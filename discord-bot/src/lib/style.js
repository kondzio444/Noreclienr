/**
 * Builder looks: how the names of categories, channels and roles are written and which colours the
 * roles get. Pure (no Discord), shared by the builder, the tests and the website panel preview
 * (the same rules are mirrored in web/public/panel/panel.js → builderPreview).
 *
 * style = {
 *   font:      plain | bold | sans | italic | smallcaps | script | double | mono | wide
 *   separator: bar | dot | line | arrow | thin | colon | bullet | none   (between emoji and name)
 *   emoji:     true | false   (emoji in front of category / channel names)
 *   category:  plain | lines | brackets | arrows | stars | dots   (decoration of category names)
 *   upper:     true | false   (category names in capitals)
 *   role:      icon | brackets | dot | arrow | plain   (role name decoration)
 *   palette:   template | nore | neon | pastel | minecraft | ocean | sunset | halloween | mono
 * }
 * Polish letters keep their accents: the base letter is converted and the combining mark kept.
 */

export const FONTS = ['plain', 'bold', 'sans', 'italic', 'smallcaps', 'script', 'double', 'mono', 'wide'];
export const SEPARATORS = { bar: '┃', dot: '・', line: '│', arrow: '»', thin: '﹒', colon: '꞉', bullet: '•', none: '' };
export const CATEGORY_STYLES = ['plain', 'lines', 'brackets', 'arrows', 'stars', 'dots'];
export const ROLE_STYLES = ['icon', 'brackets', 'dot', 'arrow', 'plain'];

export const DEFAULT_STYLE = Object.freeze({ font: 'plain', separator: 'bar', emoji: true, category: 'plain', upper: true, role: 'icon', palette: 'template', gradient: true });

/** Start code points of the Unicode mathematical alphabets: [A, a, 0]. */
const MATH = {
  bold: [0x1d400, 0x1d41a, 0x1d7ce],
  sans: [0x1d5d4, 0x1d5ee, 0x1d7ec],
  italic: [0x1d608, 0x1d622, null],
  script: [0x1d4d0, 0x1d4ea, null],
  double: [0x1d538, 0x1d552, 0x1d7d8],
  mono: [0x1d670, 0x1d68a, 0x1d7f6],
};
/** Letters missing from the double-struck alphabet live in the Letterlike block. */
const DOUBLE_HOLES = { C: 0x2102, H: 0x210d, N: 0x2115, P: 0x2119, Q: 0x211a, R: 0x211d, Z: 0x2124 };
const SMALLCAPS = 'ᴀʙᴄᴅᴇꜰɢʜɪᴊᴋʟᴍɴᴏᴘǫʀꜱᴛᴜᴠᴡxʏᴢ';

function mapChar(ch, font) {
  const c = ch.codePointAt(0);
  const upper = c >= 65 && c <= 90, lower = c >= 97 && c <= 122, digit = c >= 48 && c <= 57;
  if (!upper && !lower && !digit) return ch;
  if (font === 'smallcaps') return lower || upper ? SMALLCAPS[(lower ? c - 97 : c - 65)] : ch;
  if (font === 'wide') return String.fromCodePoint(c + 0xfee0);
  const m = MATH[font];
  if (!m) return ch;
  if (font === 'double' && upper && DOUBLE_HOLES[ch]) return String.fromCodePoint(DOUBLE_HOLES[ch]);
  if (upper) return String.fromCodePoint(m[0] + c - 65);
  if (lower) return String.fromCodePoint(m[1] + c - 97);
  return m[2] ? String.fromCodePoint(m[2] + c - 48) : ch;
}

/** Text in a Unicode "font" (accents kept as combining marks; emoji and symbols untouched). */
export function applyFont(text, font = 'plain') {
  if (!font || font === 'plain') return String(text);
  // ł/Ł have no decomposition – keep them as they are
  return [...String(text).normalize('NFD')].map(ch => mapChar(ch, font)).join('');
}

const sepOf = (s) => (s.separator in SEPARATORS ? SEPARATORS[s.separator] : SEPARATORS.bar);

/** Merges a partial style with the defaults (unknown values fall back). */
export function normalizeStyle(style = {}) {
  const s = { ...DEFAULT_STYLE, ...(style || {}) };
  if (!FONTS.includes(s.font)) s.font = DEFAULT_STYLE.font;
  if (!(s.separator in SEPARATORS)) s.separator = DEFAULT_STYLE.separator;
  if (!CATEGORY_STYLES.includes(s.category)) s.category = DEFAULT_STYLE.category;
  if (!ROLE_STYLES.includes(s.role)) s.role = DEFAULT_STYLE.role;
  if (!(s.palette in PALETTES)) s.palette = DEFAULT_STYLE.palette;
  s.emoji = s.emoji !== false;
  s.upper = s.upper !== false;
  s.gradient = s.gradient !== false;
  return s;
}

/** Category name: "🚪 ┃ START", "━━ 🚪 START ━━", "『 START 』" … */
export function categoryName(emoji, label, style) {
  const s = normalizeStyle(style);
  const text = applyFont(s.upper ? label.toUpperCase() : label, s.font);
  const e = s.emoji && emoji ? emoji : '';
  const sep = sepOf(s);
  switch (s.category) {
    case 'lines': return `━━ ${e ? e + ' ' : ''}${text} ━━`;
    case 'brackets': return `${e ? e + ' ' : ''}『 ${text} 』`;
    case 'arrows': return `${e ? e + ' ' : ''}» ${text} «`;
    case 'stars': return `✦ ${e ? e + ' ' : ''}${text} ✦`;
    case 'dots': return `${e ? e + ' ' : ''}・${text}・`;
    default: return e ? `${e} ${sep ? sep + ' ' : ''}${text}` : text;
  }
}

/** Text / voice channel name (text channels are slugified by the caller). */
export function channelName(emoji, label, { voice = false } = {}, style) {
  const s = normalizeStyle(style);
  const text = applyFont(voice ? label : label.toLowerCase(), s.font);
  const e = s.emoji && emoji ? emoji : '';
  const sep = sepOf(s);
  if (!e) return text;
  if (voice) return `${e} ${sep ? sep + ' ' : ''}${text}`;
  return `${e}${sep}${text}`;
}

/** Role name: "👑 Owner", "『 Owner 』", "• Owner", "» Owner". */
export function roleName(icon, label, style, { prefix = true } = {}) {
  const s = normalizeStyle(style);
  const text = applyFont(label, s.font);
  switch (s.role) {
    case 'brackets': return `『 ${text} 』`;
    case 'dot': return `• ${text}`;
    case 'arrow': return `» ${text}`;
    case 'plain': return text;
    default: return icon && prefix ? `${icon} ${text}` : text;
  }
}

/** Separator role between role groups. */
export function separatorName(label, style) {
  const s = normalizeStyle(style);
  return `▬▬▬ ${applyFont(label.toUpperCase(), s.font)} ▬▬▬`;
}

// ------------------------------------------------------------------ colours

/**
 * Palettes: `staff` colours go down the staff ladder (owner first), `other` colours to the rest of
 * the coloured roles in order; pings, languages, muted and bots keep their quiet template colour.
 */
export const PALETTES = {
  template: null,
  nore: { staff: ['#ff2e88', '#f72585', '#d63aff', '#b5179e', '#9d5cff', '#8a4dff', '#7209b7', '#6a4cff', '#5a5cff', '#4361ee', '#4895ef', '#4cc9f0', '#72efdd'], other: ['#c77dff', '#e0aaff', '#9d4edd', '#ff70a6', '#70d6ff', '#ffd670', '#ff9770'] },
  neon: { staff: ['#ff0054', '#ff0099', '#ff00ff', '#cc00ff', '#9900ff', '#6600ff', '#3300ff', '#0066ff', '#00a2ff', '#00d9ff', '#00ffcc', '#00ff88', '#39ff14'], other: ['#ffea00', '#ff6d00', '#00ffff', '#ff00aa', '#76ff03', '#d500f9', '#2979ff'] },
  pastel: { staff: ['#ffadad', '#ffc2a8', '#ffd6a5', '#fdffb6', '#e4f1c5', '#caffbf', '#b5f2d3', '#9bf6ff', '#a0d2ff', '#a0c4ff', '#b8b8ff', '#bdb2ff', '#ffc6ff'], other: ['#ffd1dc', '#c1e1c1', '#aec6cf', '#fdfd96', '#cfcfc4', '#b39eb5', '#ffb347'] },
  // Minecraft chat colours (§4 §c §6 §e §2 §a §b §3 §9 §1 §d §5 §f)
  minecraft: { staff: ['#aa0000', '#ff5555', '#ffaa00', '#ffff55', '#00aa00', '#55ff55', '#55ffff', '#00aaaa', '#5555ff', '#0000aa', '#ff55ff', '#aa00aa', '#ffffff'], other: ['#ffaa00', '#55ff55', '#55ffff', '#ff55ff', '#ffff55', '#5555ff', '#ff5555'] },
  ocean: { staff: ['#03045e', '#023e8a', '#0077b6', '#0096c7', '#00b4d8', '#48cae4', '#90e0ef', '#2ec4b6', '#20a39e', '#1b998b', '#3ddc97', '#7bdff2', '#b2f7ef'], other: ['#4cc9f0', '#4895ef', '#56cfe1', '#72efdd', '#80ffdb', '#64dfdf', '#5390d9'] },
  sunset: { staff: ['#d00000', '#dc2f02', '#e85d04', '#f48c06', '#faa307', '#ffba08', '#ff7b00', '#ff8800', '#ff9500', '#ffa200', '#ffaa00', '#ffb700', '#ffd000'], other: ['#ff006e', '#fb5607', '#ffbe0b', '#8338ec', '#ff477e', '#ff7096', '#f15bb5'] },
  halloween: { staff: ['#ff6a00', '#ff7f11', '#ff9500', '#ffaa33', '#9d4edd', '#7b2cbf', '#5a189a', '#3c096c', '#8ac926', '#6a994e', '#ffbe0b', '#f48c06', '#e85d04'], other: ['#ff7518', '#7b2cbf', '#8ac926', '#ffbe0b', '#c77dff', '#ff8c42', '#9ef01a'] },
  mono: { staff: ['#ffffff', '#f1f1f1', '#e3e3e3', '#d5d5d5', '#c7c7c7', '#b9b9b9', '#ababab', '#9d9d9d', '#8f8f8f', '#818181', '#737373', '#656565', '#575757'], other: ['#e0e0e0', '#c0c0c0', '#a0a0a0', '#d8d8d8', '#b0b0b0', '#909090', '#f0f0f0'] },
};

const QUIET = /^(ping_|lang_|muted$|bots$|platform_|mode_|game_)/;

/** Colours of the compiled roles after the palette (template colours when palette = template). */
export function paletteColors(roles, staffKeys, style) {
  const p = PALETTES[normalizeStyle(style).palette];
  if (!p) return new Map();
  const out = new Map();
  let si = 0, oi = 0;
  const staff = new Set(staffKeys);
  for (const r of roles) {
    if (r.separator || QUIET.test(r.key) || /^level_/.test(r.key)) continue;
    if (staff.has(r.key)) out.set(r.key, p.staff[Math.min(si++, p.staff.length - 1)]);
    else if (r.color) out.set(r.key, p.other[oi++ % p.other.length]);
  }
  return out;
}

/** Second colour of a gradient role: the colour mixed with white (35 %). */
export function gradientEnd(hex) {
  const n = parseInt(String(hex || '').replace('#', ''), 16);
  if (!Number.isFinite(n)) return null;
  const mix = (c) => Math.round(c + (255 - c) * 0.35);
  const r = mix((n >> 16) & 255), g = mix((n >> 8) & 255), b = mix(n & 255);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}
