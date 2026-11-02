import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import {
  encodeVarInt, decodeVarInt, encodeString, decodeString, handshakePacket, readPackets, packet, motdToText, parseAddress, isPrivateHost, shapeStatus, ping,
} from '../src/lib/slp.js';

test('VarInt encode/decode (wiki.vg test vectors)', () => {
  const vectors = [[0, [0x00]], [1, [0x01]], [127, [0x7f]], [128, [0x80, 0x01]], [255, [0xff, 0x01]], [25565, [0xdd, 0xc7, 0x01]], [2097151, [0xff, 0xff, 0x7f]], [2147483647, [0xff, 0xff, 0xff, 0xff, 0x07]], [-1, [0xff, 0xff, 0xff, 0xff, 0x0f]]];
  for (const [n, bytes] of vectors) {
    assert.deepEqual([...encodeVarInt(n)], bytes, `encode ${n}`);
    assert.deepEqual(decodeVarInt(Buffer.from(bytes)), { value: n, size: bytes.length }, `decode ${n}`);
  }
  assert.equal(decodeVarInt(Buffer.from([0x80])), null, 'truncated');
  assert.throws(() => decodeVarInt(Buffer.from([0xff, 0xff, 0xff, 0xff, 0xff, 0x01])));
});

test('strings and packet framing', () => {
  const s = encodeString('MC.noreclient.pl');
  assert.equal(s[0], 16);
  assert.deepEqual(decodeString(s), { value: 'MC.noreclient.pl', size: 17 });
  const hs = handshakePacket('localhost', 25565, 767);
  const { packets, rest } = readPackets(Buffer.concat([hs, packet(0x00), Buffer.from([0x05])]));
  assert.equal(packets.length, 2);
  assert.equal(packets[0].id, 0x00);
  assert.equal(rest.length, 1, 'incomplete frame kept');
  // handshake body: protocol 767 (VarInt), host, port 25565 (UShort BE), next state 1
  const body = packets[0].data;
  assert.equal(decodeVarInt(body).value, 767);
  const host = decodeString(body, 2);
  assert.equal(host.value, 'localhost');
  assert.equal(body.readUInt16BE(2 + host.size), 25565);
  assert.equal(body[body.length - 1], 1);
});

test('MOTD chat components to text', () => {
  assert.equal(motdToText('§aHello §lWorld'), 'Hello World');
  assert.equal(motdToText({ text: 'A', extra: [{ text: 'B', color: 'red' }, 'C'] }), 'ABC');
  assert.equal(motdToText([{ text: 'x' }, { text: 'y' }]), 'xy');
});

test('addresses', () => {
  assert.deepEqual(parseAddress('MC.noreclient.pl'), { host: 'mc.noreclient.pl', port: 25565, explicitPort: false });
  assert.deepEqual(parseAddress('play.example.org:25566'), { host: 'play.example.org', port: 25566, explicitPort: true });
  assert.deepEqual(parseAddress('[::1]:1234'), { host: '::1', port: 1234, explicitPort: true });
  assert.equal(parseAddress('bad host'), null);
  assert.equal(parseAddress('x:99999'), null);
  assert.ok(isPrivateHost('127.0.0.1'));
  assert.ok(isPrivateHost('192.168.1.5'));
  assert.ok(isPrivateHost('10.0.0.1'));
  assert.ok(isPrivateHost('localhost'));
  assert.ok(!isPrivateHost('51.38.1.1'));
});

test('shapeStatus normalizes the status JSON', () => {
  const s = shapeStatus({ version: { name: 'Paper 1.21.4', protocol: 769 }, players: { online: 3, max: 100, sample: [{ name: 'Steve' }] }, description: { text: '§6Nore' }, favicon: 'data:image/png;base64,AAAA' }, { host: 'h', port: 1, latency: 12 });
  assert.deepEqual([s.online, s.version, s.players.online, s.players.sample[0], s.motd, s.latency], [true, 'Paper 1.21.4', 3, 'Steve', 'Nore', 12]);
  assert.ok(s.favicon.startsWith('data:image/png'));
});

test('ping against a local fake Minecraft server', async () => {
  const status = { version: { name: 'Test 1.21', protocol: 767 }, players: { online: 7, max: 50 }, description: 'Hello' };
  const server = net.createServer((sock) => {
    let buf = Buffer.alloc(0);
    sock.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      const { packets, rest } = readPackets(buf);
      buf = rest;
      for (const p of packets) {
        if (p.id === 0x00 && p.data.length === 0) sock.write(packet(0x00, encodeString(JSON.stringify(status))));
        if (p.id === 0x01) sock.write(packet(0x01, p.data));
      }
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  try {
    const res = await ping(`127.0.0.1:${port}`, { allowPrivate: true, timeout: 3000 });
    assert.equal(res.online, true);
    assert.equal(res.players.online, 7);
    assert.equal(res.version, 'Test 1.21');
    assert.equal(res.motd, 'Hello');
    assert.ok(res.latency >= 0);
    const blocked = await ping(`127.0.0.1:${port}`);
    assert.deepEqual([blocked.online, blocked.error], [false, 'private_address']);
  } finally { server.close(); }
});
