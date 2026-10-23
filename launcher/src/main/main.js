'use strict';
const { app, BrowserWindow, ipcMain, shell, dialog, safeStorage, nativeImage, session } = require('electron');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { pathToFileURL } = require('url');

// ------------------------------------------------------------------ IPC guard
// Every invoke handler (also those registered by other modules) only answers our own renderer page.
const RENDERER_URL = pathToFileURL(path.join(__dirname, '..', 'renderer')).href + '/';
const rawHandle = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (channel, fn) => rawHandle(channel, (e, ...args) => {
  const url = e.senderFrame ? e.senderFrame.url : '';
  if (!url.startsWith(RENDERER_URL)) throw new Error('Odrzucono żądanie spoza launchera');
  return fn(e, ...args);
});
const paths = require('./paths');
const store = require('./store');
const versions = require('./versions');
const java = require('./java');
const auth = require('./auth');
const launcher = require('./launch');
const modrinth = require('./modrinth');
const curseforge = require('./curseforge');
const instances = require('./instances');
const noreMods = require('./nore-mods');
const net = require('./net');
const servers = require('./servers');
const discord = require('./discord');
const updater = require('./updater');
const serverContent = require('./server-content');
const serverNet = require('./server-net');
const serverTunnel = require('./server-tunnel');
const AdmZip = require('adm-zip');
const loaders = require('./loaders');
const modpacks = require('./modpacks');
const doctor = require('./doctor');
const social = require('./social');
const chat = require('./chat');
const chatBridge = require('./chat-bridge');
const hub = require('./hub');
const keys = require('./keys');

const FABRIC_API_ID = 'P7dR8mSH';
/** The "Nore Pack": performance + QoL mods installed for modded instances (any Fabric version). */
const NORE_PACK = ['fabric-api', 'sodium', 'lithium', 'ferrite-core', 'entityculling', 'immediatelyfast', 'modmenu', 'zoomify', 'appleskin'];
/** Performance mods installed next to Nore Client (several times more FPS than vanilla rendering). */
const NORE_PERF = ['sodium', 'lithium', 'ferrite-core', 'entityculling', 'immediatelyfast'];
const ICON = path.join(__dirname, '..', 'renderer', 'assets', 'logo.png');

let win = null;
let game = null; // { child, instanceId, started }
let busy = false;
const msLogins = new Map();

// ------------------------------------------------------------------ secrets

/** Tokens kept only in memory when the system has no secure storage (never written in plain text). */
const volatileSecrets = new Map();

function seal(obj, id) {
  if (safeStorage.isEncryptionAvailable()) return { enc: safeStorage.encryptString(JSON.stringify(obj)).toString('base64') };
  if (id) volatileSecrets.set(id, obj);
  return { volatile: true };
}

function unseal(box, id) {
  if (box && box.enc) {
    try { return JSON.parse(safeStorage.decryptString(Buffer.from(box.enc, 'base64'))); } catch { /* another machine / user */ }
  }
  return (id && volatileSecrets.get(id)) || {};
}

/**
 * Azure application ID for the Microsoft login: baked in by scripts/keys.js, or – in a build made
 * without it (CI secret not set, local development) – fetched from the Nore API, which keeps it as a
 * Worker secret. The last fetched value is remembered so token refresh works offline-first.
 */
async function msClientId() {
  const own = keys.microsoftClientId() || store.get().settings.msClientId;
  if (own) return own;
  try {
    const res = await net.fetchWithRetry('https://noroclient.pl/api/v1/launcher/config', {}, 2);
    const id = res.ok ? String((await res.json()).microsoftClientId || '') : '';
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      if (store.get().msClientIdRemote !== id) store.update(s => { s.msClientIdRemote = id; });
      return id;
    }
  } catch { /* offline – fall back to the remembered one */ }
  return store.get().msClientIdRemote || null;
}

function publicAccount(a) {
  return { id: a.id, type: a.type, name: a.name, uuid: a.uuid, skin: a.skin || null };
}

// ------------------------------------------------------------------ window

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function createWindow() {
  win = new BrowserWindow({
    width: 1220, height: 760, minWidth: 980, minHeight: 640,
    frame: false, show: false, backgroundColor: '#0d0913', title: 'Nore Launcher',
    icon: nativeImage.createFromPath(ICON),
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: true,
    },
  });
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  win.once('ready-to-show', () => win.show());
  win.on('maximize', () => send('window:state', { maximized: true }));
  win.on('unmaximize', () => send('window:state', { maximized: false }));
  // the launcher never navigates away from its own page
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith(RENDERER_URL)) e.preventDefault(); });
  win.webContents.on('will-attach-webview', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
}

// ------------------------------------------------------------------ Nore Updater splash

/**
 * Small animated window shown before the launcher: checks for a new version, downloads it with a
 * progress ring and installs it (the launcher then restarts). After an update it greets the new
 * version. It never blocks the launcher for long: no update, an error or "Pomiń" opens it at once.
 */
function runSplash() {
  return new Promise((resolve) => {
    const cur = app.getVersion();
    const prev = store.get().lastVersion;
    const justUpdated = !!prev && prev !== cur;
    const freshInstall = !prev && app.isPackaged && store.get().firstRun !== false;
    store.update((d) => { d.lastVersion = cur; });
    const testing = !!process.env.NORE_UPDATER_TEST;
    if (!app.isPackaged && !testing && !justUpdated) return resolve();

    const splash = new BrowserWindow({
      width: 400, height: 480, frame: false, resizable: false, maximizable: false, fullscreenable: false,
      show: false, center: true, backgroundColor: '#0d0913', title: 'Nore Updater',
      icon: nativeImage.createFromPath(ICON),
      webPreferences: { preload: path.join(__dirname, '..', 'updater-preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    splash.webContents.on('will-navigate', (e) => e.preventDefault());
    splash.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    splash.loadFile(path.join(__dirname, '..', 'renderer', 'updater.html'));

    let done = false;
    let off = () => {};
    const timers = [];
    const later = (fn, ms) => timers.push(setTimeout(fn, ms));
    const post = (st) => { if (!splash.isDestroyed()) splash.webContents.send('splash:state', { version: cur, ...st }); };
    const finish = () => {
      if (done) return;
      done = true;
      off();
      timers.forEach(clearTimeout);
      ipcMain.removeListener('splash:skip', onSkip);
      resolve();
      setTimeout(() => { if (!splash.isDestroyed()) splash.destroy(); }, 350);
    };
    const onSkip = (e) => { if (!splash.isDestroyed() && e.sender === splash.webContents) finish(); };
    ipcMain.on('splash:skip', onSkip);
    splash.on('closed', finish);
    // a stuck window must never keep the launcher closed
    later(() => { if (!['downloading', 'verifying', 'available'].includes(updater.current().state)) finish(); }, 20000);

    const begin = () => {
      post({ state: 'checking' });
      off = updater.onState((st) => {
        post(st);
        if (st.state === 'latest' || st.state === 'dev') later(finish, 1100);
        else if (st.state === 'error') later(finish, 1800);
        else if (st.state === 'available' && store.get().settings.autoUpdate === false) later(finish, 2600);
        else if (st.state === 'ready') {
          const auto = store.get().settings.autoUpdate !== false;
          if (!auto || testing || store.get().lastUpdateAttempt === st.next) return later(finish, 1500);
          // one automatic attempt per version, so a broken installer cannot loop the launcher
          store.update((d) => { d.lastUpdateAttempt = st.next; });
          post({ state: 'installing', next: st.next });
          later(() => updater.install(), 1400);
        }
      });
      updater.check().catch(() => later(finish, 1500));
      later(() => { if (updater.current().state === 'checking' || updater.current().state === 'idle') finish(); }, 9000);
    };

    splash.once('ready-to-show', () => {
      splash.show();
      if (justUpdated || freshInstall) {
        post({ state: justUpdated ? 'updated' : 'installed' });
        later(begin, 2600);
      } else later(begin, 450);
    });
  });
}

app.whenReady().then(async () => {
  store.load();
  // the friends voice chat needs the microphone; nothing else may ask for devices
  session.defaultSession.setPermissionRequestHandler((wc, permission, done, details) => {
    if (permission === 'notifications') return done(true);
    if (permission === 'media') return done(!(details.mediaTypes || []).includes('video'));
    done(false);
  });
  session.defaultSession.setPermissionCheckHandler((wc, permission) => ['media', 'notifications'].includes(permission));
  servers.setEmitter(send);
  chatBridge.start(send);
  instances.ensureDefault();
  updater.init(send, store.get().settings, { checkNow: true });
  await runSplash().catch(() => {});
  createWindow();
  applyDiscord();
  discord.setActivity(LAUNCHER_ACTIVITY);
});

const LAUNCHER_ACTIVITY = { details: 'W launcherze', state: 'Wybiera, w co zagrać' };

function applyDiscord() {
  const s = store.get().settings;
  discord.setClientId(s.discordAppId || store.DISCORD_APP_ID);
}

// running servers get "stop" and the launcher waits until they saved their worlds
let serversStopped = false;
app.on('before-quit', (e) => {
  if (serversStopped || !servers.runningCount()) return;
  e.preventDefault();
  serversStopped = true;
  servers.stopAllAndWait().finally(() => app.quit());
});

app.on('window-all-closed', () => {
  // the updater splash closes before the launcher window exists
  if (!game && win) app.quit();
});

// ------------------------------------------------------------------ IPC: app & window

ipcMain.handle('app:info', () => ({
  version: app.getVersion(), platform: process.platform, root: paths.root,
  totalMemMb: Math.round(require('os').totalmem() / 1048576),
}));
ipcMain.on('window:minimize', () => win.minimize());
ipcMain.on('window:maximize', () => (win.isMaximized() ? win.unmaximize() : win.maximize()));
ipcMain.on('window:close', () => win.close());
ipcMain.handle('shell:open', (e, url) => /^https:\/\//.test(url) && shell.openExternal(url));
ipcMain.handle('shell:folder', (e, dir) => shell.openPath(dir));

ipcMain.handle('state:get', () => {
  const d = store.get();
  return {
    firstRun: d.firstRun,
    settings: d.settings,
    accounts: d.accounts.map(publicAccount),
    selectedAccount: d.selectedAccount,
    instances: instances.list(),
    selectedInstance: d.selectedInstance,
    running: game ? game.instanceId : null,
    noreVersions: instances.NORE_VERSIONS,
    servers: servers.list(),
  };
});

ipcMain.handle('settings:set', (e, patch) => {
  store.update(d => Object.assign(d.settings, patch));
  if ('discordRpc' in patch || 'discordAppId' in patch) applyDiscord();
  if ('autoUpdate' in patch) updater.configure(store.get().settings);
  if ('updateChannel' in patch || 'notifyContentUpdates' in patch) scheduleUpdateChecks(1500);
  if ('hubPresence' in patch) hub.refresh();
  return store.get().settings;
});

// ------------------------------------------------------------------ IPC: custom background

const BG_TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' };

async function customBackground() {
  const name = store.get().settings.bgCustom;
  if (!name) return null;
  try {
    const data = await fsp.readFile(path.join(paths.root, name));
    return `data:${BG_TYPES[path.extname(name).toLowerCase()] || 'image/png'};base64,${data.toString('base64')}`;
  } catch { return null; }
}

ipcMain.handle('bg:custom', () => customBackground());
ipcMain.handle('bg:pick', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'Wybierz tło', filters: [{ name: 'Obrazy', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] }], properties: ['openFile'] });
  if (r.canceled || !r.filePaths[0]) return null;
  const src = r.filePaths[0];
  if ((await fsp.stat(src)).size > 25 * 1024 * 1024) throw new Error('Obrazek jest za duży (maks. 25 MB).');
  const name = 'custom-background' + path.extname(src).toLowerCase();
  for (const ext of Object.keys(BG_TYPES)) await fsp.rm(path.join(paths.root, 'custom-background' + ext), { force: true });
  await fsp.copyFile(src, path.join(paths.root, name));
  store.update(d => { d.settings.bgCustom = name; d.settings.bgScene = 'custom'; });
  return customBackground();
});

ipcMain.handle('update:state', () => updater.current());
ipcMain.handle('update:check', () => updater.check());
ipcMain.handle('update:download', () => updater.download());
ipcMain.handle('update:install', () => {
  if (game) throw new Error('Zamknij grę przed instalacją aktualizacji.');
  servers.stopAll();
  updater.install();
  return true;
});

ipcMain.handle('onboarding:done', () => store.update(d => { d.firstRun = false; }) && true);

ipcMain.handle('dialog:java', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'Wybierz plik Javy', properties: ['openFile'] });
  if (r.canceled || !r.filePaths[0]) return null;
  const major = await java.probeJava(r.filePaths[0]);
  return { path: r.filePaths[0], major };
});

// ------------------------------------------------------------------ IPC: accounts

ipcMain.handle('accounts:offline', (e, name) => {
  const acc = auth.createOffline(name);
  store.update(d => {
    d.accounts = d.accounts.filter(a => a.id !== acc.id);
    d.accounts.push({ id: acc.id, type: 'offline', name: acc.name, uuid: acc.uuid });
    d.selectedAccount = acc.id;
  });
  return publicAccount(acc);
});

ipcMain.handle('accounts:msStart', async () => {
  const device = await auth.startDeviceCode(await msClientId());
  const controller = new AbortController();
  msLogins.set(device.device_code, controller);
  return { deviceCode: device.device_code, userCode: device.user_code, uri: device.verification_uri, expiresIn: device.expires_in, interval: device.interval };
});

ipcMain.handle('accounts:msPoll', async (e, deviceCode, userCode, expiresIn, interval) => {
  const controller = msLogins.get(deviceCode);
  if (!controller) throw new Error('Sesja logowania wygasła – zacznij od nowa');
  try {
    const token = await auth.pollDeviceCode(await msClientId(), { device_code: deviceCode, expires_in: expiresIn, interval }, { signal: controller.signal });
    const mc = await auth.minecraftFromMs(token.access_token);
    const acc = { id: 'ms-' + mc.uuid, type: 'microsoft', name: mc.name, uuid: mc.uuid, skin: mc.skin, verifiedAt: Date.now() };
    const secret = seal({ accessToken: mc.accessToken, refreshToken: token.refresh_token, expiresAt: mc.expiresAt }, acc.id);
    store.update(d => {
      d.accounts = d.accounts.filter(a => a.id !== acc.id);
      d.accounts.push({ ...acc, secret });
      d.selectedAccount = acc.id;
    });
    return publicAccount(acc);
  } finally {
    msLogins.delete(deviceCode);
  }
});

ipcMain.handle('accounts:msCancel', (e, deviceCode) => {
  const c = msLogins.get(deviceCode);
  if (c) c.abort();
});

ipcMain.handle('accounts:select', (e, id) => {
  if (!store.get().accounts.some(a => a.id === id)) throw new Error('Nie ma takiego konta');
  store.update(d => { d.selectedAccount = id; });
  return true;
});

ipcMain.handle('accounts:remove', (e, id) => {
  volatileSecrets.delete(id);
  store.update(d => {
    d.accounts = d.accounts.filter(a => a.id !== id);
    if (d.selectedAccount === id) d.selectedAccount = d.accounts[0] ? d.accounts[0].id : null;
  });
  return true;
});

ipcMain.handle('auth:logout', () => {
  volatileSecrets.clear();
  store.update(d => { d.accounts = []; d.selectedAccount = null; });
  session.defaultSession.clearStorageData({ storages: ['cookies'] }).catch(() => {});
  return true;
});

/**
 * Checks the selected Microsoft session on start: the Minecraft token is refreshed when it is close
 * to expiring and the profile is checked with Mojang. Never blocks the launcher – non-premium
 * accounts (and no account at all) are fine; an expired premium session is reported.
 */
ipcMain.handle('auth:status', async () => {
  const d = store.get();
  const acc = d.accounts.find(a => a.id === d.selectedAccount);
  if (!acc) return { loggedIn: false };
  if (acc.type !== 'microsoft') return { loggedIn: true, account: publicAccount(acc) };
  try {
    const ready = await readyAccount();
    if (!(await auth.checkProfile(ready.accessToken))) {
      const fresh = await readyAccount({ force: true });
      if (!(await auth.checkProfile(fresh.accessToken))) throw Object.assign(new Error('Sesja premium wygasła – zaloguj się ponownie.'), { auth: true });
    }
    store.update(s => { const a = s.accounts.find(x => x.id === acc.id); if (a) a.verifiedAt = Date.now(); });
    return { loggedIn: true, account: publicAccount(acc) };
  } catch (e) {
    const network = !e.auth && /fetch failed|ENOTFOUND|ECONN|ETIMEDOUT|EAI_AGAIN|network/i.test(String(e.message || e));
    return { loggedIn: true, offline: network, expired: !network, error: String(e.message || e), account: publicAccount(acc) };
  }
});

/** Returns a launch-ready account (refreshing Microsoft tokens when needed). */
async function readyAccount({ force = false } = {}) {
  const d = store.get();
  const acc = d.accounts.find(a => a.id === d.selectedAccount);
  if (!acc) throw new Error('Wybierz albo dodaj konto, zanim uruchomisz grę.');
  if (acc.type === 'offline') return { ...acc, accessToken: '0' };
  let secret = unseal(acc.secret, acc.id);
  if (!secret.refreshToken && !secret.accessToken) {
    throw Object.assign(new Error('Sesja premium wygasła – zaloguj się ponownie.'), { auth: true });
  }
  if (force || !secret.accessToken || !secret.expiresAt || secret.expiresAt - Date.now() < 10 * 60 * 1000) {
    send('progress', { stage: 'Odświeżanie sesji Microsoft' });
    const refreshed = await auth.refreshMicrosoft({ ...acc, ...secret }, await msClientId());
    secret = { accessToken: refreshed.accessToken, refreshToken: refreshed.refreshToken, expiresAt: refreshed.expiresAt };
    store.update(s => {
      const a = s.accounts.find(x => x.id === acc.id);
      if (a) { a.secret = seal(secret, acc.id); a.name = refreshed.name; a.skin = refreshed.skin; a.verifiedAt = Date.now(); }
    });
  }
  return { ...acc, accessToken: secret.accessToken };
}

// ------------------------------------------------------------------ IPC: versions & instances

ipcMain.handle('versions:list', async (e, { snapshots } = {}) => {
  const m = await versions.getManifest();
  let fabric = new Set();
  try { fabric = await versions.getFabricGameVersions(); } catch { /* offline */ }
  return {
    latest: m.latest,
    versions: m.versions
      .filter(v => v.type === 'release' || (snapshots && v.type === 'snapshot'))
      .map(v => ({ id: v.id, type: v.type, releaseTime: v.releaseTime, fabric: fabric.has(v.id) })),
  };
});

ipcMain.handle('versions:fabricLoaders', (e, mc) => versions.getFabricLoaders(mc));

ipcMain.handle('instances:create', (e, opts) => instances.create(opts));
ipcMain.handle('instances:update', (e, id, patch) => instances.update(id, patch));
ipcMain.handle('instances:remove', (e, id, deleteFiles) => instances.remove(id, deleteFiles));
ipcMain.handle('instances:select', (e, id) => store.update(d => { d.selectedInstance = id; }) && true);
ipcMain.handle('instances:folder', (e, id, sub) => {
  const inst = instances.get(id);
  if (!inst) return;
  const dir = path.join(inst.gameDir, sub || '');
  fs.mkdirSync(dir, { recursive: true });
  return shell.openPath(dir);
});
ipcMain.handle('instances:worlds', (e, id) => instances.worlds(id));

// ------------------------------------------------------------------ IPC: launch

async function prepareNore(inst) {
  const mods = path.join(inst.gameDir, 'mods');
  await fsp.mkdir(mods, { recursive: true });
  const jar = noreMods.jarFor(inst.mcVersion);
  if (jar) await fsp.copyFile(jar, path.join(mods, 'noreclient.jar'));
  else send('log', { line: `[Launcher] Brak Nore Client dla Minecraft ${inst.mcVersion} – pomijam.`, stream: 'err' });
  const present = await fsp.readdir(mods).catch(() => []);
  if (!present.some(f => /^fabric-api-.*\.jar$/.test(f))) {
    send('progress', { stage: 'Pobieranie Fabric API' });
    try {
      await modrinth.install({ projectId: FABRIC_API_ID, kind: 'mod', gameVersion: inst.mcVersion, loader: 'fabric', targetDir: mods });
    } catch (e) {
      // Nore Client does not need Fabric API; a brand-new Minecraft version may not have it yet
      send('log', { line: `[Launcher] Fabric API niedostępne dla ${inst.mcVersion} (${e.message}) – gram bez niego.`, stream: 'out' });
    }
  }
  if (inst.perfMods !== false && !inst.perfModsInstalled) {
    let i = 0;
    for (const slug of NORE_PERF) {
      send('progress', { stage: 'Mody wydajności', current: slug, done: i++, total: NORE_PERF.length, step: 'nore' });
      try {
        await modrinth.install({ projectId: slug, kind: 'mod', gameVersion: inst.mcVersion, loader: 'fabric', targetDir: mods });
      } catch (e) {
        send('log', { line: `[Launcher] ${slug} niedostępny dla ${inst.mcVersion} (${e.message})`, stream: 'out' });
      }
    }
    instances.update(inst.id, { perfModsInstalled: true });
  }
}

/** Downloads everything an instance needs (game, loader, Java, Nore Client) without launching. */
async function prepareGame(inst, settings, progress) {
  progress({ stage: 'Minecraft ' + inst.mcVersion, step: 'game' });
  const javaFor = async (component) => settings.javaPath || java.ensureRuntime(component, { progress: (p) => progress({ ...p, step: 'java' }) });
  const installed = await versions.installVersion(
    { mcVersion: inst.mcVersion, loader: inst.loader, loaderVersion: inst.loaderVersion },
    { progress: (p) => progress({ ...p, step: p.stage && /^(Instalowanie|Pobieranie) (Fabric|Quilt|Forge|NeoForge)/.test(p.stage) ? 'loader' : 'game' }), concurrency: settings.concurrency, javaBin: javaFor });
  if (inst.loader !== 'vanilla' && !inst.loaderVersion && installed.loaderVersion) instances.update(inst.id, { loaderVersion: installed.loaderVersion });
  if (inst.noreClient) {
    progress({ stage: 'Instalowanie Nore Client', step: 'nore' });
    await prepareNore(inst);
  }
  if (inst.perfPack && inst.loader === 'fabric' && !inst.packInstalled) {
    const mods = path.join(inst.gameDir, 'mods');
    let i = 0;
    const pack = inst.noreClient ? NORE_PACK.filter(s => s !== 'zoomify') : NORE_PACK;
    for (const slug of pack) {
      progress({ stage: 'Pakiet Nore', current: slug, done: i++, total: pack.length, step: 'nore' });
      try {
        await modrinth.install({ projectId: slug, kind: 'mod', gameVersion: inst.mcVersion, loader: 'fabric', targetDir: mods });
      } catch (e) {
        send('log', { line: `[Launcher] Pakiet Nore: ${slug} niedostępny dla ${inst.mcVersion} (${e.message})`, stream: 'out' });
      }
    }
    instances.update(inst.id, { packInstalled: true });
  }
  if (inst.autoUpdateMods && inst.loader !== 'vanilla') {
    try {
      progress({ stage: 'Aktualizacja modów', step: 'nore' });
      const dir = path.join(inst.gameDir, 'mods');
      const ups = await modrinth.checkUpdates(dir, 'mod', inst.mcVersion, inst.loader, settings.updateChannel);
      if (ups.length) {
        await modrinth.applyUpdates(dir, ups, { gameDir: inst.gameDir });
        remapPackFiles(inst, dir, ups);
        send('log', { line: `[Launcher] Zaktualizowano mody: ${ups.map(u => u.newFile).join(', ')}`, stream: 'out' });
      }
    } catch (e) {
      send('log', { line: `[Launcher] Aktualizacja modów nie powiodła się: ${e.message}`, stream: 'err' });
    }
  }
  let javaBin = settings.javaPath;
  if (!javaBin) {
    const component = (installed.version.javaVersion && installed.version.javaVersion.component) || 'jre-legacy';
    progress({ stage: 'Java (' + component + ')', step: 'java' });
    javaBin = await java.ensureRuntime(component, { progress: (p) => progress({ ...p, step: 'java' }) });
  }
  return { installed, javaBin };
}

/** After a crash: find the cause in the log and (if enabled) fix it automatically. */
async function crashRepair(inst, lines, code) {
  try {
    const fresh = instances.get(inst.id) || inst;
    const problems = await doctor.analyzeLog(fresh, lines.slice(-3000));
    const auto = store.get().settings.autoRepair !== false;
    const result = auto && problems.length ? await doctor.apply(fresh, problems) : problems;
    for (const p of result) send('log', { line: `[Naprawa] ${p.title}${p.result ? ': ' + p.result : ''}`, stream: 'out' });
    send('doctor:report', { instanceId: inst.id, phase: 'crash', code, applied: auto, problems: result });
  } catch (e) {
    send('log', { line: `[Naprawa] Analiza błędu nie powiodła się: ${e.message}`, stream: 'err' });
  }
}

// ------------------------------------------------------------------ IPC: friends, gallery

ipcMain.handle('friends:list', () => social.friends());

// friends chat & voice (transport in the renderer, identity / history here – see chat.js)
ipcMain.handle('chat:identity', () => chat.identity());
ipcMain.handle('chat:contacts', () => chat.contacts());
ipcMain.handle('chat:add', (e, id, name) => chat.addContact(id, name));
ipcMain.handle('chat:remove', (e, hex) => chat.removeContact(hex));
ipcMain.handle('chat:sign', (e, text) => chat.sign(text));
ipcMain.handle('chat:verify', (e, hex, pub, text, sig) => chat.verify(hex, pub, text, sig));
ipcMain.handle('chat:seen', (e, hex, pub, name) => chat.seen(hex, pub, name));
ipcMain.handle('chat:requests', () => chat.requests());
ipcMain.handle('chat:addRequest', (e, hex, pub, name, text) => chat.addRequest(hex, pub, name, text));
ipcMain.handle('chat:decline', (e, hex, block) => chat.declineRequest(hex, block));
ipcMain.handle('chat:history', (e, hex) => chat.history(hex));
ipcMain.handle('chat:put', (e, hex, msg) => {
  const saved = chat.putMessage(hex, msg);
  if (saved && !msg.mine && msg.text) chatBridge.message(hex, saved);
  return saved;
});
ipcMain.handle('chat:presence', (e, map) => { chatBridge.setPresence(map); return true; });
ipcMain.handle('chat:read', (e, hex) => chat.markRead(hex));
ipcMain.handle('chat:clear', (e, hex) => chat.clearHistory(hex));
ipcMain.handle('chat:attention', () => { if (win && !win.isFocused()) win.flashFrame(true); return true; });
ipcMain.handle('friends:add', (e, name) => social.addFriend(name));
ipcMain.handle('friends:remove', (e, name) => social.removeFriend(name));
ipcMain.handle('gallery:list', () => social.gallery());
/** Only screenshots of Nore instances may be read, copied, opened or deleted through the gallery. */
function screenshotPath(p) {
  const full = path.resolve(String(p || ''));
  if (!/\.png$/i.test(full) || !instances.list().some(i => full.startsWith(path.join(i.gameDir, 'screenshots') + path.sep))) {
    throw new Error('Niedozwolona ścieżka.');
  }
  return full;
}
ipcMain.handle('gallery:full', (e, p) => social.fullImage(screenshotPath(p)));
ipcMain.handle('gallery:copy', (e, p) => {
  const img = nativeImage.createFromPath(screenshotPath(p));
  if (img.isEmpty()) throw new Error('Nie można odczytać obrazu.');
  require('electron').clipboard.writeImage(img);
  return true;
});
ipcMain.handle('gallery:reveal', (e, p) => shell.showItemInFolder(screenshotPath(p)));
ipcMain.handle('gallery:open', (e, p) => shell.openPath(screenshotPath(p)));
ipcMain.handle('gallery:delete', async (e, p) => {
  await fsp.rm(screenshotPath(p), { force: true });
  return true;
});

ipcMain.handle('doctor:check', async (e, id) => {
  const inst = instances.get(id);
  if (!inst) throw new Error('Nie znaleziono instancji.');
  return doctor.deepCheck(inst);
});
ipcMain.handle('doctor:fix', async (e, id, problems) => {
  const inst = instances.get(id);
  if (!inst) throw new Error('Nie znaleziono instancji.');
  return doctor.apply(inst, problems);
});

ipcMain.handle('game:prepare', async (e, instanceId) => {
  if (busy) throw new Error('Trwa już przygotowywanie gry.');
  busy = true;
  try {
    const inst = instances.get(instanceId);
    if (!inst) throw new Error('Nie znaleziono instancji.');
    await prepareGame(inst, store.get().settings, (p) => send('progress', p));
    return true;
  } finally {
    busy = false;
    send('progress', null);
  }
});

ipcMain.handle('game:launch', async (e, instanceId, opts = {}) => {
  if (busy) throw new Error('Trwa już przygotowywanie gry.');
  if (game) throw new Error('Gra jest już uruchomiona.');
  busy = true;
  const progress = (p) => send('progress', p);
  try {
    let inst = instances.get(instanceId);
    if (!inst) throw new Error('Nie znaleziono instancji.');
    if (opts.joinServer) inst = { ...inst, joinServer: opts.joinServer };
    const account = await readyAccount();
    const base = store.get().settings;
    const settings = { ...base, jvmArgs: [base.jvmArgs, inst.jvmArgs].filter(Boolean).join(' ') };

    const { installed, javaBin } = await prepareGame(inst, settings, progress);

    await social.sync().catch(() => {});

    // automatic repair before the start: duplicate mods, mods for another loader
    if (base.autoRepair !== false) {
      try {
        const found = await doctor.preflight(inst);
        if (found.length) {
          const fixed = await doctor.apply(inst, found);
          for (const p of fixed) send('log', { line: `[Naprawa] ${p.title}: ${p.result}`, stream: 'out' });
          send('doctor:report', { instanceId: inst.id, phase: 'preflight', problems: fixed });
        }
      } catch (err) {
        send('log', { line: `[Naprawa] Sprawdzanie modów nie powiodło się: ${err.message}`, stream: 'err' });
      }
    }

    progress({ stage: 'Uruchamianie gry' });
    const started = Date.now();
    const tail = [];
    // the in-game friends chat talks to the launcher through the local bridge
    const child = await launcher.launch({ instance: inst, account, settings: { ...settings, chatBridge: inst.noreClient ? chatBridge.address() : null }, installed, javaBin }, {
      onLog: (line, stream) => {
        send('log', { line, stream });
        tail.push(line);
        if (tail.length > 4000) tail.splice(0, 1000);
        if (game && !game.visible && /Backend library|Setting user|LWJGL/.test(line)) {
          game.visible = true;
          send('game:state', { running: inst.id, phase: 'running' });
          if (settings.afterLaunch === 'hide' && win) win.hide();
          if (settings.afterLaunch === 'close') app.quit();
        }
      },
      onExit: (code) => {
        const killed = game && game.killed;
        const played = Date.now() - started;
        instances.update(inst.id, { playTime: (instances.get(inst.id).playTime || 0) + played });
        game = null;
        hub.gameStopped();
        discord.setActivity(LAUNCHER_ACTIVITY);
        send('game:state', { running: null, code: killed ? 0 : code });
        if (win) { win.show(); win.focus(); }
        if (!killed && code !== 0) crashRepair(inst, tail, code);
      },
    });
    game = { child, instanceId: inst.id, started, visible: false };
    // Nore Hub: other Nore players see this one (in the background, never delays the game)
    if (inst.noreClient) hub.gameStarted(account, (line) => send('log', { line: `[Nore Hub] ${line}`, stream: 'out' }));
    // Nore Client shows its own, richer presence from inside the game
    discord.setActivity(inst.modpack === 'nore' ? null : {
      details: `Gra w Minecraft ${inst.mcVersion}`, state: inst.name, start: Math.floor(started / 1000),
    });
    instances.update(inst.id, { lastPlayed: Date.now() });
    send('game:state', { running: inst.id, phase: 'starting' });
    return true;
  } finally {
    busy = false;
    send('progress', null);
  }
});

ipcMain.handle('game:kill', () => {
  if (game) { game.killed = true; game.child.kill(); }
});

// ------------------------------------------------------------------ IPC: content (Modrinth)

function contentDir(inst, kind, world) {
  if (kind === 'datapack') {
    if (!world) throw new Error('Wybierz świat, do którego chcesz dodać datapack.');
    return path.join(inst.gameDir, 'saves', world, 'datapacks');
  }
  return path.join(inst.gameDir, modrinth.KINDS[kind].folder);
}

// Modrinth and CurseForge share one browser: CurseForge ids are "cf:<number>"
ipcMain.handle('content:search', (e, opts) => (opts && opts.source === 'curseforge' ? curseforge.search(opts) : modrinth.search(opts)));
ipcMain.handle('content:details', (e, id) => (curseforge.isCf(id) ? curseforge.details(id) : modrinth.details(id)));
ipcMain.handle('content:identify', async (e, { instanceId, kind, world }) => {
  const inst = instances.get(instanceId);
  if (!inst || (kind === 'datapack' && !world)) return {};
  const dir = contentDir(inst, kind, world);
  const mr = await modrinth.identify(dir, modrinth.KINDS[kind].ext).catch(() => ({}));
  const cfMap = await curseforge.identify(dir, modrinth.KINDS[kind].ext, new Set(Object.keys(mr))).catch(() => ({}));
  return { ...cfMap, ...mr };
});
ipcMain.handle('content:categories', (e, kind, source) => (source === 'curseforge' ? curseforge.categories(kind) : modrinth.categories(kind)));
ipcMain.handle('curseforge:status', () => ({ available: curseforge.available(), own: !!store.get().settings.curseforgeKey }));
ipcMain.handle('curseforge:setKey', async (e, k) => {
  k = String(k || '').trim();
  if (k) await curseforge.testKey(k);
  return curseforge.setKey(k);
});
ipcMain.handle('loaders:versions', (e, loader, mc) => loaders.versions(loader, mc));

// ------------------------------------------------------------------ IPC: modpacks

/** Installs a modpack as a new instance, then downloads the game + loader so it is ready to play. */
async function installPack(run) {
  if (busy) throw new Error('Trwa już przygotowywanie gry.');
  busy = true;
  const progress = (p) => send('modpack:progress', p);
  try {
    const settings = store.get().settings;
    const inst = await run(progress, settings.concurrency);
    store.update(d => { d.selectedInstance = inst.id; });
    try {
      await prepareGame(instances.get(inst.id), settings, (p) => progress({ ...p, phase: 'game' }));
    } catch (e) {
      send('log', { line: `[Launcher] Paczka zainstalowana, ale pobieranie gry nie powiodło się: ${e.message}`, stream: 'err' });
      return { instance: instances.get(inst.id), warning: e.message };
    }
    return { instance: instances.get(inst.id) };
  } finally {
    busy = false;
    send('modpack:progress', null);
  }
}

ipcMain.handle('modpacks:install', (e, { projectId, versionId }) =>
  installPack((progress, concurrency) => modpacks.install({ projectId, versionId }, progress, concurrency)));

ipcMain.handle('modpacks:import', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'Importuj modpack', filters: [{ name: 'Modpack (Modrinth .mrpack, CurseForge .zip)', extensions: ['mrpack', 'zip'] }], properties: ['openFile'] });
  if (r.canceled || !r.filePaths[0]) return null;
  const file = r.filePaths[0];
  return installPack((progress, concurrency) => modpacks.installFile(file, {}, progress, concurrency));
});

ipcMain.handle('modpacks:checkUpdate', async (e, instanceId) => {
  const inst = instances.get(instanceId);
  if (!inst) throw new Error('Nie znaleziono instancji.');
  const up = await modpacks.checkUpdate(inst, store.get().settings.updateChannel);
  setInstanceUpdates(instanceId, { ...(contentUpdates[instanceId] || { mods: 0, resourcepacks: 0, shaders: 0 }), pack: up, checked: Date.now() });
  return up;
});
ipcMain.handle('modpacks:versions', (e, instanceId) => modpacks.versions(instances.get(instanceId)));

/** Updates (or changes the version of) a modpack instance in place, then downloads the game + loader. */
ipcMain.handle('modpacks:update', async (e, { instanceId, versionId, backupWorlds = true }) => {
  if (game && game.instanceId === instanceId) throw new Error('Zamknij grę przed aktualizacją modpacka.');
  if (busy) throw new Error('Trwa już przygotowywanie gry.');
  busy = true;
  const progress = (p) => send('modpack:progress', p);
  try {
    const settings = store.get().settings;
    const inst = instances.get(instanceId);
    if (!inst) throw new Error('Nie znaleziono instancji.');
    if (!versionId) {
      const up = await modpacks.checkUpdate(inst, settings.updateChannel);
      if (!up) throw new Error('Paczka jest już aktualna.');
      versionId = up.versionId;
    }
    const r = await modpacks.update(instanceId, versionId, progress, { backupWorlds: backupWorlds !== false, concurrency: settings.concurrency });
    send('log', { line: `[Launcher] Zaktualizowano modpack ${inst.name}: ${inst.pack.version} → ${r.instance.pack.version}${r.backup ? ` (kopia: ${r.backup})` : ''}`, stream: 'out' });
    recheckInstance(instanceId);
    const out = { ...r, kept: r.kept.length };
    try {
      await prepareGame(instances.get(instanceId), settings, (p) => progress({ ...p, phase: 'game' }));
    } catch (err) {
      send('log', { line: `[Launcher] Paczka zaktualizowana, ale pobieranie gry nie powiodło się: ${err.message}`, stream: 'err' });
      return { ...out, instance: instances.get(instanceId), warning: err.message };
    }
    return { ...out, instance: instances.get(instanceId) };
  } finally {
    busy = false;
    send('modpack:progress', null);
  }
});

// ------------------------------------------------------------------ content updates (background check)

const UPDATE_CHECK_EVERY = 6 * 3600 * 1000;
let contentUpdates = {}; // { [instanceId]: { pack, mods, resourcepacks, shaders, checked } }
let updatesRun = null;
let updatesTimer = null;
const pause = (ms) => new Promise(r => setTimeout(r, ms));

function updatesState() {
  const ids = new Set(instances.list().map(i => i.id));
  return Object.fromEntries(Object.entries(contentUpdates).filter(([id]) => ids.has(id)));
}

function setInstanceUpdates(id, value) {
  contentUpdates = { ...contentUpdates, [id]: value };
  send('content:updatesState', updatesState());
}

/** Paths of a modpack instance that belong to the pack (null when unknown – older installs). */
function packFileSet(inst) {
  if (inst.modpack !== 'pack' || !inst.pack) return new Set();
  return Array.isArray(inst.pack.files) ? new Set(inst.pack.files) : null;
}

/** Updates of files a modpack brought are left to the modpack itself. */
function withoutPackFiles(inst, kind, ups) {
  const set = packFileSet(inst);
  if (!set) return inst.modpack === 'pack' ? [] : ups;
  const folder = modrinth.KINDS[kind].folder;
  return ups.filter(u => !set.has(`${folder}/${u.oldFile}`));
}

/** Keeps a modpack's file list in sync when one of its files is updated on its own. */
function remapPackFiles(inst, dir, updates) {
  if (!inst.pack || !Array.isArray(inst.pack.files)) return;
  const rel = path.relative(inst.gameDir, dir).split(path.sep).join('/');
  const files = [...inst.pack.files], ids = { ...(inst.pack.ids || {}) };
  let changed = false;
  for (const u of updates) {
    const from = `${rel}/${u.oldFile}`, to = `${rel}/${u.newFile}`;
    const k = files.indexOf(from);
    if (k < 0 || from === to) continue;
    files[k] = to;
    if (ids[from]) { ids[to] = ids[from]; delete ids[from]; }
    changed = true;
  }
  if (changed) instances.update(inst.id, { pack: { ...instances.get(inst.id).pack, files, ids } });
}

/** Modpack + mod / resource pack / shader updates of one instance (sequential, gentle on the API). */
async function checkInstanceUpdates(inst) {
  const channel = store.get().settings.updateChannel || 'all';
  const out = { pack: null, mods: 0, resourcepacks: 0, shaders: 0, checked: Date.now() };
  if (inst.modpack === 'pack' && inst.pack && inst.pack.projectId) {
    try { out.pack = await modpacks.checkUpdate(inst, channel); } catch { /* offline */ }
    await pause(400);
  }
  for (const [kind, key] of [['mod', 'mods'], ['resourcepack', 'resourcepacks'], ['shader', 'shaders']]) {
    if (kind === 'mod' && (!inst.loader || inst.loader === 'vanilla')) continue;
    const dir = path.join(inst.gameDir, modrinth.KINDS[kind].folder);
    if (!fs.existsSync(dir)) continue;
    try {
      out[key] = withoutPackFiles(inst, kind, await modrinth.checkUpdates(dir, kind, inst.mcVersion, inst.loader, channel)).length;
    } catch { /* offline */ }
    await pause(400);
  }
  return out;
}

function recheckInstance(id) {
  const inst = instances.get(id);
  if (!inst || store.get().settings.notifyContentUpdates === false) return;
  checkInstanceUpdates(inst).then(r => setInstanceUpdates(id, r)).catch(() => {});
}

function checkAllUpdates() {
  if (updatesRun) return updatesRun;
  updatesRun = (async () => {
    for (const inst of instances.list()) {
      try { contentUpdates[inst.id] = await checkInstanceUpdates(inst); } catch { /* next instance */ }
    }
    const state = updatesState();
    contentUpdates = state;
    send('content:updatesState', state);
    return state;
  })().finally(() => { updatesRun = null; });
  return updatesRun;
}

/** First check 15 s after start, then every 6 h (when notifications are on). */
function scheduleUpdateChecks(delay = 15000) {
  clearTimeout(updatesTimer);
  updatesTimer = setTimeout(async function tick() {
    if (store.get().settings.notifyContentUpdates !== false) await checkAllUpdates().catch(() => {});
    else { contentUpdates = {}; send('content:updatesState', {}); }
    updatesTimer = setTimeout(tick, UPDATE_CHECK_EVERY);
  }, delay);
}
app.whenReady().then(() => scheduleUpdateChecks());

ipcMain.handle('content:updatesState', () => updatesState());
ipcMain.handle('content:checkAll', () => checkAllUpdates());
ipcMain.handle('content:project', (e, id) => (curseforge.isCf(id) ? curseforge.project(id) : modrinth.project(id)));

ipcMain.handle('content:install', async (e, { instanceId, projectId, kind, world, versionId }) => {
  const inst = instances.get(instanceId);
  if (!inst) throw new Error('Wybierz instancję.');
  const loader = inst.loader && inst.loader !== 'vanilla' ? inst.loader : null;
  if (kind === 'mod' && !loader) throw new Error('Mody wymagają instancji z loaderem (Fabric, Quilt, Forge albo NeoForge).');
  return (curseforge.isCf(projectId) ? curseforge : modrinth).install({
    projectId, kind, gameVersion: inst.mcVersion, loader, targetDir: contentDir(inst, kind, world), versionId,
  }, (s) => send('content:status', { projectId, status: s }));
});

ipcMain.handle('content:installed', (e, { instanceId, kind, world }) => {
  const inst = instances.get(instanceId);
  if (!inst) return [];
  if (kind === 'datapack' && !world) return [];
  return modrinth.listInstalled(contentDir(inst, kind, world), modrinth.KINDS[kind].ext);
});

ipcMain.handle('content:updates', async (e, { instanceId, kind, world, skipPack }) => {
  const inst = instances.get(instanceId);
  const dir = contentDir(inst, kind, world);
  const channel = store.get().settings.updateChannel;
  const ups = await modrinth.checkUpdates(dir, kind, inst.mcVersion, inst.loader, channel);
  // files Modrinth does not know may come from CurseForge (needs an API key)
  if (curseforge.available() && kind !== 'datapack') {
    const known = new Set(Object.keys(await modrinth.identify(dir, modrinth.KINDS[kind].ext).catch(() => ({}))));
    ups.push(...await curseforge.checkUpdates(dir, kind, inst.mcVersion, inst.loader, modrinth.channelTypes(channel), known).catch(() => []));
  }
  return skipPack ? withoutPackFiles(inst, kind, ups) : ups;
});
ipcMain.handle('content:applyUpdates', async (e, { instanceId, kind, world, updates }) => {
  const inst = instances.get(instanceId);
  const dir = contentDir(inst, kind, world);
  const n = await modrinth.applyUpdates(dir, updates, { gameDir: inst.gameDir });
  remapPackFiles(inst, dir, updates);
  recheckInstance(instanceId);
  return n;
});

ipcMain.handle('content:toggle', async (e, { instanceId, kind, world, file }) => {
  const dir = contentDir(instances.get(instanceId), kind, world);
  const target = file.endsWith('.disabled') ? file.slice(0, -9) : file + '.disabled';
  await fsp.rename(path.join(dir, file), path.join(dir, target));
  return target;
});

ipcMain.handle('content:delete', async (e, { instanceId, kind, world, file }) => {
  const dir = contentDir(instances.get(instanceId), kind, world);
  await fsp.rm(path.join(dir, path.basename(file)), { recursive: true, force: true });
  return true;
});

ipcMain.handle('net:check', async () => {
  try { await net.getJson('https://api.modrinth.com/'); return true; } catch { return false; }
});

// ------------------------------------------------------------------ IPC: instance details

ipcMain.handle('instances:worldsInfo', (e, id) => instances.worldsInfo(id));
ipcMain.handle('instances:screenshots', (e, id) => instances.screenshots(id));
ipcMain.handle('instances:deleteWorld', async (e, id, world) => {
  const inst = instances.get(id);
  await fsp.rm(path.join(inst.gameDir, 'saves', path.basename(world)), { recursive: true, force: true });
  return true;
});
ipcMain.handle('instances:backupWorld', async (e, id, world) => {
  const inst = instances.get(id);
  const src = path.join(inst.gameDir, 'saves', path.basename(world));
  const outDir = path.join(inst.gameDir, 'backups');
  await fsp.mkdir(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
  const file = path.join(outDir, `${path.basename(world)}-${stamp}.zip`);
  const zip = new AdmZip();
  zip.addLocalFolder(src, path.basename(world));
  await zip.writeZipPromise(file);
  return file;
});
ipcMain.handle('instances:deleteScreenshot', async (e, id, name) => {
  const inst = instances.get(id);
  await fsp.rm(path.join(inst.gameDir, 'screenshots', path.basename(name)), { force: true });
  return true;
});
ipcMain.handle('instances:size', (e, id) => instances.dirSize(instances.get(id).gameDir));

// custom icon / banner of an instance (stored in <instance>/.nore/), served as data URLs
const MEDIA_TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' };
async function mediaFile(inst, kind) {
  const dir = path.join(inst.gameDir, '.nore');
  for (const ext of Object.keys(MEDIA_TYPES)) {
    const f = path.join(dir, kind + ext);
    if (await net.exists(f)) return f;
  }
  return null;
}
async function mediaData(inst, kind) {
  const f = await mediaFile(inst, kind);
  if (!f) return null;
  return `data:${MEDIA_TYPES[path.extname(f)]};base64,${(await fsp.readFile(f)).toString('base64')}`;
}
ipcMain.handle('instances:media', async () => {
  const out = {};
  for (const inst of instances.list()) {
    const [icon, banner] = await Promise.all([mediaData(inst, 'icon'), mediaData(inst, 'banner')]);
    if (icon || banner) out[inst.id] = { icon, banner };
  }
  return out;
});
ipcMain.handle('instances:setMedia', async (e, id, kind, clear) => {
  const inst = instances.get(id);
  if (!inst || !['icon', 'banner'].includes(kind)) return null;
  const old = await mediaFile(inst, kind);
  if (clear) { if (old) await fsp.rm(old, { force: true }); return null; }
  const r = await dialog.showOpenDialog(win, { title: kind === 'icon' ? 'Ikona instancji' : 'Tło instancji', filters: [{ name: 'Obrazy', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] }], properties: ['openFile'] });
  if (r.canceled || !r.filePaths[0]) return undefined;
  if ((await fsp.stat(r.filePaths[0])).size > 15 * 1024 * 1024) throw new Error('Obrazek jest za duży (maks. 15 MB).');
  if (old) await fsp.rm(old, { force: true });
  await fsp.mkdir(path.join(inst.gameDir, '.nore'), { recursive: true });
  await fsp.copyFile(r.filePaths[0], path.join(inst.gameDir, '.nore', kind + path.extname(r.filePaths[0]).toLowerCase()));
  return mediaData(inst, kind);
});
/** Quick numbers for instance cards: mods, resource packs, shaders, worlds, screenshots. */
ipcMain.handle('instances:stats', async () => {
  const count = async (dir, re) => { try { return (await fsp.readdir(dir)).filter(f => re.test(f)).length; } catch { return 0; } };
  const out = {};
  for (const inst of instances.list()) {
    const d = inst.gameDir;
    out[inst.id] = {
      mods: await count(path.join(d, 'mods'), /\.jar$/i),
      resourcepacks: await count(path.join(d, 'resourcepacks'), /\.zip$|^[^.]+$/i),
      shaders: await count(path.join(d, 'shaderpacks'), /\.zip$/i),
      worlds: (await instances.worlds(inst.id)).length,
      screenshots: await count(path.join(d, 'screenshots'), /\.png$/i),
    };
  }
  return out;
});
ipcMain.handle('instances:duplicate', async (e, id) => {
  const inst = instances.get(id);
  const copy = instances.create({ name: inst.name + ' (kopia)', mcVersion: inst.mcVersion, loader: inst.loader, modpack: inst.modpack, perfPack: inst.perfPack, color: inst.color });
  await fsp.cp(inst.gameDir, copy.gameDir, { recursive: true, force: true });
  instances.update(copy.id, {
    packInstalled: inst.packInstalled, loaderVersion: inst.loaderVersion, memoryMb: inst.memoryMb, jvmArgs: inst.jvmArgs,
    noreClient: inst.noreClient, perfMods: inst.perfMods, pack: inst.pack, iconUrl: inst.iconUrl, bannerUrl: inst.bannerUrl, notes: inst.notes,
  });
  return instances.get(copy.id);
});

// ------------------------------------------------------------------ IPC: downloaded versions

ipcMain.handle('versions:installed', async () => {
  const out = [];
  let dirs = [];
  try { dirs = await fsp.readdir(paths.versions, { withFileTypes: true }); } catch { return []; }
  for (const d of dirs) {
    if (!d.isDirectory()) continue;
    const p = path.join(paths.versions, d.name);
    const used = instances.list().filter(i => i.mcVersion === d.name || d.name.endsWith('-' + i.mcVersion)).map(i => i.name);
    out.push({ id: d.name, size: await instances.dirSize(p), fabric: d.name.startsWith('fabric-loader-'), usedBy: used });
  }
  return out.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
});
ipcMain.handle('versions:delete', async (e, id) => {
  await fsp.rm(path.join(paths.versions, path.basename(id)), { recursive: true, force: true });
  return true;
});
ipcMain.handle('storage:info', async () => ({
  libraries: await instances.dirSize(paths.libraries),
  assets: await instances.dirSize(paths.assets),
  runtime: await instances.dirSize(paths.runtime),
  versions: await instances.dirSize(paths.versions),
  instances: await instances.dirSize(paths.instances),
}));

// ------------------------------------------------------------------ IPC: servers (BETA)

ipcMain.handle('servers:list', () => servers.list());
ipcMain.handle('servers:create', (e, opts) => servers.create(opts));
ipcMain.handle('servers:update', (e, id, patch) => servers.update(id, patch));
ipcMain.handle('servers:remove', (e, id) => servers.remove(id));
ipcMain.handle('servers:start', async (e, id) => {
  try {
    return await servers.start(id, (p) => send('server:progress', { id, ...p }));
  } finally {
    send('server:progress', { id, done: true });
  }
});
ipcMain.handle('servers:stop', (e, id) => servers.stop(id));
ipcMain.handle('servers:command', (e, id, cmd) => servers.command(id, cmd));
ipcMain.handle('servers:logs', (e, id) => servers.logs(id));
ipcMain.handle('servers:folder', (e, id) => shell.openPath(servers.get(id).dir));
ipcMain.handle('servers:restart', (e, id) => servers.restart(id));
ipcMain.handle('servers:stats', (e, id) => servers.stats(id));
ipcMain.handle('servers:properties', (e, id) => servers.readProperties(id));
ipcMain.handle('servers:players', (e, id) => servers.players(id));
ipcMain.handle('servers:playerList', (e, id, which, action, name) => servers.playerList(id, which, action, name));
ipcMain.handle('servers:backup', (e, id) => servers.backup(id, 'manual'));
ipcMain.handle('servers:backups', (e, id) => servers.listBackups(id));
ipcMain.handle('servers:restoreBackup', (e, id, file) => servers.restoreBackup(id, file));
ipcMain.handle('servers:deleteBackup', (e, id, file) => servers.deleteBackup(id, file));
ipcMain.handle('servers:resetWorld', (e, id, seed) => servers.resetWorld(id, seed));
ipcMain.handle('servers:reinstall', async (e, id) => {
  try {
    return await servers.install(servers.raw(id), (p) => send('server:progress', { id, ...p }));
  } finally {
    send('server:progress', { id, done: true });
  }
});
ipcMain.handle('servers:setIcon', async (e, id) => {
  const r = await dialog.showOpenDialog(win, { title: 'Ikona serwera', filters: [{ name: 'Obrazy', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }], properties: ['openFile'] });
  if (r.canceled || !r.filePaths[0]) return false;
  const img = nativeImage.createFromPath(r.filePaths[0]);
  if (img.isEmpty()) throw new Error('Nie udało się wczytać obrazu.');
  fs.writeFileSync(path.join(servers.get(id).dir, 'server-icon.png'), img.resize({ width: 64, height: 64, quality: 'best' }).toPNG());
  return true;
});
ipcMain.handle('servers:icon', (e, id) => {
  const f = path.join(servers.get(id).dir, 'server-icon.png');
  return fs.existsSync(f) ? 'data:image/png;base64,' + fs.readFileSync(f).toString('base64') : null;
});

// server content (plugins / mods / datapacks / modpacks)
ipcMain.handle('servers:contentKinds', (e, id) => serverContent.kindsFor(servers.get(id).type));
ipcMain.handle('servers:contentSearch', (e, id, opts) => serverContent.search(servers.get(id), opts));
/** Installs / updates a modpack on a stopped server; the world is backed up first. */
async function serverModpack(id, run) {
  const srv = servers.get(id);
  if (srv.state !== 'stopped') throw new Error('Zatrzymaj serwer przed instalacją paczki.');
  const progress = (stage) => send('server:progress', { id, stage });
  try {
    if (fs.existsSync(path.join(srv.dir, (srv.props && srv.props['level-name']) || 'world'))) {
      progress('Kopia zapasowa świata');
      await servers.backup(id, 'modpack');
    }
    const r = await run(srv, progress);
    const patch = {};
    if (r.mcVersion) patch.mcVersion = r.mcVersion;
    if (r.type) patch.type = r.type;
    if (r.loaderVersion !== undefined) patch.loaderVersion = r.loaderVersion;
    if (r.pack) patch.pack = r.pack;
    servers.update(id, patch);
    return r;
  } finally {
    send('server:progress', { id, done: true });
  }
}

ipcMain.handle('servers:contentInstall', async (e, id, opts) => {
  if (opts.kind === 'modpack') return serverModpack(id, (srv, p) => serverContent.installModpack(srv, { projectId: opts.projectId, versionId: opts.versionId }, p));
  const srv = servers.get(id);
  const files = await serverContent.install(srv, opts, (stage) => send('server:progress', { id, stage }));
  send('server:progress', { id, done: true });
  return files;
});
ipcMain.handle('servers:modpackVersions', (e, id, projectId) => serverContent.modpackVersions(servers.get(id), projectId || (servers.get(id).pack || {}).projectId));
ipcMain.handle('servers:modpackUpdate', (e, id) => serverContent.modpackUpdate(servers.get(id)));
ipcMain.handle('servers:modpackApply', (e, id, versionId) => {
  const pack = servers.get(id).pack;
  if (!pack || !pack.projectId) throw new Error('Ten serwer nie ma paczki z Modrinth.');
  return serverModpack(id, (srv, p) => serverContent.installModpack(srv, { projectId: pack.projectId, versionId }, p));
});
ipcMain.handle('servers:loaderVersions', (e, type, mcVersion) => servers.loaderVersions(type, mcVersion));

/** Files dropped or picked for a server: .mrpack / server pack .zip install a pack, the rest go to plugins / mods / datapacks. */
async function addServerFiles(id, files) {
  files = files.filter(f => typeof f === 'string' && fs.existsSync(f) && fs.statSync(f).isFile());
  const out = { added: [], pack: null };
  for (const f of files) {
    if (f.toLowerCase().endsWith('.mrpack')) {
      out.pack = await serverModpack(id, (srv, p) => serverContent.installModpack(srv, { file: f }, p));
    } else if (f.toLowerCase().endsWith('.zip') && serverContent.isServerPack(f)) {
      out.pack = await serverModpack(id, (srv, p) => serverContent.installServerPack(srv, f, p).then(r => ({ ...r, name: path.basename(f) })));
    }
  }
  out.added = await serverContent.addFiles(servers.get(id), files.filter(f => !/\.mrpack$/i.test(f)));
  return out;
}
ipcMain.handle('servers:contentList', (e, id) => serverContent.listInstalled(servers.get(id)));
ipcMain.handle('servers:contentToggle', (e, id, kind, file, enabled) => serverContent.setEnabled(servers.get(id), kind, file, enabled));
ipcMain.handle('servers:contentRemove', (e, id, kind, file) => serverContent.remove(servers.get(id), kind, file));
ipcMain.handle('servers:contentAddFiles', async (e, id) => {
  const r = await dialog.showOpenDialog(win, { title: 'Dodaj pluginy, mody, datapacki lub modpack', filters: [{ name: 'Pluginy, mody, paczki', extensions: ['jar', 'zip', 'mrpack'] }], properties: ['openFile', 'multiSelections'] });
  if (r.canceled) return { added: [], pack: null };
  return addServerFiles(id, r.filePaths);
});
ipcMain.handle('servers:contentAddPaths', (e, id, files) => addServerFiles(id, Array.isArray(files) ? files : []));
ipcMain.handle('servers:contentUpdates', (e, id) => serverContent.checkUpdates(servers.get(id)));
ipcMain.handle('servers:contentApplyUpdates', async (e, id, updates) => {
  const n = await serverContent.applyUpdates(servers.get(id), updates, (stage) => send('server:progress', { id, stage }));
  send('server:progress', { id, done: true });
  return n;
});

// network, domain & tunnel
ipcMain.handle('servers:netInfo', async () => ({
  lan: serverNet.lanAddresses(), publicIp: await serverNet.publicIp().catch(() => null),
  platform: process.platform, tunnelSupported: serverTunnel.supported(), playitLinked: !!(store.get().playit || {}).secret,
}));
ipcMain.handle('servers:checkReachable', (e, host, port) => serverNet.checkReachable(host, port));
ipcMain.handle('servers:upnp', async (e, id, open) => {
  const srv = servers.get(id);
  servers.update(id, { upnp: !!open });
  return open ? serverNet.upnpOpen(srv.port, `Nore ${srv.name}`) : serverNet.upnpClose(srv.port);
});
ipcMain.handle('servers:diagnose', (e, id) => {
  const srv = servers.get(id);
  return serverNet.diagnose({ port: srv.port, running: srv.state === 'running', domain: srv.domain, tunnel: srv.tunnel && srv.tunnel.enabled ? srv.tunnel : null });
});
ipcMain.handle('servers:firewall', (e, id) => serverNet.firewallAllow(servers.get(id).port));
ipcMain.handle('servers:dnsCheck', (e, id) => {
  const srv = servers.get(id);
  if (!srv.domain || !srv.domain.name) throw new Error('Najpierw ustaw domenę.');
  return serverNet.dnsCheck(srv.domain.name, srv.port);
});
ipcMain.handle('servers:applyDomain', (e, id) => servers.applyDomain(servers.raw(id)));

// playit.gg: link the agent once (browser), then a tunnel per server
let playitClaim = null;
ipcMain.handle('servers:tunnelLink', async () => {
  if (playitClaim) return { url: playitClaim.url, pending: true };
  const c = await serverTunnel.claimStart();
  playitClaim = c;
  shell.openExternal(c.url);
  serverTunnel.claimFinish(c.code).then((secret) => {
    store.update(d => { d.playit = { secret: servers.encryptToken(secret), linked: Date.now() }; });
    send('server:tunnel', { linked: true });
  }).catch((err) => send('server:tunnel', { linked: false, error: err.message })).finally(() => { playitClaim = null; });
  return { url: c.url, pending: true };
});
ipcMain.handle('servers:tunnelUnlink', () => {
  store.update(d => { d.playit = null; for (const s of d.servers || []) if (s.tunnel) s.tunnel = { enabled: false }; });
  return true;
});
ipcMain.handle('servers:tunnel', async (e, id, enabled) => {
  const srv = servers.raw(id);
  if (enabled) {
    const secret = servers.decryptToken((store.get().playit || {}).secret);
    if (!secret) throw new Error('Najpierw połącz konto playit.gg.');
    const t = await serverTunnel.ensureTunnel(secret, `nore-${id}`.slice(0, 40));
    servers.update(id, { tunnel: { enabled: true, id: t.id, address: t.address } });
    return { enabled: true, address: t.address, restart: servers.isRunning(id) };
  }
  servers.update(id, { tunnel: { ...(srv.tunnel || {}), enabled: false } });
  return { enabled: false, restart: servers.isRunning(id) };
});
ipcMain.handle('servers:dnsRecords', async (e, id, hostname) => {
  const srv = servers.get(id);
  const ip = await serverNet.publicIp().catch(() => null);
  return serverNet.manualRecords(hostname, ip, srv.port);
});
