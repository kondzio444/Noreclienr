/*
 * NoreDomains – one SQLite-backed Durable Object (idFromName('global'), binding DOMAINS) with the
 * official Nore domains (docs/domains.md): who owns which <name>.noreclient.pl, where it points, the
 * Cloudflare record ids created for it, admin reservations, the official Nore MC SRV record, the last
 * signed timestamp per Nore ID (replay protection) and small rate-limit counters.
 *
 * Every change runs through one queue, so two requests never race on the DNS of the same name.
 * Methods return { error: { status, code, message } } for expected failures (RPC does not carry
 * custom error fields), like NoreAdmin.
 */
import { DurableObject } from 'cloudflare:workers';
import { CloudflareDns, desiredRecords, zoneOf } from './cfdns.js';

const fail = (status, code, message, extra) => ({ error: { status, code, message, ...extra } });
const parse = (s, d = null) => { try { return s == null ? d : JSON.parse(s); } catch { return d; } };
const HOUR = 3600000, DAY = 86400000;
const CLEANUP_EVERY = HOUR;

export class NoreDomains extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.env = env;
    this.sql = ctx.storage.sql;
    this.queue = Promise.resolve();
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS domains (
        name TEXT PRIMARY KEY, owner TEXT NOT NULL, type TEXT, address TEXT, port INTEGER,
        records TEXT NOT NULL DEFAULT '[]', state TEXT NOT NULL, error TEXT,
        created INTEGER NOT NULL, updated INTEGER NOT NULL, refreshed INTEGER NOT NULL, ip TEXT, by TEXT);
      CREATE INDEX IF NOT EXISTS domains_owner ON domains (owner);
      CREATE INDEX IF NOT EXISTS domains_refreshed ON domains (refreshed);
      CREATE TABLE IF NOT EXISTS reserved (name TEXT PRIMARY KEY, reason TEXT NOT NULL DEFAULT '', by TEXT, created INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS official (key TEXT PRIMARY KEY, host TEXT NOT NULL, port INTEGER NOT NULL, type TEXT NOT NULL,
        records TEXT NOT NULL DEFAULT '[]', updated INTEGER NOT NULL, by TEXT);
      CREATE TABLE IF NOT EXISTS nonces (hex TEXT PRIMARY KEY, ts INTEGER NOT NULL, at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS rate (key TEXT PRIMARY KEY, start INTEGER NOT NULL, n INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);`);
  }

  /** Runs fn after every change queued before it (and keeps the queue alive after a failure). */
  serial(fn) {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => {});
    return run.catch(e => (e.status ? null : console.error('nore domains', e && e.stack || e), fail(e.status || 500, e.code || 'internal', e.status ? e.message : 'Błąd serwera domen – spróbuj za chwilę')));
  }

  dns() { return new CloudflareDns(this.env); }
  zone() { return zoneOf(this.env); }

  row(name) {
    const r = this.sql.exec('SELECT * FROM domains WHERE name = ?', name).toArray()[0];
    return r ? { ...r, records: parse(r.records, []), by: parse(r.by) } : null;
  }

  isReserved(name) { return this.sql.exec('SELECT 1 FROM reserved WHERE name = ?', name).toArray().length > 0; }

  /** A signed request must carry a newer ts than the last one of the same Nore ID. */
  nonce(hex, ts) {
    const last = this.sql.exec('SELECT ts FROM nonces WHERE hex = ?', hex).toArray()[0];
    if (last && ts <= last.ts) return fail(401, 'replay', 'To żądanie już było (powtórzony podpis) – spróbuj jeszcze raz');
    this.sql.exec('INSERT OR REPLACE INTO nonces (hex, ts, at) VALUES (?, ?, ?)', hex, ts, Date.now());
    return null;
  }

  /** Fixed-window counter: false when key went over max in the window. */
  hit(key, max, windowMs) {
    const now = Date.now();
    const r = this.sql.exec('SELECT start, n FROM rate WHERE key = ?', key).toArray()[0];
    if (!r || now - r.start >= windowMs) { this.sql.exec('INSERT OR REPLACE INTO rate (key, start, n) VALUES (?, ?, 1)', key, now); return true; }
    if (r.n >= max) return false;
    this.sql.exec('UPDATE rate SET n = n + 1 WHERE key = ?', key);
    return true;
  }

  limits() {
    const n = (v, d) => Math.max(1, parseInt(v || '', 10) || d);
    return { claimsIp: n(this.env.DOMAINS_CLAIMS_PER_HOUR, 5), claimsId: n(this.env.DOMAINS_CLAIMS_PER_DAY, 10), updates: n(this.env.DOMAINS_UPDATES_PER_HOUR, 60) };
  }

  /** Points the name's records at target (null removes them) and stores the result. */
  async apply(d, target) {
    const zone = this.zone();
    const now = Date.now();
    try {
      const records = await this.dns().sync(d.name, d.records, desiredRecords(d.name, zone, target));
      this.sql.exec('UPDATE domains SET type = ?, address = ?, port = ?, records = ?, state = ?, error = NULL, updated = ?, refreshed = ? WHERE name = ?',
        target ? target.type : null, target ? target.address : null, target ? target.port : null, JSON.stringify(records), target ? 'active' : 'pending', now, now, d.name);
      return null;
    } catch (e) {
      const records = e.records || d.records;
      this.sql.exec('UPDATE domains SET records = ?, state = ?, error = ?, updated = ? WHERE name = ?', JSON.stringify(records), 'error', String(e.message || e).slice(0, 300), now, d.name);
      throw e;
    }
  }

  // ---------------------------------------------------------------- public

  lookup(name) {
    return { domain: this.row(name), reserved: this.isReserved(name) };
  }

  claim({ name, hex, ts, ip, target, max }) {
    return this.serial(async () => {
      const bad = this.nonce(hex, ts);
      if (bad) return bad;
      const L = this.limits();
      if (!this.hit(`claim-ip:${ip}`, L.claimsIp, HOUR) || !this.hit(`claim-id:${hex}`, L.claimsId, DAY)) {
        return fail(429, 'rate_limited', 'Za dużo nowych domen – spróbuj za godzinę', { retryAfter: 3600 });
      }
      if (this.isReserved(name)) return fail(409, 'reserved', 'Ta nazwa jest zarezerwowana przez Nore.');
      const old = this.row(name);
      if (old && old.owner !== hex) return fail(409, 'taken', 'Ta nazwa jest już zajęta.');
      if (old) {
        // claiming again is harmless: refresh, and point at the new target when one came along
        if (target) await this.apply(old, target);
        else this.sql.exec('UPDATE domains SET refreshed = ? WHERE name = ?', Date.now(), name);
        return { created: false, domain: this.row(name) };
      }
      const count = this.sql.exec('SELECT COUNT(*) AS n FROM domains WHERE owner = ?', hex).one().n;
      if (count >= max) return fail(409, 'limit', `Masz już ${count} z ${max} domen Nore – zwolnij jedną, aby założyć nową.`, { max });
      const dns = this.dns();
      const foreign = await dns.foreignAt(name);
      if (foreign) return fail(409, 'name_in_use', 'Ta nazwa jest już używana w DNS Nore – wybierz inną.');
      if (this.row(name)) return fail(409, 'taken', 'Ta nazwa jest już zajęta.');
      const now = Date.now();
      this.sql.exec(`INSERT INTO domains (name, owner, records, state, created, updated, refreshed, ip) VALUES (?, ?, '[]', 'pending', ?, ?, ?, ?)`, name, hex, now, now, now, ip || null);
      if (target) {
        try { await this.apply(this.row(name), target); } catch (e) {
          // the claim failed as a whole: remove what was created and the row
          const left = this.row(name);
          try { await dns.remove(name, left ? left.records : []); this.sql.exec('DELETE FROM domains WHERE name = ?', name); } catch { /* kept as state=error for the admin */ }
          throw e;
        }
      }
      return { created: true, domain: this.row(name) };
    });
  }

  update({ name, hex, ts, target }) {
    return this.serial(async () => {
      const d = this.row(name);
      if (!d) return fail(404, 'not_found', 'Ta domena nie jest zajęta – najpierw ją załóż.');
      if (d.owner !== hex) return fail(403, 'not_owner', 'Ta domena należy do innego Nore ID.');
      const bad = this.nonce(hex, ts);
      if (bad) return bad;
      if (!this.hit(`update:${name}`, this.limits().updates, HOUR)) return fail(429, 'rate_limited', 'Za dużo zmian tej domeny – spróbuj za godzinę', { retryAfter: 3600 });
      const same = d.state === 'active' && d.type === target.type && d.address === target.address && d.port === target.port && d.records.length;
      if (same) {
        this.sql.exec('UPDATE domains SET refreshed = ? WHERE name = ?', Date.now(), name);
        return { changed: false, domain: this.row(name) };
      }
      await this.apply(d, target);
      return { changed: true, domain: this.row(name) };
    });
  }

  release({ name, hex, ts }) {
    return this.serial(async () => {
      const d = this.row(name);
      if (!d) return fail(404, 'not_found', 'Ta domena nie jest zajęta.');
      if (d.owner !== hex) return fail(403, 'not_owner', 'Ta domena należy do innego Nore ID.');
      const bad = this.nonce(hex, ts);
      if (bad) return bad;
      await this.drop(d);
      return { name };
    });
  }

  mine({ hex, ts }) {
    const bad = this.nonce(hex, ts);
    if (bad) return bad;
    if (!this.hit(`mine:${hex}`, 120, HOUR)) return fail(429, 'rate_limited', 'Za często – spróbuj za chwilę', { retryAfter: 60 });
    return { domains: this.sql.exec('SELECT name FROM domains WHERE owner = ? ORDER BY created', hex).toArray().map(r => this.row(r.name)) };
  }

  /** Deletes the DNS records of a domain, then the row (the row stays when DNS refuses). */
  async drop(d) {
    try { await this.dns().remove(d.name, d.records); } catch (e) {
      this.sql.exec('UPDATE domains SET state = ?, error = ? WHERE name = ?', 'error', String(e.message || e).slice(0, 300), d.name);
      throw e;
    }
    this.sql.exec('DELETE FROM domains WHERE name = ?', d.name);
  }

  // ---------------------------------------------------------------- expiry

  cleanup({ now, days, force }) {
    return this.serial(async () => {
      const last = Number((this.sql.exec("SELECT value FROM meta WHERE key = 'cleanup'").toArray()[0] || {}).value || 0);
      if (!force && Date.now() - last < CLEANUP_EVERY) return { skipped: true };
      this.sql.exec("INSERT OR REPLACE INTO meta (key, value) VALUES ('cleanup', ?)", String(Date.now()));
      const cutoff = now - days * DAY;
      const old = this.sql.exec('SELECT name FROM domains WHERE refreshed < ? ORDER BY refreshed LIMIT 50', cutoff).toArray();
      const expired = [], failed = [];
      for (const { name } of old) {
        try { await this.drop(this.row(name)); expired.push(name); } catch (e) { failed.push({ name, error: String(e.message || e) }); }
      }
      this.sql.exec('DELETE FROM nonces WHERE at < ?', Date.now() - 30 * DAY);
      this.sql.exec('DELETE FROM rate WHERE start < ?', Date.now() - 2 * DAY);
      return { expired, failed, cutoff: new Date(cutoff).toISOString() };
    });
  }

  // ---------------------------------------------------------------- admin

  adminList({ q = '', limit = 200 }) {
    const like = q ? `%${String(q).toLowerCase().replace(/[%_]/g, '')}%` : null;
    const rows = this.sql.exec('SELECT name FROM domains WHERE (? IS NULL OR name LIKE ? OR owner LIKE ? OR address LIKE ?) ORDER BY updated DESC LIMIT ?', like, like, like, like, limit).toArray();
    return { total: this.sql.exec('SELECT COUNT(*) AS n FROM domains').one().n, domains: rows.map(r => this.row(r.name)) };
  }

  adminGet(name) { return { domain: this.row(name), reserved: this.isReserved(name) }; }

  adminRevoke(name, { reserve, reason, by }) {
    return this.serial(async () => {
      const d = this.row(name);
      if (!d) return fail(404, 'not_found', 'Nie ma takiej domeny');
      await this.drop(d);
      if (reserve) this.sql.exec('INSERT OR REPLACE INTO reserved (name, reason, by, created) VALUES (?, ?, ?, ?)', name, reason || 'odebrana przez administratora', JSON.stringify(by), Date.now());
      return { name, owner: d.owner };
    });
  }

  adminTransfer(name, hex, max) {
    return this.serial(async () => {
      const d = this.row(name);
      if (!d) return fail(404, 'not_found', 'Nie ma takiej domeny');
      if (d.owner === hex) return fail(409, 'same_owner', 'Ta domena już należy do tego Nore ID');
      const count = this.sql.exec('SELECT COUNT(*) AS n FROM domains WHERE owner = ?', hex).one().n;
      if (count >= max) return fail(409, 'limit', `Ten Nore ID ma już ${count} z ${max} domen`);
      this.sql.exec('UPDATE domains SET owner = ?, refreshed = ?, updated = ? WHERE name = ?', hex, Date.now(), Date.now(), name);
      return { domain: this.row(name), from: d.owner };
    });
  }

  reservedList() {
    return this.sql.exec('SELECT * FROM reserved ORDER BY name').toArray().map(r => ({ name: r.name, reason: r.reason, by: parse(r.by), created: r.created }));
  }

  reserve(name, reason, by) {
    this.sql.exec('INSERT OR REPLACE INTO reserved (name, reason, by, created) VALUES (?, ?, ?, ?)', name, reason, JSON.stringify(by), Date.now());
    return { taken: !!this.row(name) };
  }

  unreserve(name) {
    if (!this.isReserved(name)) return fail(404, 'not_found', 'Ta nazwa nie jest zarezerwowana');
    this.sql.exec('DELETE FROM reserved WHERE name = ?', name);
    return { name };
  }

  // ---------------------------------------------------------------- official Nore MC (mc.<zone>)

  officialRow() {
    const r = this.sql.exec("SELECT * FROM official WHERE key = 'mc'").toArray()[0];
    return r ? { ...r, records: parse(r.records, []), by: parse(r.by) } : null;
  }

  official() {
    const zone = this.zone();
    const r = this.officialRow();
    if (!r) return { configured: false, address: `mc.${zone}`, srv: `_minecraft._tcp.mc.${zone}` };
    return {
      configured: true, address: `mc.${zone}`, srv: `_minecraft._tcp.mc.${zone}`, host: r.host, port: r.port, type: r.type,
      target: r.type === 'CNAME' ? r.host : `mc-srv.${zone}`, records: r.records, updatedAt: new Date(r.updated).toISOString(), by: r.by,
    };
  }

  /**
   * SRV _minecraft._tcp.mc.<zone> → host:port. An IP gets its own DNS-only A / AAAA at mc-srv.<zone>
   * (an SRV target must be a name). mc.<zone> itself – the website – is never touched.
   */
  setOfficial({ host, port, type }, by) {
    return this.serial(async () => {
      const zone = this.zone();
      const dns = this.dns();
      const old = this.officialRow();
      const oldRecs = old ? old.records : [];
      const hostRecs = oldRecs.filter(r => r.name === `mc-srv.${zone}`);
      const srvRecs = oldRecs.filter(r => r.name === `_minecraft._tcp.mc.${zone}`);
      const save = (records) => this.sql.exec(`INSERT OR REPLACE INTO official (key, host, port, type, records, updated, by) VALUES ('mc', ?, ?, ?, ?, ?, ?)`,
        host, port, type, JSON.stringify(records), Date.now(), JSON.stringify(by));
      let a = hostRecs, s = srvRecs;
      try {
        a = await dns.sync('mc-srv', hostRecs, type === 'CNAME' ? [] : [{ type, name: `mc-srv.${zone}`, content: host }]);
        const target = type === 'CNAME' ? host : `mc-srv.${zone}`;
        s = await dns.sync('mc', srvRecs, [{ type: 'SRV', name: `_minecraft._tcp.mc.${zone}`, data: { priority: 0, weight: 5, port, target } }]);
      } catch (e) {
        if (e.records) { if (a === hostRecs) a = e.records; else s = e.records; }
        save([...a, ...s]);
        throw e;
      }
      save([...a, ...s]);
      return { official: this.official() };
    });
  }

  clearOfficial() {
    return this.serial(async () => {
      const zone = this.zone();
      const old = this.officialRow();
      if (old) {
        const dns = this.dns();
        await dns.remove('mc-srv', old.records.filter(r => r.name === `mc-srv.${zone}`));
        await dns.remove('mc', old.records.filter(r => r.name === `_minecraft._tcp.mc.${zone}`));
        this.sql.exec("DELETE FROM official WHERE key = 'mc'");
      }
      return { official: this.official() };
    });
  }

  counts() {
    return { domains: this.sql.exec('SELECT COUNT(*) AS n FROM domains').one().n, reserved: this.sql.exec('SELECT COUNT(*) AS n FROM reserved').one().n, official: !!this.officialRow() };
  }
}
