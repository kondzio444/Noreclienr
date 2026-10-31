/**
 * Config-driven actions the website panel can trigger without a new endpoint: the panel appends
 * `{ id, type, template, size, language }` to config.actions.queue and saves; the bot runs every id
 * once (remembered in the store) and reports `{ type: 'action_result', data: { id, ok, … } }` via
 * POST /bot/guilds/:id/events. Destructive operations are never available here (no prune, no
 * deletes); they need a confirmation in Discord.
 */
import { rememberId } from '../lib/store.js';
import { logger } from '../lib/logger.js';

const log = logger.child('actions');
const busy = new Set();

async function execute(bot, guild, a) {
  switch (a.type) {
    case 'setup':
    case 'setup_repair': {
      const { runFromAction } = await import('./builder/index.js');
      const job = await runFromAction(bot, guild, { template: a.template, size: a.size, lang: a.language || undefined, update: a.type === 'setup_repair' });
      return { status: job?.status ?? 'busy', errors: job?.errors?.length ?? 0 };
    }
    case 'backup_create': {
      const { createBackup } = await import('./backup.js');
      return { backup: createBackup(bot, guild, { label: 'panel' }).id };
    }
    case 'post_panels': {
      const cfg = bot.cfg(guild.id);
      const posted = [];
      const { panelPayload: ticket } = await import('./tickets.js');
      const { panelPayload: verify } = await import('./verification.js');
      const { postMenu } = await import('./roles.js');
      for (const p of cfg.tickets.panels) if (cfg.tickets.enabled && p.channel && await bot.send(guild, p.channel, ticket(bot, guild.id, p))) posted.push(`ticket:${p.id}`);
      if (cfg.verification.enabled && cfg.verification.channel && cfg.verification.role && await bot.send(guild, cfg.verification.channel, verify(bot, guild.id))) posted.push('verification');
      for (const m of cfg.roles.menus) if (m.channel && m.roles.length && await postMenu(bot, guild, m, m.channel)) posted.push(`roles:${m.id}`);
      return { posted };
    }
    case 'discovery_check': {
      const { discoveryChecklist } = await import('./community.js');
      return { checklist: discoveryChecklist(guild) };
    }
    case 'apply_server': {
      const { applyServerSettings } = await import('./configurator.js');
      return { fields: await applyServerSettings(bot, guild, bot.cfg(guild.id).server, 'Nore Bot panel') };
    }
    default: return { error: 'unknown_type' };
  }
}

async function runQueue(bot, guild, cfg) {
  if (busy.has(guild.id)) return;
  const queue = cfg.actions?.queue || [];
  if (!queue.length) return;
  const st = bot.store.ns(guild.id, 'actions', () => ({ done: [] }));
  st.done ??= [];
  busy.add(guild.id);
  try {
    for (const a of queue) {
      if (!a.id || !rememberId(st.done, a.id, 500)) continue;
      bot.store.touch(guild.id);
      let result;
      try { result = { ok: true, ...(await execute(bot, guild, a)) }; } catch (err) { log.warn('action failed', { guildId: guild.id, type: a.type, err: err.message }); result = { ok: false, error: err.message }; }
      // config the action changed (builder wiring, panels) goes back to the panel before the result
      const sync = await bot.config.flush(guild.id, { reason: 'action' }).catch(() => ({ ok: false }));
      if (sync.version) result.configVersion = sync.version;
      bot.audit(guild.id, 'action_result', { id: a.id, type: a.type, ...result });
    }
  } finally { busy.delete(guild.id); }
}

export default {
  name: null,
  configChanged(bot, guild, cfg) { runQueue(bot, guild, cfg).catch(() => {}); },
  ready(bot) {
    // the first time a guild is seen, mark queued actions as done (they were handled before or are stale)
    for (const g of bot.client.guilds.cache.values()) {
      const st = bot.store.ns(g.id, 'actions', () => ({ done: null }));
      if (st.done === null) { st.done = (bot.cfg(g.id).actions.queue || []).map(a => a.id).filter(Boolean); bot.store.touch(g.id); }
    }
  },
};
