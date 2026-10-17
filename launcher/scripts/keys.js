'use strict';
/*
 * Bakes the service keys into the build so players never have to paste anything, without the keys
 * ever being in git (the repository is public):
 *   CURSEFORGE_API_KEY   – CurseForge API key
 *   MICROSOFT_CLIENT_ID  – Azure application (client) ID for the Microsoft / Minecraft premium login
 * They come from environment variables (GitHub Actions secrets in CI) or the git-ignored file
 * launcher/keys.local.json ({ "curseforge": "...", "microsoft": "..." }) and are written masked
 * into src/main/keys.bin (also git-ignored).
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.join(__dirname, '..');
const out = path.join(root, 'src', 'main', 'keys.bin');
let local = {};
try { local = JSON.parse(fs.readFileSync(path.join(root, 'keys.local.json'), 'utf8')); } catch { /* none */ }
const keys = {
  curseforge: (process.env.CURSEFORGE_API_KEY || local.curseforge || '').trim(),
  microsoft: (process.env.MICROSOFT_CLIENT_ID || local.microsoft || '').trim(),
};

const json = JSON.stringify(keys);
const mask = crypto.randomBytes(Buffer.byteLength(json));
const data = Buffer.from(json).map((b, i) => b ^ mask[i]);
fs.writeFileSync(out, `${mask.toString('base64')}.${Buffer.from(data).toString('base64')}`);
for (const [k, v] of Object.entries(keys)) console.log(`[keys] ${k}: ${v ? 'embedded' : 'MISSING'}`);
