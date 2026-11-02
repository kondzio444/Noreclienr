/**
 * Server stats channels: channel names with live counters ({members}, {humans}, {bots}, {boosts},
 * {channels}, {roles}, {online}*, {noreOnline}, {noreVersion}, {noreDownloads}) renamed every
 * N minutes (Discord allows 2 renames per channel per 10 minutes – the minimum interval is 10).
 * /stats setup creates a locked category with voice counters.
 */
import { ChannelType, PermissionFlagsBits as P } from 'discord.js';
import { opt } from '../core/commands.js';
import { render } from '../lib/template.js';
import { num } from '../i18n/index.js';

const last = new Map(); // channelId -> { at, name }

export async function statVars(bot, guild) {
  const [hub, rel, stats] = await Promise.all([bot.api.hubStats(), bot.api.latestRelease(), bot.api.stats()]);
  const lang = bot.cfg(guild.id).general.language;
  const members = guild.memberCount;
  const bots = guild.members.cache.filter(m => m.user.bot).size;
  return {
    members: num(lang, members), humans: num(lang, Math.max(0, members - bots)), bots: num(lang, bots),
    boosts: num(lang, guild.premiumSubscriptionCount || 0), tier: guild.premiumTier,
    channels: num(lang, guild.channels.cache.size), roles: num(lang, guild.roles.cache.size - 1),
    noreOnline: hub ? num(lang, hub.online ?? hub.players?.online ?? 0) : '—', noreVersion: rel?.version || '—',
    noreDownloads: stats?.downloads?.total !== undefined ? num(lang, stats.downloads.total) : '—',
  };
}

async function updateGuild(bot, guild, force = false) {
  const cfg = bot.cfg(guild.id).stats;
  if (!cfg.enabled || !cfg.channels.length) return;
  const vars = await statVars(bot, guild);
  for (const s of cfg.channels) {
    const ch = guild.channels.cache.get(s.channel);
    if (!ch || !ch.manageable) continue;
    const name = render(s.template, vars).slice(0, 100);
    const prev = last.get(ch.id);
    if (ch.name === name) continue;
    if (!force && prev && Date.now() - prev.at < cfg.intervalMinutes * 60_000) continue;
    last.set(ch.id, { at: Date.now(), name });
    await ch.setName(name, 'stats channel').catch(() => {});
  }
}

export default {
  name: 'stats',
  ready(bot) {
    bot.every(10 * 60_000, async () => { for (const g of bot.client.guilds.cache.values()) await updateGuild(bot, g); }, 'stats');
  },
  commands: [{
    name: 'stats', category: 'automation', module: null, perms: ['ManageChannels'], botPerms: ['ManageChannels'], botPermsScope: 'guild',
    subs: {
      setup: {
        options: [opt.bool('nore')],
        async run(ctx) {
          await ctx.defer();
          const g = ctx.guild;
          const t = ctx.tg;
          const cat = await g.channels.create({ name: t('stats.category'), type: ChannelType.GuildCategory, position: 0, permissionOverwrites: [{ id: g.id, deny: [P.Connect], allow: [P.ViewChannel] }] });
          const templates = [t('stats.tpl_members'), t('stats.tpl_humans'), t('stats.tpl_boosts')];
          if (ctx.bool('nore') ?? true) templates.push(t('stats.tpl_nore_online'), t('stats.tpl_nore_version'));
          const vars = await statVars(ctx.bot, g);
          const list = [];
          for (const tpl of templates) {
            const ch = await g.channels.create({ name: render(tpl, vars).slice(0, 100), type: ChannelType.GuildVoice, parent: cat.id });
            list.push({ channel: ch.id, template: tpl });
          }
          ctx.bot.config.set(g.id, 'stats.channels', list, { by: ctx.user.id });
          ctx.bot.config.set(g.id, 'stats.enabled', true, { by: ctx.user.id });
          ctx.bot.audit(g.id, 'stats_setup', { channels: list.length, by: ctx.user.id });
          return ctx.reply({ content: ctx.t('stats.created', { count: list.length }) });
        },
      },
      refresh: {
        async run(ctx) {
          await ctx.defer();
          await updateGuild(ctx.bot, ctx.guild, true);
          return ctx.reply({ content: ctx.t('stats.refreshed') });
        },
      },
    },
  }],
};
