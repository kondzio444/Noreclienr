'use strict';
/*
 * Bakes the CurseForge API key into the build without it ever being in git: the key comes from the
 * CURSEFORGE_API_KEY environment variable (a GitHub Actions secret in CI) or the git-ignored file
 * launcher/cf-key.local, and is written masked into src/main/cf-key.bin (also git-ignored).
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.join(__dirname, '..');
const out = path.join(root, 'src', 'main', 'cf-key.bin');
let key = (process.env.CURSEFORGE_API_KEY || '').trim();
if (!key) { try { key = fs.readFileSync(path.join(root, 'cf-key.local'), 'utf8').trim(); } catch { /* none */ } }

if (!key) {
  console.log('[cf-key] no CURSEFORGE_API_KEY – the build will ask users for their own key');
  fs.rmSync(out, { force: true });
} else {
  const mask = crypto.randomBytes(Buffer.byteLength(key));
  const data = Buffer.from(key).map((b, i) => b ^ mask[i]);
  fs.writeFileSync(out, `${mask.toString('base64')}.${Buffer.from(data).toString('base64')}`);
  console.log('[cf-key] CurseForge key embedded');
}
