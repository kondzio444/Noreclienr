'use strict';
// latest.json for the Tauri updater (scripts/latest-json.js): signed installers only, all updater targets.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { build } = require('./latest-json');

test('latest.json lists every signed installer under its updater targets', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nore-latest-'));
  try {
    const v = '1.4.1500';
    for (const f of [`NoreLauncher-Setup-${v}.exe`, `NoreLauncher-${v}.AppImage`, `NoreLauncher-${v}_amd64.deb`, `NoreLauncher-${v}.app.tar.gz`]) fs.writeFileSync(path.join(dir, f), f);
    for (const f of [`NoreLauncher-Setup-${v}.exe`, `NoreLauncher-${v}.app.tar.gz`, `NoreLauncher-${v}_amd64.deb`]) fs.writeFileSync(path.join(dir, f + '.sig'), `sig-${f}\n`);
    const { json, missing } = build(v, dir, 'https://github.com/kondzio444/Noreclienr/releases/download/v1.4.1500/', 'Zmiany');
    assert.equal(json.version, v);
    assert.equal(json.notes, 'Zmiany');
    assert.deepEqual(Object.keys(json.platforms).sort(), ['darwin-aarch64', 'darwin-aarch64-app', 'darwin-x86_64', 'darwin-x86_64-app', 'linux-x86_64-deb', 'windows-x86_64', 'windows-x86_64-nsis']);
    assert.equal(json.platforms['windows-x86_64'].url, `https://github.com/kondzio444/Noreclienr/releases/download/v1.4.1500/NoreLauncher-Setup-${v}.exe`);
    assert.equal(json.platforms['windows-x86_64'].signature, `sig-NoreLauncher-Setup-${v}.exe`);
    assert.equal(json.platforms['linux-x86_64-deb'].size, `NoreLauncher-${v}_amd64.deb`.length);
    assert.match(json.platforms['darwin-aarch64'].sha256, /^[0-9a-f]{64}$/);
    assert.deepEqual(missing, [`NoreLauncher-${v}.AppImage`]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
