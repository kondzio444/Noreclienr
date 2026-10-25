/**
 * Tickets: several panels (buttons or select menu), categories with their own staff roles, forms
 * (modal questions per category), priorities, claim/unclaim/transfer, add/remove members, private
 * channels or private threads, close with reason → HTML/text transcript to the log channel (and DM),
 * reopen, ratings, auto-close on inactivity with a warning, per-user limits, blacklist, SLA stats.
 */
import {
  ChannelType, PermissionFlagsBits as P, ButtonStyle, StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle,
  AttachmentBuilder,
} from 'discord.js';
import { opt } from '../core/commands.js';
import { EPHEMERAL, row, button, okEmbed, errEmbed, COLORS, embed, confirm } from '../core/ui.js';
import { render, clip } from '../lib/template.js';
import { ts, formatDuration } from '../lib/duration.js';
import { htmlTranscript, textTranscript, plainMessage, fetchAll } from '../lib/transcript.js';
import { logger } from '../lib/logger.js';

const log = logger.child('tickets');
const PRIORITY_ICON = { low: '🟢', normal: '🔵', high: '🟠', urgent: '🔴' };
const PRIORITY_COLOR = { low: COLORS.ok, normal: COLORS.info, high: COLORS.warn, urgent: COLORS.error };

const state = (bot, guildId) => bot.store.ns(guildId, 'tickets', () => ({ next: 1, open: {}, closed: [] }));
export const ticketOf = (bot, guildId, channelId) => state(bot, guildId).open[channelId] || null;

function category(cfg, id) { return cfg.tickets.categories.find(c => c.id === id) || cfg.tickets.categories[0]; }
const catLabel = (tg, c) => { if (c.label) return c.label; const k = tg(`tickets.defaults.${c.id}`); return k.startsWith('tickets.defaults.') ? c.id : k; };
function staffRolesFor(cfg, cat) { return [...new Set([...(cat?.staffRoles?.length ? cat.staffRoles : cfg.tickets.staffRoles), ...cfg.general.staffRoles])]; }

function isTicketStaff(ctx, ticket) {
  if (ctx.member.permissions.has(P.ManageGuild) || ctx.member.permissions.has(P.ManageChannels)) return true;
  const roles = staffRolesFor(ctx.cfg, category(ctx.cfg, ticket?.category));
  return roles.some(r => ctx.member.roles.cache.has(r));
}

function questionsFor(tg, cat) {
  if (cat.questions?.length) return cat.questions.filter(q => q.label).slice(0, 5);
  return [{ label: tg('tickets.default_question'), placeholder: tg('tickets.default_placeholder'), style: 'paragraph', required: true }];
}

// ------------------------------------------------------------------ panels

export function panelPayload(bot, guildId, panel) {
  const cfg = bot.cfg(guildId);
  const tg = bot.tg(guildId);
  const cats = (panel.categories?.length ? cfg.tickets.categories.filter(c => panel.categories.includes(c.id)) : cfg.tickets.categories).slice(0, 25);
  const e = embed(panel.color || cfg.general.color).setTitle(panel.title || tg('tickets.panel_title'))
    .setDescription(panel.description || tg('tickets.panel_text'))
    .setFooter({ text: tg('tickets.panel_footer') });
  if (panel.style === 'select' || cats.length > 5) {
    const menu = new StringSelectMenuBuilder().setCustomId(`ticket:select:${panel.id}`).setPlaceholder(tg('tickets.select_placeholder'))
      .addOptions(cats.map(c => ({ label: clip(catLabel(tg, c), 100), value: c.id, description: c.description ? clip(c.description, 100) : undefined, emoji: c.emoji || undefined })));
    return { embeds: [e], components: [row(menu)] };
  }
  const buttons = cats.map(c => button(`ticket:open:${c.id}`, catLabel(tg, c), ButtonStyle.Secondary, c.emoji || undefined));
  return { embeds: [e], components: [row(...buttons)] };
}

// ------------------------------------------------------------------ open

async function startOpen(ctx, catId) {
  const cfg = ctx.cfg;
  const t = cfg.tickets;
  if (!t.enabled) return ctx.fail('errors.module_disabled', { module: ctx.t('panel.tickets._label') });
  if (t.blacklist.includes(ctx.user.id) || t.blacklistRoles.some(r => ctx.member.roles.cache.has(r))) return ctx.fail('tickets.blacklisted');
  const open = Object.values(state(ctx.bot, ctx.guild.id).open).filter(x => x.userId === ctx.user.id && !x.closedAt);
  if (open.length >= t.maxOpen) return ctx.fail('tickets.limit', { count: t.maxOpen, channels: open.map(x => `<#${x.channelId}>`).join(' ') });
  const cat = category(cfg, catId);
  if (!cat) return ctx.fail('tickets.no_categories');
  const qs = questionsFor(ctx.tg, cat);
  const modal = new ModalBuilder().setCustomId(`ticket:form:${cat.id}`).setTitle(clip(ctx.t('tickets.form_title', { category: catLabel(ctx.tg, cat) }), 45));
  qs.forEach((q, n) => {
    const input = new TextInputBuilder().setCustomId(`q${n}`).setLabel(clip(q.label, 45)).setStyle(q.style === 'short' ? TextInputStyle.Short : TextInputStyle.Paragraph)
      .setRequired(!!q.required).setMaxLength(q.style === 'short' ? 200 : 1500);
    if (q.placeholder) input.setPlaceholder(clip(q.placeholder, 100));
    modal.addComponents(row(input));
  });
  return ctx.i.showModal(modal);
}

async function createTicket(ctx, catId, answers) {
  const bot = ctx.bot;
  const cfg = ctx.cfg;
  const t = cfg.tickets;
  const tg = ctx.tg;
  const cat = category(cfg, catId);
  await ctx.defer();
  const st = state(bot, ctx.guild.id);
  const number = st.next++;
  bot.store.touch(ctx.guild.id);
  const name = render(t.nameTemplate || 'ticket-{number}', { number: String(number).padStart(4, '0'), user: ctx.user.username, category: cat.id }).toLowerCase().replace(/[^\p{L}\p{N}_-]+/gu, '-').slice(0, 90);
  const staff = staffRolesFor(cfg, cat).filter(r => ctx.guild.roles.cache.has(r));
  const me = ctx.guild.members.me;
  let channel;
  try {
    if (t.mode === 'thread') {
      const parent = ctx.i.channel?.type === ChannelType.GuildText ? ctx.i.channel : null;
      if (!parent) return ctx.reply({ embeds: [errEmbed(ctx.t('tickets.thread_parent'))] });
      channel = await parent.threads.create({ name, type: ChannelType.PrivateThread, invitable: false, autoArchiveDuration: 10080, reason: `Ticket #${number}` });
      await channel.members.add(ctx.user.id);
    } else {
      const parentId = cat.parent || t.category || null;
      channel = await ctx.guild.channels.create({
        name, type: ChannelType.GuildText, parent: parentId && ctx.guild.channels.cache.has(parentId) ? parentId : null,
        topic: tg('tickets.topic', { number, user: ctx.user.tag || ctx.user.username, category: catLabel(tg, cat) }),
        permissionOverwrites: [
          { id: ctx.guild.id, deny: [P.ViewChannel] },
          { id: ctx.user.id, allow: [P.ViewChannel, P.SendMessages, P.ReadMessageHistory, P.AttachFiles, P.EmbedLinks] },
          { id: me.id, allow: [P.ViewChannel, P.SendMessages, P.ReadMessageHistory, P.ManageChannels, P.ManageMessages, P.EmbedLinks, P.AttachFiles] },
          ...staff.map(r => ({ id: r, allow: [P.ViewChannel, P.SendMessages, P.ReadMessageHistory, P.AttachFiles, P.EmbedLinks, P.ManageMessages] })),
        ],
        reason: `Ticket #${number}`,
      });
    }
  } catch (err) {
    log.warn('ticket create failed', { guildId: ctx.guild.id, err: err.message });
    return ctx.reply({ embeds: [errEmbed(ctx.t('tickets.create_failed'))] });
  }
  const ticket = { number, channelId: channel.id, thread: t.mode === 'thread', userId: ctx.user.id, category: cat.id, priority: cat.priority || 'normal', claimedBy: null, createdAt: Date.now(), lastActivity: Date.now(), warned: false, answers, added: [], firstResponseAt: null };
  st.open[channel.id] = ticket;
  bot.store.touch(ctx.guild.id);
  const e = embed(PRIORITY_COLOR[ticket.priority]).setTitle(`${cat.emoji || '🎫'} ${tg('tickets.opened_title', { number, category: catLabel(tg, cat) })}`)
    .setDescription(render(t.openMessage || tg('tickets.opened_text'), { user: `<@${ctx.user.id}>`, category: catLabel(tg, cat) }))
    .addFields(
      { name: tg('tickets.author'), value: `<@${ctx.user.id}>`, inline: true },
      { name: tg('tickets.priority'), value: `${PRIORITY_ICON[ticket.priority]} ${tg(`panel.options.priorities.${ticket.priority}`)}`, inline: true },
      { name: tg('tickets.claimed_by'), value: '—', inline: true },
      ...answers.map(a => ({ name: clip(a.q, 256), value: clip(a.a || '—', 1024) })),
    ).setTimestamp();
  const mentions = [`<@${ctx.user.id}>`, ...(t.pingStaff ? staff.map(r => `<@&${r}>`) : [])].join(' ');
  const msg = await channel.send({ content: mentions, embeds: [e], components: [controls(tg, ticket)], allowedMentions: { users: [ctx.user.id], roles: t.pingStaff ? staff : [] } });
  await msg.pin().catch(() => {});
  ticket.controlMessage = msg.id;
  bot.store.touch(ctx.guild.id);
  bot.audit(ctx.guild.id, 'ticket_open', { number, userId: ctx.user.id, category: cat.id, channelId: channel.id });
  await logTicket(bot, ctx.guild, embed(COLORS.info).setDescription(tg('tickets.log_opened', { number, user: `<@${ctx.user.id}>`, channel: `<#${channel.id}>`, category: catLabel(tg, cat) })));
  return ctx.reply({ embeds: [okEmbed(ctx.t('tickets.created', { channel: `<#${channel.id}>` }))] });
}

function controls(tg, ticket) {
  return row(
    ticket.claimedBy
      ? button('ticket:unclaim', tg('tickets.unclaim'), ButtonStyle.Secondary, '↩️')
      : button('ticket:claim', tg('tickets.claim'), ButtonStyle.Primary, '🙋'),
    button('ticket:close', tg('tickets.close'), ButtonStyle.Danger, '🔒'),
  );
}

async function logTicket(bot, guild, e, files) {
  const cfg = bot.cfg(guild.id);
  const ch = cfg.tickets.logChannel || cfg.moderation.logChannel;
  if (ch) await bot.send(guild, ch, { embeds: [e], files });
}

async function refreshControls(bot, guild, ticket) {
  const ch = await bot.channel(guild, ticket.channelId);
  const msg = ch && ticket.controlMessage ? await ch.messages.fetch(ticket.controlMessage).catch(() => null) : null;
  if (!msg) return;
  const tg = bot.tg(guild.id);
  const e = embed(PRIORITY_COLOR[ticket.priority]).setTitle(msg.embeds[0]?.title || `#${ticket.number}`).setDescription(msg.embeds[0]?.description || null)
    .setFields(
      { name: tg('tickets.author'), value: `<@${ticket.userId}>`, inline: true },
      { name: tg('tickets.priority'), value: `${PRIORITY_ICON[ticket.priority]} ${tg(`panel.options.priorities.${ticket.priority}`)}`, inline: true },
      { name: tg('tickets.claimed_by'), value: ticket.claimedBy ? `<@${ticket.claimedBy}>` : '—', inline: true },
      ...(ticket.answers || []).map(a => ({ name: clip(a.q, 256), value: clip(a.a || '—', 1024) })),
    );
  await msg.edit({ embeds: [e], components: [controls(tg, ticket)] }).catch(() => {});
}

// ------------------------------------------------------------------ close / reopen

export async function closeTicket(bot, guild, ticket, { by, reason, auto = false }) {
  const tg = bot.tg(guild.id);
  const cfg = bot.cfg(guild.id);
  const ch = await bot.channel(guild, ticket.channelId);
  ticket.closedAt = Date.now();
  ticket.closedBy = by;
  ticket.reason = reason || null;
  bot.store.touch(guild.id);
  let files = [];
  if (ch) {
    const msgs = (await fetchAll(ch, 5000)).map(plainMessage);
    const title = tg('tickets.transcript_title', { number: ticket.number });
    const user = await bot.client.users.fetch(ticket.userId).catch(() => null);
    const meta = [[tg('tickets.author'), user ? `${user.username} (${user.id})` : ticket.userId], [tg('tickets.category'), ticket.category], [tg('tickets.opened_at'), new Date(ticket.createdAt).toISOString()], [tg('tickets.reason'), reason || '—']];
    const html = htmlTranscript({ title, guild: guild.name, channel: ch.name, messages: msgs, labels: { generated: tg('tickets.generated'), messages: tg('tickets.messages') }, meta });
    files = [new AttachmentBuilder(Buffer.from(html), { name: `ticket-${ticket.number}.html` })];
    if (cfg.tickets.dmTranscript && user) {
      await user.send({ content: tg('tickets.dm_transcript', { number: ticket.number, server: guild.name }), files: [new AttachmentBuilder(Buffer.from(textTranscript({ title, messages: msgs })), { name: `ticket-${ticket.number}.txt` })] }).catch(() => {});
    }
    // lock: author can no longer write
    try {
      if (ticket.thread) { await ch.setLocked(true); await ch.setArchived(false); }
      else await ch.permissionOverwrites.edit(ticket.userId, { SendMessages: false });
    } catch { /* missing perms */ }
    const e = embed(COLORS.muted).setTitle(tg('tickets.closed_title')).setDescription(tg(auto ? 'tickets.closed_auto' : 'tickets.closed_text', { user: by ? `<@${by}>` : tg('mod.automatic'), reason: reason || '—' }));
    const comps = [row(button('ticket:reopen', tg('tickets.reopen'), ButtonStyle.Success, '🔓'), button('ticket:delete', tg('tickets.delete'), ButtonStyle.Danger, '🗑️'))];
    if (cfg.tickets.ratings) comps.push(row(...[1, 2, 3, 4, 5].map(n => button(`ticket:rate:${n}`, String(n), ButtonStyle.Secondary, '⭐'))));
    await ch.send({ content: cfg.tickets.ratings ? tg('tickets.rate_prompt', { user: `<@${ticket.userId}>` }) : undefined, embeds: [e], components: comps, allowedMentions: { users: [ticket.userId] } }).catch(() => {});
    bot.scheduler.add(guild.id, 'ticket_delete', Date.now() + 24 * 3_600_000, { channelId: ticket.channelId });
  }
  const dur = formatDuration(ticket.closedAt - ticket.createdAt);
  await logTicket(bot, guild, embed(COLORS.muted).setTitle(tg('tickets.log_closed_title', { number: ticket.number }))
    .addFields(
      { name: tg('tickets.author'), value: `<@${ticket.userId}>`, inline: true },
      { name: tg('tickets.closed_by'), value: by ? `<@${by}>` : tg('mod.automatic'), inline: true },
      { name: tg('tickets.duration'), value: dur, inline: true },
      { name: tg('tickets.claimed_by'), value: ticket.claimedBy ? `<@${ticket.claimedBy}>` : '—', inline: true },
      { name: tg('tickets.reason'), value: clip(reason || '—', 1024) },
    ).setTimestamp(), files);
  bot.audit(guild.id, 'ticket_close', { number: ticket.number, by, auto, reason: reason || null });
}

function archive(bot, guildId, channelId) {
  const st = state(bot, guildId);
  const t = st.open[channelId];
  if (!t) return;
  delete st.open[channelId];
  st.closed.push({ number: t.number, userId: t.userId, category: t.category, priority: t.priority, claimedBy: t.claimedBy, createdAt: t.createdAt, closedAt: t.closedAt || Date.now(), firstResponseAt: t.firstResponseAt, rating: t.rating ?? null });
  if (st.closed.length > 2000) st.closed.splice(0, st.closed.length - 2000);
  bot.store.touch(guildId);
}

async function deleteTicketChannel(bot, guild, channelId) {
  archive(bot, guild.id, channelId);
  const ch = await bot.channel(guild, channelId);
  if (ch) await ch.delete('Ticket closed').catch(() => {});
}

// ------------------------------------------------------------------ inactivity

async function sweep(bot) {
  for (const guild of bot.client.guilds.cache.values()) {
    const cfg = bot.cfg(guild.id).tickets;
    if (!cfg.enabled || !cfg.autoCloseHours) continue;
    const tg = bot.tg(guild.id);
    for (const ticket of Object.values(state(bot, guild.id).open)) {
      if (ticket.closedAt) continue;
      const idle = Date.now() - ticket.lastActivity;
      if (idle >= cfg.autoCloseHours * 3_600_000) {
        await closeTicket(bot, guild, ticket, { by: null, reason: tg('tickets.inactive_reason', { hours: cfg.autoCloseHours }), auto: true });
      } else if (!ticket.warned && cfg.warnBeforeCloseHours > 0 && idle >= (cfg.autoCloseHours - cfg.warnBeforeCloseHours) * 3_600_000) {
        ticket.warned = true;
        bot.store.touch(guild.id);
        await bot.send(guild, ticket.channelId, { content: tg('tickets.inactive_warning', { user: `<@${ticket.userId}>`, when: ts(ticket.lastActivity + cfg.autoCloseHours * 3_600_000) }), allowedMentions: { users: [ticket.userId] } });
      }
    }
  }
}

// ------------------------------------------------------------------ module

const inTicket = async (ctx) => {
  const ticket = ticketOf(ctx.bot, ctx.guild.id, ctx.i.channelId);
  if (!ticket) { await ctx.fail('tickets.not_ticket'); return null; }
  return ticket;
};
const staffOnly = async (ctx, ticket) => {
  if (isTicketStaff(ctx, ticket)) return true;
  await ctx.fail('tickets.staff_only');
  return false;
};

export default {
  name: 'tickets',
  ready(bot) { bot.every(10 * 60_000, () => sweep(bot), 'ticket-sweep'); },
  events: {
    async messageCreate(bot, message) {
      if (!message.guild || message.author.bot) return;
      const ticket = ticketOf(bot, message.guild.id, message.channelId);
      if (!ticket || ticket.closedAt) return;
      ticket.lastActivity = Date.now();
      ticket.warned = false;
      if (!ticket.firstResponseAt && message.author.id !== ticket.userId) ticket.firstResponseAt = Date.now();
      bot.store.touch(message.guild.id);
    },
    async channelDelete(bot, channel) {
      if (channel.guild && ticketOf(bot, channel.guild.id, channel.id)) archive(bot, channel.guild.id, channel.id);
    },
  },
  timers: {
    async ticket_delete(bot, guildId, { channelId }) {
      const guild = bot.client.guilds.cache.get(guildId);
      const ticket = guild && ticketOf(bot, guildId, channelId);
      if (ticket?.closedAt) await deleteTicketChannel(bot, guild, channelId);
    },
  },
  commands: [{
    name: 'ticket', category: 'tickets',
    subs: {
      panel: {
        perms: ['ManageGuild'],
        options: [opt.string('panel', false, { autocomplete: true }), opt.channel('channel', false, { channelTypes: ['text'] })],
        autocomplete: (ctx) => ctx.cfg.tickets.panels.map(p => ({ name: `${p.id} – ${p.title || ctx.t('tickets.panel_title')}`, value: p.id })),
        async run(ctx) {
          const panels = ctx.str('panel') ? ctx.cfg.tickets.panels.filter(p => p.id === ctx.str('panel')) : ctx.cfg.tickets.panels;
          if (!panels.length) return ctx.fail('tickets.no_panel');
          const sent = [];
          for (const p of panels) {
            const chId = ctx.channelOpt('channel')?.id || p.channel || ctx.i.channelId;
            const msg = await ctx.bot.send(ctx.guild, chId, panelPayload(ctx.bot, ctx.guild.id, p));
            if (msg) sent.push(msg.url);
          }
          if (!sent.length) return ctx.fail('errors.cannot_send', { channel: '—' });
          return ctx.ok('tickets.panel_sent', { links: sent.join('\n') });
        },
      },
      open: {
        options: [opt.string('category', false, { autocomplete: true })],
        autocomplete: (ctx) => ctx.cfg.tickets.categories.map(c => ({ name: catLabel(ctx.tg, c), value: c.id })),
        run: (ctx) => startOpen(ctx, ctx.str('category')),
      },
      close: {
        options: [opt.string('reason', false, { max: 500 })],
        async run(ctx) {
          const ticket = await inTicket(ctx); if (!ticket) return;
          if (ticket.closedAt) return ctx.fail('tickets.already_closed');
          if (ticket.userId !== ctx.user.id && !(await staffOnly(ctx, ticket))) return;
          await ctx.defer(false);
          await closeTicket(ctx.bot, ctx.guild, ticket, { by: ctx.user.id, reason: ctx.str('reason') });
          return ctx.reply({ embeds: [okEmbed(ctx.t('tickets.closing'))] });
        },
      },
      claim: {
        async run(ctx) {
          const ticket = await inTicket(ctx); if (!ticket || !(await staffOnly(ctx, ticket))) return;
          ticket.claimedBy = ctx.user.id; ctx.bot.store.touch(ctx.guild.id);
          await refreshControls(ctx.bot, ctx.guild, ticket);
          return ctx.reply({ embeds: [okEmbed(ctx.tg('tickets.claimed', { user: `${ctx.user}` }))] });
        },
      },
      unclaim: {
        async run(ctx) {
          const ticket = await inTicket(ctx); if (!ticket || !(await staffOnly(ctx, ticket))) return;
          ticket.claimedBy = null; ctx.bot.store.touch(ctx.guild.id);
          await refreshControls(ctx.bot, ctx.guild, ticket);
          return ctx.reply({ embeds: [okEmbed(ctx.tg('tickets.unclaimed', { user: `${ctx.user}` }))] });
        },
      },
      transfer: {
        options: [opt.user('user', true)],
        async run(ctx) {
          const ticket = await inTicket(ctx); if (!ticket || !(await staffOnly(ctx, ticket))) return;
          const user = ctx.userOpt('user');
          ticket.claimedBy = user.id; ctx.bot.store.touch(ctx.guild.id);
          if (!ticket.thread) await ctx.i.channel.permissionOverwrites.edit(user.id, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true }).catch(() => {});
          else await ctx.i.channel.members.add(user.id).catch(() => {});
          await refreshControls(ctx.bot, ctx.guild, ticket);
          return ctx.reply({ content: `${user}`, embeds: [okEmbed(ctx.tg('tickets.transferred', { from: `${ctx.user}`, to: `${user}` }))], allowedMentions: { users: [user.id] } });
        },
      },
      add: {
        options: [opt.user('user', true)],
        async run(ctx) {
          const ticket = await inTicket(ctx); if (!ticket || !(await staffOnly(ctx, ticket))) return;
          const user = ctx.userOpt('user');
          if (ticket.thread) await ctx.i.channel.members.add(user.id);
          else await ctx.i.channel.permissionOverwrites.edit(user.id, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true, AttachFiles: true });
          ticket.added = [...new Set([...(ticket.added || []), user.id])]; ctx.bot.store.touch(ctx.guild.id);
          return ctx.reply({ embeds: [okEmbed(ctx.tg('tickets.user_added', { user: `${user}` }))] });
        },
      },
      remove: {
        options: [opt.user('user', true)],
        async run(ctx) {
          const ticket = await inTicket(ctx); if (!ticket || !(await staffOnly(ctx, ticket))) return;
          const user = ctx.userOpt('user');
          if (user.id === ticket.userId) return ctx.fail('tickets.cannot_remove_author');
          if (ticket.thread) await ctx.i.channel.members.remove(user.id).catch(() => {});
          else await ctx.i.channel.permissionOverwrites.delete(user.id).catch(() => {});
          ticket.added = (ticket.added || []).filter(x => x !== user.id); ctx.bot.store.touch(ctx.guild.id);
          return ctx.reply({ embeds: [okEmbed(ctx.tg('tickets.user_removed', { user: `${user}` }))] });
        },
      },
      priority: {
        options: [opt.string('priority', true, { choices: { values: ['low', 'normal', 'high', 'urgent'], key: (v) => `panel.options.priorities.${v}` } })],
        async run(ctx) {
          const ticket = await inTicket(ctx); if (!ticket || !(await staffOnly(ctx, ticket))) return;
          ticket.priority = ctx.str('priority'); ctx.bot.store.touch(ctx.guild.id);
          await refreshControls(ctx.bot, ctx.guild, ticket);
          if (!ticket.thread && ctx.i.channel.name && !ctx.i.channel.name.startsWith(PRIORITY_ICON[ticket.priority])) {
            await ctx.i.channel.setName(`${PRIORITY_ICON[ticket.priority]}${ctx.i.channel.name.replace(/^[🟢🔵🟠🔴]/u, '')}`).catch(() => {});
          }
          return ctx.reply({ embeds: [okEmbed(ctx.tg('tickets.priority_set', { priority: `${PRIORITY_ICON[ticket.priority]} ${ctx.tg(`panel.options.priorities.${ticket.priority}`)}` }))] });
        },
      },
      rename: {
        options: [opt.string('name', true, { max: 90 })],
        async run(ctx) {
          const ticket = await inTicket(ctx); if (!ticket || !(await staffOnly(ctx, ticket))) return;
          await ctx.i.channel.setName(ctx.str('name')).catch(() => {});
          return ctx.ok('tickets.renamed');
        },
      },
      stats: {
        perms: ['ManageGuild'],
        async run(ctx) {
          const st = state(ctx.bot, ctx.guild.id);
          const now = Date.now();
          const closed = st.closed;
          const recent = (days) => closed.filter(c => now - c.closedAt < days * 86_400_000);
          const avg = (arr) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;
          const first = avg(closed.filter(c => c.firstResponseAt).map(c => c.firstResponseAt - c.createdAt));
          const resolve = avg(closed.map(c => c.closedAt - c.createdAt));
          const ratings = closed.filter(c => c.rating).map(c => c.rating);
          const byCat = {};
          for (const c of closed) byCat[c.category] = (byCat[c.category] || 0) + 1;
          const byStaff = {};
          for (const c of closed) if (c.claimedBy) byStaff[c.claimedBy] = (byStaff[c.claimedBy] || 0) + 1;
          const e = ctx.bot.embed(ctx.guild.id).setTitle(ctx.t('tickets.stats_title')).addFields(
            { name: ctx.t('tickets.stats_open'), value: String(Object.values(st.open).filter(x => !x.closedAt).length), inline: true },
            { name: ctx.t('tickets.stats_7d'), value: String(recent(7).length), inline: true },
            { name: ctx.t('tickets.stats_30d'), value: String(recent(30).length), inline: true },
            { name: ctx.t('tickets.stats_first'), value: first ? formatDuration(first) : '—', inline: true },
            { name: ctx.t('tickets.stats_resolve'), value: resolve ? formatDuration(resolve) : '—', inline: true },
            { name: ctx.t('tickets.stats_rating'), value: ratings.length ? `${avg(ratings).toFixed(2)} ⭐ (${ratings.length})` : '—', inline: true },
            { name: ctx.t('tickets.stats_categories'), value: Object.entries(byCat).map(([k, v]) => `\`${k}\` ${v}`).join(' · ') || '—' },
            { name: ctx.t('tickets.stats_staff'), value: Object.entries(byStaff).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([k, v]) => `<@${k}> ${v}`).join(' · ') || '—' },
          );
          return ctx.reply({ embeds: [e], flags: EPHEMERAL });
        },
      },
      blacklist: {
        perms: ['ManageGuild'],
        options: [opt.string('action', true, { choices: { set: 'addremove', values: ['add', 'remove'] } }), opt.user('user', true)],
        async run(ctx) {
          const user = ctx.userOpt('user');
          const list = new Set(ctx.cfg.tickets.blacklist);
          if (ctx.str('action') === 'add') list.add(user.id); else list.delete(user.id);
          ctx.bot.config.set(ctx.guild.id, 'tickets.blacklist', [...list], { by: ctx.user.id });
          ctx.bot.audit(ctx.guild.id, 'ticket_blacklist', { action: ctx.str('action'), target: user.id, by: ctx.user.id });
          return ctx.ok(ctx.str('action') === 'add' ? 'tickets.blacklist_added' : 'tickets.blacklist_removed', { user: `${user}` });
        },
      },
    },
  }],
  components: {
    async ticket(ctx, [action, arg]) {
      const bot = ctx.bot;
      if (action === 'open') return startOpen(ctx, arg);
      if (action === 'select') return startOpen(ctx, ctx.i.values[0]);
      if (action === 'form' && ctx.i.isModalSubmit()) {
        const cat = category(ctx.cfg, arg);
        const qs = questionsFor(ctx.tg, cat);
        const answers = qs.map((q, n) => ({ q: q.label, a: ctx.i.fields.fields.has(`q${n}`) ? ctx.i.fields.getTextInputValue(`q${n}`) : '' }));
        return createTicket(ctx, arg, answers);
      }
      const ticket = ticketOf(bot, ctx.guild.id, ctx.i.channelId);
      if (!ticket) return ctx.fail('tickets.not_ticket');
      if (action === 'claim' || action === 'unclaim') {
        if (!isTicketStaff(ctx, ticket)) return ctx.fail('tickets.staff_only');
        ticket.claimedBy = action === 'claim' ? ctx.user.id : null;
        bot.store.touch(ctx.guild.id);
        await ctx.i.deferUpdate();
        await refreshControls(bot, ctx.guild, ticket);
        return ctx.i.channel.send({ embeds: [okEmbed(ctx.tg(action === 'claim' ? 'tickets.claimed' : 'tickets.unclaimed', { user: `${ctx.user}` }))] });
      }
      if (action === 'close') {
        if (ticket.closedAt) return ctx.fail('tickets.already_closed');
        if (ticket.userId !== ctx.user.id && !isTicketStaff(ctx, ticket)) return ctx.fail('tickets.staff_only');
        const modal = new ModalBuilder().setCustomId('ticket:closeform').setTitle(ctx.t('tickets.close_title'))
          .addComponents(row(new TextInputBuilder().setCustomId('reason').setLabel(ctx.t('tickets.reason')).setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(500)));
        return ctx.i.showModal(modal);
      }
      if (action === 'closeform' && ctx.i.isModalSubmit()) {
        if (ticket.closedAt) return ctx.fail('tickets.already_closed');
        await ctx.i.deferReply();
        await closeTicket(bot, ctx.guild, ticket, { by: ctx.user.id, reason: ctx.i.fields.getTextInputValue('reason') });
        return ctx.i.editReply({ embeds: [okEmbed(ctx.tg('tickets.closing'))] });
      }
      if (action === 'reopen') {
        if (!isTicketStaff(ctx, ticket)) return ctx.fail('tickets.staff_only');
        ticket.closedAt = null; ticket.warned = false; ticket.lastActivity = Date.now();
        bot.store.touch(ctx.guild.id);
        bot.scheduler.cancel(ctx.guild.id, t => t.type === 'ticket_delete' && t.data.channelId === ticket.channelId);
        try {
          if (ticket.thread) await ctx.i.channel.setLocked(false);
          else await ctx.i.channel.permissionOverwrites.edit(ticket.userId, { SendMessages: true });
        } catch { /* ignore */ }
        bot.audit(ctx.guild.id, 'ticket_reopen', { number: ticket.number, by: ctx.user.id });
        return ctx.i.update({ embeds: [okEmbed(ctx.tg('tickets.reopened', { user: `${ctx.user}` }))], components: [] });
      }
      if (action === 'delete') {
        if (!isTicketStaff(ctx, ticket)) return ctx.fail('tickets.staff_only');
        if (!(await confirm(ctx, { text: ctx.t('tickets.confirm_delete') }))) return;
        return deleteTicketChannel(bot, ctx.guild, ticket.channelId);
      }
      if (action === 'rate') {
        if (ctx.user.id !== ticket.userId) return ctx.fail('tickets.rate_author_only');
        ticket.rating = Math.min(5, Math.max(1, Number(arg) || 0));
        bot.store.touch(ctx.guild.id);
        bot.audit(ctx.guild.id, 'ticket_rating', { number: ticket.number, rating: ticket.rating });
        await logTicket(bot, ctx.guild, embed(COLORS.info).setDescription(ctx.tg('tickets.log_rating', { number: ticket.number, rating: '⭐'.repeat(ticket.rating) })));
        return ctx.ok('tickets.rated', { rating: '⭐'.repeat(ticket.rating) });
      }
    },
  },
};
