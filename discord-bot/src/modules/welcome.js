/**
 * Welcome & goodbye messages (templates, embeds, generated welcome image), DM welcome and autorole.
 */
import { AttachmentBuilder } from 'discord.js';
import { opt } from '../core/commands.js';
import { EPHEMERAL } from '../core/ui.js';
import { render, memberVars, colorInt } from '../lib/template.js';
import { welcomeCard } from '../lib/card.js';
import { logger } from '../lib/logger.js';

const log = logger.child('welcome');

export async function welcomePayload(bot, member, kind = 'welcome') {
  const cfg = bot.cfg(member.guild.id);
  const c = cfg[kind];
  const tg = bot.tg(member.guild.id);
  const vars = memberVars(member);
  const text = render(c.message || tg(`welcome.default_${kind}`), vars);
  const payload = { allowedMentions: { users: [member.id] } };
  if (!c.embed) return { ...payload, content: text };
  const e = bot.embed(member.guild.id, colorInt(c.color || cfg.general.color))
    .setAuthor({ name: kind === 'welcome' ? tg('welcome.title', { server: member.guild.name }) : tg('welcome.goodbye_title'), iconURL: member.guild.iconURL() || undefined })
    .setDescription(text)
    .setThumbnail(member.displayAvatarURL({ size: 256 }))
    .setFooter({ text: tg('welcome.footer', { count: member.guild.memberCount }) })
    .setTimestamp();
  const out = { ...payload, embeds: [e], content: kind === 'welcome' ? `<@${member.id}>` : undefined };
  if (kind === 'welcome' && c.image) {
    const png = await welcomeCard({
      avatarUrl: member.displayAvatarURL({ size: 256, extension: 'png' }),
      title: tg('welcome.card_title').toUpperCase(),
      name: member.displayName || member.user.username,
      subtitle: tg('welcome.card_subtitle', { count: member.guild.memberCount, server: member.guild.name }),
      accent: c.color || cfg.general.color,
    });
    if (png) { out.files = [new AttachmentBuilder(png, { name: 'welcome.png' })]; e.setImage('attachment://welcome.png'); }
  }
  return out;
}

async function giveRoles(bot, member) {
  const cfg = bot.cfg(member.guild.id);
  const roles = member.user.bot ? cfg.autorole.botRoles : cfg.autorole.roles;
  const extra = !member.user.bot && cfg.verification.enabled && cfg.verification.unverifiedRole ? [cfg.verification.unverifiedRole] : [];
  const all = [...new Set([...(cfg.autorole.enabled ? roles : []), ...extra])].filter(r => {
    const role = member.guild.roles.cache.get(r);
    return role && !role.managed && role.position < member.guild.members.me.roles.highest.position;
  });
  if (!all.length) return;
  // with verification on, normal autoroles are given after verification instead
  const now = cfg.verification.enabled && !member.user.bot ? extra : all;
  if (now.length) await member.roles.add(now, 'Nore Bot autorole').catch(err => log.warn('autorole failed', { err: err.message }));
}

export default {
  name: 'welcome',
  events: {
    async guildMemberAdd(bot, member) {
      const cfg = bot.cfg(member.guild.id);
      if (cfg.autorole.enabled || cfg.verification.enabled) {
        const delay = (cfg.autorole.delaySeconds || 0) * 1000;
        if (delay) setTimeout(() => member.fetch().then(m => giveRoles(bot, m)).catch(() => {}), delay).unref?.();
        else await giveRoles(bot, member);
      }
      if (cfg.welcome.enabled && cfg.welcome.channel) await bot.send(member.guild, cfg.welcome.channel, await welcomePayload(bot, member));
      if (cfg.welcome.enabled && cfg.welcome.dm && !member.user.bot) {
        const tg = bot.tg(member.guild.id);
        await member.send({ content: render(cfg.welcome.dmMessage || tg('welcome.default_dm'), memberVars(member)) }).catch(() => {});
      }
    },
    async guildMemberRemove(bot, member) {
      const cfg = bot.cfg(member.guild.id);
      if (cfg.goodbye.enabled && cfg.goodbye.channel) await bot.send(member.guild, cfg.goodbye.channel, await welcomePayload(bot, member, 'goodbye'));
    },
  },
  commands: [{
    name: 'welcome', category: 'admin', perms: ['ManageGuild'], module: null,
    subs: {
      test: {
        options: [opt.string('type', false, { choices: { set: 'welcomeType', values: ['welcome', 'goodbye'] } })],
        async run(ctx) {
          await ctx.defer();
          const p = await welcomePayload(ctx.bot, ctx.member, ctx.str('type') || 'welcome');
          return ctx.reply({ ...p, flags: EPHEMERAL });
        },
      },
    },
  }],
};

export { giveRoles };
