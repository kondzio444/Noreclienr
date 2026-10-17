'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const auth = require('../src/main/auth');
const versions = require('../src/main/versions');
const launch = require('../src/main/launch');

test('offline UUID matches Java UUID.nameUUIDFromBytes("OfflinePlayer:<name>")', () => {
  assert.strictEqual(auth.offlineUuid('Notch'), 'b50ad385-829d-3141-a216-7e7d7539ba7f');
});

test('offline nick validation', () => {
  assert.ok(auth.validOfflineName('Steve_123'));
  assert.ok(!auth.validOfflineName('ab'));
  assert.ok(!auth.validOfflineName('zła nazwa'));
  assert.throws(() => auth.createOffline('x'));
});

test('maven coordinates to path', () => {
  assert.strictEqual(versions.mavenPath('net.fabricmc:fabric-loader:0.16.5'),
    path.join('net', 'fabricmc', 'fabric-loader', '0.16.5', 'fabric-loader-0.16.5.jar'));
  assert.strictEqual(versions.mavenPath('org.lwjgl:lwjgl:3.3.3:natives-linux'),
    path.join('org', 'lwjgl', 'lwjgl', '3.3.3', 'lwjgl-3.3.3-natives-linux.jar'));
});

test('rules: allow/disallow by os and features', () => {
  assert.ok(versions.rulesAllow(undefined));
  assert.ok(versions.rulesAllow([{ action: 'allow' }]));
  assert.ok(!versions.rulesAllow([{ action: 'allow', os: { name: 'nonexistent-os' } }]));
  assert.ok(!versions.rulesAllow([{ action: 'allow' }, { action: 'disallow', os: { name: versions.OS_NAME } }]));
  assert.ok(versions.rulesAllow([{ action: 'allow', features: { has_custom_resolution: true } }], { has_custom_resolution: true }));
  assert.ok(!versions.rulesAllow([{ action: 'allow', features: { is_demo_user: true } }], {}));
});

test('argument expansion substitutes variables and respects rules', () => {
  const args = launch.expandArgs([
    '--username', '${auth_player_name}',
    { rules: [{ action: 'allow', features: { is_demo_user: true } }], value: '--demo' },
    { rules: [{ action: 'allow', features: { has_custom_resolution: true } }], value: ['--width', '${resolution_width}'] },
  ], { auth_player_name: 'Steve', resolution_width: '1280' }, { has_custom_resolution: true });
  assert.deepStrictEqual(args, ['--username', 'Steve', '--width', '1280']);
});
