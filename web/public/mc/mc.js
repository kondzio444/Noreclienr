'use strict';
/* mc.noreclient.pl – live server status (API v2 Server List Ping), the copyable address label, news.
   Offline and unreachable states are shown as they are; nothing is invented. Needs /assets/album.js. */
(() => {
  const N = window.Nore;
  if (!N) return;
  const { $, $$, esc, num, plural } = N;
  const ADDRESS = 'mc.noreclient.pl';

  // ------------------------------------------------------------------ the address label copies itself
  async function copyAddr(el) {
    const ok = await N.copy(ADDRESS);
    N.toast(ok ? 'Skopiowano adres' : 'Nie udało się skopiować', ok ? `${ADDRESS} – wklej w Minecraft: Multiplayer → Dodaj serwer` : `Zaznacz i skopiuj ręcznie: ${ADDRESS}`, ok ? 'ready' : 'error');
    if (ok && el) { el.classList.add('done'); const s = $('small, span', el); const t = s && s.textContent; if (s) s.textContent = 'Skopiowano'; setTimeout(() => { el.classList.remove('done'); if (s) s.textContent = t; }, 2200); }
  }
  $('#ip').addEventListener('click', (e) => copyAddr(e.currentTarget));
  for (const b of $$('[data-copy]')) b.addEventListener('click', () => copyAddr(b));

  // ------------------------------------------------------------------ live status
  const MC = { 0: '#000', 1: '#00a', 2: '#0a0', 3: '#0aa', 4: '#a00', 5: '#a0a', 6: '#fa0', 7: '#aaa', 8: '#555', 9: '#55f', a: '#5f5', b: '#5ff', c: '#f55', d: '#f5f', e: '#ff5', f: '#fff' };
  function motdHtml(raw) {
    return String(raw || '').split('\n').slice(0, 2).map((line) => {
      let html = '', color = '#aaa', bold = false;
      for (const part of line.split(/(§[0-9a-fk-or])/i)) {
        const m = /^§([0-9a-fk-or])$/i.exec(part);
        if (m) { const c = m[1].toLowerCase(); if (MC[c]) { color = MC[c]; bold = false; } else if (c === 'l') bold = true; else if (c === 'r') { color = '#aaa'; bold = false; } continue; }
        if (part) html += `<span style="color:${color}${bold ? ';font-weight:700' : ''}">${esc(part)}</span>`;
      }
      return html;
    }).join('\n');
  }
  const time = () => new Date().toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });
  let timer = 0;
  async function check() {
    clearTimeout(timer);
    const live = $('#live');
    try {
      const { server: s } = await N.api(`servers/${ADDRESS}`, { fresh: true });
      if (s.online) {
        const p = s.players || {};
        live.innerHTML = `<span class="on"><i class="dot ready slap"></i>Online</span>`
          + (p.online != null ? `<span><b>${num(p.online)}</b> / ${num(p.max)} ${plural(p.max, 'gracz', 'graczy', 'graczy')}</span>` : '')
          + (s.version && s.version.name ? `<span>wersja <b>${esc(s.version.name)}</b></span>` : '')
          + (s.latencyMs != null ? `<span>odpowiedź <b>${num(s.latencyMs)} ms</b></span>` : '');
        if (s.motd && s.motd.raw) { $('#motd').innerHTML = motdHtml(s.motd.raw); $('#motd').hidden = false; }
        $('#way-live').innerHTML = `<i class="dot sm ready"></i> online${p.online != null ? ` · ${num(p.online)}/${num(p.max)}` : ''}`;
        $('#foot-state').innerHTML = `<i class="dot ready"></i>${ADDRESS} · online`;
        if (s.version && s.version.name) $('#way-ver').textContent = `Dodaj serwer w Minecraft: Java Edition (serwer zgłasza wersję ${s.version.name}) i wpisz adres.`;
        const sample = (p.sample || []).filter((x) => x && /^[A-Za-z0-9_]{2,16}$/.test(x.name)).slice(0, 4);
        const heads = $('#heads');
        if (sample.length) {
          heads.innerHTML = sample.map((x, i) => `<img src="https://mc-heads.net/avatar/${encodeURIComponent(x.name)}/64" alt="${esc(x.name)}" title="${esc(x.name)}" width="64" height="64" style="--r:${[-6, 4, -3, 7][i]}deg">`).join('');
          heads.hidden = false;
        } else heads.hidden = true;
      } else {
        live.innerHTML = `<span class="on"><i class="dot error slap"></i>Serwer jest teraz offline</span><span>sprawdzono o ${time()}</span><button type="button" id="retry">Sprawdź ponownie</button>`;
        $('#motd').hidden = true; $('#heads').hidden = true;
        $('#way-live').innerHTML = '<i class="dot sm error"></i> offline';
        $('#foot-state').innerHTML = `<i class="dot error"></i>${ADDRESS} · offline`;
      }
    } catch (e) {
      const limited = e.status === 429;
      live.innerHTML = `<span class="on"><i class="dot off"></i>${limited ? 'Za dużo sprawdzeń – spróbuj za minutę' : 'Nie udało się sprawdzić serwera'}</span><button type="button" id="retry">Sprawdź ponownie</button>`;
      $('#way-live').innerHTML = '<i class="dot sm off"></i> stan nieznany';
    }
    const r = $('#retry');
    if (r) r.addEventListener('click', () => { live.innerHTML = '<span class="on"><i class="dot wait"></i>Sprawdzam serwer…</span>'; check(); });
    timer = setTimeout(check, 60000);
  }
  check();

  // ------------------------------------------------------------------ news (Nore feed)
  N.api('news?limit=3').then((n) => {
    if (!n.news || !n.news.length) return;
    const tapes = ['', ' mint', ' kraft'], tilts = ['-1deg', '.8deg', '-.5deg'];
    $('#news').innerHTML = n.news.slice(0, 3).map((x, i) => `<article class="clip" style="--tilt:${tilts[i]}"><span class="tape${tapes[i]}"></span><p class="meta">${esc(N.date(x.date))}${x.tag ? ` · ${esc(x.tag)}` : ''}</p><h3>${esc(x.title)}</h3><p>${esc(x.text)}</p></article>`).join('');
  }).catch(() => { $('#news .meta').textContent = 'Aktualności chwilowo niedostępne'; });
})();
