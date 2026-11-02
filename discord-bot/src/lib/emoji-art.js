/**
 * Custom emoji and role icons: an image from OpenAI (GPT image model) or an upload → 128×128 PNG,
 * or an animated GIF made from it (spin, bounce, pulse, shake, wiggle, glow). Canvas comes from the
 * optional @napi-rs/canvas; without it only still images straight from OpenAI (WebP) are possible.
 *
 * Env: OPENAI_API_KEY (required for generating), OPENAI_IMAGE_MODEL (default gpt-image-1).
 */
import { encodeGif } from './gif.js';

export const ANIMATIONS = ['none', 'spin', 'bounce', 'pulse', 'shake', 'wiggle', 'glow'];
export const EMOJI_SIZE = 128;
export const MAX_EMOJI_BYTES = 256 * 1024;

let canvasMod;
async function canvas() {
  if (canvasMod !== undefined) return canvasMod;
  try { canvasMod = await import('@napi-rs/canvas'); } catch { canvasMod = null; }
  return canvasMod;
}
export async function artAvailable() { return !!(await canvas()); }

/** The prompt sent to the image model: a clean emoji-style icon on a transparent background. */
export function emojiPrompt(prompt, { style = 'emoji' } = {}) {
  const base = style === 'icon'
    ? 'A single Discord role icon'
    : 'A single Discord custom emoji';
  return `${base}: ${prompt}. Bold clean shapes, thick dark outline, vivid colours, simple shading, centred, `
    + 'fills most of the square, no text, no letters, no background, transparent background, readable at 32 pixels.';
}

/** Generates an image with OpenAI; returns { buffer, type }. */
export async function generateImage(env, prompt, { style = 'emoji', fetchImpl = fetch } = {}) {
  if (!env.openaiKey) throw Object.assign(new Error('no_openai_key'), { code: 'no_openai_key' });
  const hasCanvas = await artAvailable();
  const body = {
    model: env.openaiImageModel || 'gpt-image-1', prompt: emojiPrompt(prompt, { style }), size: '1024x1024', n: 1,
    background: 'transparent', quality: 'medium',
    // without canvas the image goes to Discord as it is – WebP keeps it under the 256 KB emoji limit
    output_format: hasCanvas ? 'png' : 'webp', ...(hasCanvas ? {} : { output_compression: 70 }),
  };
  const res = await fetchImpl('https://api.openai.com/v1/images/generations', {
    method: 'POST', headers: { Authorization: `Bearer ${env.openaiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body), signal: AbortSignal.timeout(120_000),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(j.error?.message || `OpenAI HTTP ${res.status}`), { code: j.error?.code === 'moderation_blocked' ? 'blocked' : 'openai' });
  const b64 = j.data?.[0]?.b64_json;
  if (!b64) throw Object.assign(new Error('OpenAI returned no image'), { code: 'openai' });
  return { buffer: Buffer.from(b64, 'base64'), type: hasCanvas ? 'png' : 'webp' };
}

/** Trims transparent borders so the drawing fills the emoji. */
function contentBox(ctx, w, h) {
  const d = ctx.getImageData(0, 0, w, h).data;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y += 2) for (let x = 0; x < w; x += 2) {
    if (d[(y * w + x) * 4 + 3] > 16) { if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; }
  }
  if (x1 < 0) return { x: 0, y: 0, w, h };
  const side = Math.max(x1 - x0, y1 - y0) + 4;
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  return { x: Math.max(0, cx - side / 2), y: Math.max(0, cy - side / 2), w: side, h: side };
}

/** Any image → square 128×128 canvas (trimmed, centred). */
async function square(buffer, size = EMOJI_SIZE) {
  const c = await canvas();
  const img = await c.loadImage(buffer);
  const big = c.createCanvas(img.width, img.height);
  const bctx = big.getContext('2d');
  bctx.drawImage(img, 0, 0);
  const box = contentBox(bctx, img.width, img.height);
  const out = c.createCanvas(size, size);
  const ctx = out.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  const pad = size * 0.04;
  ctx.drawImage(big, box.x, box.y, box.w, box.h, pad, pad, size - pad * 2, size - pad * 2);
  return out;
}

/** Still emoji: 128×128 PNG (or the original WebP without canvas). */
export async function stillEmoji(buffer, type = 'png') {
  if (!(await artAvailable())) {
    if (buffer.length > MAX_EMOJI_BYTES) throw Object.assign(new Error('too_big'), { code: 'too_big' });
    return { buffer, ext: type === 'webp' ? 'webp' : 'png' };
  }
  const sq = await square(buffer);
  return { buffer: await sq.encode('png'), ext: 'png' };
}

/** Animated emoji (GIF) from a still image: 16 frames, the chosen motion. */
export async function animatedEmoji(buffer, animation = 'bounce', { frames = 16, size = EMOJI_SIZE } = {}) {
  const c = await canvas();
  if (!c) throw Object.assign(new Error('no_canvas'), { code: 'no_canvas' });
  const src = await square(buffer, size);
  const list = [];
  for (let f = 0; f < frames; f++) {
    const t = f / frames, wave = Math.sin(t * Math.PI * 2);
    const cv = c.createCanvas(size, size);
    const ctx = cv.getContext('2d');
    ctx.translate(size / 2, size / 2);
    let scale = 0.9;
    switch (animation) {
      case 'spin': ctx.rotate(t * Math.PI * 2); break;
      case 'bounce': ctx.translate(0, -Math.abs(Math.sin(t * Math.PI)) * size * 0.14 + size * 0.05); ctx.scale(1 + Math.max(0, -wave) * 0.06, 1 - Math.max(0, -wave) * 0.06); break;
      case 'pulse': scale = 0.82 + (wave + 1) * 0.07; break;
      case 'shake': ctx.translate(Math.round(Math.sin(t * Math.PI * 8) * size * 0.05), 0); break;
      case 'wiggle': ctx.rotate(wave * 0.22); break;
      case 'glow': break;
      default: break;
    }
    ctx.scale(scale, scale);
    if (animation === 'glow') {
      ctx.shadowColor = `rgba(255,255,255,${0.35 + (wave + 1) * 0.3})`;
      ctx.shadowBlur = 6 + (wave + 1) * 6;
    }
    ctx.drawImage(src, -size / 2, -size / 2, size, size);
    list.push(ctx.getImageData(0, 0, size, size).data);
  }
  const delay = { spin: 50, bounce: 55, pulse: 60, shake: 40, wiggle: 60, glow: 70 }[animation] || 60;
  let gif = encodeGif(list, size, size, delay);
  // too big for Discord: fewer frames, then smaller
  if (gif.length > MAX_EMOJI_BYTES && frames > 8) return animatedEmoji(buffer, animation, { frames: 8, size });
  if (gif.length > MAX_EMOJI_BYTES && size > 96) return animatedEmoji(buffer, animation, { frames: 8, size: 96 });
  return { buffer: gif, ext: 'gif' };
}

/** Role icon: 64×64 PNG (Discord's role icon limit is 256 KB, 64×64 is plenty). */
export async function roleIcon(buffer, type = 'png') {
  if (!(await artAvailable())) return stillEmoji(buffer, type);
  const sq = await square(buffer, 64);
  return { buffer: await sq.encode('png'), ext: 'png' };
}

/** Discord emoji name: 2–32 characters, letters, digits and underscores. */
export function emojiName(raw) {
  const s = String(raw || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l').replace(/Ł/g, 'L')
    .replace(/[^A-Za-z0-9_]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 32);
  return s.length >= 2 ? s : `nore_${s || 'emoji'}`.slice(0, 32);
}
