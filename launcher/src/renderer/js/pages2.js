'use strict';
/* Instance details (edit), new-instance installer, downloaded versions and local servers (BETA). */

// ================================================================== NEW INSTANCE ("installer" for any version)

function modpackLabel(inst) {
  if (inst.modpack === 'nore' || inst.noreClient) return 'Nore Client';
  if (inst.modpack === 'pack') return `Modpack • ${loaderName(inst.loader)}`;
  if (inst.loader && inst.loader !== 'fabric' && inst.loader !== 'vanilla') return loaderName(inst.loader);
  if (inst.loader === 'fabric') return inst.perfPack ? 'Fabric + Pakiet Nore' : 'Fabric';
  return 'Vanilla';
}

// replaces the simple version from pages.js
createInstanceModal = async function () {
  const noreVersions = App.state.noreVersions || ['1.21.1'];
  const m = modal(`<h3>Zainstaluj wersję</h3><p class="sub">Wybierz wersję Minecraft i to, czy chcesz grać na czystej grze, czy z modami.</p>
    <div class="field"><label>Rodzaj</label>
      <div class="grid cols-2" id="kinds" style="grid-template-columns:1fr 1fr;gap:10px">
        <div class="card hover kind-card" data-k="vanilla"><div class="row"><div class="kind-ico">${icon('box')}</div><div><b>Vanilla</b><div class="muted" style="font-size:12px">Czysta gra, każda wersja</div></div></div></div>
        <div class="card hover kind-card" data-k="modded"><div class="row"><div class="kind-ico">${icon('zap')}</div><div><b>Z modami</b><div class="muted" style="font-size:12px">Fabric, Quilt, Forge, NeoForge</div></div></div></div>
      </div></div>
    <div class="field"><div class="row"><label style="flex:1">Wersja Minecraft</label>
      <label class="row muted" style="font-size:12px;gap:8px">Snapshoty <span class="switch"><input type="checkbox" id="snap"><i></i></span></label></div>
      <div class="search" style="height:38px"><span>${icon('search')}</span><input id="vf" placeholder="Filtruj wersje… (np. 1.20)"></div>
      <div class="version-list" id="versions"><div class="skeleton" style="grid-column:1/-1;height:120px"></div></div></div>
    <div id="mod-opts" class="card panel" style="padding:14px 16px;margin-bottom:14px"></div>
    <div class="field"><label>Nazwa</label><input class="input" id="name" placeholder="Automatycznie" maxlength="40"></div>
    <div class="field"><label>Kolor</label><div class="color-row" id="colors"></div></div>
    <div class="foot"><button class="btn ghost" data-close>Anuluj</button><button class="btn" id="create">${icon('download')} Zainstaluj</button></div>`);
  m.el.style.width = 'min(640px, calc(100vw - 40px))';
  let kind = 'modded', version = noreVersions[noreVersions.length - 1], color = Math.floor(Math.random() * INSTANCE_COLORS.length), list = [];
  let useNore = true, pack = false, modLoader = 'fabric';

  const paintKinds = () => $$('.kind-card', m.el).forEach(c => c.classList.toggle('selected', c.dataset.k === kind));
  $$('.kind-card', m.el).forEach(c => c.onclick = () => { kind = c.dataset.k; paintKinds(); renderVersions(); });
  paintKinds();
  $('#colors', m.el).innerHTML = INSTANCE_COLORS.map(([a, b], i) => `<button data-c="${i}" style="background:linear-gradient(135deg,${a},${b})"></button>`).join('');
  const paintColors = () => $$('#colors button', m.el).forEach(b => b.classList.toggle('on', +b.dataset.c === color));
  $$('#colors button', m.el).forEach(b => b.onclick = () => { color = +b.dataset.c; paintColors(); });
  paintColors();

  const current = () => list.find(v => v.id === version);
  const renderOpts = () => {
    const box = $('#mod-opts', m.el);
    const v = current();
    if (kind === 'vanilla') {
      box.innerHTML = `<div class="row">${icon('info', 'dim')}<span class="dim" style="font-size:13px">Oryginalny Minecraft ${esc(version)} bez żadnych modyfikacji.</span></div>`;
      return;
    }
    const loaderRow = `<div class="setting" style="padding:4px 0 10px"><div class="col"><b>Loader modów</b><span>Fabric ma Nore Client i najwięcej modów wydajności</span></div><div id="o-loader"></div></div>`;
    const mountLoader = () => $('#o-loader', box).appendChild(segmented(['fabric', 'quilt', 'forge', 'neoforge'].map(l => ({ value: l, label: loaderName(l) })), modLoader, (l) => { modLoader = l; renderOpts(); }));
    if (modLoader !== 'fabric') {
      box.innerHTML = loaderRow + `<div class="row">${icon('info', 'dim')}<span class="dim" style="font-size:13px">${loaderName(modLoader)} dla Minecraft ${esc(version)} zainstaluje się przy pierwszym uruchomieniu. Mody dodasz w zakładce Mody.</span></div>`;
      mountLoader();
      return;
    }
    if (v && !v.fabric) {
      box.innerHTML = loaderRow + `<div class="row" style="color:#ffcf6b">${icon('info')}<span style="font-size:13px">Fabric nie wspiera wersji ${esc(version)} — wybierz inny loader albo Vanilla.</span></div>`;
      mountLoader();
      return;
    }
    const noreOk = noreVersions.includes(version);
    if (!noreOk) useNore = false;
    box.innerHTML = loaderRow + `
      <div class="setting" style="padding:8px 0"><div class="col"><b>Nore Client</b><span>${noreOk ? 'Nasz klient PvP: HUD, zoom, freelook, 75 modułów' : `Dostępny dla ${noreVersions.join(', ')} — tu użyj Pakietu Nore`}</span></div>
        <label class="switch"><input type="checkbox" id="o-nore" ${useNore && noreOk ? 'checked' : ''} ${noreOk ? '' : 'disabled'}><i></i></label></div>
      <div class="setting" style="padding:8px 0"><div class="col"><b>Pakiet Nore</b><span>Sodium, Lithium, FerriteCore, Entity Culling, ImmediatelyFast, Zoomify, AppleSkin, Mod Menu</span></div>
        <label class="switch"><input type="checkbox" id="o-pack" ${pack || !noreOk ? 'checked' : ''}><i></i></label></div>`;
    mountLoader();
    $('#o-nore', box).onchange = (e) => { useNore = e.target.checked; };
    $('#o-pack', box).onchange = (e) => { pack = e.target.checked; };
    if (!noreOk) pack = $('#o-pack', box).checked;
  };

  const renderVersions = () => {
    const f = $('#vf', m.el).value.trim();
    const box = $('#versions', m.el);
    const shown = list.filter(v => !f || v.id.includes(f)).slice(0, 160);
    if (!shown.some(v => v.id === version) && shown[0]) version = shown[0].id;
    box.innerHTML = shown.map(v => {
      const tag = noreVersions.includes(v.id) ? '<small>NORE</small>' : '';
      const dim = kind === 'modded' && modLoader === 'fabric' && !v.fabric ? 'style="opacity:.4"' : '';
      return `<button data-v="${esc(v.id)}" class="${v.id === version ? 'on' : ''}" ${dim} title="${v.fabric ? 'Fabric dostępny' : 'Tylko vanilla'}">${esc(v.id)}${tag}</button>`;
    }).join('') || '<div class="muted">Brak wersji</div>';
    $$('button', box).forEach(b => b.onclick = () => { version = b.dataset.v; renderVersions(); });
    renderOpts();
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
    const v = current();
    const other = kind === 'modded' && modLoader !== 'fabric';
    const modded = kind === 'modded' && (other || !v || v.fabric);
    if (kind === 'modded' && !other && v && !v.fabric) return toast('Fabric niedostępny', `Fabric nie wspiera ${version} – wybierz inny loader.`, 'error');
    const modpack = !modded ? 'vanilla' : other ? 'loader' : (useNore && noreVersions.includes(version) ? 'nore' : 'fabric');
    const perfPack = modded && !other && !!($('#o-pack', m.el) && $('#o-pack', m.el).checked);
    const name = $('#name', m.el).value.trim() || (modpack === 'nore' ? `Nore Client ${version}` : modded ? `${loaderName(other ? modLoader : 'fabric')} ${version}` : `Minecraft ${version}`);
    try {
      const inst = await nore.instances.create({ name, mcVersion: version, loader: !modded ? 'vanilla' : other ? modLoader : 'fabric', modpack, perfPack, color });
      await nore.instances.select(inst.id);
      await App.refresh();
      m.close();
      toast('Utworzono instancję', `${name} • ${modpackLabel(inst)}`, 'success');
      go('instance', { id: inst.id });
    } catch (e) { errorToast(e); }
  };
};

// ================================================================== INSTANCE DETAILS (edit)

Pages.instance = (root, { id, tab: startTab }) => {
  let tab = startTab || 'overview';
  let alive = true;
  const inst = () => App.state.instances.find(i => i.id === id);
  if (!inst()) { go('instances'); return null; }

  const renderHeader = () => {
    const i = inst();
    const [a, b] = INSTANCE_COLORS[i.color % INSTANCE_COLORS.length];
    const running = App.running === i.id;
    $('#ihead', root).innerHTML = `
      <div class="inst-hero card" style="background:radial-gradient(circle at 85% 0%, ${a}55, transparent 60%), linear-gradient(135deg, ${b}22, rgba(24,19,16,.8))">
        <button class="btn ghost sm icon" id="back" title="Wróć">${icon('arrowLeft')}</button>
        ${instIcon(i, 72)}
        <div style="flex:1;min-width:0">
          <h2 style="font-size:28px">${esc(i.name)}</h2>
          <div class="info row" style="gap:6px;margin-top:8px;flex-wrap:wrap">${instanceTags(i)}
            <span class="muted" style="font-size:12px">${icon('clock')} ${fmtDuration(i.playTime || 0)} • ${fmtAgo(i.lastPlayed)}</span></div>
        </div>
        <div class="row">
          <button class="btn ghost icon" id="folder" title="Folder">${icon('folder')}</button>
          <button class="btn ghost icon" id="dup" title="Duplikuj">${icon('copy')}</button>
          <button class="btn play ${running ? 'running' : ''}" id="play" style="height:52px;padding:0 30px;font-size:17px">${running ? icon('stop') + ' ZATRZYMAJ' : icon('play') + ' GRAJ'}</button>
        </div>
      </div>`;
    $('#back', root).onclick = () => go('instances');
    $('#folder', root).onclick = () => nore.instances.folder(i.id);
    $('#dup', root).onclick = async () => {
      const c = await nore.instances.duplicate(i.id);
      await App.refresh();
      toast('Zduplikowano instancję', c.name, 'success');
    };
    $('#play', root).onclick = async () => {
      if (App.running === i.id) return nore.game.kill();
      await nore.instances.select(i.id);
      await App.refresh();
      launchSelected(i);
    };
  };

  root.innerHTML = `<div id="ihead"></div>
    <div class="row" style="margin:18px 0 16px" id="tabs"></div>
    <div id="tabc"></div>`;
  const TABS = [
    { value: 'overview', label: 'Przegląd' }, { value: 'mods', label: 'Mody' }, { value: 'resourcepacks', label: 'Paczki' },
    { value: 'shaders', label: 'Shadery' }, { value: 'worlds', label: 'Światy' }, { value: 'screens', label: 'Zrzuty' },
    { value: 'settings', label: 'Ustawienia' },
  ];
  const seg = segmented(TABS, tab, (v) => { tab = v; renderTab(); });
  $('#tabs', root).appendChild(seg);

  async function renderTab() {
    const c = $('#tabc', root);
    c.innerHTML = '';
    const page = el('<div class="page"></div>');
    c.appendChild(page);
    const i = inst();
    if (tab === 'overview') return overviewTab(page, i);
    if (tab === 'mods' || tab === 'resourcepacks' || tab === 'shaders') return contentTab(page, i, tab);
    if (tab === 'worlds') return worldsTab(page, i);
    if (tab === 'screens') return screensTab(page, i);
    if (tab === 'settings') return settingsTab(page, i);
  }

  async function overviewTab(page, i) {
    page.innerHTML = `<div class="grid cols-2 stagger">
      <div class="card panel"><div class="section-title">${icon('layers')} Wersja i loader</div>
        <div class="field" style="margin-top:12px"><label>Wersja Minecraft</label><select class="input" id="ver"><option>${esc(i.mcVersion)}</option></select></div>
        <div class="field"><label>Rodzaj</label><div id="mp"></div></div>
        <div class="setting"><div class="col"><b>Pakiet Nore</b><span>Mody wydajności i QoL z Modrinth (pobiorą się przy starcie)</span></div>
          <label class="switch"><input type="checkbox" id="pack" ${i.perfPack ? 'checked' : ''} ${i.loader === 'fabric' ? '' : 'disabled'}><i></i></label></div>
        ${i.noreClient ? `<div class="setting"><div class="col"><b>Mody wydajności</b><span>Sodium, Lithium, FerriteCore, EntityCulling, ImmediatelyFast – dużo więcej FPS</span></div>
          <label class="switch"><input type="checkbox" id="perfmods" ${i.perfMods !== false ? 'checked' : ''}><i></i></label></div>` : ''}
        <div class="muted" style="font-size:12px;margin-top:6px">${i.loader === 'vanilla' ? 'Bez loadera modów' : `${loaderName(i.loader)} Loader: ${esc(i.loaderVersion || 'najnowszy stabilny')}`}</div>
      </div>
      <div class="card panel"><div class="section-title">${icon('edit')} Wygląd</div>
        <div class="field" style="margin-top:12px"><label>Nazwa</label><input class="input" id="name" value="${esc(i.name)}" maxlength="40"></div>
        <div class="field"><label>Kolor</label><div class="color-row" id="colors"></div></div>
        <div class="setting"><div class="col"><b>Rozmiar na dysku</b><span id="size">liczenie…</span></div>
          <button class="btn danger sm" id="del">${icon('trash')} Usuń instancję</button></div>
      </div></div>`;
    stagger($('.grid', page));
    nore.instances.size(i.id).then(s => { if ($('#size', page)) $('#size', page).textContent = fmtBytes(s); });
    const curKind = i.modpack === 'loader' || i.modpack === 'pack' ? i.loader : (i.modpack || (i.noreClient ? 'nore' : i.loader));
    const mp = segmented([{ value: 'vanilla', label: 'Vanilla' }, { value: 'fabric', label: 'Fabric' }, { value: 'nore', label: 'Nore Client' },
      { value: 'quilt', label: 'Quilt' }, { value: 'forge', label: 'Forge' }, { value: 'neoforge', label: 'NeoForge' }], curKind, async (v) => {
      if (['quilt', 'forge', 'neoforge'].includes(v)) {
        await nore.instances.update(i.id, { modpack: i.modpack === 'pack' ? 'pack' : 'loader', loader: v });
        await App.refresh();
        return toast('Zmieniono loader', loaderName(v), 'success');
      }
      if (v === 'nore' && !(App.state.noreVersions || []).includes(i.mcVersion)) {
        toast('Niedostępne', `Nore Client działa na ${App.state.noreVersions.join(', ')}. Zmień wersję albo użyj Pakietu Nore.`, 'error');
        mp.setValue(i.modpack || 'fabric');
        return;
      }
      await nore.instances.update(i.id, { modpack: v });
      await App.refresh();
      toast('Zmieniono rodzaj', v === 'vanilla' ? 'Vanilla' : v === 'nore' ? 'Nore Client' : 'Fabric', 'success');
    });
    $('#mp', page).appendChild(mp);
    $('#pack', page).onchange = async (e) => { await nore.instances.update(i.id, { perfPack: e.target.checked }); await App.refresh(); };
    if ($('#perfmods', page)) $('#perfmods', page).onchange = async (e) => {
      await nore.instances.update(i.id, { perfMods: e.target.checked });
      toast(e.target.checked ? 'Mody wydajności włączone' : 'Mody wydajności wyłączone', e.target.checked ? 'Pobiorą się przy następnym starcie' : 'Usuń je ręcznie z folderu mods, jeśli są już pobrane');
    };
    $('#name', page).onchange = async (e) => { await nore.instances.update(i.id, { name: e.target.value.trim() || i.name }); await App.refresh(); };
    let color = i.color;
    $('#colors', page).innerHTML = INSTANCE_COLORS.map(([a, b], k) => `<button data-c="${k}" style="background:linear-gradient(135deg,${a},${b})"></button>`).join('');
    const paint = () => $$('#colors button', page).forEach(b => b.classList.toggle('on', +b.dataset.c === color));
    $$('#colors button', page).forEach(b => b.onclick = async () => { color = +b.dataset.c; paint(); await nore.instances.update(i.id, { color }); await App.refresh(); });
    paint();
    $('#del', page).onclick = async () => {
      if (await confirmModal('Usunąć instancję?', `„${i.name}” zostanie usunięta razem ze światami i modami.`, { ok: 'Usuń', danger: true })) {
        await nore.instances.remove(i.id, true);
        await App.refresh();
        go('instances');
      }
    };
    try {
      const res = await nore.versions.list({ snapshots: false });
      const sel = $('#ver', page);
      if (!sel) return;
      sel.innerHTML = res.versions.map(v => `<option value="${esc(v.id)}" ${v.id === i.mcVersion ? 'selected' : ''} ${i.loader === 'fabric' && !v.fabric ? 'disabled' : ''}>${esc(v.id)}${(App.state.noreVersions || []).includes(v.id) ? '  ★ Nore' : ''}</option>`).join('');
      sel.onchange = async () => {
        if (!(await confirmModal('Zmienić wersję?', `Instancja zostanie przełączona na ${sel.value}. Mody niezgodne z nową wersją mogą przestać działać.`, { ok: 'Zmień' }))) { sel.value = i.mcVersion; return; }
        await nore.instances.update(i.id, { mcVersion: sel.value });
        await App.refresh();
        toast('Zmieniono wersję', sel.value, 'success');
      };
    } catch { /* offline */ }
  }

  async function contentTab(page, i, key) {
    const cfg = CONTENT[key];
    page.innerHTML = `<div class="row" style="margin-bottom:14px"><span class="dim">${cfg.title} w tej instancji</span><span class="spacer"></span>
      <button class="btn ghost sm" id="upd">${icon('refresh')} Aktualizacje</button><button class="btn ghost sm" id="open">${icon('folder')} Folder</button><button class="btn sm" id="add">${icon('plus')} Dodaj z Modrinth</button></div>
      ${cfg.kind === 'mod' ? `<div class="setting card" style="padding:10px 14px;margin-bottom:12px"><div class="col"><b>Aktualizuj mody automatycznie</b><span>Przy każdym uruchomieniu instancji (z Modrinth, zgodne z ${esc(i.mcVersion)})</span></div>
        <label class="switch"><input type="checkbox" id="autoupd" ${i.autoUpdateMods ? 'checked' : ''}><i></i></label></div>` : ''}<div id="list"></div>`;
    if ($('#autoupd', page)) $('#autoupd', page).onchange = (e) => nore.instances.update(i.id, { autoUpdateMods: e.target.checked }).then(() => toast('Zapisano', e.target.checked ? 'Mody będą aktualizowane przy starcie' : 'Automatyczne aktualizacje wyłączone', 'success'));
    $('#upd', page).onclick = async () => {
      toast('Aktualizacje', 'Sprawdzanie w Modrinth…');
      const ups = await nore.content.updates({ instanceId: i.id, kind: cfg.kind }).catch(e => { errorToast(e); return null; });
      if (!ups) return;
      if (!ups.length) return toast('Wszystko aktualne', cfg.title, 'success');
      if (!(await updatesConfirm(`Aktualizacje: ${ups.length}`, ups))) return;
      await nore.content.applyUpdates({ instanceId: i.id, kind: cfg.kind, updates: ups }).catch(errorToast);
      toast('Zaktualizowano', `${ups.length} plików`, 'success');
      load();
    };
    $('#open', page).onclick = () => nore.instances.folder(i.id, cfg.folder);
    $('#add', page).onclick = async () => { await nore.instances.select(i.id); await App.refresh(); go(key); };
    const load = async () => {
      const list = await nore.content.installed({ instanceId: i.id, kind: cfg.kind });
      if (!alive) return;
      const box = $('#list', page);
      if (!list.length) { box.innerHTML = `<div class="card empty">${icon(cfg.icon)}<div>Brak — dodaj coś z Modrinth.</div></div>`; return; }
      box.innerHTML = `<div class="col" style="gap:8px">${list.map(f => `<div class="card installed-row ${f.enabled ? '' : 'off'}" data-file="${esc(f.file)}">
        <div class="news-item" style="padding:0;background:none;border:0"><div class="ico">${icon(cfg.icon)}</div></div>
        <div style="flex:1;min-width:0"><b>${esc(f.name)}</b><div class="muted" style="font-size:12px">${f.dir ? 'Folder' : fmtBytes(f.size)}${f.enabled ? '' : ' • wyłączony'}</div></div>
        <label class="switch"><input type="checkbox" ${f.enabled ? 'checked' : ''} data-toggle><i></i></label>
        <button class="btn danger sm icon" data-del>${icon('trash')}</button></div>`).join('')}</div>`;
      stagger($('.col', box));
      $$('.installed-row', box).forEach(row => {
        const file = row.dataset.file;
        $('[data-toggle]', row).onchange = async () => { await nore.content.toggle({ instanceId: i.id, kind: cfg.kind, file }); load(); };
        $('[data-del]', row).onclick = async () => {
          if (!(await confirmModal('Usunąć plik?', file, { ok: 'Usuń', danger: true }))) return;
          await nore.content.remove({ instanceId: i.id, kind: cfg.kind, file });
          load();
        };
      });
    };
    load();
  }

  async function worldsTab(page, i) {
    page.innerHTML = '<div class="grid cols-2" id="w"><div class="skeleton"></div><div class="skeleton"></div></div>';
    const worlds = await nore.instances.worldsInfo(i.id);
    if (!alive) return;
    const box = $('#w', page);
    if (!worlds.length) { box.outerHTML = `<div class="card empty">${icon('globe')}<div>Brak światów — zagraj, aby stworzyć pierwszy.</div></div>`; return; }
    box.innerHTML = worlds.map(w => `<div class="card hover world-card" data-w="${esc(w.name)}">
      <div class="world-icon">${w.icon ? `<img src="${w.icon}" alt="">` : icon('globe')}</div>
      <div style="flex:1;min-width:0"><b>${esc(w.name)}</b><div class="muted" style="font-size:12px">${fmtBytes(w.size)} • ${fmtAgo(w.lastPlayed)}</div>
        <div class="row" style="gap:6px;margin-top:10px">
          <button class="btn sm" data-a="backup">${icon('download')} Kopia</button>
          <button class="btn ghost sm icon" data-a="open" title="Folder">${icon('folder')}</button>
          <button class="btn ghost sm" data-a="dp">${icon('database')} Datapacki</button>
          <button class="btn danger sm icon" data-a="del" title="Usuń">${icon('trash')}</button></div></div></div>`).join('');
    stagger(box);
    $$('.world-card', box).forEach(card => {
      const w = card.dataset.w;
      card.onclick = async (e) => {
        const a = e.target.closest('[data-a]');
        if (!a) return;
        if (a.dataset.a === 'open') nore.instances.folder(i.id, `saves/${w}`);
        if (a.dataset.a === 'dp') { await nore.instances.select(i.id); await App.refresh(); go('datapacks'); }
        if (a.dataset.a === 'backup') {
          a.disabled = true; a.innerHTML = '<span class="spinner"></span>';
          try { const f = await nore.instances.backupWorld(i.id, w); toast('Kopia zapasowa gotowa', f.split(/[\\/]/).pop(), 'success'); }
          catch (err) { errorToast(err); }
          a.disabled = false; a.innerHTML = `${icon('download')} Kopia`;
        }
        if (a.dataset.a === 'del' && await confirmModal('Usunąć świat?', `Świat „${w}” zostanie trwale usunięty.`, { ok: 'Usuń', danger: true })) {
          await nore.instances.deleteWorld(i.id, w);
          worldsTab(page, i);
        }
      };
    });
  }

  async function screensTab(page, i) {
    page.innerHTML = '<div class="shots" id="s"><div class="skeleton" style="height:140px"></div></div>';
    const shots = await nore.instances.screenshots(i.id);
    if (!alive) return;
    const box = $('#s', page);
    if (!shots.length) { box.outerHTML = `<div class="card empty">${icon('image')}<div>Brak zrzutów ekranu — w grze naciśnij <span class="kbd">F2</span>.</div></div>`; return; }
    box.innerHTML = shots.map(s => `<div class="shot card hover" data-n="${esc(s.name)}"><img src="${s.data}" alt=""><div class="shot-meta"><span>${esc(s.name)}</span><button class="btn danger sm icon" data-del>${icon('trash')}</button></div></div>`).join('');
    stagger(box);
    $$('.shot', box).forEach(sh => {
      const n = sh.dataset.n;
      $('img', sh).onclick = () => {
        const v = modal(`<img src="${$('img', sh).src}" style="width:100%;border-radius:12px" alt=""><div class="foot"><button class="btn ghost" data-close>Zamknij</button></div>`);
        v.el.style.width = 'min(1000px, calc(100vw - 60px))';
      };
      $('[data-del]', sh).onclick = async () => {
        if (!(await confirmModal('Usunąć zrzut?', n, { ok: 'Usuń', danger: true }))) return;
        await nore.instances.deleteScreenshot(i.id, n);
        sh.remove();
      };
    });
  }

  function settingsTab(page, i) {
    const maxMem = Math.max(4096, App.info.totalMemMb - 1024);
    page.innerHTML = `<div class="grid cols-2 stagger">
      <div class="card panel"><div class="section-title">${icon('cpu')} Pamięć i Java</div>
        <div class="setting"><div class="col"><b>RAM dla tej instancji</b><span>0 = jak w ustawieniach launchera</span></div></div>
        <div class="row" style="padding-bottom:12px"><input type="range" class="slider" id="mem" min="0" max="${maxMem}" step="512" value="${i.memoryMb || 0}" style="flex:1"><div class="value-pill" id="memv"></div></div>
        <div class="field"><label>Dodatkowe argumenty JVM</label><input class="input" id="jvm" value="${esc(i.jvmArgs || '')}" placeholder="np. -XX:+UseZGC"></div></div>
      <div class="card panel"><div class="section-title">${icon('monitor')} Okno i serwer</div>
        <div class="setting"><div class="col"><b>Rozdzielczość</b><span>0 = domyślna</span></div>
          <input class="input" id="w" value="${i.width || 0}" style="width:80px"> × <input class="input" id="h" value="${i.height || 0}" style="width:80px"></div>
        <div class="field" style="margin-top:12px"><label>Automatycznie dołącz do serwera</label><input class="input" id="server" value="${esc(i.joinServer || '')}" placeholder="np. play.serwer.pl"></div></div>
    </div>`;
    stagger($('.grid', page));
    const r = $('#mem', page);
    const upd = () => { $('#memv', page).textContent = +r.value ? (r.value / 1024).toFixed(1) + ' GB' : 'Domyślnie'; sliderFill(r); };
    r.oninput = upd; upd();
    const save = async (patch) => { await nore.instances.update(i.id, patch); await App.refresh(); toast('Zapisano', '', 'success', 1500); };
    r.onchange = () => save({ memoryMb: +r.value });
    $('#jvm', page).onchange = (e) => save({ jvmArgs: e.target.value.trim() });
    $('#w', page).onchange = (e) => save({ width: Math.max(0, parseInt(e.target.value, 10) || 0) });
    $('#h', page).onchange = (e) => save({ height: Math.max(0, parseInt(e.target.value, 10) || 0) });
    $('#server', page).onchange = (e) => save({ joinServer: e.target.value.trim() });
  }

  renderHeader();
  renderTab();
  const off = App.onChange(() => { if (inst()) renderHeader(); });
  return () => { alive = false; off(); };
};

// ================================================================== SERVERS (BETA)

const SERVER_TYPES = [{ value: 'vanilla', label: 'Vanilla' }, { value: 'paper', label: 'Paper' }, { value: 'fabric', label: 'Fabric' }];
const STATE_LABEL = { stopped: 'Wyłączony', starting: 'Uruchamianie…', running: 'Działa', stopping: 'Zatrzymywanie…' };

Pages.servers = (root) => {
  let alive = true;
  const progress = {};
  const render = async () => {
    const list = await nore.servers.list();
    if (!alive) return;
    root.innerHTML = `<div class="page-head"><div><h2>Serwery <span class="tag accent" style="vertical-align:middle;font-size:12px">BETA</span></h2>
      <p>Uruchom własny serwer Minecraft na swoim komputerze — Vanilla, Paper albo Fabric.</p></div>
      <div class="actions"><button class="btn" id="new">${icon('plus')} Nowy serwer</button></div></div>
      <div class="grid cols-2" id="grid"></div>`;
    const grid = $('#grid', root);
    grid.innerHTML = list.map(s => `<div class="card hover server-card ${s.state}" data-id="${s.id}">
        <div class="row"><div class="srv-ico">${icon('globe')}</div>
          <div style="flex:1;min-width:0"><h3 style="font-size:17px">${esc(s.name)}</h3>
            <div class="row" style="gap:6px;margin-top:6px"><span class="tag offline">${esc(s.mcVersion)}</span><span class="tag accent">${esc(SERVER_TYPES.find(t => t.value === s.type).label)}</span><span class="tag offline">:${s.port}</span></div></div>
          <div class="srv-state"><i></i>${STATE_LABEL[s.state] || s.state}</div></div>
        <div class="srv-progress muted" style="font-size:12px;margin-top:10px;min-height:16px">${s.state === 'running' ? `${icon('users')} ${s.players.length} graczy online` : progress[s.id] || ''}</div>
        <div class="row" style="margin-top:12px;gap:8px">
          ${s.state === 'stopped' ? `<button class="btn sm success" data-a="start">${icon('play')} Start</button>` : `<button class="btn sm danger" data-a="stop" ${s.state === 'stopping' ? 'disabled' : ''}>${icon('stop')} Stop</button>`}
          <button class="btn sm" data-a="open">${icon('terminal')} Konsola</button>
          ${s.state === 'running' ? `<button class="btn sm" data-a="join">${icon('arrowRight')} Dołącz</button>` : ''}
          <span class="spacer"></span>
          <button class="btn ghost sm icon" data-a="folder" title="Folder">${icon('folder')}</button>
          <button class="btn danger sm icon" data-a="del" title="Usuń" ${s.state !== 'stopped' ? 'disabled' : ''}>${icon('trash')}</button></div></div>`).join('')
      + `<div class="card hover new-card" id="new2" style="min-height:170px"><div style="text-align:center"><div class="plus">${icon('plus')}</div><b>Nowy serwer</b><div class="muted" style="font-size:12px;margin-top:4px">Gotowy w minutę</div></div></div>`;
    stagger(grid);
    $('#new', root).onclick = $('#new2', root).onclick = () => createServerModal(render);
    $$('.server-card', grid).forEach(card => {
      const id = card.dataset.id;
      const s = list.find(x => x.id === id);
      card.onclick = async (e) => {
        const a = e.target.closest('[data-a]');
        if (!a) return go('server', { id });
        e.stopPropagation();
        try {
          if (a.dataset.a === 'start') { await startServer(s); }
          if (a.dataset.a === 'stop') await nore.servers.stop(id);
          if (a.dataset.a === 'open') go('server', { id });
          if (a.dataset.a === 'folder') nore.servers.folder(id);
          if (a.dataset.a === 'join') joinServer(s);
          if (a.dataset.a === 'del' && await confirmModal('Usunąć serwer?', `„${s.name}” zostanie usunięty razem ze światem.`, { ok: 'Usuń', danger: true })) {
            await nore.servers.remove(id); render();
          }
        } catch (err) { errorToast(err); }
      };
    });
  };
  const offs = [
    nore.on('server:state', () => alive && !$('.modal-backdrop') && render()),
    nore.on('server:progress', (p) => {
      if (p.done) delete progress[p.id]; else progress[p.id] = p.stage + (p.total ? ` (${Math.round((p.bytes / Math.max(1, p.totalBytes)) * 100) || Math.round(p.done / p.total * 100)}%)` : '');
      const el2 = $(`.server-card[data-id="${p.id}"] .srv-progress`, root);
      if (el2) el2.textContent = progress[p.id] || '';
    }),
  ];
  render();
  return () => { alive = false; offs.forEach(o => o()); };
};

async function startServer(s) {
  if (!s.eula) {
    const ok = await confirmModal('EULA Minecraft', 'Aby uruchomić serwer, musisz zaakceptować umowę licencyjną Minecraft (aka.ms/MinecraftEULA). Akceptujesz?', { ok: 'Akceptuję EULA' });
    if (!ok) return;
    await nore.servers.update(s.id, { eula: true });
  }
  toast('Uruchamianie serwera', s.name);
  nore.servers.start(s.id).catch(e => errorToast(e, 'Serwer nie wystartował'));
}

async function joinServer(s) {
  const inst = App.instance();
  if (!inst) return toast('Brak instancji', 'Utwórz instancję, aby dołączyć.', 'error');
  if (inst.mcVersion !== s.mcVersion) toast('Uwaga', `Instancja ma wersję ${inst.mcVersion}, a serwer ${s.mcVersion}.`, 'error', 5000);
  try {
    await nore.game.launch(inst.id, { joinServer: `localhost:${s.port}` });
    toast('Dołączanie', `${inst.name} → localhost:${s.port}`, 'success');
  } catch (e) { errorToast(e); }
}

function createServerModal(done) {
  const m = modal(`<h3>Nowy serwer <span class="tag accent" style="font-size:11px">BETA</span></h3><p class="sub">Serwer działa na Twoim komputerze — znajomi w sieci LAN dołączą po Twoim IP.</p>
    <div class="field"><label>Nazwa</label><input class="input" id="name" placeholder="Mój serwer" maxlength="32"></div>
    <div class="field"><label>Silnik</label><div id="type"></div>
      <span class="hint">Vanilla – oficjalny • Paper – szybki, wtyczki • Fabric – mody serwerowe</span></div>
    <div class="row" style="gap:12px"><div class="field" style="flex:1"><label>Wersja</label><select class="input" id="ver"><option>Ładowanie…</option></select></div>
      <div class="field" style="width:130px"><label>Port</label><input class="input" id="port" value="25565"></div></div>
    <div class="field"><label>Pamięć RAM</label><div class="row"><input type="range" class="slider" id="mem" min="1024" max="${Math.max(4096, App.info.totalMemMb - 2048)}" step="512" value="2048" style="flex:1"><div class="value-pill" id="memv"></div></div></div>
    <div class="setting" style="padding:10px 0"><div class="col"><b>Gracze non-premium</b><span>Wyłącza online-mode (wymagane dla kont non-premium)</span></div><label class="switch"><input type="checkbox" id="offline" checked><i></i></label></div>
    <div class="setting" style="padding:10px 0"><div class="col"><b>Akceptuję EULA Minecraft</b><span><a href="#" id="eula-link">aka.ms/MinecraftEULA</a></span></div><label class="switch"><input type="checkbox" id="eula"><i></i></label></div>
    <div class="foot"><button class="btn ghost" data-close>Anuluj</button><button class="btn" id="create">${icon('plus')} Utwórz</button></div>`);
  let type = 'paper';
  $('#type', m.el).appendChild(segmented(SERVER_TYPES, type, (v) => { type = v; }));
  $('#eula-link', m.el).onclick = (e) => { e.preventDefault(); nore.open('https://aka.ms/MinecraftEULA'); };
  const r = $('#mem', m.el);
  const upd = () => { $('#memv', m.el).textContent = (r.value / 1024).toFixed(1) + ' GB'; sliderFill(r); };
  r.oninput = upd; upd();
  nore.versions.list({ snapshots: false }).then(res => {
    $('#ver', m.el).innerHTML = res.versions.map(v => `<option ${v.id === '1.21.1' ? 'selected' : ''}>${esc(v.id)}</option>`).join('');
  }).catch(() => {});
  $('#create', m.el).onclick = async () => {
    const port = parseInt($('#port', m.el).value, 10);
    if (!(port > 1024 && port < 65536)) return toast('Nieprawidłowy port', 'Podaj liczbę 1025–65535', 'error');
    const srv = await nore.servers.create({
      name: $('#name', m.el).value.trim() || `Serwer ${$('#ver', m.el).value}`, mcVersion: $('#ver', m.el).value, type,
      memoryMb: +r.value, port, eula: $('#eula', m.el).checked,
    });
    await nore.servers.update(srv.id, { props: { 'online-mode': !$('#offline', m.el).checked } });
    m.close();
    toast('Utworzono serwer', srv.name, 'success');
    done && done();
  };
}

Pages.server = (root, { id }) => {
  let alive = true;
  let s = null;
  root.innerHTML = `<div id="shead"></div><div class="grid" style="grid-template-columns:1.6fr 1fr;gap:16px;margin-top:16px">
      <div class="card" style="display:flex;flex-direction:column;min-height:420px">
        <div class="console" id="log" style="height:auto;flex:1;min-height:340px"></div>
        <div class="row" style="padding:10px;border-top:1px solid var(--line)"><span class="dim">${icon('terminal')}</span>
          <input class="input" id="cmd" placeholder="Wpisz komendę serwera (np. op Steve, time set day)…" style="flex:1"><button class="btn sm" id="send">Wyślij</button></div></div>
      <div class="col" style="gap:16px">
        <div class="card panel"><div class="section-title">${icon('users')} Gracze online</div><div id="players" class="col" style="margin-top:10px"></div></div>
        <div class="card panel" id="props"></div>
      </div></div>`;
  const log = $('#log', root);
  const addLine = (l) => {
    const d = document.createElement('div');
    d.className = l.stream === 'err' || /ERROR|Exception/.test(l.line) ? 'err' : /WARN/.test(l.line) ? 'warn' : l.stream === 'cmd' ? 'launcher' : 'info';
    d.textContent = l.line;
    const stick = log.scrollTop + log.clientHeight >= log.scrollHeight - 30;
    log.appendChild(d);
    while (log.childElementCount > 2500) log.firstChild.remove();
    if (stick) log.scrollTop = log.scrollHeight;
  };

  const renderHead = async () => {
    s = (await nore.servers.list()).find(x => x.id === id);
    if (!s || !alive) return;
    $('#shead', root).innerHTML = `<div class="inst-hero card"><button class="btn ghost sm icon" id="back">${icon('arrowLeft')}</button>
      <div class="srv-ico" style="width:64px;height:64px">${icon('globe')}</div>
      <div style="flex:1"><h2 style="font-size:26px">${esc(s.name)} <span class="tag accent" style="font-size:11px;vertical-align:middle">BETA</span></h2>
        <div class="row" style="gap:6px;margin-top:8px"><span class="tag offline">${esc(s.mcVersion)}</span><span class="tag accent">${esc(SERVER_TYPES.find(t => t.value === s.type).label)}</span>
        <span class="tag offline">localhost:${s.port}</span><span class="srv-state ${s.state}"><i></i>${STATE_LABEL[s.state]}</span></div></div>
      <div class="row">${s.state === 'stopped' ? `<button class="btn success" id="start">${icon('play')} Start</button>` : `<button class="btn danger" id="stop">${icon('stop')} Stop</button>`}
        ${s.state === 'running' ? `<button class="btn" id="join">${icon('arrowRight')} Dołącz</button>` : ''}
        <button class="btn ghost icon" id="folder">${icon('folder')}</button></div></div>`;
    $('#back', root).onclick = () => go('servers');
    $('#folder', root).onclick = () => nore.servers.folder(id);
    if ($('#start', root)) $('#start', root).onclick = () => startServer(s);
    if ($('#stop', root)) $('#stop', root).onclick = () => nore.servers.stop(id);
    if ($('#join', root)) $('#join', root).onclick = () => joinServer(s);
    $('#players', root).innerHTML = s.players.length
      ? s.players.map(p => `<div class="row"><div class="avatar" style="width:28px;height:28px">${esc(p[0])}<img src="https://mc-heads.net/avatar/${encodeURIComponent(p)}/32" data-fallback alt=""></div><b>${esc(p)}</b>
          <span class="spacer"></span><button class="btn ghost sm" data-op="${esc(p)}">OP</button><button class="btn danger sm" data-kick="${esc(p)}">Wyrzuć</button></div>`).join('')
      : `<div class="muted" style="font-size:13px">${s.state === 'running' ? 'Nikogo jeszcze nie ma.' : 'Serwer jest wyłączony.'}</div>`;
    $$('[data-op]', root).forEach(b => b.onclick = () => nore.servers.command(id, 'op ' + b.dataset.op));
    $$('[data-kick]', root).forEach(b => b.onclick = () => nore.servers.command(id, 'kick ' + b.dataset.kick));
    renderProps();
  };

  const renderProps = () => {
    const p = s.props;
    const box = $('#props', root);
    if (box.dataset.ready) return;
    box.dataset.ready = '1';
    box.innerHTML = `<div class="section-title">${icon('settings')} Ustawienia serwera</div>
      <div class="field" style="margin-top:10px"><label>MOTD (opis na liście serwerów)</label><input class="input" data-p="motd" value="${esc(p.motd)}"></div>
      <div class="row" style="gap:10px"><div class="field" style="flex:1"><label>Tryb gry</label><select class="input" data-p="gamemode">${['survival', 'creative', 'adventure', 'spectator'].map(g => `<option ${p.gamemode === g ? 'selected' : ''}>${g}</option>`).join('')}</select></div>
        <div class="field" style="flex:1"><label>Trudność</label><select class="input" data-p="difficulty">${['peaceful', 'easy', 'normal', 'hard'].map(g => `<option ${p.difficulty === g ? 'selected' : ''}>${g}</option>`).join('')}</select></div></div>
      <div class="row" style="gap:10px"><div class="field" style="flex:1"><label>Maks. graczy</label><input class="input" data-p="max-players" value="${p['max-players']}"></div>
        <div class="field" style="flex:1"><label>Zasięg widzenia</label><input class="input" data-p="view-distance" value="${p['view-distance']}"></div></div>
      ${[['pvp', 'PvP'], ['online-mode', 'Tylko premium (online-mode)'], ['white-list', 'Biała lista'], ['allow-flight', 'Zezwól na latanie'], ['hardcore', 'Hardcore']].map(([k, l]) => `
        <div class="setting" style="padding:8px 0"><div class="col"><b style="font-size:13px">${l}</b></div><label class="switch"><input type="checkbox" data-b="${k}" ${p[k] ? 'checked' : ''}><i></i></label></div>`).join('')}
      <div class="muted" style="font-size:12px;margin-top:6px">Zmiany zadziałają po ponownym uruchomieniu serwera.</div>`;
    $$('[data-p]', box).forEach(inp => inp.onchange = async () => {
      let v = inp.value;
      if (/^\d+$/.test(v) && inp.dataset.p !== 'motd') v = parseInt(v, 10);
      await nore.servers.update(id, { props: { [inp.dataset.p]: v } });
      toast('Zapisano', inp.dataset.p, 'success', 1500);
    });
    $$('[data-b]', box).forEach(inp => inp.onchange = async () => {
      await nore.servers.update(id, { props: { [inp.dataset.b]: inp.checked } });
      toast('Zapisano', inp.dataset.b, 'success', 1500);
    });
  };

  const send = async () => {
    const v = $('#cmd', root).value.trim();
    if (!v) return;
    try { await nore.servers.command(id, v); $('#cmd', root).value = ''; } catch (e) { errorToast(e); }
  };
  $('#send', root).onclick = send;
  $('#cmd', root).onkeydown = (e) => { if (e.key === 'Enter') send(); };

  nore.servers.logs(id).then(lines => {
    if (!lines.length) log.innerHTML = `<div class="empty">${icon('terminal')}<div>Uruchom serwer, aby zobaczyć konsolę.</div></div>`;
    lines.forEach(addLine);
    log.scrollTop = log.scrollHeight;
  });
  const offs = [
    nore.on('server:log', (l) => { if (l.id !== id) return; if ($('.empty', log)) log.innerHTML = ''; addLine(l); }),
    nore.on('server:state', (st) => { if (st.id === id) renderHead(); }),
    nore.on('server:progress', (p) => { if (p.id === id && !p.done && p.stage) addLine({ line: '[Launcher] ' + p.stage + (p.total ? ` ${p.done}/${p.total}` : ''), stream: 'cmd' }); }),
  ];
  renderHead();
  return () => { alive = false; offs.forEach(o => o()); };
};

// ================================================================== downloaded versions (storage) – injected into settings

const _settingsPage = Pages.settings;
Pages.settings = (root) => {
  const cleanup = _settingsPage(root);
  const card = el(`<div class="card panel" style="margin-top:16px"><div class="section-title">${icon('database')} Pobrane wersje i miejsce na dysku</div>
    <div id="storage" class="row" style="gap:10px;flex-wrap:wrap;margin:12px 0"></div><div id="vlist" class="col" style="gap:8px"><div class="skeleton" style="height:60px"></div></div></div>`);
  root.appendChild(card);
  const load = async () => {
    const [st, vers] = await Promise.all([nore.versions.storage(), nore.versions.installed()]);
    $('#storage', card).innerHTML = [['Wersje', st.versions], ['Biblioteki', st.libraries], ['Zasoby', st.assets], ['Java', st.runtime], ['Instancje', st.instances]]
      .map(([l, v]) => `<div class="stat card" style="padding:10px 14px"><b style="font-size:17px">${fmtBytes(v)}</b><span>${l}</span></div>`).join('');
    $('#vlist', card).innerHTML = vers.length ? vers.map(v => `<div class="installed-row card" data-v="${esc(v.id)}">
        <div class="news-item" style="padding:0;background:none;border:0"><div class="ico">${icon(v.fabric ? 'zap' : 'box')}</div></div>
        <div style="flex:1"><b>${esc(v.id)}</b><div class="muted" style="font-size:12px">${fmtBytes(v.size)}${v.usedBy.length ? ' • używana przez: ' + esc(v.usedBy.join(', ')) : ' • nieużywana'}</div></div>
        <button class="btn danger sm" data-del>${icon('trash')} Usuń</button></div>`).join('')
      : '<div class="muted">Nie pobrano jeszcze żadnej wersji.</div>';
    $$('#vlist [data-del]', card).forEach(b => b.onclick = async () => {
      const id = b.closest('[data-v]').dataset.v;
      if (!(await confirmModal('Usunąć wersję?', `${id} zostanie usunięta. Pobierze się ponownie przy następnym uruchomieniu.`, { ok: 'Usuń', danger: true }))) return;
      await nore.versions.remove(id);
      load();
    });
  };
  load();
  return cleanup;
};
