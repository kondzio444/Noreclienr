'use strict';
/*
 * Nore events (DESIGN.md §9). Forced on by date – there is no switch, only an intensity setting
 * (Settings → Wydarzenia, 25–100 %):
 *   Halloween 2026 "Zgaszone światło": 15.10 – 3.11. Lights out: the page goes black (#0b0a0c), the pointer
 *     carries a warm torch, sticker art dims away from it, glow-in-the-dark stickers charge under it,
 *     bats, a spider on a thread, a phosphor cobweb, the event poster with a countdown on Start.
 *   Winter "Seria zimowa": from 10.12.2026 (every year 10.12 – 6.01). Frost in the page corners,
 *     a string of light dots along the title bar, hole-punch confetti snow, foil stickers on the poster.
 * The palette shift itself is tokens.css: [data-event="halloween" | "winter"] on <html>.
 * Reveal storyboards (design/README.md): Halloween 1400 ms (flicker → palette → glow → torch),
 * winter 1400 ms (frost → lights → snow). Reduced motion: a 200 ms crossfade, no particles.
 */
const Events = (() => {
  const WINTER_FROM = new Date(2026, 11, 10).getTime();
  const KEY_PREVIEW = 'nore.event.preview';
  const KEY_SEEN = 'nore.event.revealed';
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
  const ls = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } },
  };
  const ss = {
    get(k) { try { return sessionStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { if (v == null) sessionStorage.removeItem(k); else sessionStorage.setItem(k, v); } catch { /* storage unavailable */ } },
  };

  // ---------------------------------------------------------------- calendar

  /** Which event runs on date d: 'halloween', 'winter' or null. */
  function byDate(d = new Date()) {
    const m = d.getMonth(), day = d.getDate();
    if ((m === 9 && day >= 15) || (m === 10 && day <= 3)) return 'halloween';
    if (d.getTime() >= WINTER_FROM && ((m === 11 && day >= 10) || (m === 0 && day <= 6))) return 'winter';
    return null;
  }
  /** A developer preview (sessionStorage, never persisted) wins over the calendar. */
  function current(d) {
    const p = ss.get(KEY_PREVIEW);
    if (p === 'halloween' || p === 'winter') return p;
    if (p === 'none') return null;
    return byDate(d);
  }
  function endOf(id, now = new Date()) {
    if (id === 'halloween') return new Date(now.getMonth() === 9 || now.getMonth() === 10 ? now.getFullYear() : now.getFullYear() + 1, 10, 3, 23, 59, 59, 999);
    if (id === 'winter') return new Date(now.getMonth() === 0 ? now.getFullYear() : now.getFullYear() + 1, 0, 6, 23, 59, 59, 999);
    return null;
  }
  /** "6 dni", "1 dzień", "14 h", "ostatnia godzina" */
  function leftText(id, now = new Date()) {
    const end = endOf(id, now);
    if (!end) return '';
    const ms = end - now;
    const days = Math.floor(ms / 86400000);
    if (days >= 1) return `${days} ${plural(days, 'dzień', 'dni', 'dni')}`;
    const h = Math.floor(ms / 3600000);
    return h >= 1 ? `${h} h` : 'ostatnia godzina';
  }
  function daysTo(month, day, now = new Date()) {
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    let t = new Date(now.getFullYear(), month, day);
    if (t < today) t = new Date(now.getFullYear() + 1, month, day);
    return Math.round((t - today) / 86400000);
  }

  // ---------------------------------------------------------------- settings: intensity + sound

  const settings = () => (typeof App === 'object' && App.state && App.state.settings) || {};
  /** Effects intensity 0.25 – 1 (events cannot be disabled). */
  const fx = () => clamp((Number(settings().eventFx) || 100) / 100, 0.25, 1);
  const quiet = () => document.body.classList.contains('no-anim');
  const still = () => quiet() || (typeof Motion === 'object' && Motion.reduced());

  // ---------------------------------------------------------------- sound cues (synthesized, no assets)

  let actx = null;
  function audio() {
    if (settings().eventSound === false) return null;
    try { actx = actx || new AudioContext(); if (actx.state === 'suspended') actx.resume(); return actx; } catch { return null; }
  }
  function noiseBurst(a, t, dur, gain, freq) {
    const n = Math.round(a.sampleRate * dur), buf = a.createBuffer(1, n, a.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n) ** 2;
    const src = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain();
    src.buffer = buf; f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = 0.8; g.gain.value = gain;
    src.connect(f).connect(g).connect(a.destination); src.start(t);
  }
  function tone(a, t, freq, dur, gain, type = 'sine') {
    const o = a.createOscillator(), g = a.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(a.destination); o.start(t); o.stop(t + dur + 0.05);
  }
  const sounds = {
    lightSwitch() { const a = audio(); if (!a) return; const t = a.currentTime; noiseBurst(a, t, 0.025, 0.5, 2400); noiseBurst(a, t + 0.03, 0.02, 0.25, 1600); },
    hum() { const a = audio(); if (!a) return; const t = a.currentTime; tone(a, t, 55, 1.2, 0.035, 'sawtooth'); tone(a, t, 110, 1.2, 0.02); },
    crackle() { const a = audio(); if (!a) return; const t = a.currentTime; for (let i = 0; i < 9; i++) noiseBurst(a, t + i * 0.05 + Math.random() * 0.03, 0.012, 0.14, 5200); },
    bell() { const a = audio(); if (!a) return; const t = a.currentTime; tone(a, t, 1318.5, 1.4, 0.05); tone(a, t, 2637, 0.8, 0.015); },
  };

  // ---------------------------------------------------------------- shared helpers

  const main = () => document.getElementById('main');
  const view = () => document.getElementById('view');
  let layer = null; // #ev-layer: behind #view, over the page background
  let over = null;  // #ev-over: above #view, never catches the pointer
  function ensureLayers() {
    const m = main();
    if (!m) return;
    if (!layer || !layer.isConnected) { layer = el('<div id="ev-layer" aria-hidden="true"></div>'); m.insertBefore(layer, m.firstChild); }
    if (!over || !over.isConnected) { over = el('<div id="ev-over" aria-hidden="true"></div>'); m.appendChild(over); }
  }
  function clearLayers() { if (layer) layer.innerHTML = ''; if (over) over.innerHTML = ''; }

  // pointer, followed with a lerp of 0.18 per frame (instant under reduced motion)
  const ptr = { x: 640, y: 360, tx: 640, ty: 360, inside: false };
  window.addEventListener('pointermove', (e) => {
    const m = main(); if (!m) return;
    const r = m.getBoundingClientRect();
    ptr.tx = e.clientX - r.left; ptr.ty = e.clientY - r.top; ptr.inside = ptr.tx >= 0;
  }, { passive: true });

  // ================================================================ Halloween: lights out

  const Lights = (() => {
    let on = false, raf = 0, last = 0, torch = null, dust = null, dctx = null, motes = [], bats = [], arts = [], glows = [], scan = 0, mo = null;
    const ART = '.h-recent .sticker, .h-album .sticker:not(.glow), .clip, .pc-banner, .ibanner, .picon, .shot img, .ga-item img, .world-icon, .icard .inst-icon, .fx-body';

    function build() {
      ensureLayers();
      clearLayers();
      layer.innerHTML = `<div class="ev-torch"></div><canvas class="ev-dust"></canvas>
        <svg class="ev-web" viewBox="0 0 230 200" fill="none" stroke-width="1.2" stroke-linecap="round">
          <path pathLength="1" d="M230 0 L120 200 M230 0 L40 130 M230 0 L0 40 M230 0 L170 200"/>
          <path pathLength="1" d="M205 0 Q200 22 220 45 Q203 38 188 42 Q190 25 205 0"/>
          <path pathLength="1" d="M168 0 Q166 40 198 85 Q170 72 145 80 Q130 60 112 55 Q140 30 168 0"/>
          <path pathLength="1" d="M128 0 Q130 60 176 128 Q140 112 104 122 Q86 92 60 84 Q100 45 128 0"/></svg>`;
      over.innerHTML = `<div class="ev-spider"><i></i><img src="assets/album/spider.png" alt=""></div>`
        + [0, 1, 2].map(i => `<img class="ev-bat" data-i="${i}" src="assets/album/bat.png" alt="">`).join('');
      torch = layer.querySelector('.ev-torch');
      dust = layer.querySelector('.ev-dust');
      dctx = dust.getContext('2d');
      bats = [...over.querySelectorAll('.ev-bat')].map((b, i) => ({ el: b, ph: i * 2.1 + Math.random(), sp: 0.00011 + i * 0.00002, cx: 0.35 + i * 0.22, cy: 0.18 + (i % 2) * 0.32, ax: 0.16 + i * 0.03, ay: 0.08 }));
      motes = Array.from({ length: 12 }, () => ({ a: Math.random() * 6.28, r: Math.random(), s: 0.3 + Math.random() * 0.7, z: Math.random() }));
      rescan();
    }
    function rescan() {
      const v = view();
      arts = v ? [...v.querySelectorAll(ART)] : [];
      glows = [...document.querySelectorAll('#view .glow')];
      arts.forEach(a => a.classList.add('ev-dimmable'));
    }

    function frame(t) {
      raf = requestAnimationFrame(frame);
      if (document.hidden) return;
      const dt = Math.min(0.05, (t - (last || t)) / 1000); last = t;
      const k = still() ? 1 : 1 - Math.pow(1 - 0.18, dt * 60);
      ptr.x = lerp(ptr.x, ptr.tx, k); ptr.y = lerp(ptr.y, ptr.ty, k);
      const m = main(); if (!m) return;
      const mr = m.getBoundingClientRect();
      m.style.setProperty('--tx', ptr.x.toFixed(1) + 'px');
      m.style.setProperty('--ty', ptr.y.toFixed(1) + 'px');
      if (t - scan > 600) { scan = t; rescan(); }
      // sticker art dims with distance from the torch (text and controls never do)
      const lo = 1 - 0.42 * fx();
      for (const a of arts) {
        const r = a.getBoundingClientRect();
        if (!r.width) continue;
        const d = Math.hypot(r.left + r.width / 2 - mr.left - ptr.x, r.top + r.height / 2 - mr.top - ptr.y);
        const v = lo + (1 - lo) * (1 - smooth(140, 440, d));
        const s = v.toFixed(2);
        if (a._dim !== s) { a._dim = s; a.style.setProperty('--dim', s); }
      }
      // glow stickers charge under the torch and fade back over ~4 s
      const now = performance.now();
      for (const g of glows) {
        const r = g.getBoundingClientRect();
        const d = Math.hypot(r.left + r.width / 2 - mr.left - ptr.x, r.top + r.height / 2 - mr.top - ptr.y);
        if (d < 150) g._charged = now;
        const c = g._charged && now - g._charged < 4000;
        if (!!g._c !== !!c) { g._c = c; g.classList.toggle('charged', !!c); }
      }
      // dust motes inside the cone (≤ 12, none under reduced motion)
      const W = m.clientWidth, H = m.clientHeight, dpr = Math.min(1.5, devicePixelRatio || 1);
      if (dust.width !== Math.round(W * dpr)) { dust.width = Math.round(W * dpr); dust.height = Math.round(H * dpr); }
      dctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      dctx.clearRect(0, 0, W, H);
      const n = still() ? 0 : Math.round(12 * fx());
      for (let i = 0; i < n; i++) {
        const p = motes[i];
        p.a += dt * 0.25 * p.s; p.r = (p.r + dt * 0.04 * p.s) % 1;
        const rad = 40 + p.r * 220;
        const x = ptr.x + Math.cos(p.a) * rad, y = ptr.y + Math.sin(p.a * 1.3) * rad * 0.7 - p.r * 30;
        dctx.globalAlpha = 0.5 * (1 - p.r) * (0.4 + 0.6 * p.z);
        dctx.fillStyle = '#ffeccc';
        dctx.fillRect(x, y, 1.5 + p.z, 1.5 + p.z);
      }
      dctx.globalAlpha = 1;
      // bats on slow figure-eights (2, or 3 at full intensity)
      const nb = still() ? 0 : fx() > 0.6 ? 3 : 2;
      bats.forEach((b, i) => {
        b.el.hidden = i >= nb;
        if (i >= nb) return;
        const ph = b.ph + t * b.sp * 6.28;
        const x = (b.cx + Math.sin(ph) * b.ax) * W, y = (b.cy + Math.sin(ph * 2) * b.ay) * H;
        const vx = Math.cos(ph);
        b.el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) scaleX(${vx < 0 ? -1 : 1}) rotate(${(Math.sin(ph * 2) * 8).toFixed(1)}deg)`;
      });
    }

    function start() {
      if (on) return;
      on = true;
      build();
      if (!raf) raf = requestAnimationFrame(frame);
      const v = view();
      if (v && !mo) { mo = new MutationObserver(() => { scan = 0; }); mo.observe(v, { childList: true, subtree: true }); }
    }
    function stop() {
      on = false;
      cancelAnimationFrame(raf); raf = 0;
      if (mo) { mo.disconnect(); mo = null; }
      document.querySelectorAll('.ev-dimmable').forEach(a => { a.classList.remove('ev-dimmable'); a.style.removeProperty('--dim'); });
      clearLayers();
    }
    return { start, stop, rescan, get on() { return on; } };
  })();

  // ================================================================ Winter: frost, light dots, confetti snow

  const Winter = (() => {
    let on = false, raf = 0, last = 0, snow = null, sctx = null, flakes = [], t0 = 0;
    const LIGHTS = ['var(--nore-winter-light-red)', 'var(--nore-winter-light-green)', 'var(--nore-winter-light-gold)', 'var(--nore-winter-light-blue)'];
    function build() {
      ensureLayers();
      clearLayers();
      layer.innerHTML = '<i class="ev-frost tl"></i><i class="ev-frost tr"></i><i class="ev-frost bl"></i><i class="ev-frost br"></i>';
      over.innerHTML = '<canvas class="ev-snow"></canvas>';
      const bar = document.getElementById('titlebar');
      if (bar && !bar.querySelector('.ev-lights')) {
        const n = 22;
        let html = '<svg class="wire" viewBox="0 0 1000 20" preserveAspectRatio="none"><path d="M0 4 ';
        for (let i = 1; i <= 11; i++) html += `Q${(i - 0.5) * 90.9} 18 ${i * 90.9} 4 `;
        html += '"/></svg>';
        for (let i = 0; i < n; i++) {
          const x = (i + 0.5) / n;
          const sag = Math.sin(((x * 11) % 1) * Math.PI) * 9;
          html += `<i style="left:${(x * 100).toFixed(2)}%;top:${(3 + sag).toFixed(1)}px;--c:${LIGHTS[i % 4]};--i:${i}"></i>`;
        }
        bar.insertAdjacentHTML('beforeend', `<div class="ev-lights" aria-hidden="true">${html}</div>`);
      }
      snow = over.querySelector('.ev-snow');
      sctx = snow.getContext('2d');
      flakes = Array.from({ length: 40 }, () => ({ x: Math.random(), y: Math.random() * 1.1 - 0.1, r: 2.2 + Math.random() * 1.8, vy: 0.018 + Math.random() * 0.02, ph: Math.random() * 6.28, sp: 0.5 + Math.random() * 0.6, tone: Math.random() }));
    }
    function frame(t) {
      raf = requestAnimationFrame(frame);
      if (document.hidden) return;
      const dt = Math.min(0.05, (t - (last || t)) / 1000); last = t;
      const m = main(); if (!m || !snow) return;
      const W = m.clientWidth, H = m.clientHeight, dpr = Math.min(1.5, devicePixelRatio || 1);
      if (snow.width !== Math.round(W * dpr)) { snow.width = Math.round(W * dpr); snow.height = Math.round(H * dpr); }
      sctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      sctx.clearRect(0, 0, W, H);
      if (still()) return;
      // density ramps up over 2 s after the reveal
      const ramp = clamp((t - t0) / 2000, 0.25, 1);
      const n = Math.round(40 * fx() * ramp);
      for (let i = 0; i < n; i++) {
        const f = flakes[i];
        f.y += f.vy * dt * f.sp * 2.2; f.ph += dt * f.sp;
        if (f.y > 1.05) { f.y = -0.05; f.x = Math.random(); }
        const x = (f.x + Math.sin(f.ph) * 0.01) * W, y = f.y * H;
        // hole-punch confetti: paper circles from the album's own puncher
        sctx.fillStyle = f.tone > 0.7 ? '#e8e5e0' : '#e9f4ff';
        sctx.globalAlpha = 0.85;
        sctx.beginPath(); sctx.arc(x, y, f.r, 0, 6.283); sctx.fill();
        sctx.globalAlpha = 0.25; sctx.fillStyle = '#000';
        sctx.beginPath(); sctx.arc(x + 0.8, y + 1, f.r, 0, 6.283); sctx.fill();
      }
      sctx.globalAlpha = 1;
    }
    function start() {
      if (on) return;
      on = true; t0 = performance.now();
      build();
      if (!raf) raf = requestAnimationFrame(frame);
    }
    function stop() {
      on = false;
      cancelAnimationFrame(raf); raf = 0;
      const l = document.querySelector('#titlebar .ev-lights'); if (l) l.remove();
      clearLayers();
    }
    return { start, stop, get on() { return on; } };
  })();

  // ================================================================ reveal storyboards

  let revealing = null;
  function overlay() {
    let o = document.getElementById('ev-dim');
    if (!o) { o = el('<div id="ev-dim" aria-hidden="true"></div>'); document.body.appendChild(o); }
    return o;
  }
  /** Halloween: two flickers like a failing bulb, the palette crossfades, glow stickers fade in, the web
      draws, the spider drops, then the torch fades in and the bats fly. */
  function revealHalloween({ palette = true } = {}) {
    clearTimeout(revealing);
    const o = overlay();
    const root = document.documentElement;
    if (still()) {
      if (palette) root.dataset.event = 'halloween';
      Motion.animate(o, [{ opacity: 0.6 }, { opacity: 0 }], { duration: 200, easing: 'linear' });
      return;
    }
    sounds.lightSwitch();
    Motion.animate(o, [
      { opacity: 0, offset: 0 }, { opacity: 0.65, offset: 0.08 }, { opacity: 0.1, offset: 0.14 }, { opacity: 0.8, offset: 0.19 },
      { opacity: 0.8, offset: 0.24 }, { opacity: 0, offset: 0.5 }, { opacity: 0, offset: 1 },
    ], { duration: Motion.ms('--nore-dur-reveal'), easing: 'linear' });
    document.body.classList.add('ev-revealing');
    if (palette) delete root.dataset.event;
    setTimeout(() => { if (palette) root.dataset.event = 'halloween'; sounds.hum(); }, 260);
    setTimeout(() => {
      document.querySelectorAll('#view .glow').forEach((g, i) => { g.style.animationDelay = ''; g.classList.remove('glow-in'); void g.offsetWidth; g.style.setProperty('--gi', i); g.classList.add('glow-in'); });
      const web = document.querySelector('#ev-layer .ev-web'); if (web) { web.classList.remove('draw'); void web.getBoundingClientRect(); web.classList.add('draw'); }
      const sp = document.querySelector('#ev-over .ev-spider'); if (sp) { sp.classList.remove('drop'); void sp.offsetWidth; sp.classList.add('drop'); }
    }, 700);
    revealing = setTimeout(() => document.body.classList.remove('ev-revealing'), 1400);
  }
  /** Winter: frost grows from the corners, light dots switch on one by one (bell at the last), snow ramps up. */
  function revealWinter() {
    clearTimeout(revealing);
    const root = document.documentElement;
    root.dataset.event = 'winter';
    if (still()) { Motion.animate(overlay(), [{ opacity: 0.5 }, { opacity: 0 }], { duration: 200, easing: 'linear' }); return; }
    sounds.crackle();
    document.body.classList.add('ev-revealing');
    setTimeout(sounds.bell, 400 + 22 * 60);
    revealing = setTimeout(() => document.body.classList.remove('ev-revealing'), 1800);
  }

  // ================================================================ apply / switch

  let active;
  /** The reveal plays on the first launch in the event (per year) and whenever the event page opens. */
  function maybeReveal() {
    if (!active) return;
    const seenKey = `${KEY_SEEN}.${active}.${new Date().getFullYear()}`;
    if (ls.get(seenKey) && !ss.get(KEY_PREVIEW)) return;
    ls.set(seenKey, '1');
    if (active === 'halloween') revealHalloween(); else revealWinter();
  }
  function apply({ reveal = false } = {}) {
    const id = current();
    const root = document.documentElement;
    root.style.setProperty('--ev-fx', fx().toFixed(2));
    if (id === active) return;
    if (active === 'halloween') Lights.stop();
    if (active === 'winter') Winter.stop();
    active = id;
    document.body.classList.toggle('halloween', id === 'halloween');
    document.body.classList.toggle('winter', id === 'winter');
    if (id) root.dataset.event = id; else delete root.dataset.event;
    if (id === 'halloween') Lights.start();
    if (id === 'winter') Winter.start();
    renderRail();
    if (reveal) maybeReveal();
    if (typeof Halloween === 'object' && Halloween.applyTheme) Halloween.applyTheme();
  }

  function renderRail() {
    const a = document.querySelector('a[data-page="halloween"]');
    if (!a) return;
    const on = active === 'halloween';
    if (a.hidden === on) { a.hidden = !on; if (typeof moveIndicator === 'function') setTimeout(moveIndicator); }
    const svg = a.querySelector('svg');
    if (on && svg) svg.outerHTML = '<img class="ev-ico" src="assets/album/pumpkin.png" alt="">';
    const b = a.querySelector('.badge');
    if (b) railBadge(b);
  }
  function railBadge(b) {
    if (active !== 'halloween') { b.hidden = true; return; }
    b.hidden = false;
    const txt = leftText('halloween');
    if (b.dataset.t !== txt) { b.dataset.t = txt; b.innerHTML = `${esc(txt)}<i class="dot sm event"></i>`; }
  }

  // ================================================================ Start: poster, collection, ghost on the hero

  function poster(id) {
    if (id === 'halloween') {
      const caps = typeof Halloween === 'object' ? Halloween.collection() : [];
      const sum = typeof Halloween === 'object' && Halloween.summary ? Halloween.summary() : null;
      return `<section class="poster hw"><span class="tape kraft"></span><span class="tape kraft r"></span>
        <h3>Halloween 2026</h3>
        <p>Zgaszone światło. Poświeć latarką, a naklejki zaczną świecić. Peleryny zbierasz do 3 listopada.</p>
        <div class="caps">${caps.map((c, i) => c.owned
          ? `<div class="sticker glow" style="--tilt:${['-2deg', '2deg', '-1deg'][i]};background-image:url(${c.img})" title="Peleryna ${esc(c.name)}"></div>`
          : `<div class="slot" title="Peleryna ${esc(c.name)} – poziom ${c.lvl} drogi nagród"><img src="assets/album/${c.ghost}.png" alt=""></div>`).join('')}
          <div class="sticker ink ghosty-card"><img class="glow" src="assets/album/ghost.png" alt=""></div></div>
        <div class="row2"><button class="btn pumpkin sm" data-go="halloween"><img class="candle" src="assets/album/pumpkin.png" alt="">Łap dynie</button>
          <div class="count"><b class="tnum">${esc(leftText('halloween'))}</b>do końca${sum && sum.daily ? ' · nagroda dnia czeka' : ''}</div></div></section>`;
    }
    if (id === 'winter') {
      const dW = daysTo(11, 24), dN = daysTo(0, 1);
      const [big, small] = dW === 0 ? ['Wigilia', 'Wesołych Świąt!'] : dW <= 14 ? [`${dW} ${plural(dW, 'dzień', 'dni', 'dni')}`, 'do Wigilii'] : dN === 0 ? ['Nowy Rok', 'Szczęśliwego!'] : [`${dN} ${plural(dN, 'dzień', 'dni', 'dni')}`, 'do Nowego Roku'];
      return `<section class="poster wt"><span class="tape mint"></span>
        <h3>Seria zimowa</h3>
        <p>Szron na stronach albumu, lampki nad oknem i śnieg z dziurkacza. Zimowe naklejki zbierasz do 6 stycznia.</p>
        <div class="caps"><div class="sticker foil" style="--tilt:-3deg"><img src="assets/album/flake.png" alt=""></div><div class="sticker foil" style="--tilt:2deg"><img src="assets/album/gift.png" alt=""></div><div class="slot"><img src="assets/album/flake.png" alt=""></div></div>
        <div class="row2"><span class="label">${icon('sparkles')} Zawsze włączone</span><div class="count"><b class="tnum">${esc(big)}</b>${esc(small)}</div></div></section>`;
    }
    return '';
  }

  function collectionHtml() {
    const caps = typeof Halloween === 'object' ? Halloween.collection() : [];
    const winterOn = Date.now() >= WINTER_FROM || current() === 'winter';
    const owned = caps.filter(c => c.owned).length;
    const total = caps.length + 2;
    const date = (ts) => { const d = new Date(ts); return `${d.getDate()}.${String(d.getMonth() + 1).padStart(2, '0')}`; };
    const items = caps.map((c, i) => c.owned
      ? `<div class="it"><div class="sticker${active === 'halloween' ? ' glow' : ''}" style="--tilt:${['-2deg', '1deg', '-1deg'][i]};background-image:url(${c.img})"></div><small>${esc(c.name)}${c.at ? ' · ' + date(c.at) : ''}</small></div>`
      : `<div class="it ghost"><div class="slot"><img src="assets/album/${c.ghost}.png" alt=""></div><small>${esc(c.name)}</small></div>`).join('');
    const wint = [['flake', 'Śnieżynka'], ['gift', winterOn ? 'Prezent' : 'od 10.12']].map(([img, n]) => `<div class="it ghost"><div class="slot"><img src="assets/album/${img}.png" alt=""></div><small>${n}</small></div>`).join('');
    return `<h3 class="section-title">Twoja kolekcja${active === 'halloween' ? '<button class="more" data-go="halloween">Droga nagród</button>' : ''}</h3>
      <div class="row">${items}<span class="gap"></span>${wint}<div class="count"><b class="tnum">${owned}/${total}</b>w serii 2026</div></div>`;
  }

  /** Called by Pages.home: fills the poster slot, the collection and the ghost on the hero sticker. */
  function homeSlots(root) {
    const ev = root.querySelector('#h-event');
    if (ev) {
      ev.hidden = !active;
      ev.innerHTML = active ? poster(active) : '';
      ev.querySelectorAll('[data-go]').forEach(b => b.onclick = () => go(b.dataset.go));
      if (active === 'winter') foil(ev);
      if (active === 'halloween') {
        const p = ev.querySelector('.poster');
        if (p) p.addEventListener('pointerenter', () => { if (!still()) sounds.crackle(); }, { once: true });
      }
    }
    const al = root.querySelector('#h-album');
    if (al) {
      al.hidden = false;
      al.innerHTML = collectionHtml();
      al.querySelectorAll('[data-go]').forEach(b => b.onclick = () => go(b.dataset.go));
    }
    const art = root.querySelector('#h-art');
    if (art && active === 'halloween' && !art.querySelector('.ev-ghost')) art.insertAdjacentHTML('beforeend', '<img class="ev-ghost glow" src="assets/album/ghost.png" alt="">');
    Lights.rescan();
  }

  /** Foil stickers: the holographic conic turns with the pointer (only on rare / seasonal stickers). */
  function foil(box) {
    box.addEventListener('pointermove', (e) => {
      if (still()) return;
      box.querySelectorAll('.foil').forEach(f => {
        const r = f.getBoundingClientRect();
        f.style.setProperty('--nore-foil-angle', `${Math.round(Math.atan2(e.clientY - r.top - r.height / 2, e.clientX - r.left - r.width / 2) * 57.3)}deg`);
      });
    });
  }

  // ================================================================ Settings: the event sheet

  function settingsCard(extras) {
    const s = settings();
    const id = active;
    const state = id === 'halloween' ? `Trwa Halloween 2026 „Zgaszone światło” · do końca: ${leftText('halloween')}`
      : id === 'winter' ? `Trwa Seria zimowa · do 6 stycznia`
      : Date.now() < WINTER_FROM ? 'Następne: Seria zimowa od 10 grudnia' : 'Następne wydarzenie wkrótce';
    const card = el(`<div class="card panel ev-set">
      <div class="section-title">${icon('sparkles')} Wydarzenia</div>
      <div class="setting"><div class="col"><b>Wydarzenia Nore</b><span><i class="sdot sm ${id ? 'event' : 'off'}"></i> ${esc(state)}</span></div><span class="tag event">zawsze włączone</span></div>
      <div class="setting"><div class="col"><b>Intensywność efektów</b><span>Latarka, przyciemnienie naklejek, nietoperze, kurz i śnieg. Wydarzeń nie można wyłączyć – można je przyciszyć.</span></div></div>
      <div class="row" style="padding-bottom:10px"><input type="range" class="slider" id="ev-fx" min="25" max="100" step="5" value="${Math.round(fx() * 100)}" style="flex:1"><div class="value-pill" id="ev-fxv"></div></div>
      <div class="setting"><div class="col"><b>Dźwięki wydarzeń</b><span>Pstryknięcie światła i szum przy odsłonie, trzask szronu i dzwonek zimą</span></div><label class="switch"><input type="checkbox" id="ev-snd" ${s.eventSound !== false ? 'checked' : ''}><i></i></label></div>
      <div id="ev-extras"></div>
      ${id === 'halloween' ? `<div class="setting"><div class="col"><b>Cukierek albo psikus</b><span>Mini-gra z nagrodami: tła, akcenty, odznaki i peleryny do gry</span></div><button class="btn ghost sm" id="ev-open">${icon('sparkles')} Otwórz</button></div>` : ''}
      ${id ? `<div class="setting"><div class="col"><b>Odsłona wydarzenia</b><span>Zobacz jeszcze raz, jak gaśnie światło${id === 'winter' ? ' i spada szron' : ''}</span></div><button class="btn ghost sm" id="ev-replay">${icon('refresh')} Pokaż</button></div>` : ''}
    </div>`);
    if (extras) card.querySelector('#ev-extras').appendChild(extras);
    const r = card.querySelector('#ev-fx'), v = card.querySelector('#ev-fxv');
    const upd = () => { v.textContent = r.value + '%'; sliderFill(r); document.documentElement.style.setProperty('--ev-fx', (r.value / 100).toFixed(2)); };
    r.oninput = () => { upd(); if (App.state) App.state.settings.eventFx = +r.value; };
    r.onchange = async () => { App.state.settings = await nore.setSettings({ eventFx: +r.value }); apply(); };
    upd();
    card.querySelector('#ev-snd').onchange = async (e) => { App.state.settings = await nore.setSettings({ eventSound: e.target.checked }); if (e.target.checked) sounds.bell(); };
    const open = card.querySelector('#ev-open'); if (open) open.onclick = () => go('halloween');
    const rep = card.querySelector('#ev-replay'); if (rep) rep.onclick = () => (active === 'halloween' ? revealHalloween() : revealWinter());
    return card;
  }

  /** Last step of the Settings page: the event sheet is added and every sheet goes into two columns. */
  function decorateSettings(root, extras) {
    const head = root.querySelector('.page-head');
    const cols = el('<div class="settings-cols"></div>');
    const look = root.querySelector('.look-card');
    const cards = [...root.querySelectorAll(':scope > .card, :scope > .settings-base > .card')].filter(c => c !== look);
    if (look) cols.appendChild(look);
    cols.appendChild(settingsCard(extras));
    cards.forEach(c => { c.style.marginTop = ''; cols.appendChild(c); });
    const base = root.querySelector('.settings-base');
    if (base) base.remove();
    if (head) head.after(cols); else root.prepend(cols);
    [...cols.children].forEach((c, i) => c.style.setProperty('--i', i));
    stagger(cols);
  }

  // ================================================================ boot

  function init() {
    apply();
    window.addEventListener('nore:launched', maybeReveal);
    // every visit to the Halloween page plays its reveal (without the palette swap)
    if (Pages.halloween && !Pages.halloween._ev) {
      const _hw = Pages.halloween;
      Pages.halloween = (root, opts) => { const c = _hw(root, opts); if (active === 'halloween') revealHalloween({ palette: false }); return c; };
      Pages.halloween._ev = true;
    }
    // the calendar is re-checked every minute: a launcher left open over midnight changes event by itself
    setInterval(() => { const before = active; apply({ reveal: true }); if (before !== active && App.page === 'home') go('home'); renderRail(); }, 60000);
    if (typeof App === 'object' && App.onChange) App.onChange(() => document.documentElement.style.setProperty('--ev-fx', fx().toFixed(2)));
  }

  /** Developer preview: Events.preview('halloween' | 'winter' | 'none' | null) – this session only. */
  function preview(id) {
    ss.set(KEY_PREVIEW, id || null);
    apply({ reveal: true });
    if (typeof App === 'object' && App.page) go(App.page);
  }

  return { init, current, byDate, leftText, endOf, apply, homeSlots, railBadge, decorateSettings, preview, revealHalloween, revealWinter, fx, get active() { return active; } };
})();
