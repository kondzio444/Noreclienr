/**
 * Starboard: messages that reach N ⭐ reactions are reposted (and kept updated) in the starboard channel.
 */
import { ButtonStyle } from 'discord.js';
import { embed, row, linkButton } from '../core/ui.js';
import { clip } from '../lib/template.js';

const state = (bot, gid) => bot.store.ns(gid, 'starboard', () => ({}));
const emojiMatch = (cfgEmoji, emoji) => cfgEmoji === emoji.name || cfgEmoji === emoji.toString() || cfgEmoji.includes(`:${emoji.id}>`);

async function update(bot, reaction) {
  if (reaction.partial) await reaction.fetch().catch(() => null);
  const msg = reaction.message.partial ? await reaction.message.fetch().catch(() => null) : reaction.message;
  if (!msg?.guild) return;
  const cfg = bot.cfg(msg.guild.id).starboard;
  if (!cfg.enabled || !cfg.channel || msg.channelId === cfg.channel || !emojiMatch(cfg.emoji, reaction.emoji)) return;
  if (cfg.ignoredChannels.includes(msg.channelId) || (msg.channel.nsfw && !cfg.nsfw)) return;
  const users = await reaction.users.fetch().catch(() => null);
  let count = users ? users.filter(u => !u.bot && (cfg.selfStar || u.id !== msg.author.id)).size : reaction.count;
  const st = state(bot, msg.guild.id);
  const rec = st[msg.id];
  const tg = bot.tg(msg.guild.id);
  const e = embed(0xffc83d).setAuthor({ name: msg.member?.displayName || msg.author.username, iconURL: msg.author.displayAvatarURL() })
    .setDescription(clip(msg.content || '', 3800) || null).setTimestamp(msg.createdTimestamp).setFooter({ text: `#${msg.channel.name}` });
  const img = msg.attachments.find(a => a.contentType?.startsWith('image/'));
  if (img) e.setImage(img.url);
  else if (msg.embeds[0]?.image?.url) e.setImage(msg.embeds[0].image.url);
  const payload = { content: `${cfg.emoji} **${count}** · <#${msg.channelId}>`, embeds: [e], components: [row(linkButton(msg.url, tg('star.jump'), '↗️'))] };
  if (rec) {
    const ch = await bot.channel(msg.guild, cfg.channel);
    const sm = ch ? await ch.messages.fetch(rec.id).catch(() => null) : null;
    if (count < cfg.threshold && sm) { await sm.delete().catch(() => {}); delete st[msg.id]; }
    else if (sm) await sm.edit(payload).catch(() => {});
  } else if (count >= cfg.threshold) {
    const sm = await bot.send(msg.guild, cfg.channel, payload);
    if (sm) st[msg.id] = { id: sm.id, at: Date.now() };
  }
  const keys = Object.keys(st);
  if (keys.length > 3000) for (const k of keys.slice(0, keys.length - 3000)) delete st[k];
  bot.store.touch(msg.guild.id);
}

export default {
  name: 'starboard',
  events: {
    messageReactionAdd: (bot, r, u) => !u.bot && update(bot, r),
    messageReactionRemove: (bot, r, u) => !u.bot && update(bot, r),
  },
};
export { ButtonStyle };
