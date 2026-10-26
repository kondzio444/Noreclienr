/**
 * AutoMod: spam/flood, duplicates, mass mentions, invites, link allow-list, bad words, caps,
 * new-account filter and raid mode (join-rate detection). Rules: src/lib/automod.js.
 * Also manages Discord's native AutoMod rules (/automod native …).
 */
import {
  AutoModerationRuleEventType, AutoModerationRuleTriggerType, AutoModerationActionType, AutoModerationRuleKeywordPresetType,
} from 'discord.js';
import { opt } from '../core/commands.js';
import { EPHEMERAL, okEmbed, COLORS, embed } from '../core/ui.js';
import { AutoModEngine, isNewAccount } from '../lib/automod.js';
import { parseDuration, ts, formatDuration } from '../lib/duration.js';
import { clip } from '../lib/template.js';
import { createCase, dmMember, applyThresholds } from './moderation.js';
import { logger } from '../lib/logger.js';

const log = logger.child('automod');
const engine = new AutoModEngine();

function raidState(bot, guildId) { return bot.store.ns(guildId, 'raid', () => ({ until: 0 })); }
export const raidActive = (bot, guildId) => raidState(bot, guildId).until > Date.now();

async function logAutomod(bot, guild, e) {
  const cfg = bot.cfg(guild.id);
  return bot.modLog(guild, e, cfg.automod.logChannel || cfg.moderation.logChannel);
}

function exempt(cfg, message) {
  const m = message.member;
  if (!m) return true;
  if (m.permissions.has('ManageMessages') || m.permissions.has('Administrator')) return true;
  if ((cfg.exemptChannels || []).includes(message.channelId) || (cfg.exemptChannels || []).includes(message.channel.parentId)) return true;
  return (cfg.exemptRoles || []).some(r => m.roles.cache.has(r));
}

async function act(bot, message, hit) {
  const guild = message.guild;
  const cfg = bot.cfg(guild.id).automod;
  const tg = bot.tg(guild.id);
  const member = message.member;
  const reason = tg('automod.reason', { rule: tg(`automod.rule.${hit.rule}`), detail: hit.detail || '' });
  await message.delete().catch(() => {});
  engine.reset(guild.id, member.id);
  let caseType = null, duration = null;
  try {
    switch (hit.action) {
      case 'warn':
        caseType = 'warn';
        break;
      case 'timeout':
        if (member.moderatable) { duration = cfg.timeoutMinutes * 60_000; await member.timeout(duration, reason); caseType = 'timeout'; }
        break;
      case 'kick':
        if (member.kickable) { await dmMember(bot, guild, member.user, 'kick', reason); await member.kick(reason); caseType = 'kick'; }
        break;
      case 'ban':
        if (member.bannable) { await dmMember(bot, guild, member.user, 'ban', reason); await guild.members.ban(member.id, { reason, deleteMessageSeconds: 3600 }); caseType = 'ban'; }
        break;
      default: break;
    }
  } catch (err) { log.warn('action failed', { guildId: guild.id, err: err.message }); }
  const notice = await message.channel.send({ content: tg('automod.notice', { user: `<@${member.id}>`, rule: tg(`automod.rule.${hit.rule}`) }), allowedMentions: { users: [member.id] } }).catch(() => null);
  if (notice) setTimeout(() => notice.delete().catch(() => {}), 8000).unref?.();
  if (caseType) {
    await createCase(bot, guild, { type: caseType, target: member.id, moderator: null, reason, duration, extra: { automod: hit.rule } });
    if (caseType === 'warn') { await dmMember(bot, guild, member.user, 'warn', reason); await applyThresholds(bot, guild, member); }
  } else {
    await logAutomod(bot, guild, embed(COLORS.warn).setAuthor({ name: tg('automod.log_title', { rule: tg(`automod.rule.${hit.rule}`) }) })
      .setDescription(`${member} · <#${message.channelId}>\n\`\`\`\n${clip(message.content, 900)}\n\`\`\``).setTimestamp());
  }
}

async function startRaid(bot, guild, minutes, by = null) {
  const st = raidState(bot, guild.id);
  st.until = Date.now() + minutes * 60_000;
  bot.store.touch(guild.id);
  const cfg = bot.cfg(guild.id).automod;
  const tg = bot.tg(guild.id);
  bot.audit(guild.id, 'raid_mode', { on: true, until: st.until, by });
  const e = embed(COLORS.error).setTitle(tg('automod.raid_title')).setDescription(tg('automod.raid_on', { until: ts(st.until), action: tg(`panel.options.actions.${cfg.raid.action}`) }));
  await bot.modLog(guild, { content: cfg.raid.alertRole ? `<@&${cfg.raid.alertRole}>` : undefined, embeds: [e], allowedMentions: { roles: cfg.raid.alertRole ? [cfg.raid.alertRole] : [] } }, cfg.logChannel || bot.cfg(guild.id).moderation.logChannel);
}

const NATIVE_ACTIONS = ['block', 'alert', 'timeout'];
function nativeActions(ctx) {
  const kind = ctx.str('action') || 'block';
  const actions = [{ type: AutoModerationActionType.BlockMessage, metadata: { customMessage: ctx.t('automod.native_blocked').slice(0, 150) } }];
  const alert = ctx.channelOpt('alert_channel');
  if (alert) actions.push({ type: AutoModerationActionType.SendAlertMessage, metadata: { channel: alert.id } });
  if (kind === 'timeout') actions.push({ type: AutoModerationActionType.Timeout, metadata: { durationSeconds: 600 } });
  if (kind === 'alert' && alert) actions.shift();
  return actions;
}

async function ruleAutocomplete(ctx) {
  const q = (ctx.i.options.getFocused() || '').toLowerCase();
  const rules = await ctx.guild.autoModerationRules.fetch().catch(() => null);
  return rules ? [...rules.values()].filter(r => r.name.toLowerCase().includes(q)).map(r => ({ name: `${r.enabled ? '🟢' : '⚫'} ${r.name}`, value: r.id })) : [];
}

export default {
  name: 'automod',
  ready(bot) { bot.every(60_000, () => engine.sweep(), 'automod-sweep'); },
  events: {
    async messageCreate(bot, message) {
      if (!message.guild || message.author.bot || message.webhookId || !message.member) return;
      const cfg = bot.cfg(message.guild.id).automod;
      if (!cfg.enabled || exempt(cfg, message)) return;
      const hit = engine.check({
        guildId: message.guild.id, authorId: message.author.id, content: message.content,
        mentions: message.mentions.users.size + message.mentions.roles.size, everyone: message.mentions.everyone,
      }, cfg);
      if (hit) await act(bot, message, hit);
    },
    async guildMemberAdd(bot, member) {
      const cfg = bot.cfg(member.guild.id).automod;
      if (!cfg.enabled) return;
      const tg = bot.tg(member.guild.id);
      if (engine.recordJoin(member.guild.id, cfg.raid) && !raidActive(bot, member.guild.id)) await startRaid(bot, member.guild, cfg.raid.durationMinutes);
      if (raidActive(bot, member.guild.id) && !member.user.bot) {
        const reason = tg('automod.raid_reason');
        if (cfg.raid.action === 'kick' && member.kickable) await member.kick(reason).catch(() => {});
        else if (cfg.raid.action === 'timeout' && member.moderatable) await member.timeout(cfg.timeoutMinutes * 60_000, reason).catch(() => {});
        return;
      }
      const na = cfg.newAccounts;
      if (na.enabled && !member.user.bot && isNewAccount(member.user.createdTimestamp, na.minAgeDays)) {
        const reason = tg('automod.new_account_reason', { days: na.minAgeDays });
        try {
          if (na.action === 'kick' && member.kickable) {
            await member.send(tg('automod.new_account_dm', { server: member.guild.name, days: na.minAgeDays })).catch(() => {});
            await member.kick(reason);
          } else if (na.action === 'timeout' && member.moderatable) await member.timeout(cfg.timeoutMinutes * 60_000, reason);
          else if (na.action === 'role' && na.role) await member.roles.add(na.role, reason);
        } catch (err) { log.warn('new account action failed', { err: err.message }); }
        await logAutomod(bot, member.guild, embed(COLORS.warn).setDescription(tg('automod.new_account_log', { user: `${member}`, created: ts(member.user.createdTimestamp) })));
      }
    },
  },
  timers: {},
  commands: [{
    name: 'automod', category: 'moderation', module: null, perms: ['ManageGuild'],
    subs: {
      status: {
        async run(ctx) {
          const cfg = ctx.cfg.automod;
          const rules = ['spam', 'duplicates', 'mentions', 'invites', 'links', 'badWords', 'caps', 'newAccounts', 'raid'];
          const lines = rules.map(r => `${cfg[r].enabled ? '🟢' : '⚫'} **${ctx.t(`automod.rule.${r}`)}**${cfg[r].action ? ` → ${ctx.t(`panel.options.actions.${cfg[r].action}`)}` : ''}`);
          const raid = raidState(ctx.bot, ctx.guild.id);
          const e = ctx.bot.embed(ctx.guild.id).setTitle(ctx.t('automod.status_title')).setDescription(`${cfg.enabled ? ctx.t('automod.enabled') : ctx.t('automod.disabled')}\n\n${lines.join('\n')}`);
          if (raid.until > Date.now()) e.addFields({ name: ctx.t('automod.raid_title'), value: ctx.t('automod.raid_until', { until: ts(raid.until) }) });
          return ctx.reply({ embeds: [e], flags: EPHEMERAL });
        },
      },
      raidmode: {
        options: [opt.string('state', true, { choices: { set: 'onoff', values: ['on', 'off'] } }), opt.string('duration', false, { max: 20 })],
        async run(ctx) {
          if (ctx.str('state') === 'off') {
            raidState(ctx.bot, ctx.guild.id).until = 0;
            ctx.bot.store.touch(ctx.guild.id);
            ctx.bot.audit(ctx.guild.id, 'raid_mode', { on: false, by: ctx.user.id });
            return ctx.ok('automod.raid_off');
          }
          const ms = parseDuration(ctx.str('duration') || `${ctx.cfg.automod.raid.durationMinutes}m`) || 600_000;
          await startRaid(ctx.bot, ctx.guild, Math.round(ms / 60_000), ctx.user.id);
          return ctx.ok('automod.raid_started', { duration: formatDuration(ms) });
        },
      },
    },
    groups: {
      native: {
        list: {
          botPerms: ['ManageGuild'], botPermsScope: 'guild',
          async run(ctx) {
            const rules = await ctx.guild.autoModerationRules.fetch();
            const lines = [...rules.values()].map(r => `${r.enabled ? '🟢' : '⚫'} **${r.name}** · ${ctx.t(`automod.native_trigger.${r.triggerType}`)} · \`${r.id}\``);
            return ctx.reply({ embeds: [ctx.bot.embed(ctx.guild.id).setTitle(ctx.t('automod.native_title')).setDescription(lines.join('\n') || ctx.t('automod.native_none'))], flags: EPHEMERAL });
          },
        },
        keyword: {
          botPerms: ['ManageGuild'], botPermsScope: 'guild',
          options: [opt.string('name', true, { max: 100 }), opt.string('words', true, { max: 1000 }), opt.string('action', false, { choices: { set: 'nativeAction', values: NATIVE_ACTIONS } }), opt.channel('alert_channel', false, { channelTypes: ['text'] })],
          async run(ctx) {
            const words = ctx.str('words').split(/[,\n]/).map(w => w.trim()).filter(Boolean).slice(0, 1000);
            const rule = await ctx.guild.autoModerationRules.create({
              name: ctx.str('name'), eventType: AutoModerationRuleEventType.MessageSend, triggerType: AutoModerationRuleTriggerType.Keyword,
              triggerMetadata: { keywordFilter: words }, actions: nativeActions(ctx), enabled: true, reason: `by ${ctx.user.tag}`,
            });
            ctx.bot.audit(ctx.guild.id, 'native_automod_create', { rule: rule.id, by: ctx.user.id });
            return ctx.ok('automod.native_created', { name: rule.name });
          },
        },
        preset: {
          botPerms: ['ManageGuild'], botPermsScope: 'guild',
          options: [opt.string('name', true, { max: 100 }), opt.channel('alert_channel', false, { channelTypes: ['text'] })],
          async run(ctx) {
            const rule = await ctx.guild.autoModerationRules.create({
              name: ctx.str('name'), eventType: AutoModerationRuleEventType.MessageSend, triggerType: AutoModerationRuleTriggerType.KeywordPreset,
              triggerMetadata: { presets: [AutoModerationRuleKeywordPresetType.Profanity, AutoModerationRuleKeywordPresetType.SexualContent, AutoModerationRuleKeywordPresetType.Slurs] },
              actions: nativeActions(ctx), enabled: true,
            });
            return ctx.ok('automod.native_created', { name: rule.name });
          },
        },
        mentions: {
          botPerms: ['ManageGuild'], botPermsScope: 'guild',
          options: [opt.string('name', true, { max: 100 }), opt.int('limit', true, { min: 1, max: 50 }), opt.channel('alert_channel', false, { channelTypes: ['text'] })],
          async run(ctx) {
            const rule = await ctx.guild.autoModerationRules.create({
              name: ctx.str('name'), eventType: AutoModerationRuleEventType.MessageSend, triggerType: AutoModerationRuleTriggerType.MentionSpam,
              triggerMetadata: { mentionTotalLimit: ctx.int('limit'), mentionRaidProtectionEnabled: true }, actions: nativeActions(ctx), enabled: true,
            });
            return ctx.ok('automod.native_created', { name: rule.name });
          },
        },
        toggle: {
          botPerms: ['ManageGuild'], botPermsScope: 'guild',
          options: [opt.string('rule', true, { autocomplete: true }), opt.bool('enabled', true)],
          autocomplete: ruleAutocomplete,
          async run(ctx) {
            const rule = await ctx.guild.autoModerationRules.fetch(ctx.str('rule')).catch(() => null);
            if (!rule) return ctx.fail('automod.native_not_found');
            await rule.setEnabled(ctx.bool('enabled'));
            return ctx.ok('automod.native_toggled', { name: rule.name, state: ctx.bool('enabled') ? '🟢' : '⚫' });
          },
        },
        delete: {
          botPerms: ['ManageGuild'], botPermsScope: 'guild',
          options: [opt.string('rule', true, { autocomplete: true })],
          autocomplete: ruleAutocomplete,
          async run(ctx) {
            const rule = await ctx.guild.autoModerationRules.fetch(ctx.str('rule')).catch(() => null);
            if (!rule) return ctx.fail('automod.native_not_found');
            const { confirm } = await import('../core/ui.js');
            if (!(await confirm(ctx, { text: ctx.t('automod.native_confirm_delete', { name: rule.name }) }))) return;
            await rule.delete();
            ctx.bot.audit(ctx.guild.id, 'native_automod_delete', { rule: rule.id, by: ctx.user.id });
            return ctx.i.followUp({ embeds: [okEmbed(ctx.t('automod.native_deleted', { name: rule.name }))], flags: EPHEMERAL });
          },
        },
      },
    },
  }],
};

export { engine };
