/**
 * Runs one bot process (a single shard, or one shard spawned by the ShardingManager).
 */
import { fileURLToPath } from 'node:url';
import { Bot } from './core/bot.js';
import { env as readEnv } from './lib/env.js';
import { logger } from './lib/logger.js';

const log = logger.child('shard');

export async function run(env = readEnv()) {
  const bot = new Bot({ env });
  await bot.init();
  let stopping = false;
  const stop = async (signal) => {
    if (stopping) return;
    stopping = true;
    const force = setTimeout(() => process.exit(0), 10_000);
    force.unref();
    await bot.stop(signal);
    process.exit(0);
  };
  process.once('SIGINT', () => stop('SIGINT'));
  process.once('SIGTERM', () => stop('SIGTERM'));
  await bot.start();
  return bot;
}

// spawned by ShardingManager as a separate process
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.on('unhandledRejection', (err) => log.error('unhandled rejection', { err }));
  process.on('uncaughtException', (err) => log.error('uncaught exception (process kept alive)', { err }));
  run().catch((err) => { log.error('shard failed to start', { err }); process.exit(1); });
}
