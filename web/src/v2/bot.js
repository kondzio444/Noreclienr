/*
 * Nore Bot → API v2 (docs/bot-api.md), header `Authorization: Bot <NORE_BOT_SECRET>`.
 *
 *   GET    /api/v2/bot/guilds/:guildId/config   { guildId, version, updatedAt, config }
 *   PATCH  /api/v2/bot/guilds/:guildId/config   { config (partial, merged), baseVersion?, by?, reason? }
 *                                               → { guildId, version, updatedAt, config }
 *   PUT    /api/v2/bot/guilds/:guildId/meta     { name, icon, channels, roles }
 *   DELETE /api/v2/bot/guilds/:guildId          the bot left the guild
 *   GET    /api/v2/bot/changes?since=<ms>       { now, guilds }
 *   POST   /api/v2/bot/guilds/:guildId/events   { type, data }   (100/min per guild)
 *   GET    /api/v2/bot/config.schema.json       the configuration schema (public, also for the panel)
 */
import SCHEMA from '../bot-schema.json';
import { ApiError, readJson, safeEqual } from './http.js';
import { effectiveConfig, applyDefaults, validate } from './schema.js';
import { botStore } from './store.js';

export { SCHEMA };
export const SNOWFLAKE = /^\d{17,20}$/;
const EVENT_TYPE = /^[a-z][a-z0-9_.:-]{0,47}$/;
export const iso = (ms) => (ms ? new Date(ms).toISOString() : null);
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

export function store(env) {
  const s = botStore(env);
  if (!s) throw new ApiError(503, 'unavailable', 'Magazyn Nore Bota jest chwilowo niedostępny');
  return s;
}

/** Unwraps a NoreBot RPC result ({ error } → ApiError). */
export function unwrap(r) {
  if (r && r.error) {
    const { status, code, message, ...extra } = r.error;
    throw new ApiError(status, code, message, extra);
  }
  return r;
}

export function guildIdOf(raw) {
  if (!SNOWFLAKE.test(raw)) throw new ApiError(400, 'bad_guild_id', 'Zły identyfikator serwera Discord (17–20 cyfr)');
  return raw;
}

export async function requireBot(request, env) {
  const secret = String(env.NORE_BOT_SECRET || '');
  if (secret.length < 16) throw new ApiError(503, 'bot_api_disabled', 'API bota nie jest skonfigurowane na serwerze (NORE_BOT_SECRET)');
  const m = /^Bot\s+(\S+)$/.exec(request.headers.get('Authorization') || '');
  if (!m) throw new ApiError(401, 'unauthorized', 'Brak nagłówka Authorization: Bot <sekret>', undefined);
  if (!(await safeEqual(m[1], secret))) throw new ApiError(401, 'unauthorized', 'Zły sekret bota');
}

const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : null);
const snowOrNull = (v) => (typeof v === 'string' && SNOWFLAKE.test(v) ? v : null);

/** Keeps only what the panel needs from the bot's guild report. */
export function cleanMeta(b) {
  if (typeof b.name !== 'string' || !b.name.trim()) throw new ApiError(400, 'bad_meta', 'meta: wymagane pole name');
  if (b.channels !== undefined && !Array.isArray(b.channels)) throw new ApiError(400, 'bad_meta', 'meta: channels musi być listą');
  if (b.roles !== undefined && !Array.isArray(b.roles)) throw new ApiError(400, 'bad_meta', 'meta: roles musi być listą');
  if ((b.channels || []).length > 1000 || (b.roles || []).length > 500) throw new ApiError(400, 'bad_meta', 'meta: najwyżej 1000 kanałów i 500 ról');
  const channels = (b.channels || []).filter(c => isObj(c) && SNOWFLAKE.test(c.id)).map(c => ({
    id: c.id, name: str(c.name, 100) || '', type: typeof c.type === 'number' || typeof c.type === 'string' ? (typeof c.type === 'string' ? c.type.slice(0, 32) : c.type) : null,
    parentId: snowOrNull(c.parentId), ...(Number.isInteger(c.position) ? { position: c.position } : {}),
  }));
  const roles = (b.roles || []).filter(r => isObj(r) && SNOWFLAKE.test(r.id)).map(r => ({
    id: r.id, name: str(r.name, 100) || '', color: Number.isInteger(r.color) ? r.color : 0, position: Number.isInteger(r.position) ? r.position : 0, managed: r.managed === true,
  }));
  return { name: b.name.slice(0, 100), icon: str(b.icon, 200), channels, roles, ...(Number.isInteger(b.memberCount) ? { memberCount: b.memberCount } : {}) };
}

/**
 * Merges a partial config into the current one (RFC 7386 style): objects are merged key by key,
 * arrays and scalars replace, null removes the key (its schema default applies again).
 */
export function mergePatch(base, patch) {
  if (!isObj(patch)) return structuredClone(patch);
  const out = isObj(base) ? { ...base } : {};
  for (const [k, v] of Object.entries(patch)) {
    if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
    if (v === null) delete out[k];
    else out[k] = isObj(v) ? mergePatch(out[k], v) : structuredClone(v);
  }
  return out;
}

const REASON = /^[a-z][a-z0-9_.:-]{0,39}$/;
const PATCH_TRIES = 4;

/**
 * The bot writes what it changed itself (builder, /config, panel actions): the partial config is
 * merged into the stored one, validated against the schema, saved as a new version (updatedBy is
 * the bot) and the merged config is returned. Without baseVersion a concurrent save is retried on
 * the new version (field-level merge); with baseVersion a different current version is a 409.
 */
async function patchConfig(request, env, guildId) {
  const b = await readJson(request, 256 * 1024);
  if (!isObj(b.config)) throw new ApiError(400, 'bad_config', 'config musi być obiektem (część konfiguracji do scalenia)');
  if (b.baseVersion !== undefined && b.baseVersion !== null && (!Number.isInteger(b.baseVersion) || b.baseVersion < 0)) throw new ApiError(400, 'bad_version', 'baseVersion: liczba całkowita ≥ 0 – wersja, na której bot oparł zmianę');
  const base = Number.isInteger(b.baseVersion) ? b.baseVersion : null;
  const reason = typeof b.reason === 'string' && REASON.test(b.reason) ? b.reason : null;
  const actor = isObj(b.by) && SNOWFLAKE.test(b.by.id) ? { userId: b.by.id } : {};
  const by = { id: 'bot', name: 'Nore Bot', bot: true, ...actor, ...(reason ? { reason } : {}) };
  const s = store(env);
  for (let attempt = 0; attempt < PATCH_TRIES; attempt++) {
    const cur = await s.getConfig(guildId);
    if (base !== null && base !== cur.version) {
      throw new ApiError(409, 'version_conflict', 'Konfiguracja zmieniła się w międzyczasie – pobierz ją jeszcze raz', { version: cur.version, updatedAt: iso(cur.updatedAt) });
    }
    const config = applyDefaults(mergePatch(effectiveConfig(cur.config, SCHEMA), b.config), SCHEMA);
    const errors = validate(config, SCHEMA);
    if (errors.length) throw new ApiError(400, 'invalid_config', `Konfiguracja ma błędy (${errors.length})`, { errors: errors.map(({ path, message, keyword }) => ({ path, pointer: path, message, keyword })) });
    const saved = await s.saveConfig(guildId, config, cur.version, by, 'bot_config_saved');
    if (!saved.error) return { guildId, version: saved.version, updatedAt: iso(saved.updatedAt), updatedBy: by, config };
    if (saved.error.code !== 'version_conflict' || base !== null) unwrap({ error: { ...saved.error, updatedAt: iso(saved.error.updatedAt) } });
  }
  throw new ApiError(409, 'version_conflict', 'Konfiguracja zmienia się zbyt często – spróbuj za chwilę');
}

export async function botRoute(request, url, env, parts) {
  // parts: path after /api/v2/bot/
  if (parts === 'config.schema.json') return { body: { schema: SCHEMA }, raw: SCHEMA };
  await requireBot(request, env);
  const m = request.method === 'HEAD' ? 'GET' : request.method;

  if (parts === 'changes') {
    if (m !== 'GET') throw new ApiError(405, 'method_not_allowed', 'Tylko GET');
    const since = Number(url.searchParams.get('since') || 0);
    if (!Number.isFinite(since) || since < 0) throw new ApiError(400, 'bad_since', 'since: czas w milisekundach (≥ 0)');
    return { body: await store(env).changes(Math.floor(since)) };
  }

  const g = /^guilds\/([^/]+)(\/config|\/meta|\/events)?$/.exec(parts);
  if (!g) throw new ApiError(404, 'not_found', 'Nie ma takiego endpointu bota – zobacz docs/bot-api.md');
  const guildId = guildIdOf(g[1]);
  const sub = g[2] || '';

  if (sub === '/config') {
    if (m === 'PATCH') return { body: await patchConfig(request, env, guildId) };
    if (m !== 'GET') throw new ApiError(405, 'method_not_allowed', 'Tylko GET lub PATCH');
    const r = await store(env).getConfig(guildId);
    return { body: { guildId, version: r.version, updatedAt: iso(r.updatedAt), config: effectiveConfig(r.config, SCHEMA) } };
  }
  if (sub === '/meta') {
    if (m !== 'PUT') throw new ApiError(405, 'method_not_allowed', 'Tylko PUT');
    const meta = cleanMeta(await readJson(request, 512 * 1024));
    const r = await store(env).putMeta(guildId, meta);
    return { body: { guildId, present: true, metaAt: iso(r.metaAt) } };
  }
  if (sub === '/events') {
    if (m !== 'POST') throw new ApiError(405, 'method_not_allowed', 'Tylko POST');
    const b = await readJson(request, 8 * 1024);
    if (typeof b.type !== 'string' || !EVENT_TYPE.test(b.type)) throw new ApiError(400, 'bad_event', 'type: małe litery, cyfry i _ . : - (do 48 znaków)');
    const data = b.data === undefined ? {} : b.data;
    if (!isObj(data)) throw new ApiError(400, 'bad_event', 'data musi być obiektem');
    if (JSON.stringify(data).length > 4096) throw new ApiError(413, 'too_large', 'data: najwyżej 4 KB');
    const r = unwrap(await store(env).addEvent(guildId, b.type, data));
    return { body: { id: r.id, at: iso(r.at) }, status: 201 };
  }
  if (m !== 'DELETE') throw new ApiError(405, 'method_not_allowed', 'Tylko DELETE');
  unwrap(await store(env).removeGuild(guildId));
  return { body: { guildId, present: false } };
}
