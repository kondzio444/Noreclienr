'use strict';
/*
 * Modrinth modpacks (.mrpack) for client instances. Installing a pack creates a new instance with
 * the pack's Minecraft version and mod loader, downloads every client file listed in
 * modrinth.index.json and unpacks overrides/ + client-overrides/ into the instance folder.
 */
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const AdmZip = require('adm-zip');
const paths = require('./paths');
const net = require('./net');
const instances = require('./instances');

const API = 'https://api.modrinth.com/v2';

/** Loader + version from modrinth.index.json dependencies. */
function loaderOf(deps) {
  if (deps['fabric-loader']) return { loader: 'fabric', loaderVersion: deps['fabric-loader'] };
  if (deps['quilt-loader']) return { loader: 'quilt', loaderVersion: deps['quilt-loader'] };
  if (deps.neoforge) return { loader: 'neoforge', loaderVersion: deps.neoforge };
  if (deps.forge) return { loader: 'forge', loaderVersion: deps.forge };
  return { loader: 'vanilla', loaderVersion: null };
}

function inside(root, rel) {
  const dest = path.resolve(root, rel);
  return dest.startsWith(path.resolve(root) + path.sep) ? dest : null; // never write outside the instance
}

async function readPack(file) {
  const zip = new AdmZip(file);
  const entry = zip.getEntry('modrinth.index.json');
  if (!entry) throw new Error('To nie jest paczka Modrinth (.mrpack) – brak modrinth.index.json.');
  return { zip, index: JSON.parse(entry.getData().toString('utf8')) };
}

/**
 * Creates an instance from a .mrpack file. meta: { title, icon, projectId, versionId, version }.
 * onProgress({ stage, done, total, current }).
 */
async function installFile(file, meta = {}, onProgress = () => {}, concurrency = 12) {
  const { zip, index } = await readPack(file);
  const deps = index.dependencies || {};
  if (!deps.minecraft) throw new Error('Paczka nie podaje wersji Minecraft.');
  const { loader, loaderVersion } = loaderOf(deps);
  const inst = instances.create({
    name: meta.title || index.name || 'Modpack', mcVersion: deps.minecraft, loader, loaderVersion, modpack: 'pack',
  });
  instances.update(inst.id, {
    pack: {
      projectId: meta.projectId || null, versionId: meta.versionId || null, title: meta.title || index.name,
      version: meta.version || index.versionId || '', summary: index.summary || '',
    },
    iconUrl: meta.icon || null,
    bannerUrl: meta.banner || null,
    packInstalled: true,
    // Fabric packs on a version Nore Client supports run with Nore Client on top;
    // the pack brings its own performance mods, so the launcher's set is not added
    noreClient: loader === 'fabric' && instances.NORE_VERSIONS.includes(deps.minecraft),
    perfMods: false,
  });
  const root = inst.gameDir;
  try {
    const files = (index.files || []).filter(f => !(f.env && f.env.client === 'unsupported'));
    const tasks = [];
    for (const f of files) {
      const dest = inside(root, f.path);
      if (!dest || !f.downloads || !f.downloads.length) continue;
      tasks.push({ url: f.downloads[0], dest, sha1: f.hashes && f.hashes.sha1, size: f.fileSize, name: path.basename(f.path) });
    }
    let last = 0;
    onProgress({ stage: 'Pobieranie plików paczki', done: 0, total: tasks.length });
    await net.downloadAll(tasks, {
      concurrency,
      progress: (p) => {
        if (Date.now() - last < 120 && p.done !== p.total) return;
        last = Date.now();
        onProgress({ stage: 'Pobieranie plików paczki', ...p });
      },
    });
    onProgress({ stage: 'Rozpakowywanie ustawień paczki' });
    for (const prefix of ['overrides/', 'client-overrides/']) {
      for (const e of zip.getEntries()) {
        if (e.isDirectory || !e.entryName.startsWith(prefix)) continue;
        const dest = inside(root, e.entryName.slice(prefix.length));
        if (!dest) continue;
        await fsp.mkdir(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, e.getData());
      }
    }
  } catch (e) {
    await instances.remove(inst.id, true);
    throw e;
  }
  return instances.get(inst.id);
}

/** Downloads a pack version from Modrinth (newest release when versionId is empty) and installs it. */
async function install({ projectId, versionId }, onProgress = () => {}, concurrency) {
  onProgress({ stage: 'Pobieranie informacji o paczce' });
  const project = await net.getJson(`${API}/project/${encodeURIComponent(projectId)}`);
  let version;
  if (versionId) version = await net.getJson(`${API}/version/${encodeURIComponent(versionId)}`);
  else {
    const list = await net.getJson(`${API}/project/${encodeURIComponent(projectId)}/version`);
    version = list.find(v => v.version_type === 'release') || list[0];
  }
  if (!version) throw new Error('Ta paczka nie ma jeszcze żadnej wersji.');
  const file = version.files.find(f => f.primary && f.filename.endsWith('.mrpack')) || version.files.find(f => f.filename.endsWith('.mrpack'));
  if (!file) throw new Error('Ta wersja nie zawiera pliku .mrpack.');
  const tmp = path.join(paths.cache, 'modpacks', file.filename);
  onProgress({ stage: `Pobieranie ${file.filename}` });
  await net.download(file.url, tmp, { sha1: file.hashes && file.hashes.sha1, size: file.size });
  try {
    return await installFile(tmp, {
      title: project.title, icon: project.icon_url, projectId: project.id,
      banner: ((project.gallery || []).find(g => g.featured) || (project.gallery || [])[0] || {}).url || null, versionId: version.id, version: version.version_number,
    }, onProgress, concurrency);
  } finally {
    await fsp.rm(tmp, { force: true });
  }
}

/** Reads name / Minecraft version / loader of a local .mrpack without installing it. */
async function inspect(file) {
  const { index } = await readPack(file);
  const deps = index.dependencies || {};
  return { name: index.name, version: index.versionId, mcVersion: deps.minecraft, ...loaderOf(deps), files: (index.files || []).length };
}

module.exports = { install, installFile, inspect, loaderOf };
