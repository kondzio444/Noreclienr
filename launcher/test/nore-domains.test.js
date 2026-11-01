'use strict';
/* Official Nore domains (<name>.noreclient.pl): signature payload, local name rules, targets and the
 * provider flow in servers.js against a fake Nore API that checks signatures like the worker. */
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.NORE_LAUNCHER_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'nore-dom-'));
process.env.NORE_API = 'https://api.test';
const nd = require('../src/main/nore-domains');
const chat = require('../src/main/chat');
const servers = require('../src/main/servers');
const serverNet = require('../src/main/server-net');

/** A fake /api/v2/domains: verifies the Nore ID signature, keeps names, records every request. */
function fakeApi() {
  const names = new Map(); // name -> { owner, target }
  const seen = [];
  let lastTs = 0;
  const reply = (status, body) => ({ ok: status < 400, status, json: async () => (status < 400 ? { ok: true, ...body } : { ok: false, status, ...body }) });
  const view = (name, d) => ({ name, fqdn: `${name}.noreclient.pl`, address: `${name}.noreclient.pl`, target: d.target ? { ...d.target, type: /^\d/.test(d.target.address) ? 'A' : 'CNAME' } : null, expiresAt: '2027-01-01T00:00:00.000Z', state: d.target ? 'active' : 'pending' });
  async function fetch(url, opts) {
    const u = new URL(url);
    assert.strictEqual(u.origin, 'https://api.test');
    const p = u.pathname.replace('/api/v2/domains', '');
    const body = opts.body ? JSON.parse(opts.body) : null;
    seen.push({ method: opts.method, path: p, body });
    if (opts.method === 'GET') {
      const name = decodeURIComponent(p.slice(1));
      return reply(200, { name, fqdn: `${name}.noreclient.pl`, valid: true, available: !names.has(name), reason: names.has(name) ? 'taken' : null, message: names.has(name) ? 'Ta nazwa jest już zajęta.' : null });
    }
    const op = p === '/@mine' ? 'mine' : { POST: 'claim', PUT: 'update', DELETE: 'release' }[opts.method];
    const name = p === '/@mine' ? '' : p.slice(1);
    const canon = nd.canonical(op, name, body.hex, body.ts, body.target);
    if (!chat.verify(body.hex, body.pub, canon, body.sig)) return reply(401, { code: 'bad_signature', error: 'Zły podpis Nore ID' });
    if (body.ts <= lastTs) return reply(401, { code: 'replay', error: 'To żądanie już było' });
    lastTs = body.ts;
    const d = names.get(name);
    if (op === 'mine') return reply(200, { domains: [...names].filter(([, v]) => v.owner === body.hex).map(([k, v]) => view(k, v)) });
    if (op === 'claim') {
      if (d && d.owner !== body.hex) return reply(409, { code: 'taken', error: 'Ta nazwa jest już zajęta.' });
      names.set(name, { owner: body.hex, target: body.target || (d && d.target) || null });
      return reply(d ? 200 : 201, { created: !d, domain: view(name, names.get(name)) });
    }
    if (!d) return reply(404, { code: 'not_found', error: 'Ta domena nie jest zajęta' });
    if (d.owner !== body.hex) return reply(403, { code: 'not_owner', error: 'Ta domena należy do innego Nore ID.' });
    if (op === 'update') { d.target = body.target; return reply(200, { changed: true, domain: view(name, d) }); }
    names.delete(name);
    return reply(200, { released: name });
  }
  return { fetch, names, seen };
}

test('signature payload matches docs/domains.md and verifies with the Nore ID key', () => {
  const me = chat.identity();
  const target = { address: '93.184.216.34', port: 25570 };
  const text = nd.canonical('update', 'mojserwer', me.hex, 1792270000000, target);
  const digest = crypto.createHash('sha256').update('{"address":"93.184.216.34","port":25570}').digest('hex');
  assert.strictEqual(text, `nore-domains/1|update|mojserwer|${me.hex}|1792270000000|${digest}`);
  assert.strictEqual(nd.canonical('release', 'x', 'h', 1, undefined), `nore-domains/1|release|x|h|1|${crypto.createHash('sha256').update('null').digest('hex')}`);
  const b1 = nd.signedBody('update', 'mojserwer', target);
  const b2 = nd.signedBody('update', 'mojserwer', target);
  assert.ok(b2.ts > b1.ts, 'ts strictly increasing');
  assert.strictEqual(b1.hex, me.hex); assert.strictEqual(b1.pub, me.pub); assert.deepStrictEqual(b1.target, target);
  assert.ok(chat.verify(me.hex, me.pub, nd.canonical('update', 'mojserwer', b1.hex, b1.ts, b1.target), b1.sig));
  // the worker verifies over WebCrypto: the DER signature must be a valid P-256 ECDSA
  const key = crypto.createPublicKey({ key: Buffer.from(me.pub, 'base64'), format: 'der', type: 'spki' });
  assert.ok(crypto.verify('sha256', Buffer.from(nd.canonical('update', 'mojserwer', b1.hex, b1.ts, b1.target)), key, Buffer.from(b1.sig, 'base64')));
  assert.strictEqual(nd.signedBody('release', 'x').target, undefined);
});

test('local name rules and targets', async () => {
  assert.strictEqual(nd.normalize(' MojSerwer.noreclient.pl '), 'mojserwer');
  for (const bad of ['ab', 'x'.repeat(33), '-abc', 'abc-', 'a--b', 'żółw', 'a_b']) assert.ok(nd.localError(nd.normalize(bad)), bad);
  assert.strictEqual(nd.localError('moj-serwer-2'), null);
  const r = await nd.check('a_b'); // answered locally, no request
  assert.strictEqual(r.available, false); assert.strictEqual(r.reason, 'invalid');
  assert.deepStrictEqual(nd.targetFor({ publicIp: '93.184.216.34', port: 25565 }), { address: '93.184.216.34', port: 25565 });
  assert.deepStrictEqual(nd.targetFor({ tunnelAddress: 'Abc-Def.joinmc.link:41234', publicIp: '1.1.1.1', port: 25565 }), { address: 'abc-def.joinmc.link', port: 41234 });
  assert.deepStrictEqual(nd.targetFor({ tunnelAddress: 'abc.joinmc.link', port: 30000 }), { address: 'abc.joinmc.link', port: 25565 });
  assert.throws(() => nd.targetFor({ publicIp: null, port: 25565 }), /publicznego IP/);
});

test('provider flow: check, claim, update on start (IP / tunnel), re-claim after expiry, release on delete', async (t) => {
  const api = fakeApi();
  nd.setFetch(api.fetch);
  t.after(() => nd.setFetch(null));
  const realIp = serverNet.publicIp;
  serverNet.publicIp = async () => '93.184.216.34';
  t.after(() => { serverNet.publicIp = realIp; });

  const srv = servers.create({ name: 'Domeny', mcVersion: '1.21.1', type: 'paper', port: 25570 });
  let r = await servers.noreDomain('check', 'mojserwer');
  assert.strictEqual(r.available, true);

  r = await servers.noreDomain('claim', srv.id, 'MojSerwer');
  assert.strictEqual(r.created, true); assert.strictEqual(r.domain.fqdn, 'mojserwer.noreclient.pl');
  assert.deepStrictEqual(api.names.get('mojserwer').target, { address: '93.184.216.34', port: 25570 });
  assert.deepStrictEqual(r.server.domain.provider, 'nore'); assert.strictEqual(r.server.domain.name, 'mojserwer'); assert.strictEqual(r.server.domain.auto, true);
  assert.strictEqual((await servers.noreDomain('check', 'mojserwer')).available, false);

  // server start / "update now": PUT with the current IP
  serverNet.publicIp = async () => '93.184.216.99';
  r = await servers.applyDomain(servers.raw(srv.id));
  assert.strictEqual(r.host, 'mojserwer.noreclient.pl'); assert.strictEqual(r.ip, '93.184.216.99:25570');
  assert.strictEqual(api.seen.at(-1).method, 'PUT');
  assert.deepStrictEqual(api.names.get('mojserwer').target, { address: '93.184.216.99', port: 25570 });
  assert.strictEqual(servers.raw(srv.id).domain.lastIp, '93.184.216.99:25570');

  // with the playit.gg tunnel on, the name points at the tunnel host:port
  servers.update(srv.id, { tunnel: { enabled: true, id: 'x', address: 'abc-def.joinmc.link:41234' } });
  r = await servers.applyDomain(servers.raw(srv.id));
  assert.deepStrictEqual(api.names.get('mojserwer').target, { address: 'abc-def.joinmc.link', port: 41234 });
  servers.update(srv.id, { tunnel: { enabled: false } });

  // the name expired on the server: PUT → 404 → claimed again with the target
  api.names.delete('mojserwer');
  r = await servers.applyDomain(servers.raw(srv.id));
  assert.deepStrictEqual(api.seen.slice(-2).map(x => x.method), ['PUT', 'POST']);
  assert.deepStrictEqual(api.names.get('mojserwer').target, { address: '93.184.216.99', port: 25570 });

  r = await servers.noreDomain('mine');
  assert.deepStrictEqual(r.domains.map(x => x.name), ['mojserwer']);

  // someone else's name
  api.names.set('zajeta', { owner: 'f'.repeat(20), target: null });
  await assert.rejects(servers.noreDomain('claim', srv.id, 'zajeta'), /zajęta/);

  // deleting the server releases the name only when asked
  const other = servers.create({ name: 'Drugi', mcVersion: '1.21.1', type: 'paper' });
  await servers.noreDomain('claim', other.id, 'drugi-serwer');
  await servers.remove(other.id, { releaseDomain: false });
  assert.ok(api.names.has('drugi-serwer'));
  await servers.remove(srv.id, { releaseDomain: true });
  assert.ok(!api.names.has('mojserwer'));
  assert.strictEqual(servers.get(srv.id), null);
  // every signed request verified (the fake answers 401 otherwise)
  assert.ok(api.seen.filter(x => x.method !== 'GET').every(x => x.body && x.body.sig));
});

test('release from the UI resets the domain', async (t) => {
  const api = fakeApi();
  nd.setFetch(api.fetch);
  t.after(() => nd.setFetch(null));
  const realIp = serverNet.publicIp;
  serverNet.publicIp = async () => '93.184.216.34';
  t.after(() => { serverNet.publicIp = realIp; });
  const srv = servers.create({ name: 'Trzeci', mcVersion: '1.21.1', type: 'paper' });
  await servers.noreDomain('claim', srv.id, 'trzeci');
  const r = await servers.noreDomain('release', srv.id);
  assert.strictEqual(r.released, 'trzeci'); assert.strictEqual(r.server.domain.provider, 'none');
  assert.ok(!api.names.has('trzeci'));
  await assert.rejects(servers.noreDomain('release', srv.id), /nie ma domeny Nore/);
});
