'use strict';
/*
 * Launcher background: a scene (photo, own image or an animated canvas scene), an optional
 * particle layer on top and the photo motion. Everything is configured in Settings → Wygląd and
 * pauses while the window is hidden or animations are off.
 */
(function () {
  const bg = document.getElementById('bg');
  const photo = bg.querySelector('.photo');
  const scene = document.createElement('canvas');
  scene.id = 'scene';
  bg.insertBefore(scene, bg.querySelector('#embers'));
  const parts = document.getElementById('embers');
  const sc = scene.getContext('2d'), pc = parts.getContext('2d');

  let W = 0, H = 0, dpr = 1, mx = 0.5, my = 0.5, enabled = true, t0 = performance.now();
  let cfg = { scene: 'photo', particles: 'embers', motion: 'kenburns', density: 1, dim: 55, blur: 0, speed: 1, custom: null };
  let accent = [255, 138, 31];
  let sceneState = null, list = [], lastFrame = 0;

  function readAccent() {
    const v = getComputedStyle(document.documentElement).getPropertyValue('--accent-rgb').split(',').map(n => parseInt(n, 10));
    if (v.length === 3 && v.every(n => !isNaN(n))) accent = v;
  }
  const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
  const mix = (a, b, f) => [0, 1, 2].map(i => Math.round(a[i] + (b[i] - a[i]) * f));

  function resize() {
    dpr = Math.min(1.5, window.devicePixelRatio || 1);
    W = bg.clientWidth; H = bg.clientHeight;
    for (const [c, ctx, k] of [[scene, sc, 0.6], [parts, pc, 1]]) {
      // scenes render at reduced resolution (they are soft anyway) to stay light on the GPU
      c.width = Math.max(1, Math.round(W * dpr * k)); c.height = Math.max(1, Math.round(H * dpr * k));
      ctx.setTransform(dpr * k, 0, 0, dpr * k, 0, 0);
    }
    sceneState = null;
  }

  // ------------------------------------------------------------------ scenes

  const SCENES = {
    photo: null,
    custom: null,
    minimal: null,

    aurora(t, s) {
      const g = sc.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, '#07060a'); g.addColorStop(1, '#120c08');
      sc.fillStyle = g; sc.fillRect(0, 0, W, H);
      sc.globalCompositeOperation = 'lighter';
      const bands = [[accent, 0.0, 0.42], [mix(accent, [255, 214, 120], 0.6), 1.7, 0.3], [mix(accent, [160, 80, 255], 0.55), 3.1, 0.26], [mix(accent, [60, 200, 255], 0.5), 4.4, 0.22]];
      for (const [col, ph, alpha] of bands) {
        sc.beginPath();
        const base = H * (0.35 + 0.08 * Math.sin(t * 0.00011 + ph));
        for (let x = 0; x <= W; x += 16) {
          const y = base + Math.sin(x * 0.004 + t * 0.0004 + ph) * 60 + Math.sin(x * 0.011 - t * 0.0003 + ph * 2) * 26;
          x === 0 ? sc.moveTo(x, y) : sc.lineTo(x, y);
        }
        sc.lineTo(W, H); sc.lineTo(0, H); sc.closePath();
        const gg = sc.createLinearGradient(0, base - 120, 0, base + 260);
        gg.addColorStop(0, rgba(col, 0)); gg.addColorStop(0.25, rgba(col, alpha)); gg.addColorStop(1, rgba(col, 0));
        sc.fillStyle = gg; sc.fill();
      }
      sc.globalCompositeOperation = 'source-over';
    },

    space(t, s) {
      if (!s.stars) s.stars = Array.from({ length: 420 }, () => ({ x: Math.random() * 2 - 1, y: Math.random() * 2 - 1, z: Math.random() }));
      sc.fillStyle = '#05040a'; sc.fillRect(0, 0, W, H);
      const neb = (x, y, r, c, a) => { const g = sc.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, rgba(c, a)); g.addColorStop(1, rgba(c, 0)); sc.fillStyle = g; sc.fillRect(0, 0, W, H); };
      neb(W * (0.7 + 0.05 * Math.sin(t * 0.00005)), H * 0.3, W * 0.5, accent, 0.38);
      neb(W * 0.2, H * (0.8 + 0.05 * Math.cos(t * 0.00007)), W * 0.45, mix(accent, [120, 60, 255], 0.7), 0.3);
      const cx = W / 2 + (mx - 0.5) * 60, cy = H / 2 + (my - 0.5) * 40, v = 0.00012 * (s.dt || 16);
      for (const st of s.stars) {
        st.z -= v;
        if (st.z <= 0.02) { st.z = 1; st.x = Math.random() * 2 - 1; st.y = Math.random() * 2 - 1; }
        const px = cx + st.x / st.z * W * 0.25, py = cy + st.y / st.z * H * 0.25;
        if (px < 0 || px > W || py < 0 || py > H) continue;
        const r = (1 - st.z) * 2.2, a = Math.min(1, (1 - st.z) * 1.4);
        sc.fillStyle = `rgba(255,${230 + Math.round(st.x * 20)},${210 + Math.round(st.y * 40)},${a})`;
        sc.beginPath(); sc.arc(px, py, r, 0, Math.PI * 2); sc.fill();
      }
    },

    waves(t) {
      const g = sc.createLinearGradient(0, 0, W, H);
      g.addColorStop(0, '#0d0907'); g.addColorStop(1, rgba(mix(accent, [0, 0, 0], 0.8), 1));
      sc.fillStyle = g; sc.fillRect(0, 0, W, H);
      for (let i = 0; i < 5; i++) {
        const col = mix(accent, [255, 255, 255], i * 0.08), amp = 22 + i * 9, base = H * (0.55 + i * 0.09);
        sc.beginPath(); sc.moveTo(0, H);
        for (let x = 0; x <= W; x += 12) sc.lineTo(x, base + Math.sin(x * (0.006 - i * 0.0007) + t * 0.0006 * (1 + i * 0.2) + i) * amp);
        sc.lineTo(W, H); sc.closePath();
        sc.fillStyle = rgba(col, 0.07 + i * 0.025); sc.fill();
        sc.strokeStyle = rgba(col, 0.25); sc.lineWidth = 1.2; sc.stroke();
      }
    },

    grid(t) {
      const horizon = H * 0.55;
      const g = sc.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, '#09060f'); g.addColorStop(0.55, rgba(mix(accent, [20, 0, 40], 0.75), 1)); g.addColorStop(1, '#07050a');
      sc.fillStyle = g; sc.fillRect(0, 0, W, H);
      // sun
      const sunR = Math.min(W, H) * 0.2, sx = W * 0.5 + (mx - 0.5) * 30, sy = horizon - sunR * 0.35;
      const sg = sc.createLinearGradient(0, sy - sunR, 0, sy + sunR);
      sg.addColorStop(0, rgba(mix(accent, [255, 230, 120], 0.6), 1)); sg.addColorStop(1, rgba(accent, 0.9));
      sc.save(); sc.beginPath(); sc.rect(0, 0, W, horizon); sc.clip();
      sc.shadowColor = rgba(accent, 0.9); sc.shadowBlur = 60;
      sc.fillStyle = sg; sc.beginPath(); sc.arc(sx, sy, sunR, 0, Math.PI * 2); sc.fill();
      sc.shadowBlur = 0; sc.fillStyle = '#0b0710';
      for (let i = 0; i < 6; i++) { const y = sy + sunR * (0.1 + i * 0.16); sc.fillRect(sx - sunR, y, sunR * 2, 2 + i * 1.4); }
      sc.restore();
      // floor grid
      sc.strokeStyle = rgba(accent, 0.55); sc.lineWidth = 1;
      const off = (t * 0.00005) % 1;
      for (let i = 0; i < 22; i++) {
        const z = (i + off) / 22, y = horizon + (H - horizon) * z * z;
        sc.globalAlpha = Math.min(1, z * 1.5); sc.beginPath(); sc.moveTo(0, y); sc.lineTo(W, y); sc.stroke();
      }
      sc.globalAlpha = 1;
      for (let i = -24; i <= 24; i++) {
        sc.beginPath(); sc.moveTo(W / 2 + i * 14, horizon); sc.lineTo(W / 2 + i * W * 0.12, H); sc.stroke();
      }
      const hg = sc.createLinearGradient(0, horizon - 40, 0, horizon + 60);
      hg.addColorStop(0, rgba(accent, 0)); hg.addColorStop(0.5, rgba(accent, 0.35)); hg.addColorStop(1, rgba(accent, 0));
      sc.fillStyle = hg; sc.fillRect(0, horizon - 40, W, 100);
    },

    cubes(t, s) {
      if (!s.cubes) s.cubes = Array.from({ length: 26 }, () => ({ x: Math.random(), y: Math.random(), z: 0.3 + Math.random() * 0.7, r: Math.random() * 6, vr: (Math.random() - 0.5) * 0.0004, kind: Math.floor(Math.random() * 4) }));
      const g = sc.createRadialGradient(W * 0.7, H * 0.2, 0, W * 0.7, H * 0.2, Math.max(W, H));
      g.addColorStop(0, rgba(mix(accent, [0, 0, 0], 0.6), 1)); g.addColorStop(1, '#080605');
      sc.fillStyle = g; sc.fillRect(0, 0, W, H);
      const tops = [[124, 189, 75], [160, 160, 160], [196, 152, 97], accent];
      const sides = [[134, 96, 67], [118, 118, 118], [150, 112, 70], mix(accent, [0, 0, 0], 0.4)];
      s.cubes.sort((a, b) => a.z - b.z);
      for (const c of s.cubes) {
        c.y -= 0.000012 * (s.dt || 16) * c.z;
        c.r += c.vr * (s.dt || 16);
        if (c.y < -0.15) { c.y = 1.15; c.x = Math.random(); }
        const size = 18 + c.z * 46, px = c.x * W + (mx - 0.5) * 40 * c.z, py = c.y * H + (my - 0.5) * 30 * c.z;
        const a = 0.25 + c.z * 0.55, ang = c.r;
        const p = (dx, dy) => [px + (dx * Math.cos(ang) - dy * Math.sin(ang)) * size, py + (dx * Math.sin(ang) + dy * Math.cos(ang)) * size * 0.55];
        const top = [p(0, -1), p(1, 0), p(0, 1), p(-1, 0)];
        const face = (pts, col, k) => { sc.beginPath(); pts.forEach(([x, y], i) => (i ? sc.lineTo(x, y) : sc.moveTo(x, y))); sc.closePath(); sc.fillStyle = rgba(mix(col, [0, 0, 0], k), a); sc.fill(); };
        const down = (q) => [q[0], q[1] + size * 0.95];
        face([top[3], top[2], down(top[2]), down(top[3])], sides[c.kind], 0.15);
        face([top[2], top[1], down(top[1]), down(top[2])], sides[c.kind], 0.35);
        face(top, tops[c.kind], 0);
      }
    },
  };

  // ------------------------------------------------------------------ particles

  function spawn(kind, initial) {
    const p = { x: Math.random() * W, y: initial ? Math.random() * H : H + 10, life: 0, phase: Math.random() * Math.PI * 2 };
    if (kind === 'embers') Object.assign(p, { r: 0.6 + Math.random() * 2.2, vy: -(0.15 + Math.random() * 0.55), vx: (Math.random() - 0.5) * 0.25, max: 400 + Math.random() * 700, hue: 18 + Math.random() * 22 });
    if (kind === 'snow') Object.assign(p, { y: initial ? Math.random() * H : -10, r: 0.8 + Math.random() * 2.4, vy: 0.3 + Math.random() * 0.8, vx: (Math.random() - 0.5) * 0.4, max: 3000 });
    if (kind === 'fireflies') Object.assign(p, { y: Math.random() * H, r: 1 + Math.random() * 1.8, vy: 0, vx: 0, max: 600 + Math.random() * 900, hue: 50 + Math.random() * 40 });
    if (kind === 'stars') Object.assign(p, { y: Math.random() * H, r: 0.4 + Math.random() * 1.4, vy: 0, vx: 0, max: 900 + Math.random() * 1500 });
    if (kind === 'bubbles') Object.assign(p, { r: 3 + Math.random() * 10, vy: -(0.2 + Math.random() * 0.5), vx: 0, max: 2000 });
    return p;
  }

  function drawParticles(t, dt) {
    pc.clearRect(0, 0, W, H);
    const kind = cfg.particles;
    if (kind === 'none') return;
    const target = Math.min(160, (W * H) / 14000) * cfg.density * (kind === 'stars' ? 1.6 : kind === 'bubbles' ? 0.35 : 1);
    while (list.length < target) list.push(spawn(kind, list.length < target * 0.6));
    if (list.length > target + 5) list.length = Math.floor(target);
    pc.globalCompositeOperation = kind === 'snow' || kind === 'bubbles' ? 'source-over' : 'lighter';
    const k = dt / 16 * cfg.speed;
    for (let i = list.length - 1; i >= 0; i--) {
      const p = list[i];
      p.life += k;
      if (kind === 'fireflies') { p.x += Math.cos(t / 900 + p.phase) * 0.35 * k; p.y += Math.sin(t / 1300 + p.phase * 2) * 0.3 * k; }
      else { p.y += p.vy * k; p.x += (p.vx + Math.sin(t / 1400 + p.phase) * 0.25 + (mx - 0.5) * 0.15) * k; }
      const fade = Math.min(1, p.life / 60) * Math.max(0, 1 - p.life / p.max);
      if (p.y < -30 || p.y > H + 30 || p.life > p.max) { list.splice(i, 1); continue; }
      if (kind === 'embers' || kind === 'fireflies') {
        const a = fade * (0.7 + 0.3 * Math.sin(t / (kind === 'fireflies' ? 500 : 200) + p.phase * 3));
        const g = pc.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r * 5);
        const hue = kind === 'embers' ? p.hue : p.hue;
        g.addColorStop(0, `hsla(${hue},100%,70%,${0.9 * a})`); g.addColorStop(0.35, `hsla(${hue},100%,55%,${0.35 * a})`); g.addColorStop(1, `hsla(${hue},100%,50%,0)`);
        pc.fillStyle = g; pc.beginPath(); pc.arc(p.x, p.y, p.r * 5, 0, Math.PI * 2); pc.fill();
      } else if (kind === 'snow') {
        pc.fillStyle = `rgba(255,255,255,${0.75 * fade})`; pc.beginPath(); pc.arc(p.x, p.y, p.r, 0, Math.PI * 2); pc.fill();
      } else if (kind === 'stars') {
        const a = fade * (0.4 + 0.6 * Math.abs(Math.sin(t / 700 + p.phase)));
        pc.fillStyle = `rgba(255,245,230,${a})`; pc.beginPath(); pc.arc(p.x, p.y, p.r, 0, Math.PI * 2); pc.fill();
        if (p.r > 1.2) { pc.fillStyle = rgba(accent, a * 0.3); pc.fillRect(p.x - p.r * 4, p.y - 0.3, p.r * 8, 0.6); pc.fillRect(p.x - 0.3, p.y - p.r * 4, 0.6, p.r * 8); }
      } else if (kind === 'bubbles') {
        pc.strokeStyle = rgba(accent, 0.35 * fade); pc.lineWidth = 1; pc.beginPath(); pc.arc(p.x, p.y, p.r, 0, Math.PI * 2); pc.stroke();
        pc.fillStyle = `rgba(255,255,255,${0.12 * fade})`; pc.beginPath(); pc.arc(p.x - p.r * 0.35, p.y - p.r * 0.35, p.r * 0.25, 0, Math.PI * 2); pc.fill();
      }
    }
    pc.globalCompositeOperation = 'source-over';
  }

  // ------------------------------------------------------------------ loop

  function frame(now) {
    requestAnimationFrame(frame);
    if (!enabled || document.hidden) return;
    if (!lastFrame) lastFrame = now - 16;
    const dt = Math.min(64, now - lastFrame);
    if (dt < 15) return; // ~60 fps cap
    lastFrame = now;
    const t = (now - t0) * cfg.speed;
    const fn = SCENES[cfg.scene];
    if (fn) {
      if (!sceneState) sceneState = {};
      sceneState.dt = dt * cfg.speed;
      fn(t, sceneState);
    }
    drawParticles(t, dt);
  }

  function applyPhotoMotion() {
    photo.classList.toggle('still', cfg.motion === 'static' || cfg.motion === 'parallax');
    if (cfg.motion === 'static' || cfg.motion === 'kenburns') photo.style.transform = '';
  }

  window.addEventListener('resize', resize);
  window.addEventListener('mousemove', (e) => {
    mx = e.clientX / window.innerWidth; my = e.clientY / window.innerHeight;
    if (cfg.motion === 'parallax' || cfg.motion === 'both') photo.style.transform = `translate(${(0.5 - mx) * 22}px, ${(0.5 - my) * 14}px)`;
  });

  const Background = {
    SCENES: [
      { id: 'photo', name: 'Mgławica', desc: 'Zdjęcie z teleskopu JWST' },
      { id: 'aurora', name: 'Zorza', desc: 'Płynące wstęgi światła' },
      { id: 'space', name: 'Kosmos', desc: 'Lot między gwiazdami' },
      { id: 'cubes', name: 'Bloki', desc: 'Unoszące się bloki' },
      { id: 'grid', name: 'Synthwave', desc: 'Neonowa siatka i słońce' },
      { id: 'waves', name: 'Fale', desc: 'Spokojne, warstwowe fale' },
      { id: 'minimal', name: 'Minimal', desc: 'Ciemny gradient bez ruchu' },
      { id: 'custom', name: 'Własne', desc: 'Twój obrazek lub GIF' },
    ],
    PARTICLES: [['none', 'Brak'], ['embers', 'Iskry'], ['fireflies', 'Świetliki'], ['snow', 'Śnieg'], ['stars', 'Gwiazdy'], ['bubbles', 'Bańki']],
    MOTIONS: [['kenburns', 'Powolny zoom'], ['parallax', 'Paralaksa'], ['both', 'Zoom + paralaksa'], ['static', 'Bez ruchu']],

    apply(s) {
      const prev = cfg;
      cfg = { ...cfg, ...s };
      readAccent();
      const photoScene = cfg.scene === 'photo' || (cfg.scene === 'custom' && cfg.custom);
      bg.dataset.scene = cfg.scene;
      photo.style.display = photoScene ? '' : 'none';
      photo.style.backgroundImage = cfg.scene === 'custom' && cfg.custom ? `url("${cfg.custom}")` : '';
      scene.style.display = SCENES[cfg.scene] ? '' : 'none';
      bg.style.setProperty('--bg-dim', String(1 - cfg.dim / 100 * 0.9));
      bg.style.setProperty('--bg-blur', cfg.blur + 'px');
      applyPhotoMotion();
      if (prev.scene !== cfg.scene) sceneState = null;
      if (prev.particles !== cfg.particles) list = [];
      if (!SCENES[cfg.scene]) sc.clearRect(0, 0, W, H);
    },
    setEnabled(v) { enabled = v; if (!v) { pc.clearRect(0, 0, W, H); } },
  };
  window.Background = Background;
  window.Embers = Background; // older code toggles animations through Embers.setEnabled

  resize();
  requestAnimationFrame(frame);
})();
