// End-to-end tests of the website Worker under `wrangler dev` (local, fresh state):
// API v1 unchanged, API v2 public routes, Minecraft server ping against local fake servers,
// Nore Bot endpoints, Discord OAuth2 against a fake Discord, panel sessions and host routing.
//   npm test            (= node scripts/v2-test.mjs; DEV_LOG=1 shows the wrangler output)
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import { startHttpFakes, startModernMc, startLegacyMc, startSilentMc, PNG_1PX, MODERN_STATUS } from './test/fakes.mjs';
import { startDev } from './test/dev.mjs';
import { snapshotV1 } from './test/v1-snapshot.mjs';
import { allowedOrigin } from '../src/v2/http.js';
import GOLDEN from './test/v1-golden.json' with { type: 'json' };

const FAKE = 8790, DEV = 8788;
const BOT_SECRET = 'test-bot-secret-0123456789';
const SESSION_KEY = 'test-session-key-0123456789abcdef0123456789';
const ADMIN_TOKEN = 'test-admin-token-0123456789abcdef0123456789';
const G1 = '900000000000000001', G2 = '900000000000000002', G3 = '900000000000000003', G4 = '900000000000000004';

const fakes = await startHttpFakes(FAKE);
const modern = await startModernMc(25599);
const legacyMc = await startLegacyMc(25598);
const silent = await startSilentMc(25597);
fakes.dns.set('_minecraft._tcp.srv.nore-test.pl|SRV', [{ data: '0 5 25599 mc.nore-test.pl.' }]);
fakes.dns.set('mc.nore-test.pl|A', [{ data: '127.0.0.1' }]);
fakes.dns.set('evil.nore-test.pl|A', [{ data: '10.0.0.5' }]);
fakes.dns.set('_minecraft._tcp.srv-evil.nore-test.pl|SRV', [{ data: '0 5 25565 localhost.' }]);
fakes.dns.set('v6only.nore-test.pl|AAAA', [{ data: 'fd00::1' }]);

const dev = await startDev({
  port: DEV,
  vars: {
    GITHUB_API: `http://127.0.0.1:${FAKE}/github`, DISCORD_API: `http://127.0.0.1:${FAKE}/discord`, DOH_URL: `http://127.0.0.1:${FAKE}/doh`,
    SLP_ALLOW_IPS: '127.0.0.1', NORE_BOT_SECRET: BOT_SECRET, SESSION_KEY, DISCORD_CLIENT_ID: 'test-client', DISCORD_CLIENT_SECRET: 'test-client-secret',
    TEST_HOST_HEADER: 'X-Nore-Test-Host', ADMIN_TOKEN, ADMIN_DISCORD_IDS: '111111111111111111, 333333333333333333', ADMIN_MC_SERVER: '127.0.0.1:25599',
  },
});
let priv = null;
const BASE = dev.base;
let passed = 0;
const step = (what) => { passed++; console.log('ok  ', what); };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function req(method, path, { body, headers = {}, cookie } = {}) {
  const h = { ...headers };
  if (body !== undefined && !h['Content-Type']) h['Content-Type'] = 'application/json';
  if (cookie) h.Cookie = cookie;
  const res = await fetch(BASE + path, { method, headers: h, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body), redirect: 'manual' });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, headers: res.headers, json, text };
}
const get = (p, o) => req('GET', p, o);
const bot = (method, p, body, secret = BOT_SECRET) => req(method, '/api/v2/bot' + p, { body, headers: secret === null ? {} : { Authorization: `Bot ${secret}` } });

/** GET with an explicit Host header (fetch cannot set it). */
function hostGet(host, path) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: DEV, path, headers: { 'X-Nore-Test-Host': host } }, (res) => {
      let t = ''; res.on('data', d => { t += d; }); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: t }));
    }).on('error', reject);
  });
}

try {
  // ------------------------------------------------------------ API v1 unchanged
  const now = await snapshotV1(BASE);
  for (const [i, g] of GOLDEN.entries()) {
    const n = now[i];
    assert.equal(`${n.method} ${n.path}`, `${g.method} ${g.path}`);
    assert.equal(n.status, g.status, `${g.method} ${g.path} status`);
    assert.deepEqual(n.headers, g.headers, `${g.method} ${g.path} headers`);
    if (g.path === '/api/v1/events') assert.deepEqual(Object.keys(JSON.parse(n.body).events[0]), Object.keys(JSON.parse(g.body).events[0]));
    else assert.equal(n.body, g.body, `${g.method} ${g.path} body`);
  }
  step(`API v1: ${GOLDEN.length} requests answer exactly as before (status, headers, body)`);

  // ------------------------------------------------------------ v2 public
  let r = await get('/api/v2');
  assert.equal(r.status, 200); assert.equal(r.json.ok, true); assert.ok(r.json.endpoints.length >= 12);
  assert.equal(r.headers.get('access-control-allow-origin'), '*'); assert.equal(r.headers.get('x-nore-api'), '2.0.0');
  step('GET /api/v2 index, envelope ok:true, CORS *, X-Nore-Api');
  const etag = r.headers.get('etag');
  r = await get('/api/v2', { headers: { 'If-None-Match': `W/"zzz", ${etag}` } });
  assert.equal(r.status, 304); step('ETag → 304 (list and weak forms)');

  r = await get('/api/v2/openapi.json');
  assert.equal(r.json.openapi, '3.1.0');
  for (const p of ['/api/v2/status', '/api/v2/servers/{address}', '/api/v2/bot/changes', '/api/v2/panel/guilds/{guildId}/config', '/api/v2/me', '/api/v2/downloads/{platform}', '/api/v2/players/{name}']) assert.ok(r.json.paths[p], p);
  assert.ok(r.json.paths['/api/v2/bot/guilds/{guildId}/config'].patch, 'bot PATCH config documented');
  step(`OpenAPI 3.1 with ${Object.keys(r.json.paths).length} paths`);

  r = await get('/api/v2/status');
  assert.equal(r.status, 200); assert.ok(['ok', 'degraded'].includes(r.json.status));
  for (const c of ['api', 'releases', 'sync', 'hub', 'bot', 'counters', 'panelLogin', 'serverPing']) assert.ok(r.json.components[c], c);
  assert.equal(r.json.components.hub.status, 'ok'); assert.equal(r.json.components.bot.status, 'ok'); assert.equal(r.json.components.panelLogin.status, 'ok');
  assert.deepEqual(Object.keys(r.json.hub), ['online', 'known']);
  step(`status: ${r.json.status}, components ${Object.entries(r.json.components).map(([k, v]) => `${k}=${v.status}`).join(' ')}`);

  r = await get('/api/v2/releases?limit=1');
  assert.equal(r.json.count, 1); assert.equal(r.json.releases[0].version, '1.5.0'); assert.equal(r.json.releases[0].notes, undefined); assert.ok(r.json.releases[0].assets.win);
  r = await get('/api/v2/releases?notes=true');
  assert.equal(r.json.count, 2); assert.equal(r.json.releases[1].notes, 'Starsze');
  r = await get('/api/v2/releases/latest');
  assert.equal(r.json.release.version, '1.5.0'); assert.equal(r.json.release.mods.length, 1);
  r = await get('/api/v2/releases/v1.4.0'); assert.equal(r.json.release.version, '1.4.0');
  r = await get('/api/v2/releases/9.9.9'); assert.equal(r.status, 404); assert.equal(r.json.ok, false); assert.equal(r.json.code, 'no_release'); assert.match(r.json.error, /Nie ma wydania/);
  step('releases, releases/latest, releases/:version (404 in the error envelope)');

  r = await get('/api/v2/downloads');
  const win = r.json.platforms.find(p => p.id === 'win');
  assert.equal(win.file, 'NoreLauncher-Setup-1.5.0.exe'); assert.equal(win.downloads.latest, 120); assert.equal(win.downloads.allReleases, 420); assert.equal(win.downloads.redirects, 0);
  assert.equal(r.json.platforms.find(p => p.id === 'mac-zip').available, true);
  r = await get('/api/v2/downloads/win');
  assert.equal(r.status, 302); assert.match(r.headers.get('location'), /NoreLauncher-Setup-1\.5\.0\.exe$/);
  await get('/api/v2/downloads/linux'); await get('/api/v2/downloads/win');
  let clicks;
  for (let k = 0; k < 20; k++) { clicks = (await get('/api/v2/stats')).json.redirects; if (clicks.total === 3) break; await sleep(150); }
  assert.equal(clicks.win, 2); assert.equal(clicks.linux, 1); assert.equal(clicks.daily.at(-1).n, 3);
  r = await get('/api/v2/downloads/xbox'); assert.equal(r.status, 404);
  step('downloads: per-platform files, 302 redirects counted (win 2, linux 1, today 3)');

  r = await get('/api/v2/events');
  assert.equal(r.json.flags.halloween, true); assert.ok(r.json.active.includes('halloween'));
  const xmas = r.json.events.find(e => e.id === 'christmas');
  assert.equal(xmas.season, 'winter'); assert.equal(xmas.startsAt, '2026-12-10T00:00:00+01:00');
  if (!xmas.active) { assert.equal(xmas.countdown.kind, 'start'); assert.ok(xmas.countdown.seconds > 0); assert.equal(r.json.next.id, 'christmas'); }
  step(`events: flags ${JSON.stringify(r.json.flags)}, winter countdown ${xmas.countdown && xmas.countdown.days} d`);

  r = await get('/api/v2/news?limit=2'); assert.equal(r.json.count, 2); assert.ok(r.json.tags.length);
  r = await get('/api/v2/platforms'); assert.ok(r.json.minecraft.includes('1.21.8')); assert.ok(r.json.loaders.includes('fabric'));
  step('news (limit, tags) and platforms (versions, loaders)');

  // a real Nore Hub player (signed hello like the launcher)
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const pub = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
  const hex = crypto.createHash('sha256').update(Buffer.from(pub, 'base64')).digest('hex').slice(0, 20);
  const cos = { v: 1, slots: { back: { id: 'bat_wings', color: 0xff00ff, variant: 'classic' } } };
  const hb = { name: 'Nore_Tester', uuid: crypto.randomBytes(16).toString('hex'), premium: false, hex, pub, ts: Date.now(), online: true, cosmetics: cos };
  const canon = `nore-hub/1|${hb.name}|${hb.uuid}|${hb.hex}|${hb.ts}|1|${crypto.createHash('sha256').update(JSON.stringify(cos)).digest('hex')}`;
  hb.sig = crypto.sign('sha256', Buffer.from(canon), privateKey).toString('base64');
  r = await req('POST', '/api/v1/hub/hello', { body: hb }); assert.equal(r.status, 200, r.text);
  r = await get('/api/v2/players/nore_tester');
  assert.equal(r.json.player.nore, true); assert.equal(r.json.player.name, 'Nore_Tester'); assert.equal(r.json.player.online, true); assert.equal(r.json.player.noreId, hex);
  assert.deepEqual(r.json.player.wardrobe, [{ slot: 'back', id: 'bat_wings', variant: 'classic', color: '#ff00ff' }]);
  r = await get('/api/v2/players/Nobody_Here'); assert.deepEqual(r.json.player, { name: 'Nobody_Here', nore: false });
  r = await get('/api/v2/players/bad%20name'); assert.equal(r.status, 400); assert.match(r.json.error, /Zły nick/);
  r = await get('/api/v2/stats'); assert.equal(r.json.online, 1); assert.equal(r.json.downloads.total, 520);
  step('players/:name from Nore Hub (online, Nore ID, wardrobe), unknown → nore:false, bad → 400; stats');

  r = await get('/api/v2/nope'); assert.equal(r.status, 404); assert.equal(r.json.code, 'not_found');
  r = await req('POST', '/api/v2/status', { body: {} }); assert.equal(r.status, 405); assert.match(r.headers.get('allow'), /GET/);
  r = await req('OPTIONS', '/api/v2/servers/x.pl'); assert.equal(r.status, 204); assert.equal(r.headers.get('access-control-allow-origin'), '*');
  step('404 / 405 with Allow / CORS preflight');

  // ------------------------------------------------------------ server ping
  r = await get('/api/v2/servers/127.0.0.1:25599');
  let s = r.json.server;
  assert.equal(r.status, 200, r.text); assert.equal(s.online, true, JSON.stringify(s)); assert.equal(s.protocol, 'modern');
  assert.deepEqual(s.players, { online: 7, max: 100, sample: MODERN_STATUS.players.sample });
  assert.equal(s.version.name, 'Paper 1.21.8'); assert.equal(s.version.protocol, 772);
  assert.equal(s.motd.clean, 'Nore Serwer\nDruga linia'); assert.deepEqual(s.motd.lines, ['Nore Serwer', 'Druga linia']); assert.match(s.motd.html, /<span style="color:#ff55ff;font-weight:700">Nore <\/span>/);
  assert.equal(s.favicon, MODERN_STATUS.favicon); assert.equal(typeof s.latencyMs, 'number'); assert.equal(s.enforcesSecureChat, true);
  assert.equal(r.headers.get('x-nore-cache'), 'MISS');
  assert.deepEqual(modern.seen.at(-1), { proto: -1, host: '127.0.0.1', port: 25599, next: 1 });
  step(`SLP modern: 7/100, MOTD, favicon, latency ${s.latencyMs} ms, handshake ${JSON.stringify(modern.seen.at(-1))}`);
  const seenBefore = modern.seen.length;
  r = await get('/api/v2/servers/127.0.0.1:25599?favicon=false');
  assert.equal(r.headers.get('x-nore-cache'), 'HIT'); assert.equal(r.json.server.favicon, undefined); assert.equal(modern.seen.length, seenBefore);
  step('second ping within 30 s comes from the cache');
  r = await fetch(BASE + '/api/v2/servers/127.0.0.1:25599/favicon');
  assert.equal(r.headers.get('content-type'), 'image/png'); assert.deepEqual(Buffer.from(await r.arrayBuffer()), Buffer.from(PNG_1PX, 'base64'));
  step('favicon endpoint returns the PNG');

  r = await get('/api/v2/servers/srv.nore-test.pl');
  s = r.json.server;
  assert.equal(s.online, true, JSON.stringify(s)); assert.deepEqual(s.srv, { target: 'mc.nore-test.pl', port: 25599 }); assert.equal(s.port, 25599); assert.equal(s.ip, '127.0.0.1');
  assert.equal(modern.seen.at(-1).host, 'srv.nore-test.pl');
  step('SRV _minecraft._tcp lookup via DNS-over-HTTPS → target:port');

  r = await get('/api/v2/servers/127.0.0.1:25598');
  s = r.json.server;
  assert.equal(s.online, true, JSON.stringify(s)); assert.equal(s.protocol, 'legacy'); assert.equal(s.version.name, '1.5.2'); assert.deepEqual([s.players.online, s.players.max], [3, 20]); assert.equal(s.motd.clean, 'Stary serwer Nore');
  step('legacy 0xFE fallback (1.5.2, 3/20)');

  r = await get('/api/v2/servers/127.0.0.1:25596');
  assert.equal(r.json.server.online, false); assert.equal(r.json.server.code, 'refused');
  const t0 = Date.now();
  r = await get('/api/v2/servers/127.0.0.1:25597');
  assert.equal(r.json.server.online, false); assert.equal(r.json.server.code, 'timeout'); assert.ok(Date.now() - t0 < 12000);
  r = await get('/api/v2/servers/missing.nore-test.pl');
  assert.equal(r.json.server.online, false); assert.equal(r.json.server.code, 'dns_not_found'); assert.match(r.json.server.error, /DNS/);
  step(`offline answers: refused, timeout (${Date.now() - t0} ms), not in DNS`);

  for (const a of ['10.0.0.1', '192.168.1.1:25565', '127.0.0.2', '%5B%3A%3A1%5D:25565', '%5B%3A%3Affff%3A10.0.0.1%5D', 'localhost', 'evil.nore-test.pl', 'srv-evil.nore-test.pl', 'v6only.nore-test.pl', '169.254.169.254', '100.64.0.1']) {
    r = await get('/api/v2/servers/' + a);
    assert.equal(r.status, 403, `${a}: ${r.text}`); assert.equal(r.json.code, 'private_address');
  }
  step('private, loopback, link-local, CGNAT, mapped IPv6, localhost and names resolving to them → 403');
  for (const a of ['bad%20name', 'x.pl:99999', 'nodot', 'x.pl:0']) { r = await get('/api/v2/servers/' + a); assert.equal(r.status, 400, a); }
  step('bad addresses → 400 with Polish messages');

  // ------------------------------------------------------------ bot API
  r = await bot('GET', `/guilds/${G1}/config`, undefined, null); assert.equal(r.status, 401); assert.equal(r.headers.get('www-authenticate'), 'Bot realm="nore-api"');
  r = await bot('GET', `/guilds/${G1}/config`, undefined, 'wrong-secret-0123456789'); assert.equal(r.status, 401); assert.match(r.json.error, /sekret/);
  r = await req('GET', `/api/v2/bot/guilds/${G1}/config`, { headers: { Authorization: `Bearer ${BOT_SECRET}` } }); assert.equal(r.status, 401);
  assert.equal(r.headers.get('access-control-allow-origin'), null);
  step('bot auth: missing / wrong secret / wrong scheme → 401, no CORS on bot routes');
  r = await bot('GET', `/guilds/${G1}/config`);
  assert.equal(r.status, 200); assert.deepEqual(Object.keys(r.json), ['ok', 'guildId', 'version', 'updatedAt', 'config']);
  assert.equal(r.json.version, 0); assert.equal(r.json.updatedAt, null); assert.equal(r.json.config.general.language, 'pl'); assert.equal(r.json.config.welcome.enabled, false);
  step('GET config of a new guild → version 0 with schema defaults');
  r = await bot('GET', '/guilds/123/config'); assert.equal(r.status, 400);
  r = await bot('PUT', `/guilds/${G1}/meta`, { channels: [] }); assert.equal(r.status, 400);
  r = await bot('PUT', `/guilds/${G1}/meta`, 'not json'); assert.equal(r.status, 400); assert.equal(r.json.code, 'invalid_json');
  r = await bot('PUT', `/guilds/${G1}/meta`, {
    name: 'Nore Polska', icon: 'i1', channels: [{ id: '800000000000000001', name: 'ogólny', type: 0, parentId: null, extra: 'dropped' }, { id: 'bad' }],
    roles: [{ id: '700000000000000001', name: 'Admin', color: 16711680, position: 5, managed: false }],
  });
  assert.equal(r.status, 200, r.text); assert.equal(r.json.present, true);
  r = await bot('PUT', `/guilds/${G3}/meta`, { name: 'Own', icon: null, channels: [], roles: [] }); assert.equal(r.status, 200);
  step('PUT meta (validated and trimmed)');

  // ------------------------------------------------------------ OAuth + panel
  r = await get('/api/v2/me'); assert.equal(r.status, 401); assert.match(r.json.error, /Zaloguj/);
  r = await get('/api/v2/auth/discord/login?next=/panel/' + G1);
  assert.equal(r.status, 302);
  const loc = new URL(r.headers.get('location'));
  assert.equal(loc.origin + loc.pathname, 'https://discord.com/oauth2/authorize');
  assert.equal(loc.searchParams.get('client_id'), 'test-client'); assert.equal(loc.searchParams.get('scope'), 'identify guilds');
  assert.match(loc.searchParams.get('redirect_uri'), /^https?:\/\/[^/]+\/api\/v2\/auth\/discord\/callback$/);
  const redirectUri = loc.searchParams.get('redirect_uri'); assert.equal(loc.searchParams.get('code_challenge_method'), 'S256');
  const state = loc.searchParams.get('state');
  const oCookie = r.headers.get('set-cookie');
  assert.match(oCookie, /^__Host-nore_o=[^;]+; Path=\/; Secure; HttpOnly; SameSite=Lax/);
  const oc = oCookie.split(';')[0];
  step('login → Discord authorize with state + PKCE, signed __Host-nore_o cookie');

  r = await get(`/api/v2/auth/discord/callback?code=code-alice&state=wrong`, { cookie: oc }); assert.equal(r.status, 400); assert.equal(r.json.code, 'state');
  step('callback with a wrong state → 400');
  r = await get('/api/v2/auth/discord/login?next=/panel/' + G1);
  const st2 = new URL(r.headers.get('location')).searchParams.get('state');
  const challenge = new URL(r.headers.get('location')).searchParams.get('code_challenge');
  const oc2 = r.headers.get('set-cookie').split(';')[0];
  r = await get(`/api/v2/auth/discord/callback?code=code-alice&state=${st2}`, { cookie: oc2 });
  assert.equal(r.status, 302, r.text); assert.equal(r.headers.get('location'), '/panel/' + G1);
  const setc = r.headers.getSetCookie();
  const sc = setc.find(c => c.startsWith('__Host-nore_s=')); assert.match(sc, /Path=\/; Secure; HttpOnly; SameSite=Lax; Max-Age=\d+/);
  assert.ok(setc.some(c => c.startsWith('__Host-nore_o=;') && /Max-Age=0/.test(c)));
  assert.equal(crypto.createHash('sha256').update(fakes.calls.lastToken.code_verifier).digest('base64url'), challenge);
  // (wrangler dev rewrites its upstream host inside Location, so compare the path only)
  assert.equal(new URL(fakes.calls.lastToken.redirect_uri).pathname, new URL(redirectUri).pathname);
  const alice = sc.split(';')[0];
  step('callback exchanges the code (verifier matches the challenge), sets __Host-nore_s, back to next');
  r = await get(`/api/v2/auth/discord/callback?code=code-alice&state=${st2}`, { headers: { Accept: 'text/html' } });
  assert.equal(r.status, 302); assert.equal(r.headers.get('location'), '/panel?login=expired');
  r = await get(`/api/v2/auth/discord/callback?error=access_denied`, { cookie: oc2, headers: { Accept: 'text/html' } });
  assert.equal(r.headers.get('location'), `/panel/${G1}?login=cancelled`);
  r = await get('/api/v2/auth/discord/login?next=//evil.example');
  const st3 = new URL(r.headers.get('location')).searchParams.get('state');
  r = await get(`/api/v2/auth/discord/callback?code=bad-code&state=${st3}`, { cookie: r.headers.get('set-cookie').split(';')[0], headers: { Accept: 'text/html' } });
  assert.equal(r.headers.get('location'), '/panel?login=token');
  step('browser failures go back to the panel (?login=expired|cancelled|token), open redirects refused');

  const guildCalls = fakes.calls.guilds;
  r = await get('/api/v2/me', { cookie: alice });
  assert.equal(r.status, 200, r.text); assert.equal(r.headers.get('cache-control'), 'private, no-store');
  assert.deepEqual(r.json.user, { id: '111111111111111111', username: 'alice', globalName: 'Alice', avatar: 'abc', avatarUrl: 'https://cdn.discordapp.com/avatars/111111111111111111/abc.png?size=128' });
  const byId = Object.fromEntries(r.json.guilds.map(g => [g.id, g]));
  assert.deepEqual([byId[G1].manageable, byId[G2].manageable, byId[G3].manageable, byId[G4].manageable], [true, true, true, false]);
  assert.deepEqual([byId[G1].botPresent, byId[G2].botPresent, byId[G3].botPresent, byId[G4].botPresent], [true, false, true, false]);
  assert.match(byId[G2].inviteUrl, /guild_id=900000000000000002/); assert.equal(byId[G1].inviteUrl, undefined);
  await get('/api/v2/me', { cookie: alice });
  assert.equal(fakes.calls.guilds, guildCalls + 1);
  step('/me: user, manageable (MANAGE_GUILD, ADMINISTRATOR, owner; not plain member), botPresent, guild list cached');

  const [payload, mac] = alice.slice('__Host-nore_s='.length).split('.');
  const flip = (t) => t.slice(0, -2) + (t.at(-2) === 'A' ? 'B' : 'A') + t.at(-1);
  const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload, 'base64url')), uid: '222222222222222222' })).toString('base64url');
  const otherKey = crypto.createHmac('sha256', 'not-the-key-0123456789abcdef0123456789').update(`nore-s1.${forged}`).digest('base64url');
  const expired = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload, 'base64url')), exp: Date.now() - 1000 })).toString('base64url');
  for (const bad of [`${flip(payload)}.${mac}`, `${payload}.${flip(mac)}`, `${forged}.${mac}`, `${forged}.${otherKey}`, `${expired}.${mac}`, payload, `${payload}.${mac}.x`, 'garbage']) {
    r = await get('/api/v2/me', { cookie: `__Host-nore_s=${bad}` });
    assert.equal(r.status, 401, bad);
  }
  const validSigWrongSid = crypto.createHmac('sha256', SESSION_KEY);
  const fakeSid = Buffer.from(JSON.stringify({ sid: 'nope', uid: '111111111111111111', exp: Date.now() + 60000 })).toString('base64url');
  r = await get('/api/v2/me', { cookie: `__Host-nore_s=${fakeSid}.${validSigWrongSid.update(`nore-s1.${fakeSid}`).digest('base64url')}` });
  assert.equal(r.status, 401); assert.equal(r.json.code, 'session_expired');
  step('tampered, forged, expired and unknown-session cookies → 401');

  r = await get(`/api/v2/panel/guilds/${G1}`, { cookie: alice });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.version, 0); assert.equal(r.json.meta.name, 'Nore Polska'); assert.deepEqual(r.json.meta.channels, [{ id: '800000000000000001', name: 'ogólny', type: 0, parentId: null }]);
  assert.equal(r.json.config.general.color, '#9d5cff'); assert.equal(r.json.guild.name, 'Nore Polska');
  r = await get(`/api/v2/panel/guilds/${G4}`, { cookie: alice }); assert.equal(r.status, 403); assert.match(r.json.error, /Zarządzanie serwerem/);
  r = await get(`/api/v2/panel/guilds/${G2}`, { cookie: alice }); assert.equal(r.status, 404); assert.equal(r.json.code, 'bot_not_present'); assert.ok(r.json.inviteUrl);
  r = await get(`/api/v2/panel/guilds/900000000000000099`, { cookie: alice }); assert.equal(r.status, 403);
  step('panel GET: manageable guild with meta + defaults; member-only 403, bot absent 404 with invite, foreign 403');

  const cfg = { general: { language: 'en', color: '#112233', staffRoles: ['700000000000000001'], commandCooldownSeconds: 5 }, welcome: { enabled: true, channel: '800000000000000001', message: 'Cześć {user}!' } };
  const put = (body, cookie = alice, headers = {}) => req('PUT', `/api/v2/panel/guilds/${G1}/config`, { body, cookie, headers });
  r = await put({ config: cfg, version: 0 });
  assert.equal(r.status, 200, r.text); assert.equal(r.json.version, 1); assert.ok(r.json.updatedAt);
  r = await put({ config: cfg, version: 0 });
  assert.equal(r.status, 409); assert.equal(r.json.code, 'version_conflict'); assert.equal(r.json.version, 1); assert.equal(r.json.updatedBy.name, 'Alice');
  r = await req('PUT', `/api/v2/panel/guilds/${G1}`, { body: { config: { general: { language: 'pl' } }, version: 1 }, cookie: alice });
  assert.equal(r.status, 200); assert.equal(r.json.version, 2);
  step('PUT config: version 0 → 1, stale version → 409 (current version + who), alias PUT /panel/guilds/:id → 2');
  r = await put({ config: { general: { language: 'xx', color: 'red', bogus: 1, staffRoles: ['1'], commandCooldownSeconds: 61 }, welcome: { enabled: 'yes' }, extra: {} }, version: 2 });
  assert.equal(r.status, 400); assert.equal(r.json.code, 'invalid_config');
  const paths = r.json.errors.map(e => e.path).sort();
  assert.deepEqual(paths, ['/extra', '/general/bogus', '/general/color', '/general/commandCooldownSeconds', '/general/language', '/general/staffRoles/0', '/welcome/enabled']);
  assert.ok(r.json.errors.every(e => e.message && e.pointer === e.path));
  r = await put({ version: 2 }); assert.equal(r.status, 400);
  r = await put({ config: {}, version: '2' }); assert.equal(r.status, 400); assert.equal(r.json.code, 'bad_version');
  r = await put({ config: cfg, version: 2 }, alice, { Origin: 'https://evil.example' }); assert.equal(r.status, 403); assert.equal(r.json.code, 'bad_origin');
  r = await put({ config: cfg, version: 2 }, alice, { 'Content-Type': 'text/plain' }); assert.equal(r.status, 415);
  r = await put({ config: { welcome: { message: 'x'.repeat(2001) } }, version: 2 }); assert.equal(r.json.errors[0].path, '/welcome/message');
  step('PUT config: schema errors as JSON pointers (type, enum, pattern, min/max, additionalProperties, items), CSRF origin, content type');

  // wrangler dev rewrites every *noreclient.pl origin to its own host, so the site list is checked directly
  for (const o of ['https://noreclient.pl', 'https://mc.noreclient.pl']) assert.equal(allowedOrigin(new Request('https://x.invalid/api/v2/me', { headers: { Origin: o } }), {}), o);
  r = await req('OPTIONS', '/api/v2/me', { headers: { Origin: 'https://noreclient.pl', 'Access-Control-Request-Method': 'GET' } });
  assert.ok(r.headers.get('access-control-allow-origin')); assert.equal(r.headers.get('access-control-allow-credentials'), 'true');
  r = await req('OPTIONS', '/api/v2/me', { headers: { Origin: 'https://evil.example' } }); assert.equal(r.headers.get('access-control-allow-origin'), null);
  step('session routes: credentialed CORS only for the Nore sites');

  // bob: no manage permission on G1
  r = await get('/api/v2/auth/discord/login');
  const sb = new URL(r.headers.get('location')).searchParams.get('state');
  r = await get(`/api/v2/auth/discord/callback?code=code-bob&state=${sb}`, { cookie: r.headers.get('set-cookie').split(';')[0] });
  assert.equal(r.headers.get('location'), '/panel');
  const bob = r.headers.getSetCookie().find(c => c.startsWith('__Host-nore_s=')).split(';')[0];
  r = await get(`/api/v2/panel/guilds/${G1}`, { cookie: bob }); assert.equal(r.status, 403);
  r = await put({ config: cfg, version: 2 }, bob); assert.equal(r.status, 403);
  step('a member without Manage Server cannot read or write the panel');

  // bot sees the panel changes
  r = await bot('GET', '/changes?since=0');
  assert.deepEqual(r.json.guilds, [G1]); assert.equal(typeof r.json.now, 'number');
  const since = r.json.now;
  r = await bot('GET', `/changes?since=${since}`); assert.deepEqual(r.json.guilds, []);
  r = await bot('GET', `/guilds/${G1}/config`);
  assert.equal(r.json.version, 2); assert.equal(r.json.config.general.language, 'pl'); assert.equal(r.json.config.general.color, '#9d5cff'); assert.equal(r.json.config.welcome.enabled, false);
  assert.ok(Date.parse(r.json.updatedAt) > 0);
  await put({ config: cfg, version: 2 });
  r = await bot('GET', `/changes?since=${since}`); assert.deepEqual(r.json.guilds, [G1]);
  r = await bot('GET', '/changes?since=-5'); assert.equal(r.status, 400);
  step('bot: changes feed (since/now), GET config returns the saved version with defaults filled in');

  // bot writes what it changed itself (builder, /config, panel actions) – PATCH, merged and versioned
  const sincePatch = (await bot('GET', `/changes?since=${since}`)).json.now;
  r = await bot('PATCH', `/guilds/${G1}/config`, { config: { tickets: { enabled: true, category: '800000000000000001' } } }, null); assert.equal(r.status, 401);
  r = await bot('PATCH', `/guilds/${G1}/config`, {
    config: { tickets: { enabled: true, category: '800000000000000001', logChannel: '800000000000000001', staffRoles: ['700000000000000001'], panels: [{ id: 'main', channel: '800000000000000001' }] } },
    by: { id: '111111111111111111' }, reason: 'builder',
  });
  assert.equal(r.status, 200, r.text); assert.deepEqual(Object.keys(r.json), ['ok', 'guildId', 'version', 'updatedAt', 'updatedBy', 'config']);
  assert.equal(r.json.version, 4); assert.ok(Date.parse(r.json.updatedAt) > 0);
  assert.deepEqual(r.json.updatedBy, { id: 'bot', name: 'Nore Bot', bot: true, userId: '111111111111111111', reason: 'builder' });
  assert.equal(r.json.config.tickets.enabled, true); assert.equal(r.json.config.tickets.category, '800000000000000001');
  assert.equal(r.json.config.tickets.panels[0].style, 'buttons', 'list items completed with defaults');
  assert.equal(r.json.config.general.language, 'en', 'fields outside the patch are kept'); assert.equal(r.json.config.welcome.enabled, true);
  step('bot PATCH config: partial merge, schema defaults, version 3 → 4, updatedBy = Nore Bot (+ who and why)');
  r = await bot('GET', `/changes?since=${sincePatch}`); assert.deepEqual(r.json.guilds, [G1]);
  r = await bot('GET', `/guilds/${G1}/config`); assert.equal(r.json.version, 4); assert.equal(r.json.config.tickets.staffRoles[0], '700000000000000001');
  r = await get(`/api/v2/panel/guilds/${G1}`, { cookie: alice });
  assert.equal(r.json.version, 4); assert.equal(r.json.config.tickets.enabled, true); assert.equal(r.json.config.tickets.logChannel, '800000000000000001');
  assert.equal(r.json.updatedBy.name, 'Nore Bot');
  assert.ok(r.json.events.some(e => e.type === 'bot_config_saved' && e.data.version === 4 && e.data.by.bot === true));
  r = await put({ config: cfg, version: 3 }); assert.equal(r.status, 409); assert.equal(r.json.version, 4); assert.equal(r.json.updatedBy.name, 'Nore Bot');
  step('bot PATCH is visible at once: changes feed, bot GET, panel GET (+ bot_config_saved event), stale panel save → 409');
  r = await bot('PATCH', `/guilds/${G1}/config`, { config: { tickets: { enabled: 'yes', category: 'abc' } } });
  assert.equal(r.status, 400); assert.equal(r.json.code, 'invalid_config'); assert.deepEqual(r.json.errors.map(e => e.path).sort(), ['/tickets/category', '/tickets/enabled']);
  r = await bot('PATCH', `/guilds/${G1}/config`, { config: { nope: {} } }); assert.equal(r.status, 400); assert.deepEqual(r.json.errors.map(e => e.path), ['/nope']);
  r = await bot('PATCH', `/guilds/${G1}/config`, { config: [] }); assert.equal(r.status, 400); assert.equal(r.json.code, 'bad_config');
  r = await bot('PATCH', `/guilds/${G1}/config`, { config: {}, baseVersion: 'x' }); assert.equal(r.status, 400); assert.equal(r.json.code, 'bad_version');
  r = await bot('PATCH', `/guilds/${G1}/config`, { config: { tickets: { maxOpen: 2 } }, baseVersion: 1 }); assert.equal(r.status, 409); assert.equal(r.json.code, 'version_conflict'); assert.equal(r.json.version, 4);
  r = await bot('GET', `/guilds/${G1}/config`); assert.equal(r.json.version, 4, 'rejected patches change nothing');
  step('bot PATCH: schema errors as JSON pointers, bad body / baseVersion → 400, stale baseVersion → 409, nothing saved');
  r = await bot('PATCH', `/guilds/${G1}/config`, { config: { tickets: { category: null, staffRoles: ['700000000000000002', '700000000000000003'] } }, baseVersion: 4 });
  assert.equal(r.status, 200, r.text); assert.equal(r.json.version, 5); assert.equal(r.json.config.tickets.category, '', 'null → default');
  assert.deepEqual(r.json.config.tickets.staffRoles, ['700000000000000002', '700000000000000003'], 'lists replace'); assert.equal(r.json.config.tickets.enabled, true);
  r = await bot('PATCH', `/guilds/${G2}/config`, { config: { welcome: { enabled: true } } }); assert.equal(r.status, 200); assert.equal(r.json.version, 1);
  r = await bot('PATCH', `/guilds/${G1}/config`, { config: {} }); assert.equal(r.status, 200); assert.equal(r.json.version, 6, 'an empty patch still saves (the bot re-syncs)');
  step('bot PATCH: matching baseVersion, null restores the default, lists replace, a guild without a saved config starts at 1');

  r = await bot('POST', `/guilds/${G1}/events`, { type: 'member_join', data: { user: 'Steve' } }); assert.equal(r.status, 201);
  r = await bot('POST', `/guilds/${G1}/events`, { type: 'Bad Type' }); assert.equal(r.status, 400);
  r = await bot('POST', `/guilds/${G1}/events`, { type: 'x', data: { big: 'y'.repeat(5000) } }); assert.equal(r.status, 413);
  let limited = 0;
  for (let k = 0; k < 102; k++) { const x = await bot('POST', `/guilds/${G3}/events`, { type: 'mod_action', data: { k } }); if (x.status === 429) { limited++; assert.ok(x.headers.get('retry-after')); } }
  assert.ok(limited >= 2, `limited ${limited}`);
  r = await get(`/api/v2/panel/guilds/${G1}`, { cookie: alice });
  assert.equal(r.json.events[0].type, 'member_join'); assert.deepEqual(r.json.events[0].data, { user: 'Steve' }); assert.ok(r.json.events.some(e => e.type === 'panel_config_saved' && e.data.by.name === 'Alice'));
  r = await get(`/api/v2/panel/guilds/${G3}`, { cookie: alice }); assert.equal(r.json.events.length, 50);
  step(`bot events: validated, 100/min per guild (${limited} × 429), last 50 in the panel`);

  r = await bot('DELETE', `/guilds/${G3}`); assert.equal(r.status, 200); assert.equal(r.json.present, false);
  r = await bot('DELETE', '/guilds/900000000000000077'); assert.equal(r.status, 404);
  r = await get(`/api/v2/panel/guilds/${G3}`, { cookie: alice }); assert.equal(r.status, 404);
  r = await bot('PUT', `/guilds/${G3}/config`, {}); assert.equal(r.status, 405);
  step('bot DELETE guild → botPresent false, panel 404');

  r = await get('/api/v2/bot/config.schema.json'); assert.equal(r.json.type, 'object'); assert.equal(r.json.ok, undefined);
  step('schema served at /api/v2/bot/config.schema.json');

  // ------------------------------------------------------------ admin API (docs/admin-api.md)
  const adm = (method, p, body, token = ADMIN_TOKEN, extra = {}) => req(method, '/api/v2/admin' + p, { body, headers: token === null ? extra : { Authorization: `Admin ${token}`, ...extra } });
  r = await adm('GET', '/me', undefined, null); assert.equal(r.status, 401); assert.equal(r.headers.get('www-authenticate'), 'Admin realm="nore-admin"');
  r = await adm('GET', '/me', undefined, 'wrong-token-wrong-token-wrong-token-xx'); assert.equal(r.status, 401); assert.match(r.json.error, /Zły token/);
  r = await req('GET', '/api/v2/admin/me', { headers: { Authorization: `Bearer ${ADMIN_TOKEN}` } }); assert.equal(r.status, 401);
  r = await adm('GET', '/me'); assert.equal(r.status, 200, r.text); assert.equal(r.json.actor.via, 'token'); assert.equal(r.headers.get('cache-control'), 'private, no-store');
  assert.equal(r.json.features.mcServer, '127.0.0.1:25599');
  r = await get('/api/v2/admin/me', { cookie: alice }); assert.equal(r.status, 200, r.text); assert.deepEqual(r.json.actor, { via: 'discord', id: '111111111111111111', name: 'Alice' });
  r = await get('/api/v2/admin/me', { cookie: bob }); assert.equal(r.status, 403); assert.equal(r.json.code, 'not_admin');
  r = await req('POST', '/api/v2/admin/announcements', { cookie: alice, body: { title: 'x' }, headers: { Origin: 'https://evil.example' } }); assert.equal(r.status, 403); assert.equal(r.json.code, 'bad_origin');
  r = await req('OPTIONS', '/api/v2/admin/me', { headers: { Origin: 'https://evil.example' } }); assert.equal(r.headers.get('access-control-allow-origin'), null);
  r = await adm('GET', '/nope'); assert.equal(r.status, 404);
  step('admin auth: token (constant-time) or Discord session in ADMIN_DISCORD_IDS; others 401/403, CSRF origin, no foreign CORS');

  // blacklist → Nore Hub
  r = await get('/api/v1/hub/players?names=nore_tester'); assert.ok(r.json.players.nore_tester);
  r = await adm('POST', '/blacklist', { kind: 'auto', value: 'Nore_Tester', reason: 'cheaty' });
  assert.equal(r.status, 201, r.text); assert.equal(r.json.entry.kind, 'mc_name'); assert.equal(r.json.entry.value, 'nore_tester'); assert.equal(r.json.hubSynced, true);
  r = await get('/api/v1/hub/players?names=nore_tester'); assert.deepEqual(r.json.players, {});
  r = await get('/api/v2/players/Nore_Tester'); assert.equal(r.json.player.nore, false);
  r = await get('/api/v2/blacklist/check?name=NORE_TESTER'); assert.equal(r.json.blocked, true); assert.equal(r.json.matches[0].reason, 'cheaty');
  r = await get('/api/v2/blacklist/check?name=Somebody'); assert.equal(r.json.blocked, false);
  // the game's presence heartbeat with a blacklisted nick is refused and not counted
  const statsBefore = (await get('/api/v1/hub/stats')).json.online;
  r = await req('POST', '/api/v2/presence', { body: { sid: 'ef'.repeat(16), online: true, name: 'NORE_tester', mc: '1.21.1' } }); assert.equal(r.status, 403, r.text); assert.match(r.json.error, /zablokowane/);
  assert.equal((await get('/api/v1/hub/stats')).json.online, statsBefore);
  r = await get('/api/v2/blacklist/check'); assert.equal(r.status, 400);
  // a blacklisted Nore ID cannot say hello
  const kp2 = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const pub2 = kp2.publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
  const hex2 = crypto.createHash('sha256').update(Buffer.from(pub2, 'base64')).digest('hex').slice(0, 20);
  r = await adm('POST', '/blacklist', { kind: 'nore_id', value: hex2.toUpperCase(), expiresAt: new Date(Date.now() + 86400000).toISOString() }); assert.equal(r.status, 201); assert.equal(r.json.entry.value, hex2);
  const hb2 = { name: 'Banned_One', uuid: crypto.randomBytes(16).toString('hex'), premium: false, hex: hex2, pub: pub2, ts: Date.now(), online: true, cosmetics: { v: 1, slots: {} }, client: '1.5.0' };
  hb2.sig = crypto.sign('sha256', Buffer.from(`nore-hub/1|${hb2.name}|${hb2.uuid}|${hb2.hex}|${hb2.ts}|1|${crypto.createHash('sha256').update(JSON.stringify(hb2.cosmetics)).digest('hex')}`), kp2.privateKey).toString('base64');
  r = await req('POST', '/api/v1/hub/hello', { body: hb2 }); assert.equal(r.status, 403, r.text); assert.match(r.json.error, /zablokowane/);
  r = await adm('POST', '/blacklist', { kind: 'discord', value: '222222222222222222', reason: 'spam' }); assert.equal(r.status, 201); assert.equal(r.json.hubSynced, null);
  r = await adm('POST', '/blacklist', { kind: 'discord', value: '222222222222222222', reason: 'spam 2' }); assert.equal(r.status, 200); assert.equal(r.json.updated, true);
  for (const bad of [{ kind: 'mc_name', value: 'a b' }, { kind: 'nore_id', value: 'xyz' }, { kind: 'bogus', value: 'Steve' }, { kind: 'auto', value: '!!' }, { kind: 'mc_name', value: 'Steve', expiresAt: '2001-01-01' }]) {
    r = await adm('POST', '/blacklist', bad); assert.equal(r.status, 400, JSON.stringify(bad));
  }
  r = await adm('GET', '/blacklist'); assert.equal(r.json.count, 3);
  const nameEntry = r.json.entries.find(e => e.kind === 'mc_name');
  r = await adm('DELETE', `/blacklist/${nameEntry.id}`); assert.equal(r.status, 200); assert.equal(r.json.hubSynced, true);
  r = await get('/api/v1/hub/players?names=nore_tester'); assert.ok(r.json.players.nore_tester);
  r = await adm('DELETE', `/blacklist/${nameEntry.id}`); assert.equal(r.status, 404);
  step('blacklist: auto kind detection, Nore Hub hides the player and refuses the hello of a blocked Nore ID, public check, removal');

  // announcements
  r = await adm('POST', '/announcements', { title: 'Przerwa techniczna', body: 'Serwer wraca o 20:00', level: 'warning', targets: ['launcher', 'mod', 'discord'], link: 'https://noreclient.pl/status' });
  assert.equal(r.status, 201, r.text); assert.equal(r.json.announcement.state, 'active');
  const ann1 = r.json.announcement.id;
  r = await adm('POST', '/announcements', { title: 'Święta w Nore', level: 'event', targets: ['web'], startsAt: new Date(Date.now() + 3600000).toISOString() });
  assert.equal(r.status, 201); assert.equal(r.json.announcement.state, 'scheduled');
  const ann2 = r.json.announcement.id;
  for (const bad of [{ title: '' }, { title: 'x', level: 'loud' }, { title: 'x', targets: ['tv'] }, { title: 'x', targets: [] }, { title: 'x', link: 'http://x' }, { title: 'x', startsAt: '2026-01-02', endsAt: '2026-01-01' }]) {
    r = await adm('POST', '/announcements', bad); assert.equal(r.status, 400, JSON.stringify(bad));
  }
  r = await get('/api/v2/announcements?target=launcher'); assert.equal(r.json.count, 1); assert.equal(r.json.announcements[0].title, 'Przerwa techniczna'); assert.equal(r.json.announcements[0].level, 'warning');
  assert.equal(r.json.announcements[0].by, undefined);
  r = await get('/api/v2/announcements?target=web'); assert.equal(r.json.count, 0);
  r = await get('/api/v2/announcements'); assert.equal(r.json.count, 1);
  r = await get('/api/v2/announcements?target=tv'); assert.equal(r.status, 400);
  r = await adm('PUT', `/announcements/${ann2}`, { startsAt: new Date(Date.now() - 1000).toISOString() }); assert.equal(r.status, 200, r.text); assert.equal(r.json.announcement.state, 'active'); assert.equal(r.json.announcement.title, 'Święta w Nore');
  r = await get('/api/v2/announcements?target=web'); assert.equal(r.json.count, 1);
  r = await adm('GET', '/announcements'); assert.equal(r.json.count, 2);
  r = await adm('DELETE', `/announcements/${ann2}`); assert.equal(r.status, 200);
  r = await adm('PUT', `/announcements/${ann2}`, { title: 'x' }); assert.equal(r.status, 404);
  step('announcements: create, schedule, validate, public read per target, update, delete');

  // flags + client config
  r = await get('/api/v2/client/config?target=mod');
  assert.equal(r.status, 200); assert.equal(r.json.maintenance.enabled, false); assert.deepEqual(r.json.killSwitch, { modules: [] }); assert.equal(r.json.latestLauncherVersion, '1.5.0'); assert.equal(r.json.announcements.length, 1);
  r = await adm('PUT', '/flags', { maintenance: { enabled: true, message: 'Aktualizujemy serwery' }, minLauncherVersion: 'v1.5.0', killSwitch: { modules: ['Freecam', 'Freecam'] }, features: { radialMenu: false } });
  assert.equal(r.status, 200, r.text); assert.equal(r.json.flags.minLauncherVersion, '1.5.0'); assert.deepEqual(r.json.flags.killSwitch.modules, ['Freecam']); assert.equal(r.json.meta.maintenance.by.via, 'token');
  r = await get('/api/v2/client/config'); assert.equal(r.json.target, 'launcher'); assert.equal(r.json.maintenance.message, 'Aktualizujemy serwery'); assert.equal(r.json.minLauncherVersion, '1.5.0'); assert.deepEqual(r.json.features, { radialMenu: false });
  for (const bad of [{}, { maintenance: { enabled: 'yes' } }, { minLauncherVersion: 'latest' }, { killSwitch: { modules: [1] } }, { features: { 'bad key': true } }]) {
    r = await adm('PUT', '/flags', bad); assert.equal(r.status, 400, JSON.stringify(bad));
  }
  r = await get('/api/v2/client/config?target=web'); assert.equal(r.status, 400);
  step('flags: maintenance, minimum launcher version, kill-switch and features in the public client config');

  // warns and notes
  r = await adm('POST', '/warns', { subject: 'Steve', text: 'Spam na czacie' }); assert.equal(r.status, 201, r.text); assert.equal(r.json.activeWarns, 1); assert.equal(r.json.warn.subjectKind, 'mc_name');
  r = await adm('POST', '/warns', { subject: 'steve', text: 'Obraza' }); assert.equal(r.json.activeWarns, 2);
  r = await adm('POST', '/warns', { subject: 'Steve', kind: 'note', text: 'Rozmawiałem z nim' }); assert.equal(r.status, 201);
  const firstWarn = (await adm('GET', '/warns?subject=STEVE')).json.warns.at(-1).id;
  r = await adm('DELETE', `/warns/${firstWarn}`); assert.equal(r.status, 200); assert.ok(r.json.warn.revoked); assert.equal(r.json.warn.revokedBy.via, 'token');
  r = await adm('DELETE', `/warns/${firstWarn}`); assert.equal(r.status, 409);
  r = await adm('GET', '/warns?subject=Steve'); assert.equal(r.json.count, 3); assert.equal(r.json.blacklisted, false);
  r = await adm('GET', '/warns'); assert.deepEqual([r.json.subjects[0].subject, r.json.subjects[0].warns, r.json.subjects[0].notes], ['steve', 1, 1]);
  r = await adm('POST', '/warns', { subject: 'Steve', text: '' }); assert.equal(r.status, 400);
  r = await adm('POST', '/warns', { subject: 'Steve', kind: 'ban', text: 'x' }); assert.equal(r.status, 400);
  step('warns: history per player (warns and notes), revoke keeps the entry, overview per subject');

  // bot control
  r = await adm('GET', '/bot/guilds'); assert.equal(r.status, 200); assert.ok(r.json.guilds.some(g => g.id === G1 && g.present && g.name === 'Nore Polska'));
  r = await adm('GET', `/bot/guilds/${G1}`); assert.equal(r.status, 200); const gv = r.json.version; assert.ok(gv >= 3); assert.equal(r.json.meta.name, 'Nore Polska'); assert.ok(r.json.events.length);
  r = await adm('GET', '/bot/guilds/900000000000000088'); assert.equal(r.status, 404);
  r = await adm('PUT', `/bot/guilds/${G1}/config`, { config: { general: { language: 'en' } }, version: gv }); assert.equal(r.status, 200, r.text); assert.equal(r.json.version, gv + 1);
  r = await adm('PUT', `/bot/guilds/${G1}/config`, { config: {}, version: gv }); assert.equal(r.status, 409);
  r = await adm('PUT', `/bot/guilds/${G1}/config`, { config: { general: { language: 'xx' } }, version: gv + 1 }); assert.equal(r.status, 400); assert.equal(r.json.code, 'invalid_config');
  r = await bot('GET', `/guilds/${G1}/config`); assert.equal(r.json.version, gv + 1); assert.equal(r.json.config.general.language, 'en');
  r = await adm('GET', '/bot/events?limit=5'); assert.ok(r.json.events.length <= 5 && r.json.events.length > 0); assert.ok(r.json.events[0].guildId);
  r = await adm('POST', '/bot/actions', { type: 'message', guildId: G1, channelId: '800000000000000001', content: 'Cześć od administracji' }); assert.equal(r.status, 201, r.text);
  const act = r.json.action.id;
  r = await adm('POST', '/bot/actions', { type: 'reload', guildId: G1 }); assert.equal(r.status, 201);
  const act2 = r.json.action.id;
  r = await adm('POST', '/bot/actions', { type: 'message', guildId: G1 }); assert.equal(r.status, 400);
  r = await adm('POST', '/bot/actions', { type: 'nuke' }); assert.equal(r.status, 400);
  r = await adm('POST', '/bot/actions', { type: 'announce', announcementId: 'nope-nope' }); assert.equal(r.status, 400);
  r = await adm('DELETE', `/bot/actions/${act2}`); assert.equal(r.json.action.status, 'cancelled');
  r = await bot('GET', '/admin');
  assert.equal(r.status, 200, r.text); assert.deepEqual(r.json.blacklist.discord, ['222222222222222222']);
  assert.deepEqual(r.json.actions.map(a => [a.id, a.type, a.data.content]), [[act, 'message', 'Cześć od administracji']]);
  assert.deepEqual(r.json.announcements.map(a => a.id), [ann1]);
  r = await bot('GET', '/admin', undefined, null); assert.equal(r.status, 401);
  r = await bot('POST', `/actions/${act}`, { ok: true, result: { messageId: '1' } }); assert.equal(r.status, 200); assert.equal(r.json.action.status, 'done');
  r = await bot('POST', `/actions/${act}`, { ok: true }); assert.equal(r.status, 409);
  r = await adm('GET', '/bot/actions?status=done'); assert.equal(r.json.actions[0].result.messageId, '1');
  step('bot control: guild list, config edit with version check (bot sees it), events, action queue (bot takes and reports), blacklist for the bot');

  // overview, client, releases, server, source, audit
  r = await adm('GET', '/overview'); assert.equal(r.status, 200, r.text);
  assert.equal(r.json.server.online, true, JSON.stringify(r.json.server)); assert.equal(r.json.hub.known >= 1, true); assert.ok(Array.isArray(r.json.hub.versions));
  assert.ok(r.json.bot.guilds >= 1); assert.equal(r.json.counts.blacklist, 2); assert.equal(r.json.counts.announcementsActive, 1); assert.ok(r.json.downloads.downloads.total > 0); assert.ok(r.json.audit.length > 0);
  r = await adm('GET', '/client?q=nore'); assert.equal(r.json.hub.players[0].name, 'Nore_Tester'); assert.equal(r.json.flags.maintenance.enabled, true);
  // a player who only runs the game (mod heartbeat, no launcher) is listed and counted as known
  r = await req('POST', '/api/v2/presence', { body: { sid: 'ef'.repeat(16), online: true, name: 'GameOnly_K', mc: '1.21.1', version: '1.4.5' } }); assert.equal(r.status, 200, r.text);
  r = await adm('GET', '/client?q=gameonly'); assert.equal(r.json.hub.players[0].name, 'GameOnly_K'); assert.equal(r.json.hub.players[0].source, 'game'); assert.equal(r.json.hub.players[0].online, true);
  await req('POST', '/api/v2/presence', { body: { sid: 'ef'.repeat(16), online: false } });
  r = await adm('GET', '/releases'); assert.equal(r.json.releases[0].version, '1.5.0'); assert.ok(r.json.downloads.platforms);
  r = await adm('POST', '/releases/sync'); assert.equal(r.json.sync.ok, true);
  r = await adm('GET', '/server'); assert.equal(r.json.server.online, true);
  r = await adm('GET', '/source');
  assert.equal(r.status, 200, r.text); assert.equal(r.json.commits.length, 3); assert.equal(r.json.commits[0].message, 'Commit 1'); assert.equal(r.json.branches.length, 2); assert.equal(r.json.runs[0].conclusion, 'success'); assert.equal(r.json.pulls[0].number, 5); assert.equal(r.json.repo.stars, 42);
  r = await adm('GET', '/source'); assert.equal(r.json.cached, true);
  r = await adm('GET', '/audit?limit=200');
  const actions = r.json.entries.map(e => e.action);
  for (const a of ['blacklist.add', 'blacklist.update', 'blacklist.remove', 'announcement.create', 'announcement.update', 'announcement.delete', 'flags.update', 'warn.add', 'note.add', 'warn.revoke', 'bot.config', 'bot.action', 'bot.action.cancel', 'releases.sync']) assert.ok(actions.includes(a), a);
  assert.ok(r.json.entries.every(e => e.actor.via === 'token' && e.at));
  r = await adm('GET', '/audit?action=blacklist'); assert.ok(r.json.entries.every(e => e.action.startsWith('blacklist')));
  step(`overview (server, hub, bot, downloads, counts), client, releases + sync, source (GitHub), audit log with ${actions.length} entries`);

  // release files through the Worker (also for a private repository)
  r = await get('/api/v2/updates/feed/latest.yml'); assert.equal(r.status, 200); assert.match(r.text, /^version: 1\.5\.0/); assert.match(r.headers.get('content-type'), /yaml/);
  r = await get('/api/v2/updates/feed/NoreLauncher-Setup-1.5.0.exe'); assert.equal(r.status, 302); assert.equal(r.headers.get('location'), 'https://github.com/kondzio444/Noreclienr/releases/download/v1.5.0/NoreLauncher-Setup-1.5.0.exe');
  r = await get('/api/v2/updates/feed/NoreLauncher-Setup-1.5.0.exe.blockmap'); assert.equal(r.status, 302);
  r = await get('/api/v2/files/v1.4.0/NoreLauncher-Setup-1.4.0.exe'); assert.equal(r.status, 302); assert.match(r.headers.get('location'), /v1\.4\.0\/NoreLauncher-Setup-1\.4\.0\.exe$/);
  r = await get('/api/v2/files/v1.4.0/nope.exe'); assert.equal(r.status, 404);
  r = await get('/api/v2/updates/feed/evil.yml'); assert.equal(r.status, 404);
  step('updates feed for electron-updater (latest.yml as text, files as 302) and /files/:version/:name');

  r = await req('POST', '/api/v2/auth/logout', { cookie: alice });
  assert.equal(r.status, 200); assert.match(r.headers.get('set-cookie'), /__Host-nore_s=; .*Max-Age=0/);
  r = await get('/api/v2/me', { cookie: alice }); assert.equal(r.status, 401);
  step('logout revokes the session server-side');

  // ------------------------------------------------------------ presence (games without the launcher)
  const before = (await get('/api/v2/stats')).json.online;
  const sid = 'ab'.repeat(16);
  r = await req('POST', '/api/v2/presence', { body: { sid, online: true, name: 'Presence_T', mc: '1.21.1', version: '1.4.5' } });
  assert.equal(r.status, 200, r.text);
  r = await req('POST', '/api/v2/presence', { body: { sid, online: true } }); assert.equal(r.status, 429);
  r = await req('POST', '/api/v2/presence', { body: { sid: 'xyz', online: true } }); assert.equal(r.status, 400);
  r = await req('POST', '/api/v2/presence', { body: { sid: 'cd'.repeat(16), online: true, name: 'bad name!' } }); assert.equal(r.status, 400);
  assert.equal((await get('/api/v2/stats')).json.online, before + 1);
  r = await req('POST', '/api/v2/presence', { body: { sid, online: false } }); assert.equal(r.status, 200);
  assert.equal((await get('/api/v2/stats')).json.online, before);
  step('POST /api/v2/presence: game heartbeat counts as online (once per nick), validation, 20 s limit, online:false leaves');

  // ------------------------------------------------------------ hosts + site
  let h = await hostGet('www.noreclient.pl', '/api/v1/version?x=1');
  assert.equal(h.status, 301); assert.match(h.headers.location, /^https?:\/\/(noreclient\.pl|127\.0\.0\.1:\d+)\/api\/v1\/version\?x=1$/); // wrangler dev rewrites its own host
  h = await hostGet('www.noreclient.pl', '/'); assert.equal(h.status, 301); assert.match(h.headers.location, /^https?:\/\/(noreclient\.pl|127\.0\.0\.1:\d+)\/$/); // wrangler dev rewrites its own host
  h = await hostGet('mc.noreclient.pl', '/'); assert.equal(h.status, 200); assert.match(h.text, /Nore MC/);
  h = await hostGet('mc.noreclient.pl', '/mc.js'); assert.equal(h.status, 200); assert.match(h.headers['content-type'], /javascript/);
  h = await hostGet('mc.noreclient.pl', '/nope'); assert.equal(h.status, 404); assert.match(h.text, /Strona serwera/);
  h = await hostGet('mc.noreclient.pl', '/api/v2/events'); assert.equal(h.status, 200);
  h = await hostGet('mc.noreclient.pl', '/assets/logo.png'); assert.equal(h.status, 200);
  h = await hostGet('noreclient.pl', '/mc/'); assert.equal(h.status, 301); assert.match(h.headers.location, /^https?:\/\/mc\.(noreclient\.pl|127\.0\.0\.1:\d+)\/$/);
  h = await hostGet('noreclient.pl', '/'); assert.equal(h.status, 200); assert.match(h.text, /Nore/); assert.ok(h.headers['content-security-policy']);
  h = await hostGet('noreclient.pl', '/api'); assert.equal(h.status, 200);
  h = await hostGet('noreclient.pl', '/nope'); assert.equal(h.status, 404);
  h = await hostGet('noreclient.pl', '/panel/900000000000000001'); assert.equal(h.status, 200); assert.match(h.text, /Panel Nore Bota/);
  h = await hostGet('mc.noreclient.pl', '/assets/fonts/onest-latin.woff2'); assert.equal(h.status, 200);
  h = await hostGet('noreclient.pl', '/'); assert.match(h.headers['content-security-policy'], /font-src 'self'/);
  step('hosts: www → apex, mc host serves public/mc/ (own 404, shared /assets, same API), /mc on main → mc host, main pages unchanged');

  // ------------------------------------------------------------ rate limit (last: it uses up this IP's pings)
  let tooMany = 0, retry = null;
  for (let k = 0; k < 25; k++) { const x = await get(`/api/v2/servers/10.1.0.${k}`); if (x.status === 429) { tooMany++; retry = x.headers.get('retry-after'); } }
  assert.ok(tooMany >= 5, `429s: ${tooMany}`); assert.equal(retry, '60');
  step(`server ping rate limit per IP: ${tooMany} × 429 with Retry-After`);


  // ------------------------------------------------------------ private repository (second Worker: RELEASES_PRIVATE + GITHUB_TOKEN)
  priv = await startDev({ port: DEV + 5, vars: { GITHUB_API: `http://127.0.0.1:${FAKE}/github`, GITHUB_TOKEN: 'gh-test-token', RELEASES_PRIVATE: 'true', TEST_HOST_HEADER: 'X-Nore-Test-Host' } });
  const pget = (p) => fetch(priv.base + p, { redirect: 'manual' });
  let pr = await (await pget('/api/v1/version')).json();
  assert.equal(pr.assets.win.url, 'https://noreclient.pl/api/v2/files/v1.5.0/NoreLauncher-Setup-1.5.0.exe'); assert.equal(pr.files, undefined);
  assert.equal(pr.mods[0].url, 'https://noreclient.pl/api/v2/files/v1.5.0/noreclient-fabric-1.21.8.jar');
  let pres = await pget('/api/v2/downloads/win');
  assert.equal(pres.status, 302); assert.equal(pres.headers.get('location'), 'https://objects.githubusercontent.example/signed/1/NoreLauncher-Setup-1.5.0.exe?sig=x');
  pres = await pget('/api/v1/download/linux'); assert.equal(pres.status, 302); assert.match(pres.headers.get('location'), /signed\/2\/NoreLauncher-1\.5\.0\.AppImage/);
  pres = await pget('/api/v2/files/v1.5.0/noreclient-fabric-1.21.8.jar'); assert.equal(pres.status, 302); assert.match(pres.headers.get('location'), /signed\/5\//);
  pres = await pget('/api/v2/updates/feed/latest.yml'); assert.equal(pres.status, 200); assert.match(await pres.text(), /path: NoreLauncher-Setup-1\.5\.0\.exe/);
  pres = await pget('/api/v2/updates/feed/NoreLauncher-Setup-1.5.0.exe'); assert.match(pres.headers.get('location'), /signed\/1\//);
  assert.equal(fakes.calls.assetAuth.at(-1), 'Bearer gh-test-token');
  pr = await (await pget('/api/v1/updates/launcher?platform=win&current=1.4.0')).json(); assert.match(pr.download.url, /^https:\/\/noreclient\.pl\/api\/v2\/files\//);
  step('private repository: file links point at the Worker, downloads and the update feed redirect to signed GitHub URLs (token sent)');

  console.log(`\nall ${passed} web checks passed`);
} catch (e) {
  console.error('\nFAILED:', e.stack);
  if (process.env.DEV_LOG !== '1') console.error(dev.output().slice(-4000));
  process.exitCode = 1;
} finally {
  dev.stop();
  if (priv) priv.stop();
  for (const x of [fakes.server, modern.server, legacyMc.server]) x.close();
  silent.server.closeAll();
}
