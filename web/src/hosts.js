/*
 * Host routing: one Worker answers noroclient.pl, noreclient.pl and mc.noreclient.pl.
 *   www.<anything>       → 301 to the apex host (same path and query)
 *   mc.noreclient.pl     → static files from public/mc/ (the Minecraft server site); /api/* is the same API
 *   other hosts          → public/ as before; /mc/… there redirects to the mc host
 * MC_HOSTS (comma list) adds hosts treated as the Minecraft site (local tests only).
 */
export const MC_HOST = 'mc.noreclient.pl';

export function siteOf(hostname, env) {
  const h = hostname.toLowerCase();
  const extra = String(env.MC_HOSTS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  return h === MC_HOST || extra.includes(h) ? 'mc' : 'main';
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
