'use strict';
/* API Nore Client – the documentation page talks to the API it documents. */
(() => {
  document.documentElement.classList.add('js');
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

  const COLO = { WAW: 'Warszawa', FRA: 'Frankfurt', AMS: 'Amsterdam', LHR: 'Londyn', CDG: 'Paryż', VIE: 'Wiedeń', PRG: 'Praga', BER: 'Berlin', HAM: 'Hamburg', MUC: 'Monachium', ARN: 'Sztokholm', CPH: 'Kopenhaga', KBP: 'Kijów', IAD: 'Waszyngton', EWR: 'Nowy Jork', ORD: 'Chicago', SJC: 'San José', LAX: 'Los Angeles', SIN: 'Singapur', NRT: 'Tokio' };
  const ago = (s) => s == null ? '—' : s < 60 ? 'przed chwilą' : s < 3600 ? `${Math.round(s / 60)} min temu` : `${Math.round(s / 3600)} godz. temu`;
  let status = null;

  // ---------------------------------------------------------------- live chips
  async function loadStatus() {
    try {
      const r = await fetch('/api/v1/status', { cache: 'no-store' });
      status = await r.json();
      if (status.latest) $('#live-version').textContent = status.latest;
      $('#live-sync').textContent = status.sync ? ago(status.sync.ageSeconds) : 'co 15 min';
      if (status.colo) $('#live-edge').textContent = COLO[status.colo] ? `${COLO[status.colo]} · ${status.colo}` : status.colo;
      renderStage(+stage.value);
    } catch { /* the page keeps its static values */ }
  }

  // ---------------------------------------------------------------- console
  const form = $('#console-form');
  const body = $('#res-body');
  const PARAMS = { 'updates/mod': ['mc', 'loader'], 'updates/launcher': ['platform', 'current'], releases: ['limit'] };

  function endpointUrl() {
    const ep = form.ep.value;
    const q = new URLSearchParams();
    for (const name of PARAMS[ep] || []) {
      const v = form[name].value;
      if (v) q.set(name, v);
    }
    const qs = q.toString();
    return `/api/v1/${ep}${qs ? '?' + qs : ''}`;
  }

  function showParams() {
    const ep = form.ep.value;
    for (const p of $$('.param')) p.hidden = p.dataset.for !== ep;
  }

  const esc = (s) => s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  function highlight(text) {
    return esc(text).replace(/("(?:\\.|[^"\\])*")(\s*:)?|\b(-?\d+(?:\.\d+)?)\b|\b(true|false|null)\b/g, (m, str, colon, num, lit) => {
      if (str) return colon ? `<span class="k">${str}</span>${colon}` : `<span class="s">${str}</span>`;
      if (num) return `<span class="n">${num}</span>`;
      return `<span class="l">${lit}</span>`;
    });
  }

  let seq = 0;
  async function send() {
    const url = endpointUrl();
    const mine = ++seq;
    $('#req-url').textContent = url;
    $('#res-open').href = url;
    body.parentElement.classList.add('loading');
    const t0 = performance.now();
    try {
      const r = await fetch(url, { cache: 'no-store' });
      const text = await r.text();
      if (mine !== seq) return;
      const ms = Math.round(performance.now() - t0);
      const st = $('#res-status');
      st.textContent = `${r.status} ${r.ok ? 'OK' : r.statusText || 'błąd'}`;
      st.classList.toggle('bad', !r.ok);
      $('#res-time').textContent = `${ms} ms`;
      $('#res-cache').textContent = `cache ${r.headers.get('X-Nore-Cache') || '—'}`;
      $('#res-etag').textContent = `ETag ${r.headers.get('ETag') || '—'}`;
      let pretty = text;
      try { pretty = JSON.stringify(JSON.parse(text), null, 2); } catch { /* not JSON */ }
      if (pretty.length > 60000) pretty = pretty.slice(0, 60000) + '\n…';
      body.innerHTML = highlight(pretty);
    } catch (e) {
      if (mine !== seq) return;
      $('#res-status').textContent = 'Brak połączenia';
      $('#res-status').classList.add('bad');
      body.textContent = String(e.message || e);
    } finally {
      if (mine === seq) body.parentElement.classList.remove('loading');
    }
  }

  let typing;
  form.addEventListener('input', (e) => {
    if (e.target.name === 'limit') $('#limit-out').textContent = e.target.value;
    if (e.target.name === 'ep') showParams();
    clearTimeout(typing);
    typing = setTimeout(send, e.target.name === 'current' ? 350 : 60);
  });
  form.addEventListener('submit', (e) => { e.preventDefault(); send(); });

  function choose(ep) {
    const radio = form.querySelector(`input[name=ep][value="${ep}"]`);
    if (!radio) return false;
    radio.checked = true;
    showParams();
    send();
    $('#konsola').scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
    return true;
  }
  for (const a of $$('[data-endpoint]')) {
    a.addEventListener('click', (e) => { if (choose(a.dataset.endpoint)) e.preventDefault(); });
  }

  async function loadVersions() {
    try {
      const r = await fetch('/api/v1/platforms');
      const { platforms } = await r.json();
      const seen = new Set();
      const versions = [];
      for (const p of platforms) for (const v of p.versions) if (!seen.has(v)) { seen.add(v); versions.push(v); }
      const num = (v) => v.split('.').map(n => +n || 0);
      versions.sort((a, b) => { const x = num(a), y = num(b); for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (y[i] || 0) - (x[i] || 0); return 0; });
      const sel = $('#p-mc');
      sel.innerHTML = versions.map(v => `<option${v === '1.21.8' ? ' selected' : ''}>${v}</option>`).join('');
    } catch { /* keeps the default option */ }
  }

  // ---------------------------------------------------------------- endpoint tabs
  const tabs = $$('[role=tab]');
  function selectTab(t) {
    for (const x of tabs) {
      const on = x === t;
      x.setAttribute('aria-selected', on);
      x.tabIndex = on ? 0 : -1;
      $('#' + x.getAttribute('aria-controls')).hidden = !on;
    }
  }
  tabs.forEach((t, i) => {
    t.tabIndex = i === 0 ? 0 : -1;
    t.addEventListener('click', () => selectTab(t));
    t.addEventListener('keydown', (e) => {
      const d = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : 0;
      if (!d) return;
      e.preventDefault();
      const n = tabs[(i + d + tabs.length) % tabs.length];
      selectTab(n);
      n.focus();
    });
  });

  // ---------------------------------------------------------------- stages of a request
  const stage = $('#stage');
  const STAGES = [
    {
      clause: 'Zapytanie trafia na krawędź',
      note: () => `Odpowiada serwer Cloudflare najbliżej Ciebie${status && status.colo ? ` (${COLO[status.colo] || status.colo})` : ''}, nie jeden komputer gdzieś daleko.`,
      rows: () => [['Serwer', status && status.colo ? status.colo : 'najbliższy', true], ['Połączenie', 'HTTPS · HTTP/2'], ['Klucz', 'niepotrzebny']],
      flow: 1,
    },
    {
      clause: 'Odpowiedź czeka w pamięci',
      note: () => 'Dane młodsze niż 5 minut wracają od razu. Z nagłówkiem If-None-Match dostajesz puste 304.',
      rows: () => [['X-Nore-Cache', 'HIT', true], ['ETag', '"9f2c41d07ab3e5c1"'], ['Cache-Control', 'public, max-age=60']],
      flow: 2,
    },
    {
      clause: 'Stare? Odświeżamy w tle',
      note: () => 'Starsze dane dostajesz od razu, a serwer w tym czasie sam pobiera nowe z GitHuba. Nie czekasz ani chwili.',
      rows: () => [['X-Nore-Cache', 'STALE', true], ['W tle', 'GitHub Releases → pamięć'], ['Następne zapytanie', 'HIT']],
      flow: 3,
    },
    {
      clause: 'Co 15 minut bez pytania',
      note: () => status && status.sync ? `Cron Trigger synchronizuje wydania sam, nawet gdy nikt nie pyta. Ostatnio ${ago(status.sync.ageSeconds)}, w ${status.sync.ms} ms.` : 'Cron Trigger synchronizuje wydania sam, nawet gdy nikt nie pyta.',
      rows: () => status && status.sync
        ? [['Harmonogram', '*/15 * * * *'], ['Ostatnio', ago(status.sync.ageSeconds), true], ['Wynik', status.sync.ok ? `ok · ${status.sync.releases} wydań` : 'błąd, spróbuje znowu'], ['Czas', `${status.sync.ms} ms`]]
        : [['Harmonogram', '*/15 * * * *'], ['Wynik', 'ok', true]],
      flow: 4,
    },
  ];
  const FLOW = ['Ty', 'Krawędź', 'Pamięć', 'GitHub', 'Cron'];
  const flow = $('#stage-flow');
  flow.innerHTML = FLOW.map(f => `<span>${f}</span>`).join('');

  function renderStage(i, animate) {
    const s = STAGES[i];
    const apply = () => {
      $('#stage-title').textContent = s.clause;
      $('#stage-note').textContent = s.note();
      $('#stage-rows').innerHTML = s.rows().map(([k, v, hl]) => `<dt>${k}</dt><dd${hl ? ' class="hl"' : ''}><code>${esc(String(v))}</code></dd>`).join('');
      $$('span', flow).forEach((el, k) => el.classList.toggle('on', k === 0 || k === s.flow));
      $$('.stage-names li').forEach((li, k) => li.classList.toggle('on', k === i));
      stage.setAttribute('aria-valuetext', s.clause);
      $('#stage-fill').style.width = `${(i / 3) * 100}%`;
    };
    if (!animate || reduce) { apply(); return; }
    const parts = [$('#stage-title'), $('#stage-note'), $('.stage-frag')];
    parts.forEach(p => p.classList.add('fade'));
    setTimeout(() => { apply(); parts.forEach(p => p.classList.remove('fade')); }, 200);
  }
  stage.addEventListener('input', () => renderStage(+stage.value, true));
  $$('.stage-names li').forEach((li, k) => li.addEventListener('click', () => { stage.value = k; renderStage(k, true); }));

  // ---------------------------------------------------------------- entrances
  const io = 'IntersectionObserver' in window ? new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
  }, { threshold: 0.12 }) : null;
  for (const sec of $$('main > section')) {
    $$('.reveal', sec).forEach((el, i) => { el.style.setProperty('--d', `${i * 80}ms`); if (io) io.observe(el); else el.classList.add('in'); });
  }

  showParams();
  renderStage(0);
  send();
  loadStatus();
  loadVersions();
})();
