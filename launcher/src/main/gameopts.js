'use strict';
/*
 * Graphics profiles written into options.txt (Profil: Wydajność / Zrównoważony / Jakość).
 * Big modpacks lag on servers mostly because of render / simulation distance: the profile lowers
 * them together with a few heavy options. Applied once when chosen (and on the next start when the
 * file does not exist yet) – later changes made in the game are never overwritten.
 */
const fsp = require('fs/promises');
const path = require('path');

const PROFILES = {
  performance: {
    label: 'Wydajność',
    options: { renderDistance: 8, simulationDistance: 6, graphicsMode: 0, particles: 2, entityShadows: false, biomeBlendRadius: 0, entityDistanceScaling: 0.75, mipmapLevels: 2, maxFps: 260, enableVsync: false },
  },
  balanced: {
    label: 'Zrównoważony',
    options: { renderDistance: 12, simulationDistance: 8, graphicsMode: 1, particles: 1, entityShadows: true, biomeBlendRadius: 1, entityDistanceScaling: 1.0, mipmapLevels: 4 },
  },
  quality: {
    label: 'Jakość',
    options: { renderDistance: 16, simulationDistance: 12, graphicsMode: 1, particles: 0, entityShadows: true, biomeBlendRadius: 2, entityDistanceScaling: 1.0, mipmapLevels: 4 },
  },
};

/** Minecraft before 1.18 has no simulation distance; before 1.16 graphics is "fancyGraphics". */
function keysFor(mcVersion) {
  const m = /^1\.(\d+)/.exec(String(mcVersion || ''));
  const minor = m ? +m[1] : 99;
  return { simulation: minor >= 18, graphicsMode: minor >= 16 };
}

const fmt = (v) => String(v);

/**
 * Returns options.txt text with the profile applied. Unknown lines and every other option stay as
 * they are; missing keys are appended.
 */
function applyProfile(text, profile, mcVersion) {
  const p = PROFILES[profile];
  if (!p) return text || '';
  const k = keysFor(mcVersion);
  const want = { ...p.options };
  if (!k.simulation) delete want.simulationDistance;
  if (!k.graphicsMode) { want.fancyGraphics = want.graphicsMode > 0; delete want.graphicsMode; }
  const lines = String(text || '').split(/\r?\n/);
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  const seen = new Set();
  const out = lines.map(line => {
    const i = line.indexOf(':');
    if (i <= 0) return line;
    const key = line.slice(0, i);
    if (!(key in want)) return line;
    seen.add(key);
    return `${key}:${fmt(want[key])}`;
  });
  for (const [key, v] of Object.entries(want)) if (!seen.has(key)) out.push(`${key}:${fmt(v)}`);
  return out.join('\n') + '\n';
}

/** Reads one option from options.txt text (string value or null). */
function readOption(text, key) {
  const m = new RegExp(`^${key}:(.*)$`, 'm').exec(String(text || ''));
  return m ? m[1].trim() : null;
}

/** Applies a profile to an instance's options.txt. Returns true when written. */
async function applyToInstance(inst, profile) {
  if (!PROFILES[profile]) return false;
  const file = path.join(inst.gameDir, 'options.txt');
  const text = await fsp.readFile(file, 'utf8').catch(() => '');
  await fsp.mkdir(inst.gameDir, { recursive: true });
  await fsp.writeFile(file, applyProfile(text, profile, inst.mcVersion));
  return true;
}

module.exports = { PROFILES, applyProfile, readOption, applyToInstance, keysFor };
