import test from 'node:test';
import assert from 'node:assert/strict';
import { applyFont, categoryName, channelName, roleName, normalizeStyle, paletteColors, gradientEnd } from '../src/lib/style.js';
import { loadTemplates, compileTemplate } from '../src/lib/templates.js';
import { validateLayout, normName } from '../src/lib/layout.js';
import { translator } from '../src/i18n/index.js';
import { encodeGif } from '../src/lib/gif.js';
import { emojiName, generateImage, stillEmoji, animatedEmoji, artAvailable, ANIMATIONS } from '../src/lib/emoji-art.js';

test('fonts: letters change, accents, emoji and symbols stay', () => {
  assert.equal(applyFont('Admin 1', 'bold'), '𝐀𝐝𝐦𝐢𝐧 𝟏');
  assert.equal(applyFont('Admin', 'smallcaps'), 'ᴀᴅᴍɪɴ');
  assert.equal(applyFont('Chat', 'double'), 'ℂ𝕙𝕒𝕥');
  assert.equal(applyFont('👑 S.Helper', 'mono'), '👑 𝚂.𝙷𝚎𝚕𝚙𝚎𝚛');
  // ą keeps its ogonek (combining mark), ł stays as it is
  assert.equal(applyFont('ął', 'bold').normalize('NFC'), '𝐚̨ł');
  // the comparable form still matches the plain name (re-runs find the same channel)
  assert.equal(normName(applyFont('Ogólny', 'bold')), normName('Ogólny'));
});

test('names: category, channel and role looks', () => {
  assert.equal(categoryName('🚪', 'Start', {}), '🚪 ┃ START');
  assert.equal(categoryName('🚪', 'Start', { category: 'lines', separator: 'dot' }), '━━ 🚪 START ━━');
  assert.equal(categoryName('🚪', 'Start', { emoji: false, upper: false }), 'Start');
  assert.equal(channelName('💬', 'General', {}, { separator: 'dot' }), '💬・general');
  assert.equal(channelName('🏠', 'Lobby', { voice: true }, { separator: 'none' }), '🏠 Lobby');
  assert.equal(roleName('👑', 'Owner', { role: 'brackets' }), '『 Owner 』');
  assert.equal(roleName('👑', 'Owner', {}), '👑 Owner');
  assert.deepEqual(normalizeStyle({ font: 'nope', palette: 'x' }).font, 'plain');
});

test('palettes recolour the staff ladder top → bottom, quiet roles keep their colour', () => {
  const roles = [{ key: 'owner', color: '#111111' }, { key: 'admin', color: '#222222' }, { key: 'vip', color: '#333333' }, { key: 'ping_updates', color: '#576574' }, { key: 'sep_x', separator: true }];
  const c = paletteColors(roles, ['owner', 'admin'], { palette: 'minecraft' });
  assert.equal(c.get('owner'), '#aa0000');
  assert.equal(c.get('admin'), '#ff5555');
  assert.ok(c.has('vip'));
  assert.ok(!c.has('ping_updates'));
  assert.equal(paletteColors(roles, [], {}).size, 0);
  assert.match(gradientEnd('#aa0000'), /^#[0-9a-f]{6}$/);
});

test('every template × look stays within Discord limits and has the graded staff ladder', () => {
  const tpls = loadTemplates();
  const looks = [{}, { font: 'smallcaps', separator: 'dot', category: 'lines', role: 'brackets', palette: 'neon' }, { font: 'bold', category: 'stars', palette: 'minecraft', emoji: false }];
  for (const [id, tpl] of Object.entries(tpls)) for (const lang of ['pl', 'en']) for (const style of looks) {
    const c = compileTemplate(tpl, { t: translator(lang), size: 'full', style });
    assert.deepEqual(validateLayout(c.layout), [], `${id} ${lang} ${JSON.stringify(style)}`);
  }
  const keys = compileTemplate(tpls['nore-client'], { t: translator('pl'), size: 'full' }).layout.roles.map(r => r.key);
  for (const k of ['owner', 'co_owner', 'head_admin', 'senior_admin', 'admin', 'senior_mod', 'moderator', 'trial_mod', 'senior_helper', 'helper', 'trial', 'mc_admin', 'mc_mod', 'mc_helper']) assert.ok(keys.includes(k), k);
  const names = compileTemplate(tpls['nore-client'], { t: translator('pl'), size: 'full' }).layout.roles;
  assert.ok(names.find(r => r.key === 'trial').name.includes('T.Helper'));
  assert.ok(names.find(r => r.key === 'senior_helper').name.includes('S.Helper'));
});

test('GIF encoder: header, loop, frames, transparency', () => {
  const w = 16, h = 16;
  const frame = (v) => { const a = new Uint8ClampedArray(w * h * 4); for (let i = 0; i < w * h; i++) { a[i * 4] = v; a[i * 4 + 3] = i % 3 ? 255 : 0; } return a; };
  const gif = encodeGif([frame(0), frame(255)], w, h, 50);
  assert.equal(gif.subarray(0, 6).toString(), 'GIF89a');
  assert.ok(gif.includes(Buffer.from('NETSCAPE2.0')));
  assert.equal(gif.at(-1), 0x3b);
  // two graphic control extensions (one per frame)
  let n = 0;
  for (let i = 0; i < gif.length - 2; i++) if (gif[i] === 0x21 && gif[i + 1] === 0xf9 && gif[i + 2] === 0x04) n++;
  assert.equal(n, 2);
});

test('emoji names are valid for Discord', () => {
  assert.equal(emojiName('Zielony creeper!'), 'Zielony_creeper');
  assert.equal(emojiName('ł'), 'nore_l');
  assert.equal(emojiName('a'.repeat(50)).length, 32);
  assert.ok(ANIMATIONS.includes('spin'));
});

test('AI emoji: OpenAI request, still and animated emoji under Discord limits', { skip: !(await artAvailable()) && 'no @napi-rs/canvas' }, async () => {
  const { createCanvas } = await import('@napi-rs/canvas');
  const c = createCanvas(1024, 1024);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#9d5cff'; ctx.beginPath(); ctx.arc(512, 512, 300, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#ffffff'; ctx.fillRect(420, 400, 60, 60); ctx.fillRect(560, 400, 60, 60);
  const png = await c.encode('png');
  let sent;
  const fetchImpl = async (url, init) => { sent = { url, body: JSON.parse(init.body), auth: init.headers.Authorization }; return new Response(JSON.stringify({ data: [{ b64_json: png.toString('base64') }] }), { status: 200 }); };
  const img = await generateImage({ openaiKey: 'sk-test', openaiImageModel: 'gpt-image-1' }, 'fioletowy slime', { fetchImpl });
  assert.equal(sent.url, 'https://api.openai.com/v1/images/generations');
  assert.equal(sent.auth, 'Bearer sk-test');
  assert.equal(sent.body.background, 'transparent');
  assert.match(sent.body.prompt, /fioletowy slime/);
  const still = await stillEmoji(img.buffer, img.type);
  assert.equal(still.ext, 'png');
  assert.ok(still.buffer.length < 256 * 1024);
  for (const a of ['spin', 'bounce', 'pulse', 'shake', 'wiggle', 'glow']) {
    const anim = await animatedEmoji(img.buffer, a);
    assert.equal(anim.ext, 'gif');
    assert.ok(anim.buffer.length < 256 * 1024, `${a}: ${anim.buffer.length}`);
  }
  await assert.rejects(generateImage({ openaiKey: '' }, 'x'), /no_openai_key/);
});
