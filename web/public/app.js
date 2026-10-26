'use strict';
/* noroclient.pl home: the download (visitor's system, newest release), live numbers from API v2, the nick
   sticker with a Nore Hub lookup, the module sheet, the MOTD editor, the wardrobe, event countdowns, news and
   the changelog. Needs /assets/album.js (window.Nore). Without script the page stays complete and static. */
(() => {
  const N = window.Nore;
  if (!N) return;
  const { $, $$, api, esc, num, plural, reduced } = N;

  // ------------------------------------------------------------------ download: the visitor's system, counted redirects (API v2)
  const OS_LABEL = { win: 'Windows', linux: 'Linux', mac: 'macOS', 'mac-zip': 'macOS (ZIP)' };
  const ua = navigator.userAgent;
  const os = /Mac/.test(ua) && !/iPhone|iPad/.test(ua) ? 'mac' : /Linux/.test(ua) && !/Android/.test(ua) ? 'linux' : 'win';
  const heroBtn = $('#dl-hero');
  heroBtn.href = `/api/v2/downloads/${os}`;
  $('span', heroBtn).textContent = `Pobierz dla ${OS_LABEL[os]}`;
  const sel = $('#dl-os');
  sel.value = os;
  const form = $('#dl-form');
  const syncForm = () => { form.action = `/api/v2/downloads/${sel.value}`; };
  sel.addEventListener('change', syncForm);
  syncForm();
  form.addEventListener('submit', (e) => { e.preventDefault(); location.href = `/api/v2/downloads/${sel.value}`; });

  api('downloads').then((d) => {
    $('#dl-note').textContent = `Wersja ${d.version}${d.prerelease ? ' (beta)' : ''} z ${N.date(d.published)}, prosto z GitHub Releases. Instalator sam przeprowadzi Cię przez konto, wygląd i pamięć.`;
    $('#dl-files').innerHTML = d.platforms.filter((p) => p.available).map((p) => `<li><a href="${esc(p.href)}"><b>${esc(p.name)}</b><span>${esc(p.file)} · ${N.bytes(p.size)}</span>${p.digest ? `<span>SHA-256 ${esc(String(p.digest).replace(/^sha256:/, '').slice(0, 16))}…</span>` : ''}</a></li>`).join('');
    for (const o of sel.options) { const p = d.platforms.find((x) => x.id === o.value); if (p && !p.available) o.disabled = true; }
  }).catch(() => {});

  // ------------------------------------------------------------------ live numbers: players online/known, downloads
  api('stats').then((s) => {
    const live = $('#hero-live');
    if (s.online != null) {
      live.innerHTML = `<i class="dot ${s.online > 0 ? 'ready' : 'off'} slap"></i><span><b>${num(s.online)}</b> ${plural(s.online, 'gracz', 'graczy', 'graczy')} Nore w grze teraz${s.known != null ? ` · <b>${num(s.known)}</b> z ostatnich 30 dni` : ''}</span>`;
    } else live.innerHTML = '<i class="dot off"></i><span>Licznik graczy chwilowo nie odpowiada.</span>';
    $('#st-online').textContent = num(s.online);
    $('#st-known').textContent = num(s.known);
    $('#st-dl').textContent = s.downloads ? num(s.downloads.total) : '–';
  }).catch(() => { $('#hero-live').innerHTML = '<i class="dot off"></i><span>Licznik graczy chwilowo nie odpowiada.</span>'; });

  // ------------------------------------------------------------------ versions (API v2 platforms) and the newest release
  api('platforms').then((p) => {
    const byMajor = new Map();
    for (const pl of p.platforms) for (const v of pl.versions) {
      const parts = v.split('.');
      const major = Number(parts[0]) >= 26 ? `${parts[0]}.${parts[1] || 0}` : `${parts[0]}.${parts[1]}`;
      const e = byMajor.get(major) || { versions: new Set(), java: new Set(), loaders: new Set() };
      e.versions.add(v); e.java.add(pl.java); e.loaders.add(pl.loader);
      byMajor.set(major, e);
    }
    const key = (v) => v.split('.').map(Number);
    const cmp = (a, b) => { const x = key(a), y = key(b); for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (y[i] || 0) - (x[i] || 0); return 0; };
    const majors = [...byMajor.keys()].sort(cmp);
    if (!majors.length) return;
    const loaderName = (l) => ({ fabric: 'Fabric', forge: 'Forge', neoforge: 'NeoForge', quilt: 'Quilt' }[l] || l);
    $('#ver-list').innerHTML = majors.map((m) => {
      const e = byMajor.get(m);
      const vs = [...e.versions].sort(cmp);
      const range = vs.length > 1 ? `${vs[vs.length - 1]} – ${vs[0]}` : vs[0];
      return `<li><b>${esc(m)}</b><small>${esc(range)} · ${[...e.loaders].map(loaderName).join(', ')} · Java ${[...e.java].sort().join(' / ')}</small></li>`;
    }).join('');
    const all = p.minecraft;
    $('#hero-ver').textContent = `Wersje ${all[all.length - 1]} – ${all[0]}`;
    $('#ver-note').textContent = `${all.length} ${plural(all.length, 'wersja', 'wersje', 'wersji')} Minecraft. Launcher sam dobiera loader i Javę.`;
  }).catch(() => {});

  const mdText = (s) => s.replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/[*_`#>]/g, '').replace(/\s+/g, ' ').trim();
  api('releases/latest').then(({ release: r }) => {
    $('#rel-ver').textContent = `Nore ${r.version}${r.prerelease ? ' beta' : ''}`;
    $('#rel-date').textContent = N.date(r.published);
    $('#rel-title').textContent = r.name && r.name !== r.version ? mdText(r.name) : `Wydanie ${r.version}`;
    const lines = String(r.notes || '').split(/\r?\n/).map((l) => l.trim()).filter((l) => /^[-*•]\s+/.test(l)).map((l) => mdText(l.replace(/^[-*•]\s+/, ''))).filter(Boolean);
    const paras = lines.length ? lines : String(r.notes || '').split(/\r?\n\r?\n/).map(mdText).filter((l) => l.length > 3);
    if (paras.length) $('#rel-notes').innerHTML = paras.slice(0, 8).map((l) => `<li>${esc(l.length > 180 ? l.slice(0, 177) + '…' : l)}</li>`).join('') + (paras.length > 8 ? `<li>i ${paras.length - 8} więcej</li>` : '');
    if (r.url) $('#rel-link').href = r.url;
    $('#rel-link').textContent = 'Pełna lista zmian na GitHubie';
  }).catch(() => {});

  api('news?limit=4').then((n) => {
    if (!n.news || !n.news.length) return;
    const tapes = ['', ' mint', ' kraft', ''];
    const tilts = ['-1.2deg', '.8deg', '-.6deg', '1deg'];
    $('#news-list').innerHTML = n.news.slice(0, 4).map((x, i) => `<article class="clip" style="--tilt:${tilts[i]}"><span class="tape${tapes[i]}"></span><p class="meta">${esc(N.date(x.date))}${x.tag ? ` · ${esc(x.tag)}` : ''}</p><h3>${esc(x.title)}</h3><p>${esc(x.text)}</p></article>`).join('');
  }).catch(() => {});

  // ------------------------------------------------------------------ the nick sticker: obfuscated glyphs that resolve (§k) + Nore Hub
  const GLYPHS = 'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789';
  function reveal(el, text, ms = 520) {
    if (reduced) { el.textContent = text; return; }
    cancelAnimationFrame(el._raf);
    const t0 = performance.now();
    const step = (now) => {
      const p = Math.min(1, (now - t0) / ms);
      const k = Math.floor(p * text.length);
      el.textContent = text.slice(0, k) + [...text.slice(k)].map((c) => (c === ' ' ? ' ' : GLYPHS[(Math.random() * GLYPHS.length) | 0])).join('');
      if (p < 1) el._raf = requestAnimationFrame(step);
    };
    el._raf = requestAnimationFrame(step);
  }
  const nickIn = $('#nick-in');
  const head = $('#nick-head');
  let headTimer = 0, hubTimer = 0, hubSeq = 0;
  function hub(name) {
    const out = $('#nick-hub');
    const mine = ++hubSeq;
    out.innerHTML = '<i class="dot wait"></i>Sprawdzam Nore Hub…';
    api(`players/${encodeURIComponent(name)}`).then(({ player: p }) => {
      if (mine !== hubSeq) return;
      if (!p.nore) out.innerHTML = '<i class="dot off"></i>Jeszcze nie gra w Nore';
      else if (p.online) out.innerHTML = '<i class="dot ready slap"></i>Gra teraz w Nore';
      else out.innerHTML = `<i class="dot nore slap"></i>Gra w Nore · ${esc(N.ago(p.seenAt))}`;
    }).catch(() => { if (mine === hubSeq) out.innerHTML = '<i class="dot off"></i>Nore Hub nie odpowiada'; });
  }
  function updateNick(animate) {
    const v = nickIn.value.trim();
    const ok = /^[A-Za-z0-9_]{3,16}$/.test(v);
    const name = $('#nick-name');
    if (animate) reveal(name, v || '…'); else name.textContent = v || '…';
    const tag = $('#nick-tag');
    tag.textContent = ok ? 'bez premium' : 'zły nick';
    tag.classList.toggle('bad', !ok);
    $('#nick-note').textContent = ok
      ? 'Tak zobaczysz siebie w launcherze. Singleplayer, LAN i serwery non-premium działają od razu.'
      : 'Nick ma od 3 do 16 znaków: litery, cyfry i podkreślenie.';
    clearTimeout(headTimer); clearTimeout(hubTimer);
    if (ok) {
      headTimer = setTimeout(() => { head.src = `https://mc-heads.net/avatar/${encodeURIComponent(v)}/96`; }, 350);
      hubTimer = setTimeout(() => hub(v), 600);
    } else { hubSeq++; $('#nick-hub').textContent = ''; }
  }
  nickIn.addEventListener('input', () => { nickIn.value = nickIn.value.replace(/\s+/g, ''); updateNick(false); });
  head.addEventListener('error', () => { if (!head.src.includes('MHF_Steve')) head.src = 'https://mc-heads.net/avatar/MHF_Steve/96'; });
  for (const b of $$('[data-nick]')) b.addEventListener('click', () => { nickIn.value = b.dataset.nick; updateNick(true); nickIn.focus(); });
  updateNick(false);

  // ------------------------------------------------------------------ modules: categories as tabs, each module a sticker you can peel
  const MODS = {
    HUD: [['FPS', 'Liczba klatek na sekundę'], ['CPS', 'Kliknięcia na sekundę (LPM | PPM)'], ['Keystrokes', 'Podgląd wciskanych WASD i myszy'], ['Armor Status', 'Zbroja i jej wytrzymałość'], ['Coordinates', 'Pozycja XYZ, kierunek i biom'], ['Target HUD', 'Informacje o przeciwniku'], ['Potion Effects', 'Aktywne efekty mikstur z czasem'], ['Server Info', 'Flaga, gracze i ping serwera']],
    Render: [['Zoom', 'Przybliżenie widoku pod klawiszem', 'C'], ['Freelook', 'Rozglądanie się wokół postaci', 'Left Alt'], ['Sky Style', 'Kolor nieba, chmury i gwiazdy'], ['Fullbright', 'Pełna jasność w ciemnych miejscach'], ['Crosshair', 'Własny, konfigurowalny celownik'], ['Block Outline', 'Kolorowy obrys bloku pod celownikiem'], ['No Hurt Cam', 'Bez trzęsienia kamery po obrażeniach'], ['Low Fire', 'Niższa nakładka ognia']],
    Gracz: [['Auto Craft', 'Szybkie craftowanie jednym kliknięciem'], ['Toggle Sprint', 'Automatyczny, stały sprint'], ['Auto Respawn', 'Odrodzenie zaraz po śmierci']],
    Narzędzia: [['Chat Macros', 'Wiadomości i komendy pod klawiszem'], ['Coords Share', 'Kopiuje lub wysyła Twoje koordynaty'], ['Durability Alert', 'Ostrzeżenie przed zniszczeniem narzędzia'], ['Low Health Alert', 'Czerwona winieta przy małym życiu'], ['Tab Ping', 'Ping w liczbach na liście graczy'], ['Chat Timestamps', 'Godzina przy każdej wiadomości']],
    Klient: [['Radialne menu', 'Wszystkie moduły na jednym kole', 'Prawy Shift'], ['Szatnia', 'Peleryny, skrzydła i kapelusz'], ['Friends Chat', 'Czat z launchera w grze', 'Y'], ['Discord RPC', 'Status gry w Discordzie'], ['Dynamic FPS', 'Mniej FPS w tle, chłodniejszy komputer']],
  };
  const off = new Set(['Freelook', 'Fullbright', 'Auto Respawn', 'Chat Timestamps']);
  const tabs = $('#mod-tabs');
  const grid = $('#mod-grid');
  function countLine() {
    const all = Object.values(MODS).flat();
    const on = all.filter(([t]) => !off.has(t)).length;
    $('#mod-count').textContent = `Przyklejone: ${on} z ${all.length} pokazanych tutaj. W grze jest ich 97.`;
  }
  function showCat(name) {
    grid.innerHTML = MODS[name].map(([t, d, k], i) => `<button type="button" class="mod" aria-pressed="${!off.has(t)}" data-mod="${esc(t)}" style="--i:${i}"><b>${esc(t)}</b><span>${esc(d)}</span>${k ? `<kbd>${esc(k)}</kbd>` : ''}</button>`).join('');
    for (const b of $$('button', tabs)) { const on = b.dataset.cat === name; b.setAttribute('aria-selected', on); b.tabIndex = on ? 0 : -1; }
    if (!reduced) $$('.mod', grid).forEach((m, i) => { m.style.animationDelay = `${Math.min(i, 7) * 45}ms`; m.classList.add('stuck'); });
    countLine();
  }
  grid.addEventListener('click', (e) => {
    const b = e.target.closest('.mod');
    if (!b) return;
    const t = b.dataset.mod;
    const nowOn = off.has(t);
    if (nowOn) off.delete(t); else off.add(t);
    b.setAttribute('aria-pressed', nowOn);
    b.classList.remove('stuck'); b.style.animationDelay = '0ms';
    if (nowOn && !reduced) { void b.offsetWidth; b.classList.add('stuck'); }
    countLine();
  });
  tabs.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) showCat(b.dataset.cat); });
  tabs.addEventListener('keydown', (e) => {
    const list = $$('button', tabs); const i = list.indexOf(document.activeElement);
    const d = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (d == null || i < 0) return;
    e.preventDefault(); const n = list[(i + d + list.length) % list.length]; n.focus(); showCat(n.dataset.cat);
  });
  showCat('HUD');

  // ------------------------------------------------------------------ MOTD: § codes rendered like the server list
  const src = $('#motd-src');
  const out = $('#motd-out');
  if (src.contentEditable !== 'plaintext-only') src.contentEditable = 'true';
  function motdHtml(text) {
    return text.replace(/\r/g, '').split('\n').slice(0, 2).map((line) => {
      let html = '', cls = ['m-7'];
      for (const part of line.split(/(§[0-9a-fk-or])/i)) {
        const m = /^§([0-9a-fk-or])$/i.exec(part);
        if (m) {
          const c = m[1].toLowerCase();
          if (/[0-9a-f]/.test(c)) cls = ['m-' + c]; else if (c === 'r') cls = ['m-7']; else cls.push('m-' + c);
          continue;
        }
        if (part) html += `<span class="${cls.join(' ')}">${esc(part)}</span>`;
      }
      return html;
    }).join('\n');
  }
  const renderMotd = () => { out.innerHTML = motdHtml(src.innerText); };
  src.addEventListener('input', renderMotd);
  src.addEventListener('paste', (e) => { e.preventDefault(); document.execCommand('insertText', false, (e.clipboardData || window.clipboardData).getData('text')); });
  for (const b of $$('[data-code]')) b.addEventListener('click', () => {
    src.focus();
    const s = getSelection();
    if (!s.rangeCount || !src.contains(s.anchorNode)) { const r = document.createRange(); r.selectNodeContents(src); r.collapse(false); s.removeAllRanges(); s.addRange(r); }
    document.execCommand('insertText', false, b.dataset.code);
    renderMotd();
  });
  renderMotd();
  if (!reduced) setInterval(() => { for (const k of $$('.m-k', out)) k.textContent = [...k.textContent].map((c) => (c === ' ' ? ' ' : GLYPHS[(Math.random() * GLYPHS.length) | 0])).join(''); }, 70);

  // ------------------------------------------------------------------ wardrobe
  const WARD = {
    capes: ['/assets/home/ward-capes.webp', 'Animowane peleryny Halloween w Szatni', 'Ubierz się na F5', 'Trzy animowane peleryny Halloween: Dynia, Nietoperz i Pajęczyna. Do tego Kapelusz Wiedźmy i Skrzydła Nietoperza, widoczne w F5.'],
    history: ['/assets/home/ward-history.webp', 'Animowane peleryny z kolekcji Historia Nore', 'Historia Nore', 'Peleryny z historii klienta i dziewięć kolorów. Wszystkie animowane i widoczne też na elytrze.'],
    hat: ['/assets/home/ward-hat.webp', 'Gracz w Kapeluszu Wiedźmy z fioletową klamrą, widok z przodu w F5', 'Kapelusz Wiedźmy', 'Fioletowy kapelusz ze złotą klamrą kołysze się, kiedy biegniesz. Gdy założysz hełm, kapelusz sam się chowa.'],
    wings: ['/assets/home/ward-wings.webp', 'Gracz ze Skrzydłami Nietoperza i peleryną Halloween, widok z tyłu w F5', 'Skrzydła Nietoperza', 'Na ziemi oddychają powoli, w locie, na elytrze i przy spadaniu biją mocniej. Z żarzącą się krawędzią i pazurem na nadgarstku.'],
  };
  const wtabs = $$('.ward .seg button');
  const wimg = $('#ward-img');
  function showWard(key) {
    const [img, alt, title, desc] = WARD[key];
    for (const b of wtabs) { const on = b.dataset.w === key; b.setAttribute('aria-selected', on); b.tabIndex = on ? 0 : -1; }
    wimg.classList.add('swap');
    setTimeout(() => {
      wimg.src = img; wimg.alt = alt;
      const done = () => wimg.classList.remove('swap');
      wimg.onload = done; setTimeout(done, 400);
    }, reduced ? 0 : 160);
    $('#ward-title').textContent = title;
    $('#ward-desc').textContent = desc;
    $('.capes').hidden = key !== 'capes';
  }
  for (const b of wtabs) b.addEventListener('click', () => showWard(b.dataset.w));
  $('.ward .seg').addEventListener('keydown', (e) => {
    const i = wtabs.indexOf(document.activeElement); const d = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
    if (d == null || i < 0) return;
    e.preventDefault(); const n = wtabs[(i + d + wtabs.length) % wtabs.length]; n.focus(); showWard(n.dataset.w);
  });
  wtabs.forEach((b, i) => { b.tabIndex = i === 0 ? 0 : -1; });

  // ------------------------------------------------------------------ events: hero label, the board tile, countdowns
  const H = N.state.halloween;
  function dur(t) {
    if (t.d > 0) return `${t.d} ${plural(t.d, 'dzień', 'dni', 'dni')} ${t.h} godz.`;
    return `${t.h} godz. ${t.m} min`;
  }
  function paintEvent(st) {
    const tag = $('#hero-tag'), sprite = $('#hero-sprite');
    const tile = $('#tile-ev'), tileImg = $('#tile-ev-img');
    if (st.event === 'winter') {
      tag.hidden = false; tag.classList.add('winter'); tag.innerHTML = 'Seria zimowa<br>trwa';
      sprite.hidden = false; sprite.src = '/assets/album/flake-sticker.png';
      tileImg.src = '/assets/album/flake-sticker.png';
      tile.style.background = 'var(--nore-winter-frost)';
      $('#tile-ev-title').textContent = 'Zima trwa'; $('#tile-ev-text').textContent = 'Śnieg i lampki w menu gry.';
    } else if (st.event === 'halloween') {
      tag.hidden = false; tag.classList.remove('winter'); tag.innerHTML = 'Halloween<br>do 3 listopada';
      sprite.hidden = false; sprite.src = '/assets/album/pumpkin-sticker.png';
    } else {
      tag.hidden = false; tag.classList.add('winter'); tag.innerHTML = 'Zima<br>od 10 grudnia';
      sprite.hidden = true;
      tileImg.src = '/assets/album/flake-sticker.png';
      tile.style.background = 'var(--nore-winter-frost)';
      $('#tile-ev-title').textContent = 'Zima od 10 grudnia'; $('#tile-ev-text').textContent = 'Śnieg i lampki włączą się same.';
    }
  }
  N.onEvent(paintEvent);

  function tick() {
    const now = Date.now();
    const hc = $('#hw-count');
    if (now < Date.parse(H.peak)) hc.textContent = `Do Nocy Halloween: ${dur(N.until(H.peak))}`;
    else if (now < Date.parse(H.end)) hc.textContent = `Ostatnie dni, do końca eventu: ${dur(N.until(H.end))}`;
    else hc.textContent = 'Tegoroczne Halloween się skończyło. Wraca 15 października.';
    const ws = N.state.winterStart;
    const t = N.until(ws);
    const clock = $('#wt-clock');
    if (t.total > 0) {
      const parts = [[t.d, plural(t.d, 'dzień', 'dni', 'dni')], [t.h, 'godz.'], [t.m, 'min'], [t.s, 's']];
      clock.innerHTML = parts.map(([v, l]) => `<span><b>${v}</b>${l}</span>`).join('');
      clock.setAttribute('aria-label', `Do zimy: ${t.d} dni, ${t.h} godzin, ${t.m} minut`);
    } else clock.innerHTML = '<span><b>Trwa</b>śnieg i lampki są w grze</span>';
  }
  tick();
  setInterval(tick, 1000);

  // ------------------------------------------------------------------ the moving picture plays only while seen
  const vid = $('.t-upd video');
  if (vid) {
    if (reduced) { vid.removeAttribute('autoplay'); vid.pause(); }
    else if ('IntersectionObserver' in window) new IntersectionObserver(([e]) => { if (e.isIntersecting) vid.play().catch(() => {}); else vid.pause(); }, { threshold: 0.3 }).observe(vid);
  }
})();
