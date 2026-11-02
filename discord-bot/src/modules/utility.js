/**
 * Utility: /help (categories + pagination), /ping, /userinfo, /serverinfo, /avatar, /embed (modal builder).
 */
import {
  StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ButtonStyle, GuildVerificationLevel,
} from 'discord.js';
import { opt } from '../core/commands.js';
import { EPHEMERAL, row, button, embed, chunk } from '../core/ui.js';
import { ts } from '../lib/duration.js';
import { colorInt, clip } from '../lib/template.js';
import { leaves } from '../core/commands.js';

export const CATEGORIES = ['nore', 'community', 'leveling', 'tickets', 'moderation', 'automation', 'server', 'builder', 'admin', 'utility'];
const CAT_EMOJI = { nore: '🟣', community: '🎉', leveling: '📈', tickets: '🎫', moderation: '🛡️', automation: '🤖', server: '🧰', builder: '🏗️', admin: '⚙️', utility: '🔧' };
const PER_PAGE = 12;

function helpView(ctx, cat, page) {
  const t = ctx.t;
  const bot = ctx.bot;
  const items = [];
  for (const def of bot.commands.values()) {
    if ((def.category || 'utility') !== cat) continue;
    for (const l of leaves(def)) {
      const key = l.group ? `cmd.${def.name}.${l.group}.${l.sub}.desc` : l.sub ? `cmd.${def.name}.${l.sub}.desc` : `cmd.${def.name}.desc`;
      items.push(`${bot.mention(l.path)} – ${t(key)}`);
    }
  }
  const pages = Math.max(1, Math.ceil(items.length / PER_PAGE));
  page = Math.min(Math.max(0, page), pages - 1);
  const e = bot.embed(ctx.guild.id)
    .setTitle(`${CAT_EMOJI[cat]} ${t(`help.cat.${cat}`)}`)
    .setDescription(items.slice(page * PER_PAGE, (page + 1) * PER_PAGE).join('\n') || t('help.empty'))
    .setFooter({ text: t('help.footer', { page: page + 1, pages }) });
  const select = new StringSelectMenuBuilder().setCustomId('help:cat').setPlaceholder(t('help.pick'))
    .addOptions(CATEGORIES.map(c => ({ label: t(`help.cat.${c}`), value: c, emoji: CAT_EMOJI[c], default: c === cat })));
  const nav = row(
    button(`help:page:${cat}:${page - 1}`, null, ButtonStyle.Secondary, '◀️').setDisabled(page === 0),
    button(`help:page:${cat}:${page + 1}`, null, ButtonStyle.Secondary, '▶️').setDisabled(page >= pages - 1),
  );
  return { embeds: [e], components: [row(select), nav] };
}

function overview(ctx) {
  const t = ctx.t;
  const e = ctx.bot.embed(ctx.guild.id)
    .setTitle(t('help.title'))
    .setDescription(t('help.intro', { panel: `${ctx.bot.env.noreApi}/panel` }))
    .addFields(CATEGORIES.map(c => ({ name: `${CAT_EMOJI[c]} ${t(`help.cat.${c}`)}`, value: t(`help.catdesc.${c}`), inline: true })));
  const select = new StringSelectMenuBuilder().setCustomId('help:cat').setPlaceholder(t('help.pick'))
    .addOptions(CATEGORIES.map(c => ({ label: t(`help.cat.${c}`), value: c, emoji: CAT_EMOJI[c] })));
  return { embeds: [e], components: [row(select)] };
}

export default {
  name: 'utility',
  alwaysComponents: true,
  commands: [
    {
      name: 'help', category: 'utility', module: null,
      options: [opt.string('category', false, { choices: { set: 'helpcat', values: CATEGORIES, key: (c) => `help.cat.${c}` } })],
      async run(ctx) {
        const cat = ctx.str('category');
        return ctx.reply({ ...(cat ? helpView(ctx, cat, 0) : overview(ctx)), flags: EPHEMERAL });
      },
    },
    {
      name: 'ping', category: 'utility',
      async run(ctx) {
        const started = Date.now();
        await ctx.defer();
        const api = await ctx.bot.api.status();
        return ctx.reply({ embeds: [ctx.bot.embed(ctx.guild.id).setTitle('🏓 Pong!').addFields(
          { name: ctx.t('ping.gateway'), value: `${Math.round(ctx.bot.client.ws.ping)} ms`, inline: true },
          { name: ctx.t('ping.roundtrip'), value: `${Date.now() - started} ms`, inline: true },
          { name: ctx.t('ping.api'), value: api ? '🟢' : '🔴', inline: true },
          { name: ctx.t('ping.uptime'), value: ts(Date.now() - process.uptime() * 1000), inline: true },
        )] });
      },
    },
    {
      name: 'userinfo', category: 'utility',
      options: [opt.user('user')],
      async run(ctx) {
        const user = await (ctx.userOpt('user') || ctx.user).fetch(true).catch(() => ctx.userOpt('user') || ctx.user);
        const member = await ctx.guild.members.fetch(user.id).catch(() => null);
        const e = embed(user.accentColor || colorInt(ctx.cfg.general.color))
          .setAuthor({ name: user.tag || user.username, iconURL: user.displayAvatarURL() })
          .setThumbnail(user.displayAvatarURL({ size: 256 }))
          .addFields(
            { name: 'ID', value: `\`${user.id}\``, inline: true },
            { name: ctx.t('userinfo.created'), value: `${ts(user.createdTimestamp, 'D')} (${ts(user.createdTimestamp)})`, inline: true },
            { name: ctx.t('userinfo.bot'), value: user.bot ? '✅' : '❌', inline: true },
          );
        if (member) {
          const roles = member.roles.cache.filter(r => r.id !== ctx.guild.id).sort((a, b) => b.position - a.position);
          e.addFields(
            { name: ctx.t('userinfo.joined'), value: `${ts(member.joinedTimestamp, 'D')} (${ts(member.joinedTimestamp)})`, inline: true },
            { name: ctx.t('userinfo.nickname'), value: member.nickname || '—', inline: true },
            { name: ctx.t('userinfo.boosting'), value: member.premiumSince ? ts(member.premiumSinceTimestamp) : '—', inline: true },
            { name: ctx.t('userinfo.roles', { count: roles.size }), value: clip(roles.map(r => `${r}`).join(' ') || '—', 1024) },
          );
          if (member.communicationDisabledUntilTimestamp > Date.now()) e.addFields({ name: ctx.t('userinfo.timeout'), value: ts(member.communicationDisabledUntilTimestamp) });
        }
        if (user.bannerURL()) e.setImage(user.bannerURL({ size: 1024 }));
        return ctx.reply({ embeds: [e], flags: EPHEMERAL });
      },
    },
    {
      name: 'serverinfo', category: 'utility',
      async run(ctx) {
        const g = ctx.guild;
        const owner = await g.fetchOwner().catch(() => null);
        const ch = g.channels.cache;
        const levels = { [GuildVerificationLevel.None]: 'none', [GuildVerificationLevel.Low]: 'low', [GuildVerificationLevel.Medium]: 'medium', [GuildVerificationLevel.High]: 'high', [GuildVerificationLevel.VeryHigh]: 'very_high' };
        const e = ctx.bot.embed(g.id).setTitle(g.name).setThumbnail(g.iconURL({ size: 256 }))
          .setDescription(g.description || null)
          .addFields(
            { name: ctx.t('serverinfo.owner'), value: owner ? `${owner}` : '—', inline: true },
            { name: ctx.t('serverinfo.created'), value: ts(g.createdTimestamp, 'D'), inline: true },
            { name: ctx.t('serverinfo.members'), value: String(g.memberCount), inline: true },
            { name: ctx.t('serverinfo.channels'), value: ctx.t('serverinfo.channels_value', { text: ch.filter(c => c.isTextBased() && !c.isThread()).size, voice: ch.filter(c => c.isVoiceBased()).size, categories: ch.filter(c => c.type === 4).size }), inline: true },
            { name: ctx.t('serverinfo.roles'), value: String(g.roles.cache.size - 1), inline: true },
            { name: ctx.t('serverinfo.emojis'), value: String(g.emojis.cache.size), inline: true },
            { name: ctx.t('serverinfo.boosts'), value: ctx.t('serverinfo.boosts_value', { count: g.premiumSubscriptionCount || 0, tier: g.premiumTier }), inline: true },
            { name: ctx.t('serverinfo.verification'), value: ctx.t(`panel.options.verificationLevels.${levels[g.verificationLevel] || 'none'}`), inline: true },
            { name: 'ID', value: `\`${g.id}\``, inline: true },
          );
        if (g.bannerURL()) e.setImage(g.bannerURL({ size: 1024 }));
        return ctx.reply({ embeds: [e], flags: EPHEMERAL });
      },
    },
    {
      name: 'avatar', category: 'utility',
      options: [opt.user('user'), opt.bool('server')],
      async run(ctx) {
        const user = ctx.userOpt('user') || ctx.user;
        const member = ctx.bool('server') ? await ctx.guild.members.fetch(user.id).catch(() => null) : null;
        const url = (member || user).displayAvatarURL({ size: 1024, extension: 'png' });
        return ctx.reply({ embeds: [ctx.bot.embed(ctx.guild.id).setTitle(ctx.t('avatar.title', { name: user.username })).setImage(url).setURL(url)] });
      },
    },
    {
      name: 'embed', category: 'utility', perms: ['ManageMessages'],
      options: [opt.channel('channel', false, { channelTypes: ['text', 'announcement'] })],
      async run(ctx) {
        const ch = ctx.channelOpt('channel') || ctx.i.channel;
        const modal = new ModalBuilder().setCustomId(`embed:send:${ch.id}`).setTitle(ctx.t('embed.modal_title'));
        const input = (id, style, max, required = false) => row(new TextInputBuilder().setCustomId(id).setLabel(ctx.t(`embed.field_${id}`)).setStyle(style).setMaxLength(max).setRequired(required));
        modal.addComponents(
          input('title', TextInputStyle.Short, 256),
          input('description', TextInputStyle.Paragraph, 4000, true),
          input('color', TextInputStyle.Short, 7),
          input('image', TextInputStyle.Short, 500),
          input('footer', TextInputStyle.Short, 2048),
        );
        return ctx.i.showModal(modal);
      },
    },
  ],
  components: {
    async help(ctx, [action, cat, page]) {
      if (action === 'cat') return ctx.i.update(helpView(ctx, ctx.i.values[0], 0));
      if (action === 'page') return ctx.i.update(helpView(ctx, cat, Number(page) || 0));
    },
    async embed(ctx, [action, channelId]) {
      if (action !== 'send' || !ctx.i.isModalSubmit()) return;
      if (!ctx.member.permissions.has('ManageMessages')) return ctx.fail('errors.missing_user_perms', { perms: ctx.t('perm.ManageMessages') });
      const f = (id) => ctx.i.fields.getTextInputValue(id)?.trim();
      const e = embed(colorInt(f('color'), colorInt(ctx.cfg.general.color))).setDescription(f('description'));
      if (f('title')) e.setTitle(f('title'));
      if (/^https?:\/\/\S+$/.test(f('image') || '')) e.setImage(f('image'));
      if (f('footer')) e.setFooter({ text: f('footer') });
      const msg = await ctx.bot.send(ctx.guild, channelId, { embeds: [e] });
      if (!msg) return ctx.fail('errors.cannot_send', { channel: `<#${channelId}>` });
      ctx.bot.audit(ctx.guild.id, 'embed_sent', { channelId, by: ctx.user.id });
      return ctx.ok('embed.sent', { url: msg.url });
    },
  },
};

export { chunk };
