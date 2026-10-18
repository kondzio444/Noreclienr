'use strict';
/*
 * Local bridge between the launcher's friends chat and Nore Client in the game. A tiny HTTP server
 * on 127.0.0.1 (random port) with a random token that the launcher hands to the game as
 * -Dnoreclient.chatBridge=<port>:<token>. Nothing outside this computer can reach it, requests
 * without the token or with a foreign Host header (DNS rebinding) are refused.
 *
 *   GET  /v1/state                → { me, contacts: [{ hex, name, online, status, detail, unread, last }], requests }
 *   GET  /v1/history?hex=&limit=  → messages
 *   GET  /v1/events?since=        → long poll (25 s): { seq, events: [{ seq, type, hex, name, text, ts }] }
 *   POST /v1/send   { hex, text } → queued in the launcher (sent now or when the friend comes online)
 *   POST /v1/read   { hex }
 *   POST /v1/contacts/remove   { hex }        → removes a chat contact
 *   POST /v1/requests/decline  { hex, block? } → declines a chat invitation
 *   POST /v1/presence { cosmetics }  → the wardrobe for the next Nore Hub hello (hub.js)
 *   POST /v1/contacts/add { hex, name } → { ok, contact } – adds a Nore player and sends the invitation
 */
const http = require('http');
const crypto = require('crypto');
const chat = require('./chat');
const hub = require('./hub');

let server = null, port = 0, token = '';
let toRenderer = () => {};
let presence = {}; // hex → { online, status, detail }
const events = [];
let seq = 0;
const waiters = new Set();

function push(ev) {
  ev.seq = ++seq;
  events.push(ev);
  if (events.length > 200) events.splice(0, events.length - 200);
  for (const w of [...waiters]) w();
}

const contactView = (c) => ({
  hex: c.hex, name: c.name, unread: c.unread, last: c.last ? { text: c.last.text, mine: !!c.last.mine, ts: c.last.ts } : null,
  ...(presence[c.hex] || { online: false, status: 'offline', detail: '' }),
});

function state() {
  const me = chat.identity();
  return {
    me: { hex: me.hex, name: me.name, id: me.id },
    contacts: chat.contacts().map(contactView),
    requests: chat.requests().map(r => ({ hex: r.hex, name: r.name, text: r.text, at: r.at })),
  };
}

/** A Nore player from the game (player menu → add friend); the renderer dials them and invites. */
function addContact(b) {
  const hex = String(b.hex || '');
  const name = b.name == null ? '' : String(b.name);
  if (!/^[0-9a-f]{20}$/.test(hex) || (name && !/^[A-Za-z0-9_]{2,16}$/.test(name))) return [400, { error: 'hex' }];
  if (hex === chat.identity().hex) return [400, { error: 'self' }];
  let c = chat.contacts().find(x => x.hex === hex);
  if (!c) {
    try { chat.addContact(hex, name); } catch (e) { return [400, { error: e.message }]; }
    c = chat.contacts().find(x => x.hex === hex);
    toRenderer('chat:bridgeAdd', { hex });
  }
  return [200, { ok: true, contact: contactView(c) }];
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (d) => { data += d; if (data.length > 16384) { reject(new Error('too large')); req.destroy(); } });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(e); } });
  });
}

function handle(req, res) {
  const json = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); };
  const host = String(req.headers.host || '');
  if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) return json(403, { error: 'host' });
  const t = String(req.headers['x-nore-token'] || '');
  if (t.length !== token.length || !crypto.timingSafeEqual(Buffer.from(t), Buffer.from(token))) return json(401, { error: 'token' });
  const url = new URL(req.url, `http://127.0.0.1:${port}`);
  if (req.method === 'GET' && url.pathname === '/v1/state') return json(200, state());
  if (req.method === 'GET' && url.pathname === '/v1/history') {
    const limit = Math.max(1, Math.min(200, Number(url.searchParams.get('limit')) || 50));
    return json(200, { messages: chat.history(String(url.searchParams.get('hex') || '')).slice(-limit).map(m => ({ text: m.text, mine: !!m.mine, ts: m.ts, state: m.state || null })) });
  }
  if (req.method === 'GET' && url.pathname === '/v1/events') {
    const since = Number(url.searchParams.get('since')) || 0;
    const reply = () => json(200, { seq, events: events.filter(e => e.seq > since) });
    if (since < seq || since > seq) return reply(); // new events, or the launcher restarted
    const done = () => { waiters.delete(done); clearTimeout(timer); if (!res.writableEnded) reply(); };
    const timer = setTimeout(done, 25000);
    waiters.add(done);
    req.on('close', () => { waiters.delete(done); clearTimeout(timer); });
    return undefined;
  }
  if (req.method === 'POST' && (url.pathname === '/v1/send' || url.pathname === '/v1/read')) {
    return readBody(req).then((b) => {
      const hex = String(b.hex || '');
      if (!chat.contacts().some(c => c.hex === hex)) return json(404, { error: 'contact' });
      if (url.pathname === '/v1/read') { chat.markRead(hex); toRenderer('chat:bridgeRead', { hex }); return json(200, { ok: true }); }
      const text = String(b.text || '').trim().slice(0, 2000);
      if (!text) return json(400, { error: 'empty' });
      toRenderer('chat:bridgeSend', { hex, text });
      return json(202, { ok: true });
    }).catch(() => json(400, { error: 'body' }));
  }
  if (req.method === 'POST' && url.pathname === '/v1/presence') {
    return readBody(req).then((b) => {
      const bad = hub.cosmeticsError(b.cosmetics);
      if (bad) return json(400, { error: bad });
      hub.setCosmetics(b.cosmetics);
      return json(200, { ok: true });
    }).catch(() => json(400, { error: 'body' }));
  }
  if (req.method === 'POST' && url.pathname === '/v1/contacts/add') {
    return readBody(req).then(b => json(...addContact(b))).catch(() => json(400, { error: 'body' }));
  }
  if (req.method === 'POST' && (url.pathname === '/v1/contacts/remove' || url.pathname === '/v1/requests/decline')) {
    return readBody(req).then((b) => {
      const hex = String(b.hex || '');
      if (!/^[0-9a-f]{20}$/.test(hex)) return json(400, { error: 'hex' });
      if (url.pathname === '/v1/contacts/remove') chat.removeContact(hex);
      else chat.declineRequest(hex, !!b.block);
      toRenderer('chat:bridgeRead', { hex });
      return json(200, { ok: true });
    }).catch(() => json(400, { error: 'body' }));
  }
  return json(404, { error: 'not found' });
}

function start(send) {
  toRenderer = send;
  if (server) return Promise.resolve(address());
  token = crypto.randomBytes(24).toString('hex');
  server = http.createServer(handle);
  return new Promise((resolve) => {
    server.on('error', () => resolve(null));
    server.listen(0, '127.0.0.1', () => { port = server.address().port; resolve(address()); });
  });
}

function stop() {
  if (server) server.close();
  server = null; port = 0;
}

/** "<port>:<token>" for -Dnoreclient.chatBridge, or null before start(). */
function address() { return port ? `${port}:${token}` : null; }

/** Called by main.js for every stored incoming message. */
function message(hex, msg) {
  if (!msg || msg.mine || !msg.text) return;
  const c = chat.contacts().find(x => x.hex === hex);
  push({ type: 'message', hex, name: c ? c.name : 'Znajomy', text: msg.text, ts: msg.ts });
}

/** Presence snapshot from the renderer (who is online / in game). */
function setPresence(map) {
  const before = presence;
  presence = map || {};
  for (const [hex, p] of Object.entries(presence)) {
    if (p.online && !(before[hex] && before[hex].online)) {
      const c = chat.contacts().find(x => x.hex === hex);
      push({ type: 'online', hex, name: c ? c.name : 'Znajomy', text: p.detail || '', ts: Date.now() });
    }
  }
}

module.exports = { start, stop, address, message, setPresence };
