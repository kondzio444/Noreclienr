/**
 * Welcome / level-up cards. Uses @napi-rs/canvas when it is installed (an optional dependency with
 * prebuilt binaries – no compiler needed); without it, or without any system font, the callers fall
 * back to rich embeds. Never throws.
 */
import { logger } from './logger.js';

const log = logger.child('card');
let canvasMod; // undefined = not tried, null = unavailable

async function canvas() {
  if (canvasMod !== undefined) return canvasMod;
  try {
    canvasMod = await import('@napi-rs/canvas');
    if (!canvasMod.GlobalFonts.families.length) { log.info('no system fonts – welcome images disabled'); canvasMod = null; }
  } catch { canvasMod = null; }
  return canvasMod;
}

export async function cardsAvailable() { return !!(await canvas()); }

function fit(ctx, text, max, size, weight = 'bold') {
  let s = size;
  do { ctx.font = `${weight} ${s}px sans-serif`; s -= 2; } while (ctx.measureText(text).width > max && s > 14);
  return text;
}

/**
 * @returns {Promise<Buffer|null>} PNG
 */
export async function welcomeCard({ avatarUrl, title, name, subtitle, accent = '#9d5cff' }) {
  const c = await canvas();
  if (!c) return null;
  try {
    const W = 1024, H = 340;
    const cv = c.createCanvas(W, H);
    const g = cv.getContext('2d');
    const bg = g.createLinearGradient(0, 0, W, H);
    bg.addColorStop(0, '#0d0913'); bg.addColorStop(0.6, '#1c1428'); bg.addColorStop(1, accent);
    g.fillStyle = bg;
    g.beginPath(); g.roundRect(0, 0, W, H, 28); g.fill();
    // soft glow
    const glow = g.createRadialGradient(170, H / 2, 20, 170, H / 2, 260);
    glow.addColorStop(0, accent + '88'); glow.addColorStop(1, '#00000000');
    g.fillStyle = glow; g.fillRect(0, 0, W, H);
    // avatar
    try {
      const res = await fetch(avatarUrl);
      const img = await c.loadImage(Buffer.from(await res.arrayBuffer()));
      g.save(); g.beginPath(); g.arc(170, H / 2, 105, 0, Math.PI * 2); g.closePath(); g.clip();
      g.drawImage(img, 65, H / 2 - 105, 210, 210); g.restore();
    } catch { /* avatar optional */ }
    g.lineWidth = 8; g.strokeStyle = accent; g.beginPath(); g.arc(170, H / 2, 109, 0, Math.PI * 2); g.stroke();
    g.fillStyle = '#c8a8ff'; fit(g, title, 640, 38); g.fillText(title, 320, 120);
    g.fillStyle = '#f3eefa'; fit(g, name, 640, 64); g.fillText(name, 320, 195);
    g.fillStyle = '#b8adc9'; fit(g, subtitle, 640, 28, 'normal'); g.fillText(subtitle, 320, 250);
    return await cv.encode('png');
  } catch (err) { log.warn('card failed', { err: err.message }); return null; }
}
