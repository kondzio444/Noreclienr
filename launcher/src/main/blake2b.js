'use strict';
/**
 * BLAKE2b-512 (RFC 7693) in plain JavaScript, streaming. Electron's crypto (BoringSSL) has no
 * 'blake2b512' digest – createHash throws "Digest method not supported" – so the bridge needs its own
 * for the minisign prehash of the Tauri installer. 64-bit words are kept as two 32-bit halves.
 */

const IV = new Uint32Array([
  0xf3bcc908, 0x6a09e667, 0x84caa73b, 0xbb67ae85, 0xfe94f82b, 0x3c6ef372, 0x5f1d36f1, 0xa54ff53a,
  0xade682d1, 0x510e527f, 0x2b3e6c1f, 0x9b05688c, 0xfb41bd6b, 0x1f83d9ab, 0x137e2179, 0x5be0cd19,
]);

const SIGMA = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
  [14, 10, 4, 8, 9, 15, 13, 6, 1, 12, 0, 2, 11, 7, 5, 3],
  [11, 8, 12, 0, 5, 2, 15, 13, 10, 14, 3, 6, 7, 1, 9, 4],
  [7, 9, 3, 1, 13, 12, 11, 14, 2, 6, 5, 10, 4, 0, 15, 8],
  [9, 0, 5, 7, 2, 4, 10, 15, 14, 1, 11, 12, 6, 8, 3, 13],
  [2, 12, 6, 10, 0, 11, 8, 3, 4, 13, 7, 5, 15, 14, 1, 9],
  [12, 5, 1, 15, 14, 13, 4, 10, 0, 7, 6, 3, 9, 2, 8, 11],
  [13, 11, 7, 14, 12, 1, 3, 9, 5, 0, 15, 4, 8, 6, 2, 10],
  [6, 15, 14, 9, 11, 3, 0, 8, 12, 2, 13, 7, 1, 4, 10, 5],
  [10, 2, 8, 4, 7, 6, 1, 5, 15, 11, 9, 14, 3, 12, 13, 0],
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
  [14, 10, 4, 8, 9, 15, 13, 6, 1, 12, 0, 2, 11, 7, 5, 3],
].map(r => r.map(x => x * 2));

const v = new Uint32Array(32);
const m = new Uint32Array(32);

// v[a] += v[b] (64-bit, as lo/hi pairs)
function add64(a, b) {
  const lo = v[a] + v[b];
  let hi = v[a + 1] + v[b + 1];
  if (lo >= 0x100000000) hi++;
  v[a] = lo; v[a + 1] = hi;
}
// v[a] += (lo, hi)
function add64c(a, lo0, hi0) {
  let lo = v[a] + lo0;
  if (lo0 < 0) lo += 0x100000000;
  let hi = v[a + 1] + hi0;
  if (lo >= 0x100000000) hi++;
  v[a] = lo; v[a + 1] = hi;
}

function G(a, b, c, d, ix, iy) {
  const x0 = m[ix], x1 = m[ix + 1], y0 = m[iy], y1 = m[iy + 1];
  add64(a, b); add64c(a, x0, x1);
  // d = (d ^ a) >>> 32
  let xor0 = v[d] ^ v[a], xor1 = v[d + 1] ^ v[a + 1];
  v[d] = xor1; v[d + 1] = xor0;
  add64(c, d);
  // b = (b ^ c) >>> 24
  xor0 = v[b] ^ v[c]; xor1 = v[b + 1] ^ v[c + 1];
  v[b] = (xor0 >>> 24) ^ (xor1 << 8); v[b + 1] = (xor1 >>> 24) ^ (xor0 << 8);
  add64(a, b); add64c(a, y0, y1);
  // d = (d ^ a) >>> 16
  xor0 = v[d] ^ v[a]; xor1 = v[d + 1] ^ v[a + 1];
  v[d] = (xor0 >>> 16) ^ (xor1 << 16); v[d + 1] = (xor1 >>> 16) ^ (xor0 << 16);
  add64(c, d);
  // b = (b ^ c) >>> 63
  xor0 = v[b] ^ v[c]; xor1 = v[b + 1] ^ v[c + 1];
  v[b] = (xor1 >>> 31) ^ (xor0 << 1); v[b + 1] = (xor0 >>> 31) ^ (xor1 << 1);
}

function compress(h, block, t, last) {
  for (let i = 0; i < 16; i++) { v[i] = h[i]; v[i + 16] = IV[i]; }
  v[24] ^= t >>> 0; v[25] ^= Math.floor(t / 0x100000000) >>> 0;
  if (last) { v[28] = ~v[28]; v[29] = ~v[29]; }
  for (let i = 0; i < 32; i++) {
    m[i] = block[i * 4] | (block[i * 4 + 1] << 8) | (block[i * 4 + 2] << 16) | (block[i * 4 + 3] << 24);
  }
  for (let r = 0; r < 12; r++) {
    const s = SIGMA[r];
    G(0, 8, 16, 24, s[0], s[1]);
    G(2, 10, 18, 26, s[2], s[3]);
    G(4, 12, 20, 28, s[4], s[5]);
    G(6, 14, 22, 30, s[6], s[7]);
    G(0, 10, 20, 30, s[8], s[9]);
    G(2, 12, 22, 24, s[10], s[11]);
    G(4, 14, 16, 26, s[12], s[13]);
    G(6, 8, 18, 28, s[14], s[15]);
  }
  for (let i = 0; i < 16; i++) h[i] = h[i] ^ v[i] ^ v[i + 16];
}

/** createHash-like object: update(buffer) … digest() → 64-byte Buffer. */
function createBlake2b512() {
  const h = new Uint32Array(IV);
  h[0] ^= 0x01010000 ^ 64; // digest length 64, no key, fanout 1, depth 1
  const buf = new Uint8Array(128);
  let fill = 0;
  let t = 0;
  return {
    update(data) {
      const d = data instanceof Uint8Array ? data : Buffer.from(data);
      for (let i = 0; i < d.length; i++) {
        if (fill === 128) { t += 128; compress(h, buf, t, false); fill = 0; }
        buf[fill++] = d[i];
      }
      return this;
    },
    digest() {
      t += fill;
      buf.fill(0, fill);
      compress(h, buf, t, true);
      const out = Buffer.alloc(64);
      for (let i = 0; i < 16; i++) out.writeUInt32LE(h[i] >>> 0, i * 4);
      return out;
    },
  };
}

/** BLAKE2b-512 hasher: Node's native one when the runtime has it, else the JS one. */
function blake2b512() {
  try { return require('crypto').createHash('blake2b512'); } catch { return createBlake2b512(); }
}

module.exports = { createBlake2b512, blake2b512 };
