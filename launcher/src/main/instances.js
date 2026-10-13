'use strict';
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const paths = require('./paths');
const store = require('./store');

const NORE_MC_VERSION = '1.21.1';

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

function create({ name, mcVersion, loader = 'vanilla', loaderVersion = null, noreClient = false, color = 0 }) {
  const inst = {
    id: slug(name), name: name.trim() || mcVersion, mcVersion, loader, loaderVersion,
    noreClient: !!noreClient && loader === 'fabric' && mcVersion === NORE_MC_VERSION,
    color, created: Date.now(), lastPlayed: 0, playTime: 0, memoryMb: 0, joinServer: '',
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
    if (i) Object.assign(i, patch, { id });
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

module.exports = { list, get, create, update, remove, ensureDefault, worlds, gameDir, NORE_MC_VERSION };
