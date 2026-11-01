/**
 * Minimal animated GIF89a encoder for emoji (no dependency): RGBA frames → one global palette
 * (6×7×6 colour cube + transparent index), LZW compressed, looping forever. Small enough for
 * Discord's 256 KB emoji limit at 128×128 and ~12–24 frames.
 */

const R_LEVELS = 6, G_LEVELS = 7, B_LEVELS = 6; // 252 colours + 1 transparent (index 252)
const TRANSPARENT = R_LEVELS * G_LEVELS * B_LEVELS;

function palette() {
  const p = new Uint8Array(256 * 3);
  let i = 0;
  for (let r = 0; r < R_LEVELS; r++) for (let g = 0; g < G_LEVELS; g++) for (let b = 0; b < B_LEVELS; b++) {
    p[i++] = Math.round(r * 255 / (R_LEVELS - 1)); p[i++] = Math.round(g * 255 / (G_LEVELS - 1)); p[i++] = Math.round(b * 255 / (B_LEVELS - 1));
  }
  return p;
}

/** RGBA → palette indices (alpha < 128 = transparent), with light ordered dithering. */
function indexFrame(rgba, w, h) {
  const out = new Uint8Array(w * h);
  const bayer = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    if (rgba[i + 3] < 128) { out[y * w + x] = TRANSPARENT; continue; }
    const d = (bayer[(y & 3) * 4 + (x & 3)] / 16 - 0.5);
    const q = (v, levels) => Math.max(0, Math.min(levels - 1, Math.round(v / 255 * (levels - 1) + d * 0.9)));
    out[y * w + x] = (q(rgba[i], R_LEVELS) * G_LEVELS + q(rgba[i + 1], G_LEVELS)) * B_LEVELS + q(rgba[i + 2], B_LEVELS);
  }
  return out;
}

/** GIF LZW (minimum code size 8). */
function lzw(indices) {
  const minSize = 8, clear = 1 << minSize, eoi = clear + 1;
  const bytes = [];
  let cur = 0, bits = 0;
  const emit = (code, size) => {
    cur |= code << bits; bits += size;
    while (bits >= 8) { bytes.push(cur & 255); cur >>>= 8; bits -= 8; }
  };
  let dict = new Map(), next = eoi + 1, size = minSize + 1;
  emit(clear, size);
  let prefix = indices[0];
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i];
    const key = prefix * 256 + k;
    const hit = dict.get(key);
    if (hit !== undefined) { prefix = hit; continue; }
    emit(prefix, size);
    if (next < 4096) {
      dict.set(key, next++);
      if (next > (1 << size) && size < 12) size++;
    } else {
      emit(clear, size);
      dict = new Map(); next = eoi + 1; size = minSize + 1;
    }
    prefix = k;
  }
  emit(prefix, size);
  emit(eoi, size);
  if (bits > 0) bytes.push(cur & 255);
  // sub-blocks of at most 255 bytes
  const out = [minSize];
  for (let i = 0; i < bytes.length; i += 255) {
    const chunk = bytes.slice(i, i + 255);
    out.push(chunk.length, ...chunk);
  }
  out.push(0);
  return out;
}

/**
 * @param frames  array of RGBA Uint8(Clamped)Array, each w*h*4
 * @param delayMs frame delay (rounded to 10 ms)
 * @returns Buffer with an animated GIF
 */
export function encodeGif(frames, w, h, delayMs = 60) {
  const pal = palette();
  const out = [];
  const u16 = (v) => [v & 255, (v >> 8) & 255];
  out.push(...Buffer.from('GIF89a'), ...u16(w), ...u16(h), 0xf7, 0, 0); // global table of 256 colours
  out.push(...pal);
  out.push(0x21, 0xff, 0x0b, ...Buffer.from('NETSCAPE2.0'), 0x03, 0x01, 0, 0, 0); // loop forever
  const delay = Math.max(2, Math.round(delayMs / 10));
  for (const f of frames) {
    out.push(0x21, 0xf9, 0x04, 0b00001001, ...u16(delay), TRANSPARENT, 0); // dispose: restore to background, transparent
    out.push(0x2c, 0, 0, 0, 0, ...u16(w), ...u16(h), 0);
    out.push(...lzw(indexFrame(f, w, h)));
  }
  out.push(0x3b);
  return Buffer.from(out);
}
