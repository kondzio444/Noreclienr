/**
 * AutoMod rule engine – pure logic, no Discord objects (unit-tested).
 * The automod module feeds it plain message facts and executes the returned action.
 *
 * Rules (each configurable in config.automod.<rule>): badWords, invites, links, mentions, caps,
 * duplicates, spam; plus join-rate raid detection and the new-account filter.
 */

const INVITE_RE = /(?:discord(?:app)?\.com\/invite|discord\.gg|dsc\.gg|discord\.me|invite\.gg)\/([\w-]{2,})/gi;
const URL_RE = /\bhttps?:\/\/([^\s/<>?#]+)[^\s<>]*/gi;
const BARE_DOMAIN_RE = /\b((?:[a-z0-9-]+\.)+(?:com|net|org|pl|gg|io|xyz|ru|de|tk|ml|ga|cf|link|site|online|shop|app|dev|me|tv|co|info|biz|top|click))\b(?:\/[^\s]*)?/gi;

const LEET = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', 8: 'b', '@': 'a', $: 's', '!': 'i', '|': 'l' };

/** Lowercase, no diacritics, leetspeak undone, repeated letters collapsed to two. */
export function normalizeText(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/ł/g, 'l')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[0134578@$!|]/g, (c) => LEET[c] ?? c)
    .replace(/(.)\1{2,}/g, '$1$1');
}

export function findInvites(content) {
  return [...String(content || '').matchAll(INVITE_RE)].map(m => m[1]);
}

/** Domains of links in the text (scheme links and well-known bare domains). */
export function findDomains(content) {
  const text = String(content || '').replace(INVITE_RE, ' ');
  const out = new Set();
  for (const m of text.matchAll(URL_RE)) out.add(m[1].toLowerCase().replace(/^www\./, '').replace(/:\d+$/, ''));
  for (const m of text.matchAll(BARE_DOMAIN_RE)) out.add(m[1].toLowerCase().replace(/^www\./, ''));
  return [...out];
}

/** example.com allows example.com and *.example.com */
export function domainAllowed(domain, allowList) {
  const d = domain.toLowerCase();
  return (allowList || []).some((a) => {
    const x = String(a).toLowerCase().trim().replace(/^\*\./, '').replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    return x && (d === x || d.endsWith('.' + x));
  });
}

/** Bad-word match. Entries: "word" (whole word), "word*" (prefix), "*word*" (anywhere). */
export function findBadWord(content, words) {
  const norm = normalizeText(content);
  const tokens = norm.split(/[^a-z0-9а-яёіїєґ]+/i).filter(Boolean);
  const squashed = norm.replace(/[^a-z0-9а-яёіїєґ]+/gi, '');
  for (const raw of words || []) {
    const w = normalizeText(String(raw).trim());
    if (!w) continue;
    const pre = w.startsWith('*'), post = w.endsWith('*');
    const core = w.replace(/^\*|\*$/g, '');
    if (!core) continue;
    if (pre && post) { if (squashed.includes(core)) return raw; continue; }
    if (post) { if (tokens.some(t => t.startsWith(core))) return raw; continue; }
    if (pre) { if (tokens.some(t => t.endsWith(core))) return raw; continue; }
    if (tokens.includes(core)) return raw;
  }
  return null;
}

/** Share of upper-case letters (0–100) among letters, and the letter count. */
export function capsRatio(content) {
  const letters = [...String(content || '').replace(/<a?:\w+:\d+>|<[@#&!]+\d+>|https?:\/\/\S+/g, '')].filter(c => c.toLowerCase() !== c.toUpperCase());
  if (!letters.length) return { percent: 0, letters: 0 };
  const upper = letters.filter(c => c === c.toUpperCase()).length;
  return { percent: Math.round((upper / letters.length) * 100), letters: letters.length };
}

export class AutoModEngine {
  constructor() {
    this.history = new Map(); // `${guild}:${user}` -> [{ t, norm }]
    this.joins = new Map();   // guild -> [t]
  }

  /**
   * @param {object} msg { guildId, authorId, content, mentions, everyone }
   * @param {object} cfg config.automod
   * @param {number} now ms
   * @returns {null | { rule:string, action:string, detail?:string }}
   */
  check(msg, cfg, now = Date.now()) {
    if (!cfg || !cfg.enabled) return null;
    const content = String(msg.content || '');
    const key = `${msg.guildId}:${msg.authorId}`;
    const norm = normalizeText(content).trim();
    let list = this.history.get(key);
    if (!list) { list = []; this.history.set(key, list); }
    const windowMs = Math.max(1, cfg.spam?.perSeconds ?? 5) * 1000;
    const dupWindow = 60_000;
    while (list.length && now - list[0].t > Math.max(windowMs, dupWindow)) list.shift();
    list.push({ t: now, norm });
    if (list.length > 50) list.splice(0, list.length - 50);

    const hit = (rule, detail) => ({ rule, action: cfg[rule]?.action || 'delete', detail });

    if (cfg.badWords?.enabled) {
      const w = findBadWord(content, cfg.badWords.words);
      if (w) return hit('badWords', w);
    }
    if (cfg.invites?.enabled) {
      const codes = findInvites(content).filter(c => !(cfg.invites.allowed || []).map(String).map(s => s.toLowerCase()).includes(c.toLowerCase()));
      if (codes.length) return hit('invites', codes[0]);
    }
    if (cfg.links?.enabled) {
      const bad = findDomains(content).filter(d => !domainAllowed(d, cfg.links.allowList));
      if (bad.length) return hit('links', bad[0]);
    }
    if (cfg.mentions?.enabled) {
      const n = (msg.mentions || 0) + (msg.everyone ? (cfg.mentions.max ?? 5) : 0);
      if (n > (cfg.mentions.max ?? 5)) return hit('mentions', String(n));
    }
    if (cfg.caps?.enabled) {
      const { percent, letters } = capsRatio(content);
      if (letters >= (cfg.caps.minLength ?? 12) && percent >= (cfg.caps.percent ?? 70)) return hit('caps', `${percent}%`);
    }
    if (cfg.duplicates?.enabled && norm.length >= 3) {
      const same = list.filter(e => e.norm === norm && now - e.t <= dupWindow).length;
      if (same >= (cfg.duplicates.max ?? 3)) return hit('duplicates', String(same));
    }
    if (cfg.spam?.enabled) {
      const recent = list.filter(e => now - e.t <= windowMs).length;
      if (recent > (cfg.spam.maxMessages ?? 6)) return hit('spam', String(recent));
    }
    return null;
  }

  /** Records a join; returns true when the rate crosses the raid threshold. */
  recordJoin(guildId, raidCfg, now = Date.now()) {
    if (!raidCfg?.enabled) return false;
    const windowMs = Math.max(1, raidCfg.perSeconds ?? 10) * 1000;
    let list = this.joins.get(guildId);
    if (!list) { list = []; this.joins.set(guildId, list); }
    list.push(now);
    while (list.length && now - list[0] > windowMs) list.shift();
    return list.length >= (raidCfg.joins ?? 10);
  }

  /** Clears the in-memory history of a user (after an action was taken). */
  reset(guildId, userId) { this.history.delete(`${guildId}:${userId}`); }

  /** Drops stale entries (called periodically). */
  sweep(now = Date.now()) {
    for (const [k, list] of this.history) if (!list.length || now - list[list.length - 1].t > 120_000) this.history.delete(k);
    for (const [k, list] of this.joins) if (!list.length || now - list[list.length - 1] > 600_000) this.joins.delete(k);
  }
}

/** New-account filter: is the account younger than minAgeDays? */
export function isNewAccount(createdAt, minAgeDays, now = Date.now()) {
  return minAgeDays > 0 && now - createdAt < minAgeDays * 86_400_000;
}
