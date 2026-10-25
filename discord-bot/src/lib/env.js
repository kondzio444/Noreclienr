/**
 * Loads discord-bot/.env with Node's built-in loader (no dotenv dependency) and exposes a typed view.
 * Values already present in the environment win over the file.
 */
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

let loaded = false;
export function loadEnv() {
  if (loaded) return;
  loaded = true;
  const file = path.join(ROOT, '.env');
  if (existsSync(file)) {
    try { process.loadEnvFile(file); } catch { /* malformed file: rely on the real environment */ }
  }
}

export function env() {
  loadEnv();
  const e = process.env;
  const str = (k, d = '') => (e[k] ?? d).trim();
  return {
    token: str('DISCORD_TOKEN'),
    clientId: str('DISCORD_CLIENT_ID'),
    noreApi: str('NORE_API', 'https://noroclient.pl').replace(/\/+$/, ''),
    botSecret: str('NORE_BOT_SECRET'),
    deployGuildId: str('DEPLOY_GUILD_ID'),
    shards: str('SHARDS', 'auto'),
    dataDir: path.resolve(ROOT, str('DATA_DIR', './data')),
    twitchClientId: str('TWITCH_CLIENT_ID'),
    twitchClientSecret: str('TWITCH_CLIENT_SECRET'),
    githubToken: str('GITHUB_TOKEN'),
    rssBridgeUrl: str('RSS_BRIDGE_URL').replace(/\/+$/, ''),
  };
}
