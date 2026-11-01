'use strict';
// latest.json of the Tauri updater for one release (build.yml, job "release"):
//   node scripts/latest-json.js <version> <folder with the installers + .sig> <download base url> [notes file]
// Every signed installer of the release becomes a platform entry ({os}-{arch}[-{installer}], see
// tauri-plugin-updater). size / sha256 are extra fields (the updater ignores them; the Electron bridge
// and the website can read them). Exits with 2 when no installer is signed (no latest.json then).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/** The installer file names of a release and the updater targets each one serves. */
function targets(version) {
  return [
    { file: `NoreLauncher-Setup-${version}.exe`, keys: ['windows-x86_64', 'windows-x86_64-nsis'] },
    { file: `NoreLauncher-${version}.AppImage`, keys: ['linux-x86_64', 'linux-x86_64-appimage'] },
    { file: `NoreLauncher-${version}_amd64.deb`, keys: ['linux-x86_64-deb'] },
    // universal macOS build: one archive for both architectures
    { file: `NoreLauncher-${version}.app.tar.gz`, keys: ['darwin-x86_64', 'darwin-aarch64', 'darwin-x86_64-app', 'darwin-aarch64-app'] },
  ];
}

function build(version, dir, base, notes) {
  const platforms = {};
  const missing = [];
  for (const t of targets(version)) {
    const file = path.join(dir, t.file);
    if (!fs.existsSync(file)) continue;
    if (!fs.existsSync(file + '.sig')) { missing.push(t.file); continue; }
    const signature = fs.readFileSync(file + '.sig', 'utf8').trim();
    const data = fs.readFileSync(file);
    const entry = {
      signature,
      url: `${base.replace(/\/+$/, '')}/${encodeURIComponent(t.file)}`,
      size: data.length,
      sha256: crypto.createHash('sha256').update(data).digest('hex'),
    };
    for (const k of t.keys) platforms[k] = entry;
  }
  return {
    json: { version, notes: notes || `Nore Launcher ${version}`, pub_date: new Date().toISOString(), platforms },
    missing,
  };
}

if (require.main === module) {
  const [version, dir, base, notesFile] = process.argv.slice(2);
  if (!version || !dir || !base) {
    console.error('Użycie: node scripts/latest-json.js <wersja> <folder z instalatorami> <adres pobierania> [plik z opisem]');
    process.exit(1);
  }
  const notes = notesFile && fs.existsSync(notesFile) ? fs.readFileSync(notesFile, 'utf8').slice(0, 4000) : '';
  const { json, missing } = build(version, dir, base, notes);
  for (const f of missing) console.error(`::warning::${f} nie ma podpisu (.sig) – pominięty w latest.json`);
  if (!Object.keys(json.platforms).length) {
    console.error('Żaden instalator nie jest podpisany – latest.json nie powstanie.');
    process.exit(2);
  }
  process.stdout.write(JSON.stringify(json, null, 2) + '\n');
}

module.exports = { build, targets };
