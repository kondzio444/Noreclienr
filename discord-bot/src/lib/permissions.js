/**
 * Permission helpers that do not need a live Discord connection (unit-tested).
 * Permission names are discord.js PermissionFlagsBits keys ("BanMembers", "ManageChannels" …).
 */
import { PermissionFlagsBits } from 'discord.js';

/** Bitfield (bigint | number | string | {bitfield}) → bigint. */
export function toBits(p) {
  if (p === null || p === undefined) return 0n;
  if (typeof p === 'bigint') return p;
  if (typeof p === 'object' && 'bitfield' in p) return BigInt(p.bitfield);
  return BigInt(p);
}

export function bitsOf(names) {
  let bits = 0n;
  for (const n of names || []) {
    const b = PermissionFlagsBits[n];
    if (b === undefined) throw new Error(`Unknown permission: ${n}`);
    bits |= b;
  }
  return bits;
}

/** Names from `required` the holder does not have (Administrator grants everything). */
export function missingPermissions(have, required) {
  const bits = toBits(have);
  if ((bits & PermissionFlagsBits.Administrator) === PermissionFlagsBits.Administrator) return [];
  return (required || []).filter(n => (bits & PermissionFlagsBits[n]) !== PermissionFlagsBits[n]);
}

/**
 * Can `actor` (a moderator) act on `target`? Returns null when allowed, or an error code:
 *  self, owner, bot_self, actor_hierarchy, bot_hierarchy
 * Positions are the highest role positions; the guild owner always outranks everybody.
 */
export function hierarchyCheck({ actorId, targetId, ownerId, botId, actorTop, targetTop, botTop }) {
  if (targetId === actorId) return 'self';
  if (targetId === ownerId) return 'owner';
  if (targetId === botId) return 'bot_self';
  if (actorId !== ownerId && actorTop <= targetTop) return 'actor_hierarchy';
  if (botTop <= targetTop) return 'bot_hierarchy';
  return null;
}

/** Can the bot manage (assign/edit) a role at `rolePosition`? */
export function canManageRole({ botTop, rolePosition, managed = false, isEveryone = false }) {
  if (managed || isEveryone) return false;
  return botTop > rolePosition;
}

/** Translation key for a permission name ("perm.BanMembers"). */
export const permKey = (name) => `perm.${name}`;

/** True if the member holds one of the roles (array of ids) or has any of the permissions. */
export function hasRoleOrPerm(memberRoleIds, memberPerms, roleIds = [], perms = []) {
  if (roleIds.some(r => memberRoleIds.includes(r))) return true;
  if (perms.length && missingPermissions(memberPerms, perms).length < perms.length) return true;
  return false;
}
