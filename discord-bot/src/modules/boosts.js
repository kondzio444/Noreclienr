/**
 * Server boosts: thank-you announcement (+ optional DM), an extra booster role, a booster-only
 * perks channel kept in sync with that role, and /boosts info (tier, perks, boosters).
 */
import { opt } from '../core/commands.js';
import { EPHEMERAL } from '../core/ui.js';
import { render, memberVars, clip } from '../lib/template.js';
import { ts } from '../lib/duration.js';

const TIER_GOALS = [0, 2, 7, 14];

async function ensurePerks(bot, guild) {
  const cfg = bot.cfg(guild.id).boosts;
  if (!cfg.enabled || !cfg.perksChannel) return;
  const ch = guild.channels.cache.get(cfg.perksChannel);
  const roleId = cfg.role || guild.roles.premiumSubscriberRole?.id;
  if (!ch || !roleId || !ch.manageable) return;
  const has = ch.permissionOverwrites.cache.get(roleId);
  if (!has?.allow.has('ViewChannel')) {
    await ch.permissionOverwrites.edit(guild.id, { ViewChannel: false }).catch(() => {});
    await ch.permissionOverwrites.edit(roleId, { ViewChannel: true, SendMessages: true, Connect: true }).catch(() => {});
  }
}

export default {
  name: 'boosts',
  events: {
    async guildMemberUpdate(bot, before, after) {
      const cfg = bot.cfg(after.guild.id).boosts;
      if (!cfg.enabled || before.partial) return;
      const started = !before.premiumSince && after.premiumSince;
      const stopped = before.premiumSince && !after.premiumSince;
      if (cfg.role && after.guild.roles.cache.get(cfg.role)?.editable) {
        if (started) await after.roles.add(cfg.role, 'booster').catch(() => {});
        if (stopped) await after.roles.remove(cfg.role, 'booster ended').catch(() => {});
      }
      if (!started) return;
      const tg = bot.tg(after.guild.id);
      const text = render(cfg.message || tg('boosts.default_message'), { ...memberVars(after), boosts: after.guild.premiumSubscriptionCount || 0, tier: after.guild.premiumTier });
      if (cfg.channel) {
        await bot.send(after.guild, cfg.channel, { content: `${after}`, embeds: [bot.embed(after.guild.id, 0xf47fff).setTitle(tg('boosts.title')).setDescription(text).setThumbnail(after.displayAvatarURL({ size: 256 }))], allowedMentions: { users: [after.id] } });
      }
      if (cfg.thankDm) await after.send(tg('boosts.dm', { server: after.guild.name })).catch(() => {});
      bot.audit(after.guild.id, 'boost', { userId: after.id });
    },
  },
  configChanged(bot, guild) { ensurePerks(bot, guild).catch(() => {}); },
  commands: [{
    name: 'boosts', category: 'server', module: null,
    subs: {
      info: {
        async run(ctx) {
          const g = ctx.guild;
          const boosters = (await g.members.fetch().catch(() => g.members.cache)).filter(m => m.premiumSince).sort((a, b) => a.premiumSinceTimestamp - b.premiumSinceTimestamp);
          const count = g.premiumSubscriptionCount || 0;
          const next = TIER_GOALS.find(x => x > count);
          const e = ctx.bot.embed(g.id, 0xf47fff).setTitle(ctx.t('boosts.info_title', { server: g.name }))
            .addFields(
              { name: ctx.t('boosts.tier'), value: `${g.premiumTier} / 3`, inline: true },
              { name: ctx.t('boosts.count'), value: String(count), inline: true },
              { name: ctx.t('boosts.next'), value: next ? ctx.t('boosts.next_value', { count: next - count }) : '🏆', inline: true },
              { name: ctx.t('boosts.perks'), value: ctx.t(`boosts.perks_${g.premiumTier}`) },
              { name: ctx.t('boosts.boosters', { count: boosters.size }), value: clip(boosters.map(m => `${m} ${ts(m.premiumSinceTimestamp)}`).join('\n') || '—', 1024) },
            );
          return ctx.reply({ embeds: [e], flags: EPHEMERAL });
        },
      },
      setup: {
        perms: ['ManageGuild'],
        options: [opt.channel('channel', false, { channelTypes: ['text'] }), opt.role('role'), opt.channel('perks_channel', false, { channelTypes: ['text', 'voice', 'forum'] })],
        async run(ctx) {
          const set = (k, v) => ctx.bot.config.set(ctx.guild.id, `boosts.${k}`, v, { by: ctx.user.id });
          if (ctx.channelOpt('channel')) set('channel', ctx.channelOpt('channel').id);
          if (ctx.roleOpt('role')) set('role', ctx.roleOpt('role').id);
          if (ctx.channelOpt('perks_channel')) set('perksChannel', ctx.channelOpt('perks_channel').id);
          set('enabled', true);
          await ensurePerks(ctx.bot, ctx.guild);
          return ctx.ok('boosts.configured');
        },
      },
    },
  }],
};
