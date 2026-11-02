/**
 * Giveaways: enter/leave button with live count, timed end, optional required role, reroll, list.
 */
import { ButtonStyle } from 'discord.js';
import { randomInt } from 'node:crypto';
import { opt } from '../core/commands.js';
import { EPHEMERAL, row, button, okEmbed, COLORS, embed } from '../core/ui.js';
import { parseDuration, ts } from '../lib/duration.js';
import { clip } from '../lib/template.js';

const state = (bot, gid) => bot.store.ns(gid, 'giveaways', () => ({ next: 1, items: {} }));

/** Picks `n` distinct winners from `entries` (crypto random). */
export function pickWinners(entries, n, rnd = randomInt) {
  const pool = [...new Set(entries)];
  const out = [];
  while (pool.length && out.length < n) out.push(pool.splice(rnd(0, pool.length), 1)[0]);
  return out;
}

function gEmbed(bot, guildId, g) {
  const tg = bot.tg(guildId);
  const ended = !!g.endedAt;
  const e = embed(ended ? COLORS.muted : COLORS.brand).setTitle(`🎁 ${clip(g.prize, 240)}`)
    .setDescription([
      g.description ? clip(g.description, 1500) : null,
      ended ? tg('give.ended_at', { when: ts(g.endedAt) }) : tg('give.ends', { when: ts(g.endsAt), date: ts(g.endsAt, 'f') }),
      tg('give.host', { user: `<@${g.host}>` }),
      tg('give.winners_count', { count: g.winners }),
      g.requiredRole ? tg('give.required_role', { role: `<@&${g.requiredRole}>` }) : null,
      ended ? `\n**${tg('give.winners')}:** ${g.result?.length ? g.result.map(u => `<@${u}>`).join(', ') : tg('give.no_winners')}` : null,
    ].filter(Boolean).join('\n'))
    .setFooter({ text: tg('give.entries', { count: g.entries.length }) });
  return e;
}

const gRow = (bot, guildId, g) => row(button(`give:enter:${g.id}`, bot.tg(guildId)('give.enter'), ButtonStyle.Success, '🎉').setDisabled(!!g.endedAt));

async function end(bot, guild, g, reroll = false) {
  const tg = bot.tg(guild.id);
  const pool = reroll ? g.entries.filter(u => !(g.result || []).includes(u)) : g.entries;
  const winners = pickWinners(pool, g.winners);
  g.result = winners;
  g.endedAt = g.endedAt || Date.now();
  bot.store.touch(guild.id);
  const ch = await bot.channel(guild, g.channelId);
  const msg = ch ? await ch.messages.fetch(g.messageId).catch(() => null) : null;
  if (msg) await msg.edit({ embeds: [gEmbed(bot, guild.id, g)], components: [gRow(bot, guild.id, g)] }).catch(() => {});
  if (ch) {
    await ch.send({
      content: winners.length ? tg(reroll ? 'give.rerolled' : 'give.congrats', { users: winners.map(u => `<@${u}>`).join(', '), prize: g.prize }) : tg('give.nobody', { prize: g.prize }),
      allowedMentions: { users: winners },
      reply: msg ? { messageReference: msg.id, failIfNotExists: false } : undefined,
    }).catch(() => {});
  }
  bot.audit(guild.id, 'giveaway_end', { id: g.id, winners, reroll });
  return winners;
}

const idOpt = () => opt.int('id', true, { min: 1, autocomplete: true });
const idAuto = (ctx) => Object.values(state(ctx.bot, ctx.guild.id).items).slice(-25).reverse().map(g => ({ name: `#${g.id} ${g.endedAt ? '✔️' : '⏳'} ${g.prize}`, value: g.id }));

export default {
  name: 'giveaways',
  timers: {
    async giveaway_end(bot, guildId, { id }) {
      const guild = bot.client.guilds.cache.get(guildId);
      const g = guild && state(bot, guildId).items[id];
      if (g && !g.endedAt) await end(bot, guild, g);
    },
  },
  commands: [{
    name: 'giveaway', category: 'community', perms: ['ManageGuild'],
    allowRoles: (cfg) => cfg.giveaways.managerRoles,
    subs: {
      start: {
        options: [opt.string('prize', true, { max: 200 }), opt.string('duration', true, { max: 20 }), opt.int('winners', false, { min: 1, max: 50 }), opt.channel('channel', false, { channelTypes: ['text', 'announcement'] }), opt.role('required_role'), opt.string('description', false, { max: 1500 })],
        async run(ctx) {
          const ms = parseDuration(ctx.str('duration'));
          if (!ms || ms < 30_000 || ms > 60 * 86_400_000) return ctx.fail('give.bad_duration');
          const st = state(ctx.bot, ctx.guild.id);
          const g = { id: st.next++, prize: ctx.str('prize'), description: ctx.str('description') || '', winners: ctx.int('winners') || 1, host: ctx.user.id, endsAt: Date.now() + ms, entries: [], requiredRole: ctx.roleOpt('required_role')?.id || null, result: null, endedAt: null };
          const ch = ctx.channelOpt('channel') || ctx.i.channel;
          const ping = ctx.cfg.giveaways.pingRole;
          const msg = await ctx.bot.send(ctx.guild, ch.id, { content: ping ? `<@&${ping}>` : undefined, embeds: [gEmbed(ctx.bot, ctx.guild.id, g)], components: [gRow(ctx.bot, ctx.guild.id, g)], allowedMentions: { roles: ping ? [ping] : [] } });
          if (!msg) return ctx.fail('errors.cannot_send', { channel: `${ch}` });
          g.channelId = ch.id; g.messageId = msg.id;
          st.items[g.id] = g;
          ctx.bot.store.touch(ctx.guild.id);
          ctx.bot.scheduler.add(ctx.guild.id, 'giveaway_end', g.endsAt, { id: g.id });
          ctx.bot.audit(ctx.guild.id, 'giveaway_start', { id: g.id, prize: g.prize, by: ctx.user.id });
          return ctx.ok('give.started', { url: msg.url });
        },
      },
      end: {
        options: [idOpt()], autocomplete: idAuto,
        async run(ctx) {
          const g = state(ctx.bot, ctx.guild.id).items[ctx.int('id')];
          if (!g) return ctx.fail('give.not_found');
          if (g.endedAt) return ctx.fail('give.already_ended');
          ctx.bot.scheduler.cancel(ctx.guild.id, t => t.type === 'giveaway_end' && t.data.id === g.id);
          await ctx.defer();
          const w = await end(ctx.bot, ctx.guild, g);
          return ctx.reply({ embeds: [okEmbed(ctx.t('give.ended', { count: w.length }))] });
        },
      },
      reroll: {
        options: [idOpt()], autocomplete: idAuto,
        async run(ctx) {
          const g = state(ctx.bot, ctx.guild.id).items[ctx.int('id')];
          if (!g) return ctx.fail('give.not_found');
          if (!g.endedAt) return ctx.fail('give.not_ended');
          await ctx.defer();
          const w = await end(ctx.bot, ctx.guild, g, true);
          return ctx.reply({ embeds: [okEmbed(ctx.t('give.rerolled_ok', { count: w.length }))] });
        },
      },
      list: {
        async run(ctx) {
          const items = Object.values(state(ctx.bot, ctx.guild.id).items).filter(g => !g.endedAt);
          const lines = items.map(g => `**#${g.id}** ${clip(g.prize, 80)} · ${ts(g.endsAt)} · ${g.entries.length} 🎟️ · [↗](https://discord.com/channels/${ctx.guild.id}/${g.channelId}/${g.messageId})`);
          return ctx.reply({ embeds: [ctx.bot.embed(ctx.guild.id).setTitle(ctx.t('give.list_title')).setDescription(lines.join('\n') || ctx.t('give.none'))], flags: EPHEMERAL });
        },
      },
    },
  }],
  components: {
    async give(ctx, [action, id]) {
      const g = state(ctx.bot, ctx.guild.id).items[Number(id)];
      if (!g || action !== 'enter') return ctx.fail('give.not_found');
      if (g.endedAt) return ctx.fail('give.already_ended');
      if (g.requiredRole && !ctx.member.roles.cache.has(g.requiredRole)) return ctx.fail('give.need_role', { role: `<@&${g.requiredRole}>` });
      const had = g.entries.includes(ctx.user.id);
      g.entries = had ? g.entries.filter(u => u !== ctx.user.id) : [...g.entries, ctx.user.id];
      ctx.bot.store.touch(ctx.guild.id);
      await ctx.i.update({ embeds: [gEmbed(ctx.bot, ctx.guild.id, g)], components: [gRow(ctx.bot, ctx.guild.id, g)] });
      return ctx.i.followUp({ embeds: [okEmbed(ctx.t(had ? 'give.left' : 'give.entered'))], flags: EPHEMERAL });
    },
  },
};
