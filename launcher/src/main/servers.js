'use strict';
/*
 * Local Minecraft servers: Vanilla, Paper, Purpur, Folia, Fabric, Forge and NeoForge. Install,
 * start / stop with a live console, auto-restart after crashes, backups, player lists
 * (whitelist / ops / bans), server.properties, resource stats and making the server reachable
 * from the internet (UPnP + domains, see server-net.js).
 */
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { spawn, execFile } = require('child_process');
const AdmZip = require('adm-zip');
const paths = require('./paths');
const store = require('./store');
const net = require('./net');
const versions = require('./versions');
const java = require('./java');
const serverNet = require('./server-net');

const TYPES = ['vanilla', 'paper', 'purpur', 'folia', 'fabric', 'forge', 'neoforge'];
const running = new Map(); // id -> { child, state, players:Set, log:[], started, stopping }
const restarts = new Map(); // id -> [timestamps]
let emit = () => {};

function setEmitter(fn) { emit = fn; }

function dir(id) { return path.join(paths.root, 'servers', id); }

function publicView(s) {
  const rt = running.get(s.id);
  const domain = s.domain ? { ...s.domain, token: undefined, hasToken: !!s.domain.token } : null;
  return {
    ...s, domain, dir: dir(s.id),
    state: rt ? rt.state : 'stopped',
    players: rt ? [...rt.players] : [],
    startedAt: rt ? rt.started : null,
    hasIcon: fs.existsSync(path.join(dir(s.id), 'server-icon.png')),
  };
}

function raw(id) { return (store.get().servers || []).find(x => x.id === id) || null; }

function list() { return (store.get().servers || []).map(publicView); }

function get(id) { const s = raw(id); return s ? publicView(s) : null; }

const DEFAULT_PROPS = {
  motd: 'Serwer Nore', 'max-players': 10, 'online-mode': false, gamemode: 'survival',
  difficulty: 'normal', pvp: true, 'white-list': false, 'view-distance': 10, 'simulation-distance': 10, 'spawn-protection': 0,
  'allow-flight': false, hardcore: false, 'level-seed': '', 'level-name': 'world',
};

function create({ name, mcVersion, type = 'paper', memoryMb = 2048, port = 25565, eula = false }) {
  if (!TYPES.includes(type)) throw new Error('Nieznany silnik ' + type);
  const id = (name || 'serwer').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) + '-' + crypto.randomBytes(3).toString('hex');
  const srv = {
    id, name: name || `Serwer ${mcVersion}`, mcVersion, type, memoryMb, port, eula: !!eula, props: { ...DEFAULT_PROPS },
    created: Date.now(), installed: false, autoRestart: true, backupOnStart: false, backupKeep: 10, upnp: false, domain: null, jvmArgs: '',
  };
  store.update(d => { (d.servers = d.servers || []).push(srv); });
  fs.mkdirSync(dir(id), { recursive: true });
  return get(id);
}

function update(id, patch) {
  store.update(d => {
    const s = (d.servers || []).find(x => x.id === id);
    if (!s) return;
    if (patch.props) { s.props = { ...s.props, ...patch.props }; delete patch.props; }
    if (patch.domain) {
      // keep the stored token when the UI sends the domain settings without it
      const token = patch.domain.token === undefined && s.domain ? s.domain.token : encryptToken(patch.domain.token);
      s.domain = { ...patch.domain, token };
      delete patch.domain;
    }
    if (patch.mcVersion && patch.mcVersion !== s.mcVersion) s.installed = false;
    if (patch.type && patch.type !== s.type) s.installed = false;
    Object.assign(s, patch, { id });
  });
  return get(id);
}

async function remove(id) {
  if (running.has(id)) throw new Error('Najpierw zatrzymaj serwer.');
  store.update(d => { d.servers = (d.servers || []).filter(x => x.id !== id); });
  await fsp.rm(dir(id), { recursive: true, force: true });
}

// ------------------------------------------------------------------ secrets (domain API tokens)

function safe() {
  try { return require('electron').safeStorage; } catch { return null; }
}

function encryptToken(token) {
  if (!token) return null;
  const s = safe();
  if (s && s.isEncryptionAvailable()) return 'enc:' + s.encryptString(token).toString('base64');
  return token;
}

function decryptToken(value) {
  if (!value) return null;
  if (!value.startsWith('enc:')) return value;
  const s = safe();
  return s ? s.decryptString(Buffer.from(value.slice(4), 'base64')) : null;
}

// ------------------------------------------------------------------ installation

async function vanillaInfo(mcVersion) {
  const manifest = await versions.getManifest();
  const entry = manifest.versions.find(v => v.id === mcVersion);
  if (!entry) throw new Error('Nieznana wersja ' + mcVersion);
  const json = await net.getJson(entry.url);
  return {
    server: json.downloads && json.downloads.server,
    javaComponent: (json.javaVersion && json.javaVersion.component) || 'jre-legacy',
  };
}

async function javaFor(srv, progress) {
  const settings = store.get().settings;
  let bin = settings.javaPath;
  if (!bin) bin = await java.ensureRuntime(srv.javaComponent || 'java-runtime-delta', { progress });
  if (process.platform === 'win32') bin = bin.replace(/javaw\.exe$/i, 'java.exe');
  return bin;
}

function runInstaller(bin, installer, cwd, progress) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, ['-jar', installer, '--installServer'], { cwd, windowsHide: true });
    let last = '';
    const onData = (d) => {
      last = d.toString().trim().split(/\r?\n/).pop() || last;
      progress({ stage: 'Instalator: ' + last.slice(0, 90) });
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('error', reject);
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error('Instalator zakończył się błędem: ' + last))));
  });
}

function argsFileFor(base, loaderPath) {
  const f = path.join(base, 'libraries', loaderPath, process.platform === 'win32' ? 'win_args.txt' : 'unix_args.txt');
  return fs.existsSync(f) ? path.relative(base, f) : null;
}

async function install(srv, progress) {
  const base = dir(srv.id);
  const jar = path.join(base, 'server.jar');
  const info = await vanillaInfo(srv.mcVersion);
  update(srv.id, { javaComponent: info.javaComponent });
  srv = raw(srv.id);
  progress({ stage: `Pobieranie serwera ${srv.type} ${srv.mcVersion}` });
  let launch = { mode: 'jar', jar: 'server.jar' };

  if (srv.type === 'paper' || srv.type === 'folia') {
    const builds = await net.getJson(`https://fill.papermc.io/v3/projects/${srv.type}/versions/${encodeURIComponent(srv.mcVersion)}/builds`)
      .catch(() => { throw new Error(`${srv.type === 'paper' ? 'Paper' : 'Folia'} nie wspiera wersji ${srv.mcVersion}`); });
    const build = builds.find(b => b.channel === 'STABLE') || builds[0];
    if (!build) throw new Error(`Brak buildów dla ${srv.mcVersion}`);
    const file = build.downloads['server:default'];
    await fsp.rm(jar, { force: true });
    await net.download(file.url, jar, { size: file.size });
  } else if (srv.type === 'purpur') {
    await net.getJson(`https://api.purpurmc.org/v2/purpur/${encodeURIComponent(srv.mcVersion)}`)
      .catch(() => { throw new Error(`Purpur nie wspiera wersji ${srv.mcVersion}`); });
    await fsp.rm(jar, { force: true });
    await net.download(`https://api.purpurmc.org/v2/purpur/${encodeURIComponent(srv.mcVersion)}/latest/download`, jar);
  } else if (srv.type === 'fabric') {
    const loaders = await versions.getFabricLoaders(srv.mcVersion);
    const loader = (loaders.find(l => l.stable) || loaders[0]);
    if (!loader) throw new Error(`Fabric nie wspiera wersji ${srv.mcVersion}`);
    const installers = await net.getJson('https://meta.fabricmc.net/v2/versions/installer');
    const inst = installers.find(i => i.stable) || installers[0];
    await fsp.rm(jar, { force: true });
    await net.download(`https://meta.fabricmc.net/v2/versions/loader/${srv.mcVersion}/${loader.version}/${inst.version}/server/jar`, jar);
  } else if (srv.type === 'neoforge' || srv.type === 'forge') {
    let installerUrl, loaderPath, fullVersion;
    if (srv.type === 'neoforge') {
      const [, minor, patch = '0'] = srv.mcVersion.split('.');
      const prefix = `${minor}.${patch}.`;
      const all = (await net.getJson('https://maven.neoforged.net/api/maven/versions/releases/net/neoforged/neoforge')).versions || [];
      const matching = all.filter(v => v.startsWith(prefix));
      fullVersion = matching.filter(v => !/beta|alpha/i.test(v)).pop() || matching.pop();
      if (!fullVersion) throw new Error(`NeoForge nie wspiera wersji ${srv.mcVersion}`);
      installerUrl = `https://maven.neoforged.net/releases/net/neoforged/neoforge/${fullVersion}/neoforge-${fullVersion}-installer.jar`;
      loaderPath = `net/neoforged/neoforge/${fullVersion}`;
    } else {
      const promos = (await net.getJson('https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json')).promos || {};
      const forge = promos[`${srv.mcVersion}-recommended`] || promos[`${srv.mcVersion}-latest`];
      if (!forge) throw new Error(`Forge nie wspiera wersji ${srv.mcVersion}`);
      fullVersion = `${srv.mcVersion}-${forge}`;
      installerUrl = `https://maven.minecraftforge.net/net/minecraftforge/forge/${fullVersion}/forge-${fullVersion}-installer.jar`;
      loaderPath = `net/minecraftforge/forge/${fullVersion}`;
    }
    const installer = path.join(base, 'installer.jar');
    await net.download(installerUrl, installer);
    const bin = await javaFor(srv, progress);
    progress({ stage: `Instalowanie ${srv.type === 'forge' ? 'Forge' : 'NeoForge'} ${fullVersion}` });
    await runInstaller(bin, 'installer.jar', base, progress);
    await fsp.rm(installer, { force: true });
    await fsp.rm(installer + '.log', { force: true });
    const argsFile = argsFileFor(base, loaderPath);
    if (argsFile) launch = { mode: 'args', argsFile };
    else {
      const candidate = (await fsp.readdir(base)).find(f => /^(neo)?forge-.*\.jar$/.test(f) && !f.includes('installer'));
      if (!candidate) throw new Error('Nie znaleziono pliku startowego Forge');
      launch = { mode: 'jar', jar: candidate };
    }
  } else {
    if (!info.server) throw new Error(`Wersja ${srv.mcVersion} nie ma oficjalnego serwera`);
    await net.download(info.server.url, jar, { sha1: info.server.sha1, size: info.server.size });
  }
  update(srv.id, { installed: true, launch });
  return get(srv.id);
}

// ------------------------------------------------------------------ server.properties

function propertiesFile(id) { return path.join(dir(id), 'server.properties'); }

function readProperties(id) {
  const out = {};
  try {
    for (const l of fs.readFileSync(propertiesFile(id), 'utf8').split(/\r?\n/)) {
      const m = /^([^#=\s][^=]*)=(.*)$/.exec(l);
      if (m) out[m[1].trim()] = m[2];
    }
  } catch { /* not generated yet */ }
  const s = raw(id);
  return { ...out, ...(s ? Object.fromEntries(Object.entries(s.props).map(([k, v]) => [k, String(v)])) : {}) };
}

function writeProperties(srv) {
  const file = propertiesFile(srv.id);
  let lines = [];
  try { lines = fs.readFileSync(file, 'utf8').split(/\r?\n/); } catch { /* new server */ }
  const props = { ...srv.props, 'server-port': srv.port, 'query.port': srv.port };
  const seen = new Set();
  lines = lines.map(l => {
    const m = /^([^#=]+)=(.*)$/.exec(l);
    if (!m || !(m[1] in props)) return l;
    seen.add(m[1]);
    return `${m[1]}=${props[m[1]]}`;
  });
  for (const [k, val] of Object.entries(props)) if (!seen.has(k)) lines.push(`${k}=${val}`);
  fs.writeFileSync(file, lines.filter((l, i) => l !== '' || i < lines.length - 1).join('\n') + '\n');
}

// ------------------------------------------------------------------ process control

function log(id, line, stream = 'cmd') {
  const rt = running.get(id);
  if (rt) {
    rt.log.push({ line, stream });
    if (rt.log.length > 3000) rt.log.splice(0, 1000);
  }
  emit('server:log', { id, line, stream });
}

/** Port forwarding and DNS update before the server starts (failures only warn). */
async function prepareNetwork(srv) {
  if (srv.upnp) {
    try {
      const r = await serverNet.upnpOpen(srv.port, `Nore ${srv.name}`);
      log(srv.id, `[Launcher] UPnP: otwarto port ${srv.port} na routerze ${r.router}${r.external ? ` (publiczne IP ${r.external})` : ''}`);
    } catch (e) { log(srv.id, `[Launcher] UPnP: ${e.message}`, 'err'); }
  }
  const d = srv.domain;
  if (d && d.auto && d.provider && d.provider !== 'manual') {
    try {
      const ip = await serverNet.publicIp();
      const token = decryptToken(d.token);
      const host = d.provider === 'duckdns'
        ? await serverNet.duckdnsUpdate(d.name, token, ip)
        : await serverNet.cloudflareUpdate({ token, hostname: d.name, ip, port: srv.port });
      log(srv.id, `[Launcher] Domena ${host} → ${ip}`);
    } catch (e) { log(srv.id, `[Launcher] Domena: ${e.message}`, 'err'); }
  }
}

async function start(id, progress = () => {}) {
  if (running.has(id)) throw new Error('Serwer już działa.');
  let srv = raw(id);
  if (!srv) throw new Error('Nie znaleziono serwera.');
  if (!srv.eula) throw new Error('Musisz zaakceptować EULA Minecraft, aby uruchomić serwer.');
  if (!srv.installed) { await install(srv, progress); srv = raw(id); }
  const bin = await javaFor(srv, progress);
  fs.writeFileSync(path.join(dir(id), 'eula.txt'), '# Zaakceptowano w Nore Launcher (https://aka.ms/MinecraftEULA)\neula=true\n');
  writeProperties(srv);
  if (srv.backupOnStart && fs.existsSync(path.join(dir(id), worldName(srv)))) {
    progress({ stage: 'Kopia zapasowa świata' });
    await backup(id, 'auto');
  }

  const launch = srv.launch || { mode: 'jar', jar: 'server.jar' };
  const mem = [`-Xmx${srv.memoryMb}M`, `-Xms${Math.min(1024, srv.memoryMb)}M`];
  const extra = (srv.jvmArgs || '').trim() ? srv.jvmArgs.trim().split(/\s+/) : [];
  const args = launch.mode === 'args' ? [...mem, ...extra, `@${launch.argsFile}`, 'nogui'] : [...mem, ...extra, '-jar', launch.jar, 'nogui'];
  progress({ stage: 'Uruchamianie serwera' });

  const child = spawn(bin, args, { cwd: dir(id), windowsHide: true });
  const rt = { child, state: 'starting', players: new Set(), log: [], started: Date.now(), stopping: false };
  running.set(id, rt);
  emit('server:state', { id, state: 'starting' });
  prepareNetwork(srv);
  const onLine = (line, stream) => {
    line = line.replace(/\x1b\[[0-9;]*m/g, ''); // NeoForge / Forge colour codes
    log(id, line, stream);
    if (rt.state === 'starting' && /Done \(.*\)! For help/.test(line)) {
      rt.state = 'running';
      emit('server:state', { id, state: 'running' });
    }
    let m = /: (\w{3,16}) joined the game/.exec(line);
    if (m) { rt.players.add(m[1]); emit('server:state', { id, state: rt.state, players: [...rt.players] }); }
    m = /: (\w{3,16}) left the game/.exec(line);
    if (m) { rt.players.delete(m[1]); emit('server:state', { id, state: rt.state, players: [...rt.players] }); }
    if (rt.waitSave && /Saved the game|Saved the world/i.test(line)) { rt.waitSave(); rt.waitSave = null; }
  };
  for (const [stream, name] of [[child.stdout, 'out'], [child.stderr, 'err']]) {
    let buf = '';
    stream.on('data', (d) => {
      buf += d.toString();
      let i;
      while ((i = buf.indexOf('\n')) >= 0) { onLine(buf.slice(0, i).replace(/\r$/, ''), name); buf = buf.slice(i + 1); }
    });
  }
  child.on('exit', (code) => {
    running.delete(id);
    emit('server:state', { id, state: 'stopped', code });
    const s = raw(id);
    if (s && s.upnp) serverNet.upnpClose(s.port).catch(() => {});
    // auto-restart after a crash (max 3 times in 10 minutes)
    if (!rt.stopping && code !== 0 && s && s.autoRestart) {
      const now = Date.now();
      const recent = (restarts.get(id) || []).filter(t => now - t < 600000);
      if (recent.length < 3) {
        recent.push(now);
        restarts.set(id, recent);
        emit('server:log', { id, line: `[Launcher] Serwer padł (kod ${code}) – restart za 5 s (${recent.length}/3)`, stream: 'err' });
        setTimeout(() => { if (!running.has(id)) start(id).catch(e => emit('server:log', { id, line: '[Launcher] ' + e.message, stream: 'err' })); }, 5000);
      } else {
        emit('server:log', { id, line: '[Launcher] Serwer padł 3 razy w 10 minut – automatyczny restart wstrzymany', stream: 'err' });
      }
    }
  });
  child.on('error', (e) => onLine('[Launcher] Nie udało się uruchomić Javy: ' + e.message, 'err'));
  return true;
}

function command(id, cmd) {
  const rt = running.get(id);
  if (!rt) throw new Error('Serwer nie działa.');
  rt.child.stdin.write(cmd.replace(/^\//, '') + '\n');
  log(id, '> ' + cmd);
}

function stop(id) {
  const rt = running.get(id);
  if (!rt) return false;
  rt.state = 'stopping';
  rt.stopping = true;
  emit('server:state', { id, state: 'stopping' });
  try { rt.child.stdin.write('stop\n'); } catch { /* already closing */ }
  setTimeout(() => { if (running.get(id) === rt) rt.child.kill(); }, 30000);
  return true;
}

async function restart(id) {
  if (!running.has(id)) return start(id);
  const rt = running.get(id);
  stop(id);
  await new Promise((resolve) => rt.child.once('exit', resolve));
  return start(id);
}

function logs(id) {
  const rt = running.get(id);
  return rt ? rt.log.slice(-1500) : [];
}

function stopAll() {
  for (const id of running.keys()) stop(id);
}

/** RAM used by the server process (MB) and uptime. */
function stats(id) {
  const rt = running.get(id);
  if (!rt) return Promise.resolve(null);
  const pid = rt.child.pid;
  const uptime = Date.now() - rt.started;
  return new Promise((resolve) => {
    const done = (kb) => resolve({ memMb: kb ? Math.round(kb / 1024) : null, uptime, players: rt.players.size });
    if (process.platform === 'linux') {
      fs.readFile(`/proc/${pid}/status`, 'utf8', (e, t) => done(e ? null : parseInt((/VmRSS:\s+(\d+)/.exec(t) || [])[1], 10)));
    } else if (process.platform === 'win32') {
      execFile('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], { windowsHide: true }, (e, out) => {
        const m = /"([\d\s., ]+) K"/.exec(out || '');
        done(m ? parseInt(m[1].replace(/[^\d]/g, ''), 10) : null);
      });
    } else {
      execFile('ps', ['-o', 'rss=', '-p', String(pid)], (e, out) => done(e ? null : parseInt(out, 10)));
    }
  });
}

// ------------------------------------------------------------------ players: whitelist / ops / bans

const LISTS = { whitelist: 'whitelist.json', ops: 'ops.json', bans: 'banned-players.json' };

function readList(id, which) {
  try { return JSON.parse(fs.readFileSync(path.join(dir(id), LISTS[which]), 'utf8')); } catch { return []; }
}

function offlineUuid(name) {
  const h = crypto.createHash('md5').update('OfflinePlayer:' + name).digest();
  h[6] = (h[6] & 0x0f) | 0x30;
  h[8] = (h[8] & 0x3f) | 0x80;
  const x = h.toString('hex');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}

async function uuidFor(srv, name) {
  if (!srv.props['online-mode']) return offlineUuid(name);
  const j = await net.getJson(`https://api.mojang.com/users/profiles/minecraft/${encodeURIComponent(name)}`)
    .catch(() => { throw new Error(`Nie ma konta premium o nazwie ${name}`); });
  return j.id.replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5');
}

/** Adds or removes a player from a list: live commands while running, JSON files otherwise. */
async function playerList(id, which, action, name) {
  if (!/^\w{3,16}$/.test(name)) throw new Error('Nieprawidłowa nazwa gracza');
  const srv = raw(id);
  if (running.has(id)) {
    const cmd = {
      whitelist: action === 'add' ? `whitelist add ${name}` : `whitelist remove ${name}`,
      ops: action === 'add' ? `op ${name}` : `deop ${name}`,
      bans: action === 'add' ? `ban ${name}` : `pardon ${name}`,
    }[which];
    command(id, cmd);
    return true;
  }
  let listData = readList(id, which).filter(e => e.name.toLowerCase() !== name.toLowerCase());
  if (action === 'add') {
    const entry = { uuid: await uuidFor(srv, name), name };
    if (which === 'ops') Object.assign(entry, { level: 4, bypassesPlayerLimit: false });
    if (which === 'bans') Object.assign(entry, { created: new Date().toISOString().replace('T', ' ').slice(0, 19) + ' +0000', source: 'Nore Launcher', expires: 'forever', reason: 'Zbanowany' });
    listData.push(entry);
  }
  fs.writeFileSync(path.join(dir(id), LISTS[which]), JSON.stringify(listData, null, 2));
  return true;
}

function players(id) {
  return { whitelist: readList(id, 'whitelist'), ops: readList(id, 'ops'), bans: readList(id, 'bans'), online: running.has(id) ? [...running.get(id).players] : [] };
}

// ------------------------------------------------------------------ backups

function worldName(srv) { return (srv.props && srv.props['level-name']) || 'world'; }

function backupDir(id) { return path.join(dir(id), 'backups'); }

async function backup(id, label = 'manual') {
  const srv = raw(id);
  const base = dir(id);
  const world = worldName(srv);
  const folders = [world, `${world}_nether`, `${world}_the_end`].filter(f => fs.existsSync(path.join(base, f)));
  if (!folders.length) throw new Error('Świat jeszcze nie istnieje – uruchom serwer choć raz.');
  const rt = running.get(id);
  if (rt) {
    command(id, 'save-off');
    await new Promise((resolve) => { rt.waitSave = resolve; command(id, 'save-all flush'); setTimeout(resolve, 8000); });
  }
  try {
    await fsp.mkdir(backupDir(id), { recursive: true });
    const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
    const file = path.join(backupDir(id), `${label}-${stamp}.zip`);
    const zip = new AdmZip();
    for (const f of folders) zip.addLocalFolder(path.join(base, f), f, (name) => !/session\.lock$/.test(name));
    await new Promise((resolve, reject) => zip.writeZip(file, (e) => (e ? reject(e) : resolve())));
    // keep only the newest N backups
    const all = await listBackups(id);
    for (const old of all.slice(srv.backupKeep || 10)) await fsp.rm(path.join(backupDir(id), old.file), { force: true });
    return path.basename(file);
  } finally {
    if (rt && running.has(id)) command(id, 'save-on');
  }
}

async function listBackups(id) {
  let files = [];
  try { files = (await fsp.readdir(backupDir(id))).filter(f => f.endsWith('.zip')); } catch { return []; }
  const out = [];
  for (const f of files) {
    const st = await fsp.stat(path.join(backupDir(id), f));
    out.push({ file: f, size: st.size, created: st.mtimeMs, auto: f.startsWith('auto-') });
  }
  return out.sort((a, b) => b.created - a.created);
}

async function restoreBackup(id, file) {
  if (running.has(id)) throw new Error('Zatrzymaj serwer przed przywróceniem kopii.');
  const srv = raw(id);
  const base = dir(id);
  const zip = new AdmZip(path.join(backupDir(id), path.basename(file)));
  const world = worldName(srv);
  for (const f of [world, `${world}_nether`, `${world}_the_end`]) await fsp.rm(path.join(base, f), { recursive: true, force: true });
  for (const e of zip.getEntries()) {
    const dest = path.resolve(base, e.entryName);
    if (!dest.startsWith(path.resolve(base) + path.sep)) throw new Error('Nieprawidłowa kopia zapasowa');
  }
  zip.extractAllTo(base, true);
  return true;
}

async function deleteBackup(id, file) {
  await fsp.rm(path.join(backupDir(id), path.basename(file)), { force: true });
}

/** Removes the world so the next start generates a new one (optionally with a new seed). */
async function resetWorld(id, seed) {
  if (running.has(id)) throw new Error('Zatrzymaj serwer.');
  const srv = raw(id);
  const world = worldName(srv);
  for (const f of [world, `${world}_nether`, `${world}_the_end`]) await fsp.rm(path.join(dir(id), f), { recursive: true, force: true });
  if (seed !== undefined) update(id, { props: { 'level-seed': seed } });
}

module.exports = {
  TYPES, DEFAULT_PROPS, setEmitter, list, get, create, update, remove, install, start, stop, restart, command, logs, stopAll, stats,
  readProperties, players, playerList, backup, listBackups, restoreBackup, deleteBackup, resetWorld, decryptToken, raw,
};
