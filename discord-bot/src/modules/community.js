/**
 * Discord Community features: enable/disable Community (rules + public updates channel), Welcome
 * Screen, Onboarding (prompts from the self-role menus, default channels), forum tags and forum
 * auto-tagging, announcement auto-publish (crosspost), stage instances and a Server Discovery
 * prerequisites checklist.
 *
 * Not in Discord's public bot API (so not automated): Server Guide and Membership Screening – the
 * builder posts a start-here guide and the verification gate covers screening.
 */
import { ChannelType, GuildVerificationLevel, GuildExplicitContentFilter, GuildMFALevel, Routes } from 'discord.js';
import { opt } from '../core/commands.js';
import { EPHEMERAL, okEmbed, confirm, embed, COLORS } from '../core/ui.js';
import { clip } from '../lib/template.js';

/** Discovery prerequisites → [{ key, ok, value? }] (pure: takes plain facts). */
export function discoveryChecklist(g, now = Date.now()) {
  const weeks = (now - g.createdTimestamp) / (7 * 86_400_000);
  return [
    { key: 'community', ok: g.features.includes('COMMUNITY') },
    { key: 'members', ok: g.memberCount >= 1000, value: g.memberCount },
    { key: 'age', ok: weeks >= 8, value: Math.floor(weeks) },
    { key: 'verification', ok: g.verificationLevel >= GuildVerificationLevel.Medium, value: g.verificationLevel },
    { key: 'content_filter', ok: g.explicitContentFilter === GuildExplicitContentFilter.AllMembers },
    { key: 'mfa', ok: g.mfaLevel === GuildMFALevel.Elevated },
    { key: 'rules', ok: !!g.rulesChannelId },
    { key: 'updates', ok: !!g.publicUpdatesChannelId },
    { key: 'description', ok: !!g.description },
    { key: 'icon', ok: !!g.icon },
    { key: 'onboarding', ok: !!g.onboardingEnabled },
  ];
}

/** Onboarding payload from self-role menus (pure). Discord: ≤ 15 prompts, ≤ 50 options each. */
export function onboardingFromMenus(menus, guildRoles, defaultChannels, { enabled = true } = {}) {
  const prompts = [];
  for (const m of menus.slice(0, 15)) {
    const options = m.roles.filter(r => r.role && guildRoles.has(r.role)).slice(0, 50).map((r) => {
      const o = { title: clip(r.label || guildRoles.get(r.role).name, 50), description: r.description ? clip(r.description, 100) : null, role_ids: [r.role], channel_ids: [] };
      const em = /^<?(a)?:?(\w+):(\d+)>?$/.exec(r.emoji || '');
      if (em) { o.emoji_id = em[3]; o.emoji_name = em[2]; o.emoji_animated = !!em[1]; } else if (r.emoji) o.emoji_name = r.emoji;
      return o;
    });
    if (!options.length) continue;
    prompts.push({ type: 0, title: clip(m.title || m.id, 100), single_select: !m.multiple, required: false, in_onboarding: true, options });
  }
  return { prompts, default_channel_ids: defaultChannels.slice(0, 50), enabled, mode: 0 };
}

export default {
  name: 'community',
  events: {
    async messageCreate(bot, message) {
      if (!message.guild || message.channel.type !== ChannelType.GuildAnnouncement) return;
      const list = bot.cfg(message.guild.id).community.autoPublish;
      if (!list.includes(message.channelId) || !message.crosspostable) return;
      await message.crosspost().catch(() => {});
    },
    async threadCreate(bot, thread, newly) {
      if (!newly || !thread.guild || thread.parent?.type !== ChannelType.GuildForum) return;
      if (!bot.cfg(thread.guild.id).community.forumAutoTag || thread.appliedTags.length) return;
      const title = thread.name.toLowerCase();
      const tags = thread.parent.availableTags.filter(t => title.includes(t.name.toLowerCase().replace(/^\W+/u, '')));
      if (tags.length) await thread.setAppliedTags(tags.slice(0, 5).map(t => t.id)).catch(() => {});
    },
  },
  commands: [{
    name: 'community', category: 'server', module: null, perms: ['ManageGuild'], botPerms: ['ManageGuild'], botPermsScope: 'guild',
    subs: {
      status: {
        async run(ctx) {
          const g = ctx.guild;
          const ob = await ctx.bot.client.rest.get(Routes.guildOnboarding(g.id)).catch(() => null);
          const ws = await g.fetchWelcomeScreen().catch(() => null);
          const e = ctx.bot.embed(g.id).setTitle(ctx.t('comm.status_title')).addFields(
            { name: 'Community', value: g.features.includes('COMMUNITY') ? '✅' : '❌', inline: true },
            { name: ctx.t('comm.rules'), value: g.rulesChannelId ? `<#${g.rulesChannelId}>` : '—', inline: true },
            { name: ctx.t('comm.updates'), value: g.publicUpdatesChannelId ? `<#${g.publicUpdatesChannelId}>` : '—', inline: true },
            { name: 'Onboarding', value: ob ? `${ob.enabled ? '✅' : '❌'} · ${ob.prompts?.length ?? 0} ${ctx.t('comm.prompts')} · ${ob.default_channel_ids?.length ?? 0} ${ctx.t('comm.default_channels')}` : '—', inline: true },
            { name: ctx.t('comm.welcome_screen'), value: ws ? `${ws.enabled ? '✅' : '❌'} · ${ws.welcomeChannels.size}` : '—', inline: true },
            { name: ctx.t('comm.autopublish'), value: ctx.cfg.community.autoPublish.map(c => `<#${c}>`).join(' ') || '—', inline: true },
            { name: ctx.t('comm.features'), value: clip(g.features.map(f => `\`${f}\``).join(' ') || '—', 1024) },
          );
          return ctx.reply({ embeds: [e], flags: EPHEMERAL });
        },
      },
      enable: {
        options: [opt.channel('rules_channel', true, { channelTypes: ['text'] }), opt.channel('updates_channel', true, { channelTypes: ['text'] })],
        async run(ctx) {
          const g = ctx.guild;
          if (!(await confirm(ctx, { text: ctx.t('comm.confirm_enable'), danger: false }))) return;
          await g.edit({
            features: [...new Set([...g.features, 'COMMUNITY'])],
            rulesChannel: ctx.channelOpt('rules_channel').id, publicUpdatesChannel: ctx.channelOpt('updates_channel').id,
            verificationLevel: Math.max(g.verificationLevel, GuildVerificationLevel.Low), explicitContentFilter: GuildExplicitContentFilter.AllMembers,
            reason: `Community by ${ctx.user.username}`,
          });
          ctx.bot.audit(g.id, 'community_enable', { by: ctx.user.id });
          return ctx.i.followUp({ embeds: [okEmbed(ctx.t('comm.enabled'))], flags: EPHEMERAL });
        },
      },
      disable: {
        async run(ctx) {
          if (!(await confirm(ctx, { text: ctx.t('comm.confirm_disable') }))) return;
          await ctx.guild.edit({ features: ctx.guild.features.filter(f => f !== 'COMMUNITY'), reason: `by ${ctx.user.username}` });
          ctx.bot.audit(ctx.guild.id, 'community_disable', { by: ctx.user.id });
          return ctx.i.followUp({ embeds: [okEmbed(ctx.t('comm.disabled'))], flags: EPHEMERAL });
        },
      },
      welcomescreen: {
        options: [
          opt.string('description', true, { max: 140 }), opt.channel('channel_1', true, { channelTypes: ['text', 'announcement', 'forum'] }), opt.string('text_1', true, { max: 50 }),
          opt.channel('channel_2', false, { channelTypes: ['text', 'announcement', 'forum'] }), opt.string('text_2', false, { max: 50 }),
          opt.channel('channel_3', false, { channelTypes: ['text', 'announcement', 'forum'] }), opt.string('text_3', false, { max: 50 }),
          opt.channel('channel_4', false, { channelTypes: ['text', 'announcement', 'forum'] }), opt.string('text_4', false, { max: 50 }),
          opt.bool('enabled'),
        ],
        async run(ctx) {
          if (!ctx.guild.features.includes('COMMUNITY')) return ctx.fail('conf.need_community');
          const welcomeChannels = [];
          for (let i = 1; i <= 4; i++) {
            const ch = ctx.channelOpt(`channel_${i}`);
            if (ch) welcomeChannels.push({ channel: ch.id, description: ctx.str(`text_${i}`) || ch.name, emoji: '👉' });
          }
          await ctx.guild.editWelcomeScreen({ enabled: ctx.bool('enabled') ?? true, description: ctx.str('description'), welcomeChannels });
          ctx.bot.audit(ctx.guild.id, 'welcome_screen', { by: ctx.user.id });
          return ctx.ok('conf.saved');
        },
      },
      onboarding: {
        options: [opt.bool('enabled'), opt.string('default_channels', false, { max: 1000 })],
        async run(ctx) {
          if (!ctx.guild.features.includes('COMMUNITY')) return ctx.fail('conf.need_community');
          await ctx.defer();
          const g = ctx.guild;
          let defaults = (ctx.str('default_channels') || '').match(/\d{17,20}/g) || [];
          if (!defaults.length) {
            // every text channel @everyone can see, top of the list first
            defaults = g.channels.cache.filter(c => [ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildForum].includes(c.type) && c.permissionsFor(g.roles.everyone)?.has('ViewChannel'))
              .sort((a, b) => a.rawPosition - b.rawPosition).map(c => c.id).slice(0, 20);
          }
          const body = onboardingFromMenus(ctx.cfg.roles.menus, g.roles.cache, defaults, { enabled: ctx.bool('enabled') ?? true });
          const writable = defaults.filter(id => g.channels.cache.get(id)?.permissionsFor(g.roles.everyone)?.has('SendMessages')).length;
          if (body.enabled && (defaults.length < 7 || writable < 5)) body.enabled = false;
          await ctx.bot.client.rest.put(Routes.guildOnboarding(g.id), { body, reason: `by ${ctx.user.username}` });
          ctx.bot.audit(g.id, 'onboarding', { prompts: body.prompts.length, defaults: defaults.length, by: ctx.user.id });
          return ctx.reply({ embeds: [okEmbed(ctx.t(body.enabled ? 'comm.onboarding_on' : 'comm.onboarding_saved', { prompts: body.prompts.length, channels: defaults.length, writable }))] });
        },
      },
      tag: {
        options: [opt.channel('forum', true, { channelTypes: ['forum'] }), opt.string('action', true, { choices: { set: 'addremove', values: ['add', 'remove'] } }), opt.string('name', true, { max: 20 }), opt.string('emoji', false, { max: 32 }), opt.bool('moderated')],
        async run(ctx) {
          const f = ctx.channelOpt('forum');
          let tags = f.availableTags.map(t => ({ id: t.id, name: t.name, moderated: t.moderated, emoji: t.emoji }));
          if (ctx.str('action') === 'add') {
            if (tags.length >= 20) return ctx.fail('comm.tags_full');
            tags.push({ name: ctx.str('name'), moderated: !!ctx.bool('moderated'), emoji: ctx.str('emoji') ? { id: null, name: ctx.str('emoji') } : null });
          } else tags = tags.filter(t => t.name.toLowerCase() !== ctx.str('name').toLowerCase());
          await f.setAvailableTags(tags);
          return ctx.ok('conf.saved');
        },
      },
      crosspost: {
        options: [opt.channel('channel', true, { channelTypes: ['announcement'] }), opt.bool('enabled', true)],
        async run(ctx) {
          const set = new Set(ctx.cfg.community.autoPublish);
          if (ctx.bool('enabled')) set.add(ctx.channelOpt('channel').id); else set.delete(ctx.channelOpt('channel').id);
          ctx.bot.config.set(ctx.guild.id, 'community.autoPublish', [...set], { by: ctx.user.id });
          return ctx.ok(ctx.bool('enabled') ? 'comm.crosspost_on' : 'comm.crosspost_off', { channel: `${ctx.channelOpt('channel')}` });
        },
      },
      stage: {
        botPerms: ['ManageChannels', 'MuteMembers', 'MoveMembers'],
        options: [opt.channel('channel', true, { channelTypes: ['stage'] }), opt.string('topic', true, { max: 120 })],
        async run(ctx) {
          const ch = ctx.channelOpt('channel');
          const inst = ch.stageInstance ? await ch.stageInstance.edit({ topic: ctx.str('topic') }) : await ctx.guild.stageInstances.create(ch, { topic: ctx.str('topic') });
          return ctx.ok('comm.stage_started', { topic: inst.topic, channel: `${ch}` });
        },
      },
      discovery: {
        async run(ctx) {
          const g = ctx.guild;
          const ob = await ctx.bot.client.rest.get(Routes.guildOnboarding(g.id)).catch(() => null);
          const list = discoveryChecklist({ ...g, features: g.features, createdTimestamp: g.createdTimestamp, memberCount: g.memberCount, onboardingEnabled: ob?.enabled, icon: g.icon, description: g.description, rulesChannelId: g.rulesChannelId, publicUpdatesChannelId: g.publicUpdatesChannelId, verificationLevel: g.verificationLevel, explicitContentFilter: g.explicitContentFilter, mfaLevel: g.mfaLevel });
          const ok = list.filter(x => x.ok).length;
          const e = embed(ok === list.length ? COLORS.ok : COLORS.warn).setTitle(ctx.t('comm.discovery_title', { ok, total: list.length }))
            .setDescription(list.map(x => `${x.ok ? '✅' : '❌'} ${ctx.t(`comm.check.${x.key}`, { value: x.value ?? '' })}`).join('\n'))
            .setFooter({ text: ctx.t('comm.discovery_footer') });
          return ctx.reply({ embeds: [e], flags: EPHEMERAL });
        },
      },
    },
  }],
};
