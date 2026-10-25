/**
 * Translations: locales/<lang>.json (nested objects, dotted keys), `{var}` placeholders and plurals
 * via Intl.PluralRules ({ "one": "…", "few": "…", "many": "…", "other": "…" } with a `count` var).
 *
 * Fallback chain for a key: requested language → English → Polish (default) → the key itself.
 * Polish is the bot's default language for guilds; English is the base for Discord's
 * command definitions (the description shown for locales the bot does not translate).
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { ROOT } from '../lib/env.js';

export const LANGUAGES = ['pl', 'en', 'de', 'es', 'fr', 'uk', 'ru', 'cs', 'pt-BR', 'tr'];
export const DEFAULT_LANG = 'pl';
const FALLBACKS = ['en', 'pl'];

/** Our language code → Discord locale codes (command localizations). */
export const DISCORD_LOCALES = {
  pl: ['pl'],
  en: ['en-US', 'en-GB'],
  de: ['de'],
  es: ['es-ES', 'es-419'],
  fr: ['fr'],
  uk: ['uk'],
  ru: ['ru'],
  cs: ['cs'],
  'pt-BR': ['pt-BR'],
  tr: ['tr'],
};

/** Native names for language pickers. */
export const LANGUAGE_NAMES = {
  pl: 'Polski', en: 'English', de: 'Deutsch', es: 'Español', fr: 'Français', uk: 'Українська',
  ru: 'Русский', cs: 'Čeština', 'pt-BR': 'Português (Brasil)', tr: 'Türkçe',
};

const dicts = new Map();
const pluralRules = new Map();

function flatten(obj, prefix = '', out = {}) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v) && !isPluralNode(v)) flatten(v, key, out);
    else out[key] = v;
  }
  return out;
}

const PLURAL_KEYS = new Set(['zero', 'one', 'two', 'few', 'many', 'other']);
function isPluralNode(v) {
  const keys = Object.keys(v);
  return keys.length > 0 && keys.includes('other') && keys.every(k => PLURAL_KEYS.has(k));
}

export function loadLocales(dir = path.join(ROOT, 'locales')) {
  dicts.clear();
  for (const file of readdirSync(dir).filter(f => f.endsWith('.json'))) {
    const lang = file.slice(0, -5);
    dicts.set(lang, flatten(JSON.parse(readFileSync(path.join(dir, file), 'utf8'))));
  }
  // builder template texts live in locales/templates/<lang>.json (merged under "tpl.")
  const tplDir = path.join(dir, 'templates');
  let files = [];
  try { files = readdirSync(tplDir).filter(f => f.endsWith('.json')); } catch { /* none */ }
  for (const file of files) {
    const lang = file.slice(0, -5);
    const d = dicts.get(lang) || {};
    Object.assign(d, flatten(JSON.parse(readFileSync(path.join(tplDir, file), 'utf8')), 'tpl'));
    dicts.set(lang, d);
  }
  return dicts;
}

function dict(lang) {
  if (!dicts.size) loadLocales();
  return dicts.get(lang);
}

/** Normalizes a Discord locale or a free-form code to one of LANGUAGES (or null). */
export function normalizeLang(code) {
  if (!code) return null;
  if (LANGUAGES.includes(code)) return code;
  const lower = String(code).toLowerCase();
  if (lower === 'pt-br' || lower === 'pt') return 'pt-BR';
  const base = lower.split('-')[0];
  return LANGUAGES.includes(base) ? base : null;
}

function plural(lang, count) {
  let r = pluralRules.get(lang);
  if (!r) { r = new Intl.PluralRules(lang); pluralRules.set(lang, r); }
  return r.select(count);
}

function interpolate(str, vars) {
  if (!vars) return str;
  return str.replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined && vars[k] !== null ? String(vars[k]) : m));
}

/** Raw lookup without interpolation; returns undefined when no language has it. */
export function lookup(lang, key) {
  const chain = [normalizeLang(lang) || DEFAULT_LANG, ...FALLBACKS];
  for (const l of chain) {
    const d = dict(l);
    if (d && d[key] !== undefined) return { value: d[key], lang: l };
  }
  return undefined;
}

export function has(lang, key, { exact = false } = {}) {
  if (exact) { const d = dict(normalizeLang(lang)); return !!d && d[key] !== undefined; }
  return lookup(lang, key) !== undefined;
}

/** Translate `key` into `lang` with `{var}` interpolation. */
export function t(lang, key, vars) {
  const hit = lookup(lang, key);
  if (!hit) return key;
  let v = hit.value;
  if (v && typeof v === 'object') {
    const n = Number(vars?.count ?? 0);
    v = v[plural(hit.lang, n)] ?? v.other;
  }
  return interpolate(String(v), vars);
}

/** Bound translator: const tr = translator('de'); tr('help.title') */
export function translator(lang) {
  const l = normalizeLang(lang) || DEFAULT_LANG;
  const fn = (key, vars) => t(l, key, vars);
  fn.lang = l;
  return fn;
}

/**
 * Discord localization map for a key: { pl: '…', 'en-US': '…', de: '…' … }.
 * Only languages that really define the key are included (no fallbacks), values are trimmed to `max`.
 */
export function localizations(key, { max = 100, transform } = {}) {
  const out = {};
  for (const lang of LANGUAGES) {
    const d = dict(lang);
    if (!d || d[key] === undefined) continue;
    let v = String(d[key]);
    if (transform) v = transform(v);
    v = v.slice(0, max);
    for (const loc of DISCORD_LOCALES[lang]) out[loc] = v;
  }
  return out;
}

/** All keys of a language (for completeness tests). */
export function keysOf(lang) { return Object.keys(dict(lang) || {}); }

/** Formats a number for a language. */
export function num(lang, n, opts) {
  try { return new Intl.NumberFormat(normalizeLang(lang) || DEFAULT_LANG, opts).format(n); } catch { return String(n); }
}
