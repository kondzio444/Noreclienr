'use strict';
// Copies every built Nore Client platform jar (dist/mods/noreclient-<platform>.jar) into
// launcher/resources/mods and writes index.json, which maps Minecraft versions to jars.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..', '..');
const built = path.join(root, 'dist', 'mods');
const out = path.join(__dirname, '..', 'resources', 'mods');
const platforms = JSON.parse(fs.readFileSync(path.join(root, 'platforms', 'platforms.json'), 'utf8'));

// Build the mod first when no platform jar exists yet (e.g. a fresh checkout).
if (!platforms.some(p => fs.existsSync(path.join(built, `noreclient-${p.name}.jar`)))) {
  console.log('Brak zbudowanego moda – buduję Nore Client (gradlew build)…');
  const win = process.platform === 'win32';
  const r = spawnSync(win ? 'gradlew.bat' : './gradlew', ['build'], { cwd: root, stdio: 'inherit', shell: win });
  if (r.status !== 0) {
    console.error('Budowanie moda nie powiodło się. Potrzebna jest Java 21 (JDK) – sprawdź "java -version".');
    process.exit(1);
  }
}

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
const index = [];
for (const p of platforms) {
  const file = `noreclient-${p.name}.jar`;
  const src = path.join(built, file);
  if (!fs.existsSync(src)) { console.warn('Brak', file, '– pomijam'); continue; }
  fs.copyFileSync(src, path.join(out, file));
  index.push({ ...p, file });
}
if (!index.length) {
  console.error('Brak zbudowanego moda – w głównym folderze projektu uruchom: .\\gradlew.bat build (Windows) lub ./gradlew build');
  process.exit(1);
}
fs.writeFileSync(path.join(out, 'index.json'), JSON.stringify(index, null, 2));
console.log('Nore Client:', index.map(p => `${p.name} (${p.versions.join(', ')})`).join('; '));
