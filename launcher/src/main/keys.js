'use strict';
/** Service keys baked into the build by scripts/keys.js (never stored in git). */
const fs = require('fs');
const path = require('path');

let cached = null;
function all() {
  if (cached) return cached;
  cached = {};
  try {
    const [mask, data] = fs.readFileSync(path.join(__dirname, 'keys.bin'), 'utf8').trim().split('.').map(x => Buffer.from(x, 'base64'));
    cached = JSON.parse(Buffer.from(data.map((b, i) => b ^ mask[i])).toString('utf8'));
  } catch { /* development build without keys */ }
  return cached;
}

module.exports = {
  curseforge: () => process.env.NORE_CF_KEY || all().curseforge || null,
  microsoftClientId: () => process.env.NORE_MS_CLIENT_ID || all().microsoft || null,
};
