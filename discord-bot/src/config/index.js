/**
 * Per-guild configuration.
 *
 *   effective = defaults(schema) ⊕ remote config (API v2, cached on disk) ⊕ local overrides
 *
 * - Remote: GET /bot/guilds/:id/config; applied only when its `version` is newer than the cached one.
 *   Changes are discovered by polling GET /bot/changes every 15 s.
 * - Local overrides: written by /config and by the builder. Each override remembers when it was made;
 *   a remote config saved later (updatedAt) wins over older overrides (the panel is the authority once
 *   somebody saves there). Every local change is also reported as a `config_local_change` event so the
 *   panel can show it.
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
    const remoteAt = Date.parse(rec.remote?.updatedAt || 0) || 0;
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
  set(guildId, dottedPath, value, { by = null } = {}) {
    const node = schemaAt(this.schema, dottedPath);
    if (!node) throw new Error(`unknown config path ${dottedPath}`);
    const errors = validate(value, node);
    if (errors.length) return { ok: false, errors };
    const rec = this.record(guildId);
    rec.overrides[dottedPath] = { value, at: Date.now(), by };
    this.store.touch(guildId);
    const before = this.cache.get(guildId);
    const cfg = this.compute(guildId);
    this.emit('change', guildId, cfg, before);
    this.api?.event(guildId, 'config_local_change', { path: dottedPath, value, by }).catch?.(() => {});
    return { ok: true };
  }

  /** Removes the override (and, if the remote config has the key, it applies again). */
  reset(guildId, dottedPath) {
    const rec = this.record(guildId);
    for (const p of Object.keys(rec.overrides)) if (p === dottedPath || p.startsWith(dottedPath + '.')) delete rec.overrides[p];
    // also force default when the remote has a value but the admin wants the default locally
    const node = schemaAt(this.schema, dottedPath);
    if (node && rec.remote?.config && getPath(rec.remote.config, dottedPath) !== undefined) {
      rec.overrides[dottedPath] = { value: defaultsOf(node), at: Date.now() };
    }
    this.store.touch(guildId);
    const cfg = this.compute(guildId);
    this.emit('change', guildId, cfg);
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
    const at = Date.now();
    for (const [p, v] of flat) rec.overrides[p] = { value: v, at, by };
    this.store.touch(guildId);
    this.emit('change', guildId, this.compute(guildId));
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
    rec.remote = { version, updatedAt: payload.updatedAt || new Date().toISOString(), config: payload.config };
    this.store.touch(guildId);
    const before = this.cache.get(guildId);
    const cfg = this.compute(guildId);
    this.emit('change', guildId, cfg, before);
    log.info('config updated from API', { guildId, version });
    return true;
  }

  async load(guildId) {
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

  stop() { if (this.pollTimer) clearTimeout(this.pollTimer); }

  /** Drops the cached state of a guild the bot left. */
  forget(guildId) { this.cache.delete(guildId); }
}
