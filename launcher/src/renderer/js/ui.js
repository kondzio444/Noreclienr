'use strict';
/* Small DOM + UI helpers shared by every page. */

const ICONS = {
  home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M10 21v-6h4v6"/>',
  layers: '<path d="m12 2 9 5-9 5-9-5 9-5z"/><path d="m3 12 9 5 9-5"/><path d="m3 17 9 5 9-5"/>',
  puzzle: '<path d="M10 3h4v2.5a2 2 0 1 0 4 0V3h3v7h-2.5a2 2 0 1 0 0 4H21v7h-7v-2.5a2 2 0 1 0-4 0V21H3v-7h2.5a2 2 0 1 0 0-4H3V3h7z"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="9" cy="9" r="2"/><path d="m21 15-5-5L5 21"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  database: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5"/><path d="M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-7 8-7s8 3 8 7"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14c2.2.6 3.5 2.8 3.5 6"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  terminal: '<rect x="2" y="4" width="20" height="16" rx="3"/><path d="m7 10 3 2-3 2M13 15h4"/>',
  play: '<path d="M7 4.5v15l13-7.5z" fill="currentColor" stroke="none"/>',
  download: '<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/>',
  folder: '<path d="M3 6a2 2 0 0 1 2-2h4l2 3h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  check: '<path d="m5 12 5 5 9-10"/>',
  checks: '<path d="m2 12 5 5 9-10"/><path d="m12 16 1 1 9-10"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  heart: '<path d="M12 20s-7-4.4-9.3-8.8A5.2 5.2 0 0 1 12 6.4a5.2 5.2 0 0 1 9.3 4.8C19 15.6 12 20 12 20z"/>',
  cpu: '<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  sparkles: '<path d="M12 3l1.8 4.7 4.7 1.8-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>',
  external: '<path d="M14 4h6v6"/><path d="M20 4 10 14"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" stroke="none"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
  shield: '<path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z"/><path d="m9 12 2 2 4-4"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>',
  refresh: '<path d="M20 11a8 8 0 0 0-14.9-3.5L4 9"/><path d="M4 4v5h5"/><path d="M4 13a8 8 0 0 0 14.9 3.5L20 15"/><path d="M20 20v-5h-5"/>',
  arrowRight: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  arrowLeft: '<path d="M19 12H5M11 6l-6 6 6 6"/>',
  box: '<path d="m12 2 9 5v10l-9 5-9-5V7z"/><path d="m3 7 9 5 9-5M12 12v10"/>',
  zap: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
  copy: '<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>',
  power: '<path d="M12 2v10"/><path d="M5.6 6.6a9 9 0 1 0 12.8 0"/>',
  monitor: '<rect x="2" y="4" width="20" height="13" rx="2"/><path d="M8 21h8M12 17v4"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9M17 6l3 3M14 9l2 2"/>',
  server: '<rect x="3" y="4" width="18" height="7" rx="2"/><rect x="3" y="13" width="18" height="7" rx="2"/><path d="M7 7.5h.01M7 16.5h.01M11 7.5h6M11 16.5h6"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  wifi: '<path d="M2 8.5a15 15 0 0 1 20 0M5 12a10 10 0 0 1 14 0M8.5 15.5a5 5 0 0 1 7 0"/><path d="M12 19h.01"/>',
  archive: '<rect x="3" y="4" width="18" height="5" rx="1.5"/><path d="M5 9v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9M10 13h4"/>',
  upload: '<path d="M12 21V9"/><path d="m7 14 5-5 5 5"/><path d="M5 3h14"/>',
  ban: '<circle cx="12" cy="12" r="9"/><path d="m5.6 5.6 12.8 12.8"/>',
  crown: '<path d="m3 7 4.5 4L12 4l4.5 7L21 7l-2 12H5z"/>',
  activity: '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
  plug: '<path d="M9 2v6M15 2v6M6 8h12v3a6 6 0 0 1-12 0zM12 17v5"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
  micOff: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3M4 4l16 16"/>',
  headphones: '<path d="M4 15v-3a8 8 0 0 1 16 0v3"/><rect x="3" y="14" width="5" height="7" rx="1.5"/><rect x="16" y="14" width="5" height="7" rx="1.5"/>',
  headphonesOff: '<path d="M4 15v-3a8 8 0 0 1 16 0v3"/><rect x="3" y="14" width="5" height="7" rx="1.5"/><rect x="16" y="14" width="5" height="7" rx="1.5"/><path d="M3 3l18 18"/>',
  message: '<path d="M4 5h16v11H9l-5 4z"/>',
};

const LOADER_LABELS = { vanilla: 'Vanilla', fabric: 'Fabric', quilt: 'Quilt', forge: 'Forge', neoforge: 'NeoForge' };
function loaderName(l) { return LOADER_LABELS[l] || 'Vanilla'; }

function icon(name, cls = '') {
  return `<svg viewBox="0 0 24 24" class="i ${cls}">${ICONS[name] || ''}</svg>`;
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** Creates an element from an HTML string. */
function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

function $(sel, root = document) { return root.querySelector(sel); }
function $$(sel, root = document) { return [...root.querySelectorAll(sel)]; }

function fmtNum(n) {
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace('.0', '') + ' mln';
  if (n >= 1e3) return (n / 1e3).toFixed(1).replace('.0', '') + ' tys.';
  return String(n);
}

function fmtBytes(b) {
  if (b > 1073741824) return (b / 1073741824).toFixed(2) + ' GB';
  if (b > 1048576) return (b / 1048576).toFixed(1) + ' MB';
  if (b > 1024) return (b / 1024).toFixed(0) + ' KB';
  return b + ' B';
}

function fmtDuration(ms) {
  const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000);
  return h ? `${h} h ${m} min` : `${m} min`;
}

function fmtAgo(ts) {
  if (!ts) return 'nigdy';
  const d = (Date.now() - ts) / 1000;
  if (d < 60) return 'przed chwilą';
  if (d < 3600) return Math.floor(d / 60) + ' min temu';
  if (d < 86400) return Math.floor(d / 3600) + ' h temu';
  return Math.floor(d / 86400) + ' dni temu';
}

const INSTANCE_COLORS = [
  ['#ff8a1f', '#ff4d1a'], ['#ffb547', '#ff7a1a'], ['#ff5c5c', '#b8233a'], ['#a96bff', '#5b2bd6'],
  ['#2fd4ff', '#1a6dff'], ['#3ddc97', '#11916a'], ['#ff6bc1', '#c12e86'], ['#d6d3d1', '#78716c'],
];

function instIcon(inst, size = 42) {
  const [a, b] = INSTANCE_COLORS[inst.color % INSTANCE_COLORS.length] || INSTANCE_COLORS[0];
  const inner = inst.noreClient ? '<img src="assets/logo.png" alt="">' : `<span>${esc((inst.name || '?').charAt(0).toUpperCase())}</span>`;
  return `<div class="inst-icon" style="width:${size}px;height:${size}px;background:linear-gradient(135deg,${a},${b});box-shadow:0 0 18px ${a}55">${inner}</div>`;
}

function avatarHtml(acc) {
  if (!acc) return `<div class="avatar">${icon('user')}</div>`;
  const letter = esc(acc.name.charAt(0).toUpperCase());
  return `<div class="avatar">${letter}<img src="https://mc-heads.net/avatar/${encodeURIComponent(acc.name)}/64" data-fallback alt=""></div>`;
}

// ------------------------------------------------------------------ motion (reads the tokens in styles.css :root)

const Motion = (() => {
  const css = () => getComputedStyle(document.body || document.documentElement);
  /** In-app animation switch off: no motion at all. */
  const off = () => document.body.classList.contains('no-anim');
  /** prefers-reduced-motion: fades stay, travel goes. */
  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches || document.body.classList.contains('motion-reduced');
  const ms = (name) => { const v = css().getPropertyValue(name).trim(); return v.endsWith('ms') ? parseFloat(v) : v.endsWith('s') ? parseFloat(v) * 1000 : (parseFloat(v) || 0); };
  const ease = (name) => css().getPropertyValue(name).trim() || 'ease';
  /** A travel distance, zero under reduced motion. */
  const px = (n) => (reduced() ? 0 : n);

  function animate(node, frames, opts) {
    if (!node || off() || !node.animate) return null;
    try { return node.animate(frames, opts); } catch { return null; }
  }

  /** Tweens the number shown in node to `to` (formatted by fmt). Interruptible: starts from the value on screen. */
  function count(node, to, fmt = (n) => String(Math.round(n)), dur) {
    if (!node) return;
    const from = node._num != null ? node._shown : null;
    node._num = to;
    cancelAnimationFrame(node._numRaf);
    if (from == null || from === to || off() || reduced() || !isFinite(from) || !isFinite(to)) { node._shown = to; node.textContent = fmt(to); return; }
    const d = dur || ms('--dur-focal'), t0 = performance.now();
    const step = (now) => {
      const p = Math.max(0, Math.min(1, (now - t0) / d)), e = 1 - Math.pow(1 - p, 4); // rAF time can precede t0
      node._shown = from + (to - from) * e;
      node.textContent = fmt(node._shown);
      if (p < 1) node._numRaf = requestAnimationFrame(step);
    };
    node._numRaf = requestAnimationFrame(step);
  }

  /** A short spring pulse on a badge or counter whose value just changed. */
  function bump(node) {
    if (!node || off() || reduced()) return;
    node.classList.remove('bump'); void node.offsetWidth; node.classList.add('bump');
    clearTimeout(node._bump); node._bump = setTimeout(() => node.classList.remove('bump'), ms('--dur-base') + 40);
  }

  /** Swaps node's content with a quick out/in (a button label, a status line). dir 1 = new content rises. */
  function swap(node, html, dir = 1) {
    if (!node || node._swapHtml === html) return;
    const first = node._swapHtml == null;
    node._swapHtml = html;
    if (first || off() || !node.isConnected) { node.innerHTML = html; return; }
    const d = px(7) * dir;
    if (node._swapAnim) node._swapAnim.cancel();
    const out = animate(node, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: `translateY(${-d}px)` }], { duration: ms('--dur-exit'), easing: ease('--ease-in') });
    node._swapAnim = out;
    const show = () => {
      if (node._swapHtml !== html) return;
      node.innerHTML = html;
      node._swapAnim = animate(node, [{ opacity: 0, transform: `translateY(${d}px)` }, { opacity: 1, transform: 'none' }], { duration: ms('--dur-base'), easing: ease('--ease-out') });
    };
    if (out) out.onfinish = show; else show();
  }

  /** Keeps a frozen copy of container's current content over it and fades it away, so whatever
      replaces the content (results after a skeleton) crossfades instead of popping. */
  function ghost(container) {
    if (!container || off() || !container.firstElementChild) return;
    const g = document.createElement('div');
    g.className = 'swap-ghost';
    g.setAttribute('aria-hidden', 'true');
    for (const c of container.children) { if (c.classList.contains('swap-ghost')) continue; const k = c.cloneNode(true); k.querySelectorAll('[id]').forEach(n => n.removeAttribute('id')); g.appendChild(k); }
    if (getComputedStyle(container).position === 'static') container.style.position = 'relative';
    queueMicrotask(() => {
      container.appendChild(g);
      const a = animate(g, [{ opacity: 1 }, { opacity: 0 }], { duration: ms('--dur-base'), easing: ease('--ease-in'), fill: 'forwards' });
      if (a) a.onfinish = () => g.remove(); else g.remove();
    });
  }

  /** FLIP: measures nodes, runs mutate(), then slides each one from where it was. */
  function flip(nodes, mutate) {
    const before = new Map(nodes.map(n => [n, n.getBoundingClientRect()]));
    mutate();
    if (off() || reduced()) return;
    for (const [n, r] of before) {
      if (!n.isConnected) continue;
      const now = n.getBoundingClientRect();
      const dx = r.left - now.left, dy = r.top - now.top;
      if (dx || dy) animate(n, [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { duration: ms('--dur-base'), easing: ease('--ease-out') });
    }
  }

  return { off, reduced, ms, ease, px, animate, count, bump, swap, ghost, flip };
})();

// ------------------------------------------------------------------ toasts

function toast(title, text = '', type = 'info', ms = 3800) {
  const ic = type === 'error' ? 'x' : type === 'success' ? 'check' : 'info';
  const t = el(`<div class="toast ${type}" role="status"><div class="ico">${icon(ic)}</div><div><b>${esc(title)}</b>${text ? `<span>${esc(text)}</span>` : ''}</div><div class="bar" style="animation-duration:${ms}ms"></div></div>`);
  const box = $('#toasts');
  // the stack is bottom-aligned: the newcomer pushes the others up smoothly
  const others = [...box.children].filter(x => !x.classList.contains('out'));
  Motion.flip(others, () => box.appendChild(t));
  let left = ms, started = Date.now(), timer = null;
  const close = () => {
    if (t.classList.contains('out')) return;
    clearTimeout(timer);
    t.classList.add('out');
    setTimeout(() => {
      // the toasts above close the gap instead of jumping
      const rest = [...box.children].filter(x => x !== t && !x.classList.contains('out'));
      Motion.flip(rest, () => t.remove());
    }, Motion.off() ? 0 : Motion.ms('--dur-base'));
  };
  // hovering holds the toast (its bar pauses in CSS)
  t.addEventListener('pointerenter', () => { clearTimeout(timer); left -= Date.now() - started; });
  t.addEventListener('pointerleave', () => { started = Date.now(); clearTimeout(timer); timer = setTimeout(close, Math.max(900, left)); });
  t.addEventListener('click', close);
  timer = setTimeout(close, ms);
}

function errorToast(e, title = 'Wystąpił błąd') {
  const msg = String((e && e.message) || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
  toast(title, msg, 'error', 6000);
}

// ------------------------------------------------------------------ modal

function modal(html, { onClose, dismissable = true } = {}) {
  const back = el(`<div class="modal-backdrop"><div class="modal">${html}</div></div>`);
  document.body.appendChild(back);
  const close = () => {
    if (back.classList.contains('closing')) return;
    back.classList.add('closing');
    setTimeout(() => back.remove(), Motion.off() ? 0 : Motion.ms('--dur-exit') + 30);
    onClose && onClose();
  };
  if (dismissable) back.addEventListener('mousedown', (e) => { if (e.target === back) close(); });
  $$('[data-close]', back).forEach(b => b.addEventListener('click', close));
  return { root: back, el: $('.modal', back), close };
}

function confirmModal(title, text, { ok = 'Potwierdź', danger = false } = {}) {
  return new Promise((resolve) => {
    let done = false;
    const m = modal(`<h3>${esc(title)}</h3><p class="sub">${esc(text)}</p>
      <div class="foot"><button class="btn ghost" data-close>Anuluj</button><button class="btn ${danger ? 'danger' : ''}" id="m-ok">${esc(ok)}</button></div>`,
    { onClose: () => { if (!done) resolve(false); } });
    $('#m-ok', m.el).addEventListener('click', () => { done = true; resolve(true); m.close(); });
  });
}

/** BETA / ALPHA tag for a Modrinth version type (nothing for releases). */
function versionTypeTag(type) {
  return type && type !== 'release' ? `<span class="tag vt ${esc(type)}">${esc(String(type).toUpperCase())}</span>` : '';
}

/** Confirmation with a list of content updates (file → version + BETA/ALPHA). Resolves true/false. */
function updatesConfirm(title, ups, { ok = 'Aktualizuj wszystko' } = {}) {
  return new Promise((resolve) => {
    let done = false;
    const m = modal(`<h3>${esc(title)}</h3><p class="sub">Stare pliki trafią do folderu .nore-backup w instancji – nic nie zostanie utracone.</p>
      <div class="upd-list">${ups.map(u => `<div class="upd-item"><span class="from">${esc(u.oldFile)}</span>${icon('arrowRight')}<b>${esc(u.version)}</b>${versionTypeTag(u.type)}</div>`).join('')}</div>
      <div class="foot"><button class="btn ghost" data-close>Anuluj</button><button class="btn" id="m-ok">${icon('download')} ${esc(ok)}</button></div>`,
    { onClose: () => { if (!done) resolve(false); } });
    $('#m-ok', m.el).addEventListener('click', () => { done = true; resolve(true); m.close(); });
  });
}

/** Polish plural: plural(3, 'mod', 'mody', 'modów') → 'mody'. */
function plural(n, one, few, many) {
  if (n === 1) return one;
  const d = n % 10, t = n % 100;
  return d >= 2 && d <= 4 && (t < 12 || t > 14) ? few : many;
}

/** Animated segmented control: buttons [{value,label}] → element; onChange(value).
    The pill glides with transform only (its width change is FLIPped into a scale). */
function segmented(options, value, onChange) {
  const root = el(`<div class="seg"><span class="pill"></span>${options.map(o => `<button data-v="${esc(o.value)}">${o.label}</button>`).join('')}</div>`);
  const pill = $('.pill', root);
  let at = null; // { x, w } currently drawn
  const set = (v, animate = true) => {
    $$('button', root).forEach(b => b.classList.toggle('on', b.dataset.v === v));
    const b = $(`button[data-v="${CSS.escape(v)}"]`, root);
    if (!b || !b.offsetWidth) return;
    const x = b.offsetLeft, w = b.offsetWidth;
    pill.style.left = '0px';
    pill.style.transformOrigin = 'left';
    pill.style.transition = 'none';
    pill.style.width = w + 'px';
    pill.style.transform = `translateX(${x}px)`;
    if (animate && at && (at.x !== x || at.w !== w)) {
      Motion.animate(pill, [{ transform: `translateX(${at.x}px) scaleX(${at.w / w})` }, { transform: `translateX(${x}px) scaleX(1)` }],
        { duration: Motion.ms('--nore-spring-tab-dur'), easing: Motion.ease('--nore-spring-tab') });
    }
    at = { x, w };
  };
  $$('button', root).forEach(b => b.addEventListener('click', () => { set(b.dataset.v); onChange(b.dataset.v); }));
  requestAnimationFrame(() => set(value, false));
  root.setValue = set;
  return root;
}

/** Marks a container's children as a list arriving (a short staggered rise, capped in CSS).
    replay=false refreshes a list in place without playing the entrance again. */
function stagger(container, replay = true) {
  if (!container) return;
  [...container.children].forEach((c, i) => c.style.setProperty('--i', i));
  container.classList.toggle('settled', !replay);
  container.classList.add('stagger');
}

function sliderFill(input) {
  const p = ((input.value - input.min) / (input.max - input.min)) * 100;
  input.style.setProperty('--p', p + '%');
}

// images marked data-fallback simply disappear when they fail to load (CSP forbids inline handlers)
document.addEventListener('error', (e) => {
  const t = e.target;
  if (t && t.tagName === 'IMG' && t.hasAttribute('data-fallback')) t.remove();
}, true);
