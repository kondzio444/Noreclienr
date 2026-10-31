'use strict';
/*
 * Installed mods / plugins of an instance or a server: detailed list (metadata, side, who depends on
 * whom, missing dependencies, conflicts), enable / disable (".jar.disabled"), bulk actions, version
 * pins ("nie aktualizuj"), saved mod profiles, mod list export (txt / markdown) and exporting a whole
 * instance as a Modrinth .mrpack or a CurseForge .zip. Pure helpers are exported for tests.
 */
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const AdmZip = require('adm-zip');
const meta = require('./mod-meta');

const DISABLED = '.disabled';
const isDisabled = (f) => f.endsWith(DISABLED);
const baseName = (f) => (isDisabled(f) ? f.slice(0, -DISABLED.length) : f);

/** Stable key for a mod across versions: its id from metadata, else the file name without version. */
function modKey(file, m) {
  if (m && m.id) return String(m.id).toLowerCase();
  return baseName(file).toLowerCase().replace(/\.(jar|zip)$/, '').replace(/[-_+ ]?(mc)?v?\d[\w.+-]*$/i, '').replace(/[^a-z0-9]+/g, '') || baseName(file).toLowerCase();
}

// ------------------------------------------------------------------ listing

/**
 * Lists jars in dir with metadata and analysis. opts: { server, loader, pins: [key], ids: { file: identified } }.
 * Returns { mods: [...], warnings }.
 */
async function list(dir, opts = {}) {
  let entries = [];
  try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return { mods: [], warnings: [] }; }
  const mods = [];
  for (const e of entries) {
    if (!e.isFile()) continue;
    const base = baseName(e.name);
    if (!/\.jar$/i.test(base)) continue;
    const full = path.join(dir, e.name);
    const st = await fsp.stat(full).catch(() => null);
    if (!st) continue;
    mods.push({ file: e.name, enabled: !isDisabled(e.name), size: st.size, mtime: st.mtimeMs, meta: meta.readJar(full) });
  }
  return describe(mods, opts);
}

/** Pure part of list(): adds analysis, keys, pins and identified project info. */
function describe(mods, { server = false, loader = null, pins = [], ids = {} } = {}) {
  const { byFile, warnings } = meta.analyze(mods, { server, loader });
  const pinSet = new Set(pins.map(p => String(p).toLowerCase()));
  const nameOf = (f) => { const m = mods.find(x => x.file === f); return m ? (m.meta && m.meta.name) || baseName(f) : f; };
  const out = mods.map(m => {
    const a = byFile[m.file] || { dependents: [], missing: [], conflicts: [] };
    const md = m.meta || {};
    const idf = ids[m.file] || ids[baseName(m.file)] || null;
    const key = modKey(m.file, md);
    return {
      file: m.file, enabled: m.enabled, size: m.size, key,
      id: md.id || null, name: (idf && idf.title) || md.name || baseName(m.file).replace(/\.jar$/i, ''), version: md.version || (idf && idf.version) || '',
      loader: md.loader || null, kind: md.kind || 'mod', side: md.side || 'unknown', description: md.description || (idf && idf.description) || '',
      authors: md.authors || [], depends: md.depends || [], optional: md.optional || [],
      dependents: a.dependents.map(f => ({ file: f, name: nameOf(f) })), missing: a.missing, conflicts: a.conflicts.map(f => ({ file: f, name: nameOf(f) })),
      pinned: pinSet.has(key), source: idf ? idf.source || 'modrinth' : null, projectId: idf ? idf.projectId : null, icon: idf ? idf.icon : null,
      serverSide: idf && idf.serverSide ? idf.serverSide : null, clientSide: idf && idf.clientSide ? idf.clientSide : null,
    };
  });
  return { mods: out.sort((a, b) => a.name.localeCompare(b.name, 'pl')), warnings };
}

/** Filter + sort of the installed list (the same rules the UI uses). */
function filterSort(mods, { query = '', state = 'all', side = 'all', sort = 'name' } = {}) {
  const q = query.trim().toLowerCase();
  let out = mods.filter(m => {
    if (q && !`${m.name} ${m.file} ${m.id || ''} ${(m.authors || []).join(' ')}`.toLowerCase().includes(q)) return false;
    if (state === 'enabled' && !m.enabled) return false;
    if (state === 'disabled' && m.enabled) return false;
    if (state === 'problems' && !(m.missing.length || m.conflicts.length)) return false;
    if (state === 'pinned' && !m.pinned) return false;
    if (side !== 'all' && m.side !== side) return false;
    return true;
  });
  const by = {
    name: (a, b) => a.name.localeCompare(b.name, 'pl'),
    size: (a, b) => b.size - a.size,
    dependents: (a, b) => b.dependents.length - a.dependents.length || a.name.localeCompare(b.name, 'pl'),
    state: (a, b) => (a.enabled === b.enabled ? a.name.localeCompare(b.name, 'pl') : a.enabled ? -1 : 1),
  }[sort] || ((a, b) => a.name.localeCompare(b.name, 'pl'));
  out = out.slice().sort(by);
  return out;
}

// ------------------------------------------------------------------ enable / disable / remove

/** New file name for a toggle: "x.jar" ⇄ "x.jar.disabled". */
function toggledName(file, enabled) {
  const base = baseName(file);
  return enabled ? base : base + DISABLED;
}

function safeName(file) {
  const n = path.basename(String(file));
  if (!n || n !== String(file) || n.startsWith('.')) throw new Error('Nieprawidłowa nazwa pliku');
  return n;
}

async function setEnabled(dir, file, enabled) {
  file = safeName(file);
  const target = toggledName(file, enabled);
  if (target === file) return file;
  if (fs.existsSync(path.join(dir, target))) throw new Error(`Plik ${target} już istnieje.`);
  await fsp.rename(path.join(dir, file), path.join(dir, target));
  return target;
}

/** Bulk: action 'enable' | 'disable' | 'remove' on files. Removed files go to backupDir when given. */
async function bulk(dir, files, action, { backupDir } = {}) {
  const done = [];
  for (const f of files) {
    try {
      if (action === 'remove') {
        const n = safeName(f);
        if (backupDir) {
          await fsp.mkdir(backupDir, { recursive: true });
          await fsp.rename(path.join(dir, n), path.join(backupDir, n)).catch(() => fsp.rm(path.join(dir, n), { force: true }));
        } else await fsp.rm(path.join(dir, n), { force: true });
        done.push(n);
      } else done.push(await setEnabled(dir, f, action === 'enable'));
    } catch { /* one bad file does not stop the rest */ }
  }
  return done;
}

// ------------------------------------------------------------------ pins

/** Drops updates of pinned mods. keyOf(file) → mod key. */
function withoutPinned(updates, pins, keyOf) {
  const set = new Set((pins || []).map(p => String(p).toLowerCase()));
  if (!set.size) return updates;
  return updates.filter(u => !set.has(keyOf(u.oldFile)));
}

function togglePin(pins, key, on) {
  const set = new Set((pins || []).map(p => String(p).toLowerCase()));
  if (on) set.add(String(key).toLowerCase()); else set.delete(String(key).toLowerCase());
  return [...set].sort();
}

// ------------------------------------------------------------------ profiles

/** A profile from the current folder: which keys are on, and every key it knew about. */
function makeProfile(name, mods) {
  return {
    name: String(name).trim().slice(0, 40) || 'Profil',
    enabled: mods.filter(m => m.enabled).map(m => m.key).sort(),
    known: mods.map(m => m.key).sort(),
    created: Date.now(),
  };
}

/**
 * Renames that switch the folder to a profile: [{ file, to }]. Mods the profile did not know
 * (installed later) keep their state.
 */
function profilePlan(mods, profile) {
  const on = new Set(profile.enabled || []);
  const known = new Set(profile.known || profile.enabled || []);
  const out = [];
  for (const m of mods) {
    if (!known.has(m.key)) continue;
    const want = on.has(m.key);
    if (want !== m.enabled) out.push({ file: m.file, to: toggledName(m.file, want) });
  }
  return out;
}

/** Saved profiles list with one added / replaced by name. */
function upsertProfile(profiles, p) {
  return [...(profiles || []).filter(x => x.name !== p.name), p].sort((a, b) => a.name.localeCompare(b.name, 'pl'));
}

async function applyProfile(dir, mods, profile) {
  const plan = profilePlan(mods, profile);
  for (const r of plan) await fsp.rename(path.join(dir, r.file), path.join(dir, r.to)).catch(() => {});
  return plan.length;
}

// ------------------------------------------------------------------ mod list export

const SIDE_TXT = { client: 'klient', server: 'serwer', both: 'klient + serwer', unknown: '' };

/** Text / Markdown list of mods. ctx: { title, mcVersion, loader }. */
function modlist(mods, format = 'txt', ctx = {}) {
  const on = mods.filter(m => m.enabled);
  const off = mods.filter(m => !m.enabled);
  const head = [ctx.title, [ctx.mcVersion && `Minecraft ${ctx.mcVersion}`, ctx.loader].filter(Boolean).join(' • ')].filter(Boolean);
  const link = (m) => (m.projectId ? (m.source === 'curseforge' ? `https://www.curseforge.com/projects/${String(m.projectId).replace(/^cf:/, '')}` : `https://modrinth.com/project/${m.projectId}`) : null);
  if (format === 'md') {
    const row = (m) => `| ${link(m) ? `[${md(m.name)}](${link(m)})` : md(m.name)} | ${md(m.version || '–')} | ${SIDE_TXT[m.side] || ''} | \`${md(m.file)}\` |`;
    const table = (list) => ['| Mod | Wersja | Strona | Plik |', '|---|---|---|---|', ...list.map(row)].join('\n');
    return [
      head.length ? `# ${md(head[0] || 'Mody')}` : '# Mody', head[1] ? `\n${head[1]}` : '', `\nWłączone: ${on.length}${off.length ? ` • wyłączone: ${off.length}` : ''}\n`,
      table(on), off.length ? `\n## Wyłączone\n\n${table(off)}` : '', '',
    ].filter(x => x !== '').join('\n') + '\n';
  }
  const line = (m) => `- ${m.name}${m.version ? ' ' + m.version : ''}${SIDE_TXT[m.side] ? ` [${SIDE_TXT[m.side]}]` : ''} (${m.file})`;
  return [...head, `Włączone mody (${on.length}):`, ...on.map(line), ...(off.length ? ['', `Wyłączone (${off.length}):`, ...off.map(line)] : []), ''].join('\n');
}

const md = (s) => String(s).replace(/([|\\`*_[\]])/g, '\\$1');

// ------------------------------------------------------------------ instance export (.mrpack / CurseForge .zip)

/** Folders exported as content files (others only as overrides). */
const CONTENT_DIRS = ['mods', 'resourcepacks', 'shaderpacks'];
/** Never exported: worlds, logs, caches, the launcher's own files, accounts. */
const SKIP = /^(\.[^/]*|saves|logs|crash-reports|screenshots|backups|\.nore-backup|\.fabric|\.mixin\.out|\.cache|cache|downloads|natives|libraries|assets|versions|usercache\.json|usernamecache\.json|launcher_profiles\.json|.*\.log)(\/|$)/i;

const LOADER_DEP = { fabric: 'fabric-loader', quilt: 'quilt-loader', forge: 'forge', neoforge: 'neoforge' };

/** modrinth.index.json from resolved files. files: [{ path, sha1, sha512, size, url, env? }]. */
function mrpackIndex({ name, version, summary, mcVersion, loader, loaderVersion, files }) {
  const deps = { minecraft: mcVersion };
  if (LOADER_DEP[loader] && loaderVersion) deps[LOADER_DEP[loader]] = loaderVersion;
  return {
    formatVersion: 1, game: 'minecraft', versionId: String(version || '1.0.0'), name: String(name || 'Paczka'), ...(summary ? { summary } : {}),
    files: files.map(f => ({
      path: f.path, hashes: { sha1: f.sha1, sha512: f.sha512 }, ...(f.env ? { env: f.env } : {}), downloads: [f.url], fileSize: f.size,
    })),
    dependencies: deps,
  };
}

/** CurseForge manifest.json. files: [{ projectID, fileID, required }]. */
function cfManifest({ name, version, author, mcVersion, loader, loaderVersion, files }) {
  const modLoaders = LOADER_DEP[loader] && loaderVersion ? [{ id: `${loader}-${loaderVersion}`, primary: true }] : [];
  return {
    minecraft: { version: mcVersion, modLoaders }, manifestType: 'minecraftModpack', manifestVersion: 1,
    name: String(name || 'Paczka'), version: String(version || '1.0.0'), author: String(author || ''),
    files: files.map(f => ({ projectID: f.projectID, fileID: f.fileID, required: f.required !== false })), overrides: 'overrides',
  };
}

/** All exportable files of a game folder as relative paths ('mods/x.jar', 'config/y.toml', 'options.txt'). */
async function exportableFiles(root, { includeOptions = true } = {}) {
  const out = [];
  const walk = async (rel) => {
    let entries = [];
    try { entries = await fsp.readdir(path.join(root, rel), { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (SKIP.test(r)) continue;
      if (!rel && e.isFile() && !includeOptions && /^options(of)?\.txt$/i.test(e.name)) continue;
      if (!rel && e.isFile() && !/^(options\.txt|optionsof\.txt|servers\.dat)$/i.test(e.name)) continue; // only the useful files from the root
      if (e.isDirectory()) await walk(r);
      else if (e.isFile() && !isDisabled(e.name)) out.push(r);
    }
  };
  await walk('');
  return out.sort();
}

/**
 * Splits files into pack downloads and overrides. lookup: { [rel]: { url, sha1, sha512, size, projectID, fileID } }.
 * Pure – the IO (hashing, API calls) happens in exportPack().
 */
function splitExport(files, lookup, format) {
  const remote = [], overrides = [];
  for (const rel of files) {
    const l = lookup[rel];
    const content = CONTENT_DIRS.some(d => rel.startsWith(d + '/'));
    if (content && l && (format === 'mrpack' ? l.url && l.sha512 : l.projectID && l.fileID)) remote.push({ path: rel, ...l });
    else overrides.push(rel);
  }
  return { remote, overrides };
}

/** Modrinth versions for files by SHA-1 → { rel: { url, sha1, sha512, size } }. */
async function modrinthLookup(root, rels, net) {
  const byHash = {};
  for (const rel of rels) byHash[await net.sha1File(path.join(root, rel))] = rel;
  const hashes = Object.keys(byHash);
  if (!hashes.length) return {};
  const res = await net.fetchWithRetry('https://api.modrinth.com/v2/version_files', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ hashes, algorithm: 'sha1' }),
  });
  if (!res.ok) return {};
  const map = await res.json();
  const out = {};
  for (const [hash, v] of Object.entries(map)) {
    const f = (v.files || []).find(x => x.hashes && x.hashes.sha1 === hash);
    if (f) out[byHash[hash]] = { url: f.url, sha1: hash, sha512: f.hashes.sha512, size: f.size };
  }
  return out;
}

/** CurseForge files by fingerprint → { rel: { projectID, fileID } }. */
async function curseforgeLookup(root, rels, cf) {
  const out = {};
  const byDir = {};
  for (const rel of rels) { const d = path.posix.dirname(rel); (byDir[d] = byDir[d] || []).push(path.posix.basename(rel)); }
  for (const [d, names] of Object.entries(byDir)) {
    const ids = await cf.identify(path.join(root, d), ['.jar', '.zip'], new Set()).catch(() => ({}));
    for (const n of names) if (ids[n]) out[`${d}/${n}`] = { projectID: Number(String(ids[n].projectId).replace(/^cf:/, '')), fileID: Number(ids[n].versionId) };
  }
  return out;
}

/**
 * Writes the instance as a pack. inst: { name, gameDir, mcVersion, loader, loaderVersion }.
 * opts: { format: 'mrpack'|'curseforge', out, version, includeOptions, net, cf, onStatus }.
 */
async function exportPack(inst, opts) {
  const { format, out, net, cf, onStatus = () => {} } = opts;
  const root = inst.gameDir;
  onStatus('Zbieranie plików');
  const files = await exportableFiles(root, { includeOptions: opts.includeOptions !== false });
  const content = files.filter(r => CONTENT_DIRS.some(d => r.startsWith(d + '/')));
  onStatus(format === 'mrpack' ? 'Szukanie plików w Modrinth' : 'Szukanie plików w CurseForge');
  const lookup = format === 'mrpack' ? await modrinthLookup(root, content, net).catch(() => ({})) : await curseforgeLookup(root, content, cf).catch(() => ({}));
  const { remote, overrides } = splitExport(files, lookup, format);
  const zip = new AdmZip();
  const base = { name: inst.name, version: opts.version || '1.0.0', mcVersion: inst.mcVersion, loader: inst.loader, loaderVersion: inst.loaderVersion || inst.installedLoader || '' };
  if (format === 'mrpack') zip.addFile('modrinth.index.json', Buffer.from(JSON.stringify(mrpackIndex({ ...base, summary: 'Wyeksportowano z Nore Launcher', files: remote }), null, 2)));
  else zip.addFile('manifest.json', Buffer.from(JSON.stringify(cfManifest({ ...base, author: opts.author || '', files: remote }), null, 2)));
  if (format === 'curseforge') zip.addFile('modlist.html', Buffer.from(`<ul>\n${remote.map(r => `<li>${path.posix.basename(r.path)}</li>`).join('\n')}\n</ul>\n`));
  onStatus('Pakowanie');
  for (const rel of overrides) zip.addFile(`overrides/${rel}`, await fsp.readFile(path.join(root, rel)));
  await fsp.mkdir(path.dirname(out), { recursive: true });
  await new Promise((resolve, reject) => zip.writeZip(out, (e) => (e ? reject(e) : resolve())));
  return { file: out, remote: remote.length, overrides: overrides.length };
}

// ------------------------------------------------------------------ config files

const CONFIG_EXT = /\.(toml|json|json5|properties|cfg|txt|yml|yaml)$/i;

/** Config files under root/config (and defaultconfigs) with size, for the config editor. */
async function configFiles(root, dirs = ['config', 'defaultconfigs']) {
  const out = [];
  const walk = async (rel, depth) => {
    if (depth > 4) return;
    let entries = [];
    try { entries = await fsp.readdir(path.join(root, rel), { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const r = `${rel}/${e.name}`;
      if (e.isDirectory()) await walk(r, depth + 1);
      else if (CONFIG_EXT.test(e.name)) {
        const st = await fsp.stat(path.join(root, r)).catch(() => null);
        if (st && st.size < 2 * 1024 * 1024) out.push({ path: r, size: st.size, mtime: st.mtimeMs });
      }
    }
  };
  for (const d of dirs) await walk(d, 0);
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

/** Resolves a relative config path inside root (never outside it). */
function insideRoot(root, rel) {
  const p = path.resolve(root, String(rel || ''));
  if (!p.startsWith(path.resolve(root) + path.sep)) throw new Error('Nieprawidłowa ścieżka pliku');
  return p;
}

const sha1 = (buf) => crypto.createHash('sha1').update(buf).digest('hex');

module.exports = {
  list, describe, filterSort, toggledName, setEnabled, bulk, withoutPinned, togglePin, makeProfile, profilePlan, upsertProfile, applyProfile,
  modlist, mrpackIndex, cfManifest, exportableFiles, splitExport, exportPack, configFiles, insideRoot, modKey, baseName, sha1,
};
