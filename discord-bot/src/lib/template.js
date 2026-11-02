/**
 * Message templates configured by server admins: "Witaj {user} na {server}! Jesteś {count}. osobą."
 * Unknown placeholders stay as they are. Values are plain strings; mentions are produced by callers.
 */
export function render(template, vars = {}) {
  if (!template) return '';
  return String(template).replace(/\{([a-zA-Z_][a-zA-Z0-9_.]*)\}/g, (m, k) => {
    const v = k.split('.').reduce((o, p) => (o == null ? undefined : o[p]), vars);
    return v === undefined || v === null ? m : String(v);
  });
}

/** Common placeholders for member-related templates. */
export function memberVars(member, extra = {}) {
  const user = member.user || member;
  const guild = member.guild;
  return {
    user: `<@${user.id}>`,
    mention: `<@${user.id}>`,
    username: user.username,
    name: member.displayName || user.globalName || user.username,
    tag: user.tag || user.username,
    id: user.id,
    server: guild?.name ?? '',
    guild: guild?.name ?? '',
    count: guild?.memberCount ?? '',
    members: guild?.memberCount ?? '',
    ...extra,
  };
}

/** Escapes Discord markdown in user supplied text that is embedded into our messages. */
export function escapeMd(text) {
  return String(text ?? '').replace(/([\\*_`~|>])/g, '\\$1').replace(/@(everyone|here)/g, '@\u200b$1');
}

/** Trims to `max` characters with an ellipsis. */
export function clip(text, max) {
  const s = String(text ?? '');
  return s.length > max ? s.slice(0, Math.max(0, max - 1)) + '…' : s;
}

/** Converts a hex colour ("#9d5cff" / "9d5cff") to an integer for embeds. */
export function colorInt(hex, fallback = 0x9d5cff) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
  return m ? parseInt(m[1], 16) : fallback;
}
