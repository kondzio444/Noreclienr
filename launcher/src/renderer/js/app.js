'use strict';
/* Application shell: state, navigation with sliding indicator, global events, onboarding. */

const App = {
  state: null,
  info: null,
  page: 'home',
  progress: null,
  logs: [],
  running: null,
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
  ],
  'nav-content': [
    { id: 'mods', label: 'Mody', icon: 'puzzle' },
    { id: 'resourcepacks', label: 'Paczki zasobów', icon: 'image' },
    { id: 'shaders', label: 'Shadery', icon: 'sun' },
    { id: 'datapacks', label: 'Datapacki', icon: 'database' },
  ],
  'nav-launcher': [
    { id: 'accounts', label: 'Konta', icon: 'users' },
    { id: 'settings', label: 'Ustawienia', icon: 'settings' },
    { id: 'console', label: 'Konsola', icon: 'terminal' },
  ],
};

function buildNav() {
  for (const [id, items] of Object.entries(NAV)) {
    const nav = document.getElementById(id);
    nav.innerHTML = '<span class="indicator"></span>' + items.map(it =>
      `<a data-page="${it.id}">${icon(it.icon)}<span>${it.label}</span><span class="badge" data-badge="${it.id}" hidden></span></a>`).join('');
    $$('a', nav).forEach(a => a.addEventListener('click', () => go(a.dataset.page)));
  }
}

function moveIndicator() {
  for (const id of Object.keys(NAV)) {
    const nav = document.getElementById(id);
    const ind = $('.indicator', nav);
    const active = $(`a[data-page="${App.page}"]`, nav);
    $$('a', nav).forEach(a => a.classList.toggle('active', a === active));
    if (active) {
      ind.style.opacity = 1;
      ind.style.transform = `translateY(${active.offsetTop}px)`;
    } else {
      ind.style.opacity = 0;
    }
  }
}

function renderBadges() {
  const b = $('[data-badge="instances"]');
  if (b && App.state) { b.textContent = App.state.instances.length; b.hidden = false; }
  const c = $('[data-badge="console"]');
  if (c) { c.hidden = !App.running; c.textContent = 'LIVE'; }
}

let cleanup = null;
let navigating = false;

async function go(page, opts) {
  if (navigating) return;
  const view = $('#view');
  const current = $('.page', view);
  App.page = page;
  moveIndicator();
  if (current) {
    navigating = true;
    current.classList.add('leaving');
    await new Promise(r => setTimeout(r, 160));
    navigating = false;
  }
  if (cleanup) { try { cleanup(); } catch { /* ignore */ } cleanup = null; }
  view.innerHTML = '';
  view.scrollTop = 0;
  const root = el('<div class="page"></div>');
  view.appendChild(root);
  $('#bg').classList.toggle('dim', page !== 'home');
  const fn = Pages[page] || Pages.home;
  cleanup = fn(root, opts || {}) || null;
}

function renderAccountChip() {
  const chip = $('#account-chip');
  const acc = App.account();
  chip.innerHTML = acc
    ? `${avatarHtml(acc)}<div class="meta"><b>${esc(acc.name)}</b><span>${acc.type === 'microsoft' ? '<span class="tag premium">PREMIUM</span>' : '<span class="tag offline">NON-PREMIUM</span>'}</span></div>`
    : `${avatarHtml(null)}<div class="meta"><b>Zaloguj się</b><span>Dodaj konto, aby grać</span></div>`;
}

// ------------------------------------------------------------------ launching (shared by pages)

async function launchSelected(instance) {
  const inst = instance || App.instance();
  if (!inst) return toast('Brak instancji', 'Utwórz instancję, aby zagrać.', 'error');
  if (!App.account()) {
    toast('Brak konta', 'Dodaj konto premium albo non-premium.', 'error');
    return go('accounts');
  }
  App.logs = [];
  try {
    App.progress = { stage: 'Przygotowywanie…' };
    App.emit();
    await nore.game.launch(inst.id);
    toast('Uruchamianie', `${inst.name} • ${inst.mcVersion}`, 'success');
  } catch (e) {
    App.progress = null;
    App.emit();
    errorToast(e, 'Nie udało się uruchomić gry');
  }
}

// ------------------------------------------------------------------ onboarding wizard ("installer" first-run experience)

function onboarding() {
  return new Promise((resolve) => {
    const wiz = el(`<div class="wizard"><div class="box"><div class="steps"><i></i><i></i><i></i><i></i></div><div class="content"></div></div></div>`);
    document.body.appendChild(wiz);
    const content = $('.content', wiz);
    let step = 0;
    let memory = Math.min(8192, Math.max(2048, Math.round(App.info.totalMemMb / 4 / 512) * 512));

    const render = () => {
      $$('.steps i', wiz).forEach((s, i) => s.classList.toggle('done', i <= step));
      if (step === 0) {
        content.innerHTML = `<div class="step" style="text-align:center">
          <img class="welcome-logo" src="assets/logo.png" alt="">
          <h2>Witaj w <span>Nore</span></h2>
          <p class="lead" style="margin:0 auto 26px">Launcher z własnym klientem PvP, przeglądarką modów, paczek zasobów,
          shaderów i datapacków. Skonfigurujmy wszystko w trzech krótkich krokach.</p>
          <button class="btn play" id="w-next">ZACZYNAMY ${icon('arrowRight')}</button></div>`;
        $('#w-next', content).onclick = () => { step = 1; render(); };
      } else if (step === 1) {
        content.innerHTML = `<div class="step">
          <h2>Twoje <span>konto</span></h2>
          <p class="lead">Zaloguj się kontem Microsoft (premium) albo graj bez premium, podając tylko nick.</p>
          <div class="login-options">
            <div class="card hover login-option ms" id="w-ms">
              <div class="ico"><div class="ms-grid"><i style="background:#f25022"></i><i style="background:#7fba00"></i><i style="background:#00a4ef"></i><i style="background:#ffb900"></i></div></div>
              <h3>Microsoft (premium)</h3><p>Pełny dostęp do serwerów online-mode, Twój skin i peleryna.</p></div>
            <div class="card hover login-option" id="w-off">
              <div class="ico" style="background:rgba(var(--accent-rgb),.15);color:var(--accent)">${icon('user')}</div>
              <h3>Non-premium</h3><p>Gra z dowolnym nickiem — singleplayer, LAN i serwery offline-mode.</p></div>
          </div>
          <div class="nav-row"><button class="btn ghost" id="w-back">${icon('arrowLeft')} Wstecz</button><button class="btn ghost" id="w-skip">Pomiń</button></div></div>`;
        $('#w-back', content).onclick = () => { step = 0; render(); };
        $('#w-skip', content).onclick = () => { step = 2; render(); };
        $('#w-off', content).onclick = () => offlineLoginModal(() => { step = 2; render(); });
        $('#w-ms', content).onclick = () => microsoftLoginModal(() => { step = 2; render(); });
      } else if (step === 2) {
        content.innerHTML = `<div class="step">
          <h2>Pamięć <span>RAM</span></h2>
          <p class="lead">Ile pamięci przydzielić grze? Dla Nore Client z modami polecamy 4–6 GB.
          Twój komputer ma ${(App.info.totalMemMb / 1024).toFixed(1)} GB.</p>
          <div class="row"><input type="range" class="slider" id="w-mem" min="1024" max="${Math.max(4096, App.info.totalMemMb - 1024)}" step="512" value="${memory}" style="width:100%"><div class="value-pill" id="w-memv"></div></div>
          <div class="nav-row"><button class="btn ghost" id="w-back">${icon('arrowLeft')} Wstecz</button><button class="btn" id="w-next">Dalej ${icon('arrowRight')}</button></div></div>`;
        const r = $('#w-mem', content);
        const upd = () => { memory = +r.value; $('#w-memv', content).textContent = (memory / 1024).toFixed(1) + ' GB'; sliderFill(r); };
        r.oninput = upd; upd();
        $('#w-back', content).onclick = () => { step = 1; render(); };
        $('#w-next', content).onclick = async () => { await nore.setSettings({ memoryMb: memory }); step = 3; render(); };
      } else {
        content.innerHTML = `<div class="step" style="text-align:center">
          <img class="welcome-logo" src="assets/logo.png" alt="">
          <h2>Wszystko <span>gotowe!</span></h2>
          <p class="lead" style="margin:0 auto 26px">Utworzyliśmy instancję <b>Nore Client 1.21.1</b> z Fabric.
          Pliki gry pobiorą się automatycznie przy pierwszym uruchomieniu.</p>
          <button class="btn play" id="w-done">${icon('play')} DO GRY</button></div>`;
        $('#w-done', content).onclick = async () => {
          await nore.onboardingDone();
          wiz.style.transition = 'opacity .4s'; wiz.style.opacity = 0;
          setTimeout(() => { wiz.remove(); resolve(); }, 400);
        };
      }
    };
    render();
  });
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
    if (!g.running && g.code != null && g.code !== 0) toast('Gra zakończyła się błędem', `Kod wyjścia ${g.code} — sprawdź konsolę.`, 'error', 7000);
    await App.refresh();
  });

  App.info = await nore.info();
  await App.refresh();
  document.body.classList.toggle('no-anim', !App.state.settings.animations);
  Embers.setEnabled(App.state.settings.animations);

  const online = navigator.onLine;
  $('#net-status').innerHTML = online ? '<span class="dot"></span><span>Online</span>' : '<span class="dot off"></span><span>Offline</span>';

  go('home');
  setTimeout(() => $('#splash').classList.add('hide'), 900);
  window.addEventListener('resize', moveIndicator);
  if (App.state.firstRun) {
    setTimeout(async () => { await onboarding(); await App.refresh(); go('home'); }, 1100);
  }
})();
