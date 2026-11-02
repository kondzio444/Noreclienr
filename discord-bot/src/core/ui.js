/**
 * Embed / component helpers shared by all modules.
 */
import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, ComponentType } from 'discord.js';
import { colorInt, clip } from '../lib/template.js';

export const COLORS = {
  brand: 0x9d5cff, ok: 0x3ad18b, warn: 0xffb020, error: 0xff5470, info: 0x5aa9ff, muted: 0x2b2533,
};

export const EPHEMERAL = MessageFlags.Ephemeral;

export function embed(color = COLORS.brand) {
  return new EmbedBuilder().setColor(typeof color === 'string' ? colorInt(color) : color);
}

export const okEmbed = (text) => embed(COLORS.ok).setDescription(`✅ ${clip(text, 4000)}`);
export const errEmbed = (text) => embed(COLORS.error).setDescription(`⛔ ${clip(text, 4000)}`);
export const infoEmbed = (text) => embed(COLORS.info).setDescription(clip(text, 4096));
export const warnEmbed = (text) => embed(COLORS.warn).setDescription(`⚠️ ${clip(text, 4000)}`);

export function button(customId, label, style = ButtonStyle.Secondary, emoji) {
  const b = new ButtonBuilder().setCustomId(customId).setStyle(style);
  if (label) b.setLabel(clip(label, 80));
  if (emoji) b.setEmoji(emoji);
  return b;
}

export function linkButton(url, label, emoji) {
  const b = new ButtonBuilder().setURL(url).setStyle(ButtonStyle.Link).setLabel(clip(label, 80));
  if (emoji) b.setEmoji(emoji);
  return b;
}

export const row = (...components) => new ActionRowBuilder().addComponents(...components);

/** Splits up to 25 buttons into rows of 5. */
export function rows(buttons) {
  const out = [];
  for (let i = 0; i < buttons.length && out.length < 5; i += 5) out.push(row(...buttons.slice(i, i + 5)));
  return out;
}

/**
 * Asks for confirmation with two buttons (only the asking user can answer). Resolves true/false.
 * `message` is an interaction reply (fetchReply) or a sent message.
 */
export async function confirm(ctx, { text, danger = true, timeout = 60_000, embeds } = {}) {
  const id = `confirm:${ctx.i.id}`;
  const payload = {
    embeds: embeds || [warnEmbed(text)],
    components: [row(
      button(`${id}:yes`, ctx.t('common.confirm'), danger ? ButtonStyle.Danger : ButtonStyle.Success, danger ? '⚠️' : '✅'),
      button(`${id}:no`, ctx.t('common.cancel'), ButtonStyle.Secondary),
    )],
  };
  const msg = await ctx.reply({ ...payload, flags: EPHEMERAL, withResponse: true });
  try {
    const target = msg?.resource?.message || msg;
    const click = await target.awaitMessageComponent({ componentType: ComponentType.Button, time: timeout, filter: (b) => b.user.id === ctx.user.id && b.customId.startsWith(id) });
    const yes = click.customId.endsWith(':yes');
    await click.update({ embeds: [yes ? infoEmbed(ctx.t('common.working')) : infoEmbed(ctx.t('common.cancelled'))], components: [] }).catch(() => {});
    return yes;
  } catch {
    await ctx.i.editReply({ embeds: [infoEmbed(ctx.t('common.timeout'))], components: [] }).catch(() => {});
    return false;
  }
}

/** Splits a long text into chunks that fit one embed description. */
export function chunk(lines, max = 3900) {
  const out = [];
  let cur = '';
  for (const l of lines) {
    if ((cur + '\n' + l).length > max) { if (cur) out.push(cur); cur = l.slice(0, max); } else cur = cur ? cur + '\n' + l : l;
  }
  if (cur) out.push(cur);
  return out;
}

/** Text progress bar for long jobs. */
export function bar(done, total, width = 20) {
  const r = total ? Math.min(1, done / total) : 1;
  const f = Math.round(r * width);
  return `\`${'█'.repeat(f)}${'░'.repeat(width - f)}\` ${Math.round(r * 100)}%`;
}
