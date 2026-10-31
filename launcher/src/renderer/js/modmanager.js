'use strict';
/*
 * Mod manager shared by the instance "Mody" tab and the server "Dodatki" tab: details (version,
 * loader, source, size, dependencies and who depends on a mod), enable / disable, filters, sort,
 * search, bulk actions, version pins, updates with changelogs, conflict and missing-dependency
 * warnings, mod list export, .mrpack / CurseForge export, mod profiles and the config editor.
 * The logic lives in the main process (mod-manager.js); this file only draws it.
 */

Object.assign(ICONS, {
  pin: '<path d="M12 17v5"/><path d="M9 3h6l-1 6 3 3v2H7v-2l3-3-1-6z"/>',
  alert: '<path d="M12 3 2 20h20L12 3z"/><path d="M12 10v4"/><path d="M12 17.5v.5"/>',
  filter: '<path d="M3 5h18l-7 8v6l-4 2v-8L3 5z"/>',
});

const MM_SIDE = { client: ['Klient', 'Działa tylko w grze – na serwerze niepotrzebny albo wysypie serwer'], server: ['Serwer', 'Działa tylko na serwerze'], both: ['Klient + serwer', 'Potrzebny po obu stronach'], unknown: ['?', 'Autor nie podał, po której stronie działa'] };
const MM_LOADER = { fabric: 'Fabric', quilt: 'Quilt', forge: 'Forge', neoforge: 'NeoForge', bukkit: 'Bukkit', paper: 'Paper', velocity: 'Velocity', bungeecord: 'BungeeCord' };
const MM_SOURCE = { modrinth: 'Modrinth', curseforge: 'CurseForge', hangar: 'Hangar' };

const ModManager = {
  /**
   * Draws the manager into root. target: { instanceId } | { serverId, kind }. opts: {
   *   title, browse(): open the content browser, exportPack: bool (instances), running: bool,
   *   updates(): Promise<[]>, applyUpdates(list): Promise, onChange() }.
   */
  mount(root, target, opts = {}) {
    let alive = true;
    let data = { mods: [], warnings: [], profiles: [] };
    let identified = false;
    let ups = null; // updates found by "Sprawdź aktualizacje"
    const sel = new Set();
    const open = new Set();
    const f = { query: '', state: 'all', side: 'all', sort: 'name' };
    const noun = target.kind === 'plugin' ? { one: 'plugin', many: 'pluginy', gen: 'pluginów' } : { one: 'mod', many: 'mody', gen: 'modów' };

    root.innerHTML = `<div class="mm">
      <div class="mm-bar">
        <div class="mm-search">${icon('search')}<input class="input" id="mm-q" placeholder="Szukaj ${noun.gen}…"></div>
        <select class="input sm" id="mm-state" title="Stan"><option value="all">Wszystkie</option><option value="enabled">Włączone</option><option value="disabled">Wyłączone</option><option value="problems">Z problemami</option><option value="pinned">Przypięte</option></select>
        <select class="input sm" id="mm-side" title="Strona"><option value="all">Każda strona</option><option value="client">Tylko klient</option><option value="server">Tylko serwer</option><option value="both">Klient + serwer</option><option value="unknown">Nieznana</option></select>
        <select class="input sm" id="mm-sort" title="Sortuj"><option value="name">Nazwa</option><option value="size">Rozmiar</option><option value="dependents">Najczęściej wymagane</option><option value="state">Włączone najpierw</option></select>
        <span class="spacer"></span>
        <button class="btn ghost sm" id="mm-upd">${icon('refresh')} Aktualizacje</button>
        <div class="mm-menu"><button class="btn ghost sm" data-menu="prof">${icon('layers')} Profile</button></div>
        <div class="mm-menu"><button class="btn ghost sm" data-menu="exp">${icon('upload')} Eksport</button></div>
        <button class="btn ghost sm" id="mm-cfg">${icon('settings')} Konfiguracja</button>
        ${opts.browse ? `<button class="btn sm" id="mm-add">${icon('plus')} Dodaj</button>` : ''}
      </div>
      <div id="mm-warn"></div>
      <div class="mm-bulk" id="mm-bulk"></div>
      <div id="mm-list"><div class="skeleton" style="height:64px"></div><div class="skeleton" style="height:64px;margin-top:8px"></div></div>
    </div>`;
    const $r = (s) => $(s, root);

    const load = async (withIds) => {
      try {
        data = await (withIds ? nore.mods.identify(target) : nore.mods.list(target));
        if (withIds) identified = true;
      } catch (e) { errorToast(e); }
      if (!alive) return;
      for (const s of [...sel]) if (!data.mods.some(m => m.file === s)) sel.delete(s);
      draw();
    };

    // ---------------------------------------------------------------- drawing
    const filtered = () => {
      const q = f.query.trim().toLowerCase();
      let list = data.mods.filter(m => {
        if (q && !`${m.name} ${m.file} ${m.id || ''} ${(m.authors || []).join(' ')}`.toLowerCase().includes(q)) return false;
        if (f.state === 'enabled' && !m.enabled) return false;
        if (f.state === 'disabled' && m.enabled) return false;
        if (f.state === 'problems' && !(m.missing.length || m.conflicts.length)) return false;
        if (f.state === 'pinned' && !m.pinned) return false;
        if (f.side !== 'all' && m.side !== f.side) return false;
        return true;
      });
      const by = { size: (a, b) => b.size - a.size, dependents: (a, b) => b.dependents.length - a.dependents.length || a.name.localeCompare(b.name, 'pl'), state: (a, b) => (a.enabled === b.enabled ? a.name.localeCompare(b.name, 'pl') : a.enabled ? -1 : 1) }[f.sort];
      if (by) list = list.slice().sort(by);
      return list;
    };

    const upFor = (m) => (ups || []).find(u => u.oldFile === m.file);

    function warnHtml() {
      const w = data.warnings || [];
      if (!w.length) return '';
      const label = (x) => ({
        missing: `<b>${esc(x.name)}</b> wymaga <b>${esc(x.dep)}</b>${x.disabled ? ` – jest wyłączony (${esc(x.disabled)})` : ' – brak w folderze'}`,
        conflict: `<b>${esc(x.name)}</b> nie działa razem z <b>${esc(x.other)}</b>`,
        duplicate: `<b>${esc(x.name)}</b> jest dwa razy (${esc(x.file)} i ${esc(x.other)}) – zostaw jedną wersję`,
        client: `<b>${esc(x.name)}</b> działa tylko w grze – na serwerze zostanie wyłączony`,
        loader: `<b>${esc(x.name)}</b> jest dla ${esc(MM_LOADER[x.loader] || x.loader)} – nie zadziała z tym loaderem`,
      }[x.type] || esc(x.type));
      const bad = w.filter(x => x.type !== 'client').length;
      return `<div class="mm-warn ${bad ? 'bad' : ''}">${icon('alert')}<div><b>${bad ? `Problemy: ${bad}` : 'Uwagi'}</b>
        <ul>${w.slice(0, 8).map(x => `<li>${label(x)}${x.type === 'missing' && x.disabled ? ` <button class="btn ghost sm" data-fixon="${esc(x.disabled)}">Włącz</button>` : ''}</li>`).join('')}${w.length > 8 ? `<li class="muted">…i ${w.length - 8} więcej (filtr „Z problemami”)</li>` : ''}</ul></div></div>`;
    }

    function rowHtml(m) {
      const side = MM_SIDE[m.side] || MM_SIDE.unknown;
      const up = upFor(m);
      const problems = m.missing.length + m.conflicts.length;
      return `<div class="mm-row ${m.enabled ? '' : 'off'} ${open.has(m.file) ? 'open' : ''}" data-file="${esc(m.file)}">
        <div class="mm-main">
          <label class="mm-check"><input type="checkbox" data-sel ${sel.has(m.file) ? 'checked' : ''}><i></i></label>
          ${m.icon ? `<img class="mm-ico" src="${esc(m.icon)}" alt="" data-fallback>` : `<div class="mm-ico ph">${icon(target.kind === 'plugin' ? 'plug' : 'puzzle')}</div>`}
          <div class="mm-name"><div class="mm-title"><b>${esc(m.name)}</b><span class="muted">${esc(m.version || '')}</span>${m.pinned ? `<span class="mm-pin" title="Przypięta wersja – bez aktualizacji">${icon('pin')}</span>` : ''}</div>
            <div class="mm-tags"><span class="mm-side ${m.side}" title="${esc(side[1])}">${esc(side[0])}</span>
              ${m.loader ? `<span class="tag offline">${esc(MM_LOADER[m.loader] || m.loader)}</span>` : ''}
              ${m.source ? `<span class="tag offline">${esc(MM_SOURCE[m.source] || m.source)}</span>` : ''}
              ${m.dependents.length ? `<span class="tag offline" title="${esc(m.dependents.map(d => d.name).join(', '))}">wymagany przez ${m.dependents.length}</span>` : ''}
              ${problems ? `<span class="tag danger">${icon('alert')} ${problems === 1 ? '1 problem' : problems + ' problemy'}</span>` : ''}
              ${up ? `<span class="tag upd">${icon('download')} ${esc(up.version)}</span>${versionTypeTag(up.type)}` : ''}</div></div>
          <span class="mm-size muted">${fmtBytes(m.size)}</span>
          <button class="btn ghost sm icon" data-pin title="${m.pinned ? 'Odepnij – pozwól aktualizować' : 'Nie aktualizuj (przypnij tę wersję)'}">${icon('pin')}</button>
          <button class="btn ghost sm icon" data-more title="Szczegóły">${icon('info')}</button>
          <label class="switch" title="${m.enabled ? 'Wyłącz' : 'Włącz'}"><input type="checkbox" data-tog ${m.enabled ? 'checked' : ''}><i></i></label>
          <button class="btn danger sm icon" data-del title="Usuń">${icon('trash')}</button>
        </div>
        ${open.has(m.file) ? detailHtml(m) : ''}
      </div>`;
    }

    function detailHtml(m) {
      const dep = (d) => {
        const miss = m.missing.find(x => x.id === d);
        return `<span class="chip ${miss ? 'bad' : ''}" title="${miss ? (miss.disabled ? 'Wyłączony' : 'Brak') : 'Jest'}">${esc(d)}${miss ? ' ✕' : ''}</span>`;
      };
      const deps = (m.depends || []).filter(d => !['minecraft', 'java', 'fabricloader', 'forge', 'neoforge', 'quilt_loader'].includes(String(d).toLowerCase()));
      const up = upFor(m);
      return `<div class="mm-detail">
        <div class="mm-grid">
          <div><span>Plik</span><b>${esc(m.file)}</b></div><div><span>Id</span><b>${esc(m.id || '–')}</b></div>
          <div><span>Wersja</span><b>${esc(m.version || '–')}</b></div><div><span>Loader</span><b>${esc(MM_LOADER[m.loader] || m.loader || '–')}</b></div>
          <div><span>Źródło</span><b>${esc(MM_SOURCE[m.source] || (identified ? 'Plik własny' : '…'))}</b></div><div><span>Rozmiar</span><b>${fmtBytes(m.size)}</b></div>
          <div><span>Strona</span><b>${esc((MM_SIDE[m.side] || MM_SIDE.unknown)[1])}</b></div><div><span>Autorzy</span><b>${esc((m.authors || []).join(', ') || '–')}</b></div>
        </div>
        ${m.description ? `<p class="mm-desc">${esc(m.description)}</p>` : ''}
        <div class="mm-deps"><span>Wymaga</span><div>${deps.length ? deps.map(dep).join('') : '<span class="muted">nic poza grą i loaderem</span>'}</div></div>
        ${(m.optional || []).length ? `<div class="mm-deps"><span>Opcjonalnie</span><div>${m.optional.map(d => `<span class="chip">${esc(d)}</span>`).join('')}</div></div>` : ''}
        <div class="mm-deps"><span>Wymagany przez</span><div>${m.dependents.length ? m.dependents.map(d => `<span class="chip on">${esc(d.name)}</span>`).join('') : '<span class="muted">żaden inny ' + noun.one + '</span>'}</div></div>
        ${m.conflicts.length ? `<div class="mm-deps"><span>Konflikty</span><div>${m.conflicts.map(d => `<span class="chip bad">${esc(d.name)}</span>`).join('')}</div></div>` : ''}
        <div class="row" style="gap:8px;margin-top:10px">
          ${m.projectId ? `<button class="btn ghost sm" data-page>${icon('external')} Strona projektu</button>` : ''}
          <button class="btn ghost sm" data-pin2>${icon('pin')} ${m.pinned ? 'Pozwól aktualizować' : 'Nie aktualizuj'}</button>
          ${up ? `<button class="btn sm" data-up1>${icon('download')} Aktualizuj do ${esc(up.version)}</button>` : ''}
        </div>
      </div>`;
    }

    function bulkHtml() {
      if (!sel.size) return '';
      const list = data.mods.filter(m => sel.has(m.file));
      const updatable = (ups || []).filter(u => sel.has(u.oldFile));
      return `<div class="mm-bulkbar"><b>Zaznaczone: ${sel.size}</b>
        <button class="btn ghost sm" data-bulk="enable" ${list.every(m => m.enabled) ? 'disabled' : ''}>Włącz</button>
        <button class="btn ghost sm" data-bulk="disable" ${list.every(m => !m.enabled) ? 'disabled' : ''}>Wyłącz</button>
        ${updatable.length ? `<button class="btn sm" data-bulk="update">${icon('download')} Aktualizuj (${updatable.length})</button>` : ''}
        <button class="btn danger sm" data-bulk="remove">${icon('trash')} Usuń</button>
        <span class="spacer"></span><button class="btn ghost sm" data-bulk="none">Odznacz</button></div>`;
    }

    function draw() {
      $r('#mm-warn').innerHTML = warnHtml();
      $r('#mm-bulk').innerHTML = bulkHtml();
      const list = filtered();
      const box = $r('#mm-list');
      if (!data.mods.length) {
        box.innerHTML = `<div class="card empty">${icon(target.kind === 'plugin' ? 'plug' : 'puzzle')}<div>Brak ${noun.gen}.</div>${opts.browse ? `<button class="btn sm" id="mm-empty-add" style="margin-top:12px">${icon('search')} Znajdź ${noun.many}</button>` : ''}</div>`;
        if ($r('#mm-empty-add')) $r('#mm-empty-add').onclick = () => opts.browse();
      } else {
        const on = data.mods.filter(m => m.enabled).length;
        box.innerHTML = `<div class="mm-head"><label class="mm-check"><input type="checkbox" id="mm-all" ${list.length && list.every(m => sel.has(m.file)) ? 'checked' : ''}><i></i></label>
          <span class="muted">${data.mods.length} ${plural(data.mods.length, noun.one, noun.many, noun.gen)} • włączonych ${on}${list.length !== data.mods.length ? ` • widocznych ${list.length}` : ''}</span>
          ${data.profileActive ? `<span class="tag accent">${esc(data.profileActive)}</span>` : ''}</div>
          <div class="mm-rows">${list.map(rowHtml).join('') || '<div class="muted" style="padding:16px">Nic nie pasuje do filtrów.</div>'}</div>
          <div class="muted mm-foot">${opts.server ? 'Zmiany zadziałają po restarcie serwera.' : 'Zmiany zadziałają przy następnym uruchomieniu gry.'} Usunięte pliki trafiają do .nore-backup.</div>`;
        $r('#mm-all').onchange = (e) => { for (const m of list) { if (e.target.checked) sel.add(m.file); else sel.delete(m.file); } draw(); };
      }
      wire();
    }

    // ---------------------------------------------------------------- actions
    const busy = async (fn) => { try { await fn(); } catch (e) { errorToast(e); } await load(identified); opts.onChange && opts.onChange(); };

    function wire() {
      $$('[data-fixon]', root).forEach(b => b.onclick = () => busy(() => nore.mods.toggle(target, b.dataset.fixon, true)));
      $$('[data-bulk]', root).forEach(b => b.onclick = async () => {
        const action = b.dataset.bulk;
        const files = [...sel];
        if (action === 'none') { sel.clear(); return draw(); }
        if (action === 'update') return updatesModal((ups || []).filter(u => sel.has(u.oldFile)));
        if (action === 'remove') {
          const needed = data.mods.filter(m => sel.has(m.file) && m.dependents.some(d => !sel.has(d.file)));
          const extra = needed.length ? `\n\nUwaga: ${needed.map(m => m.name).join(', ')} ${needed.length === 1 ? 'jest wymagany' : 'są wymagane'} przez inne ${noun.many}.` : '';
          if (!(await confirmModal(`Usunąć ${files.length} ${plural(files.length, noun.one, noun.many, noun.gen)}?`, `Pliki trafią do folderu .nore-backup.${extra}`, { ok: 'Usuń', danger: true }))) return;
        }
        if (action === 'disable') {
          const needed = data.mods.filter(m => sel.has(m.file) && m.enabled && m.dependents.some(d => !sel.has(d.file)));
          if (needed.length && !(await confirmModal('Wyłączyć?', `${needed.map(m => m.name).join(', ')} ${needed.length === 1 ? 'jest wymagany' : 'są wymagane'} przez inne włączone ${noun.many}. Mogą przestać działać.`, { ok: 'Wyłącz mimo to' }))) return;
        }
        sel.clear();
        busy(async () => { const r = await nore.mods.bulk(target, files, action); toast(action === 'remove' ? 'Usunięto' : action === 'enable' ? 'Włączono' : 'Wyłączono', `${r.length} ${plural(r.length, 'plik', 'pliki', 'plików')}`, 'success', 1800); });
      });
      $$('.mm-row', root).forEach(row => {
        const file = row.dataset.file;
        const m = data.mods.find(x => x.file === file);
        if (!m) return;
        $('[data-sel]', row).onchange = (e) => { if (e.target.checked) sel.add(file); else sel.delete(file); $r('#mm-bulk').innerHTML = bulkHtml(); wire(); };
        $('[data-more]', row).onclick = () => { if (open.has(file)) open.delete(file); else open.add(file); draw(); };
        $('.mm-name', row).onclick = () => { if (open.has(file)) open.delete(file); else open.add(file); draw(); };
        const pin = () => busy(async () => { await nore.mods.pin(target, m.key, !m.pinned); toast(m.pinned ? 'Odpięto' : 'Przypięto wersję', `${m.name}${m.pinned ? '' : ' – launcher nie będzie go aktualizował'}`, 'success', 2200); });
        $('[data-pin]', row).onclick = pin;
        if ($('[data-pin2]', row)) $('[data-pin2]', row).onclick = pin;
        if ($('[data-page]', row)) $('[data-page]', row).onclick = () => nore.open(m.source === 'curseforge' ? `https://www.curseforge.com/projects/${String(m.projectId).replace(/^cf:/, '')}` : m.source === 'hangar' ? `https://hangar.papermc.io/${String(m.projectId).replace(/^hangar:/, '')}` : `https://modrinth.com/project/${m.projectId}`);
        if ($('[data-up1]', row)) $('[data-up1]', row).onclick = () => updatesModal([upFor(m)]);
        $('[data-tog]', row).onchange = async (e) => {
          const on = e.target.checked;
          if (!on && m.dependents.some(d => data.mods.find(x => x.file === d.file && x.enabled))) {
            if (!(await confirmModal(`Wyłączyć ${m.name}?`, `Wymagają go: ${m.dependents.map(d => d.name).join(', ')}. Bez niego mogą nie działać.`, { ok: 'Wyłącz' }))) { e.target.checked = true; return; }
          }
          busy(() => nore.mods.toggle(target, file, on));
        };
        $('[data-del]', row).onclick = async () => {
          const extra = m.dependents.length ? ` Wymagają go: ${m.dependents.map(d => d.name).join(', ')}.` : '';
          if (!(await confirmModal(`Usunąć ${m.name}?`, `${m.file} trafi do .nore-backup.${extra}`, { ok: 'Usuń', danger: true }))) return;
          busy(() => nore.mods.bulk(target, [file], 'remove'));
        };
      });
    }

    // updates (with changelogs)
    async function checkUpdates(btn) {
      btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Sprawdzanie';
      try {
        ups = (await opts.updates()) || [];
        const pinned = data.mods.filter(m => m.pinned).length;
        if (!ups.length) { btn.innerHTML = `${icon('check')} Aktualne`; toast('Wszystko aktualne', pinned ? `Przypięte (bez sprawdzania): ${pinned}` : `${noun.many[0].toUpperCase() + noun.many.slice(1)} są w najnowszych wersjach`, 'success'); }
        else { btn.innerHTML = `${icon('download')} Aktualizuj (${ups.length})`; btn.classList.remove('ghost'); }
      } catch (e) { errorToast(e); btn.innerHTML = `${icon('refresh')} Aktualizacje`; }
      btn.disabled = false;
      draw();
    }

    function updatesModal(list) {
      if (!list.length) return;
      const name = (u) => { const m = data.mods.find(x => x.file === u.oldFile); return m ? m.name : u.oldFile; };
      const m = modal(`<h3>Aktualizacje: ${list.length}</h3><p class="sub">Przeczytaj listę zmian przed aktualizacją. Stare pliki trafią do .nore-backup.</p>
        <div class="mm-ups">${list.map((u, k) => `<div class="mm-up" data-k="${k}"><label class="mm-check"><input type="checkbox" checked data-on><i></i></label>
          <div style="flex:1;min-width:0"><b>${esc(name(u))}</b> <span class="muted">${esc(u.oldFile)}</span> ${icon('arrowRight')} <b>${esc(u.version)}</b>${versionTypeTag(u.type)}
            ${u.source ? `<span class="tag offline">${esc(MM_SOURCE[u.source] || u.source)}</span>` : ''}
            <div class="mm-log" hidden></div></div>
          ${u.versionId && u.source !== 'hangar' ? `<button class="btn ghost sm" data-log>${icon('list')} Zmiany</button>` : ''}</div>`).join('')}</div>
        <div class="foot"><button class="btn ghost" data-close>Anuluj</button><button class="btn" id="mm-go">${icon('download')} Aktualizuj zaznaczone</button></div>`);
      $$('.mm-up', m.el).forEach(row => {
        const u = list[+row.dataset.k];
        const b = $('[data-log]', row);
        if (!b) return;
        b.onclick = async () => {
          const box = $('.mm-log', row);
          if (!box.hidden) { box.hidden = true; return; }
          box.hidden = false;
          box.textContent = 'Wczytywanie…';
          const t = await nore.mods.changelog(u).catch(() => '');
          box.textContent = (t || '').trim() || 'Autor nie dodał listy zmian.';
        };
      });
      $('#mm-go', m.el).onclick = async (e) => {
        const chosen = list.filter((u, k) => $(`.mm-up[data-k="${k}"] [data-on]`, m.el).checked);
        if (!chosen.length) return m.close();
        e.currentTarget.disabled = true; e.currentTarget.innerHTML = '<span class="spinner"></span> Aktualizowanie';
        try {
          await opts.applyUpdates(chosen);
          toast('Zaktualizowano', `${chosen.length} ${plural(chosen.length, 'plik', 'pliki', 'plików')}`, 'success');
          ups = (ups || []).filter(u => !chosen.includes(u));
        } catch (err) { errorToast(err); }
        m.close();
        sel.clear();
        load(identified);
      };
    }

    // profiles
    function profilesModal() {
      const m = modal(`<h3>${icon('layers')} Profile ${noun.gen}</h3>
        <p class="sub">Zapisz, które ${noun.many} są włączone, i przełączaj się jednym kliknięciem (np. „PvP”, „Budowanie”, „Lekki”). ${noun.many[0].toUpperCase() + noun.many.slice(1)} dodane później zachowują swój stan.</p>
        <div id="mm-profs"></div>
        <div class="row" style="gap:8px;margin-top:12px"><input class="input" id="mm-pname" placeholder="Nazwa nowego profilu" maxlength="40" style="flex:1"><button class="btn sm" id="mm-psave">${icon('plus')} Zapisz obecny układ</button></div>
        <div class="foot"><button class="btn ghost" data-close>Zamknij</button></div>`);
      const drawList = (profiles) => {
        $('#mm-profs', m.el).innerHTML = profiles.length ? `<div class="col" style="gap:6px">${profiles.map(p => `<div class="mm-prof"><div style="flex:1"><b>${esc(p.name)}</b>
            <div class="muted" style="font-size:12px">włączonych: ${p.enabled.length} z ${p.known.length} • ${new Date(p.created).toLocaleDateString('pl-PL')}</div></div>
            <button class="btn sm" data-apply="${esc(p.name)}">Przełącz</button><button class="btn ghost sm icon" data-pdel="${esc(p.name)}" title="Usuń profil">${icon('trash')}</button></div>`).join('')}</div>`
          : '<div class="muted">Nie masz jeszcze profili.</div>';
        $$('[data-apply]', m.el).forEach(b => b.onclick = async () => {
          try { const r = await nore.mods.applyProfile(target, b.dataset.apply); toast(`Profil „${b.dataset.apply}”`, r.changed ? `Zmieniono ${r.changed} ${plural(r.changed, 'plik', 'pliki', 'plików')}` : 'Już był aktywny', 'success'); m.close(); load(identified); } catch (e) { errorToast(e); }
        });
        $$('[data-pdel]', m.el).forEach(b => b.onclick = async () => { data.profiles = await nore.mods.deleteProfile(target, b.dataset.pdel); drawList(data.profiles); });
      };
      drawList(data.profiles || []);
      const save = async () => {
        const name = $('#mm-pname', m.el).value.trim();
        if (!name) return toast('Podaj nazwę profilu', '', 'error');
        data.profiles = await nore.mods.saveProfile(target, name).catch(errorToast) || data.profiles;
        $('#mm-pname', m.el).value = '';
        drawList(data.profiles);
        toast('Zapisano profil', name, 'success', 1600);
      };
      $('#mm-psave', m.el).onclick = save;
      $('#mm-pname', m.el).onkeydown = (e) => { if (e.key === 'Enter') save(); };
    }

    // export
    function exportModal() {
      const m = modal(`<h3>${icon('upload')} Eksport</h3><p class="sub">Lista ${noun.gen} do wysłania znajomym albo cała instancja jako paczka do zaimportowania w innym launcherze.</p>
        <div class="section-title" style="font-size:13px">Lista ${noun.gen}</div>
        <div class="row" style="gap:8px;margin:8px 0 14px;flex-wrap:wrap"><button class="btn ghost sm" data-l="txt-copy">${icon('copy')} Kopiuj jako tekst</button><button class="btn ghost sm" data-l="md-copy">${icon('copy')} Kopiuj jako Markdown</button>
          <button class="btn ghost sm" data-l="txt">${icon('download')} Zapisz .txt</button><button class="btn ghost sm" data-l="md">${icon('download')} Zapisz .md</button></div>
        ${opts.exportPack ? `<div class="section-title" style="font-size:13px">Cała instancja</div>
        <div class="row" style="gap:10px;margin-top:8px"><div class="field" style="flex:1;margin:0"><label>Wersja paczki</label><input class="input" id="mm-ver" value="1.0.0" maxlength="20"></div>
          <label class="fcheck" style="margin-top:20px"><input type="checkbox" id="mm-opt" checked><i></i>Dołącz ustawienia gry (options.txt)</label></div>
        <div class="row" style="gap:8px;margin-top:10px"><button class="btn sm" data-p="mrpack">${icon('box')} Modrinth .mrpack</button><button class="btn sm" data-p="curseforge">${icon('box')} CurseForge .zip</button></div>
        <div class="muted" id="mm-pst" style="font-size:12px;margin-top:8px">Pliki z Modrinth / CurseForge trafią do paczki jako linki, Twoje własne pliki i configi – do folderu overrides. Światy nie są eksportowane.</div>` : ''}
        <div class="foot"><button class="btn ghost" data-close>Zamknij</button></div>`);
      $$('[data-l]', m.el).forEach(b => b.onclick = async () => {
        const [fmt, copy] = b.dataset.l.split('-');
        try {
          if (copy) { const t = await nore.mods.modlist(target, fmt); await navigator.clipboard.writeText(t); toast('Skopiowano listę', `${data.mods.filter(x => x.enabled).length} ${noun.gen}`, 'success', 1800); }
          else { const p = await nore.mods.saveModlist(target, fmt); if (p) toast('Zapisano', p, 'success'); }
        } catch (e) { errorToast(e); }
      });
      $$('[data-p]', m.el).forEach(b => b.onclick = async () => {
        const off = nore.on('mods:status', (s) => { if (s && $('#mm-pst', m.el)) $('#mm-pst', m.el).textContent = s.stage + '…'; });
        $$('[data-p]', m.el).forEach(x => { x.disabled = true; });
        try {
          const r = await nore.mods.exportPack(target.instanceId, b.dataset.p, { version: $('#mm-ver', m.el).value.trim() || '1.0.0', includeOptions: $('#mm-opt', m.el).checked });
          if (r) { toast('Wyeksportowano paczkę', `${r.remote} plików jako linki, ${r.overrides} w overrides`, 'success', 6000); $('#mm-pst', m.el).textContent = `Zapisano: ${r.file}`; }
        } catch (e) { errorToast(e); }
        off();
        $$('[data-p]', m.el).forEach(x => { x.disabled = false; });
      });
    }

    // ---------------------------------------------------------------- toolbar
    let qt;
    $r('#mm-q').oninput = (e) => { clearTimeout(qt); qt = setTimeout(() => { f.query = e.target.value; draw(); }, 120); };
    $r('#mm-state').onchange = (e) => { f.state = e.target.value; draw(); };
    $r('#mm-side').onchange = (e) => { f.side = e.target.value; draw(); };
    $r('#mm-sort').onchange = (e) => { f.sort = e.target.value; draw(); };
    $r('#mm-upd').onclick = (e) => { if (ups && ups.length) updatesModal(ups); else checkUpdates(e.currentTarget); };
    $r('[data-menu="prof"]').onclick = profilesModal;
    $r('[data-menu="exp"]').onclick = exportModal;
    $r('#mm-cfg').onclick = () => ConfigEditor.open(target, { title: opts.title });
    if ($r('#mm-add')) $r('#mm-add').onclick = () => opts.browse();

    load(false).then(() => alive && load(true));
    return { reload: () => load(identified), destroy: () => { alive = false; } };
  },
};

// ================================================================== config editor

const ConfigEditor = {
  /** Modal with config files on the left and a form (or raw text) on the right. */
  async open(target, { title = '' } = {}) {
    const m = modal(`<div class="cfg-ed"><div class="cfg-head"><h3>${icon('settings')} Konfiguracja</h3><span class="muted">${esc(title)}</span></div>
      <div class="cfg-body"><div class="cfg-files"><input class="input sm" id="cfg-q" placeholder="Szukaj pliku…"><div id="cfg-list"><div class="skeleton" style="height:200px"></div></div></div>
        <div class="cfg-main" id="cfg-main"><div class="empty">${icon('settings')}<div>Wybierz plik konfiguracji.</div><div class="muted" style="font-size:12px;margin-top:6px">TOML, JSON i .properties mają prosty formularz; inne pliki edytujesz jako tekst.</div></div></div></div>
      <div class="foot"><button class="btn ghost" data-close>Zamknij</button></div></div>`);
    m.el.classList.add('wide');
    let files = [];
    try { files = await nore.mods.configs(target); } catch (e) { errorToast(e); }
    const drawFiles = (q = '') => {
      const list = files.filter(f => f.path.toLowerCase().includes(q.toLowerCase()));
      $('#cfg-list', m.el).innerHTML = list.length ? list.slice(0, 400).map(f => `<button class="cfg-file" data-p="${esc(f.path)}"><span>${esc(f.path.split('/').pop())}</span><small>${esc(f.path.split('/').slice(0, -1).join('/') || '/')}</small></button>`).join('')
        : '<div class="muted" style="padding:10px;font-size:12px">Brak plików konfiguracji – pojawią się po pierwszym uruchomieniu.</div>';
      $$('.cfg-file', m.el).forEach(b => b.onclick = () => { $$('.cfg-file', m.el).forEach(x => x.classList.toggle('on', x === b)); show(b.dataset.p); });
    };
    drawFiles();
    $('#cfg-q', m.el).oninput = (e) => drawFiles(e.target.value);

    async function show(rel, mode) {
      const main = $('#cfg-main', m.el);
      main.innerHTML = '<div class="skeleton" style="height:240px"></div>';
      let doc;
      try { doc = await nore.mods.readConfig(target, rel); } catch (e) { main.innerHTML = `<div class="muted">${esc(e.message)}</div>`; return; }
      mode = mode || (doc.editable ? 'form' : 'text');
      const changes = {};
      const sections = {};
      for (const f of doc.fields) (sections[f.section || ''] = sections[f.section || ''] || []).push(f);
      const input = (f) => {
        const k = esc(f.key);
        if (f.type === 'bool') return `<label class="switch"><input type="checkbox" data-k="${k}" ${f.value ? 'checked' : ''}><i></i></label>`;
        if (f.type === 'int' || f.type === 'float') return `<input class="input sm" type="number" step="${f.type === 'int' ? 1 : 'any'}" data-k="${k}" value="${esc(f.value)}">`;
        if (f.type === 'array') return `<input class="input sm" data-k="${k}" value="${esc((f.value || []).join(', '))}" title="Wartości oddzielone przecinkami">`;
        return `<input class="input sm" data-k="${k}" value="${esc(f.value)}">`;
      };
      main.innerHTML = `<div class="cfg-top"><b>${esc(rel)}</b><span class="spacer"></span>
          ${doc.editable ? `<div class="seg-mini"><button class="${mode === 'form' ? 'on' : ''}" data-mode="form">Formularz</button><button class="${mode === 'text' ? 'on' : ''}" data-mode="text">Tekst</button></div>` : '<span class="tag offline">tylko tekst</span>'}
          <button class="btn sm" id="cfg-save" disabled>${icon('check')} Zapisz</button></div>
        ${mode === 'form' ? `<input class="input sm" id="cfg-fq" placeholder="Filtruj opcje…" style="margin:8px 0">
          <div class="cfg-form">${Object.entries(sections).map(([s, list]) => `<div class="cfg-sec" data-sec="${esc(s)}">${s ? `<div class="cfg-sec-t">${esc(s)}</div>` : ''}
            ${list.map(f => `<div class="cfg-field" data-key="${esc(f.key.toLowerCase())} ${esc((f.comment || '').toLowerCase())}"><div class="cfg-l"><b>${esc(f.name)}</b>${f.comment ? `<small>${esc(f.comment.slice(0, 300))}</small>` : ''}</div>${input(f)}</div>`).join('')}</div>`).join('')}</div>`
          : `<textarea class="input cfg-text" id="cfg-text" spellcheck="false">${esc(doc.text)}</textarea>`}
        <div class="muted" style="font-size:11.5px;margin-top:8px">Przy pierwszej zmianie oryginał zostaje zapisany obok jako <b>.nore-orig</b>. Komentarze i kolejność w pliku zostają.</div>`;
      const save = $('#cfg-save', main);
      $$('[data-mode]', main).forEach(b => b.onclick = () => show(rel, b.dataset.mode));
      if (mode === 'form') {
        $$('[data-k]', main).forEach(i => i.oninput = i.onchange = () => { changes[i.dataset.k] = i.type === 'checkbox' ? i.checked : i.value; save.disabled = false; });
        $('#cfg-fq', main).oninput = (e) => { const q = e.target.value.toLowerCase(); $$('.cfg-field', main).forEach(x => { x.style.display = x.dataset.key.includes(q) ? '' : 'none'; }); };
      } else $('#cfg-text', main).oninput = () => { save.disabled = false; };
      save.onclick = async () => {
        try {
          if (mode === 'form') await nore.mods.saveConfig(target, rel, { changes });
          else await nore.mods.saveConfig(target, rel, { text: $('#cfg-text', main).value });
          toast('Zapisano', rel, 'success', 1500);
          show(rel, mode);
        } catch (e) { errorToast(e); }
      };
    }
  },
};
