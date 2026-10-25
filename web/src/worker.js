/*
 * Nore Client – website + public API on Cloudflare Workers (static assets, no R2).
 * Documentation for people: https://noroclient.pl/api   ·   machine readable: /api/v1/openapi.json
 *
 *   GET /api/v1                           index of the endpoints
 *   GET /api/v1/status                    health, version and the last background sync
 *   GET /api/v1/version                   latest release
 *   GET /api/v1/releases?limit=10         recent releases (1–30)
 *   GET /api/v1/stats                     download counters per platform and per release
 *   GET /api/v1/updates/launcher?platform=win|linux|mac&current=1.4.0
 *   GET /api/v1/updates/mod?mc=1.21.8[&loader=fabric|forge]
 *   GET /api/v1/download/:platform        302 to the installer of the latest release
 *   GET /api/v1/events                    running events (Halloween + Christmas, always on)
 *   GET /api/v1/news                      news for the launcher home page
 *   GET /api/v1/platforms                 supported Minecraft versions and loaders
 *   POST /api/v1/hub/hello                Nore Hub: the launcher announces its player (src/hub.js)
 *   GET /api/v1/hub/players?names=a,b     Nore Hub: which of these players use Nore, and what they wear
 *   GET /api/v1/hub/stats                 Nore Hub: players online and known
 *   GET /api/v1/launcher/config           what Nore Launcher reads at run time (src/launcher.js)
 *   GET|POST /api/v1/cf/v1/…              CurseForge for the launcher, key added on the server
 *   GET /api/v1/openapi.json              OpenAPI 3.1 description of all of the above
 *
 * API v2 (/api/v2/*, src/v2/index.js, OpenAPI at /api/v2/openapi.json) is a separate router; this
 * file keeps API v1 exactly as released launchers and mods expect it. Host routing: src/hosts.js.
 *
 * Background work: a Cron Trigger (wrangler.jsonc) refreshes the GitHub data every 15 minutes, and
 * every request serves cached data at once while a stale copy is refreshed with ctx.waitUntil
 * (stale-while-revalidate), so the API answers fast and GitHub rate limits are never hit.
 */
import PLATFORMS from '../../platforms/platforms.json';
import NEWS from './news.json';
import { HubError, readHello, readNames, hubCall } from './hub.js';
import { launcherConfig, curseforge } from './launcher.js';
import { HttpError, readCache, releases, brief, cmpVersion, events, sync, platformsView } from './data.js';
import { handleV2 } from './v2/index.js';
import { siteOf, wwwRedirect, mcAsset, MC_HOST } from './hosts.js';

export { NoreHub } from './hub.js';
export { NoreBot } from './v2/store.js';
export { NoreCounters } from './v2/counters.js';

const API_VERSION = '1.3.0';

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'Cross-Origin-Opener-Policy': 'same-origin',
};

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, If-None-Match',
  'Access-Control-Expose-Headers': 'ETag, X-Nore-Cache, X-Nore-Api',
  'Access-Control-Max-Age': '86400',
};

async function etagOf(text) {
  const d = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(text));
  return '"' + [...new Uint8Array(d)].slice(0, 10).map(b => b.toString(16).padStart(2, '0')).join('') + '"';
}

async function json(request, data, { status = 200, maxAge = 60, swr = 600, cacheState } = {}) {
  const body = JSON.stringify(data, null, 2);
  const etag = await etagOf(body);
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': maxAge ? `public, max-age=${maxAge}${swr ? `, stale-while-revalidate=${swr}` : ''}` : 'no-store',
    ETag: etag,
    'X-Nore-Api': API_VERSION,
    ...CORS,
    ...SECURITY_HEADERS,
  };
  if (cacheState) headers['X-Nore-Cache'] = cacheState;
  if (status === 200 && request.headers.get('If-None-Match') === etag) return new Response(null, { status: 304, headers });
  return new Response(request.method === 'HEAD' ? null : body, { status, headers });
}

const fail = (request, status, message) => json(request, { error: message, status }, { status, maxAge: 0 });

// ---------------------------------------------------------------- API

const ENDPOINTS = [
  ['GET', '/api/v1/status', 'Stan API, najnowsza wersja i ostatnia synchronizacja w tle'],
  ['GET', '/api/v1/version', 'Najnowsze wydanie z plikami launchera i moda'],
  ['GET', '/api/v1/releases?limit=10', 'Ostatnie wydania (1–30)'],
  ['GET', '/api/v1/stats', 'Liczniki pobrań'],
  ['GET', '/api/v1/updates/launcher?platform=win&current=1.4.0', 'Czy jest nowszy launcher (dla aktualizatora)'],
  ['GET', '/api/v1/updates/mod?mc=1.21.8&loader=fabric', 'Plik Nore Client dla wersji Minecraft'],
  ['GET', '/api/v1/download/{win|linux|mac}', 'Przekierowanie do instalatora'],
  ['GET', '/api/v1/events', 'Wydarzenia (zawsze włączone)'],
  ['GET', '/api/v1/news', 'Aktualności'],
  ['GET', '/api/v1/platforms', 'Obsługiwane wersje i loadery'],
  ['POST', '/api/v1/hub/hello', 'Nore Hub: launcher zgłasza gracza (podpisane, co 60 s w trakcie gry)'],
  ['GET', '/api/v1/hub/players?names=Steve,Alex', 'Nore Hub: którzy z tych graczy używają Nore i co noszą (do 100 nicków)'],
  ['GET', '/api/v1/hub/stats', 'Nore Hub: gracze online i znani'],
  ['GET', '/api/v1/launcher/config', 'Ustawienia dla Nore Launchera (identyfikator aplikacji Microsoft do logowania)'],
  ['GET', '/api/v1/openapi.json', 'Opis OpenAPI 3.1'],
];

async function api(request, url, env, ctx) {
  const p = url.pathname.replace(/\/+$/, '');
  const q = url.searchParams;

  if (p.startsWith('/api/v1/hub/')) return hub(request, p, q, env);
  if (p.startsWith('/api/v1/cf/')) return curseforge(request, url, env, ctx);
  if (request.method === 'POST') return fail(request, 405, 'Tylko GET');
  if (p === '/api/v1/launcher/config') return json(request, launcherConfig(env), { maxAge: 3600 });

  if (p === '/api/v1') {
    return json(request, { api: 'Nore Client API', version: API_VERSION, docs: 'https://noroclient.pl/api', endpoints: ENDPOINTS.map(([method, path, about]) => ({ method, path, about })) }, { maxAge: 3600 });
  }
  if (p === '/api/v1/openapi.json') return json(request, openapi(), { maxAge: 3600 });
  if (p === '/api/v1/events') return json(request, { events: events() }, { maxAge: 300 });
  if (p === '/api/v1/news') return json(request, { news: NEWS }, { maxAge: 300 });
  if (p === '/api/v1/platforms') return json(request, { platforms: platformsView() }, { maxAge: 3600 });

  if (p === '/api/v1/status') {
    const [syncMeta, rel] = await Promise.all([readCache('sync'), readCache('releases')]);
    const latest = rel && rel.data[0];
    const syncAge = syncMeta ? Math.round((Date.now() - Date.parse(syncMeta.data.at)) / 1000) : null;
    return json(request, {
      ok: true,
      service: 'nore-api',
      api: API_VERSION,
      time: new Date().toISOString(),
      colo: (request.cf && request.cf.colo) || null,
      latest: latest ? latest.version : null,
      cache: rel ? { ageSeconds: Math.round((Date.now() - rel.storedAt) / 1000) } : null,
      sync: syncMeta ? { ...syncMeta.data, ageSeconds: syncAge } : null,
    }, { maxAge: 0 });
  }

  if (p === '/api/v1/version') {
    const { data, state } = await releases(env, ctx);
    return json(request, data[0], { cacheState: state });
  }

  if (p === '/api/v1/releases') {
    const limit = Math.max(1, Math.min(30, parseInt(q.get('limit') || '10', 10) || 10));
    const { data, state } = await releases(env, ctx);
    return json(request, { count: Math.min(limit, data.length), releases: data.slice(0, limit).map(brief) }, { cacheState: state });
  }

  if (p === '/api/v1/stats') {
    const { data, state } = await releases(env, ctx);
    const perPlatform = { win: 0, linux: 0, mac: 0, mods: 0 };
    let total = 0;
    for (const r of data) {
      total += r.downloads;
      for (const k of ['win', 'linux', 'mac']) if (r.assets[k]) perPlatform[k] += r.assets[k].downloads;
      if (r.assets.macZip) perPlatform.mac += r.assets.macZip.downloads;
      for (const m of r.mods) perPlatform.mods += m.downloads;
    }
    return json(request, {
      releases: data.length,
      downloads: { total, ...perPlatform },
      latest: { version: data[0].version, downloads: data[0].downloads },
      note: 'Liczniki z GitHub Releases z ostatnich 30 wydań.',
    }, { cacheState: state });
  }

  if (p === '/api/v1/updates/launcher') {
    const platform = q.get('platform') || 'win';
    if (!['win', 'linux', 'mac'].includes(platform)) return fail(request, 400, 'platform musi być win, linux albo mac');
    const current = q.get('current') || '0';
    const { data, state } = await releases(env, ctx);
    const rel = data[0];
    const asset = rel.assets[platform] || null;
    return json(request, { update: cmpVersion(rel.version, current) > 0, current, version: rel.version, published: rel.published, notes: rel.notes, prerelease: rel.prerelease, download: asset }, { cacheState: state });
  }

  if (p === '/api/v1/updates/mod') {
    const mc = q.get('mc') || '';
    const loader = (q.get('loader') || '').toLowerCase();
    if (!mc) return fail(request, 400, 'Podaj wersję Minecraft, np. ?mc=1.21.8');
    const candidates = PLATFORMS.filter(x => x.versions.includes(mc) && (!loader || x.loader === loader));
    if (!candidates.length) return fail(request, 404, loader ? `Nore Client nie wspiera ${mc} na ${loader}` : `Nore Client nie wspiera wersji ${mc}`);
    const plat = candidates[0];
    const { data, state } = await releases(env, ctx);
    const rel = data[0];
    const jar = rel.mods.find(m => m.name === `noreclient-${plat.name}.jar`) || rel.mods.find(m => m.name.includes(plat.name)) || null;
    return json(request, { mc, loader: plat.loader, platform: plat.name, java: plat.java, version: rel.version, jar, bundled: !jar }, { cacheState: state });
  }

  const dl = p.match(/^\/api\/v1\/download\/(win|linux|mac)$/);
  if (dl) {
    const { data } = await releases(env, ctx);
    const asset = data[0].assets[dl[1]];
    if (!asset) return fail(request, 404, 'Brak pliku dla tej platformy w najnowszym wydaniu');
    return Response.redirect(asset.url, 302);
  }
  return fail(request, 404, 'Nie ma takiego endpointu – lista: /api/v1');
}

// ---------------------------------------------------------------- Nore Hub (src/hub.js, docs/nore-hub.md)

async function hub(request, p, q, env) {
  if (p === '/api/v1/hub/hello') {
    if (request.method !== 'POST') return fail(request, 405, 'Tylko POST');
    return json(request, await hubCall(env, 'hello', await readHello(request)), { maxAge: 0 });
  }
  if (request.method === 'POST') return fail(request, 405, 'Tylko GET');
  if (p === '/api/v1/hub/players') return json(request, await hubCall(env, 'players', { names: readNames(q.get('names')) }), { maxAge: 20, swr: 0 });
  if (p === '/api/v1/hub/stats') return json(request, await hubCall(env, 'stats', {}), { maxAge: 30, swr: 0 });
  throw new HubError(404, 'Nie ma takiego endpointu – lista: /api/v1');
}

function openapi() {
  const ok = (description, schema) => ({ 200: { description, content: { 'application/json': { schema } } } });
  const obj = (properties) => ({ type: 'object', properties });
  const s = { type: 'string' }, n = { type: 'integer' }, b = { type: 'boolean' };
  const asset = obj({ name: s, size: n, url: s, digest: { type: ['string', 'null'] }, downloads: n });
  const err = (status, description) => ({ [status]: { description, content: { 'application/json': { schema: obj({ error: s, status: n }) } } } });
  const cosmetics = { type: 'object', description: 'Garderoba z moda: { v, slots: { <slot>: { id, color, variant, opts } } }, najwyżej 2048 bajtów', properties: { v: n, slots: { type: 'object' } } };
  const player = obj({ name: s, uuid: s, hex: s, verified: b, online: b, seen: n, cosmetics });
  return {
    openapi: '3.1.0',
    info: { title: 'Nore Client API', version: API_VERSION, description: 'Publiczne API Nore Client: wydania, aktualizacje launchera i moda, wydarzenia, aktualności i Nore Hub (kto jeszcze gra z Nore). Bez klucza, CORS otwarty, odpowiedzi z ETag.' },
    servers: [{ url: 'https://noroclient.pl' }],
    paths: {
      '/api/v1/status': { get: { summary: 'Stan API i synchronizacji w tle', responses: ok('Stan', obj({ ok: b, api: s, latest: s, sync: obj({ at: s, ok: b, ms: n, releases: n, ageSeconds: n }) })) } },
      '/api/v1/version': { get: { summary: 'Najnowsze wydanie', responses: ok('Wydanie', obj({ version: s, published: s, notes: s, downloads: n, assets: obj({ win: asset, linux: asset, mac: asset }), mods: { type: 'array', items: asset } })) } },
      '/api/v1/releases': { get: { summary: 'Ostatnie wydania', parameters: [{ name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 30, default: 10 } }], responses: ok('Lista', obj({ count: n, releases: { type: 'array', items: obj({ version: s, published: s, downloads: n, url: s }) } })) } },
      '/api/v1/stats': { get: { summary: 'Liczniki pobrań', responses: ok('Liczniki', obj({ releases: n, downloads: obj({ total: n, win: n, linux: n, mac: n, mods: n }) })) } },
      '/api/v1/updates/launcher': { get: { summary: 'Aktualizacja launchera', parameters: [{ name: 'platform', in: 'query', required: true, schema: { enum: ['win', 'linux', 'mac'] } }, { name: 'current', in: 'query', schema: s }], responses: ok('Wynik', obj({ update: b, version: s, download: asset })) } },
      '/api/v1/updates/mod': { get: { summary: 'Plik moda dla wersji Minecraft', parameters: [{ name: 'mc', in: 'query', required: true, schema: s }, { name: 'loader', in: 'query', schema: { enum: ['fabric', 'forge'] } }], responses: ok('Plik', obj({ mc: s, loader: s, platform: s, java: n, jar: asset })) } },
      '/api/v1/download/{platform}': { get: { summary: 'Pobierz instalator', parameters: [{ name: 'platform', in: 'path', required: true, schema: { enum: ['win', 'linux', 'mac'] } }], responses: { 302: { description: 'Przekierowanie do pliku w GitHub Releases' } } } },
      '/api/v1/events': { get: { summary: 'Wydarzenia', responses: ok('Wydarzenia', obj({ events: { type: 'array', items: obj({ id: s, name: s, active: b, forced: b }) } })) } },
      '/api/v1/news': { get: { summary: 'Aktualności', responses: ok('Aktualności', obj({ news: { type: 'array' } })) } },
      '/api/v1/platforms': { get: { summary: 'Obsługiwane wersje', responses: ok('Platformy', obj({ platforms: { type: 'array', items: obj({ name: s, loader: s, java: n, versions: { type: 'array', items: s } }) } })) } },
      '/api/v1/hub/hello': { post: {
        summary: 'Nore Hub: launcher zgłasza gracza (też heartbeat co 60 s)',
        description: 'Podpis ECDSA P-256 (DER, base64) kluczem Nore ID nad: nore-hub/1|name|uuid|hex|ts|online(1/0)|sha256hex(JSON.stringify(cosmetics)). hex = pierwsze 20 znaków sha256(pub). Konto premium: serverId po session/minecraft/join w Mojang. Najwyżej jedno hello na Nore ID co 15 s.',
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['name', 'uuid', 'hex', 'pub', 'ts', 'online', 'cosmetics', 'sig'], properties: { name: s, uuid: s, premium: b, serverId: s, hex: s, pub: s, ts: n, online: b, cosmetics, sig: s } } } } },
        responses: { ...ok('Zapisano', obj({ ok: b, verified: b, name: s })), ...err(400, 'Złe pola'), ...err(401, 'Zły podpis, klucz, czas albo brak potwierdzenia Mojang'), ...err(409, 'Nick należy do innego gracza Nore'), ...err(429, 'Za często') },
      } },
      '/api/v1/hub/players': { get: { summary: 'Nore Hub: którzy z tych graczy używają Nore', parameters: [{ name: 'names', in: 'query', required: true, description: 'Do 100 nicków po przecinku, wielkość liter bez znaczenia', schema: s }], responses: { ...ok('Gracze Nore (klucze to nicki małymi literami)', obj({ players: { type: 'object', additionalProperties: player } })), ...err(400, 'Za dużo nicków') } } },
      '/api/v1/hub/stats': { get: { summary: 'Nore Hub: liczba graczy', responses: ok('Liczniki', obj({ online: n, known: n })) } },
      '/api/v1/launcher/config': { get: { summary: 'Ustawienia dla Nore Launchera', responses: ok('Ustawienia', obj({ microsoftClientId: { type: ['string', 'null'] } })) } },
    },
  };
}

// ---------------------------------------------------------------- entry points

function withPageHeaders(res, html) {
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) out.headers.set(k, v);
  if (html) {
    out.headers.set('Content-Security-Policy', "default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://api.fontshare.com; font-src https://fonts.gstatic.com https://cdn.fontshare.com; script-src 'self' https://static.cloudflareinsights.com; connect-src 'self' https://cloudflareinsights.com; frame-ancestors 'none'");
  }
  return out;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const www = wwwRedirect(url);
    if (www) return www;
    if (url.pathname === '/api/v2' || url.pathname.startsWith('/api/v2/')) return handleV2(request, url, env, ctx);
    // the API documentation page
    if (url.pathname === '/api' || url.pathname === '/api/') {
      const res = await env.ASSETS.fetch(new Request(url.origin + '/api', request));
      return withPageHeaders(res, true);
    }
    if (url.pathname.startsWith('/api/')) {
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
      if (!['GET', 'HEAD', 'POST'].includes(request.method)) return fail(request, 405, 'Tylko GET');
      try {
        return await api(request, url, env, ctx);
      } catch (e) {
        return fail(request, e.status || 502, String(e.message || e));
      }
    }
    const site = siteOf(url.hostname, env);
    if (site === 'main' && (url.pathname === '/mc' || url.pathname.startsWith('/mc/'))) {
      return Response.redirect(`https://${MC_HOST}${url.pathname.slice(3) || '/'}${url.search}`, 301);
    }
    const res = site === 'mc' ? await mcAsset(request, url, env) : await env.ASSETS.fetch(request);
    return withPageHeaders(res, (res.headers.get('Content-Type') || '').includes('text/html'));
  },

  // Cron Trigger (wrangler.jsonc "triggers"): refreshes the release data in the background
  async scheduled(event, env, ctx) {
    ctx.waitUntil(sync(env));
  },
};
