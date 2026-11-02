'use strict';
/*
 * Importing instances from other launchers: Prism Launcher / MultiMC (instance.cfg + mmc-pack.json),
 * the CurseForge app (minecraftinstance.json) and the older Modrinth App (profile.json). The folder
 * is recognised, Minecraft version + loader read, then the game folder (mods, configs, worlds,
 * resource packs, shaders, options) is copied into a new Nore instance – the source stays untouched.
 * Modpack files (.mrpack / CurseForge .zip) are imported by modpacks.installFile.
 */
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

const readJson = (file) => { try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, '')); } catch { return null; } };
const readText = (file) => { try { return fs.readFileSync(file, 'utf8'); } catch { return null; } };

/** key=value lines of MultiMC / Prism instance.cfg. */
function parseCfg(text) {
  const out = {};
  for (const line of String(text || '').split(/\r?\n/)) {
    const i = line.indexOf('=');
    if (i > 0 && !line.startsWith('[')) out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out;
}

const PRISM_UIDS = {
  'net.fabricmc.fabric-loader': 'fabric',
  'org.quiltmc.quilt-loader': 'quilt',
  'net.minecraftforge': 'forge',
  'net.neoforged': 'neoforge',
};

/** mmc-pack.json → { mcVersion, loader, loaderVersion }. */
function fromMmcPack(pack) {
  const comps = (pack && pack.components) || [];
  const ver = (c) => c.version || c.cachedVersion || null;
  const mc = comps.find(c => c.uid === 'net.minecraft');
  let loader = 'vanilla', loaderVersion = null;
  for (const c of comps) if (PRISM_UIDS[c.uid]) { loader = PRISM_UIDS[c.uid]; loaderVersion = ver(c); break; }
  return { mcVersion: mc ? ver(mc) : null, loader, loaderVersion };
}

/** "forge-47.2.0" / "neoforge-21.1.80" / "fabric-0.15.7-1.20.1" → { loader, loaderVersion }. */
function fromLoaderName(name, mc) {
  const m = /^(forge|neoforge|fabric|quilt)-(.+)$/i.exec(String(name || ''));
  if (!m) return { loader: 'vanilla', loaderVersion: null };
  let v = m[2];
  if (mc && v.endsWith('-' + mc)) v = v.slice(0, -(mc.length + 1));
  if (mc && v.startsWith(mc + '-')) v = v.slice(mc.length + 1);
  return { loader: m[1].toLowerCase(), loaderVersion: v };
}

/**
 * Recognises an instance folder of another launcher. Returns
 * { type, label, name, mcVersion, loader, loaderVersion, gameDir, memoryMb, jvmArgs } or null.
 */
function detect(dir) {
  // Prism Launcher / MultiMC
  const pack = readJson(path.join(dir, 'mmc-pack.json'));
  const cfgText = readText(path.join(dir, 'instance.cfg'));
  if (pack || cfgText) {
    const cfg = parseCfg(cfgText);
    const v = pack ? fromMmcPack(pack) : { mcVersion: cfg.IntendedVersion || null, loader: 'vanilla', loaderVersion: null };
    const gameDir = ['.minecraft', 'minecraft'].map(d => path.join(dir, d)).find(d => fs.existsSync(d)) || path.join(dir, '.minecraft');
    return {
      type: 'prism', label: 'Prism Launcher / MultiMC', name: cfg.name || path.basename(dir), ...v, gameDir,
      memoryMb: cfg.OverrideMemory === 'true' ? parseInt(cfg.MaxMemAlloc, 10) || 0 : 0,
      jvmArgs: cfg.OverrideJavaArgs === 'true' ? cfg.JvmArgs || '' : '',
    };
  }
  // CurseForge app
  const cf = readJson(path.join(dir, 'minecraftinstance.json'));
  if (cf && (cf.gameVersion || (cf.baseModLoader && cf.baseModLoader.minecraftVersion))) {
    const mc = cf.gameVersion || cf.baseModLoader.minecraftVersion;
    return {
      type: 'curseforge', label: 'CurseForge', name: cf.name || path.basename(dir), mcVersion: mc,
      ...fromLoaderName(cf.baseModLoader && cf.baseModLoader.name, mc), gameDir: dir,
      memoryMb: cf.isMemoryOverride || cf.allocatedMemory ? parseInt(cf.allocatedMemory, 10) || 0 : 0,
      jvmArgs: cf.javaArgsOverride || '',
    };
  }
  // Modrinth App (profile.json)
  const mr = readJson(path.join(dir, 'profile.json'));
  if (mr && mr.metadata && mr.metadata.game_version) {
    const m = mr.metadata;
    const loader = ['fabric', 'quilt', 'forge', 'neoforge'].includes(m.loader) ? m.loader : 'vanilla';
    return {
      type: 'modrinth', label: 'Modrinth App', name: m.name || path.basename(dir), mcVersion: m.game_version, loader,
      loaderVersion: loader === 'vanilla' ? null : (m.loader_version && (m.loader_version.id || m.loader_version)) || null,
      gameDir: dir, memoryMb: (mr.memory && mr.memory.maximum) || 0, jvmArgs: '',
    };
  }
  return null;
}

/** Never copied: launcher-specific or regenerated folders. */
const SKIP = new Set(['logs', 'crash-reports', 'natives', '.cache', '.fabric', 'webcache', 'webcache2', 'downloads', '.mixin.out', 'instance.cfg', 'mmc-pack.json', 'minecraftinstance.json', 'profile.json', 'patches', 'libraries', 'icon.png']);

/** Copies the game folder of a detected instance into dest (no overwrites of what is already there). */
async function copyGame(found, dest, onProgress = () => {}) {
  const names = await fsp.readdir(found.gameDir).catch(() => []);
  let done = 0;
  for (const n of names) {
    done++;
    if (SKIP.has(n.toLowerCase())) continue;
    onProgress({ stage: 'Kopiowanie plików instancji', current: n, done, total: names.length });
    await fsp.cp(path.join(found.gameDir, n), path.join(dest, n), { recursive: true, force: false, errorOnExist: false });
  }
}

module.exports = { detect, copyGame, parseCfg, fromMmcPack, fromLoaderName };
