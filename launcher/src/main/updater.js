'use strict';
/*
 * Launcher auto-update (electron-updater, GitHub releases of kondzio444/Noreclienr). The Nore
 * Client mod jars ship inside the launcher, so updating the launcher also updates the mod.
 * Checks on start and every 3 hours; downloads in the background and installs on quit or when
 * the user clicks "restart".
 *
 * When electron-updater cannot update this copy (unpacked folder, missing app-update.yml, a
 * broken latest.yml…) the launcher falls back to its own updater: it asks the Nore API
 * (noreclient.pl, GitHub API as a backup) for the newest release, downloads the installer /
 * AppImage itself, checks its SHA-256 and runs it, so an old version can always move to the new
 * one without visiting GitHub.
 */
const { app, shell } = require('electron');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const net = require('./net');

const REPO = 'kondzio444/Noreclienr';
const API = 'https://noreclient.pl/api/v1';

let updater = null;
let emit = () => {};
let state = { state: 'idle', version: app.getVersion() };
let timer = null;
const listeners = new Set();

function set(s) {
  state = { ...state, ...s };
  emit('update:state', state);
  for (const fn of listeners) { try { fn(state); } catch { /* ignore */ } }
}

/** Calls fn on every state change; returns a function that stops listening. */
function onState(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function load() {
  if (updater) return updater;
  try {
    updater = require('electron-updater').autoUpdater;
  } catch {
    return null;
  }
  updater.autoInstallOnAppQuit = true;
  updater.on('checking-for-update', () => set({ state: 'checking' }));
  updater.on('update-available', (i) => set({ state: updater.autoDownload ? 'downloading' : 'available', next: i.version, percent: 0, notes: notes(i) }));
  updater.on('update-not-available', () => set({ state: 'latest', checkedAt: Date.now() }));
  updater.on('download-progress', (p) => set({ state: 'downloading', percent: Math.round(p.percent) }));
  updater.on('update-downloaded', (i) => set({ state: 'ready', next: i.version, notes: notes(i) }));
  updater.on('error', (e) => {
    const wasDownloading = state.state === 'downloading' && !manual;
    set({ state: 'error', message: friendly(e) });
    // a failed background download: switch to the installer download so the update still lands
    if (wasDownloading) { brokenNative = true; fallbackCheck().catch(() => {}); }
  });
  return updater;
}

function notes(info) {
  const n = info.releaseNotes;
  if (!n) return '';
  const text = Array.isArray(n) ? n.map(x => x.note).join('\n') : String(n);
  return text.replace(/<[^>]+>/g, '').trim().slice(0, 600);
}

const NO_RELEASES = 'Nie ma jeszcze wydania na GitHubie – pojawi się automatycznie po zbudowaniu nowej wersji.';

function friendly(e) {
  const m = String(e && e.message || e);
  if (/404|Unable to find latest version|No published versions/i.test(m)) return NO_RELEASES;
  if (/ENOTFOUND|ETIMEDOUT|ECONNRESET|ECONNREFUSED|fetch failed|net::/i.test(m)) return 'Brak połączenia z serwerem aktualizacji.';
  if (/HTTP (403|429|5\d\d)/.test(m)) return 'Serwer aktualizacji jest chwilowo niedostępny – spróbuję później.';
  return m.split('\n')[0].slice(0, 200);
}

/** Starts periodic checks (packaged builds only). */
function init(sendFn, settings, { checkNow = false } = {}) {
  emit = sendFn;
  if (!app.isPackaged && !process.env.NORE_UPDATER_TEST) {
    set({ state: 'dev' });
    return;
  }
  const u = process.env.NORE_UPDATER_TEST ? null : load();
  if (u) u.autoDownload = settings.autoUpdate !== false;
  if (!u) brokenNative = true;
  fallbackAuto = settings.autoUpdate !== false;
  if (!checkNow) setTimeout(() => check(), 8000);
  timer = setInterval(() => check(), 3 * 60 * 60 * 1000);
}

function configure(settings) {
  if (updater) updater.autoDownload = settings.autoUpdate !== false;
  fallbackAuto = settings.autoUpdate !== false;
}

async function check() {
  if (!app.isPackaged && !process.env.NORE_UPDATER_TEST) { set({ state: 'dev' }); return state; }
  manual = null;
  const u = brokenNative ? null : load();
  let ok = false;
  if (u) {
    try {
      const r = await u.checkForUpdates();
      ok = !!r && state.state !== 'error';
    } catch (e) { set({ state: 'error', message: friendly(e) }); }
  }
  // electron-updater could not handle this copy – try the GitHub release directly
  if (!ok) await fallbackCheck();
  return state;
}

// ------------------------------------------------------------------ own updater (Nore API, GitHub API as a backup)

let manual = null; // { version, asset: { name, url, size, sha256 }, file }
let brokenNative = false; // electron-updater failed to download – use the fallback from now on

function newer(a, b) {
  const pa = String(a).replace(/^v/, '').split(/[.+-]/).map(n => parseInt(n, 10) || 0);
  const pb = String(b).replace(/^v/, '').split(/[.+-]/).map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  return false;
}

function pickAsset(assets) {
  const want = process.platform === 'win32' ? /\.exe$/i : process.platform === 'darwin' ? /\.dmg$/i : /\.AppImage$/i;
  return assets.find(a => want.test(a.name) && !/blockmap/i.test(a.name));
}

const PLATFORM = process.platform === 'win32' ? 'win' : process.platform === 'darwin' ? 'mac' : 'linux';
const sha256Of = (digest) => (/^sha256:([0-9a-f]{64})$/i.exec(String(digest || '')) || [])[1] || null;

/** Newest release from the Nore API: { version, notes, asset } or null when there is nothing newer. */
async function fromNoreApi() {
  const r = await net.getJson(`${API}/updates/launcher?platform=${PLATFORM}&current=${encodeURIComponent(app.getVersion())}`);
  const version = String(r.version || '');
  if (!r.update || !newer(version, app.getVersion())) return { version, latest: true };
  if (!r.download || !/^https:\/\/github\.com\/kondzio444\/Noreclienr\/releases\/download\//.test(r.download.url)) {
    return { version, asset: null, notes: r.notes };
  }
  return { version, notes: r.notes, asset: { name: r.download.name, url: r.download.url, size: r.download.size, sha256: sha256Of(r.download.digest) } };
}

async function fromGithub() {
  const rel = await net.getJson(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { Accept: 'application/vnd.github+json' } });
  const version = String(rel.tag_name || '').replace(/^v/, '');
  if (!newer(version, app.getVersion())) return { version, latest: true };
  const a = pickAsset(rel.assets || []);
  return { version, notes: rel.body, asset: a ? { name: a.name, url: a.browser_download_url, size: a.size, sha256: sha256Of(a.digest) } : null };
}

async function fallbackCheck() {
  const prev = state.state === 'error' ? state.message : null;
  try {
    let rel;
    try { rel = await fromNoreApi(); } catch { rel = await fromGithub(); }
    if (rel.latest) { set({ state: 'latest', checkedAt: Date.now(), message: null }); return; }
    if (!rel.asset) { set({ state: 'error', message: `Wydanie ${rel.version} nie ma pliku dla tego systemu.` }); return; }
    if (manual && manual.version === rel.version && manual.file) return;
    manual = { version: rel.version, asset: rel.asset, file: null };
    set({ state: 'available', next: rel.version, manual: true, size: rel.asset.size, notes: String(rel.notes || '').slice(0, 600), message: null });
    if (autoDownload()) download().catch(() => {});
  } catch (e) {
    set({ state: 'error', message: /404/.test(String(e.message)) ? NO_RELEASES : (prev || friendly(e)) });
  }
}

async function fileSha256(file) {
  const h = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) h.update(chunk);
  return h.digest('hex');
}

let fallbackAuto = true;
function autoDownload() { return fallbackAuto; }

async function download() {
  if (manual) {
    if (manual.file) return;
    const dest = path.join(os.tmpdir(), 'nore-launcher-update', manual.asset.name);
    let got = 0, last = 0;
    const started = Date.now();
    set({ state: 'downloading', percent: 0, next: manual.version, bytes: 0, size: manual.asset.size });
    try {
      await fsp.rm(dest, { force: true });
      await net.download(manual.asset.url, dest, {
        onBytes: (n) => {
          got += n;
          const pct = manual.asset.size ? Math.round(got / manual.asset.size * 100) : 0;
          if (pct !== last) {
            last = pct;
            const speed = got / Math.max(0.5, (Date.now() - started) / 1000);
            set({ state: 'downloading', percent: pct, bytes: got, speed: Math.round(speed) });
          }
        },
      });
      // the installer must be exactly the published file
      if (manual.asset.size && fs.statSync(dest).size !== manual.asset.size) throw new Error('Pobrany plik ma zły rozmiar – spróbuj ponownie.');
      if (manual.asset.sha256) {
        set({ state: 'verifying' });
        if (await fileSha256(dest) !== manual.asset.sha256.toLowerCase()) {
          await fsp.rm(dest, { force: true });
          throw new Error('Suma kontrolna aktualizacji się nie zgadza – plik odrzucony.');
        }
      }
    } catch (e) {
      set({ state: 'error', message: friendly(e) });
      throw e;
    }
    manual.file = dest;
    set({ state: 'ready', next: manual.version });
    return;
  }
  const u = load();
  if (!u) return;
  try {
    await u.downloadUpdate();
  } catch (e) {
    brokenNative = true;
    await fallbackCheck();
    if (manual) await download();
  }
}

function install() {
  if (state.state !== 'ready') return;
  if (!manual || !manual.file) { if (updater) updater.quitAndInstall(false, true); return; }
  const file = manual.file;
  if (process.platform === 'win32') {
    // NSIS installer: --updated keeps settings and relaunches the launcher when done
    spawn(file, ['/S', '--updated', '--force-run'], { detached: true, stdio: 'ignore' }).unref();
    app.quit();
  } else if (process.platform === 'linux' && process.env.APPIMAGE) {
    const target = process.env.APPIMAGE;
    fs.copyFileSync(file, target + '.new');
    fs.chmodSync(target + '.new', 0o755);
    fs.renameSync(target + '.new', target);
    spawn(target, [], { detached: true, stdio: 'ignore' }).unref();
    app.quit();
  } else {
    shell.openPath(file);
  }
}

function current() { return state; }

function stop() { clearInterval(timer); }

module.exports = { init, configure, check, download, install, current, stop, onState };
