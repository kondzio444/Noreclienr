/*
 * NoreCounters – a tiny SQLite-backed Durable Object (idFromName('global'), binding COUNTERS) that
 * counts what GitHub does not: clicks on the /api/v2/downloads/:platform redirects, in total and per
 * day (the last DAYS_KEEP days are kept).
 */
import { DurableObject } from 'cloudflare:workers';

const DAYS_KEEP = 90;
const day = (t) => new Date(t).toISOString().slice(0, 10);

export class NoreCounters extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.n = 0;
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS totals (key TEXT PRIMARY KEY, n INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS daily (key TEXT NOT NULL, day TEXT NOT NULL, n INTEGER NOT NULL, PRIMARY KEY (key, day));`);
  }

  /** Adds 1 to each key (and its day bucket). */
  hit(keys) {
    const d = day(Date.now());
    for (const k of keys.slice(0, 8)) {
      this.sql.exec('INSERT INTO totals (key, n) VALUES (?, 1) ON CONFLICT (key) DO UPDATE SET n = n + 1', k);
      this.sql.exec('INSERT INTO daily (key, day, n) VALUES (?, ?, 1) ON CONFLICT (key, day) DO UPDATE SET n = n + 1', k, d);
    }
    if (++this.n % 500 === 1) this.sql.exec('DELETE FROM daily WHERE day < ?', day(Date.now() - DAYS_KEEP * 86400000));
    return true;
  }

  /** { totals: { key: n }, daily: [{ day, n }] for `dailyKey` over the last `days` days } */
  read(dailyKey = 'download', days = 30) {
    const totals = {};
    for (const r of this.sql.exec('SELECT key, n FROM totals').toArray()) totals[r.key] = r.n;
    const since = day(Date.now() - (Math.min(DAYS_KEEP, days) - 1) * 86400000);
    const rows = new Map(this.sql.exec('SELECT day, n FROM daily WHERE key = ? AND day >= ?', dailyKey, since).toArray().map(r => [r.day, r.n]));
    const daily = [];
    for (let i = Math.min(DAYS_KEEP, days) - 1; i >= 0; i--) { const d = day(Date.now() - i * 86400000); daily.push({ day: d, n: rows.get(d) || 0 }); }
    return { totals, daily };
  }
}

export const counters = (env) => (env.COUNTERS ? env.COUNTERS.get(env.COUNTERS.idFromName('global')) : null);
