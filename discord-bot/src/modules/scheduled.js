/**
 * Scheduled messages (config.scheduled.messages): every N minutes, daily at HH:MM or weekly,
 * in the guild's time zone. Managed by /schedule.
 */
import { opt } from '../core/commands.js';
import { EPHEMERAL } from '../core/ui.js';
import { clip } from '../lib/template.js';
import { ts } from '../lib/duration.js';

/** Wall-clock parts of `now` in a time zone (falls back to UTC for unknown zones). */
export function zoned(now, timeZone) {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone, hour12: false, weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date(now));
    const get = (t) => parts.find(p => p.type === t)?.value;
    const wd = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[get('weekday')];
    return { date: `${get('year')}-${get('month')}-${get('day')}`, hm: `${get('hour') === '24' ? '00' : get('hour')}:${get('minute')}`, weekday: wd };
  } catch { return zoned(now, 'UTC'); }
}

/** Is the scheduled message due now? `last` = last run (ms). Pure, unit-tested. */
export function isDue(msg, now, last, timeZone) {
  if (msg.mode === 'interval') return !last || now - last >= msg.everyMinutes * 60_000;
  const z = zoned(now, timeZone);
  const late = minutesBetween(msg.time, z.hm); // grace window of 5 minutes for a missed tick
  if (late < 0 || late > 5) return false;
  if (msg.mode === 'weekly' && z.weekday !== msg.weekday) return false;
  return !last || zoned(last, timeZone).date !== z.date;
}

function minutesBetween(a, b) {
  const m = (s) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3));
  return m(b) - m(a);
}

const lastRuns = (bot, gid) => bot.store.ns(gid, 'scheduled', () => ({}));

export default {
  name: 'scheduled',
  ready(bot) {
    bot.every(60_000, async () => {
      const now = Date.now();
      for (const guild of bot.client.guilds.cache.values()) {
        const cfg = bot.cfg(guild.id);
        if (!cfg.scheduled.enabled) continue;
        const runs = lastRuns(bot, guild.id);
        for (const [i, m] of cfg.scheduled.messages.entries()) {
          const key = m.id || `#${i}`;
          if (!m.channel || !m.content || !isDue(m, now, runs[key], cfg.general.timezone)) continue;
          runs[key] = now;
          bot.store.touch(guild.id);
          await bot.send(guild, m.channel, m.embed ? { embeds: [bot.embed(guild.id).setDescription(m.content)] } : { content: m.content, allowedMentions: { parse: ['roles', 'users'] } });
        }
      }
    }, 'scheduled');
  },
  commands: [{
    name: 'schedule', category: 'automation', module: null, perms: ['ManageGuild'],
    subs: {
      add: {
        options: [
          opt.channel('channel', true, { channelTypes: ['text', 'announcement'] }), opt.string('content', true, { max: 2000 }),
          opt.string('mode', true, { choices: { values: ['interval', 'daily', 'weekly'], key: (v) => `panel.options.scheduleModes.${v}` } }),
          opt.string('time', false, { max: 5 }), opt.int('every_minutes', false, { min: 10, max: 43200 }),
          opt.int('weekday', false, { choices: { values: [1, 2, 3, 4, 5, 6, 0], key: (v) => `panel.options.weekdays.${v}` } }), opt.bool('embed'),
        ],
        async run(ctx) {
          const time = ctx.str('time') || '12:00';
          if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return ctx.fail('sched.bad_time');
          const list = structuredClone(ctx.cfg.scheduled.messages);
          const id = `m${Date.now().toString(36)}`;
          list.push({ id, channel: ctx.channelOpt('channel').id, content: ctx.str('content').replace(/\\n/g, '\n'), embed: !!ctx.bool('embed'), mode: ctx.str('mode'), everyMinutes: ctx.int('every_minutes') || 60, time, weekday: ctx.int('weekday') ?? 1 });
          const res = ctx.bot.config.set(ctx.guild.id, 'scheduled.messages', list, { by: ctx.user.id });
          if (!res.ok) return ctx.fail('sched.limit');
          if (!ctx.cfg.scheduled.enabled) ctx.bot.config.set(ctx.guild.id, 'scheduled.enabled', true, { by: ctx.user.id });
          return ctx.ok('sched.added', { id });
        },
      },
      list: {
        async run(ctx) {
          const runs = lastRuns(ctx.bot, ctx.guild.id);
          const lines = ctx.cfg.scheduled.messages.map((m, i) => `**${m.id || `#${i}`}** · <#${m.channel}> · ${ctx.t(`panel.options.scheduleModes.${m.mode}`)} ${m.mode === 'interval' ? `${m.everyMinutes} min` : m.time}${m.mode === 'weekly' ? ` (${ctx.t(`panel.options.weekdays.${m.weekday}`)})` : ''}${runs[m.id] ? ` · ${ts(runs[m.id])}` : ''}\n${clip(m.content.replace(/\n/g, ' '), 80)}`);
          return ctx.reply({ embeds: [ctx.bot.embed(ctx.guild.id).setTitle(ctx.t('sched.list_title')).setDescription(lines.join('\n') || ctx.t('sched.none')).setFooter({ text: ctx.cfg.general.timezone })], flags: EPHEMERAL });
        },
      },
      remove: {
        options: [opt.string('id', true, { autocomplete: true })],
        autocomplete: (ctx) => ctx.cfg.scheduled.messages.map((m, i) => ({ name: `${m.id || `#${i}`} – ${m.content}`, value: m.id || `#${i}` })),
        async run(ctx) {
          const list = ctx.cfg.scheduled.messages.filter((m, i) => (m.id || `#${i}`) !== ctx.str('id'));
          ctx.bot.config.set(ctx.guild.id, 'scheduled.messages', list, { by: ctx.user.id });
          return ctx.ok('sched.removed');
        },
      },
    },
  }],
};
