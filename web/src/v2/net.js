/*
 * Address parsing, DNS-over-HTTPS (SRV, A, AAAA) and the private/loopback address block list for
 * the Minecraft server ping. DOH_URL overrides the resolver (tests only).
 */
import { ApiError } from './http.js';

const DOH = 'https://cloudflare-dns.com/dns-query';
const HOST = /^(?=.{1,253}$)(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))*\.?$/i;
const BLOCKED_NAMES = /(^|\.)(localhost|local|internal|intranet|lan|home\.arpa|localdomain|invalid|test|example|onion)\.?$/i;

/** Parses "host", "host:port", "1.2.3.4:25565", "[2001:db8::1]:25565". */
export function parseAddress(raw) {
  let s = String(raw || '').trim().toLowerCase();
  if (!s || s.length > 260) throw new ApiError(400, 'bad_address', 'Podaj adres serwera, np. play.example.pl albo play.example.pl:25565');
  let host, port = null;
  const v6 = /^\[([0-9a-f:.]+)\](?::(\d{1,5}))?$/.exec(s);
  if (v6) { host = v6[1]; port = v6[2] ?? null; }
  else if ((s.match(/:/g) || []).length > 1) host = s; // bare IPv6
  else { const i = s.lastIndexOf(':'); if (i >= 0) { host = s.slice(0, i); port = s.slice(i + 1); } else host = s; }
  if (port !== null) {
    if (!/^\d{1,5}$/.test(port) || +port < 1 || +port > 65535) throw new ApiError(400, 'bad_port', 'Zły port – liczba od 1 do 65535');
    port = +port;
  }
  host = host.replace(/\.$/, '');
  const ip = ipKind(host);
  if (!ip && !HOST.test(host)) throw new ApiError(400, 'bad_address', 'Zły adres serwera – dozwolone są nazwy domen i adresy IP');
  if (!ip && !host.includes('.')) throw new ApiError(400, 'bad_address', 'Podaj pełną nazwę domeny, np. play.example.pl');
  return { host, port, ip };
}

// ---------------------------------------------------------------- IP addresses

function v4(s) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s);
  if (!m) return null;
  const o = m.slice(1).map(Number);
  return o.every(x => x <= 255) && m.slice(1).every(x => x === '0' || !x.startsWith('0')) ? o : null;
}

/** 8 hextets, or null. */
function v6(s) {
  if (!/^[0-9a-f:.]+$/i.test(s) || !s.includes(':')) return null;
  const lastColon = s.lastIndexOf(':');
  if (s.slice(lastColon + 1).includes('.')) { // embedded IPv4 tail (::ffff:1.2.3.4) → two hextets
    const o = v4(s.slice(lastColon + 1));
    if (!o) return null;
    s = s.slice(0, lastColon + 1) + ((o[0] << 8) | o[1]).toString(16) + ':' + ((o[2] << 8) | o[3]).toString(16);
  }
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const part = (x) => (x ? x.split(':') : []);
  const head = part(halves[0]), rest = halves.length === 2 ? part(halves[1]) : [];
  if ([...head, ...rest].some(h => !/^[0-9a-f]{1,4}$/i.test(h))) return null;
  const missing = 8 - head.length - rest.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  return [...head.map(h => parseInt(h, 16)), ...Array(halves.length === 2 ? missing : 0).fill(0), ...rest.map(h => parseInt(h, 16))];
}

export function ipKind(s) {
  if (v4(s)) return 4;
  if (v6(s)) return 6;
  return 0;
}

function privateV4([a, b, c]) {
  return a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) || (a === 192 && b === 0 && (c === 0 || c === 2)) || (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) || (a === 203 && b === 0 && c === 113) || (a === 192 && b === 88 && c === 99);
}

/** Loopback, private, link-local, CGNAT, multicast, documentation and reserved ranges. */
export function isPrivateIp(s) {
  const a = v4(s);
  if (a) return privateV4(a);
  const h = v6(s);
  if (!h) return true;
  if (h.every(x => x === 0)) return true;                                     // ::
  if (h.slice(0, 7).every(x => x === 0) && h[7] === 1) return true;           // ::1
  const mapped = h.slice(0, 5).every(x => x === 0) && (h[5] === 0xffff || h[5] === 0);
  const nat64 = h[0] === 0x64 && h[1] === 0xff9b && h.slice(2, 6).every(x => x === 0);
  if (mapped || nat64) return privateV4([h[6] >> 8, h[6] & 255, h[7] >> 8, h[7] & 255]);
  if ((h[0] & 0xfe00) === 0xfc00) return true;                               // fc00::/7 unique local
  if ((h[0] & 0xffc0) === 0xfe80 || (h[0] & 0xffc0) === 0xfec0) return true; // link-local, site-local
  if ((h[0] & 0xff00) === 0xff00) return true;                               // multicast
  if (h[0] === 0x2001 && h[1] === 0x0db8) return true;                        // documentation
  if (h[0] === 0x2002) return privateV4([h[1] >> 8, h[1] & 255, h[2] >> 8, h[2] & 255]); // 6to4
  if (h[0] === 0x2001 && h[1] === 0) return true;                             // Teredo
  if (h[0] === 0x0100 && h.slice(1, 4).every(x => x === 0)) return true;      // discard
  return false;
}

export const isBlockedName = (host) => BLOCKED_NAMES.test(host);

// ---------------------------------------------------------------- DNS over HTTPS

async function doh(env, name, type) {
  const url = `${env.DOH_URL || DOH}?name=${encodeURIComponent(name)}&type=${type}`;
  let res;
  try { res = await fetch(url, { headers: { Accept: 'application/dns-json' }, signal: AbortSignal.timeout(2500) }); } catch { throw new ApiError(504, 'dns_timeout', 'Serwer DNS nie odpowiedział na czas'); }
  if (!res.ok) throw new ApiError(502, 'dns_error', `Błąd DNS (${res.status})`);
  const j = await res.json().catch(() => null);
  if (!j || (j.Status !== 0 && j.Status !== 3)) return [];
  return Array.isArray(j.Answer) ? j.Answer : [];
}

/** `_minecraft._tcp.<host>` → { target, port } or null. */
export async function srvLookup(env, host) {
  const answers = (await doh(env, `_minecraft._tcp.${host}`, 'SRV')).filter(a => a.type === 33);
  const recs = answers.map(a => String(a.data).trim().split(/\s+/)).filter(p => p.length === 4).map(([pr, w, port, target]) => ({ priority: +pr, weight: +w, port: +port, target: target.replace(/\.$/, '').toLowerCase() }))
    .filter(r => r.port > 0 && r.port < 65536 && r.target && r.target !== '.' && (HOST.test(r.target) || ipKind(r.target)));
  if (!recs.length) return null;
  recs.sort((a, b) => a.priority - b.priority || b.weight - a.weight);
  return { target: recs[0].target, port: recs[0].port };
}

/** First A (else AAAA) address of a name, or null. */
export async function resolveHost(env, host) {
  const a = (await doh(env, host, 'A')).filter(x => x.type === 1 && v4(String(x.data)));
  if (a.length) return { ip: String(a[0].data), family: 4 };
  const aaaa = (await doh(env, host, 'AAAA')).filter(x => x.type === 28 && v6(String(x.data)));
  if (aaaa.length) return { ip: String(aaaa[0].data).toLowerCase(), family: 6 };
  return null;
}
