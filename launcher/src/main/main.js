'use strict';
const { app, BrowserWindow, ipcMain, shell, dialog, safeStorage, nativeImage } = require('electron');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const paths = require('./paths');
const store = require('./store');
const versions = require('./versions');
const java = require('./java');
const auth = require('./auth');
const launcher = require('./launch');
const modrinth = require('./modrinth');
const instances = require('./instances');
const noreMods = require('./nore-mods');
const net = require('./net');
const servers = require('./servers');
const AdmZip = require('adm-zip');

const FABRIC_API_ID = 'P7dR8mSH';
/** The "Nore Pack": performance + QoL mods installed for modded instances (any Fabric version). */
const NORE_PACK = ['fabric-api', 'sodium', 'lithium', 'ferrite-core', 'entityculling', 'immediatelyfast', 'modmenu', 'zoomify', 'appleskin'];
const ICON = path.join(__dirname, '..', 'renderer', 'assets', 'logo.png');

let win = null;
let game = null; // { child, instanceId, started }
let busy = false;
const msLogins = new Map();

// ------------------------------------------------------------------ secrets

function seal(obj) {
  const json = JSON.stringify(obj);
  if (safeStorage.isEncryptionAvailable()) return { enc: safeStorage.encryptString(json).toString('base64') };
  return { plain: Buffer.from(json).toString('base64') };
}

function unseal(box) {
  if (!box) return {};
  try {
    if (box.enc) return JSON.parse(safeStorage.decryptString(Buffer.from(box.enc, 'base64')));
    if (box.plain) return JSON.parse(Buffer.from(box.plain, 'base64').toString());
  } catch { /* unreadable on another machine */ }
  return {};
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
    frame: false, show: false, backgroundColor: '#0c0a09', title: 'Nore Launcher',
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
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
}

app.whenReady().then(() => {
  store.load();
  servers.setEmitter(send);
  instances.ensureDefault();
  createWindow();
});

app.on('before-quit', () => servers.stopAll());

app.on('window-all-closed', () => {
  if (!game) app.quit();
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
  return store.get().settings;
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
  const clientId = store.get().settings.msClientId;
  const device = await auth.startDeviceCode(clientId);
  const controller = new AbortController();
  msLogins.set(device.device_code, controller);
  return { deviceCode: device.device_code, userCode: device.user_code, uri: device.verification_uri, expiresIn: device.expires_in, interval: device.interval };
});

ipcMain.handle('accounts:msPoll', async (e, deviceCode, userCode, expiresIn, interval) => {
  const clientId = store.get().settings.msClientId;
  const controller = msLogins.get(deviceCode) || new AbortController();
  try {
    const token = await auth.pollDeviceCode(clientId, { device_code: deviceCode, expires_in: expiresIn, interval }, { signal: controller.signal });
    const mc = await auth.minecraftFromMs(token.access_token);
    const acc = { id: 'ms-' + mc.uuid, type: 'microsoft', name: mc.name, uuid: mc.uuid, skin: mc.skin };
    const secret = seal({ accessToken: mc.accessToken, refreshToken: token.refresh_token, expiresAt: mc.expiresAt });
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

ipcMain.handle('accounts:select', (e, id) => store.update(d => { d.selectedAccount = id; }) && true);
ipcMain.handle('accounts:remove', (e, id) => {
  store.update(d => {
    d.accounts = d.accounts.filter(a => a.id !== id);
    if (d.selectedAccount === id) d.selectedAccount = d.accounts[0] ? d.accounts[0].id : null;
  });
  return true;
});

/** Returns a launch-ready account (refreshing Microsoft tokens if needed). */
async function readyAccount() {
  const d = store.get();
  const acc = d.accounts.find(a => a.id === d.selectedAccount);
  if (!acc) throw new Error('Wybierz albo dodaj konto, zanim uruchomisz grę.');
  if (acc.type === 'offline') return { ...acc, accessToken: '0' };
  let secret = unseal(acc.secret);
  if (!secret.accessToken || !secret.expiresAt || secret.expiresAt - Date.now() < 10 * 60 * 1000) {
    send('progress', { stage: 'Odświeżanie sesji Microsoft' });
    const refreshed = await auth.refreshMicrosoft({ ...acc, ...secret }, d.settings.msClientId);
    secret = { accessToken: refreshed.accessToken, refreshToken: refreshed.refreshToken, expiresAt: refreshed.expiresAt };
    store.update(s => {
      const a = s.accounts.find(x => x.id === acc.id);
      if (a) { a.secret = seal(secret); a.name = refreshed.name; a.skin = refreshed.skin; }
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
    await modrinth.install({ projectId: FABRIC_API_ID, kind: 'mod', gameVersion: inst.mcVersion, loader: 'fabric', targetDir: mods });
  }
}

/** Downloads everything an instance needs (game, loader, Java, Nore Client) without launching. */
async function prepareGame(inst, settings, progress) {
  progress({ stage: 'Minecraft ' + inst.mcVersion, step: 'game' });
  const installed = await versions.installVersion(
    { mcVersion: inst.mcVersion, loader: inst.loader, loaderVersion: inst.loaderVersion },
    { progress: (p) => progress({ ...p, step: p.stage && p.stage.startsWith('Instalowanie Fabric') ? 'loader' : 'game' }), concurrency: settings.concurrency });
  if (inst.loader === 'fabric' && !inst.loaderVersion) instances.update(inst.id, { loaderVersion: installed.loaderVersion });
  if (inst.noreClient) {
    progress({ stage: 'Instalowanie Nore Client', step: 'nore' });
    await prepareNore(inst);
  }
  if (inst.perfPack && inst.loader === 'fabric' && !inst.packInstalled) {
    const mods = path.join(inst.gameDir, 'mods');
    let i = 0;
    for (const slug of NORE_PACK) {
      progress({ stage: 'Pakiet Nore', current: slug, done: i++, total: NORE_PACK.length, step: 'nore' });
      try {
        await modrinth.install({ projectId: slug, kind: 'mod', gameVersion: inst.mcVersion, loader: 'fabric', targetDir: mods });
      } catch (e) {
        send('log', { line: `[Launcher] Pakiet Nore: ${slug} niedostępny dla ${inst.mcVersion} (${e.message})`, stream: 'out' });
      }
    }
    instances.update(inst.id, { packInstalled: true });
  }
  let javaBin = settings.javaPath;
  if (!javaBin) {
    const component = (installed.version.javaVersion && installed.version.javaVersion.component) || 'jre-legacy';
    progress({ stage: 'Java (' + component + ')', step: 'java' });
    javaBin = await java.ensureRuntime(component, { progress: (p) => progress({ ...p, step: 'java' }) });
  }
  return { installed, javaBin };
}

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

    progress({ stage: 'Uruchamianie gry' });
    const started = Date.now();
    const child = await launcher.launch({ instance: inst, account, settings, installed, javaBin }, {
      onLog: (line, stream) => {
        send('log', { line, stream });
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
        send('game:state', { running: null, code: killed ? 0 : code });
        if (win) { win.show(); win.focus(); }
      },
    });
    game = { child, instanceId: inst.id, started, visible: false };
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

ipcMain.handle('content:search', (e, opts) => modrinth.search(opts));
ipcMain.handle('content:project', (e, id) => modrinth.project(id));

ipcMain.handle('content:install', async (e, { instanceId, projectId, kind, world }) => {
  const inst = instances.get(instanceId);
  if (!inst) throw new Error('Wybierz instancję.');
  const loader = inst.loader === 'fabric' ? 'fabric' : null;
  if (kind === 'mod' && !loader) throw new Error('Mody wymagają instancji z Fabric.');
  return modrinth.install({
    projectId, kind, gameVersion: inst.mcVersion, loader, targetDir: contentDir(inst, kind, world),
  }, (s) => send('content:status', { projectId, status: s }));
});

ipcMain.handle('content:installed', (e, { instanceId, kind, world }) => {
  const inst = instances.get(instanceId);
  if (!inst) return [];
  if (kind === 'datapack' && !world) return [];
  return modrinth.listInstalled(contentDir(inst, kind, world), modrinth.KINDS[kind].ext);
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
ipcMain.handle('instances:duplicate', async (e, id) => {
  const inst = instances.get(id);
  const copy = instances.create({ name: inst.name + ' (kopia)', mcVersion: inst.mcVersion, loader: inst.loader, modpack: inst.modpack, perfPack: inst.perfPack, color: inst.color });
  await fsp.cp(inst.gameDir, copy.gameDir, { recursive: true, force: true });
  instances.update(copy.id, { packInstalled: inst.packInstalled, loaderVersion: inst.loaderVersion, memoryMb: inst.memoryMb, jvmArgs: inst.jvmArgs });
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
