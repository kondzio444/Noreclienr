'use strict';
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const os = require('os');
const AdmZip = require('adm-zip');
const paths = require('./paths');
const net = require('./net');

const MANIFEST = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json';
const FABRIC_META = 'https://meta.fabricmc.net/v2';
const RESOURCES = 'https://resources.download.minecraft.net';

const OS_NAME = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'osx' : 'linux';
const ARCH = process.arch === 'x64' ? 'x86_64' : process.arch === 'arm64' ? 'arm64' : process.arch === 'ia32' ? 'x86' : process.arch;

let manifestCache = null;

async function getManifest(force = false) {
  if (manifestCache && !force) return manifestCache;
  const cacheFile = path.join(paths.cache, 'version_manifest_v2.json');
  try {
    manifestCache = await net.getJson(MANIFEST);
    await fsp.mkdir(paths.cache, { recursive: true });
    await fsp.writeFile(cacheFile, JSON.stringify(manifestCache));
  } catch (e) {
    // offline fallback
    manifestCache = JSON.parse(await fsp.readFile(cacheFile, 'utf8'));
  }
  return manifestCache;
}

async function getFabricLoaders(mcVersion) {
  const list = await net.getJson(`${FABRIC_META}/versions/loader/${encodeURIComponent(mcVersion)}`);
  return list.map(e => ({ version: e.loader.version, stable: e.loader.stable }));
}

async function getFabricGameVersions() {
  const list = await net.getJson(`${FABRIC_META}/versions/game`);
  return new Set(list.map(v => v.version));
}

/** Evaluates Mojang's "rules" arrays. features: {is_demo_user, has_custom_resolution, ...} */
function rulesAllow(rules, features = {}) {
  if (!rules || !rules.length) return true;
  let allowed = false;
  for (const rule of rules) {
    let match = true;
    if (rule.os) {
      if (rule.os.name && rule.os.name !== OS_NAME) match = false;
      if (rule.os.arch && rule.os.arch !== (process.arch === 'ia32' ? 'x86' : process.arch)) match = false;
      if (rule.os.version && !new RegExp(rule.os.version).test(os.release())) match = false;
    }
    if (rule.features) {
      for (const [k, v] of Object.entries(rule.features)) if (!!features[k] !== v) match = false;
    }
    if (match) allowed = rule.action === 'allow';
  }
  return allowed;
}

/** "group:artifact:version[:classifier]" → relative maven path */
function mavenPath(name) {
  const [coords, ext = 'jar'] = name.split('@');
  const parts = coords.split(':');
  const [group, artifact, version, classifier] = parts;
  const file = `${artifact}-${version}${classifier ? '-' + classifier : ''}.${ext}`;
  return path.join(...group.split('.'), artifact, version, file);
}

function versionDir(id) { return path.join(paths.versions, id); }
function versionJsonPath(id) { return path.join(versionDir(id), `${id}.json`); }

async function readVersionJson(id) {
  return JSON.parse(await fsp.readFile(versionJsonPath(id), 'utf8'));
}

/** Downloads (if needed) and returns the raw vanilla version json. */
async function fetchVanillaJson(id) {
  const file = versionJsonPath(id);
  const manifest = await getManifest().catch(() => null);
  const entry = manifest && manifest.versions.find(v => v.id === id);
  if (entry) {
    await net.download(entry.url, file, { sha1: entry.sha1 });
  } else if (!(await net.exists(file))) {
    throw new Error(`Nieznana wersja Minecraft: ${id}`);
  }
  return readVersionJson(id);
}

/** Installs Fabric's profile json; returns its id. */
async function fetchFabricJson(mcVersion, loaderVersion) {
  const id = `fabric-loader-${loaderVersion}-${mcVersion}`;
  const file = versionJsonPath(id);
  if (!(await net.exists(file))) {
    const json = await net.getJson(`${FABRIC_META}/versions/loader/${encodeURIComponent(mcVersion)}/${encodeURIComponent(loaderVersion)}/profile/json`);
    await fsp.mkdir(path.dirname(file), { recursive: true });
    await fsp.writeFile(file, JSON.stringify(json, null, 2));
  }
  return id;
}

/** Merges a child version (e.g. Fabric) with the version it inherits from. */
async function resolveVersion(id) {
  const json = await readVersionJson(id);
  if (!json.inheritsFrom) return json;
  const parent = await resolveVersion(json.inheritsFrom);
  const merged = { ...parent, ...json };
  merged.libraries = [...(json.libraries || []), ...(parent.libraries || [])];
  merged.mainClass = json.mainClass || parent.mainClass;
  if (parent.arguments || json.arguments) {
    merged.arguments = {
      game: [...((parent.arguments && parent.arguments.game) || []), ...((json.arguments && json.arguments.game) || [])],
      jvm: [...((parent.arguments && parent.arguments.jvm) || []), ...((json.arguments && json.arguments.jvm) || [])],
    };
  }
  merged.jar = parent.jar || parent.id;
  merged.assetIndex = parent.assetIndex;
  merged.assets = parent.assets;
  merged.downloads = parent.downloads;
  merged.javaVersion = json.javaVersion || parent.javaVersion;
  merged.logging = parent.logging;
  delete merged.inheritsFrom;
  return merged;
}

/** Collects libraries to download + classpath entries + native jars to extract. */
function collectLibraries(version) {
  const downloads = [], classpath = [], natives = [];
  const seen = new Map(); // group:artifact(:classifier) → keep the first (child wins)
  for (const lib of version.libraries || []) {
    if (!rulesAllow(lib.rules)) continue;
    const parts = lib.name.split(':');
    const key = parts.length > 3 ? `${parts[0]}:${parts[1]}:${parts[3]}` : `${parts[0]}:${parts[1]}`;
    if (seen.has(key)) continue;
    seen.set(key, true);

    const art = lib.downloads && lib.downloads.artifact;
    if (art) {
      const dest = path.join(paths.libraries, art.path || mavenPath(lib.name));
      if (art.url) downloads.push({ url: art.url, dest, sha1: art.sha1, size: art.size, name: path.basename(dest) });
      classpath.push(dest);
    } else if (!lib.natives) {
      // Fabric style: maven repo url + coordinates
      const rel = mavenPath(lib.name);
      const base = (lib.url || 'https://libraries.minecraft.net/').replace(/\/?$/, '/');
      const dest = path.join(paths.libraries, rel);
      downloads.push({ url: base + rel.split(path.sep).join('/'), dest, sha1: lib.sha1, size: lib.size, name: path.basename(dest) });
      classpath.push(dest);
    }
    // legacy natives (pre 1.19)
    if (lib.natives && lib.natives[OS_NAME]) {
      const classifier = lib.natives[OS_NAME].replace('${arch}', process.arch === 'ia32' ? '32' : '64');
      const nat = lib.downloads && lib.downloads.classifiers && lib.downloads.classifiers[classifier];
      if (nat) {
        const dest = path.join(paths.libraries, nat.path);
        downloads.push({ url: nat.url, dest, sha1: nat.sha1, size: nat.size, name: path.basename(dest) });
        natives.push({ file: dest, exclude: (lib.extract && lib.extract.exclude) || [] });
      }
    }
    // modern natives are separate libraries with a "natives-<os>" classifier
    if (parts[3] && parts[3].startsWith('natives-') && art) {
      natives.push({ file: path.join(paths.libraries, art.path), exclude: ['META-INF/'] });
    }
  }
  return { downloads, classpath, natives };
}

async function extractNatives(natives, dir) {
  await fsp.rm(dir, { recursive: true, force: true });
  await fsp.mkdir(dir, { recursive: true });
  for (const n of natives) {
    try {
      const zip = new AdmZip(n.file);
      for (const entry of zip.getEntries()) {
        if (entry.isDirectory) continue;
        if (n.exclude.some(e => entry.entryName.startsWith(e))) continue;
        if (!/\.(dll|so|dylib|jnilib)$/i.test(entry.entryName)) continue;
        fs.writeFileSync(path.join(dir, path.basename(entry.entryName)), entry.getData());
      }
    } catch (e) {
      // a broken native jar is re-downloaded on the next install pass
    }
  }
}

async function assetTasks(version) {
  const idx = version.assetIndex;
  const indexFile = path.join(paths.assets, 'indexes', `${idx.id}.json`);
  await net.download(idx.url, indexFile, { sha1: idx.sha1 });
  const index = JSON.parse(await fsp.readFile(indexFile, 'utf8'));
  const tasks = [];
  for (const [name, obj] of Object.entries(index.objects)) {
    const sub = obj.hash.substring(0, 2);
    const dest = index.map_to_resources
      ? path.join(paths.assets, 'virtual', 'legacy', name)
      : path.join(paths.assets, 'objects', sub, obj.hash);
    tasks.push({ url: `${RESOURCES}/${sub}/${obj.hash}`, dest, sha1: obj.hash, size: obj.size, name });
  }
  return tasks;
}

/**
 * Installs everything needed to launch an instance's version.
 * Returns the resolved version json + version id that should be launched.
 */
async function installVersion({ mcVersion, loader, loaderVersion }, { progress, concurrency } = {}) {
  const step = (stage, extra = {}) => progress && progress({ stage, ...extra });
  step('Pobieranie informacji o wersji');
  await fetchVanillaJson(mcVersion);
  let launchId = mcVersion;
  if (loader === 'fabric') {
    if (!loaderVersion) {
      const loaders = await getFabricLoaders(mcVersion);
      const stable = loaders.find(l => l.stable) || loaders[0];
      if (!stable) throw new Error(`Fabric nie wspiera wersji ${mcVersion}`);
      loaderVersion = stable.version;
    }
    step('Instalowanie Fabric ' + loaderVersion);
    launchId = await fetchFabricJson(mcVersion, loaderVersion);
  }
  const version = await resolveVersion(launchId);

  const tasks = [];
  const client = version.downloads && version.downloads.client;
  const jarPath = path.join(versionDir(mcVersion), `${mcVersion}.jar`);
  if (client) tasks.push({ url: client.url, dest: jarPath, sha1: client.sha1, size: client.size, name: `${mcVersion}.jar` });
  const libs = collectLibraries(version);
  tasks.push(...libs.downloads);
  if (version.logging && version.logging.client) {
    const f = version.logging.client.file;
    tasks.push({ url: f.url, dest: path.join(paths.assets, 'log_configs', f.id), sha1: f.sha1, size: f.size, name: f.id });
  }
  step('Pobieranie indeksu zasobów');
  tasks.push(...await assetTasks(version));

  let last = 0;
  await net.downloadAll(tasks, {
    concurrency,
    progress: (p) => {
      const now = Date.now();
      if (now - last < 100 && p.done !== p.total) return;
      last = now;
      step('Pobieranie plików gry', p);
    },
  });
  return { version, launchId, jarPath, libs, loaderVersion };
}

module.exports = {
  getManifest, getFabricLoaders, getFabricGameVersions, installVersion, resolveVersion, rulesAllow,
  extractNatives, mavenPath, versionDir, OS_NAME, ARCH,
};
