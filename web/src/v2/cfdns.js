/*
 * Cloudflare DNS for the official Nore domains (<name>.noreclient.pl, docs/domains.md).
 *
 * Secrets / vars (never in git):
 *   CF_DNS_TOKEN   API token with Zone → DNS → Edit on the noreclient.pl zone only
 *   CF_ZONE_ID     the zone id of noreclient.pl (var or secret)
 *   CF_API         API base (tests only; default https://api.cloudflare.com/client/v4)
 *   DOMAINS_ZONE   zone name (default noreclient.pl)
 *
 * Strict allowlist: this module only ever creates, changes or deletes records
 *   - whose name is <label>.<zone> or _minecraft._tcp.<label>.<zone> for the label being worked on,
 *   - that it created itself (the caller passes the record ids it stored), and
 *   - whose comment on Cloudflare still starts with "nore-domain:<label>".
 * A record that fails any of these checks is never touched; the operation stops with 409.
 * Every record is DNS-only (proxied: false) – Minecraft speaks plain TCP.
 */
import { ApiError } from './http.js';

export const DEFAULT_ZONE = 'noreclient.pl';
const API = 'https://api.cloudflare.com/client/v4';
const TTL = 60;
export const COMMENT = 'nore-domain:';
const isOurs = (r, label) => String(r.comment || '').trim() === COMMENT + label;

export const zoneOf = (env) => String(env.DOMAINS_ZONE || DEFAULT_ZONE).toLowerCase();
export const dnsConfigured = (env) => !!(env.CF_DNS_TOKEN && env.CF_ZONE_ID);

export function requireDns(env) {
  if (!dnsConfigured(env)) {
    throw new ApiError(503, 'domains_disabled', 'Domeny Nore są chwilowo wyłączone – administrator nie skonfigurował jeszcze dostępu do DNS (CF_DNS_TOKEN, CF_ZONE_ID).');
  }
}

/** The two record names a label may own. */
export const namesFor = (label, zone) => ({ host: `${label}.${zone}`, srv: `_minecraft._tcp.${label}.${zone}` });

export class CloudflareDns {
  constructor(env) {
    requireDns(env);
    this.base = String(env.CF_API || API).replace(/\/+$/, '');
    this.zoneId = String(env.CF_ZONE_ID);
    this.token = String(env.CF_DNS_TOKEN);
    this.zone = zoneOf(env);
    this.calls = 0;
  }

  async call(method, path, body) {
    if (++this.calls > 40) throw new ApiError(502, 'dns_error', 'Za dużo operacji DNS naraz');
    let res;
    try {
      res = await fetch(`${this.base}/zones/${encodeURIComponent(this.zoneId)}${path}`, {
        method,
        headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json', 'User-Agent': 'nore-domains' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(8000),
      });
    } catch { throw new ApiError(502, 'dns_error', 'Cloudflare DNS nie odpowiada – spróbuj za chwilę'); }
    const j = await res.json().catch(() => null);
    if (res.status === 404 && method !== 'POST') return null;
    if (!res.ok || !j || j.success === false) {
      const why = j && Array.isArray(j.errors) && j.errors[0] ? `${j.errors[0].code || ''} ${j.errors[0].message || ''}`.trim() : `HTTP ${res.status}`;
      console.error('cloudflare dns', method, path, res.status, why);
      if (res.status === 401 || res.status === 403) throw new ApiError(503, 'domains_disabled', 'Token Cloudflare nie ma dostępu do strefy DNS (Zone → DNS → Edit) – zgłoś to administratorowi.');
      throw new ApiError(502, 'dns_error', `Cloudflare DNS odrzucił zmianę (${why.slice(0, 120)})`);
    }
    return j.result;
  }

  /** Every record with exactly this name. */
  async byName(name) {
    const r = await this.call('GET', `/dns_records?name=${encodeURIComponent(name)}&per_page=100`);
    return Array.isArray(r) ? r : [];
  }

  /** The label owns these names only; `mc.<zone>` itself (the website) is never one of them. */
  assertAllowed(label, name) {
    const n = namesFor(label, this.zone);
    if (name !== n.host && name !== n.srv) throw new ApiError(409, 'foreign_record', `Rekord ${name} nie należy do ${label}.${this.zone}`);
    if (name === `mc.${this.zone}` || name === this.zone || name === `www.${this.zone}`) throw new ApiError(409, 'foreign_record', `Rekord ${name} jest chroniony`);
  }

  /** Reads a stored record back: null when gone, the record when it is still ours, else 409. */
  async owned(label, rec) {
    this.assertAllowed(label, rec.name);
    const r = await this.call('GET', `/dns_records/${encodeURIComponent(rec.id)}`);
    if (!r) return null;
    if (String(r.name).toLowerCase() !== rec.name || !isOurs(r, label)) {
      throw new ApiError(409, 'foreign_record', `Rekord ${rec.name} został zmieniony poza Nore API – nie zostanie dotknięty. Zgłoś to administratorowi.`);
    }
    return r;
  }

  body(label, d) {
    const base = { type: d.type, name: d.name, ttl: TTL, comment: COMMENT + label };
    if (d.type === 'SRV') return { ...base, data: d.data };
    return { ...base, content: d.content, proxied: false };
  }

  /**
   * Makes the records of `label` equal to `desired` ([{ type, name, content | data }]); `stored` are
   * the records created earlier ([{ id, type, name }]). Returns the new stored list. On a failure
   * half way the list of what exists now is attached to the error (e.records) so nothing is lost.
   */
  async sync(label, stored, desired) {
    for (const d of desired) this.assertAllowed(label, d.name);
    const now = [];
    const keep = [];
    try {
      // 1. our old records: changed in place when the same type/name is still wanted, else removed
      for (const rec of stored || []) {
        const want = desired.find(d => d.type === rec.type && d.name === rec.name && !keep.includes(d));
        const live = await this.owned(label, rec);
        if (!live) continue;
        if (want) { keep.push(want); now.push({ rec, want, live }); continue; }
        await this.call('DELETE', `/dns_records/${encodeURIComponent(rec.id)}`);
      }
      const out = [];
      for (const { rec, want, live } of now) {
        const same = want.type === 'SRV'
          ? live.data && Number(live.data.port) === want.data.port && String(live.data.target).replace(/\.$/, '') === want.data.target
          : String(live.content) === want.content && live.proxied === false;
        if (!same) await this.call('PATCH', `/dns_records/${encodeURIComponent(rec.id)}`, this.body(label, want));
        out.push({ id: rec.id, type: rec.type, name: rec.name });
      }
      // 2. new records – only when nobody else has a record with that name
      for (const d of desired.filter(x => !keep.includes(x))) {
        const ours = new Set(out.map(r => r.id));
        const foreign = (await this.byName(d.name)).filter(r => !ours.has(r.id));
        if (foreign.length) throw new ApiError(409, 'name_in_use', `Nazwa ${d.name} ma już inne rekordy DNS – wybierz inną nazwę.`);
        const r = await this.call('POST', '/dns_records', this.body(label, d));
        out.push({ id: r.id, type: d.type, name: d.name });
      }
      return out;
    } catch (e) {
      e.records = await this.survivors(label, stored, desired).catch(() => stored || []);
      throw e;
    }
  }

  /** After a failed sync: which of our records exist now (old ids plus anything we just created). */
  async survivors(label, stored, desired) {
    const out = [];
    // stored ids that still exist stay tracked (even when their comment was edited by hand)
    for (const rec of stored || []) {
      if (await this.call('GET', `/dns_records/${encodeURIComponent(rec.id)}`)) out.push(rec);
    }
    const names = [...new Set(desired.map(d => d.name))];
    for (const name of names) {
      for (const r of await this.byName(name)) {
        if (isOurs(r, label) && !out.some(x => x.id === r.id)) out.push({ id: r.id, type: r.type, name });
      }
    }
    return out;
  }

  /** Removes every stored record of the label (skipping ones already gone). */
  async remove(label, stored) {
    for (const rec of stored || []) {
      const live = await this.owned(label, rec);
      if (live) await this.call('DELETE', `/dns_records/${encodeURIComponent(rec.id)}`);
    }
    return [];
  }

  /** Is anything at the label's names that Nore did not create? */
  async foreignAt(label, storedIds = []) {
    const n = namesFor(label, this.zone);
    const ids = new Set(storedIds);
    for (const name of [n.host, n.srv]) {
      if ((await this.byName(name)).some(r => !ids.has(r.id))) return name;
    }
    return null;
  }
}

/**
 * Records wanted for a target { type: A | AAAA | CNAME, address, port }:
 *   A / AAAA / CNAME at <label>.<zone>, plus SRV _minecraft._tcp.<label>.<zone> when the port is not
 *   25565 (to <label>.<zone> for an IP; straight to the tunnel host for a CNAME – SRV must not point
 *   at an alias).
 */
export function desiredRecords(label, zone, target) {
  if (!target) return [];
  const n = namesFor(label, zone);
  const out = [{ type: target.type, name: n.host, content: target.address }];
  if (target.port && target.port !== 25565) {
    out.push({ type: 'SRV', name: n.srv, data: { priority: 0, weight: 5, port: target.port, target: target.type === 'CNAME' ? target.address : n.host } });
  }
  return out;
}
