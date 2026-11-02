#!/usr/bin/env node
/**
 * Nore Bot entry point.
 *
 *   node .              start (1 shard in-process, or ShardingManager when Discord recommends more)
 *   node . --dry-run    load every module, build every command definition, validate the schema,
 *                       locales and templates, print the command list and exit (no token needed)
 *
 * BOT_SHARDS=auto|<n> in .env controls sharding.
 */
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { env as readEnv } from './src/lib/env.js';
import { logger } from './src/lib/logger.js';

const log = logger.child('main');
const args = new Set(process.argv.slice(2));
const env = readEnv();

process.on('unhandledRejection', (err) => log.error('unhandled rejection', { err }));
process.on('uncaughtException', (err) => log.error('uncaught exception (process kept alive)', { err }));

if (args.has('--dry-run')) {
  const { dryRun } = await import('./src/dry-run.js');
  process.exit(await dryRun(env));
}

if (!env.token) {
  log.error('DISCORD_TOKEN missing – copy .env.example to .env and fill it in (or run `node . --dry-run`)');
  process.exit(1);
}

async function recommendedShards() {
  try {
    const res = await fetch('https://discord.com/api/v10/gateway/bot', { headers: { Authorization: `Bot ${env.token}` } });
    if (!res.ok) return 1;
    return (await res.json()).shards || 1;
  } catch { return 1; }
}

const isShardChild = process.env.SHARDING_MANAGER === 'true';
// discord.js parses process.env.SHARDS as JSON when it is set; an old .env with SHARDS=auto would break login
if (!isShardChild) { delete process.env.SHARDS; delete process.env.SHARD_COUNT; }
let shards = 1;
if (!isShardChild) {
  shards = /^\d+$/.test(env.shards) ? Number(env.shards) : await recommendedShards();
}

if (!isShardChild && shards > 1) {
  // Many guilds: one process per shard, managed and respawned by discord.js.
  const { ShardingManager } = await import('discord.js');
  const file = path.join(path.dirname(fileURLToPath(import.meta.url)), 'src', 'shard.js');
  const manager = new ShardingManager(file, { token: env.token, totalShards: shards, respawn: true });
  manager.on('shardCreate', (s) => {
    log.info('shard launched', { shard: s.id });
    s.on('death', () => log.warn('shard died – respawning', { shard: s.id }));
  });
  const stop = async (signal) => {
    log.info('stopping shards', { signal });
    for (const s of manager.shards.values()) s.kill();
    process.exit(0);
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  await manager.spawn({ timeout: 60_000, delay: 7000 });
} else {
  const { run } = await import('./src/shard.js');
  await run(env);
}
