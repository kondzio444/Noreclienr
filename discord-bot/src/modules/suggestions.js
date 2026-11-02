/**
 * Suggestions ("propozycje"): text channel or forum, live up/down vote buttons, a thread per
 * suggestion, statuses set by staff with a reason (new → considering → accepted / rejected →
 * implemented), DM to the author, anonymous option, categories, cooldown, top list, staff review
 * queue (optional pre-moderation).
 */
import { ChannelType, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';
import { opt } from '../core/commands.js';
import { EPHEMERAL, row, button, okEmbed, COLORS, embed } from '../core/ui.js';
import { clip } from '../lib/template.js';
import { ts } from '../lib/duration.js';

export const STATUSES = ['new', 'considering', 'accepted', 'rejected', 'implemented'];
const STATUS_ICON = { pending: '🕓', new: '💡', considering: '🤔', accepted: '✅', rejected: '❌', implemented: '🚀' };
const STATUS_COLOR = { pending: COLORS.muted, new: COLORS.brand, considering: COLORS.info, accepted: COLORS.ok, rejected: COLORS.error, implemented: 0xc8a8ff };

const state = (bot, gid) => bot.store.ns(gid, 'suggestions', () => ({ next: 1, items: {}, cooldowns: {} }));
const score = (s) => s.votes.up.length - s.votes.down.length;

function catOf(cfg, id) { return cfg.suggestions.categories.find(c => c.id === id) || null; }

function suggestionEmbed(bot, guild, s) {
  const tg = bot.tg(guild.id);
  const cfg = bot.cfg(guild.id);
  const cat = catOf(cfg, s.category);
  const up = s.votes.up.length, down = s.votes.down.length, total = up + down;
  const pct = total ? Math.round((up / total) * 100) : 0;
  const e = embed(STATUS_COLOR[s.status]).setTitle(`${STATUS_ICON[s.status]} #${s.id} · ${clip(s.title, 230)}`)
    .setDescription(clip(s.text, 3500))
    .addFields(
      { name: tg('sug.status'), value: `${STATUS_ICON[s.status]} ${tg(`sug.st.${s.status}`)}`, inline: true },
      { name: tg('sug.votes'), value: `👍 ${up} · 👎 ${down} · ${pct}%`, inline: true },
    )
    .setTimestamp(s.createdAt);
  if (cat) e.addFields({ name: tg('sug.category'), value: `${cat.emoji || ''} ${cat.label}`, inline: true });
  if (s.anonymous) e.setAuthor({ name: tg('sug.anonymous') });
  else e.setAuthor({ name: s.authorName || s.userId, iconURL: s.authorAvatar || undefined });
  const last = s.history.at(-1);
  if (last?.reason) e.addFields({ name: tg('sug.staff_reason'), value: `${clip(last.reason, 1000)}\n-# <@${last.by}> ${ts(last.at)}` });
  return e;
}

function voteRow(bot, guildId, s) {
  const closed = s.status === 'rejected' || s.status === 'implemented';
  return row(
    button(`sug:up:${s.id}`, String(s.votes.up.length), ButtonStyle.Success, '👍').setDisabled(closed),
    button(`sug:down:${s.id}`, String(s.votes.down.length), ButtonStyle.Danger, '👎').setDisabled(closed),
  );
}

async function publish(bot, guild, s) {
  const cfg = bot.cfg(guild.id).suggestions;
  const tg = bot.tg(guild.id);
  const ch = await bot.channel(guild, cfg.channel);
  if (!ch) return null;
  const payload = { embeds: [suggestionEmbed(bot, guild, s)], components: [voteRow(bot, guild.id, s)] };
  if (ch.type === ChannelType.GuildForum) {
    const tag = ch.availableTags.find(t => t.name.toLowerCase().includes(tg(`sug.st.${s.status}`).toLowerCase()));
    const thread = await ch.threads.create({ name: clip(`#${s.id} ${s.title}`, 100), message: payload, appliedTags: tag ? [tag.id] : [] });
    s.channelId = thread.id; s.messageId = thread.id; s.threadId = thread.id; s.forum = true;
  } else {
    const msg = await bot.send(guild, ch.id, payload);
    if (!msg) return null;
    s.channelId = ch.id; s.messageId = msg.id;
    if (cfg.threads) {
      const th = await msg.startThread({ name: clip(`#${s.id} ${s.title}`, 100), autoArchiveDuration: 10080 }).catch(() => null);
      if (th) s.threadId = th.id;
    }
  }
  bot.store.touch(guild.id);
  return s;
}

async function refresh(bot, guild, s) {
  const ch = await bot.channel(guild, s.channelId);
  if (!ch) return;
  const msg = s.forum ? await ch.fetchStarterMessage().catch(() => null) : await ch.messages.fetch(s.messageId).catch(() => null);
  if (msg) await msg.edit({ embeds: [suggestionEmbed(bot, guild, s)], components: [voteRow(bot, guild.id, s)] }).catch(() => {});
  if (s.forum && ch.parent?.availableTags) {
    const tg = bot.tg(guild.id);
    const tag = ch.parent.availableTags.find(t => t.name.toLowerCase().includes(tg(`sug.st.${s.status}`).toLowerCase()));
    if (tag) await ch.setAppliedTags([tag.id]).catch(() => {});
    if (s.status === 'rejected' || s.status === 'implemented') await ch.setLocked(true).catch(() => {});
  }
}

async function setStatus(bot, guild, s, status, by, reason) {
  const prev = s.status;
  s.status = status;
  s.history.push({ status, by, reason: reason || null, at: Date.now() });
  bot.store.touch(guild.id);
  if (prev === 'pending' && status !== 'rejected') await publish(bot, guild, s);
  else await refresh(bot, guild, s);
  bot.audit(guild.id, 'suggestion_status', { id: s.id, status, by });
  const cfg = bot.cfg(guild.id).suggestions;
  if (cfg.dmOnStatus) {
    const tg = bot.tg(guild.id);
    const user = await bot.client.users.fetch(s.userId).catch(() => null);
    await user?.send({ embeds: [embed(STATUS_COLOR[status]).setTitle(tg('sug.dm_title', { id: s.id, server: guild.name }))
      .setDescription(tg('sug.dm_text', { title: s.title, status: `${STATUS_ICON[status]} ${tg(`sug.st.${status}`)}`, reason: reason || '—' }))] }).catch(() => {});
  }
}

function modalFor(ctx, category = '', anonymous = false) {
  return new ModalBuilder().setCustomId(`sug:submit:${category || '-'}:${anonymous ? 1 : 0}`).setTitle(ctx.t('sug.modal_title'))
    .addComponents(
      row(new TextInputBuilder().setCustomId('title').setLabel(ctx.t('sug.field_title')).setStyle(TextInputStyle.Short).setMaxLength(100).setRequired(true)),
      row(new TextInputBuilder().setCustomId('text').setLabel(ctx.t('sug.field_text')).setStyle(TextInputStyle.Paragraph).setMaxLength(2000).setRequired(true)),
    );
}

function checkCooldown(ctx) {
  const cfg = ctx.cfg.suggestions;
  if (!cfg.enabled || !cfg.channel) return 'sug.not_configured';
  const st = state(ctx.bot, ctx.guild.id);
  const last = st.cooldowns[ctx.user.id] || 0;
  if (cfg.cooldownMinutes && Date.now() - last < cfg.cooldownMinutes * 60_000 && !ctx.isStaff(cfg.staffRoles)) return { key: 'sug.cooldown', vars: { when: ts(last + cfg.cooldownMinutes * 60_000) } };
  return null;
}

async function submit(ctx, category, anonymous) {
  const bot = ctx.bot;
  const cfg = ctx.cfg.suggestions;
  const st = state(bot, ctx.guild.id);
  await ctx.defer();
  const s = {
    id: st.next++, userId: ctx.user.id, authorName: ctx.member.displayName, authorAvatar: ctx.user.displayAvatarURL({ size: 64 }),
    anonymous: !!(anonymous && cfg.allowAnonymous), title: ctx.i.fields.getTextInputValue('title').trim(), text: ctx.i.fields.getTextInputValue('text').trim(),
    category: category && category !== '-' ? category : null, status: cfg.requireReview ? 'pending' : 'new', votes: { up: [], down: [] }, createdAt: Date.now(), history: [],
  };
  st.items[s.id] = s;
  st.cooldowns[ctx.user.id] = Date.now();
  bot.store.touch(ctx.guild.id);
  if (cfg.requireReview && cfg.reviewChannel) {
    const tg = ctx.tg;
    await bot.send(ctx.guild, cfg.reviewChannel, {
      content: tg('sug.review_new', { id: s.id }),
      embeds: [suggestionEmbed(bot, ctx.guild, s).setFooter({ text: `${ctx.user.tag || ctx.user.username} · ${ctx.user.id}` })],
      components: [row(button(`sug:approve:${s.id}`, tg('sug.approve'), ButtonStyle.Success, '✅'), button(`sug:reject:${s.id}`, tg('sug.reject'), ButtonStyle.Danger, '❌'))],
    });
    bot.audit(ctx.guild.id, 'suggestion_new', { id: s.id, pending: true });
    return ctx.reply({ embeds: [okEmbed(ctx.t('sug.sent_review', { id: s.id }))] });
  }
  if (!(await publish(bot, ctx.guild, s))) return ctx.reply({ embeds: [okEmbed(ctx.t('errors.cannot_send', { channel: `<#${cfg.channel}>` }))] });
  bot.audit(ctx.guild.id, 'suggestion_new', { id: s.id });
  return ctx.reply({ embeds: [okEmbed(ctx.t('sug.sent', { id: s.id, url: `https://discord.com/channels/${ctx.guild.id}/${s.channelId}/${s.forum ? '' : s.messageId}` }))] });
}

const idOpt = () => opt.int('id', true, { min: 1, autocomplete: true });
function idAutocomplete(ctx) {
  const q = String(ctx.i.options.getFocused() || '');
  return Object.values(state(ctx.bot, ctx.guild.id).items).filter(s => String(s.id).startsWith(q) || s.title.toLowerCase().includes(q.toLowerCase()))
    .slice(-25).reverse().map(s => ({ name: `#${s.id} ${STATUS_ICON[s.status]} ${s.title}`, value: s.id }));
}

export default {
  name: 'suggestions',
  commands: [
    {
      name: 'suggest', category: 'community',
      options: [opt.string('category', false, { autocomplete: true }), opt.bool('anonymous')],
      autocomplete: (ctx) => ctx.cfg.suggestions.categories.map(c => ({ name: `${c.emoji || ''} ${c.label || c.id}`.trim(), value: c.id })),
      async run(ctx) {
        const err = checkCooldown(ctx);
        if (err) return typeof err === 'string' ? ctx.fail(err) : ctx.fail(err.key, err.vars);
        return ctx.i.showModal(modalFor(ctx, ctx.str('category'), ctx.bool('anonymous')));
      },
    },
    {
      name: 'suggestion', category: 'community',
      allowRoles: (cfg) => cfg.suggestions.staffRoles,
      subs: {
        status: {
          perms: ['ManageMessages'],
          options: [idOpt(), opt.string('status', true, { choices: { values: STATUSES, key: (v) => `sug.st.${v}` } }), opt.string('reason', false, { max: 1000 })],
          autocomplete: idAutocomplete,
          async run(ctx) {
            const s = state(ctx.bot, ctx.guild.id).items[ctx.int('id')];
            if (!s) return ctx.fail('sug.not_found');
            await ctx.defer();
            await setStatus(ctx.bot, ctx.guild, s, ctx.str('status'), ctx.user.id, ctx.str('reason'));
            return ctx.reply({ embeds: [okEmbed(ctx.t('sug.status_set', { id: s.id, status: ctx.t(`sug.st.${s.status}`) }))] });
          },
        },
        top: {
          options: [opt.string('period', false, { choices: { set: 'period', values: ['week', 'month', 'all'] } })],
          async run(ctx) {
            const period = ctx.str('period') || 'all';
            const since = period === 'week' ? Date.now() - 7 * 86_400_000 : period === 'month' ? Date.now() - 30 * 86_400_000 : 0;
            const list = Object.values(state(ctx.bot, ctx.guild.id).items).filter(s => s.status !== 'pending' && s.createdAt >= since).sort((a, b) => score(b) - score(a)).slice(0, 10);
            const lines = list.map((s, n) => `**${n + 1}.** ${STATUS_ICON[s.status]} [#${s.id} ${clip(s.title, 60)}](https://discord.com/channels/${ctx.guild.id}/${s.channelId}${s.forum ? '' : '/' + s.messageId}) · **${score(s) > 0 ? '+' : ''}${score(s)}** (👍 ${s.votes.up.length} 👎 ${s.votes.down.length})`);
            return ctx.reply({ embeds: [ctx.bot.embed(ctx.guild.id).setTitle(ctx.t('sug.top_title', { period: ctx.t(`choice.period.${period}`) })).setDescription(lines.join('\n') || ctx.t('sug.none'))] });
          },
        },
        queue: {
          perms: ['ManageMessages'],
          async run(ctx) {
            const list = Object.values(state(ctx.bot, ctx.guild.id).items).filter(s => ['pending', 'new', 'considering'].includes(s.status)).sort((a, b) => a.createdAt - b.createdAt).slice(0, 25);
            const lines = list.map(s => `${STATUS_ICON[s.status]} **#${s.id}** ${clip(s.title, 70)} · ${score(s) >= 0 ? '+' : ''}${score(s)} · ${ts(s.createdAt)}`);
            return ctx.reply({ embeds: [ctx.bot.embed(ctx.guild.id).setTitle(ctx.t('sug.queue_title', { count: list.length })).setDescription(lines.join('\n') || ctx.t('sug.none'))], flags: EPHEMERAL });
          },
        },
        panel: {
          perms: ['ManageGuild'],
          options: [opt.channel('channel', false, { channelTypes: ['text'] })],
          async run(ctx) {
            const ch = ctx.channelOpt('channel') || ctx.i.channel;
            const msg = await ctx.bot.send(ctx.guild, ch.id, panelPayload(ctx.bot, ctx.guild.id));
            return msg ? ctx.ok('sug.panel_sent', { url: msg.url }) : ctx.fail('errors.cannot_send', { channel: `${ch}` });
          },
        },
      },
    },
  ],
  components: {
    async sug(ctx, [action, id, extra]) {
      const bot = ctx.bot;
      if (action === 'new') {
        const err = checkCooldown(ctx);
        if (err) return typeof err === 'string' ? ctx.fail(err) : ctx.fail(err.key, err.vars);
        return ctx.i.showModal(modalFor(ctx));
      }
      if (action === 'submit' && ctx.i.isModalSubmit()) return submit(ctx, id, extra === '1');
      const s = state(bot, ctx.guild.id).items[Number(id)];
      if (!s) return ctx.fail('sug.not_found');
      if (action === 'up' || action === 'down') {
        const other = action === 'up' ? 'down' : 'up';
        s.votes[other] = s.votes[other].filter(u => u !== ctx.user.id);
        if (s.votes[action].includes(ctx.user.id)) s.votes[action] = s.votes[action].filter(u => u !== ctx.user.id);
        else s.votes[action].push(ctx.user.id);
        bot.store.touch(ctx.guild.id);
        return ctx.i.update({ embeds: [suggestionEmbed(bot, ctx.guild, s)], components: [voteRow(bot, ctx.guild.id, s)] });
      }
      if (!ctx.isStaff(ctx.cfg.suggestions.staffRoles) && !ctx.member.permissions.has('ManageMessages')) return ctx.fail('sug.staff_only');
      if (action === 'approve') {
        await ctx.i.deferUpdate();
        await setStatus(bot, ctx.guild, s, 'new', ctx.user.id, null);
        return ctx.i.editReply({ content: ctx.tg('sug.review_approved', { id: s.id, user: `${ctx.user}` }), components: [] });
      }
      if (action === 'reject') {
        const modal = new ModalBuilder().setCustomId(`sug:rejectform:${s.id}`).setTitle(ctx.t('sug.reject'))
          .addComponents(row(new TextInputBuilder().setCustomId('reason').setLabel(ctx.t('sug.staff_reason')).setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(1000)));
        return ctx.i.showModal(modal);
      }
      if (action === 'rejectform' && ctx.i.isModalSubmit()) {
        await ctx.i.deferUpdate();
        await setStatus(bot, ctx.guild, s, 'rejected', ctx.user.id, ctx.i.fields.getTextInputValue('reason'));
        return ctx.i.editReply({ content: ctx.tg('sug.review_rejected', { id: s.id, user: `${ctx.user}` }), components: [] }).catch(() => {});
      }
    },
  },
};

export function panelPayload(bot, guildId) {
  const tg = bot.tg(guildId);
  return {
    embeds: [bot.embed(guildId).setTitle(tg('sug.panel_title')).setDescription(tg('sug.panel_text'))],
    components: [row(button('sug:new', tg('sug.panel_button'), ButtonStyle.Primary, '💡'))],
  };
}
