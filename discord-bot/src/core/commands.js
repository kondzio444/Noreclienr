/**
 * Declarative slash commands → Discord JSON with localizations.
 *
 * A command module exports:
 *   { name, module, category, perms?, botPerms?, options?, subs?, groups?, run?, autocomplete?, guildOnly? }
 *   subs:   { <sub>: { options?, perms?, botPerms?, run, autocomplete? } }
 *   groups: { <group>: { <sub>: { … } } }
 *
 * Texts (locales/<lang>.json):
 *   cmd.<name>.desc                      description of the command
 *   cmd.<name>.<sub>.desc                description of a subcommand (cmd.<name>.<group>.<sub>.desc in groups)
 *   cmd.<path>.opt.<option>              description of an option
 *   choice.<set>.<value>                 choice labels (option.choices = { set, values })
 *   cmdname.<name>                       localized top-level name (optional, only languages that define it)
 * English is the base text Discord shows for locales the bot does not translate.
 */
import { ApplicationCommandOptionType as T, PermissionFlagsBits, InteractionContextType, ChannelType } from 'discord.js';
import { t, localizations, has } from '../i18n/index.js';
import { bitsOf } from '../lib/permissions.js';

const CHANNEL_TYPES = {
  text: ChannelType.GuildText, voice: ChannelType.GuildVoice, category: ChannelType.GuildCategory,
  announcement: ChannelType.GuildAnnouncement, forum: ChannelType.GuildForum, stage: ChannelType.GuildStageVoice,
  thread: ChannelType.PublicThread, media: ChannelType.GuildMedia,
};

// ------------------------------------------------------------------ option helpers

const mk = (type) => (name, required = false, extra = {}) => ({ type, name, required, ...extra });
export const opt = {
  string: mk(T.String), int: mk(T.Integer), number: mk(T.Number), bool: mk(T.Boolean),
  user: mk(T.User), channel: mk(T.Channel), role: mk(T.Role), mentionable: mk(T.Mentionable), attachment: mk(T.Attachment),
};

/** Translation key of a choice label: choices.key(v) or choice.<set>.<value>. */
export const choiceKey = (choices, v) => (choices.key ? choices.key(v) : `choice.${choices.set}.${v}`);

const NAME_RE = /^[-_\p{L}\p{N}\p{sc=Deva}\p{sc=Thai}]{1,32}$/u;

function desc(key) {
  const base = t('en', key);
  return { description: base === key ? key : base.slice(0, 100), description_localizations: localizations(key) };
}

function buildOption(o, path) {
  const out = { type: o.type, name: o.name, ...desc(`cmd.${path}.opt.${o.name}`), required: !!o.required };
  if (o.choices) {
    const { values, names } = o.choices;
    out.choices = values.map((v) => {
      if (names) return { name: String(names[v] ?? v).slice(0, 100), value: v };
      const key = choiceKey(o.choices, v);
      const en = t('en', key);
      return { name: (en === key ? String(v) : en).slice(0, 100), name_localizations: localizations(key), value: v };
    });
  }
  if (o.min !== undefined) { if (o.type === T.String) out.min_length = o.min; else out.min_value = o.min; }
  if (o.max !== undefined) { if (o.type === T.String) out.max_length = o.max; else out.max_value = o.max; }
  if (o.autocomplete) out.autocomplete = true;
  if (o.channelTypes) out.channel_types = o.channelTypes.map(c => CHANNEL_TYPES[c]);
  return out;
}

function buildSub(name, sub, path, type = T.Subcommand) {
  return { type, name, ...desc(`cmd.${path}.desc`), options: (sub.options || []).map(o => buildOption(o, path)) };
}

/** Command definition → JSON for PUT /applications/:id/commands. */
export function buildCommand(def) {
  const json = {
    name: def.name,
    ...desc(`cmd.${def.name}.desc`),
    type: 1,
    contexts: [InteractionContextType.Guild],
    nsfw: false,
  };
  const names = localizations(`cmdname.${def.name}`, { max: 32, transform: (s) => s.toLowerCase() });
  if (Object.keys(names).length) json.name_localizations = names;
  if (def.perms?.length) json.default_member_permissions = String(bitsOf(def.perms));
  if (def.subs || def.groups) {
    json.options = [];
    for (const [g, subs] of Object.entries(def.groups || {})) {
      json.options.push({
        type: T.SubcommandGroup, name: g, ...desc(`cmd.${def.name}.${g}.desc`),
        options: Object.entries(subs).map(([s, sub]) => buildSub(s, sub, `${def.name}.${g}.${s}`)),
      });
    }
    for (const [s, sub] of Object.entries(def.subs || {})) json.options.push(buildSub(s, sub, `${def.name}.${s}`));
  } else {
    json.options = (def.options || []).map(o => buildOption(o, def.name));
  }
  return json;
}

/** Problems Discord would reject (checked by the dry run and the tests). */
export function lintCommand(json) {
  const problems = [];
  const chars = { base: 0 };
  const check = (node, where) => {
    if (!NAME_RE.test(node.name) || node.name !== node.name.toLowerCase()) problems.push(`${where}: bad name "${node.name}"`);
    if (!node.description || node.description.length > 100) problems.push(`${where}: description length ${node.description?.length}`);
    if (node.description?.startsWith('cmd.')) problems.push(`${where}: missing English text ${node.description}`);
    for (const [loc, v] of Object.entries(node.description_localizations || {})) if (!v || v.length > 100) problems.push(`${where}: ${loc} description length`);
    for (const [loc, v] of Object.entries(node.name_localizations || {})) if (!NAME_RE.test(v) || v !== v.toLowerCase()) problems.push(`${where}: ${loc} bad localized name "${v}"`);
    chars.base += node.name.length + (node.description?.length || 0);
    if ((node.options || []).length > 25) problems.push(`${where}: more than 25 options`);
    let seenOptional = false;
    for (const o of node.options || []) {
      if (o.type === T.Subcommand || o.type === T.SubcommandGroup) { check(o, `${where} ${o.name}`); continue; }
      if (!NAME_RE.test(o.name)) problems.push(`${where}: bad option name ${o.name}`);
      if (!o.description || o.description.length > 100 || o.description.startsWith('cmd.')) problems.push(`${where}: option ${o.name} description "${o.description}"`);
      if (o.required && seenOptional) problems.push(`${where}: required option ${o.name} after optional one`);
      if (!o.required) seenOptional = true;
      if ((o.choices || []).length > 25) problems.push(`${where}: option ${o.name} more than 25 choices`);
      chars.base += o.name.length + o.description.length + (o.choices || []).reduce((a, c) => a + c.name.length + String(c.value).length, 0);
    }
  };
  check(json, `/${json.name}`);
  if (chars.base > 8000) problems.push(`/${json.name}: ${chars.base} characters (limit 8000)`);
  return problems;
}

/** Iterates every runnable leaf: { path: 'ticket close', name, sub, group, leaf } */
export function leaves(def) {
  const out = [];
  if (!def.subs && !def.groups) out.push({ path: def.name, leaf: def, sub: null, group: null });
  for (const [g, subs] of Object.entries(def.groups || {})) for (const [s, leaf] of Object.entries(subs)) out.push({ path: `${def.name} ${g} ${s}`, leaf, sub: s, group: g });
  for (const [s, leaf] of Object.entries(def.subs || {})) out.push({ path: `${def.name} ${s}`, leaf, sub: s, group: null });
  return out;
}

/** i18n keys a command needs (for completeness tests). */
export function requiredKeys(def) {
  const keys = [`cmd.${def.name}.desc`];
  const opts = (list, path) => { for (const o of list || []) { keys.push(`cmd.${path}.opt.${o.name}`); if (o.choices && !o.choices.names) for (const v of o.choices.values) keys.push(choiceKey(o.choices, v)); } };
  if (!def.subs && !def.groups) opts(def.options, def.name);
  for (const [g, subs] of Object.entries(def.groups || {})) {
    keys.push(`cmd.${def.name}.${g}.desc`);
    for (const [s, leaf] of Object.entries(subs)) { keys.push(`cmd.${def.name}.${g}.${s}.desc`); opts(leaf.options, `${def.name}.${g}.${s}`); }
  }
  for (const [s, leaf] of Object.entries(def.subs || {})) { keys.push(`cmd.${def.name}.${s}.desc`); opts(leaf.options, `${def.name}.${s}`); }
  return keys;
}

export { PermissionFlagsBits, has as hasKey };
