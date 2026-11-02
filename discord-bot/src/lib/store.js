/**
 * Small embedded store without native dependencies: one JSON document per guild
 * (data/guilds/<guildId>.json) plus named global documents (data/<name>.json).
 *
 * A guild always lives on exactly one shard, so per-guild files stay safe when the bot is sharded.
 * Documents are kept in memory, changes are marked with `touch()` and flushed in the background
 * (debounced, atomic write: temp file + rename). `flush()` is called on shutdown.
 */
import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync, readdirSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { logger } from './logger.js';

const log = logger.child('store');

export class Store {
  /**
   * @param {string|null} dir  data directory; null = memory only (tests, dry run)
   */
  constructor(dir, { flushMs = 2000 } = {}) {
    this.dir = dir;
    this.flushMs = flushMs;
    this.docs = new Map();   // key -> object
    this.dirty = new Set();
    this.timer = null;
    if (dir) mkdirSync(path.join(dir, 'guilds'), { recursive: true });
  }

  fileOf(key) {
    if (!this.dir) return null;
    if (key.startsWith('g:')) return path.join(this.dir, 'guilds', `${key.slice(2).replace(/[^0-9a-z_-]/gi, '')}.json`);
    return path.join(this.dir, `${key.replace(/[^0-9a-z_-]/gi, '')}.json`);
  }

  load(key) {
    let doc = this.docs.get(key);
    if (doc) return doc;
    doc = {};
    const file = this.fileOf(key);
    if (file && existsSync(file)) {
      try { doc = JSON.parse(readFileSync(file, 'utf8')) || {}; } catch (err) {
        log.error('corrupt data file, starting empty (backup kept)', { file, err });
        try { renameSync(file, `${file}.corrupt-${Date.now()}`); } catch { /* ignore */ }
        doc = {};
      }
    }
    this.docs.set(key, doc);
    return doc;
  }

  /** The guild's document. Namespaces are created on first use: store.guild(id).xp ??= {} */
  guild(guildId) { return this.load(`g:${guildId}`); }
  global(name) { return this.load(name); }

  /** Namespace helper: returns doc[ns], creating it with `init` when missing. */
  ns(guildId, ns, init = () => ({})) {
    const doc = this.guild(guildId);
    if (doc[ns] === undefined) doc[ns] = init();
    return doc[ns];
  }

  touch(guildIdOrKey, isGlobal = false) {
    const key = isGlobal ? guildIdOrKey : `g:${guildIdOrKey}`;
    this.dirty.add(key);
    if (!this.timer && this.dir) {
      this.timer = setTimeout(() => { this.timer = null; this.flush(); }, this.flushMs);
      this.timer.unref?.();
    }
  }

  touchGlobal(name) { this.touch(name, true); }

  /** Guild ids that have a file on disk (used at start-up to re-arm timers). */
  knownGuilds() {
    if (!this.dir) return [...this.docs.keys()].filter(k => k.startsWith('g:')).map(k => k.slice(2));
    try {
      return readdirSync(path.join(this.dir, 'guilds')).filter(f => f.endsWith('.json')).map(f => f.slice(0, -5));
    } catch { return []; }
  }

  deleteGuild(guildId) {
    const key = `g:${guildId}`;
    this.docs.delete(key);
    this.dirty.delete(key);
    const file = this.fileOf(key);
    if (file && existsSync(file)) {
      try { unlinkSync(file); } catch (err) { log.warn('could not delete guild file', { file, err }); }
    }
  }

  flush() {
    if (!this.dir) { this.dirty.clear(); return; }
    for (const key of [...this.dirty]) {
      this.dirty.delete(key);
      const doc = this.docs.get(key);
      const file = this.fileOf(key);
      if (!doc || !file) continue;
      try {
        const tmp = `${file}.tmp`;
        writeFileSync(tmp, JSON.stringify(doc));
        renameSync(tmp, file);
      } catch (err) {
        log.error('write failed, will retry', { file, err });
        this.dirty.add(key);
      }
    }
  }

  close() {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    this.flush();
  }
}

/** Keeps a bounded list of seen ids (dedupe of feed items, announcements…). Returns true if new. */
export function rememberId(list, id, max = 300) {
  if (list.includes(id)) return false;
  list.push(id);
  if (list.length > max) list.splice(0, list.length - max);
  return true;
}
