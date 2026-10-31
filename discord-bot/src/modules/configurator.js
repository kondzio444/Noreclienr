/**
 * Discord configurator: manage everything the bot has permission for, from Discord.
 *   /guild    – name, icon, banner, splash, description, verification level, content filter,
 *               notifications, system channel, AFK, invites, vanity, server settings from config
 *   /channel  – create, delete, rename, move, topic, slowmode, NSFW, permission sync, clone, lock/unlock
 *   /role     – create, delete, edit, icon, permissions, move, give/take
 *   /perms    – channel permission overwrites editor (view, set, clear, copy)
 *   /emoji, /sticker, /event (scheduled events), /webhook, /template (server templates)
 * Destructive actions ask for confirmation and are audited (mod log + API event).
 */
import {
  ChannelType, PermissionFlagsBits, GuildVerificationLevel, GuildExplicitContentFilter, GuildDefaultMessageNotifications,
  GuildScheduledEventEntityType, GuildScheduledEventPrivacyLevel, OverwriteType,
} from 'discord.js';
import { opt } from '../core/commands.js';
import { EPHEMERAL, okEmbed, confirm, embed, COLORS, chunk } from '../core/ui.js';
import { parseDuration, ts } from '../lib/duration.js';
import { clip, colorInt } from '../lib/template.js';
import { has } from '../i18n/index.js';

const CH_TYPES = { text: ChannelType.GuildText, voice: ChannelType.GuildVoice, category: ChannelType.GuildCategory, announcement: ChannelType.GuildAnnouncement, forum: ChannelType.GuildForum, stage: ChannelType.GuildStageVoice };
export const VERIFICATION = { none: GuildVerificationLevel.None, low: GuildVerificationLevel.Low, medium: GuildVerificationLevel.Medium, high: GuildVerificationLevel.High, very_high: GuildVerificationLevel.VeryHigh };
export const CONTENT_FILTER = { disabled: GuildExplicitContentFilter.Disabled, members_without_roles: GuildExplicitContentFilter.MembersWithoutRoles, all_members: GuildExplicitContentFilter.AllMembers };
export const NOTIFICATIONS = { all: GuildDefaultMessageNotifications.AllMessages, mentions: GuildDefaultMessageNotifications.OnlyMentions };
export const PERMISSION_NAMES = Object.keys(PermissionFlagsBits);

export const permName = (t, p) => (has('en', `perm.${p}`) ? t(`perm.${p}`) : p.replace(/([a-z])([A-Z])/g, '$1 $2'));

async function audit(ctx, action, data = {}) {
  ctx.bot.audit(ctx.guild.id, 'configurator', { action, by: ctx.user.id, ...data });
  await ctx.bot.modLog(ctx.guild, embed(COLORS.info).setDescription(ctx.tg('conf.audit', { user: `${ctx.user}`, action, details: clip(Object.entries(data).map(([k, v]) => `${k}: ${v}`).join(', '), 900) })).setTimestamp());
}

const done = async (ctx, key, vars, action, data) => { await audit(ctx, action, data); return ctx.reply({ embeds: [okEmbed(ctx.t(key, vars))], flags: EPHEMERAL }); };
const followDone = async (ctx, key, vars, action, data) => { await audit(ctx, action, data); return ctx.i.followUp({ embeds: [okEmbed(ctx.t(key, vars))], flags: EPHEMERAL }); };

async function imageFrom(ctx) {
  const att = ctx.attachment('image');
  const url = att?.url || ctx.str('url');
  if (!url) return null;
  if (att && !att.contentType?.startsWith('image/')) throw Object.assign(new Error('not an image'), { userKey: 'conf.not_image' });
  return url;
}

function permAutocomplete(ctx) {
  const q = (ctx.i.options.getFocused() || '').toLowerCase();
  return PERMISSION_NAMES.filter(p => p.toLowerCase().includes(q) || permName(ctx.t, p).toLowerCase().includes(q)).slice(0, 25).map(p => ({ name: `${permName(ctx.t, p)} (${p})`, value: p }));
}

/** Applies config.server (desired guild settings) – used by the panel's "apply on sync" and /guild apply. */
export async function applyServerSettings(bot, guild, s, reason = 'Nore Bot server settings') {
  const edit = {};
  if (s.name && s.name !== guild.name) edit.name = s.name;
  if (s.description && s.description !== guild.description && guild.features.includes('COMMUNITY')) edit.description = s.description;
  if (s.verificationLevel !== 'keep' && VERIFICATION[s.verificationLevel] !== guild.verificationLevel) edit.verificationLevel = VERIFICATION[s.verificationLevel];
  if (s.explicitContentFilter !== 'keep' && CONTENT_FILTER[s.explicitContentFilter] !== guild.explicitContentFilter) edit.explicitContentFilter = CONTENT_FILTER[s.explicitContentFilter];
  if (s.defaultNotifications !== 'keep' && NOTIFICATIONS[s.defaultNotifications] !== guild.defaultMessageNotifications) edit.defaultMessageNotifications = NOTIFICATIONS[s.defaultNotifications];
  if (s.systemChannel && s.systemChannel !== guild.systemChannelId && guild.channels.cache.has(s.systemChannel)) edit.systemChannel = s.systemChannel;
  if (s.afkChannel && s.afkChannel !== guild.afkChannelId && guild.channels.cache.has(s.afkChannel)) edit.afkChannel = s.afkChannel;
  if (s.afkTimeout && s.afkTimeout !== guild.afkTimeout) edit.afkTimeout = s.afkTimeout;
  if (!Object.keys(edit).length) return [];
  await guild.edit({ ...edit, reason });
  bot.audit(guild.id, 'server_settings_applied', { fields: Object.keys(edit) });
  return Object.keys(edit);
}

const choice = (set, values) => ({ values, key: (v) => `panel.options.${set}.${v}` });

export default {
  name: null,
  configChanged(bot, guild, cfg, before) {
    if (cfg.server.applyOnSync && JSON.stringify(cfg.server) !== JSON.stringify(before?.server)) applyServerSettings(bot, guild, cfg.server).catch(err => bot.log.warn('server settings apply failed', { guildId: guild.id, err: err.message }));
  },
  commands: [
    // ------------------------------------------------------------- /guild
    {
      name: 'guild', category: 'server', perms: ['ManageGuild'], botPerms: ['ManageGuild'], botPermsScope: 'guild',
      subs: {
        name: { options: [opt.string('name', true, { min: 2, max: 100 })], async run(ctx) { const old = ctx.guild.name; await ctx.guild.setName(ctx.str('name')); return done(ctx, 'conf.guild_name', { name: ctx.str('name') }, 'guild.name', { from: old, to: ctx.str('name') }); } },
        icon: { options: [opt.attachment('image'), opt.string('url', false, { max: 500 })], async run(ctx) { await ctx.defer(); const url = await imageFrom(ctx); await ctx.guild.setIcon(url); return done(ctx, url ? 'conf.icon_set' : 'conf.icon_removed', {}, 'guild.icon', {}); } },
        banner: { options: [opt.attachment('image'), opt.string('url', false, { max: 500 })], async run(ctx) { if (!ctx.guild.features.includes('BANNER')) return ctx.fail('conf.need_boost', { feature: 'banner', tier: 2 }); await ctx.defer(); await ctx.guild.setBanner(await imageFrom(ctx)); return done(ctx, 'conf.banner_set', {}, 'guild.banner', {}); } },
        splash: { options: [opt.attachment('image'), opt.string('url', false, { max: 500 })], async run(ctx) { if (!ctx.guild.features.includes('INVITE_SPLASH')) return ctx.fail('conf.need_boost', { feature: 'invite splash', tier: 1 }); await ctx.defer(); await ctx.guild.setSplash(await imageFrom(ctx)); return done(ctx, 'conf.splash_set', {}, 'guild.splash', {}); } },
        description: { options: [opt.string('text', true, { max: 120 })], async run(ctx) { if (!ctx.guild.features.includes('COMMUNITY')) return ctx.fail('conf.need_community'); await ctx.guild.edit({ description: ctx.str('text') }); return done(ctx, 'conf.saved', {}, 'guild.description', {}); } },
        verification: { options: [opt.string('level', true, { choices: choice('verificationLevels', Object.keys(VERIFICATION)) })], async run(ctx) { await ctx.guild.setVerificationLevel(VERIFICATION[ctx.str('level')]); return done(ctx, 'conf.saved', {}, 'guild.verification', { level: ctx.str('level') }); } },
        contentfilter: { options: [opt.string('filter', true, { choices: choice('contentFilters', Object.keys(CONTENT_FILTER)) })], async run(ctx) { await ctx.guild.setExplicitContentFilter(CONTENT_FILTER[ctx.str('filter')]); return done(ctx, 'conf.saved', {}, 'guild.contentfilter', { filter: ctx.str('filter') }); } },
        notifications: { options: [opt.string('mode', true, { choices: choice('notifications', Object.keys(NOTIFICATIONS)) })], async run(ctx) { await ctx.guild.setDefaultMessageNotifications(NOTIFICATIONS[ctx.str('mode')]); return done(ctx, 'conf.saved', {}, 'guild.notifications', { mode: ctx.str('mode') }); } },
        systemchannel: {
          options: [opt.channel('channel', false, { channelTypes: ['text'] }), opt.bool('join_messages'), opt.bool('boost_messages'), opt.bool('welcome_stickers')],
          async run(ctx) {
            const { GuildSystemChannelFlags: F } = await import('discord.js');
            let flags = ctx.guild.systemChannelFlags.bitfield;
            const set = (bit, on) => { if (on === null) return; flags = on ? flags & ~bit : flags | bit; }; // flags SUPPRESS features
            set(F.SuppressJoinNotifications, ctx.bool('join_messages'));
            set(F.SuppressPremiumSubscriptions, ctx.bool('boost_messages'));
            set(F.SuppressJoinNotificationReplies, ctx.bool('welcome_stickers'));
            await ctx.guild.edit({ systemChannel: ctx.channelOpt('channel')?.id ?? ctx.guild.systemChannelId, systemChannelFlags: flags });
            return done(ctx, 'conf.saved', {}, 'guild.systemchannel', {});
          },
        },
        afk: {
          options: [opt.channel('channel', false, { channelTypes: ['voice'] }), opt.int('timeout', false, { choices: { values: [60, 300, 900, 1800, 3600], key: (v) => `panel.options.afkTimeouts.${v}` } })],
          async run(ctx) { await ctx.guild.edit({ afkChannel: ctx.channelOpt('channel')?.id ?? ctx.guild.afkChannelId, afkTimeout: ctx.int('timeout') ?? ctx.guild.afkTimeout }); return done(ctx, 'conf.saved', {}, 'guild.afk', {}); },
        },
        invite: {
          botPerms: ['CreateInstantInvite'],
          options: [opt.channel('channel', false, { channelTypes: ['text', 'voice', 'announcement', 'forum'] }), opt.int('max_age_hours', false, { min: 0, max: 168 }), opt.int('max_uses', false, { min: 0, max: 100 }), opt.bool('temporary')],
          async run(ctx) {
            const ch = ctx.channelOpt('channel') || ctx.guild.rulesChannel || ctx.i.channel;
            const inv = await ch.createInvite({ maxAge: (ctx.int('max_age_hours') ?? 0) * 3600, maxUses: ctx.int('max_uses') ?? 0, temporary: !!ctx.bool('temporary'), unique: true, reason: `by ${ctx.user.username}` });
            return done(ctx, 'conf.invite_created', { url: inv.url }, 'guild.invite', { channel: ch.name });
          },
        },
        invites: {
          async run(ctx) {
            const list = await ctx.guild.invites.fetch();
            const lines = [...list.values()].sort((a, b) => b.uses - a.uses).slice(0, 30).map(i => `\`${i.code}\` · ${i.inviter ? `${i.inviter}` : '—'} · #${i.channel?.name} · ${i.uses}${i.maxUses ? `/${i.maxUses}` : ''} · ${i.expiresTimestamp ? ts(i.expiresTimestamp) : '∞'}`);
            const vanity = ctx.guild.vanityURLCode ? `\n\n🔗 discord.gg/${ctx.guild.vanityURLCode}` : '';
            return ctx.reply({ embeds: [ctx.bot.embed(ctx.guild.id).setTitle(ctx.t('conf.invites_title')).setDescription((lines.join('\n') || '—') + vanity)], flags: EPHEMERAL });
          },
        },
        vanity: {
          options: [opt.string('code', true, { min: 2, max: 32 })],
          async run(ctx) {
            if (!ctx.guild.features.includes('VANITY_URL')) return ctx.fail('conf.need_boost', { feature: 'vanity URL', tier: 3 });
            await ctx.bot.client.rest.patch(`/guilds/${ctx.guild.id}/vanity-url`, { body: { code: ctx.str('code') }, reason: `by ${ctx.user.username}` });
            return done(ctx, 'conf.vanity_set', { code: ctx.str('code') }, 'guild.vanity', { code: ctx.str('code') });
          },
        },
        apply: {
          async run(ctx) {
            await ctx.defer();
            const fields = await applyServerSettings(ctx.bot, ctx.guild, ctx.cfg.server, `by ${ctx.user.username}`);
            return ctx.reply({ embeds: [okEmbed(fields.length ? ctx.t('conf.applied', { fields: fields.join(', ') }) : ctx.t('conf.nothing_to_apply'))] });
          },
        },
      },
    },
    // ------------------------------------------------------------- /channel
    {
      name: 'channel', category: 'server', perms: ['ManageChannels'], botPerms: ['ManageChannels'], botPermsScope: 'guild',
      subs: {
        create: {
          options: [opt.string('name', true, { max: 100 }), opt.string('type', false, { choices: { values: Object.keys(CH_TYPES), key: (v) => `conf.chtype.${v}` } }), opt.channel('category', false, { channelTypes: ['category'] }), opt.string('topic', false, { max: 1024 }), opt.bool('private')],
          async run(ctx) {
            const type = CH_TYPES[ctx.str('type') || 'text'];
            const overwrites = ctx.bool('private') ? [{ id: ctx.guild.id, deny: [PermissionFlagsBits.ViewChannel] }, { id: ctx.guild.members.me.id, allow: [PermissionFlagsBits.ViewChannel] }] : undefined;
            const ch = await ctx.guild.channels.create({ name: ctx.str('name'), type, parent: type === ChannelType.GuildCategory ? null : ctx.channelOpt('category')?.id, topic: ctx.str('topic') || undefined, permissionOverwrites: overwrites, reason: `by ${ctx.user.username}` });
            return done(ctx, 'conf.channel_created', { channel: `${ch}` }, 'channel.create', { name: ch.name });
          },
        },
        delete: {
          options: [opt.channel('channel', true)],
          async run(ctx) {
            const ch = ctx.channelOpt('channel');
            if (!(await confirm(ctx, { text: ctx.t('conf.confirm_channel_delete', { name: ch.name }) }))) return;
            await ch.delete(`by ${ctx.user.username}`);
            return followDone(ctx, 'conf.channel_deleted', { name: ch.name }, 'channel.delete', { name: ch.name });
          },
        },
        rename: { options: [opt.channel('channel', true), opt.string('name', true, { max: 100 })], async run(ctx) { const ch = ctx.channelOpt('channel'); const old = ch.name; await ch.setName(ctx.str('name')); return done(ctx, 'conf.saved', {}, 'channel.rename', { from: old, to: ctx.str('name') }); } },
        move: {
          options: [opt.channel('channel', true), opt.channel('category', false, { channelTypes: ['category'] }), opt.int('position', false, { min: 0, max: 500 }), opt.bool('sync_permissions')],
          async run(ctx) {
            const ch = ctx.channelOpt('channel');
            if (ctx.channelOpt('category')) await ch.setParent(ctx.channelOpt('category').id, { lockPermissions: !!ctx.bool('sync_permissions') });
            if (ctx.int('position') !== null) await ch.setPosition(ctx.int('position'));
            return done(ctx, 'conf.saved', {}, 'channel.move', { channel: ch.name });
          },
        },
        topic: { options: [opt.channel('channel', true, { channelTypes: ['text', 'announcement', 'forum'] }), opt.string('topic', true, { max: 1024 })], async run(ctx) { await ctx.channelOpt('channel').setTopic(ctx.str('topic')); return done(ctx, 'conf.saved', {}, 'channel.topic', { channel: ctx.channelOpt('channel').name }); } },
        slowmode: { options: [opt.string('duration', true, { max: 10 }), opt.channel('channel', false, { channelTypes: ['text', 'forum', 'voice'] })], async run(ctx) { const ms = ctx.str('duration') === '0' ? 0 : parseDuration(ctx.str('duration'), { defaultUnit: 's' }); if (ms === null || ms > 21_600_000) return ctx.fail('conf.bad_slowmode'); const ch = ctx.channelOpt('channel') || ctx.i.channel; await ch.setRateLimitPerUser(Math.round(ms / 1000)); return done(ctx, 'conf.slowmode_set', { seconds: Math.round(ms / 1000), channel: `${ch}` }, 'channel.slowmode', { channel: ch.name, seconds: Math.round(ms / 1000) }); } },
        nsfw: { options: [opt.bool('nsfw', true), opt.channel('channel', false, { channelTypes: ['text', 'forum', 'voice'] })], async run(ctx) { const ch = ctx.channelOpt('channel') || ctx.i.channel; await ch.setNSFW(ctx.bool('nsfw')); return done(ctx, 'conf.saved', {}, 'channel.nsfw', { channel: ch.name, nsfw: ctx.bool('nsfw') }); } },
        sync: { options: [opt.channel('channel', true)], async run(ctx) { const ch = ctx.channelOpt('channel'); if (!ch.parent) return ctx.fail('conf.no_parent'); await ch.lockPermissions(); return done(ctx, 'conf.synced', { channel: `${ch}` }, 'channel.sync', { channel: ch.name }); } },
        clone: { options: [opt.channel('channel', true), opt.string('name', false, { max: 100 })], async run(ctx) { const c = await ctx.channelOpt('channel').clone({ name: ctx.str('name') || undefined }); return done(ctx, 'conf.channel_created', { channel: `${c}` }, 'channel.clone', { from: ctx.channelOpt('channel').name }); } },
        lock: {
          options: [opt.channel('channel', false, { channelTypes: ['text', 'forum', 'voice', 'announcement'] }), opt.string('reason', false, { max: 300 })],
          async run(ctx) {
            const ch = ctx.channelOpt('channel') || ctx.i.channel;
            await ch.permissionOverwrites.edit(ctx.guild.id, { SendMessages: false, SendMessagesInThreads: false, CreatePublicThreads: false, AddReactions: false, Connect: ch.isVoiceBased() ? false : null }, { reason: ctx.str('reason') || undefined });
            await ch.send?.({ embeds: [embed(COLORS.warn).setDescription(`🔒 ${ctx.tg('conf.locked_notice')}${ctx.str('reason') ? `\n${ctx.str('reason')}` : ''}`)] }).catch(() => {});
            return done(ctx, 'conf.locked', { channel: `${ch}` }, 'channel.lock', { channel: ch.name });
          },
        },
        unlock: {
          options: [opt.channel('channel', false, { channelTypes: ['text', 'forum', 'voice', 'announcement'] })],
          async run(ctx) {
            const ch = ctx.channelOpt('channel') || ctx.i.channel;
            await ch.permissionOverwrites.edit(ctx.guild.id, { SendMessages: null, SendMessagesInThreads: null, CreatePublicThreads: null, AddReactions: null, Connect: null });
            await ch.send?.({ embeds: [embed(COLORS.ok).setDescription(`🔓 ${ctx.tg('conf.unlocked_notice')}`)] }).catch(() => {});
            return done(ctx, 'conf.unlocked', { channel: `${ch}` }, 'channel.unlock', { channel: ch.name });
          },
        },
      },
    },
    // ------------------------------------------------------------- /role
    {
      name: 'role', category: 'server', perms: ['ManageRoles'], botPerms: ['ManageRoles'], botPermsScope: 'guild',
      subs: {
        create: {
          options: [opt.string('name', true, { max: 100 }), opt.string('color', false, { max: 7 }), opt.bool('hoist'), opt.bool('mentionable')],
          async run(ctx) { const r = await ctx.guild.roles.create({ name: ctx.str('name'), colors: { primaryColor: colorInt(ctx.str('color'), 0) }, hoist: !!ctx.bool('hoist'), mentionable: !!ctx.bool('mentionable'), permissions: [], reason: `by ${ctx.user.username}` }); return done(ctx, 'conf.role_created', { role: `${r}` }, 'role.create', { name: r.name }); },
        },
        delete: {
          options: [opt.role('role', true)],
          async run(ctx) {
            const r = ctx.roleOpt('role');
            if (!r.editable) return ctx.fail('roles.too_high');
            if (!(await confirm(ctx, { text: ctx.t('conf.confirm_role_delete', { name: r.name, count: r.members.size }) }))) return;
            await r.delete(`by ${ctx.user.username}`);
            return followDone(ctx, 'conf.role_deleted', { name: r.name }, 'role.delete', { name: r.name });
          },
        },
        edit: {
          options: [opt.role('role', true), opt.string('name', false, { max: 100 }), opt.string('color', false, { max: 7 }), opt.bool('hoist'), opt.bool('mentionable')],
          async run(ctx) {
            const r = ctx.roleOpt('role');
            if (!r.editable) return ctx.fail('roles.too_high');
            const data = {};
            if (ctx.str('name')) data.name = ctx.str('name');
            if (ctx.str('color')) data.colors = { primaryColor: colorInt(ctx.str('color'), r.color) };
            if (ctx.bool('hoist') !== null) data.hoist = ctx.bool('hoist');
            if (ctx.bool('mentionable') !== null) data.mentionable = ctx.bool('mentionable');
            await r.edit({ ...data, reason: `by ${ctx.user.username}` });
            return done(ctx, 'conf.saved', {}, 'role.edit', { role: r.name, fields: Object.keys(data).join(',') });
          },
        },
        icon: {
          options: [opt.role('role', true), opt.attachment('image'), opt.string('emoji', false, { max: 32 })],
          async run(ctx) {
            if (!ctx.guild.features.includes('ROLE_ICONS')) return ctx.fail('conf.need_boost', { feature: 'role icons', tier: 2 });
            const r = ctx.roleOpt('role');
            if (!r.editable) return ctx.fail('roles.too_high');
            if (ctx.attachment('image')) await r.setIcon(ctx.attachment('image').url); else await r.setUnicodeEmoji(ctx.str('emoji') || null);
            return done(ctx, 'conf.saved', {}, 'role.icon', { role: r.name });
          },
        },
        permission: {
          options: [opt.role('role', true), opt.string('permission', true, { autocomplete: true }), opt.bool('allow', true)],
          autocomplete: permAutocomplete,
          async run(ctx) {
            const r = ctx.roleOpt('role');
            const p = ctx.str('permission');
            if (!PERMISSION_NAMES.includes(p)) return ctx.fail('conf.bad_permission');
            if (!r.editable) return ctx.fail('roles.too_high');
            if (ctx.bool('allow') && !ctx.guild.members.me.permissions.has(p)) return ctx.fail('errors.missing_bot_perms', { perms: permName(ctx.t, p) });
            if (p === 'Administrator' && ctx.bool('allow') && !(await confirm(ctx, { text: ctx.t('conf.confirm_admin', { role: r.name }) }))) return;
            const perms = ctx.bool('allow') ? r.permissions.add(p) : r.permissions.remove(p);
            await r.setPermissions(perms, `by ${ctx.user.username}`);
            const reply = { embeds: [okEmbed(ctx.t('conf.saved'))], flags: EPHEMERAL };
            await audit(ctx, 'role.permission', { role: r.name, permission: p, allow: ctx.bool('allow') });
            return ctx.i.replied ? ctx.i.followUp(reply) : ctx.reply(reply);
          },
        },
        move: {
          options: [opt.role('role', true), opt.role('above', true)],
          async run(ctx) {
            const r = ctx.roleOpt('role'), above = ctx.roleOpt('above');
            if (!r.editable || above.position >= ctx.guild.members.me.roles.highest.position) return ctx.fail('roles.too_high');
            await r.setPosition(above.position + (r.position > above.position ? 1 : 0));
            return done(ctx, 'conf.saved', {}, 'role.move', { role: r.name, above: above.name });
          },
        },
        give: { options: [opt.user('user', true), opt.role('role', true)], async run(ctx) { const m = ctx.memberOpt('user'); const r = ctx.roleOpt('role'); if (!m) return ctx.fail('mod.not_member'); if (!r.editable) return ctx.fail('roles.too_high'); await m.roles.add(r, `by ${ctx.user.username}`); return done(ctx, 'roles.added', { role: `${r}` }, 'role.give', { role: r.name, target: m.id }); } },
        take: { options: [opt.user('user', true), opt.role('role', true)], async run(ctx) { const m = ctx.memberOpt('user'); const r = ctx.roleOpt('role'); if (!m) return ctx.fail('mod.not_member'); if (!r.editable) return ctx.fail('roles.too_high'); await m.roles.remove(r, `by ${ctx.user.username}`); return done(ctx, 'roles.removed', { role: `${r}` }, 'role.take', { role: r.name, target: m.id }); } },
        info: {
          options: [opt.role('role', true)],
          async run(ctx) {
            const r = ctx.roleOpt('role');
            const perms = r.permissions.has('Administrator') ? [permName(ctx.t, 'Administrator')] : r.permissions.toArray().map(p => permName(ctx.t, p));
            const e = embed(r.color || COLORS.muted).setTitle(r.name).addFields(
              { name: 'ID', value: `\`${r.id}\``, inline: true }, { name: ctx.t('conf.members'), value: String(r.members.size), inline: true },
              { name: ctx.t('conf.position'), value: String(r.position), inline: true }, { name: ctx.t('conf.created'), value: ts(r.createdTimestamp, 'D'), inline: true },
              { name: ctx.t('conf.permissions'), value: clip(perms.join(', ') || '—', 1024) },
            );
            return ctx.reply({ embeds: [e], flags: EPHEMERAL });
          },
        },
      },
    },
    // ------------------------------------------------------------- /perms
    {
      name: 'perms', category: 'server', perms: ['ManageRoles', 'ManageChannels'], botPerms: ['ManageRoles', 'ManageChannels'], botPermsScope: 'guild',
      subs: {
        view: {
          options: [opt.channel('channel', true), opt.mentionable('target')],
          async run(ctx) {
            const ch = ctx.channelOpt('channel');
            const target = ctx.i.options.getMentionable('target');
            const list = [...ch.permissionOverwrites.cache.values()].filter(o => !target || o.id === target.id);
            const lines = list.map(o => {
              const who = o.type === OverwriteType.Role ? (o.id === ctx.guild.id ? '@everyone' : `<@&${o.id}>`) : `<@${o.id}>`;
              const allow = o.allow.toArray().map(p => `✅ ${permName(ctx.t, p)}`), deny = o.deny.toArray().map(p => `⛔ ${permName(ctx.t, p)}`);
              return `**${who}**\n${[...allow, ...deny].join(' · ') || '—'}`;
            });
            const pages = chunk(lines, 3900);
            return ctx.reply({ embeds: pages.slice(0, 5).map((d, i) => ctx.bot.embed(ctx.guild.id).setTitle(i ? null : ctx.t('conf.perms_title', { channel: ch.name })).setDescription(d)), flags: EPHEMERAL }).catch(() => ctx.fail('conf.perms_none'));
          },
        },
        set: {
          options: [opt.channel('channel', true), opt.mentionable('target', true), opt.string('permission', true, { autocomplete: true }), opt.string('value', true, { choices: { set: 'permValue', values: ['allow', 'deny', 'inherit'] } })],
          autocomplete: permAutocomplete,
          async run(ctx) {
            const ch = ctx.channelOpt('channel'), target = ctx.i.options.getMentionable('target'), p = ctx.str('permission');
            if (!PERMISSION_NAMES.includes(p)) return ctx.fail('conf.bad_permission');
            const v = { allow: true, deny: false, inherit: null }[ctx.str('value')];
            await ch.permissionOverwrites.edit(target.id, { [p]: v }, { reason: `by ${ctx.user.username}` });
            return done(ctx, 'conf.saved', {}, 'perms.set', { channel: ch.name, target: target.id, permission: p, value: ctx.str('value') });
          },
        },
        clear: {
          options: [opt.channel('channel', true), opt.mentionable('target', true)],
          async run(ctx) {
            const ch = ctx.channelOpt('channel'), target = ctx.i.options.getMentionable('target');
            if (!(await confirm(ctx, { text: ctx.t('conf.confirm_perms_clear', { channel: ch.name }) }))) return;
            await ch.permissionOverwrites.delete(target.id, `by ${ctx.user.username}`);
            return followDone(ctx, 'conf.saved', {}, 'perms.clear', { channel: ch.name, target: target.id });
          },
        },
        copy: {
          options: [opt.channel('from', true), opt.channel('to', true)],
          async run(ctx) {
            const from = ctx.channelOpt('from'), to = ctx.channelOpt('to');
            if (!(await confirm(ctx, { text: ctx.t('conf.confirm_perms_copy', { from: from.name, to: to.name }) }))) return;
            await to.permissionOverwrites.set(from.permissionOverwrites.cache.map(o => ({ id: o.id, type: o.type, allow: o.allow.bitfield, deny: o.deny.bitfield })), `by ${ctx.user.username}`);
            return followDone(ctx, 'conf.saved', {}, 'perms.copy', { from: from.name, to: to.name });
          },
        },
      },
    },
    // ------------------------------------------------------------- /emoji, /sticker
    {
      name: 'emoji', category: 'server', perms: ['ManageGuildExpressions'], botPerms: ['ManageGuildExpressions'], botPermsScope: 'guild',
      subs: {
        add: {
          options: [opt.string('name', true, { min: 2, max: 32 }), opt.attachment('image'), opt.string('url', false, { max: 500 })],
          async run(ctx) {
            await ctx.defer();
            const url = await imageFrom(ctx);
            if (!url) return ctx.reply({ content: ctx.t('conf.need_image') });
            const e = await ctx.guild.emojis.create({ attachment: url, name: ctx.str('name').replace(/[^\w]/g, '_') });
            return done(ctx, 'conf.emoji_added', { emoji: `${e}` }, 'emoji.add', { name: e.name });
          },
        },
        delete: {
          options: [opt.string('emoji', true, { autocomplete: true })],
          autocomplete: (ctx) => ctx.guild.emojis.cache.filter(e => e.name.toLowerCase().includes((ctx.i.options.getFocused() || '').toLowerCase())).first(25).map(e => ({ name: e.name, value: e.id })),
          async run(ctx) {
            const e = ctx.guild.emojis.cache.get(ctx.str('emoji'));
            if (!e) return ctx.fail('conf.not_found');
            if (!(await confirm(ctx, { text: ctx.t('conf.confirm_emoji_delete', { name: e.name }) }))) return;
            await e.delete(`by ${ctx.user.username}`);
            return followDone(ctx, 'conf.deleted', { name: e.name }, 'emoji.delete', { name: e.name });
          },
        },
        rename: {
          options: [opt.string('emoji', true, { autocomplete: true }), opt.string('name', true, { min: 2, max: 32 })],
          autocomplete: (ctx) => ctx.guild.emojis.cache.first(25).map(e => ({ name: e.name, value: e.id })),
          async run(ctx) { const e = ctx.guild.emojis.cache.get(ctx.str('emoji')); if (!e) return ctx.fail('conf.not_found'); await e.setName(ctx.str('name').replace(/[^\w]/g, '_')); return done(ctx, 'conf.saved', {}, 'emoji.rename', { name: e.name }); },
        },
        list: {
          async run(ctx) {
            const list = ctx.guild.emojis.cache.map(e => `${e} \`:${e.name}:\``);
            return ctx.reply({ embeds: chunk(list, 3900).slice(0, 5).map((d, i) => ctx.bot.embed(ctx.guild.id).setTitle(i ? null : ctx.t('conf.emoji_title', { count: list.length })).setDescription(d)).concat(list.length ? [] : [ctx.bot.embed(ctx.guild.id).setDescription('—')]), flags: EPHEMERAL });
          },
        },
      },
    },
    {
      name: 'sticker', category: 'server', perms: ['ManageGuildExpressions'], botPerms: ['ManageGuildExpressions'], botPermsScope: 'guild',
      subs: {
        add: {
          options: [opt.string('name', true, { min: 2, max: 30 }), opt.attachment('image', true), opt.string('emoji', true, { max: 32 }), opt.string('description', false, { max: 100 })],
          async run(ctx) {
            await ctx.defer();
            const s = await ctx.guild.stickers.create({ file: ctx.attachment('image').url, name: ctx.str('name'), tags: ctx.str('emoji'), description: ctx.str('description') || '' });
            return done(ctx, 'conf.sticker_added', { name: s.name }, 'sticker.add', { name: s.name });
          },
        },
        delete: {
          options: [opt.string('sticker', true, { autocomplete: true })],
          autocomplete: async (ctx) => (await ctx.guild.stickers.fetch()).first(25).map(s => ({ name: s.name, value: s.id })),
          async run(ctx) {
            const s = await ctx.guild.stickers.fetch(ctx.str('sticker')).catch(() => null);
            if (!s) return ctx.fail('conf.not_found');
            if (!(await confirm(ctx, { text: ctx.t('conf.confirm_sticker_delete', { name: s.name }) }))) return;
            await s.delete();
            return followDone(ctx, 'conf.deleted', { name: s.name }, 'sticker.delete', { name: s.name });
          },
        },
      },
    },
    // ------------------------------------------------------------- /event
    {
      name: 'event', category: 'server', perms: ['ManageEvents'], botPerms: ['ManageEvents'], botPermsScope: 'guild',
      subs: {
        create: {
          options: [opt.string('name', true, { max: 100 }), opt.string('starts_in', true, { max: 20 }), opt.string('duration', false, { max: 20 }), opt.channel('channel', false, { channelTypes: ['voice', 'stage'] }), opt.string('location', false, { max: 100 }), opt.string('description', false, { max: 1000 }), opt.attachment('image')],
          async run(ctx) {
            const start = parseDuration(ctx.str('starts_in'));
            if (!start || start < 60_000) return ctx.fail('conf.bad_start');
            const startAt = Date.now() + start;
            const dur = parseDuration(ctx.str('duration') || '2h') || 7_200_000;
            const ch = ctx.channelOpt('channel');
            const external = !ch;
            if (external && !ctx.str('location')) return ctx.fail('conf.need_location');
            const ev = await ctx.guild.scheduledEvents.create({
              name: ctx.str('name'), scheduledStartTime: startAt, scheduledEndTime: startAt + dur, privacyLevel: GuildScheduledEventPrivacyLevel.GuildOnly,
              entityType: external ? GuildScheduledEventEntityType.External : ch.type === ChannelType.GuildStageVoice ? GuildScheduledEventEntityType.StageInstance : GuildScheduledEventEntityType.Voice,
              channel: ch?.id, entityMetadata: external ? { location: ctx.str('location') } : undefined, description: ctx.str('description') || undefined, image: ctx.attachment('image')?.url,
            });
            return done(ctx, 'conf.event_created', { url: ev.url, when: ts(startAt) }, 'event.create', { name: ev.name });
          },
        },
        list: {
          async run(ctx) {
            const list = await ctx.guild.scheduledEvents.fetch();
            const lines = [...list.values()].map(e => `**${e.name}** · ${ts(e.scheduledStartTimestamp)} · ${e.userCount ?? 0} 👥 · [↗](${e.url})`);
            return ctx.reply({ embeds: [ctx.bot.embed(ctx.guild.id).setTitle(ctx.t('conf.events_title')).setDescription(lines.join('\n') || '—')], flags: EPHEMERAL });
          },
        },
        delete: {
          options: [opt.string('event', true, { autocomplete: true })],
          autocomplete: async (ctx) => [...(await ctx.guild.scheduledEvents.fetch()).values()].slice(0, 25).map(e => ({ name: e.name, value: e.id })),
          async run(ctx) {
            const ev = await ctx.guild.scheduledEvents.fetch(ctx.str('event')).catch(() => null);
            if (!ev) return ctx.fail('conf.not_found');
            if (!(await confirm(ctx, { text: ctx.t('conf.confirm_event_delete', { name: ev.name }) }))) return;
            await ev.delete();
            return followDone(ctx, 'conf.deleted', { name: ev.name }, 'event.delete', { name: ev.name });
          },
        },
      },
    },
    // ------------------------------------------------------------- /webhook
    {
      name: 'webhook', category: 'server', perms: ['ManageWebhooks'], botPerms: ['ManageWebhooks'],
      subs: {
        create: {
          options: [opt.string('name', true, { max: 80 }), opt.channel('channel', false, { channelTypes: ['text', 'announcement', 'forum'] }), opt.attachment('avatar')],
          async run(ctx) {
            const ch = ctx.channelOpt('channel') || ctx.i.channel;
            const wh = await ch.createWebhook({ name: ctx.str('name'), avatar: ctx.attachment('avatar')?.url, reason: `by ${ctx.user.username}` });
            await audit(ctx, 'webhook.create', { name: wh.name, channel: ch.name });
            return ctx.reply({ embeds: [okEmbed(ctx.t('conf.webhook_created', { name: wh.name, url: wh.url }))], flags: EPHEMERAL });
          },
        },
        list: {
          async run(ctx) {
            const list = await ctx.guild.fetchWebhooks();
            const lines = [...list.values()].map(w => `**${w.name}** · <#${w.channelId}> · ${w.owner ? `${w.owner}` : '—'} \`${w.id}\``);
            return ctx.reply({ embeds: [ctx.bot.embed(ctx.guild.id).setTitle(ctx.t('conf.webhooks_title')).setDescription(clip(lines.join('\n') || '—', 4000))], flags: EPHEMERAL });
          },
        },
        delete: {
          options: [opt.string('webhook', true, { autocomplete: true })],
          autocomplete: async (ctx) => [...(await ctx.guild.fetchWebhooks()).values()].slice(0, 25).map(w => ({ name: `${w.name} (#${w.channel?.name ?? '?'})`, value: w.id })),
          async run(ctx) {
            const wh = (await ctx.guild.fetchWebhooks()).get(ctx.str('webhook'));
            if (!wh) return ctx.fail('conf.not_found');
            if (!(await confirm(ctx, { text: ctx.t('conf.confirm_webhook_delete', { name: wh.name }) }))) return;
            await wh.delete(`by ${ctx.user.username}`);
            return followDone(ctx, 'conf.deleted', { name: wh.name }, 'webhook.delete', { name: wh.name });
          },
        },
        send: {
          options: [opt.string('webhook', true, { autocomplete: true }), opt.string('content', true, { max: 2000 }), opt.string('username', false, { max: 80 })],
          autocomplete: async (ctx) => [...(await ctx.guild.fetchWebhooks()).values()].filter(w => w.token).slice(0, 25).map(w => ({ name: `${w.name} (#${w.channel?.name ?? '?'})`, value: w.id })),
          async run(ctx) {
            const wh = (await ctx.guild.fetchWebhooks()).get(ctx.str('webhook'));
            if (!wh?.token) return ctx.fail('conf.not_found');
            await wh.send({ content: ctx.str('content').replace(/\\n/g, '\n'), username: ctx.str('username') || undefined, allowedMentions: { parse: [] } });
            return done(ctx, 'conf.sent', {}, 'webhook.send', { name: wh.name });
          },
        },
      },
    },
    // ------------------------------------------------------------- /template
    {
      name: 'template', category: 'server', perms: ['ManageGuild'], botPerms: ['ManageGuild'], botPermsScope: 'guild',
      subs: {
        create: {
          options: [opt.string('name', true, { max: 100 }), opt.string('description', false, { max: 120 })],
          async run(ctx) { const tpl = await ctx.guild.createTemplate(ctx.str('name'), ctx.str('description') || undefined); return done(ctx, 'conf.template_created', { url: tpl.url }, 'template.create', { name: tpl.name }); },
        },
        list: {
          async run(ctx) {
            const list = await ctx.guild.fetchTemplates();
            const lines = [...list.values()].map(t => `**${t.name}** · ${t.url} · ${t.unSynced ? '⚠️' : '✅'} · ${t.usageCount}×`);
            return ctx.reply({ embeds: [ctx.bot.embed(ctx.guild.id).setTitle(ctx.t('conf.templates_title')).setDescription(lines.join('\n') || '—')], flags: EPHEMERAL });
          },
        },
        sync: {
          async run(ctx) {
            const list = await ctx.guild.fetchTemplates();
            for (const t of list.values()) await t.sync();
            return done(ctx, 'conf.templates_synced', { count: list.size }, 'template.sync', {});
          },
        },
        delete: {
          options: [opt.string('code', true, { autocomplete: true })],
          autocomplete: async (ctx) => [...(await ctx.guild.fetchTemplates()).values()].map(t => ({ name: t.name, value: t.code })),
          async run(ctx) {
            const t = (await ctx.guild.fetchTemplates()).get(ctx.str('code'));
            if (!t) return ctx.fail('conf.not_found');
            if (!(await confirm(ctx, { text: ctx.t('conf.confirm_template_delete', { name: t.name }) }))) return;
            await t.delete();
            return followDone(ctx, 'conf.deleted', { name: t.name }, 'template.delete', { name: t.name });
          },
        },
      },
    },
  ],
};
