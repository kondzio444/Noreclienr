'use strict';
/*
 * Performance mods for every modded instance, modpacks included – done safely:
 *  - what the pack / player already has is detected by mod id (fabric.mod.json, mods.toml) and
 *    file name, so nothing is ever doubled or downgraded (a pack's own Sodium always wins),
 *  - known conflicts are respected (OptiFine, Embeddium vs Sodium, VulkanMod, Iris with a bundled
 *    Sodium, ViaFabricPlus vs Krypton...),
 *  - exact versions for the instance's Minecraft + loader come from Modrinth with their required
 *    dependencies (a dependency the pack already has is not downloaded again),
 *  - every added file is recorded in the instance (perfAdded), so pack updates keep them, the
 *    player can remove them in one click and crash repair can take back the one that broke the game.
 * Planning (planPerfMods, blamePerf) is pure and covered by tests.
 */
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const AdmZip = require('adm-zip');

/** Bumped when the catalog changes, so instances are checked again once. */
const CATALOG_VERSION = 2;

/**
 * slug: Modrinth project, ids: mod ids that mean "already there", loaders: where it exists,
 * group: only one of a group is added (the first Modrinth has a build for), conflicts: mod ids
 * (or file-name tokens) that rule it out, pkg: Java packages that appear in its stack frames.
 */
const CATALOG = [
  { slug: 'sodium', title: 'Sodium', group: 'renderer', ids: ['sodium'], loaders: ['fabric', 'quilt', 'neoforge'],
    why: 'Nowy silnik renderowania – zwykle kilka razy więcej FPS', pkg: ['me.jellysquid.mods.sodium', 'net.caffeinemc.mods.sodium'] },
  { slug: 'embeddium', title: 'Embeddium', group: 'renderer', ids: ['embeddium', 'rubidium'], loaders: ['forge', 'neoforge'],
    why: 'Sodium dla Forge / NeoForge – dużo więcej FPS', pkg: ['org.embeddedt.embeddium'] },
  { slug: 'lithium', title: 'Lithium', ids: ['lithium'], loaders: ['fabric', 'quilt', 'neoforge'],
    conflicts: ['canary', 'radium', 'roadrunner'], why: 'Szybsza logika gry: mniej lagów z mobami, redstone i chunkami', pkg: ['me.jellysquid.mods.lithium', 'net.caffeinemc.mods.lithium'] },
  { slug: 'ferrite-core', title: 'FerriteCore', ids: ['ferritecore'], loaders: ['fabric', 'quilt', 'forge', 'neoforge'],
    why: 'Mniejsze zużycie RAM – mniej przycięć od GC', pkg: ['malte0811.ferritecore'] },
  { slug: 'modernfix', title: 'ModernFix', ids: ['modernfix'], loaders: ['fabric', 'quilt', 'forge', 'neoforge'],
    why: 'Szybszy start i mniej RAM w dużych paczkach', pkg: ['org.embeddedt.modernfix'] },
  { slug: 'entityculling', title: 'EntityCulling', ids: ['entityculling'], loaders: ['fabric', 'quilt', 'forge', 'neoforge'],
    conflicts: ['optifine', 'vulkanmod'], why: 'Nie rysuje mobów i skrzyń za ścianami – więcej FPS na serwerach', pkg: ['dev.tr7zw.entityculling'] },
  { slug: 'immediatelyfast', title: 'ImmediatelyFast', ids: ['immediatelyfast'], loaders: ['fabric', 'quilt', 'forge', 'neoforge'],
    conflicts: ['optifine', 'vulkanmod'], why: 'Szybsze rysowanie HUD, tekstu i mobów', pkg: ['net.raphimc.immediatelyfast'] },
  { slug: 'krypton', title: 'Krypton', ids: ['krypton'], loaders: ['fabric', 'quilt'],
    conflicts: ['viafabricplus', 'viafabric', 'raknetify', 'nochatreports_krypton'], why: 'Lżejszy stos sieciowy – mniej lagów na serwerach', pkg: ['me.steinborn.krypton'] },
  { slug: 'moreculling', title: 'MoreCulling', ids: ['moreculling'], loaders: ['fabric', 'quilt'],
    conflicts: ['optifine', 'vulkanmod', 'cullleaves'], why: 'Pomija niewidoczne ściany bloków i liście', pkg: ['ca.fxco.moreculling'] },
  { slug: 'dynamic-fps', title: 'Dynamic FPS', ids: ['dynamic_fps', 'dynamicfps'], loaders: ['fabric', 'quilt', 'forge', 'neoforge'],
    why: 'Mniej FPS w tle i na pauzie – chłodniejszy komputer, płynniej w innych programach', pkg: ['dynamic_fps.impl', 'juliand665.dynamicfps'] },
  { slug: 'badoptimizations', title: 'BadOptimizations', ids: ['badoptimizations'], loaders: ['fabric', 'quilt', 'forge', 'neoforge'],
    conflicts: ['optifine'], why: 'Drobne optymalizacje świateł, nieba i mgły', pkg: ['me.thosea.badoptimizations'] },
];

/** Mods that replace the renderer: no Sodium / Embeddium next to them. */
const RENDERERS = ['sodium', 'embeddium', 'rubidium', 'magnesium', 'xenon', 'optifine', 'optifabric', 'canvas', 'vulkanmod', 'bendyrenderer'];

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

/** File-name tokens of jars without mod metadata (OptiFine is a plain jar). */
function fileTokens(file) {
  const base = String(file).toLowerCase().replace(/\.disabled$/, '').replace(/\.jar$/, '');
  const out = [];
  if (/optifine/.test(base)) out.push('optifine');
  if (/optifabric/.test(base)) out.push('optifabric');
  const head = /^([a-z][a-z_\-]*?)(?:[-_ ]?(?:fabric|forge|neoforge|quilt|mc)?[-_ ]?\d|$)/.exec(base);
  if (head && head[1]) out.push(head[1]);
  return out;
}

/** Everything that counts as "installed": ids of every jar (also switched off ones) + file tokens. */
function presentSet(present) {
  const set = new Set();
  for (const m of present) {
    for (const id of m.ids || []) set.add(norm(id));
    for (const t of fileTokens(m.file)) set.add(norm(t));
  }
  return set;
}

function disabledSet(present) {
  const set = new Set();
  for (const m of present) {
    if (m.enabled !== false) continue;
    for (const id of m.ids || []) set.add(norm(id));
    for (const t of fileTokens(m.file)) set.add(norm(t));
  }
  return set;
}

/**
 * Decides which performance mods to add.
 * present: [{ file, ids, enabled }] – mods of the pack / player (NOT the ones we added),
 * own: [{ slug, file }] – mods added by the launcher earlier, blocked: slugs crash repair took back.
 * Returns { add: [entry], keep: [slug], skip: [{ slug, title, reason }], drop: [{ slug, file, reason }] }
 * where add entries may share a group (the resolver keeps the first one Modrinth has).
 */
function planPerfMods({ loader, present = [], own = [], blocked = [] }) {
  const out = { add: [], keep: [], skip: [], drop: [] };
  if (!loader || loader === 'vanilla') return out;
  const have = presentSet(present);
  const off = disabledSet(present);
  const ownBy = new Map(own.map(o => [o.slug, o]));
  const has = (ids) => ids.some(id => have.has(norm(id)));
  const rendererTaken = RENDERERS.some(r => have.has(norm(r))) || (have.has('iris') && !have.has('sodium')) || have.has('oculus');
  const iris = have.has('iris') || have.has('oculus');
  for (const c of CATALOG) {
    if (!c.loaders.includes(loader)) continue;
    const mine = ownBy.get(c.slug);
    if (has(c.ids)) {
      // the pack (or the player) has it now: ours would be a duplicate
      if (mine) out.drop.push({ slug: c.slug, file: mine.file, reason: 'jest już w paczce' });
      else out.skip.push({ slug: c.slug, title: c.title, reason: c.ids.some(id => off.has(norm(id))) ? 'wyłączony przez gracza' : 'już jest w paczce' });
      continue;
    }
    if (blocked.includes(c.slug)) {
      if (mine) out.drop.push({ slug: c.slug, file: mine.file, reason: 'wyłączony po crashu' });
      out.skip.push({ slug: c.slug, title: c.title, reason: 'zabrany po crashu gry' });
      continue;
    }
    const conflict = (c.conflicts || []).find(id => have.has(norm(id)));
    if (conflict) {
      if (mine) out.drop.push({ slug: c.slug, file: mine.file, reason: `konflikt z ${conflict}` });
      out.skip.push({ slug: c.slug, title: c.title, reason: `konflikt z ${conflict}` });
      continue;
    }
    if (c.group === 'renderer' && rendererTaken) {
      if (mine) out.keep.push(c.slug); // our own renderer from earlier (counted in "have" only for pack mods)
      else out.skip.push({ slug: c.slug, title: c.title, reason: iris ? 'shadery z własnym Sodium / Embeddium' : 'paczka ma inny silnik renderowania' });
      continue;
    }
    if (mine) { out.keep.push(c.slug); continue; }
    out.add.push({ slug: c.slug, title: c.title, why: c.why, group: c.group || null });
  }
  // a renderer we added earlier stays the only one of its group
  const ownRenderer = CATALOG.find(c => c.group === 'renderer' && out.keep.includes(c.slug));
  if (ownRenderer) out.add = out.add.filter(a => a.group !== 'renderer');
  return out;
}

/**
 * Which of our added mods a crash points at: a mixin config of the mod that failed, or its classes in
 * the top frames of an exception. lines: game log; own: [{ slug, file }]. Returns slugs.
 */
function blamePerf(lines, own) {
  const text = Array.isArray(lines) ? lines : String(lines || '').split('\n');
  const slugs = new Set(own.map(o => o.slug));
  const out = new Set();
  // the top frames after every exception header
  const top = [];
  for (let i = 0; i < text.length; i++) {
    if (!/(Exception|Error)\b|Caused by:/.test(text[i]) || /^\s*at /.test(text[i])) continue;
    let n = 0;
    for (let j = i + 1; j < text.length && n < 6; j++) {
      if (!/^\s*at /.test(text[j])) { if (n) break; continue; }
      top.push(text[j]); n++;
    }
  }
  for (const c of CATALOG) {
    if (!slugs.has(c.slug)) continue;
    const ids = c.ids.map(id => id.replace(/[^a-z0-9_]/gi, ''));
    const mixin = new RegExp(`(Mixin apply(?: for mod)? (${ids.join('|')}) failed|\\b(${ids.join('|')})[\\w.-]*\\.mixins\\.json[^\\n]*(fail|error|exception))`, 'i');
    if (text.some(l => mixin.test(l))) { out.add(c.slug); continue; }
    if (top.some(l => c.pkg.some(p => l.includes(`at ${p}.`) || l.includes(`/${p}.`)))) out.add(c.slug);
  }
  return [...out];
}

// ------------------------------------------------------------------ disk + Modrinth (not pure)

const API = 'https://api.modrinth.com/v2';

/** Mod ids of a jar (fabric / quilt / forge / neoforge metadata). */
function jarIds(file) {
  const ids = [];
  let zip;
  try { zip = new AdmZip(file); } catch { return ids; }
  const text = (n) => { const e = zip.getEntry(n); return e ? e.getData().toString('utf8') : null; };
  try {
    const f = text('fabric.mod.json');
    if (f) {
      const j = JSON.parse(f.replace(/^﻿/, '').replace(/[\u0000-\u001f]+/g, ' '));
      if (j.id) ids.push(j.id);
      for (const p of [].concat(j.provides || [])) ids.push(typeof p === 'string' ? p : p.id);
    }
  } catch { /* broken json */ }
  try {
    const q = text('quilt.mod.json');
    if (q) { const j = JSON.parse(q).quilt_loader || {}; if (j.id) ids.push(j.id); }
  } catch { /* broken json */ }
  for (const n of ['META-INF/neoforge.mods.toml', 'META-INF/mods.toml']) {
    const t = text(n);
    if (t) for (const m of t.matchAll(/^\s*modId\s*=\s*["']([^"']+)["']/gm)) ids.push(m[1]);
  }
  return [...new Set(ids.filter(Boolean).map(s => s.toLowerCase()))];
}

const idCache = new Map(); // path|size|mtime → ids

/** Every jar in mods/ (switched off ones too) with its mod ids. */
async function scan(modsDir) {
  let names = [];
  try { names = await fsp.readdir(modsDir); } catch { return []; }
  const out = [];
  for (const file of names) {
    if (!/\.jar(\.disabled)?$/i.test(file)) continue;
    const full = path.join(modsDir, file);
    const st = await fsp.stat(full).catch(() => null);
    if (!st || !st.isFile()) continue;
    const k = `${full}|${st.size}|${st.mtimeMs}`;
    if (!idCache.has(k)) idCache.set(k, jarIds(full));
    out.push({ file, ids: idCache.get(k), enabled: !file.endsWith('.disabled') });
  }
  return out;
}

/** Version of a project for Minecraft + loader: newest release, else newest beta (never alpha). */
async function bestVersion(net, modLoaders, projectId, mcVersion, loader) {
  const params = new URLSearchParams({ game_versions: JSON.stringify([mcVersion]), loaders: JSON.stringify(modLoaders(loader)) });
  // a project Modrinth does not have is "missing"; a network error is thrown (checked again next start)
  const list = await net.getJson(`${API}/project/${encodeURIComponent(projectId)}/version?${params}`).catch((e) => { if (/HTTP 404/.test(e.message)) return []; throw e; });
  return list.find(v => v.version_type === 'release') || list.find(v => v.version_type === 'beta') || null;
}

const primary = (v) => (v.files || []).find(f => f.primary) || (v.files || [])[0];

/**
 * Turns a plan into files to download for this Minecraft + loader, with required dependencies the
 * instance does not have yet. present: scan() result. Returns { files: [...], missing: [{ slug, title }] }.
 */
async function resolve(plan, { mcVersion, loader, present = [] }) {
  const net = require('./net');
  const { modLoaders } = require('./loaders');
  const have = presentSet(present);
  const files = [], missing = [];
  let errors = 0;
  const doneGroups = new Set(), seen = new Set();
  const addDeps = async (v, forSlug, depth) => {
    for (const d of v.dependencies || []) {
      if (d.dependency_type !== 'required' || !d.project_id || seen.has(d.project_id)) continue;
      seen.add(d.project_id);
      const proj = await net.getJson(`${API}/project/${encodeURIComponent(d.project_id)}`).catch(() => null);
      if (!proj) { errors++; continue; }
      if ( have.has(norm(proj.slug)) || have.has(norm(proj.slug).replace(/api$/, ''))) continue;
      let dv = null;
      try {
        dv = d.version_id ? await net.getJson(`${API}/version/${encodeURIComponent(d.version_id)}`) : await bestVersion(net, modLoaders, d.project_id, mcVersion, loader);
      } catch { errors++; continue; }
      const f = dv && primary(dv);
      if (!f) continue;
      files.push({ slug: proj.slug, title: proj.title, version: dv.version_number, versionId: dv.id, projectId: d.project_id, file: f.filename, url: f.url, sha1: f.hashes && f.hashes.sha1, size: f.size, dep: forSlug });
      if (depth < 2) await addDeps(dv, forSlug, depth + 1);
    }
  };
  for (const a of plan.add) {
    if (a.group && doneGroups.has(a.group)) continue;
    let v = null;
    try { v = await bestVersion(net, modLoaders, a.slug, mcVersion, loader); } catch { errors++; break; }
    const f = v && primary(v);
    if (!f) { if (!a.group) missing.push({ slug: a.slug, title: a.title }); continue; }
    if (a.group) doneGroups.add(a.group);
    seen.add(v.project_id);
    files.push({ slug: a.slug, title: a.title, why: a.why, version: v.version_number, versionId: v.id, projectId: v.project_id, file: f.filename, url: f.url, sha1: f.hashes && f.hashes.sha1, size: f.size });
    await addDeps(v, a.slug, 0);
  }
  // a group none of whose members exist for this version
  if (!errors) for (const a of plan.add) if (a.group && !doneGroups.has(a.group) && !missing.some(m => m.slug === a.group)) missing.push({ slug: a.group, title: 'Sodium / Embeddium' });
  return { files, missing, errors };
}

/** Is the performance set on for this instance? (Nore Client instances had it on by default.) */
function enabledFor(inst) {
  if (!inst || !inst.loader || inst.loader === 'vanilla') return false;
  if (inst.perfMods === true) return true;
  if (inst.perfMods === false) return false;
  return !!inst.noreClient;
}

function stateKey(inst) {
  return [CATALOG_VERSION, inst.mcVersion, inst.loader, (inst.pack && (inst.pack.versionId || inst.pack.version)) || ''].join('|');
}

/** What would change in this instance (for the "Optymalizuj" preview and for ensure). */
async function preview(inst, { blocked } = {}) {
  const modsDir = path.join(inst.gameDir, 'mods');
  const all = await scan(modsDir);
  let own = (inst.perfAdded || []).filter(o => all.some(m => m.file === o.file || m.file === o.file + '.disabled'));
  const sameTarget = inst.perfFor && inst.perfFor.mc === inst.mcVersion && inst.perfFor.loader === inst.loader;
  const stale = sameTarget ? [] : own; // built for another Minecraft / loader: replaced
  if (!sameTarget) own = [];
  const ownFiles = new Set([...own, ...stale].flatMap(o => [o.file, o.file + '.disabled']));
  const present = all.filter(m => !ownFiles.has(m.file));
  const plan = planPerfMods({ loader: inst.loader, present, own: own.filter(o => !o.dep), blocked: blocked || inst.perfBlocked || [] });
  const res = await resolve(plan, { mcVersion: inst.mcVersion, loader: inst.loader, present: all.filter(m => !ownFiles.has(m.file) || own.some(o => o.file === m.file)) });
  return { plan, files: res.files, missing: res.missing, errors: res.errors, own, stale, present };
}

/**
 * Brings the instance's performance mods in line with the plan: removes our duplicates / stale
 * files, downloads what is missing and records it. Cheap when nothing changed (no network).
 * Returns { added: [...], removed: [...] } or null when skipped.
 */
async function ensure(inst, { progress = () => {}, log = () => {}, force = false } = {}) {
  const instances = require('./instances');
  if (!enabledFor(inst)) return null;
  const modsDir = path.join(inst.gameDir, 'mods');
  const key = stateKey(inst);
  const recorded = inst.perfAdded || [];
  if (!force && inst.perfKey === key && recorded.every(o => fs.existsSync(path.join(modsDir, o.file)) || fs.existsSync(path.join(modsDir, o.file + '.disabled')))) return null;
  progress({ stage: 'Mody wydajności: sprawdzanie paczki', step: 'nore' });
  // offline: do not hold the start up with retries – the check runs again next time
  try {
    const res = await fetch('https://api.modrinth.com/', { signal: AbortSignal.timeout(4000), headers: { 'User-Agent': require('./net').UA } });
    if (!res.ok) throw new Error('HTTP ' + res.status);
  } catch {
    log('[Launcher] Mody wydajności: Modrinth niedostępny – sprawdzę przy następnym starcie.');
    return null;
  }
  const p = await preview(inst);
  const removed = [];
  const rm = async (file, reason) => {
    for (const f of [file, file + '.disabled']) {
      if (fs.existsSync(path.join(modsDir, f))) { await fsp.rm(path.join(modsDir, f), { force: true }); removed.push({ file: f, reason }); }
    }
  };
  for (const o of p.stale) await rm(o.file, 'inna wersja gry');
  const dropSlugs = new Set(p.plan.drop.map(d => d.slug));
  for (const d of p.plan.drop) await rm(d.file, d.reason);
  // dependencies we added only for a dropped mod go with it
  for (const o of p.own) if (o.dep && dropSlugs.has(o.dep)) await rm(o.file, 'zależność usuniętego moda');
  const keep = p.own.filter(o => !dropSlugs.has(o.slug) && !(o.dep && dropSlugs.has(o.dep)));
  const net = require('./net');
  const added = [];
  let failed = p.errors || 0;
  let i = 0;
  for (const f of p.files) {
    progress({ stage: 'Mody wydajności', current: f.title || f.slug, done: i++, total: p.files.length, step: 'nore' });
    try {
      await net.download(f.url, path.join(modsDir, f.file), { sha1: f.sha1, size: f.size });
      added.push({ slug: f.slug, file: f.file, projectId: f.projectId, versionId: f.versionId, version: f.version, dep: f.dep || null, added: Date.now() });
    } catch (e) {
      failed++;
      log(`[Launcher] ${f.title || f.slug} – nie udało się pobrać (${e.message})`);
    }
  }
  for (const m of p.missing) log(`[Launcher] ${m.title}: brak wersji dla ${inst.mcVersion} (${inst.loader}) – pomijam.`);
  if (p.errors) log('[Launcher] Mody wydajności: brak połączenia z Modrinth – sprawdzę ponownie przy następnym starcie.');
  // with errors (offline) the check runs again on the next start
  instances.update(inst.id, { perfAdded: [...keep, ...added], perfKey: failed ? null : key, perfFor: { mc: inst.mcVersion, loader: inst.loader }, perfModsInstalled: true });
  if (added.length) log(`[Launcher] Dodano mody wydajności: ${added.map(a => a.file).join(', ')}`);
  if (removed.length) log(`[Launcher] Usunięto mody wydajności: ${removed.map(r => `${r.file} (${r.reason})`).join(', ')}`);
  return { added, removed, skipped: p.plan.skip, missing: p.missing };
}

/** Removes every mod the launcher added (switching the set off). */
async function removeAll(inst) {
  const instances = require('./instances');
  const modsDir = path.join(inst.gameDir, 'mods');
  const removed = [];
  for (const o of inst.perfAdded || []) {
    for (const f of [o.file, o.file + '.disabled']) {
      if (fs.existsSync(path.join(modsDir, f))) { await fsp.rm(path.join(modsDir, f), { force: true }); removed.push(f); }
    }
  }
  instances.update(inst.id, { perfAdded: [], perfKey: null, perfMods: false, perfAsked: true });
  return removed;
}

/** Crash repair took one back: remove the file (and deps only it needed) and never add it again. */
async function takeBack(inst, slug) {
  const instances = require('./instances');
  const modsDir = path.join(inst.gameDir, 'mods');
  const own = inst.perfAdded || [];
  const gone = own.filter(o => o.slug === slug || o.dep === slug);
  for (const o of gone) for (const f of [o.file, o.file + '.disabled']) await fsp.rm(path.join(modsDir, f), { force: true }).catch(() => {});
  instances.update(inst.id, {
    perfAdded: own.filter(o => !gone.includes(o)),
    perfBlocked: [...new Set([...(inst.perfBlocked || []), slug])],
  });
  return gone.map(o => o.file);
}

const titleOf = (slug) => (CATALOG.find(c => c.slug === slug) || {}).title || slug;

module.exports = {
  CATALOG, CATALOG_VERSION, RENDERERS, planPerfMods, blamePerf, fileTokens, presentSet, scan, jarIds, resolve, preview, ensure,
  removeAll, takeBack, enabledFor, stateKey, titleOf,
};
