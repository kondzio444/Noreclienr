'use strict';
// Bundles the Nore Client jars with the Tauri build like the Electron one (launcher/scripts/copy-mod.js
// → launcher/resources/mods, which tauri.conf.json ships as <resources>/nore/mods).
//   node scripts/prepare-mods.js            – copies the built jars (dist/mods); without them a
//                                             debug build gets an empty list
//   node scripts/prepare-mods.js --require  – release builds: builds the mod when needed, fails without it
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const launcher = path.join(__dirname, '..', '..', 'launcher');
const out = path.join(launcher, 'resources', 'mods');
const require_ = process.argv.includes('--require');

const built = path.join(launcher, '..', 'dist', 'mods');
const hasJars = fs.existsSync(built) && fs.readdirSync(built).some(f => /^noreclient-.*\.jar$/.test(f));
// without built jars a development build does not start a Gradle build
const r = !hasJars && !require_ ? { status: 1 } : spawnSync(process.execPath, [path.join(launcher, 'scripts', 'copy-mod.js')], { stdio: 'inherit' });
if (r.status !== 0) {
  if (require_) {
    console.error('Nie udało się przygotować Nore Client – build wydania wymaga zbudowanego moda (./gradlew build).');
    process.exit(1);
  }
  // development builds start without Nore Client jars (the launcher logs "Brak Nore Client …")
  fs.mkdirSync(out, { recursive: true });
  if (!fs.existsSync(path.join(out, 'index.json'))) fs.writeFileSync(path.join(out, 'index.json'), '[]\n');
  console.warn('Nore Client nie został dołączony (build deweloperski).');
}
