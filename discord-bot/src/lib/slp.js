/**
 * Minecraft Server List Ping (Java Edition, protocol ≥ 1.7) – used by /mc server when API v2
 * `/servers/:address` is not available, and by the server status monitors.
 *
 *   C→S Handshake (0x00): VarInt protocol, String host, UShort port, VarInt nextState=1
 *   C→S Status Request (0x00)
 *   S→C Status Response (0x00): String JSON
 *   C→S Ping (0x01): Long payload   S→C Pong (0x01): Long payload  → latency
 *
 * Every packet is framed as VarInt length + VarInt packet id + data.
 * SRV records (_minecraft._tcp.<host>) are honoured like the vanilla client does.
 */
import net from 'node:net';
import dns from 'node:dns/promises';

// ------------------------------------------------------------------ VarInt / packets

export function encodeVarInt(value) {
  const bytes = [];
  let v = value >>> 0; // two's complement for negatives, like Java
  do {
    let b = v & 0x7f;
    v >>>= 7;
    if (v !== 0) b |= 0x80;
    bytes.push(b);
  } while (v !== 0);
  return Buffer.from(bytes);
}

/** @returns {{ value:number, size:number } | null} null when the buffer ends mid-VarInt */
export function decodeVarInt(buf, offset = 0) {
  let value = 0, size = 0, b;
  do {
    if (offset + size >= buf.length) return null;
    b = buf[offset + size];
    value |= (b & 0x7f) << (7 * size);
    size++;
    if (size > 5) throw new Error('VarInt too big');
  } while (b & 0x80);
  return { value: value | 0, size };
}

export function encodeString(str) {
  const data = Buffer.from(str, 'utf8');
  return Buffer.concat([encodeVarInt(data.length), data]);
}

export function packet(id, ...parts) {
  const body = Buffer.concat([encodeVarInt(id), ...parts]);
  return Buffer.concat([encodeVarInt(body.length), body]);
}

export function handshakePacket(host, port, protocol = 767) {
  const p = Buffer.alloc(2);
  p.writeUInt16BE(port);
  return packet(0x00, encodeVarInt(protocol), encodeString(host), p, encodeVarInt(1));
}

export const statusRequestPacket = () => packet(0x00);

export function pingPacket(payload = BigInt(Date.now())) {
  const b = Buffer.alloc(8);
  b.writeBigInt64BE(payload);
  return packet(0x01, b);
}

/**
 * Splits complete frames out of a receive buffer.
 * @returns {{ packets: {id:number, data:Buffer}[], rest: Buffer }}
 */
export function readPackets(buf) {
  const packets = [];
  let off = 0;
  for (;;) {
    const len = decodeVarInt(buf, off);
    if (!len || off + len.size + len.value > buf.length) break;
    const start = off + len.size;
    const id = decodeVarInt(buf, start);
    packets.push({ id: id.value, data: buf.subarray(start + id.size, start + len.value) });
    off = start + len.value;
  }
  return { packets, rest: buf.subarray(off) };
}

export function decodeString(buf, offset = 0) {
  const len = decodeVarInt(buf, offset);
  if (!len) throw new Error('Truncated string');
  const start = offset + len.size;
  return { value: buf.toString('utf8', start, start + len.value), size: len.size + len.value };
}

// ------------------------------------------------------------------ MOTD / response

/** Chat component (string | object | array) → plain text without § colour codes. */
export function motdToText(desc) {
  const walk = (c) => {
    if (c === null || c === undefined) return '';
    if (typeof c === 'string') return c;
    if (Array.isArray(c)) return c.map(walk).join('');
    let s = (c.text ?? '') + (c.translate ?? '');
    if (Array.isArray(c.extra)) s += c.extra.map(walk).join('');
    return s;
  };
  return walk(desc).replace(/§[0-9a-fk-or]/gi, '').replace(/[ \t]+\n/g, '\n').trim();
}

/** Normalized result shared by the API v2 path and the local ping. */
export function shapeStatus(json, { host, port, latency = null } = {}) {
  const players = json.players || {};
  return {
    online: true,
    host, port,
    version: json.version?.name ?? null,
    protocol: json.version?.protocol ?? null,
    players: { online: players.online ?? 0, max: players.max ?? 0, sample: (players.sample || []).map(p => p.name).filter(Boolean).slice(0, 12) },
    motd: motdToText(json.description),
    favicon: typeof json.favicon === 'string' && json.favicon.startsWith('data:image/png;base64,') ? json.favicon : null,
    latency,
    secureChat: json.enforcesSecureChat ?? null,
    modded: !!(json.modinfo || json.forgeData),
  };
}

// ------------------------------------------------------------------ address

/** "play.example.org:25566" → { host, port, explicitPort } with IPv6 support "[::1]:25565". */
export function parseAddress(address) {
  const a = String(address || '').trim().toLowerCase();
  if (!a || a.length > 255) return null;
  let host = a, port = 25565, explicitPort = false;
  const v6 = /^\[([0-9a-f:]+)\](?::(\d+))?$/.exec(a);
  if (v6) { host = v6[1]; if (v6[2]) { port = +v6[2]; explicitPort = true; } }
  else {
    const m = /^([^:\s/]+)(?::(\d+))?$/.exec(a);
    if (!m) return null;
    host = m[1];
    if (m[2]) { port = +m[2]; explicitPort = true; }
  }
  if (!(port > 0 && port < 65536)) return null;
  if (!/^[a-z0-9.\-_:]+$/.test(host)) return null;
  return { host, port, explicitPort };
}

/** True for loopback / private / link-local targets (the bot must not probe the host's LAN). */
export function isPrivateHost(host) {
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) return true;
  const m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(host);
  if (m) {
    const [a, b] = [+m[1], +m[2]];
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  if (host.includes(':')) return host === '::1' || host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80');
  return false;
}

async function resolveTarget(host, port, explicitPort) {
  if (!explicitPort && !net.isIP(host)) {
    try {
      const srv = await dns.resolveSrv(`_minecraft._tcp.${host}`);
      if (srv.length) return { host: srv[0].name, port: srv[0].port };
    } catch { /* no SRV */ }
  }
  return { host, port };
}

/**
 * Pings a server. Resolves with shapeStatus(...) or { online:false, error }.
 * Never rejects.
 */
export async function ping(address, { timeout = 5000, allowPrivate = false } = {}) {
  const parsed = parseAddress(address);
  if (!parsed) return { online: false, error: 'invalid_address' };
  const target = await resolveTarget(parsed.host, parsed.port, parsed.explicitPort);
  if (!allowPrivate) {
    let ip = target.host;
    if (!net.isIP(ip)) { try { ip = (await dns.lookup(ip)).address; } catch { return { online: false, error: 'dns', host: parsed.host, port: parsed.port }; } }
    if (isPrivateHost(ip)) return { online: false, error: 'private_address', host: parsed.host, port: parsed.port };
  }
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: target.host, port: target.port });
    let buf = Buffer.alloc(0);
    let status = null, sentAt = 0, done = false;
    const finish = (r) => { if (done) return; done = true; clearTimeout(timer); socket.destroy(); resolve(r); };
    const timer = setTimeout(() => finish(status ? shapeStatus(status, { host: parsed.host, port: parsed.port }) : { online: false, error: 'timeout', host: parsed.host, port: parsed.port }), timeout);
    socket.on('connect', () => {
      socket.write(Buffer.concat([handshakePacket(parsed.host, parsed.port), statusRequestPacket()]));
    });
    socket.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      if (buf.length > 1_000_000) return finish({ online: false, error: 'too_big', host: parsed.host, port: parsed.port });
      let res;
      try { res = readPackets(buf); } catch { return finish({ online: false, error: 'protocol', host: parsed.host, port: parsed.port }); }
      buf = res.rest;
      for (const p of res.packets) {
        if (p.id === 0x00 && !status) {
          try { status = JSON.parse(decodeString(p.data).value); } catch { return finish({ online: false, error: 'protocol', host: parsed.host, port: parsed.port }); }
          sentAt = Date.now();
          socket.write(pingPacket(BigInt(sentAt)));
        } else if (p.id === 0x01 && status) {
          return finish(shapeStatus(status, { host: parsed.host, port: parsed.port, latency: Date.now() - sentAt }));
        }
      }
    });
    socket.on('error', (err) => finish(status ? shapeStatus(status, { host: parsed.host, port: parsed.port }) : { online: false, error: err.code || 'error', host: parsed.host, port: parsed.port }));
    socket.on('close', () => finish(status ? shapeStatus(status, { host: parsed.host, port: parsed.port }) : { online: false, error: 'closed', host: parsed.host, port: parsed.port }));
  });
}
