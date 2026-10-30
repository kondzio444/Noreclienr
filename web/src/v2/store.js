/*
 * NoreBot – one SQLite-backed Durable Object (idFromName('global'), binding BOT) with the state of
 * Nore Bot and its panel (docs/bot-api.md):
 *
 *   guilds    configuration (versioned), what the bot reported (meta) and whether the bot is there
 *   events    audit/stat events per guild, capped (EVENTS_KEEP newest per guild)
 *   sessions  panel logins: Discord access token and a short-lived copy of the user's guild list
 *   actions   the admin's action queue for the bot (send a message, leave a guild, reload …)
 *
 * Called over Durable Object RPC. Methods never throw for expected outcomes; they return
 * { error: { status, code, message } } instead (RPC does not carry custom error fields).
 */
import { DurableObject } from 'cloudflare:workers';

const EVENTS_KEEP = 500;        // newest events kept per guild
const EVENTS_PER_MIN = 100;     // per guild (docs/bot-api.md)
const fail = (status, code, message, extra) => ({ error: { status, code, message, ...extra } });

export class NoreBot extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.lastNow = 0;            // last `now` given out by changes(): later writes get a newer updated_at
    this.buckets = new Map();    // guildId → { minute, n } event rate limit
    this.inserts = 0;
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS guilds (
        id TEXT PRIMARY KEY, present INTEGER NOT NULL DEFAULT 0,
        version INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL DEFAULT 0, updated_by TEXT,
        config TEXT, meta TEXT, meta_at INTEGER, joined_at INTEGER, left_at INTEGER);
      CREATE INDEX IF NOT EXISTS guilds_updated ON guilds (updated_at);
      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT NOT NULL, type TEXT NOT NULL, data TEXT NOT NULL, at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS events_guild ON events (guild_id, id);
      CREATE TABLE IF NOT EXISTS sessions (
        sid TEXT PRIMARY KEY, user_id TEXT NOT NULL, user TEXT NOT NULL, access_token TEXT NOT NULL,
        token_exp INTEGER NOT NULL, guilds TEXT, guilds_at INTEGER, created INTEGER NOT NULL, expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS actions (
        id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT, type TEXT NOT NULL, data TEXT NOT NULL, status TEXT NOT NULL,
        by TEXT NOT NULL, created INTEGER NOT NULL, done_at INTEGER, result TEXT);
      CREATE INDEX IF NOT EXISTS actions_status ON actions (status, id);`);
  }

  guild(id) {
    return this.sql.exec('SELECT * FROM guilds WHERE id = ?', id).toArray()[0] || null;
  }

  stamp() {
    const t = Math.max(Date.now(), this.lastNow + 1);
    this.lastNow = Math.max(this.lastNow, t);
    return t;
  }

  // ---------------------------------------------------------------- bot

  getConfig(guildId) {
    const g = this.guild(guildId);
    return { guildId, version: g ? g.version : 0, updatedAt: g && g.updated_at ? g.updated_at : null, config: g && g.config ? JSON.parse(g.config) : null, present: !!(g && g.present) };
  }

  putMeta(guildId, meta) {
    const now = Date.now();
    this.sql.exec(`INSERT INTO guilds (id, present, meta, meta_at, joined_at) VALUES (?, 1, ?, ?, ?)
      ON CONFLICT (id) DO UPDATE SET present = 1, meta = excluded.meta, meta_at = excluded.meta_at,
        joined_at = CASE WHEN guilds.present = 1 AND guilds.joined_at IS NOT NULL THEN guilds.joined_at ELSE excluded.joined_at END, left_at = NULL`,
    guildId, JSON.stringify(meta), now, now);
    return { guildId, present: true, metaAt: now };
  }

  removeGuild(guildId) {
    const g = this.guild(guildId);
    if (!g) return fail(404, 'unknown_guild', 'Nieznany serwer');
    this.sql.exec('UPDATE guilds SET present = 0, left_at = ? WHERE id = ?', Date.now(), guildId);
    return { guildId, present: false };
  }

  changes(since) {
    const now = Date.now();
    this.lastNow = Math.max(this.lastNow, now);
    const guilds = this.sql.exec('SELECT id FROM guilds WHERE updated_at > ? AND updated_at <= ? ORDER BY updated_at LIMIT 1000', since, now).toArray().map(r => r.id);
    return { now, guilds };
  }

  addEvent(guildId, type, data) {
    const now = Date.now();
    const minute = Math.floor(now / 60000);
    const b = this.buckets.get(guildId);
    if (b && b.minute === minute && b.n >= EVENTS_PER_MIN) return fail(429, 'rate_limited', `Najwyżej ${EVENTS_PER_MIN} zdarzeń na minutę na serwer`, { retryAfter: 60 - Math.floor((now % 60000) / 1000) });
    if (!b || b.minute !== minute) this.buckets.set(guildId, { minute, n: 1 }); else b.n++;
    const r = this.sql.exec('INSERT INTO events (guild_id, type, data, at) VALUES (?, ?, ?, ?) RETURNING id', guildId, type, JSON.stringify(data), now).one();
    if (++this.inserts % 25 === 0) this.capEvents(guildId);
    if (this.buckets.size > 5000) for (const [k, v] of this.buckets) if (v.minute !== minute) this.buckets.delete(k);
    return { id: r.id, at: now };
  }

  capEvents(guildId) {
    this.sql.exec(`DELETE FROM events WHERE guild_id = ? AND id <= (SELECT id FROM events WHERE guild_id = ? ORDER BY id DESC LIMIT 1 OFFSET ?)`, guildId, guildId, EVENTS_KEEP);
  }

  events(guildId, limit = 50) {
    return this.sql.exec('SELECT id, type, data, at FROM events WHERE guild_id = ? ORDER BY id DESC LIMIT ?', guildId, Math.min(200, limit)).toArray()
      .map(r => ({ id: r.id, type: r.type, data: JSON.parse(r.data), at: r.at }));
  }

  // ---------------------------------------------------------------- panel

  panelGuild(guildId) {
    const g = this.guild(guildId);
    if (!g) return { present: false };
    return {
      present: !!g.present, version: g.version, updatedAt: g.updated_at || null, updatedBy: g.updated_by ? JSON.parse(g.updated_by) : null,
      config: g.config ? JSON.parse(g.config) : null, meta: g.meta ? JSON.parse(g.meta) : null, metaAt: g.meta_at || null,
      events: this.events(guildId, 50),
    };
  }

  /** Saves a validated config when `expected` is the current version; bumps the version. */
  saveConfig(guildId, config, expected, by) {
    const g = this.guild(guildId);
    const current = g ? g.version : 0;
    if (expected !== current) return fail(409, 'version_conflict', 'Konfiguracja zmieniła się w międzyczasie – odśwież panel i zapisz jeszcze raz', { version: current, updatedAt: g && g.updated_at ? g.updated_at : null, updatedBy: g && g.updated_by ? JSON.parse(g.updated_by) : null });
    const version = current + 1;
    const at = this.stamp();
    this.sql.exec(`INSERT INTO guilds (id, version, updated_at, updated_by, config) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (id) DO UPDATE SET version = excluded.version, updated_at = excluded.updated_at, updated_by = excluded.updated_by, config = excluded.config`,
    guildId, version, at, JSON.stringify(by), JSON.stringify(config));
    this.sql.exec('INSERT INTO events (guild_id, type, data, at) VALUES (?, ?, ?, ?)', guildId, 'panel_config_saved', JSON.stringify({ version, by }), at);
    return { version, updatedAt: at };
  }

  /** Which of these guild ids have the bot. */
  presence(ids) {
    if (!Array.isArray(ids) || !ids.length) return [];
    return this.sql.exec('SELECT id FROM guilds WHERE present = 1 AND id IN (SELECT value FROM json_each(?))', JSON.stringify(ids.slice(0, 1000))).toArray().map(r => r.id);
  }

  stats() {
    const r = this.sql.exec('SELECT SUM(present = 1) AS present, SUM(version > 0) AS configured FROM guilds').one();
    return { guilds: r.present || 0, configured: r.configured || 0 };
  }

  // ---------------------------------------------------------------- admin (docs/admin-api.md)

  /** Every guild the bot reported, with its config version and the newest event time. */
  adminGuilds() {
    return this.sql.exec(`SELECT g.id, g.present, g.version, g.updated_at, g.updated_by, g.meta, g.meta_at, g.joined_at, g.left_at,
        (SELECT MAX(at) FROM events e WHERE e.guild_id = g.id) AS last_event
      FROM guilds g ORDER BY g.present DESC, g.meta_at DESC LIMIT 2000`).toArray().map(r => {
      const meta = r.meta ? JSON.parse(r.meta) : null;
      return {
        id: r.id, present: !!r.present, name: meta ? meta.name : null, icon: meta ? meta.icon : null, memberCount: meta && meta.memberCount !== undefined ? meta.memberCount : null,
        channels: meta ? meta.channels.length : 0, roles: meta ? meta.roles.length : 0, version: r.version, updatedAt: r.updated_at || null,
        updatedBy: r.updated_by ? JSON.parse(r.updated_by) : null, metaAt: r.meta_at, joinedAt: r.joined_at, leftAt: r.left_at, lastEvent: r.last_event,
      };
    });
  }

  /** The newest events of every guild. */
  recentEvents(limit = 100, type = null) {
    return this.sql.exec('SELECT id, guild_id, type, data, at FROM events WHERE (? IS NULL OR type = ?) ORDER BY id DESC LIMIT ?', type, type, Math.max(1, Math.min(500, limit)))
      .toArray().map(r => ({ id: r.id, guildId: r.guild_id, type: r.type, data: JSON.parse(r.data), at: r.at }));
  }

  actionRow(r) {
    return { id: r.id, guildId: r.guild_id, type: r.type, data: JSON.parse(r.data), status: r.status, by: JSON.parse(r.by), created: r.created, doneAt: r.done_at, result: r.result ? JSON.parse(r.result) : null };
  }

  queueAction(guildId, type, data, by) {
    const pending = this.sql.exec("SELECT COUNT(*) AS n FROM actions WHERE status = 'pending'").one().n;
    if (pending >= 200) return fail(429, 'queue_full', 'W kolejce czeka już 200 akcji – poczekaj, aż bot je wykona');
    const r = this.sql.exec("INSERT INTO actions (guild_id, type, data, status, by, created) VALUES (?, ?, ?, 'pending', ?, ?) RETURNING *",
      guildId, type, JSON.stringify(data), JSON.stringify(by), Date.now()).one();
    this.sql.exec("DELETE FROM actions WHERE status <> 'pending' AND id <= (SELECT id FROM actions ORDER BY id DESC LIMIT 1 OFFSET 1000)");
    return { action: this.actionRow(r) };
  }

  actions({ status = null, limit = 100 } = {}) {
    return this.sql.exec('SELECT * FROM actions WHERE (? IS NULL OR status = ?) ORDER BY id DESC LIMIT ?', status, status, Math.max(1, Math.min(500, limit)))
      .toArray().map(r => this.actionRow(r));
  }

  /** Pending actions for the bot, oldest first. */
  pendingActions() {
    return this.sql.exec("SELECT * FROM actions WHERE status = 'pending' ORDER BY id LIMIT 50").toArray().map(r => this.actionRow(r));
  }

  finishAction(id, ok, result) {
    const r = this.sql.exec('SELECT * FROM actions WHERE id = ?', id).toArray()[0];
    if (!r) return fail(404, 'not_found', 'Nie ma takiej akcji');
    if (r.status !== 'pending') return fail(409, 'not_pending', 'Ta akcja nie czeka już na wykonanie');
    this.sql.exec('UPDATE actions SET status = ?, done_at = ?, result = ? WHERE id = ?', ok ? 'done' : 'failed', Date.now(), JSON.stringify(result ?? null), id);
    return { action: this.actionRow(this.sql.exec('SELECT * FROM actions WHERE id = ?', id).one()) };
  }

  cancelAction(id) {
    const r = this.sql.exec('SELECT * FROM actions WHERE id = ?', id).toArray()[0];
    if (!r) return fail(404, 'not_found', 'Nie ma takiej akcji');
    if (r.status !== 'pending') return fail(409, 'not_pending', 'Ta akcja nie czeka już na wykonanie');
    this.sql.exec("UPDATE actions SET status = 'cancelled', done_at = ? WHERE id = ?", Date.now(), id);
    return { action: this.actionRow(this.sql.exec('SELECT * FROM actions WHERE id = ?', id).one()) };
  }

  // ---------------------------------------------------------------- sessions

  createSession(s) {
    const now = Date.now();
    this.sql.exec('DELETE FROM sessions WHERE expires < ?', now);
    this.sql.exec('INSERT INTO sessions (sid, user_id, user, access_token, token_exp, created, expires) VALUES (?, ?, ?, ?, ?, ?, ?)',
      s.sid, s.user.id, JSON.stringify(s.user), s.accessToken, s.tokenExp, now, s.expires);
    return { sid: s.sid };
  }

  getSession(sid) {
    const r = this.sql.exec('SELECT * FROM sessions WHERE sid = ?', sid).toArray()[0];
    if (!r) return null;
    if (r.expires < Date.now() || r.token_exp < Date.now()) { this.sql.exec('DELETE FROM sessions WHERE sid = ?', sid); return null; }
    return { sid: r.sid, userId: r.user_id, user: JSON.parse(r.user), accessToken: r.access_token, guilds: r.guilds ? JSON.parse(r.guilds) : null, guildsAt: r.guilds_at || 0, expires: r.expires };
  }

  setSessionGuilds(sid, guilds) {
    this.sql.exec('UPDATE sessions SET guilds = ?, guilds_at = ? WHERE sid = ?', JSON.stringify(guilds), Date.now(), sid);
    return true;
  }

  deleteSession(sid) {
    this.sql.exec('DELETE FROM sessions WHERE sid = ?', sid);
    return true;
  }
}

/** The global NoreBot stub, or null when the binding is missing. */
export const botStore = (env) => (env.BOT ? env.BOT.get(env.BOT.idFromName('global')) : null);
