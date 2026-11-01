'use strict';
// The one-time move to the Rust launcher (src/main/migrate.js): picking the Tauri installer, minisign
// signatures (vector made with `tauri signer sign` and a throwaway key), checks before installing.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const m = require('../src/main/migrate');

// throwaway key pair (only the public half is here) and a signature of FILE made by `tauri signer sign`
const TEST_PUB = 'dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IDkwMTEzMjlBM0Q1MkE0ODQKUldTRXBGSTltaklSa0tzcERWOEtsNFNEN2tEQjZTcHQwZWxTck94N0pIaGpQRnhHeHpzUGtpS2gK';
const TEST_SIG = 'dW50cnVzdGVkIGNvbW1lbnQ6IHNpZ25hdHVyZSBmcm9tIHRhdXJpIHNlY3JldCBrZXkKUlVTRXBGSTltaklSa0I5QTFzUktkZTQ5bG54TEo4TEY4d2xYTDAra3JDeUVobDh6UHFNZjJJbk5ZUXlQbWorcDhMWjQ0VThMeS9ZVWN3QXZycXlKdlkrc0NOY3p1V3MyZWdVPQp0cnVzdGVkIGNvbW1lbnQ6IHRpbWVzdGFtcDoxNzkzNTI2Nzc3CWZpbGU6ZmlsZS5iaW4KQys2WTc3ZVVVMWc2eS9SbysxNDlJQnk0SEdsQUt1eUxnVVJ3NkNtUzZaeER0dXZLNUdBWGNRVG9mMjdoaEdSdnBqd095RC82d1ZBVjViZ3R1cytrQVE9PQo=';
const FILE = Buffer.from('Nore test installer\n');
const blake = (b) => crypto.createHash('blake2b512').update(b).digest();

test('Tauri installer names – never the Electron bridge build', () => {
  assert.ok(m.isTauriInstaller('NoreLauncher-Setup-1.4.1500.exe', 'win'));
  assert.ok(!m.isTauriInstaller('NoreLauncher-Bridge-Setup-1.4.1500.exe', 'win'));
  assert.ok(!m.isTauriInstaller('NoreLauncher-Setup-1.4.1500.exe.blockmap', 'win'));
  assert.ok(m.isTauriInstaller('NoreLauncher-1.4.1500.AppImage', 'linux'));
  assert.ok(!m.isTauriInstaller('NoreLauncher-Bridge-1.4.1500.AppImage', 'linux'));
  assert.ok(m.isTauriInstaller('NoreLauncher-1.4.1500.dmg', 'mac'));
  assert.ok(!m.isTauriInstaller('NoreLauncher-1.4.1500.dmg', 'win'));
  assert.equal(m.platformId('win32'), 'win');
  assert.equal(m.platformId('darwin'), 'mac');
  assert.equal(m.platformId('linux'), 'linux');
});

test('installer from the Nore API (/api/v2/downloads) and from the GitHub release', () => {
  const url = 'https://github.com/kondzio444/Noreclienr/releases/download/v1.4.1500/NoreLauncher-Setup-1.4.1500.exe';
  const d = { version: '1.4.1500', platforms: [{ id: 'win', available: true, file: 'NoreLauncher-Setup-1.4.1500.exe', size: 12, digest: 'sha256:' + 'ab'.repeat(32), url }] };
  assert.deepEqual(m.pickFromDownloads(d, 'win'), { version: '1.4.1500', name: 'NoreLauncher-Setup-1.4.1500.exe', size: 12, sha256: 'ab'.repeat(32), url, sigUrl: url + '.sig' });
  assert.equal(m.pickFromDownloads(d, 'linux'), null);
  // an Electron-only release or a foreign link is not used
  assert.equal(m.pickFromDownloads({ version: '1', platforms: [{ id: 'win', available: true, file: 'NoreLauncher-Bridge-Setup-1.4.1.exe', url }] }, 'win'), null);
  assert.equal(m.pickFromDownloads({ version: '1', platforms: [{ ...d.platforms[0], url: 'https://evil.example/NoreLauncher-Setup-1.4.1500.exe' }] }, 'win'), null);
  // private releases: Worker links
  const priv = 'https://noreclient.pl/api/v2/files/v1.4.1500/NoreLauncher-1.4.1500.AppImage';
  assert.equal(m.pickFromDownloads({ version: '1.4.1500', platforms: [{ id: 'linux', available: true, file: 'NoreLauncher-1.4.1500.AppImage', size: 5, digest: null, url: priv }] }, 'linux').sigUrl, priv + '.sig');

  const gh = (name) => ({ name, size: 7, digest: 'sha256:' + 'cd'.repeat(32), browser_download_url: `https://github.com/kondzio444/Noreclienr/releases/download/v1.4.1500/${name}` });
  const rel = { tag_name: 'v1.4.1500', assets: [gh('NoreLauncher-Bridge-1.4.1500.dmg'), gh('NoreLauncher-1.4.1500.dmg'), gh('NoreLauncher-1.4.1500.dmg.sig')] };
  const a = m.pickFromGithub(rel, 'mac');
  assert.equal(a.name, 'NoreLauncher-1.4.1500.dmg');
  assert.equal(a.version, '1.4.1500');
  assert.equal(a.sha256, 'cd'.repeat(32));
  assert.match(a.sigUrl, /NoreLauncher-1\.4\.1500\.dmg\.sig$/);
  assert.equal(m.pickFromGithub({ tag_name: 'v1', assets: [gh('NoreLauncher-Bridge-1.4.1500.dmg')] }, 'mac'), null);
});

test('minisign signature of the Tauri signer (prehashed, with trusted comment)', () => {
  assert.equal(m.verifyMinisign({ sig: TEST_SIG, pubkey: TEST_PUB, blake2b: blake(FILE) }), true);
  // another file, another key, a broken signature
  assert.equal(m.verifyMinisign({ sig: TEST_SIG, pubkey: TEST_PUB, blake2b: blake(Buffer.from('Nore test installer!\n')) }), false);
  assert.equal(m.verifyMinisign({ sig: TEST_SIG, pubkey: m.UPDATER_PUBKEY, blake2b: blake(FILE) }), false);
  const text = Buffer.from(TEST_SIG, 'base64').toString('utf8').replace('file:file.bin', 'file:evil.bin');
  assert.equal(m.verifyMinisign({ sig: Buffer.from(text).toString('base64'), pubkey: TEST_PUB, blake2b: blake(FILE) }), false);
  assert.equal(m.verifyMinisign({ sig: 'garbage', pubkey: TEST_PUB, blake2b: blake(FILE) }), false);
  // the committed updater key parses (minisign key id D2FD2480DABA1D85)
  assert.equal(m.parsePublicKey(m.UPDATER_PUBKEY).keyId.length, 8);
});

test('verifyInstaller: size, SHA-256, signature – every mismatch is refused', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nore-migrate-'));
  const file = path.join(dir, 'file.bin');
  fs.writeFileSync(file, FILE);
  const sha = crypto.createHash('sha256').update(FILE).digest('hex');
  try {
    await m.verifyInstaller(file, { size: FILE.length, sha256: sha }, TEST_SIG, TEST_PUB);
    await m.verifyInstaller(file, { size: FILE.length, sha256: sha }, null, TEST_PUB); // unsigned release: size + SHA-256
    await assert.rejects(m.verifyInstaller(file, { size: FILE.length + 1, sha256: sha }, TEST_SIG, TEST_PUB), /rozmiar/);
    await assert.rejects(m.verifyInstaller(file, { size: FILE.length, sha256: '0'.repeat(64) }, TEST_SIG, TEST_PUB), /SHA-256/);
    await assert.rejects(m.verifyInstaller(file, { size: FILE.length, sha256: sha }, TEST_SIG, m.UPDATER_PUBKEY), /Podpis/);
    await assert.rejects(m.verifyInstaller(file, { size: FILE.length, sha256: null }, null, TEST_PUB), /nie instaluję/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('decide: postponed start, switched off, too many installs; app bundle path', () => {
  assert.equal(m.decide({}, {}), 'run');
  assert.equal(m.decide({ postponed: true }, {}), 'run');
  assert.equal(m.decide({ skipNext: true }, {}), 'skip');
  assert.equal(m.decide({}, { NORE_NO_MIGRATE: '1' }), 'skip');
  assert.equal(m.decide({ installs: m.MAX_INSTALLS }, {}), 'skip');
  assert.equal(m.appBundle('/Applications/Nore Launcher.app/Contents/MacOS/Nore Launcher'), '/Applications/Nore Launcher.app');
  assert.equal(m.appBundle('/usr/bin/nore'), null);
});
