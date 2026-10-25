/*
 * Data shared by API v1 (src/worker.js) and API v2 (src/v2/): the GitHub releases with their
 * stale-while-revalidate cache, the Nore events and the platform list. API v1 answers are built
 * from these exactly as before (scripts/test/v1-snapshot.mjs checks it).
 */
import PLATFORMS from '../../platforms/platforms.json';

export const REPO = 'kondzio444/Noreclienr';
const FRESH_SECONDS = 300;        // data younger than this is served as is
const KEEP_SECONDS = 7 * 86400;   // stale data is still served (and refreshed in the background)
export const INTERNAL = 'https://nore-internal.invalid/';

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// ---------------------------------------------------------------- cache (stale-while-revalidate)

export async function readCache(name) {
  const hit = await caches.default.match(new Request(INTERNAL + name));
  if (!hit) return null;
  return { data: await hit.json(), storedAt: Number(hit.headers.get('X-Stored-At') || 0) };
}

export async function writeCache(name, data) {
  await caches.default.put(new Request(INTERNAL + name), new Response(JSON.stringify(data), {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': `public, max-age=${KEEP_SECONDS}`, 'X-Stored-At': String(Date.now()) },
  }));
}

/** Cached value: fresh → served; stale → served now and refreshed in the background; missing → loaded. */
export async function cached(name, loader, ctx) {
  const hit = await readCache(name);
  if (hit) {
    const age = (Date.now() - hit.storedAt) / 1000;
    if (age < FRESH_SECONDS) return { data: hit.data, state: 'HIT' };
    ctx.waitUntil(loader().then(d => writeCache(name, d)).catch(() => {}));
    return { data: hit.data, state: 'STALE' };
  }
  const data = await loader();
  ctx.waitUntil(writeCache(name, data));
  return { data, state: 'MISS' };
}

// ---------------------------------------------------------------- GitHub releases

export async function fetchReleases(env) {
  const headers = { 'User-Agent': 'nore-web', Accept: 'application/vnd.github+json' };
  if (env.GITHUB_TOKEN) headers.Authorization = `Bearer ${env.GITHUB_TOKEN}`;
  const res = await fetch(`${env.GITHUB_API || 'https://api.github.com'}/repos/${REPO}/releases?per_page=30`, { headers }); // GITHUB_API: tests only
  if (!res.ok) throw new HttpError(502, `GitHub odpowiedział ${res.status}`);
  const list = await res.json();
  return list.filter(r => !r.draft).map(shapeRelease);
}

export const ASSET_PATTERNS = {
  win: /NoreLauncher-Setup-.*\.exe$/i,
  linux: /NoreLauncher-.*\.AppImage$/i,
  mac: /NoreLauncher-.*\.dmg$/i,
  macZip: /NoreLauncher-.*-mac\.zip$|NoreLauncher-.*\.zip$/i,
};

export function cmpVersion(a, b) {
  const pa = String(a).replace(/^v/, '').split(/[.-]/).map(n => parseInt(n, 10) || 0);
  const pb = String(b).replace(/^v/, '').split(/[.-]/).map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  }
  return 0;
}

export function shapeRelease(r) {
  const assets = {};
  let downloads = 0;
  for (const a of r.assets || []) {
    downloads += a.download_count || 0;
    for (const [k, re] of Object.entries(ASSET_PATTERNS)) {
      if (!assets[k] && re.test(a.name)) assets[k] = { name: a.name, size: a.size, url: a.browser_download_url, digest: a.digest || null, downloads: a.download_count || 0 };
    }
  }
  const mods = (r.assets || []).filter(a => /^noreclient-.*\.jar$/i.test(a.name))
    .map(a => ({ name: a.name, size: a.size, url: a.browser_download_url, digest: a.digest || null, downloads: a.download_count || 0 }));
  return {
    version: String(r.tag_name || '').replace(/^v/, ''),
    name: r.name,
    prerelease: !!r.prerelease,
    published: r.published_at,
    notes: (r.body || '').slice(0, 8000),
    url: r.html_url,
    downloads,
    assets,
    mods,
  };
}

export async function releases(env, ctx) {
  const r = await cached('releases', () => fetchReleases(env), ctx);
  if (!r.data.length) throw new HttpError(404, 'Nie ma jeszcze żadnego wydania');
  return r;
}

export const brief = (r) => ({ version: r.version, name: r.name, prerelease: r.prerelease, published: r.published, url: r.url, downloads: r.downloads });

// ---------------------------------------------------------------- events

/** Nore events are forced on (cannot be switched off); the winter event starts on 10 December 2026. */
export const WINTER_START = '2026-12-10T00:00:00+01:00';
export function events() {
  const winter = Date.now() >= Date.parse(WINTER_START);
  return [
    { id: 'halloween', name: 'Halloween w Nore', forced: true, active: true, accent: '#ff8a1f', features: ['Dyniowe dekoracje', 'Peleryny Halloween', 'Kapelusz Wiedźmy', 'Skrzydła Nietoperza', 'Mini-gra Cukierek albo psikus'] },
    { id: 'christmas', name: 'Święta w Nore', forced: true, active: winter, startsAt: WINTER_START, accent: '#ff4d6d', features: ['Śnieg w menu i w launcherze', 'Świąteczne lampki', 'Zimowy motyw launchera'] },
  ];
}

// ---------------------------------------------------------------- background sync (Cron Trigger)

export async function sync(env) {
  const started = Date.now();
  const meta = { at: new Date(started).toISOString(), ok: false, ms: 0, releases: 0, error: null };
  try {
    const list = await fetchReleases(env);
    await writeCache('releases', list);
    meta.ok = true;
    meta.releases = list.length;
  } catch (e) {
    meta.error = String(e.message || e);
  }
  meta.ms = Date.now() - started;
  await writeCache('sync', meta);
  return meta;
}

export function platformsView() {
  return PLATFORMS.map(x => ({ name: x.name, loader: x.loader, java: x.java, versions: x.versions }));
}

export { PLATFORMS };
