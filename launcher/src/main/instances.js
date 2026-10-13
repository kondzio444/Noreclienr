'use strict';
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const paths = require('./paths');
const store = require('./store');
const noreMods = require('./nore-mods');

const NORE_MC_VERSION = '1.21.1';
/** Minecraft versions the bundled Nore Client jars support. */
const NORE_VERSIONS = noreMods.versions();

function gameDir(inst) {
  return path.join(paths.instances, inst.id);
}

function list() {
  return store.get().instances.map(i => ({ ...i, gameDir: gameDir(i) }));
}

function get(id) {
  const i = store.get().instances.find(x => x.id === id);
  return i ? { ...i, gameDir: gameDir(i) } : null;
}

function slug(name) {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'instancja';
  return `${base}-${crypto.randomBytes(3).toString('hex')}`;
}

/**
 * modpack: 'vanilla' (no loader), 'fabric' (plain Fabric) or 'nore' (Fabric + Nore Client,
 * supported versions only). perfPack adds the Nore performance/QoL mod pack from Modrinth and
 * works on every version Fabric supports.
 */
function create({ name, mcVersion, loader = 'vanilla', loaderVersion = null, noreClient = false, modpack = null, perfPack = false, color = 0 }) {
  if (!modpack) modpack = loader === 'fabric' ? (noreClient ? 'nore' : 'fabric') : 'vanilla';
  if (modpack === 'nore' && !NORE_VERSIONS.includes(mcVersion)) { modpack = 'fabric'; perfPack = true; }
  if (modpack !== 'vanilla') loader = 'fabric';
  const inst = {
    id: slug(name), name: name.trim() || mcVersion, mcVersion, loader, loaderVersion,
    modpack, noreClient: modpack === 'nore', perfPack: !!perfPack && modpack !== 'vanilla', packInstalled: false,
    color, created: Date.now(), lastPlayed: 0, playTime: 0, memoryMb: 0, joinServer: '', jvmArgs: '', width: 0, height: 0,
  };
  store.update(d => {
    d.instances.push(inst);
    d.selectedInstance = inst.id;
  });
  fs.mkdirSync(gameDir(inst), { recursive: true });
  return get(inst.id);
}

function update(id, patch) {
  store.update(d => {
    const i = d.instances.find(x => x.id === id);
    if (!i) return;
    const versionChanged = patch.mcVersion && patch.mcVersion !== i.mcVersion;
    Object.assign(i, patch, { id });
    if (versionChanged) { i.loaderVersion = null; i.packInstalled = false; }
    if (patch.modpack) {
      if (i.modpack === 'nore' && !NORE_VERSIONS.includes(i.mcVersion)) { i.modpack = 'fabric'; i.perfPack = true; }
      i.loader = i.modpack === 'vanilla' ? 'vanilla' : 'fabric';
      i.noreClient = i.modpack === 'nore';
      if (i.modpack === 'vanilla') i.perfPack = false;
      i.packInstalled = false;
    } else if (versionChanged && i.modpack === 'nore' && !NORE_VERSIONS.includes(i.mcVersion)) {
      i.modpack = 'fabric'; i.noreClient = false; i.perfPack = true;
    }
    if (patch.perfPack !== undefined) i.packInstalled = false;
  });
  return get(id);
}

async function remove(id, deleteFiles) {
  const inst = get(id);
  store.update(d => {
    d.instances = d.instances.filter(x => x.id !== id);
    if (d.selectedInstance === id) d.selectedInstance = d.instances[0] ? d.instances[0].id : null;
  });
  if (inst && deleteFiles) await fsp.rm(inst.gameDir, { recursive: true, force: true });
}

/** Creates the default "Nore Client" instance on first start. */
function ensureDefault() {
  if (store.get().instances.length) return;
  create({ name: 'Nore Client', mcVersion: NORE_MC_VERSION, loader: 'fabric', noreClient: true, color: 0 });
}

async function worlds(id) {
  const inst = get(id);
  if (!inst) return [];
  try {
    const dirs = await fsp.readdir(path.join(inst.gameDir, 'saves'), { withFileTypes: true });
    return dirs.filter(d => d.isDirectory()).map(d => d.name).sort();
  } catch {
    return [];
  }
}

async function dirSize(p) {
  let total = 0;
  try {
    const st = await fsp.stat(p);
    if (!st.isDirectory()) return st.size;
    for (const e of await fsp.readdir(p)) total += await dirSize(path.join(p, e));
  } catch { /* missing */ }
  return total;
}

async function worldsInfo(id) {
  const inst = get(id);
  if (!inst) return [];
  const out = [];
  for (const name of await worlds(id)) {
    const wdir = path.join(inst.gameDir, 'saves', name);
    let mtime = 0;
    try { mtime = (await fsp.stat(path.join(wdir, 'level.dat'))).mtimeMs; } catch { /* broken world */ }
    let icon = null;
    try { icon = 'data:image/png;base64,' + (await fsp.readFile(path.join(wdir, 'icon.png'))).toString('base64'); } catch { /* no icon */ }
    out.push({ name, size: await dirSize(wdir), lastPlayed: mtime, icon });
  }
  return out.sort((a, b) => b.lastPlayed - a.lastPlayed);
}

async function screenshots(id, limit = 24) {
  const inst = get(id);
  if (!inst) return [];
  const sdir = path.join(inst.gameDir, 'screenshots');
  let files = [];
  try { files = (await fsp.readdir(sdir)).filter(f => /\.png$/i.test(f)); } catch { return []; }
  const withTime = await Promise.all(files.map(async f => ({ f, t: (await fsp.stat(path.join(sdir, f))).mtimeMs })));
  withTime.sort((a, b) => b.t - a.t);
  return Promise.all(withTime.slice(0, limit).map(async ({ f, t }) => ({
    name: f, time: t, path: path.join(sdir, f),
    data: 'data:image/png;base64,' + (await fsp.readFile(path.join(sdir, f))).toString('base64'),
  })));
}

module.exports = { list, get, create, update, remove, ensureDefault, worlds, worldsInfo, screenshots, dirSize, gameDir, NORE_MC_VERSION, NORE_VERSIONS };
