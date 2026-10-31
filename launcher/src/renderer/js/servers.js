'use strict';
/* Servers 2.0: list + server panel (overview, console, players, add-ons, worlds, network & domain, settings). */

const ENGINES = [
  { value: 'paper', label: 'Paper', hint: 'Szybki, pluginy', color: '#4da3ff' },
  { value: 'purpur', label: 'Purpur', hint: 'Paper + więcej opcji', color: '#b67cff' },
  { value: 'fabric', label: 'Fabric', hint: 'Mody serwerowe', color: '#dbb784' },
  { value: 'quilt', label: 'Quilt', hint: 'Mody Quilt + Fabric', color: '#c58cff' },
  { value: 'neoforge', label: 'NeoForge', hint: 'Duże mody', color: '#f2894a' },
  { value: 'forge', label: 'Forge', hint: 'Klasyczne mody', color: '#7d93b5' },
  { value: 'vanilla', label: 'Vanilla', hint: 'Oficjalny', color: '#6fcf6f' },
  { value: 'folia', label: 'Folia', hint: 'Wielowątkowy (eksp.)', color: '#4fd1a8' },
  { value: 'velocity', label: 'Velocity', hint: 'Proxy: kilka serwerów', color: '#3fb6e8', proxy: true },
  { value: 'bungeecord', label: 'BungeeCord', hint: 'Proxy (klasyczne)', color: '#e0b84a', proxy: true },
];
const SRC_LABEL = { modrinth: 'Modrinth', curseforge: 'CurseForge', hangar: 'Hangar' };
const MOTD_COLORS = { 0: '#000000', 1: '#0000aa', 2: '#00aa00', 3: '#00aaaa', 4: '#aa0000', 5: '#aa00aa', 6: '#ffaa00', 7: '#aaaaaa', 8: '#555555', 9: '#5555ff', a: '#55ff55', b: '#55ffff', c: '#ff5555', d: '#ff55ff', e: '#ffff55', f: '#ffffff' };
const engine = (t) => ENGINES.find(e => e.value === t) || ENGINES[0];
const srvSeenState = {};
const SRV_STATE = { stopped: 'Wyłączony', starting: 'Uruchamianie…', running: 'Online', stopping: 'Zatrzymywanie…' };
const KIND_LABEL = { plugin: 'Pluginy', mod: 'Mody', datapack: 'Datapacki', modpack: 'Paczki modów' };

/** CurseForge files blocked for other apps on a server built from a modpack. */
function serverBlockedModal(id) {
  blockedFilesModal({ id, name: 'Serwer' }, { list: () => nore.servers.blocked(id), resolve: () => nore.servers.resolveBlocked(id) });
}

function copyText(text, label = 'Skopiowano') {
  navigator.clipboard.writeText(text).then(() => toast(label, text, 'success', 1800));
}

function srvIcon(s, size = 52) {
  const e = engine(s.type);
  return `<div class="srv2-ico" style="--ec:${e.color};width:${size}px;height:${size}px" data-icon="${s.hasIcon ? s.id : ''}">
    ${icon('server')}</div>`;
}

async function hydrateIcons(root) {
  for (const box of $$('[data-icon]', root)) {
    const id = box.dataset.icon;
    if (!id) continue;
    const url = await nore.servers.icon(id).catch(() => null);
    if (url) box.innerHTML = `<img src="${url}" alt="">`;
  }
}

// ================================================================== list

/** A row whose server just changed state: the signal bars climb (or drop) one by one and the status line fades in. */
function srvStateMotion(card, up) {
  $$('.srv2-sig i', card).forEach((b, i, all) => Motion.animate(b, [{ transform: `scaleY(${up ? 0 : 1})`, opacity: up ? 0.4 : 1 }, { transform: 'scaleY(1)', opacity: 1 }],
    { duration: Motion.ms('--dur-base'), delay: (up ? i : all.length - 1 - i) * 45, easing: Motion.ease('--ease-spring'), fill: 'backwards' }));
  const st = $('.srv2-st', card);
  if (st) Motion.animate(st, [{ opacity: 0, transform: `translateY(${Motion.px(4)}px)` }, { opacity: 1, transform: 'none' }], { duration: Motion.ms('--dur-base'), easing: Motion.ease('--ease-out') });
}

Pages.servers = (root) => {
  let alive = true;
  const progress = {};
  let netInfo = null;
  nore.servers.netInfo().then(n => { netInfo = n; if (alive) render(); }).catch(() => {});

  let rendered = false;
  const render = async () => {
    const list = await nore.servers.list();
    if (!alive) return;
    const online = list.filter(s => s.state === 'running');
    const players = online.reduce((n, s) => n + s.players.length, 0);
    root.innerHTML = `<div class="srv2-hero card">
        <div class="srv2-hero-glow"></div>
        <div style="flex:1;position:relative">
          <h2>Serwery</h2>
          <p class="muted">Twój własny serwer Minecraft w minutę: Paper, Purpur, Fabric, NeoForge, Forge – z pluginami, modami,
            kopiami zapasowymi i własną domeną.</p>
          <div class="row" style="gap:10px;margin-top:14px;flex-wrap:wrap">
            <div class="srv2-pill">${icon('activity')} <b>${online.length}</b> online</div>
            <div class="srv2-pill">${icon('users')} <b>${players}</b> graczy</div>
            <div class="srv2-pill copyable" id="pubip" title="Kopiuj">${icon('globe')} IP: <b>${esc(netInfo && netInfo.publicIp ? netInfo.publicIp : '…')}</b></div>
          </div>
        </div>
        <button class="btn" id="new">${icon('plus')} Nowy serwer</button>
      </div>
      <div class="section-title" style="margin-top:18px">${icon('crown')} Oficjalny serwer</div>
      <section id="srv-official" style="margin-top:10px"></section>
      <div class="section-title" style="margin-top:18px">${icon('server')} Twoje serwery</div>
      <div class="srv2-list" id="grid" style="margin-top:10px"></div>`;
    Official.card($('#srv-official', root));
    const grid = $('#grid', root);
    grid.innerHTML = list.map(s => {
      const e = engine(s.type);
      const motd = (s.props && s.props.motd) || `§7${e.label} ${s.mcVersion}`;
      const live = s.state === 'running';
      return `<div class="card hover srv2-card srv2-row ${s.state}" data-id="${s.id}" style="--ec:${e.color}">
        <div class="srv2-line">${srvIcon(s)}
          <div class="srv2-text"><h3>${esc(s.name)}</h3>
            <div class="motd srv2-motd">${Motd.html(motd)}</div>
            <div class="row" style="gap:5px;margin-top:6px;flex-wrap:wrap"><span class="tag eng">${esc(e.label)}</span><span class="tag offline">${esc(s.mcVersion)}</span><span class="tag offline">:${s.port}</span>
              ${s.domain && s.domain.name ? `<span class="tag offline">${esc(s.domain.name)}</span>` : ''}</div></div>
          <div class="srv2-right">
            <div class="srv2-sig ${live ? 'on' : ''}" title="${SRV_STATE[s.state] || s.state}"><i></i><i></i><i></i><i></i><i></i></div>
            <div class="srv2-count">${live ? `${s.players.length}<span>/${s.props['max-players']}</span>` : `${(s.memoryMb / 1024).toFixed(1)} GB`}</div>
            <div class="srv2-st"><i class="sdot sm ${live ? 'ready' : s.state === 'stopped' ? 'off' : s.state === 'crashed' ? 'error' : 'wait'}"></i>${esc(SRV_STATE[s.state] || s.state)}</div></div></div>
        <div class="srv2-actions">
          ${s.state === 'stopped' ? `<button class="btn sm success" data-a="start">${icon('play')} Start</button>` : `<button class="btn sm danger" data-a="stop" ${s.state === 'stopping' ? 'disabled' : ''}>${icon('stop')} Stop</button>`}
          <button class="btn sm" data-a="open">${icon('settings')} Zarządzaj</button>
          ${live ? `<button class="btn sm ghost" data-a="join">${icon('arrowRight')} Dołącz</button>` : ''}
          <span class="srv-progress">${progress[s.id] || ''}</span>
          <span class="spacer"></span>
          <button class="btn ghost sm icon" data-a="copy" title="Kopiuj adres">${icon('copy')}</button></div></div>`;
    }).join('') + `<button class="card hover srv2-add" id="new2"><span class="plus">${icon('plus')}</span><b>Nowy serwer</b><span class="muted">Paper, Purpur, Fabric, NeoForge, Forge…</span></button>`;
    // the list arrives once; later renders (a server changed state) refresh it in place
    stagger(grid, !rendered);
    rendered = true;
    hydrateIcons(grid);
    if ($('#pubip', root)) $('#pubip', root).onclick = () => netInfo && netInfo.publicIp && copyText(netInfo.publicIp, 'Skopiowano IP');
    $('#new', root).onclick = $('#new2', root).onclick = () => createServerModal2(render);
    $$('.srv2-card', grid).forEach(card => {
      const id = card.dataset.id;
      const s = list.find(x => x.id === id);
      if (srvSeenState[id] && srvSeenState[id] !== s.state) {
        if (s.state === 'running' || s.state === 'stopped') Motd.lit(card);
        srvStateMotion(card, s.state === 'running');
      }
      srvSeenState[id] = s.state;
      card.onclick = async (ev) => {
        const a = ev.target.closest('[data-a]');
        if (!a) return go('server', { id });
        ev.stopPropagation();
        try {
          if (a.dataset.a === 'start') await startServer(s);
          if (a.dataset.a === 'stop') await nore.servers.stop(id);
          if (a.dataset.a === 'open') go('server', { id });
          if (a.dataset.a === 'join') joinServer(s);
          if (a.dataset.a === 'copy') copyText(s.domain && s.domain.name ? s.domain.name : `${netInfo && netInfo.publicIp ? netInfo.publicIp : 'localhost'}:${s.port}`, 'Skopiowano adres');
        } catch (err) { errorToast(err); }
      };
    });
  };
  const offs = [
    nore.on('server:state', () => alive && !$('.modal-backdrop') && render()),
    nore.on('server:progress', (p) => {
      if (p.done) delete progress[p.id]; else if (p.stage) progress[p.id] = p.stage;
      const el2 = $(`.srv2-card[data-id="${p.id}"] .srv-progress`, root);
      if (el2) el2.textContent = progress[p.id] || '';
    }),
  ];
  render();
  return () => { alive = false; offs.forEach(o => o()); };
};

function createServerModal2(done) {
  const m = modal(`<h3>Nowy serwer</h3><p class="sub">Działa na Twoim komputerze. Znajomi dołączą przez LAN, a po otwarciu portu – z internetu.</p>
    <div class="field"><label>Nazwa</label><input class="input" id="name" placeholder="Mój serwer" maxlength="32"></div>
    <div class="field"><label>Na podstawie instancji (opcjonalnie)</label><select class="input" id="frominst"><option value="">— nowy, pusty serwer —</option>${(App.state.instances || []).map(i => `<option value="${esc(i.id)}">${esc(i.name)} • ${esc(i.mcVersion)}${i.loader !== 'vanilla' ? ' • ' + esc(loaderName(i.loader)) : ''}${i.pack && i.pack.projectId ? ' • modpack' : ''}</option>`).join('')}</select>
      <span class="hint">Ta sama wersja Minecrafta i loader – a dla modpacka z Modrinth lub CurseForge ta sama paczka po stronie serwera.</span></div>
    <div class="field"><label>Albo z modpacka (opcjonalnie)</label>
      <div class="row" style="gap:8px"><div id="psrc"></div><input class="input" id="pq" placeholder="Szukaj modpacka, np. All the Mods, Cobblemon…" style="flex:1"></div>
      <div id="pres" class="srv-packpick"></div>
      <span class="hint" id="phint">Paczka ustawi wersję Minecrafta i silnik. Z CurseForge launcher użyje server packa autora, a gdy go nie ma – zbuduje serwer z listy modów (bez modów tylko dla klienta).</span></div>
    <div class="field" id="engf"><label>Silnik</label><div class="eng-grid" id="eng">${ENGINES.map(e => `<button class="eng ${e.value === 'paper' ? 'on' : ''}" data-v="${e.value}" style="--ec:${e.color}"><b>${e.label}</b><span>${e.hint}</span></button>`).join('')}</div></div>
    <div class="row" style="gap:12px"><div class="field" style="flex:1" id="verf"><label>Wersja</label><select class="input" id="ver"><option>Ładowanie…</option></select></div>
      <div class="field" style="width:130px"><label>Port</label><input class="input" id="port" value="25565"></div></div>
    <div class="field"><label>Pamięć RAM</label><div class="row"><input type="range" class="slider" id="mem" min="1024" max="${Math.max(4096, App.info.totalMemMb - 2048)}" step="512" value="3072" style="flex:1"><div class="value-pill" id="memv"></div></div></div>
    <div class="setting" style="padding:10px 0"><div class="col"><b>Gracze non-premium</b><span>Wyłącza online-mode (wymagane dla kont non-premium)</span></div><label class="switch"><input type="checkbox" id="offline" checked><i></i></label></div>
    <div class="setting" style="padding:10px 0"><div class="col"><b>Akceptuję EULA Minecraft</b><span><a href="#" id="eula-link">aka.ms/MinecraftEULA</a></span></div><label class="switch"><input type="checkbox" id="eula"><i></i></label></div>
    <div class="foot"><button class="btn ghost" data-close>Anuluj</button><button class="btn" id="create">${icon('plus')} Utwórz</button></div>`);
  let type = 'paper';
  let pack = null; // { projectId, title, source }
  const pickEngine = (v) => {
    type = v;
    $$('.eng', m.el).forEach(x => x.classList.toggle('on', x.dataset.v === v));
    const proxy = engine(v).proxy;
    $('#verf', m.el).style.visibility = proxy ? 'hidden' : '';
    $('#offline', m.el).closest('.setting').style.display = proxy ? 'none' : '';
    if (proxy && $('#port', m.el).value === '25565') $('#port', m.el).value = '25577';
    if (!proxy && $('#port', m.el).value === '25577') $('#port', m.el).value = '25565';
  };
  // modpack picker (Modrinth / CurseForge)
  let psource = 'modrinth', ptimer = null;
  $('#psrc', m.el).appendChild(segmented([{ value: 'modrinth', label: 'Modrinth' }, { value: 'curseforge', label: 'CurseForge' }], psource, (v) => { psource = v; pack = null; searchPacks(); }));
  const drawPick = () => {
    $('#engf', m.el).style.display = pack ? 'none' : '';
    $('#verf', m.el).style.display = pack ? 'none' : '';
  };
  async function searchPacks() {
    const q = $('#pq', m.el).value.trim();
    const box = $('#pres', m.el);
    if (!q) { box.innerHTML = ''; pack = null; drawPick(); return; }
    box.innerHTML = '<div class="muted" style="font-size:12px;padding:6px 0"><span class="spinner"></span> Szukanie…</div>';
    try {
      const res = await nore.content.search({ query: q, kind: 'modpack', source: psource, limit: 6, sort: 'relevance', loaders: ['fabric', 'quilt', 'forge', 'neoforge'] });
      box.innerHTML = (res.hits || []).slice(0, 6).map(h => `<button class="srv-pack ${pack && pack.projectId === h.project_id ? 'on' : ''}" data-pid="${esc(h.project_id)}" data-t="${esc(h.title)}">
        <img src="${esc(h.icon_url || '')}" data-fallback alt=""><span><b>${esc(h.title)}</b><small>${fmtNum(h.downloads)} pobrań • ${esc(SRC_LABEL[h.source || psource] || '')}</small></span></button>`).join('') || '<div class="muted" style="font-size:12px">Nic nie znaleziono.</div>';
      $$('.srv-pack', box).forEach(b => b.onclick = () => {
        const same = pack && pack.projectId === b.dataset.pid;
        pack = same ? null : { projectId: b.dataset.pid, title: b.dataset.t, source: psource };
        $$('.srv-pack', box).forEach(x => x.classList.toggle('on', !same && x === b));
        if (pack && !$('#name', m.el).value.trim()) $('#name', m.el).value = `${pack.title} – serwer`.slice(0, 32);
        drawPick();
      });
    } catch (e) { box.innerHTML = `<div class="muted" style="font-size:12px">${esc(e.message)}</div>`; }
  }
  $('#pq', m.el).oninput = () => { clearTimeout(ptimer); ptimer = setTimeout(searchPacks, 350); };
  $$('.eng', m.el).forEach(b => b.onclick = () => pickEngine(b.dataset.v));
  $('#frominst', m.el).onchange = (e) => {
    const inst = (App.state.instances || []).find(i => i.id === e.target.value);
    if (!inst) return;
    pickEngine(['fabric', 'quilt', 'forge', 'neoforge'].includes(inst.loader) ? inst.loader : 'paper');
    const sel = $('#ver', m.el);
    if (![...sel.options].some(o => o.value === inst.mcVersion)) sel.add(new Option(inst.mcVersion, inst.mcVersion));
    sel.value = inst.mcVersion;
    if (!$('#name', m.el).value.trim()) $('#name', m.el).value = `${inst.name} – serwer`.slice(0, 32);
  };
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
    try {
      const srv = await nore.servers.create({
        name: $('#name', m.el).value.trim() || `Serwer ${$('#ver', m.el).value}`, mcVersion: $('#ver', m.el).value, type,
        memoryMb: +r.value, port, eula: $('#eula', m.el).checked,
      });
      await nore.servers.update(srv.id, { props: { 'online-mode': !$('#offline', m.el).checked } });
      const from = (App.state.instances || []).find(i => i.id === $('#frominst', m.el).value);
      if (from && from.loaderVersion && from.loader === type) await nore.servers.update(srv.id, { loaderVersion: from.loaderVersion });
      m.close();
      toast('Utworzono serwer', srv.name, 'success');
      const src = pack ? pack : from && from.pack && from.pack.projectId ? { projectId: from.pack.projectId, versionId: from.pack.versionId, title: from.pack.title || from.name } : null;
      if (src) {
        toast('Modpack na serwerze', `${src.title} – instalowanie…`);
        nore.servers.contentInstall(srv.id, { kind: 'modpack', projectId: src.projectId, versionId: src.versionId || null, source: String(src.projectId).startsWith('cf:') ? 'curseforge' : 'modrinth' })
          .then(r => {
            toast('Modpack zainstalowany', `${r.name} – Minecraft ${r.mcVersion}${r.serverPack ? ' (server pack autora)' : r.clientSkipped && r.clientSkipped.length ? `, pominięto ${r.clientSkipped.length} plików tylko dla klienta` : ''}`, 'success', 7000);
            if (r.blocked && r.blocked.length) serverBlockedModal(srv.id);
          }).catch(e => errorToast(e, 'Modpack'));
      }
      done && done();
      go('server', { id: srv.id });
    } catch (e) { errorToast(e); }
  };
}

// ================================================================== server panel

const SRV_TABS = [
  { value: 'overview', label: 'Przegląd' }, { value: 'console', label: 'Konsola' }, { value: 'players', label: 'Gracze' },
  { value: 'addons', label: 'Dodatki' }, { value: 'worlds', label: 'Światy' }, { value: 'network', label: 'Sieć i domena' },
  { value: 'settings', label: 'Ustawienia' },
];

Pages.server = (root, { id, tab: startTab }) => {
  let alive = true;
  let s = null;
  let tab = startTab || 'overview';
  let statsTimer = null;
  let tunnelListener = null;
  const consoleLines = [];

  root.innerHTML = `<div id="shead"></div><div class="row" style="margin:16px 0" id="tabs"></div><div id="tab"></div>`;

  const renderHead = async () => {
    s = await nore.servers.list().then(l => l.find(x => x.id === id));
    if (!s || !alive) return;
    const e = engine(s.type);
    $('#shead', root).innerHTML = `<div class="srv2-hero card" style="--ec:${e.color}"><div class="srv2-hero-glow"></div>
      <button class="btn ghost sm icon" id="back" style="position:relative">${icon('arrowLeft')}</button>
      <div class="srv2-icon-edit" id="seticon" title="Zmień ikonę serwera">${srvIcon(s, 64)}<span>${icon('edit')}</span></div>
      <div style="flex:1;min-width:0;position:relative"><h2 style="font-size:26px">${esc(s.name)}</h2>
        <div class="row" style="gap:6px;margin-top:8px;flex-wrap:wrap"><span class="tag eng">${esc(e.label)}</span><span class="tag offline">${esc(s.mcVersion)}</span>
        <span class="tag offline">:${s.port}</span><span class="srv2-state ${s.state}"><i></i>${SRV_STATE[s.state]}</span></div></div>
      <div class="row" style="position:relative">${s.state === 'stopped' ? `<button class="btn success" id="start">${icon('play')} Start</button>`
        : `<button class="btn danger" id="stop" ${s.state === 'stopping' ? 'disabled' : ''}>${icon('stop')} Stop</button><button class="btn ghost" id="restart">${icon('refresh')} Restart</button>`}
        ${s.state === 'running' ? `<button class="btn" id="join">${icon('arrowRight')} Dołącz</button>` : ''}
        <button class="btn ghost icon" id="folder" title="Folder serwera">${icon('folder')}</button></div></div>`;
    hydrateIcons($('#shead', root));
    $('#back', root).onclick = () => go('servers');
    $('#folder', root).onclick = () => nore.servers.folder(id);
    $('#seticon', root).onclick = async () => { if (await nore.servers.setIcon(id).catch(errorToast)) { toast('Ustawiono ikonę', 'Pojawi się na liście serwerów w grze', 'success'); renderHead(); } };
    if ($('#start', root)) $('#start', root).onclick = () => startServer(s);
    if ($('#stop', root)) $('#stop', root).onclick = () => nore.servers.stop(id);
    if ($('#restart', root)) $('#restart', root).onclick = () => nore.servers.restart(id).catch(errorToast);
    if ($('#join', root)) $('#join', root).onclick = () => joinServer(s);
  };

  const tabs = segmented(SRV_TABS, tab, (v) => { tab = v; renderTab(); });
  $('#tabs', root).appendChild(tabs);

  const box = () => $('#tab', root);

  async function renderTab() {
    clearInterval(statsTimer);
    if (!s) await renderHead();
    if (!alive || !s) return;
    const t = box();
    t.innerHTML = '';
    t.classList.remove('fade-in');
    void t.offsetWidth;
    t.classList.add('fade-in');
    ({ overview, console: consoleTab, players: playersTab, addons, worlds, network, settings })[tab](t);
  }

  // ---------------------------------------------------------------- overview
  async function overview(t) {
    const net = await nore.servers.netInfo().catch(() => ({ lan: [], publicIp: null }));
    if (!alive || tab !== 'overview') return;
    const lan = (net.lan[0] && net.lan[0].address) || '127.0.0.1';
    const addrs = [
      ['Na tym komputerze', `localhost:${s.port}`, 'monitor'],
      ['W sieci domowej (LAN)', `${lan}:${s.port}`, 'wifi'],
      ['Z internetu', net.publicIp ? `${net.publicIp}${s.port === 25565 ? '' : ':' + s.port}` : 'brak połączenia', 'globe'],
    ];
    if (s.domain && s.domain.name) addrs.push(['Domena', s.domain.name + (s.port === 25565 || s.domain.provider === 'cloudflare' ? '' : ':' + s.port), 'link']);
    t.innerHTML = `<div class="grid" style="grid-template-columns:repeat(5,1fr);gap:12px">
        <div class="card stat srv2-stat"><span>Status</span><b id="st-state">${SRV_STATE[s.state]}</b></div>
        <div class="card stat srv2-stat"><span>Gracze</span><b id="st-players">${s.players.length} / ${s.props['max-players']}</b></div>
        <div class="card stat srv2-stat"><span>RAM</span><b id="st-mem">– / ${(s.memoryMb / 1024).toFixed(1)} GB</b><div class="bar"><i id="st-membar"></i></div></div>
        <div class="card stat srv2-stat" title="Ticki na sekundę – 20 to pełna płynność. Paper, Purpur, Folia, Forge i NeoForge."><span>TPS</span><b id="st-tps" class="tps-val">–</b><div class="muted" id="st-mspt" style="font-size:11px"></div></div>
        <div class="card stat srv2-stat"><span>Czas działania</span><b id="st-up">–</b><div class="muted" id="st-next" style="font-size:11px"></div></div></div>
      <div class="grid" style="grid-template-columns:1.2fr 1fr;gap:16px;margin-top:16px">
        <div class="card panel"><div class="section-title">${icon('link')} Adresy do połączenia</div>
          <div class="col" style="gap:8px;margin-top:12px">${addrs.map(([l, a, ic]) => `<div class="addr-row">${icon(ic)}<div style="flex:1"><span>${l}</span><b>${esc(a)}</b></div>
            <button class="btn ghost sm icon" data-copy="${esc(a)}">${icon('copy')}</button></div>`).join('')}</div>
          <div class="muted" style="font-size:12px;margin-top:10px">Znajomi spoza Twojej sieci potrzebują otwartego portu – zakładka <a href="#" id="tonet">Sieć i domena</a>.</div></div>
        <div class="card panel"><div class="section-title">${icon('zap')} Szybkie akcje</div>
          <div class="quick-grid">
            <button class="qa" data-q="backup">${icon('archive')}<b>Kopia zapasowa</b><span>Zapisz świat teraz</span></button>
            <button class="qa" data-q="addons">${icon('plug')}<b>${s.type === 'vanilla' ? 'Datapacki' : ['paper', 'purpur', 'folia', 'velocity', 'bungeecord'].includes(s.type) ? 'Pluginy' : 'Mody'}</b><span>Modrinth, CurseForge, Hangar</span></button>
            <button class="qa" data-q="day" ${s.state !== 'running' ? 'disabled' : ''}>${icon('sun')}<b>Dzień</b><span>time set day</span></button>
            <button class="qa" data-q="save" ${s.state !== 'running' ? 'disabled' : ''}>${icon('database')}<b>Zapisz świat</b><span>save-all</span></button>
          </div></div></div>`;
    $$('[data-copy]', t).forEach(b => b.onclick = () => copyText(b.dataset.copy, 'Skopiowano adres'));
    $('#tonet', t).onclick = (e) => { e.preventDefault(); switchTab('network'); };
    $$('[data-q]', t).forEach(b => b.onclick = async () => {
      try {
        if (b.dataset.q === 'backup') { toast('Kopia zapasowa', 'Tworzenie…'); toast('Gotowe', await nore.servers.backup(id), 'success'); }
        if (b.dataset.q === 'addons') switchTab('addons');
        if (b.dataset.q === 'day') await nore.servers.command(id, 'time set day');
        if (b.dataset.q === 'save') await nore.servers.command(id, 'save-all');
      } catch (e) { errorToast(e); }
    });
    const tick = async () => {
      const st = await nore.servers.stats(id).catch(() => null);
      if (!alive || tab !== 'overview') return;
      if (!st) { $('#st-mem', t).textContent = `– / ${(s.memoryMb / 1024).toFixed(1)} GB`; $('#st-up', t).textContent = '–'; return; }
      if (st.memMb) {
        $('#st-mem', t).textContent = `${(st.memMb / 1024).toFixed(1)} / ${(s.memoryMb / 1024).toFixed(1)} GB`;
        $('#st-membar', t).style.width = Math.min(100, st.memMb / s.memoryMb * 100) + '%';
      }
      $('#st-up', t).textContent = fmtDuration(st.uptime);
      const tpsEl = $('#st-tps', t);
      if (st.tps && st.tps.tps != null) {
        tpsEl.textContent = st.tps.tps.toFixed(1);
        tpsEl.className = 'tps-val ' + (st.tps.tps >= 19 ? 'good' : st.tps.tps >= 15 ? 'mid' : 'bad');
        $('#st-mspt', t).textContent = st.tps.mspt != null ? `${st.tps.mspt.toFixed(1)} ms/tick` : '';
      } else { tpsEl.textContent = ['vanilla', 'fabric', 'quilt', 'velocity', 'bungeecord'].includes(s.type) ? 'n/d' : '…'; tpsEl.className = 'tps-val'; }
      $('#st-next', t).textContent = st.nextRestart ? `restart ${new Date(st.nextRestart).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' })}` : '';
      $('#st-players', t).textContent = `${st.players} / ${s.props['max-players']}`;
    };
    tick();
    statsTimer = setInterval(tick, 3000);
  }

  // ---------------------------------------------------------------- console
  async function consoleTab(t) {
    t.innerHTML = `<div class="card" style="display:flex;flex-direction:column">
        <div class="console" id="log" style="height:calc(100vh - 330px);min-height:300px"></div>
        <div class="row" style="padding:8px 10px;gap:6px;border-top:1px solid var(--line);flex-wrap:wrap">
          ${['list', 'time set day', 'weather clear', 'save-all', 'difficulty normal', 'gamemode creative @a'].map(c => `<button class="chip" data-cmd="${c}">${c}</button>`).join('')}</div>
        <div class="row" style="padding:10px;border-top:1px solid var(--line)"><span class="dim">${icon('terminal')}</span>
          <div class="cmd-wrap"><div class="cmd-sugg" id="sugg" hidden></div><input class="input" id="cmd" placeholder="Komenda serwera (np. op Steve)… Tab – podpowiedź, ↑ – historia" autocomplete="off"></div><button class="btn sm" id="send">Wyślij</button></div></div>`;
    const log = $('#log', t);
    const add = (l) => {
      const d = document.createElement('div');
      d.className = l.stream === 'err' || /ERROR|Exception/.test(l.line) ? 'err' : /WARN/.test(l.line) ? 'warn' : l.stream === 'cmd' ? 'launcher' : 'info';
      d.textContent = l.line;
      const stick = log.scrollTop + log.clientHeight >= log.scrollHeight - 30;
      log.appendChild(d);
      while (log.childElementCount > 2500) log.firstChild.remove();
      if (stick) log.scrollTop = log.scrollHeight;
    };
    const lines = await nore.servers.logs(id);
    if (!lines.length && !consoleLines.length) log.innerHTML = `<div class="empty">${icon('terminal')}<div>Uruchom serwer, aby zobaczyć konsolę.</div></div>`;
    lines.forEach(add);
    log.scrollTop = log.scrollHeight;
    consoleAdd = (l) => { if ($('.empty', log)) log.innerHTML = ''; add(l); };
    // history survives tab switches and launcher restarts (per server)
    const hkey = `nore.srvhist.${id}`;
    let history = [];
    try { history = JSON.parse(localStorage.getItem(hkey) || '[]').slice(-100); } catch { history = []; }
    let hi = history.length;
    const input = $('#cmd', t), sugg = $('#sugg', t);
    let items = [], si = -1;
    const hide = () => { sugg.hidden = true; items = []; si = -1; };
    const paint = () => {
      if (!items.length) return hide();
      sugg.hidden = false;
      sugg.innerHTML = items.map((x, k) => `<div class="${k === si ? 'on' : ''}" data-k="${k}"><span>${esc(x.value)}</span><small>${esc(x.hint || '')}</small></div>`).join('');
      $$('[data-k]', sugg).forEach(d => d.onmousedown = (e) => { e.preventDefault(); input.value = items[+d.dataset.k].value + ' '; hide(); input.focus(); suggest(); });
    };
    let st = null;
    const suggest = () => {
      clearTimeout(st);
      st = setTimeout(async () => {
        const v = input.value;
        if (!v.trim()) return hide();
        items = await nore.servers.complete(id, v, history).catch(() => []);
        si = -1;
        paint();
      }, 80);
    };
    const send = async (v) => {
      v = (v || input.value).trim();
      if (!v) return;
      try {
        await nore.servers.command(id, v);
        history = [...history.filter(h => h !== v), v].slice(-100);
        try { localStorage.setItem(hkey, JSON.stringify(history)); } catch { /* private mode */ }
        hi = history.length; input.value = ''; hide();
      } catch (e) { errorToast(e); }
    };
    $('#send', t).onclick = () => send();
    input.oninput = suggest;
    input.onblur = () => setTimeout(hide, 150);
    input.onkeydown = (e) => {
      if (e.key === 'Tab') {
        e.preventDefault();
        if (items.length) { input.value = items[Math.max(0, si)].value + ' '; hide(); suggest(); }
        return;
      }
      if (!sugg.hidden && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
        e.preventDefault();
        si = (si + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
        return paint();
      }
      if (e.key === 'Escape') return hide();
      if (e.key === 'Enter') { if (!sugg.hidden && si >= 0) { input.value = items[si].value; hide(); return; } send(); }
      if (e.key === 'ArrowUp' && hi > 0) { input.value = history[--hi]; e.preventDefault(); }
      if (e.key === 'ArrowDown' && hi < history.length) { input.value = history[++hi] || ''; e.preventDefault(); }
    };
    $$('[data-cmd]', t).forEach(b => b.onclick = () => send(b.dataset.cmd));
  }
  let consoleAdd = null;

  // ---------------------------------------------------------------- players
  async function playersTab(t) {
    const p = await nore.servers.players(id);
    if (!alive || tab !== 'players') return;
    const head = (n) => `<img src="https://mc-heads.net/avatar/${encodeURIComponent(n)}/32" data-fallback alt="">`;
    const listBox = (which, title, ic, entries, hint) => `<div class="card panel"><div class="section-title">${icon(ic)} ${title} <span class="muted" style="font-weight:500">(${entries.length})</span></div>
      <div class="row" style="gap:8px;margin:12px 0"><input class="input" data-in="${which}" placeholder="Nazwa gracza" maxlength="16" style="flex:1"><button class="btn sm" data-add="${which}">${icon('plus')} Dodaj</button></div>
      <div class="col" style="gap:6px">${entries.length ? entries.map(e => `<div class="player-row"><div class="avatar" style="width:26px;height:26px">${esc(e.name[0])}${head(e.name)}</div><b>${esc(e.name)}</b><span class="spacer"></span>
        <button class="btn ghost sm icon" data-del="${which}" data-name="${esc(e.name)}">${icon('x')}</button></div>`).join('') : `<div class="muted" style="font-size:12px">${hint}</div>`}</div></div>`;
    t.innerHTML = `<div class="card panel"><div class="section-title">${icon('users')} Online teraz (${p.online.length})</div>
        <div class="col" style="gap:6px;margin-top:12px">${p.online.length ? p.online.map(n => `<div class="player-row"><div class="avatar" style="width:30px;height:30px">${esc(n[0])}${head(n)}</div><b>${esc(n)}</b><span class="spacer"></span>
          <button class="btn ghost sm" data-c="op ${esc(n)}">${icon('crown')} OP</button><button class="btn ghost sm" data-c="kick ${esc(n)}">Wyrzuć</button><button class="btn danger sm" data-c="ban ${esc(n)}">${icon('ban')} Ban</button></div>`).join('')
          : `<div class="muted" style="font-size:13px">${s.state === 'running' ? 'Nikogo jeszcze nie ma.' : 'Serwer jest wyłączony.'}</div>`}</div></div>
      <div class="grid" style="grid-template-columns:repeat(3,1fr);gap:16px;margin-top:16px">
        ${listBox('whitelist', 'Biała lista', 'shield', p.whitelist, s.props['white-list'] ? 'Lista jest pusta – nikt nie wejdzie.' : 'Biała lista jest wyłączona (Ustawienia).')}
        ${listBox('ops', 'Operatorzy', 'crown', p.ops, 'Brak operatorów.')}
        ${listBox('bans', 'Zbanowani', 'ban', p.bans, 'Nikt nie jest zbanowany.')}</div>`;
    $$('[data-c]', t).forEach(b => b.onclick = () => nore.servers.command(id, b.dataset.c).then(() => setTimeout(() => playersTab(t), 600)).catch(errorToast));
    const act = async (which, action, name) => {
      try { await nore.servers.playerList(id, which, action, name); toast(action === 'add' ? 'Dodano' : 'Usunięto', name, 'success', 1500); setTimeout(() => playersTab(t), s.state === 'running' ? 700 : 0); } catch (e) { errorToast(e); }
    };
    $$('[data-add]', t).forEach(b => b.onclick = () => { const v = $(`[data-in="${b.dataset.add}"]`, t).value.trim(); if (v) act(b.dataset.add, 'add', v); });
    $$('[data-in]', t).forEach(i => i.onkeydown = (e) => { if (e.key === 'Enter' && i.value.trim()) act(i.dataset.in, 'add', i.value.trim()); });
    $$('[data-del]', t).forEach(b => b.onclick = () => act(b.dataset.del, 'remove', b.dataset.name));
  }

  // ---------------------------------------------------------------- add-ons
  const TYPE_TAG = (type) => type && type !== 'release' ? ` <span class="tag ${type === 'alpha' ? 'danger' : 'accent'}">${type.toUpperCase()}</span>` : '';

  /** Version picker + changelog for installing / updating a modpack on this server. */
  async function packModal(projectId, title, { update } = {}) {
    const m = modal(`<h3>${update ? 'Aktualizacja modpacka' : 'Instalacja modpacka'}</h3><p class="sub">${esc(title || '')}</p>
      <div id="pv"><div class="skeleton" style="height:120px"></div></div>
      <div class="foot"><button class="btn ghost" data-close>Anuluj</button><button class="btn" id="pgo" disabled>${icon('download')} ${update ? 'Aktualizuj' : 'Zainstaluj'}</button></div>`);
    let list = [];
    try { list = await nore.servers.modpackVersions(id, projectId); } catch (e) { errorToast(e); m.close(); return; }
    if (!list.length) { $('#pv', m.el).innerHTML = `<div class="muted">Ta paczka nie ma wersji dla silnika ${esc(engine(s.type).label)}.</div>`; return; }
    const cur = s.pack && s.pack.versionId;
    const def = (update && update.id) || (list.find(v => v.mcVersion === s.mcVersion && v.type === 'release') || list.find(v => v.type === 'release') || list[0]).id;
    $('#pv', m.el).innerHTML = `<div class="field"><label>Wersja</label><select class="input" id="pver">${list.map(v => `<option value="${esc(v.id)}" ${v.id === def ? 'selected' : ''}>${esc(v.number)} • MC ${esc(v.mcVersion || '?')}${v.type !== 'release' ? ' • ' + v.type.toUpperCase() : ''}${v.id === cur ? ' (zainstalowana)' : ''}</option>`).join('')}</select></div>
      <div id="pwarn"></div><div class="srv-changelog" id="plog"></div>
      <div class="muted" style="font-size:12px;margin-top:10px">${icon('shield')} Przed ${update ? 'aktualizacją' : 'instalacją'} launcher zrobi kopię świata. Twoje pliki, zmienione configi i świat zostają; usunięte pliki paczki trafią do <b>.nore-backup</b>.</div>`;
    const sel = $('#pver', m.el);
    const show = () => {
      const v = list.find(x => x.id === sel.value);
      $('#plog', m.el).textContent = (v && v.changelog) || 'Brak opisu zmian.';
      $('#pwarn', m.el).innerHTML = v && v.mcVersion && v.mcVersion !== s.mcVersion
        ? `<div class="check bad" style="margin-bottom:10px">${icon('info')}<div><b>Minecraft zmieni się z ${esc(s.mcVersion)} na ${esc(v.mcVersion)}</b><span>Świat zostanie przekonwertowany do nowej wersji (kopia zapasowa powstanie automatycznie). Gracze będą potrzebować tej samej wersji paczki.</span></div></div>` : '';
      $('#pgo', m.el).disabled = !v || v.id === cur;
    };
    sel.onchange = show; show();
    $('#pgo', m.el).onclick = async (e) => {
      const b = e.currentTarget; b.disabled = true; b.innerHTML = `${icon('refresh', 'spin')} ${update ? 'Aktualizowanie' : 'Instalowanie'}…`;
      try {
        const r = s.pack && s.pack.projectId === projectId ? await nore.servers.modpackApply(id, sel.value) : await nore.servers.contentInstall(id, { kind: 'modpack', projectId, versionId: sel.value });
        m.close();
        toast(update ? 'Zaktualizowano modpack' : 'Zainstalowano modpack', `${r.name} ${r.pack ? r.pack.version : ''} – Minecraft ${r.mcVersion}, ${engine(r.type).label}`, 'success', 7000);
        await renderHead(); renderTab();
      } catch (err) { b.disabled = false; b.innerHTML = `${icon('download')} Ponów`; errorToast(err); }
    };
  }

  async function addons(t) {
    const sources = await nore.servers.contentSources(id).catch(() => ({ modrinth: [], curseforge: [], hangar: [] }));
    const kinds = [...new Set([...sources.modrinth, ...sources.curseforge, ...sources.hangar])];
    let kind = kinds[0];
    let mode = 'installed';
    let source = 'modrinth';
    const modded = kinds.includes('mod');
    const srcOf = (p) => (p.source === 'curseforge' ? 'z CurseForge' : p.projectId ? 'z Modrinth' : 'z pliku');
    const blockedN = s.pack && (s.pack.blocked || []).length;
    t.innerHTML = `${s.pack ? `<div class="card pack-strip" id="packstrip"><div class="addon-ico">${icon('box')}</div>
        <div style="flex:1;min-width:0"><b>${esc(s.pack.title || 'Modpack')}</b> <span class="muted" style="font-size:12px">${esc(s.pack.version || '')}</span><div class="muted" style="font-size:12px" id="packst">Modpack ${srcOf(s.pack)}${s.pack.serverPack ? ' • server pack autora' : ''}${s.pack.clientSkipped ? ` • pominięto ${s.pack.clientSkipped} plików tylko dla klienta` : ''}</div></div>
        ${blockedN ? `<button class="btn sm" id="packblocked">${icon('download')} Pobierz ręcznie (${blockedN})</button>` : ''}
        ${s.pack.projectId ? `<button class="btn ghost sm" id="packcheck">${icon('refresh')} Sprawdź aktualizację</button><button class="btn ghost sm" id="packver">${icon('list')} Zmień wersję</button>` : ''}</div>` : ''}
      <div class="row" style="gap:10px;flex-wrap:wrap"><div id="kinds"></div><div id="mode"></div><div id="srcs" class="src-seg"></div><span class="spacer"></span>
        <button class="btn ghost sm" id="addfile" title="Pluginy / mody (.jar), datapacki (.zip), modpacki (.mrpack, server pack .zip)">${icon('upload')} Z pliku</button><button class="btn sm" id="updates">${icon('refresh')} Sprawdź aktualizacje</button></div>
      ${modded ? `<div class="setting card" style="padding:8px 14px;margin-top:12px"><div class="col"><b>Wyłączaj mody tylko dla klienta</b><span>Np. Sodium, Iris, minimapy – na serwerze powodują crash. Launcher wyłączy je przed startem.</span></div><label class="switch"><input type="checkbox" id="clientoff" ${s.disableClientMods !== false ? 'checked' : ''}><i></i></label></div>` : ''}
      <div id="abody" style="margin-top:14px"></div>
      <div class="drop-hint" id="drop">${icon('upload')}<b>Upuść pliki</b><span>.jar → ${modded ? 'mody' : 'pluginy'} • .zip → datapack / server pack • .mrpack → modpack</span></div>`;
    $('#kinds', t).appendChild(segmented(kinds.map(k => ({ value: k, label: KIND_LABEL[k] })), kind, (v) => { kind = v; if (kind === 'modpack') mode = 'browse'; draw(); }));
    $('#mode', t).appendChild(segmented([{ value: 'installed', label: 'Zainstalowane' }, { value: 'browse', label: 'Szukaj' }], mode, (v) => { mode = v; draw(); }));
    const drawSources = () => {
      const box = $('#srcs', t);
      const list = ['modrinth', 'curseforge', 'hangar'].filter(x => (sources[x] || []).includes(kind));
      if (!list.includes(source)) source = list[0] || 'modrinth';
      box.innerHTML = '';
      box.style.display = mode === 'browse' && list.length > 1 ? '' : 'none';
      if (list.length > 1) box.appendChild(segmented(list.map(x => ({ value: x, label: SRC_LABEL[x] })), source, (v) => { source = v; drawBrowse(); }));
    };
    if ($('#packblocked', t)) $('#packblocked', t).onclick = () => serverBlockedModal(id);
    if ($('#clientoff', t)) $('#clientoff', t).onchange = (e) => nore.servers.update(id, { disableClientMods: e.target.checked }).then(x => { s = x; toast('Zapisano', '', 'success', 1200); });
    const afterAdd = async (r) => {
      if (!r) return;
      if (r.pack) { toast('Zainstalowano paczkę', `${r.pack.name || ''}${r.pack.mcVersion ? ' – Minecraft ' + r.pack.mcVersion : ''}${r.pack.type ? ', ' + engine(r.pack.type).label : ''}`, 'success', 7000); await renderHead(); return renderTab(); }
      if (r.added && r.added.length) { toast('Dodano', r.added.join(', '), 'success'); draw(); } else toast('Nic nie dodano', 'Obsługiwane: .jar, .zip, .mrpack', 'error');
    };
    $('#addfile', t).onclick = async () => afterAdd(await nore.servers.contentAddFiles(id).catch(errorToast));
    // drag & drop from the file manager
    let depth = 0;
    t.ondragenter = (e) => { if (e.dataTransfer.types.includes('Files')) { depth++; t.classList.add('dropping'); } };
    t.ondragleave = () => { if (--depth <= 0) { depth = 0; t.classList.remove('dropping'); } };
    t.ondragover = (e) => { if (e.dataTransfer.types.includes('Files')) e.preventDefault(); };
    t.ondrop = async (e) => {
      e.preventDefault(); depth = 0; t.classList.remove('dropping');
      const paths = [...e.dataTransfer.files].map(f => nore.servers.pathForFile(f)).filter(Boolean);
      if (!paths.length) return;
      if (paths.some(p => /\.mrpack$|\.zip$/i.test(p)) && s.state !== 'stopped') return toast('Zatrzymaj serwer', 'Paczki instaluje się na wyłączonym serwerze', 'error');
      toast('Dodawanie', `${paths.length} plików…`);
      afterAdd(await nore.servers.contentAddPaths(id, paths).catch(errorToast));
    };
    $('#updates', t).onclick = async () => {
      toast('Aktualizacje', 'Sprawdzanie w Modrinth, CurseForge i Hangar…');
      const ups = await nore.servers.contentUpdates(id).catch(errorToast);
      if (!ups) return;
      if (!ups.length) return toast('Wszystko aktualne', 'Pluginy i mody są w najnowszych wersjach', 'success');
      if (await confirmModal(`Dostępne aktualizacje: ${ups.length}`, ups.map(u => `${u.oldFile} → ${u.version}${u.type && u.type !== 'release' ? ' (' + u.type.toUpperCase() + ')' : ''}`).join('\n'), { ok: 'Aktualizuj wszystko' })) {
        await nore.servers.contentApplyUpdates(id, ups).catch(errorToast);
        toast('Zaktualizowano', `${ups.length} plików – zrestartuj serwer (stare wersje w .nore-backup)`, 'success');
        draw();
      }
    };
    if ($('#packcheck', t)) {
      $('#packcheck', t).onclick = async (e) => {
        const b = e.currentTarget; b.disabled = true; b.innerHTML = `${icon('refresh', 'spin')} Sprawdzanie`;
        try {
          const u = await nore.servers.modpackUpdate(id);
          if (!u) { $('#packst', t).innerHTML = `${icon('check')} Najnowsza wersja dla Minecraft ${esc(s.mcVersion)}`; b.innerHTML = `${icon('check')} Aktualna`; return; }
          $('#packst', t).innerHTML = `Nowa wersja: <b>${esc(u.number)}</b>${TYPE_TAG(u.type)}`;
          b.disabled = false; b.className = 'btn sm'; b.innerHTML = `${icon('download')} Aktualizuj do ${esc(u.number)}`;
          b.onclick = () => packModal(s.pack.projectId, s.pack.title, { update: u });
        } catch (err) { b.disabled = false; b.innerHTML = `${icon('refresh')} Sprawdź aktualizację`; errorToast(err); }
      };
      $('#packver', t).onclick = () => packModal(s.pack.projectId, s.pack.title, { update: null });
    }
    const body = () => $('#abody', t);
    let mmInst = null;
    async function draw() {
      $('#mode', t).style.display = kind === 'modpack' ? 'none' : '';
      if (mmInst) { mmInst.destroy(); mmInst = null; }
      drawSources();
      if (mode === 'installed' && kind !== 'modpack') return drawInstalled();
      return drawBrowse();
    }
    async function drawInstalled() {
      if ((kind === 'mod' || kind === 'plugin') && typeof ModManager !== 'undefined') {
        mmInst = ModManager.mount(body(), { serverId: id, kind }, {
          title: s.name, server: true,
          browse: () => $('#mode .seg button[data-v="browse"]', t).click(),
          updates: () => nore.servers.contentUpdates(id).then(l => l.filter(u => u.kind === kind)),
          applyUpdates: (list) => nore.servers.contentApplyUpdates(id, list),
        });
        return;
      }
      const items = (await nore.servers.contentList(id)).filter(i => i.kind === kind);
      if (!alive || tab !== 'addons') return;
      body().innerHTML = items.length ? `<div class="col" style="gap:8px">${items.map(i => `<div class="card addon-row ${i.enabled ? '' : 'off'}" data-file="${esc(i.file)}">
          <div class="addon-ico">${icon(kind === 'datapack' ? 'database' : 'plug')}</div>
          <div style="flex:1;min-width:0"><b>${esc(i.name)}</b> <span class="muted" style="font-size:12px">${esc(i.version)}</span>${i.clientOnly ? ' <span class="tag danger" title="Ten mod działa tylko w grze – na serwerze spowoduje crash">TYLKO KLIENT</span>' : ''}
            <div class="muted" style="font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(i.description || i.file)} • ${fmtBytes(i.size)}</div></div>
          <label class="switch" title="Włączony"><input type="checkbox" data-tog ${i.enabled ? 'checked' : ''}><i></i></label>
          <button class="btn danger sm icon" data-rm title="Usuń">${icon('trash')}</button></div>`).join('')}</div>
          <div class="muted" style="font-size:12px;margin-top:10px">Zmiany zadziałają po restarcie serwera. Możesz też przeciągnąć tu pliki.</div>`
        : `<div class="empty card" style="padding:40px">${icon('plug')}<div>Brak zainstalowanych: ${KIND_LABEL[kind].toLowerCase()}.</div>
          <div class="muted" style="font-size:12px;margin-top:6px">Przeciągnij tu pliki albo poszukaj w Modrinth i CurseForge.</div>
          <button class="btn sm" id="gobrowse" style="margin-top:12px">${icon('search')} Szukaj</button></div>`;
      if ($('#gobrowse', body())) $('#gobrowse', body()).onclick = () => $('#mode .seg button[data-v="browse"]', t).click();
      $$('.addon-row', body()).forEach(row => {
        const file = row.dataset.file;
        $('[data-tog]', row).onchange = async (e) => { await nore.servers.contentToggle(id, kind, file, e.target.checked).catch(errorToast); drawInstalled(); };
        $('[data-rm]', row).onclick = async () => { if (await confirmModal('Usunąć?', file, { ok: 'Usuń', danger: true })) { await nore.servers.contentRemove(id, kind, file).catch(errorToast); drawInstalled(); } };
      });
    }
    async function drawBrowse(query = '') {
      body().innerHTML = `<div class="row" style="gap:8px"><input class="input" id="q" placeholder="Szukaj ${KIND_LABEL[kind].toLowerCase()}…" value="${esc(query)}" style="flex:1"><select class="input" id="sort" style="width:150px">
          <option value="relevance">Trafność</option><option value="downloads">Popularne</option><option value="updated">Nowe</option></select></div>
        ${kind === 'modpack' ? '<div class="muted" style="font-size:12px;margin-top:8px">Paczka ustawi wersję Minecrafta i silnik serwera, wybierzesz też wersję paczki. Masz plik .mrpack albo server pack? Użyj „Z pliku” albo przeciągnij go tutaj.</div>' : ''}
        <div id="res" class="grid cols-2" style="margin-top:12px"><div class="skeleton" style="height:80px"></div><div class="skeleton" style="height:80px"></div></div>`;
      const run = async () => {
        const res = await nore.servers.contentSearch(id, { kind, source, query: $('#q', body()).value, sort: $('#sort', body()).value }).catch(e => { errorToast(e); return { hits: [] }; });
        if (!alive || tab !== 'addons') return;
        const box2 = $('#res', body());
        box2.innerHTML = res.hits.length ? res.hits.map(h => `<div class="card addon-hit" data-pid="${esc(h.project_id)}" data-title="${esc(h.title)}">
            <img src="${esc(h.icon_url || '')}" data-fallback alt="">
            <div style="flex:1;min-width:0"><b>${esc(h.title)}</b><div class="muted addon-desc">${esc(h.description)}</div>
              <div class="muted" style="font-size:11px;margin-top:4px">${icon('download')} ${fmtNum(h.downloads)} • ${esc(h.author)} • ${esc(SRC_LABEL[h.source || source] || '')}</div></div>
            <button class="btn sm" data-inst>${icon('download')} ${kind === 'modpack' ? 'Wybierz wersję' : 'Pobierz'}</button></div>`).join('')
          : `<div class="muted">Brak wyników.</div>`;
        $$('.addon-hit', box2).forEach(card => {
          $('[data-inst]', card).onclick = async (e) => {
            if (kind === 'modpack') {
              if (s.state !== 'stopped') return toast('Zatrzymaj serwer', 'Paczki instaluje się na wyłączonym serwerze', 'error');
              return packModal(card.dataset.pid, card.dataset.title);
            }
            const b = e.currentTarget;
            b.disabled = true;
            b.innerHTML = `${icon('refresh', 'spin')} Instalowanie`;
            try {
              const r = await nore.servers.contentInstall(id, { kind, source, projectId: card.dataset.pid });
              b.innerHTML = `${icon('check')} Gotowe`;
              toast('Zainstalowano', r.join(', '), 'success');
            } catch (err) { b.disabled = false; b.innerHTML = `${icon('download')} Ponów`; errorToast(err); }
          };
        });
      };
      let timer;
      $('#q', body()).oninput = () => { clearTimeout(timer); timer = setTimeout(run, 350); };
      $('#sort', body()).onchange = run;
      run();
    }
    draw();
  }

  // ---------------------------------------------------------------- worlds & backups
  async function worlds(t) {
    if (s.proxy) {
      t.innerHTML = `<div class="card empty" style="padding:40px">${icon('globe')}<div>Proxy nie ma własnego świata.</div><div class="muted" style="font-size:12px;margin-top:6px">Światy i kopie zapasowe mają serwery, do których prowadzi ${esc(engine(s.type).label)}.</div></div>`;
      return;
    }
    const backups = await nore.servers.backups(id);
    if (!alive || tab !== 'worlds') return;
    t.innerHTML = `<div class="grid" style="grid-template-columns:1.4fr 1fr;gap:16px">
      <div class="card panel"><div class="row"><div class="section-title" style="flex:1">${icon('archive')} Kopie zapasowe (${backups.length})</div>
          <button class="btn sm" id="mk">${icon('plus')} Utwórz kopię</button></div>
        <div class="col" style="gap:8px;margin-top:12px">${backups.length ? backups.map(b => `<div class="addon-row card" data-f="${esc(b.file)}">
            <div class="addon-ico">${icon('archive')}</div><div style="flex:1"><b>${new Date(b.created).toLocaleString('pl-PL')}</b>
            <div class="muted" style="font-size:12px">${b.auto ? 'Automatyczna' : 'Ręczna'} • ${fmtBytes(b.size)}</div></div>
            <button class="btn ghost sm" data-restore>${icon('refresh')} Przywróć</button><button class="btn danger sm icon" data-del>${icon('trash')}</button></div>`).join('')
          : '<div class="muted" style="font-size:13px">Brak kopii. Utwórz pierwszą albo włącz automatyczne kopie.</div>'}</div></div>
      <div class="col" style="gap:16px">
        <div class="card panel"><div class="section-title">${icon('clock')} Automatyczne kopie</div>
          <div class="setting" style="padding:10px 0"><div class="col"><b>Kopia przy każdym starcie</b><span>Zapisuje świat przed uruchomieniem</span></div><label class="switch"><input type="checkbox" id="auto" ${s.backupOnStart ? 'checked' : ''}><i></i></label></div>
          <div class="field"><label>Ile kopii trzymać</label><input class="input" id="keep" value="${s.backupKeep || 10}" style="width:100px"></div></div>
        <div class="card panel"><div class="section-title">${icon('sparkles')} Nowy świat</div>
          <div class="field" style="margin-top:10px"><label>Seed (puste = losowy)</label><input class="input" id="seed" value="${esc(s.props['level-seed'] || '')}"></div>
          <button class="btn danger sm" id="reset">${icon('trash')} Wygeneruj świat od nowa</button>
          <div class="muted" style="font-size:12px;margin-top:8px">Obecny świat zostanie usunięty – zrób najpierw kopię.</div></div></div></div>`;
    $('#mk', t).onclick = async () => { try { toast('Kopia zapasowa', 'Tworzenie…'); toast('Gotowe', await nore.servers.backup(id), 'success'); worlds(t); } catch (e) { errorToast(e); } };
    $('#auto', t).onchange = (e) => nore.servers.update(id, { backupOnStart: e.target.checked }).then(() => toast('Zapisano', '', 'success', 1200));
    $('#keep', t).onchange = (e) => nore.servers.update(id, { backupKeep: Math.max(1, parseInt(e.target.value, 10) || 10) });
    $('#reset', t).onclick = async () => {
      if (!(await confirmModal('Nowy świat?', 'Obecny świat zostanie usunięty.', { ok: 'Usuń i wygeneruj', danger: true }))) return;
      try { await nore.servers.resetWorld(id, $('#seed', t).value.trim()); toast('Gotowe', 'Nowy świat powstanie przy starcie', 'success'); } catch (e) { errorToast(e); }
    };
    $$('[data-f]', t).forEach(row => {
      const f = row.dataset.f;
      $('[data-restore]', row).onclick = async () => {
        if (!(await confirmModal('Przywrócić kopię?', 'Obecny świat zostanie zastąpiony kopią.', { ok: 'Przywróć', danger: true }))) return;
        try { await nore.servers.restoreBackup(id, f); toast('Przywrócono', f, 'success'); } catch (e) { errorToast(e); }
      };
      $('[data-del]', row).onclick = async () => { await nore.servers.deleteBackup(id, f); worlds(t); };
    });
  }

  // ---------------------------------------------------------------- network & domain
  async function network(t) {
    const net = await nore.servers.netInfo().catch(() => ({ lan: [], publicIp: null }));
    if (!alive || tab !== 'network') return;
    const d = s.domain || { provider: 'none', name: '', auto: true };
    let provider = d.provider || 'none';
    const lanIp = ((net.lan || []).find(a => !a.virtual) || net.lan[0] || {}).address;
    const tunnelOn = !!(s.tunnel && s.tunnel.enabled);
    const addr = (v, label, ic, note) => v ? `<div class="addr card" data-cp="${esc(v)}" title="Kopiuj">${icon(ic)}<div><span>${label}</span><b>${esc(v)}</b>${note ? `<small>${note}</small>` : ''}</div>${icon('copy')}</div>` : '';
    t.innerHTML = `<div class="addr-grid">
        ${addr(lanIp && `${lanIp}${s.port !== 25565 ? ':' + s.port : ''}`, 'W tej samej sieci (LAN)', 'wifi', 'Domownicy, ta sama sieć Wi-Fi')}
        ${addr(net.publicIp && `${net.publicIp}${s.port !== 25565 ? ':' + s.port : ''}`, 'Z internetu (IP)', 'globe', 'Wymaga otwartego portu')}
        ${addr(d.name && d.provider !== 'none' ? d.name + (s.port !== 25565 && !['cloudflare', 'manual'].includes(d.provider) ? ':' + s.port : '') : '', 'Domena', 'link', 'Zawsze aktualne IP')}
        ${addr(tunnelOn && s.tunnel.address, 'Tunel playit.gg', 'zap', 'Działa nawet przy CGNAT')}
      </div>
      <div class="card panel" style="margin-top:16px"><div class="row"><div class="section-title" style="flex:1">${icon('activity')} Diagnostyka połączenia</div>
          <button class="btn sm" id="diag">${icon('search')} Sprawdź wszystko</button></div>
        <p class="muted" style="font-size:13px;margin:6px 0 0">Sprawdza serwer, router (UPnP / NAT-PMP), CGNAT, przekierowanie portu${net.platform === 'win32' ? ', zaporę Windows' : ''}, domenę i test z internetu – i podpowiada, co naprawić.</p>
        <div id="diagres" class="diag"></div></div>
      <div class="grid" style="grid-template-columns:1fr 1fr;gap:16px;margin-top:16px">
      <div class="col" style="gap:16px">
        <div class="card panel"><div class="section-title">${icon('wifi')} Otwórz port ${s.port}</div>
          <p class="muted" style="font-size:13px;margin:8px 0 12px">Router musi przepuścić port serwera do tego komputera${lanIp ? ` (${esc(lanIp)})` : ''}. Launcher robi to sam przez UPnP albo NAT-PMP.</p>
          <div class="setting" style="padding:8px 0"><div class="col"><b>Automatycznie (UPnP / NAT-PMP)</b><span>Otwieraj port przy każdym starcie serwera i odnawiaj go, dopóki działa</span></div><label class="switch"><input type="checkbox" id="upnp" ${s.upnp ? 'checked' : ''}><i></i></label></div>
          <div class="row" style="gap:8px;flex-wrap:wrap"><button class="btn sm" id="upnpnow">${icon('zap')} Otwórz teraz</button>
            ${net.platform === 'win32' ? `<button class="btn ghost sm" id="fw">${icon('shield')} Zezwól w zaporze Windows</button>` : ''}</div>
          <div id="upnpres" style="margin-top:10px"></div>
          <details class="howto"><summary>Ręcznie w routerze</summary><ol>
            <li>Wejdź do panelu routera (adres bramy, zwykle 192.168.0.1 lub 192.168.1.1).</li>
            <li>Znajdź „Przekierowanie portów / Port forwarding / NAT / Serwer wirtualny”.</li>
            <li>Dodaj regułę: port zewnętrzny i wewnętrzny ${s.port}, protokół TCP (i UDP) → ${esc(lanIp || 'IP tego komputera')}.</li>
            <li>Ustaw temu komputerowi stałe IP (rezerwacja DHCP), żeby reguła nie przestała działać.</li>
            <li>Brak publicznego IP (CGNAT)? Przekierowanie nie pomoże – użyj tunelu playit.gg obok.</li></ol></details></div>
        <div class="card panel"><div class="section-title">${icon('zap')} Tunel playit.gg <span class="tag accent" style="margin-left:6px">BEZ ROUTERA</span></div>
          <p class="muted" style="font-size:13px;margin:8px 0 12px">Dla sieci bez publicznego IP (CGNAT, internet mobilny, akademik) albo bez dostępu do routera. Darmowy adres w stylu <b>abc.joinmc.link</b>.</p>
          <div id="tunnelbox"></div></div>
        <div class="card panel"><div class="section-title">${icon('search')} Test z internetu</div>
          <p class="muted" style="font-size:13px;margin:8px 0 12px">Zewnętrzny serwer (mcsrvstat.us) łączy się tak jak znajomi.</p>
          <div class="row" style="gap:8px"><input class="input" id="chkhost" value="${esc((tunnelOn && s.tunnel.address) || d.name || net.publicIp || '')}" style="flex:1"><button class="btn sm" id="chk">${icon('search')} Sprawdź</button></div>
          <div id="chkres" style="margin-top:12px"></div></div></div>
      <div class="card panel"><div class="section-title">${icon('link')} Własna domena</div>
        <p class="muted" style="font-size:13px;margin:8px 0 12px">Zamiast IP znajomi wpiszą np. <b>mojserwer.duckdns.org</b> albo <b>mc.twojadomena.pl</b>. Launcher aktualizuje IP przy starcie i co 10 minut, gdy serwer działa.</p>
        <div id="prov"></div><div id="pform" style="margin-top:14px"></div></div></div>`;
    $$('.addr[data-cp]', t).forEach(a => a.onclick = () => copyText(a.dataset.cp, 'Skopiowano adres'));

    const showForward = (r) => {
      $('#upnpres', t).innerHTML = `<div class="check ${r.cgnat ? 'bad' : 'ok'}">${icon(r.cgnat ? 'x' : 'check')}<div><b>${r.cgnat ? 'Port otwarty, ale masz CGNAT' : 'Port otwarty'}</b>
        <span>${r.method === 'natpmp' ? 'NAT-PMP' : 'UPnP'} • router ${esc(r.router)} → ${esc(r.client)}:${s.port}${r.external ? ` • IP routera ${esc(r.external)}` : ''}${r.verified === false ? ' • router nie potwierdził reguły' : ''}
        ${r.cgnat ? '<br>Router nie ma publicznego IP – znajomi z internetu nie połączą się przez IP. Włącz tunel playit.gg.' : ''}</span></div></div>`;
    };
    const fail = (err) => { $('#upnpres', t).innerHTML = `<div class="check bad">${icon('x')}<div><b>Nie udało się otworzyć portu</b><span>${esc(err.message || err)}</span></div></div>`; };
    $('#upnp', t).onchange = async (e) => {
      try {
        const r = await nore.servers.upnp(id, e.target.checked);
        s.upnp = e.target.checked;
        if (e.target.checked) showForward(r); else $('#upnpres', t).innerHTML = '';
      } catch (err) { e.target.checked = false; fail(err); }
    };
    $('#upnpnow', t).onclick = async (e) => {
      const b = e.currentTarget; b.disabled = true; b.innerHTML = `${icon('refresh', 'spin')} Otwieranie…`;
      try { showForward(await nore.servers.upnp(id, true)); $('#upnp', t).checked = true; s.upnp = true; } catch (err) { fail(err); }
      b.disabled = false; b.innerHTML = `${icon('zap')} Otwórz teraz`;
    };
    if ($('#fw', t)) $('#fw', t).onclick = async () => {
      try { await nore.servers.firewall(id); toast('Zapora Windows', `Port ${s.port} przepuszczony`, 'success'); } catch (err) { errorToast(err, 'Zapora'); }
    };

    // ---- diagnosis
    const FIX = {
      start: ['play', 'Uruchom serwer', async () => { await startServer(s); }],
      upnp: ['zap', 'Otwórz port', async () => { showForward(await nore.servers.upnp(id, true)); $('#upnp', t).checked = true; }],
      firewall: ['shield', 'Dodaj regułę zapory', async () => { await nore.servers.firewall(id); }],
      tunnel: ['zap', 'Użyj tunelu', async () => { $('#tunnelbox', t).scrollIntoView({ behavior: 'smooth', block: 'center' }); }],
      domain: ['link', 'Zaktualizuj domenę', async () => { const r = await nore.servers.applyDomain(id); toast('Domena', `${r.host} → ${r.ip}`, 'success'); }],
      manual: ['info', 'Instrukcja', async () => { $('.howto', t).open = true; $('.howto', t).scrollIntoView({ behavior: 'smooth', block: 'center' }); }],
    };
    const runDiag = async () => {
      const box = $('#diagres', t), b = $('#diag', t);
      b.disabled = true; b.innerHTML = `${icon('refresh', 'spin')} Sprawdzanie…`;
      box.innerHTML = `<div class="muted" style="font-size:13px;margin-top:12px">Sprawdzanie routera i połączenia z internetu (do 20 s)…</div>`;
      try {
        const r = await nore.servers.diagnose(id);
        if (!alive || tab !== 'network') return;
        box.innerHTML = r.steps.map(st => `<div class="diag-step ${st.status}"><i>${icon(st.status === 'ok' ? 'check' : st.status === 'bad' ? 'x' : 'info')}</i>
          <div style="flex:1;min-width:0"><b>${esc(st.title)}</b><span>${esc(st.text)}</span></div>
          ${st.fix && FIX[st.fix] ? `<button class="btn ghost sm" data-fix="${st.fix}">${icon(FIX[st.fix][0])} ${FIX[st.fix][1]}</button>` : ''}</div>`).join('');
        $$('[data-fix]', box).forEach(fb => fb.onclick = async () => {
          fb.disabled = true;
          try { await FIX[fb.dataset.fix][2](); if (fb.dataset.fix !== 'tunnel' && fb.dataset.fix !== 'manual') setTimeout(runDiag, 800); } catch (err) { errorToast(err); }
          fb.disabled = false;
        });
      } catch (err) { box.innerHTML = `<div class="check bad" style="margin-top:12px">${icon('x')}<div><b>Diagnostyka nie powiodła się</b><span>${esc(err.message)}</span></div></div>`; }
      b.disabled = false; b.innerHTML = `${icon('search')} Sprawdź ponownie`;
    };
    $('#diag', t).onclick = runDiag;

    // ---- playit.gg tunnel
    const drawTunnel = async (waiting) => {
      const box = $('#tunnelbox', t);
      if (!box) return;
      const info = await nore.servers.netInfo().catch(() => net);
      if (!info.tunnelSupported) {
        box.innerHTML = `<div class="muted" style="font-size:13px">Na tym systemie zainstaluj agenta ze strony <a href="#" data-url="https://playit.gg/download">playit.gg</a> i dodaj tunel „Minecraft Java” na port ${s.port}.</div>`;
      } else if (!info.playitLinked) {
        box.innerHTML = waiting
          ? `<div class="check ok">${icon('refresh', 'spin')}<div><b>Czekam na potwierdzenie na playit.gg…</b><span>Zaloguj się w otwartej karcie przeglądarki (konto jest darmowe) i kliknij „Accept / Add agent”.</span></div></div>`
          : `<ol class="steps"><li>Kliknij „Połącz z playit.gg” – otworzy się przeglądarka.</li><li>Zaloguj się (darmowe konto) i zatwierdź agenta „Nore Launcher”.</li><li>Włącz tunel – launcher sam utworzy adres i uruchomi go razem z serwerem.</li></ol>
            <button class="btn sm" id="tlink" style="margin-top:10px">${icon('link')} Połącz z playit.gg</button>`;
        if ($('#tlink', box)) $('#tlink', box).onclick = async () => {
          try { await nore.servers.tunnelLink(); drawTunnel(true); } catch (err) { errorToast(err, 'playit.gg'); }
        };
      } else {
        const on = !!(s.tunnel && s.tunnel.enabled);
        box.innerHTML = `<div class="setting" style="padding:6px 0"><div class="col"><b>Tunel dla tego serwera</b><span>${on && s.tunnel.address ? `Adres: <b class="copyable" data-cpa="${esc(s.tunnel.address)}">${esc(s.tunnel.address)}</b>` : 'Uruchamiany razem z serwerem'}</span></div>
            <label class="switch"><input type="checkbox" id="tun" ${on ? 'checked' : ''}><i></i></label></div>
          <div class="row" style="gap:8px"><span class="muted" style="font-size:12px;flex:1">${icon('check')} Konto playit.gg połączone</span><button class="btn ghost sm" id="tunlink">${icon('x')} Odłącz</button></div>`;
        if ($('[data-cpa]', box)) $('[data-cpa]', box).onclick = (e) => copyText(e.target.dataset.cpa, 'Skopiowano adres');
        $('#tun', box).onchange = async (e) => {
          const cb = e.target; cb.disabled = true;
          try {
            const r = await nore.servers.tunnel(id, cb.checked);
            s.tunnel = { ...(s.tunnel || {}), enabled: r.enabled, address: r.address || (s.tunnel || {}).address };
            toast(r.enabled ? 'Tunel włączony' : 'Tunel wyłączony', r.enabled ? `${r.address}${r.restart ? ' – zrestartuj serwer' : ''}` : '', 'success', 6000);
            network(t);
          } catch (err) { cb.checked = !cb.checked; errorToast(err, 'playit.gg'); }
          cb.disabled = false;
        };
        $('#tunlink', box).onclick = async () => {
          if (!(await confirmModal('Odłączyć playit.gg?', 'Tunele wszystkich serwerów zostaną wyłączone. Adresy zostają na Twoim koncie playit.gg.', { ok: 'Odłącz', danger: true }))) return;
          await nore.servers.tunnelUnlink(); s.tunnel = { enabled: false }; network(t);
        };
      }
      $$('[data-url]', box).forEach(a => a.onclick = (e) => { e.preventDefault(); nore.open(a.dataset.url); });
    };
    drawTunnel(false);
    tunnelListener = (ev) => {
      if (tab !== 'network') return;
      if (ev.linked) toast('playit.gg połączone', 'Możesz włączyć tunel dla serwera', 'success'); else if (ev.error) toast('playit.gg', ev.error, 'error');
      drawTunnel(false);
    };

    $('#chk', t).onclick = async () => {
      const res = $('#chkres', t);
      res.innerHTML = `<div class="muted">${icon('refresh', 'spin')} Sprawdzanie…</div>`;
      try {
        const host = $('#chkhost', t).value.trim();
        const tunnelHost = tunnelOn && host === s.tunnel.address;
        const r = await nore.servers.checkReachable(host, /:\d+$/.test(host) || tunnelHost || (d.provider === 'cloudflare' && host === d.name) ? null : s.port);
        res.innerHTML = r.online
          ? `<div class="check ok">${icon('check')} <div><b>Działa! Znajomi mogą dołączyć.</b><span>${esc(r.version || '')} • ${r.players ? `${r.players.online}/${r.players.max} graczy` : ''}${r.srv ? ' • rekord SRV OK' : ''}</span></div></div>`
          : `<div class="check bad">${icon('x')} <div><b>Serwer nie odpowiada z internetu.</b><span>${s.state !== 'running' ? 'Najpierw uruchom serwer. ' : ''}Uruchom „Diagnostykę połączenia” powyżej – pokaże, co blokuje.${r.cached ? ' Wynik z pamięci podręcznej (do 5 min).' : ''}</span></div></div>`;
      } catch (e) { res.innerHTML = `<div class="check bad">${icon('x')} <div><b>Nie udało się sprawdzić</b><span>${esc(e.message)}</span></div></div>`; }
    };

    // ---- domain
    const PROVIDERS = [{ value: 'none', label: 'Brak' }, { value: 'duckdns', label: 'DuckDNS' }, { value: 'noip', label: 'No-IP' }, { value: 'dynu', label: 'Dynu' }, { value: 'cloudflare', label: 'Cloudflare' }, { value: 'manual', label: 'Inna' }];
    const HELP = {
      duckdns: `<ol class="steps"><li>Zaloguj się na <a href="#" data-url="https://www.duckdns.org">duckdns.org</a> (Google/GitHub, za darmo).</li><li>Dodaj subdomenę, skopiuj <b>token</b> z góry strony.</li><li>Wpisz je poniżej i kliknij „Zapisz i zastosuj”.</li></ol>`,
      noip: `<ol class="steps"><li>Załóż darmowe konto na <a href="#" data-url="https://www.noip.com/sign-up">noip.com</a> i utwórz hosta (np. mojserwer.ddns.net).</li><li>Wpisz pełną nazwę hosta, e-mail/login i hasło (albo „DDNS Key”).</li><li>Darmowy host trzeba potwierdzać co 30 dni w mailu od No-IP.</li></ol>`,
      dynu: `<ol class="steps"><li>Załóż darmowe konto na <a href="#" data-url="https://www.dynu.com/en-US/ControlPanel/AddDDNS">dynu.com</a> i dodaj usługę DDNS.</li><li>Wpisz pełną nazwę hosta, login i hasło (albo hasło IP Update).</li><li>Bez wygasania – nie trzeba nic potwierdzać.</li></ol>`,
      cloudflare: `<ol class="steps"><li>Domena musi być w Cloudflare.</li><li>Utwórz token API: <a href="#" data-url="https://dash.cloudflare.com/profile/api-tokens">dash.cloudflare.com → API Tokens</a> → szablon „Edit zone DNS”.</li><li>Launcher utworzy rekord A (bez proxy) i SRV dla portu innego niż 25565.</li></ol>`,
      manual: `<ol class="steps"><li>Wpisz nazwę (np. mc.twojadomena.pl).</li><li>Dodaj u dostawcy domeny rekordy z tabeli poniżej (rekord A bez proxy).</li><li>Gdy zmieni się Twoje IP, zaktualizuj rekord A (albo użyj DuckDNS / No-IP / Dynu).</li></ol>`,
    };
    $('#prov', t).appendChild(segmented(PROVIDERS, provider, (v) => { provider = v; form(); }));
    async function form() {
      const f = $('#pform', t);
      if (provider === 'none') {
        f.innerHTML = '<div class="muted" style="font-size:13px">Bez domeny znajomi łączą się przez publiczne IP i port (albo adres tunelu).</div>';
        if (s.domain && s.domain.provider !== 'none') { await nore.servers.update(id, { domain: { provider: 'none', name: '', auto: false, token: null } }); s.domain = null; }
        return;
      }
      const same = d.provider === provider;
      const dyn = provider === 'noip' || provider === 'dynu';
      const secretLabel = provider === 'duckdns' ? 'Token DuckDNS' : provider === 'cloudflare' ? 'Token API Cloudflare' : 'Hasło';
      f.innerHTML = `${HELP[provider]}
        <div class="field"><label>${provider === 'duckdns' ? 'Subdomena' : 'Nazwa hosta'}</label><div class="row" style="gap:6px"><input class="input" id="dname" value="${esc(same ? (provider === 'duckdns' ? d.name.replace(/\.duckdns\.org$/, '') : d.name) : '')}" placeholder="${provider === 'duckdns' ? 'mojserwer' : provider === 'noip' ? 'mojserwer.ddns.net' : provider === 'dynu' ? 'mojserwer.freeddns.org' : 'mc.twojadomena.pl'}" style="flex:1">${provider === 'duckdns' ? '<span class="muted">.duckdns.org</span>' : ''}</div></div>
        ${dyn ? `<div class="field"><label>Login / e-mail</label><input class="input" id="duser" value="${esc(same ? d.user || '' : '')}" autocomplete="off"></div>` : ''}
        ${provider !== 'manual' ? `<div class="field"><label>${secretLabel}</label><input class="input" id="dtoken" type="password" autocomplete="new-password" placeholder="${same && d.hasToken ? '•••••••• (zapisany – wpisz, aby zmienić)' : dyn ? 'hasło' : 'wklej token'}"></div>
          <div class="setting" style="padding:6px 0"><div class="col"><b>Aktualizuj automatycznie</b><span>Przy starcie serwera i co 10 minut – domena zawsze wskaże Twoje aktualne IP</span></div><label class="switch"><input type="checkbox" id="dauto" ${!same || d.auto ? 'checked' : ''}><i></i></label></div>` : ''}
        <div class="row" style="gap:8px;margin-top:10px"><button class="btn sm" id="dsave">${icon('check')} Zapisz i zastosuj</button>${same && d.name ? `<button class="btn ghost sm" id="dcheck">${icon('search')} Sprawdź DNS</button>` : ''}</div>
        <div id="dnsres" style="margin-top:10px"></div><div id="records" style="margin-top:14px"></div>`;
      $$('[data-url]', f).forEach(a => a.onclick = (e) => { e.preventDefault(); nore.open(a.dataset.url); });
      const showRecords = async (host) => {
        const recs = await nore.servers.dnsRecords(id, host).catch(() => []);
        $('#records', f).innerHTML = `<div class="muted" style="font-size:12px;margin-bottom:6px">${provider === 'manual' ? 'Dodaj te rekordy DNS:' : provider === 'cloudflare' ? 'Rekordy, które ustawia launcher:' : 'Adres, który ustawia launcher:'}</div>
          <table class="dns"><tr><th>Typ</th><th>Nazwa</th><th>Wartość</th><th></th></tr>${recs.filter(r => provider === 'manual' || provider === 'cloudflare' || r.type === 'A').map(r => `<tr><td><b>${r.type}</b></td><td>${esc(r.name)}</td><td>${esc(r.value)}</td>
            <td><button class="btn ghost sm icon" data-cp="${esc(r.value)}">${icon('copy')}</button></td></tr>`).join('')}</table>
          ${s.port !== 25565 && dyn ? `<div class="muted" style="font-size:12px;margin-top:6px">Port ${s.port} nie jest domyślny – znajomi wpiszą <b>${esc(host)}:${s.port}</b>.</div>` : ''}`;
        $$('[data-cp]', f).forEach(b => b.onclick = () => copyText(b.dataset.cp));
      };
      const checkDns = async () => {
        const box = $('#dnsres', f);
        box.innerHTML = `<div class="muted" style="font-size:12.5px">${icon('refresh', 'spin')} Sprawdzanie DNS…</div>`;
        try {
          const [r, info] = await Promise.all([nore.servers.dnsCheck(id), nore.servers.netInfo()]);
          const ok = r.a.length && (!info.publicIp || r.a.includes(info.publicIp));
          box.innerHTML = `<div class="check ${ok ? 'ok' : 'bad'}">${icon(ok ? 'check' : 'x')}<div><b>${esc(r.host)} → ${r.a.length ? esc(r.a.join(', ')) : 'brak rekordu'}</b>
            <span>${ok ? 'Domena wskazuje na ten komputer.' : r.a.length ? `Twoje IP to ${esc(info.publicIp)} – kliknij „Zapisz i zastosuj” (DNS odświeża się do kilku minut).` : esc(r.error || 'Brak rekordu A')}${r.srv ? ` • SRV → port ${r.srv.port}${r.srvWrongPort ? ' (inny niż port serwera!)' : ''}` : ''}</span></div></div>`;
        } catch (err) { box.innerHTML = `<div class="check bad">${icon('x')}<div><b>Nie udało się sprawdzić DNS</b><span>${esc(err.message)}</span></div></div>`; }
      };
      if ($('#dcheck', f)) $('#dcheck', f).onclick = checkDns;
      if (same && d.name) showRecords(provider === 'duckdns' ? `${d.name.replace(/\.duckdns\.org$/, '')}.duckdns.org` : d.name);
      $('#dsave', f).onclick = async (e) => {
        let name = $('#dname', f).value.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
        if (!name) return toast('Podaj nazwę', '', 'error');
        if (provider === 'duckdns') name = name.replace(/\.duckdns\.org$/, '') + '.duckdns.org';
        else if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(name)) return toast('Nieprawidłowa nazwa hosta', 'np. mc.twojadomena.pl', 'error');
        const patch = { provider, name, auto: $('#dauto', f) ? $('#dauto', f).checked : false };
        if ($('#duser', f)) patch.user = $('#duser', f).value.trim();
        const tok = $('#dtoken', f) && $('#dtoken', f).value.trim();
        if (tok) patch.token = tok;
        const b = e.currentTarget; b.disabled = true;
        try {
          s = await nore.servers.update(id, { domain: patch });
          Object.assign(d, s.domain);
          const r = await nore.servers.applyDomain(id);
          toast('Domena gotowa', `${r.host} → ${r.ip}`, 'success', 6000);
          $('#chkhost', t).value = r.host;
          form().then(() => { showRecords(r.host); setTimeout(() => $('#dcheck', f) && checkDns(), 1500); });
        } catch (err) { errorToast(err, 'Domena'); }
        b.disabled = false;
      };
    }
    form();
  }

  // ---------------------------------------------------------------- settings
  async function settings(t) {
    const [form, all] = await Promise.all([nore.servers.propertiesForm(id).catch(() => null), nore.servers.properties(id).catch(() => ({}))]);
    if (!alive || tab !== 'settings') return;
    const proxy = !!s.proxy;
    const sch = s.schedule || {};
    const v = (form && form.values) || {};
    const field = (f) => {
      const val = v[f.key] ?? (f.type === 'bool' && f.def != null ? String(f.def) : '');
      if (f.type === 'bool') return `<label class="switch"><input type="checkbox" data-pf="${f.key}" ${String(val) === 'true' ? 'checked' : ''}><i></i></label>`;
      if (f.type === 'enum') return `<select class="input" data-pf="${f.key}">${f.options.map(([o, l]) => `<option value="${esc(o)}" ${String(val) === o ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
      if (f.type === 'int') return `<input class="input" type="number" min="${f.min}" max="${f.max}" data-pf="${f.key}" value="${esc(val)}" placeholder="${f.def ?? ''}">`;
      return `<input class="input" data-pf="${f.key}" value="${esc(val)}" ${f.key === 'resource-pack' ? 'placeholder="https://…/paczka.zip"' : ''}>`;
    };
    const groups = form ? Object.entries(form.groups).map(([g, label]) => {
      const list = form.schema.filter(f => f.group === g && f.type !== 'motd');
      return list.length ? `<div class="card panel sp-group"><div class="section-title">${esc(label)}</div>${list.map(f => `<div class="sp-row"><span>${esc(f.label)}</span>${field(f)}</div>`).join('')}</div>` : '';
    }).join('') : '';
    const warnHtml = (ws) => (ws || []).map(w => `<div class="sp-warn ${w.level === 'info' ? 'info' : ''}">${icon(w.level === 'info' ? 'info' : 'alert')}<span>${esc(w.text)}</span></div>`).join('');
    t.innerHTML = `<div class="grid" style="grid-template-columns:1fr 1fr;gap:16px">
      <div class="col" style="gap:16px">
        <div class="card panel"><div class="section-title">${icon('server')} Serwer</div>
          <div class="field" style="margin-top:10px"><label>Nazwa</label><input class="input" id="sname" value="${esc(s.name)}"></div>
          <div class="field"><label>Silnik</label><div class="eng-grid">${ENGINES.map(e => `<button class="eng ${e.value === s.type ? 'on' : ''}" data-eng="${e.value}" style="--ec:${e.color}"><b>${e.label}</b><span>${e.hint}</span></button>`).join('')}</div></div>
          <div class="row" style="gap:10px">${proxy ? '' : `<div class="field" style="flex:1"><label>Wersja Minecraft</label><select class="input" id="sver"><option>${esc(s.mcVersion)}</option></select></div>`}
            <div class="field" style="width:120px"><label>Port</label><input class="input" id="sport" value="${s.port}"></div></div>
          ${['fabric', 'quilt', 'forge', 'neoforge', 'velocity'].includes(s.type) ? `<div class="field"><label>Wersja ${esc(engine(s.type).label)}${s.installedLoader ? ` <span class="muted">(zainstalowana: ${esc(s.installedLoader)})</span>` : ''}</label>
            ${s.type === 'velocity' ? `<input class="input" id="sloadertxt" value="${esc(s.loaderVersion || '')}" placeholder="Najnowsza (np. 3.4.0)">` : `<select class="input" id="sloader"><option value="">Najnowsza stabilna</option>${s.loaderVersion ? `<option value="${esc(s.loaderVersion)}" selected>${esc(s.loaderVersion)}</option>` : ''}</select>`}</div>` : ''}
          <div class="setting" style="padding:8px 0"><div class="col"><b>Automatyczny restart</b><span>Uruchom ponownie po awarii (max 3× w 10 min)</span></div><label class="switch"><input type="checkbox" id="sauto" ${s.autoRestart !== false ? 'checked' : ''}><i></i></label></div>
          <div class="row" style="gap:8px;margin-top:6px"><button class="btn ghost sm" id="reinstall">${icon('refresh')} Zainstaluj silnik ponownie</button>
            <button class="btn ghost sm" id="sfolder">${icon('folder')} Folder</button><button class="btn ghost sm" id="scfg">${icon('settings')} Pliki konfiguracji</button>
            <button class="btn danger sm" id="sdel">${icon('trash')} Usuń serwer</button></div></div>
        <div class="card panel"><div class="section-title">${icon('cpu')} Pamięć i Java</div>
          <div class="field" style="margin-top:10px"><label>Pamięć RAM</label><div class="row"><input type="range" class="slider" id="smem" min="${proxy ? 512 : 1024}" max="${Math.max(4096, App.info.totalMemMb - 2048)}" step="512" value="${s.memoryMb}" style="flex:1"><div class="value-pill" id="smemv"></div></div>
            <span class="hint">${proxy ? 'Proxy potrzebuje mało pamięci – 512 MB–1 GB wystarcza.' : 'Vanilla / Paper: 2–4 GB, duże modpacki: 6–10 GB. Więcej niż potrzeba nie przyspiesza serwera.'}</span></div>
          <div class="field"><label>Profil flag JVM</label><select class="input" id="sjprof">
            <option value="aikar" ${(s.jvmProfile || 'aikar') === 'aikar' ? 'selected' : ''}>${proxy ? 'Zalecany dla proxy (Velocity)' : 'Flagi Aikara (zalecane dla Paper i modów)'}</option>
            <option value="zgc" ${s.jvmProfile === 'zgc' ? 'selected' : ''}>ZGC – niskie przycięcia, duża pamięć (Java 21+)</option>
            <option value="basic" ${s.jvmProfile === 'basic' ? 'selected' : ''}>Podstawowy – tylko pamięć</option>
            <option value="custom" ${s.jvmProfile === 'custom' ? 'selected' : ''}>Własne argumenty</option></select></div>
          <div class="field"><label>Własne argumenty JVM (mają pierwszeństwo)</label><input class="input" id="sjvm" value="${esc(s.jvmArgs || '')}" placeholder="np. -Dpaper.playerconnection.keepalive=60"></div>
          <div class="jvm-preview" id="sjprev" title="Argumenty, z którymi wystartuje serwer"></div></div>
        <div class="card panel"><div class="section-title">${icon('clock')} Harmonogram</div>
          <div class="sp-row" style="display:flex;align-items:center;gap:12px;padding:8px 0"><span style="flex:1;font-size:13px">Codzienny restart o godzinie<br><small class="muted">puste = wyłączony</small></span><input class="input" type="time" id="srat" value="${esc(sch.restartAt || '')}" style="width:130px"></div>
          <div class="sp-row" style="display:flex;align-items:center;gap:12px;padding:8px 0"><span style="flex:1;font-size:13px">Ostrzeż graczy przed restartem (minuty)</span><input class="input" type="number" min="0" max="30" id="srwarn" value="${sch.warnMinutes ?? 5}" style="width:90px"></div>
          ${proxy ? '' : `<div class="sp-row" style="display:flex;align-items:center;gap:12px;padding:8px 0"><span style="flex:1;font-size:13px">Kopia zapasowa świata co … godzin<br><small class="muted">0 = tylko ręcznie / przy starcie</small></span><input class="input" type="number" min="0" max="168" id="sbk" value="${sch.backupEveryH || 0}" style="width:90px"></div>`}
          <div class="muted" style="font-size:12px">Działa, gdy serwer jest włączony, a launcher otwarty. Kopie: zakładka „Światy”.</div></div></div>
      <div class="col" style="gap:16px">
        ${proxy ? `<div class="card panel"><div class="section-title">${icon('link')} Proxy</div><p class="muted" style="font-size:13px;margin-top:8px">
          ${s.type === 'velocity' ? 'Velocity ustawiasz w pliku <b>velocity.toml</b> (lista serwerów, online-mode, forwarding).' : 'BungeeCord ustawiasz w pliku <b>config.yml</b> (lista serwerów, online_mode).'}
          Launcher sam wpisze port. Pliki edytujesz przyciskiem „Pliki konfiguracji”. Serwery za proxy uruchom na innych portach i dodaj je do listy.</p></div>`
          : `<div class="card panel"><div class="section-title">${icon('sparkles')} Wygląd na liście serwerów</div>
          <div class="field" style="margin-top:10px"><label>MOTD – kody kolorów: &amp; lub §, dwie linie oddziel \\n</label><input class="input" id="smotd" value="${esc(String(v.motd || '').replace(/\n/g, '\\n'))}" maxlength="200"></div>
          <div class="motd-codes">${'0123456789abcdef'.split('').map(c => `<button data-code="&${c}" title="&${c}" style="background:${MOTD_COLORS[c]}">${c}</button>`).join('')}<button data-code="&l" title="pogrubienie" style="background:#444"><b>B</b></button><button data-code="&o" title="kursywa" style="background:#444"><i>I</i></button><button data-code="&r" title="reset" style="background:#444">R</button></div>
          <div class="motd-preview"><div class="mp-ico" id="smico"></div><div style="min-width:0"><div class="mp-name">${esc(s.name)}</div><div id="smprev"></div></div></div>
          <div class="row" style="gap:8px;margin-top:8px"><button class="btn ghost sm" id="sicon">${icon('image')} Ikona serwera (64×64)</button></div></div>
        <div id="spwarn">${warnHtml(form && form.warnings)}</div>
        ${groups}
        <details class="card panel adv"><summary class="section-title">${icon('list')} Wszystkie opcje server.properties</summary>
          <div class="col" style="gap:6px;margin-top:10px">${Object.keys(all).sort().map(k => `<div class="row prop-row"><code>${esc(k)}</code><input class="input sm" data-raw="${esc(k)}" value="${esc(all[k])}"></div>`).join('') || '<div class="muted">Pojawią się po pierwszym starcie serwera.</div>'}</div></details>`}
        <div class="muted" style="font-size:12px">Zmiany zadziałają po restarcie serwera.</div></div></div>`;
    const saved = (what) => toast('Zapisano', what, 'success', 1300);
    const save = async (patch, what) => { try { s = await nore.servers.update(id, patch); saved(what); } catch (e) { errorToast(e); } };
    $('#sname', t).onchange = (e) => save({ name: e.target.value.trim() || s.name }, 'nazwa').then(renderHead);
    $$('[data-eng]', t).forEach(b => b.onclick = async () => {
      if (b.dataset.eng === s.type) return;
      const toProxy = engine(b.dataset.eng).proxy;
      if (!(await confirmModal('Zmienić silnik?', toProxy ? `Serwer stanie się proxy ${engine(b.dataset.eng).label} – świat zostaje w folderze, ale proxy go nie używa.` : `Serwer zostanie przeinstalowany jako ${engine(b.dataset.eng).label} przy następnym starcie. Świat zostaje.`, { ok: 'Zmień' }))) return;
      await save({ type: b.dataset.eng }, 'silnik');
      renderHead(); settings(t);
    });
    if ($('#sver', t)) {
      nore.versions.list({ snapshots: false }).then(res => {
        if ($('#sver', t)) $('#sver', t).innerHTML = res.versions.map(x => `<option ${x.id === s.mcVersion ? 'selected' : ''}>${esc(x.id)}</option>`).join('');
      }).catch(() => {});
      $('#sver', t).onchange = (e) => save({ mcVersion: e.target.value }, 'wersja – pobierze się przy starcie').then(renderHead).then(() => settings(t));
    }
    if ($('#sloader', t)) {
      nore.servers.loaderVersions(s.type, s.mcVersion).then(list => {
        const sel = $('#sloader', t);
        if (!sel) return;
        sel.innerHTML = `<option value="">Najnowsza stabilna</option>${list.slice(0, 120).map(l => `<option value="${esc(l.version)}" ${l.version === s.loaderVersion ? 'selected' : ''}>${esc(l.version)}${l.stable ? '' : ' • BETA'}</option>`).join('')}`;
      }).catch(() => {});
      $('#sloader', t).onchange = (e) => save({ loaderVersion: e.target.value }, 'wersja loadera – zainstaluje się przy starcie');
    }
    if ($('#sloadertxt', t)) $('#sloadertxt', t).onchange = (e) => save({ loaderVersion: e.target.value.trim() }, 'wersja Velocity – zainstaluje się przy starcie');
    $('#sport', t).onchange = (e) => { const p = parseInt(e.target.value, 10); if (p > 1024 && p < 65536) save({ port: p }, 'port').then(renderHead); else toast('Nieprawidłowy port', '1025–65535', 'error'); };
    const m = $('#smem', t);
    const preview = async () => { const box = $('#sjprev', t); if (box) box.textContent = await nore.servers.jvmPreview(id, { memoryMb: +m.value, jvmProfile: $('#sjprof', t).value, jvmArgs: $('#sjvm', t).value }).catch(() => ''); };
    const mu = () => { $('#smemv', t).textContent = (m.value / 1024).toFixed(1) + ' GB'; sliderFill(m); };
    m.oninput = () => { mu(); preview(); }; mu(); preview();
    m.onchange = () => save({ memoryMb: +m.value }, 'RAM');
    $('#sjprof', t).onchange = (e) => { save({ jvmProfile: e.target.value }, 'profil JVM'); preview(); };
    $('#sjvm', t).onchange = (e) => { save({ jvmArgs: e.target.value.trim() }, 'argumenty JVM'); preview(); };
    $('#sauto', t).onchange = (e) => save({ autoRestart: e.target.checked }, 'automatyczny restart');
    const saveSchedule = () => save({ schedule: { restartAt: $('#srat', t).value, warnMinutes: $('#srwarn', t).value, backupEveryH: $('#sbk', t) ? $('#sbk', t).value : 0 } }, 'harmonogram');
    ['#srat', '#srwarn', '#sbk'].forEach(sel => { if ($(sel, t)) $(sel, t).onchange = saveSchedule; });
    $('#reinstall', t).onclick = async () => { try { toast('Instalowanie', engine(s.type).label); await nore.servers.reinstall(id); toast('Gotowe', 'Silnik zainstalowany', 'success'); } catch (e) { errorToast(e); } };
    $('#sfolder', t).onclick = () => nore.servers.folder(id);
    $('#scfg', t).onclick = () => ConfigEditor.open({ serverId: id, kind: s.type === 'velocity' || s.type === 'bungeecord' || ['paper', 'purpur', 'folia'].includes(s.type) ? 'plugin' : 'mod' }, { title: s.name });
    $('#sdel', t).onclick = async () => {
      if (!(await confirmModal('Usunąć serwer?', `„${s.name}” zostanie usunięty razem ze światem i kopiami.`, { ok: 'Usuń', danger: true }))) return;
      try { await nore.servers.remove(id); go('servers'); } catch (e) { errorToast(e); }
    };
    if (proxy) return;
    // MOTD with live preview
    const motdIn = $('#smotd', t);
    const drawMotd = async () => {
      const lines = await nore.servers.motdPreview(motdIn.value).catch(() => []);
      $('#smprev', t).innerHTML = lines.map(segs => `<div class="mp-line">${segs.map(x => `<span style="color:${x.color};${x.bold ? 'font-weight:700;' : ''}${x.italic ? 'font-style:italic;' : ''}${x.underline || x.strike ? `text-decoration:${x.underline ? 'underline ' : ''}${x.strike ? 'line-through' : ''};` : ''}">${esc(x.text)}</span>`).join('')}</div>`).join('') || '<div class="mp-line" style="color:#aaa">A Minecraft Server</div>';
    };
    motdIn.oninput = drawMotd; drawMotd();
    nore.servers.icon(id).then(u => { if (u && $('#smico', t)) $('#smico', t).innerHTML = `<img src="${u}" alt="">`; }).catch(() => {});
    $$('[data-code]', t).forEach(b => b.onclick = () => {
      const p = motdIn.selectionStart ?? motdIn.value.length;
      motdIn.value = motdIn.value.slice(0, p) + b.dataset.code + motdIn.value.slice(p);
      motdIn.focus(); motdIn.setSelectionRange(p + 2, p + 2);
      drawMotd(); motdIn.dispatchEvent(new Event('change'));
    });
    const saveProps = async (changes, what) => {
      try {
        const r = await nore.servers.saveProperties(id, changes);
        s = r.server;
        $('#spwarn', t).innerHTML = warnHtml(r.warnings);
        if (r.errors.length) toast('Poprawiono wartość', r.errors.join('\n'), 'error'); else saved(what);
      } catch (e) { errorToast(e); }
    };
    motdIn.onchange = () => saveProps({ motd: motdIn.value }, 'MOTD');
    $('#sicon', t).onclick = async () => { try { if (await nore.servers.setIcon(id)) { saved('ikona'); renderHead(); settings(t); } } catch (e) { errorToast(e); } };
    $$('[data-pf]', t).forEach(inp => inp.onchange = async () => {
      const k = inp.dataset.pf;
      const val = inp.type === 'checkbox' ? inp.checked : inp.value;
      if (k === 'online-mode' && val === true && !(await confirmModal('Tylko konta premium?', 'Gracze z kontami non-premium nie wejdą na serwer. Zostawić online-mode wyłączony, jeśli grają z Tobą osoby bez premium.', { ok: 'Włącz online-mode' }))) { inp.checked = false; return; }
      saveProps({ [k]: val }, k);
    });
    $$('[data-raw]', t).forEach(inp => inp.onchange = () => saveProps({ [inp.dataset.raw]: inp.value }, inp.dataset.raw));
  }

  function switchTab(v) {
    tab = v;
    const btn = $(`#tabs .seg button[data-v="${v}"]`, root);
    if (btn) btn.click(); else renderTab();
  }

  const offs = [
    nore.on('server:log', (l) => { if (l.id === id && tab === 'console' && consoleAdd) consoleAdd(l); }),
    nore.on('server:state', (st) => { if (st.id !== id) return; renderHead(); if (tab === 'overview' || (tab === 'players' && st.players)) renderTab(); }),
    nore.on('server:progress', (p) => { if (p.id === id && !p.done && p.stage && tab === 'console' && consoleAdd) consoleAdd({ line: '[Launcher] ' + p.stage, stream: 'cmd' }); }),
    nore.on('server:tunnel', (ev) => { if (tunnelListener) tunnelListener(ev); }),
  ];
  renderHead().then(renderTab);
  return () => { alive = false; clearInterval(statsTimer); offs.forEach(o => o()); };
};
