// An in-memory stand-in for the bot endpoints of Nore API v2 (docs/bot-api.md): versioned configs,
// PATCH merges like the Worker (objects merged, lists and leaves replaced, null removes) and
// /bot/changes. `offline = true` makes every call fail like an unreachable API.
import { deepMerge } from '../../src/config/validate.js';

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
function mergePatch(base, patch) {
  const out = isObj(base) ? { ...base } : {};
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) delete out[k];
    else out[k] = isObj(v) ? mergePatch(out[k], v) : structuredClone(v);
  }
  return out;
}

export class FakeApi {
  constructor(defaults) {
    this.defaults = defaults;
    this.offline = false;
    this.guilds = new Map(); // id -> { version, updatedAt, config, updatedBy }
    this.calls = [];         // { method, guildId, body }
    this.events = [];
    this.changed = [];       // { id, at }
    this.backoff = { delay: 10, ready: () => true };
  }

  get botEnabled() { return true; }

  doc(id) { return this.guilds.get(id) || { version: 0, updatedAt: null, config: structuredClone(this.defaults) }; }

  async getConfig(guildId) {
    this.calls.push({ method: 'GET', guildId });
    if (this.offline) return { ok: false, offline: true };
    return { ok: true, data: { guildId, ...structuredClone(this.doc(guildId)) } };
  }

  async patchConfig(guildId, body) {
    this.calls.push({ method: 'PATCH', guildId, body: structuredClone(body) });
    if (this.offline) return { ok: false, offline: true };
    const d = this.doc(guildId);
    if (Number.isInteger(body.baseVersion) && body.baseVersion !== d.version) return { ok: false, status: 409, data: { code: 'version_conflict', version: d.version } };
    const config = deepMerge(this.defaults, mergePatch(d.config, body.config));
    const saved = { version: d.version + 1, updatedAt: new Date().toISOString(), config, updatedBy: { id: 'bot', name: 'Nore Bot', bot: true, ...(body.by ? { userId: body.by.id } : {}), reason: body.reason } };
    this.guilds.set(guildId, saved);
    this.changed.push({ id: guildId, at: Date.now() });
    return { ok: true, data: { guildId, ...structuredClone(saved) } };
  }

  /** What the panel does: PUT a whole config on the current version. */
  panelSave(guildId, change) {
    const d = this.doc(guildId);
    const saved = { version: d.version + 1, updatedAt: new Date().toISOString(), config: deepMerge(d.config, change), updatedBy: { id: '1', name: 'Panel' } };
    this.guilds.set(guildId, saved);
    this.changed.push({ id: guildId, at: Date.now() });
    return saved;
  }

  async changes(since) {
    this.calls.push({ method: 'CHANGES', since });
    if (this.offline) return { ok: false, offline: true };
    return { ok: true, data: { now: Date.now(), guilds: [...new Set(this.changed.filter(c => c.at > since).map(c => c.id))] } };
  }

  async event(guildId, type, data) { this.events.push({ guildId, type, data }); return { ok: true }; }
  async putMeta() { return { ok: true }; }
  async deleteGuild() { return { ok: true }; }

  patches(guildId) { return this.calls.filter(c => c.method === 'PATCH' && (!guildId || c.guildId === guildId)); }
}
