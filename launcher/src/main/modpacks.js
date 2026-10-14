'use strict';
/*
 * Modrinth modpacks (.mrpack) for client instances. Installing a pack creates a new instance with
 * the pack's Minecraft version and mod loader, downloads every client file listed in
 * modrinth.index.json and unpacks overrides/ + client-overrides/ into the instance folder.
 * Updating swaps the pack's own files for the new version's and keeps everything that belongs to the
 * player: worlds, screenshots, changed configs/options, mods they added themselves.
 */
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const AdmZip = require('adm-zip');
const paths = require('./paths');
const net = require('./net');
const instances = require('./instances');
const modrinth = require('./modrinth');

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

/** Never touched by a pack update. */
const PROTECTED = /^(saves|screenshots|backups|logs|crash-reports|\.nore-backup)(\/|$)/i;
/** Content folders: pack files there always follow the pack (the player cannot "edit" a jar). */
const CONTENT = /^(mods|resourcepacks|shaderpacks)\//i;

const norm = (rel) => String(rel).replace(/\\/g, '/').replace(/^(\.\/)+/, '');
const sha1 = (buf) => crypto.createHash('sha1').update(buf).digest('hex');
const statOf = (p) => fsp.stat(p).catch(() => null);

/** Project id from a Modrinth CDN url (cdn.modrinth.com/data/<id>/versions/...). */
function cdnProject(url) {
  const m = /\/data\/([A-Za-z0-9]{8})\/versions\//.exec(url || '');
  return m ? m[1] : null;
}

/** Files of modrinth.index.json the client needs. */
function clientFiles(index) {
  return (index.files || []).filter(f => f.path && f.downloads && f.downloads.length && !(f.env && f.env.client === 'unsupported'));
}

/** Files under overrides/ and client-overrides/ (the latter wins), as [{ rel, entry }]. */
function overrideEntries(zip) {
  const out = new Map();
  for (const prefix of ['overrides/', 'client-overrides/']) {
    for (const e of zip.getEntries()) {
      if (e.isDirectory || !e.entryName.startsWith(prefix)) continue;
      const rel = norm(e.entryName.slice(prefix.length));
      if (rel) out.set(rel, e);
    }
  }
  return [...out].map(([rel, entry]) => ({ rel, entry }));
}

/** What a pack version put into the instance: index paths, their Modrinth projects and override hashes. */
function packRecord(index, zip) {
  const files = [], ids = {}, overrides = {};
  for (const f of clientFiles(index)) {
    const rel = norm(f.path);
    files.push(rel);
    const id = cdnProject(f.downloads[0]);
    if (id) ids[rel] = id;
  }
  for (const { rel, entry } of overrideEntries(zip)) overrides[rel] = sha1(entry.getData());
  return { files, ids, overrides };
}

/**
 * Decides what happens with one override file during an update:
 * 'write' – take the pack's version, 'keep' – the player changed it, keep theirs, 'skip' – nothing to do.
 * current/oldHash/newHash are SHA-1 of the file on disk, in the old pack and in the new pack.
 */
function overrideAction(rel, { exists, current, oldHash, newHash }) {
  rel = norm(rel);
  if (PROTECTED.test(rel)) return 'skip';
  if (!exists) return 'write';
  if (current && current === newHash) return 'skip';
  if (CONTENT.test(rel)) return 'write';
  if (oldHash && current === oldHash) return 'write';
  return 'keep';
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
      type: meta.type || null, date: meta.date || null, ...packRecord(index, zip),
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
    for (const { rel, entry } of overrideEntries(zip)) {
      const dest = inside(root, rel);
      if (!dest) continue;
      await fsp.mkdir(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, entry.getData());
    }
  } catch (e) {
    await instances.remove(inst.id, true);
    throw e;
  }
  return instances.get(inst.id);
}

function mrpackFile(version) {
  const file = (version.files || []).find(f => f.primary && f.filename.endsWith('.mrpack')) || (version.files || []).find(f => f.filename.endsWith('.mrpack'));
  if (!file) throw new Error('Ta wersja nie zawiera pliku .mrpack.');
  return file;
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
  const file = mrpackFile(version);
  const tmp = path.join(paths.cache, 'modpacks', file.filename);
  onProgress({ stage: `Pobieranie ${file.filename}` });
  await net.download(file.url, tmp, { sha1: file.hashes && file.hashes.sha1, size: file.size });
  try {
    return await installFile(tmp, {
      title: project.title, icon: project.icon_url, projectId: project.id,
      banner: ((project.gallery || []).find(g => g.featured) || (project.gallery || [])[0] || {}).url || null, versionId: version.id, version: version.version_number,
      type: version.version_type, date: version.date_published,
    }, onProgress, concurrency);
  } finally {
    await fsp.rm(tmp, { force: true });
  }
}

// ------------------------------------------------------------------ updates

const byDate = (a, b) => Date.parse(b.date_published) - Date.parse(a.date_published);

/** All .mrpack versions of a project, newest first. */
async function packVersions(projectId) {
  const list = await net.getJson(`${API}/project/${encodeURIComponent(projectId)}/version`);
  return list.filter(v => (v.files || []).some(f => f.filename.endsWith('.mrpack'))).sort(byDate);
}

function mcOf(v, inst) {
  const gv = v.game_versions || [];
  return gv.includes(inst.mcVersion) ? inst.mcVersion : gv[gv.length - 1] || null;
}

function describe(v, inst) {
  const mcVersion = mcOf(v, inst);
  return {
    versionId: v.id, version: v.version_number, name: v.name, type: v.version_type, date: v.date_published,
    changelog: (v.changelog || '').slice(0, 4000), mcVersion, loaders: v.loaders || [],
    mcChanged: !!mcVersion && mcVersion !== inst.mcVersion, current: inst.pack.version || null,
  };
}

/**
 * Newest pack version for the instance's Minecraft version allowed by the channel ('all' | 'beta' | 'release')
 * when it is newer than the installed one, otherwise null. Many packs publish parallel builds for several
 * Minecraft versions – those are only offered in the version picker. Packs imported from a file cannot be checked.
 */
async function checkUpdate(inst, channel = 'all') {
  if (!inst || !inst.pack || !inst.pack.projectId) return null;
  const list = await packVersions(inst.pack.projectId);
  const types = modrinth.channelTypes(channel);
  const best = list.find(v => types.includes(v.version_type) && (v.game_versions || []).includes(inst.mcVersion));
  if (!best || best.id === inst.pack.versionId) return null;
  const cur = list.find(v => v.id === inst.pack.versionId);
  const curDate = cur ? Date.parse(cur.date_published) : Date.parse(inst.pack.date || '') || 0;
  if (curDate && Date.parse(best.date_published) <= curDate) return null;
  return describe(best, inst);
}

/** Every version of the instance's pack for the version picker. */
async function versions(inst) {
  if (!inst || !inst.pack || !inst.pack.projectId) return [];
  const list = await packVersions(inst.pack.projectId);
  return list.slice(0, 80).map(v => ({
    id: v.id, number: v.version_number, name: v.name, type: v.version_type, date: v.date_published,
    mcVersion: mcOf(v, inst), current: v.id === inst.pack.versionId, changelog: (v.changelog || '').slice(0, 4000),
  }));
}

async function downloadPack(version, tag = '') {
  const file = mrpackFile(version);
  const tmp = path.join(paths.cache, 'modpacks', `${version.id}${tag}-${file.filename}`);
  await net.download(file.url, tmp, { sha1: file.hashes && file.hashes.sha1, size: file.size });
  return tmp;
}

/** What the installed version put into the instance (downloads the old .mrpack for older installs). */
async function oldRecord(inst, onProgress, temp) {
  const p = inst.pack || {};
  if (Array.isArray(p.files)) return { files: p.files, ids: p.ids || {}, overrides: p.overrides || {} };
  if (p.versionId) {
    try {
      onProgress({ stage: 'Pobieranie poprzedniej wersji paczki' });
      const v = await net.getJson(`${API}/version/${encodeURIComponent(p.versionId)}`);
      const tmp = await downloadPack(v, '-old');
      temp.push(tmp);
      const { zip, index } = await readPack(tmp);
      return packRecord(index, zip);
    } catch { /* removed from Modrinth – fall back to matching files by project */ }
  }
  return { files: [], ids: {}, overrides: {} };
}

/**
 * Updates (or downgrades) a modpack instance to versionId without losing the player's data.
 * Pack files are swapped, every removed / replaced file goes to <gameDir>/.nore-backup/<time>-pack/
 * (worlds too when Minecraft changes and backupWorlds is on). saves/, screenshots/, options or configs
 * the player changed and mods they added themselves are kept. On failure everything is put back.
 */
async function update(instId, versionId, onProgress = () => {}, { backupWorlds = true, concurrency = 12 } = {}) {
  const inst = instances.get(instId);
  if (!inst || !inst.pack) throw new Error('To nie jest instancja modpacka.');
  if (!versionId) throw new Error('Nie wybrano wersji paczki.');
  const root = inst.gameDir;
  const temp = [];
  try {
    onProgress({ stage: 'Pobieranie informacji o wersji' });
    const version = await net.getJson(`${API}/version/${encodeURIComponent(versionId)}`);
    if (inst.pack.projectId && version.project_id !== inst.pack.projectId) throw new Error('Ta wersja należy do innej paczki.');
    onProgress({ stage: `Pobieranie ${mrpackFile(version).filename}` });
    const tmp = await downloadPack(version);
    temp.push(tmp);
    const { zip, index } = await readPack(tmp);
    const deps = index.dependencies || {};
    if (!deps.minecraft) throw new Error('Paczka nie podaje wersji Minecraft.');
    const old = await oldRecord(inst, onProgress, temp);
    const rec = packRecord(index, zip);
    const { loader, loaderVersion } = loaderOf(deps);
    const noreClient = loader === 'fabric' && instances.NORE_VERSIONS.includes(deps.minecraft);
    const result = await swapFiles(root, { zip, index, rec, old, onProgress, concurrency,
      backupWorlds: backupWorlds && deps.minecraft !== inst.mcVersion, dropNore: inst.noreClient && !noreClient,
      label: { from: inst.pack.version, to: version.version_number, mcFrom: inst.mcVersion, mcTo: deps.minecraft } });
    instances.update(inst.id, {
      mcVersion: deps.minecraft, loader, loaderVersion, packInstalled: true, noreClient,
      pack: {
        ...inst.pack, versionId: version.id, version: version.version_number, type: version.version_type,
        date: version.date_published, summary: index.summary || inst.pack.summary || '', ...rec, updated: Date.now(),
      },
    });
    onProgress({ stage: 'Gotowe', done: 1, total: 1 });
    return { instance: instances.get(inst.id), ...result };
  } finally {
    for (const t of temp) await fsp.rm(t, { force: true }).catch(() => {});
  }
}

/** Swaps the old pack files for the new ones (see update). Returns { added, removed, replaced, kept, backup }. */
async function swapFiles(root, { zip, index, rec, old, onProgress, concurrency, backupWorlds, dropNore, label }) {
  const backup = path.join(root, modrinth.BACKUP_DIR, `${modrinth.stamp()}-pack`);
  const moved = [], created = [], kept = [], tasks = [];
  const exists = async (rel) => !!(await statOf(path.join(root, rel)));
  const stash = async (rel) => {
    if (!inside(root, rel) || PROTECTED.test(rel)) return;
    const dst = path.join(backup, rel);
    await fsp.mkdir(path.dirname(dst), { recursive: true });
    await fsp.rename(path.join(root, rel), dst);
    moved.push(rel);
  };
  try {
    if (backupWorlds && await exists('saves')) {
      onProgress({ stage: 'Kopia zapasowa światów' });
      await fsp.cp(path.join(root, 'saves'), path.join(backup, 'saves'), { recursive: true });
    }
    onProgress({ stage: 'Porównywanie plików paczki' });
    const oldSet = new Set(old.files.map(norm));
    const newFiles = clientFiles(index);
    const newPaths = new Set(rec.files);
    const newProjects = new Set(Object.values(rec.ids));

    // installed content matched with Modrinth projects – finds old versions of pack mods the launcher
    // did not track (older installs, manual updates) so the new version never ends up next to them
    const found = {}; // rel → projectId
    for (const dir of ['mods', 'resourcepacks', 'shaderpacks']) {
      if (!rec.files.some(r => r.startsWith(dir + '/')) || !await exists(dir)) continue;
      const kind = dir === 'mods' ? 'mod' : dir === 'resourcepacks' ? 'resourcepack' : 'shader';
      try {
        const ids = await modrinth.identify(path.join(root, dir), modrinth.KINDS[kind].ext);
        for (const [file, m] of Object.entries(ids)) found[`${dir}/${file}`] = m.projectId;
      } catch { /* offline – only the tracked files are replaced */ }
    }
    // projects the player switched off stay switched off
    const disabled = new Set();
    for (const rel of oldSet) if (old.ids[rel] && !await exists(rel) && await exists(rel + '.disabled')) disabled.add(old.ids[rel]);
    for (const [rel, pid] of Object.entries(found)) {
      if (rel.endsWith('.disabled') && !Object.entries(found).some(([r, p]) => p === pid && !r.endsWith('.disabled'))) disabled.add(pid);
    }

    const keepPaths = new Set();
    for (const f of newFiles) {
      const rel = norm(f.path);
      if (PROTECTED.test(rel) || !inside(root, rel)) continue;
      const pid = cdnProject(f.downloads[0]);
      let destRel = rel;
      if ((pid && disabled.has(pid)) || (!await exists(rel) && await exists(rel + '.disabled'))) destRel = rel + '.disabled';
      keepPaths.add(destRel);
      const sha = f.hashes && f.hashes.sha1;
      if (await exists(destRel)) {
        if (sha && await net.isValid(path.join(root, destRel), sha)) continue; // unchanged
        await stash(destRel);
      } else {
        created.push(destRel);
      }
      tasks.push({ url: f.downloads[0], dest: path.join(root, destRel), sha1: sha, size: f.fileSize, name: path.basename(rel) });
    }

    let last = 0;
    onProgress({ stage: 'Pobieranie nowych plików paczki', done: 0, total: tasks.length });
    await net.downloadAll(tasks, {
      concurrency,
      progress: (p) => {
        if (Date.now() - last < 120 && p.done !== p.total) return;
        last = Date.now();
        onProgress({ stage: 'Pobieranie nowych plików paczki', ...p });
      },
    });

    onProgress({ stage: 'Usuwanie starych plików paczki' });
    let removed = 0;
    for (const rel of oldSet) {
      if (newPaths.has(rel)) continue;
      for (const r of [rel, rel + '.disabled']) if (!keepPaths.has(r) && await exists(r)) { await stash(r); removed++; }
    }
    for (const [rel, pid] of Object.entries(found)) {
      if (!newProjects.has(pid) || keepPaths.has(rel) || newPaths.has(rel) || !await exists(rel)) continue;
      await stash(rel); removed++;
    }
    if (dropNore && await exists('mods/noreclient.jar')) await stash('mods/noreclient.jar');

    onProgress({ stage: 'Aktualizowanie ustawień paczki' });
    let replaced = 0;
    for (const { rel, entry } of overrideEntries(zip)) {
      let destRel = rel;
      if (CONTENT.test(rel) && !await exists(rel) && await exists(rel + '.disabled')) destRel = rel + '.disabled';
      const dest = inside(root, destRel);
      if (!dest) continue;
      const st = await statOf(dest);
      if (st && !st.isFile()) continue;
      const current = st ? await net.sha1File(dest) : null;
      const action = overrideAction(rel, { exists: !!st, current, oldHash: old.overrides[rel], newHash: rec.overrides[rel] });
      if (action === 'keep') kept.push(rel);
      if (action !== 'write') continue;
      if (st) { await stash(destRel); replaced++; } else created.push(destRel);
      await fsp.mkdir(path.dirname(dest), { recursive: true });
      await fsp.writeFile(dest, entry.getData());
    }
    // mods / packs shipped as overrides that the new version dropped (only when the player did not replace them)
    for (const [rel, hash] of Object.entries(old.overrides)) {
      if (rec.overrides[rel] || newPaths.has(rel) || !CONTENT.test(rel) || PROTECTED.test(rel)) continue;
      const st = await statOf(path.join(root, rel));
      if (st && st.isFile() && await net.sha1File(path.join(root, rel)) === hash) { await stash(rel); removed++; }
    }

    const hasBackup = moved.length > 0 || !!(await statOf(path.join(backup, 'saves')));
    if (hasBackup) {
      await fsp.mkdir(backup, { recursive: true });
      await fsp.writeFile(path.join(backup, 'nore-backup.json'), JSON.stringify({ ...label, date: Date.now(), moved, kept }, null, 2));
      await modrinth.pruneBackups(root, /-pack$/);
    }
    return { added: created.length, removed, replaced, kept, backup: hasBackup ? backup : null };
  } catch (e) {
    // best-effort rollback: drop new files, put moved ones back
    onProgress({ stage: 'Przywracanie poprzednich plików' });
    for (const t of tasks) await fsp.rm(`${t.dest}.${process.pid}.part`, { force: true }).catch(() => {});
    for (const rel of created) await fsp.rm(path.join(root, rel), { force: true }).catch(() => {});
    let lost = 0;
    for (const rel of moved.reverse()) {
      const dest = path.join(root, rel);
      await fsp.mkdir(path.dirname(dest), { recursive: true }).catch(() => {});
      await fsp.rename(path.join(backup, rel), dest).catch(() => { lost++; });
    }
    // everything is back in place (worlds were only copied) – the half-made backup is not needed
    if (!lost) await fsp.rm(backup, { recursive: true, force: true }).catch(() => {});
    throw e;
  }
}

/** Reads name / Minecraft version / loader of a local .mrpack without installing it. */
async function inspect(file) {
  const { index } = await readPack(file);
  const deps = index.dependencies || {};
  return { name: index.name, version: index.versionId, mcVersion: deps.minecraft, ...loaderOf(deps), files: (index.files || []).length };
}

module.exports = { install, installFile, inspect, loaderOf, checkUpdate, versions, update, overrideAction, packRecord, cdnProject };
