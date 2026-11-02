'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const AdmZip = require('adm-zip');

process.env.NORE_LAUNCHER_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'nore-doctor-'));
const doctor = require('../src/main/doctor');

function jar(dir, name, files) {
  const z = new AdmZip();
  for (const [k, v] of Object.entries(files)) z.addFile(k, Buffer.from(v));
  z.writeZip(path.join(dir, name));
}

function instance(loader) {
  const gameDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nore-inst-'));
  fs.mkdirSync(path.join(gameDir, 'mods'));
  return { id: 'x', name: 'Test', mcVersion: '1.21.1', loader, gameDir };
}

const neoToml = (id, v) => `modLoader="javafml"\n[[mods]]\nmodId="${id}"\nversion="${v}"\ndisplayName="${id}"\n`;

test('preflight: duplicate mod and mod for another loader', async () => {
  const inst = instance('neoforge');
  const mods = path.join(inst.gameDir, 'mods');
  jar(mods, 'sodium-neoforge-0.8.13.jar', { 'META-INF/neoforge.mods.toml': neoToml('sodium', '0.8.13') });
  jar(mods, 'sodium-neoforge-0.6.0.jar', { 'META-INF/neoforge.mods.toml': neoToml('sodium', '0.6.0') });
  jar(mods, 'lithium-fabric.jar', { 'fabric.mod.json': JSON.stringify({ id: 'lithium', version: '0.15.4', name: 'Lithium' }) });
  const p = await doctor.preflight(inst);
  assert.deepStrictEqual(p.map(x => [x.kind, x.file]).sort(), [['duplicate', 'sodium-neoforge-0.6.0.jar'], ['wrong-loader', 'lithium-fabric.jar']]);
  const fixed = await doctor.apply(inst, p);
  assert.ok(fixed.every(f => f.result === 'wyłączono'));
  assert.ok(fs.existsSync(path.join(mods, 'sodium-neoforge-0.6.0.jar.disabled')));
  assert.ok(fs.existsSync(path.join(mods, 'sodium-neoforge-0.8.13.jar')));
});

test('crash log: "Modules sodium_service and sodium export package" keeps the newest Sodium', async () => {
  const inst = instance('neoforge');
  const mods = path.join(inst.gameDir, 'mods');
  jar(mods, 'sodium-neoforge-0.8.13.jar', { 'META-INF/neoforge.mods.toml': neoToml('sodium', '0.8.13') });
  jar(mods, 'sodium-0.6.0.jar', { 'META-INF/neoforge.mods.toml': neoToml('sodium', '0.6.0') });
  const log = ['Exception in thread "main" java.lang.module.ResolutionException: Modules sodium_service and sodium export package net.caffeinemc.mods.sodium.client.compatibility.workarounds.intel to module connector$authlib',
    '\tat java.base/java.lang.module.Resolver.resolveFail(Resolver.java:900)'];
  const p = await doctor.analyzeLog(inst, log);
  const conflict = p.filter(x => x.kind === 'module-conflict');
  assert.strictEqual(conflict.length, 1);
  assert.strictEqual(conflict[0].fix.file, 'sodium-0.6.0.jar');
});

test('crash log: Fabric missing dependency and Forge missing dependency', async () => {
  const inst = instance('fabric');
  const p = await doctor.analyzeLog(inst, [
    "\t - Mod 'Sodium Extra' (sodium-extra) 0.5.4+mc1.21.1 requires any version of mod 'Sodium' (sodium), which is missing!",
    "\tMod ID: 'geckolib', Requested by: 'mowziesmobs', Expected range: '[4.4,)', Actual version: '[MISSING]'",
  ]);
  assert.deepStrictEqual(p.filter(x => x.kind === 'missing-dep').map(x => x.fix.id).sort(), ['geckolib', 'sodium']);
});

test('crash log: wrong Java and out of memory', async () => {
  const inst = { ...instance('fabric'), memoryMb: 2048 };
  const p = await doctor.analyzeLog(inst, ['java.lang.UnsupportedClassVersionError: x has been compiled by a more recent version of the Java Runtime', 'java.lang.OutOfMemoryError: Java heap space']);
  const kinds = p.map(x => x.kind);
  assert.ok(kinds.includes('java'));
  if (os.totalmem() / 1048576 > 6000) assert.ok(kinds.includes('memory'));
});
