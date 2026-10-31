'use strict';
// electron-builder unpacks its Windows tools (rcedit, signtool) from winCodeSign-2.6.0.7z, which
// also contains macOS symlinks. Creating symlinks on Windows needs admin rights or Developer
// Mode, so on a normal account the build fails with "Cannot create symbolic link". This script
// pre-extracts the archive into electron-builder's cache without the macOS part, after which
// electron-builder finds it and skips its own extraction. No-op on other systems.
const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const { spawnSync } = require('child_process');

if (process.platform !== 'win32') process.exit(0);

const URL = 'https://github.com/electron-userland/electron-builder-binaries/releases/download/winCodeSign-2.6.0/winCodeSign-2.6.0.7z';
const cache = process.env.ELECTRON_BUILDER_CACHE || path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'electron-builder', 'Cache');
const target = path.join(cache, 'winCodeSign', 'winCodeSign-2.6.0');

if (fs.existsSync(path.join(target, 'rcedit-x64.exe'))) process.exit(0);

function download(url, file, redirects = 5) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'nore-launcher-build' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects > 0) {
        res.resume();
        return resolve(download(res.headers.location, file, redirects - 1));
      }
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      const out = fs.createWriteStream(file);
      res.pipe(out);
      out.on('finish', () => out.close(resolve));
      out.on('error', reject);
    }).on('error', reject);
  });
}

(async () => {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const archive = path.join(os.tmpdir(), `winCodeSign-2.6.0-${process.pid}.7z`);
  const tmp = `${target}.tmp-${process.pid}`;
  console.log('Przygotowywanie narzędzi Windows dla electron-builder (winCodeSign 2.6.0)…');
  await download(URL, archive);
  const r = spawnSync(require('7zip-bin').path7za, ['x', '-bd', '-y', '-xr!darwin', archive, `-o${tmp}`], { stdio: 'inherit' });
  fs.rmSync(archive, { force: true });
  if (r.status !== 0 || !fs.existsSync(path.join(tmp, 'rcedit-x64.exe'))) {
    fs.rmSync(tmp, { recursive: true, force: true });
    throw new Error('Nie udało się rozpakować winCodeSign (7za status ' + r.status + ')');
  }
  fs.rmSync(target, { recursive: true, force: true });
  fs.renameSync(tmp, target);
  console.log('Gotowe:', target);
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
