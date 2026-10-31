/*
 * Single-script build of the website for deploying through the Cloudflare API without the
 * static-assets upload: the page, styles and script are bundled as text and images are served
 * from the repository (GitHub raw, edge-cached). CI (wrangler + assets) uses src/worker.js directly.
 */
import worker from './worker.js';

export { NoreHub, NoreBot, NoreCounters } from './worker.js';
import INDEX from '../public/index.html';
import NOT_FOUND from '../public/404.html';
import STYLE from '../public/style.css';
import APP from '../dist/app.js.txt';
import API_PAGE from '../public/api.html';
import API_STYLE from '../public/api.css';
import API_APP from '../dist/api.js.txt';
import TOKENS from '../public/assets/tokens.css';
import ALBUM_CSS from '../public/assets/album.css';
import ALBUM_JS from '../dist/album.js.txt';
import MC_INDEX from '../public/mc/index.html';
import MC_404 from '../public/mc/404.html';
import MC_STYLE from '../public/mc/mc.css';
import MC_APP from '../dist/mc.js.txt';
import PANEL from '../public/panel/index.html';
import PANEL_STYLE from '../public/panel/panel.css';
import PANEL_APP from '../dist/panel.js.txt';
import LOCALE_PL from '../dist/locale-pl.json.txt';
import LOCALE_EN from '../dist/locale-en.json.txt';

// Images and fonts come from this pinned commit; bump it after the Album website (assets/album, assets/fonts) is merged.
const RAW = 'https://raw.githubusercontent.com/kondzio444/Noreclienr/4279ca91fbfc72b1610a2f3de3df6ab502ad42ff/web/public';
const HTML = 'text/html; charset=utf-8', CSS = 'text/css; charset=utf-8', JS = 'text/javascript; charset=utf-8', JSON_T = 'application/json; charset=utf-8';
const TEXT = {
  '/': [INDEX, HTML], '/index.html': [INDEX, HTML], '/404.html': [NOT_FOUND, HTML],
  '/style.css': [STYLE, CSS], '/app.js': [APP, JS],
  '/api': [API_PAGE, HTML], '/api.html': [API_PAGE, HTML], '/api.css': [API_STYLE, CSS], '/api.js': [API_APP, JS],
  '/assets/tokens.css': [TOKENS, CSS], '/assets/album.css': [ALBUM_CSS, CSS], '/assets/album.js': [ALBUM_JS, JS],
  '/mc/': [MC_INDEX, HTML], '/mc/index.html': [MC_INDEX, HTML], '/mc/404.html': [MC_404, HTML], '/mc/mc.css': [MC_STYLE, CSS], '/mc/mc.js': [MC_APP, JS],
  '/panel/': [PANEL, HTML], '/panel/index.html': [PANEL, HTML], '/panel/panel.css': [PANEL_STYLE, CSS], '/panel/panel.js': [PANEL_APP, JS],
  '/panel/locales/pl.json': [LOCALE_PL, JSON_T], '/panel/locales/en.json': [LOCALE_EN, JSON_T],
};
const TYPES = { png: 'image/png', gif: 'image/gif', jpg: 'image/jpeg', svg: 'image/svg+xml', ico: 'image/x-icon', webp: 'image/webp', webm: 'video/webm', mp4: 'video/mp4', woff2: 'font/woff2', txt: 'text/plain; charset=utf-8' };

const ASSETS = {
  async fetch(request, ctx) {
    const url = new URL(request.url);
    const t = TEXT[url.pathname];
    if (t) return new Response(t[0], { headers: { 'Content-Type': t[1], 'Cache-Control': 'public, max-age=300' } });
    const m = url.pathname.match(/^\/assets\/([\w./-]+)\.(png|gif|jpg|svg|ico|webp|webm|mp4|woff2|txt)$/);
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
    if (url.pathname === '/panel') return Response.redirect(url.origin + '/panel/', 307);
    return new Response(url.pathname.startsWith('/mc/') ? MC_404 : NOT_FOUND, { status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  },
};

export default {
  fetch(request, env, ctx) {
    return worker.fetch(request, { ...env, ASSETS: { fetch: (r) => ASSETS.fetch(r, ctx) } }, ctx);
  },
  scheduled(event, env, ctx) {
    return worker.scheduled(event, env, ctx);
  },
};
