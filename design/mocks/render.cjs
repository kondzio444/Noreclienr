#!/usr/bin/env node
// Renders every mock to design/mocks/png/ with Playwright's Chromium.
//   node design/mocks/render.cjs            -> all
//   node design/mocks/render.cjs launcher   -> only jobs whose file name contains "launcher"
// Needs playwright (global install is fine: NODE_PATH or the fallback path below) and network for Google Fonts.
const path = require('path');
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const D = __dirname;
// [html, png, width, height, deviceScaleFactor, fullPage]
const JOBS = [
  ['web-home.html', 'web-home-1440.png', 1440, 900, 1, true],
  ['web-home.html', 'web-home-390.png', 390, 844, 2, true],
  ['web-api.html', 'web-api-1440.png', 1440, 900, 1, true],
  ['web-api.html', 'web-api-390.png', 390, 844, 2, true],
  ['web-panel.html', 'web-panel-1440.png', 1440, 900, 1, true],
  ['web-panel.html', 'web-panel-390.png', 390, 844, 2, true],
  ['launcher-home.html', 'launcher-home.png', 1280, 800, 1, false],
  ['launcher-instance.html', 'launcher-instance.png', 1280, 800, 1, false],
  ['launcher-settings.html', 'launcher-settings.png', 1280, 800, 1, false],
  ['launcher-login.html', 'launcher-login.png', 1280, 800, 1, false],
  ['launcher-home-halloween.html', 'launcher-home-halloween.png', 1280, 800, 1, false],
  ['installer.html', 'installer-welcome.png', 497, 390, 2, false, '#welcome'],
  ['installer.html', 'installer-progress.png', 497, 390, 2, false, '#progress'],
  ['updater.html', 'updater.png', 400, 480, 2, false],
  // in-game: GUI scale 3 -> 1600x900 device pixels from a 533x300 GUI canvas
  ['game-main-menu.html', 'game-main-menu.png', 533, 300, 3, false],
  ['game-clickgui.html', 'game-clickgui.png', 533, 300, 3, false],
  ['game-pause.html', 'game-pause.png', 533, 300, 3, false],
  ['game-main-menu-halloween.html', 'game-main-menu-halloween.png', 533, 300, 3, false],
];

(async () => {
  const only = process.argv[2];
  const b = await chromium.launch();
  for (const [f, o, w, h, sc, full, hash] of JOBS) {
    if (only && !f.includes(only) && !o.includes(only)) continue;
    if (!require('fs').existsSync(path.join(D, f))) { console.log('skip (missing)', f); continue; }
    const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: sc });
    p.on('pageerror', e => console.log('PAGEERR', f, e.message));
    p.on('requestfailed', r => console.log('REQFAIL', f, r.url().slice(0, 100)));
    await p.goto('file://' + path.join(D, f) + (hash || ''), { waitUntil: 'networkidle' }).catch(e => console.log(e.message));
    await p.evaluate(() => document.fonts.ready);
    // settle entrance motion so the capture shows the resting state
    await p.addStyleTag({ content: '.enter > *, [data-anim] { animation-delay: 0s !important; animation-duration: 0s !important; }' });
    await p.waitForTimeout(900);
    await p.screenshot({ path: path.join(D, 'png', o), fullPage: !!full });
    console.log('ok', o);
    await p.close();
  }
  await b.close();
})();
