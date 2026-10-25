/*
 * Host routing: one Worker answers noroclient.pl, noreclient.pl and mc.noreclient.pl.
 *   www.<anything>       → 301 to the apex host (same path and query)
 *   mc.noreclient.pl     → static files from public/mc/ (the Minecraft server site); /api/* is the same API
 *   other hosts          → public/ as before; /mc/… there redirects to the mc host
 * TEST_HOST_HEADER names a request header that replaces the host (local tests only: wrangler dev
 * maps every request onto the first route host).
 */
export const MC_HOST = 'mc.noreclient.pl';

export const siteOf = (hostname) => (hostname.toLowerCase() === MC_HOST ? 'mc' : 'main');

/** The request URL with the test host applied (only when TEST_HOST_HEADER is set). */
export function effectiveUrl(request, env) {
  const url = new URL(request.url);
  const h = env.TEST_HOST_HEADER && request.headers.get(env.TEST_HOST_HEADER);
  if (h && /^[a-z0-9.-]{1,253}$/i.test(h)) url.hostname = h;
  return url;
}

/** www.* → apex, or null. */
export function wwwRedirect(url) {
  if (!url.hostname.startsWith('www.')) return null;
  const to = new URL(url);
  to.hostname = url.hostname.slice(4);
  return Response.redirect(to.toString(), 301);
}

/** A static file of the mc site: /x → /mc/x in the assets, and redirects from the assets are mapped back. */
export async function mcAsset(request, url, env) {
  if (url.pathname.startsWith('/assets/')) return env.ASSETS.fetch(request); // shared images (logo …)
  const inner = new URL(url);
  inner.pathname = '/mc' + (url.pathname === '/' ? '/' : url.pathname);
  const res = await env.ASSETS.fetch(new Request(inner, request));
  const loc = res.headers.get('Location');
  if (loc && res.status >= 300 && res.status < 400) {
    const l = new URL(loc, inner);
    if (l.pathname === '/mc' || l.pathname.startsWith('/mc/')) {
      const out = new Response(res.body, res);
      out.headers.set('Location', (l.pathname.slice(3) || '/') + l.search);
      return out;
    }
  }
  return res;
}
