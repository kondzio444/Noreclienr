'use strict';
/*
 * Content for local servers from Modrinth: plugins (Paper / Purpur / Folia), server mods (Fabric /
 * Forge / NeoForge), datapacks and whole modpacks (.mrpack), plus update checks for installed jars.
 */
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const AdmZip = require('adm-zip');
const net = require('./net');

const API = 'https://api.modrinth.com/v2';

const PLUGIN_LOADERS = { paper: ['paper', 'spigot', 'bukkit', 'purpur'], purpur: ['purpur', 'paper', 'spigot', 'bukkit'], folia: ['folia'] };
const MOD_LOADERS = { fabric: ['fabric'], forge: ['forge'], neoforge: ['neoforge'] };

/** Which kinds of content a server type can use. */
function kindsFor(type) {
  const kinds = [];
  if (PLUGIN_LOADERS[type]) kinds.push('plugin');
  if (MOD_LOADERS[type]) kinds.push('mod');
  kinds.push('datapack');
  if (MOD_LOADERS[type]) kinds.push('modpack');
  return kinds;
}

function loadersFor(srv, kind) {
  if (kind === 'plugin') return PLUGIN_LOADERS[srv.type] || [];
  if (kind === 'mod' || kind === 'modpack') return MOD_LOADERS[srv.type] || [];
  return ['datapack'];
}

function worldName(srv) {
  return (srv.props && srv.props['level-name']) || 'world';
}

function folderFor(srv, kind) {
  if (kind === 'plugin') return path.join(srv.dir, 'plugins');
  if (kind === 'mod') return path.join(srv.dir, 'mods');
  return path.join(srv.dir, worldName(srv), 'datapacks');
}

async function search(srv, { kind, query = '', sort = 'relevance', offset = 0 }) {
  const facets = [];
  if (kind === 'plugin') facets.push(['project_type:plugin'], loadersFor(srv, kind).map(l => `categories:${l}`));
  else if (kind === 'mod') facets.push(['project_type:mod'], loadersFor(srv, kind).map(l => `categories:${l}`), ['server_side:required', 'server_side:optional']);
  else if (kind === 'modpack') facets.push(['project_type:modpack'], loadersFor(srv, kind).map(l => `categories:${l}`), ['server_side:required', 'server_side:optional']);
  else facets.push(['project_type:datapack']);
  if (kind !== 'modpack') facets.push([`versions:${srv.mcVersion}`]);
  const params = new URLSearchParams({ query, index: sort, offset: String(offset), limit: '20', facets: JSON.stringify(facets) });
  return net.getJson(`${API}/search?${params}`);
}

async function bestVersion(projectId, { loaders, gameVersion }) {
  const params = new URLSearchParams();
  if (gameVersion) params.set('game_versions', JSON.stringify([gameVersion]));
  if (loaders && loaders.length) params.set('loaders', JSON.stringify(loaders));
  const list = await net.getJson(`${API}/project/${encodeURIComponent(projectId)}/version?${params}`);
  return list.find(v => v.version_type === 'release') || list[0] || null;
}

function primaryFile(version) {
  return version.files.find(f => f.primary) || version.files[0];
}

/** Installs a plugin / mod / datapack (mods also get their required dependencies). */
async function install(srv, { kind, projectId }, onStatus, seen = new Set()) {
  if (seen.has(projectId)) return [];
  seen.add(projectId);
  const version = await bestVersion(projectId, { loaders: loadersFor(srv, kind), gameVersion: srv.mcVersion });
  if (!version) throw new Error(`Brak wersji zgodnej z ${srv.type} ${srv.mcVersion}`);
  const file = primaryFile(version);
  const dir = folderFor(srv, kind);
  await fsp.mkdir(dir, { recursive: true });
  onStatus && onStatus(`Pobieranie ${file.filename}`);
  await net.download(file.url, path.join(dir, file.filename), { sha1: file.hashes && file.hashes.sha1, size: file.size });
  const out = [file.filename];
  if (kind !== 'datapack') {
    for (const dep of version.dependencies || []) {
      if (dep.dependency_type !== 'required' || !dep.project_id) continue;
      try { out.push(...await install(srv, { kind, projectId: dep.project_id }, onStatus, seen)); } catch (e) { onStatus && onStatus(`Pominięto zależność: ${e.message}`); }
    }
  }
  return out;
}

/** Reads name / version from plugin.yml, paper-plugin.yml, fabric.mod.json or mods.toml. */
function describeJar(file) {
  try {
    const zip = new AdmZip(file);
    const text = (n) => { const e = zip.getEntry(n); return e ? zip.readAsText(e) : null; };
    const yml = text('plugin.yml') || text('paper-plugin.yml');
    if (yml) {
      const get = (k) => { const m = new RegExp(`^${k}:\\s*['"]?([^'"\\r\\n]+)`, 'm').exec(yml); return m ? m[1].trim() : null; };
      return { name: get('name'), version: get('version'), description: get('description') };
    }
    const fmj = text('fabric.mod.json');
    if (fmj) { const j = JSON.parse(fmj); return { name: j.name || j.id, version: j.version, description: j.description }; }
    const toml = text('META-INF/neoforge.mods.toml') || text('META-INF/mods.toml');
    if (toml) {
      const get = (k) => { const m = new RegExp(`^\\s*${k}\\s*=\\s*"([^"]+)"`, 'm').exec(toml); return m ? m[1] : null; };
      return { name: get('displayName') || get('modId'), version: get('version'), description: get('description') };
    }
  } catch { /* not a readable jar */ }
  return {};
}

async function listInstalled(srv) {
  const out = [];
  for (const kind of kindsFor(srv.type).filter(k => k !== 'modpack')) {
    const dir = folderFor(srv, kind);
    let files = [];
    try { files = await fsp.readdir(dir, { withFileTypes: true }); } catch { continue; }
    for (const f of files) {
      const enabled = !f.name.endsWith('.disabled');
      const base = enabled ? f.name : f.name.slice(0, -9);
      const isJar = base.toLowerCase().endsWith('.jar');
      if (kind !== 'datapack' && !isJar) continue;
      if (kind === 'datapack' && !f.isDirectory() && !base.toLowerCase().endsWith('.zip')) continue;
      if (kind === 'datapack' && f.isDirectory() && /^(bukkit|paper)$/i.test(base)) continue; // built into Paper
      const full = path.join(dir, f.name);
      const st = await fsp.stat(full);
      const info = isJar ? describeJar(full) : {};
      out.push({ kind, file: f.name, name: info.name || base.replace(/\.(jar|zip)$/i, ''), version: info.version || '', description: info.description || '', enabled, size: st.size, dir: f.isDirectory() });
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

async function setEnabled(srv, kind, file, enabled) {
  const dir = folderFor(srv, kind);
  const base = file.endsWith('.disabled') ? file.slice(0, -9) : file;
  const target = enabled ? base : base + '.disabled';
  if (target !== file) await fsp.rename(path.join(dir, file), path.join(dir, target));
  return target;
}

async function remove(srv, kind, file) {
  await fsp.rm(path.join(folderFor(srv, kind), file), { recursive: true, force: true });
}

/** Copies files chosen by the user (jar → plugins/mods by server type, zip → datapacks). */
async function addFiles(srv, files) {
  const added = [];
  for (const f of files) {
    const lower = f.toLowerCase();
    let kind;
    if (lower.endsWith('.jar')) kind = PLUGIN_LOADERS[srv.type] ? 'plugin' : MOD_LOADERS[srv.type] ? 'mod' : null;
    else if (lower.endsWith('.zip')) kind = 'datapack';
    if (!kind) continue;
    const dir = folderFor(srv, kind);
    await fsp.mkdir(dir, { recursive: true });
    await fsp.copyFile(f, path.join(dir, path.basename(f)));
    added.push(path.basename(f));
  }
  return added;
}

// ------------------------------------------------------------------ updates

/** Finds newer Modrinth versions for installed plugins / mods (matched by file hash). */
async function checkUpdates(srv) {
  const updates = [];
  for (const kind of ['plugin', 'mod']) {
    if (!kindsFor(srv.type).includes(kind)) continue;
    const dir = folderFor(srv, kind);
    let files = [];
    try { files = (await fsp.readdir(dir)).filter(f => f.endsWith('.jar')); } catch { continue; }
    if (!files.length) continue;
    const hashes = {};
    for (const f of files) hashes[await net.sha1File(path.join(dir, f))] = f;
    const res = await net.fetchWithRetry(`${API}/version_files/update`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hashes: Object.keys(hashes), algorithm: 'sha1', loaders: loadersFor(srv, kind), game_versions: [srv.mcVersion] }),
    });
    if (!res.ok) continue;
    const map = await res.json();
    for (const [hash, version] of Object.entries(map)) {
      const file = primaryFile(version);
      if (!file || file.hashes.sha1 === hash) continue;
      updates.push({ kind, oldFile: hashes[hash], newFile: file.filename, url: file.url, sha1: file.hashes.sha1, size: file.size, version: version.version_number, projectId: version.project_id });
    }
  }
  return updates;
}

async function applyUpdates(srv, updates, onStatus) {
  for (const u of updates) {
    const dir = folderFor(srv, u.kind);
    onStatus && onStatus(`Aktualizacja ${u.newFile}`);
    await net.download(u.url, path.join(dir, u.newFile), { sha1: u.sha1, size: u.size });
    if (u.oldFile !== u.newFile) await fsp.rm(path.join(dir, u.oldFile), { force: true });
  }
  return updates.length;
}

// ------------------------------------------------------------------ modpacks (.mrpack)

/**
 * Installs a Modrinth modpack on the server: server-side files from modrinth.index.json plus
 * overrides / server-overrides. Returns the Minecraft version and loader the pack needs.
 */
async function installModpack(srv, projectId, onStatus) {
  const version = await bestVersion(projectId, { loaders: loadersFor(srv, 'modpack') });
  if (!version) throw new Error('Ta paczka nie ma wersji dla ' + srv.type);
  const file = primaryFile(version);
  const tmp = path.join(srv.dir, '.nore-modpack.mrpack');
  onStatus && onStatus(`Pobieranie paczki ${file.filename}`);
  await net.download(file.url, tmp, { sha1: file.hashes && file.hashes.sha1, size: file.size });
  const zip = new AdmZip(tmp);
  const index = JSON.parse(zip.readAsText('modrinth.index.json'));
  const files = (index.files || []).filter(f => !f.env || f.env.server !== 'unsupported');
  let i = 0;
  for (const f of files) {
    const dest = path.resolve(srv.dir, f.path);
    if (!dest.startsWith(path.resolve(srv.dir) + path.sep)) continue; // never write outside the server
    onStatus && onStatus(`Pliki paczki ${++i}/${files.length}`);
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    await net.download(f.downloads[0], dest, { sha1: f.hashes && f.hashes.sha1, size: f.fileSize });
  }
  for (const prefix of ['overrides/', 'server-overrides/']) {
    for (const e of zip.getEntries()) {
      if (e.isDirectory || !e.entryName.startsWith(prefix)) continue;
      const dest = path.resolve(srv.dir, e.entryName.slice(prefix.length));
      if (!dest.startsWith(path.resolve(srv.dir) + path.sep)) continue;
      await fsp.mkdir(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, e.getData());
    }
  }
  await fsp.rm(tmp, { force: true });
  const deps = index.dependencies || {};
  const type = deps['fabric-loader'] ? 'fabric' : deps.neoforge ? 'neoforge' : deps.forge ? 'forge' : srv.type;
  return { mcVersion: deps.minecraft || srv.mcVersion, type, name: index.name, files: files.length };
}

module.exports = { kindsFor, search, install, listInstalled, setEnabled, remove, addFiles, checkUpdates, applyUpdates, installModpack };
