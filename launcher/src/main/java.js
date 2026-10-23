'use strict';
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { execFile } = require('child_process');
const paths = require('./paths');
const net = require('./net');

const ALL = 'https://launchermeta.mojang.com/v1/products/java-runtime/2ec0cc96c44e5a76b9c8b7c39df7210883d12871/all.json';

function platformKey() {
  if (process.platform === 'win32') return process.arch === 'arm64' ? 'windows-arm64' : process.arch === 'ia32' ? 'windows-x86' : 'windows-x64';
  if (process.platform === 'darwin') return process.arch === 'arm64' ? 'mac-os-arm64' : 'mac-os';
  return process.arch === 'ia32' ? 'linux-i386' : 'linux';
}

function javaExecutable(home) {
  if (process.platform === 'win32') return path.join(home, 'bin', 'javaw.exe');
  if (process.platform === 'darwin') return path.join(home, 'jre.bundle', 'Contents', 'Home', 'bin', 'java');
  return path.join(home, 'bin', 'java');
}

/** Ensures Mojang's bundled Java runtime for the component (e.g. java-runtime-delta) and returns the java binary. */
async function ensureRuntime(component, { progress } = {}) {
  component = component || 'java-runtime-delta';
  const home = path.join(paths.runtime, component, platformKey());
  const exe = javaExecutable(home);
  const marker = path.join(home, '.installed');
  if (await net.exists(marker) && await net.exists(exe)) return exe;

  progress && progress({ stage: 'Pobieranie Javy (' + component + ')' });
  const all = await net.getJson(ALL);
  const entries = (all[platformKey()] || {})[component];
  if (!entries || !entries.length) throw new Error(`Brak Javy ${component} dla tej platformy – ustaw własną ścieżkę Javy w ustawieniach.`);
  const manifest = await net.getJson(entries[0].manifest.url);
  const tasks = [];
  const execs = [];
  const links = [];
  for (const [rel, info] of Object.entries(manifest.files)) {
    const dest = path.join(home, rel);
    if (info.type === 'directory') await fsp.mkdir(dest, { recursive: true });
    else if (info.type === 'file') {
      const raw = info.downloads.raw;
      tasks.push({ url: raw.url, dest, sha1: raw.sha1, size: raw.size, name: path.basename(rel) });
      if (info.executable) execs.push(dest);
    } else if (info.type === 'link') links.push({ dest, target: info.target });
  }
  let last = 0;
  await net.downloadAll(tasks, {
    concurrency: 16,
    progress: (p) => {
      if (Date.now() - last < 100 && p.done !== p.total) return;
      last = Date.now();
      progress && progress({ stage: 'Pobieranie Javy', ...p });
    },
  });
  if (process.platform !== 'win32') {
    for (const f of execs) await fsp.chmod(f, 0o755).catch(() => {});
    for (const l of links) {
      await fsp.rm(l.dest, { force: true }).catch(() => {});
      await fsp.symlink(l.target, l.dest).catch(() => {});
    }
  }
  await fsp.writeFile(marker, new Date().toISOString());
  return exe;
}

/** Returns the major version of a java binary, or null. */
function probeJava(bin) {
  return new Promise((resolve) => {
    execFile(bin, ['-version'], { timeout: 8000 }, (err, stdout, stderr) => {
      if (err) return resolve(null);
      const m = /version "(\d+)(?:\.(\d+))?/.exec(stderr || stdout);
      if (!m) return resolve(null);
      resolve(m[1] === '1' ? parseInt(m[2], 10) : parseInt(m[1], 10));
    });
  });
}

module.exports = { ensureRuntime, probeJava, platformKey };
