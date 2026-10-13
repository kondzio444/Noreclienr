'use strict';
/* Community pages (1.4 Beta): friends shared with Nore Client, screenshot gallery and the shop teaser. */

const NICK_RE = /^[A-Za-z0-9_]{2,16}$/;
const head = (name, size = 64) => `https://mc-heads.net/avatar/${encodeURIComponent(name)}/${size}`;

// ================================================================== friends

Pages.friends = (root) => {
  let list = [];
  let q = '';
  root.innerHTML = `
    <div class="page-head"><div><h2>${icon('users')} Znajomi</h2><p>Jedna lista dla launchera i Nore Client – zapisuje się w każdej instancji.</p></div>
      <div class="actions"><span class="tag accent" id="fr-count">0 znajomych</span></div></div>
    <div class="fr-top stagger">
      <div class="card fr-add" style="--i:0">
        <div class="fr-prev" id="fr-prev">${icon('user')}</div>
        <div class="grow">
          <div class="look-label" style="margin:0 0 8px">Dodaj znajomego</div>
          <div class="row" style="gap:10px"><input class="input grow" id="fr-nick" maxlength="16" placeholder="Nick w Minecraft, np. Notch" spellcheck="false">
            <button class="btn" id="fr-go" disabled>${icon('plus')} Dodaj</button></div>
          <small class="muted" id="fr-hint">2–16 znaków: litery, cyfry i podkreślenie.</small>
        </div>
      </div>
      <div class="card fr-tips" style="--i:1">
        <div class="section-title">${icon('sparkles')} W grze</div>
        <div class="fr-tip"><i>${icon('zap')}</i><span>Nick znajomego świeci w kolorze akcentu nad głową i na liście TAB.</span></div>
        <div class="fr-tip"><i>${icon('globe')}</i><span>Gdy znajomy wejdzie na serwer, dostaniesz powiadomienie.</span></div>
        <div class="fr-tip"><i>${icon('plus')}</i><span>Środkowy przycisk myszy na graczu dodaje go do listy.</span></div>
      </div>
    </div>
    <div class="row" style="margin:22px 0 12px;gap:12px">
      <div class="section-title" style="flex:1">${icon('heart')} Twoja lista</div>
      <input class="input sm fr-search" id="fr-q" placeholder="Szukaj na liście…">
    </div>
    <div class="fr-grid" id="fr-list"></div>`;

  const input = $('#fr-nick', root), go2 = $('#fr-go', root), prev = $('#fr-prev', root);
  let prevTimer = null;
  input.oninput = () => {
    const v = input.value.trim(), ok = NICK_RE.test(v);
    go2.disabled = !ok;
    $('#fr-hint', root).textContent = !v ? '2–16 znaków: litery, cyfry i podkreślenie.' : ok ? `Enter, aby dodać ${v}` : 'Niepoprawny nick.';
    clearTimeout(prevTimer);
    prevTimer = setTimeout(() => {
      prev.innerHTML = ok ? `<img src="${head(v, 96)}" alt="" data-fallback>` : icon('user');
      prev.classList.toggle('on', ok);
    }, 300);
  };
  const add = async () => {
    const v = input.value.trim();
    if (!NICK_RE.test(v)) return;
    try {
      list = await nore.friends.add(v);
      input.value = '';
      input.oninput();
      toast('Dodano znajomego', `${v} będzie podświetlony w grze.`, 'success');
      render(v);
    } catch (e) { errorToast(e, 'Znajomi'); }
  };
  go2.onclick = add;
  input.onkeydown = (e) => { if (e.key === 'Enter') add(); };
  $('#fr-q', root).oninput = (e) => { q = e.target.value.trim().toLowerCase(); render(); };

  const render = (fresh) => {
    $('#fr-count', root).textContent = `${list.length} ${list.length === 1 ? 'znajomy' : 'znajomych'}`;
    const box = $('#fr-list', root);
    const shown = list.filter(n => !q || n.toLowerCase().includes(q));
    if (!list.length) {
      box.innerHTML = `<div class="card empty" style="grid-column:1/-1">${icon('users')}<div>Nie masz jeszcze znajomych na liście.<br><small>Dodaj nick powyżej albo kliknij gracza środkowym przyciskiem w grze.</small></div></div>`;
      return;
    }
    if (!shown.length) { box.innerHTML = `<div class="card empty small" style="grid-column:1/-1">${icon('search')}<div>Brak wyników dla „${esc(q)}”.</div></div>`; return; }
    box.innerHTML = shown.map((n, i) => `<div class="card fr-card ${n === fresh ? 'fresh' : ''}" data-n="${esc(n)}" style="--i:${Math.min(i, 12)}">
        <div class="fr-body"><span>${esc(n.charAt(0).toUpperCase())}</span><img src="https://mc-heads.net/body/${encodeURIComponent(n)}/120" alt="" data-fallback></div>
        <b>${esc(n)}</b>
        <div class="fr-actions">
          <button class="btn ghost sm icon" data-a="copy" title="Kopiuj nick">${icon('copy')}</button>
          <button class="btn ghost sm icon" data-a="namemc" title="Profil NameMC">${icon('external')}</button>
          <button class="btn danger sm icon" data-a="del" title="Usuń">${icon('trash')}</button>
        </div></div>`).join('');
    stagger(box);
    $$('.fr-card', box).forEach(c => {
      const n = c.dataset.n;
      $('[data-a="copy"]', c).onclick = () => { navigator.clipboard.writeText(n); toast('Skopiowano', n, 'success', 1800); };
      $('[data-a="namemc"]', c).onclick = () => nore.open(`https://namemc.com/profile/${encodeURIComponent(n)}`);
      $('[data-a="del"]', c).onclick = async () => {
        if (!await confirmModal(`Usunąć ${n}?`, 'Gracz zniknie z listy w launcherze i we wszystkich instancjach Nore Client.', { ok: 'Usuń', danger: true })) return;
        c.classList.add('leaving');
        list = await nore.friends.remove(n);
        setTimeout(() => render(), 220);
      };
    });
  };
  nore.friends.list().then(l => { list = l; render(); }).catch(e => errorToast(e, 'Znajomi'));
  render();
  setTimeout(() => input.focus(), 250);
};

// ================================================================== gallery

Pages.gallery = (root) => {
  let shots = [];
  let filter = 'all';
  root.innerHTML = `
    <div class="page-head"><div><h2>${icon('monitor')} Galeria</h2><p>Zrzuty ekranu ze wszystkich instancji (F2 w grze).</p></div>
      <div class="actions"><button class="btn ghost" id="ga-refresh">${icon('refresh')} Odśwież</button></div></div>
    <div class="chips ga-filter" id="ga-filter"></div>
    <div class="ga-grid" id="ga-grid"><div class="card empty" style="grid-column:1/-1"><span class="spinner"></span><div>Wczytywanie zrzutów…</div></div></div>`;

  const filtered = () => shots.filter(s => filter === 'all' || s.instanceId === filter);
  const render = () => {
    const insts = [...new Map(shots.map(s => [s.instanceId, s.instance])).entries()];
    $('#ga-filter', root).innerHTML = shots.length ? [['all', `Wszystkie <i>${shots.length}</i>`], ...insts.map(([id, name]) => [id, `${esc(name)} <i>${shots.filter(s => s.instanceId === id).length}</i>`])]
      .map(([v, l]) => `<button class="lchip ${v === filter ? 'on' : ''}" data-v="${esc(v)}">${l}</button>`).join('') : '';
    $$('#ga-filter .lchip', root).forEach(b => b.onclick = () => { filter = b.dataset.v; render(); });
    const grid = $('#ga-grid', root);
    const list = filtered();
    if (!list.length) {
      grid.innerHTML = `<div class="card empty" style="grid-column:1/-1">${icon('image')}<div>Nie ma jeszcze zrzutów ekranu.<br><small>Naciśnij F2 w grze – Nore Client pokaże podgląd, a zrzut pojawi się tutaj.</small></div></div>`;
      return;
    }
    let lastDay = '';
    grid.innerHTML = list.map((s, i) => {
      const day = new Date(s.time).toLocaleDateString('pl-PL', { day: 'numeric', month: 'long', year: 'numeric' });
      const sep = day !== lastDay ? `<div class="ga-day">${esc(day)}</div>` : '';
      lastDay = day;
      return `${sep}<div class="ga-item" data-i="${i}" style="--i:${Math.min(i, 16)}">
        ${s.thumb ? `<img src="${s.thumb}" alt="" loading="lazy">` : `<div class="ga-missing">${icon('image')}</div>`}
        <div class="ga-meta"><b>${esc(s.instance)}</b><span>${new Date(s.time).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' })} • ${fmtBytes(s.size)}</span></div></div>`;
    }).join('');
    stagger(grid);
    $$('.ga-item', grid).forEach(it => it.onclick = () => lightbox(list, +it.dataset.i));
  };

  const lightbox = (list, index) => {
    const m = modal(`<div class="lb"><div class="lb-stage"><img id="lb-img" alt=""><span class="spinner" id="lb-spin"></span>
        <button class="lb-nav prev" id="lb-prev">${icon('arrowLeft')}</button><button class="lb-nav next" id="lb-next">${icon('arrowRight')}</button></div>
      <div class="lb-bar"><div class="grow"><b id="lb-name"></b><span id="lb-sub"></span></div>
        <button class="btn ghost sm" data-a="copy">${icon('copy')} Kopiuj</button>
        <button class="btn ghost sm" data-a="open">${icon('external')} Otwórz</button>
        <button class="btn ghost sm" data-a="reveal">${icon('folder')} Folder</button>
        <button class="btn danger sm icon" data-a="del" title="Usuń">${icon('trash')}</button>
        <button class="btn ghost sm icon" data-close title="Zamknij">${icon('x')}</button></div></div>`, { onClose: () => document.removeEventListener('keydown', onKey) });
    m.el.classList.add('lb-modal');
    const show = async () => {
      const s = list[index];
      $('#lb-name', m.el).textContent = s.name;
      $('#lb-sub', m.el).textContent = `${s.instance} • ${new Date(s.time).toLocaleString('pl-PL')} • ${index + 1}/${list.length}`;
      const img = $('#lb-img', m.el);
      if (s.thumb) img.src = s.thumb;
      img.classList.add('loading');
      $('#lb-spin', m.el).hidden = false;
      const want = index;
      const full = await nore.gallery.full(s.path).catch(() => null);
      if (want !== index) return;
      if (full) img.src = full;
      img.classList.remove('loading');
      $('#lb-spin', m.el).hidden = true;
      $('#lb-prev', m.el).hidden = index === 0;
      $('#lb-next', m.el).hidden = index === list.length - 1;
    };
    const step = (d) => { const n = index + d; if (n < 0 || n >= list.length) return; index = n; show(); };
    const onKey = (e) => { if (e.key === 'ArrowLeft') step(-1); else if (e.key === 'ArrowRight') step(1); else if (e.key === 'Escape') m.close(); };
    document.addEventListener('keydown', onKey);
    $('#lb-prev', m.el).onclick = () => step(-1);
    $('#lb-next', m.el).onclick = () => step(1);
    const act = (a, fn) => { $(`[data-a="${a}"]`, m.el).onclick = () => fn(list[index]).catch(e => errorToast(e, 'Galeria')); };
    act('copy', async s => { await nore.gallery.copy(s.path); toast('Skopiowano obraz', 'Wklej go np. na Discordzie.', 'success', 2200); });
    act('open', s => nore.gallery.open(s.path));
    act('reveal', s => nore.gallery.reveal(s.path));
    act('del', async s => {
      if (!await confirmModal('Usunąć zrzut?', s.name, { ok: 'Usuń', danger: true })) return;
      await nore.gallery.remove(s.path);
      shots = shots.filter(x => x.path !== s.path);
      list.splice(index, 1);
      render();
      if (!list.length) return m.close();
      index = Math.min(index, list.length - 1);
      show();
    });
    show();
  };

  const load = () => nore.gallery.list().then(l => { shots = l; render(); }).catch(e => errorToast(e, 'Galeria'));
  $('#ga-refresh', root).onclick = load;
  load();
};

// ================================================================== shop (coming soon)

const SHOP_ITEMS = [
  { name: 'Skrzydła Feniksa', kind: 'Skrzydła', cls: 'wings', c1: '#ffb547', c2: '#ff3d1a' },
  { name: 'Aureola Nova', kind: 'Aureola', cls: 'halo', c1: '#c9a4ff', c2: '#7fe3ff' },
  { name: 'Smocze skrzydła', kind: 'Skrzydła', cls: 'wings', c1: '#8af0c0', c2: '#0e7a52' },
  { name: 'Ognisty ślad', kind: 'Efekt', cls: 'trail', c1: '#ffe08a', c2: '#ff6b2c' },
];

Pages.shop = (root) => {
  root.innerHTML = `
    <div class="shop-hero card stagger">
      <div class="shop-glow"></div>
      <div style="--i:0"><span class="tag accent">${icon('clock')} WKRÓTCE</span>
        <h1>Sklep <span>Nore</span></h1>
        <p class="lead">Skrzydła, aureole, efekty i ekskluzywne peleryny – widoczne dla wszystkich graczy Nore Client.
          Sklep ruszy w jednej z kolejnych aktualizacji.</p></div>
      <div class="shop-preview" style="--i:1">${SHOP_ITEMS.map((it, i) => `<div class="shop-item" style="--c1:${it.c1};--c2:${it.c2};--d:${i * 0.4}s">
        <div class="shop-art ${it.cls}"><i></i><i></i></div><b>${esc(it.name)}</b><small>${esc(it.kind)}</small><span class="lock">${icon('key')}</span></div>`).join('')}</div>
    </div>
    <div class="card shop-free stagger">
      <div style="--i:0"><div class="section-title">${icon('sparkles')} Za darmo już teraz: kolekcja „Historia Nore”</div>
        <p class="muted">Trzy peleryny upamiętniające aktualizacje, które zbudowały projekt: <b>Genesis</b> (1.0), <b>Kuźnia 2.1</b> i <b>Nova 1.4</b>.
          Załóż je w grze: menu główne → kafelek <b>Kosmetyki</b>. Widać je w widoku F5 i na elytrze.</p></div>
      <img src="assets/capes-historia.png" alt="Peleryny Historia Nore" style="--i:1">
    </div>`;
  stagger(root);
};

// ================================================================== sidebar collapse

(function sidebarToggle() {
  const KEY = 'nore.sidebarCollapsed';
  const apply = (on) => {
    document.body.classList.toggle('sb-collapsed', on);
    setTimeout(() => window.dispatchEvent(new Event('resize')), 320);
  };
  let collapsed = false;
  try { collapsed = localStorage.getItem(KEY) === '1'; } catch { /* storage unavailable */ }
  apply(collapsed);
  const btn = document.getElementById('sb-toggle');
  if (btn) btn.onclick = () => {
    collapsed = !collapsed;
    try { localStorage.setItem(KEY, collapsed ? '1' : '0'); } catch { /* storage unavailable */ }
    apply(collapsed);
  };
})();
