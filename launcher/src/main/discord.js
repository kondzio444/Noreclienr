'use strict';
// Discord Rich Presence for the launcher over Discord's local IPC (named pipe / unix socket).
const net = require('net');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const OP_HANDSHAKE = 0, OP_FRAME = 1, OP_CLOSE = 2;
const START = Math.floor(Date.now() / 1000);

let socket = null, ready = false, clientId = null, current = null, retry = null, connecting = false;

function ipcPaths(i) {
  if (process.platform === 'win32') return [`\\\\?\\pipe\\discord-ipc-${i}`];
  const bases = [process.env.XDG_RUNTIME_DIR, process.env.TMPDIR, process.env.TMP, process.env.TEMP, '/tmp'].filter(Boolean);
  const subs = ['', 'app/com.discordapp.Discord', 'snap.discord', '.flatpak/com.discordapp.Discord/xdg-run'];
  return bases.flatMap(b => subs.map(s => path.join(b, s, `discord-ipc-${i}`)));
}

function encode(op, data) {
  const body = Buffer.from(JSON.stringify(data), 'utf8');
  const head = Buffer.alloc(8);
  head.writeInt32LE(op, 0);
  head.writeInt32LE(body.length, 4);
  return Buffer.concat([head, body]);
}

function tryConnect(list) {
  return new Promise((resolve) => {
    const next = () => {
      const p = list.shift();
      if (!p) return resolve(null);
      const s = net.createConnection(p);
      s.once('connect', () => { s.removeAllListeners('error'); resolve(s); });
      s.once('error', () => { s.destroy(); next(); });
    };
    next();
  });
}

async function connect() {
  if (connecting || socket || !clientId) return;
  connecting = true;
  const candidates = [];
  for (let i = 0; i < 10; i++) candidates.push(...ipcPaths(i));
  const s = await tryConnect(candidates);
  connecting = false;
  if (!s) return scheduleRetry();
  socket = s;
  let buf = Buffer.alloc(0);
  s.on('data', (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    while (buf.length >= 8) {
      const op = buf.readInt32LE(0), len = buf.readInt32LE(4);
      if (buf.length < 8 + len) break;
      let msg = null;
      try { msg = JSON.parse(buf.slice(8, 8 + len).toString('utf8')); } catch { /* ignore */ }
      buf = buf.slice(8 + len);
      if (op === OP_CLOSE) { s.destroy(); return; }
      if (msg && msg.evt === 'READY') { ready = true; push(); }
    }
  });
  const drop = () => { socket = null; ready = false; scheduleRetry(); };
  s.on('close', drop);
  s.on('error', () => s.destroy());
  s.write(encode(OP_HANDSHAKE, { v: 1, client_id: clientId }));
}

function scheduleRetry() {
  if (retry || !clientId) return;
  retry = setTimeout(() => { retry = null; connect(); }, 15000);
}

function push() {
  if (!socket || !ready) return;
  socket.write(encode(OP_FRAME, {
    cmd: 'SET_ACTIVITY',
    args: { pid: process.pid, activity: current || undefined },
    nonce: crypto.randomUUID(),
  }));
}

/** Configures the Discord application id (empty disables Rich Presence). */
function setClientId(id) {
  id = (id || '').trim();
  if (id === clientId) return;
  clientId = id || null;
  if (socket) { socket.destroy(); socket = null; ready = false; }
  if (clientId) connect();
}

/** Shows an activity: { details, state, start? } or null to clear. */
function setActivity(a) {
  current = a ? {
    details: a.details,
    state: a.state,
    timestamps: { start: a.start || START },
    assets: { large_image: 'logo', large_text: 'Nore Launcher', small_image: a.small || undefined, small_text: a.smallText || undefined },
    buttons: [{ label: 'Nore Client', url: 'https://github.com/kondzio444/Noreclienr' }],
  } : null;
  push();
}

module.exports = { setClientId, setActivity };
