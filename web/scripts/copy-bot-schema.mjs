// Build step (wrangler.jsonc "build", also `npm run build:schema`): copies the Nore Bot configuration
// schema and the panel translations from discord-bot/ into the website, when the bot is in the repository.
//   ../discord-bot/config.schema.json  → src/bot-schema.json      (bundled, validates panel writes)
//   ../discord-bot/locales/<lang>.json → public/panel/locales/    (labels for the panel forms)
// Without discord-bot/ the committed src/bot-schema.json (a placeholder or the last copy) is kept.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BOT = path.resolve(WEB, '../discord-bot');
const schemaSrc = path.join(BOT, 'config.schema.json');
const schemaDst = path.join(WEB, 'src/bot-schema.json');

function writeIfChanged(file, text) {
  if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') === text) return false;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  return true;
}

if (fs.existsSync(schemaSrc)) {
  const text = fs.readFileSync(schemaSrc, 'utf8');
  let schema;
  try { schema = JSON.parse(text); } catch (e) {
    console.error(`copy-bot-schema: ${schemaSrc} is not valid JSON (${e.message})`);
    process.exit(1);
  }
  if (!schema || schema.type !== 'object' || typeof schema.properties !== 'object') {
    console.error('copy-bot-schema: the bot schema must be an object schema with properties');
    process.exit(1);
  }
  const changed = writeIfChanged(schemaDst, text.endsWith('\n') ? text : text + '\n');
  console.log(changed ? 'copy-bot-schema: src/bot-schema.json updated from discord-bot/' : 'copy-bot-schema: src/bot-schema.json is up to date');
} else {
  console.log('copy-bot-schema: discord-bot/config.schema.json not found – keeping src/bot-schema.json');
}

const locSrc = path.join(BOT, 'locales');
if (fs.existsSync(locSrc)) {
  let n = 0;
  for (const f of fs.readdirSync(locSrc).filter(f => /^[a-zA-Z-]{2,8}\.json$/.test(f))) {
    if (writeIfChanged(path.join(WEB, 'public/panel/locales', f), fs.readFileSync(path.join(locSrc, f), 'utf8'))) n++;
  }
  console.log(`copy-bot-schema: ${n} panel locale file(s) updated`);
}
