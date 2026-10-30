/**
 * Link to the Nore administration (docs/admin-api.md): every 30 s the bot reads
 * GET /api/v2/bot/admin → { blacklist: { discord: [ids] }, actions: [pending], announcements: [target discord] }.
 *
 *   - blacklisted Discord users cannot use the bot (commands, buttons, modals),
 *   - a blacklisted guild ID makes the bot leave that guild,
 *   - pending actions (message, leave, reload, meta, announce) run once and are reported back,
 *   - announcements for Discord go to the channel set in the panel (Nore → Ogłoszenia Nore).
 */
import { logger } from '../lib/logger.js';
import { rememberId } from '../lib/store.js';
import { render, clip } from '../lib/template.js';

const log = logger.child('admin');
const LEVEL_COLORS = { info: 0x9d5cff, warning: 0xffb020, event: 0xff8a1f };
const LEVEL_EMOJI = { info: '📢', warning: '⚠️', event: '🎉' };

export class AdminLink {
  constructor(bot, { intervalMs = 30_000 } = {}) {
    this.bot = bot;
    this.intervalMs = intervalMs;
    this.blocked = new Set();
    this.announcements = [];
    this.done = new Set(); // action ids already handled in this process (the API may answer before the report lands)
    this.running = false;
  }

  /** True when this Discord user (or guild) is on the Nore blacklist. */
  isBlocked(id) { return !!id && this.blocked.has(String(id)); }

  start() {
    if (!this.bot.api.botEnabled) return;
    setTimeout(() => this.poll().catch(err => log.warn('admin poll failed', { err: err.message })), 5_000).unref?.();
    this.bot.every(this.intervalMs, () => this.poll(), 'admin-link');
  }

  async poll() {
    if (this.running) return;
    this.running = true;
    try {
      const r = await this.bot.api.admin();
      if (!r.ok || !r.data) return;
      this.apply(r.data);
      for (const a of r.data.actions || []) {
        if (this.done.has(a.id)) continue;
        this.done.add(a.id);
        let ok = true, result = null;
        try { result = await this.run(a); } catch (err) { ok = false; result = { error: String(err.message || err).slice(0, 300) }; }
        await this.bot.api.actionDone(a.id, ok, result);
        log.info('admin action', { id: a.id, type: a.type, guildId: a.guildId, ok });
      }
      if (this.done.size > 2000) this.done = new Set([...this.done].slice(-500));
      await this.postAnnouncements();
    } finally { this.running = false; }
  }

  /** Takes the blacklist and announcements; leaves blacklisted guilds. */
  apply(data) {
    this.blocked = new Set((data.blacklist?.discord || []).map(String));
    this.announcements = Array.isArray(data.announcements) ? data.announcements : [];
    const client = this.bot.client;
    if (!client) return;
    for (const g of client.guilds.cache.values()) {
      if (this.blocked.has(g.id)) {
        log.warn('leaving a blacklisted guild', { guildId: g.id });
        g.leave().catch(err => log.warn('leave failed', { guildId: g.id, err: err.message }));
      }
    }
  }

  guild(id) {
    const g = id ? this.bot.client?.guilds.cache.get(id) : null;
    if (id && !g) throw new Error('Bota nie ma na tym serwerze');
    return g;
  }

  /** Runs one admin action; returns a small result object. */
  async run(a) {
    const d = a.data || {};
    switch (a.type) {
      case 'message': {
        const g = this.guild(a.guildId);
        const msg = await this.bot.send(g, d.channelId, { content: clip(d.content, 2000), allowedMentions: { parse: [] } });
        if (!msg) throw new Error('Nie udało się wysłać – brak kanału albo uprawnień');
        return { messageId: msg.id };
      }
      case 'leave': {
        const g = this.guild(a.guildId);
        await g.leave();
        return { left: g.id };
      }
      case 'reload': {
        const ids = a.guildId ? [this.guild(a.guildId).id] : [...this.bot.client.guilds.cache.keys()];
        for (const id of ids) await this.bot.config.load(id);
        return { reloaded: ids.length };
      }
      case 'meta': {
        const gs = a.guildId ? [this.guild(a.guildId)] : [...this.bot.client.guilds.cache.values()];
        for (const g of gs) this.bot.reportMeta(g, 500 + Math.random() * 5000);
        return { reported: gs.length };
      }
      case 'announce': {
        const ann = this.announcements.find(x => x.id === d.announcementId);
        if (!ann) throw new Error('Ogłoszenie nie jest aktywne dla Discorda');
        const gs = a.guildId ? [this.guild(a.guildId)] : [...this.bot.client.guilds.cache.values()];
        let posted = 0;
        for (const g of gs) if (await this.postTo(g, ann, { force: true })) posted++;
        return { posted };
      }
      default: throw new Error(`Nieznana akcja ${a.type}`);
    }
  }

  embedOf(guildId, ann) {
    const e = this.bot.embed(guildId, LEVEL_COLORS[ann.level] ?? undefined).setTitle(`${LEVEL_EMOJI[ann.level] || '📢'} ${clip(ann.title, 240)}`);
    if (ann.body) e.setDescription(clip(ann.body, 3500));
    if (ann.link) e.setURL(ann.link);
    if (ann.startsAt) e.setTimestamp(new Date(ann.startsAt));
    return e;
  }

  /** Posts one announcement to a guild's configured channel (once per guild unless forced). */
  async postTo(guild, ann, { force = false } = {}) {
    const cfg = this.bot.cfg(guild.id).nore;
    const feed = cfg?.announcements;
    if (!cfg?.enabled || !feed?.enabled || !feed.channel) return false;
    const st = this.bot.store.ns(guild.id, 'nore', () => ({}));
    st.announcements ??= null;
    if (st.announcements === null) st.announcements = [];
    if (!rememberId(st.announcements, ann.id, 200) && !force) return false;
    this.bot.store.touch?.(guild.id);
    const role = feed.role ? `<@&${feed.role}>` : '';
    const content = render(feed.template || this.bot.tg(guild.id)('nore.announcement_template'), { title: ann.title, role }).trim();
    const msg = await this.bot.send(guild, feed.channel, { content: content || undefined, embeds: [this.embedOf(guild.id, ann)], allowedMentions: { roles: feed.role ? [feed.role] : [] } });
    return !!msg;
  }

  async postAnnouncements() {
    if (!this.announcements.length || !this.bot.client) return;
    for (const g of this.bot.client.guilds.cache.values()) {
      for (const ann of [...this.announcements].reverse()) {
        try { await this.postTo(g, ann); } catch (err) { log.warn('announcement post failed', { guildId: g.id, err: err.message }); }
      }
    }
  }
}
