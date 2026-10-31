/*
 * Public API v2 data: status, releases, downloads, events, news, platforms, players, stats.
 * Built on the same cached GitHub data as API v1 (src/data.js).
 */
import NEWS from '../news.json';
import { readCache, releases, events as v1Events, PLATFORMS, WINTER_START, assetLocation } from '../data.js';
import { hubCall } from '../hub.js';
import { ApiError } from './http.js';
import { botStore } from './store.js';
import { counters } from './counters.js';
import { SCHEMA } from './bot.js';

export const PLATFORM_IDS = { win: 'win', linux: 'linux', mac: 'mac', 'mac-zip': 'macZip' };
const PLATFORM_NAMES = { win: 'Windows', linux: 'Linux (AppImage)', mac: 'macOS (DMG)', 'mac-zip': 'macOS (ZIP)' };
const NAME = /^[A-Za-z0-9_]{2,16}$/;

/** Runs `p` with a time limit; resolves to { ok, value | error, ms }. */
async function timed(p, ms = 2500) {
  const t0 = Date.now();
  let t;
  try {
    const value = await Promise.race([p, new Promise((_, rej) => { t = setTimeout(() => rej(new Error('przekroczony czas')), ms); })]);
    return { ok: true, value, ms: Date.now() - t0 };
  } catch (e) {
    return { ok: false, error: String(e.message || e), ms: Date.now() - t0 };
  } finally { clearTimeout(t); }
}

const releaseView = (r, { notes = true } = {}) => ({
  version: r.version, name: r.name, prerelease: r.prerelease, published: r.published, url: r.url, downloads: r.downloads,
  ...(notes ? { notes: r.notes } : {}), assets: r.assets, mods: r.mods,
});

const truthy = (v) => v === '1' || v === 'true' || v === 'yes';
const falsy = (v) => v === '0' || v === 'false' || v === 'no';

// ---------------------------------------------------------------- status

export async function status(request, env) {
  const [syncMeta, rel, hub, bot, clicks] = await Promise.all([
    readCache('sync'), readCache('releases'),
    timed(hubCall(env, 'stats', {})),
    timed(Promise.resolve(botStore(env)).then(s => (s ? s.stats() : Promise.reject(new Error('brak powiązania BOT'))))),
    timed(Promise.resolve(counters(env)).then(s => (s ? s.read('download', 1) : Promise.reject(new Error('brak powiązania COUNTERS'))))),
  ]);
  const relAge = rel ? Math.round((Date.now() - rel.storedAt) / 1000) : null;
  const components = {
    api: { status: 'ok' },
    releases: rel ? { status: relAge < 3 * 3600 ? 'ok' : 'stale', ageSeconds: relAge, count: rel.data.length, latest: rel.data[0] ? rel.data[0].version : null } : { status: 'unknown', note: 'Dane wydań pobiorą się przy pierwszym zapytaniu albo synchronizacji' },
    sync: syncMeta ? { status: syncMeta.data.ok ? 'ok' : 'error', at: syncMeta.data.at, ageSeconds: Math.round((Date.now() - Date.parse(syncMeta.data.at)) / 1000), ms: syncMeta.data.ms, error: syncMeta.data.error } : { status: 'unknown' },
    hub: hub.ok ? { status: 'ok', ms: hub.ms, online: hub.value.online, known: hub.value.known } : { status: 'down', ms: hub.ms, error: hub.error },
    bot: bot.ok ? { status: 'ok', ms: bot.ms, guilds: bot.value.guilds, botApi: String(env.NORE_BOT_SECRET || '').length >= 16 } : { status: 'down', ms: bot.ms, error: bot.error },
    counters: clicks.ok ? { status: 'ok', ms: clicks.ms } : { status: 'down', ms: clicks.ms, error: clicks.error },
    panelLogin: { status: env.DISCORD_CLIENT_ID && env.DISCORD_CLIENT_SECRET && String(env.SESSION_KEY || '').length >= 32 ? 'ok' : 'disabled' },
    serverPing: { status: 'ok', rateLimit: env.SLP_LIMIT ? 'binding' : 'isolate' },
  };
  const bad = Object.values(components).filter(c => c.status === 'down' || c.status === 'error').length;
  return {
    status: bad === 0 ? 'ok' : bad >= 3 ? 'down' : 'degraded',
    service: 'nore-api',
    time: new Date().toISOString(),
    colo: (request.cf && request.cf.colo) || null,
    latest: rel && rel.data[0] ? rel.data[0].version : null,
    hub: hub.ok ? { online: hub.value.online, known: hub.value.known } : null,
    components,
  };
}

// ---------------------------------------------------------------- releases & downloads

async function releaseList(env, ctx, q) {
  const { data, state } = await releases(env, ctx);
  const list = falsy(q.get('prerelease')) ? data.filter(r => !r.prerelease) : data;
  return { list, state };
}

export async function releasesList(env, ctx, q) {
  const limit = Math.max(1, Math.min(30, parseInt(q.get('limit') || '10', 10) || 10));
  const { list, state } = await releaseList(env, ctx, q);
  const notes = truthy(q.get('notes'));
  return { body: { count: Math.min(limit, list.length), releases: list.slice(0, limit).map(r => releaseView(r, { notes })) }, state };
}

export async function releaseLatest(env, ctx, q) {
  const { list, state } = await releaseList(env, ctx, q);
  if (!list.length) throw new ApiError(404, 'no_release', 'Nie ma jeszcze stabilnego wydania');
  return { body: { release: releaseView(list[0]) }, state };
}

export async function releaseOne(env, ctx, version) {
  const { data, state } = await releases(env, ctx);
  const v = String(version).replace(/^v/, '');
  const r = data.find(x => x.version === v);
  if (!r) throw new ApiError(404, 'no_release', `Nie ma wydania ${v}`);
  return { body: { release: releaseView(r) }, state };
}

async function clickCounts(env) {
  const c = counters(env);
  if (!c) return null;
  const r = await timed(c.read('download', 30), 2000);
  return r.ok ? r.value : null;
}

export async function downloads(env, ctx) {
  const [{ data, state }, clicks] = await Promise.all([releases(env, ctx), clickCounts(env)]);
  const latest = data[0];
  const github = { win: 0, linux: 0, mac: 0, 'mac-zip': 0 };
  for (const r of data) for (const [id, k] of Object.entries(PLATFORM_IDS)) if (r.assets[k]) github[id] += r.assets[k].downloads;
  const platforms = Object.entries(PLATFORM_IDS).map(([id, k]) => {
    const a = latest.assets[k];
    return {
      id, name: PLATFORM_NAMES[id], available: !!a, href: `/api/v2/downloads/${id}`,
      file: a ? a.name : null, size: a ? a.size : null, digest: a ? a.digest : null, url: a ? a.url : null,
      downloads: { latest: a ? a.downloads : 0, allReleases: github[id], redirects: clicks ? clicks.totals[`download:${id}`] || 0 : null },
    };
  });
  return {
    body: {
      version: latest.version, published: latest.published, prerelease: latest.prerelease,
      platforms, mods: latest.mods,
      totals: { github: data.reduce((a, r) => a + r.downloads, 0), redirects: clicks ? clicks.totals.download || 0 : null },
      daily: clicks ? clicks.daily : null,
      note: 'downloads.latest / allReleases: liczniki GitHub Releases (ostatnie 30 wydań); redirects: kliknięcia /api/v2/downloads/:platform.',
    },
    state,
  };
}

/** 302 to the installer; counts the click in the background. */
export async function downloadRedirect(request, env, ctx, id) {
  const { data } = await releases(env, ctx);
  const a = data[0].assets[PLATFORM_IDS[id]];
  if (!a) throw new ApiError(404, 'no_file', `Najnowsze wydanie nie ma pliku dla ${PLATFORM_NAMES[id]}`);
  const c = counters(env);
  if (c && request.method === 'GET') ctx.waitUntil(c.hit(['download', `download:${id}`]).catch(() => {}));
  const file = (data[0].files || []).find(f => f.name === a.name);
  const location = file ? await assetLocation(env, file) : a.url;
  return new Response(null, { status: 302, headers: { Location: location, 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*', 'X-Nore-File': a.name } });
}

// ---------------------------------------------------------------- events

const tz = '+01:00'; // late October to February: Polish winter time
function countdown(at, kind, now) {
  const s = Math.max(0, Math.round((Date.parse(at) - now) / 1000));
  return { kind, at, seconds: s, days: Math.floor(s / 86400), hours: Math.floor((s % 86400) / 3600), minutes: Math.floor((s % 3600) / 60) };
}

export function eventsV2(now = Date.now()) {
  const year = new Date(now).getUTCFullYear();
  const list = v1Events().map(e => {
    if (e.id === 'halloween') {
      let peak = `${year}-10-31T00:00:00${tz}`;
      if (now >= Date.parse(`${year}-11-01T00:00:00${tz}`)) peak = `${year + 1}-10-31T00:00:00${tz}`;
      return { ...e, season: 'halloween', startsAt: null, endsAt: null, peakAt: peak, countdown: now < Date.parse(peak) ? countdown(peak, 'peak', now) : null };
    }
    if (e.id === 'christmas') {
      let eve = `${year}-12-24T00:00:00${tz}`;
      if (now >= Date.parse(`${year}-12-27T00:00:00${tz}`)) eve = `${year + 1}-12-24T00:00:00${tz}`;
      const cd = !e.active ? countdown(WINTER_START, 'start', now) : now < Date.parse(eve) ? countdown(eve, 'peak', now) : null;
      return { ...e, season: 'winter', startsAt: WINTER_START, endsAt: null, peakAt: eve, countdown: cd };
    }
    return { ...e, season: e.id, countdown: null };
  });
  const flags = { halloween: list.some(e => e.season === 'halloween' && e.active), winter: list.some(e => e.season === 'winter' && e.active) };
  const upcoming = list.filter(e => !e.active && e.countdown).sort((a, b) => a.countdown.seconds - b.countdown.seconds)[0] || null;
  return { now: new Date(now).toISOString(), active: list.filter(e => e.active).map(e => e.id), flags, next: upcoming ? { id: upcoming.id, countdown: upcoming.countdown } : null, events: list };
}

// ---------------------------------------------------------------- news, platforms

export function news(q) {
  const limit = Math.max(1, Math.min(50, parseInt(q.get('limit') || '20', 10) || 20));
  const tag = q.get('tag');
  const list = tag ? NEWS.filter(n => String(n.tag).toLowerCase() === tag.toLowerCase()) : NEWS;
  return { count: Math.min(limit, list.length), tags: [...new Set(NEWS.map(n => n.tag))], news: list.slice(0, limit) };
}

const verKey = (v) => v.split('.').map(n => parseInt(n, 10) || 0);
const cmpVer = (a, b) => { const x = verKey(a), y = verKey(b); for (let i = 0; i < 4; i++) if ((x[i] || 0) !== (y[i] || 0)) return (y[i] || 0) - (x[i] || 0); return 0; };

export function platforms() {
  const list = PLATFORMS.map(x => ({ name: x.name, loader: x.loader, java: x.java, versions: x.versions }));
  return {
    platforms: list,
    minecraft: [...new Set(list.flatMap(p => p.versions))].sort(cmpVer),
    loaders: [...new Set(list.map(p => p.loader))],
    downloads: Object.entries(PLATFORM_NAMES).map(([id, name]) => ({ id, name, href: `/api/v2/downloads/${id}` })),
  };
}

// ---------------------------------------------------------------- players (Nore Hub)

export async function player(env, raw) {
  const name = decodeURIComponent(raw);
  if (!NAME.test(name)) throw new ApiError(400, 'bad_name', 'Zły nick: 2–16 znaków, litery, cyfry lub _');
  const { players } = await hubCall(env, 'players', { names: [name.toLowerCase()] });
  const p = players[name.toLowerCase()];
  if (!p) return { player: { name, nore: false } };
  const slots = p.cosmetics && p.cosmetics.slots && typeof p.cosmetics.slots === 'object' ? p.cosmetics.slots : {};
  return {
    player: {
      name: p.name, nore: true, uuid: p.uuid, noreId: p.hex, verified: p.verified, online: p.online,
      seen: p.seen, seenAt: new Date(p.seen).toISOString(),
      wardrobe: Object.entries(slots).map(([slot, s]) => ({ slot, id: s.id, ...(s.variant ? { variant: s.variant } : {}), ...(s.color !== undefined ? { color: '#' + s.color.toString(16).padStart(6, '0') } : {}) })),
      cosmetics: p.cosmetics,
    },
  };
}

// ---------------------------------------------------------------- stats

export async function stats(env, ctx) {
  const [rel, hub, bot, clicks] = await Promise.all([
    releases(env, ctx).then(r => r.data).catch(() => null),
    timed(hubCall(env, 'stats', {})),
    timed(Promise.resolve(botStore(env)).then(s => (s ? s.stats() : Promise.reject(new Error('brak BOT'))))),
    clickCounts(env),
  ]);
  let downloadsOut = null;
  if (rel) {
    const d = { total: 0, win: 0, linux: 0, mac: 0, mods: 0 };
    for (const r of rel) {
      d.total += r.downloads;
      for (const k of ['win', 'linux', 'mac']) if (r.assets[k]) d[k] += r.assets[k].downloads;
      if (r.assets.macZip) d.mac += r.assets.macZip.downloads;
      for (const m of r.mods) d.mods += m.downloads;
    }
    downloadsOut = d;
  }
  return {
    releases: rel ? rel.length : null,
    latest: rel && rel[0] ? { version: rel[0].version, downloads: rel[0].downloads } : null,
    downloads: downloadsOut,
    redirects: clicks ? { total: clicks.totals.download || 0, win: clicks.totals['download:win'] || 0, linux: clicks.totals['download:linux'] || 0, mac: clicks.totals['download:mac'] || 0, 'mac-zip': clicks.totals['download:mac-zip'] || 0, daily: clicks.daily } : null,
    hub: hub.ok ? hub.value : null,
    online: hub.ok ? hub.value.online : null,
    known: hub.ok ? hub.value.known : null,
    bot: bot.ok ? bot.value : null,
    schema: { version: SCHEMA['x-version'] ?? null, placeholder: SCHEMA['x-placeholder'] === true },
  };
}
