/*
 * Single-script build of the website for deploying through the Cloudflare API without the
 * static-assets upload: the page, styles and script are bundled as text and images are served
 * from the repository (GitHub raw, edge-cached). CI (wrangler + assets) uses src/worker.js directly.
 */
import worker from './worker.js';
import INDEX from '../public/index.html';
import NOT_FOUND from '../public/404.html';
import STYLE from '../public/style.css';
import APP from '../dist/app.js.txt';

const RAW = 'https://raw.githubusercontent.com/kondzio444/Noreclienr/3fa206c97bdc40bfcf07af15f68bb1bbba50ab5d/web/public';
const TEXT = {
  '/': [INDEX, 'text/html; charset=utf-8'],
  '/index.html': [INDEX, 'text/html; charset=utf-8'],
  '/style.css': [STYLE, 'text/css; charset=utf-8'],
  '/app.js': [APP, 'text/javascript; charset=utf-8'],
};
const TYPES = { png: 'image/png', gif: 'image/gif', jpg: 'image/jpeg', svg: 'image/svg+xml', ico: 'image/x-icon' };

const ASSETS = {
  async fetch(request, ctx) {
    const url = new URL(request.url);
    const t = TEXT[url.pathname];
    if (t) return new Response(t[0], { headers: { 'Content-Type': t[1], 'Cache-Control': 'public, max-age=300' } });
    const m = url.pathname.match(/^\/assets\/([\w.-]+)\.(png|gif|jpg|svg|ico)$/);
    if (m) {
      const cache = caches.default;
      const key = new Request(url.origin + url.pathname);
      const hit = await cache.match(key);
      if (hit) return hit;
      const res = await fetch(RAW + url.pathname);
      if (!res.ok) return new Response('Not found', { status: 404 });
      const out = new Response(res.body, { headers: { 'Content-Type': TYPES[m[2]], 'Cache-Control': 'public, max-age=86400' } });
      if (ctx) ctx.waitUntil(cache.put(key, out.clone()));
      return out;
    }
    return new Response(NOT_FOUND, { status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  },
};

export default {
  fetch(request, env, ctx) {
    return worker.fetch(request, { ...env, ASSETS: { fetch: (r) => ASSETS.fetch(r, ctx) } }, ctx);
  },
};
