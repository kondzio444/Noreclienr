'use strict';
/* /panel – Nore Bot configuration panel (docs/bot-api.md).
   Discord login → guild picker (/api/v2/me) → editor whose forms are rendered ONLY from the bot schema
   (/api/v2/bot/config.schema.json: x-module tabs, x-ui hints, x-i18n labels from /panel/locales/<lang>.json).
   Saves with { config, version }: 409 = someone saved meanwhile, 400 = JSON-pointer errors mapped to fields.
   The action queue (config.actions.queue) shows each job's result from the bot's action_result events.
   Languages: Polish (default) and English. */
(() => {
  const N = window.Nore;
  if (!N) return;
  const { $, $$, esc } = N;
  const app = $('#app');

  // ------------------------------------------------------------------ chrome strings (the schema labels come from the locale files)
  const UI = {
    pl: {
      brand: 'Panel bota', loading: 'Wczytuję panel…', loginTitle: 'Panel Nore Bota', loginText: 'Zaloguj się przez Discord. Zobaczysz serwery, na których masz uprawnienie „Zarządzanie serwerem”.', login: 'Zaloguj przez Discord',
      loginDisabled: 'Logowanie jest chwilowo wyłączone na serwerze.', logout: 'Wyloguj', pickTitle: 'Wybierz serwer', pickText: 'Serwery, którymi możesz zarządzać. Bota dodasz jednym kliknięciem.', find: 'Szukaj serwera', open: 'Otwórz', invite: 'Dodaj bota', noPerm: 'Brak uprawnień', botHere: 'Nore Bot jest na serwerze', botMissing: 'Bota jeszcze nie ma', noGuilds: 'Nie masz serwerów, którymi możesz zarządzać.',
      modules: 'Moduły', server: 'Serwer', change: 'Zmień serwer', botSeen: 'Bot zgłosił się', botNever: 'Bot jeszcze się nie zgłosił', version: 'wersja', enabled: 'Moduł włączony',
      unsaved: (n) => `Masz ${n} ${N.plural(n, 'niezapisaną zmianę', 'niezapisane zmiany', 'niezapisanych zmian')}`, unsavedHint: 'Bot wczyta je w ciągu 15 sekund od zapisania.', undo: 'Cofnij', save: 'Zapisz', saving: 'Zapisuję…', saved: 'Zapisano', savedHint: (v) => `Wersja ${v}. Bot wczyta zmiany w ciągu 15 sekund.`,
      conflict: (who, v) => `${who || 'Ktoś'} zapisał(a) konfigurację w międzyczasie (wersja ${v}).`, conflictLoad: 'Wczytaj nową wersję', conflictKeep: 'Zapisz moje zmiany mimo to', invalid: (n) => `Konfiguracja ma błędy (${n}). Popraw zaznaczone pola.`,
      preview: 'Podgląd na Discordzie', previewHint: 'Kliknij pole z wiadomością, żeby zobaczyć podgląd.', today: 'dziś', recent: 'Ostatnio', noEvents: 'Jeszcze nic się nie wydarzyło.', notSet: '— nie ustawiono —', unknownCh: 'nieznany kanał', unknownRole: 'nieznana rola',
      add: 'Dodaj', addItem: 'Dodaj wpis', remove: 'Usuń', item: 'Wpis', emptyList: 'Pusta lista. Dodaj pierwszy wpis.', addRole: '+ Dodaj rolę', addChannel: '+ Dodaj kanał', addText: 'Wpisz i naciśnij Enter',
      vars: 'Wstaw zmienną kliknięciem.', newAction: 'Nowa akcja', queueHint: 'Akcja wykona się raz, po zapisaniu. Wynik pojawi się poniżej i w zdarzeniach.', aUnsaved: 'czeka na zapis', aQueued: 'w kolejce, bot jeszcze nie odpowiedział', aOk: 'wykonano', aFail: 'błąd',
      err401: 'Sesja wygasła. Zaloguj się ponownie.', err403: 'Nie masz uprawnienia „Zarządzanie serwerem” na tym serwerze.', err404bot: 'Nore Bota nie ma na tym serwerze.', errNet: 'Nie udało się połączyć z API. Spróbuj za chwilę.', retry: 'Spróbuj ponownie', back: 'Wróć do listy serwerów',
      loginErr: { cancelled: 'Logowanie zostało anulowane.', expired: 'Logowanie wygasło. Zacznij od nowa.', state: 'Coś poszło nie tak przy logowaniu. Zacznij od nowa.', token: 'Discord nie przyjął logowania. Spróbuj jeszcze raz.', scope: 'Potrzebujemy zgody na listę serwerów.', user: 'Nie udało się pobrać konta Discord.', code: 'Brak kodu logowania od Discorda.' },
      ev: { action_result: 'Akcja', panel_config_saved: 'Zapis w panelu', member_join: 'Nowa osoba', member_leave: 'Ktoś wyszedł', ticket_open: 'Ticket otwarty', mod_action: 'Moderacja', builder_finished: 'Kreator skończył', builder_start: 'Kreator ruszył', backup_create: 'Kopia zapasowa', suggestion_new: 'Nowa propozycja', application_new: 'Nowe podanie' },
      ago: (s) => N.ago(s),
    },
    en: {
      brand: 'Bot panel', loading: 'Loading the panel…', loginTitle: 'Nore Bot panel', loginText: 'Sign in with Discord. You will see the servers where you have the “Manage Server” permission.', login: 'Sign in with Discord',
      loginDisabled: 'Sign-in is temporarily disabled on the server.', logout: 'Sign out', pickTitle: 'Choose a server', pickText: 'Servers you can manage. Add the bot in one click.', find: 'Search servers', open: 'Open', invite: 'Add the bot', noPerm: 'No permission', botHere: 'Nore Bot is on the server', botMissing: 'The bot is not here yet', noGuilds: 'You have no servers you can manage.',
      modules: 'Modules', server: 'Server', change: 'Change server', botSeen: 'Bot reported', botNever: 'The bot has not reported yet', version: 'version', enabled: 'Module enabled',
      unsaved: (n) => `You have ${n} unsaved change${n === 1 ? '' : 's'}`, unsavedHint: 'The bot loads them within 15 seconds of saving.', undo: 'Undo', save: 'Save', saving: 'Saving…', saved: 'Saved', savedHint: (v) => `Version ${v}. The bot loads the changes within 15 seconds.`,
      conflict: (who, v) => `${who || 'Someone'} saved the configuration in the meantime (version ${v}).`, conflictLoad: 'Load the new version', conflictKeep: 'Save my changes anyway', invalid: (n) => `The configuration has ${n} error${n === 1 ? '' : 's'}. Fix the marked fields.`,
      preview: 'Discord preview', previewHint: 'Click a message field to see a preview.', today: 'today', recent: 'Recent', noEvents: 'Nothing has happened yet.', notSet: '— not set —', unknownCh: 'unknown channel', unknownRole: 'unknown role',
      add: 'Add', addItem: 'Add entry', remove: 'Remove', item: 'Entry', emptyList: 'Empty list. Add the first entry.', addRole: '+ Add role', addChannel: '+ Add channel', addText: 'Type and press Enter',
      vars: 'Click to insert a variable.', newAction: 'New action', queueHint: 'An action runs once, after saving. Its result appears below and in the events.', aUnsaved: 'waiting for save', aQueued: 'queued, no answer from the bot yet', aOk: 'done', aFail: 'error',
      err401: 'Your session expired. Please sign in again.', err403: 'You do not have the “Manage Server” permission on this server.', err404bot: 'Nore Bot is not on this server.', errNet: 'Could not reach the API. Try again in a moment.', retry: 'Try again', back: 'Back to the server list',
      loginErr: { cancelled: 'Sign-in was cancelled.', expired: 'Sign-in expired. Start again.', state: 'Something went wrong while signing in. Start again.', token: 'Discord did not accept the sign-in. Try again.', scope: 'We need permission to see your server list.', user: 'Could not load your Discord account.', code: 'Discord sent no sign-in code.' },
      ev: { action_result: 'Action', panel_config_saved: 'Saved in the panel', member_join: 'New member', member_leave: 'Member left', ticket_open: 'Ticket opened', mod_action: 'Moderation', builder_finished: 'Builder finished', builder_start: 'Builder started', backup_create: 'Backup', suggestion_new: 'New suggestion', application_new: 'New application' },
      ago: (iso) => { const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000); return s < 60 ? 'just now' : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86400)} d ago`; },
    },
  };
  const LANGS = ['pl', 'en'];
  let lang = (() => { try { const l = localStorage.getItem('nore-panel-lang'); if (LANGS.includes(l)) return l; } catch { /* storage off */ } return /^en\b/i.test(navigator.language || '') ? 'en' : 'pl'; })();
  const u = (k, ...a) => { const v = UI[lang][k] ?? UI.pl[k]; return typeof v === 'function' ? v(...a) : v; };
  const locales = {};
  async function loadLocale(l) {
    if (locales[l]) return locales[l];
    try { const r = await fetch(`/panel/locales/${l}.json`); locales[l] = r.ok ? await r.json() : {}; } catch { locales[l] = {}; }
    return locales[l];
  }
  const dig = (obj, key) => String(key || '').split('.').reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), obj);
  const humanize = (k) => String(k).replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').replace(/^./, (c) => c.toUpperCase());
  function tr(key, fallback) {
    if (!key) return fallback;
    for (const l of [lang, 'pl', 'en']) {
      let v = dig(locales[l], key);
      if (v && typeof v === 'object') v = v._label;
      if (typeof v === 'string' && v) return v;
    }
    return fallback;
  }

  // ------------------------------------------------------------------ API (session routes send the cookie; same origin)
  async function call(method, path, body) {
    let r;
    try {
      r = await fetch(`/api/v2/${path}`, { method, credentials: 'same-origin', headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    } catch { throw Object.assign(new Error(u('errNet')), { status: 0 }); }
    const j = await r.json().catch(() => null);
    if (!r.ok || !j || j.ok === false) throw Object.assign(new Error((j && j.error) || `HTTP ${r.status}`), { status: r.status, body: j || {} });
    return j;
  }

  // ------------------------------------------------------------------ JSON pointers and values
  const escPtr = (k) => String(k).replace(/~/g, '~0').replace(/\//g, '~1');
  const ptrJoin = (base, k) => `${base}/${escPtr(k)}`;
  const ptrParts = (p) => p.split('/').slice(1).map((s) => s.replace(/~1/g, '/').replace(/~0/g, '~'));
  function getAt(obj, p) { return ptrParts(p).reduce((o, k) => (o == null ? undefined : o[k]), obj); }
  function setAt(obj, p, v) {
    const parts = ptrParts(p); let o = obj;
    for (let i = 0; i < parts.length - 1; i++) { if (o[parts[i]] == null) o[parts[i]] = /^\d+$/.test(parts[i + 1]) ? [] : {}; o = o[parts[i]]; }
    o[parts[parts.length - 1]] = v;
  }
  const clone = (v) => JSON.parse(JSON.stringify(v));
  function changes(a, b, p = '', out = []) {
    if (a === b) return out;
    if (a && b && typeof a === 'object' && typeof b === 'object' && Array.isArray(a) === Array.isArray(b)) {
      if (Array.isArray(a) && a.length !== b.length) { out.push(p); return out; }
      for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) changes(a[k], b[k], ptrJoin(p, k), out);
      return out;
    }
    if (JSON.stringify(a) !== JSON.stringify(b)) out.push(p);
    return out;
  }
  function deref(s, root, depth = 0) {
    if (!s || !s.$ref || depth > 8) return s || {};
    const t = s.$ref.replace(/^#\//, '').split('/').reduce((o, k) => (o ? o[k] : undefined), root);
    return deref({ ...t, ...Object.fromEntries(Object.entries(s).filter(([k]) => k !== '$ref')) }, root, depth + 1);
  }
  function defaultOf(s0) {
    const s = deref(s0, schema);
    if (s.default !== undefined) return clone(s.default);
    if (s.type === 'object') { const o = {}; for (const [k, v] of Object.entries(s.properties || {})) o[k] = defaultOf(v); return o; }
    if (s.type === 'array') return [];
    if (s.type === 'boolean') return false;
    if (s.type === 'integer' || s.type === 'number') return s.minimum ?? 0;
    if (s.enum) return s.enum[0];
    return '';
  }

  // ------------------------------------------------------------------ state
  let schema = null, me = null, guild = null, original = null, config = null, version = 0, current = '', errors = new Map(), focusPreview = null, pollTimer = 0;
  const route = () => { const m = location.pathname.match(/^\/panel\/(\d{17,20})\/?$/); return m ? m[1] : null; };
  const go = (path, replace) => { if (location.pathname !== path) history[replace ? 'replaceState' : 'pushState']({}, '', path); render(); };
  addEventListener('popstate', () => render());

  // ------------------------------------------------------------------ header: language switch + user
  function paintChrome() {
    document.documentElement.lang = lang;
    for (const el of $$('[data-t]')) el.textContent = u(el.dataset.t);
    for (const b of $$('.lang button')) b.setAttribute('aria-pressed', b.dataset.lang === lang);
    const box = $('#user');
    if (me) {
      const name = me.user.globalName || me.user.username;
      box.innerHTML = `${me.user.avatarUrl ? `<img src="${esc(me.user.avatarUrl)}" alt="">` : ''}<span>${esc(name)}</span><button type="button" id="logout">${esc(u('logout'))}</button>`;
      box.hidden = false;
      $('#logout').addEventListener('click', async () => { try { await call('POST', 'auth/logout'); } catch { /* already gone */ } me = null; box.hidden = true; go('/panel'); });
      fixIcons(box);
    } else box.hidden = true;
  }
  for (const b of $$('.lang button')) b.addEventListener('click', async () => {
    lang = b.dataset.lang;
    try { localStorage.setItem('nore-panel-lang', lang); } catch { /* storage off */ }
    await loadLocale(lang);
    paintChrome();
    if (guild && config) paintEditor(); else render();
  });

  // ------------------------------------------------------------------ screens
  // a Discord icon that fails to load falls back to the initials sticker
  function fixIcons(root) {
    for (const img of $$('.gi img, .user img', root)) img.addEventListener('error', () => { const box = img.parentElement; if (box.classList.contains('gi')) box.textContent = (box.closest('[data-name]')?.dataset.name || '?').slice(0, 2).toUpperCase(); else img.remove(); }, { once: true });
  }
  function screen(html) { app.innerHTML = html; N.entrances(app); fixIcons(app); }
  function showError(e, { backToList = true } = {}) {
    const text = e.status === 401 ? u('err401') : e.status === 403 ? u('err403') : e.status === 404 && e.body.code === 'bot_not_present' ? u('err404bot') : e.message || u('errNet');
    screen(`<section class="center"><h1>${esc(text)}</h1>${e.body && e.body.inviteUrl ? `<a class="pill" href="${esc(e.body.inviteUrl)}">${esc(u('invite'))}</a>` : ''}<div class="chips"><button type="button" class="btn" id="retry">${esc(u('retry'))}</button>${backToList ? `<a class="btn" href="/panel" id="back">${esc(u('back'))}</a>` : ''}</div></section>`);
    $('#retry').addEventListener('click', () => render());
    const b = $('#back'); if (b) b.addEventListener('click', (ev) => { ev.preventDefault(); go('/panel'); });
  }
  function showLogin(disabled) {
    const q = new URLSearchParams(location.search);
    const code = q.get('login');
    const msg = code ? (u('loginErr')[code] || u('loginErr').state) : '';
    const next = location.pathname.startsWith('/panel') ? location.pathname : '/panel';
    screen(`<section class="center"><div class="login rv rv-stick"><img src="/assets/album/logo-sticker-256.png" alt="" width="88" height="88"><h1>${esc(u('loginTitle'))}</h1><p>${esc(u('loginText'))}</p>
      ${disabled ? `<p class="err-line"><i class="dot error"></i>${esc(u('loginDisabled'))}</p>` : `<a class="pill lg" href="/api/v2/auth/discord/login?next=${encodeURIComponent(next)}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/></svg>${esc(u('login'))}</a>`}
      ${msg ? `<p class="err-line"><i class="dot error"></i>${esc(msg)}</p>` : ''}</div></section>`);
  }
  const initials = (name) => esc(String(name || '?').split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase());
  function showPicker() {
    const list = me.guilds;
    screen(`<section class="picker"><h1 class="rv">${esc(u('pickTitle'))}</h1><p class="rv">${esc(u('pickText'))}</p>
      <label class="sr" for="find">${esc(u('find'))}</label><input class="find rv" id="find" type="search" placeholder="${esc(u('find'))}" autocomplete="off">
      <ul class="guilds rv" id="guilds"></ul></section>`);
    const paint = (f = '') => {
      const items = list.filter((g) => g.name.toLowerCase().includes(f.toLowerCase()));
      $('#guilds').innerHTML = items.length ? items.map((g) => {
        const icon = `<span class="gi">${g.iconUrl ? `<img src="${esc(g.iconUrl)}" alt="">` : initials(g.name)}</span>`;
        if (!g.manageable) return `<li class="g off" data-name="${esc(g.name)}">${icon}<div><b>${esc(g.name)}</b><small><i class="dot sm off"></i>${esc(u('noPerm'))}</small></div></li>`;
        if (!g.botPresent) return `<li class="g" data-name="${esc(g.name)}">${icon}<div><b>${esc(g.name)}</b><small><i class="dot sm wait"></i>${esc(u('botMissing'))}</small></div>${g.inviteUrl ? `<a class="pill sm quiet" href="${esc(g.inviteUrl)}">${esc(u('invite'))}</a>` : ''}</li>`;
        return `<li><a class="g" href="/panel/${esc(g.id)}" data-gid="${esc(g.id)}" data-name="${esc(g.name)}">${icon}<div><b>${esc(g.name)}</b><small><i class="dot sm ready"></i>${esc(u('botHere'))}</small></div><span class="pill sm">${esc(u('open'))}</span></a></li>`;
      }).join('') : `<li class="empty">${esc(u('noGuilds'))}</li>`;
      fixIcons($('#guilds'));
    };
    paint();
    $('#find').addEventListener('input', (e) => paint(e.target.value));
    $('#guilds').addEventListener('click', (e) => { const a = e.target.closest('a[data-gid]'); if (a) { e.preventDefault(); go(`/panel/${a.dataset.gid}`); } });
  }

  async function render() {
    clearTimeout(pollTimer);
    await loadLocale(lang);
    paintChrome();
    try {
      if (!schema) schema = await fetch('/api/v2/bot/config.schema.json').then((r) => r.json());
      if (!me) me = await call('GET', 'me');
    } catch (e) {
      if (e.status === 401) { me = null; paintChrome(); return showLogin(false); }
      if (e.status === 503) return showLogin(true);
      return showError(e, { backToList: false });
    }
    paintChrome();
    const gid = route();
    if (!gid) return showPicker();
    screen(`<section class="center"><img class="spin" src="/assets/album/logo-sticker-256.png" alt="" width="96" height="96"><p>${esc(u('loading'))}</p></section>`);
    try {
      guild = await call('GET', `panel/guilds/${gid}`);
    } catch (e) {
      if (e.status === 401) { me = null; paintChrome(); return showLogin(false); }
      return showError(e);
    }
    original = clone(guild.config); config = clone(guild.config); version = guild.version; errors = new Map();
    const mods = modules();
    if (!mods.some(([k]) => k === current)) current = (location.hash.slice(1) && mods.some(([k]) => k === location.hash.slice(1))) ? location.hash.slice(1) : mods[0][0];
    paintEditor();
    schedulePoll();
  }

  // ------------------------------------------------------------------ the editor
  const modules = () => Object.entries(schema.properties || {}).filter(([, s]) => deref(s, schema).type === 'object');
  function moduleDot(key) {
    const v = config[key];
    const errs = [...errors.keys()].filter((p) => p === `/${key}` || p.startsWith(`/${key}/`)).length;
    if (errs) return `<span class="cnt">${errs}</span>`;
    if (v && typeof v.enabled === 'boolean') return `<i class="dot sm ${v.enabled ? 'ready' : 'off'}"></i>`;
    return '';
  }
  function paintEditor() {
    const mods = modules();
    const metaAge = guild.metaAt ? (Date.now() - Date.parse(guild.metaAt)) / 1000 : null;
    const botDot = metaAge == null ? 'off' : metaAge < 20 * 60 ? 'ready' : 'wait';
    const g = guild.guild;
    app.innerHTML = `<div class="app">
      <aside class="rail">
        <div class="guild" data-name="${esc(g.name)}"><span class="gi">${g.iconUrl ? `<img src="${esc(g.iconUrl)}" alt="">` : initials(g.name)}</span><div><b>${esc(g.name)}</b><small><i class="dot sm ${botDot}"></i>${esc(metaAge == null ? u('botNever') : `${u('botSeen')} ${u('ago', guild.metaAt)}`)} · ${esc(u('version'))} ${version}</small></div></div>
        <nav aria-label="${esc(u('modules'))}"><p class="grp">${esc(u('modules'))}</p>
          ${mods.map(([k, s]) => `<a class="tab" href="#${esc(k)}" data-mod="${esc(k)}"${k === current ? ' aria-current="page"' : ''}>${esc(tr(deref(s, schema)['x-i18n'], humanize(k)))}${moduleDot(k)}</a>`).join('')}
          <p class="grp">${esc(u('server'))}</p><a class="tab" href="/panel" id="change">${esc(u('change'))}</a>
        </nav>
      </aside>
      <section class="main" id="main"></section>
    </div>
    <div class="save" id="save" hidden></div>`;
    $('nav', app).addEventListener('click', (e) => {
      const a = e.target.closest('a'); if (!a) return;
      e.preventDefault();
      if (a.id === 'change') { go('/panel'); return; }
      current = a.dataset.mod; history.replaceState({}, '', `${location.pathname}#${current}`);
      for (const t of $$('.tab[data-mod]')) { if (t === a) t.setAttribute('aria-current', 'page'); else t.removeAttribute('aria-current'); }
      paintModule(); window.scrollTo({ top: 0 });
    });
    paintModule();
    paintSave();
    fixIcons(app);
  }
  function refreshTabs() { for (const t of $$('.tab[data-mod]')) { const k = t.dataset.mod; const old = $('.dot, .cnt', t); if (old) old.remove(); t.insertAdjacentHTML('beforeend', moduleDot(k)); } }

  function paintModule() {
    const s = deref(schema.properties[current], schema);
    const ptr = `/${escPtr(current)}`;
    const value = config[current] || {};
    const props = s.properties || {};
    const hasEnabled = props.enabled && deref(props.enabled, schema).type === 'boolean';
    const body = Object.entries(props).filter(([k]) => !(hasEnabled && k === 'enabled')).map(([k, ps]) => field(ptrJoin(ptr, k), k, ps, value[k])).join('');
    const isActions = current === 'actions';
    $('#main').innerHTML = `
      <div class="head"><div><h1>${esc(tr(s['x-i18n'], humanize(current)))}</h1>${s['x-i18n-help'] ? `<p>${esc(tr(s['x-i18n-help'], ''))}</p>` : ''}</div>
        ${hasEnabled ? `<button type="button" class="switch" role="switch" aria-checked="${!!value.enabled}" aria-label="${esc(u('enabled'))}" data-ptr="${ptr}/enabled" data-kind="toggle"></button>` : ''}</div>
      ${errAt(`${ptr}/enabled`)}
      <div class="cols"><form class="form" id="form" novalidate>${body}</form>
        <aside class="side">
          ${isActions ? `<div class="quick"><button type="button" class="btn" id="new-action">+ ${esc(u('newAction'))}</button><p>${esc(u('queueHint'))}</p></div>` : ''}
          ${body.includes('data-kind="textarea"') ? `<h3>${esc(u('preview'))}</h3><div class="discord" id="dprev" data-ui><span class="soft">${esc(u('previewHint'))}</span></div>` : ''}
          <h3>${esc(u('recent'))}</h3><ul class="events" id="events"></ul>
        </aside></div>`;
    const form = $('#form');
    form.addEventListener('submit', (e) => e.preventDefault());
    $('#main').addEventListener('input', onInput);
    $('#main').addEventListener('change', onInput);
    $('#main').addEventListener('click', onClick);
    $('#main').addEventListener('keydown', onKey);
    $('#main').addEventListener('focusin', (e) => { const t = e.target.closest('[data-kind="textarea"], [data-kind="text"]'); if (t) { focusPreview = t.dataset.ptr; preview(); } });
    const na = $('#new-action'); if (na) na.addEventListener('click', newAction);
    paintEvents();
    if (!focusPreview || !focusPreview.startsWith(`${ptr}/`)) { const t = $('#form [data-kind="textarea"]'); focusPreview = t ? t.dataset.ptr : null; }
    if (focusPreview) preview();
  }

  // a field from its schema; the x-ui hint picks the control
  function field(ptr, key, s0, value) {
    const s = deref(s0, schema);
    const label = esc(tr(s['x-i18n'], humanize(key)));
    const help = s['x-i18n-help'] ? `<span class="help">${esc(tr(s['x-i18n-help'], ''))}</span>` : '';
    const ui = s['x-ui'] || (s.type === 'boolean' ? 'toggle' : s.type === 'object' ? 'object' : s.type === 'array' ? 'list' : s.enum ? 'select' : (s.type === 'integer' || s.type === 'number') ? 'number' : 'text');
    const id = `f${ptr.replace(/[^a-z0-9]/gi, '_')}`;
    if (s.type === 'object' && ui !== 'list') return objectGroup(ptr, key, s, value || {});
    switch (ui) {
      case 'toggle':
        return `<div class="row"><div><span class="lbl" id="${id}-l">${label}</span>${help}</div><button type="button" class="switch" role="switch" aria-checked="${!!value}" aria-labelledby="${id}-l" data-ptr="${ptr}" data-kind="toggle"></button></div>${errAt(ptr)}`;
      case 'textarea':
        return `<div class="f"><label class="lbl" for="${id}">${label}</label>${help}<textarea class="area${errors.has(ptr) ? ' bad' : ''}" id="${id}" data-ptr="${ptr}" data-kind="textarea"${s.maxLength ? ` maxlength="${s.maxLength}"` : ''}>${esc(value ?? '')}</textarea>${varChips(s, ptr)}${errAt(ptr)}</div>`;
      case 'number':
        return `<div class="f"><label class="lbl" for="${id}">${label}</label>${help}<input class="inp${errors.has(ptr) ? ' bad' : ''}" id="${id}" type="number" inputmode="${s.type === 'integer' ? 'numeric' : 'decimal'}" data-ptr="${ptr}" data-kind="number" data-int="${s.type === 'integer'}" value="${esc(value ?? '')}"${s.minimum != null ? ` min="${s.minimum}"` : ''}${s.maximum != null ? ` max="${s.maximum}"` : ''} step="${s.type === 'integer' ? 1 : 'any'}">${errAt(ptr)}</div>`;
      case 'select':
        return `<div class="f"><label class="lbl" for="${id}">${label}</label>${help}<div class="sel-wrap"><select class="inp${errors.has(ptr) ? ' bad' : ''}" id="${id}" data-ptr="${ptr}" data-kind="select" data-type="${s.type}">${(s.enum || []).map((e) => `<option value="${esc(e)}"${String(e) === String(value) ? ' selected' : ''}>${esc(optLabel(s, e))}</option>`).join('')}</select></div>${errAt(ptr)}</div>`;
      case 'color':
        return `<div class="f"><span class="lbl" id="${id}-l">${label}</span>${help}${colorPicker(ptr, value, id)}${errAt(ptr)}</div>`;
      case 'channel':
        return `<div class="f"><label class="lbl" for="${id}">${label}</label>${help}<div class="sel-wrap"><select class="inp${errors.has(ptr) ? ' bad' : ''}" id="${id}" data-ptr="${ptr}" data-kind="select">${channelOptions(s['x-channel-types'], value, true)}</select></div>${errAt(ptr)}</div>`;
      case 'role':
        return `<div class="f"><label class="lbl" for="${id}">${label}</label>${help}<div class="sel-wrap"><select class="inp${errors.has(ptr) ? ' bad' : ''}" id="${id}" data-ptr="${ptr}" data-kind="select">${roleOptions(value, true)}</select></div>${errAt(ptr)}</div>`;
      case 'list':
        return listField(ptr, key, s, Array.isArray(value) ? value : [], label, help, id);
      default:
        return `<div class="f"><label class="lbl" for="${id}">${label}</label>${help}<input class="inp${errors.has(ptr) ? ' bad' : ''}" id="${id}" data-ptr="${ptr}" data-kind="text" value="${esc(value ?? '')}"${s.maxLength ? ` maxlength="${s.maxLength}"` : ''} autocomplete="off" spellcheck="false">${errAt(ptr)}</div>`;
    }
  }
  function objectGroup(ptr, key, s, value) {
    const props = s.properties || {};
    const hasEnabled = props.enabled && deref(props.enabled, schema).type === 'boolean';
    const id = `g${ptr.replace(/[^a-z0-9]/gi, '_')}`;
    return `<fieldset class="group${hasEnabled && !value.enabled ? ' off' : ''}" data-group="${ptr}"><legend><span id="${id}">${esc(tr(s['x-i18n'], humanize(key)))}</span>${hasEnabled ? `<button type="button" class="switch" role="switch" aria-checked="${!!value.enabled}" aria-labelledby="${id}" data-ptr="${ptr}/enabled" data-kind="toggle"></button>` : ''}</legend>
      ${s['x-i18n-help'] ? `<p class="help soft">${esc(tr(s['x-i18n-help'], ''))}</p>` : ''}
      ${Object.entries(props).filter(([k]) => !(hasEnabled && k === 'enabled')).map(([k, ps]) => field(ptrJoin(ptr, k), k, ps, value[k])).join('')}${errAt(ptr)}</fieldset>`;
  }
  const optLabel = (s, e) => (s['x-i18n-options'] && s['x-i18n-options'][e] ? tr(s['x-i18n-options'][e], String(e)) : e === '' ? u('notSet') : String(e));

  // channels and roles come from the bot's report (meta); channel type is a string (text, voice, category …) or a Discord number
  const CH_NUM = { 0: 'text', 2: 'voice', 4: 'category', 5: 'announcement', 13: 'stage', 15: 'forum', 16: 'media' };
  const chType = (c) => (typeof c.type === 'number' ? CH_NUM[c.type] || String(c.type) : String(c.type || 'text'));
  function channelOptions(types, value, withEmpty, exclude = []) {
    const chans = (guild.meta && guild.meta.channels) || [];
    const ok = (c) => !types || !types.length || types.includes(chType(c));
    const cats = new Map(chans.filter((c) => chType(c) === 'category').map((c) => [c.id, c]));
    const groups = new Map();
    for (const c of chans.filter(ok).filter((c) => !exclude.includes(c.id))) {
      const key = chType(c) === 'category' ? '' : c.parentId || '';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(c);
    }
    let html = withEmpty ? `<option value="">${esc(u('notSet'))}</option>` : '';
    const opt = (c) => `<option value="${esc(c.id)}"${c.id === value ? ' selected' : ''}>${esc(chType(c) === 'category' ? c.name.toUpperCase() : `${chType(c) === 'voice' || chType(c) === 'stage' ? '' : '#'}${c.name}`)}${chType(c) !== 'text' && chType(c) !== 'category' ? ` (${esc(chType(c))})` : ''}</option>`;
    for (const [k, list] of groups) {
      list.sort((a, b) => (a.position ?? 0) - (b.position ?? 0) || a.name.localeCompare(b.name));
      html += k && cats.has(k) ? `<optgroup label="${esc(cats.get(k).name)}">${list.map(opt).join('')}</optgroup>` : list.map(opt).join('');
    }
    if (value && !chans.some((c) => c.id === value)) html += `<option value="${esc(value)}" selected>${esc(u('unknownCh'))} (${esc(value)})</option>`;
    return html;
  }
  function roleOptions(value, withEmpty, exclude = []) {
    const roles = ((guild.meta && guild.meta.roles) || []).filter((r) => !r.managed && r.id !== guild.guild.id && !exclude.includes(r.id)).sort((a, b) => (b.position ?? 0) - (a.position ?? 0));
    let html = withEmpty ? `<option value="">${esc(u('notSet'))}</option>` : '';
    html += roles.map((r) => `<option value="${esc(r.id)}"${r.id === value ? ' selected' : ''}>@${esc(r.name)}</option>`).join('');
    if (value && !roles.some((r) => r.id === value)) html += `<option value="${esc(value)}" selected>${esc(u('unknownRole'))} (${esc(value)})</option>`;
    return html;
  }
  const roleById = (id) => ((guild.meta && guild.meta.roles) || []).find((r) => r.id === id);
  const chanById = (id) => ((guild.meta && guild.meta.channels) || []).find((c) => c.id === id);
  const roleColor = (r) => (r && r.color ? `#${Number(r.color).toString(16).padStart(6, '0')}` : 'var(--nore-dot-off)');

  const SWATCHES = ['#9d5cff', '#4aa3ff', '#3fd27f', '#ffd23a', '#ff8a1f', '#ff5a4f', '#f3efe9'];
  function colorPicker(ptr, value, id) {
    const v = /^#[0-9a-f]{6}$/i.test(value || '') ? value.toLowerCase() : '#9d5cff';
    return `<div class="sw" role="group" aria-labelledby="${id}-l">${SWATCHES.map((c) => `<button type="button" style="--c:${c}" data-ptr="${ptr}" data-kind="swatch" data-color="${c}" aria-pressed="${c === v}" aria-label="${c}"></button>`).join('')}<input type="color" value="${v}" data-ptr="${ptr}" data-kind="color" aria-label="${esc(u('add'))} ${v}"><code>${esc(v)}</code></div>`;
  }
  function varChips(s, ptr) {
    const help = tr(s['x-i18n-help'], '') + ' ' + tr('panel.common.template_help', '');
    const vars = [...new Set(help.match(/\{[a-zA-Z_.]+\}/g) || [])];
    if (!vars.length) return '';
    return `<div class="vars" aria-label="${esc(u('vars'))}">${vars.map((v) => `<button type="button" class="var" data-ptr="${ptr}" data-insert="${esc(v)}">${esc(v)}</button>`).join('')}</div>`;
  }

  // lists: primitives as chips (roles, channels, words), objects as repeatable sheets
  function listField(ptr, key, s, arr, label, help, id) {
    const it = deref(s.items || {}, schema);
    const max = s.maxItems ?? Infinity;
    if (it.type === 'object') {
      const isQueue = ptr === '/actions/queue';
      const items = arr.map((v, i) => `<div class="item" data-item="${ptrJoin(ptr, i)}">
          <div class="item-head"><span>${esc(itemTitle(it, v, i))}</span>${isQueue ? actionState(v) : ''}<button type="button" class="btn sm danger rm" data-remove="${ptrJoin(ptr, i)}">${esc(u('remove'))}</button></div>
          ${Object.entries(it.properties || {}).map(([k, ps]) => field(ptrJoin(ptrJoin(ptr, i), k), k, ps, (v || {})[k])).join('')}
        </div>`).join('');
      return `<fieldset class="group" data-group="${ptr}"><legend><span>${label}</span></legend>${help ? `<p class="help soft">${help.replace(/^<span class="help">|<\/span>$/g, '')}</p>` : ''}
        <div class="items">${items || `<p class="empty">${esc(u('emptyList'))}</p>`}</div>
        <button type="button" class="btn" data-add="${ptr}"${arr.length >= max ? ' disabled' : ''}>+ ${esc(u('addItem'))}</button>${errAt(ptr)}</fieldset>`;
    }
    const kind = it['x-ui'] || 'text';
    const chips = arr.map((v, i) => {
      let text = String(v), dot = '';
      if (kind === 'role') { const r = roleById(v); text = r ? `@${r.name}` : `${u('unknownRole')} (${v})`; dot = `<i class="dot sm" style="--c:${roleColor(r)}"></i>`; }
      if (kind === 'channel') { const c = chanById(v); text = c ? `#${c.name}` : `${u('unknownCh')} (${v})`; }
      return `<span class="chip">${dot}${esc(text)}<button type="button" data-remove="${ptrJoin(ptr, i)}" aria-label="${esc(u('remove'))} ${esc(text)}">×</button></span>`;
    }).join('');
    let adder = '';
    if (arr.length < max) {
      if (kind === 'role') adder = `<span class="chip add"><select data-addsel="${ptr}" aria-label="${esc(u('addRole'))}"><option value="">${esc(u('addRole'))}</option>${roleOptions('', false, arr)}</select></span>`;
      else if (kind === 'channel') adder = `<span class="chip add"><select data-addsel="${ptr}" aria-label="${esc(u('addChannel'))}"><option value="">${esc(u('addChannel'))}</option>${channelOptions(it['x-channel-types'], '', false, arr)}</select></span>`;
      else adder = `<span class="chip add"><input data-addtext="${ptr}" data-type="${it.type}" placeholder="${esc(u('addText'))}" aria-label="${label}"${it.maxLength ? ` maxlength="${it.maxLength}"` : ''}></span>`;
    }
    return `<div class="f" data-group="${ptr}"><span class="lbl" id="${id}-l">${label}</span>${help}<div class="chips" role="group" aria-labelledby="${id}-l">${chips}${adder}</div>${errAt(ptr)}</div>`;
  }
  function itemTitle(it, v, i) {
    for (const k of ['name', 'title', 'label', 'trigger', 'login', 'username', 'address', 'repo', 'rank', 'type', 'id']) {
      if (v && v[k] != null && v[k] !== '') { const ps = deref((it.properties || {})[k], schema); return ps.enum ? optLabel(ps, v[k]) : String(v[k]); }
    }
    return `${u('item')} ${i + 1}`;
  }

  // the action queue: state of each job from the bot's action_result events
  function actionState(a) {
    if (!a || !a.id) return '';
    const saved = ((original.actions && original.actions.queue) || []).some((x) => x.id === a.id);
    if (!saved) return `<span class="state"><i class="dot sm wait"></i>${esc(u('aUnsaved'))}</span>`;
    const ev = (guild.events || []).find((e) => e.type === 'action_result' && e.data && e.data.id === a.id);
    if (!ev) return `<span class="state"><i class="dot sm info"></i>${esc(u('aQueued'))}</span>`;
    return ev.data.ok ? `<span class="state"><i class="dot sm ready"></i>${esc(u('aOk'))} · ${esc(u('ago', ev.at))}</span>` : `<span class="state"><i class="dot sm error"></i>${esc(u('aFail'))}: ${esc(ev.data.error || '')}</span>`;
  }
  function newAction() {
    const s = deref(schema.properties.actions, schema);
    const qs = deref(s.properties.queue, schema);
    const item = defaultOf(qs.items);
    item.id = `p${Date.now().toString(36)}`;
    const list = (config.actions && config.actions.queue) || [];
    if (qs.maxItems && list.length >= qs.maxItems) list.shift(); // the oldest (already run) job makes room
    list.push(item);
    setAt(config, '/actions/queue', list);
    changed(true);
  }

  // ------------------------------------------------------------------ editing
  function parseVal(el) {
    if (el.dataset.kind === 'number') { if (el.value === '') return null; const n = Number(el.value); return el.dataset.int === 'true' ? Math.trunc(n) : n; }
    if (el.dataset.kind === 'select' && (el.dataset.type === 'integer' || el.dataset.type === 'number')) return Number(el.value);
    return el.value;
  }
  function onInput(e) {
    const el = e.target;
    if (el.dataset.kind === 'color' && e.type === 'input') { setAt(config, el.dataset.ptr, el.value); clearErr(el.dataset.ptr); const sw = el.closest('.sw'); for (const b of $$('button', sw)) b.setAttribute('aria-pressed', b.dataset.color === el.value); $('code', sw).textContent = el.value; changed(); preview(); return; }
    if (el.dataset.addsel && e.type === 'change' && el.value) { const p = el.dataset.addsel; const arr = getAt(config, p) || []; arr.push(el.value); setAt(config, p, arr); changed(true); return; }
    if (!el.dataset.ptr || !['text', 'textarea', 'number', 'select'].includes(el.dataset.kind)) return;
    if (e.type === 'change' && el.dataset.kind !== 'select') return;
    const v = parseVal(el);
    if (v === null) return;
    setAt(config, el.dataset.ptr, v);
    clearErr(el.dataset.ptr);
    const titled = el.closest('.item') && /\/(name|title|label|id|trigger|login|username|address|repo|rank|type)$/.test(el.dataset.ptr);
    changed(titled && e.type === 'change');
    if (focusPreview === el.dataset.ptr) preview();
  }
  function onKey(e) {
    const el = e.target;
    if (el.dataset.addtext && e.key === 'Enter') {
      e.preventDefault();
      const v = el.value.trim(); if (!v) return;
      const p = el.dataset.addtext; const arr = getAt(config, p) || [];
      arr.push(el.dataset.type === 'integer' || el.dataset.type === 'number' ? Number(v) : v);
      setAt(config, p, arr); changed(true);
      const again = $(`[data-addtext="${CSS.escape(p)}"]`); if (again) again.focus();
    }
  }
  function onClick(e) {
    const t = e.target.closest('button'); if (!t) return;
    if (t.dataset.kind === 'toggle') {
      const v = t.getAttribute('aria-checked') !== 'true';
      t.setAttribute('aria-checked', v);
      setAt(config, t.dataset.ptr, v); clearErr(t.dataset.ptr);
      const grp = t.closest('fieldset.group'); if (grp && t.closest('legend')) grp.classList.toggle('off', !v);
      changed(); refreshTabs(); return;
    }
    if (t.dataset.kind === 'swatch') {
      setAt(config, t.dataset.ptr, t.dataset.color); clearErr(t.dataset.ptr);
      const sw = t.closest('.sw'); for (const b of $$('button', sw)) b.setAttribute('aria-pressed', b === t); $('input', sw).value = t.dataset.color; $('code', sw).textContent = t.dataset.color;
      changed(); preview(); return;
    }
    if (t.dataset.insert) {
      const ta = $(`[data-ptr="${CSS.escape(t.dataset.ptr)}"]`);
      if (!ta) return;
      const a = ta.selectionStart ?? ta.value.length, b = ta.selectionEnd ?? ta.value.length;
      ta.value = ta.value.slice(0, a) + t.dataset.insert + ta.value.slice(b);
      ta.focus(); ta.selectionStart = ta.selectionEnd = a + t.dataset.insert.length;
      setAt(config, t.dataset.ptr, ta.value); focusPreview = t.dataset.ptr; changed(); preview(); return;
    }
    if (t.dataset.remove) {
      const parts = t.dataset.remove.split('/'); const idx = Number(parts.pop()); const p = parts.join('/');
      const arr = getAt(config, p) || []; arr.splice(idx, 1); setAt(config, p, arr);
      for (const k of [...errors.keys()]) if (k.startsWith(`${p}/`)) errors.delete(k);
      changed(true); return;
    }
    if (t.dataset.add) {
      const p = t.dataset.add;
      const s = schemaAt(p);
      const arr = getAt(config, p) || [];
      const item = defaultOf(s.items);
      if (p === '/actions/queue' && item && typeof item === 'object' && !item.id) item.id = `p${Date.now().toString(36)}`;
      arr.push(item); setAt(config, p, arr); changed(true);
    }
  }
  function schemaAt(p) {
    let s = schema;
    for (const k of ptrParts(p)) { s = deref(s, schema); s = /^\d+$/.test(k) && s.items ? s.items : (s.properties || {})[k]; if (!s) return {}; }
    return deref(s, schema);
  }
  function changed(repaint) {
    if (repaint) { const y = scrollY; paintModule(); scrollTo(0, y); }
    paintSave(); refreshTabs();
  }

  // ------------------------------------------------------------------ errors from the server (JSON pointers)
  function errAt(ptr) { const m = errors.get(ptr); return m ? `<p class="ferr slap" data-err="${ptr}"><i class="dot sm error"></i>${esc(m)}</p>` : ''; }
  function clearErr(ptr) {
    if (!errors.delete(ptr)) return;
    const el = $(`[data-err="${CSS.escape(ptr)}"]`); if (el) el.remove();
    const f = $(`[data-ptr="${CSS.escape(ptr)}"]`); if (f) f.classList.remove('bad');
  }
  function showErrors(list) {
    errors = new Map();
    // a pointer with no field of its own (a missing property, an array item) shows on its nearest rendered parent
    for (const e of list) errors.set(e.pointer || e.path || '', e.message);
    const first = [...errors.keys()][0] || '';
    const mod = ptrParts(first)[0];
    if (mod && mod !== current && schema.properties[mod]) { current = mod; history.replaceState({}, '', `${location.pathname}#${current}`); }
    paintEditor();
    // place unmapped errors under the closest rendered group
    for (const [p, m] of errors) {
      if ($(`[data-err="${CSS.escape(p)}"]`)) continue;
      let q = p, host = null;
      while (q && !host) { q = q.slice(0, q.lastIndexOf('/')); host = q ? $(`[data-group="${CSS.escape(q)}"], [data-item="${CSS.escape(q)}"]`) : null; }
      (host || $('#form'))?.insertAdjacentHTML('beforeend', `<p class="ferr slap" data-err="${esc(p)}"><i class="dot sm error"></i><span><code>${esc(p)}</code> ${esc(m)}</span></p>`);
    }
    const target = $('.ferr'); if (target) target.scrollIntoView({ block: 'center', behavior: N.reduced ? 'auto' : 'smooth' });
  }

  // ------------------------------------------------------------------ the save bar
  let saving = false, conflict = null;
  function paintSave(note) {
    const bar = $('#save'); if (!bar) return;
    const n = changes(original, config).length;
    bar.classList.toggle('conflict', !!conflict);
    if (conflict) {
      bar.hidden = false;
      bar.innerHTML = `<i class="dot error"></i><span class="grow">${esc(u('conflict', conflict.updatedBy && conflict.updatedBy.name, conflict.version))}</span><button type="button" class="pill sm ghost" id="c-load">${esc(u('conflictLoad'))}</button><button type="button" class="pill sm" id="c-keep">${esc(u('conflictKeep'))}</button>`;
      $('#c-load').addEventListener('click', () => { conflict = null; render(); });
      $('#c-keep').addEventListener('click', () => { version = conflict.version; conflict = null; save(); });
      return;
    }
    if (note) { bar.hidden = false; bar.innerHTML = note; return; }
    if (!n) { bar.hidden = true; return; }
    bar.hidden = false;
    const errs = errors.size;
    bar.innerHTML = `<span class="grow">${errs ? `<i class="dot sm error"></i> ${esc(u('invalid', errs))}` : `${esc(u('unsaved', n))}<small>${esc(u('unsavedHint'))}</small>`}</span><button type="button" class="pill sm ghost" id="s-undo">${esc(u('undo'))}</button><button type="button" class="pill sm" id="s-save"${saving ? ' disabled' : ''}>${esc(saving ? u('saving') : u('save'))}</button>`;
    $('#s-undo').addEventListener('click', () => { config = clone(original); errors = new Map(); paintEditor(); });
    $('#s-save').addEventListener('click', save);
  }
  async function save() {
    if (saving) return;
    saving = true; paintSave();
    try {
      const r = await call('PUT', `panel/guilds/${guild.guild.id}/config`, { config, version });
      version = r.version; original = clone(config); errors = new Map(); saving = false;
      guild.version = r.version; guild.updatedAt = r.updatedAt;
      paintEditor();
      paintSave(`<i class="dot ready slap"></i><span class="grow">${esc(u('saved'))}<small>${esc(u('savedHint', r.version))}</small></span>`);
      setTimeout(() => paintSave(), 3200);
      refreshEvents();
      schedulePoll();
    } catch (e) {
      saving = false;
      if (e.status === 409) { conflict = { version: e.body.version, updatedBy: e.body.updatedBy, updatedAt: e.body.updatedAt }; paintSave(); return; }
      if (e.status === 400 && Array.isArray(e.body.errors)) { showErrors(e.body.errors); paintSave(); return; }
      if (e.status === 401) { me = null; showLogin(false); return; }
      paintSave(`<i class="dot error"></i><span class="grow">${esc(e.message)}</span><button type="button" class="pill sm" id="s-retry">${esc(u('retry'))}</button>`);
      $('#s-retry').addEventListener('click', () => { paintSave(); save(); });
    }
  }

  // ------------------------------------------------------------------ events (and action results), refreshed while jobs wait
  function evLine(e) {
    const d = e.data || {};
    const name = u('ev')[e.type] || humanize(e.type);
    let dot = 'info', text = name;
    if (e.type === 'action_result') {
      dot = d.ok ? 'ready' : 'error';
      const t = deref((schemaAt('/actions/queue').items || {}), schema);
      const typeS = deref((t.properties || {}).type, schema);
      text = `${name}: ${typeS && typeS.enum ? optLabel(typeS, d.type) : d.type || ''}${d.ok ? '' : ` – ${d.error || ''}`}`;
    } else if (e.type === 'panel_config_saved') { dot = 'nore'; text = `${name} · v${d.version}${d.by && d.by.name ? ` · ${d.by.name}` : ''}`; }
    else if (/join|verified|new|open|start/.test(e.type)) dot = 'ready';
    else if (/mod|warn|raid|ban|kick|automod/.test(e.type)) dot = 'wait';
    else if (/error|fail/.test(e.type)) dot = 'error';
    const extra = d.user || d.name || d.title || '';
    return `<li><i class="dot sm ${dot}"></i><span>${esc(text)}${extra && e.type !== 'panel_config_saved' ? ` · ${esc(String(extra))}` : ''}</span><time datetime="${esc(e.at)}">${esc(u('ago', e.at))}</time></li>`;
  }
  function paintEvents() {
    const box = $('#events'); if (!box) return;
    const list = guild.events || [];
    box.innerHTML = list.length ? list.slice(0, 30).map(evLine).join('') : `<li class="none">${esc(u('noEvents'))}</li>`;
  }
  async function refreshEvents() {
    try {
      const g = await call('GET', `panel/guilds/${guild.guild.id}`);
      guild.events = g.events; guild.metaAt = g.metaAt; guild.meta = g.meta;
      paintEvents();
      if (current === 'actions') { const y = scrollY; paintModule(); scrollTo(0, y); }
    } catch { /* keep the old list */ }
  }
  function schedulePoll() {
    clearTimeout(pollTimer);
    const pending = ((original && original.actions && original.actions.queue) || []).some((a) => a.id && !(guild.events || []).some((e) => e.type === 'action_result' && e.data && e.data.id === a.id));
    pollTimer = setTimeout(async () => { if (document.visibilityState === 'visible' && route()) await refreshEvents(); schedulePoll(); }, pending ? 8000 : 45000);
  }

  // ------------------------------------------------------------------ Discord preview of the focused message field
  function preview() {
    const box = $('#dprev'); if (!box || !focusPreview) return;
    const text = getAt(config, focusPreview);
    if (typeof text !== 'string') return;
    const base = focusPreview.slice(0, focusPreview.lastIndexOf('/'));
    const embed = getAt(config, `${base}/embed`) === true;
    const color = getAt(config, `${base}/color`) || (config.general && config.general.color) || '#9d5cff';
    const sample = { user: '<span class="men">@ola_mc</span>', mention: '<span class="men">@ola_mc</span>', name: 'ola_mc', username: 'ola_mc', server: esc(guild.guild.name), guild: esc(guild.guild.name), count: '128', memberCount: '128', role: '<span class="men">@Gracz</span>', channel: '<span class="men">#ogólny</span>' };
    const body = text ? esc(text).replace(/\{([a-zA-Z_.]+)\}/g, (m, k) => sample[k] ?? m) : `<span style="opacity:.7">${lang === 'en' ? 'Default text in the server language.' : 'Domyślny tekst w języku serwera.'}</span>`;
    const time = new Date().toLocaleTimeString(lang === 'en' ? 'en-GB' : 'pl-PL', { hour: '2-digit', minute: '2-digit' });
    box.innerHTML = `<div class="who"><img src="/assets/album/logo-sticker-256.png" alt=""><b>Nore Bot</b><em>BOT</em><small>${esc(u('today'))} ${time}</small></div><div class="msg${embed ? ' embed' : ''}" style="--embed:${esc(color)}">${body}</div>`;
  }

  // ------------------------------------------------------------------ leave guard
  addEventListener('beforeunload', (e) => { if (original && config && changes(original, config).length) { e.preventDefault(); e.returnValue = ''; } });

  render();
})();
