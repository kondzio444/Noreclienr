/**
 * Per-guild configuration.
 *
 *   effective = defaults(schema) ⊕ remote config (API v2, cached on disk) ⊕ local overrides
 *
 * - Remote: GET /bot/guilds/:id/config; applied only when its `version` is newer than the cached one.
 *   Changes are discovered by polling GET /bot/changes every 15 s.
 * - Local overrides: written by /config, the builder and panel actions. They apply at once (also
 *   offline) and are then pushed to the API (PATCH /bot/guilds/:id/config, debounced): the answer
 *   becomes the remote copy and the pushed overrides are dropped, so the panel shows exactly what the
 *   bot uses. While the API is unreachable the overrides stay in the store (they are the queue) and
 *   are pushed on the next successful poll, before the guild's config is loaded and after a restart.
 *   A remote config received later than an override wins over it (the panel is the authority once
 *   somebody saves there after the change).
 * - Everything is validated and sanitized against the schema: invalid values fall back to defaults.
 * - The API being offline never blocks anything: the cached remote copy (or plain defaults) is used.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { ROOT } from '../lib/env.js';
import { logger } from '../lib/logger.js';
import { defaultsOf, deepMerge, sanitize, validate, schemaAt, getPath, setPath } from './validate.js';

const log = logger.child('config');

export function loadSchema() {
  return JSON.parse(readFileSync(path.join(ROOT, 'config.schema.json'), 'utf8'));
}

export class ConfigManager extends EventEmitter {
  constructor({ store, api, schema = loadSchema() }) {
    super();
    this.store = store;
    this.api = api;
    this.schema = schema;
    this.defaults = defaultsOf(schema);
    this.cache = new Map(); // guildId -> effective config
    this.since = 0;
    this.pollTimer = null;
    this.pushDelay = 1500;          // ms: coalesces the many set() calls of one builder step
    this.pushTimers = new Map();    // guildId -> timeout
    this.pushing = new Map();       // guildId -> promise of the running push
    this.dirty = new Set();         // guilds with overrides the API has not got yet
    this.rejected = new Map();      // guildId -> override `at` stamps the API refused (not retried)
  }

  get syncEnabled() { return !!this.api?.botEnabled; }

  /** Strictly increasing ms clock for override / receive times (two events never share a stamp). */
  stamp() {
    this.lastStamp = Math.max(Date.now(), (this.lastStamp || 0) + 1);
    return this.lastStamp;
  }

  /** The cached record in the guild document: { remote: {version, updatedAt, config}, overrides: { path: {value, at} } } */
  record(guildId) {
    const doc = this.store.guild(guildId);
    doc.config ??= { remote: null, overrides: {} };
    doc.config.overrides ??= {};
    return doc.config;
  }

  /** Builds the effective config from defaults, remote and overrides. */
  compute(guildId) {
    const rec = this.record(guildId);
    let cfg = this.defaults;
    if (rec.remote?.config) cfg = deepMerge(cfg, sanitize(rec.remote.config, this.schema) || {});
    // bot clock: when the remote copy arrived (server clocks may differ); older payloads: updatedAt
    const remoteAt = Number(rec.remote?.receivedAt) || Date.parse(rec.remote?.updatedAt || 0) || 0;
    for (const [p, o] of Object.entries(rec.overrides)) {
      if (o.at < remoteAt) { delete rec.overrides[p]; this.store.touch(guildId); continue; }
      const node = schemaAt(this.schema, p);
      if (!node || validate(o.value, node).length) { delete rec.overrides[p]; this.store.touch(guildId); continue; }
      cfg = structuredClone(cfg);
      setPath(cfg, p, structuredClone(o.value));
    }
    this.cache.set(guildId, cfg);
    return cfg;
  }

  get(guildId) {
    return this.cache.get(guildId) || this.compute(guildId);
  }

  /** Sets a local override (from /config or the builder). */
  set(guildId, dottedPath, value, { by = null, reason = null } = {}) {
    const node = schemaAt(this.schema, dottedPath);
    if (!node) throw new Error(`unknown config path ${dottedPath}`);
    const errors = validate(value, node);
    if (errors.length) return { ok: false, errors };
    const rec = this.record(guildId);
    rec.overrides[dottedPath] = { value, at: this.stamp(), by, ...(reason ? { reason } : {}) };
    this.store.touch(guildId);
    const before = this.cache.get(guildId);
    const cfg = this.compute(guildId);
    this.emit('change', guildId, cfg, before);
    this.schedulePush(guildId);
    return { ok: true };
  }

  /** Removes the override (and, if the remote config has the key, it applies again). */
  reset(guildId, dottedPath) {
    const rec = this.record(guildId);
    for (const p of Object.keys(rec.overrides)) if (p === dottedPath || p.startsWith(dottedPath + '.')) delete rec.overrides[p];
    // also force default when the remote has a value but the admin wants the default locally
    const node = schemaAt(this.schema, dottedPath);
    if (node && rec.remote?.config && getPath(rec.remote.config, dottedPath) !== undefined) {
      rec.overrides[dottedPath] = { value: defaultsOf(node), at: this.stamp() };
    }
    this.store.touch(guildId);
    const cfg = this.compute(guildId);
    this.emit('change', guildId, cfg);
    if (Object.keys(rec.overrides).length) this.schedulePush(guildId);
    return cfg;
  }

  /** Imports a whole config (JSON) as overrides of every top-level module. */
  import(guildId, json, { by } = {}) {
    const errors = validate(json, this.schema);
    const clean = sanitize(json, this.schema) || {};
    const flat = [];
    const walk = (obj, prefix) => {
      for (const [k, v] of Object.entries(obj)) {
        const p = prefix ? `${prefix}.${k}` : k;
        const node = schemaAt(this.schema, p);
        if (node?.type === 'object') walk(v, p); else flat.push([p, v]);
      }
    };
    walk(clean, '');
    const rec = this.record(guildId);
    const at = this.stamp();
    for (const [p, v] of flat) rec.overrides[p] = { value: v, at, by };
    this.store.touch(guildId);
    this.emit('change', guildId, this.compute(guildId));
    this.schedulePush(guildId);
    return { applied: flat.length, errors };
  }

  // ---------------------------------------------------------------- remote sync

  /** Applies a remote payload { guildId, version, updatedAt, config } when it is newer. */
  applyRemote(guildId, payload) {
    if (!payload || typeof payload !== 'object' || !payload.config) return false;
    const rec = this.record(guildId);
    const version = Number(payload.version) || 0;
    if (rec.remote && version <= (Number(rec.remote.version) || 0)) return false;
    const errors = validate(payload.config, this.schema);
    if (errors.length) log.warn('remote config has invalid fields – using defaults for them', { guildId, errors: errors.slice(0, 10) });
    rec.remote = { version, updatedAt: payload.updatedAt || new Date().toISOString(), receivedAt: this.stamp(), config: payload.config };
    this.store.touch(guildId);
    const before = this.cache.get(guildId);
    const cfg = this.compute(guildId);
    this.emit('change', guildId, cfg, before);
    log.info('config updated from API', { guildId, version });
    return true;
  }

  async load(guildId) {
    // local changes first, so a newer remote copy cannot drop changes the API never saw
    if (this.hasPending(guildId)) await this.flush(guildId);
    const res = await this.api?.getConfig(guildId);
    if (res?.ok) this.applyRemote(guildId, res.data);
    return this.get(guildId);
  }

  /** Loads configs for many guilds with limited concurrency. */
  async loadAll(guildIds, concurrency = 4) {
    const queue = [...guildIds];
    const worker = async () => { while (queue.length) { const id = queue.shift(); try { await this.load(id); } catch (err) { log.warn('config load failed', { guildId: id, err }); } } };
    await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker));
  }

  /** Polls /bot/changes every `interval` ms for guilds accepted by `has(guildId)`. */
  startPolling(has, interval = 15_000) {
    if (!this.api?.botEnabled) return;
    const tick = async () => {
      try {
        const res = await this.api.changes(this.since);
        if (res.ok && res.data) {
          await this.flushDirty(has);
          const ids = (res.data.guilds || []).filter(has);
          if (res.data.now) this.since = Number(res.data.now) || Date.now();
          for (const id of ids) await this.load(id);
        }
      } catch (err) { log.warn('change poll failed', { err }); }
      const wait = this.api.offline ? this.api.backoff.delay : interval;
      this.pollTimer = setTimeout(tick, wait);
      this.pollTimer.unref?.();
    };
    this.since = Date.now() - 60_000;
    this.pollTimer = setTimeout(tick, interval);
    this.pollTimer.unref?.();
  }

  stop() {
    if (this.pollTimer) clearTimeout(this.pollTimer);
    for (const t of this.pushTimers.values()) clearTimeout(t);
    this.pushTimers.clear();
  }

  // ---------------------------------------------------------------- push local changes to the API

  /** Overrides the API has not saved yet (minus the ones it rejected, until they change again). */
  pendingOverrides(guildId) {
    const rec = this.record(guildId);
    const rejected = this.rejected.get(guildId);
    return Object.entries(rec.overrides).filter(([p, o]) => !(rejected && rejected.get(p) === o.at));
  }

  hasPending(guildId) { return this.syncEnabled && this.pendingOverrides(guildId).length > 0; }

  /** Pushes this guild's overrides soon (debounced). */
  schedulePush(guildId, delay = this.pushDelay) {
    if (!this.syncEnabled) return;
    this.dirty.add(guildId);
    clearTimeout(this.pushTimers.get(guildId));
    const t = setTimeout(() => { this.pushTimers.delete(guildId); this.flush(guildId).catch(err => log.warn('config push failed', { guildId, err })); }, delay);
    t.unref?.();
    this.pushTimers.set(guildId, t);
  }

  /**
   * Sends the pending overrides now: PATCH with the partial config they make. On success the answer
   * becomes the remote copy and the sent overrides are removed. Resolves to
   * { ok, version?, offline?, skipped?, rejected? }.
   */
  async flush(guildId, { reason } = {}) {
    clearTimeout(this.pushTimers.get(guildId));
    this.pushTimers.delete(guildId);
    if (!this.syncEnabled) return { ok: false, skipped: true };
    while (this.pushing.has(guildId)) await this.pushing.get(guildId).catch(() => {});
    const entries = this.pendingOverrides(guildId);
    if (!entries.length) { this.dirty.delete(guildId); return { ok: true, nothing: true }; }
    const run = this.push(guildId, entries, reason);
    this.pushing.set(guildId, run);
    try { return await run; } finally { this.pushing.delete(guildId); }
  }

  async push(guildId, entries, reason) {
    const patch = {};
    for (const [p, o] of entries) setPath(patch, p, structuredClone(o.value));
    const by = entries.map(([, o]) => o.by).filter(Boolean).at(-1) || null;
    const sentAt = this.stamp();
    const res = await this.api.patchConfig(guildId, { config: patch, by, reason: reason || entries.map(([, o]) => o.reason).filter(Boolean).at(-1) || 'local' });
    const rec = this.record(guildId);
    if (res?.ok && res.data?.config) {
      for (const [p, o] of entries) if (rec.overrides[p]?.at === o.at) delete rec.overrides[p];
      const version = Number(res.data.version) || 0;
      if (!rec.remote || version >= (Number(rec.remote.version) || 0)) {
        rec.remote = { version, updatedAt: res.data.updatedAt || new Date(sentAt).toISOString(), receivedAt: sentAt, config: res.data.config };
      }
      this.store.touch(guildId);
      this.rejected.delete(guildId);
      if (!this.pendingOverrides(guildId).length) this.dirty.delete(guildId);
      const before = this.cache.get(guildId);
      const cfg = this.compute(guildId);
      if (JSON.stringify(before) !== JSON.stringify(cfg)) this.emit('change', guildId, cfg, before);
      this.emit('pushed', guildId, { version, paths: entries.map(([p]) => p) });
      log.info('config saved to API', { guildId, version, paths: entries.length });
      return { ok: true, version };
    }
    if (res?.offline || res?.skipped) { this.dirty.add(guildId); return { ok: false, offline: !!res.offline, skipped: !!res.skipped }; }
    // the API refused it (schema of the Worker older/newer than the bot's …): keep the overrides
    // locally, do not retry them until they change
    const stamps = new Map(entries.map(([p, o]) => [p, o.at]));
    this.rejected.set(guildId, stamps);
    this.dirty.delete(guildId);
    log.warn('API refused the bot config – kept locally', { guildId, status: res?.status, errors: res?.data?.errors?.slice?.(0, 5) });
    return { ok: false, rejected: true, status: res?.status, errors: res?.data?.errors };
  }

  /** Pushes every guild with unsent overrides (after the API came back). */
  async flushDirty(has = () => true) {
    for (const id of [...this.dirty]) {
      if (!has(id)) continue;
      const r = await this.flush(id);
      if (r.offline) break;
    }
  }

  /** Drops the cached state of a guild the bot left. */
  forget(guildId) { this.cache.delete(guildId); }
}
