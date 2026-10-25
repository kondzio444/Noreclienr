/**
 * Server layouts – shared by the builder (templates) and backups.
 *
 * A layout is plain JSON:
 *   { roles: [{ key, name, color, hoist, mentionable, permissions:[names] | bitfield string, icon? }],   // top → bottom
 *     channels: [{ key, name, type, parent (key of a category) | null, topic, nsfw, slowmode, bitrate?, userLimit?,
 *                  overwrites: [{ target: roleKey | '@everyone' | '@bot' | id, type: 'role'|'member', allow:[names], deny:[names] }],
 *                  tags?: [{ name, emoji }] }],
 *     settings?: { … } }
 *
 * planLayout() compares a desired layout with the guild's current state (a snapshot of the same
 * shape plus the builder's key→id map) and returns serializable operations; it is pure and unit-tested.
 * Matching: the stored id of a key first, then the same name (case/emoji-insensitive) and type
 * (and parent for channels) – so re-running a template never duplicates anything.
 */

export const LIMITS = { roles: 250, channels: 500, perCategory: 50, roleName: 100, channelName: 100, topic: 1024 };
export const TEXT_TYPES = new Set(['text', 'announcement', 'forum']);

/** Comparable form of a name: lowercase, no emoji/separators/dashes. */
export function normName(n) {
  return String(n || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

/** Discord text channel slug: lowercase, spaces → dashes, keeps emoji and the "・" separator. */
export function slug(name) {
  return String(name).toLowerCase().trim().replace(/\s+/g, '-').replace(/[#@:`"'<>]/g, '').replace(/-{2,}/g, '-').slice(0, LIMITS.channelName);
}

/** Validates a desired layout against Discord limits; returns a list of problems (empty = ok). */
export function validateLayout(layout) {
  const p = [];
  const roles = layout.roles || [], channels = layout.channels || [];
  if (roles.length > LIMITS.roles) p.push(`${roles.length} roles > ${LIMITS.roles}`);
  if (channels.length > LIMITS.channels) p.push(`${channels.length} channels > ${LIMITS.channels}`);
  const keys = new Set();
  for (const r of roles) {
    if (keys.has(`r:${r.key}`)) p.push(`duplicate role key ${r.key}`);
    keys.add(`r:${r.key}`);
    if (!r.name || r.name.length > LIMITS.roleName) p.push(`role ${r.key}: name length ${r.name?.length}`);
  }
  const perCat = {};
  const cats = new Set(channels.filter(c => c.type === 'category').map(c => c.key));
  for (const c of channels) {
    if (keys.has(`c:${c.key}`)) p.push(`duplicate channel key ${c.key}`);
    keys.add(`c:${c.key}`);
    if (!c.name || c.name.length > LIMITS.channelName) p.push(`channel ${c.key}: name length ${c.name?.length}`);
    if (c.topic && c.topic.length > LIMITS.topic) p.push(`channel ${c.key}: topic too long`);
    if (c.type === 'category' && c.parent) p.push(`category ${c.key} has a parent`);
    if (c.parent) {
      if (!cats.has(c.parent)) p.push(`channel ${c.key}: unknown parent ${c.parent}`);
      perCat[c.parent] = (perCat[c.parent] || 0) + 1;
    }
    for (const o of c.overwrites || []) {
      if (o.target && !o.target.startsWith('@') && !/^\d+$/.test(o.target) && !roles.some(r => r.key === o.target)) p.push(`channel ${c.key}: overwrite for unknown role ${o.target}`);
    }
  }
  for (const [cat, n] of Object.entries(perCat)) if (n > LIMITS.perCategory) p.push(`category ${cat}: ${n} channels > ${LIMITS.perCategory}`);
  return p;
}

function findRole(current, map, r) {
  const byId = map[`r:${r.key}`] && current.roles.find(x => x.id === map[`r:${r.key}`]);
  if (byId) return byId;
  return current.roles.find(x => !x.managed && normName(x.name) === normName(r.name)) || null;
}

function findChannel(current, map, c, parentId) {
  const byId = map[`c:${c.key}`] && current.channels.find(x => x.id === map[`c:${c.key}`]);
  if (byId) return byId;
  const n = normName(c.name);
  return current.channels.find(x => x.type === c.type && normName(x.name) === n && (c.type === 'category' || (x.parentId || null) === (parentId || null)))
    || current.channels.find(x => x.type === c.type && normName(x.name) === n) || null;
}

const colorNum = (c) => (typeof c === 'number' ? c : c ? parseInt(String(c).replace('#', ''), 16) || 0 : 0);
const sameList = (a = [], b = []) => [...a].sort().join(',') === [...b].sort().join(',');

/**
 * @param desired  layout
 * @param current  { roles:[{id,name,color,hoist,mentionable,permissions:[names],managed}], channels:[{id,name,type,parentId,topic,nsfw,slowmode}] }
 * @param opts     { map: { 'r:key'|'c:key': id }, update: bool (repair existing), prune: bool (delete what the layout lacks) }
 * @returns {{ ops: object[], summary: { create:{roles,channels}, update:{roles,channels}, keep:{roles,channels}, delete:{roles,channels} }, map }}
 */
export function planLayout(desired, current, { map = {}, update = false, prune = false } = {}) {
  const ops = [];
  const summary = { create: { roles: 0, channels: 0 }, update: { roles: 0, channels: 0 }, keep: { roles: 0, channels: 0 }, delete: { roles: 0, channels: 0 } };
  const nextMap = { ...map };
  const usedRoles = new Set(), usedChannels = new Set();

  for (const r of desired.roles || []) {
    const ex = findRole(current, map, r);
    if (!ex) { ops.push({ op: 'role.create', key: r.key, data: r }); summary.create.roles++; continue; }
    usedRoles.add(ex.id);
    nextMap[`r:${r.key}`] = ex.id;
    const changed = update && (ex.color !== colorNum(r.color) || !!ex.hoist !== !!r.hoist || !!ex.mentionable !== !!r.mentionable || (Array.isArray(r.permissions) && !sameList(ex.permissions, r.permissions)));
    if (changed) { ops.push({ op: 'role.update', key: r.key, id: ex.id, data: r }); summary.update.roles++; } else summary.keep.roles++;
  }
  if ((desired.roles || []).length) ops.push({ op: 'role.positions', keys: desired.roles.map(r => r.key) });

  const catId = {};
  const ordered = [...(desired.channels || []).filter(c => c.type === 'category'), ...(desired.channels || []).filter(c => c.type !== 'category')];
  for (const c of ordered) {
    const parentId = c.parent ? (catId[c.parent] ?? null) : null;
    const ex = findChannel(current, map, c, parentId);
    if (!ex) { ops.push({ op: 'channel.create', key: c.key, data: c }); summary.create.channels++; if (c.type === 'category') catId[c.key] = undefined; continue; }
    usedChannels.add(ex.id);
    nextMap[`c:${c.key}`] = ex.id;
    if (c.type === 'category') catId[c.key] = ex.id;
    const changed = update && ((c.topic || '') !== (ex.topic || '') || (c.slowmode || 0) !== (ex.slowmode || 0) || !!c.nsfw !== !!ex.nsfw || (c.parent && (ex.parentId || null) !== (parentId || null)) || (c.overwrites?.length && !ex.overwritesMatch));
    if (changed) { ops.push({ op: 'channel.update', key: c.key, id: ex.id, data: c }); summary.update.channels++; } else summary.keep.channels++;
  }
  if ((desired.channels || []).length) ops.push({ op: 'channel.positions', keys: desired.channels.map(c => c.key) });

  if (prune) {
    for (const ch of current.channels) if (!usedChannels.has(ch.id) && !ch.protected) { ops.push({ op: 'channel.delete', id: ch.id, name: ch.name }); summary.delete.channels++; }
    for (const r of current.roles) if (!usedRoles.has(r.id) && !r.managed && !r.everyone && !r.protected) { ops.push({ op: 'role.delete', id: r.id, name: r.name }); summary.delete.roles++; }
  }
  if (desired.settings) ops.push({ op: 'guild.settings', data: desired.settings });
  return { ops, summary, map: nextMap };
}

/** Human readable diff lines for a preview (keys of the plan, not translated). */
export function diffLines(plan, desired, limit = 40) {
  const name = (key, kind) => (kind === 'r' ? desired.roles : desired.channels).find(x => x.key === key)?.name || key;
  const lines = [];
  for (const o of plan.ops) {
    if (o.op === 'role.create') lines.push(`+ @${name(o.key, 'r')}`);
    else if (o.op === 'role.update') lines.push(`~ @${name(o.key, 'r')}`);
    else if (o.op === 'channel.create') lines.push(`+ ${o.data.type === 'category' ? '📁 ' : '#'}${name(o.key, 'c')}`);
    else if (o.op === 'channel.update') lines.push(`~ #${name(o.key, 'c')}`);
    else if (o.op === 'channel.delete') lines.push(`- #${o.name}`);
    else if (o.op === 'role.delete') lines.push(`- @${o.name}`);
  }
  return lines.length > limit ? [...lines.slice(0, limit), `… +${lines.length - limit}`] : lines;
}
