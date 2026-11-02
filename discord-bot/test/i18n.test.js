import { test } from 'node:test';
import assert from 'node:assert/strict';
import { t, keysOf, normalizeLang, localizations, translator, LANGUAGES, has } from '../src/i18n/index.js';

test('only Polish and English are supported', () => {
  assert.deepEqual(LANGUAGES, ['pl', 'en']);
});

test('pl and en have identical key sets', () => {
  const pl = new Set(keysOf('pl'));
  const en = new Set(keysOf('en'));
  assert.ok(pl.size > 1000, `pl has ${pl.size} keys`);
  assert.deepEqual([...en].filter(k => !pl.has(k)), [], 'keys missing in pl');
  assert.deepEqual([...pl].filter(k => !en.has(k)), [], 'keys missing in en');
});

test('placeholders match between pl and en', () => {
  const vars = (s) => (typeof s === 'string' ? [...s.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort().join(',') : '');
  const bad = [];
  for (const k of keysOf('en')) {
    const a = t('en', k, null), b = t('pl', k, null);
    if (vars(a) !== vars(b)) bad.push(k);
  }
  assert.deepEqual(bad, []);
});

test('Polish texts use diacritics', () => {
  assert.match(t('pl', 'errors.generic'), /poszło/);
  assert.match(t('pl', 'tpl.ch.announcements'), /ogłoszenia/);
});

test('interpolation and fallback', () => {
  assert.equal(t('en', 'errors.cooldown', { seconds: 3 }), 'Slow down! Try again in 3 s.');
  assert.equal(t('de', 'errors.cooldown', { seconds: 3 }), t('pl', 'errors.cooldown', { seconds: 3 }), 'unsupported language → default (pl)');
  assert.equal(t('pl', 'does.not.exist'), 'does.not.exist');
  assert.equal(t('en', 'errors.cooldown', {}), 'Slow down! Try again in {seconds} s.', 'missing vars stay visible');
});

test('Polish plurals', () => {
  assert.equal(t('pl', 'mod.purged', { count: 1 }), 'Usunięto 1 wiadomość.');
  assert.equal(t('pl', 'give.entries', { count: 3 }), '3 zgłoszenia');
  assert.equal(t('pl', 'give.entries', { count: 5 }), '5 zgłoszeń');
  assert.equal(t('en', 'give.entries', { count: 1 }), '1 entry');
});

test('Discord locales map to our languages', () => {
  assert.equal(normalizeLang('en-US'), 'en');
  assert.equal(normalizeLang('en-GB'), 'en');
  assert.equal(normalizeLang('pl'), 'pl');
  assert.equal(normalizeLang('de'), null);
  const loc = localizations('cmd.ping.desc');
  assert.deepEqual(Object.keys(loc).sort(), ['en-GB', 'en-US', 'pl']);
  assert.equal(translator('fr').lang, 'pl');
  assert.ok(has('en', 'panel.general._label', { exact: true }));
});
