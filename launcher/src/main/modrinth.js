'use strict';
const fsp = require('fs/promises');
const path = require('path');
const net = require('./net');
const { modLoaders } = require('./loaders');

const API = 'https://api.modrinth.com/v2';

/** Content kinds supported by the browser and where they are installed inside an instance. */
const KINDS = {
  mod: { folder: 'mods', projectType: 'mod', ext: ['.jar'] },
  resourcepack: { folder: 'resourcepacks', projectType: 'resourcepack', ext: ['.zip'] },
  datapack: { folder: 'datapacks', projectType: 'datapack', ext: ['.zip'] },
  shader: { folder: 'shaderpacks', projectType: 'shader', ext: ['.zip'] },
  modpack: { folder: null, projectType: 'modpack', ext: ['.mrpack'] },
};

async function search({ query = '', kind = 'mod', gameVersion, loader, sort = 'relevance', offset = 0, limit = 20, category, categories, environment, loaders }) {
  const facets = [[`project_type:${KINDS[kind].projectType}`]];
  if (gameVersion) facets.push([`versions:${gameVersion}`]);
  if (kind === 'mod' && loader) facets.push(modLoaders(loader).map(l => `categories:${l}`));
  if (loaders && loaders.length) facets.push(loaders.map(l => `categories:${l}`));
  if (category) facets.push([`categories:${category}`]);
  for (const c of categories || []) facets.push([`categories:${c}`]);
  if (environment === 'client') facets.push(['client_side:required', 'client_side:optional']);
  if (environment === 'server') facets.push(['server_side:required', 'server_side:optional']);
  const params = new URLSearchParams({ query, index: sort, offset: String(offset), limit: String(limit), facets: JSON.stringify(facets) });
  return net.getJson(`${API}/search?${params}`);
}

/** Category tags of a project type (for the filter sidebar). */
let tagCache = null;
async function categories(kind) {
  if (!tagCache) tagCache = await net.getJson(`${API}/tag/category`);
  const type = KINDS[kind].projectType;
  return tagCache.filter(c => c.project_type === type);
}

/** Everything the details view needs: project, versions, members and dependencies. */
async function details(id) {
  const enc = encodeURIComponent(id);
  const [proj, vers, members, deps] = await Promise.all([
    net.getJson(`${API}/project/${enc}`),
    net.getJson(`${API}/project/${enc}/version`).catch(() => []),
    net.getJson(`${API}/project/${enc}/members`).catch(() => []),
    net.getJson(`${API}/project/${enc}/dependencies`).catch(() => ({ projects: [] })),
  ]);
  return {
    project: proj,
    versions: vers.map(v => ({
      id: v.id, name: v.name, number: v.version_number, type: v.version_type, date: v.date_published,
      downloads: v.downloads, gameVersions: v.game_versions, loaders: v.loaders, changelog: (v.changelog || '').slice(0, 4000),
      file: (primaryFile(v) || {}).filename, size: (primaryFile(v) || {}).size,
      deps: (v.dependencies || []).filter(d => d.project_id).map(d => ({ id: d.project_id, type: d.dependency_type })),
    })),
    members: members.map(m => ({ name: m.user.username, role: m.role, avatar: m.user.avatar_url })),
    dependencies: (deps.projects || []).map(p => ({ id: p.id, title: p.title, icon: p.icon_url, slug: p.slug, type: p.project_type })),
  };
}

async function project(id) {
  return net.getJson(`${API}/project/${encodeURIComponent(id)}`);
}

async function compatibleVersions(projectId, { kind, gameVersion, loader }) {
  const params = new URLSearchParams();
  if (gameVersion) params.set('game_versions', JSON.stringify([gameVersion]));
  if (kind === 'mod' && loader) params.set('loaders', JSON.stringify(modLoaders(loader)));
  if (kind === 'datapack') params.set('loaders', JSON.stringify(['datapack']));
  return net.getJson(`${API}/project/${encodeURIComponent(projectId)}/version?${params}`);
}

function primaryFile(version) {
  return version.files.find(f => f.primary) || version.files[0];
}

/**
 * Installs a project (and, for mods, its required dependencies) into targetDir.
 * Returns the list of installed file names.
 */
async function install({ projectId, kind, gameVersion, loader, targetDir, versionId }, onStatus, seen = new Set(), ctx = {}) {
  if (seen.has(projectId)) return [];
  seen.add(projectId);
  let version;
  if (versionId) version = await net.getJson(`${API}/version/${encodeURIComponent(versionId)}`);
  else {
    const list = await compatibleVersions(projectId, { kind, gameVersion, loader });
    version = list.find(v => v.version_type === 'release') || list[0];
  }
  if (!version) throw new Error('Brak wersji zgodnej z ' + (gameVersion || 'tą wersją gry') + (loader && kind === 'mod' ? ` (${loader})` : ''));
  const file = primaryFile(version);
  await fsp.mkdir(targetDir, { recursive: true });
  onStatus && onStatus(`Pobieranie ${file.filename}`);
  await net.download(file.url, path.join(targetDir, file.filename), { sha1: file.hashes && file.hashes.sha1, size: file.size });
  const installed = [file.filename];
  if (kind === 'mod') {
    for (const dep of version.dependencies || []) {
      if (dep.dependency_type !== 'required' || !dep.project_id) continue;
      // a dependency the folder already has (any version, also from CurseForge) is not downloaded again
      if (await hasProject(targetDir, dep.project_id, ctx)) continue;
      try {
        installed.push(...await install({ projectId: dep.project_id, kind, gameVersion, loader, targetDir }, onStatus, seen, ctx));
      } catch (e) {
        onStatus && onStatus(`Nie udało się pobrać zależności: ${e.message}`);
      }
    }
  }
  return installed;
}

/** Is a Modrinth project already in the folder? By file hash, then by mod id = project slug. */
async function hasProject(dir, projectId, ctx) {
  if (!ctx.ids) ctx.ids = new Set(Object.values(await identify(dir, ['.jar']).catch(() => ({}))).map(m => m.projectId));
  if (ctx.ids.has(projectId)) return true;
  try {
    const perf = require('./perf');
    if (!ctx.present) ctx.present = perf.presentSet(await perf.scan(dir));
    const p = await project(projectId);
    const n = String(p.slug || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    return !!n && ctx.present.has(n);
  } catch { return false; }
}

/** Lists installed files in a content folder (with .disabled support). */
async function listInstalled(dir, exts) {
  try {
    const files = await fsp.readdir(dir, { withFileTypes: true });
    const out = [];
    for (const f of files) {
      const name = f.name;
      const enabled = !name.endsWith('.disabled');
      const base = enabled ? name : name.slice(0, -'.disabled'.length);
      if (!f.isDirectory() && !exts.some(e => base.toLowerCase().endsWith(e))) continue;
      const st = await fsp.stat(path.join(dir, name));
      out.push({ file: name, name: base, enabled, size: st.size, dir: f.isDirectory() });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}

const UPDATE_LOADERS = { mod: ['fabric'], resourcepack: ['minecraft'], shader: ['iris', 'optifine', 'canvas'], datapack: ['datapack'] };

/** Version types allowed by the update channel: 'all' (alpha/beta too), 'beta' or 'release'. */
function channelTypes(channel) {
  if (channel === 'release') return ['release'];
  if (channel === 'beta') return ['release', 'beta'];
  return ['release', 'beta', 'alpha'];
}

/** Newer Modrinth versions for the files in a content folder (matched by SHA-1). */
async function checkUpdates(dir, kind, gameVersion, loader, channel = 'all') {
  const ext = KINDS[kind].ext;
  let files = [];
  try { files = (await fsp.readdir(dir)).filter(f => ext.some(e => f.toLowerCase().endsWith(e))); } catch { return []; }
  if (!files.length) return [];
  const hashes = {};
  for (const f of files) hashes[await net.sha1File(path.join(dir, f))] = f;
  const res = await net.fetchWithRetry(`${API}/version_files/update`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      hashes: Object.keys(hashes), algorithm: 'sha1', loaders: kind === 'mod' && loader && loader !== 'vanilla' ? modLoaders(loader) : UPDATE_LOADERS[kind],
      game_versions: [gameVersion], version_types: channelTypes(channel),
    }),
  });
  if (!res.ok) return [];
  const map = await res.json();
  const out = [];
  for (const [hash, version] of Object.entries(map)) {
    const file = primaryFile(version);
    if (!file || file.hashes.sha1 === hash) continue;
    out.push({
      oldFile: hashes[hash], newFile: file.filename, url: file.url, sha1: file.hashes.sha1, size: file.size,
      version: version.version_number, type: version.version_type, versionId: version.id, projectId: version.project_id,
    });
  }
  return out;
}

const BACKUP_DIR = '.nore-backup';

/** Removes old backups, keeping the `keep` newest folders whose name matches `re`. */
async function pruneBackups(gameDir, re, keep = 3) {
  const root = path.join(gameDir, BACKUP_DIR);
  let names = [];
  try { names = (await fsp.readdir(root)).filter(n => re.test(n)).sort(); } catch { return; }
  for (const n of names.slice(0, Math.max(0, names.length - keep))) await fsp.rm(path.join(root, n), { recursive: true, force: true }).catch(() => {});
}

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
}

/**
 * Installs updates: the new file is downloaded first, only then the old one is moved to
 * <gameDir>/.nore-backup/<time>/<folder>/ (the 3 newest backups are kept). Without gameDir old files are deleted.
 */
async function applyUpdates(dir, updates, { gameDir } = {}) {
  let backup = null;
  if (gameDir && updates.length) {
    const rel = path.relative(gameDir, dir);
    backup = path.join(gameDir, BACKUP_DIR, stamp(), rel.startsWith('..') ? path.basename(dir) : rel);
  }
  for (const u of updates) {
    const oldFile = path.basename(u.oldFile), newFile = path.basename(u.newFile);
    await net.download(u.url, path.join(dir, newFile), { sha1: u.sha1, size: u.size });
    if (oldFile === newFile) continue;
    if (backup) {
      await fsp.mkdir(backup, { recursive: true });
      await fsp.rename(path.join(dir, oldFile), path.join(backup, oldFile)).catch(() => fsp.rm(path.join(dir, oldFile), { force: true }));
    } else {
      await fsp.rm(path.join(dir, oldFile), { force: true });
    }
  }
  if (backup) await pruneBackups(gameDir, /^\d{4}-\d\d-\d\d_[\d-]+$/);
  return updates.length;
}

const idCache = new Map(); // path|size|mtime → hash

/**
 * Matches installed files with Modrinth projects (by SHA-1) so the launcher can show real names,
 * icons and "installed" badges. Returns { [file]: { projectId, version, title, icon, slug } }.
 */
async function identify(dir, exts) {
  let names = [];
  try { names = await fsp.readdir(dir); } catch { return {}; }
  names = names.filter(n => exts.some(e => n.toLowerCase().replace(/\.disabled$/, '').endsWith(e)));
  const byHash = {};
  for (const n of names) {
    const full = path.join(dir, n);
    try {
      const st = await fsp.stat(full);
      if (!st.isFile()) continue;
      const key = `${full}|${st.size}|${st.mtimeMs}`;
      let h = idCache.get(key);
      if (!h) { h = await net.sha1File(full); idCache.set(key, h); }
      byHash[h] = n;
    } catch { /* unreadable */ }
  }
  const hashes = Object.keys(byHash);
  if (!hashes.length) return {};
  const res = await net.fetchWithRetry(`${API}/version_files`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ hashes, algorithm: 'sha1' }),
  });
  if (!res.ok) return {};
  const versions = await res.json();
  const ids = [...new Set(Object.values(versions).map(v => v.project_id))];
  const projects = ids.length ? await net.getJson(`${API}/projects?ids=${encodeURIComponent(JSON.stringify(ids))}`).catch(() => []) : [];
  const pmap = Object.fromEntries(projects.map(p => [p.id, p]));
  const out = {};
  for (const [hash, v] of Object.entries(versions)) {
    const p = pmap[v.project_id] || {};
    out[byHash[hash]] = {
      projectId: v.project_id, version: v.version_number, versionId: v.id, title: p.title, icon: p.icon_url, slug: p.slug, description: p.description,
      gameVersions: v.game_versions || [], loaders: v.loaders || [],
    };
  }
  return out;
}

module.exports = {
  identify, KINDS, search, categories, details, primaryFile, project, compatibleVersions, install, listInstalled, checkUpdates, applyUpdates,
  channelTypes, pruneBackups, stamp, BACKUP_DIR,
};
