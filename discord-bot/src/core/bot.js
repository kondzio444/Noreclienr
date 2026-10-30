/**
 * Nore Bot runtime: owns the discord.js client, the store, the config manager, the Nore API client,
 * the scheduler and the modules, and routes events and interactions to the modules.
 *
 * Gateway intents (see README):
 *   Guilds, GuildMembers*, GuildMessages, MessageContent*, GuildMessageReactions, GuildVoiceStates,
 *   GuildModeration, GuildExpressions, GuildScheduledEvents, GuildInvites, GuildWebhooks,
 *   AutoModerationConfiguration      (* privileged – enable them in the Developer Portal)
 */
import {
  Client, GatewayIntentBits as I, Partials, Options, Events, ChannelType, PermissionFlagsBits,
} from 'discord.js';
import { logger } from '../lib/logger.js';
import { Store } from '../lib/store.js';
import { NoreApi } from '../lib/nore-api.js';
import { ConfigManager } from '../config/index.js';
import { translator, t } from '../i18n/index.js';
import { Scheduler } from './scheduler.js';
import { Ctx } from './context.js';
import { buildCommand, leaves } from './commands.js';
import { missingPermissions, permKey } from '../lib/permissions.js';
import { EPHEMERAL, errEmbed, embed, COLORS } from './ui.js';
import { loadModules } from '../modules/index.js';
import { AdminLink } from './admin-link.js';

const log = logger.child('bot');

export const INTENTS = [
  I.Guilds, I.GuildMembers, I.GuildMessages, I.MessageContent, I.GuildMessageReactions, I.GuildVoiceStates,
  I.GuildModeration, I.GuildExpressions, I.GuildScheduledEvents, I.GuildInvites, I.GuildWebhooks,
  I.AutoModerationConfiguration,
];

export const CHANNEL_TYPE_NAMES = {
  [ChannelType.GuildText]: 'text', [ChannelType.GuildVoice]: 'voice', [ChannelType.GuildCategory]: 'category',
  [ChannelType.GuildAnnouncement]: 'announcement', [ChannelType.GuildForum]: 'forum', [ChannelType.GuildStageVoice]: 'stage',
  [ChannelType.GuildMedia]: 'media',
};

export class Bot {
  constructor({ env, dryRun = false }) {
    this.env = env;
    this.dryRun = dryRun;
    this.log = log;
    this.store = new Store(dryRun ? null : env.dataDir);
    this.api = new NoreApi({ base: env.noreApi, secret: dryRun ? '' : env.botSecret });
    this.config = new ConfigManager({ store: this.store, api: this.api });
    this.scheduler = new Scheduler(this.store);
    this.admin = new AdminLink(this);
    this.modules = [];
    this.commands = new Map();
    this.components = new Map();
    this.cooldowns = new Map();
    this.metaTimers = new Map();
    this.intervals = [];
    this.client = null;
    this.stopping = false;
  }

  /** Loads every module and collects commands, component handlers and timers. */
  async init() {
    this.modules = await loadModules();
    for (const m of this.modules) {
      for (const def of m.commands || []) {
        if (this.commands.has(def.name)) throw new Error(`duplicate command ${def.name}`);
        if (!('module' in def)) def.module = m.name;
        this.commands.set(def.name, def);
      }
      for (const [prefix, h] of Object.entries(m.components || {})) {
        if (this.components.has(prefix)) throw new Error(`duplicate component prefix ${prefix}`);
        this.components.set(prefix, { module: m, handler: h });
      }
      for (const [type, h] of Object.entries(m.timers || {})) this.scheduler.on(type, (g, d, timer) => h(this, g, d, timer));
    }
    for (const m of this.modules) await m.init?.(this);
    return this;
  }

  commandJson() { return [...this.commands.values()].map(buildCommand); }

  // ---------------------------------------------------------------- helpers for modules

  cfg(guildId) { return this.config.get(guildId); }
  tg(guildId) { return translator(this.cfg(guildId).general.language); }
  color(guildId) { return this.cfg(guildId).general.color; }
  embed(guildId, color) { return embed(color ?? this.color(guildId)); }

  /** Resolves a text-capable channel of a guild by id; null when missing or not allowed. */
  async channel(guild, id) {
    if (!id || !guild) return null;
    const g = typeof guild === 'string' ? this.client.guilds.cache.get(guild) : guild;
    if (!g) return null;
    const ch = g.channels.cache.get(id) || await g.channels.fetch(id).catch(() => null);
    return ch || null;
  }

  /** Sends to a channel id if the bot may; returns the message or null. Never throws. */
  async send(guild, channelId, payload) {
    const ch = await this.channel(guild, channelId);
    if (!ch?.isTextBased?.()) return null;
    const me = ch.guild.members.me;
    const perms = ch.permissionsFor(me);
    if (!perms?.has(PermissionFlagsBits.ViewChannel) || !perms.has(PermissionFlagsBits.SendMessages)) return null;
    if (payload.embeds?.length && !perms.has(PermissionFlagsBits.EmbedLinks)) return null;
    try { return await ch.send(payload); } catch (err) { log.warn('send failed', { guildId: ch.guild.id, channelId, err: err.message }); return null; }
  }

  /** Posts to the moderation log channel. */
  async modLog(guild, embedOrPayload, channelId) {
    const id = channelId || this.cfg(guild.id).moderation.logChannel;
    if (!id) return null;
    const payload = embedOrPayload.data || embedOrPayload.toJSON ? { embeds: [embedOrPayload] } : embedOrPayload;
    return this.send(guild, id, payload);
  }

  /** Audit trail: structured log + optional API event. */
  audit(guildId, type, data = {}) {
    log.info(`audit ${type}`, { guildId, ...data });
    this.api.event(guildId, type, data).catch?.(() => {});
  }

  /** Builds the meta report for the panel (docs/bot-api.md). */
  metaOf(guild) {
    return {
      name: guild.name,
      icon: guild.iconURL({ size: 128 }) || null,
      channels: guild.channels.cache.filter(c => !c.isThread()).map(c => ({ id: c.id, name: c.name, type: CHANNEL_TYPE_NAMES[c.type] || String(c.type), parentId: c.parentId || null, position: c.rawPosition })),
      roles: guild.roles.cache.filter(r => r.id !== guild.id).map(r => ({ id: r.id, name: r.name, color: r.color, position: r.position, managed: r.managed })),
    };
  }

  reportMeta(guild, delay = 5000) {
    if (!this.api.botEnabled || !guild) return;
    clearTimeout(this.metaTimers.get(guild.id));
    const timer = setTimeout(() => { this.metaTimers.delete(guild.id); this.api.putMeta(guild.id, this.metaOf(guild)); }, delay);
    timer.unref?.();
    this.metaTimers.set(guild.id, timer);
  }

  every(ms, fn, name) {
    const h = setInterval(() => { Promise.resolve().then(fn).catch(err => log.error(`interval ${name} failed`, { err })); }, ms);
    h.unref?.();
    this.intervals.push(h);
    return h;
  }

  /** Handler safety net for gateway events. */
  wrap(event, fn) {
    return async (...args) => {
      try { await fn(...args); } catch (err) { log.error(`event ${event} failed`, { err }); }
    };
  }

  // ---------------------------------------------------------------- start / stop

  async start() {
    this.client = new Client({
      intents: INTENTS,
      partials: [Partials.Message, Partials.Channel, Partials.Reaction, Partials.GuildMember, Partials.User],
      makeCache: Options.cacheWithLimits({
        ...Options.DefaultMakeCacheSettings,
        MessageManager: 200,
        PresenceManager: 0,
      }),
      sweepers: { ...Options.DefaultSweeperSettings, messages: { interval: 3600, lifetime: 6 * 3600 } },
      allowedMentions: { parse: ['users', 'roles'], repliedUser: false },
      rest: { timeout: 20_000, retries: 3 },
    });
    const c = this.client;
    c.on(Events.Error, (err) => log.error('client error', { err }));
    c.on(Events.Warn, (msg) => log.warn('client warning', { msg }));
    c.on(Events.ShardError, (err, id) => log.error('shard error', { shard: id, err }));
    c.on(Events.ShardReconnecting, (id) => log.info('shard reconnecting', { shard: id }));
    c.rest.on('rateLimited', (info) => log.debug('rate limited', { route: info.route, ms: info.timeToReset, global: info.global }));

    c.once(Events.ClientReady, this.wrap('ready', () => this.onReady()));
    c.on(Events.InteractionCreate, this.wrap('interaction', (i) => this.onInteraction(i)));
    c.on(Events.GuildCreate, this.wrap('guildCreate', async (g) => {
      if (this.admin.isBlocked(g.id)) { log.warn('invited to a blacklisted guild – leaving', { guildId: g.id }); await g.leave().catch(() => {}); return; }
      await this.config.load(g.id); this.scheduler.arm([g.id]); this.reportMeta(g, 1000); for (const m of this.modules) await m.guildReady?.(this, g); }));
    c.on(Events.GuildDelete, this.wrap('guildDelete', async (g) => { if (!g.available) return; this.api.deleteGuild(g.id); this.config.forget(g.id); }));
    for (const ev of [Events.ChannelCreate, Events.ChannelDelete, Events.ChannelUpdate]) c.on(ev, (ch) => ch.guild && this.reportMeta(ch.guild));
    for (const ev of [Events.GuildRoleCreate, Events.GuildRoleDelete, Events.GuildRoleUpdate]) c.on(ev, (r) => this.reportMeta(r.guild));
    c.on(Events.GuildUpdate, (_o, g) => this.reportMeta(g));

    // module event listeners
    for (const m of this.modules) {
      for (const [event, fn] of Object.entries(m.events || {})) c.on(event, this.wrap(`${m.name}.${event}`, (...a) => fn(this, ...a)));
    }
    await c.login(this.env.token);
  }

  async onReady() {
    const c = this.client;
    log.info('logged in', { user: c.user.tag, guilds: c.guilds.cache.size, shard: c.shard?.ids });
    const ids = [...c.guilds.cache.keys()];
    await this.config.loadAll(ids);
    this.scheduler.arm(ids);
    this.scheduler.start();
    this.config.startPolling((id) => c.guilds.cache.has(id));
    this.admin.start();
    for (const g of c.guilds.cache.values()) this.reportMeta(g, 2000 + Math.random() * 30_000);
    this.every(10 * 60_000, () => { for (const g of c.guilds.cache.values()) this.reportMeta(g, Math.random() * 60_000); }, 'meta');
    this.config.on('change', (guildId, cfg, before) => {
      const g = c.guilds.cache.get(guildId);
      if (g) for (const m of this.modules) m.configChanged?.(this, g, cfg, before);
    });
    for (const m of this.modules) {
      try { await m.ready?.(this); } catch (err) { log.error(`module ${m.name} ready failed`, { err }); }
    }
    await this.cacheCommandIds();
  }

  /** Remembers application command ids for clickable </name:id> mentions in /help. */
  async cacheCommandIds() {
    this.commandIds = new Map();
    try {
      const list = await this.client.application.commands.fetch();
      for (const cmd of list.values()) this.commandIds.set(cmd.name, cmd.id);
    } catch { /* not deployed yet */ }
  }

  mention(path) {
    const id = this.commandIds?.get(path.split(' ')[0]);
    return id ? `</${path}:${id}>` : `/${path}`;
  }

  async stop(signal = 'stop') {
    if (this.stopping) return;
    this.stopping = true;
    log.info('shutting down', { signal });
    for (const h of this.intervals) clearInterval(h);
    this.scheduler.stop();
    this.config.stop();
    for (const m of this.modules) { try { await m.stop?.(this); } catch { /* ignore */ } }
    this.store.close();
    try { await this.client?.destroy(); } catch { /* ignore */ }
  }

  // ---------------------------------------------------------------- interactions

  async onInteraction(i) {
    if (!i.guild) {
      if (i.isRepliable()) await i.reply({ content: t('pl', 'errors.guild_only') + ' / ' + t('en', 'errors.guild_only'), flags: EPHEMERAL }).catch(() => {});
      return;
    }
    const ctx = new Ctx(this, i);
    // the Nore blacklist (admin API): blocked users cannot use the bot at all
    if (this.admin.isBlocked(i.user?.id)) {
      if (i.isAutocomplete()) return i.respond([]).catch(() => {});
      if (i.isRepliable()) return i.reply({ embeds: [errEmbed(ctx.t('errors.blacklisted'))], flags: EPHEMERAL }).catch(() => {});
      return;
    }
    try {
      if (i.isChatInputCommand()) return await this.runCommand(ctx);
      if (i.isAutocomplete()) return await this.runAutocomplete(ctx);
      if (i.isMessageComponent() || i.isModalSubmit()) {
        const [prefix, ...args] = i.customId.split(':');
        const h = this.components.get(prefix);
        if (!h) return; // collectors (confirm:, page:) handle their own ids
        if (h.module.name && this.cfg(i.guildId)[h.module.name]?.enabled === false && !h.module.alwaysComponents) {
          return ctx.fail('errors.module_disabled');
        }
        ctx.args = args;
        return await h.handler(ctx, args);
      }
    } catch (err) {
      log.error('interaction failed', { type: i.type, command: i.commandName, customId: i.customId, guildId: i.guildId, err });
      if (i.isRepliable()) {
        const payload = { embeds: [errEmbed(ctx.t('errors.generic'))], flags: EPHEMERAL };
        try { if (i.deferred || i.replied) await i.followUp(payload); else await i.reply(payload); } catch { /* gone */ }
      }
    }
  }

  findLeaf(def, i) {
    const group = i.options.getSubcommandGroup(false);
    const sub = i.options.getSubcommand(false);
    if (group) return def.groups?.[group]?.[sub];
    if (sub) return def.subs?.[sub];
    return def;
  }

  async runCommand(ctx) {
    const i = ctx.i;
    const def = this.commands.get(i.commandName);
    if (!def) return ctx.fail('errors.unknown_command');
    const leaf = this.findLeaf(def, i);
    if (!leaf?.run) return ctx.fail('errors.unknown_command');
    const cfg = ctx.cfg;
    if (def.module && cfg[def.module] && cfg[def.module].enabled === false) return ctx.fail('errors.module_disabled', { module: ctx.t(`panel.${def.module}._label`) });
    if ((cfg.general.disabledCommands || []).includes(def.name)) return ctx.fail('errors.command_disabled');

    // permissions: Discord's default_member_permissions already hides commands; check again in case
    // a server changed the command permissions, and allow configured roles (e.g. moderation.modRoles)
    const perms = leaf.perms || def.perms || [];
    const allowRoles = typeof def.allowRoles === 'function' ? def.allowRoles(cfg) : [];
    const roleOk = allowRoles.some(r => ctx.member.roles.cache.has(r));
    const missing = roleOk ? [] : missingPermissions(ctx.member.permissions, perms);
    if (missing.length) return ctx.fail('errors.missing_user_perms', { perms: missing.map(p => ctx.t(permKey(p))).join(', ') });
    const botPerms = leaf.botPerms || def.botPerms || [];
    if (botPerms.length) {
      const scope = leaf.botPermsScope === 'guild' ? ctx.guild.members.me.permissions : i.channel?.permissionsFor(ctx.guild.members.me);
      const botMissing = missingPermissions(scope, botPerms);
      if (botMissing.length) return ctx.fail('errors.missing_bot_perms', { perms: botMissing.map(p => ctx.t(permKey(p))).join(', ') });
    }

    // cooldown (staff bypass)
    const cd = (leaf.cooldown ?? def.cooldown ?? cfg.general.commandCooldownSeconds) * 1000;
    if (cd > 0 && !ctx.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
      const key = `${i.guildId}:${i.user.id}:${def.name}`;
      const until = this.cooldowns.get(key) || 0;
      if (Date.now() < until) return ctx.fail('errors.cooldown', { seconds: Math.ceil((until - Date.now()) / 1000) });
      this.cooldowns.set(key, Date.now() + cd);
      if (this.cooldowns.size > 5000) for (const [k, v] of this.cooldowns) if (v < Date.now()) this.cooldowns.delete(k);
    }
    await leaf.run(ctx);
  }

  async runAutocomplete(ctx) {
    const def = this.commands.get(ctx.i.commandName);
    const leaf = def && this.findLeaf(def, ctx.i);
    const fn = leaf?.autocomplete || def?.autocomplete;
    if (!fn) return ctx.i.respond([]);
    const choices = (await fn(ctx)) || [];
    await ctx.i.respond(choices.slice(0, 25).map(c => ({ name: String(c.name).slice(0, 100), value: typeof c.value === 'string' ? c.value.slice(0, 100) : c.value }))).catch(() => {});
  }

  /** All runnable command paths (for the dry run and /help). */
  commandPaths() {
    const out = [];
    for (const def of this.commands.values()) for (const l of leaves(def)) out.push({ path: l.path, def, leaf: l.leaf });
    return out;
  }
}

export { COLORS };
