'use strict';
/*
 * Halloween edition: a seasonal theme (15.10 – 3.11, or forced in Settings) and the
 * "Cukierek albo psikus" mini-game. Everything is drawn procedurally (pixel art on canvases),
 * state lives in localStorage (and in memory when storage is unavailable).
 */
(function () {
  // ================================================================== storage + small utils

  const KEY_MODE = 'nore.hw.mode';
  const KEY_STATE = 'nore.hw.state.v1';
  const KEY_TAB = 'nore.hw.tab';
  const mem = {};
  const LS = {
    get(k, d) {
      try { const v = localStorage.getItem(k); if (v != null) return JSON.parse(v); } catch { /* storage unavailable */ }
      return k in mem ? mem[k] : d;
    },
    set(k, v) {
      mem[k] = v;
      try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ }
    },
  };

  const MIN = 60000;
  const MANA_MAX = 10;
  const MANA_MS = 12 * MIN;
  const VISIT_MS = 25 * MIN;
  const MAX_LVL = 10;
  const noAnim = () => document.body.classList.contains('no-anim');
  const pad2 = (n) => String(n).padStart(2, '0');
  const dayKey = (d = new Date()) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  function hashStr(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function rng(seed) {
    let a = seed >>> 0 || 1;
    return () => {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const h2 = (x, y, s = 0) => ((Math.imul(x + 31, 73856093) ^ Math.imul(y + 17, 19349663) ^ Math.imul(s + 7, 83492791)) >>> 0) % 1000 / 1000;
  const pick = (r, arr) => arr[Math.floor(r() * arr.length)];

  function shade(hex, f) {
    const n = parseInt(hex.slice(1), 16);
    const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(v => Math.round(f < 0 ? v * (1 + f) : v + (255 - v) * f));
    return '#' + c.map(v => clamp(v, 0, 255).toString(16).padStart(2, '0')).join('');
  }

  // ================================================================== season / mode

  function inSeason(d = new Date()) {
    const m = d.getMonth(), day = d.getDate();
    return (m === 9 && day >= 15) || (m === 10 && day <= 3);
  }
  const getMode = () => { const m = LS.get(KEY_MODE, 'auto'); return ['auto', 'on', 'off'].includes(m) ? m : 'auto'; };
  const themeOn = () => { const m = getMode(); return m === 'on' || (m === 'auto' && inSeason()); };
  const eventOpen = () => inSeason() || getMode() === 'on';

  // ================================================================== pixel primitives

  function R(g, x, y, w, h, c) { g.fillStyle = c; g.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h)); }
  function line(g, x0, y0, x1, y1, c) {
    x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
    g.fillStyle = c;
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (let i = 0; i < 2000; i++) {
      g.fillRect(x0, y0, 1, 1);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
  }
  function disc(g, cx, cy, r, c) {
    g.fillStyle = c;
    for (let dy = -r; dy <= r; dy++) {
      const dx = Math.floor(Math.sqrt(r * r - dy * dy) + 0.35);
      g.fillRect(Math.round(cx - dx), Math.round(cy + dy), dx * 2 + 1, 1);
    }
  }
  function halo(g, cx, cy, r, c, a) {
    g.globalAlpha = a * 0.35; disc(g, cx, cy, r, c);
    g.globalAlpha = a * 0.5; disc(g, cx, cy, Math.max(1, Math.round(r * 0.62)), c);
    g.globalAlpha = 1;
  }
  function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }

  /** Builds a sprite canvas from rows of palette characters ('.' = transparent). */
  function sprite(rows, pal) {
    const w = Math.max(...rows.map(r => r.length)), c = canvas(w, rows.length), g = c.getContext('2d');
    rows.forEach((row, y) => [...row].forEach((ch, x) => { if (pal[ch]) R(g, x, y, 1, 1, pal[ch]); }));
    return c;
  }
  function scaled(src, k) {
    const c = canvas(src.width * k, src.height * k), g = c.getContext('2d');
    g.imageSmoothingEnabled = false;
    g.drawImage(src, 0, 0, c.width, c.height);
    return c;
  }
  const url = (c) => { try { return c.toDataURL('image/png'); } catch { return ''; } };

  // ================================================================== sprites

  const PK = { G: '#2f5a1c', g: '#4f8a2a', o: '#b8420b', O: '#f97316', L: '#fdba74', y: '#ffd04a', Y: '#fff3a8' };
  const PUMPKIN = ['......Gg.....', '...ooOGOoo...', '.ooOLOoOLOoo.', 'oOOLOOoOOLOOo', 'oOyYOOoOOYyOo', 'oOOyOOoOOyOOo', 'oOOOOOyOOOOOo', 'oOyOyYyYyOyOo', 'oOOyYyOyYyOOo', '.oOOOOoOOOOo.', '..ooooooooo..'];
  const SMALL_PK = ['...g...', '.oOoOo.', 'oOyOyOo', 'oOOOOOo', 'oyyyyyo', '.ooooo.'];
  const BAT_A = ['k....k.k....k', 'kk...kkk...kk', 'kkk.krkrk.kkk', '.kkkkkkkkkkk.', '...kkkkkkk...', '.....k.k.....'];
  const BAT_B = ['.....k.k.....', '.....kkk.....', '....krkrk....', '..kkkkkkkkk..', '.kkkkkkkkkkk.', 'kk..kk.kk..kk'];
  const BATPAL = { k: '#1b0f26', r: '#ff5a3a' };
  const GHOST = ['...wwwww...', '..wwwwwwws..', '.wwwwwwwwws.', '.wwkwwwkwws.', '.wwkwwwkwws.', '.wwwwwwwwws.', 'wwwwwkwwwwss', 'wwwwwwwwwwss', 'wwwwwwwwwwss', 'wwwwwwwwwwss', 'ww.www.wws.s', 'w...w...w...'];
  const KID_TOP = ['....Gg...', '..oOOOo..', '.oOOOOOo.', '.oOOyOyo.', '.oOOOOOo.', '.oOyyyyo.', '..ooooo..', '..pPPPp..', '.pPPPPPpB', '.pPPPPPpB', '..pPPPp..'];
  const KID_A = ['..d...d..', '..d...d..', '.bb...bb.'];
  const KID_B = ['...d.d...', '...d.d...', '..bb.bb..'];
  const KIDPAL = { G: '#2f5a1c', g: '#4f8a2a', o: '#b8420b', O: '#f97316', y: '#ffd04a', p: '#4c1d95', P: '#7c3aed', d: '#2b1d3a', b: '#120b18', B: '#ff8a1f' };
  const KIDPAL_GREEN = { ...KIDPAL, o: '#15803d', O: '#4ade80', p: '#166534', P: '#22c55e', y: '#d9ff6a' };
  const LANTERN = ['..k..', '.kkk.', 'kyyyk', 'kyYyk', 'kyyyk', '.kkk.'];
  const GRAVE = ['..sssss..', '.sSSSSSs.', 'sSSSdSSSs', 'sSSdddSSs', 'sSSSdSSSs', 'sSSSdSSSs', 'sSSSSSSSs', 'sSSSSSSSs', 'sSSSSSSSs', 'sSSSSSSSs', 'ggsssssgg'];
  const CAULDRON = ['.GgGGgGGgG.', 'kKKKKKKKKKk', '.kkkkkkkkk.', 'kkkkkkkkkkk', 'kkkkkkkkkkk', '.kkkkkkkkk.', '..kkkkkkk..', '.k.......k.'];
  const CANDY = ['y...ooo...y', 'yy.ooOoo.yy', 'yyyoOOOoyyy', 'yy.ooOoo.yy', 'y...ooo...y'];
  const POTION = ['..kkk..', '..kmk..', '.kkmkk.', 'kmmmmmk', 'kmMmmmk', 'kmmmmmk', 'kmmmmmk', '.kmmmk.', '..kkk..'];
  const SPIDER = ['k.k.k.k', '.kkkkk.', 'kkrkrkk', '.kkkkk.', 'k.k.k.k'];
  const CROWN = ['Y..Y..Y', 'YyYYYyY', 'yyyyyyy'];

  const SPR = {};
  function buildSprites() {
    SPR.pumpkin = sprite(PUMPKIN, PK);
    SPR.pumpkinOff = sprite(PUMPKIN, { ...PK, y: '#5a2208', Y: '#5a2208' });
    SPR.smallPk = sprite(SMALL_PK, PK);
    SPR.batA = sprite(BAT_A, BATPAL);
    SPR.batB = sprite(BAT_B, BATPAL);
    SPR.batLightA = sprite(BAT_A, { k: '#2d1a40', r: '#ff6a3a' });
    SPR.batLightB = sprite(BAT_B, { k: '#2d1a40', r: '#ff6a3a' });
    SPR.ghost = sprite(GHOST, { w: '#eeeaff', s: '#bdb4e6', k: '#2a1838' });
    SPR.kidA = sprite([...KID_TOP, ...KID_A], KIDPAL);
    SPR.kidB = sprite([...KID_TOP, ...KID_B], KIDPAL);
    SPR.kidGA = sprite([...KID_TOP, ...KID_A], KIDPAL_GREEN);
    SPR.kidGB = sprite([...KID_TOP, ...KID_B], KIDPAL_GREEN);
    SPR.lantern = sprite(LANTERN, { k: '#262230', y: '#ffc857', Y: '#fff2b0' });
    SPR.grave = sprite(GRAVE, { S: '#77748a', s: '#4d4a5c', d: '#3a3846', g: '#2f5a2a' });
    SPR.cauldron = sprite(CAULDRON, { k: '#1c1a22', K: '#3d3a48', G: '#7dff5a', g: '#3fcf2f' });
    SPR.candy = sprite(CANDY, { y: '#fbbf24', o: '#f59e0b', O: '#fde68a' });
    SPR.potion = sprite(POTION, { k: '#2e1065', m: '#8b5cf6', M: '#e9ddff' });
    SPR.spider = sprite(SPIDER, { k: '#120b18', r: '#ff4a3a' });
    SPR.web = webSprite(56);
    SPR.webSmall = webSprite(14);
    // composite badges
    const king = canvas(13, 14), kg = king.getContext('2d');
    kg.drawImage(sprite(PUMPKIN.slice(1), PK), 0, 4);
    kg.drawImage(sprite(CROWN, { Y: '#ffe066', y: '#e0a800' }), 3, 0);
    SPR.king = king;
    SPR.capes = { dynia: capeSprite('dynia'), nietoperz: capeSprite('nietoperz'), pajeczyna: capeSprite('pajeczyna') };
  }

  /** Pixel spider web anchored in the top-right corner. */
  function webSprite(n) {
    const c = canvas(n, n), g = c.getContext('2d');
    const cx = n - 1, cy = 0, spokes = 6, rings = n > 20 ? [0.13, 0.25, 0.39, 0.55, 0.72, 0.9] : [0.4, 0.75];
    const pts = [];
    for (let i = 0; i < spokes; i++) {
      const a = (i / (spokes - 1)) * Math.PI / 2;
      const ex = cx - Math.cos(a) * (n - 1), ey = cy + Math.sin(a) * (n - 1);
      line(g, cx, cy, ex, ey, 'rgba(236,230,255,.8)');
      pts.push(a);
    }
    rings.forEach((rr, k) => {
      const r = rr * (n - 1);
      for (let i = 0; i < spokes - 1; i++) {
        const a0 = pts[i], a1 = pts[i + 1], am = (a0 + a1) / 2, sag = r * 0.12;
        const x0 = cx - Math.cos(a0) * r, y0 = cy + Math.sin(a0) * r, x1 = cx - Math.cos(a1) * r, y1 = cy + Math.sin(a1) * r;
        const mx = cx - Math.cos(am) * (r - sag), my = cy + Math.sin(am) * (r - sag);
        const col = `rgba(236,230,255,${(0.75 - k * 0.06).toFixed(2)})`;
        line(g, x0, y0, mx, my, col); line(g, mx, my, x1, y1, col);
      }
    });
    return c;
  }

  function capeSprite(kind) {
    const c = canvas(12, 16), g = c.getContext('2d');
    const pal = { dynia: ['#e8590c', '#9c3606', '#ff8c3a'], nietoperz: ['#2b1b3d', '#140c1f', '#3f2a58'], pajeczyna: ['#2a2a33', '#141419', '#3a3a46'] }[kind];
    for (let y = 0; y < 16; y++) {
      const inset = y < 2 ? 1 : 0;
      R(g, inset, y, 12 - inset * 2, 1, pal[0]);
      R(g, inset, y, 1, 1, pal[1]); R(g, 11 - inset, y, 1, 1, pal[1]);
      if (y > 1 && y < 15) R(g, 1 + inset, y, 1, 1, pal[2]);
    }
    R(g, 0, 15, 12, 1, pal[1]);
    if (kind === 'dynia') {
      const y = '#ffd43b';
      R(g, 3, 5, 2, 1, y); R(g, 3, 6, 1, 1, y); R(g, 7, 5, 2, 1, y); R(g, 8, 6, 1, 1, y);
      R(g, 5, 8, 2, 1, y);
      [[2, 10], [3, 11], [4, 10], [5, 11], [6, 10], [7, 11], [8, 10], [9, 11]].forEach(([x, yy]) => R(g, x, yy, 1, 1, y));
      R(g, 5, 0, 2, 2, '#4f8a2a');
    } else if (kind === 'nietoperz') {
      g.drawImage(sprite(['k...k.k...k', 'kk..kkk..kk', 'kkkkrkrkkkk', '.kkkkkkkkk.', '...kk.kk...'], { k: '#a678ff', r: '#ff5a3a' }), 0, 6);
    } else {
      const w = 'rgba(225,225,235,.85)';
      for (let i = 0; i < 5; i++) { const a = Math.PI * (0.15 + i * 0.175); line(g, 6, 2, 6 + Math.cos(a) * 9, 2 + Math.sin(a) * 13, w); }
      [5, 9, 13].forEach(r => { for (let i = 0; i < 4; i++) { const a0 = Math.PI * (0.15 + i * 0.175), a1 = a0 + Math.PI * 0.175; line(g, 6 + Math.cos(a0) * r * 0.7, 2 + Math.sin(a0) * r, 6 + Math.cos(a1) * r * 0.7, 2 + Math.sin(a1) * r, w); } });
    }
    return c;
  }

  // ================================================================== catalog

  const WALLS = {
    planks: { base: '#7a4e2d', dark: '#583720', light: '#95623a' },
    stone: { base: '#62636c', dark: '#3f4047', light: '#7f808b' },
    brick: { base: '#8e3b2b', dark: '#55241a', light: '#a9523e' },
    darkoak: { base: '#3b2717', dark: '#24170d', light: '#513622' },
  };
  const ROOFS = { red: '#7a1f2b', purple: '#4c2a7a', moss: '#2f5a35', night: '#22305e', pumpkin: '#c2410c' };
  const DOORS = { wood: '#6b4226', arch: '#4a2a18', iron: '#4b5260', witch: '#3b1d5e' };
  const GLOWS = { warm: '#ffcf6b', pumpkin: '#ff8a1f', toxic: '#7dff6a', violet: '#b57bff', blood: '#ff4a4a' };

  const OPTS = {
    wall: { label: 'Ściany', icon: 'box', items: [
      { id: 'planks', name: 'Deski', lvl: 1, cost: 0, charm: 0 },
      { id: 'stone', name: 'Kamień', lvl: 2, cost: 40, charm: 5 },
      { id: 'brick', name: 'Cegła', lvl: 4, cost: 60, charm: 8 },
      { id: 'darkoak', name: 'Ciemny dąb', lvl: 6, cost: 80, charm: 12 }] },
    roof: { label: 'Dach', icon: 'home', items: [
      { id: 'red', name: 'Wiśniowy', lvl: 1, cost: 0, charm: 0 },
      { id: 'purple', name: 'Fioletowy', lvl: 1, cost: 25, charm: 4 },
      { id: 'moss', name: 'Omszały', lvl: 3, cost: 25, charm: 4 },
      { id: 'night', name: 'Nocny', lvl: 3, cost: 25, charm: 4 },
      { id: 'pumpkin', name: 'Dyniowy', lvl: 5, cost: 35, charm: 7 }] },
    door: { label: 'Drzwi', icon: 'layers', items: [
      { id: 'wood', name: 'Drewniane', lvl: 1, cost: 0, charm: 0 },
      { id: 'arch', name: 'Łukowe', lvl: 2, cost: 30, charm: 5 },
      { id: 'iron', name: 'Okute', lvl: 4, cost: 50, charm: 7 },
      { id: 'witch', name: 'Wiedźmie', lvl: 7, cost: 70, candy: 1, charm: 12 }] },
    glow: { label: 'Światło w oknach', icon: 'sun', items: [
      { id: 'warm', name: 'Ciepłe', lvl: 1, cost: 0, charm: 0 },
      { id: 'pumpkin', name: 'Dyniowe', lvl: 1, cost: 15, charm: 3 },
      { id: 'toxic', name: 'Upiorna zieleń', lvl: 3, cost: 30, charm: 5 },
      { id: 'violet', name: 'Fiolet', lvl: 5, cost: 30, charm: 5 },
      { id: 'blood', name: 'Krwista czerwień', lvl: 8, cost: 40, charm: 7 }] },
    deco: { label: 'Ozdoby', icon: 'sparkles', multi: true, items: [
      { id: 'lanterns', name: 'Lampiony z dyń', lvl: 1, cost: 20, charm: 6 },
      { id: 'lantern', name: 'Latarnia', lvl: 2, cost: 30, charm: 6 },
      { id: 'web', name: 'Pajęczyna', lvl: 3, cost: 25, charm: 6 },
      { id: 'grave', name: 'Nagrobek', lvl: 5, cost: 35, charm: 8 },
      { id: 'cauldron', name: 'Kocioł', lvl: 6, cost: 60, candy: 1, charm: 12 }] },
  };

  const HW_ACCENTS = {
    hw_pumpkin: { name: 'Dyniowy', a: '#ff7518', b: '#ffb04a', d: '#d9480f' },
    hw_witch: { name: 'Wiedźmi', a: '#9b5cff', b: '#cfa8ff', d: '#6a2bd9' },
  };
  const HW_SCENES = {
    'hw-moon': { name: 'Pełnia', desc: 'Halloween – księżyc nad cmentarzem' },
    'hw-patch': { name: 'Dyniowe pole', desc: 'Halloween – pole lampionów' },
  };
  const BADGES = { pumpkin: 'Dyniogłowy', bat: 'Nocny lotnik', king: 'Król Halloween' };
  const CAPE_NAMES = { dynia: 'Dynia', nietoperz: 'Nietoperz', pajeczyna: 'Pajęczyna' };

  const ROAD = [
    { lvl: 1, pk: 10, items: [{ type: 'badge', id: 'pumpkin' }] },
    { lvl: 2, pk: 20, items: [{ type: 'accent', id: 'hw_pumpkin' }] },
    { lvl: 3, pk: 25, items: [{ type: 'cape', id: 'dynia' }] },
    { lvl: 4, pk: 30, items: [{ type: 'scene', id: 'hw-moon' }] },
    { lvl: 5, pk: 35, items: [{ type: 'cursor', id: 'pumpkin' }] },
    { lvl: 6, pk: 40, items: [{ type: 'badge', id: 'bat' }] },
    { lvl: 7, pk: 45, items: [{ type: 'cape', id: 'nietoperz' }] },
    { lvl: 8, pk: 50, items: [{ type: 'accent', id: 'hw_witch' }] },
    { lvl: 9, pk: 60, items: [{ type: 'scene', id: 'hw-patch' }] },
    { lvl: 10, pk: 100, items: [{ type: 'cape', id: 'pajeczyna' }, { type: 'badge', id: 'king' }] },
  ];
  const TYPE_LABEL = { badge: 'Odznaka profilu', accent: 'Kolor akcentu', cape: 'Peleryna w grze', scene: 'Tło launchera', cursor: 'Poświata kursora' };
  function itemName(it) {
    if (it.type === 'badge') return `Odznaka „${BADGES[it.id]}”`;
    if (it.type === 'accent') return `Akcent „${HW_ACCENTS[it.id].name}”`;
    if (it.type === 'cape') return `Peleryna „${CAPE_NAMES[it.id]}”`;
    if (it.type === 'scene') return `Tło „${HW_SCENES[it.id].name}”`;
    return 'Poświata „Dyniowa”';
  }

  const NICK_A = ['Nocny', 'Upiorny', 'Dyniowy', 'Cichy', 'Mglisty', 'Szalony', 'Kościsty', 'Wiedźmi', 'Senny', 'Psotny', 'Mroczny', 'Zgrzytający'];
  const NICK_B = ['Wilk', 'Duch', 'Kot', 'Kruk', 'Nietoperz', 'Pająk', 'Zombie', 'Szkielet', 'Wampir', 'Golem', 'Puchacz', 'Strach'];
  const STREETS = ['ulica Dyniowa', 'aleja Nietoperzy', 'ulica Mglista', 'zaułek Czarownic', 'ulica Kościana', 'aleja Lampionów', 'ulica Pajęcza', 'plac Duchów'];
  const genNick = (r) => pick(r, NICK_A) + pick(r, NICK_B) + (r() < 0.6 ? Math.floor(r() * 90 + 10) : '');

  // ================================================================== game state

  function defaults() {
    const now = Date.now();
    return {
      v: 1, pumpkins: 25, candy: 0, xp: 0, mana: MANA_MAX, manaTs: now,
      owned: { 'wall:planks': 1, 'roof:red': 1, 'door:wood': 1, 'glow:warm': 1 },
      house: { wall: 'planks', roof: 'red', door: 'wood', glow: 'warm', deco: {} },
      door: 'treat', daily: { last: '', streak: 0 }, knock: { day: '', street: 0, done: {} },
      claimed: [], equip: { badge: '', cursor: false }, visit: { ts: now, log: [] },
      stats: { knocks: 0, treats: 0, tricks: 0, visitors: 0 }, greenUntil: 0,
    };
  }
  function load() {
    const d = defaults(), s = LS.get(KEY_STATE, null);
    if (!s || typeof s !== 'object') return d;
    const st = { ...d, ...s };
    for (const k of ['owned', 'house', 'daily', 'knock', 'equip', 'visit', 'stats']) st[k] = { ...d[k], ...(s[k] && typeof s[k] === 'object' ? s[k] : {}) };
    st.house.deco = { ...(st.house.deco || {}) };
    if (!Array.isArray(st.claimed)) st.claimed = [];
    if (!Array.isArray(st.visit.log)) st.visit.log = [];
    for (const k of ['pumpkins', 'candy', 'xp', 'mana', 'manaTs']) if (typeof st[k] !== 'number' || !isFinite(st[k])) st[k] = d[k];
    return st;
  }
  const save = (st) => LS.set(KEY_STATE, st);

  const xpFor = (lvl) => 60 + 30 * (lvl - 1);
  function levelInfo(xp) {
    let lvl = 1, rest = xp;
    while (lvl < MAX_LVL && rest >= xpFor(lvl)) { rest -= xpFor(lvl); lvl++; }
    return { lvl, cur: lvl >= MAX_LVL ? 1 : rest, need: lvl >= MAX_LVL ? 1 : xpFor(lvl), max: lvl >= MAX_LVL };
  }
  function regen(st, now = Date.now()) {
    if (st.mana >= MANA_MAX) { st.mana = MANA_MAX; st.manaTs = now; return; }
    const n = Math.floor((now - st.manaTs) / MANA_MS);
    if (n > 0) { st.mana = Math.min(MANA_MAX, st.mana + n); st.manaTs += n * MANA_MS; }
    if (st.mana >= MANA_MAX || st.manaTs > now) st.manaTs = Math.min(now, st.manaTs);
  }
  const manaLeft = (st) => Math.max(0, MANA_MS - (Date.now() - st.manaTs));
  const owns = (st, type, id) => ROAD.some(t => st.claimed.includes(t.lvl) && t.items.some(i => i.type === type && i.id === id));
  function charm(st, house = st.house) {
    let c = 0;
    for (const k of ['wall', 'roof', 'door', 'glow']) { const it = OPTS[k].items.find(i => i.id === house[k]); c += it ? it.charm : 0; }
    for (const it of OPTS.deco.items) if (house.deco[it.id]) c += it.charm;
    return c;
  }

  /** Simulated guests that knocked on your door while you were away. */
  function processVisitors(st, names) {
    const now = Date.now();
    if (!st.visit.ts || st.visit.ts > now) { st.visit.ts = now; return []; }
    const cap = 3 + Math.floor(charm(st) / 12);
    const n = Math.min(cap, Math.floor((now - st.visit.ts) / VISIT_MS));
    if (n <= 0) return [];
    st.visit.ts = now;
    const r = rng(hashStr(String(now)));
    const out = [];
    const bonus = Math.floor(charm(st) / 20);
    for (let i = 0; i < n; i++) {
      const who = names.length && r() < 0.5 ? pick(r, names) : genNick(r);
      const e = st.door === 'treat'
        ? { who, door: 'treat', xp: 8 + bonus, pk: bonus }
        : { who, door: 'trick', xp: 3, pk: 3 + bonus + Math.floor(r() * 3) };
      st.xp += e.xp; st.pumpkins += e.pk; st.stats.visitors++;
      e.ts = now - (n - i) * 60000;
      out.push(e);
    }
    st.visit.log = [...out.reverse(), ...st.visit.log].slice(0, 8);
    return out;
  }

  // ================================================================== scene drawing

  function starField(seed, W, H, n) {
    const r = rng(seed);
    return Array.from({ length: n }, () => ({ x: Math.floor(r() * W), y: Math.floor(r() * H), ph: r() * 6.28, sp: 0.5 + r() * 1.5, b: r() }));
  }

  function drawSky(g, W, horizon, cols) {
    const band = Math.ceil(horizon / cols.length);
    cols.forEach((c, i) => R(g, 0, i * band, W, band + 1, c));
    for (let i = 1; i < cols.length; i++) {
      const y = i * band;
      g.fillStyle = cols[i]; for (let x = y % 2; x < W; x += 2) g.fillRect(x, y - 1, 1, 1);
      g.fillStyle = cols[i - 1]; for (let x = (y + 1) % 2; x < W; x += 2) g.fillRect(x, y, 1, 1);
    }
  }
  function drawStars(g, stars, t, still) {
    for (const s of stars) {
      const tw = still ? s.b * 2 - 1 : Math.sin(t * 0.0018 * s.sp + s.ph);
      if (s.b > 0.86 && tw > 0.35) {
        R(g, s.x - 1, s.y, 3, 1, '#9d93cf'); R(g, s.x, s.y - 1, 1, 3, '#9d93cf'); R(g, s.x, s.y, 1, 1, '#fff7dc');
      } else if (tw > -0.4) {
        R(g, s.x, s.y, 1, 1, s.b > 0.5 ? '#d9d2ff' : '#7d73ad');
      }
    }
  }
  function drawMoon(g, cx, cy, r) {
    g.globalAlpha = 0.06; disc(g, cx, cy, r + 11, '#fff0c2');
    g.globalAlpha = 0.09; disc(g, cx, cy, r + 6, '#fff0c2');
    g.globalAlpha = 0.14; disc(g, cx, cy, r + 2, '#fff0c2');
    g.globalAlpha = 1;
    disc(g, cx, cy, r, '#f2e8bd');
    for (let dy = -r; dy <= r; dy++) {
      const dx = Math.floor(Math.sqrt(r * r - dy * dy) + 0.35);
      if (dy > -r * 0.7) R(g, cx + dx - Math.max(1, Math.round(r * 0.14)), cy + dy, Math.max(1, Math.round(r * 0.14)), 1, '#d7cb97');
    }
    [[-0.38, -0.18, 0.22], [0.22, 0.32, 0.17], [0.08, -0.48, 0.11], [-0.15, 0.5, 0.12], [0.45, -0.08, 0.1]].forEach(([fx, fy, fr]) => {
      const rr = Math.max(1, Math.round(fr * r));
      disc(g, cx + fx * r, cy + fy * r, rr, '#ddd1a2');
      R(g, cx + fx * r - rr + 1, cy + fy * r - rr + 1, 1, 1, '#faf3d6');
    });
  }
  function drawClouds(g, W, t, y0, still, n = 3) {
    for (let i = 0; i < n; i++) {
      const w = 26 + i * 9, sp = 0.0016 + i * 0.0007;
      const x = Math.round(((i * 137 + (still ? 0 : t * sp)) % (W + 90)) - 50);
      const y = y0 + i * 9 + (i % 2) * 4;
      g.globalAlpha = 0.82;
      R(g, x, y, w, 4, '#2f2148'); R(g, x + 4, y - 2, w - 10, 2, '#3a2a57'); R(g, x + 8, y - 4, Math.round(w * 0.35), 2, '#3a2a57');
      R(g, x + 2, y + 4, w - 4, 1, '#251a3a');
      g.globalAlpha = 1;
    }
  }
  function drawHills(g, W, H, base) {
    for (let x = 0; x < W; x++) {
      const y = Math.round(base - 12 + Math.sin(x * 0.034 + 1.3) * 5 + Math.sin(x * 0.091) * 2);
      R(g, x, y, 1, H - y, '#1e1331');
    }
    for (let x = 0; x < W; x++) {
      const y = Math.round(base - 4 + Math.sin(x * 0.052 + 4) * 3 + Math.sin(x * 0.13 + 1) * 1);
      R(g, x, y, 1, H - y, '#170e27');
    }
  }
  function drawTree(g, x, gy, h, seed, col) {
    const r = rng(seed);
    R(g, x - 1, gy - h * 0.5, 3, h * 0.5 + 1, col);
    R(g, x - 2, gy - 2, 5, 2, col);
    const br = (x0, y0, ang, len, d) => {
      const x1 = x0 + Math.cos(ang) * len, y1 = y0 + Math.sin(ang) * len;
      line(g, x0, y0, x1, y1, col);
      if (d >= 3) line(g, x0 + 1, y0, x1 + 1, y1, col);
      if (d > 0 && len > 2.5) {
        br(x1, y1, ang - 0.35 - r() * 0.35, len * (0.62 + r() * 0.14), d - 1);
        br(x1, y1, ang + 0.3 + r() * 0.35, len * (0.6 + r() * 0.14), d - 1);
        if (r() < 0.3) br(x1, y1, ang + (r() - 0.5) * 0.3, len * 0.5, d - 1);
      }
    };
    br(x, gy - h * 0.5, -Math.PI / 2 + (r() - 0.5) * 0.25, h * 0.3, 4);
  }
  function drawGround(g, W, H, gy, seed) {
    R(g, 0, gy, W, H - gy, '#1b2a1b');
    R(g, 0, gy, W, 2, '#2c4a26');
    R(g, 0, gy + 2, W, 1, '#22381f');
    for (let x = 0; x < W; x++) {
      const v = h2(x, 0, seed);
      if (v < 0.35) R(g, x, gy - 1, 1, 1, '#2c4a26');
      if (v < 0.08) R(g, x, gy - 2, 1, 1, '#38602f');
      for (let y = gy + 4; y < H; y += 3) if (h2(x, y, seed) < 0.06) R(g, x, y, 1, 1, '#243822');
    }
  }
  function drawFence(g, x0, x1, gy) {
    R(g, x0, gy - 6, x1 - x0, 1, '#352840'); R(g, x0, gy - 3, x1 - x0, 1, '#352840');
    for (let x = x0; x < x1; x += 4) { R(g, x, gy - 8, 2, 8, '#3d2e4a'); R(g, x, gy - 8, 1, 1, '#54426a'); }
  }
  function drawLamp(g, x, gy, t, still) {
    R(g, x, gy - 18, 1, 18, '#2b2233'); R(g, x - 1, gy - 1, 3, 1, '#2b2233');
    const f = still ? 1 : 0.85 + 0.15 * Math.sin(t * 0.01 + x);
    halo(g, x, gy - 19, 6, '#ffd27a', 0.45 * f);
    R(g, x - 1, gy - 21, 3, 3, '#ffd27a'); R(g, x - 1, gy - 22, 3, 1, '#2b2233');
  }

  function wallTexture(g, x0, y0, w, h, type, seed) {
    const p = WALLS[type] || WALLS.planks;
    R(g, x0, y0, w, h, p.base);
    if (type === 'planks') {
      for (let y = 0; y < h; y++) {
        if (y % 4 === 3) R(g, x0, y0 + y, w, 1, p.dark);
        else if (y % 4 === 0) R(g, x0, y0 + y, w, 1, p.light);
      }
      for (let row = 0; row < h / 4; row++) { const sx = (row * 11 + seed) % 13; for (let x = sx; x < w; x += 13) R(g, x0 + x, y0 + row * 4, 1, 3, p.dark); }
    } else if (type === 'stone') {
      R(g, x0, y0, w, h, p.dark);
      let y = 0, row = 0;
      while (y < h) {
        const bh = 4 + (row % 2);
        let x = -((row * 3) % 5);
        while (x < w) {
          const bw = 5 + Math.floor(h2(x, row, seed) * 5);
          const xa = Math.max(0, x), xb = Math.min(w, x + bw - 1);
          if (xb > xa) {
            R(g, x0 + xa, y0 + y, xb - xa, Math.min(bh - 1, h - y), h2(x, row + 9, seed) < 0.3 ? p.light : p.base);
            R(g, x0 + xa, y0 + y, xb - xa, 1, p.light);
          }
          x += bw;
        }
        y += bh; row++;
      }
    } else if (type === 'brick') {
      R(g, x0, y0, w, h, p.dark);
      for (let row = 0; row * 3 < h; row++) {
        const off = row % 2 ? 3 : 0;
        for (let x = -off; x < w; x += 6) {
          const xa = Math.max(0, x), xb = Math.min(w, x + 5);
          if (xb > xa) R(g, x0 + xa, y0 + row * 3, xb - xa, Math.min(2, h - row * 3), h2(x, row, seed) < 0.25 ? p.light : p.base);
        }
      }
    } else {
      for (let x = 0; x < w; x++) {
        if (x % 4 === 3) R(g, x0 + x, y0, 1, h, p.dark);
        else if (x % 4 === 0) R(g, x0 + x, y0, 1, h, p.light);
      }
      for (let i = 0; i < 4; i++) R(g, x0 + Math.floor(h2(i, 3, seed) * (w - 2)) + 1, y0 + Math.floor(h2(i, 7, seed) * (h - 3)) + 1, 1, 2, p.dark);
    }
  }

  function drawWindow(g, x, y, w, h, glow, t, still, lit, cat) {
    const f = still ? 1 : 0.82 + 0.18 * Math.sin(t * 0.004 + x * 0.7) * Math.sin(t * 0.0067 + y);
    if (lit) halo(g, x + w / 2, y + h / 2, Math.round(w * 0.95), glow, 0.4 * f);
    R(g, x - 1, y - 1, w + 2, h + 2, '#1e130c');
    R(g, x, y, w, h, lit ? glow : '#16111d');
    if (lit) { g.globalAlpha = 0.45; R(g, x + 1, y + 1, w - 2, h - 2, '#fff7d6'); g.globalAlpha = 1; R(g, x + 2, y + 2, w - 4, h - 4, glow); }
    if (lit && cat) { R(g, x + 1, y + h - 3, 3, 3, '#140c12'); R(g, x + 1, y + h - 4, 1, 1, '#140c12'); R(g, x + 3, y + h - 4, 1, 1, '#140c12'); }
    R(g, x + Math.floor(w / 2), y, 1, h, '#1e130c'); R(g, x, y + Math.floor(h / 2), w, 1, '#1e130c');
    R(g, x - 2, y + h + 1, w + 4, 1, '#5a463a');
  }

  function drawDoor(g, x, y, w, h, type, open, shake) {
    x += shake;
    R(g, x - 1, y - 1, w + 2, h + 1, '#22150d');
    if (open) {
      R(g, x, y, w, h, '#2a1208');
      g.globalAlpha = 0.85; R(g, x + 1, y + 2, w - 2, h - 2, '#ffb347'); g.globalAlpha = 0.6; R(g, x + 2, y + 4, w - 4, h - 4, '#fff0c0'); g.globalAlpha = 1;
      R(g, x, y, 2, h, DOORS[type] || DOORS.wood);
      return;
    }
    const c = DOORS[type] || DOORS.wood;
    R(g, x, y, w, h, c);
    if (type === 'wood') {
      for (let i = 2; i < w; i += 3) R(g, x + i, y, 1, h, shade(c, -0.3));
      R(g, x, y + 3, w, 1, shade(c, -0.35)); R(g, x, y + h - 4, w, 1, shade(c, -0.35));
      R(g, x + w - 3, y + Math.floor(h / 2), 1, 1, '#e8c547');
    } else if (type === 'arch') {
      R(g, x, y, 2, 1, '#22150d'); R(g, x + w - 2, y, 2, 1, '#22150d'); R(g, x, y + 1, 1, 1, '#22150d'); R(g, x + w - 1, y + 1, 1, 1, '#22150d');
      for (let i = 1; i < w; i += 3) R(g, x + i, y + 2, 1, h - 2, shade(c, -0.3));
      R(g, x, y + 4, w, 1, '#6a6a76'); R(g, x, y + h - 5, w, 1, '#6a6a76');
      R(g, x + w - 4, y + Math.floor(h / 2) - 1, 2, 2, '#c9a03a');
    } else if (type === 'iron') {
      R(g, x + 1, y + 1, w - 2, h - 2, shade(c, 0.08));
      for (let yy = 2; yy < h - 1; yy += 4) for (let xx = 2; xx < w - 1; xx += 4) R(g, x + xx, y + yy, 1, 1, '#9aa3b4');
      R(g, x + w - 3, y + Math.floor(h / 2), 1, 2, '#d8dde6');
    } else {
      R(g, x, y, 2, 1, '#22150d'); R(g, x + w - 2, y, 2, 1, '#22150d');
      R(g, x + 2, y + 2, w - 4, h - 4, '#5b2d91');
      const mx = x + Math.floor(w / 2) - 1, my = y + 4;
      R(g, mx, my, 2, 1, '#ffe066'); R(g, mx - 1, my + 1, 1, 2, '#ffe066'); R(g, mx, my + 3, 2, 1, '#ffe066');
      R(g, x + w - 4, y + Math.floor(h / 2), 1, 1, '#7dff6a');
    }
  }

  /**
   * Draws a house. cfg = {wall, roof, door, glow, deco}, o = {w, tall, seed, t, still, open, shake, lit, cat, smoke}.
   * Returns the door rect (for the knocking animation).
   */
  function drawHouse(g, cx, gy, cfg, o) {
    const W = o.w || 56, WH = o.tall ? 44 : 32, RH = Math.round(W * 0.36), t = o.t || 0, still = !!o.still;
    const x0 = Math.round(cx - W / 2), y0 = gy - WH;
    const roof = ROOFS[cfg.roof] || ROOFS.red, glow = GLOWS[cfg.glow] || GLOWS.warm, lit = o.lit !== false;
    const deco = cfg.deco || {};
    // chimney (behind the roof)
    const chx = x0 + Math.round(W * 0.68);
    R(g, chx, y0 - RH + 2, 6, RH, '#3b2f3a'); R(g, chx - 1, y0 - RH + 1, 8, 2, '#4a3c48');
    for (let yy = y0 - RH + 4; yy < y0; yy += 3) R(g, chx, yy, 6, 1, '#2d232c');
    if (o.smoke && !still) {
      for (let i = 0; i < 4; i++) {
        const p = ((t * 0.0006 + i / 4) % 1);
        g.globalAlpha = 0.45 * (1 - p);
        R(g, chx + 2 + Math.sin(p * 6 + i) * 3, y0 - RH - 2 - p * 22, 2 + Math.round(p * 3), 2 + Math.round(p * 2), '#8a7fa0');
      }
      g.globalAlpha = 1;
    }
    // walls
    wallTexture(g, x0, y0, W, WH, cfg.wall, o.seed || 3);
    R(g, x0, y0, 2, WH, '#2a1a10'); R(g, x0 + W - 2, y0, 2, WH, '#2a1a10');
    R(g, x0 + W - 4, y0, 2, WH, 'rgba(0,0,0,.18)');
    g.globalAlpha = 0.35; R(g, x0, y0, W, 3, '#000'); g.globalAlpha = 1;
    R(g, x0 - 1, gy - 3, W + 2, 3, '#3d3644'); R(g, x0 - 1, gy - 3, W + 2, 1, '#544b5e');
    // roof
    const ov = 4;
    for (let i = 0; i <= RH; i++) {
      const half = (W / 2 + ov) * (1 - i / (RH + 1));
      const yy = y0 - 1 - i, xa = Math.round(cx - half), w2 = Math.max(1, Math.round(half * 2));
      R(g, xa, yy, w2, 1, i % 3 === 0 ? shade(roof, -0.28) : roof);
      R(g, xa, yy, 1, 1, shade(roof, 0.25)); R(g, xa + w2 - 1, yy, 1, 1, shade(roof, -0.45));
      if (i % 3 === 1) for (let x = xa + ((i * 2) % 4); x < xa + w2 - 1; x += 4) R(g, x, yy, 1, 1, shade(roof, -0.15));
    }
    R(g, Math.round(cx - W / 2 - ov), y0 - 1, W + ov * 2, 1, shade(roof, -0.5));
    // attic window
    const aw = Math.max(3, Math.round(W * 0.07));
    const ay = y0 - Math.round(RH * 0.42);
    halo(g, cx, ay, aw + 3, glow, lit ? 0.35 : 0);
    disc(g, cx, ay, aw, '#1e130c'); disc(g, cx, ay, aw - 1, lit ? glow : '#16111d');
    R(g, cx, ay - aw + 1, 1, aw * 2 - 1, '#1e130c');
    // windows
    const ww = Math.max(7, Math.round(W * 0.17)), wh = Math.max(7, Math.round(W * 0.16));
    const rows = o.tall ? [y0 + 5, y0 + 22] : [y0 + 8];
    rows.forEach((wy, ri) => {
      drawWindow(g, x0 + Math.round(W * 0.12), wy, ww, wh, glow, t, still, lit, o.cat && ri === rows.length - 1);
      drawWindow(g, x0 + W - Math.round(W * 0.12) - ww, wy, ww, wh, glow, t + 900, still, lit, false);
      if (o.tall && ri === 0) drawWindow(g, Math.round(cx - ww / 2), wy, ww, wh, glow, t + 400, still, lit, false);
    });
    // door + steps
    const dw = Math.max(8, Math.round(W * 0.21)), dh = Math.min(WH - 8, Math.max(13, Math.round(W * 0.32)));
    const dx = Math.round(cx - dw / 2), dy = gy - 3 - dh;
    drawDoor(g, dx, dy, dw, dh, cfg.door, !!o.open, o.shake || 0);
    R(g, dx - 2, gy - 2, dw + 4, 2, '#5a5262'); R(g, dx - 2, gy - 2, dw + 4, 1, '#6e6578');
    // decorations
    const fl = (k) => (still ? 1 : 0.75 + 0.25 * Math.sin(t * 0.012 + k) * Math.sin(t * 0.007 + k * 2));
    if (deco.web) {
      g.drawImage(SPR.webSmall, x0 + W - 14, y0);
      g.save(); g.translate(x0 + 14, y0); g.scale(-1, 1); g.drawImage(SPR.webSmall, 0, 0); g.restore();
      R(g, x0 + W - 7, y0 + 7, 1, 4, 'rgba(236,230,255,.6)'); g.drawImage(SPR.spider, x0 + W - 10, y0 + 11);
    }
    if (deco.lantern) {
      const lx = dx - 7, ly = dy + 2;
      R(g, lx + 2, ly - 2, 4, 1, '#262230'); R(g, lx + 2, ly - 1, 1, 1, '#262230');
      halo(g, lx + 2, ly + 3, 7, '#ffd27a', 0.5 * fl(1));
      g.drawImage(SPR.lantern, lx, ly);
    }
    if (deco.lanterns) {
      [[dx - 10, 0], [dx + dw + 3, 2]].forEach(([px, k]) => {
        halo(g, px + 3, gy - 3, 6, '#ff9a2e', 0.5 * fl(k + 3));
        g.drawImage(SPR.smallPk, px, gy - 6);
      });
    }
    if (deco.grave) g.drawImage(SPR.grave, x0 - 15, gy - 10);
    if (deco.cauldron) {
      const cx2 = x0 + W + 6;
      halo(g, cx2 + 5, gy - 7, 9, '#7dff5a', 0.32 * fl(5));
      g.drawImage(SPR.cauldron, cx2, gy - 9);
      const ff = still ? 0 : Math.floor(t / 120) % 3;
      R(g, cx2 + 3 + ff, gy - 1, 1, 1, '#ffb02e'); R(g, cx2 + 6 - ff, gy - 1, 1, 1, '#ff6a1a'); R(g, cx2 + 4, gy - 1, 3, 1, '#ff8a1f');
      if (!still) for (let i = 0; i < 3; i++) { const p = (t * 0.0009 + i / 3) % 1; g.globalAlpha = 1 - p; R(g, cx2 + 3 + i * 2, gy - 10 - p * 8, 1, 1, '#b6ff9e'); g.globalAlpha = 1; }
    }
    return { x: dx, y: dy, w: dw, h: dh };
  }

  function drawKid(g, x, gy, frame, green, flip) {
    const s = green ? (frame ? SPR.kidGB : SPR.kidGA) : (frame ? SPR.kidB : SPR.kidA);
    g.globalAlpha = 0.35; R(g, x + 1, gy - 1, 7, 1, '#000'); g.globalAlpha = 1;
    if (flip) { g.save(); g.translate(Math.round(x) + s.width, 0); g.scale(-1, 1); g.drawImage(s, 0, gy - s.height); g.restore(); }
    else g.drawImage(s, Math.round(x), gy - s.height);
  }
  function drawBat(g, x, y, t, light) {
    const f = Math.floor(t / 110 + x) % 2;
    g.drawImage(light ? (f ? SPR.batLightA : SPR.batLightB) : (f ? SPR.batA : SPR.batB), Math.round(x), Math.round(y));
  }

  /** Night backdrop shared by the mini-game, the home hero and the Halloween backgrounds. */
  function drawNight(g, W, H, gy, t, still, st) {
    drawSky(g, W, gy - 6, ['#090616', '#0e0920', '#140d2b', '#1b1136', '#241540', '#2e1a49']);
    drawStars(g, st.stars, t, still);
    const mr = Math.max(10, Math.round(H * 0.13));
    drawMoon(g, Math.round(W * 0.8), Math.round(H * 0.3), mr);
    drawClouds(g, W, t, Math.round(H * 0.16), still);
    if (!still) {
      for (let i = 0; i < 2; i++) {
        const a = t * 0.0007 + i * 3.1;
        drawBat(g, W * 0.8 + Math.cos(a) * (mr + 14 + i * 6), H * 0.3 + Math.sin(a * 1.3) * (mr * 0.6 + 4), t + i * 50, true);
      }
    }
    drawHills(g, W, H, gy);
  }

  // ------------------------------------------------------------------ launcher backgrounds (rewards)

  function drawBgScene(g, W, H, id, t, still, st) {
    const gy = Math.round(H * 0.8);
    if (id === 'hw-patch') {
      drawSky(g, W, gy, ['#0b0716', '#120a22', '#1d0f30', '#2c143a', '#40193d', '#5a2238', '#7a2f2a']);
      drawStars(g, st.stars, t, still);
      drawMoon(g, Math.round(W * 0.74), Math.round(H * 0.22), Math.round(H * 0.08));
      drawClouds(g, W, t, Math.round(H * 0.3), still, 4);
      drawHills(g, W, H, gy - 6);
      R(g, 0, gy, W, H - gy, '#140c12');
      const r = rng(77);
      for (let row = 0; row < 4; row++) {
        const y = gy + 3 + row * Math.round((H - gy) / 4.4);
        for (let x = (row % 2) * 9 + 4; x < W - 4; x += 18 + row * 2) {
          const k = r() * 10, lit = r() < 0.75;
          if (lit) halo(g, x + 3, y + 3, 6 + row, '#ff9a2e', (still ? 0.45 : 0.32 + 0.16 * Math.sin(t * 0.006 + k)));
          g.drawImage(lit ? SPR.smallPk : SPR.smallPk, x, y);
          R(g, x - 3, y + 6, 13, 1, '#1d3a1c');
        }
      }
      // scarecrow
      const sx = Math.round(W * 0.2), sy = gy - 2;
      R(g, sx, sy - 26, 1, 26, '#20140e'); R(g, sx - 9, sy - 20, 19, 1, '#20140e');
      g.drawImage(SPR.smallPk, sx - 3, sy - 32);
      R(g, sx - 5, sy - 19, 11, 8, '#2b1a2e');
      // fog
      for (let i = 0; i < 3; i++) {
        const x = still ? i * W / 3 : ((t * 0.003 * (i + 1) + i * W / 3) % (W + 120)) - 60;
        g.globalAlpha = 0.1; R(g, x, gy - 4 + i * 6, 90, 3, '#d6c8ff'); R(g, x + 12, gy - 6 + i * 6, 60, 2, '#d6c8ff'); g.globalAlpha = 1;
      }
      return;
    }
    // hw-moon: full moon over a hillside graveyard
    drawSky(g, W, gy, ['#06050f', '#0a0718', '#0f0a22', '#150d2c', '#1c1136', '#251641', '#2f1b4b']);
    drawStars(g, st.stars, t, still);
    const mr = Math.round(H * 0.17);
    drawMoon(g, Math.round(W * 0.72), Math.round(H * 0.32), mr);
    drawClouds(g, W, t, Math.round(H * 0.24), still, 4);
    drawHills(g, W, H, gy);
    R(g, 0, gy, W, H - gy, '#120b1c');
    for (let i = 0; i < 9; i++) {
      const x = Math.round(W * 0.38 + i * W * 0.065), y = gy - 2 + (i % 3);
      R(g, x, y - 7, 5, 7, '#0b0712'); R(g, x + 1, y - 8, 3, 1, '#0b0712');
      if (i % 3 === 1) { R(g, x + 2, y - 11, 1, 4, '#0b0712'); R(g, x + 1, y - 10, 3, 1, '#0b0712'); }
    }
    drawFence(g, Math.round(W * 0.33), W, gy + 1);
    drawTree(g, Math.round(W * 0.88), gy, Math.round(H * 0.42), 11, '#08050d');
    drawTree(g, Math.round(W * 0.42), gy, Math.round(H * 0.3), 5, '#0b0712');
    // distant house on the hill
    const hx = Math.round(W * 0.6), hy = gy - Math.round(H * 0.07);
    R(g, hx, hy - 9, 14, 9, '#0b0712');
    for (let i = 0; i <= 7; i++) R(g, hx - 1 + i, hy - 10 - i, 16 - i * 2, 1, '#0b0712');
    R(g, hx + 3, hy - 6, 2, 2, '#ffcf6b'); R(g, hx + 9, hy - 6, 2, 2, '#ffcf6b');
    if (!still) for (let i = 0; i < 3; i++) {
      const p = ((t * 0.00005 + i * 0.33) % 1);
      drawBat(g, -20 + p * (W + 40), H * 0.18 + Math.sin(p * 12 + i) * H * 0.05 + i * 9, t + i * 70, true);
    }
  }

  const bgState = { canvas: null, scene: null, timer: 0, stars: null, size: '' };
  function bgFrame() {
    const c = bgState.canvas;
    if (!c || !bgState.scene) return;
    const g = c.getContext('2d');
    const W = c.width, H = c.height;
    if (bgState.size !== W + 'x' + H) { bgState.size = W + 'x' + H; bgState.stars = starField(99, W, Math.round(H * 0.7), Math.round(W * H / 260)); }
    g.imageSmoothingEnabled = false;
    drawBgScene(g, W, H, bgState.scene, performance.now(), noAnim(), { stars: bgState.stars });
  }
  function bgResize() {
    const c = bgState.canvas;
    if (!c) return;
    const bg = document.getElementById('bg');
    const w = 320, h = Math.max(120, Math.round(w * (bg.clientHeight || 760) / (bg.clientWidth || 1220)));
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    bgFrame();
  }
  function syncBgScene() {
    const bg = document.getElementById('bg');
    if (!bg) return;
    const id = bg.dataset.scene;
    const on = !!HW_SCENES[id];
    if (on && !bgState.canvas) {
      const c = document.createElement('canvas');
      c.id = 'hw-bgscene';
      bg.insertBefore(c, document.getElementById('embers'));
      bgState.canvas = c;
      window.addEventListener('resize', bgResize);
    }
    if (bgState.canvas) bgState.canvas.style.display = on ? '' : 'none';
    bgState.scene = on ? id : null;
    clearInterval(bgState.timer);
    if (on) {
      bgResize();
      bgState.timer = setInterval(() => { if (!document.hidden && !noAnim()) bgFrame(); }, 110);
    }
  }
  const previews = {};
  function scenePreview(id) {
    if (previews[id]) return previews[id];
    const c = canvas(160, 100), g = c.getContext('2d');
    drawBgScene(g, 160, 100, id, 0, true, { stars: starField(5, 160, 70, 60) });
    return (previews[id] = url(c));
  }

  // ================================================================== theme: decorations, palette, injections

  let spriteUrls = null;
  function ensureSprites() {
    if (spriteUrls) return spriteUrls;
    buildSprites();
    spriteUrls = {
      pumpkin: url(SPR.pumpkin), small: url(SPR.smallPk), web: url(SPR.web), spider: url(SPR.spider),
      batA: url(SPR.batA), batB: url(SPR.batB), candy: url(SPR.candy), potion: url(SPR.potion), ghost: url(SPR.ghost),
      lantern: url(SPR.lantern), grave: url(SPR.grave), cauldron: url(SPR.cauldron), webSmall: url(SPR.webSmall),
      badge: { pumpkin: url(SPR.pumpkin), bat: url(SPR.batA), king: url(SPR.king) },
      cape: { dynia: url(scaled(SPR.capes.dynia, 1)), nietoperz: url(SPR.capes.nietoperz), pajeczyna: url(SPR.capes.pajeczyna) },
    };
    const css = document.documentElement.style;
    css.setProperty('--hw-web', `url("${spriteUrls.web}")`);
    css.setProperty('--hw-pk', `url("${spriteUrls.pumpkin}")`);
    css.setProperty('--hw-spider', `url("${spriteUrls.spider}")`);
    const bats = canvas(26, 6), bg = bats.getContext('2d');
    bg.drawImage(SPR.batLightA, 0, 0); bg.drawImage(SPR.batLightB, 13, 0);
    css.setProperty('--hw-bat', `url("${url(bats)}")`);
    return spriteUrls;
  }
  const pxImg = (src, cls = '', title = '') => `<img class="hw-px ${cls}" src="${src}" alt=""${title ? ` title="${esc(title)}"` : ''}>`;

  function registerRewards(st) {
    if (typeof ACCENTS === 'object') {
      for (const [id, a] of Object.entries(HW_ACCENTS)) if (owns(st, 'accent', id) && !ACCENTS[id]) ACCENTS[id] = a;
    }
    if (typeof Background === 'object' && Array.isArray(Background.SCENES)) {
      for (const [id, sc] of Object.entries(HW_SCENES)) {
        if (!owns(st, 'scene', id) || Background.SCENES.some(s => s.id === id)) continue;
        const at = Background.SCENES.findIndex(s => s.id === 'custom');
        Background.SCENES.splice(at < 0 ? Background.SCENES.length : at, 0, { id, name: sc.name, desc: sc.desc });
        if (typeof SCENE_PREVIEW === 'object') SCENE_PREVIEW[id] = `url("${scenePreview(id)}") center/cover`;
      }
    }
  }

  function decorate(on) {
    const main = document.getElementById('main');
    const logo = document.querySelector('.logo-block');
    if (!on) {
      ['hw-web', 'hw-bats'].forEach(id => { const e = document.getElementById(id); if (e) e.remove(); });
      const p = document.getElementById('hw-logo-pk'); if (p) p.remove();
      return;
    }
    ensureSprites();
    if (main && !document.getElementById('hw-web')) {
      main.insertAdjacentHTML('beforeend', `<div id="hw-web" aria-hidden="true"><i class="thread"></i><i class="spider"></i></div>`);
      const bats = [[12, 26, 0, 1], [24, 34, 9, 0.8], [8, 30, 17, 1.2], [36, 40, 23, 0.7]];
      main.insertAdjacentHTML('beforeend', `<div id="hw-bats" aria-hidden="true">${bats.map(([top, dur, delay, sc]) => `<i style="--top:${top}%;--dur:${dur}s;--delay:${delay}s;--sc:${sc}"></i>`).join('')}</div>`);
    }
    if (logo && !document.getElementById('hw-logo-pk')) logo.insertAdjacentHTML('beforeend', '<span id="hw-logo-pk" title="Halloween w Nore!"></span>');
  }

  function syncTint() {
    const s = (typeof App === 'object' && App.state && App.state.settings) || {};
    document.body.classList.toggle('hw-tint', themeOn() && (s.accentPreset || 'orange') === 'orange');
  }

  function syncNav() {
    const a = document.querySelector('a[data-page="halloween"]');
    if (!a) return;
    const want = !eventOpen();
    if (a.hidden !== want) { a.hidden = want; if (typeof moveIndicator === 'function') setTimeout(moveIndicator); }
  }

  let themeActive = null;
  function applyTheme() {
    const on = themeOn();
    syncNav();
    syncTint();
    if (on === themeActive) return;
    themeActive = on;
    document.body.classList.toggle('halloween', on);
    decorate(on);
  }

  // ------------------------------------------------------------------ account badge + cursor glow

  function decorateChip() {
    const b = document.querySelector('#account-chip .meta b');
    if (!b || b.querySelector('.hw-badge')) return;
    const st = load();
    const id = st.equip.badge;
    if (!id || !owns(st, 'badge', id)) return;
    const u = ensureSprites();
    b.insertAdjacentHTML('beforeend', ` <img class="hw-px hw-badge" src="${u.badge[id]}" alt="" title="Odznaka: ${esc(BADGES[id])}">`);
  }
  function refreshChip() {
    if (typeof renderAccountChip === 'function' && typeof App === 'object' && App.state) renderAccountChip();
  }

  let cursorEl = null;
  const onMove = (e) => { if (cursorEl) { cursorEl.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`; cursorEl.style.opacity = ''; } };
  const onLeave = () => { if (cursorEl) cursorEl.style.opacity = '0'; };
  function syncCursor() {
    const st = load();
    const on = !!st.equip.cursor && owns(st, 'cursor', 'pumpkin');
    if (on && !cursorEl) {
      cursorEl = document.createElement('div');
      cursorEl.id = 'hw-cursor';
      cursorEl.style.opacity = '0';
      document.body.appendChild(cursorEl);
      window.addEventListener('mousemove', onMove, { passive: true });
      document.documentElement.addEventListener('mouseleave', onLeave);
    } else if (!on && cursorEl) {
      cursorEl.remove(); cursorEl = null;
      window.removeEventListener('mousemove', onMove);
      document.documentElement.removeEventListener('mouseleave', onLeave);
    }
  }

  async function setLook(patch) {
    try {
      App.state.settings = await nore.setSettings(patch);
      await applyAppearance(App.state.settings);
    } catch (e) { errorToast(e, 'Wygląd'); }
  }

  // ------------------------------------------------------------------ home hero banner

  function heroSky(hero) {
    const c = document.createElement('canvas');
    c.className = 'hw-hero-sky';
    const w = 240, h = Math.max(90, Math.round(w * (hero.clientHeight || 300) / Math.max(400, hero.clientWidth || 900)));
    c.width = w; c.height = h;
    const g = c.getContext('2d');
    const gy = h - 8;
    drawNight(g, w, h, gy, 0, true, { stars: starField(21, w, gy - 20, Math.round(w * h / 160)) });
    R(g, 0, gy, w, h - gy, '#120b1c');
    drawTree(g, Math.round(w * 0.56), gy, Math.round(h * 0.5), 8, '#0a0612');
    drawTree(g, Math.round(w * 0.97), gy, Math.round(h * 0.62), 13, '#0a0612');
    for (let i = 0; i < 4; i++) { const x = Math.round(w * 0.62 + i * 12); R(g, x, gy - 6 + (i % 2), 4, 6 + (i % 2), '#0b0712'); R(g, x + 1, gy - 7 + (i % 2), 2, 1, '#0b0712'); }
    return c;
  }

  function injectHero(root) {
    const hero = root.querySelector('.h14-hero');
    if (!hero || hero.querySelector('.hw-hero-event')) return;
    const u = ensureSprites();
    const st = load();
    regen(st);
    hero.classList.add('hw-hero');
    const shade2 = hero.querySelector('.h14-shade');
    hero.insertBefore(heroSky(hero), shade2 || hero.firstChild);
    const eb = hero.querySelector('.eyebrow');
    if (eb) eb.insertAdjacentHTML('beforeend', `<span class="hw-chip">${pxImg(u.small)} HALLOWEEN</span>`);
    const daily = st.daily.last !== dayKey();
    hero.insertAdjacentHTML('beforeend', `<button class="hw-hero-event" title="Otwórz wydarzenie Halloween">
        <span class="hw-bubble"><b>Wydarzenie Halloween</b> – Cukierek albo psikus!
          <small>${daily ? 'Nagroda dnia czeka · ' : ''}${st.mana}/${MANA_MAX} many – czas pukać do sąsiadów</small>
          <em>Zagraj ${icon('arrowRight')}</em></span>
        <span class="hw-hero-pk">${pxImg(u.pumpkin)}</span>
      </button>`);
    hero.querySelector('.hw-hero-event').addEventListener('click', () => go('halloween'));
  }

  // ------------------------------------------------------------------ settings card

  function settingsCard(root) {
    const st = load();
    const u = ensureSprites();
    const badges = Object.keys(BADGES).filter(id => owns(st, 'badge', id));
    const hasCursor = owns(st, 'cursor', 'pumpkin');
    const card = el(`<div class="card panel hw-set-card">
      <div class="section-title">${pxImg(u.small, 'hw-ic')} Motyw Halloween</div>
      <div class="setting"><div class="col"><b>Motyw Halloween</b><span id="hw-set-state"></span></div><div id="hw-mode"></div></div>
      ${badges.length ? `<div class="setting"><div class="col"><b>Odznaka przy nicku</b><span>Nagrody z drogi nagród „Cukierek albo psikus”</span></div>
        <div class="chips" id="hw-badges"><button class="lchip ${!st.equip.badge ? 'on' : ''}" data-b="">Brak</button>${badges.map(id => `<button class="lchip ${st.equip.badge === id ? 'on' : ''}" data-b="${id}">${pxImg(u.badge[id], 'hw-ic')} ${esc(BADGES[id])}</button>`).join('')}</div></div>` : ''}
      ${hasCursor ? `<div class="setting"><div class="col"><b>Dyniowa poświata kursora</b><span>Ciepłe światło podąża za myszką</span></div><label class="switch"><input type="checkbox" id="hw-cur" ${st.equip.cursor ? 'checked' : ''}><i></i></label></div>` : ''}
      <div class="setting"><div class="col"><b>Cukierek albo psikus</b><span>Mini-gra z nagrodami: tła, akcenty, odznaki i peleryny do gry</span></div>
        <button class="btn ghost sm" id="hw-open">${icon('sparkles')} Otwórz wydarzenie</button></div>
    </div>`);
    const stateText = () => {
      const m = getMode();
      $('#hw-set-state', card).textContent = m === 'auto'
        ? `Włącza się sam od 15 października do 3 listopada · teraz ${themeOn() ? 'aktywny' : 'nieaktywny'}`
        : m === 'on' ? 'Zawsze włączony – dekoracje, nietoperze i wydarzenie przez cały rok' : 'Wyłączony – launcher wygląda jak zwykle';
      $('#hw-open', card).hidden = !eventOpen();
    };
    $('#hw-mode', card).appendChild(segmented([{ value: 'auto', label: 'Automatycznie' }, { value: 'on', label: 'Zawsze' }, { value: 'off', label: 'Wyłączony' }], getMode(), (v) => {
      LS.set(KEY_MODE, v);
      applyTheme();
      stateText();
    }));
    stateText();
    $$('#hw-badges .lchip', card).forEach(b => b.addEventListener('click', () => {
      const s2 = load(); s2.equip.badge = b.dataset.b; save(s2);
      $$('#hw-badges .lchip', card).forEach(x => x.classList.toggle('on', x === b));
      refreshChip();
    }));
    const cur = $('#hw-cur', card);
    if (cur) cur.addEventListener('change', () => { const s2 = load(); s2.equip.cursor = cur.checked; save(s2); syncCursor(); });
    $('#hw-open', card).addEventListener('click', () => go('halloween'));
    return card;
  }

  // ================================================================== mini-game page

  function neighbourhood(day, street, friends) {
    const r = rng(hashStr(day + '|' + street));
    const fr = [...friends];
    for (let i = fr.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [fr[i], fr[j]] = [fr[j], fr[i]]; }
    const name = `${STREETS[(hashStr(day) + street) % STREETS.length]} ${street + 1}`;
    const keys = (k) => OPTS[k].items.map(i => i.id);
    const houses = Array.from({ length: 8 }, (_, i) => {
      const deco = {};
      OPTS.deco.items.forEach(it => { if (r() < 0.35) deco[it.id] = true; });
      const gen = 0.42 + r() * 0.45;
      return {
        i, owner: (street === 0 && fr[i]) || (fr[i + street * 8]) || genNick(r), friend: !!((street === 0 && fr[i]) || fr[i + street * 8]),
        cfg: { wall: pick(r, keys('wall')), roof: pick(r, keys('roof')), door: pick(r, keys('door')), glow: pick(r, keys('glow')), deco },
        tall: r() < 0.35, cat: r() < 0.3, seed: Math.floor(r() * 1000), gen,
        trait: gen > 0.72 ? ['Hojny', 'treat'] : gen < 0.55 ? ['Psotny', 'trick'] : ['Tajemniczy', 'mystery'],
      };
    });
    return { name, houses };
  }

  const TRICKS = [
    { id: 'bats', text: 'Z komina wyleciało stado nietoperzy!' },
    { id: 'green', text: 'Wiedźma zamieniła Cię w zieloną dynię na minutę.' },
    { id: 'ghost', text: 'Zamiast gospodarza drzwi otworzył duch. Buuu!' },
    { id: 'dark', text: 'Ktoś zgasił wszystkie światła na ulicy…' },
    { id: 'spiders', text: 'Z daszku spadł deszcz pająków!' },
  ];

  Pages.halloween = (root) => {
    const u = ensureSprites();
    let st = load();
    regen(st);
    let friends = [];
    const welcome = processVisitors(st, friends);
    if (st.knock.day !== dayKey()) st.knock = { day: dayKey(), street: 0, done: {} };
    save(st);
    let lvlSeen = levelInfo(st.xp).lvl;

    let tab = LS.get(KEY_TAB, 'house');
    if (!['house', 'knock', 'road'].includes(tab)) tab = 'house';
    let street = neighbourhood(st.knock.day, st.knock.street, friends);
    let view = tab === 'knock' ? 'street' : 'home';
    let visit = null; // { house, t0, outcome, applied, phase }
    let preview = null;
    const fx = { bats: [], ghost: 0, dark: 0, spiders: 0 };
    let alive = true;

    root.innerHTML = `<div class="hw-page">
      <div class="page-head hw-head">
        <div><div class="hw-eyebrow">${pxImg(u.small)} WYDARZENIE HALLOWEEN · 15.10 – 3.11</div>
          <h2>Cukierek <span>albo psikus</span></h2>
          <p>Zbuduj dom, ustal, jak odpowiadają Twoje drzwi, i pukaj do sąsiadów po dynie.</p></div>
        <div class="actions"><button class="btn" id="hw-daily"></button></div>
      </div>
      <section class="card hw-stage" id="hw-stage">
        <canvas id="hw-cv"></canvas>
        <div class="hw-hud">
          <div class="hw-pill hw-mana" title="Mana – 1 za każde pukanie, odnawia się co 12 minut">${pxImg(u.potion)}<div class="pips" id="hw-pips"></div><small id="hw-mt"></small></div>
          <div class="hw-pill" title="Dynie – waluta wydarzenia" id="hw-pk-pill">${pxImg(u.pumpkin)}<b id="hw-pk"></b></div>
          <div class="hw-pill" title="Złote cukierki – rzadkie łupy">${pxImg(u.candy)}<b id="hw-cd"></b></div>
          <div class="hw-pill hw-lvl" title="Poziom wydarzenia"><b id="hw-lv"></b><div class="bar"><i id="hw-xpb"></i></div><small id="hw-xp"></small></div>
        </div>
        <div class="hw-msg" id="hw-msg" hidden></div>
        <div class="hw-knockbubble" id="hw-kb" hidden>Puk, puk!</div>
        <div class="hw-where"><span id="hw-where"></span></div>
        <button class="btn sm ghost hw-back" id="hw-back" hidden>${icon('arrowLeft')} Wróć na ulicę</button>
      </section>
      <div class="hw-tabs" id="hw-tabs"></div>
      <div id="hw-tab"></div>
    </div>`;

    const stage = $('#hw-stage', root), cv = $('#hw-cv', root), g = cv.getContext('2d');
    let W = 360, H = 132, S = 2, stars = [];

    const fit = () => {
      const cw = stage.clientWidth || 700;
      S = clamp(Math.floor(cw / 330), 2, 4);
      W = Math.ceil(cw / S); H = 132;
      cv.width = W; cv.height = H;
      cv.style.width = W * S + 'px'; cv.style.height = H * S + 'px';
      g.imageSmoothingEnabled = false;
      stars = starField(42, W, H - 50, Math.round(W * 0.35));
      draw(performance.now());
    };

    // ------------------------------------------------------------ HUD
    const fmtT = (ms) => { const s = Math.ceil(ms / 1000); return `${Math.floor(s / 60)}:${pad2(s % 60)}`; };
    const hud = () => {
      regen(st);
      const L = levelInfo(st.xp);
      $('#hw-pips', root).innerHTML = Array.from({ length: MANA_MAX }, (_, i) => `<i class="${i < st.mana ? 'on' : ''}"></i>`).join('');
      $('#hw-mt', root).textContent = st.mana >= MANA_MAX ? 'pełna' : '+1 za ' + fmtT(manaLeft(st));
      $('#hw-pk', root).textContent = st.pumpkins;
      $('#hw-cd', root).textContent = st.candy;
      $('#hw-lv', root).textContent = 'POZ. ' + L.lvl;
      $('#hw-xpb', root).style.width = (L.cur / L.need * 100).toFixed(1) + '%';
      $('#hw-xp', root).textContent = L.max ? 'MAX' : `${L.cur}/${L.need} XP`;
      const can = st.daily.last !== dayKey();
      const d = $('#hw-daily', root);
      d.disabled = !can;
      d.classList.toggle('hw-glow', can);
      d.innerHTML = can ? `${icon('sparkles')} Odbierz nagrodę dnia` : `${icon('check')} Nagroda dnia odebrana`;
      const where = view === 'visit' && visit ? `Dom: <b>${esc(visit.house.owner)}</b>${visit.house.friend ? ' <span class="tag accent">ZNAJOMY</span>' : ''}`
        : view === 'street' ? `<b>${esc(street.name)}</b> · ${Object.keys(st.knock.done).filter(k => k.startsWith(st.knock.street + ':')).length}/8 domów`
          : `<b>Twój dom</b> · urok ${charm(st, previewHouse())} · drzwi: ${st.door === 'treat' ? 'cukierek' : 'psikus'}`;
      $('#hw-where', root).innerHTML = where;
      $('#hw-back', root).hidden = view !== 'visit' || (visit && !visit.applied);
      if (L.lvl > lvlSeen) {
        lvlSeen = L.lvl;
        toast(`Poziom ${L.lvl}!`, 'Nowa nagroda czeka na drodze nagród.', 'success', 5000);
      }
    };
    const commit = () => { save(st); registerRewards(st); hud(); };
    const floatTxt = (txt, anchor) => {
      const a = (anchor && $(anchor, root)) || $('#hw-pk-pill', root);
      const r1 = a.getBoundingClientRect(), r0 = stage.getBoundingClientRect();
      const f = el(`<div class="hw-float">${txt}</div>`);
      f.style.left = (r1.left - r0.left + r1.width / 2) + 'px'; f.style.top = (r1.bottom - r0.top) + 'px';
      stage.appendChild(f);
      setTimeout(() => f.remove(), 1600);
    };
    let msgTimer = 0;
    const say = (html, kind = '') => {
      const m = $('#hw-msg', root);
      m.className = 'hw-msg ' + kind;
      m.innerHTML = html;
      m.hidden = false;
      m.style.animation = 'none'; void m.offsetWidth; m.style.animation = '';
      clearTimeout(msgTimer);
      msgTimer = setTimeout(() => { if (alive) m.hidden = true; }, 5200);
    };

    // ------------------------------------------------------------ scene
    const previewHouse = () => {
      if (!preview) return st.house;
      const h = { ...st.house, deco: { ...st.house.deco } };
      if (preview.k === 'deco') h.deco[preview.id] = true; else h[preview.k] = preview.id;
      return h;
    };
    let lastDraw = 0, lastDoor = null;
    function draw(now) {
      const t = now, still = noAnim();
      const gy = H - 24;
      g.clearRect(0, 0, W, H);
      drawNight(g, W, H, gy, t, still, { stars });
      drawTree(g, 16, gy, 64, 4, '#0d0816');
      drawTree(g, W - 20, gy, 70, 9, '#0d0816');
      drawGround(g, W, H, gy, 7);
      const green = st.greenUntil > Date.now();
      let door = null;
      if (view === 'street') {
        const n = street.houses.length, step = W / n;
        street.houses.forEach((h, i) => {
          const cx = Math.round(step * (i + 0.5)), key = st.knock.street + ':' + i;
          drawHouse(g, cx, gy, h.cfg, { w: Math.min(34, Math.round(step) - 8), tall: h.tall, seed: h.seed, t: t + i * 300, still, lit: st.knock.done[key] !== 'dark', cat: h.cat });
          if (i < n - 1) drawLamp(g, Math.round(step * (i + 1)), gy, t, still);
        });
        drawKid(g, 4 + (still ? 0 : Math.sin(t * 0.002) * 2), gy + 6, 0, green);
      } else if (view === 'visit' && visit) {
        const h = visit.house, cx = Math.round(W / 2);
        drawFence(g, 0, W, gy - 1);
        const el2 = now - visit.t0;
        const shake = visit.phase === 'knock' && (Math.floor(el2 / 70) % 2) && ((el2 > 1500 && el2 < 1700) || (el2 > 1850 && el2 < 2050)) ? 1 : 0;
        door = drawHouse(g, cx, gy, h.cfg, { w: 62, tall: h.tall, seed: h.seed, t, still, open: visit.phase === 'open' || visit.phase === 'done', shake, lit: !(fx.dark && now < fx.dark), cat: h.cat, smoke: true });
        R(g, door.x - 1, gy, door.w + 2, H - gy, '#3a3540');
        // walk
        const targetX = door.x - 10;
        const p = still ? 1 : clamp(el2 / 1400, 0, 1);
        const kx = -10 + (targetX + 10) * p;
        drawKid(g, kx, gy + 5, p < 1 ? Math.floor(el2 / 160) % 2 : 0, green);
      } else {
        const ph = previewHouse();
        drawFence(g, 0, W, gy - 1);
        door = drawHouse(g, Math.round(W / 2), gy, ph, { w: 60, tall: false, seed: 3, t, still, smoke: true, open: false });
        R(g, door.x - 1, gy, door.w + 2, H - gy, '#3a3540');
        for (let y = gy + 2; y < H; y += 3) R(g, door.x + (y % 2 ? 1 : 3), y, 2, 1, '#2d2933');
        drawKid(g, door.x - 22, gy + 4 + (still ? 0 : Math.round(Math.sin(t * 0.004))), 0, green);
      }
      // trick effects
      if (fx.dark && now < fx.dark) {
        g.globalAlpha = 0.78; R(g, 0, 0, W, H, '#05030a'); g.globalAlpha = 1;
        if (door && Math.floor(now / 400) % 3) { R(g, door.x + 2, door.y + 6, 2, 1, '#ffe14a'); R(g, door.x + door.w - 4, door.y + 6, 2, 1, '#ffe14a'); }
      }
      if (fx.ghost && now < fx.ghost + 2600 && door) {
        const p = (now - fx.ghost) / 2600;
        g.globalAlpha = p < 0.8 ? 0.9 : (1 - p) * 4.5;
        g.drawImage(SPR.ghost, Math.round(door.x + door.w / 2 - 6 + Math.sin(p * 12) * 4), Math.round(door.y - p * 46));
        g.globalAlpha = 1;
      }
      if (fx.spiders && now < fx.spiders + 2600) {
        const p = Math.min(1, (now - fx.spiders) / 900);
        for (let i = 0; i < 9; i++) {
          const x = Math.round(W * (0.1 + i * 0.1)), y = Math.round(p * (30 + (i * 37) % 45) + Math.sin(now * 0.005 + i) * 2);
          R(g, x + 3, 0, 1, y, 'rgba(236,230,255,.55)');
          g.drawImage(SPR.spider, x, y);
        }
      }
      if (fx.bats.length) {
        fx.bats = fx.bats.filter(b => now - b.t0 < 2600);
        for (const b of fx.bats) { const e = (now - b.t0) / 1000; drawBat(g, b.x + b.vx * e * 60, b.y + b.vy * e * 60 + Math.sin(e * 9 + b.ph) * 3, now + b.ph * 100, true); }
      }
      lastDoor = door;
      if (green) { g.globalAlpha = 0.08; R(g, 0, 0, W, H, '#4ade80'); g.globalAlpha = 1; }
    }

    let raf = 0;
    const loop = (now) => {
      if (!alive) return;
      raf = requestAnimationFrame(loop);
      if (document.hidden) return;
      if (visit && !visit.applied) stepVisit(now);
      if (noAnim() && !(visit && !visit.applied)) { if (now - lastDraw < 1000) return; }
      else if (now - lastDraw < 33) return;
      lastDraw = now;
      draw(now);
    };
    const redraw = () => { lastDraw = 0; draw(performance.now()); };

    // ------------------------------------------------------------ knocking
    function stepVisit(now) {
      const e = now - visit.t0;
      const kb = $('#hw-kb', root);
      if (noAnim() || e > 2600) {
        visit.phase = 'done';
        kb.hidden = true;
        resolveVisit();
        return;
      }
      if (e > 1400 && e < 2250) {
        visit.phase = 'knock';
        if (kb.hidden) {
          kb.hidden = false;
          const d = lastDoor || { x: W / 2 - 6, y: H - 50, w: 12 };
          kb.style.left = (d.x + d.w / 2) * S + 'px'; kb.style.top = (d.y - 3) * S + 'px';
        }
      } else if (e >= 2250) { visit.phase = 'open'; kb.hidden = true; }
    }
    function resolveVisit() {
      if (visit.applied) return;
      visit.applied = true;
      const h = visit.house, key = st.knock.street + ':' + h.i;
      const treat = Math.random() < h.gen;
      st.stats.knocks++;
      if (treat) {
        const pk = 4 + Math.floor(Math.random() * 7);
        const rare = Math.random() < 0.08;
        st.pumpkins += pk; st.xp += 12; st.stats.treats++;
        if (rare) { st.candy++; st.xp += 30; }
        st.knock.done[key] = 'treat';
        say(`<b>Cukierek!</b> ${esc(h.owner)} daje Ci <b>${pk}</b> ${pxImg(u.pumpkin)}${rare ? ` i… <b>złoty cukierek</b> ${pxImg(u.candy)}!` : ''} <small>+${rare ? 42 : 12} XP</small>`, 'treat');
        floatTxt(`+${pk}`);
        if (rare) setTimeout(() => alive && floatTxt('+1', '#hw-cd'), 250);
      } else {
        const tr = TRICKS[Math.floor(Math.random() * TRICKS.length)];
        const cons = Math.random() < 0.5 ? 1 + Math.floor(Math.random() * 2) : 0;
        st.pumpkins += cons; st.xp += 8; st.stats.tricks++;
        st.knock.done[key] = tr.id === 'dark' ? 'dark' : 'trick';
        const now = performance.now();
        if (tr.id === 'bats') {
          fx.bats = Array.from({ length: 22 }, () => ({ t0: now, x: W / 2 + (Math.random() - 0.5) * 20, y: H - 70, vx: (Math.random() - 0.5) * 3.2, vy: -0.6 - Math.random() * 1.4, ph: Math.random() * 6 }));
        }
        if (tr.id === 'green') st.greenUntil = Date.now() + 60000;
        if (tr.id === 'ghost') fx.ghost = now;
        if (tr.id === 'dark') fx.dark = now + 2800;
        if (tr.id === 'spiders') fx.spiders = now;
        if (!noAnim() && tr.id !== 'dark') { stage.classList.remove('hw-shake'); void stage.offsetWidth; stage.classList.add('hw-shake'); }
        say(`<b>Psikus!</b> ${tr.text}${cons ? ` <small>Na pocieszenie: +${cons} ${pxImg(u.pumpkin)}</small>` : ''} <small>+8 XP</small>`, 'trick');
        if (cons) floatTxt(`+${cons}`);
      }
      commit();
      renderTab();
      redraw();
    }
    function knock(i) {
      if (visit && !visit.applied) return;
      regen(st);
      const h = street.houses[i];
      const key = st.knock.street + ':' + i;
      if (st.knock.done[key]) return;
      if (st.mana < 1) {
        say(`<b>Brak many.</b> Kolejny punkt za ${fmtT(manaLeft(st))} – albo odbierz nagrodę dnia.`, 'trick');
        return;
      }
      if (st.mana >= MANA_MAX) st.manaTs = Date.now();
      st.mana--;
      save(st);
      hud();
      $('#hw-msg', root).hidden = true;
      fx.dark = 0; fx.ghost = 0; fx.spiders = 0; fx.bats = [];
      visit = { house: h, t0: performance.now(), applied: false, phase: 'walk' };
      view = 'visit';
      hud();
      stage.scrollIntoView({ block: 'nearest', behavior: noAnim() ? 'auto' : 'smooth' });
      if (noAnim()) stepVisit(performance.now());
    }

    // ------------------------------------------------------------ tabs
    const tabs = segmented([{ value: 'house', label: `${icon('home')} Mój dom` }, { value: 'knock', label: `${icon('users')} Pukanie` }, { value: 'road', label: `${icon('crown')} Droga nagród` }], tab, (v) => {
      tab = v;
      LS.set(KEY_TAB, v);
      if (!(visit && !visit.applied)) { view = v === 'knock' ? 'street' : 'home'; visit = null; }
      preview = null;
      renderTab(); hud(); redraw();
    });
    $('#hw-tabs', root).appendChild(tabs);

    const optState = (k, it) => {
      const L = levelInfo(st.xp).lvl;
      const ownedK = k + ':' + it.id;
      if (st.owned[ownedK]) return 'owned';
      if (L < it.lvl) return 'locked';
      return 'buy';
    };
    const swatch = (k, it) => {
      if (k === 'wall') { const p = WALLS[it.id]; return `<span class="sw" style="background:repeating-linear-gradient(0deg,${p.dark} 0 1px,${p.base} 1px 4px)"></span>`; }
      if (k === 'roof') return `<span class="sw" style="background:linear-gradient(135deg,${shade(ROOFS[it.id], 0.2)},${ROOFS[it.id]} 60%,${shade(ROOFS[it.id], -0.4)})"></span>`;
      if (k === 'door') return `<span class="sw" style="background:${DOORS[it.id]};border-radius:6px 6px 2px 2px"></span>`;
      if (k === 'glow') return `<span class="sw glow" style="--g:${GLOWS[it.id]}"></span>`;
      const src = { lanterns: u.small, lantern: u.lantern, web: u.webSmall, grave: u.grave, cauldron: u.cauldron }[it.id];
      return `<span class="sw img">${pxImg(src)}</span>`;
    };
    const costHtml = (it) => `${it.cost} ${pxImg(u.pumpkin)}${it.candy ? ` + ${it.candy} ${pxImg(u.candy)}` : ''}`;

    function houseTab() {
      const groups = Object.entries(OPTS).map(([k, grp]) => `<div class="hw-group">
        <div class="hw-glabel">${esc(grp.label)}</div>
        <div class="hw-opts">${grp.items.map(it => {
          const s2 = optState(k, it);
          const on = k === 'deco' ? !!st.house.deco[it.id] : st.house[k] === it.id;
          const sub = s2 === 'owned' ? (k === 'deco' ? (on ? 'Postawione' : 'Schowane') : (on ? 'Wybrane' : 'Twoje')) : s2 === 'locked' ? `${icon('shield')} Poz. ${it.lvl}` : costHtml(it);
          return `<button class="hw-opt ${s2} ${on ? 'on' : ''}" data-k="${k}" data-id="${it.id}">${swatch(k, it)}<span class="tx"><b>${esc(it.name)}</b><small>${sub}</small></span></button>`;
        }).join('')}</div></div>`).join('');
      const log = st.visit.log.length
        ? st.visit.log.map(e => `<div class="hw-log"><span class="who">${esc(e.who)}</span><span>${e.door === 'treat' ? 'dostał(a) cukierka' : 'uciekł(a) przed psikusem'}</span><b>${e.xp ? `+${e.xp} XP` : ''}${e.pk ? ` +${e.pk} ${pxImg(u.pumpkin)}` : ''}</b></div>`).join('')
        : '<div class="muted hw-empty">Jeszcze nikt nie zapukał. Goście przychodzą co ok. 25 minut – im większy urok domu, tym więcej ich wpada.</div>';
      return `<div class="hw-cols">
        <section class="card panel hw-build"><div class="section-title">${icon('home')} Budowa domu <span class="muted hw-hint">Najedź, aby zobaczyć podgląd</span></div>${groups}</section>
        <div class="col hw-side">
          <section class="card panel"><div class="section-title">${icon('key')} Twoje drzwi</div>
            <p class="muted hw-p">Wybierz, co dostają goście, którzy do Ciebie zapukają.</p>
            <div class="hw-door">
              <button class="hw-dchoice ${st.door === 'treat' ? 'on' : ''}" data-door="treat">${pxImg(u.candy)}<b>Cukierek</b><small>Goście zostawiają podziękowania: więcej XP</small></button>
              <button class="hw-dchoice trick ${st.door === 'trick' ? 'on' : ''}" data-door="trick">${pxImg(u.ghost)}<b>Psikus</b><small>Uciekają w popłochu, gubiąc dynie</small></button>
            </div></section>
          <section class="card panel"><div class="section-title">${icon('users')} Goście <span class="tag accent hw-charm">Urok ${charm(st)}</span></div>${log}</section>
        </div></div>`;
    }

    function knockTab() {
      const L = levelInfo(st.xp);
      const cards = street.houses.map((h, i) => {
        const res = st.knock.done[st.knock.street + ':' + i];
        return `<div class="card hw-house ${res ? 'done ' + res : ''}" data-i="${i}">
          <canvas class="hw-mini" data-i="${i}" width="96" height="62"></canvas>
          <div class="meta"><b title="${esc(h.owner)}">${h.friend ? icon('users') : ''}${esc(h.owner)}</b><span class="hw-trait ${h.trait[1]}">${h.trait[0]}</span></div>
          ${res ? `<div class="hw-res">${res === 'treat' ? `${pxImg(u.pumpkin)} Cukierek` : `${pxImg(u.ghost)} Psikus`}</div>`
            : `<button class="btn sm hw-knock" data-i="${i}" ${st.mana < 1 ? 'disabled' : ''}>Zapukaj <span class="hw-cost">${pxImg(u.potion)} 1</span></button>`}
        </div>`;
      }).join('');
      return `<section class="card panel hw-street">
        <div class="row hw-street-head"><div class="section-title" style="flex:1">${icon('globe')} ${esc(street.name)}</div>
          <button class="btn ghost sm icon" id="hw-prev" title="Poprzednia ulica" ${st.knock.street ? '' : 'disabled'}>${icon('arrowLeft')}</button>
          <button class="btn ghost sm" id="hw-next">Następna ulica ${icon('arrowRight')}</button></div>
        <p class="muted hw-p">Każde pukanie kosztuje 1 manę. Hojni sąsiedzi częściej dają dynie, psotni – psikusy. Sąsiedztwo zmienia się codziennie${friends.length ? ', a znajomi mieszkają przy pierwszej ulicy' : ''}. Poziom ${L.lvl} · zapukano ${st.stats.knocks}×.</p>
        <div class="hw-houses">${cards}</div></section>`;
    }

    function rewardPreview(it) {
      if (it.type === 'badge') return pxImg(u.badge[it.id], 'big');
      if (it.type === 'cape') return pxImg(u.cape[it.id], 'big cape');
      if (it.type === 'accent') { const a = HW_ACCENTS[it.id]; return `<span class="hw-acc" style="--c1:${a.b};--c2:${a.d}"></span>`; }
      if (it.type === 'scene') return `<span class="hw-scn" style="background-image:url('${scenePreview(it.id)}')"></span>`;
      return `<span class="hw-cur"></span>`;
    }
    function itemAction(it) {
      const s = (App.state && App.state.settings) || {};
      if (it.type === 'badge') return st.equip.badge === it.id ? `<button class="btn sm ghost" data-use="badge:">Zdejmij</button>` : `<button class="btn sm" data-use="badge:${it.id}">Załóż</button>`;
      if (it.type === 'accent') return s.accentPreset === it.id ? `<button class="btn sm ghost" data-use="accent:orange">Przywróć</button>` : `<button class="btn sm" data-use="accent:${it.id}">Ustaw</button>`;
      if (it.type === 'scene') return s.bgScene === it.id ? `<button class="btn sm ghost" data-use="scene:photo">Przywróć</button>` : `<button class="btn sm" data-use="scene:${it.id}">Ustaw</button>`;
      if (it.type === 'cursor') return st.equip.cursor ? `<button class="btn sm ghost" data-use="cursor:0">Wyłącz</button>` : `<button class="btn sm" data-use="cursor:1">Włącz</button>`;
      return `<span class="hw-note">${icon('info')} W grze: Moduły klienta → Kosmetyki</span>`;
    }
    function roadTab() {
      const L = levelInfo(st.xp);
      const prog = clamp((L.lvl - 1 + (L.max ? 0 : L.cur / L.need)) / (MAX_LVL - 1), 0, 1);
      const tiers = ROAD.map((t) => {
        const claimed = st.claimed.includes(t.lvl), ready = !claimed && L.lvl >= t.lvl;
        return `<div class="hw-tier ${claimed ? 'claimed' : ready ? 'ready' : 'locked'}">
          <div class="hw-tlv">POZ. ${t.lvl}</div>
          <div class="hw-tprev">${t.items.map(rewardPreview).join('')}</div>
          ${t.items.map(it => `<div class="hw-tname"><b>${esc(itemName(it))}</b><small>${TYPE_LABEL[it.type]}</small>${claimed ? `<div class="hw-tact">${itemAction(it)}</div>` : ''}</div>`).join('')}
          <div class="hw-tfoot">${claimed ? `<span class="hw-ok">${icon('check')} Odebrano</span>` : ready ? `<button class="btn sm hw-glow" data-claim="${t.lvl}">Odbierz</button>` : `<span class="muted">${icon('shield')} Zablokowane</span>`}
            <span class="hw-tpk">+${t.pk} ${pxImg(u.pumpkin)}</span></div>
        </div>`;
      }).join('');
      return `<section class="card panel hw-road">
        <div class="section-title">${icon('crown')} Droga nagród <span class="muted hw-hint">Nagrody zostają z Tobą także po wydarzeniu</span></div>
        <div class="hw-track"><i style="width:${(prog * 100).toFixed(1)}%"></i>${ROAD.map((t, i) => `<span class="${L.lvl >= t.lvl ? 'on' : ''}" style="left:${(i / (ROAD.length - 1) * 100).toFixed(2)}%">${t.lvl}</span>`).join('')}</div>
        <div class="hw-tiers">${tiers}</div>
        <p class="muted hw-p hw-capenote">${icon('info')} Peleryny „Dynia”, „Nietoperz” i „Pajęczyna” odblokowują się w Nore Client: <b>Moduły klienta → Kosmetyki</b>.</p>
      </section>`;
    }

    function drawMinis() {
      $$('.hw-mini', root).forEach(c => {
        const h = street.houses[+c.dataset.i];
        const mg = c.getContext('2d');
        mg.imageSmoothingEnabled = false;
        const gy = 54;
        drawSky(mg, 96, gy, ['#0c0819', '#130c26', '#1b1133', '#251641']);
        drawStars(mg, starField(h.seed, 96, 40, 18), 0, true);
        drawHills(mg, 96, 62, gy + 2);
        drawGround(mg, 96, 62, gy, h.seed);
        const res = st.knock.done[st.knock.street + ':' + h.i];
        drawHouse(mg, 48, gy, h.cfg, { w: 40, tall: h.tall, seed: h.seed, t: 0, still: true, lit: res !== 'dark', cat: h.cat, open: res === 'treat' });
      });
    }

    function renderTab() {
      if (!alive) return;
      const box = $('#hw-tab', root);
      box.innerHTML = tab === 'house' ? houseTab() : tab === 'knock' ? knockTab() : roadTab();
      if (tab === 'knock') drawMinis();
    }

    // ------------------------------------------------------------ interactions
    const tabBox = $('#hw-tab', root);
    tabBox.addEventListener('click', async (e) => {
      const opt = e.target.closest('.hw-opt');
      if (opt) {
        const k = opt.dataset.k, it = OPTS[k].items.find(i => i.id === opt.dataset.id);
        const s2 = optState(k, it);
        if (s2 === 'locked') { toast('Jeszcze zablokowane', `${it.name} odblokujesz na poziomie ${it.lvl}.`, 'info'); return; }
        if (s2 === 'buy') {
          if (st.pumpkins < it.cost || st.candy < (it.candy || 0)) {
            opt.classList.remove('nope'); void opt.offsetWidth; opt.classList.add('nope');
            toast('Za mało dyń', `${it.name}: ${it.cost} dyń${it.candy ? ` i ${it.candy} złoty cukierek` : ''}. Zapukaj do sąsiadów!`, 'error');
            return;
          }
          st.pumpkins -= it.cost; st.candy -= it.candy || 0; st.xp += 10;
          st.owned[k + ':' + it.id] = 1;
          floatTxt(`−${it.cost}`);
          toast('Kupiono', `${it.name} · −${it.cost} dyń · +10 XP`, 'success');
        }
        if (k === 'deco') st.house.deco[it.id] = !(s2 === 'owned' && st.house.deco[it.id]);
        else st.house[k] = it.id;
        preview = null;
        commit(); renderTab(); redraw();
        return;
      }
      const dc = e.target.closest('[data-door]');
      if (dc) {
        st.door = dc.dataset.door; commit(); renderTab();
        say(st.door === 'treat' ? '<b>Twoje drzwi: Cukierek.</b> Goście dostaną słodycze.' : '<b>Twoje drzwi: Psikus.</b> Goście dostaną strachu!', st.door === 'treat' ? 'treat' : 'trick');
        return;
      }
      const kn = e.target.closest('.hw-knock');
      if (kn) return knock(+kn.dataset.i);
      const card = e.target.closest('.hw-house');
      if (card && !card.classList.contains('done') && !e.target.closest('button')) return knock(+card.dataset.i);
      if (e.target.closest('#hw-next') || e.target.closest('#hw-prev')) {
        if (visit && !visit.applied) return;
        st.knock.street = Math.max(0, st.knock.street + (e.target.closest('#hw-next') ? 1 : -1));
        street = neighbourhood(st.knock.day, st.knock.street, friends);
        view = 'street'; visit = null;
        commit(); renderTab(); redraw();
        return;
      }
      const cl = e.target.closest('[data-claim]');
      if (cl) {
        const t = ROAD.find(x => x.lvl === +cl.dataset.claim);
        if (!t || st.claimed.includes(t.lvl) || levelInfo(st.xp).lvl < t.lvl) return;
        st.claimed.push(t.lvl);
        st.pumpkins += t.pk;
        for (const it of t.items) if (it.type === 'badge' && !st.equip.badge) st.equip.badge = it.id;
        commit();
        refreshChip();
        toast('Nagroda odebrana!', t.items.map(itemName).join(' + ') + ` · +${t.pk} dyń`, 'success', 5000);
        renderTab();
        return;
      }
      const use = e.target.closest('[data-use]');
      if (use) {
        const [type, v] = use.dataset.use.split(':');
        if (type === 'badge') { st.equip.badge = v; commit(); refreshChip(); }
        if (type === 'cursor') { st.equip.cursor = v === '1'; commit(); syncCursor(); }
        if (type === 'accent') { use.disabled = true; registerRewards(st); await setLook({ accentPreset: v }); toast('Kolor akcentu', v === 'orange' ? 'Nore Orange' : HW_ACCENTS[v].name, 'success'); }
        if (type === 'scene') { use.disabled = true; registerRewards(st); await setLook({ bgScene: v }); toast('Tło launchera', v === 'photo' ? 'Mgławica' : HW_SCENES[v].name, 'success'); }
        renderTab();
      }
    });
    tabBox.addEventListener('mouseover', (e) => {
      const opt = e.target.closest('.hw-opt');
      const next = opt && !opt.classList.contains('on') ? { k: opt.dataset.k, id: opt.dataset.id } : null;
      if (JSON.stringify(next) === JSON.stringify(preview)) return;
      if (next && next.k === 'deco' && st.house.deco[next.id]) return;
      preview = next;
      if (view !== 'home' && !(visit && !visit.applied)) { view = 'home'; visit = null; }
      hud(); redraw();
    });
    tabBox.addEventListener('mouseleave', () => { if (preview) { preview = null; hud(); redraw(); } });

    $('#hw-daily', root).addEventListener('click', () => {
      if (st.daily.last === dayKey()) return;
      const y = new Date(); y.setDate(y.getDate() - 1);
      st.daily.streak = st.daily.last === dayKey(y) ? st.daily.streak + 1 : 1;
      st.daily.last = dayKey();
      const pk = 15 + 5 * Math.min(st.daily.streak - 1, 5);
      regen(st);
      const mana = Math.min(3, MANA_MAX - st.mana);
      st.pumpkins += pk; st.xp += 30; st.mana += mana;
      commit();
      floatTxt(`+${pk}`);
      say(`<b>Nagroda dnia!</b> +${pk} ${pxImg(u.pumpkin)}${mana ? `, +${mana} ${pxImg(u.potion)}` : ''} i +30 XP <small>Seria: ${st.daily.streak} ${plural(st.daily.streak, 'dzień', 'dni', 'dni')}</small>`, 'treat');
      renderTab();
    });
    $('#hw-back', root).addEventListener('click', () => { visit = null; view = 'street'; fx.dark = 0; hud(); redraw(); });

    // ------------------------------------------------------------ lifecycle
    const ro = new ResizeObserver(() => fit());
    ro.observe(stage);
    fit();
    hud();
    renderTab();
    raf = requestAnimationFrame(loop);
    const tick = setInterval(() => {
      if (!alive) return;
      const before = st.mana;
      hud();
      const vis = processVisitors(st, friends);
      if (vis.length || st.mana !== before) { save(st); if (tab !== 'road') renderTab(); }
      if (vis.length) toast('Goście!', `${vis.length} ${plural(vis.length, 'osoba zapukała', 'osoby zapukały', 'osób zapukało')} do Twoich drzwi.`, 'info');
    }, 1000);
    if (welcome.length) setTimeout(() => alive && say(`<b>Pod Twoją nieobecność</b> zapukało ${welcome.length} ${plural(welcome.length, 'gość', 'gości', 'gości')}: ${welcome.reduce((a, e) => a + e.xp, 0)} XP${welcome.some(e => e.pk) ? `, ${welcome.reduce((a, e) => a + e.pk, 0)} ${pxImg(u.pumpkin)}` : ''}.`, 'treat'), 600);
    else if (!st.stats.knocks && !st.claimed.length) setTimeout(() => alive && say('<b>Witaj na Halloween!</b> Odbierz nagrodę dnia, zapukaj do sąsiadów i odbierz pierwszą nagrodę na drodze nagród.'), 600);

    try {
      nore.friends.list().then(list => {
        if (!alive || !Array.isArray(list)) return;
        friends = list.map(f => (typeof f === 'string' ? f : f && (f.name || f.nick))).filter(Boolean).slice(0, 40);
        if (!friends.length) return;
        street = neighbourhood(st.knock.day, st.knock.street, friends);
        if (tab === 'knock') renderTab();
        hud(); redraw();
      }).catch(() => {});
    } catch { /* friends API unavailable */ }

    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      clearInterval(tick);
      clearTimeout(msgTimer);
      ro.disconnect();
    };
  };

  // ================================================================== wiring (wrappers around existing pages/functions)

  const _home = Pages.home;
  Pages.home = (root, opts) => {
    const c = _home(root, opts);
    try { if (themeOn()) injectHero(root); } catch (e) { console.error('[halloween]', e); }
    return c;
  };

  const _settings = Pages.settings;
  Pages.settings = (root, opts) => {
    const c = _settings(root, opts);
    try {
      const card = settingsCard(root);
      const look = $('.look-card', root);
      if (look) { card.style.marginTop = '16px'; look.after(card); } else root.appendChild(card);
    } catch (e) { console.error('[halloween]', e); }
    return c;
  };

  if (typeof applyAppearance === 'function') {
    const _apply = applyAppearance;
    // eslint-disable-next-line no-global-assign
    applyAppearance = async function (s, o) {
      try {
        if (s && HW_ACCENTS[s.accentPreset] && typeof ACCENTS === 'object' && !ACCENTS[s.accentPreset]) ACCENTS[s.accentPreset] = HW_ACCENTS[s.accentPreset];
      } catch { /* ignore */ }
      const r = await _apply(s, o);
      syncTint();
      return r;
    };
  }
  if (typeof renderAccountChip === 'function') {
    const _chip = renderAccountChip;
    // eslint-disable-next-line no-global-assign
    renderAccountChip = function () { _chip(); try { decorateChip(); } catch (e) { console.error('[halloween]', e); } };
  }

  // background scenes from the reward road are drawn here (Background only knows its own)
  try {
    const bg = document.getElementById('bg');
    if (bg) new MutationObserver(syncBgScene).observe(bg, { attributes: true, attributeFilter: ['data-scene'] });
  } catch { /* ignore */ }

  try {
    const st0 = load();
    if (st0.claimed.length) ensureSprites();
    registerRewards(st0);
    applyTheme();
    syncCursor();
    syncBgScene();
  } catch (e) { console.error('[halloween]', e); }
  setInterval(applyTheme, 10 * MIN);

  window.Halloween = { inSeason, themeOn, eventOpen, applyTheme, mode: getMode };
})();
