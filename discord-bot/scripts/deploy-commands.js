#!/usr/bin/env node
/**
 * Registers the slash commands (npm run deploy-commands).
 *   DEPLOY_GUILD_ID set  → per-guild (instant, for testing)
 *   otherwise            → global (can take up to an hour to show everywhere)
 *   --clear              → removes the commands (global, or of DEPLOY_GUILD_ID)
 *   --guild <id>         → overrides DEPLOY_GUILD_ID
 */
import { REST, Routes } from 'discord.js';
import { env as readEnv } from '../src/lib/env.js';
import { Bot } from '../src/core/bot.js';

const env = readEnv();
const args = process.argv.slice(2);
const guildArg = args.includes('--guild') ? args[args.indexOf('--guild') + 1] : null;
const guildId = guildArg || env.deployGuildId;
const clear = args.includes('--clear');

if (!env.token || !env.clientId) {
  console.error('DISCORD_TOKEN and DISCORD_CLIENT_ID are required in .env');
  process.exit(1);
}

const bot = await new Bot({ env, dryRun: true }).init();
const body = clear ? [] : bot.commandJson();
const rest = new REST({ version: '10' }).setToken(env.token);
const route = guildId ? Routes.applicationGuildCommands(env.clientId, guildId) : Routes.applicationCommands(env.clientId);
try {
  const res = await rest.put(route, { body });
  console.log(`${clear ? 'Cleared' : 'Registered'} ${res.length} command(s) ${guildId ? `in guild ${guildId}` : 'globally'}.`);
} catch (err) {
  console.error('Deploy failed:', err.message);
  if (err.rawError?.errors) console.error(JSON.stringify(err.rawError.errors, null, 2).slice(0, 4000));
  process.exit(1);
}
