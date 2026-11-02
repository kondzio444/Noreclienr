'use strict';
const test = require('node:test');
const assert = require('node:assert');
const jvm = require('../src/main/jvm');

const GB = 1024;

test('memory: sized by mod count, capped by system RAM with 2–3 GB left for the system', () => {
  assert.strictEqual(jvm.autoMemoryMb({ mods: 0, loader: 'vanilla', totalMb: 16 * GB }), 2 * GB);
  assert.strictEqual(jvm.autoMemoryMb({ mods: 10, loader: 'fabric', totalMb: 16 * GB }), 3 * GB);
  assert.strictEqual(jvm.autoMemoryMb({ mods: 80, loader: 'fabric', totalMb: 16 * GB }), 4 * GB);
  assert.strictEqual(jvm.autoMemoryMb({ mods: 220, loader: 'forge', totalMb: 16 * GB }), 6 * GB);
  assert.strictEqual(jvm.autoMemoryMb({ mods: 400, loader: 'neoforge', totalMb: 32 * GB }), 8 * GB);
  // 8 GB machine: at most 6 GB for the game, 16 GB: at most 13 GB
  assert.strictEqual(jvm.autoMemoryMb({ mods: 400, loader: 'forge', totalMb: 8 * GB }), 6 * GB);
  assert.strictEqual(jvm.maxGameMb(16 * GB), 13 * GB);
  // 4 GB laptop: 2 GB stay for Windows
  assert.strictEqual(jvm.autoMemoryMb({ mods: 400, loader: 'forge', totalMb: 4 * GB }), 2 * GB);
  assert.ok(jvm.maxGameMb(2 * GB) >= 1024);
  // shaders on a light instance get a bit more
  assert.strictEqual(jvm.autoMemoryMb({ mods: 10, loader: 'fabric', totalMb: 16 * GB, shaders: true }), 4 * GB);
});

test('memory plan: instance > launcher > automatic, Xms = Xmx for big packs', () => {
  assert.deepStrictEqual(jvm.memoryPlan({ instanceMb: 5000, settingsMb: 3000, mods: 0, loader: 'fabric', totalMb: 16 * GB }), { xmx: 5000, xms: 1024, auto: false, big: false });
  assert.strictEqual(jvm.memoryPlan({ settingsMb: 3072, totalMb: 16 * GB }).xmx, 3072);
  const big = jvm.memoryPlan({ mods: 300, loader: 'forge', totalMb: 32 * GB });
  assert.deepStrictEqual(big, { xmx: 8 * GB, xms: 8 * GB, auto: true, big: true });
  const small = jvm.memoryPlan({ mods: 5, loader: 'fabric', totalMb: 16 * GB });
  assert.strictEqual(small.xms, 1024);
  assert.ok(small.auto);
});

test('G1 flags for clients, AlwaysPreTouch only when RAM allows', () => {
  const g = jvm.gcFlags({ mode: 'auto', javaMajor: 21, xmx: 6 * GB, xms: 6 * GB, freeMb: 12 * GB });
  assert.strictEqual(g.gc, 'g1');
  for (const f of ['-XX:+UseG1GC', '-XX:+ParallelRefProcEnabled', '-XX:+DisableExplicitGC', '-XX:G1HeapRegionSize=16M', '-XX:G1ReservePercent=20', '-XX:+AlwaysPreTouch', '-XX:+IgnoreUnrecognizedVMOptions']) {
    assert.ok(g.flags.includes(f), f);
  }
  assert.ok(g.flags.some(f => /^-XX:MaxGCPauseMillis=\d+$/.test(f)));
  assert.ok(g.flags.some(f => /^-XX:G1NewSizePercent=\d+$/.test(f)));
  // not enough free RAM, or a growing heap → no pre-touch
  assert.ok(!jvm.gcFlags({ xmx: 6 * GB, xms: 6 * GB, freeMb: 7 * GB }).flags.includes('-XX:+AlwaysPreTouch'));
  assert.ok(!jvm.gcFlags({ xmx: 6 * GB, xms: 1024, freeMb: 30 * GB }).flags.includes('-XX:+AlwaysPreTouch'));
  assert.ok(jvm.gcFlags({ xmx: 2 * GB }).flags.includes('-XX:G1HeapRegionSize=4M'));
  assert.ok(jvm.gcFlags({ xmx: 16 * GB }).flags.includes('-XX:G1HeapRegionSize=32M'));
});

test('ZGC: generational on Java 21+, falls back to G1 on older Java', () => {
  const z21 = jvm.gcFlags({ mode: 'zgc', javaMajor: 21, xmx: 8 * GB });
  assert.strictEqual(z21.gc, 'zgc');
  assert.ok(z21.flags.includes('-XX:+UseZGC') && z21.flags.includes('-XX:+ZGenerational'));
  assert.ok(!z21.flags.includes('-XX:+UseG1GC'));
  const z25 = jvm.gcFlags({ mode: 'zgc', javaMajor: 25, xmx: 8 * GB });
  assert.ok(z25.flags.includes('-XX:+UseZGC') && !z25.flags.includes('-XX:+ZGenerational'));
  const z17 = jvm.gcFlags({ mode: 'zgc', javaMajor: 17, xmx: 4 * GB });
  assert.strictEqual(z17.gc, 'g1');
  assert.ok(z17.note && /Javy 21/.test(z17.note));
  assert.deepStrictEqual(jvm.gcFlags({ mode: 'custom' }).flags, []);
});

test('player arguments win over ours and keep working', () => {
  const r = jvm.buildJvmArgs({ mode: 'auto', javaMajor: 21, mods: 0, loader: 'fabric', totalMb: 16 * GB, userArgs: '-Xmx6G -XX:+UseZGC -Dfoo="a b"' });
  assert.ok(!r.args.some(a => /^-Xmx\d+M$/.test(a)), 'our -Xmx dropped');
  assert.ok(!r.args.some(a => /^-Xms/.test(a)), 'no -Xms above the player -Xmx');
  assert.ok(!r.args.includes('-XX:+UseG1GC') && !r.args.some(a => a.startsWith('-XX:G1')), 'our GC dropped');
  assert.ok(r.args.includes('-XX:+UseZGC') && r.args.includes('-Xmx6G') && r.args.includes('-Dfoo=a b'));
  // the same option given by the player replaces ours
  const p = jvm.buildJvmArgs({ mode: 'g1', javaMajor: 17, totalMb: 16 * GB, userArgs: '-XX:MaxGCPauseMillis=100' });
  assert.deepStrictEqual(p.args.filter(a => a.startsWith('-XX:MaxGCPauseMillis')), ['-XX:MaxGCPauseMillis=100']);
  // only -Xms given: Xmx is raised to fit it
  const s = jvm.buildJvmArgs({ mode: 'custom', loader: 'vanilla', totalMb: 16 * GB, userArgs: '-Xms3G' });
  assert.deepStrictEqual(s.args, ['-Xmx3072M', '-Xms3G']);
  // custom: only memory + the player's own arguments
  const c = jvm.buildJvmArgs({ mode: 'custom', loader: 'vanilla', totalMb: 16 * GB, userArgs: '-XX:+UseG1GC' });
  assert.deepStrictEqual(c.args, ['-Xmx2048M', '-Xms1024M', '-XX:+UseG1GC']);
  // unknown mode → automatic
  assert.strictEqual(jvm.buildJvmArgs({ mode: 'nonsense' }).gc, 'g1');
  assert.strictEqual(jvm.parseMem('-Xmx4G'), 4096);
  assert.strictEqual(jvm.parseMem('-Xms512m'), 512);
});

test('Java per Minecraft version', () => {
  assert.strictEqual(jvm.requiredJava('1.12.2'), 8);
  assert.strictEqual(jvm.requiredJava('1.16.5'), 8);
  assert.strictEqual(jvm.requiredJava('1.17.1'), 16);
  assert.strictEqual(jvm.requiredJava('1.18.2'), 17);
  assert.strictEqual(jvm.requiredJava('1.20.4'), 17);
  assert.strictEqual(jvm.requiredJava('1.20.5'), 21);
  assert.strictEqual(jvm.requiredJava('1.21.1'), 21);
  assert.strictEqual(jvm.requiredJava('26.1'), 25);
  assert.strictEqual(jvm.requiredJava('1.21.1', { javaVersion: { majorVersion: 21, component: 'java-runtime-delta' } }), 21);
  assert.strictEqual(jvm.requiredJava('24w14a'), 21);
  assert.strictEqual(jvm.componentFor(8), 'jre-legacy');
  assert.strictEqual(jvm.componentFor(17), 'java-runtime-gamma');
  assert.strictEqual(jvm.componentFor(21), 'java-runtime-delta');
  assert.strictEqual(jvm.componentFor(25), 'java-runtime-epsilon');
  assert.ok(jvm.javaFits(21, 17));
  assert.ok(!jvm.javaFits(17, 21));
  assert.ok(!jvm.javaFits(17, 8, 'forge'));
  assert.ok(jvm.javaFits(8, 8, 'forge'));
  assert.ok(!jvm.javaFits(null, 8));
});
