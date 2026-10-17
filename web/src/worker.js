/*
 * Nore Client – website + public API on Cloudflare Workers (static assets, no R2).
 *
 *   GET /api/v1/status                    health check
 *   GET /api/v1/version                   latest release (GitHub Releases, cached)
 *   GET /api/v1/updates/launcher?platform=win|linux|mac&current=1.4.0
 *                                         update manifest for the Nore updater
 *   GET /api/v1/updates/mod?mc=1.21.8     Nore Client jar for a Minecraft version
 *   GET /api/v1/download/:platform        302 to the installer of the latest release
 *   GET /api/v1/events                    running events (Halloween + Christmas, always on)
 *   GET /api/v1/news                      news for the launcher home page
 *   GET /api/v1/platforms                 supported Minecraft versions
 *
 * Downloads are served straight from GitHub Releases, so no object storage is needed.
 */
import PLATFORMS from '../../platforms/platforms.json';
import NEWS from './news.json';

const REPO = 'kondzio444/Noreclienr';
const CACHE_SECONDS = 600;

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'Cross-Origin-Opener-Policy': 'same-origin',
};

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
};

function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': `public, max-age=${CACHE_SECONDS}`, ...CORS, ...SECURITY_HEADERS, ...extra },
  });
}

const error = (status, message) => json({ error: message }, status, { 'Cache-Control': 'no-store' });

/** GitHub API through the edge cache, so the rate limit is never hit. */
async function github(path, env, ctx) {
  const url = `https://api.github.com/repos/${REPO}${path}`;
  const cache = caches.default;
  const key = new Request(url);
  const hit = await cache.match(key);
  if (hit) return hit.json();
  const headers = { 'User-Agent': 'nore-web', Accept: 'application/vnd.github+json' };
  if (env.GITHUB_TOKEN) headers.Authorization = `Bearer ${env.GITHUB_TOKEN}`;
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`GitHub ${res.status}`);
  const body = await res.text();
  ctx.waitUntil(cache.put(key, new Response(body, { headers: { 'Cache-Control': `public, max-age=${CACHE_SECONDS}` } })));
  return JSON.parse(body);
}

const ASSET_PATTERNS = {
  win: /NoreLauncher-Setup-.*\.exe$/i,
  linux: /NoreLauncher-.*\.AppImage$/i,
  mac: /NoreLauncher-.*\.dmg$/i,
  macZip: /NoreLauncher-.*-mac\.zip$|NoreLauncher-.*\.zip$/i,
};

function cmpVersion(a, b) {
  const pa = String(a).replace(/^v/, '').split(/[.-]/).map(n => parseInt(n, 10) || 0);
  const pb = String(b).replace(/^v/, '').split(/[.-]/).map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  }
  return 0;
}

function shapeRelease(r) {
  const assets = {};
  for (const a of r.assets || []) {
    for (const [k, re] of Object.entries(ASSET_PATTERNS)) {
      if (!assets[k] && re.test(a.name)) assets[k] = { name: a.name, size: a.size, url: a.browser_download_url, digest: a.digest || null };
    }
  }
  const mods = (r.assets || []).filter(a => /^noreclient-.*\.jar$/i.test(a.name)).map(a => ({ name: a.name, size: a.size, url: a.browser_download_url, digest: a.digest || null }));
  return {
    version: String(r.tag_name || '').replace(/^v/, ''),
    name: r.name,
    prerelease: !!r.prerelease,
    published: r.published_at,
    notes: (r.body || '').slice(0, 8000),
    url: r.html_url,
    assets,
    mods,
  };
}

async function latest(env, ctx) {
  const list = await github('/releases?per_page=10', env, ctx);
  const r = list.find(x => !x.draft);
  if (!r) throw new Error('Brak wydań');
  return shapeRelease(r);
}

/** Nore events are forced on (cannot be switched off); the winter event starts on 10 December 2026. */
const WINTER_START = '2026-12-10T00:00:00+01:00';
function events() {
  const winter = Date.now() >= Date.parse(WINTER_START);
  return [
    { id: 'halloween', name: 'Halloween w Nore', forced: true, active: true, accent: '#ff8a1f', features: ['Dyniowe dekoracje', 'Peleryny Halloween', 'Kapelusz Wiedźmy', 'Skrzydła Nietoperza', 'Mini-gra Cukierek albo psikus'] },
    { id: 'christmas', name: 'Święta w Nore', forced: true, active: winter, startsAt: WINTER_START, accent: '#ff4d6d', features: ['Śnieg w menu', 'Świąteczne lampki', 'Zimowy motyw launchera'] },
  ];
}

async function api(url, env, ctx) {
  const p = url.pathname.replace(/\/+$/, '');
  if (p === '/api/v1/status') return json({ ok: true, service: 'nore-api', time: new Date().toISOString() }, 200, { 'Cache-Control': 'no-store' });
  if (p === '/api/v1/events') return json({ events: events() });
  if (p === '/api/v1/news') return json({ news: NEWS });
  if (p === '/api/v1/platforms') return json({ platforms: PLATFORMS.map(x => ({ name: x.name, loader: x.loader, java: x.java, versions: x.versions })) });
  if (p === '/api/v1/version') return json(await latest(env, ctx));

  if (p === '/api/v1/updates/launcher') {
    const platform = url.searchParams.get('platform') || 'win';
    const current = url.searchParams.get('current') || '0';
    const rel = await latest(env, ctx);
    const asset = rel.assets[platform];
    const update = cmpVersion(rel.version, current) > 0;
    return json({ update, current, version: rel.version, published: rel.published, notes: rel.notes, prerelease: rel.prerelease, download: asset || null });
  }

  if (p === '/api/v1/updates/mod') {
    const mc = url.searchParams.get('mc') || '';
    const plat = PLATFORMS.find(x => x.versions.includes(mc));
    if (!plat) return error(404, 'Ta wersja Minecraft nie jest wspierana');
    const rel = await latest(env, ctx);
    const jar = rel.mods.find(m => m.name.includes(plat.name)) || null;
    return json({ mc, platform: plat.name, version: rel.version, jar });
  }

  const dl = p.match(/^\/api\/v1\/download\/(win|linux|mac)$/);
  if (dl) {
    const rel = await latest(env, ctx);
    const asset = rel.assets[dl[1]];
    if (!asset) return error(404, 'Brak pliku dla tej platformy w najnowszym wydaniu');
    return Response.redirect(asset.url, 302);
  }
  return error(404, 'Nie ma takiego endpointu');
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.hostname.startsWith('www.')) {
      url.hostname = url.hostname.slice(4);
      return Response.redirect(url.toString(), 301);
    }
    if (url.pathname.startsWith('/api/')) {
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
      if (request.method !== 'GET') return error(405, 'Tylko GET');
      try {
        return await api(url, env, ctx);
      } catch (e) {
        return error(502, String(e.message || e));
      }
    }
    const res = await env.ASSETS.fetch(request);
    const out = new Response(res.body, res);
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) out.headers.set(k, v);
    if ((out.headers.get('Content-Type') || '').includes('text/html')) {
      out.headers.set('Content-Security-Policy', "default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'self'; connect-src 'self'; frame-ancestors 'none'");
    }
    return out;
  },
};
