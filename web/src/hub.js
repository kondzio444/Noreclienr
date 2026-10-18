/*
 * Nore Hub – which players around me also use Nore, and what they wear (contract: docs/nore-hub.md).
 *
 *   POST /api/v1/hub/hello            signed hello / heartbeat from the launcher
 *   GET  /api/v1/hub/players?names=   Nore users among up to 100 names (the game)
 *   GET  /api/v1/hub/stats            { online, known }
 *
 * The worker checks the hello (fields, Nore ID key, ECDSA P-256 signature, clock) without state;
 * one SQLite-backed Durable Object (NoreHub, idFromName('global')) keeps the players and does the
 * rest: the per-ID rate limit, the Mojang check for premium accounts and the name binding.
 */

const ONLINE_MS = 3 * 60 * 1000;          // a hello in the last 3 minutes = online
const CLAIM_MS = 30 * 86400 * 1000;       // an unverified name stays bound this long after it was seen
const CLOCK_MS = 5 * 60 * 1000;           // |now - ts| allowed for a hello
const GAP_MS = 15 * 1000;                 // at most one hello per Nore ID per 15 s
const MAX_NAMES = 100;
const MAX_BODY = 8192;
const MOJANG = 'https://sessionserver.mojang.com';

export class HubError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const NAME = /^[A-Za-z0-9_]{2,16}$/;
const KEY = /^[a-z0-9_]{1,32}$/;
const OPT = /^[a-z0-9_]{1,24}$/;
const SLOT_FIELDS = ['id', 'color', 'variant', 'opts'];
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const utf8 = new TextEncoder();

/** Why a cosmetics object is not acceptable, or null. Keep in sync with launcher/src/main/hub.js. */
export function cosmeticsError(c) {
  if (!isObj(c) || !Number.isInteger(c.v) || !isObj(c.slots)) return 'cosmetics: wymagane { v, slots }';
  if (Object.keys(c).some(k => k !== 'v' && k !== 'slots')) return 'cosmetics: dozwolone są tylko v i slots';
  const slots = Object.entries(c.slots);
  if (slots.length > 10) return 'cosmetics: najwyżej 10 slotów';
  for (const [slot, s] of slots) {
    if (!KEY.test(slot) || !isObj(s) || Object.keys(s).some(k => !SLOT_FIELDS.includes(k))) return `cosmetics: zły slot ${slot}`;
    if (typeof s.id !== 'string' || !KEY.test(s.id)) return `cosmetics: zły id w slocie ${slot}`;
    if ('variant' in s && (typeof s.variant !== 'string' || !KEY.test(s.variant))) return `cosmetics: zły variant w slocie ${slot}`;
    if ('color' in s && !(Number.isInteger(s.color) && s.color >= 0 && s.color <= 0xffffff)) return `cosmetics: zły color w slocie ${slot}`;
    if ('opts' in s) {
      if (!isObj(s.opts) || Object.keys(s.opts).length > 12) return `cosmetics: złe opts w slocie ${slot}`;
      for (const [k, v] of Object.entries(s.opts)) {
        const ok = typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v)) || (typeof v === 'string' && v.length <= 32);
        if (!OPT.test(k) || !ok) return `cosmetics: zła opcja ${k} w slocie ${slot}`;
      }
    }
  }
  if (utf8.encode(JSON.stringify(c)).length > 2048) return 'cosmetics: najwyżej 2048 bajtów';
  return null;
}

const toHex = (buf) => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
const sha256hex = async (bytes) => toHex(await crypto.subtle.digest('SHA-256', bytes));
const unb64 = (s) => Uint8Array.from(atob(s), ch => ch.charCodeAt(0));

/** The string the launcher signs (docs/nore-hub.md). */
export async function canonical({ name, uuid, hex, ts, online, cosmetics }) {
  const cos = await sha256hex(utf8.encode(JSON.stringify(cosmetics)));
  return `nore-hub/1|${name}|${uuid}|${hex}|${ts}|${online ? 1 : 0}|${cos}`;
}

/** DER ECDSA signature (Node crypto.sign) → raw r||s (IEEE P1363, what WebCrypto verifies), or null. */
export function derToP1363(der) {
  if (der.length < 8 || der.length > 72 || der[0] !== 0x30 || der[1] !== der.length - 2) return null;
  const out = new Uint8Array(64);
  let i = 2;
  for (const at of [0, 32]) {
    if (der[i] !== 0x02) return null;
    const n = der[i + 1];
    if (n < 1 || n > 33 || i + 2 + n > der.length) return null;
    let v = der.subarray(i + 2, i + 2 + n);
    i += 2 + n;
    while (v.length > 32 && v[0] === 0) v = v.subarray(1); // sign byte
    if (v.length > 32) return null;
    out.set(v, at + 32 - v.length);
  }
  return i === der.length ? out : null;
}

/** Reads and checks a hello body; returns the fields the Durable Object needs. Throws HubError. */
export async function readHello(request) {
  if (Number(request.headers.get('Content-Length') || 0) > MAX_BODY) throw new HubError(413, 'Za duże żądanie');
  const text = await request.text();
  if (text.length > MAX_BODY) throw new HubError(413, 'Za duże żądanie');
  let b;
  try { b = JSON.parse(text); } catch { throw new HubError(400, 'Treść musi być JSON-em'); }
  if (!isObj(b)) throw new HubError(400, 'Treść musi być obiektem JSON');
  const { name, uuid, hex, pub, ts, online, sig, cosmetics } = b;
  if (typeof name !== 'string' || !NAME.test(name)) throw new HubError(400, 'Zły nick: 2–16 znaków, litery, cyfry lub _');
  if (typeof uuid !== 'string' || !/^[0-9a-f]{32}$/i.test(uuid)) throw new HubError(400, 'uuid: 32 znaki hex bez myślników');
  if (typeof hex !== 'string' || !/^[0-9a-f]{20}$/.test(hex)) throw new HubError(400, 'hex: 20 małych znaków hex');
  if (!Number.isSafeInteger(ts)) throw new HubError(400, 'ts: czas w milisekundach');
  if (typeof online !== 'boolean') throw new HubError(400, 'online: true albo false');
  if (typeof pub !== 'string' || pub.length > 400 || typeof sig !== 'string' || sig.length > 200) throw new HubError(400, 'Brak klucza albo podpisu');
  const bad = cosmeticsError(cosmetics);
  if (bad) throw new HubError(400, bad);
  const premium = b.premium === true;
  const serverId = premium && typeof b.serverId === 'string' && /^-?[0-9a-f]{1,40}$/.test(b.serverId) ? b.serverId : null;

  let pubDer, sigDer;
  try { pubDer = unb64(pub); sigDer = unb64(sig); } catch { throw new HubError(400, 'pub i sig muszą być w base64'); }
  if ((await sha256hex(pubDer)).slice(0, 20) !== hex) throw new HubError(401, 'Klucz nie pasuje do Nore ID');
  if (Math.abs(Date.now() - ts) >= CLOCK_MS) throw new HubError(401, 'Zły czas żądania – sprawdź zegar komputera');
  const raw = derToP1363(sigDer);
  let key;
  try { key = await crypto.subtle.importKey('spki', pubDer, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']); } catch { throw new HubError(400, 'pub: to nie jest klucz P-256'); }
  const signed = utf8.encode(await canonical(b));
  if (!raw || !(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, raw, signed))) throw new HubError(401, 'Zły podpis');
  return { name, uuid: uuid.toLowerCase(), hex, ts, online, premium, serverId, cosmetics: JSON.stringify(cosmetics) };
}

/** ?names=a,b,c → unique valid lowercase names (at most 100). */
export function readNames(param) {
  const names = [...new Set(String(param || '').split(',').map(n => n.trim().toLowerCase()).filter(n => NAME.test(n)))];
  if (names.length > MAX_NAMES) throw new HubError(400, `Najwyżej ${MAX_NAMES} nicków naraz`);
  return names;
}

/** Calls the global NoreHub object; its errors come back as HubError. */
export async function hubCall(env, op, data) {
  if (!env.HUB) throw new HubError(503, 'Nore Hub jest chwilowo wyłączony');
  const stub = env.HUB.get(env.HUB.idFromName('global'));
  const res = await stub.fetch('https://hub/' + op, { method: 'POST', body: JSON.stringify(data) });
  const out = await res.json();
  if (!res.ok) throw new HubError(res.status, out.error);
  return out;
}

// ---------------------------------------------------------------- Durable Object

export class NoreHub {
  constructor(ctx, env) {
    this.env = env;
    this.sql = ctx.storage.sql;
    this.writes = 0;
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS players (
        name_lower TEXT PRIMARY KEY, name TEXT NOT NULL, uuid TEXT NOT NULL, hex TEXT NOT NULL,
        verified INTEGER NOT NULL, cosmetics TEXT NOT NULL, online INTEGER NOT NULL,
        seen INTEGER NOT NULL, created INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS players_seen ON players (seen);
      CREATE INDEX IF NOT EXISTS players_uuid ON players (uuid);
      CREATE TABLE IF NOT EXISTS hellos (hex TEXT PRIMARY KEY, at INTEGER NOT NULL, ts INTEGER NOT NULL);`);
  }

  async fetch(request) {
    const op = new URL(request.url).pathname.slice(1);
    try {
      const data = await request.json();
      if (op === 'hello') return Response.json(await this.hello(data));
      if (op === 'players') return Response.json(this.players(data.names));
      if (op === 'stats') return Response.json(this.stats());
      return Response.json({ error: 'op' }, { status: 404 });
    } catch (e) {
      return Response.json({ error: String(e.message || e) }, { status: e.status || 500 });
    }
  }

  row(nameLower) {
    return this.sql.exec('SELECT * FROM players WHERE name_lower = ?', nameLower).toArray()[0] || null;
  }

  async hello(h) {
    const now = Date.now();
    const key = h.name.toLowerCase();
    const last = this.sql.exec('SELECT at, ts FROM hellos WHERE hex = ?', h.hex).toArray()[0];
    if (last && now - last.at < GAP_MS) throw new HubError(429, 'Za często – najwyżej jedno hello na 15 s');
    if (last && h.ts <= last.ts) throw new HubError(401, 'To hello już było');
    this.sql.exec('INSERT OR REPLACE INTO hellos (hex, at, ts) VALUES (?, ?, ?)', h.hex, now, h.ts);
    if (++this.writes % 200 === 1) {
      this.sql.exec('DELETE FROM hellos WHERE at < ?', now - 3600 * 1000);
      this.sql.exec('DELETE FROM players WHERE verified = 0 AND seen < ?', now - CLAIM_MS);
    }

    let row = this.row(key);
    if (!h.online) {
      const mine = row && row.hex === h.hex;
      if (mine) this.sql.exec('UPDATE players SET online = 0, seen = ? WHERE name_lower = ?', now, key);
      return { ok: true, verified: !!(mine && row.verified), name: mine ? row.name : h.name };
    }

    let name = h.name, verified = false;
    if (h.premium) {
      // later heartbeats of a verified session are signature-only
      const session = row && row.verified && row.hex === h.hex && row.uuid === h.uuid && row.online && now - row.seen < ONLINE_MS;
      name = session ? row.name : await this.mojang(h);
      verified = true;
      row = this.row(key); // the Mojang call may have let another hello in
    }
    if (row && row.hex !== h.hex && !verified && (row.verified || now - row.seen < CLAIM_MS)) {
      throw new HubError(409, 'Ten nick należy już do innego gracza Nore');
    }
    // a premium player who changed the name leaves no verified claim on the old one
    if (verified) this.sql.exec('DELETE FROM players WHERE uuid = ? AND verified = 1 AND name_lower <> ?', h.uuid, key);
    this.sql.exec(`INSERT INTO players (name_lower, name, uuid, hex, verified, cosmetics, online, seen, created)
      VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
      ON CONFLICT (name_lower) DO UPDATE SET name = excluded.name, uuid = excluded.uuid, verified = excluded.verified,
        cosmetics = excluded.cosmetics, online = 1, seen = excluded.seen,
        created = CASE WHEN players.hex = excluded.hex THEN players.created ELSE excluded.created END, hex = excluded.hex`,
    key, name, h.uuid, h.hex, verified ? 1 : 0, h.cosmetics, now, now);
    return { ok: true, verified, name };
  }

  /** Mojang hasJoined after the launcher's session/minecraft/join; returns the exact profile name. */
  async mojang(h) {
    if (!h.serverId) throw new HubError(401, 'Brak potwierdzenia Mojang (serverId)');
    const base = this.env.MOJANG_SESSION || MOJANG; // tests only
    let res;
    try {
      res = await fetch(`${base}/session/minecraft/hasJoined?username=${encodeURIComponent(h.name)}&serverId=${encodeURIComponent(h.serverId)}`,
        { headers: { 'User-Agent': 'nore-hub' }, signal: AbortSignal.timeout(5000) });
    } catch { throw new HubError(502, 'Mojang nie odpowiada'); }
    if (res.status !== 200 && res.status !== 204) throw new HubError(502, `Mojang odpowiedział ${res.status}`);
    const p = res.status === 200 ? await res.json().catch(() => null) : null;
    if (!p || p.id !== h.uuid || String(p.name).toLowerCase() !== h.name.toLowerCase()) throw new HubError(401, 'Mojang nie potwierdził konta premium');
    return p.name;
  }

  players(names) {
    const now = Date.now();
    const players = {};
    if (!Array.isArray(names) || !names.length) return { players };
    const rows = this.sql.exec('SELECT * FROM players WHERE name_lower IN (SELECT value FROM json_each(?)) AND seen > ?',
      JSON.stringify(names.slice(0, MAX_NAMES)), now - CLAIM_MS).toArray();
    for (const r of rows) {
      players[r.name_lower] = {
        name: r.name, uuid: r.uuid, hex: r.hex, verified: !!r.verified,
        online: !!r.online && now - r.seen < ONLINE_MS, seen: r.seen, cosmetics: JSON.parse(r.cosmetics),
      };
    }
    return { players };
  }

  stats() {
    const now = Date.now();
    const [r] = this.sql.exec('SELECT SUM(online = 1 AND seen > ?) AS online, COUNT(*) AS known FROM players WHERE seen > ?', now - ONLINE_MS, now - CLAIM_MS).toArray();
    return { online: r.online || 0, known: r.known || 0 };
  }
}
