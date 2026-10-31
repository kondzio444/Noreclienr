'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const AdmZip = require('adm-zip');

process.env.NORE_LAUNCHER_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'nore-perf-'));
const perf = require('../src/main/perf');
const gameopts = require('../src/main/gameopts');

const slugs = (list) => list.map(a => a.slug);
const mod = (file, ids, enabled = true) => ({ file, ids, enabled });

test('fabric: only missing performance mods are added', () => {
  const p = perf.planPerfMods({ loader: 'fabric', present: [mod('lithium-fabric-0.15.jar', ['lithium']), mod('fabric-api-0.100.jar', ['fabric-api'])] });
  const add = slugs(p.add);
  for (const s of ['sodium', 'ferrite-core', 'modernfix', 'entityculling', 'immediatelyfast', 'krypton', 'moreculling', 'dynamic-fps', 'badoptimizations']) assert.ok(add.includes(s), s);
  assert.ok(!add.includes('lithium'));
  assert.ok(!add.includes('embeddium'), 'no Forge-only mods on Fabric');
  assert.deepStrictEqual(p.skip.map(s => s.slug), ['lithium']);
});

test('renderer conflicts: Embeddium, OptiFine, Iris with bundled Sodium, VulkanMod', () => {
  const emb = perf.planPerfMods({ loader: 'neoforge', present: [mod('embeddium-1.0.jar', ['embeddium'])] });
  assert.ok(!slugs(emb.add).includes('sodium'));
  assert.ok(!slugs(emb.add).includes('embeddium'));
  // OptiFine is a plain jar: recognised by its name
  const of = perf.planPerfMods({ loader: 'forge', present: [mod('OptiFine_1.20.1_HD_U_I6.jar', [])] });
  assert.ok(!slugs(of.add).includes('embeddium'));
  assert.ok(!slugs(of.add).includes('entityculling') && !slugs(of.add).includes('immediatelyfast'));
  assert.ok(slugs(of.add).includes('ferrite-core'));
  const iris = perf.planPerfMods({ loader: 'fabric', present: [mod('iris-mc1.21-1.7.jar', ['iris'])] });
  assert.ok(!slugs(iris.add).includes('sodium'));
  const vk = perf.planPerfMods({ loader: 'fabric', present: [mod('VulkanMod_1.21-0.5.jar', ['vulkanmod'])] });
  assert.ok(!slugs(vk.add).includes('sodium') && !slugs(vk.add).includes('immediatelyfast'));
  const via = perf.planPerfMods({ loader: 'fabric', present: [mod('ViaFabricPlus-4.0.jar', ['viafabricplus'])] });
  assert.ok(!slugs(via.add).includes('krypton'));
});

test('neoforge: Sodium first, Embeddium as the fallback of the same group; forge gets Embeddium', () => {
  const neo = perf.planPerfMods({ loader: 'neoforge', present: [] });
  const r = neo.add.filter(a => a.group === 'renderer').map(a => a.slug);
  assert.deepStrictEqual(r, ['sodium', 'embeddium']);
  assert.ok(!slugs(neo.add).includes('krypton'));
  const forge = perf.planPerfMods({ loader: 'forge', present: [] });
  assert.deepStrictEqual(forge.add.filter(a => a.group === 'renderer').map(a => a.slug), ['embeddium']);
  assert.ok(!slugs(forge.add).includes('lithium'));
  assert.deepStrictEqual(perf.planPerfMods({ loader: 'vanilla' }).add, []);
});

test('never duplicate: our copy is dropped when the pack brings the mod, kept otherwise', () => {
  const own = [{ slug: 'sodium', file: 'sodium-fabric-0.6.jar' }, { slug: 'krypton', file: 'krypton-0.2.jar' }];
  const p = perf.planPerfMods({ loader: 'fabric', present: [mod('sodium-fabric-0.6.5.jar', ['sodium'])], own });
  assert.deepStrictEqual(p.drop.map(d => d.file), ['sodium-fabric-0.6.jar']);
  assert.ok(p.keep.includes('krypton'));
  assert.ok(!slugs(p.add).includes('sodium') && !slugs(p.add).includes('krypton'));
  // a mod the player switched off stays off
  const off = perf.planPerfMods({ loader: 'fabric', present: [mod('entityculling-1.0.jar.disabled', ['entityculling'], false)] });
  assert.ok(!slugs(off.add).includes('entityculling'));
  assert.strictEqual(off.skip.find(s => s.slug === 'entityculling').reason, 'wyłączony przez gracza');
  // a renderer we added earlier stays the only one
  const ownR = perf.planPerfMods({ loader: 'neoforge', present: [], own: [{ slug: 'embeddium', file: 'embeddium.jar' }] });
  assert.ok(ownR.keep.includes('embeddium'));
  assert.ok(!slugs(ownR.add).includes('sodium'));
});

test('crash repair: blocked mods are not added again and our copy is dropped', () => {
  const p = perf.planPerfMods({ loader: 'fabric', present: [], own: [{ slug: 'moreculling', file: 'moreculling.jar' }], blocked: ['moreculling'] });
  assert.ok(!slugs(p.add).includes('moreculling'));
  assert.deepStrictEqual(p.drop.map(d => d.slug), ['moreculling']);
});

test('blame: mixin failure or top stack frames of an added mod', () => {
  const own = [{ slug: 'immediatelyfast', file: 'if.jar' }, { slug: 'sodium', file: 's.jar' }, { slug: 'krypton', file: 'k.jar' }];
  assert.deepStrictEqual(perf.blamePerf(['Mixin apply for mod immediatelyfast failed immediatelyfast-common.mixins.json:x'], own), ['immediatelyfast']);
  const trace = [
    'java.lang.NullPointerException: Cannot invoke "x"',
    '\tat me.steinborn.krypton.mod.shared.network.pipeline.MinecraftCompressEncoder.encode(MinecraftCompressEncoder.java:40)',
    '\tat io.netty.handler.codec.MessageToByteEncoder.write(MessageToByteEncoder.java:107)',
  ];
  assert.deepStrictEqual(perf.blamePerf(trace, own), ['krypton']);
  // a mod deep in the trace (not at the top) is not blamed; mods we did not add never are
  const deep = ['java.lang.RuntimeException: boom', ...Array.from({ length: 7 }, (_, i) => `\tat some.other.Mod.m${i}(Mod.java:1)`), '\tat net.caffeinemc.mods.sodium.client.Render.r(Render.java:1)'];
  assert.deepStrictEqual(perf.blamePerf(deep, own), []);
  assert.deepStrictEqual(perf.blamePerf(trace, [{ slug: 'sodium', file: 's.jar' }]), []);
});

test('jar scan reads mod ids of every jar, switched off ones too', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nore-perf-mods-'));
  const jar = (name, files) => { const z = new AdmZip(); for (const [k, v] of Object.entries(files)) z.addFile(k, Buffer.from(v)); z.writeZip(path.join(dir, name)); };
  jar('a.jar', { 'fabric.mod.json': JSON.stringify({ id: 'sodium', provides: ['indium-compat'] }) });
  jar('b.jar.disabled', { 'META-INF/neoforge.mods.toml': 'modId="ferritecore"\n' });
  fs.writeFileSync(path.join(dir, 'notes.txt'), 'x');
  const list = (await perf.scan(dir)).sort((x, y) => x.file.localeCompare(y.file));
  assert.deepStrictEqual(list, [{ file: 'a.jar', ids: ['sodium', 'indium-compat'], enabled: true }, { file: 'b.jar.disabled', ids: ['ferritecore'], enabled: false }]);
});

test('enabled: new instances on, Nore Client on by default, vanilla never', () => {
  assert.ok(perf.enabledFor({ loader: 'fabric', perfMods: true }));
  assert.ok(perf.enabledFor({ loader: 'fabric', noreClient: true }));
  assert.ok(!perf.enabledFor({ loader: 'fabric' }));
  assert.ok(!perf.enabledFor({ loader: 'forge', perfMods: false }));
  assert.ok(!perf.enabledFor({ loader: 'vanilla', perfMods: true }));
});

test('graphics profiles in options.txt keep other options', () => {
  const src = 'version:3955\nrenderDistance:24\nsimulationDistance:16\nfov:0.5\nkey_key.jump:key.keyboard.space\n';
  const out = gameopts.applyProfile(src, 'performance', '1.21.1');
  assert.strictEqual(gameopts.readOption(out, 'renderDistance'), '8');
  assert.strictEqual(gameopts.readOption(out, 'simulationDistance'), '6');
  assert.strictEqual(gameopts.readOption(out, 'fov'), '0.5');
  assert.strictEqual(gameopts.readOption(out, 'key_key.jump'), 'key.keyboard.space');
  assert.strictEqual(gameopts.readOption(out, 'graphicsMode'), '0');
  // older versions: no simulation distance, fancyGraphics instead of graphicsMode
  const old = gameopts.applyProfile('', 'quality', '1.12.2');
  assert.strictEqual(gameopts.readOption(old, 'simulationDistance'), null);
  assert.strictEqual(gameopts.readOption(old, 'fancyGraphics'), 'true');
  assert.strictEqual(gameopts.applyProfile(src, 'nope', '1.21.1'), src);
  assert.strictEqual(gameopts.readOption(gameopts.applyProfile(src, 'balanced', '1.21.1'), 'renderDistance'), '12');
});

test('ensure: installs once, never duplicates a pack mod, respects deleted files, crash repair takes one back', async () => {
  const net = require('../src/main/net');
  const instances = require('../src/main/instances');
  const doctor = require('../src/main/doctor');
  const orig = { getJson: net.getJson, download: net.download, fetch: global.fetch };
  const calls = [];
  global.fetch = async () => ({ ok: true, status: 200 });
  net.getJson = async (url) => {
    calls.push(url);
    const m = /\/project\/([^/?]+)\/version\?/.exec(url);
    if (m) {
      const slug = decodeURIComponent(m[1]);
      if (slug === 'badoptimizations' || slug === 'embeddium') return [];
      const deps = slug === 'entityculling' ? [{ dependency_type: 'required', project_id: 'P7dR8mSH' }] : [];
      return [{ id: `v-${slug}`, project_id: `id-${slug}`, version_number: '1.0', version_type: 'release', dependencies: deps,
        files: [{ primary: true, filename: `${slug}-1.0.jar`, url: `https://cdn/${slug}.jar`, hashes: { sha1: 'x' }, size: 1 }] }];
    }
    if (/\/project\/P7dR8mSH$/.test(url)) return { slug: 'fabric-api', title: 'Fabric API' };
    throw new Error('HTTP 404 dla ' + url);
  };
  net.download = async (url, dest) => { fs.writeFileSync(dest, 'jar'); return true; };
  try {
    const inst = instances.create({ name: 'Pack', mcVersion: '1.21.1', loader: 'fabric', modpack: 'pack' });
    const mods = path.join(inst.gameDir, 'mods');
    fs.mkdirSync(mods, { recursive: true });
    const jar = (name, id) => { const z = new AdmZip(); z.addFile('fabric.mod.json', Buffer.from(JSON.stringify({ id }))); z.writeZip(path.join(mods, name)); };
    jar('fabric-api-0.116.jar', 'fabric-api');
    jar('lithium-pack.jar', 'lithium');
    const r = await perf.ensure(instances.get(inst.id));
    const files = r.added.map(a => a.file).sort();
    assert.ok(files.includes('sodium-1.0.jar') && files.includes('krypton-1.0.jar'));
    assert.ok(!files.includes('lithium-1.0.jar'), 'the pack has Lithium');
    assert.ok(!files.includes('fabric-api-1.0.jar'), 'the pack has Fabric API (dependency of EntityCulling)');
    assert.ok(!files.some(f => f.startsWith('badoptimizations')), 'not on Modrinth for this version');
    // nothing changed → no network at all
    calls.length = 0;
    assert.strictEqual(await perf.ensure(instances.get(inst.id)), null);
    assert.strictEqual(calls.length, 0);
    // the pack now brings its own Sodium; the player deleted our Krypton
    jar('sodium-pack.jar', 'sodium');
    fs.rmSync(path.join(mods, 'krypton-1.0.jar'));
    const r2 = await perf.ensure(instances.get(inst.id));
    assert.deepStrictEqual(r2.removed.map(x => x.file), ['sodium-1.0.jar']);
    assert.ok(!fs.existsSync(path.join(mods, 'krypton-1.0.jar')), 'deleted by the player – not added again');
    assert.deepStrictEqual(instances.get(inst.id).perfRemoved, ['krypton']);
    // crash in ImmediatelyFast → taken back and blocked
    const problems = await doctor.analyzeLog(instances.get(inst.id), ['Mixin apply for mod immediatelyfast failed immediatelyfast-common.mixins.json:font.X']);
    const p = problems.find(x => x.fix && x.fix.action === 'perf-remove');
    assert.strictEqual(p.fix.slug, 'immediatelyfast');
    await doctor.apply(instances.get(inst.id), [p]);
    assert.ok(!fs.existsSync(path.join(mods, 'immediatelyfast-1.0.jar')));
    assert.deepStrictEqual(instances.get(inst.id).perfBlocked, ['immediatelyfast']);
    // switching the set off removes only our files
    const gone = await perf.removeAll(instances.get(inst.id));
    assert.ok(gone.length > 0 && !gone.includes('lithium-pack.jar'));
    assert.ok(fs.existsSync(path.join(mods, 'lithium-pack.jar')) && fs.existsSync(path.join(mods, 'sodium-pack.jar')));
    assert.strictEqual(instances.get(inst.id).perfMods, false);
  } finally {
    net.getJson = orig.getJson; net.download = orig.download; global.fetch = orig.fetch;
  }
});
