#!/usr/bin/env node
/**
 * Registers the slash commands (npm run deploy-commands).
 *   DEPLOY_GUILD_ID set  → per-guild (instant); several servers: comma separated, e.g. 123,456
 *   otherwise            → global (every server the bot is on; can take up to an hour to show)
 *   --clear              → removes the commands (global, or of DEPLOY_GUILD_ID)
 *   --guild <id[,id]>    → overrides DEPLOY_GUILD_ID
 */
import { REST, Routes } from 'discord.js';
import { env as readEnv } from '../src/lib/env.js';
import { Bot } from '../src/core/bot.js';

const env = readEnv();
const args = process.argv.slice(2);
const guildArg = args.includes('--guild') ? args[args.indexOf('--guild') + 1] : null;
const guildIds = String(guildArg || env.deployGuildId || '').split(/[\s,;]+/).filter(Boolean);
const clear = args.includes('--clear');

if (!env.token || !env.clientId) {
  console.error('DISCORD_TOKEN and DISCORD_CLIENT_ID are required in .env');
  process.exit(1);
}
const bad = guildIds.filter(id => !/^\d{17,20}$/.test(id));
if (bad.length) {
  console.error(`DEPLOY_GUILD_ID: to nie jest ID serwera: ${bad.join(', ')} (Discord → tryb dewelopera → prawy klik na serwer → Kopiuj ID serwera)`);
  process.exit(1);
}

const bot = await new Bot({ env, dryRun: true }).init();
const body = clear ? [] : bot.commandJson();
const rest = new REST({ version: '10' }).setToken(env.token);

let failed = 0;
for (const guildId of guildIds.length ? guildIds : [null]) {
  const route = guildId ? Routes.applicationGuildCommands(env.clientId, guildId) : Routes.applicationCommands(env.clientId);
  try {
    const res = await rest.put(route, { body });
    console.log(`${clear ? 'Cleared' : 'Registered'} ${res.length} command(s) ${guildId ? `in guild ${guildId}` : 'globally'}.`);
  } catch (err) {
    failed++;
    console.error(`Deploy failed${guildId ? ` (guild ${guildId})` : ''}:`, err.message);
    if (err.code === 50001 && guildId) {
      console.error(`Bot nie jest na serwerze ${guildId} albo został dodany bez zakresu applications.commands. Dodaj go linkiem:`);
      console.error(`https://discord.com/oauth2/authorize?client_id=${env.clientId}&scope=bot%20applications.commands&permissions=8&guild_id=${guildId}`);
      console.error('albo usuń DEPLOY_GUILD_ID z .env, żeby zarejestrować komendy globalnie.');
    } else if (err.status === 401) {
      console.error('Zły DISCORD_TOKEN – skopiuj go ponownie z zakładki Bot w Discord Developer Portal.');
      break;
    }
    if (err.rawError?.errors) console.error(JSON.stringify(err.rawError.errors, null, 2).slice(0, 4000));
  }
}
if (failed) process.exit(1);
