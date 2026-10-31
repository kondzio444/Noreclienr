'use strict';
/*
 * Config files as simple forms: TOML (Forge / NeoForge / many Fabric mods), .properties (server,
 * some mods), JSON (most Fabric mods; JSON with comments falls back to the text editor) and
 * Forge's old .cfg. Parsing keeps every line, so saving a form changes only the edited values and
 * leaves comments, order and formatting alone. Pure functions – no file system here.
 *
 * Field: { key, section, name, type: 'bool'|'int'|'float'|'string'|'array'|'raw', value, line, comment }.
 */

const FORMATS = { toml: 'toml', properties: 'properties', json: 'json', json5: 'json', cfg: 'cfg', txt: 'properties' };

function formatOf(file) {
  const ext = String(file).toLowerCase().split('.').pop();
  return FORMATS[ext] || null;
}

// ------------------------------------------------------------------ TOML (the subset configs use)

/** Splits "value # comment" while respecting quoted strings. */
function splitComment(s) {
  let q = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === '\\' && q === '"') i++; else if (c === q) q = null; continue; }
    if (c === '"' || c === "'") q = c;
    else if (c === '#') return [s.slice(0, i).trimEnd(), s.slice(i)];
  }
  return [s.trimEnd(), ''];
}

/** Parses one TOML value (string, number, bool, inline array of those). */
function tomlValue(raw) {
  const v = raw.trim();
  if (v === 'true' || v === 'false') return { type: 'bool', value: v === 'true' };
  if (/^[+-]?\d[\d_]*$/.test(v)) return { type: 'int', value: Number(v.replace(/_/g, '')) };
  if (/^[+-]?(\d[\d_]*)?\.\d+([eE][+-]?\d+)?$|^[+-]?\d+[eE][+-]?\d+$|^[+-]?\d+\.\d*$/.test(v)) return { type: 'float', value: Number(v.replace(/_/g, '')) };
  if (/^"(?:[^"\\]|\\.)*"$/.test(v)) return { type: 'string', value: JSON.parse(v.replace(/\\'/g, "'")) };
  if (/^'[^']*'$/.test(v)) return { type: 'string', value: v.slice(1, -1) };
  if (v.startsWith('[') && v.endsWith(']')) {
    const inner = v.slice(1, -1).trim();
    if (!inner) return { type: 'array', value: [] };
    const items = [];
    let q = null, cur = '', depth = 0;
    for (const c of inner) {
      if (q) { cur += c; if (c === q) q = null; continue; }
      if (c === '"' || c === "'") { q = c; cur += c; continue; }
      if (c === '[') depth++;
      if (c === ']') depth--;
      if (c === ',' && depth === 0) { items.push(cur); cur = ''; continue; }
      cur += c;
    }
    if (cur.trim()) items.push(cur);
    const vals = items.map(i => tomlValue(i));
    if (vals.every(x => x.type !== 'raw' && x.type !== 'array')) return { type: 'array', value: vals.map(x => x.value) };
  }
  return { type: 'raw', value: v };
}

function tomlFormat(type, value) {
  if (type === 'bool') return value ? 'true' : 'false';
  if (type === 'int') return String(Math.trunc(Number(value) || 0));
  if (type === 'float') { const n = Number(value) || 0; return Number.isInteger(n) ? n.toFixed(1) : String(n); }
  if (type === 'string') return JSON.stringify(String(value));
  if (type === 'array') return '[' + (Array.isArray(value) ? value : []).map(v => (typeof v === 'string' ? JSON.stringify(v) : String(v))).join(', ') + ']';
  return String(value);
}

/** Text → { lines, fields, tables } where tables = [{ name, array, values: { key: value } }]. */
function parseToml(text) {
  const lines = String(text).split(/\r?\n/);
  const fields = [], tables = [{ name: '', array: false, values: {} }];
  let section = '', comment = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].trim();
    if (!l) { comment = []; continue; }
    if (l.startsWith('#')) { comment.push(l.replace(/^#+\s?/, '')); continue; }
    let m = /^\[\[\s*([^\]]+?)\s*\]\]/.exec(l);
    if (m) { section = m[1]; tables.push({ name: section, array: true, values: {} }); comment = []; continue; }
    m = /^\[\s*([^\]]+?)\s*\]/.exec(l);
    if (m) { section = m[1]; tables.push({ name: section, array: false, values: {} }); comment = []; continue; }
    m = /^("(?:[^"\\]|\\.)*"|'[^']*'|[A-Za-z0-9_.-]+)\s*=\s*(.*)$/.exec(l);
    if (!m) { comment = []; continue; }
    let [valuePart] = splitComment(m[2]);
    let end = i;
    // multi-line arrays / strings: join until brackets balance
    if (valuePart.startsWith('[') && !balanced(valuePart)) {
      while (end + 1 < lines.length && !balanced(valuePart)) { end++; valuePart += ' ' + splitComment(lines[end].trim())[0]; }
    } else if (valuePart.startsWith('"""') || valuePart.startsWith("'''")) {
      const d = valuePart.slice(0, 3);
      while (end + 1 < lines.length && valuePart.indexOf(d, 3) < 0) { end++; valuePart += '\n' + lines[end]; }
    }
    const name = m[1].replace(/^["']|["']$/g, '');
    const parsed = valuePart.startsWith('"""') || valuePart.startsWith("'''") ? { type: 'raw', value: valuePart } : tomlValue(valuePart.replace(/,\s*\]$/, ']'));
    tables[tables.length - 1].values[name] = parsed.value;
    fields.push({ key: section ? `${section}.${name}` : name, section, name, type: parsed.type, value: parsed.value, line: i, endLine: end, comment: comment.join('\n') });
    comment = [];
    i = end;
  }
  return { lines, fields, tables };
}

function balanced(s) {
  let depth = 0, q = null;
  for (const c of s) {
    if (q) { if (c === q) q = null; continue; }
    if (c === '"' || c === "'") q = c;
    else if (c === '[') depth++;
    else if (c === ']') depth--;
  }
  return depth <= 0;
}

// ------------------------------------------------------------------ .properties / .cfg

/** server.properties style: key=value (also key: value), # and ! comments, \ escapes. */
function parseProperties(text) {
  const lines = String(text).split(/\r?\n/);
  const fields = [];
  let comment = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].trim();
    if (!l) { comment = []; continue; }
    if (l.startsWith('#') || l.startsWith('!')) { comment.push(l.replace(/^[#!]+\s?/, '')); continue; }
    const m = /^((?:\\.|[^=:\s])+)\s*[=:]\s*(.*)$/.exec(lines[i].replace(/^\s+/, '')) || /^((?:\\.|[^=:\s])+)\s*$/.exec(l);
    if (!m) continue;
    const name = m[1].replace(/\\(.)/g, '$1');
    const raw = unescapeProp(m[2] || '');
    fields.push({ key: name, section: '', name, type: guessType(raw), value: typed(raw), line: i, endLine: i, comment: comment.join('\n') });
    comment = [];
  }
  return { lines, fields };
}

function unescapeProp(v) {
  return v.replace(/\\u([0-9a-fA-F]{4})/g, (x, h) => String.fromCharCode(parseInt(h, 16))).replace(/\\([:=#!\\ ])/g, '$1').replace(/\\n/g, '\n').replace(/\\t/g, '\t');
}

function escapeProp(v) {
  return String(v).replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/[^\x20-\x7e]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
}

function guessType(raw) {
  if (raw === 'true' || raw === 'false') return 'bool';
  if (/^-?\d+$/.test(raw) && raw.length < 16) return 'int';
  if (/^-?\d+\.\d+$/.test(raw)) return 'float';
  return 'string';
}

function typed(raw) {
  const t = guessType(raw);
  return t === 'bool' ? raw === 'true' : t === 'int' || t === 'float' ? Number(raw) : raw;
}

/** Forge 1.12 .cfg: "category {", "B:name=true", "I:count=5", "S:text=abc", "}". */
function parseCfg(text) {
  const lines = String(text).split(/\r?\n/);
  const fields = [];
  const stack = [];
  let comment = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].trim();
    if (!l) { comment = []; continue; }
    if (l.startsWith('#')) { comment.push(l.replace(/^#+\s?/, '')); continue; }
    let m = /^"?([^"{]+?)"?\s*\{$/.exec(l);
    if (m) { stack.push(m[1].trim()); comment = []; continue; }
    if (l === '}') { stack.pop(); continue; }
    m = /^([BIDS]):"?([^"=]+)"?=(.*)$/.exec(l);
    if (!m) continue;
    const type = { B: 'bool', I: 'int', D: 'float', S: 'string' }[m[1]];
    const value = type === 'bool' ? m[3].trim() === 'true' : type === 'string' ? m[3] : Number(m[3]);
    const section = stack.join('.');
    fields.push({ key: section ? `${section}.${m[2]}` : m[2], section, name: m[2], type, value, line: i, endLine: i, comment: comment.join('\n'), prefix: m[1] });
    comment = [];
  }
  return { lines, fields };
}

// ------------------------------------------------------------------ JSON

/** Strict JSON only (comments make it a text-only file); nested objects flatten to dotted keys. */
function parseJson(text) {
  let data;
  try { data = JSON.parse(text); } catch { return null; }
  const fields = [];
  const walk = (obj, prefix) => {
    for (const [k, v] of Object.entries(obj)) {
      const key = prefix ? `${prefix}.${k}` : k;
      if (v && typeof v === 'object' && !Array.isArray(v)) walk(v, key);
      else {
        const type = typeof v === 'boolean' ? 'bool' : typeof v === 'number' ? (Number.isInteger(v) ? 'int' : 'float') : typeof v === 'string' ? 'string'
          : Array.isArray(v) && v.every(x => x === null || typeof x !== 'object') ? 'array' : 'raw';
        fields.push({ key, section: prefix, name: k, type, value: type === 'raw' ? JSON.stringify(v) : v, path: prefix ? [...prefix.split('.'), k] : [k], comment: '' });
      }
    }
  };
  if (data && typeof data === 'object' && !Array.isArray(data)) walk(data, '');
  return { data, fields };
}

// ------------------------------------------------------------------ public API

/** Text → { format, fields, editable } (editable false = show only the raw text editor). */
function parse(file, text) {
  const format = formatOf(file);
  if (format === 'toml') { const r = parseToml(text); return { format, fields: r.fields, editable: r.fields.length > 0 }; }
  if (format === 'properties') { const r = parseProperties(text); return { format, fields: r.fields, editable: r.fields.length > 0 }; }
  if (format === 'cfg') { const r = parseCfg(text); return { format, fields: r.fields, editable: r.fields.length > 0 }; }
  if (format === 'json') { const r = parseJson(text); return r ? { format, fields: r.fields, editable: r.fields.length > 0 } : { format, fields: [], editable: false }; }
  return { format: null, fields: [], editable: false };
}

/** Coerces a form value to the field's type (strings from inputs → numbers / booleans). */
function coerce(type, v) {
  if (type === 'bool') return v === true || v === 'true' || v === 'on';
  if (type === 'int') { const n = parseInt(v, 10); return Number.isFinite(n) ? n : 0; }
  if (type === 'float') { const n = parseFloat(String(v).replace(',', '.')); return Number.isFinite(n) ? n : 0; }
  if (type === 'array') {
    if (Array.isArray(v)) return v;
    try { const j = JSON.parse(v); if (Array.isArray(j)) return j; } catch { /* comma list */ }
    return String(v).split(',').map(s => s.trim()).filter(Boolean);
  }
  return String(v);
}

/** Applies { key: newValue } to the text, changing only those values. */
function apply(file, text, changes) {
  const format = formatOf(file);
  const keys = Object.keys(changes || {});
  if (!keys.length) return text;
  const eol = /\r\n/.test(text) ? '\r\n' : '\n';
  if (format === 'json') {
    const r = parseJson(text);
    if (!r) throw new Error('Ten plik JSON ma komentarze – edytuj go jako tekst.');
    for (const f of r.fields) {
      if (!(f.key in changes)) continue;
      let o = r.data;
      for (const p of f.path.slice(0, -1)) o = o[p];
      o[f.path[f.path.length - 1]] = f.type === 'raw' ? JSON.parse(changes[f.key]) : coerce(f.type, changes[f.key]);
    }
    const indent = (/\n(\s+)"/.exec(text) || [])[1] || '  ';
    return JSON.stringify(r.data, null, indent.includes('\t') ? '\t' : indent.length) + (text.endsWith('\n') ? '\n' : '');
  }
  const parsed = format === 'toml' ? parseToml(text) : format === 'cfg' ? parseCfg(text) : parseProperties(text);
  const lines = parsed.lines.slice();
  // replace from the bottom so multi-line values keep the indexes above valid
  const edits = parsed.fields.filter(f => f.key in changes).sort((a, b) => b.line - a.line);
  for (const f of edits) {
    const v = changes[f.key];
    const line = lines[f.line];
    const indent = (/^\s*/.exec(line) || [''])[0];
    if (format === 'toml') {
      const [, trailing] = splitComment(lines[f.endLine].replace(/^[^=]*=/, ''));
      const keyPart = (/^[^=]*=[ \t]*/.exec(line) || [indent + f.name + ' = '])[0];
      const val = f.type === 'raw' ? String(v) : tomlFormat(f.type, coerce(f.type, v));
      lines.splice(f.line, f.endLine - f.line + 1, `${keyPart}${val}${trailing && f.endLine === f.line ? ' ' + trailing : ''}`);
    } else if (format === 'cfg') {
      const val = f.type === 'bool' ? String(coerce('bool', v)) : String(coerce(f.type, v));
      lines[f.line] = line.replace(/=.*$/, '=' + val);
    } else {
      const m = /^(\s*(?:\\.|[^=:\s])+\s*[=:]\s*)/.exec(line);
      const val = f.type === 'bool' ? String(coerce('bool', v)) : escapeProp(f.type === 'string' ? String(v) : coerce(f.type, v));
      lines[f.line] = (m ? m[1] : indent + f.name + '=') + val;
    }
  }
  // properties may get new keys (server.properties written before the first start)
  if (format === 'properties') {
    const have = new Set(parsed.fields.map(f => f.key));
    const add = keys.filter(k => !have.has(k));
    if (add.length) {
      while (lines.length && lines[lines.length - 1] === '') lines.pop();
      for (const k of add) lines.push(`${k}=${typeof changes[k] === 'string' ? escapeProp(changes[k]) : String(changes[k])}`);
      lines.push('');
    }
  }
  return lines.join(eol);
}

module.exports = { formatOf, parse, apply, coerce, parseToml, parseProperties, parseCfg, parseJson, tomlValue, tomlFormat, escapeProp, unescapeProp };
