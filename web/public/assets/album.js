'use strict';
/* Nore – Album: shared behaviour of the Nore sites (noroclient.pl, noreclient.pl, mc.noreclient.pl).
   API helper (v2 envelope), entrances, the seasonal event (Halloween torch, winter snow), toasts.
   Everything degrades to the static page without script. */
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const root = document.documentElement;
  root.classList.add('js');

  // ------------------------------------------------------------------ API v2: { ok: true, ...fields } | { ok: false, error }
  const cache = new Map();
  function api(path, { fresh = false } = {}) {
    const url = path.startsWith('/') ? path : `/api/v2/${path}`;
    if (!fresh && cache.has(url)) return cache.get(url);
    const p = fetch(url, { headers: { Accept: 'application/json' } })
      .then(async (r) => {
        const j = await r.json().catch(() => null);
        if (!j) throw Object.assign(new Error(`Błąd ${r.status}`), { status: r.status });
        if (j.ok === false) throw Object.assign(new Error(j.error || `Błąd ${r.status}`), { status: r.status, body: j });
        return j;
      });
    cache.set(url, p);
    p.catch(() => cache.delete(url));
    return p;
  }

  // ------------------------------------------------------------------ formatting (Polish)
  const nf = new Intl.NumberFormat('pl-PL');
  const num = (n) => (n == null || Number.isNaN(n) ? '–' : nf.format(n));
  const plural = (n, one, few, many) => {
    const a = Math.abs(n) % 100, b = a % 10;
    return n === 1 ? one : b >= 2 && b <= 4 && (a < 12 || a > 14) ? few : many;
  };
  const bytes = (b) => (b == null ? '' : b >= 1e6 ? `${(b / 1048576).toFixed(1).replace('.', ',')} MB` : `${Math.round(b / 1024)} KB`);
  const date = (iso, opts = { day: 'numeric', month: 'long', year: 'numeric' }) => { const d = new Date(iso); return Number.isNaN(+d) ? '' : d.toLocaleDateString('pl-PL', opts); };
  function ago(iso) {
    const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
    if (!Number.isFinite(s)) return '';
    if (s < 60) return 'przed chwilą';
    if (s < 3600) { const m = Math.round(s / 60); return `${m} min temu`; }
    if (s < 86400) { const h = Math.round(s / 3600); return `${h} ${plural(h, 'godzinę', 'godziny', 'godzin')} temu`; }
    const d = Math.round(s / 86400); return `${d} ${plural(d, 'dzień', 'dni', 'dni')} temu`;
  }
  function until(iso) {
    const s = Math.max(0, Math.floor((Date.parse(iso) - Date.now()) / 1000));
    return { total: s, d: Math.floor(s / 86400), h: Math.floor((s % 86400) / 3600), m: Math.floor((s % 3600) / 60), s: s % 60 };
  }
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ------------------------------------------------------------------ toast + clipboard
  let toastEl, toastTimer;
  function toast(text, sub = '', dot = 'ready') {
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.className = 'toast';
      toastEl.setAttribute('role', 'status');
      toastEl.hidden = true;
      document.body.append(toastEl);
    }
    toastEl.hidden = true;
    void toastEl.offsetWidth;
    toastEl.innerHTML = `<i class="dot ${dot}"></i><span>${esc(text)}${sub ? `<small>${esc(sub)}</small>` : ''}</span>`;
    toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toastEl.hidden = true; }, 3200);
  }
  async function copy(text) {
    try { await navigator.clipboard.writeText(text); return true; } catch {
      const t = document.createElement('textarea');
      t.value = text; t.setAttribute('readonly', ''); t.style.position = 'fixed'; t.style.opacity = '0';
      document.body.append(t); t.select();
      let ok = false; try { ok = document.execCommand('copy'); } catch { /* no clipboard */ }
      t.remove(); return ok;
    }
  }

  // ------------------------------------------------------------------ entrances: the parts of every section, staggered, once
  function entrances(scope = document) {
    const parts = $$('.rv', scope).filter((el) => !el.dataset.rvDone);
    const groups = new Map();
    for (const el of parts) {
      el.dataset.rvDone = '1';
      const sec = el.closest('section, footer, header, aside') || document.body;
      const i = groups.get(sec) || 0;
      groups.set(sec, i + 1);
      if (!el.style.getPropertyValue('--d')) el.style.setProperty('--d', `${Math.min(i, 7) * 70}ms`);
    }
    if (reduced || !('IntersectionObserver' in window)) return;
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        e.target.classList.remove('rv-wait');
        e.target.classList.add(e.target.classList.contains('rv-stick') ? 'stick-in' : 'in');
        io.unobserve(e.target);
      }
    }, { threshold: 0.12, rootMargin: '0px 0px -4% 0px' });
    for (const el of parts) {
      const r = el.getBoundingClientRect();
      if (r.top < innerHeight && r.bottom > 0) el.classList.add(el.classList.contains('rv-stick') ? 'stick-in' : 'in');
      else { el.classList.add('rv-wait'); io.observe(el); }
    }
  }

  // ------------------------------------------------------------------ the seasonal event (forced on by date; DESIGN.md §9)
  const TZ = '+01:00';
  const year = new Date().getFullYear();
  const HALLOWEEN = { from: Date.parse(`${year}-10-15T00:00:00+02:00`), to: Date.parse(`${year}-11-04T00:00:00${TZ}`), peak: `${year}-10-31T00:00:00${TZ}`, end: `${year}-11-04T00:00:00${TZ}` };
  const WINTER_START = '2026-12-10T00:00:00+01:00';
  function eventByDate(now = Date.now()) {
    if (now >= Date.parse(WINTER_START) && (new Date(now).getMonth() === 11 || new Date(now).getMonth() <= 1)) return 'winter';
    if (now >= HALLOWEEN.from && now < HALLOWEEN.to) return 'halloween';
    return '';
  }
  const listeners = [];
  const state = { event: eventByDate(), events: null, halloween: HALLOWEEN, winterStart: WINTER_START };
  function setEvent(name) {
    state.event = name;
    if (name) root.dataset.event = name; else delete root.dataset.event;
    decorate();
    for (const f of listeners) f(state);
  }
  function onEvent(f) { listeners.push(f); if (state.events || state.event) f(state); }

  let decorated = '';
  function decorate() {
    if (decorated === state.event || document.body.classList.contains('panel')) return; // the panel works with the event palette only
    decorated = state.event;
    for (const el of $$('.lights, .bats, .snow, body > .web')) el.remove();
    if (state.event === 'halloween') {
      const lights = document.createElement('div');
      lights.className = 'lights';
      lights.setAttribute('aria-hidden', 'true');
      const bats = document.createElement('div');
      bats.className = 'bats';
      bats.setAttribute('aria-hidden', 'true');
      bats.innerHTML = '<img src="/assets/album/bat.png" alt=""><img src="/assets/album/bat.png" alt=""><img src="/assets/album/bat.png" alt="">';
      const web = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      web.setAttribute('class', 'web'); web.setAttribute('viewBox', '0 0 200 200'); web.setAttribute('aria-hidden', 'true');
      web.innerHTML = '<path d="M200 0 L60 0 M200 0 L90 70 M200 0 L140 130 M200 0 L200 160"/><path d="M168 0 Q176 18 184 26 Q192 34 200 34"/><path d="M128 0 Q144 34 160 54 Q180 66 200 70"/><path d="M92 0 Q114 50 132 84 Q162 100 200 108"/><path d="M60 0 Q86 66 108 114 Q150 132 200 150"/>';
      document.body.prepend(lights, bats, web);
      torch(lights);
    } else if (state.event === 'winter') {
      const snow = document.createElement('div');
      snow.className = 'snow';
      snow.setAttribute('aria-hidden', 'true');
      const n = innerWidth < 600 ? 18 : 40;
      snow.innerHTML = Array.from({ length: n }, () => `<i style="left:${(Math.random() * 100).toFixed(1)}%;--s:${(6 + Math.random() * 8).toFixed(0)}px;--t:${(10 + Math.random() * 12).toFixed(1)}s;--dl:-${(Math.random() * 20).toFixed(1)}s;opacity:${(.4 + Math.random() * .5).toFixed(2)}"></i>`).join('');
      document.body.prepend(snow);
    }
  }

  // the torch: a warm cone at the pointer; art dims with distance, glow stickers charge
  let torchOn = false;
  function torch(lights) {
    if (torchOn) return;
    torchOn = true;
    let tx = innerWidth / 2, ty = innerHeight * 0.38, x = tx, y = ty, raf = 0;
    const charged = new WeakMap();
    function frame() {
      raf = 0;
      x += (tx - x) * (reduced ? 1 : 0.18);
      y += (ty - y) * (reduced ? 1 : 0.18);
      const l = $('.lights');
      if (l) { l.style.setProperty('--tx', `${x.toFixed(0)}px`); l.style.setProperty('--ty', `${y.toFixed(0)}px`); }
      for (const el of $$('.art')) {
        const r = el.getBoundingClientRect();
        if (r.bottom < 0 || r.top > innerHeight) continue;
        const dx = Math.max(r.left - x, 0, x - r.right), dy = Math.max(r.top - y, 0, y - r.bottom);
        const k = Math.max(0, 1 - Math.hypot(dx, dy) / 420);
        el.style.setProperty('--lit', (0.64 + 0.36 * k).toFixed(2));
      }
      for (const el of $$('.glow')) {
        const r = el.getBoundingClientRect();
        if (Math.hypot(r.left + r.width / 2 - x, r.top + r.height / 2 - y) < 170) {
          el.classList.add('charged');
          clearTimeout(charged.get(el));
          charged.set(el, setTimeout(() => el.classList.remove('charged'), 4000));
        }
      }
      if (Math.abs(tx - x) > 0.5 || Math.abs(ty - y) > 0.5) raf = requestAnimationFrame(frame);
    }
    const kick = () => { if (!raf) raf = requestAnimationFrame(frame); };
    addEventListener('pointermove', (e) => { if (e.pointerType === 'touch') return; tx = e.clientX; ty = e.clientY; kick(); }, { passive: true });
    addEventListener('scroll', kick, { passive: true });
    addEventListener('resize', kick);
    kick();
  }

  // ------------------------------------------------------------------ live footer status
  function footerStatus() {
    const el = $('[data-api-state]');
    if (!el) return;
    api('status').then((s) => {
      const map = { ok: ['ready', 'API działa'], degraded: ['wait', 'API działa częściowo'], down: ['error', 'API ma awarię'] };
      const [dot, text] = map[s.status] || ['off', 'Stan nieznany'];
      el.innerHTML = `<i class="dot ${dot}"></i>${text}${s.latest ? ` · wersja ${esc(s.latest)}` : ''}`;
    }).catch(() => { el.innerHTML = '<i class="dot off"></i>Nie udało się sprawdzić stanu API'; });
  }

  window.Nore = { $, $$, reduced, api, num, plural, bytes, date, ago, until, esc, toast, copy, entrances, onEvent, state };

  const start = () => {
    if (state.event) setEvent(state.event);
    entrances();
    footerStatus();
    api('events').then((ev) => {
      state.events = ev;
      // Halloween is forced on in the API all year; the site shows it during its season (15.10 – 3.11)
      const name = ev.flags && ev.flags.winter ? 'winter' : eventByDate();
      setEvent(name);
    }).catch(() => setEvent(state.event));
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
