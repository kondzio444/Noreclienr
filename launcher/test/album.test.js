'use strict';
// The Album look: tokens in sync with design/, self-hosted fonts under CSP, every asset a stylesheet
// points at exists, and the event calendar (forced on by date, intensity only).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const R = path.join(__dirname, '..', 'src', 'renderer');
const read = (f) => fs.readFileSync(path.join(R, f), 'utf8');

test('renderer tokens.css is the generated design/tokens.css', () => {
  const sync = require('../scripts/sync-tokens');
  if (!fs.existsSync(sync.SRC)) return; // packaged outside the monorepo
  assert.strictEqual(fs.readFileSync(sync.DST, 'utf8'), sync.expected(), 'run node scripts/sync-tokens.js');
});

test('fonts are self-hosted woff2 with their OFL licences, nothing remote', () => {
  const fonts = read('fonts.css');
  for (const fam of ['DelaGothicOne', 'Onest', 'PixelifySans']) {
    for (const sub of ['latin', 'latin-ext']) assert.ok(fs.existsSync(path.join(R, 'assets', 'fonts', `${fam}-${sub}.woff2`)), `${fam}-${sub}`);
    assert.ok(fs.existsSync(path.join(R, 'assets', 'fonts', `OFL-${fam}.txt`)), `OFL for ${fam}`);
  }
  for (const f of fs.readdirSync(R).filter(f => f.endsWith('.css'))) {
    const css = read(f);
    assert.ok(!/@import\s+url\(\s*['"]?https?:/i.test(css) && !/url\(\s*['"]?https?:\/\/fonts\./i.test(css), `${f} loads a remote font`);
    assert.ok(!/Archivo|Silkscreen|'Inter'/.test(css), `${f} still names a retired face`);
  }
  assert.match(fonts, /Dela Gothic One/);
  for (const html of ['index.html', 'updater.html']) assert.match(read(html), /font-src 'self'/);
});

test('every local url() in the stylesheets exists', () => {
  for (const f of fs.readdirSync(R).filter(f => f.endsWith('.css'))) {
    for (const m of read(f).matchAll(/url\(\s*['"]?((?:assets|fonts)\/[^'")]+)['"]?\s*\)/g)) {
      assert.ok(fs.existsSync(path.join(R, m[1])), `${f}: ${m[1]}`);
    }
  }
});

test('index.html loads the Album stylesheets and the events script before app.js', () => {
  const html = read('index.html');
  const order = ['tokens.css', 'fonts.css', 'styles.css', 'album.css', 'events.css', 'motion.css'].map(f => html.indexOf(`href="${f}"`));
  order.forEach((i) => assert.ok(i > 0));
  assert.deepStrictEqual([...order].sort((a, b) => a - b), order);
  assert.ok(html.indexOf('js/events.js') < html.indexOf('js/app.js'));
});

function loadEvents() {
  const sandbox = {
    window: { addEventListener() {} }, document: { documentElement: { dataset: {}, style: { setProperty() {} } }, body: { classList: { toggle() {}, contains: () => false } }, getElementById: () => null, querySelector: () => null, querySelectorAll: () => [] },
    plural: (n, a, b, c) => (n === 1 ? a : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? b : c),
    performance: { now: () => 0 }, setTimeout, clearTimeout, setInterval() {}, requestAnimationFrame() {}, Date,
  };
  vm.createContext(sandbox);
  vm.runInContext(read('js/events.js') + '\nthis.Events = Events;', sandbox);
  return sandbox.Events;
}

test('event calendar: Halloween 15.10–3.11, winter from 10.12.2026, nothing in between', () => {
  const E = loadEvents();
  const at = (y, m, d) => E.byDate(new Date(y, m - 1, d, 12));
  assert.strictEqual(at(2026, 10, 14), null);
  assert.strictEqual(at(2026, 10, 15), 'halloween');
  assert.strictEqual(at(2026, 10, 30), 'halloween');
  assert.strictEqual(at(2026, 11, 3), 'halloween');
  assert.strictEqual(at(2026, 11, 4), null);
  assert.strictEqual(at(2026, 12, 9), null);
  assert.strictEqual(at(2026, 12, 10), 'winter');
  assert.strictEqual(at(2027, 1, 6), 'winter');
  assert.strictEqual(at(2027, 1, 7), null);
  assert.strictEqual(at(2025, 12, 20), null, 'the winter series starts in 2026');
  assert.strictEqual(E.leftText('halloween', new Date(2026, 9, 30, 12)), '4 dni');
  assert.strictEqual(E.leftText('halloween', new Date(2026, 10, 3, 12)), '11 h');
});

test('event intensity is clamped to 25–100 % (events cannot be switched off)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'store.js'), 'utf8');
  assert.match(src, /eventFx: 100/);
  assert.match(src, /Math\.max\(25, Math\.min\(100/);
  const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'main.js'), 'utf8');
  assert.match(main, /patch\.eventFx = Math\.max\(25, Math\.min\(100/);
});
