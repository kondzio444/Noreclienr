/**
 * Polls with buttons (2–10 options), single or multiple choice, anonymous results bar chart,
 * timed end (or /poll end).
 */
import { ButtonStyle } from 'discord.js';
import { opt } from '../core/commands.js';
import { EPHEMERAL, rows, button, okEmbed, COLORS, embed } from '../core/ui.js';
import { parseDuration, ts } from '../lib/duration.js';
import { clip } from '../lib/template.js';

const NUM = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];
const state = (bot, gid) => bot.store.ns(gid, 'polls', () => ({ next: 1, items: {} }));

/** Counts per option and the total number of voters. */
export function tally(poll) {
  const counts = poll.options.map(() => 0);
  for (const choices of Object.values(poll.votes)) for (const c of choices) if (counts[c] !== undefined) counts[c]++;
  return { counts, voters: Object.keys(poll.votes).length };
}

function pEmbed(bot, guildId, p) {
  const tg = bot.tg(guildId);
  const { counts, voters } = tally(p);
  const total = counts.reduce((a, b) => a + b, 0);
  const lines = p.options.map((o, i) => {
    const pct = total ? Math.round((counts[i] / total) * 100) : 0;
    const bar = '█'.repeat(Math.round(pct / 10)) + '░'.repeat(10 - Math.round(pct / 10));
    return `${NUM[i]} **${clip(o, 80)}**\n\`${bar}\` ${pct}% (${counts[i]})`;
  });
  return embed(p.endedAt ? COLORS.muted : COLORS.brand).setTitle(`📊 ${clip(p.question, 240)}`).setDescription(lines.join('\n'))
    .addFields({ name: tg('poll.info'), value: [p.multi ? tg('poll.multi') : tg('poll.single'), p.endedAt ? tg('poll.ended', { when: ts(p.endedAt) }) : p.endsAt ? tg('poll.ends', { when: ts(p.endsAt) }) : null, tg('poll.voters', { count: voters })].filter(Boolean).join(' · ') })
    .setFooter({ text: tg('poll.by', { user: p.authorName }) });
}

const pRows = (p) => rows(p.options.map((o, i) => button(`poll:v:${p.id}:${i}`, clip(o, 70), ButtonStyle.Secondary, NUM[i]).setDisabled(!!p.endedAt)));

async function end(bot, guild, p) {
  p.endedAt = Date.now();
  bot.store.touch(guild.id);
  const ch = await bot.channel(guild, p.channelId);
  const msg = ch ? await ch.messages.fetch(p.messageId).catch(() => null) : null;
  if (msg) await msg.edit({ embeds: [pEmbed(bot, guild.id, p)], components: pRows(p) }).catch(() => {});
}

export default {
  name: 'polls',
  timers: {
    async poll_end(bot, guildId, { id }) {
      const guild = bot.client.guilds.cache.get(guildId);
      const p = guild && state(bot, guildId).items[id];
      if (p && !p.endedAt) await end(bot, guild, p);
    },
  },
  commands: [{
    name: 'poll', category: 'community',
    subs: {
      create: {
        options: [opt.string('question', true, { max: 240 }), opt.string('options', true, { max: 1000 }), opt.string('duration', false, { max: 20 }), opt.bool('multiple')],
        async run(ctx) {
          const options = ctx.str('options').split(/[|;\n]/).map(s => s.trim()).filter(Boolean).slice(0, 10);
          if (options.length < 2) return ctx.fail('poll.need_options');
          let endsAt = null;
          if (ctx.str('duration')) {
            const ms = parseDuration(ctx.str('duration'));
            if (!ms || ms < 60_000 || ms > 30 * 86_400_000) return ctx.fail('poll.bad_duration');
            endsAt = Date.now() + ms;
          }
          const st = state(ctx.bot, ctx.guild.id);
          const p = { id: st.next++, question: ctx.str('question'), options, multi: !!ctx.bool('multiple'), votes: {}, author: ctx.user.id, authorName: ctx.member.displayName, endsAt, endedAt: null };
          await ctx.reply({ embeds: [pEmbed(ctx.bot, ctx.guild.id, p)], components: pRows(p) });
          const msg = await ctx.i.fetchReply();
          p.channelId = msg.channelId; p.messageId = msg.id;
          st.items[p.id] = p;
          const ids = Object.keys(st.items).map(Number).sort((a, b) => a - b);
          for (const old of ids.slice(0, Math.max(0, ids.length - 200))) delete st.items[old];
          ctx.bot.store.touch(ctx.guild.id);
          if (endsAt) ctx.bot.scheduler.add(ctx.guild.id, 'poll_end', endsAt, { id: p.id });
        },
      },
      end: {
        options: [opt.int('id', true, { min: 1, autocomplete: true })],
        autocomplete: (ctx) => Object.values(state(ctx.bot, ctx.guild.id).items).filter(p => !p.endedAt).slice(-25).map(p => ({ name: `#${p.id} ${p.question}`, value: p.id })),
        async run(ctx) {
          const p = state(ctx.bot, ctx.guild.id).items[ctx.int('id')];
          if (!p) return ctx.fail('poll.not_found');
          if (p.author !== ctx.user.id && !ctx.member.permissions.has('ManageMessages')) return ctx.fail('poll.not_author');
          ctx.bot.scheduler.cancel(ctx.guild.id, t => t.type === 'poll_end' && t.data.id === p.id);
          await end(ctx.bot, ctx.guild, p);
          return ctx.ok('poll.closed');
        },
      },
    },
  }],
  components: {
    async poll(ctx, [, id, idx]) {
      const p = state(ctx.bot, ctx.guild.id).items[Number(id)];
      if (!p) return ctx.fail('poll.not_found');
      if (p.endedAt) return ctx.fail('poll.is_ended');
      const i = Number(idx);
      const mine = new Set(p.votes[ctx.user.id] || []);
      if (mine.has(i)) mine.delete(i); else { if (!p.multi) mine.clear(); mine.add(i); }
      if (mine.size) p.votes[ctx.user.id] = [...mine]; else delete p.votes[ctx.user.id];
      ctx.bot.store.touch(ctx.guild.id);
      await ctx.i.update({ embeds: [pEmbed(ctx.bot, ctx.guild.id, p)], components: pRows(p) });
      return ctx.i.followUp({ embeds: [okEmbed(mine.size ? ctx.t('poll.voted', { options: [...mine].map(x => NUM[x]).join(' ') }) : ctx.t('poll.unvoted'))], flags: EPHEMERAL });
    },
  },
};
