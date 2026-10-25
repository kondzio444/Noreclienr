/**
 * Leveling: XP per message with cooldown, voice XP per minute, level-up messages, level roles,
 * /rank, /leaderboard, /xp (admin).
 */
import { ButtonStyle } from 'discord.js';
import { opt } from '../core/commands.js';
import { EPHEMERAL, row, button, okEmbed } from '../core/ui.js';
import { levelFromXp, grantXp, rewardsFor, progressBar, totalXpForLevel } from '../lib/xp.js';
import { render, memberVars } from '../lib/template.js';
import { num } from '../i18n/index.js';

const xpOf = (bot, gid) => bot.store.ns(gid, 'xp', () => ({}));

function ranked(bot, gid) {
  return Object.entries(xpOf(bot, gid)).sort((a, b) => (b[1].xp || 0) - (a[1].xp || 0));
}

export async function syncRewards(bot, member, level) {
  const cfg = bot.cfg(member.guild.id).leveling;
  if (!cfg.rewards.length) return;
  const top = member.guild.members.me.roles.highest.position;
  const want = new Set(rewardsFor(level, cfg.rewards, cfg.stackRewards).map(r => r.role));
  const all = cfg.rewards.map(r => r.role).filter(r => { const role = member.guild.roles.cache.get(r); return role && role.position < top; });
  const add = all.filter(r => want.has(r) && !member.roles.cache.has(r));
  const remove = cfg.stackRewards ? [] : all.filter(r => !want.has(r) && member.roles.cache.has(r));
  if (add.length) await member.roles.add(add, 'level reward').catch(() => {});
  if (remove.length) await member.roles.remove(remove, 'level reward').catch(() => {});
}

async function announce(bot, member, level, channel) {
  const cfg = bot.cfg(member.guild.id).leveling;
  if (cfg.announce === 'off') return;
  const tg = bot.tg(member.guild.id);
  const reward = cfg.rewards.find(r => r.level === level && r.role);
  const text = render(cfg.message || tg('level.default_message'), { ...memberVars(member), level, role: reward ? `<@&${reward.role}>` : '' });
  const payload = { content: text, allowedMentions: { users: [member.id] } };
  if (cfg.announce === 'dm') return member.send(payload).catch(() => {});
  if (cfg.announce === 'channel' && cfg.announceChannel) return bot.send(member.guild, cfg.announceChannel, payload);
  if (channel) return channel.send(payload).catch(() => {});
}

async function add(bot, member, amount, channel) {
  const rec = xpOf(bot, member.guild.id)[member.id] ??= { xp: 0, messages: 0, last: 0 };
  const before = levelFromXp(rec.xp).level;
  rec.xp = Math.max(0, rec.xp + amount);
  bot.store.touch(member.guild.id);
  const after = levelFromXp(rec.xp).level;
  if (after !== before) await syncRewards(bot, member, after);
  if (after > before) await announce(bot, member, after, channel);
}

function leaderboardView(ctx, page) {
  const list = ranked(ctx.bot, ctx.guild.id);
  const per = 10;
  const pages = Math.max(1, Math.ceil(list.length / per));
  page = Math.min(Math.max(0, page), pages - 1);
  const medals = ['🥇', '🥈', '🥉'];
  const lines = list.slice(page * per, page * per + per).map(([id, r], i) => {
    const n = page * per + i;
    const lv = levelFromXp(r.xp);
    return `${medals[n] || `**${n + 1}.**`} <@${id}> · ${ctx.t('level.level_short', { level: lv.level })} · ${num(ctx.lang, r.xp)} XP`;
  });
  const me = list.findIndex(([id]) => id === ctx.user.id);
  const e = ctx.bot.embed(ctx.guild.id).setTitle(ctx.t('level.leaderboard_title', { server: ctx.guild.name })).setDescription(lines.join('\n') || ctx.t('level.empty'))
    .setFooter({ text: `${ctx.t('help.footer', { page: page + 1, pages })}${me >= 0 ? ` · ${ctx.t('level.your_rank', { rank: me + 1 })}` : ''}` });
  return {
    embeds: [e],
    components: [row(button(`lb:${page - 1}`, null, ButtonStyle.Secondary, '◀️').setDisabled(page === 0), button(`lb:${page + 1}`, null, ButtonStyle.Secondary, '▶️').setDisabled(page >= pages - 1))],
  };
}

export default {
  name: 'leveling',
  events: {
    async messageCreate(bot, message) {
      if (!message.guild || message.author.bot || message.webhookId || !message.member) return;
      const cfg = bot.cfg(message.guild.id).leveling;
      if (!cfg.enabled) return;
      if (cfg.ignoredChannels.includes(message.channelId) || cfg.ignoredChannels.includes(message.channel.parentId)) return;
      if (cfg.ignoredRoles.some(r => message.member.roles.cache.has(r))) return;
      const rec = xpOf(bot, message.guild.id)[message.author.id] ??= { xp: 0, messages: 0, last: 0 };
      const res = grantXp(rec, { now: Date.now(), cooldownMs: cfg.cooldownSeconds * 1000, min: cfg.xpMin, max: cfg.xpMax, multiplier: cfg.multiplier });
      if (!res.gained) return;
      bot.store.touch(message.guild.id);
      if (res.to !== res.from) await syncRewards(bot, message.member, res.to);
      if (res.leveledUp) await announce(bot, message.member, res.to, message.channel);
    },
  },
  ready(bot) {
    // voice XP: every minute for members in voice (not alone, not muted/deafened, not AFK)
    bot.every(60_000, async () => {
      for (const guild of bot.client.guilds.cache.values()) {
        const cfg = bot.cfg(guild.id).leveling;
        if (!cfg.enabled || !cfg.voiceXpPerMinute) continue;
        for (const vs of guild.voiceStates.cache.values()) {
          const ch = vs.channel;
          if (!ch || !vs.member || vs.member.user.bot || ch.id === guild.afkChannelId) continue;
          if (vs.selfMute || vs.selfDeaf || vs.serverMute || vs.serverDeaf) continue;
          if (ch.members.filter(m => !m.user.bot).size < 2 || cfg.ignoredChannels.includes(ch.id)) continue;
          await add(bot, vs.member, Math.round(cfg.voiceXpPerMinute * cfg.multiplier), null);
        }
      }
    }, 'voice-xp');
  },
  commands: [
    {
      name: 'rank', category: 'leveling',
      options: [opt.user('user')],
      async run(ctx) {
        const user = ctx.userOpt('user') || ctx.user;
        const list = ranked(ctx.bot, ctx.guild.id);
        const pos = list.findIndex(([id]) => id === user.id);
        const rec = xpOf(ctx.bot, ctx.guild.id)[user.id] || { xp: 0, messages: 0 };
        const lv = levelFromXp(rec.xp);
        const next = ctx.cfg.leveling.rewards.filter(r => r.level > lv.level && r.role).sort((a, b) => a.level - b.level)[0];
        const e = ctx.bot.embed(ctx.guild.id).setAuthor({ name: user.username, iconURL: user.displayAvatarURL() }).setThumbnail(user.displayAvatarURL({ size: 256 }))
          .setTitle(ctx.t('level.rank_title', { level: lv.level }))
          .setDescription(`${progressBar(lv.current, lv.needed, 16)}\n**${num(ctx.lang, lv.current)}** / ${num(ctx.lang, lv.needed)} XP`)
          .addFields(
            { name: ctx.t('level.position'), value: pos >= 0 ? `#${pos + 1} / ${list.length}` : '—', inline: true },
            { name: ctx.t('level.total'), value: `${num(ctx.lang, rec.xp)} XP`, inline: true },
            { name: ctx.t('level.messages'), value: num(ctx.lang, rec.messages || 0), inline: true },
          );
        if (next) e.addFields({ name: ctx.t('level.next_reward'), value: ctx.t('level.next_reward_value', { role: `<@&${next.role}>`, level: next.level, xp: num(ctx.lang, totalXpForLevel(next.level) - rec.xp) }) });
        if (!ctx.cfg.leveling.enabled) e.setFooter({ text: ctx.t('level.disabled_note') });
        return ctx.reply({ embeds: [e] });
      },
    },
    {
      name: 'leaderboard', category: 'leveling',
      options: [opt.int('page', false, { min: 1, max: 1000 })],
      async run(ctx) { return ctx.reply(leaderboardView(ctx, (ctx.int('page') || 1) - 1)); },
    },
    {
      name: 'xp', category: 'leveling', perms: ['ManageGuild'],
      subs: {
        give: { options: [opt.user('user', true), opt.int('amount', true, { min: 1, max: 1_000_000 })], async run(ctx) { const m = ctx.memberOpt('user'); if (!m) return ctx.fail('mod.not_member'); await add(ctx.bot, m, ctx.int('amount'), null); ctx.bot.audit(ctx.guild.id, 'xp_give', { target: m.id, amount: ctx.int('amount'), by: ctx.user.id }); return ctx.ok('level.given', { amount: ctx.int('amount'), user: `${m}` }); } },
        take: { options: [opt.user('user', true), opt.int('amount', true, { min: 1, max: 1_000_000 })], async run(ctx) { const m = ctx.memberOpt('user'); if (!m) return ctx.fail('mod.not_member'); await add(ctx.bot, m, -ctx.int('amount'), null); return ctx.ok('level.taken', { amount: ctx.int('amount'), user: `${m}` }); } },
        set: {
          options: [opt.user('user', true), opt.int('level', true, { min: 0, max: 1000 })],
          async run(ctx) {
            const m = ctx.memberOpt('user'); if (!m) return ctx.fail('mod.not_member');
            const rec = xpOf(ctx.bot, ctx.guild.id)[m.id] ??= { xp: 0, messages: 0, last: 0 };
            rec.xp = totalXpForLevel(ctx.int('level'));
            ctx.bot.store.touch(ctx.guild.id);
            await syncRewards(ctx.bot, m, ctx.int('level'));
            return ctx.ok('level.set', { level: ctx.int('level'), user: `${m}` });
          },
        },
        reset: {
          options: [opt.user('user')],
          async run(ctx) {
            const user = ctx.userOpt('user');
            const { confirm } = await import('../core/ui.js');
            if (!(await confirm(ctx, { text: user ? ctx.t('level.confirm_reset_user', { user: `${user}` }) : ctx.t('level.confirm_reset_all') }))) return;
            const all = xpOf(ctx.bot, ctx.guild.id);
            if (user) delete all[user.id]; else for (const k of Object.keys(all)) delete all[k];
            ctx.bot.store.touch(ctx.guild.id);
            ctx.bot.audit(ctx.guild.id, 'xp_reset', { target: user?.id || 'all', by: ctx.user.id });
            return ctx.i.followUp({ embeds: [okEmbed(ctx.t('level.reset_done'))], flags: EPHEMERAL });
          },
        },
      },
    },
  ],
  components: {
    async lb(ctx, [page]) { return ctx.i.update(leaderboardView(ctx, Number(page) || 0)); },
  },
  alwaysComponents: true,
};
