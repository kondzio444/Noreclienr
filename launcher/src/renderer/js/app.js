'use strict';
/* Application shell: state, navigation with sliding indicator, global events, onboarding. */

const App = {
  state: null,
  info: null,
  page: 'home',
  progress: null,
  logs: [],
  running: null,
  media: {},
  stats: {},
  contentUpdates: {}, // { [instanceId]: { pack, mods, resourcepacks, shaders, checked } }
  listeners: new Set(),

  async refresh() {
    this.state = await nore.state();
    this.running = this.state.running;
    renderAccountChip();
    renderBadges();
    this.emit();
  },
  emit() { this.listeners.forEach(fn => { try { fn(); } catch (e) { console.error(e); } }); },
  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); },
  instance() {
    const s = this.state;
    return s.instances.find(i => i.id === s.selectedInstance) || s.instances[0] || null;
  },
  account() {
    const s = this.state;
    return s.accounts.find(a => a.id === s.selectedAccount) || null;
  },
};

const NAV = {
  'nav-main': [
    { id: 'home', label: 'Start', icon: 'home' },
    { id: 'instances', label: 'Instancje', icon: 'layers' },
    { id: 'servers', label: 'Serwery', icon: 'server' },
    { id: 'halloween', label: 'Halloween', icon: 'sparkles' },
  ],
  'nav-content': [
    { id: 'modpacks', label: 'Modpacki', icon: 'box' },
    { id: 'mods', label: 'Mody', icon: 'puzzle' },
    { id: 'resourcepacks', label: 'Paczki zasobów', icon: 'image' },
    { id: 'shaders', label: 'Shadery', icon: 'sun' },
    { id: 'datapacks', label: 'Datapacki', icon: 'database' },
  ],
  'nav-social': [
    { id: 'friends', label: 'Znajomi', icon: 'users' },
    { id: 'gallery', label: 'Galeria', icon: 'image' },
    { id: 'shop', label: 'Sklep', icon: 'crown', badge: 'wkrótce' },
  ],
  'nav-launcher': [
    { id: 'accounts', label: 'Konta', icon: 'user' },
    { id: 'settings', label: 'Ustawienia', icon: 'settings' },
    { id: 'console', label: 'Konsola', icon: 'terminal' },
  ],
};

function buildNav() {
  for (const [id, items] of Object.entries(NAV)) {
    const nav = document.getElementById(id);
    nav.innerHTML = items.map(it =>
      `<a data-page="${it.id}">${icon(it.icon)}<span>${it.label}</span><span class="badge" data-badge="${it.id}" ${it.badge ? '' : 'hidden'}>${it.badge || ''}</span></a>`).join('');
    $$('a', nav).forEach(a => { a.title = a.textContent.trim(); a.addEventListener('click', () => go(a.dataset.page)); });
  }
  // one active field for the whole rail, so it can glide between the groups
  if (!$('.rail-ind')) $('.sb-scroll').prepend(el('<span class="rail-ind" aria-hidden="true"></span>'));
}

const DETAIL_PAGES = { instance: 'instances', server: 'servers' };
const navKey = (page) => DETAIL_PAGES[page] || page;

let indY = null;
function moveIndicator() {
  const scroll = $('.sb-scroll');
  const ind = $('.rail-ind', scroll);
  const active = $(`a[data-page="${navKey(App.page)}"]`, scroll);
  $$('.nav a', scroll).forEach(a => a.classList.toggle('active', a === active));
  if (!ind) return;
  if (!active || !active.offsetParent) { ind.style.opacity = 0; indY = null; return; }
  const y = active.getBoundingClientRect().top - scroll.getBoundingClientRect().top + scroll.scrollTop;
  ind.style.height = active.offsetHeight + 'px';
  ind.style.opacity = 1;
  // glide from wherever the field is right now (interruptible), with a small spring settle
  const from = indY == null ? null : (() => { const m = new DOMMatrixReadOnly(getComputedStyle(ind).transform); return m.m42; })();
  ind.getAnimations().forEach(a => a.cancel());
  ind.style.transform = `translateY(${y}px)`;
  if (from != null && Math.abs(from - y) > 0.5) {
    Motion.animate(ind, [{ transform: `translateY(${from}px)` }, { transform: `translateY(${y}px)` }],
      { duration: Motion.ms('--nore-spring-tab-dur'), easing: Motion.ease('--nore-spring-tab') });
  }
  indY = y;
}

function setBadge(b, text) {
  if (!b) return;
  const t = String(text);
  if (b.textContent !== t && !b.hidden && b.textContent) Motion.bump(b);
  b.textContent = t;
}

function renderBadges() {
  const b = $('[data-badge="instances"]');
  if (b && App.state) { setBadge(b, App.state.instances.length); b.hidden = false; }
  // state is a dot sticker, a count is a plain number (DESIGN.md §5 index tabs)
  const c = $('[data-badge="console"]');
  if (c) { c.hidden = !App.running; if (!c.firstElementChild) c.innerHTML = '<i class="dot sm ready"></i>'; }
  const ev = $('[data-badge="halloween"]');
  if (ev && typeof Events === 'object') Events.railBadge(ev);
}

// ------------------------------------------------------------------ navigation: short, directional, interruptible

const PAGE_ORDER = Object.values(NAV).flat().map(n => n.id);

/** down/up follow the rail order; in/out drill into or back out of a detail page; '' just fades. */
function pageDir(from, to) {
  if (!from || from === to) return '';
  if (DETAIL_PAGES[to] && DETAIL_PAGES[to] === from) return 'in';
  if (DETAIL_PAGES[from] && DETAIL_PAGES[from] === to) return 'out';
  if (DETAIL_PAGES[to] && !DETAIL_PAGES[from]) return 'in';
  const a = PAGE_ORDER.indexOf(navKey(from)), b = PAGE_ORDER.indexOf(navKey(to));
  if (a < 0 || b < 0 || a === b) return '';
  return b > a ? 'down' : 'up';
}

/** The leaving page stays on screen as an inert ghost for a moment while the new page is already live. */
function ghostPage(page, dir) {
  const view = $('#view'), main = $('#main');
  document.querySelectorAll('.page-ghost').forEach(g => g.remove()); // interrupted: drop the older ghost at once
  if (!page || Motion.off()) { page && page.remove(); return; }
  const vr = view.getBoundingClientRect(), mr = main.getBoundingClientRect();
  const ghost = el('<div class="page-ghost" aria-hidden="true"></div>');
  Object.assign(ghost.style, { left: (vr.left - mr.left) + 'px', top: (vr.top - mr.top) + 'px', width: view.clientWidth + 'px', height: view.clientHeight + 'px' });
  const cs = getComputedStyle(view);
  page.style.margin = `${cs.paddingTop} ${cs.paddingRight} 0 ${cs.paddingLeft}`;
  page.style.transform = `translateY(${-view.scrollTop}px)`;
  page.querySelectorAll('[id]').forEach(n => n.removeAttribute('id'));
  page.inert = true;
  ghost.appendChild(page);
  main.appendChild(ghost);
  const d = Motion.ms('--nore-shift-page-out');
  const vertical = document.body.dataset.trans === 'rise';
  const shift = { down: vertical ? `0 ${-d}px` : `${-d}px 0`, in: `${-d}px 0`, up: vertical ? `0 ${d}px` : `${d}px 0`, out: `${d}px 0` }[dir] || '0 0';
  const a = Motion.animate(ghost, [{ opacity: 1, translate: '0 0' }, { opacity: 0, translate: shift }],
    { duration: Motion.ms('--nore-dur-exit'), easing: Motion.ease('--nore-ease-in'), fill: 'forwards' }); // leaves faster than the new page arrives
  if (a) a.onfinish = () => ghost.remove(); else ghost.remove();
}

let cleanup = null;

async function go(page, opts) {
  if (page === 'chat') page = 'friends'; // the chat lives inside Znajomi now
  const view = $('#view');
  const current = $(':scope > .page', view);
  const from = App.page;
  const dir = current ? pageDir(from, page) : '';
  App.page = page;
  moveIndicator();
  if (cleanup) { try { cleanup(); } catch { /* ignore */ } cleanup = null; }
  ghostPage(current, dir);
  view.innerHTML = '';
  view.scrollTop = 0;
  const root = el('<div class="page"></div>');
  if (dir) root.dataset.dir = dir;
  view.appendChild(root);
  $('#bg').classList.toggle('dim', page !== 'home');
  const fn = Pages[page] || Pages.home;
  cleanup = fn(root, opts || {}) || null;
}

function renderAccountChip() {
  const chip = $('#account-chip');
  const acc = App.account();
  chip.innerHTML = acc
    ? `${avatarHtml(acc)}<div class="meta"><b>${esc(acc.name)}</b><span><i class="dot sm ${acc.type === 'microsoft' ? 'ready' : 'off'}"></i>${acc.type === 'microsoft' ? 'premium' : 'bez premium'}</span></div>`
    : `${avatarHtml(null)}<div class="meta"><b>Bez konta</b><span><i class="dot sm off"></i>nick podasz przy grze</span></div>`;
}

// ------------------------------------------------------------------ launching (shared by pages)

async function launchSelected(instance, opts) {
  const inst = instance || App.instance();
  if (!inst) return toast('Brak instancji', 'Utwórz instancję, aby zagrać.', 'error');
  // login is never forced: without an account the player just types a nick (non-premium) and plays
  if (!App.account()) {
    return offlineLoginModal(() => { if (App.account()) launchSelected(inst, opts); });
  }
  App.logs = [];
  App.lastLaunchError = null;
  try {
    App.progress = { stage: 'Przygotowywanie…' };
    App.emit();
    await nore.game.launch(inst.id, opts || {});
    toast('Uruchamianie', `${inst.name} • ${inst.mcVersion}${opts && opts.joinServer ? ` → ${opts.joinServer}` : ''}`, 'success');
  } catch (e) {
    App.lastLaunchError = e;
    App.progress = null;
    App.emit();
    errorToast(e, 'Nie udało się uruchomić gry');
  }
}

// ------------------------------------------------------------------ onboarding wizard 1.4 Beta (first-run experience)

const WIZ_STEPS = [
  { id: 'welcome', name: 'Witaj', desc: 'Twój album Nore', icon: 'sparkles' },
  { id: 'account', name: 'Nick', desc: 'Bez logowania lub premium', icon: 'user' },
  { id: 'look', name: 'Wygląd', desc: 'Kolor okładki i tło', icon: 'image' },
  { id: 'memory', name: 'Pamięć RAM', desc: 'Ile pamięci dla gry', icon: 'cpu' },
  { id: 'install', name: 'Instalacja', desc: 'Minecraft + Nore Client', icon: 'download' },
  { id: 'done', name: 'Gotowe', desc: 'Czas na grę', icon: 'check' },
];

/** Full-window first-run wizard. Resolves once the player clicks "DO GRY". */
function onboarding() {
  return new Promise((resolve) => {
    const wiz = el(`<div class="wizard wz14">
      <div class="wz-aura"><i></i><i></i><i></i></div>
      <aside class="wz-rail">
        <div class="wz-brand"><span class="logo-sticker"><img src="assets/album/logo-art.png" alt=""></span><div><b>Nore</b><small>Launcher ${esc(String(App.info.version || '').split('.').slice(0, 2).join('.'))}</small></div></div>
        <div class="wz-label">Pierwsze kroki</div>
        <nav class="wz-steps">
          <div class="wz-line"><i></i></div>
          ${WIZ_STEPS.map((s, i) => `<button class="wz-st" data-i="${i}" tabindex="-1"><span class="dot">${icon(s.icon)}<span class="num">${i + 1}</span></span><span class="txt"><b>${esc(s.name)}</b><small>${esc(s.desc)}</small></span></button>`).join('')}
        </nav>
        <div class="wz-rail-foot"><span id="wz-count"></span><span class="wz-hint"><span class="kbd">Enter</span> dalej</span></div>
      </aside>
      <section class="wz-main"><div class="wz-stage"></div></section>
    </div>`);
    document.body.appendChild(wiz);
    const stage = $('.wz-stage', wiz);
    const total = App.info.totalMemMb;
    const maxMem = Math.max(4096, total - 1024);
    let step = 0, installed = false;
    const installing = () => { const b = $('.wz-pane:not(.out) #w-go', stage); return !!(b && b.disabled); };
    let memory = Math.min(8192, Math.max(2048, Math.round(total / 4 / 512) * 512));
    memory = Math.min(memory, maxMem);

    const go2 = (n) => {
      if (n === step || n < 0 || n >= WIZ_STEPS.length) return;
      const dir = n > step ? 'fwd' : 'back';
      step = n;
      render(dir);
    };
    const next = () => go2(step + 1);
    const back = () => go2(step - 1);

    // rail: completed steps before the install can be revisited
    $$('.wz-st', wiz).forEach(b => b.addEventListener('click', () => {
      const i = +b.dataset.i;
      if (installing() || step > 4 || i >= step) return;
      go2(i);
    }));

    const updateRail = () => {
      $$('.wz-st', wiz).forEach((b, i) => {
        b.classList.toggle('done', i < step);
        b.classList.toggle('current', i === step);
        b.classList.toggle('clickable', i < step && step <= 4 && !installing());
      });
      const line = $('.wz-line i', wiz);
      line.style.transform = `scaleY(${step / (WIZ_STEPS.length - 1)})`;
      $('#wz-count', wiz).textContent = `Krok ${step + 1} z ${WIZ_STEPS.length}`;
    };

    const render = (dir = 'fwd') => {
      updateRail();
      $$('.wz-pane:not(.out)', stage).forEach(p => {
        p.classList.remove('in-fwd', 'in-back');
        p.classList.add('out', 'out-' + dir);
        setTimeout(() => p.remove(), 520);
      });
      const pane = el(`<div class="wz-pane in-${dir}" data-step="${WIZ_STEPS[step].id}"></div>`);
      stage.appendChild(pane);
      STEPS[step](pane);
      stagger2(pane);
    };

    // children of .wz-body fade in one after another
    const stagger2 = (pane) => {
      $$('.wz-in', pane).forEach((c, i) => c.style.setProperty('--d', (120 + i * 70) + 'ms'));
    };

    const head = (eyebrow, title, lead) => `${eyebrow ? `<div class="wz-eyebrow wz-in">${eyebrow}</div>` : ''}<h2 class="wz-in">${title}</h2>${lead ? `<p class="lead wz-in">${lead}</p>` : ''}`;
    const navRow = (left, right) => `<div class="wz-nav wz-in">${left || '<span></span>'}${right || ''}</div>`;
    const backBtn = `<button class="btn ghost" data-back>${icon('arrowLeft')} Wstecz</button>`;
    const bind = (pane) => { $$('[data-back]', pane).forEach(b => b.addEventListener('click', back)); };

    const saveSettings = async (patch) => {
      try {
        App.state.settings = await nore.setSettings(patch);
        await applyAppearance(App.state.settings);
      } catch (e) { errorToast(e, 'Ustawienia'); }
    };

    const STEPS = [
      // 1 — welcome
      (pane) => {
        pane.innerHTML = `<div class="wz-body wz-welcome">
          <div class="wz-logo wz-in"><img src="assets/album/logo-art.png" alt=""></div>
          <h2 class="wz-in">Twój album <span>Nore</span></h2>
          <p class="lead wz-in">Instancje, mody, znajomi i nagrody z wydarzeń – wszystko to naklejki w Twoim albumie.
          Ustawmy go – zajmie to mniej niż minutę. Logowanie nie jest wymagane.</p>
          <div class="wz-chips wz-in">
            <div class="wz-chip"><span class="ic">${icon('zap')}</span><div><b>Nore Client</b><small>Klient PvP z HUD-em i FPS boostem</small></div></div>
            <div class="wz-chip"><span class="ic">${icon('box')}</span><div><b>Modpacki</b><small>Tysiące paczek z Modrinth</small></div></div>
            <div class="wz-chip"><span class="ic">${icon('users')}</span><div><b>Znajomi</b><small>Zobacz, w co grają inni</small></div></div>
          </div>
          <div class="wz-cta wz-in"><button class="btn play big" data-enter id="w-next">${icon('play')} ZACZYNAMY</button></div>
        </div>`;
        $('#w-next', pane).addEventListener('click', next);
      },

      // 2 — account
      (pane) => {
        const acc = App.account();
        pane.innerHTML = `<div class="wz-body">
          ${head('', 'Czyj to <span>album?</span>', 'Wystarczy nick – grasz od razu, bez logowania. Konto Microsoft (premium) możesz dodać teraz albo kiedyś w zakładce Konta.')}
          ${acc ? `<div class="wz-current wz-in">${avatarHtml(acc)}<div><b>${esc(acc.name)}</b><small>${acc.type === 'microsoft' ? 'Premium (Microsoft)' : 'Non-premium'} · zalogowano</small></div>${icon('check', 'ok')}</div>` : ''}
          <div class="login-options wz-in">
            <div class="card hover login-option primary" id="w-off">
              <div class="ico">${icon('user')}</div>
              <h3>Graj na nicku</h3><p>Bez premium: singleplayer, LAN i serwery z wyłączonym online-mode.</p><span class="go">${icon('arrowRight')}</span></div>
            <div class="card hover login-option ms" id="w-ms">
              <div class="ico"><div class="ms-grid"><i style="background:#f25022"></i><i style="background:#7fba00"></i><i style="background:#00a4ef"></i><i style="background:#ffb900"></i></div></div>
              <h3>Konto Microsoft</h3><p>Premium: serwery online-mode, Twój skin i peleryna.</p><span class="go">${icon('arrowRight')}</span></div>
          </div>
          ${navRow(backBtn, acc ? `<button class="btn" data-enter id="w-skip">Dalej ${icon('arrowRight')}</button>` : `<button class="btn ghost" data-enter id="w-skip">Pomiń ${icon('arrowRight')}</button>`)}
        </div>`;
        bind(pane);
        $('#w-skip', pane).addEventListener('click', next);
        $('#w-off', pane).addEventListener('click', () => offlineLoginModal(() => go2(2)));
        $('#w-ms', pane).addEventListener('click', () => microsoftLoginModal(() => go2(2)));
      },

      // 3 — appearance
      (pane) => {
        const s = App.state.settings;
        const scenes = Background.SCENES.filter(sc => sc.id !== 'custom');
        const cur = scenes.some(sc => sc.id === s.bgScene) ? s.bgScene : 'photo';
        pane.innerHTML = `<div class="wz-body">
          ${head('', 'Kolor <span>okładki</span>', 'Akcent barwi okładkę albumu, naklejkę Graj i logo. Zmiany widzisz od razu.')}
          <div class="wz-look wz-in">
            <div class="wz-look-opts">
              <div class="look-label">Kolor akcentu</div>
              <div class="wz-accents">${Object.entries(ACCENTS).map(([k, a]) => `<button class="wz-acc ${k === (s.accentPreset || 'nore') ? 'on' : ''}" data-v="${k}" style="--c1:${a.b};--c2:${a.d}"><span class="sw"></span><small>${esc(a.name)}</small></button>`).join('')}</div>
              <div class="look-label">Tło</div>
              <div class="wz-scenes">${scenes.map(sc => `<button class="wz-scene ${sc.id === cur ? 'on' : ''}" data-v="${sc.id}" title="${esc(sc.desc)}"><span class="prev" style="background:${SCENE_PREVIEW[sc.id]}"></span><b>${esc(sc.name)}</b></button>`).join('')}</div>
            </div>
            <div class="wz-preview">
              <div class="pv-screen" id="pv-screen" style="background:${SCENE_PREVIEW[cur]}">
                <div class="pv-side"><img src="assets/logo.png" alt=""><i class="on"></i><i></i><i></i><i></i></div>
                <div class="pv-main"><span class="pv-chip">1.4 BETA</span><b>Nore Client</b><small>1.21.1 · Fabric</small><span class="pv-play">${icon('play')} GRAJ</span></div>
              </div>
              <div class="pv-cap"><span id="pv-acc"></span> · <span id="pv-scene"></span></div>
            </div>
          </div>
          ${navRow(backBtn, `<button class="btn" data-enter id="w-next">Dalej ${icon('arrowRight')}</button>`)}
        </div>`;
        bind(pane);
        const caption = () => {
          const st = App.state.settings;
          $('#pv-acc', pane).textContent = (ACCENTS[st.accentPreset] || ACCENTS.orange).name;
          const sc = scenes.find(x => x.id === st.bgScene) || scenes[0];
          $('#pv-scene', pane).textContent = sc.name;
        };
        caption();
        $$('.wz-acc', pane).forEach(b => b.addEventListener('click', async () => {
          $$('.wz-acc', pane).forEach(x => x.classList.toggle('on', x === b));
          await saveSettings({ accentPreset: b.dataset.v });
          caption();
        }));
        $$('.wz-scene', pane).forEach(b => b.addEventListener('click', async () => {
          $$('.wz-scene', pane).forEach(x => x.classList.toggle('on', x === b));
          const scr = $('#pv-screen', pane);
          scr.style.background = SCENE_PREVIEW[b.dataset.v];
          scr.classList.remove('flash'); void scr.offsetWidth; scr.classList.add('flash');
          await saveSettings({ bgScene: b.dataset.v });
          caption();
        }));
        $('#w-next', pane).addEventListener('click', next);
      },

      // 4 — memory
      (pane) => {
        const gb = (mb) => (mb / 1024).toFixed(mb % 1024 ? 1 : 0) + ' GB';
        const rec = total <= 6144 ? 2048 : total <= 8192 ? 3072 : total <= 16384 ? 4096 : 6144;
        const recMb = Math.min(rec, maxMem);
        const presets = [2048, 4096, 6144, 8192];
        pane.innerHTML = `<div class="wz-body">
          ${head('', 'Pamięć <span>RAM</span>', `Ile pamięci przydzielić grze? Twój komputer ma <b>${(total / 1024).toFixed(1)} GB</b>. Dla Nore Client z modami polecamy 4–6 GB.`)}
          <div class="wz-mem wz-in">
            <div class="wz-mem-top"><div class="big" id="w-memv"></div><div class="state" id="w-mems"></div></div>
            <input type="range" class="slider" id="w-mem" min="1024" max="${maxMem}" step="512" value="${memory}">
            <div class="wz-membar"><div class="track"><i id="w-memfill"></i></div><div class="lbls"><span><b class="g"></b>Gra</span><span><b></b>Pamięć komputera: ${(total / 1024).toFixed(1)} GB</span></div></div>
            <div class="wz-presets">${presets.map(p => `<button class="lchip" data-v="${p}" ${p > maxMem ? 'disabled title="Za mało pamięci w komputerze"' : ''}>${gb(p)}</button>`).join('')}</div>
          </div>
          <div class="wz-rec wz-in">${icon('info')}<span>Rekomendacja dla Twojego komputera: <b>${gb(recMb)}</b></span><button class="btn sm ghost" id="w-rec">Ustaw</button></div>
          ${navRow(backBtn, `<button class="btn" data-enter id="w-next">Dalej ${icon('arrowRight')}</button>`)}
        </div>`;
        bind(pane);
        const r = $('#w-mem', pane);
        const upd = () => {
          memory = +r.value;
          $('#w-memv', pane).textContent = gb(memory);
          $('#w-memfill', pane).style.width = Math.min(100, memory / total * 100) + '%';
          const st = $('#w-mems', pane);
          const [cls, txt] = memory > total * 0.75 ? ['warn', 'Zostawiasz mało pamięci systemowi']
            : memory < 3072 ? ['low', 'Wystarczy do vanilli, z modami może przycinać'] : ['ok', 'Optymalnie dla Nore Client'];
          st.className = 'state ' + cls; st.textContent = txt;
          $$('.wz-presets .lchip', pane).forEach(b => b.classList.toggle('on', +b.dataset.v === memory));
          sliderFill(r);
        };
        r.addEventListener('input', upd); upd();
        $$('.wz-presets .lchip', pane).forEach(b => b.addEventListener('click', () => { r.value = b.dataset.v; upd(); }));
        $('#w-rec', pane).addEventListener('click', () => { r.value = recMb; upd(); });
        $('#w-next', pane).addEventListener('click', async () => {
          try { App.state.settings = await nore.setSettings({ memoryMb: memory }); } catch (e) { errorToast(e, 'Ustawienia'); }
          next();
        });
      },

      // 5 — install (logic lives in renderInstallStep)
      (pane) => {
        renderInstallStep(pane, next);
        const goBtn = $('#w-go', pane);
        if (goBtn) {
          goBtn.dataset.enter = '';
          goBtn.addEventListener('click', () => { installed = true; setTimeout(updateRail); });
        }
        const step = $('.step', pane);
        if (step) step.insertAdjacentHTML('afterbegin', `<div class="wz-eyebrow">${icon('download')} KROK 5 · INSTALACJA</div>`);
        const skip = $('#w-skip', pane);
        if (skip) skip.addEventListener('click', () => { installed = false; });
      },

      // 6 — done
      (pane) => {
        const acc = App.account();
        const st = App.state.settings;
        const ac = ACCENTS[st.accentPreset] || ACCENTS.orange;
        const sc = Background.SCENES.find(x => x.id === st.bgScene) || Background.SCENES[0];
        const inst = App.instance();
        pane.innerHTML = `<div class="wz-body wz-done">
          <div class="wz-confetti"></div>
          <div class="wz-logo small wz-in"><img src="assets/album/logo-art.png" alt=""></div>
          <h2 class="wz-in">Album <span>gotowy</span></h2>
          <p class="lead wz-in">${installed ? `Instancja <b>${esc(inst ? inst.name : 'Nore Client')}</b> jest zainstalowana.` : 'Brakujące pliki pobiorą się przy pierwszym uruchomieniu.'} Kliknij GRAJ na stronie głównej, aby zacząć.</p>
          <div class="wz-summary wz-in">
            <div class="sum"><span class="ic">${icon('user')}</span><div><small>Konto</small><b>${acc ? esc(acc.name) : 'Dodasz później'}</b><em>${acc ? (acc.type === 'microsoft' ? 'Premium' : 'Non-premium') : 'Zakładka Konta'}</em></div></div>
            <div class="sum"><span class="ic sw" style="--c1:${ac.b};--c2:${ac.d}"></span><div><small>Wygląd</small><b>${esc(ac.name)}</b><em>Tło: ${esc(sc.name)}</em></div></div>
            <div class="sum"><span class="ic">${icon('cpu')}</span><div><small>Pamięć RAM</small><b>${(memory / 1024).toFixed(memory % 1024 ? 1 : 0)} GB</b><em>z ${(total / 1024).toFixed(1)} GB</em></div></div>
          </div>
          <div class="wz-cta wz-in"><button class="btn play big" data-enter id="w-done">${icon('play')} DO GRY</button></div>
        </div>`;
        if (!document.body.classList.contains('no-anim')) {
          const box = $('.wz-confetti', pane);
          const colors = [ac.a, ac.b, ac.d, '#ffffff', '#ffe08a'];
          let html = '';
          for (let i = 0; i < 46; i++) {
            const x = Math.round(Math.random() * 100), d = (Math.random() * 1.4).toFixed(2), dur = (2.4 + Math.random() * 2).toFixed(2);
            const rot = Math.round(Math.random() * 720 - 360), drift = Math.round(Math.random() * 120 - 60);
            const shape = i % 3 === 0 ? 'spark' : i % 3 === 1 ? 'bit' : 'dot';
            html += `<i class="${shape}" style="left:${x}%;--d:${d}s;--t:${dur}s;--r:${rot}deg;--dx:${drift}px;--c:${colors[i % colors.length]}"></i>`;
          }
          box.innerHTML = html;
        }
        $('#w-done', pane).addEventListener('click', async (e) => {
          e.currentTarget.disabled = true;
          try { await nore.onboardingDone(); } catch (err) { console.error(err); }
          document.removeEventListener('keydown', onKey, true);
          wiz.classList.add('closing');
          setTimeout(() => { wiz.remove(); resolve(); }, 450);
        });
      },
    ];

    // Enter = primary action of the current step; Esc intentionally does nothing
    const onKey = (e) => {
      if (e.key === 'Escape') { if (!$('.modal-backdrop')) { e.preventDefault(); e.stopPropagation(); } return; }
      if (e.key !== 'Enter' || e.repeat || $('.modal-backdrop')) return;
      const t = e.target;
      if (t && (t.tagName === 'TEXTAREA' || (t.tagName === 'INPUT' && t.type !== 'range'))) return;
      if (t && t.tagName === 'BUTTON' && (!wiz.contains(t) || t.hasAttribute('data-back'))) return;
      const pane = $('.wz-pane:not(.out)', stage);
      const btn = pane && $('[data-enter]', pane);
      if (btn && !btn.disabled) { e.preventDefault(); btn.click(); }
    };
    document.addEventListener('keydown', onKey, true);

    render('fwd');
  });
}

/** Wizard step that installs the default instance with an animated progress ring. */
function renderInstallStep(content, next) {
  const inst = App.instance();
  const C = 2 * Math.PI * 92;
  const PHASES = [
    { id: 'game', name: 'Minecraft ' + (inst ? inst.mcVersion : ''), desc: 'Biblioteki, zasoby i dźwięki' },
    { id: 'loader', name: 'Fabric Loader', desc: 'Ładowarka modów' },
    { id: 'nore', name: 'Nore Client + Fabric API', desc: 'Klient PvP i jego zależności' },
    { id: 'java', name: 'Java', desc: 'Środowisko uruchomieniowe od Mojang' },
  ];
  content.innerHTML = `<div class="step">
    <h2>Instalacja <span>gry</span></h2>
    <p class="lead">Pobieramy wszystko, czego potrzebujesz. Możesz też pominąć ten krok — pliki pobiorą się przy pierwszym uruchomieniu.</p>
    <div class="install-step">
      <div class="ring" id="ring"><div class="orbit"></div>
        <svg viewBox="0 0 210 210"><defs><linearGradient id="ringGrad" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffb547"/><stop offset="1" stop-color="#ff5a1a"/></linearGradient></defs>
          <circle class="track" cx="105" cy="105" r="92"/><circle class="bar" id="bar" cx="105" cy="105" r="92" stroke-dasharray="${C}" stroke-dashoffset="${C}"/></svg>
        <div class="center"><div><div class="pct" id="pct">0%</div><div class="lbl" id="lbl">GOTOWY</div></div></div></div>
      <div class="phases" id="phases">${PHASES.map(p => `<div class="phase" data-p="${p.id}"><div class="st">${icon('clock')}</div><div><b>${esc(p.name)}</b><small>${esc(p.desc)}</small></div></div>`).join('')}</div>
    </div>
    <div class="nav-row"><button class="btn ghost" id="w-skip">Pomiń</button><button class="btn" id="w-go">${icon('download')} Zainstaluj</button></div></div>`;
  let overall = 0, current = null;
  const order = PHASES.map(p => p.id);
  const weight = { game: 0.7, loader: 0.05, nore: 0.07, java: 0.18 };
  const setPct = (f) => {
    overall = Math.max(overall, Math.min(1, f));
    $('#bar', content).style.strokeDashoffset = C * (1 - overall);
    $('#pct', content).textContent = Math.round(overall * 100) + '%';
  };
  const mark = (step) => {
    const idx = order.indexOf(step);
    if (idx < 0) return;
    order.forEach((id, i) => {
      const el2 = $(`[data-p="${id}"]`, content);
      const state = i < idx ? 'done' : i === idx ? 'active' : '';
      if (el2.dataset.state === state) return;
      el2.dataset.state = state;
      el2.className = 'phase ' + state;
      $('.st', el2).innerHTML = state === 'done' ? icon('check') : state === 'active' ? '<span class="spinner"></span>' : icon('clock');
    });
    current = step;
  };
  $('#w-skip', content).onclick = next;
  $('#w-go', content).onclick = async () => {
    if (!inst) return next();
    $('#w-go', content).disabled = true;
    $('#w-skip', content).disabled = true;
    $('#lbl', content).textContent = 'POBIERANIE';
    const off = nore.on('progress', (p) => {
      if (!p) return;
      const step = p.step || current || 'game';
      mark(step);
      const before = order.slice(0, order.indexOf(step)).reduce((a, id) => a + weight[id], 0);
      const frac = p.total ? (p.totalBytes ? p.bytes / p.totalBytes : p.done / p.total) : 0.05;
      setPct(before + weight[step] * frac);
      const small = $(`[data-p="${step}"] small`, content);
      if (small && p.current) small.textContent = p.current;
    });
    try {
      await nore.game.prepare(inst.id);
      order.forEach(id => { const e2 = $(`[data-p="${id}"]`, content); e2.className = 'phase done'; $('.st', e2).innerHTML = icon('check'); });
      setPct(1);
      $('#ring', content).classList.add('done');
      $('#lbl', content).textContent = 'ZAINSTALOWANO';
      setTimeout(next, 1200);
    } catch (e) {
      errorToast(e, 'Instalacja nie powiodła się');
      $('#w-go', content).disabled = false;
      $('#w-skip', content).disabled = false;
      $('#lbl', content).textContent = 'BŁĄD';
    } finally {
      off();
    }
  };
}

// ------------------------------------------------------------------ motion setting + app launch storyboard

/** "Animacje": full | reduced (fades only, like prefers-reduced-motion) | off. Older configs only had the boolean. */
function motionMode(s) {
  if (s && ['full', 'reduced', 'off'].includes(s.motion)) return s.motion;
  return s && s.animations === false ? 'off' : 'full';
}
function applyMotionSetting(s) {
  const m = motionMode(s);
  document.body.classList.toggle('no-anim', m === 'off');
  document.body.classList.toggle('motion-reduced', m === 'reduced');
  if (typeof Embers === 'object') Embers.setEnabled(m !== 'off');
}

/** design/README.md "App launch" (dur.launch 900 ms): the accent-dyed cover fills the window, the logo
    sticker sticks at its centre, the cover narrows into the 224 px rail and the page sticks in.
    Reduced motion / animations off: a 200 ms crossfade. `ready` renders Start under the cover. */
function launchStoryboard(ready) {
  const sp = $('#splash');
  const done = () => { sp.classList.add('hide'); sp.remove(); window.dispatchEvent(new Event('nore:launched')); };
  if (Motion.off() || Motion.reduced()) {
    ready();
    const a = Motion.animate(sp, [{ opacity: 1 }, { opacity: 0 }], { duration: 200, easing: 'linear', fill: 'forwards' });
    if (a) a.onfinish = done; else done();
    return;
  }
  sp.style.setProperty('--rail-scale', (($('#sidebar').offsetWidth || 224) / Math.max(1, window.innerWidth)).toFixed(4));
  sp.classList.add('go');
  setTimeout(ready, 380);                                   // the page sticks in from ~420 ms
  setTimeout(() => sp.classList.add('leave'), 560);          // the logo sticker settles into the rail brand
  setTimeout(() => {
    const a = Motion.animate(sp, [{ opacity: 1 }, { opacity: 0 }], { duration: 160, easing: 'linear', fill: 'forwards' });
    if (a) a.onfinish = done; else done();
  }, Math.max(740, Motion.ms('--nore-dur-launch') - 160));
}

// ------------------------------------------------------------------ boot

(async function boot() {
  buildNav();
  $('#wc-min').onclick = () => nore.window.minimize();
  $('#wc-max').onclick = () => nore.window.maximize();
  $('#wc-close').onclick = () => nore.window.close();
  $('#account-chip').onclick = () => go('accounts');

  nore.on('progress', (p) => { App.progress = p; App.emit(); });
  nore.on('log', (l) => {
    App.logs.push(l);
    if (App.logs.length > 5000) App.logs.splice(0, App.logs.length - 4000);
    if (App.onLog) App.onLog(l);
  });
  nore.on('game:state', async (g) => {
    App.running = g.running;
    if (!g.running && g.code != null && g.code !== 0) toast('Gra zakończyła się błędem', `Kod wyjścia ${g.code} — szukam przyczyny…`, 'error', 5000);
    await App.refresh();
  });

  App.info = await nore.info();
  await App.refresh();
  LoginGate.check();
  nore.on('update:state', renderUpdate);
  nore.on('content:updatesState', onContentUpdates);
  nore.content.updatesState().then(onContentUpdates).catch(() => {});
  nore.update.state().then(renderUpdate).catch(() => {});
  await applyAppearance(App.state.settings);
  loadInstanceMedia().then(() => App.emit());
  applyMotionSetting(App.state.settings);
  Events.init();
  $('#lb-ver').textContent = 'Launcher ' + String(App.info.version || '').split('.').slice(0, 2).join('.');

  const online = navigator.onLine;
  $('#net-status').innerHTML = online ? '<span class="dot"></span><span>Online</span>' : '<span class="dot off"></span><span>Offline</span>';

  launchStoryboard(() => go('home'));
  window.addEventListener('resize', moveIndicator);
  if (App.state.firstRun) {
    setTimeout(async () => { await onboarding(); await App.refresh(); go('home'); }, 1100);
  }
})();

// ------------------------------------------------------------------ auto-update banner

App.update = { state: 'idle' };
function renderUpdate(u) {
  App.update = u || App.update;
  App.emit && App.emit();
  let bar = $('#update-bar');
  const show = ['downloading', 'ready', 'available'].includes(App.update.state);
  if (!show) { if (bar) bar.remove(); return; }
  if (!bar) {
    bar = el('<div id="update-bar" class="update-bar"></div>');
    document.body.appendChild(bar);
  }
  const u2 = App.update;
  bar.innerHTML = u2.state === 'ready'
    ? `<div class="ub-ico">${icon('sparkles')}</div><div class="ub-text"><b>Aktualizacja ${esc(u2.next)} gotowa</b><span>Zainstaluje się przy zamknięciu albo teraz</span></div>
       <button class="btn sm" id="ub-go">${icon('refresh')} Uruchom ponownie</button>`
    : u2.state === 'available'
      ? `<div class="ub-ico">${icon('download')}</div><div class="ub-text"><b>Dostępna wersja ${esc(u2.next)}</b><span>Nore Launcher + Nore Client</span></div>
       <button class="btn sm" id="ub-dl">${icon('download')} Pobierz</button>`
      : `<div class="ub-ico">${icon('download')}</div><div class="ub-text"><b>Pobieranie aktualizacji ${esc(u2.next || '')}</b><span>${u2.percent || 0}%</span>
         <div class="ub-progress"><i style="width:${u2.percent || 0}%"></i></div></div>`;
  if ($('#ub-go', bar)) $('#ub-go', bar).onclick = () => nore.update.install().catch(e => errorToast(e, 'Aktualizacja'));
  if ($('#ub-dl', bar)) $('#ub-dl', bar).onclick = () => nore.update.download().catch(e => errorToast(e, 'Aktualizacja'));
}

// ------------------------------------------------------------------ modpack / mod updates (background check in main)

let contentUpdatesToasted = false;
function onContentUpdates(state) {
  App.contentUpdates = state || {};
  App.emit();
  const n = App.state ? App.state.instances.filter(i => hasContentUpdates(App.contentUpdates[i.id])).length : 0;
  if (!n || contentUpdatesToasted) return;
  contentUpdatesToasted = true;
  toast('Dostępne aktualizacje', `${n} ${plural(n, 'instancja ma', 'instancje mają', 'instancji ma')} nowe wersje modpacka lub modów – zobacz stronę główną.`, 'info', 6500);
}
