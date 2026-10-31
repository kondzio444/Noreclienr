/**
 * XP math. The XP needed to go from level n to n+1 is 5n² + 50n + 100 (the curve players know from
 * popular Discord level bots): level 1 at 100 XP, level 5 at 1 150 XP, level 10 at 4 675 XP …
 */
export const xpToNext = (level) => 5 * level * level + 50 * level + 100;

/** Total XP needed to reach `level` from zero. */
export function totalXpForLevel(level) {
  let sum = 0;
  for (let i = 0; i < level; i++) sum += xpToNext(i);
  return sum;
}

/** { level, current (XP into this level), needed (XP for the next level), total } */
export function levelFromXp(xp) {
  let level = 0;
  let rest = Math.max(0, Math.floor(xp));
  while (rest >= xpToNext(level)) { rest -= xpToNext(level); level++; if (level > 10_000) break; }
  return { level, current: rest, needed: xpToNext(level), total: Math.max(0, Math.floor(xp)) };
}

/** Random XP for one message: integer in [min, max] times the multiplier. */
export function rollXp(min, max, multiplier = 1, rnd = Math.random) {
  const lo = Math.max(0, Math.min(min, max)), hi = Math.max(min, max);
  return Math.max(0, Math.round((lo + Math.floor(rnd() * (hi - lo + 1))) * multiplier));
}

/**
 * Applies a message to a user's XP record when the cooldown passed.
 * @returns {{ gained:number, leveledUp:boolean, from:number, to:number }}
 */
export function grantXp(record, { now, cooldownMs, min, max, multiplier = 1, rnd }) {
  if (record.last && now - record.last < cooldownMs) return { gained: 0, leveledUp: false, from: levelFromXp(record.xp || 0).level, to: levelFromXp(record.xp || 0).level };
  const from = levelFromXp(record.xp || 0).level;
  const gained = rollXp(min, max, multiplier, rnd);
  record.xp = (record.xp || 0) + gained;
  record.last = now;
  record.messages = (record.messages || 0) + 1;
  const to = levelFromXp(record.xp).level;
  return { gained, leveledUp: to > from, from, to };
}

/** Rewards to hold at `level` (sorted by level). With stack=false only the highest one. */
export function rewardsFor(level, rewards, stack = true) {
  const got = (rewards || []).filter(r => r && r.role && Number(r.level) <= level).sort((a, b) => a.level - b.level);
  return stack ? got : got.slice(-1);
}

/** Progress bar made of Unicode blocks: ▰▰▰▱▱ */
export function progressBar(current, total, width = 12) {
  const ratio = total > 0 ? Math.min(1, Math.max(0, current / total)) : 0;
  const filled = Math.round(ratio * width);
  return '▰'.repeat(filled) + '▱'.repeat(width - filled);
}
