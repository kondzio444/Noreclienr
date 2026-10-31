'use strict';
/*
 * JVM tuning for the game: memory sized to the instance (number of mods, system RAM), garbage
 * collector flags tuned for a client (short pauses, no stutter on servers) and the Java version
 * Minecraft needs. Everything here is pure (no I/O) except countMods, so it is covered by tests.
 *
 * Modes (Settings → Wydajność JVM): 'auto' (tuned G1), 'g1' (tuned G1), 'zgc' (Generational ZGC,
 * Java 21+, falls back to G1 on older Java), 'custom' (only the player's own arguments).
 * The player's own arguments always win: their -Xmx / -Xms / GC choice replace ours.
 */
const fsp = require('fs/promises');
const path = require('path');

const MB = 1;
const GB = 1024 * MB;
const MODES = ['auto', 'g1', 'zgc', 'custom'];

const round512 = (mb) => Math.max(512, Math.floor(mb / 512) * 512);

/** RAM left for the system and other programs: at least 2 GB, 3 GB on machines with more than 8 GB. */
function systemReserveMb(totalMb) {
  return totalMb > 8 * GB ? 3 * GB : 2 * GB;
}

/** Most memory the game may get on this machine. */
function maxGameMb(totalMb) {
  if (!totalMb || totalMb <= 0) return 4 * GB;
  return round512(Math.max(1 * GB, totalMb - systemReserveMb(totalMb)));
}

/**
 * Memory the instance wants, by size: vanilla 2 GB, a few mods 3 GB, light packs 4 GB,
 * medium packs 6 GB, big packs (250+ mods) 8 GB.
 */
function wantedMb({ mods = 0, loader = 'vanilla', shaders = false } = {}) {
  let mb;
  if (!loader || loader === 'vanilla') mb = 2 * GB;
  else if (mods <= 25) mb = 3 * GB;
  else if (mods <= 100) mb = 4 * GB;
  else if (mods <= 175) mb = 5 * GB;
  else if (mods <= 250) mb = 6 * GB;
  else mb = 8 * GB;
  if (shaders && mb < 4 * GB && loader !== 'vanilla') mb += 1 * GB;
  return mb;
}

/** Automatic -Xmx for an instance, capped by system RAM. */
function autoMemoryMb({ mods = 0, loader = 'vanilla', totalMb = 0, shaders = false } = {}) {
  return Math.min(wantedMb({ mods, loader, shaders }), maxGameMb(totalMb));
}

/**
 * Final memory: instance value > launcher value > automatic (0 means automatic on both levels).
 * Returns { xmx, xms, auto, big }. Big packs start with Xms = Xmx so the heap never has to grow mid-game.
 */
function memoryPlan({ instanceMb = 0, settingsMb = 0, mods = 0, loader = 'vanilla', totalMb = 0, shaders = false } = {}) {
  const manual = instanceMb > 0 ? instanceMb : settingsMb > 0 ? settingsMb : 0;
  const xmx = manual ? Math.max(512, Math.round(manual)) : autoMemoryMb({ mods, loader, totalMb, shaders });
  const big = loader !== 'vanilla' && (mods > 100 || xmx >= 6 * GB);
  const xms = big ? xmx : Math.min(xmx, 1 * GB);
  return { xmx, xms, auto: !manual, big };
}

/** G1 region size: 8 MB for small heaps, 16 MB from 6 GB, 32 MB from 12 GB. */
function g1RegionMb(xmx) {
  if (xmx >= 12 * GB) return 32;
  if (xmx >= 6 * GB) return 16;
  if (xmx >= 3 * GB) return 8;
  return 4;
}

/**
 * Garbage collector flags. { mode, javaMajor, xmx, xms, freeMb } → { flags, gc, note }.
 * freeMb is the RAM free right now: AlwaysPreTouch (commits the whole heap at start, fewer stutters
 * later) is only used when the heap fits with 2 GB to spare and Xms = Xmx.
 */
function gcFlags({ mode = 'auto', javaMajor = 17, xmx = 4096, xms = 1024, freeMb = 0 } = {}) {
  if (mode === 'custom') return { flags: [], gc: 'custom', note: null };
  const preTouch = xms >= xmx && freeMb > 0 && freeMb - xmx >= 2 * GB;
  // flags that an older / newer JVM does not know must never stop the game from starting
  const base = ['-XX:+IgnoreUnrecognizedVMOptions', '-XX:+UnlockExperimentalVMOptions', '-XX:+UnlockDiagnosticVMOptions'];
  let note = null;
  if (mode === 'zgc') {
    if (javaMajor >= 21) {
      const flags = [...base, '-XX:+UseZGC'];
      // generational by default since Java 23 (the switch is gone in 24+)
      if (javaMajor < 23) flags.push('-XX:+ZGenerational');
      flags.push('-XX:+DisableExplicitGC', '-XX:+PerfDisableSharedMem');
      if (preTouch) flags.push('-XX:+AlwaysPreTouch');
      return { flags, gc: 'zgc', note };
    }
    note = `ZGC wymaga Javy 21+ (jest ${javaMajor}) – używam zoptymalizowanego G1.`;
  }
  const flags = [
    ...base,
    '-XX:+UseG1GC',
    '-XX:+ParallelRefProcEnabled',
    '-XX:MaxGCPauseMillis=37',
    '-XX:+DisableExplicitGC',
    '-XX:+AlwaysActAsServerClassMachine',
    '-XX:G1NewSizePercent=23',
    '-XX:G1MaxNewSizePercent=50',
    `-XX:G1HeapRegionSize=${g1RegionMb(xmx)}M`,
    '-XX:G1ReservePercent=20',
    '-XX:G1HeapWastePercent=5',
    '-XX:G1MixedGCCountTarget=3',
    '-XX:InitiatingHeapOccupancyPercent=10',
    '-XX:G1MixedGCLiveThresholdPercent=90',
    '-XX:SurvivorRatio=32',
    '-XX:MaxTenuringThreshold=1',
    '-XX:+PerfDisableSharedMem',
    '-XX:+UseStringDeduplication',
  ];
  if (javaMajor >= 17) flags.push('-XX:+UseFastUnorderedTimeStamps');
  if (preTouch) flags.push('-XX:+AlwaysPreTouch');
  return { flags, gc: 'g1', note };
}

/** Splits a user's argument string, keeping "quoted values" together. */
function splitArgs(str) {
  const out = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m;
  while ((m = re.exec(String(str || '')))) out.push(m[1] != null ? m[1] : m[2] != null ? m[2] : m[3]);
  return out;
}

/** Name of a -XX option ("-XX:+UseG1GC" → "UseG1GC", "-XX:MaxGCPauseMillis=50" → "MaxGCPauseMillis"). */
function xxName(arg) {
  const m = /^-XX:[+-]?([A-Za-z0-9_]+)/.exec(arg);
  return m ? m[1] : null;
}

/** "-Xms4G" / "-Xmx2048m" → MB. */
function parseMem(arg) {
  const m = /^-Xm[sx](\d+)([kKmMgG]?)$/.exec(String(arg || ''));
  if (!m) return 0;
  const n = +m[1], u = m[2].toLowerCase();
  return u === 'g' ? n * 1024 : u === 'k' ? Math.ceil(n / 1024) : u === 'm' ? n : Math.ceil(n / 1048576);
}

const GC_SELECT = /^-XX:\+Use(G1|Z|Shenandoah|Parallel|ParallelOld|Serial|ConcMarkSweep|Epsilon)GC$/;
/** Options that only make sense for one collector – dropped when the player picks another one. */
const GC_TUNING = /^(G1|Z|Shenandoah|MaxGCPauseMillis|ParallelRefProcEnabled|InitiatingHeapOccupancyPercent|SurvivorRatio|MaxTenuringThreshold|AlwaysPreTouch|UseStringDeduplication)/;

/**
 * Merges our tuned flags with the player's own arguments (theirs win):
 *  - their -Xmx / -Xms replace ours,
 *  - their GC selection drops our GC and its tuning,
 *  - the same -XX option given by them replaces ours.
 */
function mergeArgs(memory, tuned, userArgs) {
  const user = Array.isArray(userArgs) ? userArgs.filter(Boolean) : splitArgs(userArgs);
  const userXmx = user.some(a => /^-Xmx/i.test(a));
  const userXms = user.some(a => /^-Xms/i.test(a));
  const userGc = user.some(a => GC_SELECT.test(a));
  const userXX = new Set(user.map(xxName).filter(Boolean));
  const out = [];
  if (!userXmx && !userXms) out.push(`-Xmx${memory.xmx}M`, `-Xms${memory.xms}M`);
  else if (!userXmx) {
    // only -Xms given: the heap limit must not be below it
    out.push(`-Xmx${Math.max(memory.xmx, parseMem(user.find(a => /^-Xms/i.test(a))))}M`);
  }
  for (const f of tuned) {
    const n = xxName(f);
    if (userGc && (GC_SELECT.test(f) || (n && GC_TUNING.test(n)))) continue;
    if (n && userXX.has(n)) continue;
    out.push(f);
  }
  return [...out, ...user];
}

/**
 * Everything at once: { memory, flags, args, note }.
 * opts: { mode, javaMajor, instanceMb, settingsMb, mods, loader, totalMb, freeMb, shaders, userArgs }.
 */
function buildJvmArgs(opts = {}) {
  const mode = MODES.includes(opts.mode) ? opts.mode : 'auto';
  const memory = memoryPlan(opts);
  const gc = gcFlags({ mode, javaMajor: opts.javaMajor || 17, xmx: memory.xmx, xms: memory.xms, freeMb: opts.freeMb || 0 });
  return { memory, gc: gc.gc, note: gc.note, args: mergeArgs(memory, gc.flags, opts.userArgs) };
}

// ------------------------------------------------------------------ Java version per Minecraft version

/** "1.20.4" → [1, 20, 4]; "26.1" (new year-based numbers) → [26, 1, 0]; snapshots → null. */
function parseMc(v) {
  const m = /^(\d+)\.(\d+)(?:\.(\d+))?/.exec(String(v || ''));
  return m ? [+m[1], +m[2], +(m[3] || 0)] : null;
}

/**
 * Java major Minecraft needs: the version JSON knows best (javaVersion.majorVersion); without it,
 * by version: up to 1.16 → 8, 1.17 → 16, 1.18–1.20.4 → 17, 1.20.5+ → 21, year-based 26.x → 25.
 */
function requiredJava(mcVersion, versionJson) {
  const j = versionJson && versionJson.javaVersion;
  if (j && j.majorVersion) return j.majorVersion;
  const p = parseMc(mcVersion);
  if (!p) return 21;
  const [a, b, c] = p;
  if (a >= 26) return 25;
  if (a !== 1) return 21;
  if (b <= 16) return 8;
  if (b === 17) return 16;
  if (b < 20 || (b === 20 && c <= 4)) return 17;
  return 21;
}

/** Mojang runtime component for a Java major. */
function componentFor(major) {
  if (major <= 8) return 'jre-legacy';
  if (major <= 16) return 'java-runtime-alpha';
  if (major <= 17) return 'java-runtime-gamma';
  if (major <= 21) return 'java-runtime-delta';
  return 'java-runtime-epsilon';
}

/**
 * Can a Java of this major run the game? Old Minecraft (Java 8 era, LaunchWrapper / old Forge)
 * breaks on newer Java, newer Minecraft needs at least its major.
 */
function javaFits(have, need, loader) {
  if (!have || have < need) return false;
  // Forge / LaunchWrapper from the Java 8 era crashes on Java 9+
  if (need <= 8 && have > 8 && loader === 'forge') return false;
  return true;
}

// ------------------------------------------------------------------ instance size

/** Number of enabled mod jars in an instance (and whether a shader pack is installed). */
async function countMods(gameDir) {
  let mods = 0, shaders = false;
  try { mods = (await fsp.readdir(path.join(gameDir, 'mods'))).filter(f => f.toLowerCase().endsWith('.jar')).length; } catch { /* no mods */ }
  try { shaders = (await fsp.readdir(path.join(gameDir, 'shaderpacks'))).some(f => /\.zip$/i.test(f)); } catch { /* none */ }
  return { mods, shaders };
}

module.exports = {
  MODES, systemReserveMb, maxGameMb, wantedMb, autoMemoryMb, memoryPlan, g1RegionMb, gcFlags, splitArgs, mergeArgs,
  buildJvmArgs, parseMem, parseMc, requiredJava, componentFor, javaFits, countMods,
};
