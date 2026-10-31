'use strict';
/*
 * Hangar (hangar.papermc.io) – the PaperMC plugin repository: search, install with required
 * dependencies and update checks for Paper / Purpur / Folia and Velocity plugins. Project ids are
 * "hangar:<slug>" so they never mix with Modrinth / CurseForge ids.
 */
const fsp = require('fs/promises');
const path = require('path');
const net = require('./net');

const API = process.env.NORE_HANGAR_API || 'https://hangar.papermc.io/api/v1';
const PLATFORM = { paper: 'PAPER', purpur: 'PAPER', folia: 'PAPER', velocity: 'VELOCITY', bungeecord: 'WATERFALL' };
const SORT = { relevance: '-stars', downloads: '-downloads', updated: '-updated', newest: '-newest' };

const isHangar = (id) => typeof id === 'string' && id.startsWith('hangar:');
const slugOf = (id) => String(id).replace(/^hangar:/, '');

function platformFor(type) { return PLATFORM[type] || null; }

/** Search result in the shape the server browser uses for Modrinth hits. */
function hit(p) {
  const slug = (p.namespace && p.namespace.slug) || p.name;
  return {
    project_id: `hangar:${slug}`, slug, title: p.name, description: p.description || '', author: (p.namespace && p.namespace.owner) || '',
    icon_url: p.avatarUrl || null, downloads: (p.stats && p.stats.downloads) || 0, follows: (p.stats && p.stats.stars) || 0,
    date_modified: p.lastUpdated, source: 'hangar', categories: p.category ? [p.category] : [],
  };
}

async function search(srv, { query = '', sort = 'relevance', offset = 0, limit = 20 } = {}) {
  const platform = platformFor(srv.type);
  if (!platform) return { hits: [], total_hits: 0 };
  const p = new URLSearchParams({ limit: String(limit), offset: String(offset), sort: SORT[sort] || '-stars', platform });
  if (query) p.set('query', query);
  if (platform === 'PAPER' && srv.mcVersion) p.set('version', srv.mcVersion);
  const j = await net.getJson(`${API}/projects?${p}`);
  return { hits: (j.result || []).map(hit), total_hits: (j.pagination && j.pagination.count) || 0 };
}

/** "1.21.1" matches "1.21.1", "1.21" and ranges like "1.20-1.21.4" in a version's platform list. */
function supports(list, mc) {
  if (!mc || !list || !list.length) return true;
  const parts = (v) => String(v).split('.').map(n => parseInt(n, 10) || 0);
  const cmp = (a, b) => { const x = parts(a), y = parts(b); for (let i = 0; i < 3; i++) { const d = (x[i] || 0) - (y[i] || 0); if (d) return d; } return 0; };
  const minor = mc.split('.').slice(0, 2).join('.');
  return list.some(v => {
    const s = String(v);
    if (s === mc || s === minor) return true;
    const r = /^([\d.]+)\s*-\s*([\d.]+)$/.exec(s);
    return !!r && cmp(mc, r[1]) >= 0 && cmp(mc, r[2]) <= 0;
  });
}

/** Newest version of a project for the server (release channel first). Pure over the API's list. */
function pickVersion(versions, platform, mc) {
  const ok = (versions || []).filter(v => v.downloads && v.downloads[platform] && supports((v.platformDependencies || {})[platform], platform === 'PAPER' ? mc : null));
  return ok.find(v => /release/i.test((v.channel && v.channel.name) || '')) || ok[0] || null;
}

async function versions(slug, platform) {
  const p = new URLSearchParams({ limit: '25', offset: '0', platform });
  const j = await net.getJson(`${API}/projects/${encodeURIComponent(slug)}/versions?${p}`);
  return j.result || [];
}

function download(v, platform) {
  const d = v.downloads[platform];
  const url = d.downloadUrl || d.externalUrl;
  const name = (d.fileInfo && d.fileInfo.name) || `${v.name}.jar`;
  return { url, name: path.basename(name), size: d.fileInfo ? d.fileInfo.sizeBytes : undefined };
}

/**
 * Installs a plugin into dir (with required Hangar dependencies). Returns [{ file, slug, version }]
 * so the server can remember them for updates.
 */
async function install(srv, { projectId, dir }, onStatus, seen = new Set()) {
  const slug = slugOf(projectId);
  if (seen.has(slug.toLowerCase())) return [];
  seen.add(slug.toLowerCase());
  const platform = platformFor(srv.type);
  if (!platform) throw new Error('Hangar ma pluginy tylko dla Paper, Purpur, Folia i Velocity.');
  const v = pickVersion(await versions(slug, platform), platform, srv.mcVersion);
  if (!v) throw new Error(`Brak wersji ${slug} dla ${srv.mcVersion}`);
  const f = download(v, platform);
  if (!f.url) throw new Error(`${slug}: brak pliku do pobrania`);
  await fsp.mkdir(dir, { recursive: true });
  onStatus && onStatus(`Pobieranie ${f.name}`);
  await net.download(f.url, path.join(dir, f.name), { size: f.size });
  const out = [{ file: f.name, slug, version: v.name }];
  for (const d of ((v.pluginDependencies || {})[platform] || [])) {
    if (!d.required || !d.name) continue;
    try { out.push(...await install(srv, { projectId: `hangar:${d.name}`, dir }, onStatus, seen)); } catch (e) { onStatus && onStatus(`Pominięto zależność ${d.name}: ${e.message}`); }
  }
  return out;
}

/** Updates for plugins installed from Hangar. records: { [file]: { slug, version } }. */
async function checkUpdates(srv, records, dir) {
  const platform = platformFor(srv.type);
  if (!platform) return [];
  const out = [];
  for (const [file, r] of Object.entries(records || {})) {
    try {
      await fsp.access(path.join(dir, file));
      const v = pickVersion(await versions(r.slug, platform), platform, srv.mcVersion);
      if (!v || v.name === r.version) continue;
      const f = download(v, platform);
      out.push({ kind: 'plugin', oldFile: file, newFile: f.name, url: f.url, size: f.size, version: v.name, type: 'release', projectId: `hangar:${r.slug}`, source: 'hangar' });
    } catch { /* removed or offline */ }
  }
  return out;
}

module.exports = { isHangar, slugOf, platformFor, search, install, checkUpdates, pickVersion, supports, hit };
