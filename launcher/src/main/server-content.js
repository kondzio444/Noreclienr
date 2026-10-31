'use strict';
/*
 * Content for local servers from Modrinth: plugins (Paper / Purpur / Folia), server mods (Fabric /
 * Quilt / Forge / NeoForge), datapacks and whole modpacks (.mrpack from Modrinth or a file, server
 * pack .zip), safe modpack updates, client-only mod detection and update checks for installed jars.
 */
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const AdmZip = require('adm-zip');
const net = require('./net');
const store = require('./store');

const API = 'https://api.modrinth.com/v2';

const PLUGIN_LOADERS = { paper: ['paper', 'spigot', 'bukkit', 'purpur'], purpur: ['purpur', 'paper', 'spigot', 'bukkit'], folia: ['folia'] };
const MOD_LOADERS = { fabric: ['fabric'], quilt: ['quilt', 'fabric'], forge: ['forge'], neoforge: ['neoforge'] };

/** Version types allowed by Settings → update channel ('all' also takes alpha / beta). */
function versionTypes() {
  const ch = (store.get().settings || {}).updateChannel || 'all';
  return ch === 'release' ? ['release'] : ch === 'beta' ? ['release', 'beta'] : ['release', 'beta', 'alpha'];
}

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
    if (fmj) { const j = JSON.parse(fmj); return { name: j.name || j.id, version: j.version, description: j.description, clientOnly: j.environment === 'client' }; }
    const qmj = text('quilt.mod.json');
    if (qmj) {
      const j = JSON.parse(qmj);
      const q = j.quilt_loader || {};
      return { name: (q.metadata && q.metadata.name) || q.id, version: q.version, description: q.metadata && q.metadata.description, clientOnly: (j.minecraft && j.minecraft.environment) === 'client' };
    }
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
      out.push({ kind, file: f.name, name: info.name || base.replace(/\.(jar|zip)$/i, ''), version: info.version || '', description: info.description || '', enabled, size: st.size, dir: f.isDirectory(), clientOnly: !!info.clientOnly });
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** Disables mods that only work on the client (they crash a dedicated server); returns their names. */
async function disableClientOnly(srv) {
  if (!MOD_LOADERS[srv.type]) return [];
  const dir = folderFor(srv, 'mod');
  let files = [];
  try { files = (await fsp.readdir(dir)).filter(f => f.toLowerCase().endsWith('.jar')); } catch { return []; }
  const off = [];
  for (const f of files) {
    if (!describeJar(path.join(dir, f)).clientOnly) continue;
    await fsp.rename(path.join(dir, f), path.join(dir, f + '.disabled'));
    off.push(f);
  }
  return off;
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
    else if (lower.endsWith('.zip')) kind = isServerPack(f) ? null : 'datapack';
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
      body: JSON.stringify({ hashes: Object.keys(hashes), algorithm: 'sha1', loaders: loadersFor(srv, kind), game_versions: [srv.mcVersion], version_types: versionTypes() }),
    });
    if (!res.ok) continue;
    const map = await res.json();
    for (const [hash, version] of Object.entries(map)) {
      const file = primaryFile(version);
      if (!file || file.hashes.sha1 === hash) continue;
      updates.push({ kind, oldFile: hashes[hash], newFile: file.filename, url: file.url, sha1: file.hashes.sha1, size: file.size, version: version.version_number, type: version.version_type, projectId: version.project_id });
    }
  }
  return updates;
}

async function applyUpdates(srv, updates, onStatus) {
  for (const u of updates) {
    const dir = folderFor(srv, u.kind);
    onStatus && onStatus(`Aktualizacja ${u.newFile}`);
    await net.download(u.url, path.join(dir, u.newFile), { sha1: u.sha1, size: u.size });
    if (u.oldFile !== u.newFile) await moveToBackup(srv, path.join(dir, u.oldFile), 'aktualizacja');
  }
  return updates.length;
}

/** Old files go to .nore-backup/<label-date>/ instead of being deleted (keeps the newest 5). */
async function moveToBackup(srv, file, label) {
  const rel = path.relative(srv.dir, file);
  if (rel.startsWith('..') || !fs.existsSync(file)) return;
  const root = path.join(srv.dir, '.nore-backup');
  const stamp = `${label}-${new Date().toISOString().slice(0, 13).replace(/[:T]/g, '-')}`;
  const dest = path.join(root, stamp, rel);
  await fsp.mkdir(path.dirname(dest), { recursive: true });
  await fsp.rename(file, dest).catch(async () => { await fsp.cp(file, dest, { recursive: true }); await fsp.rm(file, { recursive: true, force: true }); });
  const all = (await fsp.readdir(root)).sort();
  for (const old of all.slice(0, Math.max(0, all.length - 5))) await fsp.rm(path.join(root, old), { recursive: true, force: true });
}

// ------------------------------------------------------------------ modpacks (.mrpack / server pack .zip)

function sha1(buf) { return require('crypto').createHash('sha1').update(buf).digest('hex'); }

function inside(base, rel) {
  const dest = path.resolve(base, rel);
  return dest.startsWith(path.resolve(base) + path.sep) ? dest : null; // never write outside the server
}

/** Versions of a modpack usable on this server's loader: [{ id, number, type, date, mcVersion }]. */
async function modpackVersions(srv, projectId) {
  const params = new URLSearchParams({ loaders: JSON.stringify(MOD_LOADERS[srv.type] || ['fabric', 'quilt', 'forge', 'neoforge']) });
  const list = await net.getJson(`${API}/project/${encodeURIComponent(projectId)}/version?${params}`);
  return list.filter(v => v.files.some(f => f.filename.endsWith('.mrpack'))).map(v => ({
    id: v.id, number: v.version_number, name: v.name, type: v.version_type, date: v.date_published,
    mcVersion: (v.game_versions || [])[0], gameVersions: v.game_versions || [], loaders: v.loaders, changelog: (v.changelog || '').slice(0, 3000),
  }));
}

/** Newest pack version allowed by the update channel, or null when the server is up to date. */
async function modpackUpdate(srv) {
  if (!srv.pack || !srv.pack.projectId) return null;
  const types = versionTypes();
  // packs publish parallel builds per Minecraft version – an update keeps the server's version
  const list = (await modpackVersions(srv, srv.pack.projectId)).filter(v => types.includes(v.type) && v.gameVersions.includes(srv.mcVersion));
  const newest = list.sort((a, b) => new Date(b.date) - new Date(a.date))[0];
  if (!newest || newest.id === srv.pack.versionId) return null;
  const current = list.find(v => v.id === srv.pack.versionId);
  if (current && new Date(current.date) >= new Date(newest.date)) return null;
  return { ...newest, mcChanged: newest.mcVersion && newest.mcVersion !== srv.mcVersion };
}

function loaderOf(deps, fallback) {
  return deps['fabric-loader'] ? 'fabric' : deps['quilt-loader'] ? 'quilt' : deps.neoforge ? 'neoforge' : deps.forge ? 'forge' : fallback;
}

/** Overrides land unless the server owner changed that file since the pack wrote it. */
function overrideAction(rel, existingHash, oldHash, firstInstall) {
  if (/^(world|world_nether|world_the_end)\//.test(rel)) return 'skip';
  if (existingHash == null || firstInstall) return 'write';
  if (/^(mods|plugins)\//.test(rel)) return 'write';
  return oldHash && existingHash === oldHash ? 'write' : 'keep';
}

/**
 * Installs or updates a Modrinth modpack on the server. source: { projectId, versionId } or
 * { file } (local .mrpack). Files of the previous pack version that the new one dropped are moved
 * to .nore-backup, worlds are never touched and configs the owner edited are kept.
 */
async function installModpack(srv, source, onStatus = () => {}) {
  let file = source.file, version = null, tmp = null;
  if (!file) {
    if (source.versionId) version = await net.getJson(`${API}/version/${encodeURIComponent(source.versionId)}`);
    else {
      const list = await modpackVersions(srv, source.projectId);
      const pick = list.find(v => v.type === 'release') || list[0];
      if (pick) version = await net.getJson(`${API}/version/${encodeURIComponent(pick.id)}`);
    }
    if (!version) throw new Error('Ta paczka nie ma wersji dla ' + srv.type);
    const f = version.files.find(x => x.primary && x.filename.endsWith('.mrpack')) || version.files.find(x => x.filename.endsWith('.mrpack'));
    if (!f) throw new Error('Ta wersja nie zawiera pliku .mrpack');
    tmp = file = path.join(srv.dir, '.nore-modpack.mrpack');
    onStatus(`Pobieranie paczki ${f.filename}`);
    await net.download(f.url, tmp, { sha1: f.hashes && f.hashes.sha1, size: f.size });
  }
  try {
    const zip = new AdmZip(file);
    const entry = zip.getEntry('modrinth.index.json');
    if (!entry) throw new Error('To nie jest paczka Modrinth (.mrpack)');
    const index = JSON.parse(entry.getData().toString('utf8'));
    const deps = index.dependencies || {};
    const old = srv.pack || {};
    const files = (index.files || []).filter(f => (!f.env || f.env.server !== 'unsupported') && f.downloads && f.downloads.length && inside(srv.dir, f.path));
    const newPaths = new Set(files.map(f => f.path));

    // drop files the previous pack version installed and this one no longer has
    for (const rel of old.files || []) {
      if (newPaths.has(rel)) continue;
      const p = inside(srv.dir, rel);
      if (p) { await moveToBackup(srv, p, 'modpack'); await moveToBackup(srv, p + '.disabled', 'modpack'); }
    }
    let i = 0;
    await net.downloadAll(files.map(f => ({ url: f.downloads[0], dest: inside(srv.dir, f.path), sha1: f.hashes && f.hashes.sha1, size: f.fileSize, name: path.basename(f.path) })), {
      concurrency: 8, progress: (p) => { if (p.done !== i) { i = p.done; onStatus(`Pliki paczki ${p.done}/${p.total}`); } },
    });
    const overrides = {};
    for (const prefix of ['overrides/', 'server-overrides/']) {
      for (const e of zip.getEntries()) {
        if (e.isDirectory || !e.entryName.startsWith(prefix)) continue;
        const rel = e.entryName.slice(prefix.length);
        const dest = inside(srv.dir, rel);
        if (!dest) continue;
        const data = e.getData();
        const existing = fs.existsSync(dest) ? sha1(fs.readFileSync(dest)) : null;
        const act = overrideAction(rel, existing, (old.overrides || {})[rel], !old.files);
        overrides[rel] = sha1(data);
        if (act !== 'write') continue;
        await fsp.mkdir(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, data);
      }
    }
    return {
      name: index.name, mcVersion: deps.minecraft || srv.mcVersion, type: loaderOf(deps, srv.type), files: files.length,
      loaderVersion: deps['fabric-loader'] || deps['quilt-loader'] || deps.neoforge || (deps.forge ? deps.forge : '') || '',
      pack: {
        projectId: source.projectId || (version && version.project_id) || null, versionId: version ? version.id : null,
        version: version ? version.version_number : index.versionId || '', title: index.name,
        files: [...newPaths], overrides,
      },
    };
  } finally {
    if (tmp) await fsp.rm(tmp, { force: true });
  }
}

/** A CurseForge / FTB style server pack: a zip with mods/ (maybe inside one top folder). */
function isServerPack(file) {
  try {
    const names = new AdmZip(file).getEntries().map(e => e.entryName);
    return names.some(n => /^([^/]+\/)?mods\/[^/]+\.jar$/i.test(n));
  } catch { return false; }
}

/** Unpacks a server pack zip into the server folder (one shared top folder is stripped). */
async function installServerPack(srv, file, onStatus = () => {}) {
  const zip = new AdmZip(file);
  const entries = zip.getEntries().filter(e => !e.isDirectory);
  const tops = new Set(entries.map(e => e.entryName.split('/')[0]));
  const strip = tops.size === 1 && entries.every(e => e.entryName.includes('/')) ? [...tops][0] + '/' : '';
  let n = 0, loader = null, mc = null;
  for (const e of entries) {
    const rel = e.entryName.slice(strip.length);
    if (!rel || /^(world|world_nether|world_the_end)\//.test(rel) || /^(eula\.txt|server\.properties)$/i.test(rel)) continue;
    const dest = inside(srv.dir, rel);
    if (!dest) continue;
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, e.getData());
    if (++n % 50 === 0) onStatus(`Rozpakowywanie ${n}/${entries.length}`);
    const m = /^(neoforge|forge)-(\d+\.\d+(?:\.\d+)?)-?([\d.]*)-installer\.jar$/i.exec(path.basename(rel)) || /^(fabric)-server-mc\.([\d.]+)-loader/i.exec(path.basename(rel));
    if (m) { loader = m[1].toLowerCase(); mc = m[1].toLowerCase() === 'neoforge' ? null : m[2]; }
  }
  const vars = path.join(srv.dir, 'variables.txt');
  if (fs.existsSync(vars)) {
    const t = fs.readFileSync(vars, 'utf8');
    mc = mc || (/MINECRAFT_VERSION=([\d.]+)/.exec(t) || [])[1] || null;
    loader = loader || ((/MODLOADER=(\w+)/.exec(t) || [])[1] || '').toLowerCase() || null;
  }
  return { files: n, type: MOD_LOADERS[loader] ? loader : null, mcVersion: mc };
}

module.exports = {
  kindsFor, search, install, listInstalled, setEnabled, remove, addFiles, checkUpdates, applyUpdates, disableClientOnly,
  installModpack, modpackVersions, modpackUpdate, isServerPack, installServerPack, overrideAction,
};
