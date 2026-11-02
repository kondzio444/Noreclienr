/*
 * A small JSON Schema (draft 2020-12) subset for the Nore Bot configuration (src/bot-schema.json):
 * type, enum, const, properties, required, additionalProperties, items, minItems/maxItems,
 * uniqueItems, minimum/maximum (+ exclusive), minLength/maxLength, pattern, default and local $ref.
 * Unknown keywords (x-ui, x-i18n, description …) are ignored. Errors use JSON pointers.
 */

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const ptrEsc = (k) => String(k).replace(/~/g, '~0').replace(/\//g, '~1');
const MAX_ERRORS = 50;
const NAMES = { string: 'tekst', number: 'liczba', integer: 'liczba całkowita', boolean: 'true/false', object: 'obiekt', array: 'lista', null: 'null' };

function typeOf(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (typeof v === 'number') return Number.isInteger(v) ? 'integer' : 'number';
  return typeof v;
}
const typeOk = (v, t) => t === 'number' ? typeof v === 'number' && Number.isFinite(v) : t === 'integer' ? Number.isInteger(v) : typeOf(v) === t;

function resolve(schema, root) {
  let s = schema, guard = 0;
  while (s && typeof s.$ref === 'string' && guard++ < 16) {
    if (!s.$ref.startsWith('#')) return {};
    s = s.$ref.slice(1).split('/').filter(Boolean).reduce((o, k) => o && o[k.replace(/~1/g, '/').replace(/~0/g, '~')], root);
  }
  return s || {};
}

const regexCache = new Map();
function regex(p) {
  let r = regexCache.get(p);
  if (!r) { try { r = new RegExp(p, 'u'); } catch { r = null; } regexCache.set(p, r); }
  return r;
}

const deepEqual = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** Validates `value`; returns [{ path, message, keyword }] (empty = valid). */
export function validate(value, schema, root = schema) {
  const errors = [];
  walk(value, schema, '', root, errors);
  return errors;
}

function walk(v, schema, path, root, errors) {
  if (errors.length >= MAX_ERRORS || schema === true || schema == null) return;
  const add = (keyword, message) => { if (errors.length < MAX_ERRORS) errors.push({ path: path || '/', keyword, message }); };
  if (schema === false) return add('false', 'Ta wartość jest niedozwolona');
  const s = resolve(schema, root);

  if (s.type !== undefined) {
    const types = Array.isArray(s.type) ? s.type : [s.type];
    if (!types.some(t => typeOk(v, t))) return add('type', `Zły typ: oczekiwano ${types.map(t => NAMES[t] || t).join(' lub ')}`);
  }
  if (s.const !== undefined && !deepEqual(v, s.const)) add('const', `Dozwolona jest tylko wartość ${JSON.stringify(s.const)}`);
  if (Array.isArray(s.enum) && !s.enum.some(e => deepEqual(e, v))) {
    add('enum', `Niedozwolona wartość – dozwolone: ${s.enum.slice(0, 12).map(e => JSON.stringify(e)).join(', ')}${s.enum.length > 12 ? '…' : ''}`);
  }

  if (typeof v === 'number') {
    if (typeof s.minimum === 'number' && v < s.minimum) add('minimum', `Najmniej ${s.minimum}`);
    if (typeof s.maximum === 'number' && v > s.maximum) add('maximum', `Najwięcej ${s.maximum}`);
    if (typeof s.exclusiveMinimum === 'number' && v <= s.exclusiveMinimum) add('exclusiveMinimum', `Musi być większe niż ${s.exclusiveMinimum}`);
    if (typeof s.exclusiveMaximum === 'number' && v >= s.exclusiveMaximum) add('exclusiveMaximum', `Musi być mniejsze niż ${s.exclusiveMaximum}`);
  }

  if (typeof v === 'string') {
    const len = [...v].length;
    if (typeof s.minLength === 'number' && len < s.minLength) add('minLength', s.minLength === 1 ? 'Pole nie może być puste' : `Najmniej ${s.minLength} znaków`);
    if (typeof s.maxLength === 'number' && len > s.maxLength) add('maxLength', `Najwięcej ${s.maxLength} znaków`);
    if (typeof s.pattern === 'string') {
      const r = regex(s.pattern);
      if (r && !r.test(v)) add('pattern', `Zły format (wzorzec ${s.pattern})`);
    }
  }

  if (Array.isArray(v)) {
    if (typeof s.minItems === 'number' && v.length < s.minItems) add('minItems', `Najmniej ${s.minItems} elementów`);
    if (typeof s.maxItems === 'number' && v.length > s.maxItems) add('maxItems', `Najwięcej ${s.maxItems} elementów`);
    if (s.uniqueItems === true && new Set(v.map(x => JSON.stringify(x))).size !== v.length) add('uniqueItems', 'Elementy nie mogą się powtarzać');
    if (s.items !== undefined && v.length <= 10000) v.forEach((x, i) => walk(x, s.items, `${path}/${i}`, root, errors));
  }

  if (isObj(v)) {
    const props = isObj(s.properties) ? s.properties : {};
    if (Array.isArray(s.required)) for (const k of s.required) if (!(k in v)) add('required', `Brak wymaganego pola ${k}`);
    if (typeof s.minProperties === 'number' && Object.keys(v).length < s.minProperties) add('minProperties', `Najmniej ${s.minProperties} pól`);
    if (typeof s.maxProperties === 'number' && Object.keys(v).length > s.maxProperties) add('maxProperties', `Najwięcej ${s.maxProperties} pól`);
    for (const [k, x] of Object.entries(v)) {
      const p = `${path}/${ptrEsc(k)}`;
      if (Object.prototype.hasOwnProperty.call(props, k)) walk(x, props[k], p, root, errors);
      else if (s.additionalProperties === false) { if (errors.length < MAX_ERRORS) errors.push({ path: p, keyword: 'additionalProperties', message: `Nieznane pole ${k}` }); }
      else if (isObj(s.additionalProperties) || s.additionalProperties === true) walk(x, s.additionalProperties, p, root, errors);
    }
  }
}

/**
 * A copy of `value` with the schema defaults filled in: missing properties get their `default`, and
 * missing objects that have properties are created so their own defaults appear.
 */
export function applyDefaults(value, schema, root = schema) {
  const s = resolve(schema, root);
  if (value === undefined) {
    if (s.default !== undefined) return structuredClone(s.default);
    if (isObj(s.properties) && (s.type === 'object' || s.type === undefined)) value = {};
    else return undefined;
  }
  if (isObj(value) && isObj(s.properties)) {
    const out = { ...value };
    for (const [k, ps] of Object.entries(s.properties)) {
      const d = applyDefaults(out[k], ps, root);
      if (d !== undefined) out[k] = d;
    }
    return out;
  }
  if (Array.isArray(value) && isObj(s.items)) return value.map(x => applyDefaults(x, s.items, root) ?? x);
  return value;
}

/** Drops the properties a schema no longer knows (additionalProperties: false) – for stored configs read back. */
export function prune(value, schema, root = schema) {
  const s = resolve(schema, root);
  if (isObj(value) && isObj(s.properties)) {
    const out = {};
    for (const [k, x] of Object.entries(value)) {
      if (Object.prototype.hasOwnProperty.call(s.properties, k)) out[k] = prune(x, s.properties[k], root);
      else if (s.additionalProperties !== false) out[k] = x;
    }
    return out;
  }
  if (Array.isArray(value) && isObj(s.items)) return value.map(x => prune(x, s.items, root));
  return value;
}

export const defaultsOf = (schema) => applyDefaults(undefined, schema) ?? {};

/**
 * What the API hands out for a stored config: unknown fields dropped, defaults filled in, and
 * values that no longer pass the schema (it changed since they were saved) replaced by defaults.
 */
export function effectiveConfig(stored, schema) {
  const cfg = applyDefaults(prune(isObj(stored) ? stored : {}, schema), schema);
  const errors = validate(cfg, schema);
  if (!errors.length) return cfg;
  const defaults = defaultsOf(schema);
  for (const e of errors) resetAt(cfg, defaults, e.path);
  return validate(cfg, schema).length ? defaults : cfg;
}

function resetAt(cfg, defaults, path) {
  const keys = path.split('/').slice(1).map(k => k.replace(/~1/g, '/').replace(/~0/g, '~'));
  if (!keys.length) return;
  let a = cfg, d = defaults;
  for (let i = 0; i < keys.length - 1; i++) {
    if (!a || typeof a !== 'object') return;
    a = a[keys[i]];
    d = d && typeof d === 'object' ? d[keys[i]] : undefined;
  }
  if (!a || typeof a !== 'object') return;
  const last = keys[keys.length - 1];
  if (Array.isArray(a)) { a.splice(Number(last), 1); return; }
  if (d && typeof d === 'object' && last in d) a[last] = structuredClone(d[last]);
  else delete a[last];
}
