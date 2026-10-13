'use strict';
// Copies every built Nore Client platform jar (dist/mods/noreclient-<platform>.jar) into
// launcher/resources/mods and writes index.json, which maps Minecraft versions to jars.
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', '..');
const built = path.join(root, 'dist', 'mods');
const out = path.join(__dirname, '..', 'resources', 'mods');
const platforms = JSON.parse(fs.readFileSync(path.join(root, 'platforms', 'platforms.json'), 'utf8'));

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
  console.error('Brak zbudowanego moda – uruchom najpierw "./gradlew build" w katalogu głównym repozytorium.');
  process.exit(1);
}
fs.writeFileSync(path.join(out, 'index.json'), JSON.stringify(index, null, 2));
console.log('Nore Client:', index.map(p => `${p.name} (${p.versions.join(', ')})`).join('; '));
