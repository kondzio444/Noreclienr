/**
 * Validation of configs against config.schema.json – a small, dependency-free implementation of the
 * JSON Schema subset the schema uses: type, enum, minimum, maximum, minLength, maxLength, pattern,
 * maxItems, items, properties, additionalProperties:false. Errors carry JSON pointers like the API's
 * 400 responses ("/welcome/channel").
 */

const typeOf = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : Number.isInteger(v) ? 'integer' : typeof v);

function typeMatches(value, type) {
  const types = Array.isArray(type) ? type : [type];
  const actual = typeOf(value);
  return types.some(t => t === actual || (t === 'number' && actual === 'integer'));
}

const esc = (k) => String(k).replace(/~/g, '~0').replace(/\//g, '~1');

const patternCache = new Map();
function re(p) {
  let r = patternCache.get(p);
  if (!r) { r = new RegExp(p, 'u'); patternCache.set(p, r); }
  return r;
}

/** @returns {{ pointer:string, message:string }[]} */
export function validate(value, schema, pointer = '') {
  const errors = [];
  const err = (message) => errors.push({ pointer: pointer || '/', message });
  if (schema.type && !typeMatches(value, schema.type)) { err(`expected ${schema.type}, got ${typeOf(value)}`); return errors; }
  if (schema.enum && !schema.enum.some(e => e === value)) err(`must be one of ${schema.enum.map(e => JSON.stringify(e)).join(', ')}`);
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) err(`must be >= ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) err(`must be <= ${schema.maximum}`);
  }
  if (typeof value === 'string') {
    const len = [...value].length;
    if (schema.minLength !== undefined && len < schema.minLength) err(`shorter than ${schema.minLength}`);
    if (schema.maxLength !== undefined && len > schema.maxLength) err(`longer than ${schema.maxLength}`);
    if (schema.pattern && !re(schema.pattern).test(value)) err(`does not match ${schema.pattern}`);
  }
  if (Array.isArray(value)) {
    if (schema.maxItems !== undefined && value.length > schema.maxItems) err(`more than ${schema.maxItems} items`);
    if (schema.items) value.forEach((v, i) => errors.push(...validate(v, schema.items, `${pointer}/${i}`)));
  }
  if (typeOf(value) === 'object' && schema.properties) {
    for (const [k, v] of Object.entries(value)) {
      const sub = schema.properties[k];
      if (!sub) { if (schema.additionalProperties === false) errors.push({ pointer: `${pointer}/${esc(k)}`, message: 'unknown property' }); continue; }
      errors.push(...validate(v, sub, `${pointer}/${esc(k)}`));
    }
  }
  return errors;
}

/** Defaults tree of a schema (objects recurse, arrays/leaves take `default`). */
export function defaultsOf(schema) {
  if (schema.type === 'object' && schema.properties) {
    const out = {};
    for (const [k, v] of Object.entries(schema.properties)) out[k] = defaultsOf(v);
    return out;
  }
  return schema.default === undefined ? null : structuredClone(schema.default);
}

/** Fills missing keys of list items (objects in arrays) with their item defaults. */
function itemDefaults(itemSchema, value) {
  if (itemSchema?.type !== 'object' || typeOf(value) !== 'object') return value;
  const out = {};
  for (const [k, sub] of Object.entries(itemSchema.properties)) {
    if (value[k] === undefined) out[k] = defaultsOf(sub);
    else if (sub.type === 'array' && sub.items?.type === 'object' && Array.isArray(value[k])) out[k] = value[k].map(v => itemDefaults(sub.items, v));
    else out[k] = value[k];
  }
  for (const [k, v] of Object.entries(value)) if (!(k in out)) out[k] = v; // left for sanitize to drop
  return out;
}

/**
 * Returns a copy of `value` where every invalid or unknown leaf is dropped (so defaults apply).
 * Invalid list items are removed one by one; a too long list is truncated.
 */
export function sanitize(value, schema) {
  if (schema.type === 'object' && schema.properties) {
    if (typeOf(value) !== 'object') return undefined;
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      const sub = schema.properties[k];
      if (!sub) continue;
      const s = sanitize(v, sub);
      if (s !== undefined) out[k] = s;
    }
    return out;
  }
  if (schema.type === 'array') {
    if (!Array.isArray(value)) return undefined;
    let items = value.map(v => itemDefaults(schema.items, v)).map(v => (schema.items ? sanitizeItem(v, schema.items) : v)).filter(v => v !== undefined);
    if (schema.maxItems !== undefined) items = items.slice(0, schema.maxItems);
    return items;
  }
  return validate(value, schema).length ? undefined : value;
}

function sanitizeItem(v, itemSchema) {
  if (itemSchema.type === 'object') {
    const s = sanitize(v, itemSchema);
    if (!s) return undefined;
    // a list item must be complete; any dropped field means the item is broken → fill default
    for (const [k, sub] of Object.entries(itemSchema.properties)) if (s[k] === undefined) s[k] = defaultsOf(sub);
    return s;
  }
  return validate(v, itemSchema).length ? undefined : v;
}

/** Deep merge for plain objects; arrays and leaves of `over` replace those of `base`. */
export function deepMerge(base, over) {
  if (typeOf(base) !== 'object' || typeOf(over) !== 'object') return over === undefined ? structuredClone(base) : structuredClone(over);
  const out = structuredClone(base);
  for (const [k, v] of Object.entries(over)) {
    if (v === undefined) continue;
    out[k] = typeOf(out[k]) === 'object' && typeOf(v) === 'object' ? deepMerge(out[k], v) : structuredClone(v);
  }
  return out;
}

/** Schema node at a dotted path ("automod.spam.maxMessages"), or null. */
export function schemaAt(schema, path) {
  let node = schema;
  for (const part of path.split('.')) {
    if (node?.type === 'object' && node.properties?.[part]) node = node.properties[part];
    else return null;
  }
  return node;
}

/** All editable leaf paths (lists count as leaves) – used for /config autocomplete. */
export function leafPaths(schema, prefix = '') {
  const out = [];
  for (const [k, v] of Object.entries(schema.properties || {})) {
    const p = prefix ? `${prefix}.${k}` : k;
    if (v.type === 'object' && v.properties) out.push(...leafPaths(v, p));
    else out.push(p);
  }
  return out;
}

export function getPath(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

export function setPath(obj, path, value) {
  const parts = path.split('.');
  let o = obj;
  for (const k of parts.slice(0, -1)) { if (typeOf(o[k]) !== 'object') o[k] = {}; o = o[k]; }
  o[parts.at(-1)] = value;
  return obj;
}

/**
 * Parses a value typed in Discord (/config set) for a schema leaf.
 * Accepts mentions (<#id>, <@&id>), "none"/"-" for empty, on/off/true/false, JSON for lists of objects.
 * @returns {{ ok:true, value } | { ok:false, error:string }}
 */
export function parseValue(node, raw) {
  const text = String(raw ?? '').trim();
  const empty = ['', '-', 'none', 'null', 'brak', 'off-'].includes(text.toLowerCase());
  const id = (s) => (/^(?:<[#@]&?!?)?(\d{17,20})>?$/.exec(s.trim()) || [])[1];
  let value;
  switch (node['x-ui']) {
    case 'toggle': {
      const on = ['on', 'true', 'yes', 'tak', '1', 'enable', 'enabled', 'włącz', 'ja', 'oui', 'sí', 'si', 'да', 'так', 'ano', 'sim', 'evet'];
      const off = ['off', 'false', 'no', 'nie', '0', 'disable', 'disabled', 'wyłącz', 'nein', 'non', 'нет', 'ні', 'ne', 'não', 'nao', 'hayır', 'hayir'];
      if (on.includes(text.toLowerCase())) value = true;
      else if (off.includes(text.toLowerCase())) value = false;
      else return { ok: false, error: 'toggle' };
      break;
    }
    case 'number':
      value = node.type === 'integer' ? parseInt(text, 10) : parseFloat(text.replace(',', '.'));
      if (!Number.isFinite(value)) return { ok: false, error: 'number' };
      break;
    case 'channel': case 'role':
      value = empty ? '' : id(text);
      if (value === undefined) return { ok: false, error: 'id' };
      break;
    case 'select':
      value = node.type === 'integer' ? parseInt(text, 10) : (empty && node.enum.includes('') ? '' : text);
      break;
    case 'color':
      value = /^#?[0-9a-f]{6}$/i.test(text) ? '#' + text.replace('#', '').toLowerCase() : text;
      break;
    case 'list':
      if (empty) value = [];
      else if (text.startsWith('[')) { try { value = JSON.parse(text); } catch { return { ok: false, error: 'json' }; } }
      else if (node.items?.type === 'object') return { ok: false, error: 'json' };
      else value = text.split(/[,\n]/).map(s => s.trim()).filter(Boolean).map(s => (node.items['x-ui'] === 'role' || node.items['x-ui'] === 'channel') ? (id(s) ?? s) : s);
      break;
    default:
      value = empty ? '' : text.replace(/\\n/g, '\n');
  }
  const errors = validate(value, node);
  return errors.length ? { ok: false, error: 'schema', details: errors } : { ok: true, value };
}
