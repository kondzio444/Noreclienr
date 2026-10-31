'use strict';
/*
 * server.properties as a form: parse / serialize that keeps comments and unknown keys, the form
 * schema (labels, types, limits), validation, warnings (online-mode off, open whitelist…) and the
 * MOTD colour codes (§ / &) turned into coloured segments for a preview. Pure – no file system.
 */
const cfg = require('./config-edit');

/** Form fields in display order. type: bool | int | enum | string | motd. */
const SCHEMA = [
  { key: 'motd', label: 'MOTD (opis na liście serwerów)', type: 'motd', group: 'general', max: 120 },
  { key: 'max-players', label: 'Maks. graczy', type: 'int', min: 1, max: 1000, group: 'general' },
  { key: 'gamemode', label: 'Tryb gry', type: 'enum', options: [['survival', 'Przetrwanie'], ['creative', 'Kreatywny'], ['adventure', 'Przygoda'], ['spectator', 'Obserwator']], group: 'game' },
  { key: 'force-gamemode', label: 'Wymuszaj tryb gry przy wejściu', type: 'bool', group: 'game' },
  { key: 'difficulty', label: 'Poziom trudności', type: 'enum', options: [['peaceful', 'Pokojowy'], ['easy', 'Łatwy'], ['normal', 'Normalny'], ['hard', 'Trudny']], group: 'game' },
  { key: 'hardcore', label: 'Hardcore', type: 'bool', group: 'game' },
  { key: 'pvp', label: 'PvP (walka między graczami)', type: 'bool', group: 'game' },
  { key: 'allow-flight', label: 'Zezwól na latanie (mody, elytra-glitche)', type: 'bool', group: 'game' },
  { key: 'spawn-protection', label: 'Ochrona spawnu (bloki)', type: 'int', min: 0, max: 1000, def: 16, group: 'game' },
  { key: 'allow-nether', label: 'Nether', type: 'bool', def: true, group: 'world' },
  { key: 'generate-structures', label: 'Generuj struktury', type: 'bool', def: true, group: 'world' },
  { key: 'level-seed', label: 'Seed świata', type: 'string', group: 'world' },
  { key: 'level-type', label: 'Typ świata', type: 'enum', options: [['minecraft:normal', 'Normalny'], ['minecraft:flat', 'Płaski'], ['minecraft:large_biomes', 'Duże biomy'], ['minecraft:amplified', 'Wzmocniony']], group: 'world' },
  { key: 'view-distance', label: 'Zasięg widzenia (chunki)', type: 'int', min: 3, max: 32, group: 'perf' },
  { key: 'simulation-distance', label: 'Zasięg symulacji (chunki)', type: 'int', min: 3, max: 32, group: 'perf' },
  { key: 'entity-broadcast-range-percentage', label: 'Zasięg widoczności mobów (%)', type: 'int', min: 10, max: 1000, def: 100, group: 'perf' },
  { key: 'max-tick-time', label: 'Watchdog: maks. czas ticku (ms, -1 = wył.)', type: 'int', min: -1, max: 600000, def: 60000, group: 'perf' },
  { key: 'online-mode', label: 'Tylko konta premium (online-mode)', type: 'bool', group: 'access' },
  { key: 'white-list', label: 'Biała lista', type: 'bool', group: 'access' },
  { key: 'enforce-whitelist', label: 'Wyrzucaj spoza białej listy po jej włączeniu', type: 'bool', group: 'access' },
  { key: 'enable-command-block', label: 'Bloki poleceń', type: 'bool', group: 'access' },
  { key: 'resource-pack', label: 'Paczka zasobów serwera (URL .zip)', type: 'string', group: 'access' },
  { key: 'require-resource-pack', label: 'Wymagaj paczki zasobów', type: 'bool', group: 'access' },
];

const GROUPS = { general: 'Ogólne', game: 'Rozgrywka', world: 'Świat', perf: 'Wydajność', access: 'Dostęp i bezpieczeństwo' };

const field = (k) => SCHEMA.find(f => f.key === k);

/** Text → plain { key: string } map (values unescaped). */
function parse(text) {
  const out = {};
  for (const f of cfg.parseProperties(text || '').fields) out[f.key] = typeof f.value === 'string' ? f.value : String(f.value);
  return out;
}

/** Writes props into existing text, keeping comments and unknown keys. */
function serialize(text, props) {
  const changes = {};
  for (const [k, v] of Object.entries(props)) changes[k] = typeof v === 'boolean' || typeof v === 'number' ? String(v) : v == null ? '' : String(v);
  // string fields always as strings: "true" in a MOTD must not become a boolean
  const base = text && text.trim() ? text : '#Minecraft server properties\n';
  return withStrings(base, changes);
}

function withStrings(text, changes) {
  const parsed = cfg.parseProperties(text);
  const lines = parsed.lines.slice();
  const have = new Map(parsed.fields.map(f => [f.key, f]));
  for (const [k, v] of Object.entries(changes)) {
    const f = have.get(k);
    const val = cfg.escapeProp(v);
    if (f) {
      const m = /^(\s*(?:\\.|[^=:\s])+\s*[=:]\s*)/.exec(lines[f.line]);
      lines[f.line] = (m ? m[1] : `${k}=`) + val;
    }
  }
  const add = Object.keys(changes).filter(k => !have.has(k));
  if (add.length) {
    while (lines.length && lines[lines.length - 1] === '') lines.pop();
    for (const k of add) lines.push(`${k}=${cfg.escapeProp(changes[k])}`);
  }
  while (lines.length && lines[lines.length - 1] === '') lines.pop();
  return lines.join('\n') + '\n';
}

/** Form value → stored value with limits applied; returns { value, error }. */
function validate(key, value) {
  const f = field(key);
  if (!f) return { value: String(value) };
  if (f.type === 'bool') return { value: value === true || value === 'true' };
  if (f.type === 'int') {
    const n = parseInt(value, 10);
    if (!Number.isFinite(n)) return { value: null, error: `${f.label}: podaj liczbę` };
    if (n < f.min || n > f.max) return { value: Math.min(f.max, Math.max(f.min, n)), error: `${f.label}: zakres ${f.min}–${f.max}` };
    return { value: n };
  }
  if (f.type === 'enum') {
    const ok = f.options.some(o => o[0] === value);
    return ok ? { value } : { value: f.options[0][0], error: `${f.label}: nieznana wartość` };
  }
  if (f.type === 'motd') return { value: String(value).replace(/&([0-9a-fk-or])/gi, '§$1').replace(/\\n/g, '\n').split(/\r?\n/).slice(0, 2).join('\n').slice(0, 300) };
  return { value: String(value) };
}

/** Warnings shown above the form. */
function warnings(props) {
  const p = (k) => String(props[k] ?? '');
  const out = [];
  if (p('online-mode') === 'false') out.push({ level: 'warn', key: 'online-mode', text: 'Tryb offline: każdy może wejść pod dowolnym nickiem (także adminów). Włącz białą listę albo plugin logowania (np. AuthMe), jeśli serwer jest publiczny.' });
  if (p('online-mode') === 'true') out.push({ level: 'info', key: 'online-mode', text: 'Tylko konta premium – gracze non-premium nie wejdą na serwer.' });
  if (p('white-list') === 'true' && p('enforce-whitelist') !== 'true') out.push({ level: 'info', key: 'enforce-whitelist', text: 'Gracze spoza białej listy, którzy są już online, zostaną do wyjścia – włącz „Wyrzucaj spoza białej listy”.' });
  const vd = parseInt(p('view-distance'), 10), sd = parseInt(p('simulation-distance'), 10);
  if (vd > 16) out.push({ level: 'warn', key: 'view-distance', text: `Zasięg widzenia ${vd} mocno obciąża serwer – 8–12 wystarcza większości serwerów.` });
  if (sd > vd && vd) out.push({ level: 'info', key: 'simulation-distance', text: 'Zasięg symulacji większy niż zasięg widzenia nic nie daje.' });
  if (p('enable-command-block') === 'true' && p('online-mode') === 'false') out.push({ level: 'info', key: 'enable-command-block', text: 'Bloki poleceń na serwerze offline – pilnuj, kto ma OP.' });
  return out;
}

// ------------------------------------------------------------------ MOTD colours

const COLORS = {
  0: '#000000', 1: '#0000aa', 2: '#00aa00', 3: '#00aaaa', 4: '#aa0000', 5: '#aa00aa', 6: '#ffaa00', 7: '#aaaaaa',
  8: '#555555', 9: '#5555ff', a: '#55ff55', b: '#55ffff', c: '#ff5555', d: '#ff55ff', e: '#ffff55', f: '#ffffff',
};

/**
 * MOTD → lines of segments [{ text, color, bold, italic, underline, strike, obfuscated }]. Accepts
 * §-codes, &-codes, § escapes, "\n" line breaks and &#rrggbb hex colours (Paper).
 */
function motdSegments(motd) {
  const src = String(motd || '').replace(/\\u00a7/gi, '§').replace(/\\n/g, '\n');
  const lines = [];
  for (const line of src.split('\n').slice(0, 2)) {
    const segs = [];
    let st = { color: COLORS[7], bold: false, italic: false, underline: false, strike: false, obfuscated: false };
    let buf = '';
    const flush = () => { if (buf) segs.push({ text: buf, ...st }); buf = ''; };
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if ((c === '§' || c === '&') && i + 1 < line.length) {
        const hex = /^#([0-9a-f]{6})/i.exec(line.slice(i + 1));
        if (hex) { flush(); st = { ...st, color: '#' + hex[1].toLowerCase(), bold: false, italic: false, underline: false, strike: false, obfuscated: false }; i += 7; continue; }
        const code = line[i + 1].toLowerCase();
        if (COLORS[code]) { flush(); st = { color: COLORS[code], bold: false, italic: false, underline: false, strike: false, obfuscated: false }; i++; continue; }
        const fmt = { l: 'bold', o: 'italic', n: 'underline', m: 'strike', k: 'obfuscated' }[code];
        if (fmt) { flush(); st = { ...st, [fmt]: true }; i++; continue; }
        if (code === 'r') { flush(); st = { color: COLORS[7], bold: false, italic: false, underline: false, strike: false, obfuscated: false }; i++; continue; }
      }
      buf += c;
    }
    flush();
    lines.push(segs);
  }
  return lines;
}

/** Plain text of a MOTD (codes removed) – for length limits and tooltips. */
function motdPlain(motd) {
  return motdSegments(motd).map(l => l.map(s => s.text).join('')).join('\n');
}

module.exports = { SCHEMA, GROUPS, parse, serialize, validate, warnings, motdSegments, motdPlain, COLORS };
