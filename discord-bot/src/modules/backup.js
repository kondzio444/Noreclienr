/**
 * Server layout backups: roles (colors, permissions, icons), categories and channels (topics,
 * slowmode, permission overwrites, forum tags) and server settings. Stored per guild (last 10) and
 * exportable as JSON. Loading is non-destructive by default (creates what is missing, updates what
 * differs); `prune` also deletes what the backup does not have (confirmation required).
 */
import { AttachmentBuilder } from 'discord.js';
import { randomUUID } from 'node:crypto';
import { opt } from '../core/commands.js';
import { EPHEMERAL, okEmbed, confirm, bar, embed, COLORS } from '../core/ui.js';
import { backupLayout, snapshotForPlan, runOps } from '../core/layout-exec.js';
import { planLayout, diffLines } from '../lib/layout.js';
import { ts, formatDuration } from '../lib/duration.js';
import { clip } from '../lib/template.js';

const state = (bot, gid) => bot.store.ns(gid, 'backups', () => ({ list: [] }));
const MAX = 10;

export function createBackup(bot, guild, { label = '', by = null } = {}) {
  const st = state(bot, guild.id);
  const b = { id: randomUUID().slice(0, 8), label: clip(label, 80), at: Date.now(), by, layout: backupLayout(guild) };
  st.list.push(b);
  if (st.list.length > MAX) st.list.splice(0, st.list.length - MAX);
  bot.store.touch(guild.id);
  bot.audit(guild.id, 'backup_create', { id: b.id, by, roles: b.layout.roles.length, channels: b.layout.channels.length });
  return b;
}

/** Turns a backup into a desired layout (keys = old ids). Overwrites keep role keys = old role ids. */
function desiredFrom(layout, withSettings) {
  return { roles: layout.roles, channels: layout.channels, settings: withSettings ? layout.settings : undefined };
}

const idAuto = (ctx) => state(ctx.bot, ctx.guild.id).list.slice().reverse().map(b => ({ name: clip(`${b.id} · ${new Date(b.at).toISOString().slice(0, 16).replace('T', ' ')} · ${b.label || '—'} (${b.layout.roles.length}R/${b.layout.channels.length}C)`, 100), value: b.id }));

export default {
  name: null,
  commands: [{
    name: 'backup', category: 'builder', perms: ['Administrator'], botPerms: ['ManageGuild', 'ManageRoles', 'ManageChannels'], botPermsScope: 'guild',
    subs: {
      create: {
        options: [opt.string('label', false, { max: 80 })],
        async run(ctx) {
          const b = createBackup(ctx.bot, ctx.guild, { label: ctx.str('label') || '', by: ctx.user.id });
          return ctx.ok('backup.created', { id: b.id, roles: b.layout.roles.length, channels: b.layout.channels.length });
        },
      },
      list: {
        async run(ctx) {
          const lines = state(ctx.bot, ctx.guild.id).list.slice().reverse().map(b => `\`${b.id}\` · ${ts(b.at)} · ${b.label || '—'} · ${b.layout.roles.length} 🎭 · ${b.layout.channels.length} #${b.by ? ` · <@${b.by}>` : ''}`);
          return ctx.reply({ embeds: [ctx.bot.embed(ctx.guild.id).setTitle(ctx.t('backup.list_title')).setDescription(lines.join('\n') || ctx.t('backup.none'))], flags: EPHEMERAL });
        },
      },
      export: {
        options: [opt.string('id', true, { autocomplete: true })], autocomplete: idAuto,
        async run(ctx) {
          const b = state(ctx.bot, ctx.guild.id).list.find(x => x.id === ctx.str('id'));
          if (!b) return ctx.fail('backup.not_found');
          return ctx.reply({ files: [new AttachmentBuilder(Buffer.from(JSON.stringify(b, null, 2)), { name: `nore-backup-${ctx.guild.id}-${b.id}.json` })], flags: EPHEMERAL });
        },
      },
      import: {
        options: [opt.attachment('file', true)],
        async run(ctx) {
          const att = ctx.attachment('file');
          if (att.size > 4_000_000) return ctx.fail('config.import_too_big');
          await ctx.defer();
          let b;
          try { b = await (await fetch(att.url)).json(); } catch { return ctx.reply({ content: ctx.t('config.invalid_json') }); }
          if (!b?.layout?.roles || !b.layout.channels) return ctx.reply({ content: ctx.t('backup.invalid') });
          const st = state(ctx.bot, ctx.guild.id);
          b.id = randomUUID().slice(0, 8); b.label = clip(`import: ${b.label || att.name}`, 80); b.at = Date.now(); b.by = ctx.user.id;
          st.list.push(b); if (st.list.length > MAX) st.list.shift();
          ctx.bot.store.touch(ctx.guild.id);
          return ctx.reply({ embeds: [okEmbed(ctx.t('backup.imported', { id: b.id }))] });
        },
      },
      delete: {
        options: [opt.string('id', true, { autocomplete: true })], autocomplete: idAuto,
        async run(ctx) {
          const st = state(ctx.bot, ctx.guild.id);
          const n = st.list.length;
          st.list = st.list.filter(b => b.id !== ctx.str('id'));
          ctx.bot.store.touch(ctx.guild.id);
          return n !== st.list.length ? ctx.ok('backup.deleted') : ctx.fail('backup.not_found');
        },
      },
      load: {
        options: [opt.string('id', true, { autocomplete: true }), opt.bool('prune'), opt.bool('settings')],
        autocomplete: idAuto,
        async run(ctx) {
          const b = state(ctx.bot, ctx.guild.id).list.find(x => x.id === ctx.str('id'));
          if (!b) return ctx.fail('backup.not_found');
          const prune = !!ctx.bool('prune');
          const desired = desiredFrom(b.layout, ctx.bool('settings') ?? true);
          // map old ids to themselves where they still exist (same server), names otherwise
          const map = {};
          for (const r of b.layout.roles) if (ctx.guild.roles.cache.has(r.key)) map[`r:${r.key}`] = r.key;
          for (const c of b.layout.channels) if (ctx.guild.channels.cache.has(c.key)) map[`c:${c.key}`] = c.key;
          const plan = planLayout(desired, snapshotForPlan(ctx.guild, [ctx.i.channelId]), { map, update: true, prune });
          const s = plan.summary;
          const preview = embed(prune ? COLORS.error : COLORS.warn).setTitle(ctx.t('backup.preview_title', { id: b.id }))
            .setDescription(`${ctx.t('backup.preview_counts', { cr: s.create.roles, cc: s.create.channels, ur: s.update.roles, uc: s.update.channels, dr: s.delete.roles, dc: s.delete.channels })}\n\`\`\`diff\n${clip(diffLines(plan, desired, 30).join('\n') || ' ', 1500)}\n\`\`\``);
          if (!(await confirm(ctx, { embeds: [preview], danger: true }))) return;
          createBackup(ctx.bot, ctx.guild, { label: `before restore ${b.id}`, by: ctx.user.id });
          const status = await ctx.i.channel.send({ embeds: [embed(COLORS.info).setTitle(ctx.tg('backup.restoring')).setDescription(bar(0, plan.ops.length))] }).catch(() => null);
          const started = Date.now();
          const q = runOps(ctx.bot, ctx.guild, plan.ops, {
            map: plan.map, reason: `backup ${b.id} by ${ctx.user.username}`,
            onProgress: async (p) => status?.edit({ embeds: [embed(COLORS.info).setTitle(ctx.tg('backup.restoring')).setDescription(`${bar(p.done, p.total)}\n${ctx.tg('builder.step', { done: p.done, total: p.total })}${p.eta ? ` · ETA ${formatDuration(p.eta)}` : ''}`)] }).catch(() => {}),
          });
          const res = await q.run();
          ctx.bot.audit(ctx.guild.id, 'backup_load', { id: b.id, prune, by: ctx.user.id, errors: res.errors.length });
          await status?.edit({ embeds: [embed(res.errors.length ? COLORS.warn : COLORS.ok).setTitle(ctx.tg('backup.restored')).setDescription(ctx.tg('builder.done_text', { done: res.done, total: res.total, errors: res.errors.length, time: formatDuration(Date.now() - started) }))] }).catch(() => {});
        },
      },
    },
  }],
};
