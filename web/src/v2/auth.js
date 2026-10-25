/*
 * Discord OAuth2 login for the Nore Bot panel and the panel routes (docs/bot-api.md).
 *
 *   GET  /api/v2/auth/discord/login?next=/panel   → Discord (state + PKCE verifier in the signed cookie __Host-nore_o)
 *   GET  /api/v2/auth/discord/callback            → sets __Host-nore_s and goes back to `next`
 *   POST /api/v2/auth/logout
 *   GET  /api/v2/me                               { user, guilds:[{ id, name, icon, manageable, botPresent }] }
 *   GET  /api/v2/panel/guilds/:id                 { guild, meta, config, version, updatedAt, events }
 *   PUT  /api/v2/panel/guilds/:id/config          { config, version } → { version }   (also PUT /panel/guilds/:id)
 *
 * The session cookie is `<payload>.<HMAC-SHA256(SESSION_KEY)>`; the Discord token itself stays in the
 * NoreBot Durable Object (sessions table), so logging out revokes the cookie everywhere.
 * DISCORD_API / DISCORD_AUTHORIZE override the Discord base URLs (tests only).
 */
import { ApiError, readJson, b64url, unb64url, randomToken, allowedOrigin, safeEqual } from './http.js';
import { validate, applyDefaults, effectiveConfig } from './schema.js';
import { SCHEMA, store, unwrap, guildIdOf, iso } from './bot.js';

const SESSION_COOKIE = '__Host-nore_s';
const OAUTH_COOKIE = '__Host-nore_o';
const SESSION_MS = 7 * 86400 * 1000;
const OAUTH_MS = 10 * 60 * 1000;
const GUILDS_TTL_MS = 60 * 1000;
const MANAGE_GUILD = 0x20n, ADMINISTRATOR = 0x8n;
const enc = new TextEncoder();

// what the bot asks for when it is invited from the panel
const BOT_PERMISSIONS = [1, 2, 4, 6, 7, 10, 11, 13, 14, 15, 16, 18, 20, 24, 27, 28, 29, 34, 35, 38, 40].reduce((a, b) => a | (1n << BigInt(b)), 0n).toString();

const discordApi = (env) => String(env.DISCORD_API || 'https://discord.com/api/v10').replace(/\/+$/, '');
const discordAuthorize = (env) => String(env.DISCORD_AUTHORIZE || 'https://discord.com/oauth2/authorize');

function requireOAuth(env) {
  if (!env.DISCORD_CLIENT_ID || !env.DISCORD_CLIENT_SECRET) throw new ApiError(503, 'login_disabled', 'Logowanie przez Discord nie jest skonfigurowane na serwerze');
  sessionKey(env);
}
function sessionKey(env) {
  const k = String(env.SESSION_KEY || '');
  if (k.length < 32) throw new ApiError(503, 'login_disabled', 'Logowanie jest wyłączone – brak SESSION_KEY (min. 32 znaki) na serwerze');
  return k;
}

const keyCache = new Map();
async function hmacKey(env) {
  const raw = sessionKey(env);
  let k = keyCache.get(raw);
  if (!k) { k = await crypto.subtle.importKey('raw', enc.encode(raw), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']); keyCache.set(raw, k); }
  return k;
}

/** `<b64url(json)>.<b64url(hmac(purpose.payload))>` */
export async function sign(env, purpose, data) {
  const payload = b64url(enc.encode(JSON.stringify(data)));
  const mac = await crypto.subtle.sign('HMAC', await hmacKey(env), enc.encode(`${purpose}.${payload}`));
  return `${payload}.${b64url(new Uint8Array(mac))}`;
}

/** The signed data, or null when the value is missing, tampered with or expired. */
export async function unsign(env, purpose, value) {
  if (typeof value !== 'string' || value.length > 4096) return null;
  const [payload, mac, extra] = value.split('.');
  if (!payload || !mac || extra !== undefined) return null;
  let ok = false;
  try { ok = await crypto.subtle.verify('HMAC', await hmacKey(env), unb64url(mac), enc.encode(`${purpose}.${payload}`)); } catch { return null; }
  if (!ok) return null;
  try {
    const data = JSON.parse(new TextDecoder().decode(unb64url(payload)));
    if (!data || typeof data.exp !== 'number' || data.exp < Date.now()) return null;
    return data;
  } catch { return null; }
}

export function cookies(request) {
  const out = {};
  for (const part of (request.headers.get('Cookie') || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

const cookie = (name, value, maxAgeS) => `${name}=${value}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${maxAgeS}`;
const clearCookie = (name) => `${name}=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0`;

/** Only same-site paths ("/panel", "/panel/123?x"), never "//evil" or absolute URLs. */
export function safeNext(next) {
  return typeof next === 'string' && /^\/(?![/\\])[\x21-\x7e]{0,300}$/.test(next) ? next : '/panel';
}

function redirect(location, setCookies = []) {
  const h = new Headers({ Location: location, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
  for (const c of setCookies) h.append('Set-Cookie', c);
  return new Response(null, { status: 302, headers: h });
}

const pkceChallenge = async (verifier) => b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(verifier))));
const redirectUri = (url) => `${url.origin}/api/v2/auth/discord/callback`;

// ---------------------------------------------------------------- login / callback / logout

export async function login(request, url, env) {
  requireOAuth(env);
  const state = randomToken(24);
  const verifier = randomToken(48);
  const next = safeNext(url.searchParams.get('next'));
  const redirect_uri = redirectUri(url);
  const value = await sign(env, 'nore-o1', { state, verifier, next, redirectUri: redirect_uri, exp: Date.now() + OAUTH_MS });
  const q = new URLSearchParams({
    response_type: 'code', client_id: env.DISCORD_CLIENT_ID, scope: 'identify guilds', redirect_uri,
    state, prompt: 'none', code_challenge: await pkceChallenge(verifier), code_challenge_method: 'S256',
  });
  return redirect(`${discordAuthorize(env)}?${q}`, [cookie(OAUTH_COOKIE, value, OAUTH_MS / 1000)]);
}

/** A failed login: the browser goes back to the panel with ?login=…, API clients get JSON. */
function loginFailed(request, next, code, message, status = 400) {
  if ((request.headers.get('Accept') || '').includes('text/html')) {
    const sep = next.includes('?') ? '&' : '?';
    return redirect(`${next}${sep}login=${code}`, [clearCookie(OAUTH_COOKIE)]);
  }
  throw new ApiError(status, code, message, undefined);
}

async function discordFetch(env, path, init) {
  let res;
  try { res = await fetch(discordApi(env) + path, { ...init, signal: AbortSignal.timeout(8000) }); } catch { throw new ApiError(502, 'discord_unreachable', 'Discord nie odpowiada – spróbuj za chwilę'); }
  return res;
}

export async function callback(request, url, env) {
  requireOAuth(env);
  const o = await unsign(env, 'nore-o1', cookies(request)[OAUTH_COOKIE]);
  const next = safeNext(o && o.next);
  const q = url.searchParams;
  if (q.get('error')) return loginFailed(request, next, 'cancelled', 'Logowanie przez Discord zostało anulowane');
  if (!o) return loginFailed(request, next, 'expired', 'Sesja logowania wygasła albo jest nieprawidłowa – zacznij od nowa');
  if (!q.get('state') || !(await safeEqual(q.get('state'), o.state))) return loginFailed(request, next, 'state', 'Zły parametr state – zacznij logowanie od nowa');
  const code = q.get('code');
  if (!code || code.length > 512) return loginFailed(request, next, 'code', 'Brak kodu autoryzacji od Discorda');

  const tokenRes = await discordFetch(env, '/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({ client_id: env.DISCORD_CLIENT_ID, client_secret: env.DISCORD_CLIENT_SECRET, grant_type: 'authorization_code', code, redirect_uri: o.redirectUri || redirectUri(url), code_verifier: o.verifier }),
  });
  const token = await tokenRes.json().catch(() => null);
  if (!tokenRes.ok || !token || typeof token.access_token !== 'string') return loginFailed(request, next, 'token', 'Discord nie przyjął kodu logowania – spróbuj jeszcze raz', 401);
  if (!String(token.scope || 'identify guilds').split(' ').includes('guilds')) return loginFailed(request, next, 'scope', 'Brak zgody na listę serwerów (zakres guilds)', 401);

  const meRes = await discordFetch(env, '/users/@me', { headers: { Authorization: `Bearer ${token.access_token}` } });
  const me = await meRes.json().catch(() => null);
  if (!meRes.ok || !me || !/^\d{17,20}$/.test(String(me.id))) return loginFailed(request, next, 'user', 'Nie udało się pobrać konta Discord', 502);

  const user = { id: me.id, username: String(me.username || '').slice(0, 64), globalName: me.global_name ? String(me.global_name).slice(0, 64) : null, avatar: me.avatar ? String(me.avatar).slice(0, 64) : null };
  const now = Date.now();
  const tokenExp = now + Math.max(60, Math.min(Number(token.expires_in) || 604800, 30 * 86400)) * 1000;
  const expires = Math.min(now + SESSION_MS, tokenExp);
  const sid = randomToken(24);
  await store(env).createSession({ sid, user, accessToken: token.access_token, tokenExp, expires });
  const value = await sign(env, 'nore-s1', { sid, uid: user.id, exp: expires });
  return redirect(next, [cookie(SESSION_COOKIE, value, Math.floor((expires - now) / 1000)), clearCookie(OAUTH_COOKIE)]);
}

/** Cross-site writes are refused: the Origin of a browser request must be one of the Nore sites. */
function checkOrigin(request, env) {
  if (request.headers.get('Origin') && !allowedOrigin(request, env)) throw new ApiError(403, 'bad_origin', 'Żądanie z obcej strony zostało odrzucone');
}

export async function logout(request, env) {
  checkOrigin(request, env);
  const s = await unsign(env, 'nore-s1', cookies(request)[SESSION_COOKIE]).catch(() => null);
  if (s) await store(env).deleteSession(s.sid);
  return { body: { loggedOut: true }, headers: { 'Set-Cookie': clearCookie(SESSION_COOKIE) } };
}

// ---------------------------------------------------------------- session, guilds

export async function session(request, env) {
  sessionKey(env);
  const s = await unsign(env, 'nore-s1', cookies(request)[SESSION_COOKIE]);
  if (!s || typeof s.sid !== 'string') throw new ApiError(401, 'unauthorized', 'Zaloguj się przez Discord');
  const row = await store(env).getSession(s.sid);
  if (!row || row.userId !== s.uid) throw new ApiError(401, 'session_expired', 'Sesja wygasła – zaloguj się ponownie');
  return row;
}

/** The user's guilds from Discord, cached in the session for GUILDS_TTL_MS. */
async function userGuilds(env, sess, { fresh = false } = {}) {
  if (!fresh && sess.guilds && Date.now() - sess.guildsAt < GUILDS_TTL_MS) return sess.guilds;
  const res = await discordFetch(env, '/users/@me/guilds', { headers: { Authorization: `Bearer ${sess.accessToken}` } });
  if (res.status === 401) {
    await store(env).deleteSession(sess.sid);
    throw new ApiError(401, 'session_expired', 'Discord unieważnił logowanie – zaloguj się ponownie');
  }
  if (!res.ok) {
    if (sess.guilds) return sess.guilds; // rate limited or down: the older copy is good enough
    throw new ApiError(res.status === 429 ? 503 : 502, 'discord_error', `Discord nie zwrócił listy serwerów (${res.status}) – spróbuj za chwilę`);
  }
  const list = await res.json().catch(() => null);
  if (!Array.isArray(list)) throw new ApiError(502, 'discord_error', 'Discord zwrócił złą listę serwerów');
  const guilds = list.filter(g => g && /^\d{17,20}$/.test(String(g.id))).slice(0, 500).map(g => ({
    id: String(g.id), name: String(g.name || '').slice(0, 100), icon: g.icon ? String(g.icon).slice(0, 64) : null, owner: g.owner === true, permissions: String(g.permissions || '0'),
  }));
  await store(env).setSessionGuilds(sess.sid, guilds);
  return guilds;
}

export function canManage(g) {
  if (g.owner) return true;
  let p;
  try { p = BigInt(g.permissions); } catch { return false; }
  return (p & MANAGE_GUILD) !== 0n || (p & ADMINISTRATOR) !== 0n;
}

const iconUrl = (g) => (g.icon ? `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png?size=128` : null);
const avatarUrl = (u) => (u.avatar ? `https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.png?size=128` : null);
const inviteUrl = (env, guildId) => env.DISCORD_CLIENT_ID
  ? `https://discord.com/oauth2/authorize?${new URLSearchParams({ client_id: env.DISCORD_CLIENT_ID, scope: 'bot applications.commands', permissions: BOT_PERMISSIONS, guild_id: guildId, disable_guild_select: 'true' })}`
  : null;

export async function me(request, env) {
  const sess = await session(request, env);
  const guilds = await userGuilds(env, sess);
  const present = new Set(await store(env).presence(guilds.map(g => g.id)));
  const out = guilds.map(g => {
    const manageable = canManage(g), botPresent = present.has(g.id);
    return { id: g.id, name: g.name, icon: g.icon, iconUrl: iconUrl(g), owner: g.owner, manageable, botPresent, ...(manageable && !botPresent ? { inviteUrl: inviteUrl(env, g.id) } : {}) };
  }).sort((a, b) => (b.manageable - a.manageable) || (b.botPresent - a.botPresent) || a.name.localeCompare(b.name, 'pl'));
  return { user: { ...sess.user, avatarUrl: avatarUrl(sess.user) }, guilds: out };
}

/** The guild if the user may manage it, else 403. */
async function manageable(request, env, guildId, opts) {
  const sess = await session(request, env);
  const g = (await userGuilds(env, sess, opts)).find(x => x.id === guildId);
  if (!g || !canManage(g)) throw new ApiError(403, 'forbidden', 'Nie masz uprawnienia „Zarządzanie serwerem” na tym serwerze');
  return { sess, g };
}

export async function panelGet(request, env, rawId) {
  const guildId = guildIdOf(rawId);
  const { g } = await manageable(request, env, guildId);
  const r = await store(env).panelGuild(guildId);
  if (!r.present) throw new ApiError(404, 'bot_not_present', 'Nore Bot nie jest na tym serwerze – najpierw go dodaj', { inviteUrl: inviteUrl(env, guildId) });
  return {
    guild: { id: g.id, name: g.name, icon: g.icon, iconUrl: iconUrl(g) },
    meta: r.meta, metaAt: iso(r.metaAt),
    config: effectiveConfig(r.config, SCHEMA),
    version: r.version, updatedAt: iso(r.updatedAt), updatedBy: r.updatedBy,
    events: r.events.map(e => ({ ...e, at: iso(e.at) })),
    schema: { id: SCHEMA.$id || null, version: SCHEMA['x-version'] ?? null, url: '/api/v2/bot/config.schema.json' },
  };
}

export async function panelPut(request, env, rawId) {
  checkOrigin(request, env);
  const guildId = guildIdOf(rawId);
  const b = await readJson(request, 256 * 1024);
  if (!Number.isInteger(b.version) || b.version < 0) throw new ApiError(400, 'bad_version', 'version: liczba całkowita – wersja, którą edytujesz');
  if (b.config === null || typeof b.config !== 'object' || Array.isArray(b.config)) throw new ApiError(400, 'bad_config', 'config musi być obiektem');
  const { sess } = await manageable(request, env, guildId);
  const config = applyDefaults(b.config, SCHEMA);
  const errors = validate(config, SCHEMA);
  if (errors.length) throw new ApiError(400, 'invalid_config', `Konfiguracja ma błędy (${errors.length}) – popraw zaznaczone pola`, { errors: errors.map(({ path, message, keyword }) => ({ path, pointer: path, message, keyword })) });
  const r = await store(env).panelGuild(guildId);
  if (!r.present) throw new ApiError(404, 'bot_not_present', 'Nore Bot nie jest na tym serwerze – najpierw go dodaj');
  const by = { id: sess.user.id, name: sess.user.globalName || sess.user.username };
  const saved = unwrap(await store(env).saveConfig(guildId, config, b.version, by).then(x => (x.error ? { error: { ...x.error, updatedAt: iso(x.error.updatedAt) } } : x)));
  return { version: saved.version, updatedAt: iso(saved.updatedAt) };
}
