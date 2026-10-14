'use strict';
/*
 * Mod loaders for client instances: Fabric, Quilt, Forge and NeoForge.
 * Fabric / Quilt ship ready launcher profiles; Forge / NeoForge are installed by running their
 * official installer headless (--installClient) into the launcher's data folder, which uses the
 * same layout as .minecraft (versions/, libraries/).
 */
const fsp = require('fs/promises');
const path = require('path');
const { spawn } = require('child_process');
const paths = require('./paths');
const net = require('./net');

const LOADERS = {
  vanilla: { name: 'Vanilla' },
  fabric: { name: 'Fabric' },
  quilt: { name: 'Quilt' },
  forge: { name: 'Forge' },
  neoforge: { name: 'NeoForge' },
};

const FABRIC_META = 'https://meta.fabricmc.net/v2';
const QUILT_META = 'https://meta.quiltmc.org/v3';
const FORGE_MAVEN = 'https://maven.minecraftforge.net/net/minecraftforge/forge';
const NEO_MAVEN = 'https://maven.neoforged.net/releases/net/neoforged';

function versionJson(id) { return path.join(paths.versions, id, `${id}.json`); }

function cmpVersion(a, b) {
  const pa = a.split(/[.\-+]/).map(n => parseInt(n, 10) || 0), pb = b.split(/[.\-+]/).map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  return 0;
}

function mcMinor(mc) { return parseInt(String(mc).split('.')[1], 10) || 0; }

/** Loader versions for a Minecraft version, newest first: [{ version, stable }]. */
async function versions(loader, mc) {
  if (loader === 'fabric') {
    const list = await net.getJson(`${FABRIC_META}/versions/loader/${encodeURIComponent(mc)}`);
    return list.map(e => ({ version: e.loader.version, stable: e.loader.stable }));
  }
  if (loader === 'quilt') {
    const list = await net.getJson(`${QUILT_META}/versions/loader/${encodeURIComponent(mc)}`);
    return list.map(e => ({ version: e.loader.version, stable: !/beta|pre|rc/i.test(e.loader.version) }));
  }
  if (loader === 'forge') {
    const res = await net.fetchWithRetry(`${FORGE_MAVEN}/maven-metadata.xml`);
    const xml = await res.text();
    const promos = (await net.getJson('https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json').catch(() => ({}))).promos || {};
    const rec = promos[`${mc}-recommended`];
    return [...xml.matchAll(/<version>([^<]+)<\/version>/g)].map(m => m[1])
      .filter(v => v.startsWith(mc + '-')).map(v => v.slice(mc.length + 1))
      .sort((a, b) => cmpVersion(b, a))
      .map(v => ({ version: v, stable: v === rec }));
  }
  if (loader === 'neoforge') {
    if (mc === '1.20.1') {
      const all = (await net.getJson('https://maven.neoforged.net/api/maven/versions/releases/net/neoforged/forge')).versions || [];
      return all.filter(v => v.startsWith('1.20.1-')).map(v => v.slice(7)).sort((a, b) => cmpVersion(b, a)).map(v => ({ version: v, stable: true }));
    }
    // 1.21.1 → "21.1.x", 26.1 → "26.1.0.x" (the year-based versions keep all three parts)
    const p = mc.split('.');
    const prefix = p[0] === '1' ? `${p[1]}.${p[2] || '0'}.` : `${p[0]}.${p[1]}.${p[2] || '0'}.`;
    const all = (await net.getJson('https://maven.neoforged.net/api/maven/versions/releases/net/neoforged/neoforge')).versions || [];
    return all.filter(v => v.startsWith(prefix) && !/snapshot/i.test(v)).sort((a, b) => cmpVersion(b, a))
      .map(v => ({ version: v, stable: !/beta|alpha/i.test(v) }));
  }
  return [];
}

async function pickVersion(loader, mc) {
  const list = await versions(loader, mc);
  const v = list.find(l => l.stable) || list[0];
  if (!v) throw new Error(`${LOADERS[loader].name} nie wspiera Minecraft ${mc}`);
  return v.version;
}

/** Fabric / Quilt: writes the launcher profile; returns its version id. */
async function installProfile(loader, mc, lv) {
  const id = `${loader}-loader-${lv}-${mc}`;
  const file = versionJson(id);
  if (!(await net.exists(file))) {
    const base = loader === 'quilt' ? QUILT_META : FABRIC_META;
    const json = await net.getJson(`${base}/versions/loader/${encodeURIComponent(mc)}/${encodeURIComponent(lv)}/profile/json`);
    json.id = id;
    await fsp.mkdir(path.dirname(file), { recursive: true });
    await fsp.writeFile(file, JSON.stringify(json, null, 2));
  }
  return id;
}

function runJava(javaBin, args, cwd, onLine) {
  return new Promise((resolve, reject) => {
    const child = spawn(javaBin.replace(/javaw\.exe$/i, 'java.exe'), args, { cwd, windowsHide: true });
    const tail = [];
    const read = (d) => d.toString().split(/\r?\n/).forEach(l => {
      if (!l.trim()) return;
      tail.push(l);
      if (tail.length > 15) tail.shift();
      onLine && onLine(l);
    });
    child.stdout.on('data', read);
    child.stderr.on('data', read);
    child.on('error', reject);
    child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`Instalator zakończył się kodem ${code}:\n${tail.slice(-5).join('\n')}`)));
  });
}

async function listVersionIds() {
  try { return new Set(await fsp.readdir(paths.versions)); } catch { return new Set(); }
}

/** Forge / NeoForge: runs the official installer; returns the installed version id. */
async function installForgeLike(loader, mc, lv, { javaBin, progress }) {
  if (loader === 'forge' && mcMinor(mc) < 13) {
    throw new Error(`Forge dla Minecraft ${mc} używa starego instalatora – wybierz Fabric albo wersję 1.13+.`);
  }
  let url, guesses;
  if (loader === 'forge') {
    url = `${FORGE_MAVEN}/${mc}-${lv}/forge-${mc}-${lv}-installer.jar`;
    guesses = [`${mc}-forge-${lv}`, `${mc}-forge${mc}-${lv}`];
  } else if (mc === '1.20.1') {
    url = `${NEO_MAVEN}/forge/1.20.1-${lv}/forge-1.20.1-${lv}-installer.jar`;
    guesses = [`1.20.1-forge-${lv}`, `forge-1.20.1-${lv}`];
  } else {
    url = `${NEO_MAVEN}/neoforge/${lv}/neoforge-${lv}-installer.jar`;
    guesses = [`neoforge-${lv}`];
  }
  for (const id of guesses) if (await net.exists(versionJson(id))) return id;

  const tmp = path.join(paths.cache, 'installers');
  await fsp.mkdir(tmp, { recursive: true });
  const installer = path.join(tmp, path.basename(url));
  progress && progress({ stage: `Pobieranie ${LOADERS[loader].name} ${lv}` });
  await net.download(url, installer);
  // the installer insists on a launcher profile file in the target folder
  const profiles = path.join(paths.root, 'launcher_profiles.json');
  if (!(await net.exists(profiles))) await fsp.writeFile(profiles, JSON.stringify({ profiles: {}, settings: {}, version: 3 }));
  const before = await listVersionIds();
  progress && progress({ stage: `Instalowanie ${LOADERS[loader].name} ${lv}`, current: 'To może potrwać minutę…' });
  await runJava(javaBin, ['-jar', installer, '--installClient', paths.root], tmp, (line) => {
    if (progress && /^\s*(Processor|Downloading|Extracting|Task|Considering|Splitting|Building)/i.test(line)) {
      progress({ stage: `Instalowanie ${LOADERS[loader].name} ${lv}`, current: line.trim().slice(0, 90) });
    }
  });
  await fsp.rm(installer, { force: true });
  await fsp.rm(installer + '.log', { force: true });
  for (const id of guesses) if (await net.exists(versionJson(id))) return id;
  const after = await listVersionIds();
  const created = [...after].filter(id => !before.has(id) && id !== mc);
  if (created.length) return created[0];
  throw new Error(`Nie znaleziono profilu ${LOADERS[loader].name} po instalacji.`);
}

/**
 * Installs a loader for an already installed vanilla version; returns
 * { launchId, loaderVersion, ownJar } where ownJar means the client jar must be named after
 * the loader profile (Forge/NeoForge ignore the jar by its file name).
 */
async function install({ loader, mcVersion, loaderVersion }, { javaBin, progress } = {}) {
  if (!loader || loader === 'vanilla') return { launchId: mcVersion, loaderVersion: null, ownJar: false };
  if (!LOADERS[loader]) throw new Error('Nieznany loader: ' + loader);
  const lv = loaderVersion || await pickVersion(loader, mcVersion);
  if (loader === 'fabric' || loader === 'quilt') {
    progress && progress({ stage: `Instalowanie ${LOADERS[loader].name} ${lv}` });
    return { launchId: await installProfile(loader, mcVersion, lv), loaderVersion: lv, ownJar: false };
  }
  if (!javaBin) throw new Error('Brak Javy do instalacji ' + LOADERS[loader].name);
  return { launchId: await installForgeLike(loader, mcVersion, lv, { javaBin: await javaBin(), progress }), loaderVersion: lv, ownJar: true };
}

/** Modrinth loader names that can run mods of the given instance loader. */
function modLoaders(loader) {
  if (loader === 'quilt') return ['quilt', 'fabric'];
  if (loader === 'neoforge') return ['neoforge'];
  if (loader === 'forge') return ['forge'];
  if (loader === 'fabric') return ['fabric'];
  return [];
}

module.exports = { LOADERS, versions, pickVersion, install, modLoaders, cmpVersion };
