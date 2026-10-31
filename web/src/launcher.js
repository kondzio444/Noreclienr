/*
 * What Nore Launcher needs from the server instead of baking it into the build (the repository is
 * public, so no key is ever committed):
 *
 *   GET  /api/v1/launcher/config  → { microsoftClientId } – the Azure application ID for the Microsoft
 *                                    login (a public client ID, kept as the Worker secret MS_CLIENT_ID)
 *   GET|POST /api/v1/cf/v1/…      → CurseForge API with the Worker secret CF_API_KEY added on the
 *                                    server, limited to the calls the launcher makes (curseforge.js)
 */

const MS_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CF_API = 'https://api.curseforge.com';
const CF_GET = /^\/v1\/(mods\/search|categories|games\/432|mods\/\d{1,10}(\/description|\/files(\/\d{1,12})?)?)$/;
const CF_POST = new Set(['/v1/mods', '/v1/mods/files', '/v1/fingerprints/432']);
const CF_CACHE = 'https://nore-internal.invalid/cf';
const MAX_BODY = 64 * 1024;

export function launcherConfig(env) {
  const id = String(env.MS_CLIENT_ID || '').trim();
  return { microsoftClientId: MS_ID.test(id) ? id : null };
}

const cfError = (status, error) => new Response(JSON.stringify({ error, status }), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
});

export async function curseforge(request, url, env, ctx) {
  const path = url.pathname.slice('/api/v1/cf'.length);
  const post = request.method === 'POST';
  if (post ? !CF_POST.has(path) : !CF_GET.test(path)) return cfError(404, 'Nie ma takiego zapytania CurseForge');
  if (!env.CF_API_KEY) return cfError(503, 'CurseForge nie jest skonfigurowany na serwerze');

  let body;
  if (post) {
    body = await request.text();
    if (body.length > MAX_BODY) return cfError(413, 'Za duże zapytanie');
  }
  const cacheKey = new Request(CF_CACHE + path + url.search);
  if (!post) {
    const hit = await caches.default.match(cacheKey);
    if (hit) return hit;
  }
  const res = await fetch(CF_API + path + url.search, {
    method: request.method,
    headers: { 'x-api-key': env.CF_API_KEY, Accept: 'application/json', ...(post ? { 'Content-Type': 'application/json' } : {}) },
    body,
  });
  const out = new Response(res.body, {
    status: res.status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': !post && res.ok ? 'public, max-age=300' : 'no-store' },
  });
  if (!post && res.ok) ctx.waitUntil(caches.default.put(cacheKey, out.clone()));
  return out;
}
