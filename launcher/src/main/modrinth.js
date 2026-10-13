'use strict';
const fsp = require('fs/promises');
const path = require('path');
const net = require('./net');

const API = 'https://api.modrinth.com/v2';

/** Content kinds supported by the browser and where they are installed inside an instance. */
const KINDS = {
  mod: { folder: 'mods', projectType: 'mod', ext: ['.jar'] },
  resourcepack: { folder: 'resourcepacks', projectType: 'resourcepack', ext: ['.zip'] },
  datapack: { folder: 'datapacks', projectType: 'datapack', ext: ['.zip'] },
  shader: { folder: 'shaderpacks', projectType: 'shader', ext: ['.zip'] },
};

async function search({ query = '', kind = 'mod', gameVersion, loader, sort = 'relevance', offset = 0, limit = 20, category }) {
  const facets = [[`project_type:${KINDS[kind].projectType}`]];
  if (gameVersion) facets.push([`versions:${gameVersion}`]);
  if (kind === 'mod' && loader) facets.push([`categories:${loader}`]);
  if (category) facets.push([`categories:${category}`]);
  const params = new URLSearchParams({ query, index: sort, offset: String(offset), limit: String(limit), facets: JSON.stringify(facets) });
  return net.getJson(`${API}/search?${params}`);
}

async function project(id) {
  return net.getJson(`${API}/project/${encodeURIComponent(id)}`);
}

async function compatibleVersions(projectId, { kind, gameVersion, loader }) {
  const params = new URLSearchParams();
  if (gameVersion) params.set('game_versions', JSON.stringify([gameVersion]));
  if (kind === 'mod' && loader) params.set('loaders', JSON.stringify([loader]));
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
async function install({ projectId, kind, gameVersion, loader, targetDir, versionId }, onStatus, seen = new Set()) {
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
      try {
        installed.push(...await install({ projectId: dep.project_id, kind, gameVersion, loader, targetDir }, onStatus, seen));
      } catch (e) {
        onStatus && onStatus(`Nie udało się pobrać zależności: ${e.message}`);
      }
    }
  }
  return installed;
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

/** Newer Modrinth versions for the files in a content folder (matched by SHA-1). */
async function checkUpdates(dir, kind, gameVersion) {
  const ext = KINDS[kind].ext;
  let files = [];
  try { files = (await fsp.readdir(dir)).filter(f => ext.some(e => f.toLowerCase().endsWith(e))); } catch { return []; }
  if (!files.length) return [];
  const hashes = {};
  for (const f of files) hashes[await net.sha1File(path.join(dir, f))] = f;
  const res = await net.fetchWithRetry(`${API}/version_files/update`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ hashes: Object.keys(hashes), algorithm: 'sha1', loaders: UPDATE_LOADERS[kind], game_versions: [gameVersion] }),
  });
  if (!res.ok) return [];
  const map = await res.json();
  const out = [];
  for (const [hash, version] of Object.entries(map)) {
    const file = primaryFile(version);
    if (!file || file.hashes.sha1 === hash) continue;
    out.push({ oldFile: hashes[hash], newFile: file.filename, url: file.url, sha1: file.hashes.sha1, size: file.size, version: version.version_number });
  }
  return out;
}

async function applyUpdates(dir, updates) {
  for (const u of updates) {
    await net.download(u.url, path.join(dir, u.newFile), { sha1: u.sha1, size: u.size });
    if (u.oldFile !== u.newFile) await fsp.rm(path.join(dir, u.oldFile), { force: true });
  }
  return updates.length;
}

module.exports = { KINDS, search, project, compatibleVersions, install, listInstalled, checkUpdates, applyUpdates };
