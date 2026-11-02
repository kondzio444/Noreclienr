'use strict';
/*
 * What is inside a mod / plugin jar: id, name, version, loader, which side it runs on and what it
 * depends on (fabric.mod.json, quilt.mod.json, META-INF/mods.toml / neoforge.mods.toml, mcmod.info,
 * plugin.yml, paper-plugin.yml, velocity-plugin.json, bungee.yml), plus the analysis of a whole
 * folder: who depends on whom, missing dependencies, conflicts and duplicates.
 *
 * parseMeta() and analyze() are pure (the reader is passed in) so they are easy to test and port.
 */
const fs = require('fs');
const AdmZip = require('adm-zip');
const { parseToml } = require('./config-edit');

/** Dependency ids that the loader / game itself provides. */
const BUILTIN = new Set([
  'minecraft', 'java', 'fabricloader', 'fabric-loader', 'quilt_loader', 'quilt-loader', 'forge', 'neoforge', 'javafml', 'lowcodefml',
  'mcp', 'fml', 'mixinextras', 'mixin', 'quilted_fabric_api_base',
]);
/** Bukkit / Paper names that are the server itself. */
const BUILTIN_PLUGINS = new Set(['bukkit', 'spigot', 'paper', 'purpur', 'folia', 'velocity', 'bungeecord', 'waterfall']);

const side = (env) => (env === 'client' ? 'client' : env === 'server' ? 'server' : env === '*' || env === 'both' ? 'both' : 'unknown');

function asList(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v;
  if (typeof v === 'string') return [v];
  return Object.keys(v);
}

/** Tiny YAML reader for plugin.yml: top-level scalars and lists ("[a, b]" or "- a" lines). */
function yamlTop(text) {
  const out = {};
  const lines = String(text).split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const m = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(lines[i]);
    if (!m) continue;
    let v = m[2].replace(/\s+#.*$/, '').trim();
    if (v.startsWith('[')) v = v.replace(/^\[|\]$/g, '').split(',').map(s => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
    else if (v === '' || v === '|' || v === '>') {
      const list = [];
      const map = {};
      while (i + 1 < lines.length && /^(\s+|$)/.test(lines[i + 1]) && lines[i + 1] !== undefined) {
        const l = lines[++i];
        if (!l.trim()) continue;
        const li = /^\s+-\s*(.+)$/.exec(l);
        if (li) list.push(li[1].trim().replace(/^['"]|['"]$/g, ''));
        else if (/^\s+[^\s]/.test(l)) {
          const km = /^(\s+)([^:\s]+):\s*(.*)$/.exec(l);
          if (km) map[km[2]] = { indent: km[1].length, value: km[3].trim() };
        }
      }
      v = list.length ? list : Object.keys(map).length ? map : '';
    } else v = v.replace(/^['"]|['"]$/g, '');
    out[m[1]] = v;
  }
  return out;
}

/** paper-plugin.yml dependencies: { server: { Name: { required: true } } } – read as two levels of indentation. */
function paperDeps(text) {
  const req = [], opt = [];
  const lines = String(text).split(/\r?\n/);
  let inDeps = false, inServer = false, cur = null, base = 0;
  for (const l of lines) {
    if (/^dependencies:/.test(l)) { inDeps = true; continue; }
    if (inDeps && /^\S/.test(l)) { inDeps = false; inServer = false; }
    if (!inDeps) continue;
    const m = /^(\s+)([^:\s]+):\s*(.*)$/.exec(l);
    if (!m) continue;
    if (m[2] === 'server' || m[2] === 'bootstrap') { inServer = m[2] === 'server'; base = m[1].length; continue; }
    if (!inServer) continue;
    if (m[1].length === base + 2 || (m[1].length > base && !cur)) { cur = { id: m[2], required: true }; req.push(cur); continue; }
    if (cur && m[2] === 'required' && m[3] === 'false') { req.splice(req.indexOf(cur), 1); opt.push(cur); }
  }
  return { depends: req.map(d => d.id), optional: opt.map(d => d.id) };
}

/** Version of a Forge mod whose mods.toml says ${file.jarVersion}: read the jar manifest. */
function manifestVersion(read) {
  const mf = read('META-INF/MANIFEST.MF');
  return mf ? ((/^Implementation-Version:\s*(.+)$/m.exec(mf) || [])[1] || '').trim() : '';
}

/**
 * read(name) → text or null for a jar entry. Returns { id, name, version, loader, side, depends,
 * optional, breaks, provides, description, authors, kind: 'mod'|'plugin' } or null.
 */
function parseMeta(read) {
  const fmj = read('fabric.mod.json');
  if (fmj) {
    let j;
    try { j = JSON.parse(fmj.replace(/^﻿/, '').replace(/[\u0000-\u0019]+/g, ' ')); } catch { j = null; }
    if (j) {
      return {
        kind: 'mod', loader: 'fabric', id: j.id, name: j.name || j.id, version: String(j.version || ''), side: side(j.environment || '*'),
        depends: asList(j.depends), optional: [...asList(j.recommends), ...asList(j.suggests)], breaks: [...asList(j.breaks), ...asList(j.conflicts)],
        provides: asList(j.provides), description: j.description || '', authors: asList(j.authors).map(a => (typeof a === 'string' ? a : a.name)).filter(Boolean),
      };
    }
  }
  const qmj = read('quilt.mod.json');
  if (qmj) {
    try {
      const j = JSON.parse(qmj);
      const q = j.quilt_loader || {};
      const deps = (q.depends || []).map(d => (typeof d === 'string' ? { id: d } : d));
      return {
        kind: 'mod', loader: 'quilt', id: q.id, name: (q.metadata && q.metadata.name) || q.id, version: String(q.version || ''),
        side: side((j.minecraft && j.minecraft.environment) || '*'),
        depends: deps.filter(d => !d.optional).map(d => d.id), optional: deps.filter(d => d.optional).map(d => d.id),
        breaks: (q.breaks || []).map(d => (typeof d === 'string' ? d : d.id)), provides: (q.provides || []).map(d => (typeof d === 'string' ? d : d.id)),
        description: (q.metadata && q.metadata.description) || '', authors: Object.keys((q.metadata && q.metadata.contributors) || {}),
      };
    } catch { /* broken */ }
  }
  const neo = read('META-INF/neoforge.mods.toml');
  const toml = neo || read('META-INF/mods.toml');
  if (toml) {
    const { tables } = parseToml(toml);
    const mods = tables.filter(t => t.name === 'mods');
    const main = (mods[0] && mods[0].values) || {};
    const id = main.modId;
    const depends = [], optional = [], breaks = [];
    let clientDeps = 0, serverDeps = 0;
    for (const t of tables) {
      if (!/^dependencies\./.test(t.name) || !t.array) continue;
      const owner = t.name.slice('dependencies.'.length).replace(/^"|"$/g, '');
      if (owner !== id) continue;
      const v = t.values;
      const dep = v.modId;
      if (!dep) continue;
      const type = String(v.type || (v.mandatory === false ? 'optional' : 'required')).toLowerCase();
      if (v.side && String(v.side).toUpperCase() === 'CLIENT') clientDeps++;
      if (v.side && String(v.side).toUpperCase() === 'SERVER') serverDeps++;
      if (type === 'required') depends.push(dep);
      else if (type === 'optional') optional.push(dep);
      else if (type === 'incompatible') breaks.push(dep);
    }
    let version = String(main.version || '');
    if (!version || /\$\{/.test(version)) version = manifestVersion(read) || version;
    const clientOnly = main.clientSideOnly === true || (tables[0].values.clientSideOnly === true);
    return {
      kind: 'mod', loader: neo ? 'neoforge' : 'forge', id, name: main.displayName || id, version,
      side: clientOnly ? 'client' : clientDeps && !serverDeps && clientDeps === depends.length ? 'client' : 'unknown',
      depends, optional, breaks, provides: mods.slice(1).map(m => m.values.modId).filter(Boolean),
      description: String(main.description || '').trim(), authors: asList(main.authors),
    };
  }
  const mcmod = read('mcmod.info');
  if (mcmod) {
    try {
      const j = JSON.parse(mcmod);
      const m = (Array.isArray(j) ? j : j.modList || [])[0] || {};
      return {
        kind: 'mod', loader: 'forge', id: m.modid, name: m.name || m.modid, version: String(m.version || ''), side: 'unknown',
        depends: asList(m.requiredMods).map(s => String(s).split('@')[0]).filter(Boolean), optional: [], breaks: [], provides: [],
        description: m.description || '', authors: asList(m.authorList),
      };
    } catch { /* broken */ }
  }
  const paper = read('paper-plugin.yml');
  const yml = read('plugin.yml') || paper;
  if (yml) {
    const y = yamlTop(yml);
    const deps = paper && !read('plugin.yml') ? paperDeps(paper) : { depends: asList(y.depend), optional: asList(y.softdepend) };
    return {
      kind: 'plugin', loader: paper ? 'paper' : 'bukkit', id: String(y.name || ''), name: String(y.name || ''), version: String(y.version || ''), side: 'server',
      depends: deps.depends, optional: deps.optional, breaks: [], provides: asList(y.provides),
      description: typeof y.description === 'string' ? y.description : '', authors: [...asList(y.authors), ...(y.author ? [y.author] : [])],
    };
  }
  const vpj = read('velocity-plugin.json');
  if (vpj) {
    try {
      const j = JSON.parse(vpj);
      const deps = j.dependencies || [];
      return {
        kind: 'plugin', loader: 'velocity', id: j.id, name: j.name || j.id, version: String(j.version || ''), side: 'server',
        depends: deps.filter(d => !d.optional).map(d => d.id), optional: deps.filter(d => d.optional).map(d => d.id), breaks: [], provides: [],
        description: j.description || '', authors: j.authors || [],
      };
    } catch { /* broken */ }
  }
  const bungee = read('bungee.yml');
  if (bungee) {
    const y = yamlTop(bungee);
    return {
      kind: 'plugin', loader: 'bungeecord', id: String(y.name || ''), name: String(y.name || ''), version: String(y.version || ''), side: 'server',
      depends: asList(y.depends), optional: asList(y.softDepends), breaks: [], provides: [], description: typeof y.description === 'string' ? y.description : '', authors: y.author ? [y.author] : [],
    };
  }
  return null;
}

/** Ids of mods bundled inside a jar (Fabric jar-in-jar, Forge jarjar) – they satisfy dependencies too. */
function nestedIds(zip) {
  const ids = [];
  for (const e of zip.getEntries()) {
    if (!/^META-INF\/(jars|jarjar)\/.+\.jar$/i.test(e.entryName)) continue;
    try {
      const inner = new AdmZip(e.getData());
      const read = (n) => { const x = inner.getEntry(n); return x ? inner.readAsText(x) : null; };
      const m = parseMeta(read);
      if (m && m.id) ids.push(m.id, ...m.provides);
    } catch { /* not a jar */ }
  }
  return ids;
}

const cache = new Map(); // path|size|mtime → meta

/** Reads one jar (cached by size + mtime). Returns meta (with `bundled` ids) or null. */
function readJar(file) {
  let st;
  try { st = fs.statSync(file); } catch { return null; }
  const key = `${file}|${st.size}|${st.mtimeMs}`;
  if (cache.has(key)) return cache.get(key);
  let meta = null;
  try {
    const zip = new AdmZip(file);
    const read = (n) => { const e = zip.getEntry(n); return e ? zip.readAsText(e) : null; };
    meta = parseMeta(read);
    if (meta) meta.bundled = nestedIds(zip);
  } catch { meta = null; }
  cache.set(key, meta);
  return meta;
}

const norm = (id) => String(id || '').toLowerCase();

/**
 * Whole folder: mods = [{ file, enabled, meta }]. Returns a map file → { dependents, missing,
 * conflicts } and a list of warnings { type: 'missing'|'conflict'|'duplicate'|'client', file, ... }.
 * Disabled mods count as absent (a dependency on a disabled mod is "missing – it is switched off").
 */
function analyze(mods, { server = false, loader = null } = {}) {
  const provided = new Map(); // id → [file]
  const disabledIds = new Map();
  for (const m of mods) {
    if (!m.meta || !m.meta.id) continue;
    const ids = [m.meta.id, ...(m.meta.provides || []), ...(m.meta.bundled || [])].map(norm);
    for (const id of ids) {
      const target = m.enabled ? provided : disabledIds;
      if (!target.has(id)) target.set(id, []);
      target.get(id).push(m.file);
    }
  }
  const hasFabricApi = provided.has('fabric-api') || provided.has('fabric');
  const satisfied = (id) => {
    const n = norm(id);
    if (BUILTIN.has(n) || BUILTIN_PLUGINS.has(n) || provided.has(n)) return true;
    if (hasFabricApi && (n.startsWith('fabric-') || n === 'fabric')) return true;
    if ((provided.has('qsl') || provided.has('quilted_fabric_api')) && (n.startsWith('quilt_') || n.startsWith('fabric-'))) return true;
    return false;
  };
  const out = {};
  const warnings = [];
  for (const m of mods) out[m.file] = { dependents: [], missing: [], conflicts: [] };
  for (const m of mods) {
    if (!m.enabled || !m.meta) continue;
    const meta = m.meta;
    for (const d of meta.depends || []) {
      const n = norm(d);
      if (satisfied(n)) {
        for (const f of provided.get(n) || []) if (f !== m.file && !out[f].dependents.includes(m.file)) out[f].dependents.push(m.file);
        continue;
      }
      const off = disabledIds.get(n);
      out[m.file].missing.push({ id: d, disabled: off ? off[0] : null });
      warnings.push({ type: 'missing', file: m.file, name: meta.name, dep: d, disabled: off ? off[0] : null });
    }
    for (const b of meta.breaks || []) {
      const n = norm(b);
      for (const f of provided.get(n) || []) {
        if (f === m.file) continue;
        out[m.file].conflicts.push(f);
        if (!out[f].conflicts.includes(m.file)) out[f].conflicts.push(m.file);
        warnings.push({ type: 'conflict', file: m.file, name: meta.name, other: f });
      }
    }
    if (server && meta.side === 'client') warnings.push({ type: 'client', file: m.file, name: meta.name });
    if (loader && meta.kind === 'mod' && meta.loader && !loaderFits(meta.loader, loader)) warnings.push({ type: 'loader', file: m.file, name: meta.name, loader: meta.loader });
  }
  // the same mod twice (two versions side by side) crashes most loaders
  const seen = new Map();
  for (const m of mods) {
    if (!m.enabled || !m.meta || !m.meta.id) continue;
    const id = norm(m.meta.id);
    if (seen.has(id)) {
      const other = seen.get(id);
      out[m.file].conflicts.push(other);
      out[other].conflicts.push(m.file);
      warnings.push({ type: 'duplicate', file: m.file, name: m.meta.name, other });
    } else seen.set(id, m.file);
  }
  return { byFile: out, warnings };
}

/** Can a mod built for `modLoader` run on `loader`? (Quilt runs Fabric mods; old Forge mods.toml on NeoForge 1.20.1.) */
function loaderFits(modLoader, loader) {
  if (modLoader === loader) return true;
  if (loader === 'quilt' && modLoader === 'fabric') return true;
  if (loader === 'neoforge' && modLoader === 'forge') return true; // NeoForge 1.20.1 reads mods.toml
  if (['paper', 'purpur', 'folia'].includes(loader) && ['bukkit', 'paper'].includes(modLoader)) return true;
  return false;
}

/** Side badge text for the UI. */
const SIDE_LABEL = { client: 'Klient', server: 'Serwer', both: 'Klient + serwer', unknown: '?' };

module.exports = { parseMeta, readJar, analyze, yamlTop, paperDeps, loaderFits, SIDE_LABEL, BUILTIN };
