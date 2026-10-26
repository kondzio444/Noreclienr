/**
 * Self-roles: menus with buttons, a select menu or reactions (defined in config.roles.menus, or with
 * /selfroles create|add|remove), posted and kept up to date with /selfroles post.
 */
import { ButtonStyle, StringSelectMenuBuilder } from 'discord.js';
import { opt } from '../core/commands.js';
import { EPHEMERAL, row, rows, button, okEmbed, embed } from '../core/ui.js';
import { clip } from '../lib/template.js';

const posted = (bot, gid) => bot.store.ns(gid, 'selfroles', () => ({}));

function parseEmoji(e) {
  if (!e) return undefined;
  const m = /^<?(a)?:?(\w+):(\d+)>?$/.exec(e);
  return m ? { id: m[3], name: m[2], animated: !!m[1] } : e;
}
const emojiKey = (e) => (typeof e === 'object' && e?.id ? e.id : String(e || ''));

export function menuPayload(bot, guild, menu) {
  const tg = bot.tg(guild.id);
  const roles = menu.roles.filter(r => r.role && guild.roles.cache.has(r.role)).slice(0, 25);
  const lines = roles.map(r => `${r.emoji || '•'} <@&${r.role}>${r.description ? ` – ${r.description}` : ''}`);
  const e = embed(bot.color(guild.id)).setTitle(menu.title || tg('roles.default_title')).setDescription(`${menu.description || tg('roles.default_text')}\n\n${lines.join('\n')}`.trim());
  if (menu.mode === 'reactions') return { embeds: [e], components: [] };
  if (menu.mode === 'select') {
    const sel = new StringSelectMenuBuilder().setCustomId(`sr:s:${menu.id}`).setPlaceholder(tg('roles.pick')).setMinValues(0).setMaxValues(menu.multiple ? Math.max(1, roles.length) : 1)
      .addOptions(roles.map(r => ({ label: clip(r.label || guild.roles.cache.get(r.role).name, 100), value: r.role, description: r.description ? clip(r.description, 100) : undefined, emoji: parseEmoji(r.emoji) })));
    return { embeds: [e], components: roles.length ? [row(sel)] : [] };
  }
  return { embeds: [e], components: rows(roles.map(r => button(`sr:b:${menu.id}:${r.role}`, r.label || guild.roles.cache.get(r.role).name, ButtonStyle.Secondary, parseEmoji(r.emoji)))) };
}

export async function postMenu(bot, guild, menu, channelId) {
  const rec = posted(bot, guild.id)[menu.id];
  const payload = menuPayload(bot, guild, menu);
  let msg = null;
  if (rec) {
    const ch = await bot.channel(guild, rec.channelId);
    msg = ch ? await ch.messages.fetch(rec.messageId).catch(() => null) : null;
    if (msg && (!channelId || channelId === rec.channelId)) await msg.edit(payload).catch(() => { msg = null; });
    else msg = null;
  }
  if (!msg) msg = await bot.send(guild, channelId || menu.channel, payload);
  if (!msg) return null;
  posted(bot, guild.id)[menu.id] = { channelId: msg.channelId, messageId: msg.id };
  bot.store.touch(guild.id);
  if (menu.mode === 'reactions') for (const r of menu.roles) if (r.emoji) await msg.react(r.emoji).catch(() => {});
  return msg;
}

async function toggle(ctx, menu, roleId) {
  const member = ctx.member;
  const role = ctx.guild.roles.cache.get(roleId);
  if (!role || !menu.roles.some(r => r.role === roleId)) return ctx.fail('roles.gone');
  if (role.position >= ctx.guild.members.me.roles.highest.position) return ctx.fail('roles.too_high');
  if (member.roles.cache.has(roleId)) { await member.roles.remove(roleId, 'self-role'); return ctx.ok('roles.removed', { role: `${role}` }); }
  if (!menu.multiple) {
    const others = menu.roles.map(r => r.role).filter(r => r !== roleId && member.roles.cache.has(r));
    if (others.length) await member.roles.remove(others, 'self-role (single)');
  }
  await member.roles.add(roleId, 'self-role');
  return ctx.ok('roles.added', { role: `${role}` });
}

async function reaction(bot, react, user, add) {
  if (user.bot) return;
  if (react.partial) await react.fetch().catch(() => null);
  const msg = react.message;
  if (!msg.guild) return;
  const rec = Object.entries(posted(bot, msg.guild.id)).find(([, v]) => v.messageId === msg.id);
  if (!rec) return;
  const menu = bot.cfg(msg.guild.id).roles.menus.find(m => m.id === rec[0]);
  if (!menu || menu.mode !== 'reactions' || !bot.cfg(msg.guild.id).roles.enabled) return;
  const key = react.emoji.id || react.emoji.name;
  const entry = menu.roles.find(r => emojiKey(parseEmoji(r.emoji)) === key);
  if (!entry) return;
  const member = await msg.guild.members.fetch(user.id).catch(() => null);
  if (!member) return;
  if (add) {
    if (!menu.multiple) {
      const others = menu.roles.map(r => r.role).filter(r => r !== entry.role && member.roles.cache.has(r));
      if (others.length) await member.roles.remove(others).catch(() => {});
    }
    await member.roles.add(entry.role, 'reaction role').catch(() => {});
  } else await member.roles.remove(entry.role, 'reaction role').catch(() => {});
}

const menuAutocomplete = (ctx) => ctx.cfg.roles.menus.map(m => ({ name: `${m.id} – ${m.title || ctx.t('roles.default_title')}`, value: m.id }));
function saveMenus(ctx, menus) { return ctx.bot.config.set(ctx.guild.id, 'roles.menus', menus, { by: ctx.user.id }); }

export default {
  name: 'roles',
  events: {
    messageReactionAdd: (bot, r, u) => reaction(bot, r, u, true),
    messageReactionRemove: (bot, r, u) => reaction(bot, r, u, false),
  },
  commands: [{
    name: 'selfroles', category: 'admin', module: null, perms: ['ManageRoles'], botPerms: ['ManageRoles'], botPermsScope: 'guild',
    subs: {
      create: {
        options: [opt.string('id', true, { max: 32 }), opt.string('title', true, { max: 256 }), opt.string('mode', false, { choices: { values: ['buttons', 'select', 'reactions'], key: (v) => `panel.options.menuStyles.${v}` } }), opt.bool('multiple'), opt.string('description', false, { max: 1000 })],
        async run(ctx) {
          const id = ctx.str('id').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 32);
          if (!id) return ctx.fail('roles.bad_id');
          const menus = structuredClone(ctx.cfg.roles.menus);
          if (menus.some(m => m.id === id)) return ctx.fail('roles.exists');
          menus.push({ id, channel: '', title: ctx.str('title'), description: ctx.str('description') || '', mode: ctx.str('mode') || 'buttons', multiple: ctx.bool('multiple') ?? true, roles: [] });
          const res = saveMenus(ctx, menus);
          return res.ok ? ctx.ok('roles.created', { id }) : ctx.fail('config.invalid_schema', { key: 'roles.menus', details: res.errors.map(e => e.message).join('; ') });
        },
      },
      add: {
        options: [opt.string('menu', true, { autocomplete: true }), opt.role('role', true), opt.string('label', false, { max: 80 }), opt.string('emoji', false, { max: 64 }), opt.string('description', false, { max: 100 })],
        autocomplete: menuAutocomplete,
        async run(ctx) {
          const menus = structuredClone(ctx.cfg.roles.menus);
          const m = menus.find(x => x.id === ctx.str('menu'));
          if (!m) return ctx.fail('roles.no_menu');
          const role = ctx.roleOpt('role');
          if (role.managed || role.position >= ctx.guild.members.me.roles.highest.position) return ctx.fail('roles.too_high');
          m.roles = m.roles.filter(r => r.role !== role.id);
          m.roles.push({ role: role.id, label: ctx.str('label') || '', emoji: ctx.str('emoji') || '', description: ctx.str('description') || '' });
          const res = saveMenus(ctx, menus);
          return res.ok ? ctx.ok('roles.role_added', { role: `${role}`, menu: m.id }) : ctx.fail('config.invalid_schema', { key: 'roles.menus', details: res.errors.map(e => e.message).join('; ') });
        },
      },
      remove: {
        options: [opt.string('menu', true, { autocomplete: true }), opt.role('role', true)],
        autocomplete: menuAutocomplete,
        async run(ctx) {
          const menus = structuredClone(ctx.cfg.roles.menus);
          const m = menus.find(x => x.id === ctx.str('menu'));
          if (!m) return ctx.fail('roles.no_menu');
          m.roles = m.roles.filter(r => r.role !== ctx.roleOpt('role').id);
          saveMenus(ctx, menus);
          return ctx.ok('roles.role_removed', { role: `${ctx.roleOpt('role')}`, menu: m.id });
        },
      },
      post: {
        options: [opt.string('menu', true, { autocomplete: true }), opt.channel('channel', false, { channelTypes: ['text'] })],
        autocomplete: menuAutocomplete,
        async run(ctx) {
          const m = ctx.cfg.roles.menus.find(x => x.id === ctx.str('menu'));
          if (!m) return ctx.fail('roles.no_menu');
          if (!m.roles.length) return ctx.fail('roles.empty');
          const msg = await postMenu(ctx.bot, ctx.guild, m, ctx.channelOpt('channel')?.id || m.channel || ctx.i.channelId);
          return msg ? ctx.ok('roles.posted', { url: msg.url }) : ctx.fail('errors.cannot_send', { channel: '—' });
        },
      },
      list: {
        async run(ctx) {
          const p = posted(ctx.bot, ctx.guild.id);
          const lines = ctx.cfg.roles.menus.map(m => `**${m.id}** · ${m.title || '—'} · ${ctx.t(`panel.options.menuStyles.${m.mode}`)} · ${m.roles.length} ${ctx.t('roles.roles')}${p[m.id] ? ` · [↗](https://discord.com/channels/${ctx.guild.id}/${p[m.id].channelId}/${p[m.id].messageId})` : ''}`);
          return ctx.reply({ embeds: [ctx.bot.embed(ctx.guild.id).setTitle(ctx.t('roles.list_title')).setDescription(lines.join('\n') || ctx.t('roles.none'))], flags: EPHEMERAL });
        },
      },
    },
  }],
  components: {
    async sr(ctx, [kind, menuId, roleId]) {
      const menu = ctx.cfg.roles.menus.find(m => m.id === menuId);
      if (!menu) return ctx.fail('roles.gone');
      if (kind === 'b') return toggle(ctx, menu, roleId);
      if (kind === 's') {
        const want = new Set(ctx.i.values);
        const managed = menu.roles.map(r => r.role).filter(r => { const role = ctx.guild.roles.cache.get(r); return role && role.position < ctx.guild.members.me.roles.highest.position; });
        const add = managed.filter(r => want.has(r) && !ctx.member.roles.cache.has(r));
        const remove = managed.filter(r => !want.has(r) && ctx.member.roles.cache.has(r));
        if (add.length) await ctx.member.roles.add(add, 'self-role');
        if (remove.length) await ctx.member.roles.remove(remove, 'self-role');
        return ctx.reply({ embeds: [okEmbed(ctx.t('roles.updated', { added: add.map(r => `<@&${r}>`).join(' ') || '—', removed: remove.map(r => `<@&${r}>`).join(' ') || '—' }))], flags: EPHEMERAL });
      }
    },
  },
};
