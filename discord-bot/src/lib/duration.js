/**
 * Durations typed by people: "10m", "1h30m", "2d", "1w", "90" (minutes), "1h 15m", "30s".
 * Also accepts Polish/German style unit letters where they do not clash (g = godzina, t = tydzień).
 */
const UNITS = {
  s: 1000, sec: 1000, sek: 1000,
  m: 60_000, min: 60_000,
  h: 3_600_000, g: 3_600_000, godz: 3_600_000, std: 3_600_000,
  d: 86_400_000, day: 86_400_000, dni: 86_400_000, dzień: 86_400_000, tag: 86_400_000,
  w: 604_800_000, t: 604_800_000, tydz: 604_800_000, wk: 604_800_000,
  mo: 2_592_000_000, mies: 2_592_000_000,
  y: 31_536_000_000, r: 31_536_000_000,
};

/** @returns {number|null} milliseconds, or null when the text is not a duration */
export function parseDuration(input, { defaultUnit = 'm' } = {}) {
  if (input === null || input === undefined) return null;
  const text = String(input).trim().toLowerCase().replace(/,/g, '.');
  if (!text) return null;
  if (/^\d+(\.\d+)?$/.test(text)) return Math.round(parseFloat(text) * UNITS[defaultUnit]);
  const re = /(\d+(?:\.\d+)?)\s*([a-ząćęłńóśźż]+)/g;
  let total = 0, matched = '', m;
  while ((m = re.exec(text))) {
    const unit = UNITS[m[2]] ?? UNITS[m[2].replace(/s$/, '')];
    if (!unit) return null;
    total += parseFloat(m[1]) * unit;
    matched += m[0];
  }
  if (!matched || matched.replace(/\s/g, '') !== text.replace(/\s/g, '')) return null;
  return Math.round(total);
}

/** Compact, language-neutral form: 1d 2h 5m */
export function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return '0s';
  const parts = [];
  const d = Math.floor(ms / 86_400_000); ms %= 86_400_000;
  const h = Math.floor(ms / 3_600_000); ms %= 3_600_000;
  const m = Math.floor(ms / 60_000); ms %= 60_000;
  const s = Math.floor(ms / 1000);
  if (d) parts.push(`${d}d`);
  if (h) parts.push(`${h}h`);
  if (m) parts.push(`${m}m`);
  if (s && !d && !h) parts.push(`${s}s`);
  return parts.join(' ') || '0s';
}

/** Discord timestamp markup, rendered in every client's own language and time zone. */
export const ts = (ms, style = 'R') => `<t:${Math.floor(ms / 1000)}:${style}>`;
