/**
 * Ticket transcripts: a self-contained HTML page (or plain text) from a list of plain message
 * objects { author:{ id, name, avatar, bot }, content, createdAt, attachments:[{name,url}], embeds:[{title,description}] }.
 */
export function escapeHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Minimal Discord markdown → HTML (bold, italic, code, links) on already escaped text. */
function md(text) {
  return escapeHtml(text)
    .replace(/```([\s\S]*?)```/g, '<pre>$1</pre>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/\*([^*]+)\*/g, '<i>$1</i>')
    .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" rel="noopener noreferrer">$1</a>')
    .replace(/\n/g, '<br>');
}

export function htmlTranscript({ title, guild, channel, messages, labels = {}, meta = [] }) {
  const L = { generated: 'Generated', messages: 'messages', ...labels };
  const rows = messages.map((m) => `
  <div class="msg">
    <img class="av" src="${escapeHtml(m.author.avatar)}" alt="" loading="lazy">
    <div class="body">
      <div class="head"><span class="name${m.author.bot ? ' bot' : ''}">${escapeHtml(m.author.name)}</span><time>${new Date(m.createdAt).toISOString().replace('T', ' ').slice(0, 19)} UTC</time></div>
      ${m.content ? `<div class="text">${md(m.content)}</div>` : ''}
      ${(m.embeds || []).map(e => `<div class="embed">${e.title ? `<b>${escapeHtml(e.title)}</b><br>` : ''}${md(e.description || '')}${(e.fields || []).map(f => `<div><b>${escapeHtml(f.name)}</b>: ${md(f.value)}</div>`).join('')}</div>`).join('')}
      ${(m.attachments || []).map(a => `<div class="att">📎 <a href="${escapeHtml(a.url)}">${escapeHtml(a.name)}</a></div>`).join('')}
    </div>
  </div>`).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title><style>
body{margin:0;background:#0d0913;color:#f3eefa;font:15px/1.45 system-ui,sans-serif}
header{padding:20px 24px;background:#150f1e;border-bottom:1px solid #2b2533}
header h1{margin:0 0 6px;font-size:20px;color:#c8a8ff}header p{margin:2px 0;color:#b8adc9;font-size:13px}
main{padding:12px 24px}.msg{display:flex;gap:12px;padding:8px 0;border-bottom:1px solid #1c1428}
.av{width:40px;height:40px;border-radius:50%;flex:none;background:#1c1428}.head{display:flex;gap:10px;align-items:baseline}
.name{font-weight:600}.name.bot::after{content:'BOT';margin-left:6px;font-size:10px;background:#9d5cff;border-radius:3px;padding:1px 4px}
time{color:#8f84a3;font-size:12px}.text{white-space:normal;word-wrap:break-word}
.embed{margin-top:6px;padding:8px 12px;border-left:4px solid #9d5cff;background:#150f1e;border-radius:4px}
pre{background:#0a0710;padding:8px;border-radius:4px;overflow:auto}code{background:#0a0710;padding:1px 4px;border-radius:3px}a{color:#c8a8ff}
</style></head><body><header><h1>${escapeHtml(title)}</h1><p>${escapeHtml(guild)} · #${escapeHtml(channel)} · ${messages.length} ${escapeHtml(L.messages)}</p>
${meta.map(([k, v]) => `<p><b>${escapeHtml(k)}:</b> ${escapeHtml(v)}</p>`).join('')}
<p>${escapeHtml(L.generated)}: ${new Date().toISOString().replace('T', ' ').slice(0, 19)} UTC · Nore Bot</p></header><main>${rows}</main></body></html>`;
}

export function textTranscript({ title, messages }) {
  const lines = [title, '='.repeat(title.length), ''];
  for (const m of messages) {
    lines.push(`[${new Date(m.createdAt).toISOString().replace('T', ' ').slice(0, 19)}] ${m.author.name}: ${m.content || ''}`);
    for (const e of m.embeds || []) lines.push(`    [embed] ${e.title || ''} ${e.description || ''}`.trimEnd());
    for (const a of m.attachments || []) lines.push(`    [file] ${a.name} ${a.url}`);
  }
  return lines.join('\n');
}

/** discord.js Message → plain object used above. */
export function plainMessage(m) {
  return {
    author: { id: m.author.id, name: m.member?.displayName || m.author.username, avatar: m.author.displayAvatarURL({ size: 64, extension: 'png' }), bot: m.author.bot },
    content: m.content,
    createdAt: m.createdTimestamp,
    attachments: [...m.attachments.values()].map(a => ({ name: a.name, url: a.url })),
    embeds: m.embeds.map(e => ({ title: e.title, description: e.description, fields: e.fields })),
  };
}

/** Fetches up to `max` messages of a channel, oldest first. */
export async function fetchAll(channel, max = 5000) {
  const out = [];
  let before;
  while (out.length < max) {
    const batch = await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}) }).catch(() => null);
    if (!batch?.size) break;
    out.push(...batch.values());
    before = batch.last().id;
    if (batch.size < 100) break;
  }
  return out.reverse();
}
