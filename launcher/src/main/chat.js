'use strict';
/*
 * Friends chat & voice – the trusted half that lives in the main process: this launcher's identity
 * (an ECDSA P-256 key pair; the private key never leaves the main process and is stored encrypted),
 * the Nore ID derived from the public key, contacts, invitations and message history.
 *
 * Transport (WebRTC data channels + audio through the public PeerJS broker) runs in the renderer.
 * Every connection is authenticated: both sides prove ownership of the key whose hash is their
 * Nore ID by signing the other side's random challenge, so nobody can pose as a friend.
 */
const crypto = require('crypto');
const store = require('./store');

const ID_HEX = 20; // 80 bits of SHA-256(public key) – shown as NORE-XXXXX-XXXXX-XXXXX-XXXXX
const HISTORY = 500;

function safe() { try { return require('electron').safeStorage; } catch { return null; } }

function seal(text) {
  const s = safe();
  if (s && s.isEncryptionAvailable()) return 'enc:' + s.encryptString(text).toString('base64');
  return text;
}

function unseal(value) {
  if (!value || !value.startsWith('enc:')) return value;
  const s = safe();
  return s ? s.decryptString(Buffer.from(value.slice(4), 'base64')) : null;
}

const hexId = (pubB64) => crypto.createHash('sha256').update(Buffer.from(pubB64, 'base64')).digest('hex').slice(0, ID_HEX);
const pretty = (hex) => 'NORE-' + hex.toUpperCase().match(/.{5}/g).join('-');

/** "NORE-ABCDE-..." / "abcde..." / with spaces → 20 lowercase hex chars, or null. */
function parseId(text) {
  const hex = String(text || '').toLowerCase().replace(/^nore/, '').replace(/[^0-9a-f]/g, '');
  return hex.length === ID_HEX ? hex : null;
}

let cached = null;
/** This launcher's identity, created on first use. */
function identity() {
  if (cached) return cached;
  const d = store.get();
  let rec = d.chat && d.chat.identity;
  let priv = rec && unseal(rec.priv);
  if (!rec || !priv) {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const pub = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
    priv = privateKey.export({ type: 'pkcs8', format: 'pem' });
    rec = { pub, priv: seal(priv), created: Date.now() };
    store.update(x => { x.chat = { ...(x.chat || {}), identity: rec }; });
  }
  const hex = hexId(rec.pub);
  cached = { hex, id: pretty(hex), pub: rec.pub, key: crypto.createPrivateKey(priv) };
  return cached;
}

function publicIdentity() {
  const me = identity();
  const acc = (store.get().accounts || []).find(a => a.id === store.get().selectedAccount) || {};
  return { hex: me.hex, id: me.id, pub: me.pub, name: acc.name || 'Gracz', peer: 'nore-' + me.hex };
}

/** Signs a handshake string (challenge | from | to) with this launcher's key. */
function sign(text) {
  return crypto.sign('sha256', Buffer.from(String(text)), identity().key).toString('base64');
}

/** Checks that pub belongs to hex and signed text. */
function verify(hex, pubB64, text, sigB64) {
  try {
    if (hexId(pubB64) !== hex) return false;
    const key = crypto.createPublicKey({ key: Buffer.from(pubB64, 'base64'), format: 'der', type: 'spki' });
    return crypto.verify('sha256', Buffer.from(String(text)), key, Buffer.from(sigB64, 'base64'));
  } catch { return false; }
}

// ------------------------------------------------------------------ contacts & invitations

function data() {
  const c = store.get().chat || {};
  return { contacts: c.contacts || [], requests: c.requests || [], history: c.history || {}, blocked: c.blocked || [] };
}

function update(fn) {
  store.update(d => {
    d.chat = d.chat || {};
    d.chat.contacts = d.chat.contacts || [];
    d.chat.requests = d.chat.requests || [];
    d.chat.history = d.chat.history || {};
    d.chat.blocked = d.chat.blocked || [];
    fn(d.chat);
  });
}

function contacts() {
  const { contacts: list, history } = data();
  return list.map(c => {
    const h = history[c.hex] || [];
    const last = h[h.length - 1] || null;
    return { ...c, id: pretty(c.hex), peer: 'nore-' + c.hex, last, unread: h.filter(m => !m.mine && !m.read).length };
  });
}

function addContact(idText, name) {
  const hex = parseId(idText);
  if (!hex) throw new Error('To nie jest poprawny Nore ID (NORE-XXXXX-XXXXX-XXXXX-XXXXX).');
  if (hex === identity().hex) throw new Error('To Twój własny Nore ID.');
  if (data().contacts.some(c => c.hex === hex)) throw new Error('Ten znajomy już jest na liście.');
  const req = data().requests.find(r => r.hex === hex);
  update(c => {
    c.contacts.push({ hex, name: String(name || (req && req.name) || 'Znajomy').slice(0, 24), pub: req ? req.pub : null, added: Date.now() });
    c.requests = c.requests.filter(r => r.hex !== hex);
    c.blocked = c.blocked.filter(b => b !== hex);
  });
  return contacts();
}

function removeContact(hex) {
  update(c => { c.contacts = c.contacts.filter(x => x.hex !== hex); delete c.history[hex]; });
  return contacts();
}

/** After a verified handshake: remember the key and the name the friend uses now. */
function seen(hex, pubB64, name) {
  if (hexId(pubB64) !== hex) return null;
  let known = false;
  update(c => {
    const x = c.contacts.find(k => k.hex === hex);
    if (x) { known = true; x.pub = pubB64; if (name) x.name = String(name).slice(0, 24); x.seen = Date.now(); }
  });
  return known;
}

/** Someone not on the list connected and proved their identity: an invitation. */
function addRequest(hex, pubB64, name, text) {
  if (hexId(pubB64) !== hex || data().blocked.includes(hex) || data().contacts.some(c => c.hex === hex)) return requests();
  update(c => {
    c.requests = c.requests.filter(r => r.hex !== hex);
    c.requests.push({ hex, pub: pubB64, name: String(name || 'Gracz').slice(0, 24), text: String(text || '').slice(0, 200), at: Date.now() });
    c.requests = c.requests.slice(-30);
  });
  return requests();
}

function requests() { return data().requests.map(r => ({ ...r, id: pretty(r.hex) })); }

function declineRequest(hex, block) {
  update(c => { c.requests = c.requests.filter(r => r.hex !== hex); if (block && !c.blocked.includes(hex)) c.blocked.push(hex); });
  return requests();
}

// ------------------------------------------------------------------ history

function history(hex) { return (data().history[hex] || []).slice(-HISTORY); }

/** Adds or updates a message ({ mid, text, ts, mine, state }) – an existing mid is merged. */
function putMessage(hex, msg) {
  if (!data().contacts.some(c => c.hex === hex)) return null;
  let out = null;
  update(c => {
    const list = c.history[hex] = c.history[hex] || [];
    const i = list.findIndex(m => m.mid === msg.mid);
    if (i >= 0) out = list[i] = { ...list[i], ...msg };
    else { out = { text: '', ts: Date.now(), ...msg, text: String(msg.text || '').slice(0, 2000) }; list.push(out); }
    if (list.length > HISTORY) list.splice(0, list.length - HISTORY);
  });
  return out;
}

function markRead(hex) {
  update(c => { for (const m of c.history[hex] || []) if (!m.mine) m.read = true; });
  return true;
}

function clearHistory(hex) {
  update(c => { c.history[hex] = []; });
  return true;
}

module.exports = {
  identity: publicIdentity, sign, verify, parseId, pretty, hexId, contacts, addContact, removeContact, seen,
  addRequest, requests, declineRequest, history, putMessage, markRead, clearHistory,
};
