'use strict';
/*
 * playit.gg tunnel for players behind CGNAT / without access to the router: the playit agent
 * (CLI 0.15) connects out to playit.gg and forwards a public address like "abc.joinmc.link" to the
 * local server port. One agent (secret key) per launcher, one Minecraft Java tunnel per server.
 */
const fs = require('fs');
const path = require('path');
const { execFile, spawn } = require('child_process');
const paths = require('./paths');
const net = require('./net');

const VERSION = '0.15.26';
const ASSETS = {
  'win32-x64': 'playit-windows-x86_64-signed.exe',
  'linux-x64': 'playit-linux-amd64',
  'linux-arm64': 'playit-linux-aarch64',
};

function supported() { return !!ASSETS[`${process.platform}-${process.arch}`]; }

function binPath() {
  return path.join(paths.root, 'tools', `playit-${VERSION}${process.platform === 'win32' ? '.exe' : ''}`);
}

async function ensureBinary(progress = () => {}) {
  const asset = ASSETS[`${process.platform}-${process.arch}`];
  if (!asset) throw new Error('Tunel playit.gg nie ma wersji dla tego systemu – zainstaluj go ze strony playit.gg.');
  const bin = binPath();
  if (!fs.existsSync(bin)) {
    progress({ stage: 'Pobieranie playit.gg' });
    await net.download(`https://github.com/playit-cloud/playit-agent/releases/download/v${VERSION}/${asset}`, bin);
    if (process.platform !== 'win32') fs.chmodSync(bin, 0o755);
  }
  return bin;
}

const clean = (s) => String(s || '').replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').replace(/\x1b[78]/g, '').trim();

async function cli(args, { secret, timeout = 30000 } = {}) {
  const bin = await ensureBinary();
  const full = secret ? ['--secret', secret, ...args] : args;
  return new Promise((resolve, reject) => {
    execFile(bin, full, { timeout, windowsHide: true, maxBuffer: 1 << 20 }, (e, out, err) => {
      const text = clean(out);
      if (e) return reject(new Error('playit: ' + (clean(err) || text || e.message).replace(/^Error:\s*/, '')));
      resolve(text);
    });
  });
}

/** Step 1: a claim code + URL the user opens to link the agent with their playit.gg account. */
async function claimStart() {
  const code = (await cli(['claim', 'generate'])).replace(/[^0-9a-f]/gi, '');
  if (!code) throw new Error('playit: nie udało się wygenerować kodu');
  const out = await cli(['claim', 'url', code, '--name', 'Nore Launcher', '--type', 'self-managed']);
  const url = (/https:\/\/\S+/.exec(out) || [])[0] || `https://playit.gg/claim/${code}`;
  return { code, url };
}

/** Step 2: waits until the user accepts on playit.gg and returns the agent secret. */
async function claimFinish(code, timeoutMs = 10 * 60000) {
  if (!/^[0-9a-f]+$/i.test(code)) throw new Error('Nieprawidłowy kod');
  const out = await cli(['claim', 'exchange', code, '--wait', String(Math.round(timeoutMs / 1000))], { timeout: timeoutMs + 15000 });
  const secret = out.split(/\s+/).filter(Boolean).pop();
  if (!secret || secret.length < 32) throw new Error('playit: nie otrzymano klucza – zaakceptuj agenta na playit.gg');
  return secret;
}

/** "[tunnel-id] [port-type] [port-count] [public-address]" lines → objects. */
async function listTunnels(secret) {
  const out = await cli(['tunnels', 'list'], { secret });
  return out.split(/\r?\n/).map(l => l.trim().split(/\s+/)).filter(f => f.length >= 4 && /^[0-9a-f-]{20,}$/i.test(f[0]))
    .map(([id, type, count, address]) => ({ id, type, count: +count, address }));
}

/** Creates (or reuses) the Minecraft Java tunnel named after the server. */
async function ensureTunnel(secret, name) {
  const out = await cli(['tunnels', 'prepare', 'tcp', '1', '--type', 'minecraft-java', '--name', name], { secret, timeout: 60000 });
  const id = (/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.exec(out) || [])[0];
  const list = await listTunnels(secret);
  const t = (id && list.find(x => x.id === id)) || list.find(x => x.type === 'tcp') || list[0];
  if (!t) throw new Error('playit: nie udało się utworzyć tunelu');
  return t;
}

/** Runs the agent forwarding the tunnel to the local server port; returns the child process. */
async function run(secret, tunnelId, port, onLine) {
  const bin = await ensureBinary();
  const child = spawn(bin, ['--secret', secret, '-s', 'run', `${tunnelId}=127.0.0.1:${port}`], { windowsHide: true });
  for (const s of [child.stdout, child.stderr]) {
    let buf = '';
    s.on('data', (d) => {
      buf += d.toString();
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = clean(buf.slice(0, i));
        buf = buf.slice(i + 1);
        if (line) onLine(line);
      }
    });
  }
  return child;
}

module.exports = { supported, ensureBinary, claimStart, claimFinish, listTunnels, ensureTunnel, run, VERSION };
