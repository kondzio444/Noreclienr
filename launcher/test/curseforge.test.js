'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const AdmZip = require('adm-zip');

process.env.NORE_LAUNCHER_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'nore-cf-'));
const cf = require('../src/main/curseforge');
const importers = require('../src/main/importers');

function packZip(manifest, extra = {}) {
  const z = new AdmZip();
  z.addFile('manifest.json', Buffer.from(JSON.stringify(manifest)));
  for (const [k, v] of Object.entries(extra)) z.addFile(k, Buffer.from(v));
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'nore-cfpack-')), 'pack.zip');
  z.writeZip(file);
  return file;
}

test('manifest: loader and Minecraft version (Forge, NeoForge, old NeoForge naming, Fabric)', () => {
  const m = (id, v = '1.20.1') => ({ minecraft: { version: v, modLoaders: [{ id, primary: true }] }, files: [] });
  assert.deepStrictEqual(cf.loaderOf(m('forge-47.2.0')), { loader: 'forge', loaderVersion: '47.2.0' });
  assert.deepStrictEqual(cf.loaderOf(m('neoforge-21.1.80', '1.21.1')), { loader: 'neoforge', loaderVersion: '21.1.80' });
  assert.deepStrictEqual(cf.loaderOf(m('forge-1.20.1-47.1.3')), { loader: 'forge', loaderVersion: '47.1.3' });
  assert.deepStrictEqual(cf.loaderOf(m('fabric-0.16.9', '1.21.1')), { loader: 'fabric', loaderVersion: '0.16.9' });
  assert.deepStrictEqual(cf.loaderOf({ minecraft: { version: '1.21', modLoaders: [] }, files: [] }), { loader: 'vanilla', loaderVersion: null });
  const file = packZip({ minecraft: { version: '1.20.1', modLoaders: [{ id: 'forge-47.2.0', primary: true }] }, files: [{ projectID: 1, fileID: 2, required: true }], name: 'P', version: '1.0', overrides: 'overrides' });
  const r = cf.readManifest(file);
  assert.strictEqual(r.manifest.name, 'P');
  assert.strictEqual(cf.readManifest(packZip({ hello: 1 })), null);
});

test('manifest files: folders by class, server-only and optional files skipped, blocked files flagged', () => {
  const manifest = { files: [
    { projectID: 10, fileID: 100, required: true },
    { projectID: 11, fileID: 110, required: true },
    { projectID: 12, fileID: 120, required: true },
    { projectID: 13, fileID: 130, required: false },
    { projectID: 14, fileID: 140, required: true },
    { projectID: 15, fileID: 150, required: true },
  ] };
  const files = [
    { id: 100, modId: 10, fileName: 'jei.jar', downloadUrl: 'https://edge.forgecdn.net/files/0/100/jei.jar', hashes: [{ algo: 1, value: 'aa' }], fileLength: 5, gameVersions: ['1.20.1', 'Forge', 'Client', 'Server'] },
    { id: 110, modId: 11, fileName: 'serverutils.jar', downloadUrl: 'https://x/s.jar', gameVersions: ['1.20.1', 'Server'] },
    { id: 120, modId: 12, fileName: 'Faithful.zip', downloadUrl: 'https://x/f.zip', gameVersions: ['1.20.1'] },
    { id: 130, modId: 13, fileName: 'optional.jar', downloadUrl: 'https://x/o.jar', gameVersions: ['1.20.1'] },
    { id: 140123, modId: 14, fileName: 'blocked mod.jar', downloadUrl: null, hashes: [{ algo: 1, value: 'bb' }], fileLength: 9, gameVersions: ['1.20.1'] },
  ];
  manifest.files[4].fileID = 140123;
  const mods = [
    { id: 10, classId: 6, name: 'JEI', slug: 'jei' }, { id: 11, classId: 6, name: 'Server Utils' }, { id: 12, classId: 12, name: 'Faithful' },
    { id: 14, classId: 6, name: 'Blocked', slug: 'blocked', links: { websiteUrl: 'https://www.curseforge.com/minecraft/mc-mods/blocked' } },
  ];
  const r = cf.manifestTasks(manifest, files, mods, '/inst');
  assert.deepStrictEqual(r.tasks.map(t => t.rel), ['mods/jei.jar', 'resourcepacks/Faithful.zip', 'mods/blocked mod.jar']);
  assert.strictEqual(r.tasks[0].sha1, 'aa');
  assert.strictEqual(r.tasks[0].dest, path.join('/inst', 'mods', 'jei.jar'));
  assert.deepStrictEqual(r.serverOnly.map(s => s.name), ['serverutils.jar']);
  assert.deepStrictEqual(r.optional, [{ projectId: 13, fileId: 130 }]);
  assert.deepStrictEqual(r.missing, [150]);
  const b = r.tasks[2].blocked;
  assert.ok(b && !r.tasks[0].blocked);
  assert.strictEqual(b.page, 'https://www.curseforge.com/minecraft/mc-mods/blocked/download/140123');
  assert.strictEqual(b.rel, 'mods/blocked mod.jar');
  // blocked files still get the predictable CDN link to try first
  assert.strictEqual(r.tasks[2].url, 'https://edge.forgecdn.net/files/140/123/blocked%20mod.jar');
});

test('blocked files downloaded by hand are picked up from Downloads (also "name (1).jar")', async () => {
  const instances = require('../src/main/instances');
  const modpacks = require('../src/main/modpacks');
  const inst = instances.create({ name: 'CF', mcVersion: '1.20.1', loader: 'forge', modpack: 'pack' });
  const data = Buffer.from('blocked-jar-bytes');
  const sha1 = crypto.createHash('sha1').update(data).digest('hex');
  instances.update(inst.id, { pack: { source: 'curseforge', blocked: [
    { file: 'blocked mod.jar', rel: 'mods/blocked mod.jar', sha1 },
    { file: 'other.jar', rel: 'mods/other.jar', sha1: 'ff' },
  ] } });
  const dl = fs.mkdtempSync(path.join(os.tmpdir(), 'nore-dl-'));
  fs.writeFileSync(path.join(dl, 'blocked mod (1).jar'), data);
  fs.writeFileSync(path.join(dl, 'other.jar'), 'wrong content');
  const r = await modpacks.resolveBlocked(inst.id, [dl, path.join(dl, 'missing')]);
  assert.deepStrictEqual(r.found, ['blocked mod.jar']);
  assert.deepStrictEqual(r.blocked.map(b => b.file), ['other.jar']);
  assert.strictEqual(fs.readFileSync(path.join(inst.gameDir, 'mods', 'blocked mod.jar'), 'utf8'), 'blocked-jar-bytes');
  assert.deepStrictEqual(instances.get(inst.id).pack.blocked.map(b => b.file), ['other.jar']);
});

test('import: Prism / MultiMC, CurseForge app and Modrinth App instances are recognised', async () => {
  const prism = fs.mkdtempSync(path.join(os.tmpdir(), 'nore-prism-'));
  fs.writeFileSync(path.join(prism, 'instance.cfg'), '[General]\nname=Fabulously Optimized\nOverrideMemory=true\nMaxMemAlloc=6144\n');
  fs.writeFileSync(path.join(prism, 'mmc-pack.json'), JSON.stringify({ components: [
    { uid: 'org.lwjgl3', version: '3.3.3' }, { uid: 'net.minecraft', version: '1.21.1' }, { uid: 'net.fabricmc.intermediary', version: '1.21.1' }, { uid: 'net.fabricmc.fabric-loader', version: '0.16.9' },
  ] }));
  fs.mkdirSync(path.join(prism, '.minecraft', 'mods'), { recursive: true });
  fs.writeFileSync(path.join(prism, '.minecraft', 'mods', 'a.jar'), 'x');
  fs.mkdirSync(path.join(prism, '.minecraft', 'logs'));
  const p = importers.detect(prism);
  assert.strictEqual(p.type, 'prism');
  assert.strictEqual(p.name, 'Fabulously Optimized');
  assert.deepStrictEqual([p.mcVersion, p.loader, p.loaderVersion, p.memoryMb], ['1.21.1', 'fabric', '0.16.9', 6144]);
  assert.strictEqual(p.gameDir, path.join(prism, '.minecraft'));
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'nore-imp-'));
  await importers.copyGame(p, dest);
  assert.ok(fs.existsSync(path.join(dest, 'mods', 'a.jar')));
  assert.ok(!fs.existsSync(path.join(dest, 'logs')));

  const cfDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nore-cfapp-'));
  fs.writeFileSync(path.join(cfDir, 'minecraftinstance.json'), JSON.stringify({ name: 'ATM9', gameVersion: '1.20.1', baseModLoader: { name: 'forge-47.2.20', minecraftVersion: '1.20.1' }, allocatedMemory: 8192 }));
  const c = importers.detect(cfDir);
  assert.deepStrictEqual([c.type, c.name, c.mcVersion, c.loader, c.loaderVersion, c.gameDir], ['curseforge', 'ATM9', '1.20.1', 'forge', '47.2.20', cfDir]);

  const mrDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nore-mrapp-'));
  fs.writeFileSync(path.join(mrDir, 'profile.json'), JSON.stringify({ metadata: { name: 'Mój', game_version: '1.20.4', loader: 'quilt', loader_version: { id: '0.26.0' } } }));
  const m = importers.detect(mrDir);
  assert.deepStrictEqual([m.type, m.loader, m.loaderVersion], ['modrinth', 'quilt', '0.26.0']);

  assert.strictEqual(importers.detect(fs.mkdtempSync(path.join(os.tmpdir(), 'nore-empty-'))), null);
  assert.deepStrictEqual(importers.fromLoaderName('fabric-0.15.7-1.20.1', '1.20.1'), { loader: 'fabric', loaderVersion: '0.15.7' });
});
