'use strict';
/*
 * Copies the generated Album tokens (design/tokens.css, written by design/build-tokens.mjs) into the
 * renderer, which is packaged on its own and cannot reach ../design at runtime.
 *   node scripts/sync-tokens.js          writes src/renderer/tokens.css
 *   node scripts/sync-tokens.js --check  exits 1 when the copy is stale
 * Outside the monorepo (no design/ folder) it does nothing.
 */
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', '..', 'design', 'tokens.css');
const DST = path.join(__dirname, '..', 'src', 'renderer', 'tokens.css');
const HEAD = '/* Copied from design/tokens.css by launcher/scripts/sync-tokens.js. Do not edit: change design/tokens.json. */\n';

function expected() {
  return HEAD + fs.readFileSync(SRC, 'utf8');
}

function main() {
  if (!fs.existsSync(SRC)) { console.log('sync-tokens: design/tokens.css not found, skipping'); return; }
  const want = expected();
  const have = fs.existsSync(DST) ? fs.readFileSync(DST, 'utf8') : '';
  if (process.argv.includes('--check')) {
    if (want !== have) { console.error('sync-tokens: src/renderer/tokens.css is stale – run node scripts/sync-tokens.js'); process.exit(1); }
    console.log('sync-tokens: up to date');
    return;
  }
  if (want !== have) fs.writeFileSync(DST, want);
  console.log('sync-tokens: wrote ' + path.relative(process.cwd(), DST));
}

if (require.main === module) main();
module.exports = { SRC, DST, expected };
