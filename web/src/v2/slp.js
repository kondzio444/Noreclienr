/*
 * Minecraft Server List Ping from the Worker (cloudflare:sockets):
 *   modern (1.7+): handshake (next state 1) + status request → status JSON, then ping/pong for latency
 *   legacy (1.4–1.6): 0xFE 0x01 0xFA "MC|PingHost" → 0xFF + UTF-16BE "§1\0proto\0version\0motd\0online\0max"
 *                     (and the pre-1.4 "motd§online§max" form)
 * SRV records (_minecraft._tcp) are followed when no port is given; the address is resolved through
 * DNS-over-HTTPS first and private/loopback targets are refused. Results are cached for 30 s.
 */
import { connect } from 'cloudflare:sockets';
import { ApiError } from './http.js';
import { parseAddress, ipKind, isPrivateIp, isBlockedName, srvLookup, resolveHost } from './net.js';

const DEFAULT_PORT = 25565;
const CONNECT_MS = 3500;
const MODERN_MS = 5000;
const LEGACY_MS = 3000;
const MAX_PACKET = 2 * 1024 * 1024;
const CACHE_S = 30;
const CACHE = 'https://nore-internal.invalid/v2/slp/';
const enc = new TextEncoder();

// ---------------------------------------------------------------- bytes

function varint(n) {
  const out = [];
  n >>>= 0;
  do { let b = n & 0x7f; n >>>= 7; if (n) b |= 0x80; out.push(b); } while (n);
  return out;
}
const concat = (...parts) => { const len = parts.reduce((a, p) => a + p.length, 0); const out = new Uint8Array(len); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; };
const mcString = (s) => { const b = enc.encode(s); return concat(Uint8Array.from(varint(b.length)), b); };
const packet = (id, payload) => { const body = concat(Uint8Array.from(varint(id)), payload); return concat(Uint8Array.from(varint(body.length)), body); };
const u16 = (n) => Uint8Array.of((n >> 8) & 255, n & 255);
const utf16be = (s) => { const out = new Uint8Array(s.length * 2); for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); out[2 * i] = c >> 8; out[2 * i + 1] = c & 255; } return out; };

function readVarint(buf, at) {
  let n = 0, shift = 0, i = at;
  for (let k = 0; k < 5; k++) {
    if (i >= buf.length) return null;
    const b = buf[i++];
    n |= (b & 0x7f) << shift;
    if (!(b & 0x80)) return [n, i];
    shift += 7;
  }
  throw new Error('varint');
}

/** Reads from a socket with one deadline for the whole exchange. */
class Reader {
  constructor(socket, deadline) { this.r = socket.readable.getReader(); this.buf = new Uint8Array(0); this.deadline = deadline; }
  async more() {
    const left = this.deadline - Date.now();
    if (left <= 0) throw new Error('timeout');
    let t;
    const timeout = new Promise((_, rej) => { t = setTimeout(() => rej(new Error('timeout')), left); });
    try {
      const { value, done } = await Promise.race([this.r.read(), timeout]);
      if (done) throw new Error('closed');
      this.buf = concat(this.buf, value);
      if (this.buf.length > MAX_PACKET + 16) throw new Error('too large');
    } finally { clearTimeout(t); }
  }
  async bytes(n) { while (this.buf.length < n) await this.more(); const out = this.buf.slice(0, n); this.buf = this.buf.slice(n); return out; }
  async packet() {
    let v;
    while (!(v = readVarint(this.buf, 0))) await this.more();
    const [len, at] = v;
    if (len < 1 || len > MAX_PACKET) throw new Error('bad packet');
    while (this.buf.length < at + len) await this.more();
    const body = this.buf.slice(at, at + len);
    this.buf = this.buf.slice(at + len);
    const [id, p] = readVarint(body, 0);
    return { id, body: body.slice(p) };
  }
}

async function open(ip, port, deadline) {
  const socket = connect({ hostname: ip, port });
  let t;
  const timeout = new Promise((_, rej) => { t = setTimeout(() => rej(new Error('connect timeout')), Math.max(1, Math.min(CONNECT_MS, deadline - Date.now()))); });
  try { await Promise.race([socket.opened, timeout]); } catch (e) { socket.close().catch(() => {}); throw Object.assign(new Error(String(e.message || e)), { connect: true }); } finally { clearTimeout(t); }
  return socket;
}

async function modern(ip, port, host, deadline) {
  const socket = await open(ip, port, deadline);
  const started = Date.now();
  try {
    const w = socket.writable.getWriter();
    const handshake = packet(0, concat(Uint8Array.from(varint(-1)), mcString(host), u16(port), Uint8Array.of(1)));
    await w.write(concat(handshake, packet(0, new Uint8Array(0))));
    const r = new Reader(socket, deadline);
    const p = await r.packet();
    if (p.id !== 0) throw new Error('bad status packet');
    const [len, at] = readVarint(p.body, 0);
    const status = JSON.parse(new TextDecoder().decode(p.body.slice(at, at + len)));
    const statusMs = Date.now() - started;
    let latency = statusMs;
    try {
      const payload = crypto.getRandomValues(new Uint8Array(8));
      const t0 = Date.now();
      await w.write(packet(1, payload));
      r.deadline = Math.min(deadline, Date.now() + 1500);
      const pong = await r.packet();
      if (pong.id === 1) latency = Date.now() - t0;
    } catch { /* some servers close after the status – the status round trip stands in */ }
    return { status, latency };
  } finally { socket.close().catch(() => {}); }
}

async function legacy(ip, port, host, deadline) {
  const socket = await open(ip, port, deadline);
  const started = Date.now();
  try {
    const w = socket.writable.getWriter();
    const h = utf16be(host);
    const rest = concat(Uint8Array.of(74), u16(host.length), h, Uint8Array.of((port >>> 24) & 255, (port >>> 16) & 255, (port >>> 8) & 255, port & 255));
    await w.write(concat(Uint8Array.of(0xfe, 0x01, 0xfa), u16(11), utf16be('MC|PingHost'), u16(rest.length), rest));
    const r = new Reader(socket, deadline);
    const head = await r.bytes(3);
    if (head[0] !== 0xff) throw new Error('not a legacy answer');
    const chars = (head[1] << 8) | head[2];
    const raw = await r.bytes(chars * 2);
    let text = '';
    for (let i = 0; i < raw.length; i += 2) text += String.fromCharCode((raw[i] << 8) | raw[i + 1]);
    const latency = Date.now() - started;
    if (text.startsWith('§1\u0000')) {
      const [, protocol, version, motd, online, max] = text.split('\u0000');
      return { latency, status: { version: { name: version, protocol: Number(protocol) || 0 }, players: { online: Number(online) || 0, max: Number(max) || 0 }, description: motd } };
    }
    const parts = text.split('§');
    const max = parts.pop(), online = parts.pop();
    return { latency, status: { version: { name: '<1.4', protocol: 0 }, players: { online: Number(online) || 0, max: Number(max) || 0 }, description: parts.join('§') } };
  } finally { socket.close().catch(() => {}); }
}

// ---------------------------------------------------------------- MOTD

const COLORS = { black: '0', dark_blue: '1', dark_green: '2', dark_aqua: '3', dark_red: '4', dark_purple: '5', gold: '6', gray: '7', dark_gray: '8', blue: '9', green: 'a', aqua: 'b', red: 'c', light_purple: 'd', yellow: 'e', white: 'f' };
const HEX = { 0: '#000000', 1: '#0000aa', 2: '#00aa00', 3: '#00aaaa', 4: '#aa0000', 5: '#aa00aa', 6: '#ffaa00', 7: '#aaaaaa', 8: '#555555', 9: '#5555ff', a: '#55ff55', b: '#55ffff', c: '#ff5555', d: '#ff55ff', e: '#ffff55', f: '#ffffff' };
const STYLES = { bold: 'l', italic: 'o', underlined: 'n', strikethrough: 'm', obfuscated: 'k' };

/** Chat component (string / object / array) → legacy "§"-coded text. */
export function toLegacy(c, depth = 0) {
  if (depth > 32 || c == null) return '';
  if (typeof c === 'string' || typeof c === 'number' || typeof c === 'boolean') return String(c);
  if (Array.isArray(c)) return c.map(x => toLegacy(x, depth + 1)).join('');
  if (typeof c !== 'object') return '';
  let s = '';
  if (typeof c.color === 'string') s += COLORS[c.color] ? '§' + COLORS[c.color] : /^#[0-9a-f]{6}$/i.test(c.color) ? `§#${c.color.slice(1)}` : '';
  for (const [k, code] of Object.entries(STYLES)) if (c[k] === true) s += '§' + code;
  s += typeof c.text === 'string' ? c.text : typeof c.translate === 'string' ? c.translate : '';
  if (Array.isArray(c.extra)) for (const x of c.extra) s += '§r' + s.match(/^(§(#[0-9a-f]{6}|[0-9a-fk-or]))*/i)[0] + toLegacy(x, depth + 1);
  return s;
}

export const stripCodes = (s) => s.replace(/§#[0-9a-f]{6}/gi, '').replace(/§[0-9a-fk-orx]?/gi, '');
const esc = (s) => s.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

/** Legacy text → safe HTML with inline colours (for the website). */
export function toHtml(s) {
  let html = '', color = null, styles = new Set(), buf = '';
  const flush = () => {
    if (!buf) return;
    const css = [];
    if (color) css.push(`color:${color}`);
    if (styles.has('l')) css.push('font-weight:700');
    if (styles.has('o')) css.push('font-style:italic');
    const deco = [styles.has('n') && 'underline', styles.has('m') && 'line-through'].filter(Boolean);
    if (deco.length) css.push(`text-decoration:${deco.join(' ')}`);
    const text = esc(buf).replace(/\n/g, '<br>');
    html += css.length ? `<span style="${css.join(';')}">${text}</span>` : text;
    buf = '';
  };
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '§' && i + 1 < s.length) {
      flush();
      if (s[i + 1] === '#' && /^[0-9a-f]{6}$/i.test(s.slice(i + 2, i + 8))) { color = '#' + s.slice(i + 2, i + 8).toLowerCase(); styles = new Set(); i += 7; continue; }
      const k = s[i + 1].toLowerCase();
      if (HEX[k]) { color = HEX[k]; styles = new Set(); } else if (k === 'r') { color = null; styles = new Set(); } else if ('lonmk'.includes(k)) styles.add(k);
      i++;
      continue;
    }
    buf += s[i];
  }
  flush();
  return html;
}

function shape(status, latency, kind) {
  const legacyText = toLegacy(status.description ?? '');
  const clean = stripCodes(legacyText).replace(/\r/g, '');
  const players = status.players && typeof status.players === 'object' ? status.players : {};
  const sample = Array.isArray(players.sample) ? players.sample.slice(0, 12).map(p => ({ name: stripCodes(String(p && p.name || '')).slice(0, 64), id: String(p && p.id || '').slice(0, 40) })) : [];
  const favicon = typeof status.favicon === 'string' && /^data:image\/png;base64,[A-Za-z0-9+/=\s]+$/.test(status.favicon) && status.favicon.length < 200_000 ? status.favicon.replace(/\s/g, '') : null;
  const mods = status.modinfo && Array.isArray(status.modinfo.modList) ? { type: String(status.modinfo.type || 'FML'), count: status.modinfo.modList.length }
    : status.forgeData && Array.isArray(status.forgeData.mods) ? { type: 'forge', count: status.forgeData.mods.length } : null;
  return {
    online: true,
    protocol: kind,
    latencyMs: latency,
    version: { name: stripCodes(String(status.version && status.version.name || '')).slice(0, 128), protocol: Number(status.version && status.version.protocol) || 0 },
    players: { online: Number(players.online) || 0, max: Number(players.max) || 0, sample },
    motd: { raw: legacyText.slice(0, 4096), clean: clean.slice(0, 2048), lines: clean.split('\n').slice(0, 2).map(l => l.trim()), html: toHtml(legacyText.slice(0, 4096)) },
    favicon,
    mods,
    enforcesSecureChat: status.enforcesSecureChat === true,
    previewsChat: status.previewsChat === true,
  };
}

// ---------------------------------------------------------------- the ping

/** Throws ApiError for a bad or blocked address; offline servers come back as { online: false, error }. */
export async function pingServer(env, raw, { now = Date.now() } = {}) {
  const { host, port: explicitPort, ip: hostIp } = parseAddress(raw);
  const allow = new Set(String(env.SLP_ALLOW_IPS || '').split(',').map(s => s.trim()).filter(Boolean)); // tests only
  const blocked = (ip) => isPrivateIp(ip) && !allow.has(ip);
  const base = { address: explicitPort ? `${host.includes(':') ? `[${host}]` : host}:${explicitPort}` : host, host, port: explicitPort || DEFAULT_PORT, srv: null };
  if (!hostIp && isBlockedName(host)) throw new ApiError(403, 'private_address', 'Adresy lokalne i prywatne są zablokowane');
  if (hostIp && blocked(host)) throw new ApiError(403, 'private_address', 'Adresy lokalne i prywatne są zablokowane');

  const checkedAt = new Date(now).toISOString();
  const offline = (error, code) => ({ ...base, online: false, code, error, checkedAt });

  let target = host, port = base.port;
  try {
    if (!hostIp && !explicitPort) {
      const srv = await srvLookup(env, host);
      if (srv) { base.srv = srv; target = srv.target; port = base.port = srv.port; }
    }
    let ip = target;
    if (!ipKind(target)) {
      if (isBlockedName(target)) throw new ApiError(403, 'private_address', 'Rekord SRV wskazuje na adres lokalny – zablokowane');
      const r = await resolveHost(env, target);
      if (!r) return offline('Nie znaleziono adresu serwera w DNS', 'dns_not_found');
      ip = r.ip;
    }
    if (blocked(ip)) throw new ApiError(403, 'private_address', 'Serwer wskazuje na adres prywatny albo lokalny – zablokowane');
    base.ip = ip;
  } catch (e) {
    if (e instanceof ApiError && e.status === 403) throw e;
    return offline(e.message || 'Błąd DNS', e.code || 'dns_error');
  }

  const deadline = Date.now() + MODERN_MS;
  try {
    const r = await modern(base.ip, port, host, deadline);
    return { ...base, ...shape(r.status, r.latency, 'modern'), checkedAt };
  } catch (e) {
    if (e.connect) return offline(/timeout/.test(e.message) ? 'Serwer nie odpowiada (przekroczony czas połączenia)' : 'Nie można połączyć się z serwerem', /timeout/.test(e.message) ? 'timeout' : 'refused');
    try {
      const r = await legacy(base.ip, port, host, Date.now() + LEGACY_MS);
      return { ...base, ...shape(r.status, r.latency, 'legacy'), checkedAt };
    } catch (e2) {
      return offline(/timeout/.test(String(e.message) + String(e2.message)) ? 'Serwer nie odpowiedział na zapytanie o status na czas' : 'Serwer odpowiedział, ale to nie wygląda na serwer Minecraft', /timeout/.test(String(e.message)) ? 'timeout' : 'bad_response');
    }
  }
}

// ---------------------------------------------------------------- cache + rate limit

const memLimit = new Map();
/** 20 pings per minute per IP: the SLP_LIMIT rate-limit binding when bound, else a per-isolate counter. */
export async function allowPing(env, ip) {
  if (env.SLP_LIMIT && typeof env.SLP_LIMIT.limit === 'function') {
    try { return (await env.SLP_LIMIT.limit({ key: `slp:${ip}` })).success; } catch { /* fall through */ }
  }
  const now = Date.now();
  const e = memLimit.get(ip);
  if (!e || now > e.reset) { memLimit.set(ip, { n: 1, reset: now + 60000 }); if (memLimit.size > 10000) memLimit.clear(); return true; }
  return ++e.n <= 20;
}

export function cacheKeyFor(raw) {
  const { host, port } = parseAddress(raw);
  return new Request(CACHE + encodeURIComponent(`${host}|${port || ''}`));
}

export async function cachedPing(env, ctx, raw, ip) {
  const key = cacheKeyFor(raw);
  const hit = await caches.default.match(key);
  if (hit) return { server: await hit.json(), cache: 'HIT' };
  if (!(await allowPing(env, ip))) throw new ApiError(429, 'rate_limited', 'Za dużo zapytań o serwery – najwyżej 20 na minutę. Spróbuj za chwilę', { retryAfter: 60 });
  const server = await pingServer(env, raw);
  ctx.waitUntil(caches.default.put(key, new Response(JSON.stringify(server), { headers: { 'Content-Type': 'application/json', 'Cache-Control': `public, max-age=${CACHE_S}` } })));
  return { server, cache: 'MISS' };
}
