/**
 * Executes layout operations (src/lib/layout.js) against a guild, one queued step at a time, with
 * checkpoints (the builder and backups can resume after a restart) and progress callbacks.
 */
import { ChannelType, PermissionFlagsBits, OverwriteType } from 'discord.js';
import { JobQueue } from './queue.js';
import { bitsOf } from '../lib/permissions.js';
import { colorInt } from '../lib/template.js';

export const TYPE = { text: ChannelType.GuildText, voice: ChannelType.GuildVoice, category: ChannelType.GuildCategory, announcement: ChannelType.GuildAnnouncement, forum: ChannelType.GuildForum, stage: ChannelType.GuildStageVoice };
export const TYPE_NAME = Object.fromEntries(Object.entries(TYPE).map(([k, v]) => [v, k]));

const permNames = (bits) => Object.entries(PermissionFlagsBits).filter(([, b]) => (BigInt(bits) & b) === b).map(([n]) => n);
const toBits = (p) => (Array.isArray(p) ? bitsOf(p) : BigInt(p || 0));

/** Current guild state in planLayout() shape. */
export function snapshotForPlan(guild, protectIds = []) {
  const prot = new Set([guild.rulesChannelId, guild.publicUpdatesChannelId, guild.systemChannelId, guild.safetyAlertsChannelId, ...protectIds].filter(Boolean));
  return {
    roles: guild.roles.cache.map(r => ({ id: r.id, name: r.name, color: r.color, hoist: r.hoist, mentionable: r.mentionable, permissions: permNames(r.permissions.bitfield), managed: r.managed, everyone: r.id === guild.id, protected: r.position >= guild.members.me.roles.highest.position })),
    channels: guild.channels.cache.filter(c => !c.isThread() && TYPE_NAME[c.type]).map(c => ({ id: c.id, name: c.name, type: TYPE_NAME[c.type], parentId: c.parentId || null, topic: c.topic || '', slowmode: c.rateLimitPerUser || 0, nsfw: !!c.nsfw, protected: prot.has(c.id) })),
  };
}

/** Full layout snapshot (backup): keys are the current ids. */
export function backupLayout(guild) {
  const roles = guild.roles.cache.filter(r => r.id !== guild.id && !r.managed).sort((a, b) => b.position - a.position)
    .map(r => ({ key: r.id, name: r.name, color: r.color ? `#${r.color.toString(16).padStart(6, '0')}` : null, hoist: r.hoist, mentionable: r.mentionable, permissions: r.permissions.bitfield.toString(), icon: r.unicodeEmoji || null }));
  const sorted = guild.channels.cache.filter(c => !c.isThread() && TYPE_NAME[c.type]).sort((a, b) => (a.type === ChannelType.GuildCategory ? -1 : 0) - (b.type === ChannelType.GuildCategory ? -1 : 0) || a.rawPosition - b.rawPosition);
  const channels = sorted.map(c => ({
    key: c.id, name: c.name, type: TYPE_NAME[c.type], parent: c.parentId || null, topic: c.topic || '', nsfw: !!c.nsfw, slowmode: c.rateLimitPerUser || 0,
    bitrate: c.bitrate || undefined, userLimit: c.userLimit || undefined,
    overwrites: c.permissionOverwrites.cache.map(o => ({ target: o.id === guild.id ? '@everyone' : o.id, type: o.type === OverwriteType.Member ? 'member' : 'role', allow: o.allow.bitfield.toString(), deny: o.deny.bitfield.toString() })),
    tags: c.availableTags?.map(t => ({ name: t.name, emoji: t.emoji?.name || null, moderated: t.moderated })) || undefined,
  }));
  return {
    version: 1,
    settings: {
      name: guild.name, description: guild.description, verificationLevel: guild.verificationLevel, explicitContentFilter: guild.explicitContentFilter,
      defaultMessageNotifications: guild.defaultMessageNotifications, afkTimeout: guild.afkTimeout, afkChannel: guild.afkChannelId, systemChannel: guild.systemChannelId,
      rulesChannel: guild.rulesChannelId, publicUpdatesChannel: guild.publicUpdatesChannelId,
    },
    roles, channels,
  };
}

function resolveTarget(guild, map, target) {
  if (target === '@everyone') return guild.id;
  if (target === '@bot') return guild.members.me.id;
  if (/^\d{17,20}$/.test(target)) return map[`r:${target}`] || target;
  return map[`r:${target}`] || null;
}

function overwrites(guild, map, list) {
  const out = [];
  for (const o of list || []) {
    const id = resolveTarget(guild, map, o.target);
    if (!id) continue;
    if (o.type === 'member' && !guild.members.cache.has(id)) continue;
    if (o.type !== 'member' && !guild.roles.cache.has(id)) continue;
    out.push({ id, type: o.type === 'member' ? OverwriteType.Member : OverwriteType.Role, allow: toBits(o.allow), deny: toBits(o.deny) });
  }
  // the bot must keep access to every channel it creates
  if (!out.some(o => o.id === guild.members.me.id) && out.some(o => o.id === guild.id && (BigInt(o.deny) & PermissionFlagsBits.ViewChannel))) {
    out.push({ id: guild.members.me.id, type: OverwriteType.Member, allow: PermissionFlagsBits.ViewChannel | PermissionFlagsBits.SendMessages | PermissionFlagsBits.ManageChannels | PermissionFlagsBits.ManageMessages | PermissionFlagsBits.EmbedLinks | PermissionFlagsBits.ReadMessageHistory, deny: 0n });
  }
  return out;
}

/** Runs ops; `extra(op, map)` handles builder specific ops (posts, config bindings). */
export function runOps(bot, guild, ops, { map, startAt = 0, onProgress, onCheckpoint, extra, reason = 'Nore Bot builder', spacingMs = bot?.queueSpacingMs ?? 300 } = {}) {
  const roleIcons = guild.features.includes('ROLE_ICONS');
  // a bot can only grant permissions it has itself (Administrator grants everything)
  const grantable = (bits) => {
    const mine = guild.members.me.permissions.bitfield;
    return (mine & PermissionFlagsBits.Administrator) ? bits : bits & mine;
  };
  const steps = ops.map((op) => ({
    label: `${op.op} ${op.key || op.name || ''}`.trim(),
    run: async () => {
      switch (op.op) {
        case 'role.create': {
          const r = op.data;
          const role = await guild.roles.create({ name: r.name, colors: { primaryColor: r.color ? colorInt(r.color, 0) : 0 }, hoist: !!r.hoist, mentionable: !!r.mentionable, permissions: grantable(toBits(r.permissions)), unicodeEmoji: roleIcons && r.icon ? r.icon : undefined, reason });
          map[`r:${op.key}`] = role.id;
          break;
        }
        case 'role.update': {
          const role = guild.roles.cache.get(op.id);
          if (!role?.editable) break;
          const r = op.data;
          await role.edit({ colors: { primaryColor: r.color ? colorInt(r.color, 0) : 0 }, hoist: !!r.hoist, mentionable: !!r.mentionable, permissions: grantable(toBits(r.permissions)), reason });
          break;
        }
        case 'role.positions': {
          const top = guild.members.me.roles.highest.position;
          const ids = op.keys.map(k => map[`r:${k}`]).filter(id => { const r = guild.roles.cache.get(id); return r && r.position < top; });
          if (!ids.length) break;
          await guild.roles.setPositions(ids.map((id, i) => ({ role: id, position: Math.max(1, top - 1 - i) })));
          break;
        }
        case 'channel.create': {
          const c = op.data;
          const parent = c.parent ? map[`c:${c.parent}`] : null;
          const data = { name: c.name, type: TYPE[c.type], parent: parent || null, permissionOverwrites: overwrites(guild, map, c.overwrites), reason };
          if (c.type !== 'category' && c.type !== 'voice' && c.type !== 'stage') { if (c.topic) data.topic = c.topic; data.nsfw = !!c.nsfw; data.rateLimitPerUser = c.slowmode || 0; }
          if (c.type === 'voice' || c.type === 'stage') { if (c.userLimit) data.userLimit = c.userLimit; if (c.bitrate) data.bitrate = Math.min(c.bitrate, guild.maximumBitrate); }
          if (c.type === 'forum' && c.tags?.length) data.availableTags = c.tags.slice(0, 20).map(t => ({ name: t.name, emoji: t.emoji ? { name: t.emoji } : null, moderated: !!t.moderated }));
          // announcement, forum and stage channels need Community; without it fall back to text/voice
          if (['announcement', 'forum', 'stage'].includes(c.type) && !guild.features.includes('COMMUNITY')) {
            data.type = c.type === 'stage' ? ChannelType.GuildVoice : ChannelType.GuildText;
            delete data.availableTags;
          }
          const ch = await guild.channels.create(data);
          map[`c:${op.key}`] = ch.id;
          break;
        }
        case 'channel.update': {
          const ch = guild.channels.cache.get(op.id);
          if (!ch?.manageable) break;
          const c = op.data;
          const parent = c.parent ? map[`c:${c.parent}`] : undefined;
          const data = { reason };
          if (c.type !== 'category' && c.type !== 'voice' && c.type !== 'stage') { data.topic = c.topic || null; data.nsfw = !!c.nsfw; data.rateLimitPerUser = c.slowmode || 0; }
          if (parent && parent !== ch.parentId) data.parent = parent;
          if (c.overwrites?.length) data.permissionOverwrites = overwrites(guild, map, c.overwrites);
          await ch.edit(data);
          break;
        }
        case 'channel.positions': {
          const list = [];
          const byParent = {};
          for (const k of op.keys) {
            const id = map[`c:${k}`];
            const ch = id && guild.channels.cache.get(id);
            if (!ch) continue;
            const p = ch.type === ChannelType.GuildCategory ? '__cats' : ch.parentId || '__root';
            byParent[p] = (byParent[p] ?? -1) + 1;
            list.push({ channel: id, position: byParent[p] });
          }
          if (list.length) await guild.channels.setPositions(list);
          break;
        }
        case 'channel.delete': { const ch = guild.channels.cache.get(op.id); if (ch?.deletable) await ch.delete(reason); break; }
        case 'role.delete': { const r = guild.roles.cache.get(op.id); if (r?.editable) await r.delete(reason); break; }
        case 'guild.settings': {
          const s = op.data;
          const edit = {};
          for (const k of ['name', 'verificationLevel', 'explicitContentFilter', 'defaultMessageNotifications', 'afkTimeout']) if (s[k] !== undefined && s[k] !== null) edit[k] = s[k];
          if (s.description && guild.features.includes('COMMUNITY')) edit.description = s.description;
          for (const k of ['afkChannel', 'systemChannel', 'rulesChannel', 'publicUpdatesChannel']) {
            const id = s[k] && (map[`c:${s[k]}`] || s[k]);
            if (id && guild.channels.cache.has(id)) edit[k] = id;
          }
          if (Object.keys(edit).length) await guild.edit({ ...edit, reason });
          break;
        }
        default:
          if (extra) await extra(op, map);
      }
    },
  }));
  return new JobQueue(steps, { startAt, onProgress, onCheckpoint, spacingMs });
}

export { permNames };
