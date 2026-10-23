'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const AdmZip = require('adm-zip');

process.env.NORE_LAUNCHER_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'nore-modpacks-'));
const modpacks = require('../src/main/modpacks');
const modrinth = require('../src/main/modrinth');

test('override merge: player changes are kept, untouched pack files follow the pack', () => {
  const act = (rel, o) => modpacks.overrideAction(rel, o);
  // missing → written
  assert.strictEqual(act('config/sodium.json', { exists: false, newHash: 'n' }), 'write');
  // unchanged since the old version → new version written
  assert.strictEqual(act('config/sodium.json', { exists: true, current: 'o', oldHash: 'o', newHash: 'n' }), 'write');
  // changed by the player → kept
  assert.strictEqual(act('config/sodium.json', { exists: true, current: 'p', oldHash: 'o', newHash: 'n' }), 'keep');
  assert.strictEqual(act('options.txt', { exists: true, current: 'p', oldHash: 'o', newHash: 'n' }), 'keep');
  // old version unknown → the player's file wins
  assert.strictEqual(act('config/a.toml', { exists: true, current: 'p', newHash: 'n' }), 'keep');
  // already identical → nothing to do
  assert.strictEqual(act('config/a.toml', { exists: true, current: 'n', oldHash: 'o', newHash: 'n' }), 'skip');
  // content folders always follow the pack
  assert.strictEqual(act('mods/extra.jar', { exists: true, current: 'p', oldHash: 'o', newHash: 'n' }), 'write');
  assert.strictEqual(act('resourcepacks/pack.zip', { exists: true, current: 'p', newHash: 'n' }), 'write');
  assert.strictEqual(act('shaderpacks/s.zip', { exists: true, current: 'p', newHash: 'n' }), 'write');
  // worlds and screenshots are never touched by an update
  assert.strictEqual(act('saves/World/level.dat', { exists: false, newHash: 'n' }), 'skip');
  assert.strictEqual(act('saves/World/level.dat', { exists: true, current: 'o', oldHash: 'o', newHash: 'n' }), 'skip');
  assert.strictEqual(act('screenshots/a.png', { exists: false, newHash: 'n' }), 'skip');
});

test('pack record: index paths, Modrinth projects and override hashes', () => {
  const zip = new AdmZip();
  zip.addFile('overrides/config/a.json', Buffer.from('{"a":1}'));
  zip.addFile('client-overrides/config/a.json', Buffer.from('{"a":2}'));
  zip.addFile('overrides/options.txt', Buffer.from('fov:1'));
  const index = {
    files: [
      { path: 'mods/sodium.jar', downloads: ['https://cdn.modrinth.com/data/AANobbMI/versions/abc/sodium.jar'] },
      { path: 'mods/server-only.jar', downloads: ['https://example.com/x.jar'], env: { client: 'unsupported' } },
      { path: 'resourcepacks/x.zip', downloads: ['https://example.com/x.zip'] },
    ],
  };
  const rec = modpacks.packRecord(index, new AdmZip(zip.toBuffer()));
  assert.deepStrictEqual(rec.files, ['mods/sodium.jar', 'resourcepacks/x.zip']);
  assert.deepStrictEqual(rec.ids, { 'mods/sodium.jar': 'AANobbMI' });
  // client-overrides win over overrides
  assert.strictEqual(rec.overrides['config/a.json'], require('crypto').createHash('sha1').update('{"a":2}').digest('hex'));
  assert.ok(rec.overrides['options.txt']);
});

test('update channels map to Modrinth version types', () => {
  assert.deepStrictEqual(modrinth.channelTypes('all'), ['release', 'beta', 'alpha']);
  assert.deepStrictEqual(modrinth.channelTypes(undefined), ['release', 'beta', 'alpha']);
  assert.deepStrictEqual(modrinth.channelTypes('beta'), ['release', 'beta']);
  assert.deepStrictEqual(modrinth.channelTypes('release'), ['release']);
});

test('content updates move the old file into .nore-backup and keep the 3 newest backups', async () => {
  const gameDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nore-upd-'));
  const mods = path.join(gameDir, 'mods');
  fs.mkdirSync(mods);
  fs.writeFileSync(path.join(mods, 'old.jar'), 'old');
  const backups = path.join(gameDir, modrinth.BACKUP_DIR);
  for (const n of ['2020-01-01_00-00-01', '2020-01-01_00-00-02', '2020-01-01_00-00-03', '2020-01-01_00-00-04-pack']) fs.mkdirSync(path.join(backups, n), { recursive: true });
  const net = require('../src/main/net');
  const orig = net.download;
  net.download = async (url, dest) => { fs.writeFileSync(dest, 'new'); return true; };
  try {
    await modrinth.applyUpdates(mods, [{ oldFile: 'old.jar', newFile: 'new.jar', url: 'x' }], { gameDir });
  } finally { net.download = orig; }
  assert.strictEqual(fs.readFileSync(path.join(mods, 'new.jar'), 'utf8'), 'new');
  assert.ok(!fs.existsSync(path.join(mods, 'old.jar')));
  const list = fs.readdirSync(backups).sort();
  assert.strictEqual(list.length, 4); // 3 content backups + the pack backup (pruned separately)
  assert.ok(!list.includes('2020-01-01_00-00-01'));
  const latest = list.filter(n => !n.endsWith('-pack')).pop();
  assert.strictEqual(fs.readFileSync(path.join(backups, latest, 'mods', 'old.jar'), 'utf8'), 'old');
});
