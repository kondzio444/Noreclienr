'use strict';
/* Home 1.4 Beta: instance hero with its banner, recent instances, friends, screenshots, news – plus the sidebar mini player. */

const NEWS_14 = [
  ['sparkles', 'Nore Client 1.4 Beta', 'Panorama Minecrafta w menu, poradnik powitalny i kafelki szybkiego dostępu w rogu.'],
  ['globe', 'Nowy Multiplayer', 'Flagi krajów serwerów, ping, gracze online i podgląd serwera przy szybkim dołączaniu.'],
  ['users', 'Znajomi i peleryny', 'Lista znajomych wspólna z grą, kolekcja peleryn „Historia Nore” i galeria zrzutów.'],
  ['shield', 'Auto naprawa', 'Launcher sam wykrywa zduplikowane mody, złe wersje i błędne loadery, zanim gra się wysypie.'],
  ['layers', 'Minecraft 1.21.1 – 26.3', 'Nore Client działa na wszystkich wersjach od 1.21.1 do najnowszej 26.3 – wybierz dowolną przy tworzeniu instancji.'],
];

const QUICK_14 = [
  ['modpacks', 'box', 'Modpacki', 'Gotowe paczki'],
  ['mods', 'puzzle', 'Mody', 'Modrinth'],
  ['resourcepacks', 'image', 'Paczki zasobów', 'Tekstury'],
  ['shaders', 'sun', 'Shadery', 'Iris'],
  ['servers', 'server', 'Serwery', 'Własny serwer'],
  ['gallery', 'monitor', 'Galeria', 'Zrzuty F2'],
];

Pages.home = (root) => {
  root.innerHTML = `
    <div class="h14 stagger">
      <section class="card h14-hero" id="h-hero" style="--i:0">
        <div class="h14-art" id="h-art"></div>
        <div class="h14-shade"></div>
        <img class="h14-logo" src="assets/logo.png" alt="">
        <div class="h14-main">
          <div class="eyebrow"><span class="ver-chip">1.4 BETA</span> NORE LAUNCHER ${esc(App.info.version)}</div>
          <h1 id="h-name"></h1>
          <p class="h14-sub" id="h-sub"></p>
          <div class="h14-tags" id="h-tags"></div>
          <div class="launch-row">
            <button class="btn play big" id="play"></button>
            <button class="btn ghost h14-switch" id="pick" title="Zmień instancję">${icon('layers')} <span>Zmień</span></button>
            <button class="btn ghost icon" id="h-open" title="Strona instancji">${icon('settings')}</button>
          </div>
          ${progressHtml()}
        </div>
        <div class="h14-stats">
          <div><b id="st-play">–</b><span>Czas gry</span></div>
          <div><b id="st-last">–</b><span>Ostatnio</span></div>
          <div><b id="st-inst">–</b><span>Instancje</span></div>
        </div>
      </section>

      <div class="h14-quick" style="--i:1">${QUICK_14.map(([p, ic, t, d]) => `<button class="card hover h14-q" data-go="${p}">${icon(ic)}<b>${t}</b><small>${d}</small></button>`).join('')}</div>

      <div class="h14-cols">
        <div class="col" style="gap:18px;min-width:0">
          <section class="card h14-sec" style="--i:2">
            <div class="row"><div class="section-title" style="flex:1">${icon('clock')} Ostatnio grane</div><button class="btn ghost sm" data-go="instances">Wszystkie ${icon('arrowRight')}</button></div>
            <div class="h14-recent" id="h-recent"></div>
          </section>
          <section class="card h14-sec" style="--i:3">
            <div class="row"><div class="section-title" style="flex:1">${icon('monitor')} Ostatnie zrzuty</div><button class="btn ghost sm" data-go="gallery">Galeria ${icon('arrowRight')}</button></div>
            <div class="h14-shots" id="h-shots"><div class="muted">Wczytywanie…</div></div>
          </section>
        </div>
        <div class="col" style="gap:18px;min-width:0">
          <section class="card h14-sec h14-upd" id="h-upd" style="--i:2" hidden></section>
          <section class="card h14-sec news" style="--i:2">
            <div class="section-title">${icon('sparkles')} Nowe w 1.4 Beta</div>
            ${NEWS_14.map(n => `<div class="news-item"><div class="ico">${icon(n[0])}</div><div><b>${n[1]}</b><p>${n[2]}</p></div></div>`).join('')}
          </section>
          <section class="card h14-sec" style="--i:3">
            <div class="row"><div class="section-title" style="flex:1">${icon('users')} Znajomi</div><button class="btn ghost sm" data-go="friends">Zarządzaj ${icon('arrowRight')}</button></div>
            <div class="h14-friends" id="h-friends"></div>
          </section>
          <section class="card home-servers h14-sec" id="hsrv" style="--i:4"></section>
        </div>
      </div>
    </div>`;

  $$('[data-go]', root).forEach(c => c.onclick = () => go(c.dataset.go));
  $('#pick', root).onclick = () => instancePickerModal();
  $('#h-open', root).onclick = () => { const i = App.instance(); if (i) go('instance', { id: i.id }); };
  $('#play', root).onclick = () => {
    const inst = App.instance();
    if (App.running && inst && App.running === inst.id) return nore.game.kill();
    launchSelected();
  };

  // friends and screenshots load in the background
  nore.friends.list().then(list => {
    const box = $('#h-friends', root);
    if (!box) return;
    box.innerHTML = list.length
      ? `<div class="h14-heads">${list.slice(0, 9).map(n => `<span title="${esc(n)}"><b>${esc(n.charAt(0).toUpperCase())}</b><img src="https://mc-heads.net/avatar/${encodeURIComponent(n)}/48" alt="" data-fallback></span>`).join('')}
          ${list.length > 9 ? `<span class="more">+${list.length - 9}</span>` : ''}</div><small class="muted">${list.length} na liście • podświetleni w grze</small>`
      : `<div class="muted" style="font-size:12.5px">Dodaj znajomych – Nore Client podświetli ich nicki i powiadomi, gdy wejdą na serwer.</div>`;
  }).catch(() => {});
  nore.gallery.list().then(list => {
    const box = $('#h-shots', root);
    if (!box) return;
    box.innerHTML = list.length
      ? list.slice(0, 4).map(s => `<button class="h14-shot" title="${esc(s.instance)}">${s.thumb ? `<img src="${s.thumb}" alt="">` : icon('image')}</button>`).join('')
      : `<div class="muted" style="font-size:12.5px;grid-column:1/-1">Naciśnij F2 w grze, aby zrobić pierwszy zrzut.</div>`;
    $$('.h14-shot', box).forEach(b => b.onclick = () => go('gallery'));
  }).catch(() => {});
  nore.servers.list().then(list => {
    const box = $('#hsrv', root);
    if (!box) return;
    box.innerHTML = `<div class="row"><div class="section-title" style="flex:1">${icon('server')} Twoje serwery</div><button class="btn ghost sm" data-go2="servers">${list.length ? 'Zarządzaj' : 'Utwórz'} ${icon('arrowRight')}</button></div>
      ${list.length ? list.slice(0, 3).map(x => `<div class="hs-row" data-id="${esc(x.id)}"><i class="dot ${x.state}"></i><b>${esc(x.name)}</b><span>${esc(x.mcVersion)} • ${x.state === 'running' ? x.players.length + ' graczy' : 'wyłączony'}</span></div>`).join('')
        : '<div class="muted" style="font-size:12.5px;margin-top:8px">Postaw własny serwer Paper, Fabric albo NeoForge z pluginami i domeną.</div>'}`;
    $$('[data-go2]', box).forEach(b => b.onclick = () => go(b.dataset.go2));
    $$('.hs-row', box).forEach(r => r.onclick = () => go('server', { id: r.dataset.id }));
  }).catch(() => {});

  let lastInst = null;
  const render = () => {
    const s = App.state;
    const inst = App.instance();
    if (inst !== lastInst || !inst) {
      lastInst = inst;
      $('#h-art', root).style.background = inst ? instBanner(inst) : 'linear-gradient(135deg,#2a1a10,#0e0b09)';
      $('#h-name', root).innerHTML = inst ? esc(inst.name) : 'Brak <span>instancji</span>';
      $('#h-sub', root).textContent = inst ? instSubtitle(inst) : 'Utwórz instancję, aby zagrać.';
      $('#h-tags', root).innerHTML = inst ? instanceTags(inst) : '';
    }
    const play = $('#play', root);
    const running = App.running && inst && App.running === inst.id;
    play.classList.toggle('running', !!running);
    play.disabled = !!App.progress || (!!App.running && !running);
    play.innerHTML = App.progress ? '<span class="spinner"></span> PRZYGOTOWANIE' : running ? `${icon('stop')} ZATRZYMAJ` : `${icon('play')} GRAJ`;
    $('#st-play', root).textContent = inst ? fmtDuration(inst.playTime || 0) : '–';
    $('#st-last', root).textContent = inst ? fmtAgo(inst.lastPlayed) : '–';
    $('#st-inst', root).textContent = s.instances.length;
    const recent = [...s.instances].sort((a, b) => (b.lastPlayed || 0) - (a.lastPlayed || 0)).slice(0, 4);
    const box = $('#h-recent', root);
    const sig = recent.map(i => i.id + (i.id === s.selectedInstance ? '*' : '') + (App.running === i.id ? 'r' : '')).join();
    if (box.dataset.sig !== sig) {
      box.dataset.sig = sig;
      box.innerHTML = recent.length ? recent.map(i => `<div class="h14-ri ${i.id === s.selectedInstance ? 'on' : ''}" data-id="${esc(i.id)}">
          <div class="h14-ri-art" style="background:${instBanner(i)}"></div>${instIcon(i, 36)}
          <div class="meta"><b>${esc(i.name)}</b><span>${esc(i.mcVersion)} • ${i.lastPlayed ? fmtAgo(i.lastPlayed) : 'nie grano'}</span></div>
          <button class="btn sm icon" data-play title="Graj">${icon(App.running === i.id ? 'stop' : 'play')}</button></div>`).join('')
        : `<div class="muted" style="font-size:12.5px">Nie masz jeszcze instancji.</div>`;
      $$('.h14-ri', box).forEach(r => {
        const inst2 = s.instances.find(i => i.id === r.dataset.id);
        r.onclick = async (e) => {
          if (e.target.closest('[data-play]')) {
            if (App.running === inst2.id) return nore.game.kill();
            await nore.instances.select(inst2.id); await App.refresh(); return launchSelected(inst2);
          }
          await nore.instances.select(inst2.id); await App.refresh();
        };
      });
    }
    renderUpdates();
    updateProgress(root);
  };

  // instances with a new modpack version or mod / resource pack / shader updates
  const busyUpd = new Set();
  const renderUpdates = () => {
    const box = $('#h-upd', root);
    if (!box) return;
    const list = App.state.instances.filter(i => hasContentUpdates(App.contentUpdates[i.id]));
    const sig = JSON.stringify(list.map(i => [i.id, App.contentUpdates[i.id], busyUpd.has(i.id)]));
    if (box.dataset.sig === sig) return;
    box.dataset.sig = sig;
    box.hidden = !list.length;
    if (!list.length) { box.innerHTML = ''; return; }
    box.innerHTML = `<div class="row"><div class="section-title" style="flex:1">${icon('download')} Dostępne aktualizacje</div>
        <button class="btn ghost sm icon" id="upd-re" title="Sprawdź ponownie">${icon('refresh')}</button></div>
      ${list.map(i => {
        const u = App.contentUpdates[i.id];
        const other = contentUpdatesText(u);
        return `<div class="h14-ui" data-id="${esc(i.id)}">${instIcon(i, 34)}
          <div class="meta"><b>${esc(i.name)}</b><span>${u.pack ? `Modpack ${esc(u.pack.version)} ${versionTypeTag(u.pack.type)}${u.pack.mcChanged ? ` • MC ${esc(u.pack.mcVersion)}` : ''}` : ''}${u.pack && other ? '<br>' : ''}${esc(other)}</span></div>
          <div class="acts">${u.pack ? `<button class="btn sm" data-pack>${icon('box')} Aktualizuj</button>` : ''}
          ${other ? `<button class="btn ${u.pack ? 'ghost ' : ''}sm" data-mods ${busyUpd.has(i.id) ? 'disabled' : ''}>${busyUpd.has(i.id) ? '<span class="spinner"></span>' : icon('puzzle')} Aktualizuj mody</button>` : ''}</div></div>`;
      }).join('')}`;
    $('#upd-re', box).onclick = async (e) => {
      const b = e.currentTarget;
      b.disabled = true; b.innerHTML = '<span class="spinner"></span>';
      try { await nore.content.checkAll(); } catch (err) { errorToast(err, 'Sprawdzanie aktualizacji'); }
      if (b.isConnected) { b.disabled = false; b.innerHTML = icon('refresh'); }
    };
    $$('.h14-ui', box).forEach(r => {
      const inst = App.state.instances.find(i => i.id === r.dataset.id);
      if ($('[data-pack]', r)) $('[data-pack]', r).onclick = () => go('instance', { id: inst.id, packUpdate: true });
      if ($('[data-mods]', r)) $('[data-mods]', r).onclick = async () => {
        busyUpd.add(inst.id); renderUpdates();
        try { await updateInstanceContent(inst); } catch (err) { errorToast(err, 'Aktualizacja modów'); }
        busyUpd.delete(inst.id); renderUpdates();
      };
    });
  };
  render();
  return App.onChange(render);
};

// ------------------------------------------------------------------ sidebar mini player

function renderMiniPlay() {
  const box = document.getElementById('mini-play');
  if (!box || !App.state) return;
  const inst = App.instance();
  box.hidden = !inst || App.page === 'home';
  if (!inst) return;
  const running = App.running && App.running === inst.id;
  const busy = !!App.progress;
  const frac = App.progress && App.progress.total ? (App.progress.totalBytes ? App.progress.bytes / App.progress.totalBytes : App.progress.done / App.progress.total) : 0;
  box.classList.toggle('running', !!running);
  box.innerHTML = `${instIcon(inst, 30)}<div class="meta"><b>${esc(inst.name)}</b><span>${busy ? 'Przygotowanie…' : running ? 'W grze' : esc(inst.mcVersion)}</span></div>
    <button class="mp-btn" title="${running ? 'Zatrzymaj' : 'Graj'}" ${busy || (App.running && !running) ? 'disabled' : ''}>${busy ? '<span class="spinner"></span>' : icon(running ? 'stop' : 'play')}</button>
    ${busy ? `<i class="mp-bar" style="width:${(frac * 100).toFixed(1)}%"></i>` : ''}`;
  $('.meta', box).onclick = () => go('instance', { id: inst.id });
  $('.mp-btn', box).onclick = () => (running ? nore.game.kill() : launchSelected());
}

(function hookMiniPlay() {
  const wait = () => {
    if (typeof App === 'undefined' || !App.onChange) return setTimeout(wait, 50);
    App.onChange(renderMiniPlay);
    const _go = window.go;
    if (typeof _go === 'function') window.go = async (...a) => { const r = await _go(...a); renderMiniPlay(); return r; };
  };
  wait();
})();
