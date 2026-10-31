/**
 * Persistent one-shot timers (reminders, giveaway/poll ends, temporary bans, ticket auto-close …).
 * Timers live in the guild document (`timers` array) so they survive restarts; an in-memory list
 * is scanned every `tickMs`. Handlers are registered per type by the modules.
 */
import { randomUUID } from 'node:crypto';
import { logger } from '../lib/logger.js';

const log = logger.child('scheduler');

export class Scheduler {
  constructor(store, { tickMs = 5000 } = {}) {
    this.store = store;
    this.tickMs = tickMs;
    this.handlers = new Map();
    this.pending = []; // { guildId, timer }
    this.interval = null;
    this.running = false;
  }

  on(type, handler) { this.handlers.set(type, handler); }

  /** Re-arms timers stored for the given guilds (called on ready). */
  arm(guildIds) {
    const known = new Set(this.pending.map(p => p.timer.id));
    for (const guildId of guildIds) {
      for (const timer of this.store.guild(guildId).timers || []) if (!known.has(timer.id)) this.pending.push({ guildId, timer });
    }
  }

  add(guildId, type, at, data = {}) {
    const doc = this.store.guild(guildId);
    doc.timers ??= [];
    const timer = { id: randomUUID(), type, at, data };
    doc.timers.push(timer);
    this.store.touch(guildId);
    this.pending.push({ guildId, timer });
    return timer.id;
  }

  /** Cancels timers matching a predicate on (type, data). */
  cancel(guildId, predicate) {
    const doc = this.store.guild(guildId);
    const before = (doc.timers || []).length;
    doc.timers = (doc.timers || []).filter(t => !predicate(t));
    this.pending = this.pending.filter(p => p.guildId !== guildId || !predicate(p.timer));
    if (doc.timers.length !== before) this.store.touch(guildId);
    return before - doc.timers.length;
  }

  list(guildId, predicate = () => true) { return (this.store.guild(guildId).timers || []).filter(predicate); }

  start() {
    if (this.interval) return;
    this.interval = setInterval(() => this.tick().catch(err => log.error('tick failed', { err })), this.tickMs);
    this.interval.unref?.();
  }

  stop() { if (this.interval) clearInterval(this.interval); this.interval = null; }

  async tick(now = Date.now()) {
    if (this.running) return;
    this.running = true;
    try {
      const due = this.pending.filter(p => p.timer.at <= now);
      if (!due.length) return;
      this.pending = this.pending.filter(p => p.timer.at > now);
      for (const { guildId, timer } of due) {
        const doc = this.store.guild(guildId);
        doc.timers = (doc.timers || []).filter(t => t.id !== timer.id);
        this.store.touch(guildId);
        const h = this.handlers.get(timer.type);
        if (!h) { log.warn('no handler for timer', { type: timer.type }); continue; }
        try { await h(guildId, timer.data, timer); } catch (err) { log.error('timer handler failed', { type: timer.type, guildId, err }); }
      }
    } finally { this.running = false; }
  }
}
