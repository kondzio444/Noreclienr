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
  // configuration errors are fatal (with a hint), network problems are retried with backoff
  for (let attempt = 1; ; attempt++) {
    try {
      await bot.start();
      return bot;
    } catch (err) {
      const msg = String(err?.message || err);
      if (err?.code === 'TokenInvalid') { log.error('Discord rejected DISCORD_TOKEN – reset the token in the Developer Portal and update .env'); process.exit(1); }
      if (/disallowed intents/i.test(msg) || err?.code === 4014) { log.error('Privileged intents are not enabled – turn on Server Members Intent and Message Content Intent in the Developer Portal (Bot tab)'); process.exit(1); }
      const wait = Math.min(300_000, 5000 * 2 ** (attempt - 1));
      log.warn('login failed, retrying', { attempt, waitMs: wait, err: msg });
      try { await bot.client?.destroy(); } catch { /* ignore */ }
      await new Promise(r => setTimeout(r, wait));
    }
  }
}

// spawned by ShardingManager as a separate process
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.on('unhandledRejection', (err) => log.error('unhandled rejection', { err }));
  process.on('uncaughtException', (err) => log.error('uncaught exception (process kept alive)', { err }));
  run().catch((err) => { log.error('shard failed to start', { err }); process.exit(1); });
}
