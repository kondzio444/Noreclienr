'use strict';
/* Banner with what the Nore team says (main/notices.js → GET /api/v2/client/config?target=launcher):
   announcements (dismissable, remembered per id), maintenance and "update required". Self-contained:
   it brings its own styles and only needs #main, so it survives renderer redesigns. */
(() => {
  const KEY = 'nore.notices.dismissed';
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const dismissed = new Set((() => { try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; } })());
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify([...dismissed].slice(-50))); } catch { /* ignore */ } };
  let last = null;

  const style = document.createElement('style');
  style.textContent = `
    .nore-notices { display: grid; gap: 6px; padding: 10px 16px 0; }
    .nore-notice { display: flex; align-items: flex-start; gap: 10px; padding: 10px 12px; border-radius: 12px;
      background: color-mix(in oklab, var(--accent, #9d5cff) 16%, var(--surface, #150f1e)); border: 1px solid rgba(var(--accent-rgb, 157, 92, 255), .45);
      color: var(--text, #f1eaff); font-size: 13px; line-height: 1.4; animation: nore-notice-in .32s cubic-bezier(.2, .8, .2, 1) both; }
    .nore-notice[data-level="warning"] { background: color-mix(in oklab, #ffb020 16%, var(--surface, #150f1e)); border-color: rgba(255, 176, 32, .55); }
    .nore-notice[data-level="event"] { background: color-mix(in oklab, #ff8a1f 16%, var(--surface, #150f1e)); border-color: rgba(255, 138, 31, .55); }
    .nore-notice[data-level="critical"] { background: color-mix(in oklab, #ff4d6d 18%, var(--surface, #150f1e)); border-color: rgba(255, 77, 109, .6); }
    .nore-notice b { display: block; font-weight: 700; }
    .nore-notice p { margin: 2px 0 0; opacity: .85; white-space: pre-line; }
    .nore-notice-body { flex: 1; min-width: 0; }
    .nore-notice button { flex: none; border: 0; border-radius: 8px; padding: 4px 9px; background: rgba(255, 255, 255, .1); color: inherit; font: inherit; cursor: pointer; }
    .nore-notice button:hover { background: rgba(255, 255, 255, .18); }
    @keyframes nore-notice-in { from { opacity: 0; transform: translateY(-6px); } }
    @media (prefers-reduced-motion: reduce) { .nore-notice { animation: none; } }`;
  document.head.appendChild(style);

  function render(s) {
    last = s;
    const main = document.getElementById('main');
    if (!main) return;
    let box = main.querySelector(':scope > .nore-notices');
    const items = [];
    if (s && s.updateRequired) items.push({ id: '#update', level: 'critical', title: 'Wymagana aktualizacja launchera', body: `Ta wersja jest za stara – potrzebna jest co najmniej ${s.minLauncherVersion}. Aktualizacja pobiera się w tle.`, fixed: true, action: 'Sprawdź' });
    if (s && s.maintenance) items.push({ id: '#maintenance', level: 'warning', title: 'Przerwa techniczna', body: s.maintenance.message || 'Niektóre usługi Nore mogą chwilowo nie działać.', fixed: true });
    for (const a of (s && s.announcements) || []) if (!dismissed.has(a.id)) items.push(a);
    if (!items.length) { if (box) box.remove(); return; }
    if (!box) { box = document.createElement('div'); box.className = 'nore-notices'; box.setAttribute('role', 'status'); main.prepend(box); }
    box.innerHTML = items.map(a => `<div class="nore-notice" data-level="${esc(a.level)}" data-id="${esc(a.id)}">
      <div class="nore-notice-body"><b>${esc(a.title)}</b>${a.body ? `<p>${esc(a.body)}</p>` : ''}</div>
      ${a.link ? `<button type="button" data-open="${esc(a.link)}">Więcej</button>` : ''}
      ${a.action ? `<button type="button" data-update>${esc(a.action)}</button>` : ''}
      ${a.fixed ? '' : '<button type="button" data-close aria-label="Zamknij ogłoszenie">✕</button>'}</div>`).join('');
  }

  document.addEventListener('click', (e) => {
    const el = e.target.closest('.nore-notice button');
    if (!el) return;
    if (el.dataset.open) window.nore.open(el.dataset.open);
    else if ('update' in el.dataset) window.nore.update.check();
    else if ('close' in el.dataset) { dismissed.add(el.closest('.nore-notice').dataset.id); save(); render(last); }
  });

  if (!window.nore || !window.nore.notices) return;
  window.nore.on('notices:state', render);
  const first = () => window.nore.notices.get().then(render).catch(() => {});
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', first); else first();
})();
