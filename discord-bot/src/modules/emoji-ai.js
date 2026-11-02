/**
 * AI and animated emoji – sub-commands merged into /emoji (configurator.js):
 *   /emoji generate <prompt> [name] [animation]  – OpenAI image → emoji (still PNG or animated GIF)
 *   /emoji add … animation:<motion>               – an uploaded still picture → animated emoji
 *   /emoji roleicon <role> [prompt] [image]       – role icon from a description or a picture (boost level 2)
 * Generating needs OPENAI_API_KEY in .env (costs per image, so: Manage Expressions + a cooldown).
 */
import { opt } from '../core/commands.js';
import { ANIMATIONS, generateImage, stillEmoji, animatedEmoji, roleIcon, emojiName } from '../lib/emoji-art.js';
import { logger } from '../lib/logger.js';

const log = logger.child('emojis');
const SLOTS = [50, 100, 150, 250]; // per kind (still / animated) by boost tier

export const animOpt = () => opt.string('animation', false, { choices: { values: ANIMATIONS, key: (v) => `emoji.anim.${v}` } });

function freeSlots(guild, animated) {
  const max = SLOTS[guild.premiumTier] ?? 50;
  const used = guild.emojis.cache.filter(e => !!e.animated === animated).size;
  return max - used;
}

export async function download(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { code: 'download' });
  const len = Number(res.headers.get('content-length') || 0);
  if (len > 10 * 1024 * 1024) throw Object.assign(new Error('too_big'), { code: 'too_big' });
  return Buffer.from(await res.arrayBuffer());
}

/** Image buffer → emoji created on the guild. */
export async function createEmoji(ctx, buffer, type, name, animation) {
  const animated = animation && animation !== 'none';
  if (freeSlots(ctx.guild, animated) <= 0) return ctx.fail('emoji.no_slots', { kind: ctx.t(animated ? 'emoji.kind_animated' : 'emoji.kind_still') });
  const art = animated ? await animatedEmoji(buffer, animation) : await stillEmoji(buffer, type);
  const emoji = await ctx.guild.emojis.create({ attachment: art.buffer, name: emojiName(name), reason: `Nore Bot /emoji by ${ctx.user.tag}` });
  ctx.bot.audit(ctx.guild.id, 'emoji_create', { id: emoji.id, name: emoji.name, animated: emoji.animated, by: ctx.user.id });
  return ctx.reply({ content: ctx.t('emoji.created', { emoji: emoji.toString(), name: emoji.name }) });
}

export function explain(ctx, err) {
  const code = err.code || '';
  const known = { no_openai_key: 'emoji.no_key', no_canvas: 'emoji.no_canvas', too_big: 'emoji.too_big', blocked: 'emoji.blocked', download: 'emoji.download_failed' };
  if (known[code]) return ctx.fail(known[code]);
  if (err.code === 30008 || err.code === 30018) return ctx.fail('emoji.no_slots', { kind: '' });
  if (err.code === 50035) return ctx.fail('emoji.invalid', { error: String(err.message).slice(0, 300) });
  log.warn('emoji failed', { guildId: ctx.guild.id, err: err.message });
  return ctx.fail('emoji.failed', { error: String(err.message).slice(0, 300) });
}

export const aiEmojiSubs = {
  generate: {
        cooldown: 20,
        options: [opt.string('prompt', true, { max: 300 }), opt.string('name', false, { max: 32 }), animOpt()],
        async run(ctx) {
          if (!ctx.bot.env.openaiKey) return ctx.fail('emoji.no_key');
          await ctx.defer();
          const prompt = ctx.str('prompt');
          try {
            const img = await generateImage(ctx.bot.env, prompt);
            return await createEmoji(ctx, img.buffer, img.type, ctx.str('name') || prompt, ctx.str('animation'));
          } catch (err) { return explain(ctx, err); }
        },
      },
      roleicon: {
        cooldown: 20,
        botPerms: ['ManageRoles'], botPermsScope: 'guild',
        options: [opt.role('role', true), opt.string('prompt', false, { max: 300 }), opt.attachment('image', false)],
        async run(ctx) {
          const role = ctx.i.options.getRole('role');
          if (!ctx.guild.features.includes('ROLE_ICONS')) return ctx.fail('emoji.no_role_icons');
          const target = ctx.guild.roles.cache.get(role.id);
          if (!target?.editable) return ctx.fail('emoji.role_not_editable');
          const file = ctx.attachment('image');
          const prompt = ctx.str('prompt');
          if (!file && !prompt) return ctx.fail('emoji.need_prompt_or_image');
          if (!file && !ctx.bot.env.openaiKey) return ctx.fail('emoji.no_key');
          await ctx.defer();
          try {
            const src = file ? { buffer: await download(file.url), type: 'png' } : await generateImage(ctx.bot.env, prompt, { style: 'icon' });
            const icon = await roleIcon(src.buffer, src.type);
            await target.setIcon(icon.buffer, `Nore Bot /emoji roleicon by ${ctx.user.tag}`);
            return ctx.reply({ content: ctx.t('emoji.role_icon_set', { role: target.toString() }) });
          } catch (err) { return explain(ctx, err); }
        },
      },
};
