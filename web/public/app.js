'use strict';
/* Nore Client website: chapter-coloured bar, nick preview, live MOTD, module agenda, wardrobe,
   entrances and the download picker. Everything degrades to the static page without script. */
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  document.documentElement.classList.add('js');

  // ------------------------------------------------------------------ bar takes the chapter under it
  const CH = {
    paper: ['#f4eeff', '#1a0f3d'], fiolet: ['#9d5cff', '#14082e'], pastel: ['#f7b6e0', '#2b0b24'],
    kosmos: ['#1a0f3d', '#f4eeff'], zorza: ['#2ee6a6', '#04281c'], zachod: ['#ff7a59', '#2a0b03'],
  };
  const bar = $('#bar');
  let lastCh = '';
  function paintBar() {
    const y = bar.offsetHeight / 2;
    let ch = 'paper';
    for (const el of document.elementsFromPoint(innerWidth / 2, y)) {
      if (bar.contains(el)) continue;
      const c = el.closest('[data-chapter]');
      if (c) { ch = c.dataset.chapter; break; }
    }
    // the hero's upper field is paper even though the section is Fiolet
    const r = $('#top').getBoundingClientRect();
    const seam = parseFloat(getComputedStyle($('#top')).getPropertyValue('--seam')) || 50;
    if (ch === 'fiolet' && r.top <= y && y < r.top + innerHeight * seam / 100) ch = 'paper';
    if (ch === lastCh) return;
    lastCh = ch;
    const [bg, ink] = CH[ch] || CH.paper;
    bar.style.setProperty('--bar-bg', bg);
    bar.style.setProperty('--bar-ink', ink);
    bar.style.setProperty('--bar-act', bg);
  }
  // the menu screenshot keeps rising out of the violet field while the hero scrolls away
  const plate = $('.hero-plate');
  function drift() {
    if (reduced || !plate.classList.contains('in')) return;
    const y = Math.min(scrollY, innerHeight * 1.5);
    plate.style.transform = `translate3d(0, ${(-y * 0.12).toFixed(1)}px, 0)`;
  }
  let ticking = false;
  addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(() => { ticking = false; paintBar(); drift(); }); } }, { passive: true });
  addEventListener('resize', paintBar);
  paintBar();

  // ------------------------------------------------------------------ entrances: parts of every section, staggered
  const io = 'IntersectionObserver' in window && !reduced ? new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
  }, { threshold: 0.15, rootMargin: '0px 0px -6% 0px' }) : null;
  for (const sec of $$('main > section, main > section > div, footer')) {
    $$(':scope .rv', sec).forEach((el, i) => { if (!el.style.getPropertyValue('--d')) el.style.setProperty('--d', `${Math.min(i, 6) * 80}ms`); });
  }
  for (const el of $$('.rv')) io ? io.observe(el) : el.classList.add('in');

  // ------------------------------------------------------------------ §k: obfuscated glyphs that resolve
  const GLYPHS = 'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789';
  function reveal(el, text, ms = 520) {
    if (reduced) { el.textContent = text; return; }
    cancelAnimationFrame(el._raf);
    const t0 = performance.now();
    const step = (now) => {
      const p = Math.min(1, (now - t0) / ms);
      const n = Math.floor(p * text.length);
      el.textContent = text.slice(0, n) + [...text.slice(n)].map(c => c === ' ' ? ' ' : GLYPHS[(Math.random() * GLYPHS.length) | 0]).join('');
      if (p < 1) el._raf = requestAnimationFrame(step);
    };
    el._raf = requestAnimationFrame(step);
  }

  // ------------------------------------------------------------------ the nick line
  const nickIn = $('#nick-in');
  const caret = $('.caret');
  const measure = document.createElement('canvas').getContext('2d');
  function placeCaret() {
    const cs = getComputedStyle(nickIn);
    measure.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    measure.letterSpacing = cs.letterSpacing;
    const w = measure.measureText(nickIn.value).width;
    caret.style.setProperty('--caret-x', Math.min(w + 6, nickIn.clientWidth - 8) - nickIn.scrollLeft + 'px');
  }
  let headTimer = 0;
  function updateNick(animate) {
    const v = nickIn.value.trim();
    const ok = /^[A-Za-z0-9_]{3,16}$/.test(v);
    const name = $('#nick-name');
    if (animate) reveal(name, v || '…'); else name.textContent = v || '…';
    const tag = $('.acc-tag');
    tag.textContent = ok ? '[NON-PREMIUM]' : '[ZŁY NICK]';
    tag.classList.toggle('bad', !ok);
    $('#nick-note').textContent = ok
      ? 'Tak zobaczysz siebie w launcherze. Singleplayer, LAN i serwery non-premium działają od razu.'
      : 'Nick ma od 3 do 16 znaków: litery, cyfry i podkreślenie.';
    clearTimeout(headTimer);
    if (ok) headTimer = setTimeout(() => { $('#nick-head').src = `https://mc-heads.net/avatar/${encodeURIComponent(v)}/96`; }, 350);
    placeCaret();
  }
  nickIn.addEventListener('input', () => {
    nickIn.value = nickIn.value.replace(/\s+/g, '');
    updateNick(false);
  });
  nickIn.addEventListener('keyup', placeCaret);
  nickIn.addEventListener('scroll', placeCaret);
  addEventListener('resize', placeCaret);
  $('#nick-head').addEventListener('error', (e) => { e.target.src = 'https://mc-heads.net/avatar/MHF_Steve/96'; }, { once: false });
  for (const b of $$('[data-nick]')) b.addEventListener('click', () => { nickIn.value = b.dataset.nick; updateNick(true); nickIn.focus(); });
  document.fonts && document.fonts.ready.then(placeCaret);
  updateNick(false);

  // ------------------------------------------------------------------ MOTD: § codes rendered like the server list
  const src = $('#motd-src');
  const out = $('#motd-out');
  if (src.contentEditable !== 'plaintext-only') src.contentEditable = 'true';
  const esc = (s) => s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  function motdHtml(text) {
    const lines = text.replace(/\r/g, '').split('\n').slice(0, 2);
    return lines.map(line => {
      let html = '', cls = ['m-7'];
      for (const part of line.split(/(§[0-9a-fk-or])/i)) {
        const m = /^§([0-9a-fk-or])$/i.exec(part);
        if (m) {
          const c = m[1].toLowerCase();
          if (/[0-9a-f]/.test(c)) cls = ['m-' + c];
          else if (c === 'r') cls = ['m-7'];
          else cls.push('m-' + c);
          continue;
        }
        if (part) html += `<span class="${cls.join(' ')}">${esc(part)}</span>`;
      }
      return html;
    }).join('\n');
  }
  function renderMotd() { out.innerHTML = motdHtml(src.innerText); }
  src.addEventListener('input', renderMotd);
  src.addEventListener('paste', (e) => {
    e.preventDefault();
    document.execCommand('insertText', false, (e.clipboardData || window.clipboardData).getData('text'));
  });
  for (const b of $$('[data-code]')) b.addEventListener('click', () => {
    src.focus();
    const sel = getSelection();
    if (!sel.rangeCount || !src.contains(sel.anchorNode)) { const r = document.createRange(); r.selectNodeContents(src); r.collapse(false); sel.removeAllRanges(); sel.addRange(r); }
    document.execCommand('insertText', false, b.dataset.code);
    renderMotd();
  });
  renderMotd();
  if (!reduced) setInterval(() => {
    for (const k of $$('.m-k', out)) k.textContent = [...k.textContent].map(c => c === ' ' ? ' ' : GLYPHS[(Math.random() * GLYPHS.length) | 0]).join('');
  }, 70);

  // ------------------------------------------------------------------ modules: categories as tabs, modules as bands
  const MODS = {
    HUD: [['FPS', 'Liczba klatek na sekundę'], ['CPS', 'Kliknięcia na sekundę (LPM | PPM)'], ['Keystrokes', 'Podgląd wciskanych WASD i myszy'], ['Armor Status', 'Zbroja i jej wytrzymałość'], ['Coordinates', 'Pozycja XYZ, kierunek i biom'], ['Target HUD', 'Informacje o przeciwniku'], ['Potion Effects', 'Aktywne efekty mikstur z czasem'], ['Server Info', 'Flaga, gracze i ping serwera']],
    Render: [['Zoom', 'Przybliżenie widoku pod klawiszem', 'C'], ['Freelook', 'Rozglądanie się wokół postaci', 'Left Alt'], ['Sky Style', 'Kolor nieba, chmury i gwiazdy'], ['Fullbright', 'Pełna jasność w ciemnych miejscach'], ['Crosshair', 'Własny, konfigurowalny celownik'], ['Block Outline', 'Kolorowy obrys bloku pod celownikiem'], ['No Hurt Cam', 'Bez trzęsienia kamery po obrażeniach'], ['Low Fire', 'Niższa nakładka ognia']],
    Gracz: [['Auto Craft', 'Szybkie craftowanie jednym kliknięciem'], ['Toggle Sprint', 'Automatyczny, stały sprint'], ['Auto Respawn', 'Odrodzenie zaraz po śmierci']],
    Narzędzia: [['Chat Macros', 'Wiadomości i komendy pod klawiszem'], ['Coords Share', 'Kopiuje lub wysyła Twoje koordynaty'], ['Durability Alert', 'Ostrzeżenie przed zniszczeniem narzędzia'], ['Low Health Alert', 'Czerwona winieta przy małym życiu'], ['Tab Ping', 'Ping w liczbach na liście graczy'], ['Chat Timestamps', 'Godzina przy każdej wiadomości']],
    Klient: [['Radialne menu', 'Wszystkie moduły na jednym kole', 'Prawy Shift'], ['Szatnia', 'Peleryny, skrzydła i kapelusz'], ['Friends Chat', 'Czat z launchera w grze', 'Y'], ['Discord RPC', 'Status gry w Discordzie'], ['Dynamic FPS', 'Mniej FPS w tle, chłodniejszy komputer']],
  };
  const tabs = $('#mod-tabs');
  const bands = $('#mod-bands');
  const names = Object.keys(MODS);
  tabs.innerHTML = names.map((n, i) => `<button role="tab" id="tab-${i}" aria-selected="${i === 0}" tabindex="${i === 0 ? 0 : -1}" data-cat="${n}"><b>${n}</b><small>${MODS[n].length} na liście</small></button>`).join('');
  function showCat(name) {
    bands.innerHTML = MODS[name].map(([t, d, k], i) => `<div class="band" style="--i:${i}"><b>${t}</b><p>${d}</p>${k ? `<kbd>${k}</kbd>` : '<span></span>'}</div>`).join('');
    for (const b of $$('button', tabs)) { const on = b.dataset.cat === name; b.setAttribute('aria-selected', on); b.tabIndex = on ? 0 : -1; }
  }
  tabs.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) showCat(b.dataset.cat); });
  tabs.addEventListener('keydown', (e) => {
    const list = $$('button', tabs); const i = list.indexOf(document.activeElement);
    const d = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[e.key];
    if (d == null || i < 0) return;
    e.preventDefault(); const n = list[(i + d + list.length) % list.length]; n.focus(); showCat(n.dataset.cat);
  });
  showCat(names[0]);

  // ------------------------------------------------------------------ wardrobe
  const WARD = {
    capes: ['/assets/home/ward-capes.webp', 'Animowane peleryny Halloween w Szatni', 'Ubierz się na F5', 'Trzy animowane peleryny Halloween: Dynia, Nietoperz i Pajęczyna. Do tego Kapelusz Wiedźmy i Skrzydła Nietoperza, widoczne w F5.'],
    history: ['/assets/home/ward-history.webp', 'Animowane peleryny z kolekcji Historia Nore', 'Historia Nore', 'Peleryny z historii klienta i dziewięć kolorów. Wszystkie animowane i widoczne też na elytrze. Widzisz je tylko Ty.'],
    hat: ['/assets/home/ward-hat.webp', 'Gracz w Kapeluszu Wiedźmy z fioletową klamrą, widok z przodu w F5', 'Kapelusz Wiedźmy', 'Fioletowy kapelusz ze złotą klamrą kołysze się, kiedy biegniesz. Gdy założysz hełm, kapelusz sam się chowa.'],
    wings: ['/assets/home/ward-wings.webp', 'Gracz ze Skrzydłami Nietoperza i peleryną Halloween, widok z tyłu w F5', 'Skrzydła Nietoperza', 'Na ziemi oddychają powoli, w locie, na elytrze i przy spadaniu biją mocniej. Z żarzącą się krawędzią i pazurem na nadgarstku.'],
  };
  const ptabs = $$('.ptabs button');
  const wimg = $('#ward-img');
  function showWard(key) {
    const [img, alt, title, desc] = WARD[key];
    for (const b of ptabs) { const on = b.dataset.w === key; b.setAttribute('aria-selected', on); b.tabIndex = on ? 0 : -1; }
    wimg.classList.add('swap');
    setTimeout(() => { wimg.src = img; wimg.alt = alt; wimg.onload = () => wimg.classList.remove('swap'); setTimeout(() => wimg.classList.remove('swap'), 400); }, reduced ? 0 : 180);
    $('#ward-title').textContent = title;
    $('#ward-desc').textContent = desc;
  }
  for (const b of ptabs) b.addEventListener('click', () => showWard(b.dataset.w));
  $('.ptabs').addEventListener('keydown', (e) => {
    const i = ptabs.indexOf(document.activeElement); const d = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
    if (d == null || i < 0) return;
    e.preventDefault(); const n = ptabs[(i + d + ptabs.length) % ptabs.length]; n.focus(); showWard(n.dataset.w);
  });

  // ------------------------------------------------------------------ winter countdown
  const days = Math.ceil((Date.parse('2026-12-10T00:00:00+01:00') - Date.now()) / 86400000);
  if (days > 0) $('#ev-days').textContent = days;
  else $('#ev-count').textContent = 'Zimowy event trwa – śnieg i lampki są już w grze.';

  // ------------------------------------------------------------------ the moving picture plays only while seen
  const vid = $('.tile video');
  if (vid) {
    if (reduced) { vid.removeAttribute('autoplay'); vid.pause(); }
    else if ('IntersectionObserver' in window) new IntersectionObserver(([e]) => { e.isIntersecting ? vid.play().catch(() => {}) : vid.pause(); }, { threshold: 0.3 }).observe(vid);
  }

  // ------------------------------------------------------------------ download: the visitor's system, the newest version
  const OS_LABEL = { win: 'Windows', linux: 'Linux', mac: 'macOS' };
  const ua = navigator.userAgent;
  const os = /Mac/.test(ua) && !/iPhone|iPad/.test(ua) ? 'mac' : /Linux/.test(ua) && !/Android/.test(ua) ? 'linux' : 'win';
  const heroBtn = $('#dl-hero');
  heroBtn.href = `/api/v1/download/${os}`;
  heroBtn.textContent = `Pobierz dla ${OS_LABEL[os]}`;
  const sel = $('#cta-os');
  sel.value = os;
  $('#cta-form').addEventListener('submit', (e) => { e.preventDefault(); location.href = `/api/v1/download/${sel.value}`; });
  fetch('/api/v1/version').then(r => r.ok ? r.json() : null).then(v => {
    if (!v || !v.version) return;
    $('#hero-ver').textContent = `Wersja ${v.version} · Minecraft 1.20 – 26.3`;
    $('#cta-note').textContent = `Wersja ${v.version} prosto z GitHub Releases. Instalator sam przeprowadzi Cię przez konto, wygląd i pamięć.`;
  }).catch(() => {});
})();
