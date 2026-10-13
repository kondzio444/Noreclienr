'use strict';
// Copies the built Nore Client mod jar into launcher/resources so it ships with the installer.
const fs = require('fs');
const path = require('path');

const libs = path.join(__dirname, '..', '..', 'build', 'libs');
const out = path.join(__dirname, '..', 'resources');
const jars = fs.existsSync(libs) ? fs.readdirSync(libs).filter(f => /^noreclient-.*\.jar$/.test(f) && !f.includes('sources')) : [];
if (!jars.length) {
  console.error('Brak zbudowanego moda – uruchom najpierw "./gradlew build" w katalogu głównym.');
  process.exit(1);
}
jars.sort();
fs.mkdirSync(out, { recursive: true });
fs.copyFileSync(path.join(libs, jars[jars.length - 1]), path.join(out, 'noreclient.jar'));
console.log('Skopiowano', jars[jars.length - 1], '-> resources/noreclient.jar');
