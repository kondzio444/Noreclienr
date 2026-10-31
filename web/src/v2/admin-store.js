/*
 * NoreAdmin – one SQLite-backed Durable Object (idFromName('global'), binding ADMIN) with what the
 * administrators of Nore control (docs/admin-api.md):
 *
 *   blacklist      Minecraft names / UUIDs, Nore IDs and Discord IDs (optional expiry)
 *   announcements  title, body, level, targets (launcher, mod, web, discord), start / end
 *   warns          warnings and notes per player, with history (revoked ones are kept)
 *   flags          maintenance, minimum launcher version, module kill-switch, feature switches
 *   audit          every admin write: who, what, when, from where
 *
 * Called over Durable Object RPC. Methods return { error: { status, code, message } } for expected
 * failures (RPC does not carry custom error fields), like NoreBot (src/v2/store.js).
 */
import { DurableObject } from 'cloudflare:workers';

const AUDIT_KEEP = 5000;
const fail = (status, code, message, extra) => ({ error: { status, code, message, ...extra } });
const parse = (s, d = null) => { try { return s == null ? d : JSON.parse(s); } catch { return d; } };

export const FLAG_DEFAULTS = {
  maintenance: { enabled: false, message: '' },
  minLauncherVersion: null,
  killSwitch: { modules: [] },
  features: {},
};

export class NoreAdmin extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.writes = 0;
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS blacklist (
        id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, value TEXT NOT NULL, display TEXT NOT NULL,
        reason TEXT NOT NULL DEFAULT '', by TEXT NOT NULL, created INTEGER NOT NULL, expires INTEGER,
        UNIQUE (kind, value));
      CREATE TABLE IF NOT EXISTS announcements (
        id TEXT PRIMARY KEY, title TEXT NOT NULL, body TEXT NOT NULL, level TEXT NOT NULL, targets TEXT NOT NULL,
        link TEXT, starts INTEGER NOT NULL, ends INTEGER, created INTEGER NOT NULL, updated INTEGER NOT NULL, by TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS warns (
        id INTEGER PRIMARY KEY AUTOINCREMENT, subject_kind TEXT NOT NULL, subject TEXT NOT NULL, display TEXT NOT NULL,
        kind TEXT NOT NULL, text TEXT NOT NULL, by TEXT NOT NULL, created INTEGER NOT NULL, revoked INTEGER, revoked_by TEXT);
      CREATE INDEX IF NOT EXISTS warns_subject ON warns (subject_kind, subject);
      CREATE TABLE IF NOT EXISTS flags (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated INTEGER NOT NULL, by TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS audit (
        id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, actor TEXT NOT NULL, action TEXT NOT NULL,
        target TEXT, data TEXT, ip TEXT);`);
  }

  // ---------------------------------------------------------------- audit

  audit(actor, action, target, data, ip) {
    const at = Date.now();
    const r = this.sql.exec('INSERT INTO audit (at, actor, action, target, data, ip) VALUES (?, ?, ?, ?, ?, ?) RETURNING id',
      at, JSON.stringify(actor), action, target == null ? null : String(target).slice(0, 200), data == null ? null : JSON.stringify(data).slice(0, 8000), ip || null).one();
    if (++this.writes % 50 === 0) this.sql.exec('DELETE FROM audit WHERE id <= (SELECT id FROM audit ORDER BY id DESC LIMIT 1 OFFSET ?)', AUDIT_KEEP);
    return { id: r.id, at };
  }

  auditList(limit = 100, before = null, action = null) {
    const lim = Math.max(1, Math.min(500, limit | 0 || 100));
    const rows = this.sql.exec(`SELECT * FROM audit WHERE (? IS NULL OR id < ?) AND (? IS NULL OR action LIKE ?) ORDER BY id DESC LIMIT ?`,
      before, before, action, action ? `${action}%` : null, lim).toArray();
    return rows.map(r => ({ id: r.id, at: r.at, actor: parse(r.actor, {}), action: r.action, target: r.target, data: parse(r.data), ip: r.ip }));
  }

  // ---------------------------------------------------------------- blacklist

  blacklist({ all = false } = {}) {
    const now = Date.now();
    return this.sql.exec('SELECT * FROM blacklist WHERE (? = 1 OR expires IS NULL OR expires > ?) ORDER BY id DESC', all ? 1 : 0, now).toArray()
      .map(r => ({ id: r.id, kind: r.kind, value: r.value, display: r.display, reason: r.reason, by: parse(r.by, {}), created: r.created, expires: r.expires, active: r.expires == null || r.expires > now }));
  }

  blacklistAdd(e, by) {
    const now = Date.now();
    const old = this.sql.exec('SELECT id FROM blacklist WHERE kind = ? AND value = ?', e.kind, e.value).toArray()[0];
    if (old) {
      this.sql.exec('UPDATE blacklist SET display = ?, reason = ?, by = ?, created = ?, expires = ? WHERE id = ?', e.display, e.reason, JSON.stringify(by), now, e.expires, old.id);
      return { id: old.id, updated: true };
    }
    const r = this.sql.exec('INSERT INTO blacklist (kind, value, display, reason, by, created, expires) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id',
      e.kind, e.value, e.display, e.reason, JSON.stringify(by), now, e.expires).one();
    return { id: r.id, updated: false };
  }

  blacklistRemove(id) {
    const row = this.sql.exec('SELECT * FROM blacklist WHERE id = ?', id).toArray()[0];
    if (!row) return fail(404, 'not_found', 'Nie ma takiego wpisu na czarnej liście');
    this.sql.exec('DELETE FROM blacklist WHERE id = ?', id);
    return { id, kind: row.kind, value: row.value };
  }

  /** Which of these { kind: value } pairs are blacklisted right now. */
  blacklistCheck(pairs) {
    const now = Date.now();
    const hits = [];
    for (const [kind, value] of pairs.slice(0, 10)) {
      const r = this.sql.exec('SELECT kind, value, reason, expires FROM blacklist WHERE kind = ? AND value = ? AND (expires IS NULL OR expires > ?)', kind, value, now).toArray()[0];
      if (r) hits.push({ kind: r.kind, value: r.value, reason: r.reason, expires: r.expires });
    }
    return hits;
  }

  // ---------------------------------------------------------------- announcements

  announcementRow(r) {
    return { id: r.id, title: r.title, body: r.body, level: r.level, targets: parse(r.targets, []), link: r.link, starts: r.starts, ends: r.ends, created: r.created, updated: r.updated, by: parse(r.by, {}) };
  }

  announcements({ active = false, target = null } = {}) {
    const now = Date.now();
    const rows = active
      ? this.sql.exec('SELECT * FROM announcements WHERE starts <= ? AND (ends IS NULL OR ends > ?) ORDER BY starts DESC LIMIT 50', now, now).toArray()
      : this.sql.exec('SELECT * FROM announcements ORDER BY starts DESC LIMIT 500').toArray();
    const list = rows.map(r => this.announcementRow(r));
    return target ? list.filter(a => a.targets.includes(target)) : list;
  }

  announcementPut(id, a, by) {
    const now = Date.now();
    const old = this.sql.exec('SELECT * FROM announcements WHERE id = ?', id).toArray()[0];
    if (old) {
      this.sql.exec('UPDATE announcements SET title = ?, body = ?, level = ?, targets = ?, link = ?, starts = ?, ends = ?, updated = ?, by = ? WHERE id = ?',
        a.title, a.body, a.level, JSON.stringify(a.targets), a.link, a.starts, a.ends, now, JSON.stringify(by), id);
    } else {
      this.sql.exec('INSERT INTO announcements (id, title, body, level, targets, link, starts, ends, created, updated, by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        id, a.title, a.body, a.level, JSON.stringify(a.targets), a.link, a.starts, a.ends, now, now, JSON.stringify(by));
    }
    return { announcement: this.announcementRow(this.sql.exec('SELECT * FROM announcements WHERE id = ?', id).one()), created: !old };
  }

  announcementExists(id) {
    return this.sql.exec('SELECT 1 FROM announcements WHERE id = ?', id).toArray().length > 0;
  }

  announcementRemove(id) {
    const row = this.sql.exec('SELECT * FROM announcements WHERE id = ?', id).toArray()[0];
    if (!row) return fail(404, 'not_found', 'Nie ma takiego ogłoszenia');
    this.sql.exec('DELETE FROM announcements WHERE id = ?', id);
    return { id, title: row.title };
  }

  // ---------------------------------------------------------------- warns and notes

  warnRow(r) {
    return { id: r.id, subjectKind: r.subject_kind, subject: r.subject, display: r.display, kind: r.kind, text: r.text, by: parse(r.by, {}), created: r.created, revoked: r.revoked, revokedBy: parse(r.revoked_by) };
  }

  warns({ subjectKind = null, subject = null, limit = 200 } = {}) {
    const rows = subject
      ? this.sql.exec('SELECT * FROM warns WHERE subject_kind = ? AND subject = ? ORDER BY id DESC LIMIT ?', subjectKind, subject, limit).toArray()
      : this.sql.exec('SELECT * FROM warns ORDER BY id DESC LIMIT ?', limit).toArray();
    return rows.map(r => this.warnRow(r));
  }

  /** Players with warns: subject, display, number of active warns / notes, last entry. */
  warnSubjects() {
    return this.sql.exec(`SELECT subject_kind, subject, MAX(display) AS display,
        SUM(kind = 'warn' AND revoked IS NULL) AS warns, SUM(kind = 'note' AND revoked IS NULL) AS notes, MAX(created) AS last
      FROM warns GROUP BY subject_kind, subject ORDER BY last DESC LIMIT 500`).toArray()
      .map(r => ({ subjectKind: r.subject_kind, subject: r.subject, display: r.display, warns: r.warns || 0, notes: r.notes || 0, last: r.last }));
  }

  warnAdd(w, by) {
    const r = this.sql.exec('INSERT INTO warns (subject_kind, subject, display, kind, text, by, created) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *',
      w.subjectKind, w.subject, w.display, w.kind, w.text, JSON.stringify(by), Date.now()).one();
    const count = this.sql.exec("SELECT COUNT(*) AS n FROM warns WHERE subject_kind = ? AND subject = ? AND kind = 'warn' AND revoked IS NULL", w.subjectKind, w.subject).one().n;
    return { warn: this.warnRow(r), activeWarns: count };
  }

  warnRevoke(id, by) {
    const row = this.sql.exec('SELECT * FROM warns WHERE id = ?', id).toArray()[0];
    if (!row) return fail(404, 'not_found', 'Nie ma takiego wpisu');
    if (row.revoked) return fail(409, 'already_revoked', 'Ten wpis jest już wycofany');
    this.sql.exec('UPDATE warns SET revoked = ?, revoked_by = ? WHERE id = ?', Date.now(), JSON.stringify(by), id);
    return { warn: this.warnRow(this.sql.exec('SELECT * FROM warns WHERE id = ?', id).one()) };
  }

  // ---------------------------------------------------------------- flags

  flags() {
    const out = structuredClone(FLAG_DEFAULTS);
    const meta = {};
    for (const r of this.sql.exec('SELECT * FROM flags').toArray()) {
      if (r.key in out) out[r.key] = parse(r.value, out[r.key]);
      meta[r.key] = { updated: r.updated, by: parse(r.by, {}) };
    }
    return { flags: out, meta };
  }

  setFlags(patch, by) {
    const now = Date.now();
    for (const [k, v] of Object.entries(patch)) {
      if (!(k in FLAG_DEFAULTS)) continue;
      this.sql.exec('INSERT INTO flags (key, value, updated, by) VALUES (?, ?, ?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated = excluded.updated, by = excluded.by',
        k, JSON.stringify(v), now, JSON.stringify(by));
    }
    return this.flags();
  }

  // ---------------------------------------------------------------- overview

  counts() {
    const now = Date.now();
    const one = (q, ...a) => this.sql.exec(q, ...a).one().n || 0;
    return {
      blacklist: one('SELECT COUNT(*) AS n FROM blacklist WHERE expires IS NULL OR expires > ?', now),
      announcementsActive: one('SELECT COUNT(*) AS n FROM announcements WHERE starts <= ? AND (ends IS NULL OR ends > ?)', now, now),
      announcementsScheduled: one('SELECT COUNT(*) AS n FROM announcements WHERE starts > ?', now),
      warnsActive: one("SELECT COUNT(*) AS n FROM warns WHERE kind = 'warn' AND revoked IS NULL"),
      auditToday: one('SELECT COUNT(*) AS n FROM audit WHERE at > ?', now - 86400000),
    };
  }
}

export const adminStore = (env) => (env.ADMIN ? env.ADMIN.get(env.ADMIN.idFromName('global')) : null);
