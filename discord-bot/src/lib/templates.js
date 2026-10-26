/**
 * Server templates for the builder (discord-bot/templates/*.json) → a concrete layout in one
 * language and size. Pure (takes a translator), so tests can compile every template in every
 * language and check Discord's limits.
 *
 * Template format (see README.md, section "Szablony kreatora"):
 *   roles:      [{ key, color, hoist, mentionable, perms: "<set>" | [names], icon, size, separator, menu, level, each, bind }]
 *   categories: [{ key, emoji, access, size, each, channels: [{ key, type, emoji, mode, slowmode, size, content, panel, bind, each, name, topic, tags }] }]
 *   lists:      named lists used by `each` (generated roles / categories / channels)
 *   permissionSets: { name: [permission names] }
 * Names come from the locale: tpl.role.<key>, tpl.cat.<key>, tpl.ch.<key>, topics tpl.topic.<key>
 * (keys of generated items use the base key and get {item}/{n} variables).
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { ROOT } from './env.js';
import { slug } from './layout.js';
import { LANGUAGE_NAMES } from '../i18n/index.js';

export const SIZES = ['small', 'medium', 'full'];
const rank = (s) => SIZES.indexOf(s || 'small');
const SEP = '┃';

const FLAGS = { pl: '🇵🇱', en: '🇬🇧' };
export const BUILTIN_LISTS = {
  languages: Object.fromEntries(Object.entries(LANGUAGE_NAMES).map(([k, v]) => [k, { name: v, emoji: FLAGS[k] }])),
};

/** One overwrite per target (Discord rejects duplicates); allow wins over deny of the same entry. */
export function mergeOverwrites(list) {
  const by = new Map();
  for (const o of list) {
    const cur = by.get(o.target) || { target: o.target, allow: new Set(), deny: new Set() };
    for (const p of o.allow) { cur.allow.add(p); cur.deny.delete(p); }
    for (const p of o.deny) if (!cur.allow.has(p)) cur.deny.add(p);
    by.set(o.target, cur);
  }
  return [...by.values()].map(o => ({ target: o.target, allow: [...o.allow], deny: [...o.deny] }));
}

export function loadTemplates(dir = path.join(ROOT, 'templates')) {
  const out = {};
  for (const f of readdirSync(dir).filter(f => f.endsWith('.json'))) {
    const tpl = JSON.parse(readFileSync(path.join(dir, f), 'utf8'));
    out[tpl.id] = tpl;
  }
  return out;
}

/** Expands `each` items: returns [{ key, vars }]. */
function expand(item, lists) {
  if (!item.each) return [{ key: item.key, vars: {}, item }];
  const src = Array.isArray(item.each) ? item.each : (lists[item.each] || BUILTIN_LISTS[item.each]);
  if (!src) throw new Error(`unknown list ${item.each}`);
  // arrays keep their order ([5, 10] or [{ id, name, color, emoji }]); objects are { id: { name, … } }
  const entries = Array.isArray(src)
    ? src.map(v => (v && typeof v === 'object' ? [String(v.id), { name: String(v.name ?? v.id), ...v }] : [String(v), { name: String(v) }]))
    : Object.entries(src).map(([k, v]) => [k, typeof v === 'string' ? { name: v } : v]);
  return entries.map(([id, v], i) => ({ key: item.key.replace('{id}', id.toLowerCase().replace(/[^a-z0-9]/g, '')), vars: { id, item: v.name, n: Number.isFinite(+id) ? +id : i + 1, emoji: v.emoji || item.emoji }, item, entry: v }));
}

/**
 * @returns {{ layout, roles: Map, channels: Map, content:[{channelKey, kind}], panels:[{channelKey, panel}], binds:[{path, ref}], menus, levels, settings, stats }}
 */
export function compileTemplate(tpl, { t, size = 'full', vars = {} }) {
  const lists = tpl.lists || {};
  const sets = tpl.permissionSets || {};
  const R = rank(size);
  const tv = (key, v) => t(key, { ...vars, ...v });
  const roles = [], channels = [], content = [], panels = [], binds = [], menus = {}, levels = [];

  // ---- roles
  for (const r of tpl.roles) {
    if (rank(r.size) > R) continue;
    for (const { key, vars: v, entry } of expand(r, lists)) {
      let name;
      if (r.separator) name = `▬▬▬ ${tv(`tpl.role.${r.key}`, v).toUpperCase()} ▬▬▬`;
      else if (r.each && !r.nameKey) name = `${v.emoji ? v.emoji + ' ' : ''}${tv(`tpl.role.${r.key.replace(/_?\{id\}/, '')}`, v)}`;
      else name = `${r.icon && !r.noPrefix ? r.icon + ' ' : ''}${tv(r.nameKey || `tpl.role.${r.key}`, v)}`;
      const role = {
        key, name: name.slice(0, 100), color: r.separator ? null : (entry?.color || r.color || null), hoist: !!r.hoist && !r.separator, mentionable: !!r.mentionable,
        permissions: r.separator ? [] : Array.isArray(r.perms) ? r.perms : (sets[r.perms || 'none'] || []), icon: r.icon || v.emoji || null,
        base: r.key.replace(/_?\{id\}/, ''), n: v.n, item: v.item, separator: !!r.separator,
      };
      roles.push(role);
      if (r.menu) (menus[r.menu] ??= []).push({ key, emoji: v.emoji || r.icon || '', descKey: r.each ? null : `tpl.roledesc.${r.key}` });
      if (r.level) levels.push({ key, level: v.n || r.level });
      for (const b of r.bind || []) binds.push({ path: b, ref: { role: key } });
    }
  }
  const roleKeys = new Set(roles.map(r => r.key));
  const groupKeys = (g) => (tpl.groups?.[g] || []).filter(k => roleKeys.has(k));

  // ---- access → overwrites (ViewChannel / SendMessages / Connect)
  const VIEW = ['ViewChannel'];
  const access = (a) => {
    const staff = groupKeys('staff'), admins = groupKeys('admin'), member = groupKeys('member');
    switch (a) {
      case 'everyone': return [];
      case 'unverified': return [{ target: '@everyone', allow: VIEW, deny: [] }, ...member.map(k => ({ target: k, allow: [], deny: VIEW })), ...staff.map(k => ({ target: k, allow: VIEW, deny: [] }))];
      case 'member': return [{ target: '@everyone', allow: [], deny: VIEW }, ...member.map(k => ({ target: k, allow: VIEW, deny: [] })), ...staff.map(k => ({ target: k, allow: VIEW, deny: [] }))];
      case 'staff': return [{ target: '@everyone', allow: [], deny: VIEW }, ...staff.map(k => ({ target: k, allow: VIEW, deny: [] }))];
      case 'admin': return [{ target: '@everyone', allow: [], deny: VIEW }, ...admins.map(k => ({ target: k, allow: VIEW, deny: [] }))];
      default:
        if (a && a.startsWith('role:')) return [{ target: '@everyone', allow: [], deny: VIEW }, ...a.slice(5).split(',').filter(k => roleKeys.has(k)).map(k => ({ target: k, allow: VIEW, deny: [] })), ...staff.map(k => ({ target: k, allow: VIEW, deny: [] }))];
        return [];
    }
  };
  const modeOverwrites = (mode, base, category) => {
    const staff = groupKeys('staff');
    const muted = groupKeys('muted');
    const list = base.map(o => ({ ...o, allow: [...o.allow], deny: [...o.deny] }));
    const everyoneTarget = list.find(o => o.target === '@everyone') || (list.push({ target: '@everyone', allow: [], deny: [] }), list.at(-1));
    const memberTargets = category.access === 'member' || category.access?.startsWith('role:') ? list.filter(o => o.target !== '@everyone' && !staff.includes(o.target)) : [everyoneTarget];
    if (mode === 'readonly') {
      for (const o of memberTargets) o.deny.push('SendMessages', 'CreatePublicThreads', 'SendMessagesInThreads');
      if (!memberTargets.includes(everyoneTarget)) everyoneTarget.deny.push('SendMessages');
      for (const k of staff.slice(0, 3)) list.push({ target: k, allow: ['SendMessages'], deny: [] });
      for (const o of memberTargets) o.allow.push('AddReactions');
    }
    if (mode === 'media') for (const o of memberTargets) o.allow.push('AttachFiles', 'EmbedLinks');
    if (mode === 'nolinks') for (const o of memberTargets) o.deny.push('EmbedLinks');
    for (const k of muted) list.push({ target: k, allow: [], deny: ['SendMessages', 'AddReactions', 'Speak', 'SendMessagesInThreads', 'CreatePublicThreads'] });
    return list;
  };

  // ---- categories and channels
  for (const c of tpl.categories) {
    if (rank(c.size) > R) continue;
    for (const { key: rawCatKey, vars: cv } of expand(c, lists)) {
      const catKey = `cat_${rawCatKey}`; // categories and channels share one key space
      const catName = `${cv.emoji || c.emoji} ${SEP} ${tv(`tpl.cat.${c.key.replace(/_?\{id\}/, '')}`, cv).toUpperCase()}`;
      const catOver = access(c.access);
      for (const k of groupKeys('muted')) catOver.push({ target: k, allow: [], deny: ['SendMessages', 'AddReactions', 'Speak', 'SendMessagesInThreads', 'CreatePublicThreads'] });
      channels.push({ key: catKey, name: catName.slice(0, 100), type: 'category', parent: null, overwrites: mergeOverwrites(catOver) });
      if (c.bindCategory) binds.push({ path: c.bindCategory, ref: { channel: catKey } });
      for (const ch of c.channels) {
        if (rank(ch.size) > R) continue;
        for (const { key: chKey, vars: v } of expand(ch, lists)) {
          const allVars = { ...cv, ...v, item: v.item ?? cv.item, n: ch.each ? v.n : cv.n };
          const fullKey = c.each ? `${catKey}_${chKey}` : chKey;
          const baseName = tv(ch.name || `tpl.ch.${ch.key.replace(/_?\{id\}/, '')}`, allVars);
          const emoji = v.emoji && ch.each ? v.emoji : ch.emoji;
          const isVoice = ch.type === 'voice' || ch.type === 'stage';
          const name = isVoice ? `${emoji} ${SEP} ${baseName}` : slug(`${emoji}${SEP}${baseName}`);
          const topicKey = ch.topic || `tpl.topic.${ch.key.replace(/_?\{id\}/, '')}`;
          const topic = isVoice || ch.type === 'category' ? '' : tv(topicKey, allVars);
          const out = {
            key: fullKey, name, type: ch.type || 'text', parent: catKey,
            topic: topic === topicKey ? '' : topic.slice(0, 1024),
            slowmode: ch.slowmode || 0, nsfw: false, userLimit: ch.userLimit || undefined,
            overwrites: mergeOverwrites((ch.mode || ch.access) ? modeOverwrites(ch.mode, ch.access ? access(ch.access) : catOver, ch.access ? { access: ch.access } : c) : catOver),
            tags: ch.tags ? ch.tags.map(tg => ({ name: tv(`tpl.tag.${tg.key}`, {}).slice(0, 20), emoji: tg.emoji, moderated: !!tg.moderated })) : undefined,
            topicKey: isVoice ? null : topicKey,
          };
          channels.push(out);
          for (const k of ch.content || []) content.push({ channelKey: fullKey, kind: k });
          if (ch.panel) panels.push({ channelKey: fullKey, panel: ch.panel });
          for (const b of ch.bind || []) binds.push({ path: b, ref: { channel: fullKey } });
        }
      }
    }
  }
  for (const raw of tpl.binds || []) {
    const b = structuredClone(raw);
    if (b.ref?.role && !roleKeys.has(b.ref.role)) continue;
    if (b.ref?.roles) b.ref.roles = b.ref.roles.filter(k => roleKeys.has(k));
    if (b.ref?.channel && !channels.some(c => c.key === b.ref.channel)) continue;
    if (b.refs) b.refs = b.refs.filter(([, k]) => roleKeys.has(k));
    if (b.refsChannels) { b.refsChannels = b.refsChannels.filter(x => channels.some(c => c.key === x.channel)); if (!b.refsChannels.length) continue; }
    binds.push(b);
  }
  return { layout: { roles, channels }, content, panels, binds, menus, levels, settings: tpl.settings || {}, groups: Object.fromEntries(Object.keys(tpl.groups || {}).map(g => [g, groupKeys(g)])) };
}

/** Number of roles / channels per size (shown in the builder's template picker). */
export function templateStats(tpl, t) {
  return Object.fromEntries(SIZES.map(s => {
    const c = compileTemplate(tpl, { t, size: s });
    return [s, { roles: c.layout.roles.length, channels: c.layout.channels.filter(x => x.type !== 'category').length, categories: c.layout.channels.filter(x => x.type === 'category').length }];
  }));
}
