/**
 * /config – lets admins configure every setting from Discord (works without the website panel and
 * while the API is offline). Paths and types come from config.schema.json.
 */
import { AttachmentBuilder } from 'discord.js';
import { opt } from '../core/commands.js';
import { EPHEMERAL, okEmbed, errEmbed, chunk } from '../core/ui.js';
import { leafPaths, schemaAt, parseValue, getPath } from '../config/validate.js';
import { LANGUAGES, LANGUAGE_NAMES, t } from '../i18n/index.js';
import { MODULE_NAMES } from '../config/schema-source.js';
import { clip } from '../lib/template.js';

const TOGGLE_MODULES = MODULE_NAMES.filter(m => !['general', 'community', 'server', 'actions'].includes(m));

export function showValue(node, value) {
  if (value === '' || value === null || value === undefined || (Array.isArray(value) && !value.length)) return '—';
  switch (node?.['x-ui']) {
    case 'channel': return `<#${value}>`;
    case 'role': return `<@&${value}>`;
    case 'toggle': return value ? '✅' : '❌';
    case 'list':
      if (node.items?.['x-ui'] === 'role') return value.map(v => `<@&${v}>`).join(' ');
      if (node.items?.['x-ui'] === 'channel') return value.map(v => `<#${v}>`).join(' ');
      if (node.items?.type === 'object') return `${value.length} × {…}`;
      return clip(value.join(', '), 300);
    default: return clip(String(value), 300);
  }
}

function moduleAutocomplete(ctx) {
  const q = (ctx.i.options.getFocused() || '').toLowerCase();
  return MODULE_NAMES.map(m => ({ name: `${m} – ${ctx.t(`panel.${m}._label`)}`, value: m })).filter(c => c.name.toLowerCase().includes(q));
}

export default {
  name: null,
  commands: [{
    name: 'config',
    category: 'admin',
    perms: ['ManageGuild'],
    subs: {
      show: {
        options: [opt.string('module', false, { autocomplete: true })],
        autocomplete: moduleAutocomplete,
        async run(ctx) {
          const mod = ctx.str('module');
          const schema = ctx.bot.config.schema;
          // same values as the panel: send local changes and fetch a newer panel save first (bounded wait)
          if (ctx.bot.api.botEnabled && !ctx.bot.api.offline) {
            await Promise.race([ctx.bot.config.load(ctx.guild.id).catch(() => {}), new Promise(r => setTimeout(r, 1500).unref?.())]);
          }
          const cfg = ctx.bot.cfg(ctx.guild.id);
          if (!mod) {
            const lines = MODULE_NAMES.map((m) => {
              const en = cfg[m]?.enabled;
              return `${en === undefined ? '⚙️' : en ? '🟢' : '⚫'} **${ctx.t(`panel.${m}._label`)}** \`${m}\``;
            });
            const rec = ctx.bot.config.record(ctx.guild.id);
            const e = ctx.bot.embed(ctx.guild.id).setTitle(ctx.t('config.title')).setDescription(lines.join('\n'))
              .setFooter({ text: ctx.t('config.footer', { version: rec.remote?.version ?? 0, overrides: Object.keys(rec.overrides).length, api: ctx.bot.api.offline ? ctx.t('config.api_offline') : ctx.t('config.api_online') }) });
            return ctx.reply({ embeds: [e], flags: EPHEMERAL });
          }
          if (!schema.properties[mod]) return ctx.fail('config.unknown_module');
          const lines = leafPaths(schema.properties[mod], mod).map((p) => {
            const node = schemaAt(schema, p);
            return `\`${p.slice(mod.length + 1)}\` · ${ctx.t(node['x-i18n'])}: ${showValue(node, getPath(cfg, p))}`;
          });
          const embeds = chunk(lines).slice(0, 10).map((d, i) => ctx.bot.embed(ctx.guild.id).setDescription(d).setTitle(i ? null : `${ctx.t(`panel.${mod}._label`)} · \`${mod}\``));
          return ctx.reply({ embeds, flags: EPHEMERAL });
        },
      },
      set: {
        options: [opt.string('key', true, { autocomplete: true }), opt.string('value', true, { max: 6000 })],
        autocomplete(ctx) {
          const q = (ctx.i.options.getFocused() || '').toLowerCase();
          return leafPaths(ctx.bot.config.schema).filter(p => p.toLowerCase().includes(q)).slice(0, 25).map(p => ({ name: p, value: p }));
        },
        async run(ctx) {
          const key = ctx.str('key');
          const node = schemaAt(ctx.bot.config.schema, key);
          if (!node || node.type === 'object') return ctx.fail('config.unknown_key', { key });
          const parsed = parseValue(node, ctx.str('value'));
          if (!parsed.ok) return ctx.fail(`config.invalid_${parsed.error}`, { key, details: parsed.details?.map(d => d.message).join('; ') ?? '' });
          const res = ctx.bot.config.set(ctx.guild.id, key, parsed.value, { by: ctx.user.id, reason: 'command' });
          if (!res.ok) return ctx.fail('config.invalid_schema', { key, details: res.errors.map(d => d.message).join('; ') });
          ctx.bot.audit(ctx.guild.id, 'config_set', { key, by: ctx.user.id });
          return ctx.ok('config.saved', { key, value: showValue(node, parsed.value) });
        },
      },
      reset: {
        options: [opt.string('key', true, { autocomplete: true })],
        autocomplete(ctx) {
          const q = (ctx.i.options.getFocused() || '').toLowerCase();
          const all = [...MODULE_NAMES, ...leafPaths(ctx.bot.config.schema)];
          return all.filter(p => p.toLowerCase().includes(q)).slice(0, 25).map(p => ({ name: p, value: p }));
        },
        async run(ctx) {
          const key = ctx.str('key');
          if (!schemaAt(ctx.bot.config.schema, key)) return ctx.fail('config.unknown_key', { key });
          ctx.bot.config.reset(ctx.guild.id, key);
          ctx.bot.audit(ctx.guild.id, 'config_reset', { key, by: ctx.user.id });
          return ctx.ok('config.reset_done', { key });
        },
      },
      module: {
        options: [opt.string('module', true, { choices: { values: TOGGLE_MODULES, key: (m) => `panel.${m}._label` } }), opt.bool('enabled', true)],
        async run(ctx) {
          const mod = ctx.str('module');
          const on = ctx.bool('enabled');
          ctx.bot.config.set(ctx.guild.id, `${mod}.enabled`, on, { by: ctx.user.id, reason: 'command' });
          ctx.bot.audit(ctx.guild.id, 'config_set', { key: `${mod}.enabled`, value: on, by: ctx.user.id });
          return ctx.ok(on ? 'config.module_on' : 'config.module_off', { module: ctx.t(`panel.${mod}._label`) });
        },
      },
      language: {
        options: [opt.string('language', true, { choices: { values: LANGUAGES, names: LANGUAGE_NAMES } })],
        async run(ctx) {
          const lang = ctx.str('language');
          ctx.bot.config.set(ctx.guild.id, 'general.language', lang, { by: ctx.user.id, reason: 'command' });
          return ctx.reply({ embeds: [okEmbed(t(lang, 'config.language_set', { language: LANGUAGE_NAMES[lang] }))], flags: EPHEMERAL });
        },
      },
      export: {
        async run(ctx) {
          const file = new AttachmentBuilder(Buffer.from(JSON.stringify(ctx.cfg, null, 2)), { name: `nore-config-${ctx.guild.id}.json` });
          return ctx.reply({ content: ctx.t('config.exported'), files: [file], flags: EPHEMERAL });
        },
      },
      import: {
        options: [opt.attachment('file', true)],
        async run(ctx) {
          const att = ctx.attachment('file');
          if (att.size > 512_000) return ctx.fail('config.import_too_big');
          await ctx.defer();
          let json;
          try { json = await (await fetch(att.url)).json(); } catch { return ctx.reply({ embeds: [errEmbed(ctx.t('config.invalid_json'))] }); }
          const res = ctx.bot.config.import(ctx.guild.id, json, { by: ctx.user.id });
          ctx.bot.audit(ctx.guild.id, 'config_import', { applied: res.applied, by: ctx.user.id });
          return ctx.reply({ embeds: [okEmbed(ctx.t('config.imported', { count: res.applied, errors: res.errors.length }))] });
        },
      },
      panel: {
        async run(ctx) {
          return ctx.info('config.panel_link', { url: `${ctx.bot.env.noreApi}/panel` });
        },
      },
    },
  }],
};
