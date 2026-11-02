'use strict';
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.NORE_LAUNCHER_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'nore-hub-'));
const hub = require('../src/main/hub');
const chat = require('../src/main/chat');
const bridge = require('../src/main/chat-bridge');

const wings = { v: 1, slots: { back: { id: 'bat_wings', color: 16711935, variant: 'classic', opts: { speed: 1.5, glow: true, style: 'soft' } } } };

test('cosmetics validation follows docs/nore-hub.md', () => {
  assert.strictEqual(hub.cosmeticsError(wings), null);
  assert.strictEqual(hub.cosmeticsError({ v: 1, slots: {} }), null);
  assert.ok(hub.cosmeticsError(null));
  assert.ok(hub.cosmeticsError({ v: 1.5, slots: {} }));
  assert.ok(hub.cosmeticsError({ v: 1, slots: [] }));
  assert.ok(hub.cosmeticsError({ v: 1, slots: { Back: { id: 'x' } } }));
  assert.ok(hub.cosmeticsError({ v: 1, slots: { back: { id: 'x', color: 0x1000000 } } }));
  assert.ok(hub.cosmeticsError({ v: 1, slots: { back: { id: 'x', opts: { s: 'x'.repeat(33) } } } }));
  assert.ok(hub.cosmeticsError({ v: 1, slots: { back: { id: 'x', url: 'https://example.com' } } }));
  const many = {}; for (let i = 0; i < 11; i++) many['s' + i] = { id: 'x' };
  assert.ok(hub.cosmeticsError({ v: 1, slots: many }));
});

test('hello signature: chat identity over the canonical string', () => {
  const me = chat.identity();
  const body = { name: 'Steve_PL', uuid: '0123456789abcdef0123456789abcdef', hex: me.hex, ts: 1792270000000, online: true, cosmetics: wings };
  const text = hub.canonical(body);
  assert.match(text, /^nore-hub\/1\|Steve_PL\|0123456789abcdef0123456789abcdef\|[0-9a-f]{20}\|1792270000000\|1\|[0-9a-f]{64}$/);
  assert.strictEqual(crypto.createHash('sha256').update(Buffer.from(me.pub, 'base64')).digest('hex').slice(0, 20), me.hex);
  assert.ok(chat.verify(me.hex, me.pub, text, chat.sign(text)));
});

test('bridge: presence, contacts/add and state', async () => {
  const sent = [];
  const [port, token] = (await bridge.start((ch, payload) => sent.push([ch, payload]))).split(':');
  const call = async (method, p, body) => {
    const res = await fetch(`http://127.0.0.1:${port}${p}`, { method, headers: { 'X-Nore-Token': token }, body: body && JSON.stringify(body) });
    return [res.status, await res.json()];
  };
  assert.strictEqual((await fetch(`http://127.0.0.1:${port}/v1/state`)).status, 401);
  assert.deepStrictEqual(await call('POST', '/v1/presence', { cosmetics: wings }), [200, { ok: true }]);
  assert.strictEqual((await call('POST', '/v1/presence', { cosmetics: { v: 1 } }))[0], 400);

  const friend = 'abcdef0123456789abcd';
  const [st, out] = await call('POST', '/v1/contacts/add', { hex: friend, name: 'Alex' });
  assert.strictEqual(st, 200);
  assert.strictEqual(out.contact.hex, friend);
  assert.deepStrictEqual(sent, [['chat:bridgeAdd', { hex: friend }]]);
  assert.strictEqual((await call('POST', '/v1/contacts/add', { hex: friend }))[0], 200); // already there
  assert.strictEqual(sent.length, 1);
  assert.strictEqual((await call('POST', '/v1/contacts/add', { hex: chat.identity().hex }))[0], 400);
  assert.strictEqual((await call('POST', '/v1/contacts/add', { hex: 'nope' }))[0], 400);

  const [, state] = await call('GET', '/v1/state');
  assert.strictEqual(state.me.hex, chat.identity().hex);
  assert.ok(Array.isArray(state.requests));
  assert.ok(state.contacts.some(c => c.hex === friend && c.name === 'Alex'));
  bridge.stop();
});
