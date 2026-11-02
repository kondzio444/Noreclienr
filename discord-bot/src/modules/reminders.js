/**
 * Reminders: /remind me <when> <text> [here], list, delete. Delivered by DM (or in the channel).
 */
import { opt } from '../core/commands.js';
import { EPHEMERAL } from '../core/ui.js';
import { parseDuration, ts } from '../lib/duration.js';
import { clip } from '../lib/template.js';

export default {
  name: 'reminders',
  timers: {
    async reminder(bot, guildId, { userId, text, channelId, here }) {
      const tg = bot.tg(guildId);
      const content = tg('remind.ping', { user: `<@${userId}>`, text });
      const user = await bot.client.users.fetch(userId).catch(() => null);
      if (!here && user && await user.send({ content }).then(() => true).catch(() => false)) return;
      await bot.send(guildId, channelId, { content, allowedMentions: { users: [userId] } });
    },
  },
  commands: [{
    name: 'remind', category: 'utility',
    subs: {
      me: {
        options: [opt.string('when', true, { max: 30 }), opt.string('text', true, { max: 1000 }), opt.bool('here')],
        async run(ctx) {
          const ms = parseDuration(ctx.str('when'));
          if (!ms || ms < 30_000 || ms > 365 * 86_400_000) return ctx.fail('remind.bad_time');
          const mine = ctx.bot.scheduler.list(ctx.guild.id, t => t.type === 'reminder' && t.data.userId === ctx.user.id);
          if (mine.length >= ctx.cfg.reminders.maxPerUser) return ctx.fail('remind.too_many', { count: ctx.cfg.reminders.maxPerUser });
          const at = Date.now() + ms;
          ctx.bot.scheduler.add(ctx.guild.id, 'reminder', at, { userId: ctx.user.id, text: ctx.str('text'), channelId: ctx.i.channelId, here: !!ctx.bool('here') });
          return ctx.ok('remind.set', { when: ts(at), date: ts(at, 'f') });
        },
      },
      list: {
        async run(ctx) {
          const mine = ctx.bot.scheduler.list(ctx.guild.id, t => t.type === 'reminder' && t.data.userId === ctx.user.id).sort((a, b) => a.at - b.at);
          const lines = mine.map((t, i) => `**${i + 1}.** ${ts(t.at)} – ${clip(t.data.text, 100)} \`${t.id.slice(0, 8)}\``);
          return ctx.reply({ embeds: [ctx.bot.embed(ctx.guild.id).setTitle(ctx.t('remind.list_title')).setDescription(lines.join('\n') || ctx.t('remind.none'))], flags: EPHEMERAL });
        },
      },
      delete: {
        options: [opt.string('id', true, { autocomplete: true })],
        autocomplete: (ctx) => ctx.bot.scheduler.list(ctx.guild.id, t => t.type === 'reminder' && t.data.userId === ctx.user.id).map(t => ({ name: clip(`${new Date(t.at).toISOString().slice(0, 16)} ${t.data.text}`, 100), value: t.id })),
        async run(ctx) {
          const id = ctx.str('id');
          const n = ctx.bot.scheduler.cancel(ctx.guild.id, t => t.type === 'reminder' && t.data.userId === ctx.user.id && (t.id === id || t.id.startsWith(id)));
          return n ? ctx.ok('remind.deleted') : ctx.fail('remind.not_found');
        },
      },
    },
  }],
};
