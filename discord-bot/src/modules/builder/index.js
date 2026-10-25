/**
 * Server builder ("DC maker"): /builder start → template, language, size, options → preview (diff)
 * → confirm → automatic backup → queued build with a progress embed and ETA → summary with links.
 *
 * Builds roles (tiers, separators, colours, icons when the boost level allows), categories and
 * channels (topics, slowmode, permission overwrites, forum tags), posts the starter content (rules,
 * start here, FAQ, info, roles, links, programmes …) and the panels (verification, tickets,
 * suggestions, self-roles, applications, status board), and wires every bot module to the created
 * channels and roles (local config overrides, reported to the panel).
 *
 * Idempotent: keys are mapped to ids (store), existing items are matched by id or name, so a rerun or
 * /builder repair only creates what is missing. Jobs are checkpointed after every step and resumed
 * automatically after a restart (/builder resume to continue a cancelled one).
 */
import { ButtonStyle, PermissionFlagsBits } from 'discord.js';
import { randomUUID } from 'node:crypto';
import { opt } from '../../core/commands.js';
import { EPHEMERAL, row, button, okEmbed, errEmbed, embed, COLORS, bar } from '../../core/ui.js';
import { loadTemplates, compileTemplate, templateStats, SIZES } from '../../lib/templates.js';
import { planLayout, diffLines, validateLayout } from '../../lib/layout.js';
import { snapshotForPlan, runOps } from '../../core/layout-exec.js';
import { translator, LANGUAGES, LANGUAGE_NAMES, has } from '../../i18n/index.js';
import { formatDuration, ts } from '../../lib/duration.js';
import { clip } from '../../lib/template.js';
import { contentPayloads } from './content.js';
import { createBackup } from '../backup.js';
import { panelPayload as verifyPanel } from '../verification.js';
import { panelPayload as ticketPanel } from '../tickets.js';
import { panelPayload as suggestionPanel } from '../suggestions.js';
import { panelPayload as applicationPanel } from '../applications.js';
import { postMenu } from '../roles.js';
import { getPath } from '../../config/validate.js';
import { logger } from '../../lib/logger.js';

const log = logger.child('builder');
let TEMPLATES = null;
export const templates = () => (TEMPLATES ??= loadTemplates());
const running = new Map(); // guildId -> JobQueue

const state = (bot, gid) => {
  const s = bot.store.ns(gid, 'builder', () => ({ map: {}, posted: [], jobs: {}, current: null }));
  s.map ??= {}; s.posted ??= []; s.jobs ??= {};
  return s;
};

function vars(bot, guild, tpl) {
  return { server: guild.name, website: bot.env.noreApi, address: tpl.address || bot.cfg(guild.id).minecraft.address || 'MC.noreclient.pl' };
}

/** Builds the plan (layout ops + builder ops) for a template; nothing is changed yet. */
export function buildPlan(bot, guild, { template, lang, size, content = true, settings = true, update = false, prune = false, protect = [] }) {
  const tpl = templates()[template];
  if (!tpl) throw new Error(`unknown template ${template}`);
  const t = translator(lang);
  const v = vars(bot, guild, tpl);
  const compiled = compileTemplate(tpl, { t, size, vars: v });
  const problems = validateLayout(compiled.layout);
  const st = state(bot, guild.id);
  const plan = planLayout(compiled.layout, snapshotForPlan(guild, protect), { map: st.map, update, prune });
  const ops = [...plan.ops];
  ops.push({ op: 'config', binds: compiled.binds, levels: compiled.levels, menus: compiled.menus, groups: compiled.groups, lang, template, address: v.address, status: tpl.statusServer !== false && !!tpl.address });
  if (content) {
    for (const c of compiled.content) if (update ? !st.posted.includes(`${c.channelKey}:${c.kind}`) : true) ops.push({ op: 'post', channelKey: c.channelKey, kind: c.kind });
    for (const p of compiled.panels) ops.push({ op: 'panel', channelKey: p.channelKey, panel: p.panel });
  }
  if (settings) ops.push({ op: 'settings', data: compiled.settings });
  return { ops, summary: plan.summary, map: plan.map, compiled, problems, preview: diffLines(plan, compiled.layout, 25) };
}

// ------------------------------------------------------------------ builder-specific ops

function extraOps(bot, guild, job) {
  const st = state(bot, guild.id);
  const t = translator(job.lang);
  const tpl = templates()[job.template];
  const v = vars(bot, guild, tpl);
  const set = (p, value) => {
    const res = bot.config.set(guild.id, p, value, { by: job.by });
    if (!res.ok) log.warn('builder config bind rejected', { path: p, errors: res.errors });
  };
  const cid = (map, key) => map[`c:${key}`];
  const rid = (map, key) => map[`r:${key}`];
  return async (op, map) => {
    if (op.op === 'config') {
      const lists = {};
      for (const b of op.binds) {
        const [path, append] = b.path.endsWith('+') ? [b.path.slice(0, -1), true] : [b.path, false];
        let value;
        if (b.value !== undefined) value = b.value;
        else if (b.ref?.channel) value = cid(map, b.ref.channel);
        else if (b.ref?.role) value = rid(map, b.ref.role);
        else if (b.ref?.roles) value = b.ref.roles.map(k => rid(map, k)).filter(Boolean);
        else if (b.ref?.channels) value = b.ref.channels.map(k => cid(map, k)).filter(Boolean);
        if (value === undefined || value === null) continue;
        if (append) { lists[path] ??= [...(getPath(bot.cfg(guild.id), path) || [])]; for (const x of [].concat(value)) if (!lists[path].includes(x)) lists[path].push(x); }
        else set(path, value);
      }
      for (const [p, list] of Object.entries(lists)) set(p, list);
      // level rewards
      if (op.levels.length) set('leveling.rewards', op.levels.map(l => ({ level: l.level, role: rid(map, l.key) })).filter(r => r.role));
      // staff tiers → general.staffRoles, moderation roles, ticket staff
      const staff = (op.groups.staff || []).map(k => rid(map, k)).filter(Boolean);
      if (staff.length) { set('general.staffRoles', staff); set('tickets.staffRoles', staff); set('suggestions.staffRoles', staff.slice(0, 4)); set('applications.staffRoles', staff.slice(0, 3)); }
      const mods = (op.groups.moderators || []).map(k => rid(map, k)).filter(Boolean);
      if (mods.length) set('moderation.modRoles', mods);
      // self-role menus
      const menus = Object.entries(op.menus).map(([id, roles]) => ({
        id, channel: '', title: t(`tpl.menu.${id}.title`), description: t(`tpl.menu.${id}.text`), mode: roles.length > 5 ? 'select' : 'buttons', multiple: id !== 'colors',
        roles: roles.map(r => ({ role: rid(map, r.key), label: '', emoji: r.emoji || '', description: r.descKey && has(job.lang, r.descKey) ? clip(t(r.descKey), 100) : '' })).filter(r => r.role).slice(0, 25),
      })).filter(m => m.roles.length);
      if (menus.length) set('roles.menus', menus);
      set('general.language', op.lang);
      if (op.status && cid(map, 'server_ip')) {
        set('minecraft.address', op.address);
        set('status.servers', [{ address: op.address, name: tpl.serverName || op.address, channel: cid(map, 'server_ip'), role: rid(map, 'ping_status') || '', notify: true, live: true }]);
      }
      // modules switched on by the template
      for (const m of tpl.enable || []) set(`${m}.enabled`, true);
      if (bot.cfg(guild.id).status.servers.length || bot.cfg(guild.id).status.board.channel) set('status.enabled', true);
      return;
    }
    if (op.op === 'post') {
      const chId = cid(map, op.channelKey);
      if (!chId) return;
      const compiled = job.compiledRoles || [];
      const payloads = contentPayloads(op.kind, {
        t, lang: job.lang, vars: v, accent: tpl.accent,
        mention: (key) => (cid(map, key) ? `<#${cid(map, key)}>` : null),
        roleMention: (key) => (rid(map, key) ? `<@&${rid(map, key)}>` : `@${key}`),
        roles: compiled.map(r => ({ key: r.key, desc: has(job.lang, `tpl.roledesc.${r.base}`) ? t(`tpl.roledesc.${r.base}`, { n: r.n, item: r.item }) : null })),
      });
      for (const p of payloads) {
        const { pin, ...payload } = p;
        const msg = await bot.send(guild, chId, { ...payload, allowedMentions: { parse: [] } });
        if (msg && pin) await msg.pin().catch(() => {});
      }
      if (!st.posted.includes(`${op.channelKey}:${op.kind}`)) st.posted.push(`${op.channelKey}:${op.kind}`);
      bot.store.touch(guild.id);
      return;
    }
    if (op.op === 'panel') {
      const chId = cid(map, op.channelKey);
      if (!chId) return;
      const [kind, arg] = op.panel.split(':');
      const cfg = bot.cfg(guild.id);
      if (kind === 'verification' && cfg.verification.role) await bot.send(guild, chId, verifyPanel(bot, guild.id));
      if (kind === 'tickets') {
        const panels = cfg.tickets.panels.map(p => (p.id === (arg || 'main') ? { ...p, channel: chId } : p));
        bot.config.set(guild.id, 'tickets.panels', panels, { by: job.by });
        const p = panels.find(x => x.id === (arg || 'main')) || panels[0];
        if (p) await bot.send(guild, chId, ticketPanel(bot, guild.id, p));
      }
      if (kind === 'suggestions') await bot.send(guild, chId, suggestionPanel(bot, guild.id));
      if (kind === 'apply') { const form = cfg.applications.forms.find(f => f.id === arg); if (form) await bot.send(guild, chId, applicationPanel(bot, guild.id, form)); }
      if (kind === 'selfroles') {
        for (const m of cfg.roles.menus) {
          if (arg && m.id !== arg) continue;
          await postMenu(bot, guild, { ...m, channel: chId }, chId);
        }
      }
      if (kind === 'statusboard') { bot.config.set(guild.id, 'status.board.channel', chId, { by: job.by }); bot.config.set(guild.id, 'status.board.enabled', true, { by: job.by }); bot.config.set(guild.id, 'status.enabled', true, { by: job.by }); }
      return;
    }
    if (op.op === 'settings') {
      const s = op.data || {};
      const { VERIFICATION, CONTENT_FILTER, NOTIFICATIONS } = await import('../configurator.js');
      const edit = {};
      if (s.verificationLevel) edit.verificationLevel = VERIFICATION[s.verificationLevel];
      if (s.explicitContentFilter) edit.explicitContentFilter = CONTENT_FILTER[s.explicitContentFilter];
      if (s.defaultNotifications) edit.defaultMessageNotifications = NOTIFICATIONS[s.defaultNotifications];
      if (s.afkChannel && cid(map, s.afkChannel)) { edit.afkChannel = cid(map, s.afkChannel); edit.afkTimeout = s.afkTimeout || 900; }
      if (s.systemChannel && cid(map, s.systemChannel)) edit.systemChannel = cid(map, s.systemChannel);
      if (Object.keys(edit).length) await guild.edit({ ...edit, reason: 'Nore Bot builder' }).catch(err => log.warn('settings failed', { err: err.message }));
      if (s.community && cid(map, s.rulesChannel) && cid(map, s.updatesChannel) && !guild.features.includes('COMMUNITY')) {
        await guild.edit({ features: [...guild.features, 'COMMUNITY'], rulesChannel: cid(map, s.rulesChannel), publicUpdatesChannel: cid(map, s.updatesChannel), reason: 'Nore Bot builder' }).catch(err => log.warn('community enable failed', { err: err.message }));
      }
      if (s.autoPublish) bot.config.set(guild.id, 'community.autoPublish', s.autoPublish.map(k => cid(map, k)).filter(Boolean), { by: job.by });
    }
  };
}

// ------------------------------------------------------------------ run / progress

function progressEmbed(t, job, p) {
  return embed(COLORS.info).setTitle(t('builder.progress_title', { template: t(`tpl.meta.${job.template}.name`) }))
    .setDescription(`${bar(p.done, p.total)}\n${t('builder.step', { done: p.done, total: p.total })}${p.eta ? ` · ${t('builder.eta', { time: formatDuration(p.eta) })}` : ''}\n-# ${clip(p.label || '', 100)}`)
    .setFooter({ text: p.errors ? t('builder.errors', { count: p.errors }) : t('builder.do_not_touch') });
}

export async function runJob(bot, guild, job) {
  if (running.has(guild.id)) return null;
  const st = state(bot, guild.id);
  const t = translator(bot.cfg(guild.id).general.language);
  job.status = 'running';
  st.current = job.id;
  bot.store.touch(guild.id);
  let status = null;
  if (job.progressChannel) {
    const ch = await bot.channel(guild, job.progressChannel);
    status = job.progressMessage && ch ? await ch.messages.fetch(job.progressMessage).catch(() => null) : null;
    if (!status) status = await bot.send(guild, job.progressChannel, { embeds: [progressEmbed(t, job, { done: job.index, total: job.ops.length })] });
    if (status) { job.progressMessage = status.id; bot.store.touch(guild.id); }
  }
  const started = Date.now();
  const q = runOps(bot, guild, job.ops, {
    map: st.map, startAt: job.index, reason: `Nore Bot builder (${job.template})`, extra: extraOps(bot, guild, job),
    onCheckpoint: (i) => { job.index = i; bot.store.touch(guild.id); },
    onProgress: async (p) => { if (status) await status.edit({ embeds: [progressEmbed(t, job, p)] }).catch(() => {}); },
  });
  running.set(guild.id, q);
  let res;
  try { res = await q.run(); } finally { running.delete(guild.id); }
  job.errors = [...(job.errors || []), ...res.errors].slice(-50);
  job.status = res.cancelled ? 'cancelled' : 'done';
  job.finishedAt = Date.now();
  bot.store.touch(guild.id);
  bot.audit(guild.id, 'builder_finished', { template: job.template, size: job.size, status: job.status, steps: res.done, errors: job.errors.length });
  const links = ['start', 'rules', 'verify', 'general', 'support_info', 'staff_chat'].map(k => st.map[`c:${k}`]).filter(id => id && guild.channels.cache.has(id)).map(id => `<#${id}>`);
  const summary = embed(job.errors.length ? COLORS.warn : COLORS.ok).setTitle(t(job.status === 'done' ? 'builder.done_title' : 'builder.cancelled_title'))
    .setDescription(`${t('builder.done_text', { done: res.done, total: res.total, errors: job.errors.length, time: formatDuration(Date.now() - started) })}${links.length ? `\n\n${links.join(' · ')}` : ''}${job.errors.length ? `\n\n\`\`\`\n${clip(job.errors.slice(0, 8).map(e => `${e.step}: ${e.error}`).join('\n'), 900)}\n\`\`\`` : ''}`)
    .setFooter({ text: t('builder.done_footer') });
  if (status) await status.edit({ embeds: [summary] }).catch(() => {});
  else if (job.progressChannel) await bot.send(guild, job.progressChannel, { embeds: [summary] });
  return job;
}

function newJob(bot, guild, ctx, opts) {
  const plan = buildPlan(bot, guild, opts);
  const job = {
    id: randomUUID().slice(0, 8), ...opts, by: ctx?.user.id || null, createdAt: Date.now(), status: 'pending', index: 0, ops: plan.ops, errors: [],
    compiledRoles: plan.compiled.layout.roles.filter(r => !r.separator).map(r => ({ key: r.key, base: r.base, n: r.n, item: r.item })),
    progressChannel: ctx?.i.channelId || null, summary: plan.summary,
  };
  const st = state(bot, guild.id);
  for (const [id, j] of Object.entries(st.jobs)) if (j.status !== 'running' && Date.now() - j.createdAt > 7 * 86_400_000) delete st.jobs[id];
  st.jobs[job.id] = job;
  bot.store.touch(guild.id);
  return { job, plan };
}

function previewEmbed(t, job, plan) {
  const s = plan.summary;
  const stats = plan.compiled.layout;
  return embed(job.prune ? COLORS.error : COLORS.brand).setTitle(t('builder.preview_title', { template: t(`tpl.meta.${job.template}.name`), size: t(`panel.options.sizes.${job.size}`), language: LANGUAGE_NAMES[job.lang] }))
    .setDescription(`${t(`tpl.meta.${job.template}.description`)}\n\n${t('builder.preview_counts', { roles: stats.roles.length, channels: stats.channels.filter(c => c.type !== 'category').length, categories: stats.channels.filter(c => c.type === 'category').length })}\n${t('backup.preview_counts', { cr: s.create.roles, cc: s.create.channels, ur: s.update.roles, uc: s.update.channels, dr: s.delete.roles, dc: s.delete.channels })}\n\`\`\`diff\n${clip(plan.preview.join('\n') || ' ', 1700)}\n\`\`\``)
    .addFields(
      { name: t('builder.opt_content'), value: job.content ? '✅' : '❌', inline: true },
      { name: t('builder.opt_settings'), value: job.settings ? '✅' : '❌', inline: true },
      { name: t('builder.opt_prune'), value: job.prune ? '⚠️ ✅' : '❌', inline: true },
      { name: t('builder.steps'), value: String(job.ops.length), inline: true },
      { name: t('builder.estimate'), value: `~${formatDuration(job.ops.length * 1300)}`, inline: true },
    )
    .setFooter({ text: plan.problems.length ? `⚠️ ${plan.problems.slice(0, 3).join('; ')}` : t('builder.backup_note') });
}

const TEMPLATE_IDS = ['nore-client', 'mc-server', 'gaming', 'support'];

export default {
  name: null,
  async ready(bot) {
    // resume jobs interrupted by a restart
    for (const guild of bot.client.guilds.cache.values()) {
      const st = bot.store.guild(guild.id).builder;
      const job = st?.current && st.jobs?.[st.current];
      if (job?.status === 'running') {
        log.info('resuming builder job after restart', { guildId: guild.id, job: job.id, at: job.index });
        runJob(bot, guild, job).catch(err => log.error('resume failed', { err }));
      }
    }
  },
  commands: [{
    name: 'builder', category: 'builder', perms: ['Administrator'], botPerms: ['ManageGuild', 'ManageRoles', 'ManageChannels', 'ManageMessages'], botPermsScope: 'guild',
    subs: {
      templates: {
        async run(ctx) {
          const e = ctx.bot.embed(ctx.guild.id).setTitle(ctx.t('builder.templates_title'));
          for (const id of TEMPLATE_IDS) {
            const tpl = templates()[id];
            if (!tpl) continue;
            const s = templateStats(tpl, ctx.t);
            e.addFields({ name: `${tpl.emoji} ${ctx.t(`tpl.meta.${id}.name`)} · \`${id}\``, value: `${ctx.t(`tpl.meta.${id}.description`)}\n${SIZES.map(z => `**${ctx.t(`panel.options.sizes.${z}`)}**: ${s[z].roles} 🎭 · ${s[z].categories} 📁 · ${s[z].channels} #`).join('\n')}` });
          }
          return ctx.reply({ embeds: [e], flags: EPHEMERAL });
        },
      },
      start: {
        options: [
          opt.string('template', true, { choices: { values: TEMPLATE_IDS, key: (v) => `tpl.meta.${v}.name` } }),
          opt.string('language', false, { choices: { values: LANGUAGES, names: LANGUAGE_NAMES } }),
          opt.string('size', false, { choices: { values: SIZES, key: (v) => `panel.options.sizes.${v}` } }),
          opt.bool('content'), opt.bool('settings'), opt.bool('prune'),
        ],
        async run(ctx) { return startFlow(ctx, { update: false }); },
      },
      repair: {
        options: [
          opt.string('template', true, { choices: { values: TEMPLATE_IDS, key: (v) => `tpl.meta.${v}.name` } }),
          opt.string('language', false, { choices: { values: LANGUAGES, names: LANGUAGE_NAMES } }),
          opt.string('size', false, { choices: { values: SIZES, key: (v) => `panel.options.sizes.${v}` } }),
        ],
        async run(ctx) { return startFlow(ctx, { update: true }); },
      },
      preview: {
        options: [
          opt.string('template', true, { choices: { values: TEMPLATE_IDS, key: (v) => `tpl.meta.${v}.name` } }),
          opt.string('language', false, { choices: { values: LANGUAGES, names: LANGUAGE_NAMES } }),
          opt.string('size', false, { choices: { values: SIZES, key: (v) => `panel.options.sizes.${v}` } }),
        ],
        async run(ctx) {
          const opts = { template: ctx.str('template'), lang: ctx.str('language') || ctx.cfg.general.language, size: ctx.str('size') || 'full', content: true, settings: true, update: false, prune: false, protect: [ctx.i.channelId] };
          const plan = buildPlan(ctx.bot, ctx.guild, opts);
          return ctx.reply({ embeds: [previewEmbed(ctx.t, { ...opts, ops: plan.ops }, plan)], flags: EPHEMERAL });
        },
      },
      status: {
        async run(ctx) {
          const st = state(ctx.bot, ctx.guild.id);
          const job = st.current && st.jobs[st.current];
          if (!job) return ctx.info('builder.no_job');
          const q = running.get(ctx.guild.id);
          return ctx.reply({ embeds: [progressEmbed(ctx.t, job, { done: job.index, total: job.ops.length, eta: q?.eta(), errors: job.errors?.length }).addFields({ name: ctx.t('builder.state'), value: ctx.t(`builder.st.${job.status}`), inline: true }, { name: ctx.t('builder.started'), value: ts(job.createdAt), inline: true })], flags: EPHEMERAL });
        },
      },
      cancel: {
        async run(ctx) {
          const q = running.get(ctx.guild.id);
          if (!q) return ctx.fail('builder.not_running');
          q.cancel();
          ctx.bot.audit(ctx.guild.id, 'builder_cancel', { by: ctx.user.id });
          return ctx.ok('builder.cancelling');
        },
      },
      resume: {
        async run(ctx) {
          const st = state(ctx.bot, ctx.guild.id);
          const job = st.current && st.jobs[st.current];
          if (!job || !['cancelled', 'running', 'failed'].includes(job.status) || job.index >= job.ops.length) return ctx.fail('builder.nothing_to_resume');
          if (running.has(ctx.guild.id)) return ctx.fail('builder.already_running');
          job.progressChannel = ctx.i.channelId; job.progressMessage = null;
          await ctx.ok('builder.resuming', { done: job.index, total: job.ops.length });
          runJob(ctx.bot, ctx.guild, job).catch(err => log.error('builder failed', { err }));
        },
      },
    },
  }],
  components: {
    async builder(ctx, [action, id]) {
      if (!ctx.member.permissions.has(PermissionFlagsBits.Administrator)) return ctx.fail('errors.missing_user_perms', { perms: ctx.t('perm.Administrator') });
      const st = state(ctx.bot, ctx.guild.id);
      const job = st.jobs[id];
      if (!job || job.status !== 'pending') return ctx.fail('builder.expired');
      if (action === 'cancel') { job.status = 'cancelled'; ctx.bot.store.touch(ctx.guild.id); return ctx.i.update({ embeds: [errEmbed(ctx.t('common.cancelled'))], components: [] }); }
      if (action === 'go') {
        if (running.has(ctx.guild.id)) return ctx.fail('builder.already_running');
        if (Date.now() - job.createdAt > 15 * 60_000) return ctx.fail('builder.expired');
        await ctx.i.update({ embeds: [okEmbed(ctx.t('builder.starting'))], components: [] });
        const b = createBackup(ctx.bot, ctx.guild, { label: `before builder ${job.template}`, by: ctx.user.id });
        job.backupId = b.id;
        ctx.bot.audit(ctx.guild.id, 'builder_start', { template: job.template, size: job.size, lang: job.lang, prune: job.prune, by: ctx.user.id, backup: b.id });
        runJob(ctx.bot, ctx.guild, job).catch(err => log.error('builder failed', { err }));
      }
    },
  },
};

async function startFlow(ctx, { update }) {
  if (running.has(ctx.guild.id)) return ctx.fail('builder.already_running');
  const opts = {
    template: ctx.str('template'), lang: ctx.str('language') || ctx.cfg.general.language, size: ctx.str('size') || 'full',
    content: ctx.bool('content') ?? true, settings: ctx.bool('settings') ?? !update, update, prune: !!ctx.bool('prune'), protect: [ctx.i.channelId],
  };
  await ctx.defer();
  const { job, plan } = newJob(ctx.bot, ctx.guild, ctx, opts);
  return ctx.reply({
    embeds: [previewEmbed(ctx.t, job, plan)],
    components: [row(button(`builder:go:${job.id}`, ctx.t(update ? 'builder.confirm_repair' : 'builder.confirm'), opts.prune ? ButtonStyle.Danger : ButtonStyle.Success, '🏗️'), button(`builder:cancel:${job.id}`, ctx.t('common.cancel'), ButtonStyle.Secondary))],
  });
}

/** Used by config-driven actions (panel): builds without the Discord confirmation (never prunes). */
export async function runFromAction(bot, guild, { template, size, lang, update }) {
  const opts = { template, size, lang: lang || bot.cfg(guild.id).general.language, content: true, settings: !update, update: !!update, prune: false, protect: [] };
  const { job } = newJob(bot, guild, null, opts);
  createBackup(bot, guild, { label: `before builder ${template} (panel)` });
  job.progressChannel = bot.cfg(guild.id).moderation.logChannel || null;
  return runJob(bot, guild, job);
}
