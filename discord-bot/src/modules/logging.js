/**
 * Logging to configurable channels: message edits/deletes (+ bulk), joins/leaves, nickname and
 * role changes of members, bans, role/channel create/update/delete, server updates, voice activity.
 */
import { AttachmentBuilder, AuditLogEvent } from 'discord.js';
import { embed, COLORS } from '../core/ui.js';
import { clip } from '../lib/template.js';
import { ts } from '../lib/duration.js';

function target(bot, guild, kind) {
  const cfg = bot.cfg(guild.id).logging;
  return cfg.enabled ? cfg[kind] || null : null;
}

function ignored(bot, guildId, channel, author) {
  const cfg = bot.cfg(guildId).logging;
  if (author?.bot && cfg.ignoreBots) return true;
  return !!channel && (cfg.ignoredChannels.includes(channel.id) || cfg.ignoredChannels.includes(channel.parentId));
}

async function send(bot, guild, kind, e, files) {
  const ch = target(bot, guild, kind);
  if (ch) await bot.send(guild, ch, { embeds: [e.setTimestamp()], files, allowedMentions: { parse: [] } });
}

/** Who did it (from the audit log, best effort). */
async function executor(guild, type, targetId) {
  try {
    const logs = await guild.fetchAuditLogs({ type, limit: 5 });
    const entry = logs.entries.find(e => (!targetId || e.target?.id === targetId) && Date.now() - e.createdTimestamp < 10_000);
    return entry?.executor ? `<@${entry.executor.id}>` : null;
  } catch { return null; }
}

const diff = (a, b) => (a === b ? null : `${clip(a ?? '—', 400)} → ${clip(b ?? '—', 400)}`);

export default {
  name: 'logging',
  events: {
    async messageUpdate(bot, before, after) {
      if (!after.guild || before.content === after.content || ignored(bot, after.guild.id, after.channel, after.author)) return;
      if (before.partial && !before.content) return; // we never saw the old text
      const t = bot.tg(after.guild.id);
      await send(bot, after.guild, 'messages', embed(COLORS.info).setAuthor({ name: t('log.message_edited'), iconURL: after.author?.displayAvatarURL() })
        .setDescription(`${after.author} · <#${after.channelId}> · [${t('log.jump')}](${after.url})`)
        .addFields({ name: t('log.before'), value: clip(before.content || '—', 1024) }, { name: t('log.after'), value: clip(after.content || '—', 1024) }));
    },
    async messageDelete(bot, msg) {
      if (!msg.guild || ignored(bot, msg.guild.id, msg.channel, msg.author)) return;
      const t = bot.tg(msg.guild.id);
      const e = embed(COLORS.error).setAuthor({ name: t('log.message_deleted'), iconURL: msg.author?.displayAvatarURL() })
        .setDescription(`${msg.author || t('log.unknown_author')} · <#${msg.channelId}>\n${clip(msg.content || (msg.partial ? t('log.not_cached') : '—'), 3500)}`);
      if (msg.attachments?.size) e.addFields({ name: t('log.attachments'), value: clip(msg.attachments.map(a => a.name).join(', '), 1024) });
      await send(bot, msg.guild, 'messages', e);
    },
    async messageDeleteBulk(bot, messages, channel) {
      if (!channel.guild || ignored(bot, channel.guild.id, channel)) return;
      const t = bot.tg(channel.guild.id);
      const text = [...messages.values()].reverse().map(m => `[${new Date(m.createdTimestamp).toISOString()}] ${m.author?.tag || m.author?.username || '?'}: ${m.content || ''}`).join('\n');
      await send(bot, channel.guild, 'messages', embed(COLORS.error).setDescription(t('log.bulk_deleted', { count: messages.size, channel: `<#${channel.id}>` })),
        [new AttachmentBuilder(Buffer.from(text), { name: `bulk-${channel.id}.txt` })]);
    },
    async guildMemberAdd(bot, m) {
      const t = bot.tg(m.guild.id);
      const age = Date.now() - m.user.createdTimestamp;
      await send(bot, m.guild, 'members', embed(COLORS.ok).setAuthor({ name: t('log.member_joined'), iconURL: m.user.displayAvatarURL() })
        .setDescription(`${m} \`${m.user.tag || m.user.username}\` (\`${m.id}\`)\n${t('log.account_created', { when: ts(m.user.createdTimestamp) })}${age < 7 * 86_400_000 ? ` ⚠️ ${t('log.new_account')}` : ''}`)
        .setFooter({ text: t('log.member_count', { count: m.guild.memberCount }) }));
    },
    async guildMemberRemove(bot, m) {
      const t = bot.tg(m.guild.id);
      const roles = m.roles?.cache?.filter(r => r.id !== m.guild.id).map(r => r.name).join(', ');
      const kickedBy = await executor(m.guild, AuditLogEvent.MemberKick, m.id);
      await send(bot, m.guild, 'members', embed(COLORS.warn).setAuthor({ name: kickedBy ? t('log.member_kicked') : t('log.member_left'), iconURL: m.user.displayAvatarURL() })
        .setDescription(`${m.user} \`${m.user.tag || m.user.username}\`${m.joinedTimestamp ? `\n${t('log.joined_at', { when: ts(m.joinedTimestamp) })}` : ''}${kickedBy ? `\n${t('log.by', { user: kickedBy })}` : ''}`)
        .addFields({ name: t('log.roles'), value: clip(roles || '—', 1024) }));
    },
    async guildMemberUpdate(bot, before, after) {
      const t = bot.tg(after.guild.id);
      if (before.nickname !== after.nickname && !before.partial) {
        await send(bot, after.guild, 'members', embed(COLORS.info).setAuthor({ name: t('log.nickname'), iconURL: after.user.displayAvatarURL() }).setDescription(`${after}\n${diff(before.nickname, after.nickname)}`));
      }
      if (before.partial) return;
      const added = after.roles.cache.filter(r => !before.roles.cache.has(r.id));
      const removed = before.roles.cache.filter(r => !after.roles.cache.has(r.id));
      if (added.size || removed.size) {
        await send(bot, after.guild, 'members', embed(COLORS.info).setAuthor({ name: t('log.roles_changed'), iconURL: after.user.displayAvatarURL() })
          .setDescription(`${after}\n${added.size ? `➕ ${added.map(r => `${r}`).join(' ')}\n` : ''}${removed.size ? `➖ ${removed.map(r => `${r}`).join(' ')}` : ''}`));
      }
      if (!before.communicationDisabledUntilTimestamp && after.communicationDisabledUntilTimestamp > Date.now()) {
        await send(bot, after.guild, 'members', embed(COLORS.warn).setDescription(t('log.timed_out', { user: `${after}`, until: ts(after.communicationDisabledUntilTimestamp) })));
      }
    },
    async guildBanAdd(bot, ban) {
      const t = bot.tg(ban.guild.id);
      const by = await executor(ban.guild, AuditLogEvent.MemberBanAdd, ban.user.id);
      await send(bot, ban.guild, 'members', embed(COLORS.error).setDescription(`${t('log.banned', { user: `${ban.user} \`${ban.user.username}\`` })}${by ? ` · ${t('log.by', { user: by })}` : ''}${ban.reason ? `\n${clip(ban.reason, 500)}` : ''}`));
    },
    async guildBanRemove(bot, ban) {
      const t = bot.tg(ban.guild.id);
      await send(bot, ban.guild, 'members', embed(COLORS.ok).setDescription(t('log.unbanned', { user: `${ban.user} \`${ban.user.username}\`` })));
    },
    async roleCreate(bot, role) { const t = bot.tg(role.guild.id); await send(bot, role.guild, 'server', embed(COLORS.ok).setDescription(t('log.role_created', { role: `${role}`, name: role.name }))); },
    async roleDelete(bot, role) { const t = bot.tg(role.guild.id); await send(bot, role.guild, 'server', embed(COLORS.error).setDescription(t('log.role_deleted', { name: role.name }))); },
    async roleUpdate(bot, before, after) {
      const t = bot.tg(after.guild.id);
      const changes = [
        diff(before.name, after.name) && `**${t('log.name')}:** ${diff(before.name, after.name)}`,
        before.color !== after.color && `**${t('log.color')}:** #${before.color.toString(16).padStart(6, '0')} → #${after.color.toString(16).padStart(6, '0')}`,
        before.permissions.bitfield !== after.permissions.bitfield && `**${t('log.permissions')}:** ${t('log.changed')}`,
        before.hoist !== after.hoist && `**hoist:** ${before.hoist} → ${after.hoist}`,
        before.mentionable !== after.mentionable && `**mentionable:** ${before.mentionable} → ${after.mentionable}`,
      ].filter(Boolean);
      if (changes.length) await send(bot, after.guild, 'server', embed(COLORS.info).setDescription(`${t('log.role_updated', { role: `${after}` })}\n${changes.join('\n')}`));
    },
    async channelCreate(bot, ch) { if (!ch.guild) return; const t = bot.tg(ch.guild.id); await send(bot, ch.guild, 'server', embed(COLORS.ok).setDescription(t('log.channel_created', { channel: `${ch}`, name: ch.name }))); },
    async channelDelete(bot, ch) { if (!ch.guild) return; const t = bot.tg(ch.guild.id); await send(bot, ch.guild, 'server', embed(COLORS.error).setDescription(t('log.channel_deleted', { name: ch.name }))); },
    async channelUpdate(bot, before, after) {
      if (!after.guild) return;
      const t = bot.tg(after.guild.id);
      const changes = [
        diff(before.name, after.name) && `**${t('log.name')}:** ${diff(before.name, after.name)}`,
        'topic' in after && diff(before.topic, after.topic) && `**${t('log.topic')}:** ${diff(before.topic, after.topic)}`,
        before.parentId !== after.parentId && `**${t('log.category')}:** ${before.parent?.name ?? '—'} → ${after.parent?.name ?? '—'}`,
        before.rateLimitPerUser !== after.rateLimitPerUser && `**slowmode:** ${before.rateLimitPerUser ?? 0}s → ${after.rateLimitPerUser ?? 0}s`,
        before.permissionOverwrites?.cache?.size !== after.permissionOverwrites?.cache?.size && `**${t('log.permissions')}:** ${t('log.changed')}`,
      ].filter(Boolean);
      if (changes.length) await send(bot, after.guild, 'server', embed(COLORS.info).setDescription(`${t('log.channel_updated', { channel: `${after}` })}\n${changes.join('\n')}`));
    },
    async guildUpdate(bot, before, after) {
      const t = bot.tg(after.id);
      const changes = [
        diff(before.name, after.name) && `**${t('log.name')}:** ${diff(before.name, after.name)}`,
        before.icon !== after.icon && `**${t('log.icon')}:** ${t('log.changed')}`,
        before.verificationLevel !== after.verificationLevel && `**${t('log.verification')}:** ${before.verificationLevel} → ${after.verificationLevel}`,
        before.vanityURLCode !== after.vanityURLCode && `**vanity:** ${before.vanityURLCode ?? '—'} → ${after.vanityURLCode ?? '—'}`,
      ].filter(Boolean);
      if (changes.length) await send(bot, after, 'server', embed(COLORS.info).setDescription(`${t('log.server_updated')}\n${changes.join('\n')}`));
    },
    async voiceStateUpdate(bot, before, after) {
      const guild = after.guild;
      const member = after.member || before.member;
      if (!member || ignored(bot, guild.id, null, member.user)) return;
      const t = bot.tg(guild.id);
      let text = null;
      if (!before.channelId && after.channelId) text = t('log.voice_join', { user: `${member}`, channel: `<#${after.channelId}>` });
      else if (before.channelId && !after.channelId) text = t('log.voice_leave', { user: `${member}`, channel: `<#${before.channelId}>` });
      else if (before.channelId !== after.channelId) text = t('log.voice_move', { user: `${member}`, from: `<#${before.channelId}>`, to: `<#${after.channelId}>` });
      if (text) await send(bot, guild, 'voice', embed(COLORS.muted).setDescription(text));
    },
  },
};
