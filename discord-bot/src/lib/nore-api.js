/**
 * Nore API client.
 *  - bot endpoints of API v2 (docs/bot-api.md) with `Authorization: Bot <NORE_BOT_SECRET>`,
 *  - public data: API v2 first, then API v1 (web/src/worker.js) as a fallback, so every command
 *    keeps working while v2 is not deployed yet.
 * When the API is unreachable it logs once, backs off and retries – it never throws to callers of
 * the `public*` helpers (they get null) and the bot endpoints report `{ ok:false }`.
 */
import { request, Backoff, HttpError } from './http.js';
import { logger } from './logger.js';

const log = logger.child('api');

export class NoreApi {
  constructor({ base, secret }) {
    this.base = base.replace(/\/+$/, '');
    this.secret = secret;
    this.backoff = new Backoff({ base: 15_000, max: 300_000 });
    this.offline = false;
    this.v2Missing = new Map(); // public path -> until (ms): v2 answered 404, use v1 for a while
    this.cache = new Map();     // public path -> { at, data }
    this.eventBuckets = new Map(); // guildId -> { tokens, at }
  }

  get botEnabled() { return !!this.secret; }

  markOk() {
    if (this.backoff.ok() || this.offline) log.info('Nore API reachable again');
    this.offline = false;
  }

  markFail(err) {
    const first = this.backoff.fail();
    if (first) log.warn('Nore API unreachable – working offline, retrying with backoff', { error: err.message, status: err.status });
    this.offline = true;
  }

  // ---------------------------------------------------------------- bot endpoints (v2)

  async bot(method, path, body) {
    if (!this.secret) return { ok: false, skipped: true };
    if (!this.backoff.ready()) return { ok: false, offline: true };
    try {
      const res = await request(`${this.base}/api/v2${path}`, { method, body, headers: { Authorization: `Bot ${this.secret}` } });
      this.markOk();
      return { ok: true, data: res.data, status: res.status };
    } catch (err) {
      // 4xx: the API is up, the request is wrong (or the guild unknown) – no backoff
      if (err.status >= 400 && err.status < 500) {
        this.markOk();
        if (err.status !== 404) log.warn('bot endpoint rejected request', { method, path, status: err.status, body: err.body });
        return { ok: false, status: err.status, data: err.body };
      }
      this.markFail(err);
      return { ok: false, offline: true };
    }
  }

  getConfig(guildId) { return this.bot('GET', `/bot/guilds/${guildId}/config`); }
  putMeta(guildId, meta) { return this.bot('PUT', `/bot/guilds/${guildId}/meta`, meta); }
  deleteGuild(guildId) { return this.bot('DELETE', `/bot/guilds/${guildId}`); }
  changes(since) { return this.bot('GET', `/bot/changes?since=${Math.max(0, Math.floor(since))}`); }

  /** Optional audit events, rate limited client-side to 100/min per guild as the contract says. */
  async event(guildId, type, data = {}) {
    if (!this.secret) return { ok: false, skipped: true };
    const now = Date.now();
    const b = this.eventBuckets.get(guildId) || { tokens: 100, at: now };
    b.tokens = Math.min(100, b.tokens + ((now - b.at) / 60_000) * 100);
    b.at = now;
    this.eventBuckets.set(guildId, b);
    if (b.tokens < 1) return { ok: false, limited: true };
    b.tokens -= 1;
    return this.bot('POST', `/bot/guilds/${guildId}/events`, { type, data });
  }

  // ---------------------------------------------------------------- public data

  /**
   * GET a public resource: v2 path first, then the v1 path (if given). Cached for `ttl` ms; on
   * failure the last good copy is returned (stale) or null.
   */
  async public(v2Path, v1Path, { ttl = 60_000, map1 = (d) => d } = {}) {
    const key = `${v2Path}|${v1Path}`;
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < ttl) return hit.data;
    const tryGet = async (url) => (await request(url, { timeout: 8000 })).data;
    let data = null;
    const v2Blocked = (this.v2Missing.get(v2Path) || 0) > Date.now();
    if (!v2Blocked) {
      try { data = await tryGet(`${this.base}/api/v2${v2Path}`); } catch (err) {
        if (err instanceof HttpError && (err.status === 404 || err.status === 405 || err.status === 501)) this.v2Missing.set(v2Path, Date.now() + 10 * 60_000);
        if (err.status === 400 || err.status === 422) return { error: err.body?.error || 'bad_request', status: err.status };
      }
    }
    if (data === null && v1Path) {
      try { data = map1(await tryGet(`${this.base}/api/v1${v1Path}`)); } catch (err) {
        if (!hit) log.debug('public API request failed', { path: v1Path, error: err.message });
      }
    }
    if (data !== null && data !== undefined) { this.cache.set(key, { at: Date.now(), data }); return data; }
    return hit ? hit.data : null;
  }

  status() { return this.public('/status', '/status', { ttl: 30_000 }); }
  latestRelease() { return this.public('/releases/latest', '/version', { ttl: 120_000 }).then(unwrapRelease); }
  releases(limit = 10) { return this.public(`/releases?limit=${limit}`, `/releases?limit=${limit}`, { ttl: 120_000 }).then(d => d?.releases ?? (Array.isArray(d) ? d : null)); }
  downloads() { return this.public('/downloads', '/version', { ttl: 300_000 }); }
  events() { return this.public('/events', '/events', { ttl: 300_000 }).then(d => d?.events ?? (Array.isArray(d) ? d : null)); }
  news() { return this.public('/news', '/news', { ttl: 300_000 }).then(d => d?.news ?? (Array.isArray(d) ? d : null)); }
  stats() { return this.public('/stats', '/stats', { ttl: 300_000 }); }
  hubStats() { return this.public('/stats', '/hub/stats', { ttl: 60_000 }); }

  /** Nore Hub lookup; v1 returns { players: { lowercaseName: {...} } }. */
  player(name) {
    const n = encodeURIComponent(name);
    return this.public(`/players/${n}`, `/hub/players?names=${n}`, {
      ttl: 20_000,
      map1: (d) => {
        const p = d?.players?.[String(name).toLowerCase()];
        return p ? { ...p, nore: true } : { name, nore: false };
      },
    }).then((d) => (d && d.player ? d.player : d));
  }

  /** Server ping via API v2 (null when v2 lacks it – caller falls back to the local SLP ping). */
  server(address) {
    return this.public(`/servers/${encodeURIComponent(address)}`, null, { ttl: 30_000 });
  }
}

/** /releases/latest may be the release itself or { release }. */
function unwrapRelease(d) {
  if (!d) return null;
  if (d.release) return d.release;
  if (d.version) return d;
  return null;
}

export { unwrapRelease };
