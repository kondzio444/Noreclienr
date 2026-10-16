'use strict';
/* Nore Client website: radial menu, module HUD, live scene editor, event canvases, API data. */
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const DPR = Math.min(2, window.devicePixelRatio || 1);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const ease = (t) => 1 - Math.pow(1 - t, 3);
  const back = (t) => { const c = 1.70158; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); };

  function fit(canvas) {
    const r = canvas.getBoundingClientRect();
    const w = Math.max(1, Math.round(r.width * DPR)), h = Math.max(1, Math.round(r.height * DPR));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    return [w, h];
  }

  // ------------------------------------------------------------------ night sky with drifting voxels
  const sky = $('#sky');
  const stars = Array.from({ length: 160 }, () => ({ x: Math.random(), y: Math.random(), z: Math.random() }));
  const cubes = Array.from({ length: 9 }, () => ({ x: Math.random(), y: Math.random(), s: 6 + Math.random() * 16, r: Math.random() * 6, v: 0.2 + Math.random() * 0.6 }));
  function drawSky(t) {
    const g = sky.getContext('2d');
    const [w, h] = fit(sky);
    g.clearRect(0, 0, w, h);
    const scroll = window.scrollY * 0.15 * DPR;
    for (const s of stars) {
      const tw = 0.45 + 0.55 * Math.sin(t * 0.0015 + s.x * 50);
      g.globalAlpha = (0.15 + s.z * 0.6) * tw;
      g.fillStyle = s.z > 0.85 ? '#ffffff' : '#c7b2ff';
      const y = ((s.y * h - scroll * s.z) % h + h) % h;
      g.fillRect(s.x * w, y, (1 + s.z) * DPR, (1 + s.z) * DPR);
    }
    g.globalAlpha = 1;
    for (const c of cubes) {
      const size = c.s * DPR;
      const x = c.x * w, y = ((c.y * h - t * 0.01 * c.v * DPR - scroll * 0.6) % (h + 80) + h + 80) % (h + 80) - 40;
      isoCube(g, x, y, size, 'rgba(139,92,255,.06)', 'rgba(139,92,255,.035)', 'rgba(199,178,255,.08)', 'rgba(199,178,255,.12)');
    }
  }
  function isoCube(g, x, y, s, left, right, top, stroke) {
    const hx = s * 0.866, hy = s * 0.5;
    const faces = [
      [[x, y], [x + hx, y - hy], [x, y - 2 * hy], [x - hx, y - hy], top],
      [[x, y], [x - hx, y - hy], [x - hx, y + hy], [x, y + 2 * hy], left],
      [[x, y], [x + hx, y - hy], [x + hx, y + hy], [x, y + 2 * hy], right],
    ];
    for (const f of faces) {
      g.beginPath(); g.moveTo(f[0][0], f[0][1]);
      for (let i = 1; i < 4; i++) g.lineTo(f[i][0], f[i][1]);
      g.closePath(); g.fillStyle = f[4]; g.fill();
      if (stroke) { g.strokeStyle = stroke; g.lineWidth = DPR; g.stroke(); }
    }
  }

  // ------------------------------------------------------------------ radial menu
  const ICONS = {
    hud: '<path d="M4 5h16v14H4z"/><path d="M7 9h4M7 13h7"/>',
    pvp: '<path d="M5 19 19 5M15 5h4v4M9 15l-4 4M5 15l4 4"/>',
    sky: '<path d="M20 15a8 8 0 1 1-9-11 6.5 6.5 0 0 0 9 11z"/>',
    wardrobe: '<path d="M8 4 4 7l2 4 2-1v10h8V10l2 1 2-4-4-3-2 2h-4z"/>',
    scene: '<path d="M3 20h18M6 20V11l4-4 4 4v9M14 20v-6l4-3 3 3v6"/>',
    camera: '<path d="M4 7h4l2-2h4l2 2h4v12H4z"/><circle cx="12" cy="13" r="3.5"/>',
    chat: '<path d="M4 5h16v11H9l-5 4z"/>',
    fps: '<path d="M4 18 9 11l4 4 7-9"/><path d="M4 4v16h16"/>',
  };
  const SEGMENTS = [
    { id: 'hud', name: 'HUD', count: 52, sub: '52 elementy: FPS, CPS, zbroja, kompas' },
    { id: 'pvp', name: 'PvP', count: 9, sub: 'Celownik, combo, zasięg, cooldown' },
    { id: 'sky', name: 'Niebo', count: 6, sub: 'Kolor nieba, gwiazdy, zorza, pora dnia' },
    { id: 'wardrobe', name: 'Szatnia', count: 3, sub: 'Peleryny, skrzydła i kapelusz' },
    { id: 'scene', name: 'Scena', count: 4, sub: 'Edytor tła menu' },
    { id: 'camera', name: 'Kamera', count: 6, sub: 'Zoom, freelook, płynne przejścia' },
    { id: 'chat', name: 'Czat', count: 5, sub: 'Znajomi, makra, czat w grze' },
    { id: 'fps', name: 'Wydajność', count: 12, sub: 'Więcej klatek, mniej ścinek' },
  ];
  const segRoot = $('#segments');
  SEGMENTS.forEach((s, i) => {
    const a = (i / SEGMENTS.length) * 360;
    const d = document.createElement('div');
    d.className = 'seg';
    d.style.setProperty('--a', a + 'deg');
    d.innerHTML = `<button type="button" data-i="${i}" aria-label="${s.name}"><svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[s.id]}</svg><b>${s.name}</b><small>${s.count} mod.</small></button>`;
    segRoot.appendChild(d);
  });
  const coreTitle = $('#core-title'), coreSub = $('#core-sub');
  let hovered = -1, autoIdx = 0, lastPointer = 0;
  function focusSeg(i) {
    $$('.seg button').forEach((b, k) => b.classList.toggle('on', k === i));
    if (i < 0) { coreTitle.textContent = 'NORE'; coreSub.textContent = '97 modułów'; return; }
    coreTitle.textContent = SEGMENTS[i].name.toUpperCase();
    coreSub.textContent = SEGMENTS[i].sub;
  }
  $$('.seg button').forEach(b => {
    b.addEventListener('mouseenter', () => { hovered = +b.dataset.i; lastPointer = performance.now(); focusSeg(hovered); });
    b.addEventListener('focus', () => { hovered = +b.dataset.i; focusSeg(hovered); });
    b.addEventListener('mouseleave', () => { hovered = -1; });
    b.addEventListener('click', () => {
      const target = { hud: '#modules', pvp: '#modules', sky: '#radial', wardrobe: '#wardrobe', scene: '#scene', camera: '#scene', chat: '#launcher', fps: '#modules' }[SEGMENTS[+b.dataset.i].id];
      document.querySelector(target).scrollIntoView({ behavior: reduced ? 'auto' : 'smooth' });
    });
  });
  const stage = $('#radial-stage'), tilt = $('#radial-tilt');
  const sizeRadial = () => tilt.style.setProperty('--rad', Math.round(tilt.getBoundingClientRect().width * 0.36) + 'px');
  sizeRadial();
  addEventListener('resize', sizeRadial);
  stage.addEventListener('pointermove', (e) => {
    const r = stage.getBoundingClientRect();
    const nx = (e.clientX - r.left) / r.width - 0.5, ny = (e.clientY - r.top) / r.height - 0.5;
    tilt.style.setProperty('--ry', (nx * 26).toFixed(2) + 'deg');
    tilt.style.setProperty('--rx', (-ny * 26 + 8).toFixed(2) + 'deg');
    lastPointer = performance.now();
  });
  stage.addEventListener('pointerleave', () => { tilt.style.setProperty('--ry', '-10deg'); tilt.style.setProperty('--rx', '14deg'); });
  if (!reduced) setInterval(() => {
    if (hovered >= 0 || performance.now() - lastPointer < 4000) return;
    autoIdx = (autoIdx + 1) % SEGMENTS.length;
    focusSeg(autoIdx);
  }, 1800);

  // hud readout ticks like F3
  const hud = $('#hud-read');
  let px = 128, pz = -340;
  setInterval(() => {
    px += Math.round(Math.random() * 3 - 1); pz += Math.round(Math.random() * 3 - 1);
    hud.textContent = `XYZ ${px} / 72 / ${pz} · ${230 + Math.round(Math.random() * 24)} FPS`;
  }, 700);

  // ------------------------------------------------------------------ module list HUD (real module names)
  const MODULES = [
    ['FPS', 'hud'], ['CPS', 'pvp'], ['Keystrokes', 'pvp'], ['Armor Status', 'hud'], ['Coordinates', 'hud'], ['Potion Effects', 'hud'],
    ['Zoom', 'world'], ['Freelook', 'world'], ['Crosshair', 'pvp'], ['Combo', 'pvp'], ['Reach Display', 'pvp'], ['Cooldown Indicator', 'pvp'],
    ['Target HUD', 'pvp'], ['Ping', 'hud'], ['TPS', 'hud'], ['Compass', 'hud'], ['Waypoint', 'world'], ['Fullbright', 'world'],
    ['Biome', 'world'], ['Light Level', 'world'], ['Day Counter', 'world'], ['Time Until Night', 'world'], ['Elytra Info', 'world'],
    ['FPS Graph', 'hud'], ['Memory', 'hud'], ['Inventory HUD', 'hud'], ['Totem Counter', 'pvp'], ['Pearl Counter', 'pvp'],
    ['Golden Apple Counter', 'pvp'], ['Arrow Counter', 'pvp'], ['Hit Counter', 'pvp'], ['Block Info', 'world'], ['Chunk Info', 'world'],
    ['Session Time', 'hud'], ['Server Info', 'hud'], ['Module List', 'hud'], ['Camera Tweaks', 'world'], ['Friends Chat', 'hud'], ['Cosmetics', 'world'],
  ];
  const CAT = { hud: ['#8b5cff', 'HUD'], pvp: ['#ff6b8a', 'PvP'], world: ['#6be4ff', 'Świat'] };
  const modlist = $('#modlist');
  let filter = 'all', rotation = 0;
  function renderModules() {
    const items = MODULES.filter(m => filter === 'all' || m[1] === filter);
    const start = rotation % items.length;
    const view = items.slice(start).concat(items.slice(0, start)).slice(0, 18);
    modlist.innerHTML = view.map(([n, c], i) => `<li style="--i:${i};--c:${CAT[c][0]}">${n} <small>${CAT[c][1]}</small></li>`).join('');
  }
  $$('#module-filters .chip').forEach(b => b.addEventListener('click', () => {
    $$('#module-filters .chip').forEach(x => { x.classList.toggle('on', x === b); x.setAttribute('aria-selected', x === b); });
    filter = b.dataset.f; rotation = 0; renderModules();
  }));
  renderModules();
  if (!reduced) setInterval(() => { rotation++; renderModules(); }, 2600);

  // ------------------------------------------------------------------ scene editor: voxel island, time of day, growing trees, camera
  const scene = $('#scene3d');
  const TREES = {
    oak: { log: ['#7a5a36', '#5e4429', '#8c6a42'], leaf: ['#4f9a3a', '#3d7d2c', '#63b14a'], h: 4, shape: 'round' },
    birch: { log: ['#e8e2d4', '#c9c2b2', '#f4f0e6'], leaf: ['#79b04c', '#5f9440', '#8fc45c'], h: 5, shape: 'round' },
    spruce: { log: ['#4e3820', '#3a2a17', '#5f452a'], leaf: ['#2f5e3a', '#244a2d', '#3a7046'], h: 6, shape: 'cone' },
    cherry: { log: ['#5a2f3c', '#45232e', '#6b3a48'], leaf: ['#f3a6cf', '#e086b6', '#ffc4e1'], h: 4, shape: 'round' },
  };
  const CAMS = [{ yaw: 0.78, pitch: 0.62, zoom: 1 }, { yaw: 2.3, pitch: 0.42, zoom: 1.35 }, { yaw: -0.9, pitch: 0.95, zoom: 0.85 }];
  const N = 9;
  const height = [];
  for (let x = 0; x < N; x++) {
    height[x] = [];
    for (let z = 0; z < N; z++) {
      const d = Math.hypot(x - (N - 1) / 2, z - (N - 1) / 2);
      height[x][z] = d > 4.3 ? -1 : Math.max(0, Math.round(2.2 - d * 0.45 + Math.sin(x * 1.3) * 0.6 + Math.cos(z * 1.1) * 0.5));
    }
  }
  const treeSpots = [[2, 4], [5, 2], [6, 6], [3, 7]];
  let treeType = 'oak', treeBorn = performance.now();
  let cam = { ...CAMS[0] }, camFrom = { ...CAMS[0] }, camTo = { ...CAMS[0] }, camT0 = 0, dragYaw = 0;
  const tod = $('#tod'), sceneHud = $('#scene-hud');
  let camName = 'Ujęcie 1';

  $$('#trees .chip').forEach(b => b.addEventListener('click', () => {
    $$('#trees .chip').forEach(x => x.classList.toggle('on', x === b));
    treeType = b.dataset.t; treeBorn = performance.now();
  }));
  $$('#cams .chip').forEach(b => b.addEventListener('click', () => {
    $$('#cams .chip').forEach(x => x.classList.toggle('on', x === b));
    camFrom = { ...cam }; camTo = { ...CAMS[+b.dataset.c] }; camT0 = performance.now(); dragYaw = 0; camName = b.textContent;
  }));
  let dragging = null;
  scene.addEventListener('pointerdown', (e) => { dragging = { x: e.clientX, yaw: dragYaw }; scene.setPointerCapture(e.pointerId); });
  scene.addEventListener('pointermove', (e) => { if (dragging) dragYaw = dragging.yaw + (e.clientX - dragging.x) * 0.01; });
  scene.addEventListener('pointerup', () => { dragging = null; });

  function skyColors(min) {
    // keyframes over the day: night, dawn, day, dusk, night
    const K = [[0, '#0b0820', '#1b1240'], [330, '#120c30', '#2b1850'], [390, '#ff9a6a', '#6a4fb0'], [480, '#8fd0ff', '#d8f0ff'],
      [1020, '#7fc4ff', '#cfeaff'], [1110, '#ff8a6a', '#7a4fb0'], [1170, '#2a1550', '#5a2f7a'], [1260, '#0b0820', '#1b1240'], [1440, '#0b0820', '#1b1240']];
    let a = K[0], b = K[K.length - 1];
    for (let i = 0; i < K.length - 1; i++) if (min >= K[i][0] && min <= K[i + 1][0]) { a = K[i]; b = K[i + 1]; break; }
    const t = (min - a[0]) / Math.max(1, b[0] - a[0]);
    return [mixHex(a[1], b[1], t), mixHex(a[2], b[2], t)];
  }
  function mixHex(a, b, t) {
    const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
    const c = [16, 8, 0].map(s => Math.round(lerp((pa >> s) & 255, (pb >> s) & 255, t)));
    return `rgb(${c[0]},${c[1]},${c[2]})`;
  }
  function shade(hex, k) {
    const p = parseInt(hex.slice(1), 16);
    const c = [16, 8, 0].map(s => Math.round(clamp(((p >> s) & 255) * k, 0, 255)));
    return `rgb(${c[0]},${c[1]},${c[2]})`;
  }

  function drawScene(now) {
    const g = scene.getContext('2d');
    const [w, h] = fit(scene);
    const minutes = +tod.value;
    const day = clamp(Math.sin(((minutes - 360) / 1440) * Math.PI * 2) * 1.4 + 0.35, 0.18, 1);
    // camera transition
    const ct = clamp((now - camT0) / 1400, 0, 1), ce = ct < 1 ? 1 - Math.pow(1 - ct, 4) : 1;
    cam = { yaw: lerp(camFrom.yaw, camTo.yaw, ce) + dragYaw + (reduced ? 0 : Math.sin(now * 0.0002) * 0.06), pitch: lerp(camFrom.pitch, camTo.pitch, ce), zoom: lerp(camFrom.zoom, camTo.zoom, ce) };
    const [top, bottom] = skyColors(minutes);
    const grd = g.createLinearGradient(0, 0, 0, h);
    grd.addColorStop(0, top); grd.addColorStop(1, bottom);
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
    // stars at night
    if (day < 0.5) {
      g.fillStyle = '#ffffff';
      for (let i = 0; i < 70; i++) { g.globalAlpha = (0.5 - day) * (0.5 + 0.5 * Math.sin(now * 0.002 + i)); g.fillRect((i * 97.3 % 1) * w, (i * 57.1 % 1) * h * 0.6, 1.5 * DPR, 1.5 * DPR); }
      g.globalAlpha = 1;
    }
    // sun / moon on an arc
    const ang = ((minutes - 360) / 720) * Math.PI;
    const sunUp = minutes > 330 && minutes < 1170;
    const bx = w * 0.5 - Math.cos(ang) * w * 0.42, by = h * 0.62 - Math.sin(ang) * h * 0.5;
    const mx = w * 0.5 - Math.cos(ang + Math.PI) * w * 0.42, my = h * 0.62 - Math.sin(ang + Math.PI) * h * 0.5;
    if (sunUp) { g.fillStyle = 'rgba(255,220,140,.25)'; g.fillRect(bx - 26 * DPR, by - 26 * DPR, 52 * DPR, 52 * DPR); g.fillStyle = '#ffe7a0'; g.fillRect(bx - 14 * DPR, by - 14 * DPR, 28 * DPR, 28 * DPR); }
    else { g.fillStyle = 'rgba(220,220,255,.2)'; g.fillRect(mx - 20 * DPR, my - 20 * DPR, 40 * DPR, 40 * DPR); g.fillStyle = '#e8e6ff'; g.fillRect(mx - 11 * DPR, my - 11 * DPR, 22 * DPR, 22 * DPR); }

    // voxels
    const S = Math.min(w, h) / 15 * cam.zoom;
    const cy = Math.cos(cam.yaw), sy = Math.sin(cam.yaw), cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
    const proj = (x, y, z) => {
      x -= (N - 1) / 2; z -= (N - 1) / 2;
      const rx = x * cy - z * sy, rz = x * sy + z * cy;
      return [w / 2 + rx * S, h * 0.62 - y * S * cp + rz * S * sp, rz * cp + y * sp];
    };
    const blocks = [];
    for (let x = 0; x < N; x++) for (let z = 0; z < N; z++) {
      const hh = height[x][z];
      if (hh < 0) continue;
      for (let y = 0; y <= hh; y++) blocks.push([x, y, z, y === hh ? 'grass' : 'dirt', 1]);
    }
    // water ring
    for (let x = -1; x <= N; x++) for (let z = -1; z <= N; z++) {
      if (x >= 0 && z >= 0 && x < N && z < N && height[x][z] >= 0) continue;
      if (Math.hypot(x - (N - 1) / 2, z - (N - 1) / 2) < 6) blocks.push([x, -0.2, z, 'water', 1]);
    }
    // trees grow: trunk rises block by block, leaves pop in with a springy scale
    const T = TREES[treeType];
    const age = reduced ? 99 : (now - treeBorn) / 1000;
    treeSpots.forEach(([tx, tz], ti) => {
      const base = height[tx][tz] + 1;
      const local = age - ti * 0.25;
      const trunk = clamp(Math.floor(local * 6), 0, T.h);
      for (let y = 0; y < trunk; y++) blocks.push([tx, base + y, tz, 'log', 1]);
      const leafT = clamp((local - T.h / 6) / 0.7, 0, 1);
      if (leafT <= 0) return;
      const sc = back(leafT);
      const top = base + T.h;
      const leaves = [];
      if (T.shape === 'cone') {
        for (let ly = -3; ly <= 1; ly++) { const r = ly <= -2 ? 1 : 0; for (let lx = -r; lx <= r; lx++) for (let lz = -r; lz <= r; lz++) leaves.push([lx, ly, lz]); }
      } else {
        for (let ly = -1; ly <= 1; ly++) { const r = ly === 1 ? 0 : 1; for (let lx = -r; lx <= r; lx++) for (let lz = -r; lz <= r; lz++) if (!(ly === 0 && Math.abs(lx) + Math.abs(lz) === 2)) leaves.push([lx, ly, lz]); }
      }
      for (const [lx, ly, lz] of leaves) blocks.push([tx + lx * sc, top + ly * sc, tz + lz * sc, 'leaf', sc]);
    });
    const proj3 = blocks.map(b => ({ b, d: proj(b[0], b[1], b[2])[2] }));
    proj3.sort((p, q) => p.d - q.d); // far (small depth) first
    const light = 0.35 + day * 0.65;
    for (const { b } of proj3) drawVoxel(g, proj, b, T, light);
    sceneHud.textContent = `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')} · ${$('#trees .chip.on').textContent} · ${camName}`;
  }

  function drawVoxel(g, proj, [x, y, z, kind, sc], T, light) {
    const s = 0.5 * sc;
    const c = (dx, dy, dz) => proj(x + dx, y + dy, z + dz);
    const col = kind === 'grass' ? ['#5fae45', '#7a5a36', '#6b4f30'] : kind === 'dirt' ? ['#7a5a36', '#6b4f30', '#5e4429']
      : kind === 'water' ? ['#3a6fd8', '#2d58b0', '#2a4f9e'] : kind === 'log' ? [T.log[2], T.log[0], T.log[1]] : [T.leaf[2], T.leaf[0], T.leaf[1]];
    const faces = [
      { pts: [c(-s, s, -s), c(s, s, -s), c(s, s, s), c(-s, s, s)], color: col[0], k: 1 },
      { pts: [c(-s, -s, -s), c(s, -s, -s), c(s, s, -s), c(-s, s, -s)], color: col[1], k: 0.8 },
      { pts: [c(s, -s, -s), c(s, -s, s), c(s, s, s), c(s, s, -s)], color: col[2], k: 0.68 },
      { pts: [c(-s, -s, s), c(s, -s, s), c(s, s, s), c(-s, s, s)], color: col[1], k: 0.74 },
      { pts: [c(-s, -s, -s), c(-s, -s, s), c(-s, s, s), c(-s, s, -s)], color: col[2], k: 0.62 },
    ];
    faces.sort((a, b) => (a.pts.reduce((m, p) => m + p[2], 0)) - (b.pts.reduce((m, p) => m + p[2], 0)));
    for (const f of faces.slice(2)) {
      g.beginPath(); g.moveTo(f.pts[0][0], f.pts[0][1]);
      for (let i = 1; i < 4; i++) g.lineTo(f.pts[i][0], f.pts[i][1]);
      g.closePath();
      g.fillStyle = shade(f.color.startsWith('#') ? f.color : '#888888', f.k * light);
      g.fill();
      g.strokeStyle = 'rgba(0,0,0,.1)'; g.lineWidth = DPR * 0.5; g.stroke();
    }
  }

  // ------------------------------------------------------------------ event canvases
  const evs = $$('.ev-canvas');
  const snow = Array.from({ length: 70 }, () => ({ x: Math.random(), y: Math.random(), z: 0.3 + Math.random() * 0.7, p: Math.random() * 6 }));
  const bats = Array.from({ length: 6 }, (_, i) => ({ y: 0.12 + i * 0.1, s: 0.6 + Math.random() * 0.7, v: 0.02 + Math.random() * 0.03, o: Math.random() }));
  function drawEvents(t) {
    for (const c of evs) {
      const r = c.getBoundingClientRect();
      if (r.bottom < 0 || r.top > innerHeight) continue;
      const g = c.getContext('2d');
      const [w, h] = fit(c);
      g.clearRect(0, 0, w, h);
      if (c.dataset.kind === 'snow') {
        for (const f of snow) {
          const y = ((f.y + t * 0.00004 * f.z) % 1) * h, x = ((f.x + Math.sin(t * 0.0006 + f.p) * 0.01) % 1) * w;
          g.globalAlpha = 0.3 + f.z * 0.7; g.fillStyle = '#ffffff';
          g.beginPath(); g.arc(x, y, (0.8 + f.z * 1.8) * DPR, 0, 7); g.fill();
        }
        // garland
        g.globalAlpha = 1;
        const cols = ['#ff4d6d', '#ffc23d', '#3ddc97', '#7fd0ff', '#b48cff'];
        for (let i = 0; i < 12; i++) {
          const x = (i + 0.5) / 12 * w, y = 18 * DPR + Math.sin((i % 3) / 3 * Math.PI) * 8 * DPR;
          const on = 0.55 + 0.45 * Math.sin(t * 0.003 + i * 1.7);
          g.fillStyle = cols[i % cols.length]; g.globalAlpha = 0.25 * on;
          g.beginPath(); g.arc(x, y, 9 * DPR, 0, 7); g.fill();
          g.globalAlpha = 0.6 + 0.4 * on; g.fillRect(x - 2.5 * DPR, y - 3.5 * DPR, 5 * DPR, 7 * DPR);
        }
        g.globalAlpha = 1;
      } else {
        g.fillStyle = '#0a0410';
        for (const b of bats) {
          const x = ((b.o + t * 0.00002 * b.v * 40) % 1.2 - 0.1) * w, y = b.y * h + Math.sin(t * 0.002 + b.o * 9) * 10 * DPR;
          const flap = Math.sin(t * 0.02 + b.o * 9);
          const s = 9 * b.s * DPR;
          g.beginPath(); g.moveTo(x, y);
          g.quadraticCurveTo(x - s, y - s * flap, x - s * 2, y - s * 0.3 * flap);
          g.quadraticCurveTo(x - s * 1.2, y + s * 0.2, x, y + s * 0.35);
          g.quadraticCurveTo(x + s * 1.2, y + s * 0.2, x + s * 2, y - s * 0.3 * flap);
          g.quadraticCurveTo(x + s, y - s * flap, x, y);
          g.fill();
        }
        // pumpkin glow
        const px = w * 0.86, py = h * 0.3, k = 0.75 + 0.25 * Math.sin(t * 0.004);
        const rg = g.createRadialGradient(px, py, 0, px, py, 70 * DPR);
        rg.addColorStop(0, `rgba(255,150,40,${0.45 * k})`); rg.addColorStop(1, 'rgba(255,150,40,0)');
        g.fillStyle = rg; g.fillRect(px - 80 * DPR, py - 80 * DPR, 160 * DPR, 160 * DPR);
        g.fillStyle = '#ff8a1f'; g.fillRect(px - 18 * DPR, py - 14 * DPR, 36 * DPR, 28 * DPR);
        g.fillStyle = '#c45a0a'; g.fillRect(px - 6 * DPR, py - 14 * DPR, 2 * DPR, 28 * DPR); g.fillRect(px + 4 * DPR, py - 14 * DPR, 2 * DPR, 28 * DPR);
        g.fillStyle = '#3d7d2c'; g.fillRect(px - 2 * DPR, py - 20 * DPR, 4 * DPR, 6 * DPR);
        g.fillStyle = `rgba(255,230,120,${k})`; g.fillRect(px - 10 * DPR, py - 6 * DPR, 5 * DPR, 5 * DPR); g.fillRect(px + 5 * DPR, py - 6 * DPR, 5 * DPR, 5 * DPR); g.fillRect(px - 8 * DPR, py + 4 * DPR, 16 * DPR, 3 * DPR);
      }
    }
  }

  // ------------------------------------------------------------------ main loop
  function frame(t) {
    drawSky(t);
    const sr = scene.getBoundingClientRect();
    if (sr.bottom > 0 && sr.top < innerHeight) drawScene(t);
    drawEvents(t);
    // launcher frame flattens while scrolling into view
    const fr = $('#frame').getBoundingClientRect();
    const k = clamp(1 - (fr.top - innerHeight * 0.2) / (innerHeight * 0.8), 0, 1);
    $('#frame').style.setProperty('--fx', (16 * (1 - ease(k))).toFixed(2) + 'deg');
    $('#frame').style.setProperty('--fs', (0.94 + 0.06 * ease(k)).toFixed(3));
    if (!reduced) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  if (reduced) { tod.addEventListener('input', () => drawScene(performance.now())); $$('.chip').forEach(b => b.addEventListener('click', () => setTimeout(() => drawScene(performance.now()), 0))); }

  // ------------------------------------------------------------------ scroll lift (only below the fold)
  if ('IntersectionObserver' in window && !reduced) {
    const io = new IntersectionObserver((es) => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { rootMargin: '0px 0px -8% 0px' });
    $$('.band .wrap > *, .download .dl').forEach(el => {
      if (el.getBoundingClientRect().top > innerHeight) { el.classList.add('lift'); io.observe(el); }
    });
  }

  // ------------------------------------------------------------------ API data
  const os = /Mac/i.test(navigator.platform) ? 'mac' : /Linux/i.test(navigator.platform) && !/Android/i.test(navigator.userAgent) ? 'linux' : 'win';
  const osName = { win: 'Windows', linux: 'Linux', mac: 'macOS' }[os];
  $('#dl-main').href = `/api/v1/download/${os}`;
  $('#dl-main span').textContent = `Pobierz dla ${osName}`;
  fetch('/api/v1/version').then(r => r.ok ? r.json() : null).then(v => {
    if (!v || !v.version) return;
    $('#hero-version').textContent = `NORE CLIENT ${v.version}`;
    $('#dl-version').textContent = `Wersja ${v.version} · ${new Date(v.published).toLocaleDateString('pl-PL')}`;
  }).catch(() => {});
  const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  fetch('/api/v1/news').then(r => r.ok ? r.json() : null).then(d => {
    if (!d || !d.news) return;
    $('#news-list').innerHTML = d.news.map(n => `<article><div class="meta"><time datetime="${esc(n.date)}">${esc(new Date(n.date).toLocaleDateString('pl-PL'))}</time><span>${esc(n.tag)}</span></div><h3>${esc(n.title)}</h3><p>${esc(n.text)}</p></article>`).join('');
  }).catch(() => {});
})();
