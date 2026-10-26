'use strict';
/*
 * Nore Hub – tells the Nore website which Minecraft player this launcher is playing as, so other
 * Nore players see the Nore mark, the wardrobe and the player menu (contract: docs/nore-hub.md).
 *
 * A hello signed with the chat identity (chat.js) when the game starts, a heartbeat every 60 s while
 * it runs and "online: false" when it exits. Premium accounts prove the name through Mojang
 * (session/minecraft/join here, hasJoined in the worker); nick-only accounts are listed unverified.
 * Nothing here blocks or delays the launch: failures only go to the log, and Settings turns it off.
 */
const crypto = require('crypto');
const chat = require('./chat');
const store = require('./store');

const HUB = (process.env.NORE_HUB || 'https://noreclient.pl').replace(/\/+$/, '');
const MOJANG_JOIN = 'https://sessionserver.mojang.com/session/minecraft/join';
const BEAT_MS = 60 * 1000;
const GAP_MS = 16 * 1000;  // the worker takes one hello per Nore ID per 15 s
const FAIL_MS = 30 * 1000; // nothing sooner than this after a failed request
const CHANGE_MS = 2000;    // a new wardrobe goes out this soon (or as soon as the gap allows)
const EMPTY = { v: 1, slots: {} };

const NAME = /^[A-Za-z0-9_]{2,16}$/;
const KEY = /^[a-z0-9_]{1,32}$/;
const OPT = /^[a-z0-9_]{1,24}$/;
const SLOT_FIELDS = ['id', 'color', 'variant', 'opts'];
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Why a cosmetics object is not acceptable, or null. Same rules as the worker (web/src/hub.js). */
function cosmeticsError(c) {
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
  if (Buffer.byteLength(JSON.stringify(c)) > 2048) return 'cosmetics: najwyżej 2048 bajtów';
  return null;
}

/** The string a hello is signed over (docs/nore-hub.md). */
function canonical({ name, uuid, hex, ts, online, cosmetics }) {
  const cos = crypto.createHash('sha256').update(JSON.stringify(cosmetics)).digest('hex');
  return `nore-hub/1|${name}|${uuid}|${hex}|${ts}|${online ? 1 : 0}|${cos}`;
}

const enabled = () => store.get().settings.hubPresence !== false;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

let cosmetics = null;
function wardrobe() {
  if (!cosmetics) { const saved = store.get().hubCosmetics; cosmetics = saved && !cosmeticsError(saved) ? saved : EMPTY; }
  return cosmetics;
}

let log = (line) => console.log('[Nore Hub]', line);
let game = null;    // account of the running Nore Client game
let session = null; // { name, uuid, premium, accessToken, serverId, timer, queued, dirty, sent, done }

// every request goes through one queue that keeps the gap the worker wants
let chain = Promise.resolve();
let lastAt = 0, failedAt = 0;
function enqueue(task) {
  chain = chain.then(async () => {
    const wait = Math.max(lastAt + GAP_MS, failedAt + FAIL_MS) - Date.now();
    if (wait > 0) await sleep(wait);
    lastAt = Date.now();
    await task();
  }).catch((e) => { failedAt = Date.now(); log(e.message || String(e)); });
  return chain;
}

async function mojangJoin(s) {
  const serverId = crypto.randomBytes(20).toString('hex');
  const res = await fetch(MOJANG_JOIN, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accessToken: s.accessToken, selectedProfile: s.uuid, serverId }),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`Mojang join: HTTP ${res.status}`);
  return serverId;
}

async function hello(s, online) {
  if (online && s.premium && !s.serverId) {
    // without the Mojang proof this hello goes out unverified, the next one tries again
    s.serverId = await mojangJoin(s).catch((e) => { log(e.message); return null; });
  }
  const me = chat.identity();
  s.dirty = false;
  const body = { name: s.name, uuid: s.uuid, premium: !!(online && s.premium && s.serverId), hex: me.hex, pub: me.pub, ts: Date.now(), online, cosmetics: wardrobe() };
  if (body.premium) body.serverId = s.serverId;
  body.sig = chat.sign(canonical(body));
  const res = await fetch(HUB + '/api/v1/hub/hello', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': 'NoreLauncher' },
    body: JSON.stringify(body), signal: AbortSignal.timeout(10000),
  });
  const out = await res.json().catch(() => ({}));
  if (res.ok) { s.sent = true; failedAt = 0; return; }
  failedAt = Date.now();
  if (res.status === 401 && body.premium) s.serverId = null; // a fresh Mojang join next time
  if (res.status === 409) s.done = true;                     // the name belongs to another Nore player
  log(`hello ${res.status}: ${out.error || ''}`);
}

/** Queues the next heartbeat of the current session after delay (one at a time). */
function beat(delay) {
  const s = session;
  if (!s || s.done || s.queued) return;
  clearTimeout(s.timer);
  s.timer = setTimeout(() => {
    s.queued = true;
    enqueue(async () => { s.queued = false; if (session === s && !s.done) await hello(s, true); })
      .then(() => { if (session === s) beat(s.dirty ? CHANGE_MS : BEAT_MS); });
  }, delay);
}

function resume() {
  if (session || !game || !enabled()) return;
  const a = game;
  const uuid = String(a.uuid || '').replace(/-/g, '').toLowerCase();
  if (!NAME.test(a.name || '') || !/^[0-9a-f]{32}$/.test(uuid)) return;
  const premium = a.type === 'microsoft' && !!a.accessToken && a.accessToken !== '0';
  session = { name: a.name, uuid, premium, accessToken: premium ? a.accessToken : null, serverId: null, timer: null, queued: false, dirty: false, sent: false, done: false };
  beat(0);
}

function pause() {
  const s = session;
  if (!s) return;
  session = null;
  clearTimeout(s.timer);
  if (s.sent) enqueue(() => hello(s, false));
}

/** The game started (account as launched, with its access token). */
function gameStarted(account, logger) {
  if (logger) log = logger;
  pause();
  game = account;
  resume();
}

function gameStopped() {
  game = null;
  pause();
}

/** Settings → "Pokazuj innym graczom Nore, że grasz w Nore" changed. */
function refresh() {
  if (enabled()) resume(); else pause();
}

/** Latest wardrobe from the game (validated by the caller); a change goes out within ~2 s. */
function setCosmetics(c) {
  if (JSON.stringify(c) === JSON.stringify(wardrobe())) return false;
  cosmetics = c;
  store.update(d => { d.hubCosmetics = c; });
  if (session) { session.dirty = true; beat(CHANGE_MS); }
  return true;
}

module.exports = { HUB, cosmeticsError, canonical, gameStarted, gameStopped, refresh, setCosmetics };
