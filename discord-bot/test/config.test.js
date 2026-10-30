import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildSchema } from '../src/config/schema-source.js';
import { validate, defaultsOf, sanitize, deepMerge, parseValue, schemaAt, leafPaths } from '../src/config/validate.js';
import { ConfigManager } from '../src/config/index.js';
import { Store } from '../src/lib/store.js';
import { has } from '../src/i18n/index.js';
import { FakeApi } from './helpers/fake-api.js';

const schema = buildSchema();

test('config.schema.json is in sync with schema-source (npm run schema)', () => {
  const file = JSON.parse(readFileSync(new URL('../config.schema.json', import.meta.url), 'utf8'));
  assert.deepEqual(file, schema);
});

test('schema is draft 2020-12 with x-ui and x-i18n everywhere', () => {
  assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema');
  const UI = new Set(['channel', 'role', 'text', 'textarea', 'toggle', 'select', 'color', 'number', 'list']);
  const walk = (node, path) => {
    assert.ok(node['x-i18n'], `x-i18n at ${path}`);
    if (node.type === 'object') { for (const [k, v] of Object.entries(node.properties)) walk(v, `${path}.${k}`); return; }
    assert.ok(UI.has(node['x-ui']), `x-ui at ${path}`);
    assert.notEqual(node.default, undefined, `default at ${path}`);
    if (node.type === 'array' && node.items?.type === 'object') for (const [k, v] of Object.entries(node.items.properties)) walk(v, `${path}[].${k}`);
  };
  for (const [k, v] of Object.entries(schema.properties)) walk(v, k);
});

test('every panel label/help/option key exists in pl and en', () => {
  const keys = new Set();
  const walk = (n) => {
    for (const k of ['x-i18n', 'x-i18n-help']) if (typeof n[k] === 'string') keys.add(n[k]);
    if (n['x-i18n-options']) Object.values(n['x-i18n-options']).forEach(k => keys.add(k));
    if (n.properties) Object.values(n.properties).forEach(walk);
    if (n.items) walk(n.items);
  };
  walk(schema);
  const missing = [];
  for (const k of keys) for (const l of ['pl', 'en']) if (!has(l, k, { exact: true })) missing.push(`${l}:${k}`);
  assert.deepEqual(missing, []);
});

test('defaults validate against the schema', () => {
  assert.deepEqual(validate(defaultsOf(schema), schema), []);
});

test('validation reports JSON pointers', () => {
  const errs = validate({ welcome: { channel: 'abc', enabled: 'yes' }, nope: 1 }, schema);
  const ptrs = errs.map(e => e.pointer).sort();
  assert.deepEqual(ptrs, ['/nope', '/welcome/channel', '/welcome/enabled']);
});

test('sanitize drops invalid leaves and keeps valid ones', () => {
  const clean = sanitize({ welcome: { channel: 'abc', enabled: true }, leveling: { xpMin: 9999 }, unknown: {} }, schema);
  assert.deepEqual(clean, { welcome: { enabled: true }, leveling: {} });
  const merged = deepMerge(defaultsOf(schema), clean);
  assert.equal(merged.welcome.enabled, true);
  assert.equal(merged.welcome.channel, '');
  assert.equal(merged.leveling.xpMin, 15);
});

test('list items are completed with item defaults and invalid ones dropped', () => {
  const clean = sanitize({ leveling: { rewards: [{ level: 5, role: '123456789012345678' }, { level: 'x' }] } }, schema);
  assert.equal(clean.leveling.rewards.length, 2);
  assert.equal(clean.leveling.rewards[1].level, 5, 'invalid field replaced by its default');
});

test('parseValue understands Discord input', () => {
  assert.deepEqual(parseValue(schemaAt(schema, 'welcome.channel'), '<#123456789012345678>'), { ok: true, value: '123456789012345678' });
  assert.deepEqual(parseValue(schemaAt(schema, 'welcome.enabled'), 'tak'), { ok: true, value: true });
  assert.deepEqual(parseValue(schemaAt(schema, 'welcome.enabled'), 'off'), { ok: true, value: false });
  assert.equal(parseValue(schemaAt(schema, 'leveling.xpMin'), '5000').ok, false);
  assert.deepEqual(parseValue(schemaAt(schema, 'general.color'), '9D5CFF'), { ok: true, value: '#9d5cff' });
  assert.deepEqual(parseValue(schemaAt(schema, 'automod.exemptRoles'), '<@&123456789012345678>, 223456789012345678'), { ok: true, value: ['123456789012345678', '223456789012345678'] });
  assert.ok(leafPaths(schema).includes('automod.spam.maxMessages'));
});

test('ConfigManager: remote versions, local overrides, panel wins when newer', () => {
  const store = new Store(null);
  const cm = new ConfigManager({ store, api: null, schema });
  const g = '111111111111111111';
  assert.equal(cm.get(g).general.language, 'pl');
  assert.ok(cm.applyRemote(g, { version: 2, updatedAt: new Date(Date.now() - 60_000).toISOString(), config: { general: { language: 'en' } } }));
  assert.equal(cm.get(g).general.language, 'en');
  assert.equal(cm.applyRemote(g, { version: 1, config: { general: { language: 'pl' } } }), false, 'older version ignored');
  cm.set(g, 'welcome.enabled', true);
  assert.equal(cm.get(g).welcome.enabled, true);
  assert.equal(cm.set(g, 'leveling.xpMin', -1).ok, false);
  // a panel save after the local change wins
  assert.ok(cm.applyRemote(g, { version: 3, updatedAt: new Date(Date.now() + 1000).toISOString(), config: { welcome: { enabled: false } } }));
  assert.equal(cm.get(g).welcome.enabled, false);
  cm.reset(g, 'welcome.enabled');
  assert.equal(cm.get(g).welcome.enabled, false);
});

// ------------------------------------------------------------------ sync of local changes to the API

test('ConfigManager: local changes are pushed to the API (PATCH), become the remote copy, overrides cleared', async () => {
  const api = new FakeApi(defaultsOf(schema));
  const cm = new ConfigManager({ store: new Store(null), api, schema });
  cm.pushDelay = 5;
  const g = '222222222222222222';
  cm.set(g, 'tickets.enabled', true, { by: '333333333333333333', reason: 'command' });
  cm.set(g, 'tickets.category', '444444444444444444');
  assert.equal(cm.get(g).tickets.enabled, true, 'works at once, before the push');
  assert.equal(api.patches().length, 0, 'debounced');
  const r = await cm.flush(g);
  assert.equal(r.ok, true); assert.equal(r.version, 1);
  const [p] = api.patches(g);
  assert.deepEqual(p.body.config, { tickets: { enabled: true, category: '444444444444444444' } }, 'only what changed, as a partial config');
  assert.equal(p.body.by, '333333333333333333'); assert.equal(p.body.reason, 'command');
  const rec = cm.record(g);
  assert.deepEqual(rec.overrides, {}); assert.equal(rec.remote.version, 1); assert.equal(rec.remote.config.tickets.category, '444444444444444444');
  assert.equal(cm.get(g).tickets.category, '444444444444444444');
  assert.equal((await cm.flush(g)).nothing, true, 'nothing left to send');
  // the debounced push fires on its own
  cm.set(g, 'welcome.enabled', true);
  await new Promise(res => setTimeout(res, 40));
  assert.equal(api.patches(g).length, 2); assert.equal(api.doc(g).version, 2); assert.equal(api.doc(g).config.welcome.enabled, true);
  assert.equal(api.doc(g).config.tickets.enabled, true, 'the API merged, earlier fields kept');
  // a panel save of a newer version reaches the bot through load()
  api.panelSave(g, { tickets: { maxOpen: 3 } });
  await cm.load(g);
  assert.equal(cm.get(g).tickets.maxOpen, 3); assert.equal(cm.get(g).tickets.enabled, true);
  cm.stop();
});

test('ConfigManager: offline changes are kept (store = queue) and sent when the API is back', async () => {
  const api = new FakeApi(defaultsOf(schema));
  const store = new Store(null);
  const cm = new ConfigManager({ store, api, schema });
  const g = '555555555555555555';
  api.offline = true;
  cm.set(g, 'suggestions.enabled', true);
  const r = await cm.flush(g);
  assert.equal(r.ok, false); assert.equal(r.offline, true);
  assert.ok(cm.dirty.has(g)); assert.ok(cm.record(g).overrides['suggestions.enabled'], 'kept locally');
  assert.equal(cm.get(g).suggestions.enabled, true, 'still applies');
  // a panel save happened meanwhile; on reconnect the local change goes first and is merged into it
  api.offline = false;
  api.panelSave(g, { suggestions: { requireReview: true } });
  await cm.flushDirty();
  assert.ok(!cm.dirty.has(g));
  assert.equal(api.doc(g).config.suggestions.enabled, true); assert.equal(api.doc(g).config.suggestions.requireReview, true, 'merged with the panel save');
  assert.equal(cm.get(g).suggestions.requireReview, true);
  // after a restart (new manager, same store) unsent overrides are pushed before the config loads
  api.offline = true;
  cm.set(g, 'leveling.enabled', true);
  await cm.flush(g);
  cm.stop();
  const cm2 = new ConfigManager({ store, api, schema });
  api.offline = false;
  await cm2.load(g);
  assert.equal(api.doc(g).config.leveling.enabled, true);
  assert.deepEqual(cm2.record(g).overrides, {});
  assert.equal(cm2.get(g).leveling.enabled, true);
  cm2.stop();
});

test('ConfigManager: polling pushes queued changes and applies panel saves', async () => {
  const api = new FakeApi(defaultsOf(schema));
  const cm = new ConfigManager({ store: new Store(null), api, schema });
  const g = '666666666666666666';
  api.offline = true;
  cm.set(g, 'logging.enabled', true);
  await cm.flush(g);
  api.offline = false;
  cm.startPolling(() => true, 5);
  cm.since = 0;
  await new Promise(res => setTimeout(res, 80));
  assert.equal(api.doc(g).config.logging.enabled, true, 'pushed on the next successful poll');
  api.panelSave(g, { logging: { members: '777777777777777777' } });
  await new Promise(res => setTimeout(res, 80));
  cm.stop();
  assert.equal(cm.get(g).logging.members, '777777777777777777', 'panel change reached the bot');
  assert.equal(cm.get(g).logging.enabled, true);
});

test('ConfigManager: a change the API refuses stays local and is not retried until it changes', async () => {
  const api = new FakeApi(defaultsOf(schema));
  api.patchConfig = async (guildId, body) => { api.calls.push({ method: 'PATCH', guildId, body }); return { ok: false, status: 400, data: { code: 'invalid_config', errors: [{ path: '/welcome/enabled' }] } }; };
  const cm = new ConfigManager({ store: new Store(null), api, schema });
  const g = '888888888888888888';
  cm.set(g, 'welcome.enabled', true);
  const r = await cm.flush(g);
  assert.equal(r.rejected, true);
  assert.equal(cm.get(g).welcome.enabled, true);
  assert.equal((await cm.flush(g)).nothing, true, 'not sent again');
  cm.set(g, 'welcome.enabled', false);
  await cm.flush(g);
  assert.equal(api.patches(g).length, 2, 'a new change is sent');
  cm.stop();
});
