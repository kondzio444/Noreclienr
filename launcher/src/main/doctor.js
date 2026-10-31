'use strict';
/*
 * Automatic repair of broken instances.
 *  - preflight (before every launch, offline): duplicate mods (two versions of the same mod) and
 *    mods made for another loader (Fabric mod in a NeoForge instance etc.) are disabled
 *  - deep check (Modrinth): mods built for another Minecraft version are updated to a matching
 *    version or disabled
 *  - crash analysis: known errors in the game log (module conflicts, missing dependencies,
 *    wrong Java, out of memory, broken mixins) are turned into fixes
 * Disabled files get the ".disabled" suffix, so nothing is lost and they can be switched back.
 */
const fsp = require('fs/promises');
const path = require('path');
const os = require('os');
const AdmZip = require('adm-zip');
const modrinth = require('./modrinth');
const instances = require('./instances');
const store = require('./store');
const perf = require('./perf');
const jvm = require('./jvm');

const LOADER_NAMES = { fabric: 'Fabric', quilt: 'Quilt', forge: 'Forge', neoforge: 'NeoForge', vanilla: 'Vanilla' };
const ln = (l) => LOADER_NAMES[l] || l;

function modsDir(inst) { return path.join(inst.gameDir, 'mods'); }

/** Reads the loader metadata of a mod jar: ids, loaders, version, module name. */
function readJar(file) {
  const out = { ids: [], loaders: new Set(), version: '', module: null, name: null };
  let zip;
  try { zip = new AdmZip(file); } catch { return out; }
  const text = (name) => { const e = zip.getEntry(name); return e ? e.getData().toString('utf8') : null; };
  try {
    const fmj = text('fabric.mod.json');
    if (fmj) {
      const j = JSON.parse(fmj.replace(/^﻿/, '').replace(/[\u0000-\u001f]+/g, ' '));
      out.ids.push(j.id); out.version = j.version || out.version; out.name = j.name || out.name; out.loaders.add('fabric');
      for (const p of [].concat(j.provides || [])) out.ids.push(typeof p === 'string' ? p : p.id);
    }
  } catch { /* broken json */ }
  try {
    const qmj = text('quilt.mod.json');
    if (qmj) {
      const q = JSON.parse(qmj).quilt_loader || {};
      if (q.id) out.ids.push(q.id);
      out.version = q.version || out.version; out.loaders.add('quilt');
    }
  } catch { /* broken json */ }
  for (const [name, loader] of [['META-INF/neoforge.mods.toml', 'neoforge'], ['META-INF/mods.toml', 'forge']]) {
    const toml = text(name);
    if (!toml) continue;
    out.loaders.add(loader);
    for (const m of toml.matchAll(/^\s*modId\s*=\s*["']([^"']+)["']/gm)) out.ids.push(m[1]);
    const v = /^\s*version\s*=\s*["']([^"']+)["']/m.exec(toml);
    if (v && !out.version) out.version = v[1];
    const n = /^\s*displayName\s*=\s*["']([^"']+)["']/m.exec(toml);
    if (n && !out.name) out.name = n[1];
  }
  const mf = text('META-INF/MANIFEST.MF');
  if (mf) {
    const m = /Automatic-Module-Name:\s*(\S+)/.exec(mf);
    if (m) out.module = m[1];
  }
  out.ids = [...new Set(out.ids.filter(Boolean).map(s => s.toLowerCase()))];
  return out;
}

async function scanMods(inst) {
  const dir = modsDir(inst);
  let names = [];
  try { names = await fsp.readdir(dir); } catch { return []; }
  const out = [];
  for (const file of names) {
    if (!file.toLowerCase().endsWith('.jar')) continue;
    const full = path.join(dir, file);
    const st = await fsp.stat(full).catch(() => null);
    if (!st || !st.isFile()) continue;
    out.push({ file, mtime: st.mtimeMs, size: st.size, ...readJar(full) });
  }
  return out;
}

/** Can a mod with these loaders run on the instance loader? */
function loaderOk(mod, loader) {
  if (!mod.loaders.size) return true; // a plain library jar
  if (loader === 'fabric') return mod.loaders.has('fabric');
  if (loader === 'quilt') return mod.loaders.has('quilt') || mod.loaders.has('fabric');
  if (loader === 'neoforge') return mod.loaders.has('neoforge') || mod.loaders.has('forge');
  if (loader === 'forge') return mod.loaders.has('forge');
  return false;
}

function cmpVersion(a, b) {
  const pa = String(a).split(/[.+\-_ ]/).map(n => parseInt(n, 10)), pb = String(b).split(/[.+\-_ ]/).map(n => parseInt(n, 10));
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = isNaN(pa[i]) ? -1 : pa[i], y = isNaN(pb[i]) ? -1 : pb[i];
    if (x !== y) return x - y;
  }
  return 0;
}

const LIBRARY_IDS = new Set(['fabricloader', 'java', 'minecraft', 'forge', 'neoforge', 'quilt_loader', 'mixinextras']);

/** Offline checks run before every launch. */
async function preflight(inst) {
  const problems = [];
  if (!inst.loader || inst.loader === 'vanilla') return problems;
  const mods = await scanMods(inst);
  // mods for another loader
  for (const m of mods) {
    if (!loaderOk(m, inst.loader)) {
      problems.push({ kind: 'wrong-loader', file: m.file, title: `${m.name || m.file} jest dla ${[...m.loaders].map(ln).join('/')}`,
        detail: `Instancja używa ${ln(inst.loader)} – ten mod nie zadziała i może wywalić grę.`, fix: { action: 'disable', file: m.file } });
    }
  }
  // the same mod twice (keep the newest version)
  const byId = new Map();
  for (const m of mods) {
    if (!loaderOk(m, inst.loader)) continue;
    const main = m.ids.find(id => !LIBRARY_IDS.has(id));
    if (!main) continue;
    if (!byId.has(main)) byId.set(main, []);
    byId.get(main).push(m);
  }
  for (const [id, list] of byId) {
    if (list.length < 2) continue;
    list.sort((a, b) => cmpVersion(b.version, a.version) || b.mtime - a.mtime);
    for (const old of list.slice(1)) {
      problems.push({ kind: 'duplicate', file: old.file, title: `Zdublowany mod: ${list[0].name || id}`,
        detail: `Zostaje ${list[0].file}${list[0].version ? ` (${list[0].version})` : ''}, wyłączam starszy ${old.file}.`, fix: { action: 'disable', file: old.file } });
    }
  }
  return problems;
}

/** Online check: mods built for another Minecraft version or loader (by Modrinth hash). */
async function deepCheck(inst) {
  const problems = await preflight(inst);
  if (!inst.loader || inst.loader === 'vanilla') return problems;
  const flagged = new Set(problems.map(p => p.file));
  let meta = {};
  try { meta = await modrinth.identify(modsDir(inst), ['.jar']); } catch { return problems; }
  for (const [file, m] of Object.entries(meta)) {
    if (flagged.has(file) || file.endsWith('.disabled') || !m.gameVersions) continue;
    if (!m.gameVersions.includes(inst.mcVersion)) {
      problems.push({ kind: 'wrong-version', file, title: `${m.title || file} jest dla Minecraft ${m.gameVersions.slice(-1)[0] || '?'}`,
        detail: `Instancja to ${inst.mcVersion} – pobiorę pasującą wersję albo wyłączę mod.`, fix: { action: 'replace', file, projectId: m.projectId } });
    }
  }
  return problems;
}

// ------------------------------------------------------------------ crash analysis

function findJars(mods, id) {
  const base = id.toLowerCase().replace(/_service$|_api$|-api$/, '');
  return mods.filter(m => m.ids.some(x => x === id.toLowerCase() || x === base) || (m.module && m.module.toLowerCase() === id.toLowerCase()));
}

/** Turns the last lines of a crashed game into problems with fixes. */
async function analyzeLog(inst, lines) {
  const text = lines.join('\n');
  const problems = [];
  const seen = new Set();
  const add = (p) => { const k = p.kind + (p.fix && JSON.stringify(p.fix)); if (!seen.has(k)) { seen.add(k); problems.push(p); } };
  const mods = await scanMods(inst);

  // 1. two modules export the same package (two copies / versions of one mod)
  for (const m of text.matchAll(/Modules (\S+) and (\S+) export package (\S+)/g)) {
    const cands = [...findJars(mods, m[1]), ...findJars(mods, m[2])].filter((v, i, a) => a.indexOf(v) === i);
    if (cands.length >= 2) {
      cands.sort((a, b) => cmpVersion(b.version, a.version) || b.mtime - a.mtime);
      for (const old of cands.slice(1)) {
        add({ kind: 'module-conflict', file: old.file, title: `Konflikt modułów: ${m[1]} i ${m[2]}`,
          detail: `Dwie kopie tego samego moda. Zostaje ${cands[0].file}, wyłączam ${old.file}.`, fix: { action: 'disable', file: old.file } });
      }
    } else if (cands.length === 1) {
      add({ kind: 'module-conflict', file: cands[0].file, title: `Konflikt modułów: ${m[1]} i ${m[2]}`,
        detail: `${cands[0].file} gryzie się z modem, który zawiera go w środku – wyłączam osobną kopię.`, fix: { action: 'disable', file: cands[0].file } });
    }
  }
  // 2. Fabric: missing dependency / wrong version of a dependency / wrong Minecraft
  for (const m of text.matchAll(/Mod '([^']+)' \(([^)]+)\) \S* ?requires (?:any version|version \S+)(?: or later)? of (?:mod )?'([^']+)' \(([^)]+)\), which is missing/g)) {
    if (LIBRARY_IDS.has(m[4])) continue;
    add({ kind: 'missing-dep', title: `Brakuje moda ${m[3]}`, detail: `Wymaga go ${m[1]} – pobiorę go z Modrinth.`, fix: { action: 'install', id: m[4] } });
  }
  for (const m of text.matchAll(/Mod '([^']+)' \(([^)]+)\) \S* ?requires (?:version \S+|any version)(?: or later)? of (?:mod )?'([^']+)' \(([^)]+)\), but only the wrong version is present/g)) {
    if (m[4] === 'minecraft' || m[4] === 'java') {
      const jar = findJars(mods, m[2])[0];
      if (jar) add({ kind: 'wrong-version', file: jar.file, title: `${m[1]} jest dla innej wersji ${m[3]}`, detail: 'Pobiorę pasującą wersję albo wyłączę mod.', fix: { action: 'replace', file: jar.file, slug: m[2] } });
    } else if (!LIBRARY_IDS.has(m[4])) {
      const jar = findJars(mods, m[4])[0];
      add({ kind: 'dep-version', file: jar && jar.file, title: `Zła wersja moda ${m[3]}`, detail: `Wymaga jej ${m[1]} – zaktualizuję ${m[3]}.`, fix: { action: 'replace', file: jar && jar.file, slug: m[4] } });
    }
  }
  for (const m of text.matchAll(/Mod '([^']+)' \(([^)]+)\) \S* ?is incompatible with (?:any version|version \S+) of (?:mod )?'([^']+)' \(([^)]+)\)/g)) {
    const jar = findJars(mods, m[2])[0];
    if (jar) add({ kind: 'incompatible', file: jar.file, title: `${m[1]} nie działa z ${m[3]}`, detail: `Wyłączam ${jar.file}.`, fix: { action: 'disable', file: jar.file } });
  }
  // 3. Forge / NeoForge: missing mandatory dependencies
  for (const m of text.matchAll(/Mod ID: '([^']+)', Requested by: '([^']+)', Expected range: '([^']*)', Actual version: '\[?MISSING\]?'/g)) {
    if (LIBRARY_IDS.has(m[1])) continue;
    add({ kind: 'missing-dep', title: `Brakuje moda ${m[1]}`, detail: `Wymaga go ${m[2]} – pobiorę go z Modrinth.`, fix: { action: 'install', id: m[1] } });
  }
  for (const m of text.matchAll(/Mod ID: '([^']+)', Requested by: '([^']+)', Expected range: '([^']*)', Actual version: '([^'M][^']*)'/g)) {
    if (LIBRARY_IDS.has(m[1])) continue;
    const jar = findJars(mods, m[1])[0];
    add({ kind: 'dep-version', file: jar && jar.file, title: `Zła wersja moda ${m[1]}`, detail: `${m[2]} wymaga ${m[3]}, jest ${m[4]} – zaktualizuję.`, fix: { action: 'replace', file: jar && jar.file, slug: m[1] } });
  }
  // 4. duplicate mod ids reported by the loaders
  for (const m of text.matchAll(/(?:Duplicate mods found|Found duplicate mods?|DuplicateModsFoundException)[\s\S]{0,400}?\(([a-z0-9_\-]+)\)/gi)) {
    const jars = findJars(mods, m[1]).sort((a, b) => cmpVersion(b.version, a.version) || b.mtime - a.mtime);
    for (const old of jars.slice(1)) add({ kind: 'duplicate', file: old.file, title: `Zdublowany mod: ${m[1]}`, detail: `Wyłączam starszy ${old.file}.`, fix: { action: 'disable', file: old.file } });
  }
  // 5. Java too old / too new
  if (/UnsupportedClassVersionError|compiled by a more recent version of the Java Runtime|Unsupported class file major version/.test(text)) {
    add({ kind: 'java', title: 'Zła wersja Javy', detail: 'Mod albo gra wymaga nowszej Javy – przełączam na Javę dobieraną automatycznie.', fix: { action: 'auto-java' } });
  }
  // 6. out of memory
  if (/java\.lang\.OutOfMemoryError/.test(text)) {
    const totalMb = Math.round(os.totalmem() / 1048576);
    const size = await jvm.countMods(inst.gameDir);
    const cur = inst.memoryMb || store.get().settings.memoryMb || jvm.autoMemoryMb({ ...size, loader: inst.loader, totalMb });
    const next = Math.min(jvm.maxGameMb(totalMb), cur + 2048);
    if (next > cur) add({ kind: 'memory', title: 'Zabrakło pamięci RAM', detail: `Zwiększam pamięć instancji z ${(cur / 1024).toFixed(1)} do ${(next / 1024).toFixed(1)} GB.`, fix: { action: 'memory', mb: next } });
  }
  // 7. a mixin that cannot be applied (mod built for another version of the game)
  for (const m of text.matchAll(/Mixin apply(?: for mod)? ([a-z0-9_\-]+) failed|from mod ([a-z0-9_\-]+)\] .*?(?:InvalidInjectionException|InvalidMixinException|MixinApplyError)/gi)) {
    const id = m[1] || m[2];
    if (!id || id === 'noreclient') continue;
    const jar = findJars(mods, id)[0];
    if (jar) add({ kind: 'mixin', file: jar.file, title: `Mod ${jar.name || id} nie pasuje do tej wersji gry`, detail: 'Pobiorę pasującą wersję albo wyłączę mod.', fix: { action: 'replace', file: jar.file, slug: id } });
  }
  // 8. the client was started with mods for the wrong loader (preflight finds them too)
  if (/NoClassDefFoundError: net\/fabricmc|Mod resolution failed|Incompatible mods found|Missing or unsupported mandatory dependencies|LoadingFailedException/.test(text) || !problems.length) {
    for (const p of await preflight(inst)) add(p);
  }
  perfAware(inst, problems, lines, add);
  return problems;
}

/**
 * Performance mods the launcher added itself are taken back instead of being "fixed": the problem
 * points at one of them (or its classes / mixins are at the top of the crash), so it is removed and
 * not added to this instance again.
 */
function perfAware(inst, problems, lines, add) {
  const own = inst.perfAdded || [];
  if (!own.length) return;
  const byFile = new Map(own.flatMap(o => [[o.file, o], [o.file + '.disabled', o]]));
  const taken = new Set();
  for (const p of problems) {
    const o = p.file && byFile.get(p.file);
    if (!o) continue;
    const slug = o.dep || o.slug;
    p.fix = { action: 'perf-remove', slug, file: o.file };
    p.detail = `${perf.titleOf(slug)} dodał launcher (Mody wydajności) – usuwam go i nie dodam ponownie w tej instancji.`;
    taken.add(slug);
  }
  for (const slug of perf.blamePerf(lines, own)) {
    if (taken.has(slug)) continue;
    add({ kind: 'perf', title: `Mod wydajności ${perf.titleOf(slug)} wywala grę`, detail: 'Dodał go launcher – usuwam go i nie dodam ponownie w tej instancji (przywrócisz go przyciskiem Optymalizuj).',
      fix: { action: 'perf-remove', slug } });
  }
}

// ------------------------------------------------------------------ fixes

async function disable(inst, file) {
  if (!file) return false;
  const from = path.join(modsDir(inst), file);
  await fsp.rename(from, from + '.disabled');
  return true;
}

async function install(inst, idOrSlug) {
  return modrinth.install({ projectId: idOrSlug, kind: 'mod', gameVersion: inst.mcVersion, loader: inst.loader, targetDir: modsDir(inst) });
}

/** Replaces a mod with the version for this instance; disables it when there is none. */
async function replace(inst, file, projectId) {
  try {
    const files = await install(inst, projectId);
    if (file && !files.includes(file)) await fsp.rm(path.join(modsDir(inst), file), { force: true });
    return `zaktualizowano (${files[0]})`;
  } catch {
    if (file) await disable(inst, file).catch(() => {});
    return 'brak zgodnej wersji – wyłączono';
  }
}

/** Applies the fixes; returns the problems with result strings. */
async function apply(inst, problems) {
  const done = [];
  for (const p of problems) {
    const f = p.fix || {};
    let result = null;
    try {
      if (f.action === 'disable') { await disable(inst, f.file); result = 'wyłączono'; }
      else if (f.action === 'install') { await install(inst, f.id); result = 'pobrano'; }
      else if (f.action === 'replace') result = await replace(inst, f.file, f.projectId || f.slug);
      else if (f.action === 'memory') { instances.update(inst.id, { memoryMb: f.mb }); result = 'zwiększono'; }
      else if (f.action === 'perf-remove') { const gone = await perf.takeBack(instances.get(inst.id) || inst, f.slug); result = gone.length ? `usunięto ${gone.join(', ')}` : 'zablokowano'; }
      else if (f.action === 'auto-java') { store.update(d => { d.settings.javaPath = ''; }); result = 'ustawiono automatyczną Javę'; }
    } catch (e) {
      result = 'nie udało się: ' + e.message;
    }
    done.push({ ...p, result });
  }
  return done;
}

module.exports = { preflight, deepCheck, analyzeLog, apply, scanMods, readJar, perfAware };
