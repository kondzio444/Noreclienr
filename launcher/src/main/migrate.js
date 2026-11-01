'use strict';
/*
 * One-time bridge from this Electron launcher to the new Nore Launcher (Rust / Tauri, launcher-rs/).
 *
 * On start (before the Nore Updater splash) the launcher asks the Nore API (/api/v2/downloads, the
 * GitHub release as a backup) for the newest Tauri installer of this system, downloads it, checks it
 * – exact size, SHA-256 from the release metadata and the minisign signature (`<file>.sig`, the
 * updater key of the Tauri launcher) – and installs it:
 *
 *   Windows  NSIS installer with /S /R (current user, %LOCALAPPDATA%\Nore Launcher, starts it after)
 *   Linux    the AppImage replaces this AppImage in place and is started (a .deb is on noreclient.pl)
 *   macOS    the .app from the DMG replaces this "Nore Launcher.app" and is started
 *
 * Then this launcher quits. Nothing is moved by hand: on its first start the Tauri launcher imports
 * launcher.json (settings, accounts, instances, friends, chat identity) – the data folder is shared
 * and this launcher never deletes anything. Every failure (no Tauri installer in the release, no
 * network, a wrong checksum or signature, an installer that cannot run) leaves the Electron launcher
 * working as before; the next start tries again. The player can postpone the move once ("Później").
 *
 * State in launcher.json → rustMigration: { postponed, skipNext, attempts, lastError, lastTry, installed }.
 * NORE_NO_MIGRATE=1 switches the bridge off (development, emergencies).
 */
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn, execFile } = require('child_process');
const net = require('./net');

const API_DOWNLOADS = 'https://noreclient.pl/api/v2/downloads';
const GITHUB_LATEST = 'https://api.github.com/repos/kondzio444/Noreclienr/releases/latest';
/** Public minisign key of the Tauri updater (the private key is a CI secret) – the same default as launcher-rs. */
const UPDATER_PUBKEY = 'dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IEQyRkQyNDgwREFCQTFEODUKUldTRkhicmFnQ1Q5MGh1ODR4UFBSU29aREQySUxqVmZVcTNLMXhGZDVHMk1UdU4wN2pOSDhZWFMK';
/** Download links the bridge trusts: GitHub release files and the Worker's release-file redirects. */
const TRUSTED_FILE = /^https:\/\/(github\.com\/kondzio444\/Noreclienr\/releases\/download\/|noreclient\.pl\/api\/v2\/files\/)/;
/** After this many installs that did not take over (the Electron launcher started again), stop trying automatically. */
const MAX_INSTALLS = 3;

// ------------------------------------------------------------------ pure helpers (tested in test/migrate.test.js)

function platformId(platform = process.platform) {
  return platform === 'win32' ? 'win' : platform === 'darwin' ? 'mac' : 'linux';
}

/**
 * The Tauri installer names of a release (build.yml). The Electron bridge build of the same release
 * is "NoreLauncher-Bridge-…" and is never taken.
 */
const TAURI_FILE = {
  win: /^NoreLauncher-Setup-\d+\.\d+\.\d+\.exe$/,
  linux: /^NoreLauncher-\d+\.\d+\.\d+\.AppImage$/,
  mac: /^NoreLauncher-\d+\.\d+\.\d+\.dmg$/,
};

function isTauriInstaller(name, pid) {
  return !!TAURI_FILE[pid] && TAURI_FILE[pid].test(String(name || ''));
}

const sha256Of = (digest) => (/^(?:sha256:)?([0-9a-f]{64})$/i.exec(String(digest || '')) || [])[1]?.toLowerCase() || null;

/** The Tauri installer from the Nore API answer of /api/v2/downloads, or null. */
function pickFromDownloads(d, pid) {
  const p = d && Array.isArray(d.platforms) ? d.platforms.find(x => x.id === pid) : null;
  if (!p || !p.available || !isTauriInstaller(p.file, pid) || !TRUSTED_FILE.test(String(p.url || ''))) return null;
  return { version: String(d.version || ''), name: p.file, size: Number(p.size) || 0, sha256: sha256Of(p.digest), url: p.url, sigUrl: `${p.url}.sig` };
}

/** The Tauri installer from a GitHub release (API answer), or null. */
function pickFromGithub(rel, pid) {
  const assets = (rel && rel.assets) || [];
  const a = assets.find(x => isTauriInstaller(x.name, pid));
  if (!a || !TRUSTED_FILE.test(String(a.browser_download_url || ''))) return null;
  const sig = assets.find(x => x.name === `${a.name}.sig`);
  return {
    version: String(rel.tag_name || '').replace(/^v/, ''), name: a.name, size: Number(a.size) || 0, sha256: sha256Of(a.digest),
    url: a.browser_download_url, sigUrl: sig ? sig.browser_download_url : null,
  };
}

/** The two non-comment lines of a minisign file, decoded. */
function minisignLines(text) {
  return String(text).split(/\r?\n/).map(l => l.trim()).filter(Boolean);
}

/** A minisign public key (the base64 form Tauri uses, or the plain two-line file): { keyId, key }. */
function parsePublicKey(pub) {
  let text = String(pub).trim();
  if (!/untrusted comment:/.test(text)) text = Buffer.from(text, 'base64').toString('utf8');
  const line = minisignLines(text).find(l => !/^untrusted comment:/.test(l));
  const raw = Buffer.from(line || '', 'base64');
  if (raw.length !== 42 || raw.subarray(0, 2).toString('latin1') !== 'Ed') throw new Error('Zły klucz publiczny aktualizacji.');
  const spki = Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), raw.subarray(10)]);
  return { keyId: raw.subarray(2, 10), key: crypto.createPublicKey({ key: spki, format: 'der', type: 'spki' }) };
}

/**
 * Checks a minisign signature (the base64 `.sig` Tauri writes, or the plain file) of a file whose
 * BLAKE2b-512 hash ("ED", prehashed – what Tauri makes) or whole content ("Ed", legacy) is given.
 * Also checks the trusted comment's global signature. Returns true / false.
 */
function verifyMinisign({ sig, pubkey, blake2b, content }) {
  try {
    let text = String(sig).trim();
    if (!/untrusted comment:/.test(text)) text = Buffer.from(text, 'base64').toString('utf8');
    const lines = minisignLines(text);
    const i = lines.findIndex(l => !/^(untrusted|trusted) comment:/.test(l));
    const sigRaw = Buffer.from(lines[i] || '', 'base64');
    const trustedLine = lines[i + 1] || '';
    const globalSig = Buffer.from(lines[i + 2] || '', 'base64');
    if (sigRaw.length !== 74 || !trustedLine.startsWith('trusted comment: ') || globalSig.length !== 64) return false;
    const alg = sigRaw.subarray(0, 2).toString('latin1');
    const { keyId, key } = parsePublicKey(pubkey);
    if (!sigRaw.subarray(2, 10).equals(keyId)) return false;
    const signature = sigRaw.subarray(10);
    let message;
    if (alg === 'ED') message = blake2b;
    else if (alg === 'Ed') message = content;
    else return false;
    if (!message || !crypto.verify(null, message, key, signature)) return false;
    const trusted = Buffer.from(trustedLine.slice('trusted comment: '.length), 'utf8');
    return crypto.verify(null, Buffer.concat([signature, trusted]), key, globalSig);
  } catch {
    return false;
  }
}

/** SHA-256 (hex) and BLAKE2b-512 (bytes) of a file in one pass. */
async function hashFile(file) {
  const sha = crypto.createHash('sha256');
  const blake = crypto.createHash('blake2b512');
  for await (const chunk of fs.createReadStream(file)) { sha.update(chunk); blake.update(chunk); }
  return { sha256: sha.digest('hex'), blake2b: blake.digest() };
}

/**
 * Checks a downloaded installer against the release metadata. A signature is required when the
 * release has one (signed builds); without one, size + SHA-256 must both be known.
 * Throws a Polish message on any mismatch.
 */
async function verifyInstaller(file, asset, sigText, pubkey = UPDATER_PUBKEY) {
  const st = await fsp.stat(file);
  if (asset.size && st.size !== asset.size) throw new Error('Pobrany plik ma zły rozmiar.');
  const h = await hashFile(file);
  if (asset.sha256 && h.sha256 !== asset.sha256) throw new Error('Suma SHA-256 nowego launchera się nie zgadza.');
  if (sigText) {
    // the whole content is only read for legacy (non-prehashed) signatures
    const ok = verifyMinisign({ sig: sigText, pubkey, blake2b: h.blake2b, content: await legacyContent(file, sigText) });
    if (!ok) throw new Error('Podpis nowego launchera się nie zgadza.');
  } else if (!(asset.size && asset.sha256)) {
    throw new Error('Wydanie nie ma podpisu ani sumy kontrolnej – nie instaluję.');
  }
  return h;
}

/** The whole file, only for legacy (non-prehashed "Ed") signatures. */
async function legacyContent(file, sigText) {
  try {
    let text = String(sigText).trim();
    if (!/untrusted comment:/.test(text)) text = Buffer.from(text, 'base64').toString('utf8');
    const line = minisignLines(text).find(l => !/^(untrusted|trusted) comment:/.test(l)) || '';
    return Buffer.from(line, 'base64').subarray(0, 2).toString('latin1') === 'Ed' ? await fsp.readFile(file) : null;
  } catch { return null; }
}

/**
 * What to do on this start, from the saved state: 'skip' (postponed for this start, switched off or
 * too many installs that did not take over) or 'run'.
 */
function decide(state = {}, env = process.env) {
  if (env.NORE_NO_MIGRATE) return 'skip';
  if (state.skipNext) return 'skip';
  if ((state.installs || 0) >= MAX_INSTALLS) return 'skip';
  return 'run';
}

/** The ".app" bundle this process runs from (macOS), or null. */
function appBundle(execPath = process.execPath) {
  const m = /^(.*?\.app)(?=\/Contents\/)/.exec(execPath);
  return m ? m[1] : null;
}

// ------------------------------------------------------------------ the bridge itself (Electron)

async function findInstaller(pid) {
  try {
    const d = await withTimeout(net.getJson(API_DOWNLOADS), 10000);
    const a = pickFromDownloads(d, pid);
    if (a) return a;
  } catch { /* the GitHub release below */ }
  const rel = await withTimeout(net.getJson(GITHUB_LATEST, { headers: { Accept: 'application/vnd.github+json' } }), 10000);
  return pickFromGithub(rel, pid);
}

function withTimeout(p, ms) {
  let t;
  return Promise.race([p, new Promise((_, rej) => { t = setTimeout(() => rej(new Error('Przekroczony czas połączenia.')), ms); })]).finally(() => clearTimeout(t));
}

async function fetchSignature(url) {
  if (!url || !TRUSTED_FILE.test(url)) return null;
  const res = await net.fetchWithRetry(url);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Nie udało się pobrać podpisu (HTTP ${res.status}).`);
  const text = (await res.text()).trim();
  if (text.length > 4096) throw new Error('Podpis ma zły format.');
  return text;
}

const run = (cmd, args) => new Promise((resolve, reject) => {
  execFile(cmd, args, { timeout: 120000 }, (err, stdout, stderr) => (err ? reject(new Error(String(stderr || err.message).trim().split('\n')[0])) : resolve(String(stdout))));
});

/** Installs the verified file. Resolves 'quit' (the new launcher starts, this one must exit) or 'manual'. */
async function install(file, pid, { shell }) {
  if (pid === 'win') {
    // current-user NSIS installer of the Tauri launcher: silent, starts the launcher when done (/R)
    const child = spawn(file, ['/S', '/R'], { detached: true, stdio: 'ignore' });
    await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
    child.unref();
    return 'quit';
  }
  if (pid === 'linux') {
    const target = process.env.APPIMAGE;
    if (!target) return 'manual';
    const next = `${target}.new`;
    await fsp.copyFile(file, next);
    await fsp.chmod(next, 0o755);
    await fsp.rename(next, target);
    spawn(target, [], { detached: true, stdio: 'ignore' }).unref();
    return 'quit';
  }
  // macOS: copy the .app out of the DMG over this bundle, keeping the old one until the copy is complete
  const bundle = appBundle();
  if (!bundle) { await shell.openPath(file); return 'manual'; }
  const mount = await fsp.mkdtemp(path.join(os.tmpdir(), 'nore-dmg-'));
  let attached = false;
  try {
    await run('hdiutil', ['attach', '-nobrowse', '-readonly', '-noautoopen', '-mountpoint', mount, file]);
    attached = true;
    const app = (await fsp.readdir(mount)).find(n => n.endsWith('.app'));
    if (!app) throw new Error('Obraz DMG nie zawiera aplikacji.');
    const fresh = `${bundle}.nore-new`;
    const old = `${bundle}.nore-old`;
    await fsp.rm(fresh, { recursive: true, force: true });
    await fsp.rm(old, { recursive: true, force: true });
    await run('ditto', [path.join(mount, app), fresh]);
    await fsp.rename(bundle, old);
    try { await fsp.rename(fresh, bundle); } catch (e) { await fsp.rename(old, bundle); throw e; }
    await fsp.rm(old, { recursive: true, force: true }).catch(() => {});
  } catch (e) {
    // no write access to /Applications and the like: the player drags the app over by hand
    await shell.openPath(file);
    return 'manual';
  } finally {
    if (attached) await run('hdiutil', ['detach', mount, '-quiet']).catch(() => {});
    await fsp.rm(mount, { recursive: true, force: true }).catch(() => {});
  }
  spawn('open', ['-n', bundle], { detached: true, stdio: 'ignore' }).unref();
  return 'quit';
}

/** The Tauri launcher already installed by an earlier bridge run (Windows), or null. */
function installedTauri() {
  if (process.platform !== 'win32' || !process.env.LOCALAPPDATA) return null;
  const exe = path.join(process.env.LOCALAPPDATA, 'Nore Launcher', 'nore-launcher.exe');
  return fs.existsSync(exe) ? exe : null;
}

/**
 * Runs the bridge (see the header). Resolves true when the new launcher took over and this one is
 * quitting, false when the Electron launcher should simply continue.
 */
async function maybeMigrate({ app, store, shell, openWindow, paths }) {
  if (!app.isPackaged && !process.env.NORE_MIGRATE_TEST) return false;
  const state = store.get().rustMigration || {};
  const save = (patch) => store.update((d) => { d.rustMigration = { ...(d.rustMigration || {}), ...patch }; });
  if (decide(state) === 'skip') {
    if (state.skipNext) save({ skipNext: false });
    return false;
  }
  const pid = platformId();

  // the Tauri launcher is already installed and has imported the data: just hand over to it
  const exe = installedTauri();
  if (exe && paths && fs.existsSync(path.join(paths.root, 'launcher-rs.json'))) {
    try {
      spawn(exe, [], { detached: true, stdio: 'ignore' }).unref();
      save({ handedOverAt: new Date().toISOString() });
      return true;
    } catch { /* install it again below */ }
  }

  let asset;
  try {
    asset = await findInstaller(pid);
  } catch (e) {
    save({ lastTry: new Date().toISOString(), lastError: String(e.message || e).slice(0, 200) });
    return false;
  }
  if (!asset) return false; // this release has no Tauri installer for the system yet

  const ui = openWindow();
  const post = (st) => ui.post({ migrate: true, next: asset.version, canPostpone: !state.postponed, ...st });
  let postponed = false;
  let onPostpone = () => {};
  const postponedP = new Promise((resolve) => { onPostpone = resolve; });
  ui.onSkip(() => {
    if (state.postponed) return;
    postponed = true;
    save({ postponed: true, skipNext: false, postponedAt: new Date().toISOString() });
    ui.close();
    onPostpone(false);
  });
  // "Później" answers at once; the download in the background stops at its next chunk
  return Promise.race([postponedP, (async () => {
    try {
      post({ state: 'migrate' });
      await ui.ready;
      const dest = path.join(os.tmpdir(), 'nore-launcher-migrate', asset.name);
      let got = 0, last = -1;
      const started = Date.now();
      await fsp.rm(dest, { force: true });
      await net.download(asset.url, dest, {
        onBytes: (n) => {
          if (postponed) throw new Error('Przełożone przez gracza.');
          got += n;
          const pct = asset.size ? Math.min(100, Math.round(got / asset.size * 100)) : 0;
          if (pct !== last) {
            last = pct;
            post({ state: 'downloading', percent: pct, bytes: got, size: asset.size, speed: Math.round(got / Math.max(0.5, (Date.now() - started) / 1000)) });
          }
        },
      });
      if (postponed) return false;
      post({ state: 'verifying' });
      const sig = await fetchSignature(asset.sigUrl);
      await verifyInstaller(dest, asset, sig);
      if (postponed) return false;
      post({ state: 'installing' });
      save({ installs: (state.installs || 0) + 1, lastTry: new Date().toISOString(), version: asset.version, lastError: null });
      await new Promise(r => setTimeout(r, 1200));
      const how = await install(dest, pid, { shell });
      if (how === 'manual') {
        ui.onSkip(() => ui.close());
        post({ state: 'migrate-manual', platform: pid, canPostpone: true });
        await ui.waitClosed;
        return false;
      }
      save({ installed: asset.version, installedAt: new Date().toISOString() });
      return true;
    } catch (e) {
      if (postponed) return false;
      save({ lastTry: new Date().toISOString(), lastError: String(e.message || e).slice(0, 200) });
      post({ state: 'migrate-error', message: String(e.message || e).slice(0, 120) });
      await new Promise(r => setTimeout(r, 2500));
      return false;
    } finally {
      if (!postponed) ui.close();
    }
  })()]);
}

module.exports = {
  maybeMigrate, platformId, isTauriInstaller, pickFromDownloads, pickFromGithub, parsePublicKey, verifyMinisign,
  verifyInstaller, hashFile, decide, appBundle, TRUSTED_FILE, UPDATER_PUBKEY, MAX_INSTALLS,
};
