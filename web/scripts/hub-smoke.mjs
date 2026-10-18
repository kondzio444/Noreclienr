// Nore Hub end-to-end check against a local worker (signs hellos like launcher/src/main/chat.js).
//   npx wrangler dev --port 8787 --var MOJANG_SESSION:http://127.0.0.1:8799
//   node scripts/hub-smoke.mjs [http://127.0.0.1:8787]
// Port 8799 is a fake Mojang session server started here; it takes about 35 s (the 15 s hello gap).
import crypto from 'node:crypto';
import http from 'node:http';
import assert from 'node:assert/strict';

const BASE = process.argv[2] || 'http://127.0.0.1:8787';
const joined = new Map(); // serverId → { id, name }
const mojang = http.createServer((req, res) => {
  const q = new URL(req.url, 'http://x').searchParams;
  const p = joined.get(q.get('serverId'));
  if (!p || p.name.toLowerCase() !== String(q.get('username')).toLowerCase()) { res.writeHead(204); return res.end(); }
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(p));
}).listen(8799, '127.0.0.1');

function launcherKey() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const pub = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
  const hex = crypto.createHash('sha256').update(Buffer.from(pub, 'base64')).digest('hex').slice(0, 20);
  return { pub, hex, key: privateKey };
}

const wings = { v: 1, slots: { back: { id: 'bat_wings', color: 16711935, variant: 'classic', opts: { speed: 1, scale: 1.5, glow: true } } } };

function hello(k, fields = {}, tamper = {}) {
  const b = { name: 'Steve_PL', uuid: crypto.randomBytes(16).toString('hex'), premium: false, hex: k.hex, pub: k.pub, ts: Date.now(), online: true, cosmetics: wings, ...fields };
  const cos = crypto.createHash('sha256').update(JSON.stringify(b.cosmetics)).digest('hex');
  const text = `nore-hub/1|${b.name}|${b.uuid}|${b.hex}|${b.ts}|${b.online ? 1 : 0}|${cos}`;
  b.sig = crypto.sign('sha256', Buffer.from(text), k.key).toString('base64');
  return post({ ...b, ...tamper });
}

async function post(body) {
  const res = await fetch(BASE + '/api/v1/hub/hello', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return [res.status, await res.json()];
}
const get = async (p) => { const res = await fetch(BASE + p); return [res.status, await res.json(), res.headers]; };
const join = (name, id) => { const serverId = crypto.randomBytes(20).toString('hex'); joined.set(serverId, { id, name }); return serverId; };
const step = (what) => console.log('ok  ', what);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const A = launcherKey(), B = launcherKey(), C = launcherKey(), D = launcherKey(), E = launcherKey(), F = launcherKey(), G = launcherKey();
const notch = '069a79f444e94726a5befca90e38aaf5';
const [, before] = await get('/api/v1/hub/stats');

let [st, out] = await hello(A, { uuid: 'b50ad385829d3141a2167e7d7539ba7f' });
assert.equal(st, 200, JSON.stringify(out)); assert.deepEqual(out, { ok: true, verified: false, name: 'Steve_PL' }); step('good hello (non-premium)');

let headers;
[st, out, headers] = await get('/api/v1/hub/players?names=STEVE_pl,nobody_here,bad name');
assert.equal(st, 200);
assert.deepEqual(Object.keys(out.players), ['steve_pl']);
assert.equal(out.players.steve_pl.hex, A.hex); assert.equal(out.players.steve_pl.online, true); assert.equal(out.players.steve_pl.verified, false);
assert.deepEqual(out.players.steve_pl.cosmetics, wings);
assert.equal(headers.get('cache-control'), 'public, max-age=20');
step('players lookup (case-insensitive, only Nore users, max-age=20)');

[st] = await hello(B, { name: 'Bob_1' }, { sig: crypto.sign('sha256', Buffer.from('other text'), B.key).toString('base64') });
assert.equal(st, 401); step('bad signature → 401');
[st, out] = await hello(B, { name: 'Bob_1' }, { pub: C.pub });
assert.equal(st, 401); step(`wrong hex → 401 (${out.error})`);
[st, out] = await hello(C, { name: 'Bob_1', ts: Date.now() - 6 * 60 * 1000 });
assert.equal(st, 401); step(`stale ts → 401 (${out.error})`);
[st, out] = await hello(A, { uuid: 'b50ad385829d3141a2167e7d7539ba7f' });
assert.equal(st, 429); step(`second hello within 15 s → 429 (${out.error})`);
[st, out] = await hello(D);
assert.equal(st, 409); step(`unverified name held by another Nore ID → 409 (${out.error})`);
[st, out] = await hello(B, { name: 'Bob_1', cosmetics: { v: 1, slots: { back: { id: 'X' } } } });
assert.equal(st, 400); step(`bad cosmetics → 400 (${out.error})`);

[st, out] = await hello(E, { name: 'notch', uuid: notch, premium: true, serverId: join('Notch', notch) });
assert.equal(st, 200, JSON.stringify(out)); assert.deepEqual(out, { ok: true, verified: true, name: 'Notch' }); step('premium hello verified through hasJoined (Mojang name case)');
[st, out] = await hello(G, { name: 'Jeb_', uuid: '853c80ef3c3749fdaa49938b674adae6', premium: true, serverId: 'abc123' });
assert.equal(st, 401); step(`premium without a Mojang join → 401 (${out.error})`);
const steveUuid = 'aaaabbbbccccddddeeeeffff00001111';
[st, out] = await hello(F, { uuid: steveUuid, premium: true, serverId: join('Steve_PL', steveUuid) });
assert.equal(st, 200); assert.equal(out.verified, true); step('verified premium claim takes a name held unverified');
[, out] = await get('/api/v1/hub/players?names=steve_pl,notch');
assert.equal(out.players.steve_pl.hex, F.hex); assert.equal(out.players.steve_pl.verified, true); assert.equal(out.players.notch.online, true);

let [, stats] = await get('/api/v1/hub/stats');
assert.equal(stats.online, before.online + 2, JSON.stringify({ before, stats })); step(`stats ${JSON.stringify(stats)}`);

[st] = await get('/api/v1/hub/players?names=' + Array.from({ length: 101 }, (_, i) => 'p' + i).join(','));
assert.equal(st, 400); step('101 names → 400');
assert.equal((await fetch(BASE + '/api/v1/hub/hello')).status, 405); step('GET hello → 405');
const pre = await fetch(BASE + '/api/v1/hub/hello', { method: 'OPTIONS' });
assert.equal(pre.status, 204); assert.match(pre.headers.get('access-control-allow-methods'), /POST/); step('CORS preflight allows POST');
assert.equal((await fetch(BASE + '/api/v1/version', { method: 'POST' })).status, 405); step('POST elsewhere → 405');
[, out] = await get('/api/v1');
assert.ok(out.endpoints.some(e => e.path === '/api/v1/hub/hello' && e.method === 'POST')); step('endpoint index lists the hub');
[, out] = await get('/api/v1/openapi.json');
assert.ok(out.paths['/api/v1/hub/hello'].post && out.paths['/api/v1/hub/players'].get); step('OpenAPI lists the hub');

console.log('…waiting 16 s for the hello gap');
await sleep(16000);
[st, out] = await hello(E, { name: 'Notch', uuid: notch, premium: true, serverId: 'deadbeef' });
assert.equal(st, 200, JSON.stringify(out)); assert.equal(out.verified, true); step('premium heartbeat of a running session is signature-only');
[st, out] = await hello(A, { uuid: 'b50ad385829d3141a2167e7d7539ba7f' });
assert.equal(st, 409); step('the unverified owner lost the name to the verified claim → 409');
console.log('…waiting 16 s for the hello gap');
await sleep(16000);
[st, out] = await hello(E, { name: 'Notch', uuid: notch, online: false });
assert.equal(st, 200); step('online:false');
[, out] = await get('/api/v1/hub/players?names=notch');
assert.equal(out.players.notch.online, false); assert.equal(out.players.notch.verified, true); step('… marks the player offline at once');
[, stats] = await get('/api/v1/hub/stats');
assert.equal(stats.online, before.online + 1); step(`stats ${JSON.stringify(stats)}`);

mojang.close();
console.log('all Nore Hub checks passed');
