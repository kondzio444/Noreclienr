'use strict';
/*
 * Launcher auto-update (electron-updater, GitHub releases of kondzio444/Noreclienr). The Nore
 * Client mod jars ship inside the launcher, so updating the launcher also updates the mod.
 * Checks on start and every 3 hours; downloads in the background and installs on quit or when
 * the user clicks "restart".
 */
const { app } = require('electron');

let updater = null;
let emit = () => {};
let state = { state: 'idle', version: app.getVersion() };
let timer = null;

function set(s) {
  state = { ...state, ...s };
  emit('update:state', state);
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
  updater.on('error', (e) => set({ state: 'error', message: friendly(e) }));
  return updater;
}

function notes(info) {
  const n = info.releaseNotes;
  if (!n) return '';
  const text = Array.isArray(n) ? n.map(x => x.note).join('\n') : String(n);
  return text.replace(/<[^>]+>/g, '').trim().slice(0, 600);
}

function friendly(e) {
  const m = String(e && e.message || e);
  if (/404|Unable to find latest version|No published versions/i.test(m)) return 'Brak opublikowanych wydań na GitHubie (repozytorium musi być publiczne).';
  if (/ENOTFOUND|ETIMEDOUT|ECONNRESET|net::/i.test(m)) return 'Brak połączenia z serwerem aktualizacji.';
  return m.split('\n')[0].slice(0, 200);
}

/** Starts periodic checks (packaged builds only). */
function init(sendFn, settings) {
  emit = sendFn;
  if (!app.isPackaged) {
    set({ state: 'dev' });
    return;
  }
  const u = load();
  if (!u) return;
  u.autoDownload = settings.autoUpdate !== false;
  setTimeout(() => check(), 8000);
  timer = setInterval(() => check(), 3 * 60 * 60 * 1000);
}

function configure(settings) {
  if (updater) updater.autoDownload = settings.autoUpdate !== false;
}

async function check() {
  if (!app.isPackaged) { set({ state: 'dev' }); return state; }
  const u = load();
  if (!u) return state;
  try {
    const r = await u.checkForUpdates();
    // null: this build cannot self-update (e.g. unpacked folder instead of the installer / AppImage)
    if (!r && state.state !== 'error') set({ state: 'unsupported' });
  } catch (e) { set({ state: 'error', message: friendly(e) }); }
  return state;
}

async function download() {
  const u = load();
  if (u) await u.downloadUpdate();
}

function install() {
  if (updater && state.state === 'ready') updater.quitAndInstall(false, true);
}

function current() { return state; }

function stop() { clearInterval(timer); }

module.exports = { init, configure, check, download, install, current, stop };
