'use strict';
/*
 * CurseForge for local servers: search and install mods (Fabric / Quilt / Forge / NeoForge),
 * Bukkit plugins (Paper / Purpur / Folia) and datapacks with dependencies, and whole CurseForge
 * modpacks – from the project's server pack when it has one, otherwise built from manifest.json
 * keeping only server / both-side files (client-only mods, resource packs and shaders are skipped;
 * files blocked for other apps go to the manual-download list). Pure planning helpers are exported.
 */
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const cf = require('./curseforge');

const MOD_LOADERS = ['fabric', 'quilt', 'forge', 'neoforge'];
const PLUGIN_TYPES = ['paper', 'purpur', 'folia'];
/** Overrides that only matter in the game client. */
const CLIENT_PATHS = /^(resourcepacks|shaderpacks|screenshots|saves|options\.txt|optionsof\.txt|optionsshaders\.txt|servers\.dat|config\/(iris|oculus|sodium|embeddium|rubidium)[^/]*)(\/|$)/i;
/** Never written from a pack into a server. */
const PROTECTED = /^(world|world_nether|world_the_end|backups|\.nore-backup|server\.properties|eula\.txt|whitelist\.json|ops\.json|banned-players\.json|banned-ips\.json)(\/|$)/i;

/** Which side a CurseForge file runs on, from its "Client" / "Server" tags. */
function cfSide(f) {
  const gv = (f.gameVersions || []).map(v => String(v).toLowerCase());
  const c = gv.includes('client'), s = gv.includes('server');
  return c && !s ? 'client' : s && !c ? 'server' : c && s ? 'both' : 'unknown';
}

function kindsFor(type) {
  const kinds = [];
  if (PLUGIN_TYPES.includes(type)) kinds.push('plugin');
  if (MOD_LOADERS.includes(type)) kinds.push('mod');
  if (type !== 'velocity' && type !== 'bungeecord') kinds.push('datapack', 'modpack');
  return kinds;
}

function worldName(srv) { return (srv.props && srv.props['level-name']) || 'world'; }

function folderFor(srv, kind) {
  if (kind === 'plugin') return path.join(srv.dir, 'plugins');
  if (kind === 'mod') return path.join(srv.dir, 'mods');
  return path.join(srv.dir, worldName(srv), 'datapacks');
}

async function search(srv, { kind, query = '', sort = 'relevance', offset = 0 }) {
  const modded = MOD_LOADERS.includes(srv.type);
  return cf.search({
    query, kind, sort, offset, limit: 20,
    // Bukkit files are tagged "1.21" rather than "1.21.4" – plugins are not filtered by version
    gameVersion: kind === 'mod' || kind === 'datapack' ? srv.mcVersion : null,
    loader: (kind === 'mod' || kind === 'modpack') && modded ? srv.type : null,
  });
}

async function install(srv, { kind, projectId, versionId }, onStatus) {
  if (kind === 'modpack') throw new Error('Modpacki instaluje installModpack()');
  return cf.install({
    projectId, kind, versionId, targetDir: folderFor(srv, kind),
    gameVersion: kind === 'plugin' ? null : srv.mcVersion,
    loader: kind === 'mod' ? srv.type : null,
  }, onStatus);
}

// ------------------------------------------------------------------ modpacks

/**
 * Pure: manifest + API records → { tasks, clientSkipped, missing, optional }. Tasks are
 * { url, rel, dest, sha1, size, name, blocked? } relative to the server folder.
 */
function manifestServerTasks(manifest, fileList, modList, { root = '.', world = 'world' } = {}) {
  const all = (manifest.files || []).filter(f => f.projectID && f.fileID);
  const wanted = new Set(all.filter(f => f.required !== false).map(f => Number(f.fileID)));
  const optional = all.filter(f => f.required === false).map(f => ({ projectId: f.projectID, fileId: f.fileID }));
  const mods = Object.fromEntries((modList || []).map(m => [m.id, m]));
  const tasks = [], clientSkipped = [];
  const got = new Set();
  for (const f of fileList || []) {
    if (!wanted.has(Number(f.id))) continue;
    got.add(Number(f.id));
    const mod = mods[f.modId] || {};
    const cls = mod.classId;
    const title = mod.name || f.displayName || f.fileName;
    // resource packs and shaders only exist in the client
    if (cls === cf.CLASS.resourcepack || cls === cf.CLASS.shader) { clientSkipped.push({ title, file: f.fileName, why: cls === cf.CLASS.shader ? 'shader' : 'resourcepack' }); continue; }
    if (cfSide(f) === 'client') { clientSkipped.push({ title, file: f.fileName, why: 'client' }); continue; }
    const folder = cls === cf.CLASS.datapack ? `${world}/datapacks` : cls === cf.CLASS.plugin ? 'plugins' : 'mods';
    const rel = `${folder}/${f.fileName}`;
    const t = { url: cf.fileUrl(f), rel, dest: path.join(root, folder, f.fileName), sha1: cf.sha1Of(f), size: f.fileLength, name: f.fileName };
    if (!f.downloadUrl) {
      const site = (mod.links && mod.links.websiteUrl) || `https://www.curseforge.com/minecraft/mc-mods/${mod.slug || f.modId}`;
      t.blocked = { projectId: f.modId, fileId: f.id, title, file: f.fileName, rel, sha1: t.sha1, size: f.fileLength, page: `${site.replace(/\/+$/, '')}/download/${f.id}` };
    }
    tasks.push(t);
  }
  return { tasks, clientSkipped, optional, missing: [...wanted].filter(id => !got.has(id)) };
}

/** Pure: should an override path from the client pack land on the server? */
function serverOverride(rel) {
  return !CLIENT_PATHS.test(rel) && !PROTECTED.test(rel);
}

/** Pure: which file to use – the project's server pack when the chosen client file has one. */
function serverPackPlan(fileRecord) {
  if (!fileRecord) return { mode: 'manifest' };
  if (fileRecord.isServerPack) return { mode: 'serverpack', fileId: fileRecord.id };
  if (fileRecord.serverPackFileId) return { mode: 'serverpack', fileId: fileRecord.serverPackFileId };
  return { mode: 'manifest' };
}

/** Pack versions in the same shape as Modrinth's for the server version picker. */
async function packVersions(projectId) {
  const list = await cf.files(projectId);
  return list.map(f => ({
    id: String(f.id), number: f.displayName || f.fileName, name: f.displayName, type: cf.RELEASE[f.releaseType] || 'release', date: f.fileDate,
    mcVersion: (f.gameVersions || []).filter(cf.isMcVersion)[0], gameVersions: (f.gameVersions || []).filter(cf.isMcVersion),
    loaders: (f.gameVersions || []).map(v => v.toLowerCase()).filter(v => MOD_LOADERS.includes(v)), hasServerPack: !!f.serverPackFileId, changelog: '',
  }));
}

/** Newest pack file for the server's Minecraft version newer than the installed one, or null. */
async function packUpdate(srv, types = ['release', 'beta', 'alpha']) {
  if (!srv.pack || srv.pack.source !== 'curseforge' || !srv.pack.projectId) return null;
  const list = (await packVersions(srv.pack.projectId)).filter(v => types.includes(v.type) && v.gameVersions.includes(srv.mcVersion));
  const newest = list.sort((a, b) => Date.parse(b.date) - Date.parse(a.date))[0];
  if (!newest || newest.id === String(srv.pack.versionId)) return null;
  const current = list.find(v => v.id === String(srv.pack.versionId));
  if (current && Date.parse(current.date) >= Date.parse(newest.date)) return null;
  return { ...newest, changelog: await cf.changelog(srv.pack.projectId, newest.id).catch(() => '') };
}

/** Resolves manifest files in chunks of 200 (file and project records). */
async function resolveManifest(manifest, onStatus) {
  const wanted = (manifest.files || []).filter(f => f.projectID && f.fileID && f.required !== false);
  const files = [], mods = [];
  for (let i = 0; i < wanted.length; i += 200) {
    const chunk = wanted.slice(i, i + 200);
    onStatus(`Lista plików z CurseForge ${Math.min(i + 200, wanted.length)}/${wanted.length}`);
    const [fl, ml] = await Promise.all([
      cf.call('/v1/mods/files', { method: 'POST', body: { fileIds: chunk.map(f => f.fileID) } }),
      cf.call('/v1/mods', { method: 'POST', body: { modIds: chunk.map(f => f.projectID) } }),
    ]);
    files.push(...(fl.data || []));
    mods.push(...(ml.data || []));
  }
  return { files, mods };
}

const sha1 = (buf) => crypto.createHash('sha1').update(buf).digest('hex');
function inside(base, rel) {
  const dest = path.resolve(base, rel);
  return dest.startsWith(path.resolve(base) + path.sep) ? dest : null;
}

/**
 * Installs / updates a CurseForge modpack on a server. source: { projectId, versionId } or { file }.
 * deps: { serverContent, modpacks } (injected to keep this module free of circular requires).
 */
async function installModpack(srv, source, deps, onStatus = () => {}) {
  const { serverContent, modpacks } = deps;
  const cache = path.join(srv.dir, '.nore-cf');
  await fsp.mkdir(cache, { recursive: true });
  let packFile = source.file, info = null, record = null;
  try {
    if (!packFile) {
      onStatus('Pobieranie paczki z CurseForge');
      info = await cf.downloadPack(source.projectId, source.versionId, cache);
      packFile = info.file;
      record = await cf.fileInfo(source.projectId, info.fileId).catch(() => null);
    }
    const parsed = cf.readManifest(packFile);
    if (!parsed) throw new Error('To nie jest paczka CurseForge (brak manifest.json).');
    const { zip, manifest } = parsed;
    const { loader, loaderVersion } = cf.loaderOf(manifest);
    const old = srv.pack || {};
    const plan = serverPackPlan(record);
    const base = {
      name: manifest.name, mcVersion: manifest.minecraft.version, type: MOD_LOADERS.includes(loader) ? loader : srv.type, loaderVersion: loaderVersion || '',
    };
    const packMeta = {
      source: 'curseforge', projectId: source.projectId ? `cf:${cf.rawId(source.projectId)}` : null, versionId: info ? String(info.fileId) : null,
      version: (info && info.version) || manifest.version || '', title: (info && info.title) || manifest.name,
    };

    if (plan.mode === 'serverpack') {
      onStatus('Pobieranie server packa od autora paczki');
      const sp = await cf.fileInfo(source.projectId, plan.fileId);
      const spFile = path.join(cache, sp.fileName);
      await require('./net').download(cf.fileUrl(sp), spFile, { sha1: cf.sha1Of(sp), size: sp.fileLength });
      for (const rel of old.files || []) { const p = inside(srv.dir, rel); if (p) await serverContent.moveToBackup(srv, p, 'modpack'); }
      const r = await serverContent.installServerPack(srv, spFile, onStatus);
      return { ...base, type: r.type || base.type, mcVersion: r.mcVersion || base.mcVersion, files: r.files, serverPack: true, pack: { ...packMeta, serverPack: true, files: [], overrides: {} } };
    }

    if (!cf.available()) throw new cf.NoKeyError();
    const { files, mods } = await resolveManifest(manifest, onStatus);
    const r = manifestServerTasks(manifest, files, mods, { root: srv.dir, world: worldName(srv) });
    const newRel = new Set(r.tasks.map(t => t.rel));
    for (const rel of old.files || []) {
      if (newRel.has(rel)) continue;
      const p = inside(srv.dir, rel);
      if (p) { await serverContent.moveToBackup(srv, p, 'modpack'); await serverContent.moveToBackup(srv, p + '.disabled', 'modpack'); }
    }
    let n = 0;
    const blocked = await modpacks.downloadTasks(r.tasks.map(t => ({ ...t, dest: inside(srv.dir, t.rel) })).filter(t => t.dest), {
      concurrency: 8, progress: (p) => { if (p.done !== n) { n = p.done; onStatus(`Pliki paczki ${p.done}/${p.total}`); } },
    });
    // overrides: configs, scripts, server-side data – never worlds or the owner's lists
    const prefix = (manifest.overrides || 'overrides').replace(/\/?$/, '/');
    const overrides = {};
    for (const e of zip.getEntries()) {
      if (e.isDirectory || !e.entryName.startsWith(prefix)) continue;
      const rel = e.entryName.slice(prefix.length);
      if (!serverOverride(rel)) continue;
      const dest = inside(srv.dir, rel);
      if (!dest) continue;
      const data = e.getData();
      const existing = fs.existsSync(dest) ? sha1(fs.readFileSync(dest)) : null;
      overrides[rel] = sha1(data);
      const act = serverContent.overrideAction(rel, existing, (old.overrides || {})[rel], !old.files);
      if (act !== 'write') continue;
      await fsp.mkdir(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, data);
    }
    return {
      ...base, files: r.tasks.length, clientSkipped: r.clientSkipped, blocked, missing: r.missing,
      pack: { ...packMeta, files: [...newRel], overrides, blocked, clientSkipped: r.clientSkipped.length },
    };
  } finally {
    await fsp.rm(cache, { recursive: true, force: true }).catch(() => {});
  }
}

module.exports = { cfSide, kindsFor, folderFor, search, install, manifestServerTasks, serverOverride, serverPackPlan, packVersions, packUpdate, installModpack };
