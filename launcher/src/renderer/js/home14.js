'use strict';
/* Start (DESIGN.md §8 "Launcher"): the current instance as a hero sticker with Graj, recent instances in
   slots ending with a ghost "Nowa instancja", the collection, and on the right the event poster / Nore MC,
   taped news clippings and friends as round head stickers. Plus the Graj block and the rail mini player. */

/** News clippings (washi-taped paper). [title, text, signature] */
const NEWS_14 = [
  ['Nowy wygląd: Album', 'Launcher, instalator i aktualizator w nowej odsłonie. Instancje, znajomi i nagrody to naklejki w Twoim albumie.', 'Launcher 1.4 · paź'],
  ['Nore MC: dołącz jednym kliknięciem', 'Oficjalny serwer na Starcie i w Serwerach – launcher sam wybierze instancję z Nore Client.', 'Launcher 1.4 · paź'],
  ['Serwer dla znajomych', 'Tunel playit.gg ustawia się sam, bez przekierowania portów.', 'Serwery 2.1'],
  ['Auto naprawa', 'Launcher wykrywa zduplikowane mody, złe wersje i błędne loadery, zanim gra się wysypie.', 'Launcher 1.4'],
];

const fmtHours = (ms) => {
  const h = (ms || 0) / 3600000;
  return h >= 10 ? `${Math.round(h)} h` : h >= 1 ? `${h.toFixed(1).replace('.', ',')} h` : `${Math.round(h * 60)} min`;
};

/** "wczoraj, 21:14", "dziś, 9:05", "12 paź" or "jeszcze nie" */
function fmtWhen(ts) {
  if (!ts) return 'jeszcze nie';
  const d = new Date(ts), now = new Date();
  const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(now) - day(d)) / 86400000);
  const hm = d.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });
  if (diff === 0) return `dziś, ${hm}`;
  if (diff === 1) return `wczoraj, ${hm}`;
  if (diff < 7) return `${diff} dni temu`;
  return d.toLocaleDateString('pl-PL', { day: 'numeric', month: 'short' });
}

/** Artwork for an instance sticker: its banner / icon, or a real panorama when it has none. */
function instArt(inst) {
  const media = App.media && App.media[inst.id];
  const img = (media && media.banner) || inst.bannerUrl || (media && media.icon) || inst.iconUrl;
  return img ? `url("${esc(img)}")` : '';
}

function loaderLabel(inst) {
  const l = inst.loader || 'vanilla';
  return `<span class="label ${l}">${esc(loaderName(l))}${inst.loaderVersion ? ' ' + esc(String(inst.loaderVersion).split('.').slice(0, 2).join('.')) : ''}</span>`;
}

Pages.home = (root) => {
  root.innerHTML = `
    <div class="home">
      <div class="home-main">
        <section class="h-hero" id="h-hero">
          <div class="sticker lg h-inst" id="h-art"><span class="peel"></span><span class="label lab-b" id="h-ver"></span><span class="label nore lab-a" id="h-kind"></span></div>
          <div class="h-info">
            <h1 class="h-name" id="h-name"></h1>
            <p class="h-meta" id="h-meta"></p>
            <div class="h-labels" id="h-tags"></div>
            <div class="h-actions">
              <span class="play-wrap"><button class="btn play big" id="play"></button><i class="play-dot" id="play-dot" hidden></i></span>
              <button class="btn ghost" id="pick" title="Zmień instancję">Zmień ${icon('arrowRight')}</button>
              <button class="btn ghost icon" id="h-folder" title="Folder instancji" aria-label="Folder instancji">${icon('folder')}</button>
            </div>
            <p class="h-ready" id="h-ready"></p>
            ${progressHtml()}
          </div>
        </section>
        <section class="card h-upd" id="h-upd" hidden></section>
        <section class="h-sec">
          <h3 class="section-title">Ostatnio grane<button class="more" data-go="instances">Wszystkie instancje</button></h3>
          <div class="h-recent" id="h-recent"></div>
        </section>
        <section class="h-sec h-album" id="h-album" hidden></section>
      </div>
      <aside class="h-side">
        <div id="h-event" hidden></div>
        <section id="h-official"></section>
        <section><h3 class="section-title">Co nowego</h3>
          <div class="h-clips">${NEWS_14.slice(0, 2).map((n, i) => `<article class="clip"><span class="tape ${i % 2 ? 'mint' : ''}"></span><h4>${esc(n[0])}</h4><p>${esc(n[1])}</p><time>${esc(n[2])}</time></article>`).join('')}</div>
        </section>
        <section><h3 class="section-title">Znajomi<button class="more" data-go="friends" id="h-fcount">Zarządzaj</button></h3>
          <div class="h-friends" id="h-friends"></div></section>
        <section id="hsrv" hidden></section>
      </aside>
    </div>`;

  $$('[data-go]', root).forEach(c => c.onclick = () => go(c.dataset.go));
  Official.card($('#h-official', root));
  if (typeof Events === 'object') Events.homeSlots(root);
  $('#pick', root).onclick = () => instancePickerModal();
  // the hero sticker opens the instance page (mods, worlds, settings)
  $('#h-art', root).onclick = (e) => { if (e.target.closest('.label')) return; const i = App.instance(); if (i) go('instance', { id: i.id }); };
  $('#h-art', root).title = 'Szczegóły instancji';
  $('#h-folder', root).onclick = () => { const i = App.instance(); if (i) nore.instances.folder(i.id); };
  $('#play', root).onclick = (e) => {
    const inst = App.instance();
    playRub(e.currentTarget);
    if (App.running && inst && App.running === inst.id) return nore.game.kill();
    launchSelected();
  };

  // friends: nick list + chat contacts, online first, as round head stickers with their dots
  let nicks = null;
  const drawFriends = () => {
    const box = $('#h-friends', root);
    if (!box || nicks == null) return;
    const people = sortPeople(friendPeople(nicks));
    const on = people.filter(p => p.status === 'game' || p.status === 'launcher').length;
    const sig = JSON.stringify(people.slice(0, 4).map(p => [p.key, p.status, p.unread, p.detail]).concat([people.length]));
    if (box.dataset.sig === sig) return;
    const first = box.dataset.sig == null;
    box.dataset.sig = sig;
    $('#h-fcount', root).textContent = people.length ? (on ? `${on} online` : `${people.length} ${plural(people.length, 'osoba', 'osoby', 'osób')}`) : 'Dodaj';
    box.innerHTML = people.length
      ? people.slice(0, 4).map(p => `<button class="h-friend" data-k="${esc(p.key)}"><span class="h">${personAvatar(p, 34, 48)}</span>
          <div><b>${esc(p.name)}</b><small>${esc(p.unread ? `${p.unread} ${plural(p.unread, 'nowa wiadomość', 'nowe wiadomości', 'nowych wiadomości')}` : personLine(p))}</small></div></button>`).join('')
      : '<p class="muted" style="font-size:13px;line-height:1.5">Dodaj znajomych – Nore Client podświetli ich nicki, a w launcherze możecie pisać i rozmawiać.</p>';
    if (first) stagger(box);
    $$('.h-friend', box).forEach(b => b.onclick = () => go('friends', { key: b.dataset.k }));
  };
  nore.friends.list().then(list => { nicks = list; drawFriends(); }).catch(() => { nicks = []; drawFriends(); });
  const offChat = typeof Chat !== 'undefined' ? Chat.on((w) => { if (w === 'presence' || w === 'contacts') drawFriends(); }) : () => {};

  nore.servers.list().then(list => {
    const box = $('#hsrv', root);
    if (!box || !list.length) return;
    box.hidden = false;
    const st = (x) => (x.state === 'running' ? 'ready' : x.state === 'starting' || x.state === 'stopping' ? 'wait' : x.state === 'crashed' ? 'error' : 'off');
    box.innerHTML = `<h3 class="section-title">Twoje serwery<button class="more" data-go2="servers">Zarządzaj</button></h3>
      ${list.slice(0, 3).map(x => `<button class="h-srv" data-id="${esc(x.id)}"><i class="sdot sm ${st(x)}"></i><b>${esc(x.name)}</b><span>${esc(x.mcVersion)} · ${x.state === 'running' ? x.players.length + ' ' + plural(x.players.length, 'gracz', 'graczy', 'graczy') : 'wyłączony'}</span></button>`).join('')}`;
    $$('[data-go2]', box).forEach(b => b.onclick = () => go(b.dataset.go2));
    $$('.h-srv', box).forEach(r => r.onclick = () => go('server', { id: r.dataset.id }));
  }).catch(() => {});

  let lastInst = null;
  const render = () => {
    const s = App.state;
    const inst = App.instance();
    const art = $('#h-art', root);
    const key = inst ? [inst.id, inst.name, inst.mcVersion, inst.loader, inst.loaderVersion, instArt(inst)].join('|') : '';
    if (key !== lastInst) {
      lastInst = key;
      const bg = inst ? instArt(inst) : '';
      art.style.backgroundImage = bg;
      art.classList.toggle('empty-art', !bg);
      $('#h-ver', root).textContent = inst ? inst.mcVersion : '';
      $('#h-ver', root).hidden = !inst;
      const kind = $('#h-kind', root);
      kind.textContent = inst ? (inst.noreClient ? 'Nore Client' : inst.modpack === 'pack' ? 'Modpack' : loaderName(inst.loader)) : '';
      kind.className = `label lab-a ${inst ? (inst.noreClient ? 'nore' : inst.modpack === 'pack' ? 'modpack' : inst.loader || 'vanilla') : ''}`;
      kind.hidden = !inst;
      const name = $('#h-name', root);
      name.textContent = inst ? inst.name : 'Pusty album';
      name.classList.toggle('long', !!inst && inst.name.length > 16);
      const mem = inst && inst.memoryMb ? inst.memoryMb : s.settings.memoryMb;
      $('#h-tags', root).innerHTML = inst ? `${loaderLabel(inst)}<span class="label">${mem ? (mem / 1024).toFixed(mem % 1024 ? 1 : 0).replace('.', ',') + ' GB RAM' : 'RAM: auto'}</span>${inst.modpack === 'pack' && inst.pack ? `<span class="label dark">${esc(inst.pack.title || 'Modpack')}</span>` : inst.perfPack ? '<span class="label dark">Pakiet Nore</span>' : ''}` : '';
    }
    const st = App.stats[inst && inst.id] || {};
    $('#h-meta', root).innerHTML = inst
      ? `<span><b>${fmtHours(inst.playTime)}</b> w grze</span><span>ostatnio <b>${esc(fmtWhen(inst.lastPlayed))}</b></span>${st.mods != null ? `<span><b>${st.mods}</b> ${plural(st.mods, 'mod', 'mody', 'modów')}</span>` : ''}`
      : '<span>Utwórz instancję, aby zagrać.</span>';
    $('#h-folder', root).disabled = !inst;
    renderPlayBlock($('#play', root), inst);
    renderReady($('#h-ready', root), inst);

    const recent = [...s.instances].sort((a, b) => (b.lastPlayed || 0) - (a.lastPlayed || 0) || (b.created || 0) - (a.created || 0)).slice(0, 4);
    const box = $('#h-recent', root);
    const sig = recent.map(i => [i.id, i.name, i.mcVersion, i.id === s.selectedInstance, App.running === i.id, hasContentUpdates(App.contentUpdates[i.id]), instArt(i)].join(':')).join();
    if (box.dataset.sig !== sig) {
      const first = box.dataset.sig == null;
      box.dataset.sig = sig;
      const tilts = ['1.5deg', '0deg', '-1.5deg', '1deg'];
      box.innerHTML = recent.map((i, k) => {
        const dot = App.running === i.id ? 'ready' : hasContentUpdates(App.contentUpdates[i.id]) ? 'wait' : i.noreClient ? 'nore' : 'off';
        const sub = App.running === i.id ? 'W grze' : hasContentUpdates(App.contentUpdates[i.id]) ? 'Aktualizacja' : `${i.mcVersion} · ${i.lastPlayed ? fmtAgo(i.lastPlayed) : 'nowa'}`;
        const bg = instArt(i);
        return `<figure class="${i.id === s.selectedInstance ? 'on' : ''}" data-id="${esc(i.id)}">
          <div class="sticker" style="--tilt:${tilts[k]};${bg ? `background-image:${bg}` : `background-color:color-mix(in oklab, ${(INSTANCE_COLORS[i.color % INSTANCE_COLORS.length] || INSTANCE_COLORS[0])[0]} 40%, var(--nore-page-raised))`}">
            ${bg ? '' : `<span class="inst-mono">${i.noreClient ? '<img src="assets/logo.png" alt="">' : esc((i.name || '?').charAt(0).toUpperCase())}</span>`}
            <button class="rp" data-play title="${App.running === i.id ? 'Zatrzymaj' : 'Graj'}" aria-label="${App.running === i.id ? 'Zatrzymaj' : 'Graj'}">${icon(App.running === i.id ? 'stop' : 'play')}</button></div>
          <figcaption>${esc(i.name)}<small><i class="sdot sm ${dot}"></i>${esc(sub)}</small></figcaption></figure>`;
      }).join('') + `<figure class="add" data-new><div class="slot add">${icon('plus')}</div><figcaption class="muted">Nowa instancja<small>pusty slot</small></figcaption></figure>`;
      if (first) stagger(box);
      $$('figure[data-id]', box).forEach(r => {
        const inst2 = s.instances.find(i => i.id === r.dataset.id);
        r.onclick = async (e) => {
          if (e.target.closest('[data-play]')) {
            if (App.running === inst2.id) return nore.game.kill();
            await nore.instances.select(inst2.id); await App.refresh(); return launchSelected(inst2);
          }
          await nore.instances.select(inst2.id); await App.refresh();
        };
      });
      $('[data-new]', box).onclick = () => createInstanceModal();
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
    box.innerHTML = `<h3 class="section-title"><i class="sdot wait"></i>Dostępne aktualizacje
        <button class="btn ghost sm icon" id="upd-re" title="Sprawdź ponownie" style="margin-left:auto">${icon('refresh')}</button></h3>
      ${list.map(i => {
        const u = App.contentUpdates[i.id];
        const other = contentUpdatesText(u);
        return `<div class="h14-ui" data-id="${esc(i.id)}">${instIcon(i, 34)}
          <div class="meta"><b>${esc(i.name)}</b><span>${u.pack ? `Modpack ${esc(u.pack.version)} ${versionTypeTag(u.pack.type)}${u.pack.mcChanged ? ` · MC ${esc(u.pack.mcVersion)}` : ''}` : ''}${u.pack && other ? '<br>' : ''}${esc(other)}</span></div>
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
  loadInstanceStats().then(() => { if (root.isConnected) render(); });
  return () => { offApp(); offChat(); };
};

/** The line under Graj: one dot, one sentence. */
function renderReady(box, inst) {
  if (!box) return;
  const p = App.progress;
  const frac = progressFrac(p);
  let html;
  if (!inst) html = '<i class="sdot sm off"></i>Brak instancji';
  else if (p) html = `<i class="sdot sm wait"></i>${esc(p.stage || 'Przygotowanie')}${frac != null ? ` · <b class="tnum">${Math.round(frac * 100)}%</b>` : ''}${p.totalBytes ? ` · ${fmtBytes(p.bytes)} / ${fmtBytes(p.totalBytes)}` : ''}`;
  else if (App.running && App.running === inst.id) html = '<i class="sdot sm ready"></i>W grze · launcher czeka w tle';
  else if (App.running) html = '<i class="sdot sm wait"></i>Gra działa na innej instancji';
  else if (hasContentUpdates(App.contentUpdates[inst.id])) html = `<i class="sdot sm wait"></i>Gotowe do gry · dostępne aktualizacje: ${esc(contentUpdatesText(App.contentUpdates[inst.id]) || 'modpack')}`;
  else if (!App.account()) html = '<i class="sdot sm info"></i>Gotowe do gry · przed startem podasz swój nick';
  else html = `<i class="sdot sm ready"></i>Gotowe do gry · ${esc(App.account().name)}${App.account().type === 'microsoft' ? ' (premium)' : ' (bez premium)'}`;
  if (box._html !== html) { box._html = html; box.innerHTML = html; }
}

// ------------------------------------------------------------------ the Graj block: press → progress → playing (design/README.md)

const progressFrac = (p) => (p && p.total ? Math.min(1, p.totalBytes ? p.bytes / p.totalBytes : p.done / p.total) : null);

/** Release after a press: a pale band sweeps once across the sticker. */
function playRub(btn) {
  if (!btn || Motion.off()) return;
  btn.classList.remove('rub'); void btn.offsetWidth; btn.classList.add('rub');
  clearTimeout(btn._rub); btn._rub = setTimeout(() => btn.classList.remove('rub'), Motion.ms('--nore-dur-base') + 40);
}

/** A dot sticker slaps onto the Graj sticker's corner: wait while preparing, ready in game, error after a failed start. */
function playDot(btn, state) {
  const dot = btn && btn.parentElement && btn.parentElement.querySelector('.play-dot');
  if (!dot) return;
  const c = { wait: 'var(--nore-dot-wait)', ready: 'var(--nore-dot-ready)', error: 'var(--nore-dot-error)' }[state];
  if (dot.dataset.s === (state || '')) return;
  dot.dataset.s = state || '';
  dot.hidden = !c;
  if (!c) return;
  dot.style.setProperty('--c', c);
  dot.style.animation = 'none'; void dot.offsetWidth; dot.style.animation = '';
}

/** Builds the Graj block once, then updates it in place so its fill and label can move:
    idle "GRAJ" → busy (the accent-deep layer fills with the exact download fraction) → launching → running "W GRZE" / "ZATRZYMAJ". */
function renderPlayBlock(btn, inst) {
  if (!btn) return;
  if (!btn._built) {
    btn.innerHTML = '<span class="pl-fill"></span><span class="pl-label"></span>';
    btn._built = true;
    btn.addEventListener('pointerenter', () => { if (btn.dataset.state === 'run') Motion.swap($('.pl-label', btn), `${icon('stop')} ZATRZYMAJ`); });
    btn.addEventListener('pointerleave', () => { if (btn.dataset.state === 'run') Motion.swap($('.pl-label', btn), '<i class="pl-live"></i> W GRZE', -1); });
  }
  const running = !!(App.running && inst && App.running === inst.id);
  const p = App.progress;
  const frac = progressFrac(p);
  const launching = !!p && (frac == null || frac >= 1) && /urucham|start|launch/i.test(p.stage || '');
  btn.classList.toggle('running', running);
  btn.classList.toggle('busy', !!p);
  btn.classList.toggle('indeterminate', !!p && frac == null && !launching);
  btn.classList.toggle('waiting', launching && !Motion.off());
  btn.disabled = !inst || !!p || (!!App.running && !running);
  btn.style.setProperty('--p', frac == null ? 0 : frac.toFixed(3));
  const state = p ? (launching ? 'launch' : 'busy') : running ? 'run' : 'idle';
  const label = $('.pl-label', btn);
  const pctText = frac == null ? '' : Math.round(frac * 100) + '%';
  if (btn.dataset.state !== state) {
    const prev = btn.dataset.state;
    btn.dataset.state = state;
    btn.setAttribute('aria-label', state === 'busy' ? 'Przygotowanie gry' : state === 'launch' ? 'Uruchamianie' : state === 'run' ? 'Zatrzymaj grę' : 'Graj');
    Motion.swap(label, state === 'busy' ? `<span class="pl-pct">${pctText || '…'}</span>` : state === 'launch' ? 'URUCHAMIANIE' : state === 'run' ? '<i class="pl-live"></i> W GRZE' : `${icon('play')} GRAJ`, state === 'idle' ? -1 : 1);
    playDot(btn, state === 'busy' || state === 'launch' ? 'wait' : state === 'run' ? 'ready' : null);
    // a start that ended without the game running is an error: red dot, three small shakes
    if (state === 'idle' && (prev === 'busy' || prev === 'launch') && !App.running && App.lastLaunchError) {
      playDot(btn, 'error');
      if (!Motion.off() && !Motion.reduced()) { btn.classList.remove('shake'); void btn.offsetWidth; btn.classList.add('shake'); }
      Motion.swap(label, 'SPRÓBUJ PONOWNIE');
      setTimeout(() => { if (btn.dataset.state === 'idle') { Motion.swap(label, `${icon('play')} GRAJ`, -1); playDot(btn, null); } }, 4000);
    }
  }
  const pct = $('.pl-pct', label);
  if (pct && pctText) pct.textContent = pctText;
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
    if (!first) Motion.animate(btn, [{ transform: 'scale(.7)', opacity: 0.4 }, { transform: 'none', opacity: 1 }], { duration: Motion.ms('--nore-spring-stick-dur'), easing: Motion.ease('--nore-spring-stick') });
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
