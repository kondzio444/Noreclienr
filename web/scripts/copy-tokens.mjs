// Build step (wrangler.jsonc "build", also `npm run build:tokens`): copies the generated design tokens
// (design/tokens.css, written by `node design/build-tokens.mjs`) into the website as
// public/assets/tokens.css. /assets/ is shared by noroclient.pl, noreclient.pl and mc.noreclient.pl.
// Two token lines are legitimate exceptions to the taste-skill lint (the holographic foil of seasonal
// cosmetics and the code font) and get a taste-skill-ignore marker. Without ../design the committed copy is kept.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.resolve(WEB, '../design/tokens.css');
const dst = path.join(WEB, 'public/assets/tokens.css');

if (!fs.existsSync(src)) {
  console.log('copy-tokens: design/tokens.css not found – keeping public/assets/tokens.css');
  process.exit(0);
}
const text = fs.readFileSync(src, 'utf8')
  .split('\n')
  .map(l => (/gradient\(|monospace/.test(l) && !l.includes('taste-skill-ignore') ? `${l} /* taste-skill-ignore */` : l))
  .join('\n');
const out = `/* Copied from design/tokens.css by web/scripts/copy-tokens.mjs – edit design/tokens.json instead. */\n${text}`;
if (fs.existsSync(dst) && fs.readFileSync(dst, 'utf8') === out) console.log('copy-tokens: public/assets/tokens.css is up to date');
else { fs.writeFileSync(dst, out); console.log('copy-tokens: public/assets/tokens.css updated'); }
