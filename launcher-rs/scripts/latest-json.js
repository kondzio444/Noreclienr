'use strict';
// latest.json of the Tauri updater: node scripts/latest-json.js <version> <installer.sig> <installer url>
const fs = require('fs');

const [version, sigFile, url] = process.argv.slice(2);
if (!version || !sigFile || !url) {
  console.error('Użycie: node scripts/latest-json.js <wersja> <plik .sig> <adres instalatora>');
  process.exit(1);
}
const signature = fs.readFileSync(sigFile, 'utf8').trim();
process.stdout.write(JSON.stringify({
  version,
  notes: `Nore Launcher ${version}`,
  pub_date: new Date().toISOString(),
  platforms: { 'windows-x86_64': { signature, url } },
}, null, 2) + '\n');
