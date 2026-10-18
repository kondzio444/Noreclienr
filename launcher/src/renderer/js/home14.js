'use strict';
/* Home 1.4 Beta: instance hero with its banner, recent instances, friends, screenshots, news – plus the sidebar mini player. */

const NEWS_14 = [
  ['sparkles', 'Nore Client 1.4 Beta', 'Panorama Minecrafta w menu, poradnik powitalny i kafelki szybkiego dostępu w rogu.'],
  ['globe', 'Nowy Multiplayer', 'Flagi krajów serwerów, ping, gracze online i podgląd serwera przy szybkim dołączaniu.'],
  ['users', 'Znajomi i peleryny', 'Lista znajomych wspólna z grą, kolekcja peleryn „Historia Nore” i galeria zrzutów.'],
  ['shield', 'Auto naprawa', 'Launcher sam wykrywa zduplikowane mody, złe wersje i błędne loadery, zanim gra się wysypie.'],
  ['layers', 'Minecraft 1.20 – 26.3', 'Nore Client działa na wszystkich wersjach od 1.20 do najnowszej 26.3 – wybierz dowolną przy tworzeniu instancji.'],
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
          <h1 id="h-name"></h1>
          <p class="h14-sub" id="h-sub"></p>
          <div class="h14-tags" id="h-tags"></div>
          <div class="launch-row">
            <button class="btn play big" id="play"></button>
            <button class="btn ghost h14-switch" id="pick" title="Zmień instancję">${icon('layers')} <span>Zmień</span></button>
            <button class="btn ghost icon" id="h-open" title="Strona instancji">${icon('settings')}</button>
          </div>
          ${progressHtml()}
          <div class="eyebrow h14-meta"><span class="ver-chip">1.4 BETA</span> Nore Launcher ${esc(App.info.version)}</div>
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
          <section class="card h14-sec" style="--i:2;--tab:var(--c-b)">
            <div class="row"><div class="section-title" style="flex:1">${icon('clock')} Ostatnio grane</div><button class="btn ghost sm" data-go="instances">Wszystkie ${icon('arrowRight')}</button></div>
            <div class="h14-recent" id="h-recent"></div>
          </section>
          <section class="card h14-sec" style="--i:3;--tab:var(--c-7)">
            <div class="row"><div class="section-title" style="flex:1">${icon('monitor')} Ostatnie zrzuty</div><button class="btn ghost sm" data-go="gallery">Galeria ${icon('arrowRight')}</button></div>
            <div class="h14-shots" id="h-shots"><div class="muted">Wczytywanie…</div></div>
          </section>
        </div>
        <div class="col" style="gap:18px;min-width:0">
          <section class="card h14-sec h14-upd" id="h-upd" style="--i:2;--tab:var(--c-e)" hidden></section>
          <section class="card h14-sec news" style="--i:2;--tab:var(--c-d)">
            <div class="section-title">${icon('sparkles')} Nowe w 1.4 Beta</div>
            ${NEWS_14.map(n => `<div class="news-item"><div class="ico">${icon(n[0])}</div><div><b>${n[1]}</b><p>${n[2]}</p></div></div>`).join('')}
          </section>
          <section class="card h14-sec" style="--i:3;--tab:var(--c-a)">
            <div class="row"><div class="section-title" style="flex:1">${icon('users')} Znajomi</div><button class="btn ghost sm" data-go="friends">Zarządzaj ${icon('arrowRight')}</button></div>
            <div class="h14-friends" id="h-friends"></div>
          </section>
          <section class="card home-servers h14-sec" id="hsrv" style="--i:4;--tab:var(--c-6)"></section>
        </div>
      </div>
    </div>`;

  // the stat strip counts up from zero when Start opens
  for (const id of ['#st-play', '#st-inst']) { const n = $(id, root); n._num = 0; n._shown = 0; }

  $$('[data-go]', root).forEach(c => c.onclick = () => go(c.dataset.go));
  $('#pick', root).onclick = () => instancePickerModal();
  $('#h-open', root).onclick = () => { const i = App.instance(); if (i) go('instance', { id: i.id }); };
  $('#play', root).onclick = () => {
    const inst = App.instance();
    if (App.running && inst && App.running === inst.id) return nore.game.kill();
    if (inst) Motd.reveal($('#h-name', root), inst.name, 720);
    launchSelected();
  };

  // friends and screenshots load in the background
  // friends: nick list + chat contacts as one row of heads, online first, with their status squares
  let nicks = null;
  const drawFriends = () => {
    const box = $('#h-friends', root);
    if (!box || nicks == null) return;
    const people = sortPeople(friendPeople(nicks));
    const on = people.filter(p => p.status === 'game' || p.status === 'launcher').length;
    const unread = people.reduce((n, p) => n + p.unread, 0);
    const sig = JSON.stringify(people.slice(0, 9).map(p => [p.key, p.status, p.unread]).concat([people.length]));
    if (box.dataset.sig === sig) return;
    const first = box.dataset.sig == null;
    box.dataset.sig = sig;
    if (first) Motion.ghost(box);
    box.innerHTML = people.length
      ? `<div class="h14-heads">${people.slice(0, 9).map(p => `<button class="h14-head" data-k="${esc(p.key)}" title="${esc(p.name)}">${personAvatar(p, 34, 48)}</button>`).join('')}
          ${people.length > 9 ? `<button class="h14-head more" data-k="">+${people.length - 9}</button>` : ''}</div>
        <small class="muted motd">${Motd.html(`${on ? `§a${on} online` : '§7nikt online'}§8 • §7${people.length} ${plural(people.length, 'znajomy', 'znajomych', 'znajomych')}${unread ? `§8 • §e${unread} ${plural(unread, 'nowa wiadomość', 'nowe wiadomości', 'nowych wiadomości')}` : ''}`)}</small>`
      : `<div class="muted" style="font-size:12.5px">Dodaj znajomych – Nore Client podświetli ich nicki, a w launcherze możecie pisać i rozmawiać.</div>`;
    if (first) stagger($('.h14-heads', box) || box);
    $$('.h14-head', box).forEach(b => b.onclick = () => go('friends', b.dataset.k ? { key: b.dataset.k } : {}));
  };
  nore.friends.list().then(list => { nicks = list; drawFriends(); }).catch(() => { nicks = []; drawFriends(); });
  const offChat = typeof Chat !== 'undefined' ? Chat.on((w) => { if (w === 'presence' || w === 'contacts') drawFriends(); }) : () => {};
  nore.gallery.list().then(list => {
    const box = $('#h-shots', root);
    if (!box) return;
    Motion.ghost(box);
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
      $('#h-art', root).style.background = inst ? instBanner(inst) : 'var(--surface)';
      if (inst) Motd.reveal($('#h-name', root), inst.name);
      else $('#h-name', root).innerHTML = 'Brak <span>instancji</span>';
      const sub = $('#h-sub', root);
      sub.classList.toggle('motd', !!inst);
      sub.innerHTML = inst ? instMotd(inst) : 'Utwórz instancję, aby zagrać.';
      $('#h-tags', root).innerHTML = inst ? instanceTags(inst) : '';
    }
    renderPlayBlock($('#play', root), inst);
    const stPlay = $('#st-play', root);
    if (inst) Motion.count(stPlay, (inst.playTime || 0) / 60000, (m) => fmtDuration(m * 60000)); else { stPlay._num = null; stPlay.textContent = '–'; }
    Motion.swap($('#st-last', root), inst ? esc(fmtAgo(inst.lastPlayed)) : '–');
    Motion.count($('#st-inst', root), s.instances.length);
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
  const offApp = App.onChange(render);
  const offAmbient = heroAmbient($('#h-hero', root), $('#h-name', root));
  return () => { offApp(); offChat(); offAmbient(); };
};

// ------------------------------------------------------------------ Start hero: quiet ambient life

/** The hero art drifts slowly (CSS) and leans a few pixels toward the pointer; every 7–12 s one letter
    of the instance name flickers through a §k glyph. Nothing runs while the window is hidden or unfocused,
    and none of it runs with reduced motion or the animation switch off. */
function heroAmbient(hero, name) {
  if (!hero) return () => {};
  const art = $('.h14-art', hero), logo = $('.h14-logo', hero);
  let raf = 0, tx = 0, ty = 0, timer = 0;
  const move = (e) => {
    if (Motion.off() || Motion.reduced()) return;
    const r = hero.getBoundingClientRect();
    tx = (e.clientX - r.left) / r.width - 0.5; ty = (e.clientY - r.top) / r.height - 0.5;
    if (!raf) raf = requestAnimationFrame(() => {
      raf = 0;
      if (art) art.style.translate = `${(-tx * 10).toFixed(1)}px ${(-ty * 4).toFixed(1)}px`;
      if (logo) logo.style.translate = `${(tx * 4).toFixed(1)}px ${(ty * 3).toFixed(1)}px`;
    });
  };
  const leave = () => { if (art) art.style.translate = ''; if (logo) logo.style.translate = ''; };
  hero.addEventListener('pointermove', move);
  hero.addEventListener('pointerleave', leave);
  const schedule = () => { timer = setTimeout(() => { if (!document.hidden && document.hasFocus() && !App.progress) Motd.tick(name); schedule(); }, 7000 + Math.random() * 5000); };
  schedule();
  return () => { clearTimeout(timer); cancelAnimationFrame(raf); hero.removeEventListener('pointermove', move); hero.removeEventListener('pointerleave', leave); };
}

// ------------------------------------------------------------------ the Graj block: press → progress → playing

const progressFrac = (p) => (p && p.total ? Math.min(1, p.totalBytes ? p.bytes / p.totalBytes : p.done / p.total) : null);

/** Builds the Graj block once, then updates it in place so its fill and label can move:
    idle "GRAJ" → busy (the block fills with the download, percent in tabular figures) → running (green, live mark). */
function renderPlayBlock(btn, inst) {
  if (!btn) return;
  if (!btn._built) { btn.innerHTML = '<span class="pl-fill"></span><span class="pl-label"></span>'; btn._built = true; }
  const running = !!(App.running && inst && App.running === inst.id);
  const p = App.progress;
  const frac = progressFrac(p);
  btn.classList.toggle('running', running);
  btn.classList.toggle('busy', !!p);
  btn.classList.toggle('indeterminate', !!p && frac == null);
  btn.disabled = !!p || (!!App.running && !running);
  btn.style.setProperty('--p', frac == null ? 0 : frac.toFixed(3));
  const state = p ? 'busy' : running ? 'run' : 'idle';
  const label = $('.pl-label', btn);
  const pctText = frac == null ? '' : Math.round(frac * 100) + '%';
  if (btn.dataset.state !== state) {
    btn.dataset.state = state;
    btn.setAttribute('aria-label', state === 'busy' ? 'Przygotowanie gry' : state === 'run' ? 'Zatrzymaj grę' : 'Graj');
    Motion.swap(label, state === 'busy' ? `PRZYGOTOWANIE <span class="pl-pct">${pctText}</span>` : state === 'run' ? '<i class="pl-live"></i> ZATRZYMAJ' : `${icon('play')} GRAJ`, state === 'idle' ? -1 : 1);
  }
  const pct = $('.pl-pct', label);
  if (pct) pct.textContent = pctText;
}

// ------------------------------------------------------------------ sidebar mini player

function renderMiniPlay() {
  const box = document.getElementById('mini-play');
  if (!box || !App.state) return;
  const inst = App.instance();
  const hide = !inst || App.page === 'home';
  if (box.hidden !== hide) box.hidden = hide; // unhiding replays its CSS rise
  if (!inst) return;
  const running = !!(App.running && App.running === inst.id);
  const busy = !!App.progress;
  const frac = progressFrac(App.progress);
  // the frame is built once per instance; state changes update it in place so they can animate
  if (box.dataset.inst !== inst.id + '|' + inst.name + '|' + inst.color) {
    box.dataset.inst = inst.id + '|' + inst.name + '|' + inst.color;
    box.innerHTML = `${instIcon(inst, 30)}<div class="meta"><b>${esc(inst.name)}</b><span></span></div><button class="mp-btn"></button><i class="mp-bar"></i>`;
    box._state = null;
    $('.meta', box).onclick = () => go('instance', { id: App.instance().id });
  }
  box.classList.toggle('running', running);
  box.classList.toggle('busy', busy);
  box.style.setProperty('--p', frac == null ? 0 : frac.toFixed(3));
  const state = busy ? 'busy' : running ? 'run' : 'idle';
  const btn = $('.mp-btn', box);
  btn.disabled = busy || (!!App.running && !running);
  btn.title = running ? 'Zatrzymaj' : 'Graj';
  btn.onclick = () => (running ? nore.game.kill() : launchSelected());
  if (box._state !== state) {
    const first = box._state == null;
    box._state = state;
    btn.innerHTML = busy ? '<span class="spinner"></span>' : icon(running ? 'stop' : 'play');
    if (!first) Motion.animate(btn, [{ transform: 'scale(.7)', opacity: 0.4 }, { transform: 'none', opacity: 1 }], { duration: Motion.ms('--dur-base'), easing: Motion.ease('--ease-spring') });
  }
  const sub = busy ? (frac == null ? 'Przygotowanie…' : `Przygotowanie ${Math.round(frac * 100)}%`) : running ? 'W grze' : esc(inst.mcVersion);
  const span = $('.meta span', box);
  if (span.innerHTML !== sub) span.innerHTML = sub;
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
