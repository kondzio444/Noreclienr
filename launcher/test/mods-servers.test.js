'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const AdmZip = require('adm-zip');

process.env.NORE_LAUNCHER_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'nore-ms-'));
const cfg = require('../src/main/config-edit');
const meta = require('../src/main/mod-meta');
const mm = require('../src/main/mod-manager');
const props = require('../src/main/server-props');
const scf = require('../src/main/server-cf');
const tools = require('../src/main/server-tools');
const jvm = require('../src/main/jvm');
const hangar = require('../src/main/hangar');

const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));

function jar(dir, name, entries) {
  const z = new AdmZip();
  for (const [k, v] of Object.entries(entries)) z.addFile(k, Buffer.from(typeof v === 'string' ? v : JSON.stringify(v)));
  const f = path.join(dir, name);
  z.writeZip(f);
  return f;
}

// ------------------------------------------------------------------ config editor

test('config: TOML fields keep comments, sections and formatting when one value changes', () => {
  const text = [
    '# Client settings', '[client]', '\t# Show the HUD', '\tshowHud = true # inline', '\tscale = 1.5', '', '[server]', '\tname = "Nore"',
    '\tlist = ["a", "b",', '\t  "c"]', '\tmax = 20',
  ].join('\n');
  const r = cfg.parse('x.toml', text);
  assert.ok(r.editable);
  const by = Object.fromEntries(r.fields.map(f => [f.key, f]));
  assert.strictEqual(by['client.showHud'].value, true);
  assert.strictEqual(by['client.showHud'].comment, 'Show the HUD');
  assert.strictEqual(by['client.scale'].type, 'float');
  assert.deepStrictEqual(by['server.list'].value, ['a', 'b', 'c']);
  const out = cfg.apply('x.toml', text, { 'client.showHud': false, 'server.max': '32', 'server.name': 'Nore "2"' });
  assert.match(out, /^\tshowHud = false # inline$/m);
  assert.match(out, /^\tmax = 32$/m);
  assert.match(out, /^\tname = "Nore \\"2\\""$/m);
  assert.match(out, /# Client settings/);
  assert.match(out, /"c"\]/); // untouched multi-line array stays
  const out2 = cfg.apply('x.toml', text, { 'server.list': 'x, y' });
  assert.match(out2, /^\tlist = \["x", "y"\]$/m);
  assert.strictEqual(cfg.parse('x.toml', out2).fields.find(f => f.key === 'server.max').value, 20);
});

test('config: properties, Forge .cfg and JSON (JSON with comments is text-only)', () => {
  const p = '#c\nfoo=bar\nn: 5\nflag=true\n';
  const r = cfg.parse('a.properties', p);
  assert.deepStrictEqual(r.fields.map(f => [f.key, f.value]), [['foo', 'bar'], ['n', 5], ['flag', true]]);
  assert.strictEqual(cfg.apply('a.properties', p, { n: 7, flag: false, added: 'x' }), '#c\nfoo=bar\nn: 7\nflag=false\nadded=x\n');
  const c = 'general {\n    # Enables\n    B:enabled=true\n    I:count=3\n}\n';
  const rc = cfg.parse('a.cfg', c);
  assert.strictEqual(rc.fields[0].key, 'general.enabled');
  assert.strictEqual(cfg.apply('a.cfg', c, { 'general.count': '9' }), c.replace('count=3', 'count=9'));
  const j = '{\n  "a": { "b": 1, "c": "x" },\n  "list": [1, 2]\n}\n';
  const rj = cfg.parse('a.json', j);
  assert.deepStrictEqual(rj.fields.map(f => f.key), ['a.b', 'a.c', 'list']);
  assert.deepStrictEqual(JSON.parse(cfg.apply('a.json', j, { 'a.b': '5', list: '[3]' })), { a: { b: 5, c: 'x' }, list: [3] });
  assert.strictEqual(cfg.parse('a.json', '{ // c\n "a": 1 }').editable, false);
  assert.throws(() => cfg.apply('a.json', '{ // c\n "a": 1 }', { a: 2 }));
});

// ------------------------------------------------------------------ jar metadata & analysis

test('mod metadata: Fabric, Forge mods.toml with dependencies, plugin.yml and paper-plugin.yml', () => {
  const read = (files) => (n) => (files[n] === undefined ? null : typeof files[n] === 'string' ? files[n] : JSON.stringify(files[n]));
  const fab = meta.parseMeta(read({ 'fabric.mod.json': { id: 'sodium', name: 'Sodium', version: '0.6', environment: 'client', depends: { minecraft: '1.21', 'fabric-api': '*' }, breaks: { optifabric: '*' } } }));
  assert.strictEqual(fab.side, 'client');
  assert.deepStrictEqual(fab.depends, ['minecraft', 'fabric-api']);
  assert.deepStrictEqual(fab.breaks, ['optifabric']);
  const toml = [
    'modLoader="javafml"', 'loaderVersion="[47,)"', '[[mods]]', 'modId="create"', 'version="${file.jarVersion}"', 'displayName="Create"',
    '[[dependencies.create]]', 'modId="forge"', 'mandatory=true', 'side="BOTH"', '[[dependencies.create]]', 'modId="flywheel"', 'mandatory=true', 'side="BOTH"',
    '[[dependencies.create]]', 'modId="jei"', 'type="optional"', 'side="CLIENT"', '[[dependencies.create]]', 'modId="badmod"', 'type="incompatible"',
  ].join('\n');
  const forge = meta.parseMeta(read({ 'META-INF/mods.toml': toml, 'META-INF/MANIFEST.MF': 'Manifest-Version: 1.0\nImplementation-Version: 0.5.1f\n' }));
  assert.strictEqual(forge.id, 'create');
  assert.strictEqual(forge.version, '0.5.1f');
  assert.deepStrictEqual(forge.depends, ['forge', 'flywheel']);
  assert.deepStrictEqual(forge.optional, ['jei']);
  assert.deepStrictEqual(forge.breaks, ['badmod']);
  const neo = meta.parseMeta(read({ 'META-INF/neoforge.mods.toml': '[[mods]]\nmodId="x"\nversion="1"\n', }));
  assert.strictEqual(neo.loader, 'neoforge');
  const pl = meta.parseMeta(read({ 'plugin.yml': 'name: Essentials\nversion: 2.20\ndepend: [Vault]\nsoftdepend:\n  - LuckPerms\n  - WorldGuard\nauthor: md_5\n' }));
  assert.deepStrictEqual([pl.kind, pl.id, pl.version, pl.depends, pl.optional], ['plugin', 'Essentials', '2.20', ['Vault'], ['LuckPerms', 'WorldGuard']]);
  const pp = meta.parseMeta(read({ 'paper-plugin.yml': 'name: Shop\nversion: 1\ndependencies:\n  server:\n    Vault:\n      load: BEFORE\n      required: true\n    PlaceholderAPI:\n      required: false\n' }));
  assert.deepStrictEqual([pp.depends, pp.optional], [['Vault'], ['PlaceholderAPI']]);
  assert.strictEqual(meta.parseMeta(read({})), null);
});

test('mod analysis: dependents, missing (also "switched off"), conflicts, duplicates, client-only on servers', () => {
  const m = (file, id, extra = {}, enabled = true) => ({ file, enabled, meta: { kind: 'mod', loader: 'fabric', id, name: id, side: 'both', depends: [], breaks: [], provides: [], ...extra } });
  const mods = [
    m('api.jar', 'fabric-api', { bundled: ['fabric-api-base'] }),
    m('a.jar', 'a', { depends: ['fabric-api', 'fabric-networking-api-v1', 'b', 'minecraft'] }),
    m('b.jar.disabled', 'b', {}, false),
    m('c.jar', 'c', { depends: ['nothere'], breaks: ['a'] }),
    m('d1.jar', 'd'), m('d2.jar', 'd'),
    m('s.jar', 'sodium', { side: 'client' }),
  ];
  const r = meta.analyze(mods, { server: true, loader: 'fabric' });
  assert.deepStrictEqual(r.byFile['api.jar'].dependents, ['a.jar']);
  assert.deepStrictEqual(r.byFile['a.jar'].missing, [{ id: 'b', disabled: 'b.jar.disabled' }]);
  assert.deepStrictEqual(r.byFile['c.jar'].missing, [{ id: 'nothere', disabled: null }]);
  assert.ok(r.byFile['a.jar'].conflicts.includes('c.jar'));
  assert.ok(r.byFile['d1.jar'].conflicts.includes('d2.jar'));
  const types = r.warnings.map(w => w.type).sort();
  assert.deepStrictEqual(types, ['client', 'conflict', 'duplicate', 'missing', 'missing']);
  assert.ok(meta.loaderFits('fabric', 'quilt'));
  assert.ok(!meta.loaderFits('forge', 'fabric'));
});

// ------------------------------------------------------------------ mod manager

test('mod manager: list a real folder, toggle, bulk, keys and filters', async () => {
  const dir = tmp('nore-mods-');
  jar(dir, 'sodium-fabric-0.6.0+mc1.21.1.jar', { 'fabric.mod.json': { id: 'sodium', name: 'Sodium', version: '0.6.0', environment: 'client', depends: { 'fabric-api': '*' } } });
  jar(dir, 'fabric-api-0.100.jar', { 'fabric.mod.json': { id: 'fabric-api', name: 'Fabric API', version: '0.100', environment: '*' } });
  jar(dir, 'lithium.jar.disabled', { 'fabric.mod.json': { id: 'lithium', name: 'Lithium', version: '0.13', environment: '*' } });
  fs.writeFileSync(path.join(dir, 'notes.txt'), 'x');
  const r = await mm.list(dir, { pins: ['lithium'] });
  assert.deepStrictEqual(r.mods.map(x => x.name), ['Fabric API', 'Lithium', 'Sodium']);
  const api = r.mods.find(x => x.id === 'fabric-api');
  assert.deepStrictEqual(api.dependents.map(d => d.name), ['Sodium']);
  assert.strictEqual(r.mods.find(x => x.id === 'lithium').pinned, true);
  assert.strictEqual(r.mods.find(x => x.id === 'sodium').side, 'client');
  assert.deepStrictEqual(mm.filterSort(r.mods, { state: 'disabled' }).map(x => x.id), ['lithium']);
  assert.deepStrictEqual(mm.filterSort(r.mods, { side: 'client' }).map(x => x.id), ['sodium']);
  assert.deepStrictEqual(mm.filterSort(r.mods, { query: 'api' }).map(x => x.id), ['fabric-api']);
  assert.strictEqual(mm.filterSort(r.mods, { sort: 'dependents' })[0].id, 'fabric-api');

  assert.strictEqual(await mm.setEnabled(dir, 'lithium.jar.disabled', true), 'lithium.jar');
  assert.ok(fs.existsSync(path.join(dir, 'lithium.jar')));
  await assert.rejects(mm.setEnabled(dir, '../x.jar', false));
  const done = await mm.bulk(dir, ['lithium.jar', 'fabric-api-0.100.jar'], 'disable');
  assert.deepStrictEqual(done, ['lithium.jar.disabled', 'fabric-api-0.100.jar.disabled']);
  const backup = path.join(dir, '..', path.basename(dir) + '-bk');
  await mm.bulk(dir, ['lithium.jar.disabled'], 'remove', { backupDir: backup });
  assert.ok(fs.existsSync(path.join(backup, 'lithium.jar.disabled')));
  assert.strictEqual(mm.modKey('Xaeros_Minimap_24.5.0_Fabric_1.21.jar', null), 'xaerosminimap');
  assert.strictEqual(mm.toggledName('a.jar', false), 'a.jar.disabled');
  assert.strictEqual(mm.toggledName('a.jar.disabled', true), 'a.jar');
});

test('mod manager: pins drop updates, profiles switch sets and leave unknown mods alone', () => {
  const ups = [{ oldFile: 'a-1.jar' }, { oldFile: 'b-1.jar' }];
  const keyOf = (f) => f.split('-')[0];
  assert.deepStrictEqual(mm.withoutPinned(ups, ['A'], keyOf), [{ oldFile: 'b-1.jar' }]);
  assert.deepStrictEqual(mm.togglePin(['a'], 'B', true), ['a', 'b']);
  assert.deepStrictEqual(mm.togglePin(['a', 'b'], 'a', false), ['b']);
  const mods = [{ key: 'a', file: 'a.jar', enabled: true }, { key: 'b', file: 'b.jar.disabled', enabled: false }, { key: 'c', file: 'c.jar', enabled: true }];
  const p = mm.makeProfile('  PvP  ', mods);
  assert.deepStrictEqual(p.enabled, ['a', 'c']);
  assert.strictEqual(p.name, 'PvP');
  const now = [{ key: 'a', file: 'a.jar.disabled', enabled: false }, { key: 'b', file: 'b.jar', enabled: true }, { key: 'c', file: 'c.jar', enabled: true }, { key: 'new', file: 'new.jar.disabled', enabled: false }];
  assert.deepStrictEqual(mm.profilePlan(now, p), [{ file: 'a.jar.disabled', to: 'a.jar' }, { file: 'b.jar', to: 'b.jar.disabled' }]);
  const list = mm.upsertProfile([{ name: 'Zz' }, { name: 'PvP', enabled: [] }], p);
  assert.deepStrictEqual(list.map(x => x.name), ['PvP', 'Zz']);
  assert.deepStrictEqual(list[0].enabled, ['a', 'c']);
});

test('mod manager: mod list export (txt, markdown) and pack formats', () => {
  const mods = [
    { name: 'Sodium', version: '0.6', side: 'client', file: 'sodium.jar', enabled: true, projectId: 'AANobbMI', source: 'modrinth' },
    { name: 'JEI | x', version: '19', side: 'both', file: 'jei.jar', enabled: true, projectId: 'cf:238222', source: 'curseforge' },
    { name: 'Old', version: '', side: 'unknown', file: 'old.jar.disabled', enabled: false },
  ];
  const txt = mm.modlist(mods, 'txt', { title: 'Paczka', mcVersion: '1.21.1', loader: 'Fabric' });
  assert.match(txt, /^Paczka\nMinecraft 1\.21\.1 • Fabric\nWłączone mody \(2\):\n- Sodium 0\.6 \[klient\] \(sodium\.jar\)/);
  assert.match(txt, /Wyłączone \(1\):\n- Old \(old\.jar\.disabled\)/);
  const md = mm.modlist(mods, 'md', { title: 'Paczka' });
  assert.match(md, /^# Paczka/);
  assert.match(md, /\| \[Sodium\]\(https:\/\/modrinth\.com\/project\/AANobbMI\) \| 0\.6 \| klient \| `sodium\.jar` \|/);
  assert.match(md, /\[JEI \\\| x\]\(https:\/\/www\.curseforge\.com\/projects\/238222\)/);
  assert.match(md, /## Wyłączone/);

  const idx = mm.mrpackIndex({ name: 'P', version: '2', mcVersion: '1.21.1', loader: 'fabric', loaderVersion: '0.16.9', files: [{ path: 'mods/a.jar', sha1: 's1', sha512: 's5', size: 3, url: 'https://cdn.modrinth.com/a.jar' }] });
  assert.deepStrictEqual(idx.dependencies, { minecraft: '1.21.1', 'fabric-loader': '0.16.9' });
  assert.deepStrictEqual(idx.files[0], { path: 'mods/a.jar', hashes: { sha1: 's1', sha512: 's5' }, downloads: ['https://cdn.modrinth.com/a.jar'], fileSize: 3 });
  assert.strictEqual(idx.formatVersion, 1);
  const man = mm.cfManifest({ name: 'P', mcVersion: '1.20.1', loader: 'forge', loaderVersion: '47.2.0', files: [{ projectID: 1, fileID: 2 }] });
  assert.deepStrictEqual(man.minecraft, { version: '1.20.1', modLoaders: [{ id: 'forge-47.2.0', primary: true }] });
  assert.deepStrictEqual(man.files, [{ projectID: 1, fileID: 2, required: true }]);
  assert.strictEqual(man.overrides, 'overrides');
  const split = mm.splitExport(['mods/a.jar', 'mods/own.jar', 'config/x.toml', 'options.txt'], { 'mods/a.jar': { url: 'u', sha512: 'h', projectID: 1, fileID: 2 } }, 'mrpack');
  assert.deepStrictEqual(split.remote.map(r => r.path), ['mods/a.jar']);
  assert.deepStrictEqual(split.overrides, ['mods/own.jar', 'config/x.toml', 'options.txt']);
});

test('mod manager: exportable files skip worlds, logs and launcher files; full .mrpack round trip offline', async () => {
  const root = tmp('nore-exp-');
  for (const f of ['mods/own.jar', 'config/a.toml', 'saves/w/level.dat', 'logs/latest.log', '.nore-backup/x', 'options.txt', 'usercache.json', 'resourcepacks/p.zip']) {
    fs.mkdirSync(path.dirname(path.join(root, f)), { recursive: true });
    fs.writeFileSync(path.join(root, f), 'x');
  }
  fs.writeFileSync(path.join(root, 'mods', 'off.jar.disabled'), 'x');
  assert.deepStrictEqual(await mm.exportableFiles(root), ['config/a.toml', 'mods/own.jar', 'options.txt', 'resourcepacks/p.zip']);
  assert.deepStrictEqual(await mm.exportableFiles(root, { includeOptions: false }), ['config/a.toml', 'mods/own.jar', 'resourcepacks/p.zip']);
  const out = path.join(tmp('nore-exp-out-'), 'pack.mrpack');
  const fakeNet = { sha1File: async () => 'h', fetchWithRetry: async () => ({ ok: false }) };
  const r = await mm.exportPack({ name: 'Moja', gameDir: root, mcVersion: '1.21.1', loader: 'fabric', loaderVersion: '0.16.9' }, { format: 'mrpack', out, net: fakeNet });
  assert.deepStrictEqual([r.remote, r.overrides], [0, 4]);
  const z = new AdmZip(out);
  const index = JSON.parse(z.readAsText('modrinth.index.json'));
  assert.strictEqual(index.name, 'Moja');
  assert.ok(z.getEntry('overrides/mods/own.jar'));
  assert.throws(() => mm.insideRoot(root, '../etc/passwd'));
});

// ------------------------------------------------------------------ server.properties

test('server.properties: parse / serialize keep comments, escapes and unknown keys', () => {
  const text = '#Minecraft server properties\n#Mon Jan 01\nmotd=\\u00A7aNore \\u00A7lServer\nmax-players=10\ncustom-key=keep me\nonline-mode=false\n';
  const p = props.parse(text);
  assert.strictEqual(p.motd, '§aNore §lServer');
  assert.strictEqual(p['custom-key'], 'keep me');
  const out = props.serialize(text, { motd: '§cHej\nDruga linia', 'max-players': 20, pvp: false });
  assert.match(out, /^#Minecraft server properties\n#Mon Jan 01\n/);
  assert.match(out, /^motd=\\u00a7cHej\\nDruga linia$/m);
  assert.match(out, /^max-players=20$/m);
  assert.match(out, /^custom-key=keep me$/m);
  assert.match(out, /^pvp=false$/m);
  assert.strictEqual(props.parse(out).motd, '§cHej\nDruga linia');
  assert.strictEqual(props.serialize('', { a: 1 }), '#Minecraft server properties\na=1\n');
});

test('server.properties: validation limits, warnings and MOTD colours', () => {
  assert.deepStrictEqual(props.validate('view-distance', '99'), { value: 32, error: 'Zasięg widzenia (chunki): zakres 3–32' });
  assert.deepStrictEqual(props.validate('pvp', 'true'), { value: true });
  assert.strictEqual(props.validate('difficulty', 'nope').value, 'peaceful');
  assert.strictEqual(props.validate('motd', 'a\\nb\nc').value, 'a\nb');
  const w = props.warnings({ 'online-mode': 'false', 'view-distance': '20', 'simulation-distance': '24' }).map(x => x.key);
  assert.deepStrictEqual(w, ['online-mode', 'view-distance', 'simulation-distance']);
  const segs = props.motdSegments('§aZielony &lgruby§r zwykły &#ff8800hex\\ndruga');
  assert.strictEqual(segs.length, 2);
  assert.deepStrictEqual(segs[0].map(s => [s.text, s.color, s.bold]), [['Zielony ', '#55ff55', false], ['gruby', '#55ff55', true], [' zwykły ', '#aaaaaa', false], ['hex', '#ff8800', false]]);
  assert.strictEqual(props.motdPlain('§aA§lB'), 'AB');
});

// ------------------------------------------------------------------ CurseForge on servers

test('CurseForge server pack: server pack file when the project has one, else the manifest', () => {
  assert.deepStrictEqual(scf.serverPackPlan({ id: 5, serverPackFileId: 9 }), { mode: 'serverpack', fileId: 9 });
  assert.deepStrictEqual(scf.serverPackPlan({ id: 5, isServerPack: true }), { mode: 'serverpack', fileId: 5 });
  assert.deepStrictEqual(scf.serverPackPlan({ id: 5 }), { mode: 'manifest' });
  assert.deepStrictEqual(scf.serverPackPlan(null), { mode: 'manifest' });
});

test('CurseForge manifest → server: only server / both-side files, client mods and packs skipped, blocked flagged', () => {
  const manifest = { files: [
    { projectID: 1, fileID: 10, required: true }, { projectID: 2, fileID: 20, required: true }, { projectID: 3, fileID: 30, required: true },
    { projectID: 4, fileID: 40, required: true }, { projectID: 5, fileID: 50, required: true }, { projectID: 6, fileID: 60, required: true },
    { projectID: 7, fileID: 70, required: false }, { projectID: 8, fileID: 80, required: true },
  ] };
  const files = [
    { id: 10, modId: 1, fileName: 'create.jar', downloadUrl: 'https://edge.forgecdn.net/create.jar', gameVersions: ['1.20.1', 'Forge', 'Client', 'Server'], hashes: [{ algo: 1, value: 'aa' }], fileLength: 5 },
    { id: 20, modId: 2, fileName: 'oculus.jar', downloadUrl: 'u', gameVersions: ['1.20.1', 'Forge', 'Client'] },
    { id: 30, modId: 3, fileName: 'pack.zip', downloadUrl: 'u', gameVersions: ['1.20.1'] },
    { id: 40, modId: 4, fileName: 'ftbbackups.jar', downloadUrl: 'u', gameVersions: ['1.20.1', 'Server'] },
    { id: 50, modId: 5, fileName: 'blocked.jar', downloadUrl: null, gameVersions: ['1.20.1'], hashes: [{ algo: 1, value: 'bb' }], fileLength: 7 },
    { id: 60, modId: 6, fileName: 'dp.zip', downloadUrl: 'u', gameVersions: ['1.20.1'] },
    { id: 70, modId: 7, fileName: 'optional.jar', downloadUrl: 'u', gameVersions: [] },
  ];
  const mods = [
    { id: 1, classId: 6, name: 'Create' }, { id: 2, classId: 6, name: 'Oculus' }, { id: 3, classId: 12, name: 'Faithful' }, { id: 4, classId: 6, name: 'FTB Backups' },
    { id: 5, classId: 6, name: 'Blocky', slug: 'blocky', links: { websiteUrl: 'https://www.curseforge.com/minecraft/mc-mods/blocky/' } }, { id: 6, classId: 6945, name: 'DP' },
  ];
  const r = scf.manifestServerTasks(manifest, files, mods, { root: '/srv', world: 'swiat' });
  assert.deepStrictEqual(r.tasks.map(t => t.rel), ['mods/create.jar', 'mods/ftbbackups.jar', 'mods/blocked.jar', 'swiat/datapacks/dp.zip']);
  assert.deepStrictEqual(r.clientSkipped.map(c => [c.title, c.why]), [['Oculus', 'client'], ['Faithful', 'resourcepack']]);
  assert.deepStrictEqual(r.missing, [80]);
  assert.deepStrictEqual(r.optional, [{ projectId: 7, fileId: 70 }]);
  const b = r.tasks.find(t => t.blocked);
  assert.strictEqual(b.blocked.page, 'https://www.curseforge.com/minecraft/mc-mods/blocky/download/50');
  assert.strictEqual(b.blocked.rel, 'mods/blocked.jar');
  assert.match(b.url, /edge\.forgecdn\.net\/files\/0\/50\/blocked\.jar/);
  assert.strictEqual(r.tasks[0].sha1, 'aa');
  assert.strictEqual(scf.cfSide({ gameVersions: ['Server'] }), 'server');
  assert.strictEqual(scf.cfSide({ gameVersions: [] }), 'unknown');
  assert.ok(scf.serverOverride('config/create-common.toml'));
  assert.ok(scf.serverOverride('kubejs/server_scripts/a.js'));
  assert.ok(!scf.serverOverride('resourcepacks/x.zip'));
  assert.ok(!scf.serverOverride('options.txt'));
  assert.ok(!scf.serverOverride('servers.dat_old'));
  assert.ok(!scf.serverOverride('world/level.dat'));
  assert.ok(!scf.serverOverride('server.properties'));
  assert.deepStrictEqual(scf.kindsFor('paper'), ['plugin', 'datapack', 'modpack']);
  assert.deepStrictEqual(scf.kindsFor('velocity'), []);
});

// ------------------------------------------------------------------ server tools

test('server tools: schedule, TPS lines, join / leave on proxies, console autocomplete', () => {
  const now = new Date(2026, 9, 31, 3, 50, 0).getTime();
  assert.strictEqual(tools.msUntil(now, '04:00'), 10 * 60000);
  assert.strictEqual(tools.msUntil(now, '03:50'), 24 * 3600000);
  assert.strictEqual(tools.msUntil(now, '25:00'), null);
  assert.deepStrictEqual(tools.normalizeSchedule({ restartAt: '4:05', backupEveryH: '500', warnMinutes: 99 }), { restartAt: '04:05', backupEveryH: 168, warnMinutes: 30 });
  assert.deepStrictEqual(tools.normalizeSchedule({ restartAt: 'x' }), { restartAt: '', backupEveryH: 0, warnMinutes: 5 });
  assert.deepStrictEqual(tools.restartWarnings(5).map(w => w.before), [300000, 180000, 120000, 60000, 10000]);
  assert.deepStrictEqual(tools.parseTps('[12:00:00 INFO]: §6TPS from last 1m, 5m, 15m: §a*20.0, §a19.97, §a19.99'), { tps: 20 });
  assert.deepStrictEqual(tools.parseTps('[Server thread/INFO]: Overall: Mean tick time: 4.512 ms. Mean TPS: 20.000'), { tps: 20, mspt: 4.512 });
  assert.strictEqual(tools.parseTps('hello'), null);
  assert.ok(tools.isTpsNoise('TPS from last 1m, 5m, 15m: 20.0, 20.0, 20.0'));
  assert.ok(!tools.isTpsNoise('Steve joined the game'));
  assert.strictEqual(tools.tpsCommand('paper'), 'tps');
  assert.strictEqual(tools.tpsCommand('vanilla'), null);
  assert.deepStrictEqual(tools.playerEvent('[Server thread/INFO]: Steve joined the game'), { join: 'Steve' });
  assert.deepStrictEqual(tools.playerEvent('[INFO]: [connected player] Alex (/1.2.3.4:5) has connected'), { join: 'Alex' });
  assert.deepStrictEqual(tools.playerEvent('[INFO]: Steve left the game'), { leave: 'Steve' });
  assert.ok(tools.isReadyLine('[INFO]: Done (1.23s)!'));
  assert.ok(tools.isReadyLine('Listening on /0.0.0.0:25577'));
  const c1 = tools.complete('gam', { type: 'paper' }).map(s => s.value);
  assert.ok(c1.includes('gamemode') && c1.includes('gamerule'));
  assert.deepStrictEqual(tools.complete('gamemode cr', {}).map(s => s.value), ['gamemode creative']);
  assert.deepStrictEqual(tools.complete('op St', { players: ['Steve', 'Alex'] }).map(s => s.value), ['op Steve']);
  assert.deepStrictEqual(tools.complete('time set n', {}).map(s => s.value), ['time set night', 'time set noon']);
  assert.strictEqual(tools.complete('t', { history: ['tp Steve Alex'] })[0].value, 'tp Steve Alex');
  assert.ok(tools.complete('en', { type: 'velocity' }).some(s => s.value === 'end'));
  assert.ok(!tools.complete('tp', { type: 'vanilla' }).some(s => s.value === 'tps'));
});

test('server JVM profiles: Aikar flags, ZGC on Java 21+, proxy flags, owner arguments win', () => {
  const a = jvm.serverJvmArgs({ profile: 'aikar', memoryMb: 4096 });
  assert.ok(a.includes('-Xmx4096M') && a.includes('-Xms2048M'));
  assert.ok(a.includes('-XX:G1HeapRegionSize=8M') && a.includes('-Dusing.aikars.flags=https://mcflags.emc.gs'));
  const pre = jvm.serverFlags({ profile: 'aikar', memoryMb: 4096, freeMb: 16000 });
  assert.strictEqual(pre.xms, 4096);
  assert.ok(pre.flags.includes('-XX:+AlwaysPreTouch'));
  const big = jvm.serverFlags({ profile: 'aikar', memoryMb: 16384 });
  assert.ok(big.flags.includes('-XX:G1HeapRegionSize=16M'));
  assert.ok(jvm.serverFlags({ profile: 'zgc', javaMajor: 21 }).flags.includes('-XX:+ZGenerational'));
  const old = jvm.serverFlags({ profile: 'zgc', javaMajor: 17 });
  assert.ok(old.flags.includes('-XX:+UseG1GC') && old.note);
  assert.ok(jvm.serverFlags({ profile: 'aikar', proxy: true }).flags.includes('-XX:MaxInlineLevel=15'));
  assert.deepStrictEqual(jvm.serverJvmArgs({ profile: 'basic', memoryMb: 3072 }), ['-Xmx3072M', '-Xms1024M']);
  const own = jvm.serverJvmArgs({ profile: 'aikar', memoryMb: 4096, userArgs: '-XX:+UseZGC -Xmx6G' });
  assert.ok(own.includes('-XX:+UseZGC') && own.includes('-Xmx6G'));
  assert.ok(!own.includes('-XX:+UseG1GC') && !own.includes('-Xmx4096M'));
});

test('Hangar: version picking by platform and Minecraft version', () => {
  const vs = [
    { name: '3.0-beta', channel: { name: 'Beta' }, downloads: { PAPER: { downloadUrl: 'b' } }, platformDependencies: { PAPER: ['1.21.1'] } },
    { name: '2.9', channel: { name: 'Release' }, downloads: { PAPER: { downloadUrl: 'r' } }, platformDependencies: { PAPER: ['1.20-1.21.4'] } },
    { name: '1.0', channel: { name: 'Release' }, downloads: { VELOCITY: { downloadUrl: 'v' } }, platformDependencies: { VELOCITY: ['3.3'] } },
  ];
  assert.strictEqual(hangar.pickVersion(vs, 'PAPER', '1.21.1').name, '2.9');
  assert.strictEqual(hangar.pickVersion(vs, 'PAPER', '1.19.4'), null);
  assert.strictEqual(hangar.pickVersion(vs, 'VELOCITY', '1.21.1').name, '1.0');
  assert.ok(hangar.supports(['1.21'], '1.21.3'));
  assert.strictEqual(hangar.platformFor('purpur'), 'PAPER');
  assert.strictEqual(hangar.platformFor('fabric'), null);
});
