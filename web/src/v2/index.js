/*
 * API v2 router – https://noreclient.pl/api/v2 (OpenAPI: /api/v2/openapi.json).
 * API v1 (src/worker.js) is untouched and keeps serving released launchers and mods.
 *
 * Route kinds decide CORS: public (any origin), session (Nore sites with credentials), bot (none).
 */
import { ApiError, send, sendError, corsHeaders, clientIp, etagOf, etagMatches, API2_VERSION, SECURITY_HEADERS, readJson } from './http.js';
import { presence } from '../hub.js';
import * as pub from './public.js';
import { cachedPing, cacheKeyFor } from './slp.js';
import { botRoute, SCHEMA } from './bot.js';
import * as auth from './auth.js';
import { openapi } from './openapi.js';

const PLATFORM = '(win|linux|mac|mac-zip)';

/** [methods, regexp, kind, handler(ctx) → { body, maxAge, swr, state, status, headers } | Response] */
const ROUTES = [
  ['GET', /^$/, 'public', () => ({ body: index(), maxAge: 3600 })],
  ['GET', /^\/openapi\.json$/, 'public', () => ({ body: openapi(), raw: true, maxAge: 3600 })],
  ['GET', /^\/status$/, 'public', ({ request, env }) => pub.status(request, env).then(body => ({ body, maxAge: 0 }))],
  ['GET', /^\/releases$/, 'public', ({ env, ctx, q }) => pub.releasesList(env, ctx, q).then(r => ({ ...r, maxAge: 60, swr: 600 }))],
  ['GET', /^\/releases\/latest$/, 'public', ({ env, ctx, q }) => pub.releaseLatest(env, ctx, q).then(r => ({ ...r, maxAge: 60, swr: 600 }))],
  ['GET', /^\/releases\/(v?\d+\.\d+\.\d+[\w.-]{0,40})$/, 'public', ({ env, ctx, m }) => pub.releaseOne(env, ctx, m[1]).then(r => ({ ...r, maxAge: 300, swr: 600 }))],
  ['GET', /^\/downloads$/, 'public', ({ env, ctx }) => pub.downloads(env, ctx).then(r => ({ ...r, maxAge: 60, swr: 600 }))],
  ['GET', new RegExp(`^/downloads/${PLATFORM}$`), 'public', ({ request, env, ctx, m }) => pub.downloadRedirect(request, env, ctx, m[1])],
  ['GET', /^\/events$/, 'public', () => ({ body: pub.eventsV2(), maxAge: 60 })],
  ['GET', /^\/news$/, 'public', ({ q }) => ({ body: pub.news(q), maxAge: 300 })],
  ['GET', /^\/platforms$/, 'public', () => ({ body: pub.platforms(), maxAge: 3600 })],
  ['GET', /^\/players\/([^/]{1,64})$/, 'public', ({ env, m }) => pub.player(env, m[1]).then(body => ({ body, maxAge: 20 }))],
  ['GET', /^\/servers\/([^/]{1,300})\/favicon(?:\.png)?$/, 'public', serverFavicon],
  ['GET', /^\/servers\/([^/]{1,300})$/, 'public', server],
  ['POST', /^\/presence$/, 'public', ({ request, env }) => readJson(request, 2048).then(b => presence(env, b)).then(body => ({ body }))],
  ['GET', /^\/stats$/, 'public', ({ env, ctx }) => pub.stats(env, ctx).then(body => ({ body, maxAge: 60 }))],

  ['GET', /^\/bot\/config\.schema\.json$/, 'public', () => ({ body: SCHEMA, raw: true, maxAge: 300 })],
  ['GET,PUT,POST,DELETE', /^\/bot\/(.+)$/, 'bot', ({ request, url, env, m }) => botRoute(request, url, env, m[1])],

  ['GET', /^\/auth\/discord\/login$/, 'session', ({ request, url, env }) => auth.login(request, url, env)],
  ['GET', /^\/auth\/discord\/callback$/, 'session', ({ request, url, env }) => auth.callback(request, url, env)],
  ['POST', /^\/auth\/logout$/, 'session', ({ request, env }) => auth.logout(request, env).then(r => ({ ...r, priv: true }))],
  ['GET', /^\/me$/, 'session', ({ request, env }) => auth.me(request, env).then(body => ({ body, priv: true }))],
  ['GET', /^\/panel\/guilds\/([^/]+)$/, 'session', ({ request, env, m }) => auth.panelGet(request, env, m[1]).then(body => ({ body, priv: true }))],
  ['PUT', /^\/panel\/guilds\/([^/]+)(?:\/config)?$/, 'session', ({ request, env, m }) => auth.panelPut(request, env, m[1]).then(body => ({ body, priv: true }))],
];

export const ENDPOINTS_V2 = [
  ['GET', '/api/v2/status', 'Stan API i komponentów (wydania, synchronizacja, Nore Hub, Nore Bot, logowanie)'],
  ['GET', '/api/v2/releases?limit=10&prerelease=false&notes=true', 'Ostatnie wydania z plikami'],
  ['GET', '/api/v2/releases/latest', 'Najnowsze wydanie'],
  ['GET', '/api/v2/releases/{version}', 'Jedno wydanie'],
  ['GET', '/api/v2/downloads', 'Pliki do pobrania na każdą platformę i liczniki'],
  ['GET', '/api/v2/downloads/{win|linux|mac|mac-zip}', 'Przekierowanie do instalatora (liczone)'],
  ['GET', '/api/v2/events', 'Wydarzenia z odliczaniem (Halloween, zima)'],
  ['GET', '/api/v2/news?limit=20&tag=Launcher', 'Aktualności'],
  ['GET', '/api/v2/platforms', 'Obsługiwane wersje Minecraft, loadery i platformy'],
  ['GET', '/api/v2/players/{name}', 'Nore Hub: czy gracz używa Nore, czy jest online, co nosi'],
  ['GET', '/api/v2/servers/{address}', 'Ping serwera Minecraft: online, gracze, wersja, MOTD, ikona, opóźnienie'],
  ['GET', '/api/v2/servers/{address}/favicon', 'Ikona serwera Minecraft (PNG)'],
  ['POST', '/api/v2/presence', 'Nore Client w grze: anonimowy sygnał co 60 s (licznik graczy online)'],
  ['GET', '/api/v2/stats', 'Statystyki: pobrania, gracze Nore online/znani, serwery z Nore Botem'],
  ['GET', '/api/v2/openapi.json', 'Opis OpenAPI 3.1'],
  ['GET', '/api/v2/bot/config.schema.json', 'Schemat konfiguracji Nore Bota (JSON Schema)'],
];

function index() {
  return { api: 'Nore Client API', version: API2_VERSION, docs: 'https://noreclient.pl/api', openapi: '/api/v2/openapi.json', v1: '/api/v1', endpoints: ENDPOINTS_V2.map(([method, path, about]) => ({ method, path, about })) };
}

// ---------------------------------------------------------------- servers

async function server({ request, env, ctx, m, q }) {
  const raw = decodeURIComponent(m[1]);
  const { server: s, cache } = await cachedPing(env, ctx, raw, clientIp(request));
  const withIcon = q.get('favicon') !== 'false' && q.get('favicon') !== '0';
  const out = { ...s, faviconUrl: s.favicon ? `/api/v2/servers/${encodeURIComponent(raw)}/favicon` : null };
  if (!withIcon) delete out.favicon;
  return { body: { server: out }, maxAge: 30, state: cache };
}

async function serverFavicon(args) {
  const { request, env, ctx, m } = args;
  const raw = decodeURIComponent(m[1]);
  cacheKeyFor(raw); // validates the address
  const { server: s } = await cachedPing(env, ctx, raw, clientIp(request));
  if (!s.favicon) throw new ApiError(404, 'no_favicon', s.online ? 'Ten serwer nie ma ikony' : 'Serwer jest offline');
  const bytes = Uint8Array.from(atob(s.favicon.slice(s.favicon.indexOf(',') + 1)), c => c.charCodeAt(0));
  const etag = await etagOf(s.favicon);
  const headers = { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=300', ETag: etag, ...corsHeaders('public', request, env), ...SECURITY_HEADERS };
  if (etagMatches(request.headers.get('If-None-Match'), etag)) return new Response(null, { status: 304, headers });
  return new Response(request.method === 'HEAD' ? null : bytes, { headers });
}

// ---------------------------------------------------------------- dispatch

export async function handleV2(request, url, env, ctx) {
  const path = url.pathname.replace(/^\/api\/v2/, '').replace(/\/+$/, '');
  const method = request.method === 'HEAD' ? 'GET' : request.method;
  const matching = ROUTES.map(r => [r, r[1].exec(path)]).filter(([, m]) => m);
  const kind = matching.length ? matching[0][0][2] : 'public';
  const allowed = [...new Set(matching.flatMap(([r]) => r[0].split(',')))];
  const methods = [...allowed, ...(allowed.includes('GET') ? ['HEAD'] : []), 'OPTIONS'].join(', ');
  const cors = corsHeaders(kind, request, env, methods);

  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...cors, Allow: methods } });

  try {
    if (!matching.length) throw new ApiError(404, 'not_found', 'Nie ma takiego endpointu – lista: /api/v2');
    const hit = matching.find(([r]) => r[0].split(',').includes(method));
    if (!hit) throw new ApiError(405, 'method_not_allowed', `Ta ścieżka przyjmuje tylko: ${allowed.join(', ')}`, { allow: allowed });
    const [route, m] = hit;
    const out = await route[3]({ request, url, env, ctx, m, q: url.searchParams });
    if (out instanceof Response) {
      const res = new Response(out.body, out);
      for (const [k, v] of Object.entries(cors)) res.headers.set(k, v);
      return res;
    }
    const opts = { status: out.status || 200, maxAge: out.maxAge || 0, swr: out.swr || 0, cors, headers: out.headers || {}, cacheState: out.state, priv: !!out.priv };
    if (out.raw) return rawJson(request, out.body, opts);
    return await send(request, out.body, opts);
  } catch (e) {
    if (!(e instanceof ApiError)) {
      if (e && e.status) e = new ApiError(e.status, undefined, e.message); // HttpError / HubError from shared code
      else { console.error('api v2', e && e.stack || e); e = new ApiError(500, 'internal', 'Błąd serwera – spróbuj za chwilę'); }
    }
    const headers = {};
    if (e.status === 405 && e.extra && e.extra.allow) headers.Allow = methods;
    if (e.status === 429 && e.extra && e.extra.retryAfter) headers['Retry-After'] = String(e.extra.retryAfter);
    if (e.status === 401 && kind === 'bot') headers['WWW-Authenticate'] = 'Bot realm="nore-api"';
    return sendError(request, e, { cors, headers });
  }
}

/** A JSON document as is (OpenAPI, JSON Schema) – no envelope, still ETag/CORS. */
async function rawJson(request, data, { maxAge, cors }) {
  const body = JSON.stringify(data, null, 2);
  const etag = await etagOf(body);
  const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': maxAge ? `public, max-age=${maxAge}` : 'no-store', ETag: etag, 'X-Nore-Api': API2_VERSION, ...SECURITY_HEADERS, ...cors };
  if (etagMatches(request.headers.get('If-None-Match'), etag)) return new Response(null, { status: 304, headers });
  return new Response(request.method === 'HEAD' ? null : body, { headers });
}
