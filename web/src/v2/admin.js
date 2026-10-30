/*
 * Admin API – /api/v2/admin/* (docs/admin-api.md), used by the private AdmNoreclient app.
 *
 * Who may call it:
 *   - `Authorization: Admin <ADMIN_TOKEN>` (Worker secret, at least 32 characters) – the desktop app
 *   - the panel session cookie (Discord login, src/v2/auth.js) of a user listed in the Worker
 *     secret ADMIN_DISCORD_IDS (comma separated Discord user IDs)
 * Both are compared in constant time; without either secret every admin route answers 503.
 * Every write is recorded in the audit log (who, what, target, data, IP).
 *
 * Also here, because they read the admin data:
 *   GET  /api/v2/announcements?target=launcher|mod|web|discord     active announcements (public)
 *   GET  /api/v2/client/config?target=launcher|mod                  maintenance, minimum launcher
 *                                                                    version, kill-switch, features,
 *                                                                    announcements (public)
 *   GET  /api/v2/blacklist/check?name=&uuid=&noreId=&discord=       is someone blacklisted (public)
 *   GET  /api/v2/bot/admin                                          bot: blacklisted Discord IDs,
 *                                                                    pending actions, announcements
 *   POST /api/v2/bot/actions/:id                                    bot: an action is done / failed
 */
import { ApiError, readJson, safeEqual, randomToken, allowedOrigin, clientIp } from './http.js';
import { session } from './auth.js';
import { store, unwrap, guildIdOf, iso, SCHEMA, SNOWFLAKE, requireBot } from './bot.js';
import { adminStore, FLAG_DEFAULTS } from './admin-store.js';
import { validate, applyDefaults, effectiveConfig } from './schema.js';
import { hubCall } from '../hub.js';
import { cachedPing } from './slp.js';
import * as pub from './public.js';
import { readCache, writeCache, releases, sync, REPO, githubApi, githubHeaders, cmpVersion, privateReleases } from '../data.js';

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const NAME = /^[A-Za-z0-9_]{2,16}$/;
const UUID = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i;
const NORE_ID = /^[0-9a-f]{20}$/i;
const VERSION = /^\d{1,4}\.\d{1,4}\.\d{1,4}([-.+][\w.-]{1,20})?$/;
export const KINDS = ['mc_name', 'mc_uuid', 'nore_id', 'discord'];
export const LEVELS = ['info', 'warning', 'event'];
export const TARGETS = ['launcher', 'mod', 'web', 'discord'];
export const ACTION_TYPES = ['message', 'leave', 'reload', 'meta', 'announce'];

function admins(env) {
  const r = adminStore(env);
  if (!r) throw new ApiError(503, 'unavailable', 'Magazyn administracji jest chwilowo niedostępny (brak powiązania ADMIN)');
  return r;
}

// ---------------------------------------------------------------- auth

const adminIds = (env) => String(env.ADMIN_DISCORD_IDS || '').split(/[\s,;]+/).filter(x => SNOWFLAKE.test(x));

/** The admin making this request, or an ApiError (401 / 403 / 503). */
export async function requireAdmin(request, env) {
  const token = String(env.ADMIN_TOKEN || '');
  const ids = adminIds(env);
  if (token.length < 32 && !ids.length) throw new ApiError(503, 'admin_disabled', 'Panel administratora nie jest skonfigurowany (ADMIN_TOKEN albo ADMIN_DISCORD_IDS)');
  const h = request.headers.get('Authorization') || '';
  const m = /^Admin\s+(\S{1,512})$/.exec(h);
  if (m) {
    if (token.length < 32) throw new ApiError(503, 'admin_disabled', 'Logowanie tokenem jest wyłączone – brak ADMIN_TOKEN (min. 32 znaki)');
    if (!(await safeEqual(m[1], token))) throw new ApiError(401, 'unauthorized', 'Zły token administratora');
    return { via: 'token', id: 'token', name: 'Token administratora' };
  }
  if (h) throw new ApiError(401, 'unauthorized', 'Nagłówek musi mieć postać Authorization: Admin <token>');
  if (!ids.length) throw new ApiError(401, 'unauthorized', 'Brak nagłówka Authorization: Admin <token>');
  const sess = await session(request, env);
  // constant-time membership check (no early exit on the first match)
  let ok = false;
  for (const id of ids) ok = (await safeEqual(sess.user.id, id)) || ok;
  if (!ok) throw new ApiError(403, 'not_admin', 'To konto Discord nie jest administratorem Nore');
  if (request.method !== 'GET' && request.method !== 'HEAD' && request.headers.get('Origin') && !allowedOrigin(request, env)) {
    throw new ApiError(403, 'bad_origin', 'Żądanie z obcej strony zostało odrzucone');
  }
  return { via: 'discord', id: sess.user.id, name: sess.user.globalName || sess.user.username };
}

// ---------------------------------------------------------------- validation

const str = (v, max, field, { required = false, min = 0 } = {}) => {
  if (v === undefined || v === null || v === '') {
    if (required) throw new ApiError(400, 'bad_field', `${field}: pole wymagane`);
    return '';
  }
  if (typeof v !== 'string') throw new ApiError(400, 'bad_field', `${field}: musi być tekstem`);
  const t = v.trim();
  if (t.length < min || t.length > max) throw new ApiError(400, 'bad_field', `${field}: ${min ? `${min}–` : 'do '}${max} znaków`);
  return t;
};

/** ms since epoch from an ISO string / number / null. */
function time(v, field) {
  if (v === undefined || v === null || v === '') return null;
  const t = typeof v === 'number' ? v : Date.parse(v);
  if (!Number.isFinite(t) || t < 0) throw new ApiError(400, 'bad_field', `${field}: zła data (ISO 8601 albo milisekundy)`);
  return Math.floor(t);
}

/** Guesses the kind of a blacklist value. */
export function detectKind(value) {
  const v = String(value || '').trim();
  if (/^\d{17,20}$/.test(v)) return 'discord';
  if (NORE_ID.test(v)) return 'nore_id';
  if (UUID.test(v)) return 'mc_uuid';
  if (NAME.test(v)) return 'mc_name';
  return null;
}

/** { kind, value (normalised), display } or 400. */
export function normaliseSubject(kind, raw) {
  const v = typeof raw === 'string' ? raw.trim() : '';
  const k = kind === 'auto' || !kind ? detectKind(v) : kind;
  if (!KINDS.includes(k)) throw new ApiError(400, 'bad_kind', `kind: jedno z ${KINDS.join(', ')} (albo auto)`);
  if (k === 'mc_name' && NAME.test(v)) return { kind: k, value: v.toLowerCase(), display: v };
  if (k === 'mc_uuid' && UUID.test(v)) return { kind: k, value: v.replace(/-/g, '').toLowerCase(), display: v.toLowerCase() };
  if (k === 'nore_id' && NORE_ID.test(v)) return { kind: k, value: v.toLowerCase(), display: v.toLowerCase() };
  if (k === 'discord' && SNOWFLAKE.test(v)) return { kind: k, value: v, display: v };
  const what = { mc_name: 'nick Minecraft (2–16 znaków: litery, cyfry, _)', mc_uuid: 'UUID Minecraft (32 znaki hex)', nore_id: 'Nore ID (20 znaków hex)', discord: 'ID Discord (17–20 cyfr)' }[k];
  throw new ApiError(400, 'bad_value', `value: to nie jest ${what}`);
}

function cleanAnnouncement(b, old) {
  const a = {
    title: str(b.title ?? old?.title, 120, 'title', { required: true, min: 1 }),
    body: str(b.body ?? old?.body ?? '', 2000, 'body'),
    level: b.level ?? old?.level ?? 'info',
    targets: b.targets ?? old?.targets ?? ['launcher', 'mod', 'web'],
    link: b.link === undefined ? old?.link ?? null : b.link || null,
    starts: b.startsAt === undefined ? old?.starts ?? Date.now() : time(b.startsAt, 'startsAt') ?? Date.now(),
    ends: b.endsAt === undefined ? old?.ends ?? null : time(b.endsAt, 'endsAt'),
  };
  if (!LEVELS.includes(a.level)) throw new ApiError(400, 'bad_field', `level: jedno z ${LEVELS.join(', ')}`);
  if (!Array.isArray(a.targets) || !a.targets.length || a.targets.some(t => !TARGETS.includes(t))) throw new ApiError(400, 'bad_field', `targets: niepusta lista z ${TARGETS.join(', ')}`);
  a.targets = [...new Set(a.targets)];
  if (a.link !== null && (typeof a.link !== 'string' || a.link.length > 300 || !/^https:\/\/[^\s]+$/.test(a.link))) throw new ApiError(400, 'bad_field', 'link: adres https:// (do 300 znaków)');
  if (a.ends !== null && a.ends <= a.starts) throw new ApiError(400, 'bad_field', 'endsAt musi być po startsAt');
  return a;
}

export function cleanFlags(b) {
  const out = {};
  if ('maintenance' in b) {
    const m = b.maintenance;
    if (!isObj(m) || typeof m.enabled !== 'boolean') throw new ApiError(400, 'bad_field', 'maintenance: { enabled: true/false, message }');
    out.maintenance = { enabled: m.enabled, message: str(m.message, 300, 'maintenance.message') };
  }
  if ('minLauncherVersion' in b) {
    const v = b.minLauncherVersion;
    if (v !== null && v !== '' && (typeof v !== 'string' || !VERSION.test(v.trim().replace(/^v/, '')))) throw new ApiError(400, 'bad_field', 'minLauncherVersion: wersja w postaci 1.5.0 albo null');
    out.minLauncherVersion = v ? v.trim().replace(/^v/, '') : null;
  }
  if ('killSwitch' in b) {
    const k = b.killSwitch;
    if (!isObj(k) || !Array.isArray(k.modules) || k.modules.length > 100 || k.modules.some(x => typeof x !== 'string' || !x.trim() || x.length > 48)) {
      throw new ApiError(400, 'bad_field', 'killSwitch: { modules: [nazwy modułów, do 100] }');
    }
    out.killSwitch = { modules: [...new Set(k.modules.map(x => x.trim()))] };
  }
  if ('features' in b) {
    const f = b.features;
    if (!isObj(f) || Object.keys(f).length > 100 || Object.entries(f).some(([k, v]) => !/^[a-zA-Z][\w.-]{0,47}$/.test(k) || typeof v !== 'boolean')) {
      throw new ApiError(400, 'bad_field', 'features: { nazwa: true/false } (do 100)');
    }
    out.features = f;
  }
  if (!Object.keys(out).length) throw new ApiError(400, 'bad_field', `Podaj co najmniej jedno z: ${Object.keys(FLAG_DEFAULTS).join(', ')}`);
  return out;
}

// ---------------------------------------------------------------- shapes

const announcementView = (a) => ({
  id: a.id, title: a.title, body: a.body, level: a.level, targets: a.targets, link: a.link,
  startsAt: iso(a.starts), endsAt: iso(a.ends), updatedAt: iso(a.updated),
});
const announcementAdminView = (a, now = Date.now()) => ({
  ...announcementView(a), createdAt: iso(a.created), by: a.by,
  state: a.starts > now ? 'scheduled' : a.ends !== null && a.ends <= now ? 'ended' : 'active',
});
const blacklistView = (e) => ({ ...e, created: iso(e.created), expires: iso(e.expires) });
const warnView = (w) => ({ ...w, created: iso(w.created), revoked: iso(w.revoked) });
const auditView = (a) => ({ ...a, at: iso(a.at) });
const actionView = (a) => ({ ...a, created: iso(a.created), doneAt: iso(a.doneAt) });

/** Time-limited promise: { ok, value | error }. */
async function timed(p, ms = 3000) {
  let t;
  try {
    const value = await Promise.race([p, new Promise((_, rej) => { t = setTimeout(() => rej(new Error('przekroczony czas')), ms); })]);
    return { ok: true, value };
  } catch (e) { return { ok: false, error: String(e.message || e) }; } finally { clearTimeout(t); }
}
const val = (r) => (r.ok ? r.value : { error: r.error });

/** Pushes the hub-relevant blacklist (Minecraft names / UUIDs, Nore IDs) to Nore Hub. */
async function syncHub(env) {
  const list = await admins(env).blacklist();
  const entries = list.filter(e => e.kind !== 'discord').map(e => ({ kind: e.kind, value: e.value, expires: e.expires }));
  return hubCall(env, 'blacklist', { entries });
}

// ---------------------------------------------------------------- public (+ bot) readers

export async function announcementsPublic(env, q) {
  const target = q.get('target');
  if (target && !TARGETS.includes(target)) throw new ApiError(400, 'bad_target', `target: jedno z ${TARGETS.join(', ')}`);
  const list = await admins(env).announcements({ active: true, target: target || null });
  return { count: list.length, announcements: list.map(announcementView) };
}

export async function clientConfig(env, ctx, q) {
  const target = q.get('target') || 'launcher';
  if (!['launcher', 'mod'].includes(target)) throw new ApiError(400, 'bad_target', 'target: launcher albo mod');
  const [{ flags }, list, rel] = await Promise.all([
    admins(env).flags(), admins(env).announcements({ active: true, target }),
    releases(env, ctx).then(r => r.data).catch(() => null),
  ]);
  const latest = rel && rel.find(r => !r.prerelease);
  return {
    target,
    maintenance: flags.maintenance,
    minLauncherVersion: flags.minLauncherVersion,
    latestLauncherVersion: latest ? latest.version : null,
    killSwitch: flags.killSwitch,
    features: flags.features,
    announcements: list.map(announcementView),
  };
}

export async function blacklistCheck(env, q) {
  const pairs = [];
  const add = (kind, v) => { if (v) pairs.push([kind, normaliseSubject(kind, v).value]); };
  add('mc_name', q.get('name')); add('mc_uuid', q.get('uuid')); add('nore_id', q.get('noreId')); add('discord', q.get('discord'));
  if (!pairs.length) throw new ApiError(400, 'bad_query', 'Podaj name, uuid, noreId albo discord');
  const hits = await admins(env).blacklistCheck(pairs);
  return { blocked: hits.length > 0, matches: hits.map(h => ({ kind: h.kind, reason: h.reason, expires: iso(h.expires) })) };
}

/** GET /api/v2/bot/admin – what the bot needs from the admin side, polled every ~30 s. */
export async function botAdmin(request, env) {
  await requireBot(request, env);
  const [list, actions, ann] = await Promise.all([admins(env).blacklist(), store(env).pendingActions(), admins(env).announcements({ active: true, target: 'discord' })]);
  return {
    blacklist: { discord: list.filter(e => e.kind === 'discord').map(e => e.value) },
    actions: actions.map(actionView),
    announcements: ann.map(announcementView),
  };
}

/** POST /api/v2/bot/actions/:id { ok, result } */
export async function botActionDone(request, env, id) {
  await requireBot(request, env);
  const b = await readJson(request, 8 * 1024);
  if (typeof b.ok !== 'boolean') throw new ApiError(400, 'bad_field', 'ok: true albo false');
  const r = unwrap(await store(env).finishAction(Number(id), b.ok, b.result === undefined ? null : b.result));
  return { action: actionView(r.action) };
}

// ---------------------------------------------------------------- GitHub (source code view)

async function gh(env, path) {
  const res = await fetch(`${githubApi(env)}/repos/${REPO}${path}`, { headers: githubHeaders(env), signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`GitHub ${res.status}`);
  return res.json();
}

async function source(env, q) {
  const branch = q.get('branch') || '';
  if (branch && !/^[\w./-]{1,100}$/.test(branch)) throw new ApiError(400, 'bad_branch', 'Zła nazwa gałęzi');
  const key = `admin-source:${branch}`;
  const hit = await readCache(key);
  if (hit && Date.now() - hit.storedAt < 60_000 && q.get('fresh') !== '1') return { ...hit.data, cached: true };
  const [repo, commits, branches, rels, runs, pulls] = await Promise.all([
    timed(gh(env, ''), 8000), timed(gh(env, `/commits?per_page=25${branch ? `&sha=${encodeURIComponent(branch)}` : ''}`), 8000),
    timed(gh(env, '/branches?per_page=100'), 8000), timed(gh(env, '/releases?per_page=15'), 8000),
    timed(gh(env, '/actions/runs?per_page=20'), 8000), timed(gh(env, '/pulls?state=open&per_page=20'), 8000),
  ]);
  const data = {
    repo: repo.ok ? { name: repo.value.full_name, private: !!repo.value.private, defaultBranch: repo.value.default_branch, url: repo.value.html_url, pushedAt: repo.value.pushed_at, openIssues: repo.value.open_issues_count, stars: repo.value.stargazers_count } : { error: repo.error, name: REPO, url: `https://github.com/${REPO}` },
    token: !!env.GITHUB_TOKEN,
    privateReleases: privateReleases(env),
    commits: commits.ok ? commits.value.map(c => ({ sha: c.sha, short: String(c.sha).slice(0, 7), message: String(c.commit?.message || '').split('\n')[0].slice(0, 200), author: c.commit?.author?.name || c.author?.login || null, date: c.commit?.author?.date || null, url: c.html_url })) : { error: commits.error },
    branches: branches.ok ? branches.value.map(x => ({ name: x.name, sha: x.commit?.sha, protected: !!x.protected, url: `https://github.com/${REPO}/tree/${encodeURIComponent(x.name)}` })) : { error: branches.error },
    releases: rels.ok ? rels.value.map(r => ({ tag: r.tag_name, name: r.name, draft: !!r.draft, prerelease: !!r.prerelease, published: r.published_at, url: r.html_url, assets: (r.assets || []).length, downloads: (r.assets || []).reduce((n, a) => n + (a.download_count || 0), 0) })) : { error: rels.error },
    runs: runs.ok ? (runs.value.workflow_runs || []).map(r => ({ id: r.id, name: r.name, branch: r.head_branch, event: r.event, status: r.status, conclusion: r.conclusion, sha: String(r.head_sha || '').slice(0, 7), created: r.created_at, url: r.html_url, title: r.display_title || null })) : { error: runs.error },
    pulls: pulls.ok ? pulls.value.map(p => ({ number: p.number, title: p.title, user: p.user?.login, branch: p.head?.ref, created: p.created_at, url: p.html_url, draft: !!p.draft })) : { error: pulls.error },
    at: new Date().toISOString(),
  };
  await writeCache(key, data).catch(() => {});
  return { ...data, cached: false };
}

// ---------------------------------------------------------------- admin router

const MC_SERVER = (env) => String(env.ADMIN_MC_SERVER || 'mc.noreclient.pl');
const limitOf = (q, d = 100, max = 500) => Math.max(1, Math.min(max, parseInt(q.get('limit') || String(d), 10) || d));

/** /api/v2/admin/<rest> */
export async function adminRoute(request, url, env, ctx, rest) {
  const actor = await requireAdmin(request, env);
  const m = request.method === 'HEAD' ? 'GET' : request.method;
  const q = url.searchParams;
  const ip = clientIp(request);
  const A = admins(env);
  const audit = (action, target, data) => A.audit(actor, action, target, data, ip);
  const route = (method, re) => { if (m !== method) return null; const x = re.exec(rest); return x; };
  let x;

  if ((x = route('GET', /^me$/))) {
    return { actor, features: { token: String(env.ADMIN_TOKEN || '').length >= 32, discordAdmins: adminIds(env).length, github: !!env.GITHUB_TOKEN, privateReleases: privateReleases(env), mcServer: MC_SERVER(env) } };
  }

  // ------------------------------------------------ overview
  if ((x = route('GET', /^overview$/))) {
    const [hub, botStats, events, pending, stats, server, counts, auditList, flags] = await Promise.all([
      timed(hubCall(env, 'admin', { limit: 12 })), timed(store(env).stats()), timed(store(env).recentEvents(15)), timed(store(env).actions({ status: 'pending', limit: 50 })),
      timed(pub.stats(env, ctx), 5000), timed(cachedPing(env, ctx, MC_SERVER(env), 'admin'), 9000), timed(A.counts()), timed(A.auditList(10)), timed(A.flags()),
    ]);
    return {
      at: new Date().toISOString(),
      hub: val(hub),
      bot: botStats.ok ? { ...botStats.value, pendingActions: pending.ok ? pending.value.length : null } : { error: botStats.error },
      events: events.ok ? events.value.map(e => ({ ...e, at: iso(e.at) })) : [],
      downloads: val(stats),
      server: server.ok ? { address: MC_SERVER(env), ...server.value.server, favicon: undefined } : { address: MC_SERVER(env), online: false, error: server.error },
      counts: val(counts),
      audit: auditList.ok ? auditList.value.map(auditView) : [],
      flags: flags.ok ? flags.value.flags : null,
    };
  }

  // ------------------------------------------------ blacklist
  if ((x = route('GET', /^blacklist$/))) {
    const list = await A.blacklist({ all: q.get('all') === '1' });
    return { count: list.length, entries: list.map(blacklistView) };
  }
  if ((x = route('POST', /^blacklist$/))) {
    const b = await readJson(request, 8 * 1024);
    const subj = normaliseSubject(b.kind, b.value);
    const expires = time(b.expiresAt, 'expiresAt');
    if (expires !== null && expires <= Date.now()) throw new ApiError(400, 'bad_field', 'expiresAt musi być w przyszłości');
    const r = await A.blacklistAdd({ ...subj, reason: str(b.reason, 500, 'reason'), expires }, actor);
    await audit(r.updated ? 'blacklist.update' : 'blacklist.add', `${subj.kind}:${subj.value}`, { reason: b.reason || '', expiresAt: iso(expires) });
    const hub = subj.kind === 'discord' ? null : await timed(syncHub(env));
    return { status: r.updated ? 200 : 201, body: { id: r.id, updated: r.updated, entry: { ...subj, expires: iso(expires) }, hubSynced: hub ? hub.ok : null } };
  }
  if ((x = route('DELETE', /^blacklist\/(\d{1,12})$/))) {
    const r = unwrap(await A.blacklistRemove(Number(x[1])));
    await audit('blacklist.remove', `${r.kind}:${r.value}`, null);
    const hub = r.kind === 'discord' ? null : await timed(syncHub(env));
    return { removed: r.id, hubSynced: hub ? hub.ok : null };
  }
  if ((x = route('POST', /^blacklist\/sync$/))) {
    const r = await syncHub(env);
    await audit('blacklist.sync', 'hub', r);
    return { hub: r };
  }

  // ------------------------------------------------ announcements
  if ((x = route('GET', /^announcements$/))) {
    const list = await A.announcements();
    const now = Date.now();
    return { count: list.length, announcements: list.map(a => announcementAdminView(a, now)) };
  }
  if ((x = route('POST', /^announcements$/))) {
    const a = cleanAnnouncement(await readJson(request, 16 * 1024));
    const r = await A.announcementPut(randomToken(9), a, actor);
    await audit('announcement.create', r.announcement.id, { title: a.title, targets: a.targets, level: a.level, startsAt: iso(a.starts), endsAt: iso(a.ends) });
    return { status: 201, body: { announcement: announcementAdminView(r.announcement) } };
  }
  if ((x = route('PUT', /^announcements\/([\w-]{6,32})$/))) {
    const old = (await A.announcements()).find(a => a.id === x[1]);
    if (!old) throw new ApiError(404, 'not_found', 'Nie ma takiego ogłoszenia');
    const a = cleanAnnouncement(await readJson(request, 16 * 1024), old);
    const r = await A.announcementPut(x[1], a, actor);
    await audit('announcement.update', x[1], { title: a.title, targets: a.targets, level: a.level, startsAt: iso(a.starts), endsAt: iso(a.ends) });
    return { announcement: announcementAdminView(r.announcement) };
  }
  if ((x = route('DELETE', /^announcements\/([\w-]{6,32})$/))) {
    const r = unwrap(await A.announcementRemove(x[1]));
    await audit('announcement.delete', x[1], { title: r.title });
    return { removed: r.id };
  }

  // ------------------------------------------------ warns / notes
  if ((x = route('GET', /^warns$/))) {
    if (q.get('subject')) {
      const s = normaliseSubject(q.get('kind') || 'auto', q.get('subject'));
      const list = await A.warns({ subjectKind: s.kind, subject: s.value, limit: limitOf(q, 200) });
      const bl = await A.blacklistCheck([[s.kind, s.value]]);
      return { subject: s, blacklisted: bl.length > 0, count: list.length, warns: list.map(warnView) };
    }
    const [subjects, recent] = await Promise.all([A.warnSubjects(), A.warns({ limit: limitOf(q, 50) })]);
    return { subjects: subjects.map(s => ({ ...s, last: iso(s.last) })), recent: recent.map(warnView) };
  }
  if ((x = route('POST', /^warns$/))) {
    const b = await readJson(request, 8 * 1024);
    const s = normaliseSubject(b.subjectKind || 'auto', b.subject);
    const kind = b.kind || 'warn';
    if (!['warn', 'note'].includes(kind)) throw new ApiError(400, 'bad_field', 'kind: warn albo note');
    const r = await A.warnAdd({ subjectKind: s.kind, subject: s.value, display: s.display, kind, text: str(b.text, 1000, 'text', { required: true, min: 1 }) }, actor);
    await audit(`${kind}.add`, `${s.kind}:${s.value}`, { text: r.warn.text });
    return { status: 201, body: { warn: warnView(r.warn), activeWarns: r.activeWarns } };
  }
  if ((x = route('DELETE', /^warns\/(\d{1,12})$/))) {
    const r = unwrap(await A.warnRevoke(Number(x[1]), actor));
    await audit(`${r.warn.kind}.revoke`, `${r.warn.subjectKind}:${r.warn.subject}`, { id: r.warn.id });
    return { warn: warnView(r.warn) };
  }

  // ------------------------------------------------ bot
  if ((x = route('GET', /^bot\/guilds$/))) {
    const list = await store(env).adminGuilds();
    return { count: list.length, present: list.filter(g => g.present).length, guilds: list.map(g => ({ ...g, updatedAt: iso(g.updatedAt), metaAt: iso(g.metaAt), joinedAt: iso(g.joinedAt), leftAt: iso(g.leftAt), lastEvent: iso(g.lastEvent) })) };
  }
  if ((x = route('GET', /^bot\/guilds\/([^/]+)$/))) {
    const guildId = guildIdOf(x[1]);
    const r = await store(env).panelGuild(guildId);
    if (!r.meta && !r.version) throw new ApiError(404, 'unknown_guild', 'Nore Bot nie zna tego serwera');
    const events = await store(env).events(guildId, limitOf(q, 100, 200));
    return {
      guildId, present: r.present, meta: r.meta, metaAt: iso(r.metaAt), config: effectiveConfig(r.config, SCHEMA), version: r.version || 0,
      updatedAt: iso(r.updatedAt), updatedBy: r.updatedBy || null, events: events.map(e => ({ ...e, at: iso(e.at) })),
      schema: { id: SCHEMA.$id || null, version: SCHEMA['x-version'] ?? null, url: '/api/v2/bot/config.schema.json' },
    };
  }
  if ((x = route('PUT', /^bot\/guilds\/([^/]+)\/config$/))) {
    const guildId = guildIdOf(x[1]);
    const b = await readJson(request, 256 * 1024);
    if (!Number.isInteger(b.version) || b.version < 0) throw new ApiError(400, 'bad_version', 'version: liczba całkowita – wersja, którą edytujesz');
    if (!isObj(b.config)) throw new ApiError(400, 'bad_config', 'config musi być obiektem');
    const config = applyDefaults(b.config, SCHEMA);
    const errors = validate(config, SCHEMA);
    if (errors.length) throw new ApiError(400, 'invalid_config', `Konfiguracja ma błędy (${errors.length})`, { errors: errors.map(({ path, message, keyword }) => ({ path, pointer: path, message, keyword })) });
    const by = { id: actor.id, name: `${actor.name} (admin)` };
    const saved = unwrap(await store(env).saveConfig(guildId, config, b.version, by).then(r => (r.error ? { error: { ...r.error, updatedAt: iso(r.error.updatedAt) } } : r)));
    await audit('bot.config', guildId, { version: saved.version });
    return { version: saved.version, updatedAt: iso(saved.updatedAt) };
  }
  if ((x = route('GET', /^bot\/events$/))) {
    const type = q.get('type');
    if (type && !/^[a-z][a-z0-9_.:-]{0,47}$/.test(type)) throw new ApiError(400, 'bad_type', 'Zły typ zdarzenia');
    const list = await store(env).recentEvents(limitOf(q, 100), type || null);
    return { count: list.length, events: list.map(e => ({ ...e, at: iso(e.at) })) };
  }
  if ((x = route('GET', /^bot\/actions$/))) {
    const status = q.get('status');
    if (status && !['pending', 'done', 'failed', 'cancelled'].includes(status)) throw new ApiError(400, 'bad_status', 'status: pending, done, failed albo cancelled');
    const list = await store(env).actions({ status: status || null, limit: limitOf(q, 100) });
    return { count: list.length, actions: list.map(actionView) };
  }
  if ((x = route('POST', /^bot\/actions$/))) {
    const b = await readJson(request, 8 * 1024);
    if (!ACTION_TYPES.includes(b.type)) throw new ApiError(400, 'bad_type', `type: jedno z ${ACTION_TYPES.join(', ')}`);
    const guildId = b.guildId ? guildIdOf(String(b.guildId)) : null;
    const data = {};
    if (b.type === 'message') {
      if (!guildId) throw new ApiError(400, 'bad_field', 'message: wymagany guildId');
      if (!SNOWFLAKE.test(String(b.channelId || ''))) throw new ApiError(400, 'bad_field', 'message: wymagany channelId (17–20 cyfr)');
      data.channelId = String(b.channelId);
      data.content = str(b.content, 2000, 'content', { required: true, min: 1 });
    } else if (b.type === 'announce') {
      const id = String(b.announcementId || '');
      if (!(await A.announcementExists(id))) throw new ApiError(400, 'bad_field', 'announce: nie ma takiego ogłoszenia');
      data.announcementId = id;
    } else if (b.type === 'leave' && !guildId) throw new ApiError(400, 'bad_field', 'leave: wymagany guildId');
    if (b.reason !== undefined) data.reason = str(b.reason, 300, 'reason');
    const r = unwrap(await store(env).queueAction(guildId, b.type, data, actor));
    await audit('bot.action', guildId || 'all', { id: r.action.id, type: b.type, ...data });
    return { status: 201, body: { action: actionView(r.action) } };
  }
  if ((x = route('DELETE', /^bot\/actions\/(\d{1,12})$/))) {
    const r = unwrap(await store(env).cancelAction(Number(x[1])));
    await audit('bot.action.cancel', r.action.guildId || 'all', { id: r.action.id });
    return { action: actionView(r.action) };
  }

  // ------------------------------------------------ client / mod
  if ((x = route('GET', /^client$/))) {
    const [hub, f] = await Promise.all([timed(hubCall(env, 'admin', { limit: limitOf(q, 100), q: q.get('q') || '' })), A.flags()]);
    return { hub: val(hub), flags: f.flags, flagsMeta: f.meta, platforms: pub.platforms() };
  }
  if ((x = route('GET', /^flags$/))) return await A.flags();
  if ((x = route('PUT', /^flags$/))) {
    const patch = cleanFlags(await readJson(request, 16 * 1024));
    const r = await A.setFlags(patch, actor);
    await audit('flags.update', Object.keys(patch).join(','), patch);
    return r;
  }

  // ------------------------------------------------ releases / downloads / server / source
  if ((x = route('GET', /^releases$/))) {
    const [list, dl, stats] = await Promise.all([pub.releasesList(env, ctx, new URLSearchParams('limit=30&notes=false')), timed(pub.downloads(env, ctx)), timed(pub.stats(env, ctx))]);
    const sm = await readCache('sync');
    return { releases: list.body.releases, downloads: val(dl).body || val(dl), stats: val(stats), sync: sm ? sm.data : null, privateReleases: privateReleases(env) };
  }
  if ((x = route('POST', /^releases\/sync$/))) {
    const r = await sync(env);
    await audit('releases.sync', 'github', r);
    return { sync: r };
  }
  if ((x = route('GET', /^server$/))) {
    const addr = q.get('address') || MC_SERVER(env);
    const r = await cachedPing(env, ctx, addr, 'admin');
    return { address: addr, server: { ...r.server, favicon: undefined, faviconUrl: r.server.favicon ? `/api/v2/servers/${encodeURIComponent(addr)}/favicon` : null }, cache: r.cache };
  }
  if ((x = route('GET', /^source$/))) return await source(env, q);

  // ------------------------------------------------ audit
  if ((x = route('GET', /^audit$/))) {
    const before = q.get('before') ? Number(q.get('before')) : null;
    const action = q.get('action');
    if (action && !/^[a-z.]{1,40}$/.test(action)) throw new ApiError(400, 'bad_action', 'Zły filtr akcji');
    const list = await A.auditList(limitOf(q, 100), Number.isFinite(before) ? before : null, action || null);
    return { count: list.length, entries: list.map(auditView), next: list.length ? list.at(-1).id : null };
  }

  throw new ApiError(404, 'not_found', 'Nie ma takiej ścieżki administratora – zobacz docs/admin-api.md');
}

export { cmpVersion };
