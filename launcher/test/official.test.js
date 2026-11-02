'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const official = require('../src/main/official');
const launch = require('../src/main/launch');

const { OFFICIAL, T } = { ...official, T: { STRING: 8, BYTE: 1, LIST: 9, COMPOUND: 10 } };

function serversDat(entries, extra = []) {
  const items = entries.map(e => {
    const c = [{ name: 'name', type: T.STRING, value: e.name }, { name: 'ip', type: T.STRING, value: e.ip }];
    if (e.hidden != null) c.push({ name: 'hidden', type: T.BYTE, value: e.hidden ? 1 : 0 });
    if (e.acceptTextures != null) c.push({ name: 'acceptTextures', type: T.BYTE, value: e.acceptTextures });
    return c;
  });
  return official.writeNbt({ name: '', value: [{ name: 'servers', type: T.LIST, value: { elementType: T.COMPOUND, items } }, ...extra] });
}
const entries = (buf) => official.readNbt(buf).value.find(e => e.name === 'servers').value.items
  .map(c => Object.fromEntries(c.map(f => [f.name, f.value])));

test('official address matching', () => {
  for (const a of ['mc.noreclient.pl', 'MC.NoreClient.PL', 'mc.noreclient.pl:25565', ' mc.noreclient.pl. ']) assert.ok(official.matches(a), a);
  for (const a of ['mc.noreclient.pl:25566', 'play.noreclient.pl', 'mc.noreclient.pl.evil.com', '', null]) assert.ok(!official.matches(a), String(a));
});

test('NBT round trip keeps every tag', () => {
  const buf = serversDat([{ name: 'A', ip: 'a.pl', acceptTextures: 1 }], [{ name: 'x', type: 4, value: 5n }]);
  assert.deepStrictEqual(official.writeNbt(official.readNbt(buf)), buf);
});

test('missing official server is added at the top, own servers untouched', () => {
  const out = official.ensureInNbt(serversDat([{ name: 'Mój', ip: 'play.example.org', acceptTextures: 2 }, { name: 'H', ip: 'mc.hypixel.net' }]));
  const list = entries(out);
  assert.deepStrictEqual(list.map(e => e.ip), [OFFICIAL.address, 'play.example.org', 'mc.hypixel.net']);
  assert.strictEqual(list[0].name, OFFICIAL.name);
  assert.strictEqual(list[1].acceptTextures, 2);
});

test('a manually added entry (other spelling) is not doubled', () => {
  assert.strictEqual(official.ensureInNbt(serversDat([{ name: 'Mój', ip: 'x.pl' }, { name: 'Nore', ip: 'MC.NoreClient.pl:25565' }])), null);
});

test('a hidden Direct Connection entry is shown and keeps its settings', () => {
  const list = entries(official.ensureInNbt(serversDat([{ name: 'A', ip: 'a.pl' }, { name: 'mc.noreclient.pl', ip: 'mc.noreclient.pl', hidden: true, acceptTextures: 1 }])));
  assert.strictEqual(list.length, 2);
  assert.strictEqual(list[0].ip, 'mc.noreclient.pl');
  assert.strictEqual(list[0].hidden, 0);
  assert.strictEqual(list[0].acceptTextures, 1);
});

test('servers.dat is created when missing and left alone when unreadable', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nore-off-'));
  assert.strictEqual(await official.ensureServersDat(dir), true);
  assert.deepStrictEqual(entries(fs.readFileSync(path.join(dir, 'servers.dat'))).map(e => e.ip), [OFFICIAL.address]);
  assert.strictEqual(await official.ensureServersDat(dir), false);
  fs.writeFileSync(path.join(dir, 'servers.dat'), Buffer.from([1, 2, 3]));
  assert.strictEqual(await official.ensureServersDat(dir), false);
  assert.deepStrictEqual(fs.readFileSync(path.join(dir, 'servers.dat')), Buffer.from([1, 2, 3]));
});

test('instance choice: selected Nore Client, else last played Nore Client', () => {
  const list = [{ id: 'v', noreClient: false, lastPlayed: 9 }, { id: 'a', noreClient: true, lastPlayed: 1 }, { id: 'b', noreClient: true, lastPlayed: 5 }];
  assert.strictEqual(official.pickInstance(list, 'a').id, 'a');
  assert.strictEqual(official.pickInstance(list, 'v').id, 'b');
  assert.strictEqual(official.pickInstance([{ id: 'v' }], 'v'), null);
});

test('API v2 answer is used when available', async () => {
  const fetchImpl = async (url) => {
    assert.ok(url.endsWith('/servers/mc.noreclient.pl'));
    return { ok: true, json: async () => ({ online: true, players: { online: 12, max: 100 }, version: { name: '1.21.x' }, motd: { clean: 'Witaj' }, ping: 31 }) };
  };
  const s = await official.status({ force: true, fetchImpl });
  assert.strictEqual(s.source, 'api');
  assert.deepStrictEqual([s.online, s.players, s.max, s.version, s.motd, s.ping], [true, 12, 100, '1.21.x', 'Witaj', 31]);
});

test('Server List Ping against a local fake server', async () => {
  const srv = net.createServer((sock) => {
    let buf = Buffer.alloc(0);
    sock.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      for (;;) {
        const len = official.readVarint(buf, 0);
        if (!len || buf.length < len[1] + len[0]) return;
        const body = buf.subarray(len[1], len[1] + len[0]);
        buf = buf.subarray(len[1] + len[0]);
        const id = body[0];
        if (id === 0 && body.length === 1) {
          const json = Buffer.from(JSON.stringify({ version: { name: 'Paper 1.21.1' }, players: { online: 3, max: 50 }, description: { text: 'Nore ', extra: [{ text: 'MC' }] } }));
          const payload = Buffer.concat([official.varint(0), official.varint(json.length), json]);
          sock.write(Buffer.concat([official.varint(payload.length), payload]));
        } else if (id === 1) {
          sock.write(Buffer.concat([official.varint(body.length), body]));
        }
      }
    });
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  try {
    const { status, ping } = await official.slp('127.0.0.1', srv.address().port, 3000);
    assert.strictEqual(status.players.online, 3);
    assert.strictEqual(status.version.name, 'Paper 1.21.1');
    assert.ok(ping >= 0);
  } finally { srv.close(); }
});

test('joining a server: quick play when the version has it, else --server/--port', () => {
  const modern = { arguments: { game: [{ rules: [{ features: { is_quick_play_multiplayer: true } }], value: ['--quickPlayMultiplayer', '${quickPlayMultiplayer}'] }] } };
  assert.deepStrictEqual(launch.joinArgs(modern, 'mc.noreclient.pl'), ['--quickPlayMultiplayer', 'mc.noreclient.pl']);
  assert.deepStrictEqual(launch.joinArgs({ minecraftArguments: '' }, 'mc.noreclient.pl'), ['--server', 'mc.noreclient.pl', '--port', '25565']);
  assert.deepStrictEqual(launch.joinArgs({ minecraftArguments: '' }, 'a.pl:25570'), ['--server', 'a.pl', '--port', '25570']);
});
