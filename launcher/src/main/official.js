'use strict';
/**
 * The official partner server of Nore Client (Nore MC): constants, live status (Nore API v2, with a
 * Minecraft Server List Ping from Node as the fallback) and the servers.dat entry every Nore Client
 * instance gets. The mod keeps the entry too (it restores it when the list is loaded).
 */
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const net = require('net');
const dns = require('dns').promises;

const OFFICIAL = Object.freeze({
  name: 'Nore MC',
  address: 'mc.noreclient.pl',
  port: 25565,
  tagline: 'Oficjalny serwer partnerski Nore Client',
});
const API = (process.env.NORE_API_V2 || 'https://noreclient.pl/api/v2').replace(/\/+$/, '');

/** True when an address points at the official server (any case, with or without :25565, trailing dot). */
function matches(address) {
  if (typeof address !== 'string') return false;
  let a = address.trim().toLowerCase();
  if (a.endsWith(':25565')) a = a.slice(0, -6);
  a = a.replace(/\.+$/, '');
  return a === OFFICIAL.address;
}

// ------------------------------------------------------------------ NBT (uncompressed, as servers.dat)

const T = { END: 0, BYTE: 1, SHORT: 2, INT: 3, LONG: 4, FLOAT: 5, DOUBLE: 6, BYTE_ARRAY: 7, STRING: 8, LIST: 9, COMPOUND: 10, INT_ARRAY: 11, LONG_ARRAY: 12 };

/** Reads a whole NBT file into { name, value } where compounds are { type: 10, value: [{ name, type, value }] }. */
function readNbt(buf) {
  let o = 0;
  const u8 = () => buf.readUInt8(o++);
  const str = () => { const n = buf.readUInt16BE(o); o += 2; const s = buf.toString('utf8', o, o + n); o += n; return s; };
  const payload = (type) => {
    switch (type) {
      case T.BYTE: { const v = buf.readInt8(o); o += 1; return v; }
      case T.SHORT: { const v = buf.readInt16BE(o); o += 2; return v; }
      case T.INT: { const v = buf.readInt32BE(o); o += 4; return v; }
      case T.LONG: { const v = buf.readBigInt64BE(o); o += 8; return v; }
      case T.FLOAT: { const v = buf.readFloatBE(o); o += 4; return v; }
      case T.DOUBLE: { const v = buf.readDoubleBE(o); o += 8; return v; }
      case T.BYTE_ARRAY: { const n = buf.readInt32BE(o); o += 4; const v = Buffer.from(buf.subarray(o, o + n)); o += n; return v; }
      case T.STRING: return str();
      case T.LIST: {
        const et = u8(); const n = buf.readInt32BE(o); o += 4;
        const items = [];
        for (let i = 0; i < n; i++) items.push(payload(et));
        return { elementType: et, items };
      }
      case T.COMPOUND: {
        const entries = [];
        for (;;) {
          const t = u8();
          if (t === T.END) return entries;
          const name = str();
          entries.push({ name, type: t, value: payload(t) });
        }
      }
      case T.INT_ARRAY: { const n = buf.readInt32BE(o); o += 4; const v = []; for (let i = 0; i < n; i++, o += 4) v.push(buf.readInt32BE(o)); return v; }
      case T.LONG_ARRAY: { const n = buf.readInt32BE(o); o += 4; const v = []; for (let i = 0; i < n; i++, o += 8) v.push(buf.readBigInt64BE(o)); return v; }
      default: throw new Error(`Nieznany typ NBT ${type}`);
    }
  };
  const type = u8();
  if (type !== T.COMPOUND) throw new Error('servers.dat: zły format');
  const name = str();
  return { name, value: payload(T.COMPOUND) };
}

function writeNbt(root) {
  const parts = [];
  const push = (b) => parts.push(b);
  const num = (fn, size, v) => { const b = Buffer.alloc(size); b[fn](v, 0); push(b); };
  const str = (s) => { const b = Buffer.from(s, 'utf8'); num('writeUInt16BE', 2, b.length); push(b); };
  const payload = (type, v) => {
    switch (type) {
      case T.BYTE: return num('writeInt8', 1, v);
      case T.SHORT: return num('writeInt16BE', 2, v);
      case T.INT: return num('writeInt32BE', 4, v);
      case T.LONG: return num('writeBigInt64BE', 8, v);
      case T.FLOAT: return num('writeFloatBE', 4, v);
      case T.DOUBLE: return num('writeDoubleBE', 8, v);
      case T.BYTE_ARRAY: num('writeInt32BE', 4, v.length); return push(Buffer.from(v));
      case T.STRING: return str(v);
      case T.LIST: num('writeUInt8', 1, v.items.length ? v.elementType : (v.elementType || T.END)); num('writeInt32BE', 4, v.items.length); return v.items.forEach(i => payload(v.elementType, i));
      case T.COMPOUND: for (const e of v) { num('writeUInt8', 1, e.type); str(e.name); payload(e.type, e.value); } return num('writeUInt8', 1, T.END);
      case T.INT_ARRAY: num('writeInt32BE', 4, v.length); return v.forEach(x => num('writeInt32BE', 4, x));
      case T.LONG_ARRAY: num('writeInt32BE', 4, v.length); return v.forEach(x => num('writeBigInt64BE', 8, x));
      default: throw new Error(`Nieznany typ NBT ${type}`);
    }
  };
  num('writeUInt8', 1, T.COMPOUND);
  str(root.name || '');
  payload(T.COMPOUND, root.value);
  return Buffer.concat(parts);
}

const field = (compound, name) => compound.find(e => e.name === name);

/**
 * Returns the servers.dat bytes with the official server in it: unchanged (null) when an entry with its
 * address is listed already; a hidden ("Direct Connection") entry becomes visible; otherwise a new entry
 * is put at the top. The player's own entries are kept exactly as they are.
 */
function ensureInNbt(buf) {
  const root = buf && buf.length ? readNbt(buf) : { name: '', value: [] };
  let list = field(root.value, 'servers');
  if (!list || list.type !== T.LIST) {
    if (list) root.value.splice(root.value.indexOf(list), 1);
    list = { name: 'servers', type: T.LIST, value: { elementType: T.COMPOUND, items: [] } };
    root.value.push(list);
  }
  if (list.value.elementType !== T.COMPOUND) list.value = { elementType: T.COMPOUND, items: [] };
  const items = list.value.items;
  const isHidden = (c) => { const h = field(c, 'hidden'); return !!(h && h.value); };
  const ip = (c) => { const f = field(c, 'ip'); return f && f.type === T.STRING ? f.value : ''; };
  if (items.some(c => matches(ip(c)) && !isHidden(c))) return null;
  let entry = items.find(c => matches(ip(c)));
  if (entry) {
    items.splice(items.indexOf(entry), 1);
    const h = field(entry, 'hidden');
    if (h) h.value = 0;
    const n = field(entry, 'name');
    if (n) n.value = OFFICIAL.name; else entry.push({ name: 'name', type: T.STRING, value: OFFICIAL.name });
  } else {
    entry = [{ name: 'name', type: T.STRING, value: OFFICIAL.name }, { name: 'ip', type: T.STRING, value: OFFICIAL.address }];
  }
  items.unshift(entry);
  return writeNbt(root);
}

/** Makes sure servers.dat in the game directory lists the official server. Returns true when it was written. */
async function ensureServersDat(gameDir) {
  const file = path.join(gameDir, 'servers.dat');
  let buf = null;
  try { buf = await fsp.readFile(file); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  let out;
  try { out = ensureInNbt(buf); } catch {
    return false; // unreadable file: leave it to the game rather than overwrite the player's servers
  }
  if (!out) return false;
  await fsp.mkdir(gameDir, { recursive: true });
  const tmp = `${file}.nore-tmp`;
  await fsp.writeFile(tmp, out);
  await fsp.rename(tmp, file);
  return true;
}

// ------------------------------------------------------------------ status

function varint(n) {
  const out = [];
  let v = n >>> 0;
  do { let b = v & 0x7f; v >>>= 7; if (v) b |= 0x80; out.push(b); } while (v);
  return Buffer.from(out);
}
const packet = (...parts) => { const body = Buffer.concat(parts); return Buffer.concat([varint(body.length), body]); };
const mcString = (s) => { const b = Buffer.from(s, 'utf8'); return Buffer.concat([varint(b.length), b]); };

/** Reads a VarInt at offset; returns [value, nextOffset] or null when the buffer is too short. */
function readVarint(buf, o) {
  let v = 0, shift = 0;
  for (;;) {
    if (o >= buf.length) return null;
    const b = buf[o++];
    v |= (b & 0x7f) << shift;
    if (!(b & 0x80)) return [v >>> 0, o];
    shift += 7;
    if (shift > 35) throw new Error('VarInt za długi');
  }
}

/** Plain text of a status description (string or chat component). */
function motdText(d) {
  if (d == null) return '';
  if (typeof d === 'string') return d;
  let s = typeof d.text === 'string' ? d.text : '';
  if (Array.isArray(d.extra)) s += d.extra.map(motdText).join('');
  return s;
}

/** Server List Ping (1.7+) to host:port; resolves { players, max, version, motd, ping, favicon }. */
function slp(host, port, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const sock = net.connect({ host, port });
    let buf = Buffer.alloc(0), status = null, sent = 0;
    const done = (err, val) => { clearTimeout(timer); sock.destroy(); err ? reject(err) : resolve(val); };
    const timer = setTimeout(() => done(new Error('timeout')), timeoutMs);
    sock.on('error', (e) => done(e));
    sock.on('connect', () => {
      sock.write(packet(varint(0), varint(767), mcString(host), Buffer.from([port >> 8, port & 255]), varint(1)));
      sock.write(packet(varint(0)));
    });
    sock.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      try {
        for (;;) {
          const len = readVarint(buf, 0);
          if (!len || buf.length < len[1] + len[0]) return;
          const body = buf.subarray(len[1], len[1] + len[0]);
          buf = buf.subarray(len[1] + len[0]);
          const id = readVarint(body, 0);
          if (!status && id[0] === 0) {
            const sl = readVarint(body, id[1]);
            status = JSON.parse(body.toString('utf8', sl[1], sl[1] + sl[0]));
            sent = Date.now();
            const ping = Buffer.alloc(8); ping.writeBigInt64BE(BigInt(sent));
            sock.write(packet(varint(1), ping));
          } else if (status && id[0] === 1) {
            done(null, { status, ping: Date.now() - sent });
            return;
          }
        }
      } catch (e) { done(e); }
    });
    sock.on('close', () => { if (status) done(null, { status, ping: -1 }); });
  });
}

async function slpStatus() {
  let host = OFFICIAL.address, port = OFFICIAL.port;
  try {
    const srv = await dns.resolveSrv(`_minecraft._tcp.${OFFICIAL.address}`);
    if (srv && srv[0]) { host = srv[0].name; port = srv[0].port; }
  } catch { /* no SRV record */ }
  const { status, ping } = await slp(host, port);
  return normalize({
    online: true,
    players: status.players || {},
    version: status.version && status.version.name,
    motd: motdText(status.description),
    favicon: status.favicon,
    ping,
  }, 'ping');
}

/** Shapes an API v2 or ping result the same way for the renderer. */
function normalize(d, source) {
  const players = d.players || {};
  const num = (v) => (Number.isFinite(+v) ? +v : -1);
  const motd = d.motd && typeof d.motd === 'object'
    ? (d.motd.clean || d.motd.text || (Array.isArray(d.motd.lines) ? d.motd.lines.join('\n') : '') || motdText(d.motd)) : (d.motd || '');
  return {
    ...OFFICIAL,
    state: d.online === false ? 'offline' : 'online',
    online: d.online !== false,
    players: num(players.online != null ? players.online : d.playersOnline),
    max: num(players.max != null ? players.max : d.playersMax),
    version: typeof d.version === 'object' && d.version ? (d.version.name || '') : (d.version || ''),
    motd: String(motd), // § colour codes stay: the renderer draws them (Motd.html)
    ping: num(d.ping != null ? d.ping : d.latency),
    favicon: typeof d.favicon === 'string' && d.favicon.startsWith('data:image/') ? d.favicon : null,
    source,
    checked: Date.now(),
  };
}

let cache = null, inflight = null;
const TTL = 30_000;

/** Live status of Nore MC: API v2 first, then a direct ping; never throws. */
async function status({ force = false, fetchImpl = globalThis.fetch } = {}) {
  if (!force && cache && Date.now() - cache.checked < TTL) return cache;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 4000);
      try {
        const res = await fetchImpl(`${API}/servers/${encodeURIComponent(OFFICIAL.address)}`, { signal: ctrl.signal, headers: { accept: 'application/json' } });
        if (res.ok) {
          const body = await res.json();
          return normalize(body && body.data ? body.data : body, 'api');
        }
      } finally { clearTimeout(t); }
    } catch { /* API unreachable: ping the server ourselves */ }
    try {
      return await slpStatus();
    } catch (e) {
      const unknown = e && (e.code === 'ENOTFOUND' || e.code === 'EAI_AGAIN');
      return { ...OFFICIAL, state: unknown ? 'unknown' : 'offline', online: false, players: -1, max: -1, version: '', motd: '', ping: -1, favicon: null, source: 'ping', checked: Date.now() };
    }
  })();
  try { cache = await inflight; return cache; } finally { inflight = null; }
}

/** Instance to play Nore MC with: the selected one when it runs Nore Client, else the last played Nore Client instance. */
function pickInstance(instances, selectedId) {
  const nore = instances.filter(i => i.noreClient);
  const sel = nore.find(i => i.id === selectedId);
  if (sel) return sel;
  return nore.slice().sort((a, b) => (b.lastPlayed || 0) - (a.lastPlayed || 0))[0] || null;
}

module.exports = { OFFICIAL, matches, readNbt, writeNbt, ensureInNbt, ensureServersDat, status, normalize, pickInstance, slp, readVarint, varint };
