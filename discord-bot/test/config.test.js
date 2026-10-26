import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildSchema } from '../src/config/schema-source.js';
import { validate, defaultsOf, sanitize, deepMerge, parseValue, schemaAt, leafPaths } from '../src/config/validate.js';
import { ConfigManager } from '../src/config/index.js';
import { Store } from '../src/lib/store.js';
import { has } from '../src/i18n/index.js';

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
