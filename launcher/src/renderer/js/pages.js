'use strict';
/* Page renderers. Each returns an optional cleanup function. */

const Pages = {};

// ================================================================== shared widgets

function progressHtml() {
  return `<div class="progress-wrap" id="pg"><div class="progress-info"><span id="pg-stage"></span><span id="pg-count"></span></div>
    <div class="progress-bar" id="pg-bar"><i></i></div></div>`;
}

function updateProgress(root) {
  const wrap = $('#pg', root);
  if (!wrap) return;
  const p = App.progress;
  wrap.classList.toggle('show', !!p);
  if (!p) return;
  $('#pg-stage', root).textContent = p.stage + (p.current ? ` — ${p.current}` : '');
  const bar = $('#pg-bar', root);
  if (p.total) {
    bar.classList.remove('indeterminate');
    const frac = p.totalBytes ? Math.min(1, p.bytes / p.totalBytes) : p.done / p.total;
    $('i', bar).style.width = (frac * 100).toFixed(1) + '%';
    $('#pg-count', root).textContent = p.totalBytes ? `${fmtBytes(p.bytes)} / ${fmtBytes(p.totalBytes)}` : `${p.done}/${p.total}`;
  } else {
    bar.classList.add('indeterminate');
    $('#pg-count', root).textContent = '';
  }
}

function instanceTags(inst) {
  const loader = inst.loader && inst.loader !== 'vanilla' ? `<span class="tag accent">${loaderName(inst.loader)}</span>` : '<span class="tag offline">Vanilla</span>';
  const nore = inst.noreClient ? '<span class="tag accent">Nore Client</span>' : inst.modpack === 'pack' ? '<span class="tag accent">Modpack</span>' : inst.perfPack ? '<span class="tag accent">Pakiet Nore</span>' : '';
  return `<span class="tag offline">${esc(inst.mcVersion)}</span>${loader}${nore}`;
}

// ================================================================== HOME

const HOME_NEWS = [
  ['zap', 'Auto Craft i 12 nowych modułów', 'Deski, stół, pochodnie i narzędzia jednym kliknięciem przy ekwipunku. Plus alerty, Inventory HUD, TPS, stoper.'],
  ['server', 'Serwery 2.0', 'Paper, Purpur, Fabric, NeoForge, Forge – pluginy i mody z Modrinth, kopie zapasowe, własna domena.'],
  ['refresh', 'Automatyczne aktualizacje', 'Launcher i Nore Client aktualizują się same. Mody w instancjach – jednym kliknięciem.'],
  ['sparkles', 'Nowy wygląd', 'Nowe menu w grze, ekran ładowania Nore i ekrany Minecrafta w stylu klienta. Discord RPC.'],
];

Pages.home = (root) => {
  const s = App.state;
  root.innerHTML = `
    <div class="hero stagger">
      <div class="col" style="gap:20px;min-width:0">
      <div class="card hero-main" style="--i:0">
        <img class="hero-logo" src="assets/logo.png" alt="">
        <div class="eyebrow">NORE CLIENT 2.1 • NORE LAUNCHER ${esc(App.info.version)}</div>
        <h1>Graj <span>lepiej</span>.<br>Wyglądaj lepiej.</h1>
        <p class="lead">Własny klient PvP z edytorem HUD, zoomem, freelookiem i dziesiątkami nakładek —
          plus mody, paczki zasobów, shadery i datapacki jednym kliknięciem.</p>
        <div class="launch-row">
          <div class="instance-picker" id="pick"></div>
          <button class="btn play" id="play"></button>
        </div>
        ${progressHtml()}
      </div>
      <div class="quick stagger" style="margin-top:0">
      <div class="card hover" data-go="mods" style="--i:3"><div class="ico">${icon('puzzle')}</div><div><b>Mody</b><span>Fabric • Modrinth</span></div></div>
      <div class="card hover" data-go="resourcepacks" style="--i:4"><div class="ico">${icon('image')}</div><div><b>Paczki zasobów</b><span>Tekstury i dźwięki</span></div></div>
      <div class="card hover" data-go="shaders" style="--i:5"><div class="ico">${icon('sun')}</div><div><b>Shadery</b><span>Iris / OptiFine</span></div></div>
      <div class="card hover" data-go="datapacks" style="--i:6"><div class="ico">${icon('database')}</div><div><b>Datapacki</b><span>Do Twoich światów</span></div></div>
      <div class="card hover" data-go="servers" style="--i:7"><div class="ico">${icon('server')}</div><div><b>Serwery</b><span>Pluginy, mody, domena</span></div></div>
      <div class="card hover" data-go="instances" style="--i:8"><div class="ico">${icon('layers')}</div><div><b>Instancje</b><span>Wersje i mody</span></div></div>
      </div>
      </div>
      <div class="col" style="gap:20px">
        <div class="stat-list" style="--i:1">
          <div class="card stat"><b id="st-play">–</b><span>Czas gry (instancja)</span></div>
          <div class="card stat"><b id="st-last">–</b><span>Ostatnio grane</span></div>
        </div>
        <div class="card news" style="--i:2">
          <div class="section-title">${icon('sparkles')} Co nowego</div>
          ${HOME_NEWS.map(n => `<div class="news-item"><div class="ico">${icon(n[0])}</div><div><b>${n[1]}</b><p>${n[2]}</p></div></div>`).join('')}
        </div>
        <div class="card home-servers" id="hsrv" style="--i:3"></div>
      </div>
    </div>
`;
  nore.servers.list().then(list => {
    const box = $('#hsrv', root);
    if (!box) return;
    const on = list.filter(x => x.state === 'running');
    box.innerHTML = `<div class="row"><div class="section-title" style="flex:1">${icon('server')} Twoje serwery</div><button class="btn ghost sm" data-go2="servers">${list.length ? 'Zarządzaj' : 'Utwórz'} ${icon('arrowRight')}</button></div>
      ${list.length ? list.slice(0, 3).map(x => `<div class="hs-row" data-id="${esc(x.id)}"><i class="dot ${x.state}"></i><b>${esc(x.name)}</b><span>${esc(x.mcVersion)} • ${x.state === 'running' ? x.players.length + ' graczy' : 'wyłączony'}</span></div>`).join('')
        : '<div class="muted" style="font-size:12.5px;margin-top:8px">Postaw własny serwer Paper, Fabric albo NeoForge z pluginami i domeną.</div>'}
      ${on.length ? `<div class="muted" style="font-size:12px;margin-top:6px">${on.length} online</div>` : ''}`;
    $$('[data-go2]', box).forEach(b => b.onclick = () => go(b.dataset.go2));
    $$('.hs-row', box).forEach(r => r.onclick = () => go('server', { id: r.dataset.id }));
  }).catch(() => {});
  $$('[data-go]', root).forEach(c => c.onclick = () => go(c.dataset.go));
  $('#pick', root).onclick = () => instancePickerModal();

  const render = () => {
    const inst = App.instance();
    $('#pick', root).innerHTML = inst
      ? `${instIcon(inst)}<div class="meta"><b>${esc(inst.name)}</b><span>${esc(inst.mcVersion)} • ${loaderName(inst.loader)}</span></div><span class="spacer"></span>${icon('arrowRight', 'dim')}`
      : `<div class="meta"><b>Brak instancji</b><span>Kliknij, aby utworzyć</span></div>`;
    const play = $('#play', root);
    const running = App.running && inst && App.running === inst.id;
    play.classList.toggle('running', !!running);
    play.disabled = !!App.progress || (!!App.running && !running);
    play.innerHTML = App.progress ? '<span class="spinner"></span> PRZYGOTOWANIE' : running ? `${icon('stop')} ZATRZYMAJ` : `${icon('play')} GRAJ`;
    $('#st-play', root).textContent = inst ? fmtDuration(inst.playTime || 0) : '–';
    $('#st-last', root).textContent = inst ? fmtAgo(inst.lastPlayed) : '–';
    updateProgress(root);
  };
  $('#play', root).onclick = () => {
    const inst = App.instance();
    if (App.running && inst && App.running === inst.id) return nore.game.kill();
    launchSelected();
  };
  render();
  return App.onChange(render);
};

function instancePickerModal() {
  const s = App.state;
  const m = modal(`<h3>Wybierz instancję</h3><p class="sub">Którą wersję chcesz uruchomić?</p>
    <div class="col" id="list" style="gap:8px"></div>
    <div class="foot"><button class="btn ghost" id="new">${icon('plus')} Nowa instancja</button><button class="btn ghost" data-close>Zamknij</button></div>`);
  const list = $('#list', m.el);
  list.innerHTML = s.instances.map(i => `<div class="card hover instance-picker ${i.id === s.selectedInstance ? 'selected' : ''}" data-id="${i.id}">
    ${instIcon(i)}<div class="meta"><b>${esc(i.name)}</b><span>${esc(i.mcVersion)} • ${loaderName(i.loader)}</span></div></div>`).join('');
  stagger(list);
  $$('[data-id]', list).forEach(c => c.onclick = async () => { await nore.instances.select(c.dataset.id); await App.refresh(); m.close(); });
  $('#new', m.el).onclick = () => { m.close(); createInstanceModal(); };
}

// ================================================================== INSTANCES

Pages.instances = (root) => {
  const render = () => {
    const s = App.state;
    root.innerHTML = `<div class="page-head"><div><h2>Instancje</h2><p>Każda instancja ma własne mody, światy i ustawienia.</p></div>
      <div class="actions"><button class="btn" id="new">${icon('plus')} Nowa instancja</button></div></div>
      <div class="grid cols-3" id="grid"></div>`;
    const grid = $('#grid', root);
    grid.innerHTML = s.instances.map(i => {
      const [a, b] = INSTANCE_COLORS[i.color % INSTANCE_COLORS.length];
      return `<div class="card hover inst-card ${i.id === s.selectedInstance ? 'selected' : ''}" data-id="${i.id}">
        ${App.running === i.id ? '<span class="tag premium running-dot">● W GRZE</span>' : ''}
        <div class="banner" style="background:radial-gradient(circle at 80% 0%, ${a}aa, transparent 60%), linear-gradient(135deg, ${b}55, #1a1410)">${instIcon(i, 52)}</div>
        <h3>${esc(i.name)}</h3>
        <div class="info">${instanceTags(i)}</div>
        <div class="muted" style="font-size:12px;margin-top:10px">${icon('clock')} ${fmtDuration(i.playTime || 0)} • ${fmtAgo(i.lastPlayed)}</div>
        <div class="foot">
          <button class="btn sm" data-act="play">${icon('play')} Graj</button>
          <span class="spacer"></span>
          <button class="btn ghost sm icon" data-act="folder" title="Folder">${icon('folder')}</button>
          <button class="btn ghost sm icon" data-act="edit" title="Edytuj">${icon('edit')}</button>
          <button class="btn danger sm icon" data-act="delete" title="Usuń">${icon('trash')}</button>
        </div></div>`;
    }).join('') + `<div class="card hover new-card" id="new2"><div style="text-align:center"><div class="plus">${icon('plus')}</div><b>Nowa instancja</b><div class="muted" style="font-size:12px;margin-top:4px">Dowolna wersja • Vanilla lub Fabric</div></div></div>`;
    stagger(grid);
    $('#new', root).onclick = $('#new2', root).onclick = () => createInstanceModal();
    $$('.inst-card', grid).forEach(card => {
      const id = card.dataset.id;
      const inst = s.instances.find(x => x.id === id);
      card.onclick = async (e) => {
        const act = e.target.closest('[data-act]');
        if (!act) { await nore.instances.select(id); await App.refresh(); return go('instance', { id }); }
        e.stopPropagation();
        if (act.dataset.act === 'play') { await nore.instances.select(id); await App.refresh(); launchSelected(inst); go('home'); }
        if (act.dataset.act === 'folder') nore.instances.folder(id);
        if (act.dataset.act === 'edit') go('instance', { id, tab: 'overview' });
        if (act.dataset.act === 'delete') {
          if (await confirmModal('Usunąć instancję?', `„${inst.name}” zostanie usunięta razem z jej światami i modami.`, { ok: 'Usuń', danger: true })) {
            await nore.instances.remove(id, true);
            await App.refresh();
            toast('Usunięto instancję', inst.name, 'success');
          }
        }
      };
    });
  };
  render();
  return App.onChange(() => { if (!$('.modal-backdrop')) render(); });
};

async function createInstanceModal() {
  const m = modal(`<h3>Nowa instancja</h3><p class="sub">Wybierz wersję Minecraft i loader.</p>
    <div class="field"><label>Nazwa</label><input class="input" id="name" placeholder="Moja instancja" maxlength="40"></div>
    <div class="field"><label>Loader</label><div id="loader"></div></div>
    <div class="field"><div class="row"><label style="flex:1">Wersja Minecraft</label>
      <label class="row muted" style="font-size:12px;gap:8px">Snapshoty <span class="switch"><input type="checkbox" id="snap"><i></i></span></label></div>
      <div class="search" style="height:38px"><span>${icon('search')}</span><input id="vf" placeholder="Filtruj wersje…"></div>
      <div class="version-list" id="versions"><div class="skeleton" style="grid-column:1/-1;height:120px"></div></div></div>
    <div class="field" id="nore-field"><label class="row" style="gap:10px"><span class="switch"><input type="checkbox" id="nore" checked><i></i></span> Zainstaluj Nore Client (tylko Fabric 1.21.1)</label></div>
    <div class="field"><label>Kolor</label><div class="color-row" id="colors"></div></div>
    <div class="foot"><button class="btn ghost" data-close>Anuluj</button><button class="btn" id="create">${icon('plus')} Utwórz</button></div>`);
  let loader = 'fabric', version = '1.21.1', color = Math.floor(Math.random() * INSTANCE_COLORS.length), list = [];
  $('#loader', m.el).appendChild(segmented([{ value: 'fabric', label: 'Fabric' }, { value: 'vanilla', label: 'Vanilla' }], loader, (v) => { loader = v; renderVersions(); }));
  $('#colors', m.el).innerHTML = INSTANCE_COLORS.map(([a, b], i) => `<button data-c="${i}" style="background:linear-gradient(135deg,${a},${b})"></button>`).join('');
  const paintColors = () => $$('#colors button', m.el).forEach(b => b.classList.toggle('on', +b.dataset.c === color));
  $$('#colors button', m.el).forEach(b => b.onclick = () => { color = +b.dataset.c; paintColors(); });
  paintColors();

  const renderVersions = () => {
    const f = $('#vf', m.el).value.trim();
    const box = $('#versions', m.el);
    const shown = list.filter(v => (!f || v.id.includes(f)) && (loader === 'vanilla' || v.fabric)).slice(0, 120);
    if (!shown.some(v => v.id === version) && shown[0]) version = shown[0].id;
    box.innerHTML = shown.map(v => `<button data-v="${esc(v.id)}" class="${v.id === version ? 'on' : ''}">${esc(v.id)}${v.id === '1.21.1' ? '<small>NORE</small>' : ''}</button>`).join('') || '<div class="muted">Brak wersji</div>';
    $$('button', box).forEach(b => b.onclick = () => { version = b.dataset.v; renderVersions(); });
    $('#nore-field', m.el).style.display = loader === 'fabric' && version === '1.21.1' ? '' : 'none';
  };
  const load = async () => {
    try {
      const res = await nore.versions.list({ snapshots: $('#snap', m.el).checked });
      list = res.versions;
      renderVersions();
    } catch (e) { errorToast(e, 'Nie udało się pobrać listy wersji'); }
  };
  $('#vf', m.el).oninput = renderVersions;
  $('#snap', m.el).onchange = load;
  load();
  $('#create', m.el).onclick = async () => {
    const name = $('#name', m.el).value.trim() || (loader === 'fabric' && version === '1.21.1' && $('#nore', m.el).checked ? 'Nore Client' : `Minecraft ${version}`);
    try {
      await nore.instances.create({ name, mcVersion: version, loader, noreClient: $('#nore', m.el).checked, color });
      await App.refresh();
      m.close();
      toast('Utworzono instancję', `${name} • ${version}`, 'success');
    } catch (e) { errorToast(e); }
  };
}

function editInstanceModal(inst) {
  const m = modal(`<h3>Edytuj instancję</h3><p class="sub">${esc(inst.mcVersion)} • ${loaderName(inst.loader)}</p>
    <div class="field"><label>Nazwa</label><input class="input" id="name" value="${esc(inst.name)}" maxlength="40"></div>
    <div class="field"><label>Pamięć RAM dla tej instancji (0 = jak w ustawieniach)</label>
      <div class="row"><input type="range" class="slider" id="mem" min="0" max="${Math.max(4096, App.info.totalMemMb - 1024)}" step="512" value="${inst.memoryMb || 0}" style="flex:1"><div class="value-pill" id="memv"></div></div></div>
    <div class="field"><label>Automatycznie dołącz do serwera (adres, opcjonalnie)</label><input class="input" id="server" value="${esc(inst.joinServer || '')}" placeholder="np. play.serwer.pl"></div>
    ${inst.loader === 'fabric' && inst.mcVersion === '1.21.1' ? `<div class="field"><label class="row" style="gap:10px"><span class="switch"><input type="checkbox" id="nore" ${inst.noreClient ? 'checked' : ''}><i></i></span> Nore Client</label></div>` : ''}
    <div class="field"><label>Kolor</label><div class="color-row" id="colors"></div></div>
    <div class="foot"><button class="btn ghost" data-close>Anuluj</button><button class="btn" id="save">${icon('check')} Zapisz</button></div>`);
  let color = inst.color;
  $('#colors', m.el).innerHTML = INSTANCE_COLORS.map(([a, b], i) => `<button data-c="${i}" style="background:linear-gradient(135deg,${a},${b})"></button>`).join('');
  const paint = () => $$('#colors button', m.el).forEach(b => b.classList.toggle('on', +b.dataset.c === color));
  $$('#colors button', m.el).forEach(b => b.onclick = () => { color = +b.dataset.c; paint(); });
  paint();
  const r = $('#mem', m.el);
  const upd = () => { $('#memv', m.el).textContent = +r.value ? (r.value / 1024).toFixed(1) + ' GB' : 'Domyślnie'; sliderFill(r); };
  r.oninput = upd; upd();
  $('#save', m.el).onclick = async () => {
    const patch = { name: $('#name', m.el).value.trim() || inst.name, memoryMb: +r.value, joinServer: $('#server', m.el).value.trim(), color };
    if ($('#nore', m.el)) patch.noreClient = $('#nore', m.el).checked;
    await nore.instances.update(inst.id, patch);
    await App.refresh();
    m.close();
    toast('Zapisano', patch.name, 'success');
  };
}

// ================================================================== CONTENT BROWSER (Modrinth)

const CONTENT = {
  mods: { kind: 'mod', title: 'Mody', sub: 'Mody Fabric z Modrinth — zależności instalują się automatycznie.', icon: 'puzzle', folder: 'mods' },
  resourcepacks: { kind: 'resourcepack', title: 'Paczki zasobów', sub: 'Tekstury, dźwięki i czcionki. Włączysz je w grze: Opcje → Paczki zasobów.', icon: 'image', folder: 'resourcepacks' },
  shaders: { kind: 'shader', title: 'Shadery', sub: 'Wymagają moda Iris (znajdziesz go w zakładce Mody).', icon: 'sun', folder: 'shaderpacks' },
  datapacks: { kind: 'datapack', title: 'Datapacki', sub: 'Instalowane bezpośrednio do wybranego świata.', icon: 'database', folder: 'saves' },
};

function contentPage(key) {
  return (root) => {
    const cfg = CONTENT[key];
    let tab = 'browse', query = '', sort = 'relevance', offset = 0, world = '', worlds = [], timer = null, alive = true;
    const installing = new Set();

    root.innerHTML = `<div class="page-head"><div><h2>${cfg.title}</h2><p>${cfg.sub}</p></div>
      <div class="actions"><div class="instance-picker" id="pick" style="min-width:220px;padding:6px 12px"></div></div></div>
      <div class="toolbar"><div id="tabs"></div><div class="search" id="sbox">${icon('search')}<input id="q" placeholder="Szukaj na Modrinth…"></div>
        <div id="sort"></div><select class="input" id="world" style="display:none;min-width:180px"></select>
        <button class="btn ghost icon" id="folder" title="Otwórz folder">${icon('folder')}</button></div>
      <div id="results"></div>`;

    const inst = () => App.instance();
    const renderPick = () => {
      const i = inst();
      $('#pick', root).innerHTML = i ? `${instIcon(i, 34)}<div class="meta"><b style="font-size:13px">${esc(i.name)}</b><span>${esc(i.mcVersion)}</span></div>` : '<div class="meta"><b>Brak instancji</b></div>';
    };
    $('#pick', root).onclick = () => instancePickerModal();
    $('#tabs', root).appendChild(segmented([{ value: 'browse', label: 'Przeglądaj' }, { value: 'installed', label: 'Zainstalowane' }], tab, (v) => { tab = v; offset = 0; load(); }));
    $('#sort', root).appendChild(segmented([{ value: 'relevance', label: 'Trafność' }, { value: 'downloads', label: 'Popularne' }, { value: 'updated', label: 'Nowe' }], sort, (v) => { sort = v; offset = 0; load(); }));
    $('#q', root).oninput = (e) => { clearTimeout(timer); timer = setTimeout(() => { query = e.target.value; offset = 0; load(); }, 280); };
    $('#folder', root).onclick = () => { const i = inst(); if (i) nore.instances.folder(i.id, key === 'datapacks' && world ? `saves/${world}/datapacks` : cfg.folder); };

    async function loadWorlds() {
      if (cfg.kind !== 'datapack') return;
      const i = inst();
      worlds = i ? await nore.instances.worlds(i.id) : [];
      if (!worlds.includes(world)) world = worlds[0] || '';
      const sel = $('#world', root);
      sel.style.display = '';
      sel.innerHTML = worlds.length ? worlds.map(w => `<option ${w === world ? 'selected' : ''}>${esc(w)}</option>`).join('') : '<option value="">Brak światów — zagraj najpierw</option>';
      sel.onchange = () => { world = sel.value; if (tab === 'installed') load(); };
    }

    const results = () => $('#results', root);

    async function load() {
      const i = inst();
      $('#sbox', root).style.display = $('#sort', root).style.display = tab === 'browse' ? '' : 'none';
      if (!i) { results().innerHTML = `<div class="empty">${icon('layers')}<div>Najpierw utwórz instancję.</div></div>`; return; }
      if (tab === 'installed') return loadInstalled(i);
      results().innerHTML = '<div class="grid cols-2">' + '<div class="skeleton"></div>'.repeat(6) + '</div>';
      try {
        const res = await nore.content.search({
          query, kind: cfg.kind, gameVersion: i.mcVersion, loader: i.loader === 'fabric' ? 'fabric' : null, sort, offset, limit: 20,
        });
        if (!alive) return;
        renderResults(res, i);
      } catch (e) {
        results().innerHTML = `<div class="empty">${icon('globe')}<div>Nie udało się połączyć z Modrinth.</div><div class="muted" style="margin-top:6px">${esc(e.message)}</div></div>`;
      }
    }

    function renderResults(res, i) {
      if (!res.hits.length) { results().innerHTML = `<div class="empty">${icon('search')}<div>Brak wyników dla „${esc(query)}” (${esc(i.mcVersion)}).</div></div>`; return; }
      const box = el('<div class="grid cols-2"></div>');
      box.innerHTML = res.hits.map(h => `<div class="card hover project" data-id="${h.project_id}">
        <div class="picon">${h.icon_url ? `<img src="${esc(h.icon_url)}" data-fallback alt="">` : ''}${esc(h.title.charAt(0))}</div>
        <div class="body"><h4>${esc(h.title)} <small>${esc(h.author)}</small></h4><p>${esc(h.description)}</p>
          <div class="stats"><span>${icon('download')} ${fmtNum(h.downloads)}</span><span>${icon('heart')} ${fmtNum(h.follows)}</span><span>${icon('clock')} ${fmtAgo(new Date(h.date_modified).getTime())}</span></div></div>
        <div class="side"><button class="btn sm" data-install>${icon('download')} Pobierz</button>
          <button class="btn ghost sm icon" data-page title="Strona projektu">${icon('external')}</button></div></div>`).join('');
      stagger(box);
      results().innerHTML = '';
      results().appendChild(box);
      const pages = Math.ceil(res.total_hits / 20), page = Math.floor(offset / 20) + 1;
      if (pages > 1) {
        const pager = el(`<div class="pager"><button class="btn ghost sm" id="prev" ${page <= 1 ? 'disabled' : ''}>${icon('arrowLeft')}</button><span class="muted">Strona ${page} z ${pages}</span><button class="btn ghost sm" id="next" ${page >= pages ? 'disabled' : ''}>${icon('arrowRight')}</button></div>`);
        results().appendChild(pager);
        $('#prev', pager).onclick = () => { offset = Math.max(0, offset - 20); load(); $('#view').scrollTo({ top: 0, behavior: 'smooth' }); };
        $('#next', pager).onclick = () => { offset += 20; load(); $('#view').scrollTo({ top: 0, behavior: 'smooth' }); };
      }
      $$('.project', box).forEach(card => {
        const id = card.dataset.id;
        const hit = res.hits.find(h => h.project_id === id);
        $('[data-page]', card).onclick = () => nore.open(`https://modrinth.com/${hit.project_type}/${hit.slug}`);
        const btn = $('[data-install]', card);
        if (installing.has(id)) { btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>'; }
        btn.onclick = async () => {
          if (cfg.kind === 'datapack' && !world) return toast('Brak świata', 'Wybierz świat albo najpierw stwórz go w grze.', 'error');
          installing.add(id);
          btn.disabled = true;
          btn.innerHTML = '<span class="spinner"></span> Pobieranie';
          try {
            const files = await nore.content.install({ instanceId: i.id, projectId: id, kind: cfg.kind, world });
            btn.classList.add('success');
            btn.innerHTML = `${icon('check')} Zainstalowano`;
            toast(hit.title, files.length > 1 ? `Zainstalowano z ${files.length - 1} zależnościami` : 'Zainstalowano', 'success');
          } catch (e) {
            btn.disabled = false;
            btn.innerHTML = `${icon('download')} Pobierz`;
            errorToast(e, hit.title);
          } finally {
            installing.delete(id);
          }
        };
      });
    }

    async function loadInstalled(i) {
      const list = await nore.content.installed({ instanceId: i.id, kind: cfg.kind, world });
      if (!alive) return;
      if (!list.length) {
        results().innerHTML = `<div class="empty">${icon(cfg.icon)}<div>${cfg.kind === 'datapack' && !world ? 'Wybierz świat.' : 'Nic tu jeszcze nie ma.'}</div></div>`;
        return;
      }
      const box = el('<div class="col" style="gap:10px"></div>');
      box.innerHTML = list.map(f => `<div class="card installed-row ${f.enabled ? '' : 'off'}" data-file="${esc(f.file)}">
        <div class="news-item" style="padding:0;background:none;border:0"><div class="ico">${icon(cfg.icon)}</div></div>
        <div style="flex:1;min-width:0"><b>${esc(f.name)}</b><div class="muted" style="font-size:12px">${f.dir ? 'Folder' : fmtBytes(f.size)}${f.enabled ? '' : ' • wyłączony'}</div></div>
        <label class="switch" title="Włącz / wyłącz"><input type="checkbox" ${f.enabled ? 'checked' : ''} data-toggle><i></i></label>
        <button class="btn danger sm icon" data-del title="Usuń">${icon('trash')}</button></div>`).join('');
      stagger(box);
      results().innerHTML = '';
      results().appendChild(box);
      $$('.installed-row', box).forEach(row => {
        const file = row.dataset.file;
        $('[data-toggle]', row).onchange = async () => { await nore.content.toggle({ instanceId: i.id, kind: cfg.kind, world, file }); load(); };
        $('[data-del]', row).onclick = async () => {
          if (!(await confirmModal('Usunąć plik?', file, { ok: 'Usuń', danger: true }))) return;
          await nore.content.remove({ instanceId: i.id, kind: cfg.kind, world, file });
          row.style.transition = 'all .3s'; row.style.opacity = 0; row.style.transform = 'translateX(30px)';
          setTimeout(load, 300);
        };
      });
    }

    let lastInst = inst() && inst().id;
    renderPick();
    loadWorlds().then(load);
    const off = App.onChange(() => {
      renderPick();
      const now = inst() && inst().id;
      if (now !== lastInst) { lastInst = now; offset = 0; loadWorlds().then(load); }
    });
    return () => { alive = false; off(); };
  };
}

Pages.mods = contentPage('mods');
Pages.resourcepacks = contentPage('resourcepacks');
Pages.shaders = contentPage('shaders');
Pages.datapacks = contentPage('datapacks');

// ================================================================== ACCOUNTS

Pages.accounts = (root) => {
  const render = () => {
    const s = App.state;
    root.innerHTML = `<div class="page-head"><div><h2>Konta</h2><p>Logowanie premium (Microsoft) i non-premium (dowolny nick).</p></div></div>
      <div class="login-options stagger" style="margin-bottom:26px">
        <div class="card hover login-option ms" id="ms" style="--i:0"><div class="ico"><div class="ms-grid"><i style="background:#f25022"></i><i style="background:#7fba00"></i><i style="background:#00a4ef"></i><i style="background:#ffb900"></i></div></div>
          <h3>Dodaj konto Microsoft</h3><p>Konto premium z Minecraft: Java Edition — serwery online-mode, skin i peleryna.</p></div>
        <div class="card hover login-option" id="off" style="--i:1"><div class="ico" style="background:rgba(var(--accent-rgb),.15);color:var(--accent)">${icon('user')}</div>
          <h3>Dodaj konto non-premium</h3><p>Wpisz tylko nick — singleplayer, LAN i serwery z wyłączonym online-mode.</p></div>
      </div>
      <div class="section-title" style="margin-bottom:12px">${icon('users')} Twoje konta</div>
      <div class="col" id="list" style="gap:10px"></div>`;
    const list = $('#list', root);
    list.innerHTML = s.accounts.length ? s.accounts.map(a => `<div class="card acc-card ${a.id === s.selectedAccount ? 'selected' : ''}" data-id="${a.id}">
        ${avatarHtml(a)}<div class="grow"><b>${esc(a.name)}</b><div class="row" style="margin-top:6px;gap:8px">${a.type === 'microsoft' ? `<span class="tag premium">${icon('shield')} PREMIUM</span>` : '<span class="tag offline">NON-PREMIUM</span>'}<span class="muted" style="font-size:11.5px">${esc(a.uuid)}</span></div></div>
        ${a.id === s.selectedAccount ? `<span class="tag accent">${icon('check')} AKTYWNE</span>` : '<button class="btn sm" data-sel>Użyj</button>'}
        <button class="btn danger sm icon" data-del title="Usuń">${icon('trash')}</button></div>`).join('')
      : `<div class="card empty">${icon('user')}<div>Nie dodano jeszcze żadnego konta.</div></div>`;
    stagger(list);
    $('#ms', root).onclick = () => microsoftLoginModal();
    $('#off', root).onclick = () => offlineLoginModal();
    $$('.acc-card', list).forEach(c => {
      const id = c.dataset.id;
      const sel = $('[data-sel]', c);
      if (sel) sel.onclick = async () => { await nore.accounts.select(id); await App.refresh(); toast('Zmieniono konto', '', 'success'); };
      $('[data-del]', c).onclick = async () => {
        if (await confirmModal('Usunąć konto?', 'Konto zostanie wylogowane z launchera.', { ok: 'Usuń', danger: true })) {
          await nore.accounts.remove(id); await App.refresh();
        }
      };
    });
  };
  render();
  return App.onChange(render);
};

function offlineLoginModal(done) {
  const m = modal(`<h3>Konto non-premium</h3><p class="sub">Podaj nick (3–16 znaków: litery, cyfry, _).</p>
    <div class="field"><input class="input" id="nick" maxlength="16" placeholder="Steve" autofocus></div>
    <div class="field"><span class="hint">${icon('info')} Konto non-premium działa w singleplayer, LAN i na serwerach z wyłączonym online-mode.</span></div>
    <div class="foot"><button class="btn ghost" data-close>Anuluj</button><button class="btn" id="ok">${icon('check')} Dodaj</button></div>`);
  const input = $('#nick', m.el);
  setTimeout(() => input.focus(), 50);
  const submit = async () => {
    try {
      const acc = await nore.accounts.offline(input.value.trim());
      await App.refresh();
      m.close();
      toast('Dodano konto', acc.name, 'success');
      done && done();
    } catch (e) { errorToast(e, 'Nieprawidłowy nick'); input.focus(); }
  };
  input.onkeydown = (e) => { if (e.key === 'Enter') submit(); };
  $('#ok', m.el).onclick = submit;
}

async function microsoftLoginModal(done) {
  let session = null, cancelled = false;
  const m = modal(`<h3>Logowanie Microsoft</h3><p class="sub">Łączenie z Microsoft…</p><div id="body" class="col" style="align-items:center;padding:20px"><span class="spinner"></span></div>
    <div class="foot"><button class="btn ghost" data-close>Anuluj</button></div>`, {
    onClose: () => { cancelled = true; if (session) nore.accounts.msCancel(session.deviceCode); },
  });
  try {
    session = await nore.accounts.msStart();
  } catch (e) {
    $('#body', m.el).innerHTML = `<div class="empty" style="padding:10px">${icon('key')}<div style="color:var(--text)">${esc(String(e.message).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))}</div>
      <div class="muted" style="margin-top:8px;font-size:12.5px;line-height:1.5">Logowanie Microsoft wymaga identyfikatora aplikacji Azure zatwierdzonego przez Mojang.
      Wpisz go w Ustawienia → Konta Microsoft. Do tego czasu możesz grać na koncie non-premium.</div>
      <button class="btn sm" style="margin-top:14px" id="to-settings">${icon('settings')} Przejdź do ustawień</button></div>`;
    $('.sub', m.el).textContent = 'Brak konfiguracji';
    $('#to-settings', m.el).onclick = () => { m.close(); go('settings'); };
    return;
  }
  $('.sub', m.el).textContent = 'Otwórz stronę Microsoft i wpisz poniższy kod:';
  $('#body', m.el).innerHTML = `<div class="code-box" id="code" title="Kliknij, aby skopiować">${esc(session.userCode)}</div>
    <button class="btn" id="open" style="margin-top:16px">${icon('external')} Otwórz ${esc(session.uri.replace('https://', ''))}</button>
    <div class="row muted" style="margin-top:16px;font-size:12.5px"><span class="spinner"></span> Czekam na zalogowanie…</div>`;
  $('#code', m.el).onclick = () => { navigator.clipboard.writeText(session.userCode); toast('Skopiowano kod', session.userCode); };
  $('#open', m.el).onclick = () => nore.open(session.uri);
  nore.open(session.uri);
  try {
    const acc = await nore.accounts.msPoll(session.deviceCode, session.userCode, session.expiresIn, session.interval);
    if (cancelled) return;
    await App.refresh();
    m.close();
    toast('Zalogowano', acc.name + ' (premium)', 'success');
    done && done();
  } catch (e) {
    if (!cancelled) { m.close(); errorToast(e, 'Logowanie nie powiodło się'); }
  }
}

// ================================================================== SETTINGS

Pages.settings = (root) => {
  const s = App.state.settings;
  const maxMem = Math.max(4096, App.info.totalMemMb - 1024);
  root.innerHTML = `<div class="page-head"><div><h2>Ustawienia</h2><p>Wydajność, Java, okno gry i zachowanie launchera.</p></div></div>
    <div class="grid cols-2 stagger">
      <div class="card panel">
        <div class="section-title">${icon('cpu')} Wydajność</div>
        <div class="setting"><div class="col"><b>Pamięć RAM</b><span>Twój komputer: ${(App.info.totalMemMb / 1024).toFixed(1)} GB</span></div></div>
        <div class="row" style="padding-bottom:12px"><input type="range" class="slider" id="mem" min="1024" max="${maxMem}" step="512" value="${s.memoryMb}" style="flex:1"><div class="value-pill" id="memv"></div></div>
        <div class="setting"><div class="col"><b>Równoległe pobieranie</b><span>Liczba plików pobieranych jednocześnie</span></div>
          <input type="range" class="slider" id="conc" min="4" max="32" step="1" value="${s.concurrency}" style="width:140px"><div class="value-pill" id="concv"></div></div>
        <div class="setting"><div class="col"><b>Animacje i efekty</b><span>Cząsteczki, przejścia i poświaty</span></div><label class="switch"><input type="checkbox" id="anim" ${s.animations ? 'checked' : ''}><i></i></label></div>
      </div>
      <div class="card panel">
        <div class="section-title">${icon('monitor')} Okno gry</div>
        <div class="setting"><div class="col"><b>Rozdzielczość</b><span>Rozmiar okna przy starcie</span></div>
          <input class="input" id="w" value="${s.width}" style="width:84px"> × <input class="input" id="h" value="${s.height}" style="width:84px"></div>
        <div class="setting"><div class="col"><b>Pełny ekran</b><span>Uruchamiaj grę na pełnym ekranie</span></div><label class="switch"><input type="checkbox" id="fs" ${s.fullscreen ? 'checked' : ''}><i></i></label></div>
        <div class="setting"><div class="col"><b>Po uruchomieniu gry</b><span>Co zrobić z launcherem</span></div><div id="after"></div></div>
      </div>
      <div class="card panel">
        <div class="section-title">${icon('zap')} Java</div>
        <div class="setting"><div class="col"><b>Ścieżka do Javy</b><span>Puste = automatycznie pobrana Java od Mojang (zalecane)</span></div></div>
        <div class="row"><input class="input" id="java" value="${esc(s.javaPath)}" placeholder="Automatycznie" style="flex:1"><button class="btn ghost sm" id="pickjava">${icon('folder')} Wybierz</button></div>
        <div class="field" style="margin-top:16px"><label>Dodatkowe argumenty JVM</label><input class="input" id="jvm" value="${esc(s.jvmArgs)}" placeholder="-XX:+UseG1GC"></div>
      </div>
      <div class="card panel">
        <div class="section-title">${icon('refresh')} Aktualizacje</div>
        <div class="setting"><div class="col"><b>Automatyczne aktualizacje</b><span>Pobieraj nowe wersje launchera i Nore Client w tle</span></div><label class="switch"><input type="checkbox" id="autoupd" ${s.autoUpdate !== false ? 'checked' : ''}><i></i></label></div>
        <div class="setting"><div class="col"><b>Kanał aktualizacji modów i modpacków</b><span>„Wszystkie” proponuje najnowszą wersję, nawet jeśli to alpha albo beta</span></div></div>
        <div class="row" style="padding-bottom:12px" id="uchan"></div>
        <div class="setting"><div class="col"><b>Powiadamiaj o nowych wersjach modpacków i modów</b><span>Sprawdza instancje co 6 godzin i pokazuje aktualizacje na stronie głównej</span></div><label class="switch"><input type="checkbox" id="unotify" ${s.notifyContentUpdates !== false ? 'checked' : ''}><i></i></label></div>
        <div class="setting"><div class="col"><b>Automatyczna naprawa błędów</b><span>Wyłącza zdublowane mody i mody z innego loadera, a po crashu sam naprawia przyczynę</span></div><label class="switch"><input type="checkbox" id="autorep" ${s.autoRepair !== false ? 'checked' : ''}><i></i></label></div>
        <div class="setting"><div class="col"><b>Nore Launcher ${esc(App.info.version)}</b><span id="updstate">${updateText(App.update)}</span></div><button class="btn ghost sm" id="updcheck">${icon('refresh')} Sprawdź teraz</button></div>
      </div>
      <div class="card panel">
        <div class="section-title">${icon('globe')} Discord</div>
        <div class="setting"><div class="col"><b>Status w Discordzie (Rich Presence)</b><span>Zawsze włączony – znajomi widzą, że grasz w Nore Client (launcher i gra)</span></div><span class="tag premium">AKTYWNY</span></div>
        <div class="setting"><div class="col"><b>Aplikacja Discord</b><span>Nore Client • ID ${esc(s.discordAppId || '1559570563339526175')}</span></div></div>
      </div>
      <div class="card panel">
        <div class="section-title">${icon('key')} Konta Microsoft</div>
        <div class="field"><label>Azure Client ID</label><input class="input" id="msid" value="${esc(s.msClientId)}" placeholder="00000000-0000-0000-0000-000000000000">
          <span class="hint">Logowanie premium wymaga własnej aplikacji w Azure (konta osobiste Microsoft) zatwierdzonej przez Mojang
          do Minecraft API. Zarejestruj ją w portal.azure.com, a o dostęp poproś w formularzu Mojang „Minecraft API access”.</span></div>
        <div class="setting"><div class="col"><b>Folder danych launchera</b><span>${esc(App.info.root)}</span></div><button class="btn ghost sm" id="root">${icon('folder')} Otwórz</button></div>
        <div class="setting"><div class="col"><b>Wersja</b><span>Nore Launcher ${esc(App.info.version)}</span></div><button class="btn ghost sm" id="wizard">${icon('sparkles')} Kreator startowy</button></div>
      </div>
    </div>`;
  const save = async (patch) => { App.state.settings = await nore.setSettings(patch); };
  const mem = $('#mem', root), conc = $('#conc', root);
  const upd = () => { $('#memv', root).textContent = (mem.value / 1024).toFixed(1) + ' GB'; $('#concv', root).textContent = conc.value; sliderFill(mem); sliderFill(conc); };
  mem.oninput = conc.oninput = upd; upd();
  mem.onchange = () => save({ memoryMb: +mem.value });
  conc.onchange = () => save({ concurrency: +conc.value });
  $('#anim', root).onchange = (e) => { save({ animations: e.target.checked }); document.body.classList.toggle('no-anim', !e.target.checked); Embers.setEnabled(e.target.checked); };
  $('#fs', root).onchange = (e) => save({ fullscreen: e.target.checked });
  $('#w', root).onchange = (e) => save({ width: Math.max(320, parseInt(e.target.value, 10) || 1280) });
  $('#h', root).onchange = (e) => save({ height: Math.max(240, parseInt(e.target.value, 10) || 720) });
  $('#java', root).onchange = (e) => save({ javaPath: e.target.value.trim() });
  $('#jvm', root).onchange = (e) => save({ jvmArgs: e.target.value });
  $('#autoupd', root).onchange = (e) => save({ autoUpdate: e.target.checked });
  $('#autorep', root).onchange = (e) => save({ autoRepair: e.target.checked });
  $('#uchan', root).appendChild(segmented([{ value: 'all', label: 'Wszystkie (alpha/beta)' }, { value: 'beta', label: 'Beta' }, { value: 'release', label: 'Tylko wydania' }],
    s.updateChannel || 'all', (v) => save({ updateChannel: v }).then(() => toast('Kanał aktualizacji', v === 'all' ? 'Najnowsze wersje, także alpha i beta' : v === 'beta' ? 'Wydania i wersje beta' : 'Tylko stabilne wydania', 'success'))));
  $('#unotify', root).onchange = (e) => save({ notifyContentUpdates: e.target.checked });
  $('#updcheck', root).onclick = async () => {
    $('#updstate', root).textContent = 'Sprawdzanie…';
    const st = await nore.update.check().catch(() => null);
    $('#updstate', root).textContent = updateText(st || App.update);
  };
  $('#msid', root).onchange = (e) => { save({ msClientId: e.target.value.trim() }); toast('Zapisano Client ID'); };
  $('#after', root).appendChild(segmented([{ value: 'hide', label: 'Ukryj' }, { value: 'keep', label: 'Zostaw' }, { value: 'close', label: 'Zamknij' }], s.afterLaunch, (v) => save({ afterLaunch: v })));
  $('#pickjava', root).onclick = async () => {
    const r = await nore.pickJava();
    if (!r) return;
    if (!r.major) return toast('To nie wygląda na Javę', r.path, 'error');
    $('#java', root).value = r.path;
    save({ javaPath: r.path });
    toast(`Java ${r.major}`, r.path, 'success');
  };
  $('#root', root).onclick = () => nore.openFolder(App.info.root);
  $('#wizard', root).onclick = async () => { await onboarding(); await App.refresh(); };
};

// ================================================================== CONSOLE

Pages.console = (root) => {
  root.innerHTML = `<div class="page-head"><div><h2>Konsola</h2><p>Logi gry na żywo.</p></div>
    <div class="actions"><button class="btn ghost" id="copy">${icon('copy')} Kopiuj</button><button class="btn ghost" id="clear">${icon('trash')} Wyczyść</button>
    <button class="btn danger" id="kill" ${App.running ? '' : 'disabled'}>${icon('stop')} Zatrzymaj grę</button></div></div>
    <div class="card console" id="log"></div>`;
  const log = $('#log', root);
  const cls = (l) => l.stream === 'err' || /ERROR|Exception/.test(l.line) ? 'err' : /WARN/.test(l.line) ? 'warn' : /^\[Launcher\]/.test(l.line) ? 'launcher' : 'info';
  const line = (l) => { const d = document.createElement('div'); d.className = cls(l); d.textContent = l.line; return d; };
  const frag = document.createDocumentFragment();
  App.logs.slice(-1500).forEach(l => frag.appendChild(line(l)));
  log.appendChild(frag);
  if (!App.logs.length) log.innerHTML = `<div class="empty">${icon('terminal')}<div>Uruchom grę, aby zobaczyć logi.</div></div>`;
  log.scrollTop = log.scrollHeight;
  App.onLog = (l) => {
    const stick = log.scrollTop + log.clientHeight >= log.scrollHeight - 30;
    if ($('.empty', log)) log.innerHTML = '';
    log.appendChild(line(l));
    while (log.childElementCount > 3000) log.firstChild.remove();
    if (stick) log.scrollTop = log.scrollHeight;
  };
  $('#copy', root).onclick = () => { navigator.clipboard.writeText(App.logs.map(l => l.line).join('\n')); toast('Skopiowano logi'); };
  $('#clear', root).onclick = () => { App.logs = []; log.innerHTML = ''; };
  $('#kill', root).onclick = () => nore.game.kill();
  const off = App.onChange(() => { $('#kill', root).disabled = !App.running; });
  return () => { App.onLog = null; off(); };
};

function updateText(u) {
  if (!u) return '';
  switch (u.state) {
    case 'dev': return 'Wersja deweloperska – aktualizacje działają w zainstalowanym launcherze';
    case 'unsupported': return 'Ta kopia nie aktualizuje się sama – użyj instalatora .exe / AppImage';
    case 'checking': return 'Sprawdzanie…';
    case 'latest': return 'Masz najnowszą wersję';
    case 'available': return `Dostępna wersja ${u.next}`;
    case 'downloading': return `Pobieranie ${u.next || ''} – ${u.percent || 0}%`;
    case 'ready': return `Wersja ${u.next} gotowa do instalacji`;
    case 'error': return 'Błąd: ' + (u.message || 'nieznany');
    default: return 'Aktualizacje sprawdzane automatycznie';
  }
}
