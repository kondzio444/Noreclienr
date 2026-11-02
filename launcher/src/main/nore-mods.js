'use strict';
// Bundled Nore Client jars: one per platform (group of Minecraft versions), listed in index.json.
const fs = require('fs');
const path = require('path');

const DIRS = [
  path.join(process.resourcesPath || '', 'nore', 'mods'),
  path.join(__dirname, '..', '..', 'resources', 'mods'),
];

let cached;
function load() {
  if (cached) return cached;
  for (const dir of DIRS) {
    try {
      const list = JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8'));
      return (cached = { dir, list: list.filter(p => fs.existsSync(path.join(dir, p.file))) });
    } catch { /* try the next location */ }
  }
  return (cached = { dir: null, list: [] });
}

/** Minecraft versions some bundled Nore Client jar supports. */
function versions() {
  return load().list.flatMap(p => p.versions);
}

function platformFor(mcVersion) {
  return load().list.find(p => p.versions.includes(mcVersion)) || null;
}

/** Absolute path of the jar for this Minecraft version, or null. */
function jarFor(mcVersion) {
  const p = platformFor(mcVersion);
  return p ? path.join(load().dir, p.file) : null;
}

module.exports = { versions, platformFor, jarFor };
