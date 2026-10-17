'use strict';
/*
 * Instances 2.0: banners (own image, modpack gallery or colour), real modpack icons, loader tags,
 * search / filters / sorting, pinned instances, quick stats and a context menu.
 */

// App (app.js) loads after this file: App.media / App.stats are filled at boot and on the page
async function loadInstanceMedia() {
  try { App.media = await nore.instances.media(); } catch { App.media = {}; }
}
async function loadInstanceStats() {
  try { App.stats = await nore.instances.stats(); } catch { App.stats = {}; }
}

const LOADER_COLORS = { vanilla: '#7fd17f', fabric: '#e6c48f', quilt: '#c58cff', forge: '#ff8a5c', neoforge: '#ffa43c' };

// replaces the helper from ui.js: custom icon > modpack icon > Nore logo > first letter
function instIcon(inst, size = 42) {
  const [a, b] = INSTANCE_COLORS[inst.color % INSTANCE_COLORS.length] || INSTANCE_COLORS[0];
  const media = App.media && App.media[inst.id];
  const src = (media && media.icon) || inst.iconUrl;
  const inner = src ? `<img class="cover" src="${esc(src)}" data-fallback alt="">`
    : inst.noreClient ? '<img src="assets/logo.png" alt="">' : `<span>${esc((inst.name || '?').charAt(0).toUpperCase())}</span>`;
  return `<div class="inst-icon ${src ? 'has-img' : ''}" style="width:${size}px;height:${size}px;background:linear-gradient(135deg,${a},${b});box-shadow:0 0 18px ${a}55">${inner}</div>`;
}

function instBanner(inst) {
  const [a, b] = INSTANCE_COLORS[inst.color % INSTANCE_COLORS.length] || INSTANCE_COLORS[0];
  const media = App.media && App.media[inst.id];
  const img = (media && media.banner) || inst.bannerUrl;
  const grad = `linear-gradient(135deg, ${a}77, ${b}33 55%, #120c1a)`;
  return img ? `url("${esc(img)}") center/cover no-repeat, ${grad}` : grad;
}

function loaderTag(l) {
  const c = LOADER_COLORS[l] || LOADER_COLORS.vanilla;
  return `<span class="ltag" style="--lc:${c}"><i></i>${loaderName(l)}</span>`;
}

/** True when the background check found a new modpack version or mod / pack / shader updates. */
function hasContentUpdates(u) {
  return !!(u && (u.pack || u.mods || u.resourcepacks || u.shaders));
}

/** "3 mody, 1 shader" – individual content updates of an instance. */
function contentUpdatesText(u) {
  if (!u) return '';
  return [[u.mods, 'mod', 'mody', 'modów'], [u.resourcepacks, 'paczka zasobów', 'paczki zasobów', 'paczek zasobów'], [u.shaders, 'shader', 'shadery', 'shaderów']]
    .filter(([n]) => n).map(([n, a, b, c]) => `${n} ${plural(n, a, b, c)}`).join(', ');
}

/** Updates mods / resource packs / shaders of an instance (files of its modpack are left to the modpack). */
async function updateInstanceContent(inst) {
  let total = 0;
  for (const kind of ['mod', 'resourcepack', 'shader']) {
    const ups = await nore.content.updates({ instanceId: inst.id, kind, skipPack: inst.modpack === 'pack' });
    if (!ups.length) continue;
    total += await nore.content.applyUpdates({ instanceId: inst.id, kind, updates: ups });
  }
  // main re-checks the instance in the background; hide the counts right away
  const u = App.contentUpdates[inst.id];
  if (u) { App.contentUpdates = { ...App.contentUpdates, [inst.id]: { ...u, mods: 0, resourcepacks: 0, shaders: 0 } }; App.emit(); }
  toast(total ? 'Zaktualizowano' : 'Wszystko aktualne', total ? `${inst.name}: ${total} ${plural(total, 'plik', 'pliki', 'plików')} (stare w .nore-backup)` : inst.name, 'success');
  return total;
}

/** Short description under the instance name. */
function instSubtitle(i) {
  if (i.modpack === 'pack' && i.pack) return `Modpack • ${i.pack.title || i.name}${i.pack.version ? ' ' + i.pack.version : ''}`;
  if (i.noreClient) return i.modpack === 'pack' ? 'Modpack + Nore Client' : 'Nore Client – klient PvP';
  if (i.loader === 'vanilla') return 'Czysty Minecraft';
  if (i.perfPack) return `${loaderName(i.loader)} + Pakiet Nore`;
  return `${loaderName(i.loader)} – własne mody`;
}

// replaces the helper from pages.js
function instanceTags(inst) {
  const extra = inst.noreClient ? '<span class="ltag nore"><i></i>Nore Client</span>' : '';
  const pack = inst.modpack === 'pack' ? '<span class="ltag pack"><i></i>Modpack</span>' : '';
  return `<span class="ltag ver">${esc(inst.mcVersion)}</span>${inst.loader && inst.loader !== 'vanilla' ? loaderTag(inst.loader) : loaderTag('vanilla')}${pack}${extra}`;
}

/** Small popover menu next to an element. items: [{label, icon, danger, action}] or '-' */
function popMenu(anchor, items) {
  $$('.pop-menu').forEach(m => m.remove());
  const r = anchor.getBoundingClientRect();
  const m = el(`<div class="pop-menu">${items.map((it, k) => it === '-' ? '<hr>' : `<button data-k="${k}" class="${it.danger ? 'danger' : ''}">${icon(it.icon)}<span>${esc(it.label)}</span></button>`).join('')}</div>`);
  document.body.appendChild(m);
  const mw = m.offsetWidth, mh = m.offsetHeight;
  m.style.left = Math.min(window.innerWidth - mw - 10, r.right - mw) + 'px';
  m.style.top = (r.bottom + mh + 8 > window.innerHeight ? r.top - mh - 6 : r.bottom + 6) + 'px';
  const close = () => { m.classList.add('out'); setTimeout(() => m.remove(), 150); document.removeEventListener('mousedown', outside, true); };
  const outside = (e) => { if (!m.contains(e.target)) close(); };
  setTimeout(() => document.addEventListener('mousedown', outside, true), 0);
  $$('button', m).forEach(b => b.onclick = () => { close(); items[+b.dataset.k].action(); });
}

const instView = { q: '', filter: 'all', sort: 'recent', view: 'grid' };
try { Object.assign(instView, JSON.parse(localStorage.getItem('nore.instView') || '{}'), { q: '' }); } catch { /* ignore */ }

Pages.instances = (root) => {
  let alive = true;
  const FILTERS = [['all', 'Wszystkie'], ['pinned', 'Przypięte'], ['nore', 'Nore Client'], ['pack', 'Modpacki'], ['fabric', 'Fabric'], ['quilt', 'Quilt'], ['forge', 'Forge'], ['neoforge', 'NeoForge'], ['vanilla', 'Vanilla']];
  const SORTS = [['recent', 'Ostatnio grane'], ['name', 'Nazwa'], ['time', 'Czas gry'], ['created', 'Najnowsze'], ['version', 'Wersja']];
  const save = () => { try { localStorage.setItem('nore.instView', JSON.stringify(instView)); } catch { /* ignore */ } };

  root.innerHTML = `<div class="page-head"><div><h2>${icon('layers')} Instancje</h2><p id="isub"></p></div>
      <div class="actions"><button class="btn ghost" id="imp">${icon('upload')} Importuj .mrpack</button><button class="btn ghost" id="packs">${icon('box')} Modpacki</button><button class="btn" id="new">${icon('plus')} Nowa instancja</button></div></div>
    <div class="br-top card inst-toolbar">
      <div class="search">${icon('search')}<input id="iq" placeholder="Szukaj instancji…" value=""></div>
      <select class="input" id="isort">${SORTS.map(([v, l]) => `<option value="${v}" ${v === instView.sort ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <div class="seg-icons" id="iview"><button data-v="grid" title="Kafelki">${icon('layers')}</button><button data-v="list" title="Lista">${icon('list')}</button></div>
    </div>
    <div class="chips inst-filters" id="ifil"></div>
    <div id="ibody"></div>`;
  $('#new', root).onclick = () => createInstanceModal();
  $('#packs', root).onclick = () => go('modpacks');
  $('#imp', root).onclick = () => installModpackFlow({ file: true, title: 'Import modpacka' });
  $('#iq', root).oninput = (e) => { instView.q = e.target.value.toLowerCase(); render(); };
  $('#isort', root).onchange = (e) => { instView.sort = e.target.value; save(); render(); };
  const paintView = () => $$('#iview button', root).forEach(b => b.classList.toggle('on', b.dataset.v === instView.view));
  $$('#iview button', root).forEach(b => b.onclick = () => { instView.view = b.dataset.v; save(); paintView(); render(); });
  paintView();

  const kindOf = (i) => [i.noreClient ? 'nore' : null, i.modpack === 'pack' ? 'pack' : null, i.loader || 'vanilla', i.pinned ? 'pinned' : null].filter(Boolean);

  function render() {
    if (!alive) return;
    const s = App.state;
    const all = s.instances;
    const total = all.reduce((a, i) => a + (i.playTime || 0), 0);
    $('#isub', root).textContent = `${all.length} ${all.length === 1 ? 'instancja' : all.length < 5 ? 'instancje' : 'instancji'} • łącznie ${fmtDuration(total)} gry • każda ma własne mody, światy i ustawienia`;
    $('#ifil', root).innerHTML = FILTERS.map(([v, l]) => {
      const n = v === 'all' ? all.length : all.filter(i => kindOf(i).includes(v)).length;
      if (!n && v !== 'all' && v !== instView.filter) return '';
      return `<button class="lchip ${v === instView.filter ? 'on' : ''}" data-v="${v}">${l} <small>${n}</small></button>`;
    }).join('');
    $$('#ifil .lchip', root).forEach(b => b.onclick = () => { instView.filter = b.dataset.v; save(); render(); });

    let list = all.filter(i => (instView.filter === 'all' || kindOf(i).includes(instView.filter))
      && (!instView.q || `${i.name} ${i.mcVersion} ${loaderName(i.loader)} ${i.pack ? i.pack.title : ''}`.toLowerCase().includes(instView.q)));
    const cmp = {
      recent: (a, b) => (b.lastPlayed || 0) - (a.lastPlayed || 0) || b.created - a.created,
      name: (a, b) => a.name.localeCompare(b.name, 'pl'),
      time: (a, b) => (b.playTime || 0) - (a.playTime || 0),
      created: (a, b) => b.created - a.created,
      version: (a, b) => b.mcVersion.localeCompare(a.mcVersion, undefined, { numeric: true }),
    }[instView.sort];
    list = list.sort(cmp);
    const pinned = list.filter(i => i.pinned), rest = list.filter(i => !i.pinned);
    const body = $('#ibody', root);
    if (!list.length) {
      body.innerHTML = `<div class="empty">${icon('layers')}<div>${all.length ? 'Brak instancji pasujących do filtrów.' : 'Nie masz jeszcze instancji.'}</div>
        <button class="btn sm" style="margin-top:14px" id="mk">${icon('plus')} Nowa instancja</button></div>`;
      $('#mk', body).onclick = () => createInstanceModal();
      return;
    }
    const section = (title, items, withNew) => `<div class="isec">${title ? `<div class="isec-title">${title}<span>${items.length}</span></div>` : ''}
      <div class="${instView.view === 'grid' ? 'igrid' : 'ilist2'}">${items.map(card).join('')}${withNew && instView.view === 'grid' ? newCard() : ''}</div></div>`;
    body.innerHTML = (pinned.length ? section(`${icon('sparkles')} Przypięte`, pinned, false) : '')
      + section(pinned.length ? 'Pozostałe' : '', rest, true);
    $$('.igrid, .ilist2', body).forEach(stagger);
    bind(body);
  }

  const newCard = () => `<div class="icard new" id="new2"><div class="plus">${icon('plus')}</div><b>Nowa instancja</b><span>Dowolna wersja • Vanilla, Fabric, Quilt, Forge, NeoForge</span></div>`;

  function card(i) {
    const st = App.stats[i.id] || {};
    const running = App.running === i.id;
    const selected = i.id === App.state.selectedInstance;
    const upd = hasContentUpdates(App.contentUpdates[i.id]);
    const stats = [['puzzle', st.mods, 'modów'], ['image', st.resourcepacks, 'paczek'], ['globe', st.worlds, 'światów'], ['monitor', st.screenshots, 'zrzutów']]
      .filter(([, n]) => n).map(([ic, n, l]) => `<span title="${n} ${l}">${icon(ic)}${n}</span>`).join('');
    if (instView.view === 'list') {
      return `<div class="irow2 ${selected ? 'selected' : ''} ${running ? 'running' : ''}" data-id="${i.id}">
        ${instIcon(i, 46)}
        <div class="iname2"><b>${esc(i.name)}${i.pinned ? ` <span class="pin-on">${icon('sparkles')}</span>` : ''}${upd ? ' <span class="tag upd">AKTUALIZACJA</span>' : ''}</b><span>${instMotd(i)}</span></div>
        <div class="itags">${instanceTags(i)}</div>
        <div class="istats">${stats}</div>
        <div class="itime"><b>${fmtDuration(i.playTime || 0)}</b><span>${fmtAgo(i.lastPlayed)}</span></div>
        <button class="btn sm ${running ? 'danger' : ''}" data-act="play">${running ? icon('stop') + ' Stop' : icon('play') + ' Graj'}</button>
        <button class="btn ghost sm icon" data-act="more">${icon('list')}</button></div>`;
    }
    return `<div class="icard ${selected ? 'selected' : ''} ${running ? 'running' : ''}" data-id="${i.id}">
      <div class="ibanner" style="background:${instBanner(i)}"></div>
      <div class="ibadges">${upd ? `<span class="tag upd" title="${esc(App.contentUpdates[i.id].pack ? 'Nowa wersja modpacka' : contentUpdatesText(App.contentUpdates[i.id]))}">${icon('download')} AKTUALIZACJA</span>` : ''}${running ? '<span class="tag premium running-dot">● W GRZE</span>' : ''}${selected ? '<span class="tag accent">WYBRANA</span>' : ''}</div>
      <button class="ipin ${i.pinned ? 'on' : ''}" data-act="pin" title="${i.pinned ? 'Odepnij' : 'Przypnij'}">${icon('sparkles')}</button>
      <div class="ihead">${instIcon(i, 58)}<div class="ititle"><h3>${esc(i.name)}</h3><span>${instMotd(i)}</span></div></div>
      <div class="itags">${instanceTags(i)}</div>
      <div class="istats">${stats || '<span class="muted">Brak modów i światów</span>'}</div>
      <div class="ifoot">
        <div class="itime">${icon('clock')}<b>${fmtDuration(i.playTime || 0)}</b><span>• ${fmtAgo(i.lastPlayed)}</span></div>
        <button class="btn ghost sm icon" data-act="more" title="Więcej">${icon('list')}</button>
        <button class="btn sm ${running ? 'danger' : ''}" data-act="play">${running ? icon('stop') + ' Stop' : icon('play') + ' Graj'}</button>
      </div></div>`;
  }

  function bind(body) {
    if ($('#new2', body)) $('#new2', body).onclick = () => createInstanceModal();
    $$('[data-id]', body).forEach(c => {
      const id = c.dataset.id;
      const inst = App.state.instances.find(x => x.id === id);
      const menu = (anchor) => popMenu(anchor, [
        { label: 'Otwórz szczegóły', icon: 'info', action: () => go('instance', { id }) },
        { label: 'Ustaw jako wybraną', icon: 'check', action: async () => { await nore.instances.select(id); await App.refresh(); } },
        { label: inst.pinned ? 'Odepnij' : 'Przypnij na górze', icon: 'sparkles', action: () => togglePin(inst) },
        '-',
        { label: 'Mody', icon: 'puzzle', action: () => go('instance', { id, tab: 'mods' }) },
        { label: 'Światy', icon: 'globe', action: () => go('instance', { id, tab: 'worlds' }) },
        { label: 'Folder instancji', icon: 'folder', action: () => nore.instances.folder(id) },
        { label: 'Duplikuj', icon: 'copy', action: async () => { const cp = await nore.instances.duplicate(id); await reload(); toast('Zduplikowano', cp.name, 'success'); } },
        { label: 'Zmień ikonę', icon: 'image', action: () => pickMedia(inst, 'icon') },
        { label: 'Zmień tło karty', icon: 'image', action: () => pickMedia(inst, 'banner') },
        '-',
        { label: 'Usuń instancję', icon: 'trash', danger: true, action: () => removeInst(inst) },
      ]);
      c.onclick = async (e) => {
        const act = e.target.closest('[data-act]');
        if (!act) return go('instance', { id });
        e.stopPropagation();
        if (act.dataset.act === 'play') {
          if (App.running === id) return nore.game.kill();
          await nore.instances.select(id); await App.refresh(); launchSelected(inst); go('home');
        }
        if (act.dataset.act === 'more') menu(act);
        if (act.dataset.act === 'pin') togglePin(inst);
      };
      c.oncontextmenu = (e) => { e.preventDefault(); menu($('[data-act="more"]', c) || c); };
    });
  }

  async function togglePin(inst) {
    await nore.instances.update(inst.id, { pinned: !inst.pinned });
    await App.refresh();
  }
  async function removeInst(inst) {
    if (await confirmModal('Usunąć instancję?', `„${inst.name}” zostanie usunięta razem z jej światami i modami.`, { ok: 'Usuń', danger: true })) {
      await nore.instances.remove(inst.id, true);
      await App.refresh();
      toast('Usunięto instancję', inst.name, 'success');
    }
  }
  async function reload() { await Promise.all([loadInstanceStats(), App.refresh()]); }

  render();
  Promise.all([loadInstanceMedia(), loadInstanceStats()]).then(render);
  const off = App.onChange(() => { if (!$('.modal-backdrop')) render(); });
  return () => { alive = false; off(); };
};

async function pickMedia(inst, kind, clear) {
  try {
    const data = await nore.instances.setMedia(inst.id, kind, !!clear);
    if (data === undefined) return;
    App.media[inst.id] = { ...(App.media[inst.id] || {}), [kind]: data };
    App.emit();
    toast(clear ? 'Przywrócono domyślne' : kind === 'icon' ? 'Zmieniono ikonę' : 'Zmieniono tło karty', inst.name, 'success');
  } catch (e) { errorToast(e); }
}

// instance page: banner in the hero + appearance options in the overview
const _instancePage = Pages.instance;
Pages.instance = (root, opts) => {
  const cleanup = _instancePage(root, opts);
  const id = opts.id;
  const decorate = () => {
    const inst = App.state.instances.find(i => i.id === id);
    const hero = $('.inst-hero', root);
    if (!inst || !hero) return;
    if (!hero.querySelector('.hero-banner')) {
      hero.prepend(el('<div class="hero-banner"></div>'));
      const title = hero.querySelector('h2');
      if (title && !hero.querySelector('.hero-sub')) title.after(el(`<div class="hero-sub">${esc(instSubtitle(inst))}</div>`));
    }
    hero.querySelector('.hero-banner').style.background = instBanner(inst);
    const ic = hero.querySelector('.inst-icon');
    if (ic) ic.outerHTML = instIcon(inst, 72);
    const look = $('#colors', root) && $('#colors', root).closest('.card');
    if (look && !$('#imedia', look)) {
      const box = el(`<div id="imedia">
        <div class="setting"><div class="col"><b>Ikona</b><span>Własny obrazek zamiast koloru</span></div><div class="row"><button class="btn ghost sm" data-k="icon">${icon('upload')} Wybierz</button><button class="btn ghost sm icon" data-c="icon" title="Domyślna">${icon('x')}</button></div></div>
        <div class="setting"><div class="col"><b>Tło karty</b><span>Obrazek w nagłówku i na liście instancji</span></div><div class="row"><button class="btn ghost sm" data-k="banner">${icon('upload')} Wybierz</button><button class="btn ghost sm icon" data-c="banner" title="Domyślne">${icon('x')}</button></div></div>
        <div class="setting"><div class="col"><b>Przypięta</b><span>Pokazuj na górze listy instancji</span></div><label class="switch"><input type="checkbox" id="ipinned" ${inst.pinned ? 'checked' : ''}><i></i></label></div>
        <div class="field"><label>Notatki</label><textarea class="input" id="inotes" rows="3" placeholder="np. serwer, na którym grasz, ważne koordynaty…">${esc(inst.notes || '')}</textarea></div></div>`);
      look.appendChild(box);
      $$('[data-k]', box).forEach(b => b.onclick = async () => { await pickMedia(inst, b.dataset.k); decorate(); });
      $$('[data-c]', box).forEach(b => b.onclick = async () => { await pickMedia(inst, b.dataset.c, true); decorate(); });
      $('#ipinned', box).onchange = async (e) => { await nore.instances.update(inst.id, { pinned: e.target.checked }); await App.refresh(); };
      $('#inotes', box).onchange = async (e) => { await nore.instances.update(inst.id, { notes: e.target.value.slice(0, 2000) }); };
    }
    if (inst.modpack === 'pack' && inst.pack && $('#tabc .grid', root) && !$('#packinfo', root)) {
      const pi = el(`<div class="card panel pack-info" id="packinfo">
        <div class="section-title">${icon('box')} Modpack</div>
        <div class="row" style="gap:14px;margin-top:10px">${inst.iconUrl ? `<img src="${esc(inst.iconUrl)}" data-fallback alt="" class="pack-ico">` : ''}
          <div style="flex:1;min-width:0"><b>${esc(inst.pack.title || inst.name)}</b><div class="muted" style="font-size:12.5px" id="pver"></div></div>
          ${inst.pack.projectId ? `<button class="btn ghost sm" id="pweb">${icon('external')} Strona paczki</button>` : ''}</div>
        <div class="pack-upd" id="pupd"></div></div>`);
      $('#tabc .grid', root).prepend(pi);
      if ($('#pweb', pi)) $('#pweb', pi).onclick = () => go('modpacks', { project: inst.pack.projectId });
    }
    renderPackUpdate();
  };

  // modpack version + update row inside the pack card
  let checkingPack = false;
  const renderPackUpdate = () => {
    const inst = App.state.instances.find(i => i.id === id);
    const box = $('#pupd', root);
    if (!inst || !inst.pack || !box) return;
    const up = (App.contentUpdates[id] || {}).pack || null;
    const sig = JSON.stringify([inst.pack.versionId, inst.mcVersion, inst.loader, up && up.versionId, checkingPack]);
    if (box.dataset.sig === sig) return;
    box.dataset.sig = sig;
    $('#pver', root).innerHTML = `Wersja ${esc(inst.pack.version || '?')} ${versionTypeTag(inst.pack.type)} • Minecraft ${esc(inst.mcVersion)} • ${loaderName(inst.loader)}${inst.noreClient ? ' • z Nore Client' : ''}`;
    if (!inst.pack.projectId) {
      box.innerHTML = `<div class="muted pu-note">${icon('info')} Paczka zaimportowana z pliku – nie da się sprawdzić jej aktualizacji.</div>`;
      return;
    }
    box.innerHTML = up
      ? `<div class="pu-new"><span class="ic">${icon('sparkles')}</span><div class="t"><b>Nowa wersja ${esc(up.version)} ${versionTypeTag(up.type)}</b>
          <small>${up.mcChanged ? `Minecraft ${esc(inst.mcVersion)} → ${esc(up.mcVersion)} • ` : ''}${fmtAgo(Date.parse(up.date))}</small></div>
          <button class="btn sm" id="pgo">${icon('download')} Aktualizuj modpack</button></div>`
      : `<div class="row" style="gap:8px"><span class="muted pu-note" style="flex:1">${icon('check')} ${checkingPack ? 'Sprawdzanie…' : 'Brak nowszej wersji na wybranym kanale'}</span>
          <button class="btn ghost sm" id="pcheck" ${checkingPack ? 'disabled' : ''}>${checkingPack ? '<span class="spinner"></span>' : icon('refresh')} Sprawdź aktualizacje</button>
          <button class="btn ghost sm" id="pvers">${icon('layers')} Zmień wersję</button></div>`;
    if ($('#pgo', box)) $('#pgo', box).onclick = () => packUpdateModal(inst, up);
    if ($('#pvers', box)) $('#pvers', box).onclick = () => packUpdateModal(inst, null);
    if ($('#pcheck', box)) $('#pcheck', box).onclick = async () => {
      checkingPack = true; renderPackUpdate();
      try {
        const r = await nore.modpacks.checkUpdate(id);
        if (!r) toast('Modpack jest aktualny', inst.pack.title || inst.name, 'success');
      } catch (e) { errorToast(e, 'Sprawdzanie aktualizacji'); }
      checkingPack = false; renderPackUpdate();
    };
  };
  const offUpd = App.onChange(renderPackUpdate);
  if (opts.packUpdate) {
    const inst = App.state.instances.find(i => i.id === id);
    if (inst && inst.pack) setTimeout(() => packUpdateModal(inst, (App.contentUpdates[id] || {}).pack || null), 250);
  }
  const mo = new MutationObserver(() => { mo.disconnect(); decorate(); mo.observe(root, { childList: true, subtree: true }); });
  decorate();
  mo.observe(root, { childList: true, subtree: true });
  if (!Object.keys(App.media).length) loadInstanceMedia().then(decorate);
  return () => { mo.disconnect(); offUpd(); if (cleanup) cleanup(); };
};

// ------------------------------------------------------------------ modpack update modal

/** Version picker + changelog + world backup option, then the update with live progress. */
function packUpdateModal(inst, up) {
  const pack = inst.pack;
  const m = modal(`<div class="pu-modal">
      <div class="mp-head">${projectIcon(inst.iconUrl, pack.title || inst.name, 56)}<div><h3>${up ? 'Aktualizacja modpacka' : 'Wersja modpacka'}</h3>
        <p class="sub">${esc(pack.title || inst.name)} • zainstalowana ${esc(pack.version || '?')} ${versionTypeTag(pack.type)}</p></div></div>
      <div class="pu-form">
        <div class="field"><label>Wersja</label><select class="input" id="pu-ver"><option>Wczytywanie wersji…</option></select></div>
        <div id="pu-warn"></div>
        <div class="field"><label>Lista zmian</label><div class="pu-log" id="pu-log"><span class="muted">Wczytywanie…</span></div></div>
        <label class="pu-check" id="pu-bwrow"><span class="switch"><input type="checkbox" id="pu-bw" checked><i></i></span>
          <span><b>Kopia zapasowa światów</b><small id="pu-bwhint"></small></span></label>
        <div class="pu-safe">${icon('shield')}<span>Światy, zrzuty ekranu, ustawienia gry, zmienione przez Ciebie configi i Twoje własne mody zostaną zachowane.
          Usunięte i zastąpione pliki paczki trafią do folderu <b>.nore-backup</b> w instancji.</span></div>
      </div>
      <div class="pu-run" hidden>
        <div class="mp-steps"><div class="mp-step active" data-s="pack"><span class="dot"></span>Pliki paczki</div><div class="mp-step" data-s="game"><span class="dot"></span>Minecraft i loader</div><div class="mp-step" data-s="done"><span class="dot"></span>Gotowe</div></div>
        <div class="pu-bar"><i id="pu-bar"></i></div>
        <div class="muted pu-stage" id="pu-stage">&nbsp;</div>
        <div class="pu-result" id="pu-result" hidden></div>
      </div>
      <div class="foot"><button class="btn ghost" id="pu-cancel" data-close>Anuluj</button><button class="btn" id="pu-go" disabled>${icon('download')} Aktualizuj</button></div></div>`, { dismissable: false });
  const sel = $('#pu-ver', m.el);
  let list = [];
  const chosen = () => list.find(v => v.id === sel.value);
  const cmpMc = (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true });

  const paint = () => {
    const v = chosen();
    const go = $('#pu-go', m.el);
    if (!v) return;
    go.disabled = v.current;
    go.innerHTML = v.current ? `${icon('check')} Zainstalowana` : `${icon('download')} ${list.indexOf(v) > list.findIndex(x => x.current) && list.some(x => x.current) ? 'Zmień wersję' : 'Aktualizuj'}`;
    const mcChanged = v.mcVersion && v.mcVersion !== inst.mcVersion;
    const older = mcChanged && cmpMc(v.mcVersion, inst.mcVersion) < 0;
    $('#pu-warn', m.el).innerHTML = mcChanged
      ? `<div class="pu-warn ${older ? 'bad' : ''}">${icon('info')}<span>Minecraft zmieni się z <b>${esc(inst.mcVersion)}</b> na <b>${esc(v.mcVersion)}</b> –
          ${older ? 'starsza wersja gry może nie otworzyć światów zapisanych w nowszej.' : 'światy zostaną przekonwertowane przy pierwszym otwarciu.'}
          Kopia zapasowa zostanie zapisana w .nore-backup.</span></div>`
      : '';
    const bw = $('#pu-bw', m.el);
    bw.disabled = !mcChanged;
    $('#pu-bwrow', m.el).classList.toggle('on', !!mcChanged);
    $('#pu-bwhint', m.el).textContent = mcChanged ? 'Kopia folderu saves przed zmianą wersji Minecrafta (zalecane)' : 'Ta wersja nie zmienia Minecrafta – światy nie są modyfikowane';
    const log = (v.changelog || (up && up.versionId === v.id ? up.changelog : '') || '').trim();
    $('#pu-log', m.el).textContent = log || 'Autor nie dodał listy zmian.';
  };

  nore.modpacks.versions(inst.id).then((vers) => {
    list = vers;
    if (!list.length) { sel.innerHTML = '<option>Brak wersji</option>'; $('#pu-log', m.el).textContent = 'Nie udało się wczytać wersji paczki.'; return; }
    sel.innerHTML = list.map(v => `<option value="${esc(v.id)}">${esc(v.number)}${v.type !== 'release' ? ` [${esc(v.type.toUpperCase())}]` : ''} • MC ${esc(v.mcVersion || '?')} • ${new Date(v.date).toLocaleDateString('pl-PL')}${v.current ? ' (zainstalowana)' : ''}</option>`).join('');
    sel.value = (up && list.some(v => v.id === up.versionId) ? up.versionId : (list.find(v => v.current) || list[0]).id);
    paint();
  }).catch((e) => { $('#pu-log', m.el).textContent = 'Nie udało się wczytać wersji: ' + e.message; });
  sel.onchange = paint;

  $('#pu-go', m.el).onclick = async () => {
    const v = chosen();
    if (!v || v.current) return;
    const backupWorlds = $('#pu-bw', m.el).checked;
    $('.pu-form', m.el).hidden = true;
    $('.pu-run', m.el).hidden = false;
    $('#pu-go', m.el).disabled = true;
    $('#pu-cancel', m.el).disabled = true;
    const bar = $('#pu-bar', m.el);
    bar.classList.add('indet');
    const step = (s2) => {
      const order = ['pack', 'game', 'done'];
      $$('.mp-step', m.el).forEach(x => {
        const i = order.indexOf(x.dataset.s), cur = order.indexOf(s2);
        x.className = 'mp-step' + (i < cur ? ' done' : i === cur ? ' active' : '');
      });
    };
    const off = nore.on('modpack:progress', (p) => {
      if (!p) return;
      step(p.phase === 'game' ? 'game' : 'pack');
      const frac = p.total ? (p.totalBytes ? p.bytes / p.totalBytes : p.done / p.total) : null;
      bar.classList.toggle('indet', frac == null);
      bar.style.width = frac == null ? '' : Math.round(frac * 100) + '%';
      $('#pu-stage', m.el).textContent = [p.stage, p.current || (p.total ? `${p.done || 0} / ${p.total}` : '')].filter(Boolean).join(' • ');
    });
    try {
      const r = await nore.modpacks.update({ instanceId: inst.id, versionId: v.id, backupWorlds });
      off();
      await App.refresh();
      step('done');
      bar.classList.remove('indet');
      bar.style.width = '100%';
      $('#pu-stage', m.el).textContent = r.warning ? 'Paczka zaktualizowana – gra pobierze się przy pierwszym uruchomieniu.' : 'Instancja jest gotowa do gry!';
      const res = $('#pu-result', m.el);
      res.hidden = false;
      res.innerHTML = `<div>${icon('check')} <b>${esc(pack.version || '?')} → ${esc(r.instance.pack.version)}</b> ${versionTypeTag(r.instance.pack.type)} • Minecraft ${esc(r.instance.mcVersion)}</div>
        <div class="muted">Nowe pliki: ${r.added} • usunięte: ${r.removed}${r.kept ? ` • zachowane Twoje zmiany: ${r.kept}` : ''}</div>
        ${r.backup ? `<button class="btn ghost sm" id="pu-bk">${icon('folder')} Otwórz kopię zapasową</button>` : ''}`;
      if ($('#pu-bk', res)) $('#pu-bk', res).onclick = () => nore.openFolder(r.backup);
      toast('Zaktualizowano modpack', `${r.instance.name} → ${r.instance.pack.version}`, 'success');
    } catch (e) {
      off();
      errorToast(e, 'Aktualizacja modpacka nie powiodła się');
      $('#pu-stage', m.el).textContent = 'Przywrócono poprzednie pliki – instancja działa jak wcześniej.';
      bar.classList.remove('indet');
      bar.style.width = '0';
    }
    const cancel = $('#pu-cancel', m.el);
    cancel.disabled = false;
    cancel.textContent = 'Zamknij';
    $('#pu-go', m.el).hidden = true;
  };
}
