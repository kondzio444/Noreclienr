/**
 * Moderation: warn / timeout / kick / ban (temporary too) / unban / purge with reasons, case numbers,
 * a moderation log channel, DMs to the member and warn thresholds with automatic actions.
 */
import { PermissionFlagsBits } from 'discord.js';
import { opt } from '../core/commands.js';
import { EPHEMERAL, okEmbed, COLORS, embed, chunk } from '../core/ui.js';
import { parseDuration, formatDuration, ts } from '../lib/duration.js';
import { hierarchyCheck } from '../lib/permissions.js';
import { clip } from '../lib/template.js';
import { translator } from '../i18n/index.js';
import { logger } from '../lib/logger.js';

const log = logger.child('moderation');
const MAX_TIMEOUT = 28 * 86_400_000;
const ICON = { warn: '⚠️', timeout: '🔇', untimeout: '🔊', kick: '👢', ban: '🔨', unban: '🕊️', purge: '🧹', automod: '🤖', note: '📝' };
const COLOR = { warn: COLORS.warn, timeout: COLORS.warn, kick: COLORS.error, ban: COLORS.error, unban: COLORS.ok, untimeout: COLORS.ok, purge: COLORS.info };

function modState(bot, guildId) {
  return bot.store.ns(guildId, 'mod', () => ({ next: 1, cases: [] }));
}

/** Records a case, logs it, reports it. Returns the case. */
export async function createCase(bot, guild, { type, target, moderator, reason, duration = null, extra = {} }) {
  const st = modState(bot, guild.id);
  const c = { id: st.next++, type, target, moderator, reason: reason || null, at: Date.now(), duration, ...extra };
  st.cases.push(c);
  if (st.cases.length > 5000) st.cases.splice(0, st.cases.length - 5000);
  bot.store.touch(guild.id);
  const tg = bot.tg(guild.id);
  const e = embed(COLOR[type] ?? COLORS.info)
    .setAuthor({ name: tg('mod.case_title', { id: c.id, action: tg(`mod.action.${type}`) }) })
    .addFields(
      { name: tg('mod.member'), value: target ? `<@${target}> (\`${target}\`)` : '—', inline: true },
      { name: tg('mod.moderator'), value: moderator ? `<@${moderator}>` : tg('mod.automatic'), inline: true },
    )
    .setTimestamp(c.at);
  if (duration) e.addFields({ name: tg('mod.duration'), value: formatDuration(duration), inline: true });
  e.addFields({ name: tg('mod.reason'), value: clip(reason || tg('mod.no_reason'), 1024) });
  const msg = await bot.modLog(guild, e);
  if (msg) { c.logMessage = msg.id; bot.store.touch(guild.id); }
  bot.audit(guild.id, 'mod_action', { case: c.id, type, target, moderator, reason: c.reason, duration });
  return c;
}

export async function dmMember(bot, guild, user, type, reason, duration) {
  const cfg = bot.cfg(guild.id).moderation;
  if (!cfg.dmOnAction) return false;
  const tg = bot.tg(guild.id);
  const e = embed(COLOR[type] ?? COLORS.info).setTitle(`${ICON[type] || ''} ${tg(`mod.dm.${type}`, { server: guild.name })}`)
    .addFields({ name: tg('mod.reason'), value: clip(reason || tg('mod.no_reason'), 1024) });
  if (duration) e.addFields({ name: tg('mod.duration'), value: formatDuration(duration) });
  if (cfg.appealUrl && (type === 'ban' || type === 'kick' || type === 'timeout')) e.addFields({ name: tg('mod.appeal'), value: cfg.appealUrl });
  try { await user.send({ embeds: [e] }); return true; } catch { return false; }
}

export function activeWarns(bot, guildId, userId) {
  const cfg = bot.cfg(guildId).moderation;
  const exp = cfg.warnExpiryDays > 0 ? Date.now() - cfg.warnExpiryDays * 86_400_000 : 0;
  return modState(bot, guildId).cases.filter(c => c.type === 'warn' && c.target === userId && !c.removed && c.at >= exp);
}

/** After a warn: applies the highest threshold matching the count exactly. */
export async function applyThresholds(bot, guild, member) {
  const cfg = bot.cfg(guild.id).moderation;
  const count = activeWarns(bot, guild.id, member.id).length;
  const th = [...(cfg.thresholds || [])].filter(x => x.warns === count).sort((a, b) => b.warns - a.warns)[0];
  if (!th) return null;
  const tg = bot.tg(guild.id);
  const reason = tg('mod.threshold_reason', { count });
  try {
    if (th.action === 'timeout' && member.moderatable) {
      const ms = Math.min(MAX_TIMEOUT, Math.max(60_000, th.durationMinutes * 60_000));
      await member.timeout(ms, reason);
      await createCase(bot, guild, { type: 'timeout', target: member.id, moderator: null, reason, duration: ms });
    } else if (th.action === 'kick' && member.kickable) {
      await dmMember(bot, guild, member.user, 'kick', reason);
      await member.kick(reason);
      await createCase(bot, guild, { type: 'kick', target: member.id, moderator: null, reason });
    } else if (th.action === 'ban' && member.bannable) {
      await dmMember(bot, guild, member.user, 'ban', reason);
      await guild.members.ban(member.id, { reason });
      const duration = th.durationMinutes > 0 ? th.durationMinutes * 60_000 : null;
      if (duration) bot.scheduler.add(guild.id, 'unban', Date.now() + duration, { userId: member.id });
      await createCase(bot, guild, { type: 'ban', target: member.id, moderator: null, reason, duration });
    }
    return th;
  } catch (err) { log.warn('threshold action failed', { guildId: guild.id, err }); return null; }
}

/** Common checks for a target member. Replies with an error and returns false when not allowed. */
async function canTarget(ctx, member) {
  if (!member) { await ctx.fail('mod.not_member'); return false; }
  const g = ctx.guild;
  const code = hierarchyCheck({
    actorId: ctx.user.id, targetId: member.id, ownerId: g.ownerId, botId: g.members.me.id,
    actorTop: ctx.member.roles.highest.position, targetTop: member.roles.highest.position, botTop: g.members.me.roles.highest.position,
  });
  if (code) { await ctx.fail(`mod.hierarchy.${code}`); return false; }
  return true;
}

function reasonOf(ctx) {
  const r = ctx.str('reason');
  if (!r && ctx.cfg.moderation.requireReason) return undefined;
  return r || '';
}

const reasonOpt = () => opt.string('reason', false, { max: 500 });
const allowRoles = (cfg) => cfg.moderation.modRoles || [];
const done = (ctx, key, vars, c) => ctx.reply({ embeds: [okEmbed(`${ctx.t(key, vars)}\n-# ${ctx.t('mod.case_ref', { id: c.id })}`)] });

export default {
  name: 'moderation',
  timers: {
    async unban(bot, guildId, { userId }) {
      const guild = bot.client.guilds.cache.get(guildId);
      if (!guild) return;
      const tg = bot.tg(guildId);
      try {
        await guild.members.unban(userId, tg('mod.tempban_expired'));
        await createCase(bot, guild, { type: 'unban', target: userId, moderator: null, reason: tg('mod.tempban_expired') });
      } catch { /* already unbanned */ }
    },
  },
  commands: [
    {
      name: 'warn', category: 'moderation', perms: ['ModerateMembers'], allowRoles,
      options: [opt.user('user', true), reasonOpt()],
      async run(ctx) {
        const member = ctx.memberOpt('user');
        if (!(await canTarget(ctx, member))) return;
        const reason = reasonOf(ctx);
        if (reason === undefined) return ctx.fail('mod.reason_required');
        const c = await createCase(ctx.bot, ctx.guild, { type: 'warn', target: member.id, moderator: ctx.user.id, reason });
        await dmMember(ctx.bot, ctx.guild, member.user, 'warn', reason);
        const count = activeWarns(ctx.bot, ctx.guild.id, member.id).length;
        await done(ctx, 'mod.warned', { user: `${member}`, count }, c);
        const th = await applyThresholds(ctx.bot, ctx.guild, member);
        if (th) await ctx.reply({ embeds: [okEmbed(ctx.t('mod.threshold_applied', { action: ctx.t(`mod.action.${th.action}`), count }))], flags: EPHEMERAL });
      },
    },
    {
      name: 'warnings', category: 'moderation', perms: ['ModerateMembers'], allowRoles,
      subs: {
        list: {
          options: [opt.user('user', true)],
          async run(ctx) {
            const user = ctx.userOpt('user');
            const warns = activeWarns(ctx.bot, ctx.guild.id, user.id);
            const lines = warns.map(c => `**#${c.id}** · ${ts(c.at)} · <@${c.moderator || ctx.bot.client.user.id}>\n${clip(c.reason || ctx.t('mod.no_reason'), 200)}`);
            const e = ctx.bot.embed(ctx.guild.id).setTitle(ctx.t('mod.warnings_title', { user: user.username, count: warns.length }))
              .setDescription(chunk(lines, 3900)[0] || ctx.t('mod.no_warnings'));
            return ctx.reply({ embeds: [e], flags: EPHEMERAL });
          },
        },
        remove: {
          options: [opt.int('case', true, { min: 1 })],
          async run(ctx) {
            const st = modState(ctx.bot, ctx.guild.id);
            const c = st.cases.find(x => x.id === ctx.int('case') && x.type === 'warn');
            if (!c || c.removed) return ctx.fail('mod.case_not_found');
            c.removed = { by: ctx.user.id, at: Date.now() };
            ctx.bot.store.touch(ctx.guild.id);
            ctx.bot.audit(ctx.guild.id, 'warn_removed', { case: c.id, by: ctx.user.id });
            return ctx.ok('mod.warn_removed', { id: c.id });
          },
        },
        clear: {
          options: [opt.user('user', true)],
          async run(ctx) {
            const user = ctx.userOpt('user');
            const list = activeWarns(ctx.bot, ctx.guild.id, user.id);
            for (const c of list) c.removed = { by: ctx.user.id, at: Date.now() };
            ctx.bot.store.touch(ctx.guild.id);
            ctx.bot.audit(ctx.guild.id, 'warns_cleared', { target: user.id, count: list.length, by: ctx.user.id });
            return ctx.ok('mod.warns_cleared', { count: list.length, user: `${user}` });
          },
        },
      },
    },
    {
      name: 'timeout', category: 'moderation', perms: ['ModerateMembers'], botPerms: ['ModerateMembers'], botPermsScope: 'guild', allowRoles,
      options: [opt.user('user', true), opt.string('duration', true, { max: 20 }), reasonOpt()],
      async run(ctx) {
        const member = ctx.memberOpt('user');
        if (!(await canTarget(ctx, member))) return;
        const ms = parseDuration(ctx.str('duration'));
        if (!ms || ms < 5000 || ms > MAX_TIMEOUT) return ctx.fail('mod.bad_duration_timeout');
        const reason = reasonOf(ctx);
        if (reason === undefined) return ctx.fail('mod.reason_required');
        await member.timeout(ms, reason || undefined);
        await dmMember(ctx.bot, ctx.guild, member.user, 'timeout', reason, ms);
        const c = await createCase(ctx.bot, ctx.guild, { type: 'timeout', target: member.id, moderator: ctx.user.id, reason, duration: ms });
        return done(ctx, 'mod.timed_out', { user: `${member}`, until: ts(Date.now() + ms) }, c);
      },
    },
    {
      name: 'untimeout', category: 'moderation', perms: ['ModerateMembers'], botPerms: ['ModerateMembers'], botPermsScope: 'guild', allowRoles,
      options: [opt.user('user', true), reasonOpt()],
      async run(ctx) {
        const member = ctx.memberOpt('user');
        if (!(await canTarget(ctx, member))) return;
        await member.timeout(null, ctx.str('reason') || undefined);
        const c = await createCase(ctx.bot, ctx.guild, { type: 'untimeout', target: member.id, moderator: ctx.user.id, reason: ctx.str('reason') });
        return done(ctx, 'mod.untimed_out', { user: `${member}` }, c);
      },
    },
    {
      name: 'kick', category: 'moderation', perms: ['KickMembers'], botPerms: ['KickMembers'], botPermsScope: 'guild', allowRoles,
      options: [opt.user('user', true), reasonOpt()],
      async run(ctx) {
        const member = ctx.memberOpt('user');
        if (!(await canTarget(ctx, member))) return;
        const reason = reasonOf(ctx);
        if (reason === undefined) return ctx.fail('mod.reason_required');
        await dmMember(ctx.bot, ctx.guild, member.user, 'kick', reason);
        await member.kick(reason || undefined);
        const c = await createCase(ctx.bot, ctx.guild, { type: 'kick', target: member.id, moderator: ctx.user.id, reason });
        return done(ctx, 'mod.kicked', { user: member.user.tag || member.user.username }, c);
      },
    },
    {
      name: 'ban', category: 'moderation', perms: ['BanMembers'], botPerms: ['BanMembers'], botPermsScope: 'guild', allowRoles,
      options: [opt.user('user', true), reasonOpt(), opt.string('duration', false, { max: 20 }), opt.int('delete_messages', false, { choices: { set: 'deleteDays', values: [0, 1, 7] } })],
      async run(ctx) {
        const user = ctx.userOpt('user');
        const member = ctx.memberOpt('user');
        if (member && !(await canTarget(ctx, member))) return;
        const reason = reasonOf(ctx);
        if (reason === undefined) return ctx.fail('mod.reason_required');
        let ms = null;
        if (ctx.str('duration')) {
          ms = parseDuration(ctx.str('duration'));
          if (!ms || ms < 60_000) return ctx.fail('mod.bad_duration');
        }
        if (member) await dmMember(ctx.bot, ctx.guild, user, 'ban', reason, ms);
        await ctx.guild.members.ban(user.id, { reason: reason || undefined, deleteMessageSeconds: (ctx.int('delete_messages') || 0) * 86400 });
        if (ms) ctx.bot.scheduler.add(ctx.guild.id, 'unban', Date.now() + ms, { userId: user.id });
        const c = await createCase(ctx.bot, ctx.guild, { type: 'ban', target: user.id, moderator: ctx.user.id, reason, duration: ms });
        return done(ctx, ms ? 'mod.tempbanned' : 'mod.banned', { user: user.tag || user.username, until: ms ? ts(Date.now() + ms) : '' }, c);
      },
    },
    {
      name: 'unban', category: 'moderation', perms: ['BanMembers'], botPerms: ['BanMembers'], botPermsScope: 'guild', allowRoles,
      options: [opt.string('user', true, { autocomplete: true, max: 20 }), reasonOpt()],
      async autocomplete(ctx) {
        const q = (ctx.i.options.getFocused() || '').toLowerCase();
        const bans = await ctx.guild.bans.fetch({ limit: 1000 }).catch(() => null);
        if (!bans) return [];
        return [...bans.values()].filter(b => b.user.username.toLowerCase().includes(q) || b.user.id.includes(q)).slice(0, 25).map(b => ({ name: `${b.user.username} (${b.user.id})`, value: b.user.id }));
      },
      async run(ctx) {
        const id = (/\d{17,20}/.exec(ctx.str('user')) || [])[0];
        if (!id) return ctx.fail('mod.bad_user_id');
        ctx.bot.scheduler.cancel(ctx.guild.id, t => t.type === 'unban' && t.data.userId === id);
        try { await ctx.guild.members.unban(id, ctx.str('reason') || undefined); } catch { return ctx.fail('mod.not_banned'); }
        const c = await createCase(ctx.bot, ctx.guild, { type: 'unban', target: id, moderator: ctx.user.id, reason: ctx.str('reason') });
        return done(ctx, 'mod.unbanned', { user: `<@${id}>` }, c);
      },
    },
    {
      name: 'purge', category: 'moderation', perms: ['ManageMessages'], botPerms: ['ManageMessages', 'ReadMessageHistory'], allowRoles,
      options: [opt.int('amount', true, { min: 1, max: 500 }), opt.user('user'), opt.string('contains', false, { max: 100 }), opt.bool('bots')],
      async run(ctx) {
        await ctx.defer();
        const amount = ctx.int('amount');
        const user = ctx.userOpt('user');
        const contains = ctx.str('contains')?.toLowerCase();
        const bots = ctx.bool('bots');
        const ch = ctx.i.channel;
        let deleted = 0, scanned = 0, before;
        const cutoff = Date.now() - 14 * 86_400_000 + 60_000; // bulk delete only works for < 14 days
        while (deleted < amount && scanned < 2000) {
          const batch = await ch.messages.fetch({ limit: 100, ...(before ? { before } : {}) });
          if (!batch.size) break;
          scanned += batch.size;
          before = batch.last().id;
          const pick = batch.filter(m => m.createdTimestamp > cutoff && !m.pinned && (!user || m.author.id === user.id) && (!contains || m.content.toLowerCase().includes(contains)) && (!bots || m.author.bot));
          const ids = [...pick.keys()].slice(0, amount - deleted);
          if (ids.length) { const res = await ch.bulkDelete(ids, true); deleted += res.size; }
          if (batch.last().createdTimestamp < cutoff) break;
        }
        const c = await createCase(ctx.bot, ctx.guild, { type: 'purge', target: user?.id || null, moderator: ctx.user.id, reason: ctx.t('mod.purge_reason', { count: deleted, channel: `#${ch.name}` }) });
        return ctx.reply({ embeds: [okEmbed(`${ctx.t('mod.purged', { count: deleted })}\n-# ${ctx.t('mod.case_ref', { id: c.id })}`)] });
      },
    },
    {
      name: 'case', category: 'moderation', perms: ['ModerateMembers'], allowRoles,
      subs: {
        view: {
          options: [opt.int('id', true, { min: 1 })],
          async run(ctx) {
            const c = modState(ctx.bot, ctx.guild.id).cases.find(x => x.id === ctx.int('id'));
            if (!c) return ctx.fail('mod.case_not_found');
            const e = ctx.bot.embed(ctx.guild.id, COLOR[c.type]).setTitle(`${ICON[c.type] || ''} ${ctx.t('mod.case_title', { id: c.id, action: ctx.t(`mod.action.${c.type}`) })}`)
              .addFields(
                { name: ctx.t('mod.member'), value: c.target ? `<@${c.target}>` : '—', inline: true },
                { name: ctx.t('mod.moderator'), value: c.moderator ? `<@${c.moderator}>` : ctx.t('mod.automatic'), inline: true },
                { name: ctx.t('mod.when'), value: ts(c.at, 'f'), inline: true },
                { name: ctx.t('mod.reason'), value: clip(c.reason || ctx.t('mod.no_reason'), 1024) },
              );
            if (c.duration) e.addFields({ name: ctx.t('mod.duration'), value: formatDuration(c.duration), inline: true });
            if (c.removed) e.addFields({ name: ctx.t('mod.removed'), value: `<@${c.removed.by}> ${ts(c.removed.at)}`, inline: true });
            return ctx.reply({ embeds: [e], flags: EPHEMERAL });
          },
        },
        reason: {
          options: [opt.int('id', true, { min: 1 }), opt.string('reason', true, { max: 500 })],
          async run(ctx) {
            const c = modState(ctx.bot, ctx.guild.id).cases.find(x => x.id === ctx.int('id'));
            if (!c) return ctx.fail('mod.case_not_found');
            c.reason = ctx.str('reason');
            ctx.bot.store.touch(ctx.guild.id);
            ctx.bot.audit(ctx.guild.id, 'case_reason', { case: c.id, by: ctx.user.id });
            return ctx.ok('mod.case_updated', { id: c.id });
          },
        },
        history: {
          options: [opt.user('user', true)],
          async run(ctx) {
            const user = ctx.userOpt('user');
            const list = modState(ctx.bot, ctx.guild.id).cases.filter(c => c.target === user.id).slice(-25).reverse();
            const lines = list.map(c => `${ICON[c.type] || '•'} **#${c.id}** ${ctx.t(`mod.action.${c.type}`)} · ${ts(c.at, 'd')} · ${clip(c.reason || '—', 80)}${c.removed ? ' ~~' + ctx.t('mod.removed') + '~~' : ''}`);
            return ctx.reply({ embeds: [ctx.bot.embed(ctx.guild.id).setTitle(ctx.t('mod.history_title', { user: user.username })).setDescription(lines.join('\n') || ctx.t('mod.no_history'))], flags: EPHEMERAL });
          },
        },
      },
    },
  ],
};

export { modState, PermissionFlagsBits, translator };
