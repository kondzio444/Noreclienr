'use strict';
/*
 * CurseForge next to Modrinth: search, project pages, installing mods / resource packs / shaders /
 * datapacks with their required dependencies, modpacks (manifest.json .zip, also imported from a
 * file) and recognising installed files by fingerprint for badges and updates.
 *
 * The official API (api.curseforge.com) needs a free key from console.curseforge.com – the user's
 * own key from Settings, or one baked into the build from a CI secret (scripts/keys.js). Without a key
 * only modpack files can be imported: each file is then fetched through the public
 * curseforge.com download redirect.
 */
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const AdmZip = require('adm-zip');
const net = require('./net');
const store = require('./store');

const API = process.env.NORE_CF_API || 'https://api.curseforge.com';
const GAME = 432; // Minecraft
const CLASS = { mod: 6, modpack: 4471, resourcepack: 12, shader: 6552, datapack: 6945 };
const CLASS_KIND = Object.fromEntries(Object.entries(CLASS).map(([k, v]) => [v, k]));
const LOADER_TYPE = { forge: 1, fabric: 4, quilt: 5, neoforge: 6 };
const LOADER_NAME = { 1: 'forge', 4: 'fabric', 5: 'quilt', 6: 'neoforge' };
const RELEASE = { 1: 'release', 2: 'beta', 3: 'alpha' };
const SORT = { relevance: 1, downloads: 6, follows: 2, newest: 11, updated: 3 };
const FOLDER = { mod: 'mods', resourcepack: 'resourcepacks', shader: 'shaderpacks', datapack: 'datapacks' };

const ID = (id) => `cf:${id}`;
const isCf = (id) => typeof id === 'string' && id.startsWith('cf:');
const rawId = (id) => Number(String(id).replace(/^cf:/, ''));

// ------------------------------------------------------------------ key

/** Key baked in at build time by scripts/keys.js (never stored in git). */
const bundledKey = () => require('./keys').curseforge();

function decrypt(value) {
  if (!value) return null;
  if (!value.startsWith('enc:')) return value;
  try { return require('electron').safeStorage.decryptString(Buffer.from(value.slice(4), 'base64')); } catch { return null; }
}

function encrypt(value) {
  if (!value) return '';
  try {
    const s = require('electron').safeStorage;
    if (s.isEncryptionAvailable()) return 'enc:' + s.encryptString(value).toString('base64');
  } catch { /* plain Node (tests) */ }
  return value;
}

function key() { return decrypt((store.get().settings || {}).curseforgeKey) || bundledKey(); }

function available() { return !!key(); }

class NoKeyError extends Error {
  constructor() {
    super('CurseForge wymaga klucza API – dodaj go w Ustawieniach → CurseForge (darmowy z console.curseforge.com).');
    this.code = 'CF_NO_KEY';
  }
}

async function call(pathname, { method = 'GET', body, apiKey } = {}) {
  const k = apiKey || key();
  if (!k) throw new NoKeyError();
  const res = await net.fetchWithRetry(API + pathname, {
    method, headers: { 'x-api-key': k, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  }, 3);
  if (res.status === 403 || res.status === 401) throw new Error('CurseForge odrzucił klucz API – sprawdź go w Ustawieniach.');
  if (res.status === 404) throw new Error('Nie znaleziono na CurseForge.');
  if (!res.ok) throw new Error(`CurseForge: HTTP ${res.status}`);
  return res.json();
}

/** Checks a key before saving it. */
async function testKey(k) {
  await call(`/v1/games/${GAME}`, { apiKey: k });
  return true;
}

function setKey(k) {
  store.update(d => { d.settings.curseforgeKey = k ? encrypt(k.trim()) : ''; });
  return available();
}

// ------------------------------------------------------------------ shapes shared with the Modrinth browser

function hit(m) {
  const shot = (m.screenshots || [])[0];
  const cats = (m.categories || []).map(c => c.slug);
  return {
    project_id: ID(m.id), slug: m.slug, title: m.name, description: m.summary || '', author: (m.authors || [])[0] ? m.authors[0].name : '',
    icon_url: m.logo && (m.logo.thumbnailUrl || m.logo.url), downloads: m.downloadCount || 0, follows: m.thumbsUpCount || 0,
    date_modified: m.dateModified, categories: cats.concat(loadersOfMod(m)), display_categories: cats,
    featured_gallery: shot ? shot.url : null, source: 'curseforge', project_type: CLASS_KIND[m.classId] || 'mod',
  };
}

function loadersOfMod(m) {
  const set = new Set();
  for (const f of m.latestFilesIndexes || []) if (LOADER_NAME[f.modLoader]) set.add(LOADER_NAME[f.modLoader]);
  return [...set];
}

const isMcVersion = (v) => /^\d+\.\d+(\.\d+)?$/.test(v) || /^\d{2}w\d{2}[a-z]$/.test(v);

function version(f) {
  const loaders = (f.gameVersions || []).map(v => v.toLowerCase()).filter(v => ['forge', 'fabric', 'quilt', 'neoforge'].includes(v));
  return {
    id: String(f.id), name: f.displayName || f.fileName, number: f.displayName || f.fileName, type: RELEASE[f.releaseType] || 'release',
    date: f.fileDate, downloads: f.downloadCount || 0, gameVersions: (f.gameVersions || []).filter(isMcVersion), loaders,
    changelog: '', file: f.fileName, size: f.fileLength,
    deps: (f.dependencies || []).filter(d => d.relationType === 3).map(d => ({ id: ID(d.modId), type: 'required' })),
  };
}

// ------------------------------------------------------------------ search / categories / details

const catCache = {};
async function categoryList(kind) {
  const classId = CLASS[kind];
  if (!catCache[classId]) {
    const j = await call(`/v1/categories?gameId=${GAME}&classId=${classId}`);
    catCache[classId] = (j.data || []).filter(c => !c.isClass);
  }
  return catCache[classId];
}

async function categories(kind) {
  return (await categoryList(kind)).map(c => ({ name: c.slug, header: 'categories', icon: c.iconUrl }));
}

async function search({ query = '', kind = 'mod', gameVersion, loader, loaders, sort = 'relevance', offset = 0, limit = 20, categories: cats }) {
  const p = new URLSearchParams({ gameId: String(GAME), classId: String(CLASS[kind]), sortField: String(SORT[sort] || 1), sortOrder: 'desc', index: String(offset), pageSize: String(Math.min(50, limit)) });
  if (query) p.set('searchFilter', query);
  if (gameVersion) p.set('gameVersion', gameVersion);
  const loaderList = (loader ? [loader] : loaders || []).filter(l => LOADER_TYPE[l]);
  if (loaderList.length === 1 && (kind === 'mod' || kind === 'modpack')) p.set('modLoaderType', String(LOADER_TYPE[loaderList[0]]));
  if (cats && cats.length) {
    const all = await categoryList(kind).catch(() => []);
    const ids = cats.map(s => (all.find(c => c.slug === s) || {}).id).filter(Boolean);
    if (ids.length === 1) p.set('categoryId', String(ids[0]));
    else if (ids.length > 1) p.set('categoryIds', JSON.stringify(ids.slice(0, 10)));
  }
  const j = await call(`/v1/mods/search?${p}`);
  // CurseForge caps paging at 10 000 results
  return { hits: (j.data || []).map(hit), total_hits: Math.min((j.pagination && j.pagination.totalCount) || 0, 10000), offset, limit };
}

async function files(id, { gameVersion, loader } = {}) {
  const p = new URLSearchParams({ pageSize: '50', index: '0' });
  if (gameVersion) p.set('gameVersion', gameVersion);
  if (loader && LOADER_TYPE[loader]) p.set('modLoaderType', String(LOADER_TYPE[loader]));
  const j = await call(`/v1/mods/${rawId(id)}/files?${p}`);
  return (j.data || []).filter(f => f.isAvailable !== false).sort((a, b) => Date.parse(b.fileDate) - Date.parse(a.fileDate));
}

async function details(id) {
  const n = rawId(id);
  const [mod, desc, list] = await Promise.all([
    call(`/v1/mods/${n}`).then(j => j.data),
    call(`/v1/mods/${n}/description`).then(j => j.data).catch(() => ''),
    files(n).catch(() => []),
  ]);
  const depIds = [...new Set(list.slice(0, 5).flatMap(f => (f.dependencies || []).filter(d => d.relationType === 3).map(d => d.modId)))];
  const deps = depIds.length ? (await call('/v1/mods', { method: 'POST', body: { modIds: depIds } }).catch(() => ({ data: [] }))).data || [] : [];
  const links = mod.links || {};
  return {
    project: {
      id: ID(mod.id), slug: mod.slug, title: mod.name, description: mod.summary, bodyHtml: desc || '', body: '',
      icon_url: mod.logo && mod.logo.thumbnailUrl, gallery: (mod.screenshots || []).map(s => ({ url: s.url, title: s.title, featured: false })),
      categories: (mod.categories || []).map(c => c.slug), downloads: mod.downloadCount, followers: mod.thumbsUpCount, updated: mod.dateModified,
      license: null, project_type: CLASS_KIND[mod.classId] || 'mod', source: 'curseforge',
      source_url: links.sourceUrl || null, issues_url: links.issuesUrl || null, wiki_url: links.wikiUrl || null, discord_url: null,
      web_url: links.websiteUrl || `https://www.curseforge.com/minecraft/${mod.slug}`,
    },
    versions: list.map(version),
    members: (mod.authors || []).map(a => ({ name: a.name, role: 'Autor', avatar: null })),
    dependencies: deps.map(d => ({ id: ID(d.id), title: d.name, icon: d.logo && d.logo.thumbnailUrl, slug: d.slug, type: 'wymagana' })),
  };
}

async function project(id) {
  const m = (await call(`/v1/mods/${rawId(id)}`)).data;
  return { id: ID(m.id), title: m.name, icon_url: m.logo && m.logo.thumbnailUrl, slug: m.slug, description: m.summary };
}

// ------------------------------------------------------------------ downloads

/** Direct CDN link of a file; works without a key through the curseforge.com redirect. */
function websiteDownload(projectId, fileId) {
  return `https://www.curseforge.com/api/v1/mods/${projectId}/files/${fileId}/download`;
}

function fileUrl(f) {
  if (f.downloadUrl) return f.downloadUrl;
  // authors can block third-party downloads: the CDN path is predictable from id + name
  return `https://edge.forgecdn.net/files/${Math.floor(f.id / 1000)}/${f.id % 1000}/${encodeURIComponent(f.fileName)}`;
}

const sha1Of = (f) => ((f.hashes || []).find(h => h.algo === 1) || {}).value;

/** Installs a project into targetDir (mods also get their required dependencies). */
async function install({ projectId, kind, gameVersion, loader, targetDir, versionId }, onStatus, seen = new Set()) {
  const n = rawId(projectId);
  if (seen.has(n)) return [];
  seen.add(n);
  let file;
  if (versionId) file = (await call(`/v1/mods/${n}/files/${versionId}`)).data;
  else {
    const list = await files(n, { gameVersion, loader: kind === 'mod' ? loader : null });
    const ok = list.filter(f => !gameVersion || (f.gameVersions || []).includes(gameVersion));
    file = ok.find(f => f.releaseType === 1) || ok[0];
  }
  if (!file) throw new Error('Brak wersji zgodnej z ' + (gameVersion || 'tą wersją gry') + (loader && kind === 'mod' ? ` (${loader})` : ''));
  await fsp.mkdir(targetDir, { recursive: true });
  onStatus && onStatus(`Pobieranie ${file.fileName}`);
  await net.download(fileUrl(file), path.join(targetDir, file.fileName), { sha1: sha1Of(file), size: file.fileLength });
  const out = [file.fileName];
  if (kind === 'mod') {
    for (const d of file.dependencies || []) {
      if (d.relationType !== 3) continue;
      try { out.push(...await install({ projectId: d.modId, kind, gameVersion, loader, targetDir }, onStatus, seen)); } catch (e) { onStatus && onStatus(`Nie udało się pobrać zależności: ${e.message}`); }
    }
  }
  return out;
}

// ------------------------------------------------------------------ fingerprints (installed files, updates)

/** CurseForge's file fingerprint: MurmurHash2 (seed 1) over the bytes without whitespace (9, 10, 13, 32). */
function fingerprint(buf) {
  const data = Buffer.alloc(buf.length);
  let len = 0;
  for (const b of buf) if (b !== 9 && b !== 10 && b !== 13 && b !== 32) data[len++] = b;
  const m = 0x5bd1e995;
  let h = (1 ^ len) >>> 0, i = 0, rest = len;
  while (rest >= 4) {
    let k = data[i] | (data[i + 1] << 8) | (data[i + 2] << 16) | (data[i + 3] << 24);
    k = Math.imul(k, m); k ^= k >>> 24; k = Math.imul(k, m);
    h = Math.imul(h, m) ^ k;
    i += 4; rest -= 4;
  }
  switch (rest) {
    case 3: h ^= data[i + 2] << 16; // falls through
    case 2: h ^= data[i + 1] << 8; // falls through
    case 1: h ^= data[i]; h = Math.imul(h, m);
  }
  h ^= h >>> 13; h = Math.imul(h, m); h ^= h >>> 15;
  return h >>> 0;
}

const fpCache = new Map(); // path|size|mtime → fingerprint

async function fingerprints(dir, names) {
  const out = {};
  for (const n of names) {
    const full = path.join(dir, n);
    try {
      const st = await fsp.stat(full);
      if (!st.isFile()) continue;
      const k = `${full}|${st.size}|${st.mtimeMs}`;
      let fp = fpCache.get(k);
      if (fp == null) { fp = fingerprint(await fsp.readFile(full)); fpCache.set(k, fp); }
      out[fp] = n;
    } catch { /* unreadable */ }
  }
  return out;
}

/** Files of a folder that are CurseForge projects: { [file]: { projectId, version, title, icon, ... } }. */
async function identify(dir, exts, skip = new Set()) {
  if (!available()) return {};
  let names = [];
  try { names = await fsp.readdir(dir); } catch { return {}; }
  names = names.filter(n => !skip.has(n) && exts.some(e => n.toLowerCase().replace(/\.disabled$/, '').endsWith(e)));
  const byFp = await fingerprints(dir, names);
  const fps = Object.keys(byFp).map(Number);
  if (!fps.length) return {};
  const j = await call(`/v1/fingerprints/${GAME}`, { method: 'POST', body: { fingerprints: fps } });
  const matches = (j.data && j.data.exactMatches) || [];
  if (!matches.length) return {};
  const mods = (await call('/v1/mods', { method: 'POST', body: { modIds: [...new Set(matches.map(m => m.id))] } }).catch(() => ({ data: [] }))).data || [];
  const byId = Object.fromEntries(mods.map(m => [m.id, m]));
  const out = {};
  for (const mt of matches) {
    const m = byId[mt.id] || {};
    const f = mt.file;
    out[byFp[f.fileFingerprint]] = {
      projectId: ID(mt.id), version: f.displayName, versionId: String(f.id), title: m.name, icon: m.logo && m.logo.thumbnailUrl,
      slug: m.slug, description: m.summary, gameVersions: (f.gameVersions || []).filter(isMcVersion), loaders: [], source: 'curseforge',
    };
  }
  return out;
}

/** Newer CurseForge files for recognised files (same game version / loader, by update channel). */
async function checkUpdates(dir, kind, gameVersion, loader, types = ['release', 'beta', 'alpha'], skip = new Set()) {
  const ids = await identify(dir, kind === 'mod' ? ['.jar'] : ['.zip'], skip);
  const out = [];
  for (const [file, info] of Object.entries(ids)) {
    if (file.endsWith('.disabled')) continue;
    try {
      const list = await files(info.projectId, { gameVersion, loader: kind === 'mod' ? loader : null });
      const best = list.find(f => types.includes(RELEASE[f.releaseType] || 'release') && (f.gameVersions || []).includes(gameVersion));
      if (!best || String(best.id) === info.versionId || Date.parse(best.fileDate) <= Date.parse((list.find(f => String(f.id) === info.versionId) || {}).fileDate || 0)) continue;
      out.push({ oldFile: file, newFile: best.fileName, url: fileUrl(best), sha1: sha1Of(best), size: best.fileLength, version: best.displayName, type: RELEASE[best.releaseType], projectId: info.projectId, source: 'curseforge' });
    } catch { /* project gone */ }
  }
  return out;
}

// ------------------------------------------------------------------ modpacks (manifest.json)

function readManifest(file) {
  const zip = new AdmZip(file);
  const entry = zip.getEntry('manifest.json');
  if (!entry) return null;
  const manifest = JSON.parse(entry.getData().toString('utf8'));
  if (!manifest.minecraft || !Array.isArray(manifest.files)) return null;
  return { zip, manifest };
}

/** "forge-47.2.0" / "neoforge-21.1.80" / "fabric-0.16.9" → { loader, loaderVersion }. */
function loaderOf(manifest) {
  const list = manifest.minecraft.modLoaders || [];
  const l = (list.find(x => x.primary) || list[0] || {}).id || '';
  const m = /^(forge|neoforge|fabric|quilt)-(.+)$/i.exec(l);
  if (!m) return { loader: 'vanilla', loaderVersion: null };
  let v = m[2];
  // older NeoForge packs write "neoforge-1.20.1-47.1.x"
  if (m[1].toLowerCase() === 'forge' && v.startsWith(manifest.minecraft.version + '-')) v = v.slice(manifest.minecraft.version.length + 1);
  return { loader: m[1].toLowerCase(), loaderVersion: v };
}

/** Folder for a pack file: by project class (with a key) or by looking inside the file. */
function guessFolder(file) {
  if (file.toLowerCase().endsWith('.jar')) return 'mods';
  try {
    const names = new AdmZip(file).getEntries().map(e => e.entryName);
    if (names.some(n => /^shaders\//i.test(n))) return 'shaderpacks';
    if (names.includes('pack.mcmeta')) return 'resourcepacks';
  } catch { /* not a zip */ }
  return 'mods';
}

/**
 * Resolves manifest files to { url, dest, sha1, size } – through the API when there is a key,
 * otherwise through the curseforge.com download redirect (folders are guessed after download).
 */
async function resolveFiles(manifest, root, onProgress) {
  const wanted = manifest.files.filter(f => f.required !== false && f.projectID && f.fileID);
  if (available()) {
    const out = [];
    for (let i = 0; i < wanted.length; i += 200) {
      const chunk = wanted.slice(i, i + 200);
      onProgress({ stage: 'Pobieranie listy plików z CurseForge', done: i, total: wanted.length });
      const [fl, mods] = await Promise.all([
        call('/v1/mods/files', { method: 'POST', body: { fileIds: chunk.map(f => f.fileID) } }),
        call('/v1/mods', { method: 'POST', body: { modIds: chunk.map(f => f.projectID) } }),
      ]);
      const classOf = Object.fromEntries((mods.data || []).map(m => [m.id, m.classId]));
      for (const f of fl.data || []) {
        const folder = FOLDER[CLASS_KIND[classOf[f.modId]]] || 'mods';
        out.push({ url: fileUrl(f), dest: path.join(root, folder, f.fileName), rel: `${folder}/${f.fileName}`, sha1: sha1Of(f), size: f.fileLength, name: f.fileName, guess: false });
      }
    }
    return out;
  }
  return wanted.map(f => ({ url: websiteDownload(f.projectID, f.fileID), dest: null, name: `${f.projectID}/${f.fileID}`, guess: true }));
}

/** Downloads via redirect when the name is unknown (no key): the final URL carries the file name. */
async function downloadGuessing(task, root, tmpDir) {
  const res = await net.fetchWithRetry(task.url, { redirect: 'follow' }, 3);
  if (!res.ok) throw new Error(`Nie udało się pobrać pliku paczki ${task.name} (HTTP ${res.status})`);
  const name = decodeURIComponent(new URL(res.url).pathname.split('/').pop() || `${task.name.replace('/', '-')}.jar`);
  const tmp = path.join(tmpDir, name);
  await fsp.mkdir(tmpDir, { recursive: true });
  await fsp.writeFile(tmp, Buffer.from(await res.arrayBuffer()));
  const folder = guessFolder(tmp);
  const dest = path.join(root, folder, name);
  await fsp.mkdir(path.dirname(dest), { recursive: true });
  await fsp.rename(tmp, dest).catch(async () => { await fsp.copyFile(tmp, dest); await fsp.rm(tmp, { force: true }); });
  return path.relative(root, dest).replace(/\\/g, '/');
}

/**
 * Installs a CurseForge modpack zip into root. Returns { files: [relative paths], overrides }.
 * onProgress({ stage, done, total, current }).
 */
async function installPackInto(file, root, onProgress = () => {}, concurrency = 8) {
  const parsed = readManifest(file);
  if (!parsed) throw new Error('To nie jest paczka CurseForge (brak manifest.json).');
  const { zip, manifest } = parsed;
  const tasks = await resolveFiles(manifest, root, onProgress);
  const written = [];
  let done = 0;
  const report = (current) => onProgress({ stage: 'Pobieranie plików paczki', done, total: tasks.length, current });
  report('');
  const direct = tasks.filter(t => !t.guess);
  if (direct.length) {
    await net.downloadAll(direct.map(t => ({ url: t.url, dest: t.dest, sha1: t.sha1, size: t.size, name: t.name })), {
      concurrency, progress: (p) => { done = p.done; report(p.current); },
    });
    written.push(...direct.map(t => path.relative(root, t.dest).replace(/\\/g, '/')));
  }
  const guessed = tasks.filter(t => t.guess);
  let idx = 0;
  const tmpDir = path.join(root, '.nore-cf-tmp');
  await Promise.all(Array.from({ length: Math.min(concurrency, guessed.length) }, async () => {
    while (idx < guessed.length) {
      const t = guessed[idx++];
      written.push(await downloadGuessing(t, root, tmpDir));
      done++; report(t.name);
    }
  }));
  await fsp.rm(tmpDir, { recursive: true, force: true });
  onProgress({ stage: 'Rozpakowywanie ustawień paczki' });
  const prefix = (manifest.overrides || 'overrides').replace(/\/?$/, '/');
  const overrides = {};
  for (const e of zip.getEntries()) {
    if (e.isDirectory || !e.entryName.startsWith(prefix)) continue;
    const rel = e.entryName.slice(prefix.length);
    const dest = path.resolve(root, rel);
    if (!dest.startsWith(path.resolve(root) + path.sep)) continue; // never write outside the instance
    const data = e.getData();
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, data);
    overrides[rel] = require('crypto').createHash('sha1').update(data).digest('hex');
  }
  return { files: written, overrides, manifest };
}

/**
 * The pack as a modrinth.index.json-like index ({ files: [{ path, downloads, hashes, fileSize }],
 * dependencies }) so modpack installs / safe updates can treat both formats alike. Needs a key.
 */
async function toIndex(manifest, onProgress = () => {}) {
  if (!available()) throw new NoKeyError();
  const tasks = await resolveFiles(manifest, '.', onProgress);
  const { loader, loaderVersion } = loaderOf(manifest);
  const dep = { fabric: 'fabric-loader', quilt: 'quilt-loader', forge: 'forge', neoforge: 'neoforge' }[loader];
  return {
    name: manifest.name, versionId: manifest.version, summary: manifest.author ? `Autor: ${manifest.author}` : '',
    dependencies: { minecraft: manifest.minecraft.version, ...(dep ? { [dep]: loaderVersion } : {}) },
    files: tasks.map(t => ({ path: t.rel, downloads: [t.url], hashes: t.sha1 ? { sha1: t.sha1 } : {}, fileSize: t.size })),
  };
}

/** Pack files of a project for the version picker, newest first. */
async function packVersions(projectId) {
  return (await files(projectId)).map(f => ({
    id: String(f.id), number: f.displayName || f.fileName, name: f.displayName, type: RELEASE[f.releaseType] || 'release', date: f.fileDate,
    gameVersions: (f.gameVersions || []).filter(isMcVersion), changelog: '',
  }));
}

/** Pack file for a project (newest release, or the given file id) downloaded to the cache. */
async function downloadPack(projectId, fileId, cacheDir) {
  const n = rawId(projectId);
  let f;
  if (fileId) f = (await call(`/v1/mods/${n}/files/${fileId}`)).data;
  else {
    const list = await files(n);
    f = list.find(x => x.releaseType === 1) || list[0];
  }
  if (!f) throw new Error('Ta paczka nie ma jeszcze żadnej wersji.');
  const dest = path.join(cacheDir, f.fileName);
  await net.download(fileUrl(f), dest, { sha1: sha1Of(f), size: f.fileLength });
  const mod = (await call(`/v1/mods/${n}`)).data;
  return {
    file: dest, fileId: f.id, version: f.displayName, type: RELEASE[f.releaseType], date: f.fileDate,
    title: mod.name, icon: mod.logo && mod.logo.thumbnailUrl, banner: ((mod.screenshots || [])[0] || {}).url || null,
  };
}

module.exports = {
  CLASS, isCf, rawId, available, testKey, setKey, NoKeyError, search, categories, details, project, files, install,
  fingerprint, identify, checkUpdates, readManifest, loaderOf, installPackInto, downloadPack, websiteDownload, guessFolder,
  toIndex, packVersions, encrypt, key,
};
