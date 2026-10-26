'use strict';
/* /api – the documentation page talks to the API it documents: endpoints are rendered from
   /api/v2/openapi.json (and /api/v1/openapi.json for the legacy table), the console sends real requests
   and shows what the launcher would show. Needs /assets/album.js (window.Nore). */
(() => {
  const N = window.Nore;
  if (!N) return;
  const { $, $$, esc, reduced } = N;

  const COLO = { WAW: 'Warszawa', FRA: 'Frankfurt', AMS: 'Amsterdam', LHR: 'Londyn', CDG: 'Paryż', VIE: 'Wiedeń', PRG: 'Praga', BER: 'Berlin', HAM: 'Hamburg', MUC: 'Monachium', ARN: 'Sztokholm', CPH: 'Kopenhaga', KBP: 'Kijów', IAD: 'Waszyngton', EWR: 'Nowy Jork', ORD: 'Chicago', SJC: 'San José', LAX: 'Los Angeles', SIN: 'Singapur', NRT: 'Tokio' };
  const TAGS = {
    public: ['Publiczne', 'Bez klucza, z otwartym CORS. Tego używają launcher, mod, Nore Bot i ta strona.'],
    bot: ['Nore Bot', 'Serwer do serwera: nagłówek Authorization: Bot z sekretem bota. Nie dla przeglądarek.'],
    panel: ['Panel', 'Sesja po logowaniu przez Discord (ciasteczko __Host-nore_s). Używa ich panel na tej stronie.'],
  };
  const SAMPLE = { name: 'Notch', address: 'mc.noreclient.pl', version: '', platform: 'win', limit: '5', tag: '', prerelease: '', notes: '', favicon: 'false', guildId: '', since: '' };
  const slug = (m, p) => `ep-${m}-${p.replace(/^\/api\/v2\/?/, '').replace(/[{}]/g, '').replace(/[^a-z0-9]+/gi, '-').replace(/-+$/, '') || 'index'}`;
  const codeDot = (c) => (c < 300 ? 'ready' : c < 400 ? 'info' : c < 500 ? 'wait' : 'error');
  let status = null;

  // ------------------------------------------------------------------ JSON highlight
  function highlight(text) {
    const re = /("(?:\\.|[^"\\])*")(\s*:)?|(-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b)|\b(true|false|null)\b/g;
    let out = '', last = 0, m;
    while ((m = re.exec(text))) {
      out += esc(text.slice(last, m.index));
      if (m[1]) out += m[2] ? `<span class="k">${esc(m[1])}</span>${m[2]}` : `<span class="s">${esc(m[1])}</span>`;
      else if (m[3]) out += `<span class="n">${m[3]}</span>`;
      else out += `<span class="l">${m[4]}</span>`;
      last = re.lastIndex;
    }
    return out + esc(text.slice(last));
  }

  // ------------------------------------------------------------------ OpenAPI helpers
  let spec = null;
  function deref(s, depth = 0) {
    if (!s || depth > 6) return s || {};
    if (s.$ref) return deref(s.$ref.replace(/^#\//, '').split('/').reduce((o, k) => (o ? o[k] : null), spec), depth + 1);
    return s;
  }
  function fieldsOf(schema, depth = 0) {
    const s = deref(schema);
    if (depth > 4) return [];
    let out = [];
    if (s.allOf) for (const p of s.allOf) out = out.concat(fieldsOf(p, depth + 1));
    if (s.properties) out = out.concat(Object.keys(s.properties));
    return [...new Set(out)].filter((k) => k !== 'ok');
  }
  const typeOf = (sch) => {
    const s = deref(sch);
    if (s.enum) return s.enum.map((e) => (e === '' ? '""' : e)).join(' | ');
    const t = Array.isArray(s.type) ? s.type.join(' | ') : s.type || 'string';
    return t + (s.default !== undefined ? ` · domyślnie ${JSON.stringify(s.default)}` : '') + (s.minimum !== undefined ? ` · ${s.minimum}–${s.maximum ?? '…'}` : '');
  };
  const security = (op) => {
    if (!op.security || !op.security.length) return '';
    const names = op.security.flatMap((x) => Object.keys(x));
    const schemes = (spec.components && spec.components.securitySchemes) || {};
    return names.map((n) => (schemes[n] && schemes[n].description) || n).join(', ');
  };

  // ------------------------------------------------------------------ rendering the endpoints
  const ops = [];
  function renderSpec() {
    for (const [path, item] of Object.entries(spec.paths)) {
      for (const [method, op] of Object.entries(item)) {
        if (!['get', 'post', 'put', 'delete', 'patch'].includes(method)) continue;
        const tag = (op.tags || ['public']).find((t) => TAGS[t]) || 'public';
        const codes = Object.keys(op.responses || {}).map(Number);
        const consoleable = method === 'get' && tag === 'public' && !codes.includes(302) && !(op.tags || []).includes('bot') && !/\/favicon$/.test(path);
        ops.push({ path, method, op, tag, id: slug(method, path), consoleable });
      }
    }
    const byTag = Object.keys(TAGS).map((t) => [t, ops.filter((o) => o.tag === t)]).filter(([, l]) => l.length);
    $('#ep-list').innerHTML = byTag.map(([t, list]) => `
      <div class="tagsec" id="tag-${t}">
        <h3>${esc(TAGS[t][0])}</h3>
        <p>${esc((spec.tags || []).find((x) => x.name === t)?.description || TAGS[t][1])}</p>
        ${list.map(epHtml).join('')}
      </div>`).join('');
    const idx = $('#index');
    idx.insertAdjacentHTML('beforeend', byTag.map(([t, list]) => `<p class="grp">${esc(TAGS[t][0])}</p>` + list.map((o) => `<a class="ep-link" href="#${o.id}"><span class="m ${o.method}">${o.method.toUpperCase()}</span><code>${esc(o.path.replace(/^\/api\/v2/, '') || '/')}</code></a>`).join('')).join(''));
    // the v1 link stays last
    idx.append($('a[href="#v1"]', idx));
    for (const b of $$('[data-try]')) b.addEventListener('click', () => choose(b.dataset.try, true));
    N.entrances($('#ep-list'));
    watchIndex();
    if (location.hash) { const t = document.getElementById(location.hash.slice(1)); if (t) t.scrollIntoView(); }
  }
  function epHtml(o) {
    const { op, method, path } = o;
    const params = op.parameters || [];
    const body = op.requestBody && deref(op.requestBody);
    const bodySchema = body && body.content && body.content['application/json'] && body.content['application/json'].schema;
    const ok = Object.entries(op.responses || {}).find(([c]) => c.startsWith('2'));
    const okSchema = ok && ok[1].content && ok[1].content['application/json'] && ok[1].content['application/json'].schema;
    const fields = okSchema ? fieldsOf(okSchema) : [];
    const sec = security(op);
    return `<article class="ep rv" id="${o.id}">
      <div class="ep-head"><span class="m ${method}">${method.toUpperCase()}</span><code>${esc(path)}</code>${sec ? `<span class="lock"><i class="dot wait"></i>${esc(sec)}</span>` : ''}</div>
      <h4>${esc(op.summary || '')}</h4>
      ${op.description ? `<p class="desc">${esc(op.description)}</p>` : ''}
      <div class="cols">
        <div>
          ${params.length ? `<h5>Parametry</h5><table><thead><tr><th scope="col">Nazwa</th><th scope="col">Gdzie</th><th scope="col">Opis</th></tr></thead><tbody>${params.map((p0) => { const p = deref(p0); return `<tr><td><code>${esc(p.name)}</code>${p.required ? '<small>wymagany</small>' : ''}</td><td>${p.in === 'path' ? 'ścieżka' : p.in === 'query' ? 'zapytanie' : esc(p.in)}</td><td>${esc(p.description || '')}<small>${esc(typeOf(p.schema))}</small></td></tr>`; }).join('')}</tbody></table>` : '<h5>Parametry</h5><p class="desc">Bez parametrów.</p>'}
          ${bodySchema ? `<h5 style="margin-top:16px">Treść żądania</h5><ul class="fields">${fieldsOf(bodySchema).map((f) => `<li><code>${esc(f)}</code></li>`).join('') || '<li>JSON</li>'}</ul>` : ''}
          ${fields.length ? `<h5 style="margin-top:16px">Pola odpowiedzi</h5><ul class="fields">${fields.map((f) => `<li><code>${esc(f)}</code></li>`).join('')}</ul>` : ''}
        </div>
        <div>
          <h5>Odpowiedzi</h5>
          <ul class="codes">${Object.entries(op.responses || {}).map(([c, r]) => `<li><b><i class="dot ${codeDot(+c)}"></i>${esc(c)}</b><span>${esc(deref(r).description || '')}</span></li>`).join('')}</ul>
          ${o.consoleable ? `<button type="button" class="pill quiet sm try" data-try="${esc(o.id)}">Wypróbuj w konsoli</button>` : ''}
        </div>
      </div>
    </article>`;
  }

  // index: the section on screen is the white sticker
  function watchIndex() {
    if (!('IntersectionObserver' in window)) return;
    const links = new Map($$('#index a').map((a) => [a.getAttribute('href').slice(1), a]));
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) {
        for (const a of links.values()) a.classList.remove('on');
        const a = links.get(e.target.id);
        if (a) { a.classList.add('on'); const idx = $('#index'); if (innerWidth > 1000 && idx.scrollHeight > idx.clientHeight) { const t = a.offsetTop - idx.clientHeight / 2; idx.scrollTo({ top: Math.max(0, t), behavior: reduced ? 'auto' : 'smooth' }); } }
      }
    }, { rootMargin: '-35% 0px -60% 0px' });
    for (const id of links.keys()) { const el = document.getElementById(id); if (el) io.observe(el); }
  }

  // ------------------------------------------------------------------ console
  const form = $('#console-form');
  const sel = $('#ep');
  const paramsBox = $('#params');
  const consoleOps = new Map();
  function fillConsole(v1paths) {
    const pub = ops.filter((o) => o.consoleable);
    for (const o of pub) consoleOps.set(o.id, o);
    let html = `<optgroup label="API v2">${pub.map((o) => `<option value="${o.id}">GET ${esc(o.path)} – ${esc(o.op.summary || '')}</option>`).join('')}</optgroup>`;
    if (v1paths.length) {
      for (const o of v1paths) consoleOps.set(o.id, o);
      html += `<optgroup label="API v1 (starsze)">${v1paths.map((o) => `<option value="${o.id}">GET ${esc(o.path)} – ${esc(o.op.summary || '')}</option>`).join('')}</optgroup>`;
    }
    sel.innerHTML = html;
    const first = location.hash && consoleOps.has(location.hash.slice(1)) ? location.hash.slice(1) : consoleOps.has('ep-get-servers-address') ? 'ep-get-servers-address' : pub[0] && pub[0].id;
    if (first) { sel.value = first; showParams(); send(); }
  }
  function showParams() {
    const o = consoleOps.get(sel.value);
    if (!o) return;
    paramsBox.innerHTML = (o.op.parameters || []).map((p0) => {
      const p = deref(p0); const s = deref(p.schema);
      const val = SAMPLE[p.name] ?? (s.default !== undefined ? String(s.default) : '');
      const id = `p-${p.name}`;
      if (s.enum || s.type === 'boolean') {
        const opts = s.enum ? s.enum : ['true', 'false'];
        return `<label for="${id}">${esc(p.name)}<select id="${id}" name="${esc(p.name)}" data-in="${p.in}">${p.required ? '' : '<option value="">–</option>'}${opts.map((e) => `<option${String(e) === val ? ' selected' : ''}>${esc(e)}</option>`).join('')}</select></label>`;
      }
      return `<label for="${id}">${esc(p.name)}<input id="${id}" name="${esc(p.name)}" data-in="${p.in}" value="${esc(val)}" autocomplete="off" spellcheck="false"${p.required ? ' required' : ''}></label>`;
    }).join('');
  }
  function urlOf() {
    const o = consoleOps.get(sel.value);
    let path = o.path;
    const q = new URLSearchParams();
    for (const el of $$('[data-in]', paramsBox)) {
      if (el.dataset.in === 'path') path = path.replace(`{${el.name}}`, encodeURIComponent(el.value.trim()));
      else if (el.value !== '') q.set(el.name, el.value.trim());
    }
    return path + (q.toString() ? `?${q}` : '');
  }
  let seq = 0;
  async function send() {
    const o = consoleOps.get(sel.value);
    if (!o) return;
    const url = urlOf();
    const mine = ++seq;
    $('#req-url').textContent = url;
    $('#res-open').href = url;
    $('#curl').textContent = `curl https://noroclient.pl${url}`;
    const pre = $('#res-body').parentElement;
    pre.classList.add('loading');
    const t0 = performance.now();
    try {
      const r = await fetch(url, { cache: 'no-store', headers: { Accept: 'application/json' } });
      const text = await r.text();
      if (mine !== seq) return;
      $('#res-status').innerHTML = `<i class="dot ${codeDot(r.status)} slap"></i>${r.status} ${r.ok ? 'OK' : esc(r.statusText || 'błąd')}`;
      $('#res-time').textContent = `${Math.round(performance.now() - t0)} ms`;
      $('#res-cache').textContent = `cache ${r.headers.get('X-Nore-Cache') || '—'}`;
      $('#res-etag').textContent = `ETag ${r.headers.get('ETag') || '—'}`;
      let json = null, pretty = text;
      try { json = JSON.parse(text); pretty = JSON.stringify(json, null, 2); } catch { /* not JSON */ }
      if (pretty.length > 60000) pretty = pretty.slice(0, 60000) + '\n…';
      $('#res-body').innerHTML = highlight(pretty);
      preview(o, json);
    } catch (e) {
      if (mine !== seq) return;
      $('#res-status').innerHTML = '<i class="dot error"></i>Brak połączenia';
      $('#res-body').textContent = String(e.message || e);
      $('#preview').hidden = true;
    } finally { if (mine === seq) pre.classList.remove('loading'); }
  }
  form.addEventListener('submit', (e) => { e.preventDefault(); send(); });
  sel.addEventListener('change', () => { showParams(); send(); });
  let typing;
  paramsBox.addEventListener('input', (e) => { clearTimeout(typing); typing = setTimeout(send, e.target.tagName === 'SELECT' ? 30 : 450); });
  function choose(id, scroll) {
    if (!consoleOps.has(id)) return;
    sel.value = id; showParams(); send();
    if (scroll) $('#konsola').scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
  }

  // what the launcher (or the bot) would show for this answer
  function preview(o, j) {
    const box = $('#preview');
    let html = '';
    if (j && j.ok !== false) {
      if (j.server) {
        const s = j.server;
        html = `${s.faviconUrl ? `<img class="ico" src="${esc(s.faviconUrl)}" alt="">` : '<span class="ico" aria-hidden="true"></span>'}<div><b>${esc(s.motd ? s.motd.clean.split('\n')[0] : s.address)}</b><small><i class="dot sm ${s.online ? 'ready' : 'error'}"></i> ${s.online ? `${esc(s.version ? s.version.name : '')}${s.latencyMs != null ? ` · ${s.latencyMs} ms` : ''}` : 'Serwer jest offline'}</small></div>${s.online && s.players ? `<div class="who">${s.players.online} / ${s.players.max}<small>graczy</small></div>` : ''}`;
      } else if (j.player) {
        const p = j.player;
        html = `<img class="ico" src="https://mc-heads.net/avatar/${encodeURIComponent(p.name)}/64" alt=""><div><b>${esc(p.name)}</b><small><i class="dot sm ${p.nore ? (p.online ? 'ready' : 'nore') : 'off'}"></i> ${p.nore ? (p.online ? 'Gra teraz w Nore' : `Gracz Nore · ${esc(N.ago(p.seenAt))}`) : 'Nie gra w Nore'}</small></div>`;
      } else if (j.release) {
        html = `<span class="label nore">Nore ${esc(j.release.version)}</span><div><b>${esc(j.release.name || j.release.version)}</b><small>${esc(N.date(j.release.published))} · ${N.num(j.release.downloads)} pobrań</small></div>`;
      } else if (j.components) {
        const map = { ok: 'ready', stale: 'wait', degraded: 'wait', disabled: 'off', unknown: 'off', down: 'error', error: 'error' };
        html = `<div class="dots">${Object.entries(j.components).map(([k, c]) => `<span><i class="dot sm ${map[c.status] || 'off'}"></i>${esc(k)}</span>`).join('')}</div>`;
      } else if (j.events) {
        html = `<div class="dots">${j.events.map((e) => `<span><i class="dot sm ${e.active ? 'event' : 'off'}"></i>${esc(e.name)}${e.countdown ? ` · ${e.countdown.days} dni ${e.countdown.hours} godz.` : ''}</span>`).join('')}</div>`;
      } else if (j.platforms && j.version) {
        html = `<div class="dots">${j.platforms.map((p) => `<span><i class="dot sm ${p.available ? 'ready' : 'off'}"></i>${esc(p.name)}${p.size ? ` · ${N.bytes(p.size)}` : ''}</span>`).join('')}</div>`;
      } else if ('online' in j && 'known' in j) {
        html = `<div class="dots"><span><i class="dot sm ready"></i>${N.num(j.online)} w grze</span><span><i class="dot sm nore"></i>${N.num(j.known)} z 30 dni</span>${j.downloads ? `<span><i class="dot sm info"></i>${N.num(j.downloads.total)} pobrań</span>` : ''}</div>`;
      }
    } else if (j && j.ok === false) {
      html = `<i class="dot ${codeDot(j.status)}"></i><div><b>${esc(j.code)}</b><small>${esc(j.error)}</small></div>`;
    }
    box.innerHTML = html;
    box.hidden = !html;
  }

  // ------------------------------------------------------------------ v1 (legacy) table
  const V2_FOR = { '/api/v1/status': '/api/v2/status', '/api/v1/version': '/api/v2/releases/latest', '/api/v1/releases': '/api/v2/releases', '/api/v1/stats': '/api/v2/stats', '/api/v1/download/{platform}': '/api/v2/downloads/{platform}', '/api/v1/events': '/api/v2/events', '/api/v1/news': '/api/v2/news', '/api/v1/platforms': '/api/v2/platforms', '/api/v1/hub/players': '/api/v2/players/{name}', '/api/v1/hub/stats': '/api/v2/stats' };
  async function loadV1() {
    try {
      const r = await fetch('/api/v1/openapi.json');
      const v1 = await r.json();
      const rows = [], list = [];
      for (const [path, item] of Object.entries(v1.paths)) for (const [m, op] of Object.entries(item)) {
        rows.push(`<tr><td>${m.toUpperCase()}</td><td><code>${esc(path)}</code></td><td>${esc(op.summary || '')}</td><td>${V2_FOR[path] ? `<code>${esc(V2_FOR[path])}</code>` : '–'}</td></tr>`);
        const params = (op.parameters || []);
        if (m === 'get' && !path.includes('{') && !(op.responses || {})[302]) list.push({ path, method: m, op: { ...op, parameters: params }, id: slug('v1-get', path), tag: 'v1' });
      }
      $('#v1-rows').innerHTML = rows.join('');
      return list;
    } catch { return []; }
  }

  // ------------------------------------------------------------------ stages of a request (the slider of the old page, as a segmented control)
  const ago = (s) => (s == null ? '—' : s < 60 ? 'przed chwilą' : s < 3600 ? `${Math.round(s / 60)} min temu` : `${Math.round(s / 3600)} godz. temu`);
  const STAGES = [
    { clause: 'Zapytanie trafia na krawędź', note: () => `Odpowiada serwer Cloudflare najbliżej Ciebie${status && status.colo ? ` (${COLO[status.colo] || status.colo})` : ''}, nie jeden komputer gdzieś daleko.`, rows: () => [['Serwer', status && status.colo ? status.colo : 'najbliższy', true], ['Połączenie', 'HTTPS'], ['Klucz', 'niepotrzebny']], flow: 1 },
    { clause: 'Odpowiedź czeka w pamięci', note: () => 'Dane młodsze niż kilka minut wracają od razu. Z nagłówkiem If-None-Match dostajesz puste 304.', rows: () => [['X-Nore-Cache', 'HIT', true], ['ETag', '"9f2c41d07ab3e5c1"'], ['Cache-Control', 'public, max-age=60']], flow: 2 },
    { clause: 'Stare? Odświeżamy w tle', note: () => 'Starsze dane dostajesz od razu, a serwer w tym czasie sam pobiera nowe z GitHuba. Nie czekasz ani chwili.', rows: () => [['X-Nore-Cache', 'STALE', true], ['W tle', 'GitHub Releases → pamięć'], ['Następne zapytanie', 'HIT']], flow: 3 },
    { clause: 'Co 15 minut bez pytania', note: () => { const s = status && status.components && status.components.sync; return s && s.at ? `Cron Trigger synchronizuje wydania sam, nawet gdy nikt nie pyta. Ostatnio ${ago(s.ageSeconds)}${s.ms != null ? `, w ${s.ms} ms` : ''}.` : 'Cron Trigger synchronizuje wydania sam, nawet gdy nikt nie pyta.'; },
      rows: () => { const s = status && status.components && status.components.sync; return s && s.at ? [['Harmonogram', '*/15 * * * *'], ['Ostatnio', ago(s.ageSeconds), true], ['Wynik', s.status === 'ok' ? 'ok' : 'błąd, spróbuje znowu']] : [['Harmonogram', '*/15 * * * *'], ['Wynik', 'czeka na pierwszą synchronizację', true]]; }, flow: 4 },
  ];
  const FLOW = ['Ty', 'Krawędź', 'Pamięć', 'GitHub', 'Cron'];
  $('#stage-flow').innerHTML = FLOW.map((f) => `<span>${f}</span>`).join('');
  let stageNow = 0;
  function renderStage(i, animate) {
    stageNow = i;
    const s = STAGES[i];
    const apply = () => {
      $('#stage-title').textContent = s.clause;
      $('#stage-note').textContent = s.note();
      $('#stage-rows').innerHTML = s.rows().map(([k, v, hl]) => `<dt>${esc(k)}</dt><dd${hl ? ' class="hl"' : ''}><code>${esc(String(v))}</code></dd>`).join('');
      $$('#stage-flow span').forEach((el, k) => el.classList.toggle('on', k === 0 || k === s.flow));
      $$('#stage-tabs button').forEach((b, k) => { b.setAttribute('aria-selected', k === i); b.tabIndex = k === i ? 0 : -1; });
    };
    if (!animate || reduced) { apply(); return; }
    const frag = $('.stage-frag');
    frag.classList.add('fade');
    setTimeout(() => { apply(); frag.classList.remove('fade'); }, 180);
  }
  $('#stage-tabs').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) renderStage(+b.dataset.s, true); });
  $('#stage-tabs').addEventListener('keydown', (e) => {
    const d = { ArrowRight: 1, ArrowLeft: -1 }[e.key]; if (!d) return;
    e.preventDefault(); const n = (stageNow + d + 4) % 4; renderStage(n, true); $$('#stage-tabs button')[n].focus();
  });
  renderStage(0);

  // ------------------------------------------------------------------ live facts
  N.api('status', { fresh: true }).then((s) => {
    status = s;
    const map = { ok: ['ready', 'Działa'], degraded: ['wait', 'Działa częściowo'], down: ['error', 'Awaria'] };
    const [dot, text] = map[s.status] || ['off', 'Stan nieznany'];
    const sync = s.components && s.components.sync;
    const f = $('#f-status');
    f.previousElementSibling.className = `dot ${dot} slap`;
    f.textContent = `${text}${sync && sync.at ? ` · dane sprzed ${ago(sync.ageSeconds).replace(' temu', '')}` : ''}${s.latest ? ` · wersja ${s.latest}` : ''}`;
    if (s.colo) { $('#f-edge').textContent = `Odpowiada ${COLO[s.colo] || s.colo} · ${s.colo}`; $('#f-edge-dot').className = 'dot ready'; }
    renderStage(stageNow);
  }).catch(() => { $('#f-status').textContent = 'Nie udało się sprawdzić stanu'; });

  // ------------------------------------------------------------------ the moving picture plays only while seen
  const vid = $('.shot video');
  if (vid) {
    if (reduced) { vid.removeAttribute('autoplay'); vid.pause(); }
    else if ('IntersectionObserver' in window) new IntersectionObserver(([e]) => { if (e.isIntersecting) vid.play().catch(() => {}); else vid.pause(); }, { threshold: 0.3 }).observe(vid);
  }

  // ------------------------------------------------------------------ go
  Promise.all([fetch('/api/v2/openapi.json').then((r) => r.json()), loadV1()]).then(([s, v1]) => {
    spec = s;
    renderSpec();
    fillConsole(v1);
  }).catch(() => { $('#res-body').textContent = 'Nie udało się wczytać opisu OpenAPI. Adresy z listy poniżej działają dalej.'; });
})();
