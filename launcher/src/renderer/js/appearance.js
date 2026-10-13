'use strict';
/* Appearance: accent colour presets, page transitions and the background (Settings → Wygląd). */

const ACCENTS = {
  orange: { name: 'Nore Orange', a: '#ff8a1f', b: '#ffb547', d: '#ff5a1a' },
  crimson: { name: 'Crimson', a: '#ff4d5e', b: '#ff8a8a', d: '#d61f3c' },
  violet: { name: 'Violet', a: '#a96bff', b: '#c9a4ff', d: '#7a3df0' },
  ocean: { name: 'Ocean', a: '#2fa8ff', b: '#7fd0ff', d: '#1a6dff' },
  emerald: { name: 'Emerald', a: '#2fd88f', b: '#8af0c0', d: '#11a06a' },
  sakura: { name: 'Sakura', a: '#ff6bc1', b: '#ffadd9', d: '#d63d93' },
  gold: { name: 'Gold', a: '#ffc23d', b: '#ffe08a', d: '#e09400' },
  ice: { name: 'Ice', a: '#7fe3ff', b: '#c4f3ff', d: '#3cb8e0' },
};

const TRANSITIONS = [['rise', 'Unoszenie'], ['fade', 'Zanikanie'], ['slide', 'Przesuwanie'], ['zoom', 'Przybliżenie'], ['blur', 'Rozmycie']];

const SCENE_PREVIEW = {
  photo: 'url(assets/background.jpg) center/cover',
  aurora: 'linear-gradient(180deg,#07060a 20%,rgba(var(--accent-rgb),.55) 55%,rgba(120,80,255,.35) 70%,#120c08)',
  space: 'radial-gradient(circle at 70% 30%,rgba(var(--accent-rgb),.5),transparent 45%),radial-gradient(circle at 20% 80%,rgba(120,60,255,.4),transparent 45%),#05040a',
  cubes: 'linear-gradient(135deg,#7cbd4b 0 18%,transparent 18% 40%,#8a8a8a 40% 52%,transparent 52% 72%,rgba(var(--accent-rgb),.8) 72% 84%,transparent 84%),#120d0a',
  grid: 'linear-gradient(180deg,#09060f 0 45%,rgba(var(--accent-rgb),.7) 50%,#07050a 52%),repeating-linear-gradient(90deg,rgba(var(--accent-rgb),.5) 0 1px,transparent 1px 14px)',
  waves: 'radial-gradient(120% 60% at 50% 100%,rgba(var(--accent-rgb),.6),transparent 60%),linear-gradient(135deg,#0d0907,#1d120b)',
  minimal: 'linear-gradient(160deg,#1a130f,#0b0908)',
  custom: 'repeating-linear-gradient(45deg,rgba(255,255,255,.05) 0 8px,transparent 8px 16px),#141010',
};

let customBgData = null;

function hexRgb(h) {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

async function applyAppearance(s, { reloadCustom = false } = {}) {
  const ac = ACCENTS[s.accentPreset] || ACCENTS.orange;
  const root = document.documentElement.style;
  root.setProperty('--accent', ac.a);
  root.setProperty('--accent-2', ac.b);
  root.setProperty('--accent-deep', ac.d);
  root.setProperty('--accent-rgb', hexRgb(ac.a).join(', '));
  document.body.dataset.trans = s.pageTransition || 'rise';
  if (s.bgScene === 'custom' && (reloadCustom || !customBgData)) customBgData = await nore.background.custom().catch(() => null);
  Background.apply({
    scene: s.bgScene === 'custom' && !customBgData ? 'photo' : (s.bgScene || 'photo'),
    custom: customBgData, particles: s.bgParticles || 'embers', motion: s.bgMotion || 'kenburns',
    density: s.bgDensity == null ? 1 : s.bgDensity, dim: s.bgDim == null ? 55 : s.bgDim, blur: s.bgBlur || 0, speed: s.bgSpeed || 1,
  });
}

/** "Wygląd" card shown at the top of the settings page. */
function appearanceCard(root) {
  const s = App.state.settings;
  const card = el(`<div class="card panel look-card">
    <div class="section-title">${icon('sparkles')} Wygląd launchera</div>
    <div class="look-label">Tło</div>
    <div class="scene-grid">${Background.SCENES.map(sc => `<button class="scene-tile ${sc.id === s.bgScene ? 'on' : ''}" data-scene="${sc.id}">
      <span class="prev" style="background:${SCENE_PREVIEW[sc.id]}"></span><b>${esc(sc.name)}</b><small>${esc(sc.desc)}</small>
      ${sc.id === 'custom' ? `<span class="pick">${icon('upload')}</span>` : ''}</button>`).join('')}</div>
    <div class="look-row">
      <div class="look-col"><div class="look-label">Efekty na tle</div><div class="chips" id="lk-part">${Background.PARTICLES.map(([v, l]) => `<button class="lchip ${v === s.bgParticles ? 'on' : ''}" data-v="${v}">${l}</button>`).join('')}</div></div>
      <div class="look-col"><div class="look-label">Ruch zdjęcia</div><div class="chips" id="lk-motion">${Background.MOTIONS.map(([v, l]) => `<button class="lchip ${v === s.bgMotion ? 'on' : ''}" data-v="${v}">${l}</button>`).join('')}</div></div>
    </div>
    <div class="look-sliders">
      <label><span>Przyciemnienie <i id="lk-dimv"></i></span><input type="range" class="slider" id="lk-dim" min="0" max="90" step="5" value="${s.bgDim}"></label>
      <label><span>Rozmycie <i id="lk-blurv"></i></span><input type="range" class="slider" id="lk-blur" min="0" max="16" step="1" value="${s.bgBlur}"></label>
      <label><span>Ilość efektów <i id="lk-denv"></i></span><input type="range" class="slider" id="lk-den" min="0.2" max="2.5" step="0.1" value="${s.bgDensity}"></label>
      <label><span>Prędkość animacji <i id="lk-spdv"></i></span><input type="range" class="slider" id="lk-spd" min="0.25" max="2.5" step="0.25" value="${s.bgSpeed}"></label>
    </div>
    <div class="look-row">
      <div class="look-col"><div class="look-label">Kolor akcentu</div><div class="swatches" id="lk-acc">${Object.entries(ACCENTS).map(([k, a]) => `<button class="swatch ${k === s.accentPreset ? 'on' : ''}" data-v="${k}" title="${esc(a.name)}" style="--c1:${a.b};--c2:${a.d}"></button>`).join('')}</div></div>
      <div class="look-col"><div class="look-label">Przejścia stron</div><div class="chips" id="lk-trans">${TRANSITIONS.map(([v, l]) => `<button class="lchip ${v === (s.pageTransition || 'rise') ? 'on' : ''}" data-v="${v}">${l}</button>`).join('')}</div></div>
    </div>
  </div>`);

  const save = async (patch, opts) => {
    App.state.settings = await nore.setSettings(patch);
    await applyAppearance(App.state.settings, opts);
  };
  $$('.scene-tile', card).forEach(t => t.onclick = async () => {
    const id = t.dataset.scene;
    if (id === 'custom' && (!App.state.settings.bgCustom || t.classList.contains('on'))) {
      try {
        const data = await nore.background.pick();
        if (!data) return;
        App.state = await nore.state();
        customBgData = data;
      } catch (e) { return errorToast(e, 'Tło'); }
    } else {
      await save({ bgScene: id });
    }
    await applyAppearance(App.state.settings);
    $$('.scene-tile', card).forEach(x => x.classList.toggle('on', x.dataset.scene === App.state.settings.bgScene));
    t.classList.add('pulse'); setTimeout(() => t.classList.remove('pulse'), 500);
  });
  const chipGroup = (id, key) => $$(`#${id} .lchip`, card).forEach(b => b.onclick = () => {
    $$(`#${id} .lchip`, card).forEach(x => x.classList.toggle('on', x === b));
    save({ [key]: b.dataset.v });
    if (key === 'pageTransition') go('settings');
  });
  chipGroup('lk-part', 'bgParticles');
  chipGroup('lk-motion', 'bgMotion');
  chipGroup('lk-trans', 'pageTransition');
  $$('#lk-acc .swatch', card).forEach(b => b.onclick = () => {
    $$('#lk-acc .swatch', card).forEach(x => x.classList.toggle('on', x === b));
    save({ accentPreset: b.dataset.v });
  });
  const slider = (id, key, fmt) => {
    const r = $('#' + id, card), v = $('#' + id + 'v', card);
    const upd = () => { v.textContent = fmt(+r.value); sliderFill(r); };
    r.oninput = () => { upd(); Background.apply({ [{ bgDim: 'dim', bgBlur: 'blur', bgDensity: 'density', bgSpeed: 'speed' }[key]]: +r.value }); };
    r.onchange = () => save({ [key]: +r.value });
    upd();
  };
  slider('lk-dim', 'bgDim', v => v + '%');
  slider('lk-blur', 'bgBlur', v => v + ' px');
  slider('lk-den', 'bgDensity', v => '×' + v.toFixed(1));
  slider('lk-spd', 'bgSpeed', v => '×' + v.toFixed(2).replace(/0$/, ''));
  return card;
}

const _settingsWithLook = Pages.settings;
Pages.settings = (root) => {
  const cleanup = _settingsWithLook(root);
  const head = $('.page-head', root);
  if (head) head.after(appearanceCard(root));
  return cleanup;
};
