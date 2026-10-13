'use strict';
/* Local Minecraft servers (BETA): install Vanilla / Fabric / Paper, start, stop, console, properties. */
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const paths = require('./paths');
const store = require('./store');
const net = require('./net');
const versions = require('./versions');
const java = require('./java');

const running = new Map(); // id -> { child, state, players:Set, log:[] }
let emit = () => {};

function setEmitter(fn) { emit = fn; }

function dir(id) { return path.join(paths.root, 'servers', id); }

function list() {
  return (store.get().servers || []).map(s => ({
    ...s, dir: dir(s.id),
    state: running.has(s.id) ? running.get(s.id).state : 'stopped',
    players: running.has(s.id) ? [...running.get(s.id).players] : [],
  }));
}

function get(id) { return list().find(s => s.id === id) || null; }

const DEFAULT_PROPS = {
  motd: 'Serwer Nore', 'max-players': 10, 'online-mode': false, gamemode: 'survival',
  difficulty: 'normal', pvp: true, 'white-list': false, 'view-distance': 10, 'spawn-protection': 0,
  'allow-flight': false, hardcore: false, 'level-seed': '',
};

function create({ name, mcVersion, type = 'vanilla', memoryMb = 2048, port = 25565, eula = false }) {
  const id = (name || 'serwer').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) + '-' + crypto.randomBytes(3).toString('hex');
  const srv = { id, name: name || `Serwer ${mcVersion}`, mcVersion, type, memoryMb, port, eula: !!eula, props: { ...DEFAULT_PROPS }, created: Date.now(), installed: false };
  store.update(d => { (d.servers = d.servers || []).push(srv); });
  fs.mkdirSync(dir(id), { recursive: true });
  return get(id);
}

function update(id, patch) {
  store.update(d => {
    const s = (d.servers || []).find(x => x.id === id);
    if (!s) return;
    if (patch.props) { s.props = { ...s.props, ...patch.props }; delete patch.props; }
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

// ------------------------------------------------------------------ installation

async function vanillaServerUrl(mcVersion) {
  const manifest = await versions.getManifest();
  const entry = manifest.versions.find(v => v.id === mcVersion);
  if (!entry) throw new Error('Nieznana wersja ' + mcVersion);
  const json = await net.getJson(entry.url);
  if (!json.downloads || !json.downloads.server) throw new Error(`Wersja ${mcVersion} nie ma oficjalnego serwera`);
  return { url: json.downloads.server.url, sha1: json.downloads.server.sha1, size: json.downloads.server.size, javaComponent: json.javaVersion && json.javaVersion.component };
}

async function install(srv, progress) {
  const jar = path.join(dir(srv.id), 'server.jar');
  const v = await vanillaServerUrl(srv.mcVersion); // also tells us which Java to use
  progress({ stage: `Pobieranie serwera ${srv.type} ${srv.mcVersion}` });
  if (srv.type === 'paper') {
    const builds = await net.getJson(`https://fill.papermc.io/v3/projects/paper/versions/${encodeURIComponent(srv.mcVersion)}/builds`)
      .catch(() => { throw new Error(`Paper nie wspiera wersji ${srv.mcVersion}`); });
    const build = builds.find(b => b.channel === 'STABLE') || builds[0];
    if (!build) throw new Error(`Brak buildów Paper dla ${srv.mcVersion}`);
    const file = build.downloads['server:default'];
    await fsp.rm(jar, { force: true });
    await net.download(file.url, jar, { size: file.size });
  } else if (srv.type === 'fabric') {
    const loaders = await versions.getFabricLoaders(srv.mcVersion);
    const loader = (loaders.find(l => l.stable) || loaders[0]);
    if (!loader) throw new Error(`Fabric nie wspiera wersji ${srv.mcVersion}`);
    const installers = await net.getJson('https://meta.fabricmc.net/v2/versions/installer');
    const inst = installers.find(i => i.stable) || installers[0];
    await fsp.rm(jar, { force: true });
    await net.download(`https://meta.fabricmc.net/v2/versions/loader/${srv.mcVersion}/${loader.version}/${inst.version}/server/jar`, jar);
  } else {
    await net.download(v.url, jar, { sha1: v.sha1, size: v.size });
  }
  update(srv.id, { installed: true, javaComponent: v.javaComponent || 'jre-legacy' });
  return get(srv.id);
}

function writeProperties(srv) {
  const file = path.join(dir(srv.id), 'server.properties');
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

async function start(id, progress) {
  if (running.has(id)) throw new Error('Serwer już działa.');
  let srv = get(id);
  if (!srv) throw new Error('Nie znaleziono serwera.');
  if (!srv.eula) throw new Error('Musisz zaakceptować EULA Minecraft, aby uruchomić serwer.');
  if (!srv.installed) srv = await install(srv, progress);
  const settings = store.get().settings;
  let bin = settings.javaPath;
  if (!bin) bin = await java.ensureRuntime(srv.javaComponent || 'java-runtime-delta', { progress });
  if (process.platform === 'win32') bin = bin.replace(/javaw\.exe$/i, 'java.exe');
  fs.writeFileSync(path.join(dir(id), 'eula.txt'), '# Zaakceptowano w Nore Launcher (https://aka.ms/MinecraftEULA)\neula=true\n');
  writeProperties(srv);
  progress({ stage: 'Uruchamianie serwera' });

  const child = spawn(bin, [`-Xmx${srv.memoryMb}M`, `-Xms${Math.min(1024, srv.memoryMb)}M`, '-jar', 'server.jar', 'nogui'], { cwd: dir(id), windowsHide: true });
  const rt = { child, state: 'starting', players: new Set(), log: [] };
  running.set(id, rt);
  emit('server:state', { id, state: 'starting' });
  const onLine = (line, stream) => {
    rt.log.push({ line, stream });
    if (rt.log.length > 3000) rt.log.splice(0, 1000);
    emit('server:log', { id, line, stream });
    if (rt.state === 'starting' && /Done \(.*\)! For help/.test(line)) {
      rt.state = 'running';
      emit('server:state', { id, state: 'running' });
    }
    let m = /: (\w{3,16}) joined the game/.exec(line);
    if (m) { rt.players.add(m[1]); emit('server:state', { id, state: rt.state, players: [...rt.players] }); }
    m = /: (\w{3,16}) left the game/.exec(line);
    if (m) { rt.players.delete(m[1]); emit('server:state', { id, state: rt.state, players: [...rt.players] }); }
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
  });
  child.on('error', (e) => {
    onLine('[Launcher] Nie udało się uruchomić Javy: ' + e.message, 'err');
  });
  return true;
}

function command(id, cmd) {
  const rt = running.get(id);
  if (!rt) throw new Error('Serwer nie działa.');
  rt.child.stdin.write(cmd.replace(/^\//, '') + '\n');
  emit('server:log', { id, line: '> ' + cmd, stream: 'cmd' });
}

function stop(id) {
  const rt = running.get(id);
  if (!rt) return false;
  rt.state = 'stopping';
  emit('server:state', { id, state: 'stopping' });
  try { rt.child.stdin.write('stop\n'); } catch { /* already closing */ }
  setTimeout(() => { if (running.get(id) === rt) rt.child.kill(); }, 20000);
  return true;
}

function logs(id) {
  const rt = running.get(id);
  return rt ? rt.log.slice(-1500) : [];
}

function stopAll() {
  for (const id of running.keys()) stop(id);
}

module.exports = { setEmitter, list, get, create, update, remove, install, start, stop, command, logs, stopAll, DEFAULT_PROPS };
