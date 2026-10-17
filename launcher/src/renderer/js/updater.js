'use strict';
/* Nore Updater splash: shows the launcher update states sent by the main process. */
(() => {
  const $ = (id) => document.getElementById(id);
  const RING = 339.3;
  const body = document.body;
  let lastStatus = '';

  const mb = (b) => (b / 1048576).toFixed(b >= 104857600 ? 0 : 1) + ' MB';

  // §k: the title scrambles into its new text, as obfuscated text does in Minecraft
  const GLYPHS = 'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789';
  const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let lastTitle = '';
  let raf = 0;
  function title(text) {
    const el = $('title');
    if (text === lastTitle) return;
    lastTitle = text;
    cancelAnimationFrame(raf);
    if (calm) { el.textContent = text; return; }
    const t0 = performance.now();
    const step = (now) => {
      const p = Math.min(1, (now - t0) / 480);
      const n = Math.floor(p * text.length);
      el.textContent = text.slice(0, n) + [...text.slice(n)].map(c => c === ' ' ? ' ' : GLYPHS[(Math.random() * GLYPHS.length) | 0]).join('');
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
  }

  function status(text) {
    const el = $('status');
    if (text === lastStatus) return;
    lastStatus = text;
    el.textContent = text;
    el.classList.remove('swap');
    void el.offsetWidth;
    el.classList.add('swap');
  }

  function mode(...names) {
    body.classList.remove('progress', 'done', 'error', 'installing');
    for (const n of names) body.classList.add(n);
  }

  function progress(pct) {
    const p = Math.max(0, Math.min(100, pct || 0));
    $('prog').style.strokeDashoffset = String(RING * (1 - p / 100));
    $('fill').style.width = p + '%';
    $('pct').textContent = Math.round(p) + '%';
  }

  function buttons({ skip = false, go = false } = {}) {
    $('skip').hidden = !skip;
    $('go').hidden = !go;
  }

  function render(s) {
    if (s.version) $('ver').textContent = 'Wersja ' + s.version;
    const next = s.next ? ' ' + s.next : '';
    switch (s.state) {
      case 'checking':
      case 'idle':
        mode(); buttons();
        title('Nore Launcher');
        status('Szukam aktualizacji…');
        $('meta').textContent = '';
        break;
      case 'available':
        mode('progress'); progress(0); buttons({ skip: true });
        title('Nowa wersja' + next);
        status('Przygotowuję pobieranie…');
        $('meta').textContent = s.size ? mb(s.size) : '';
        break;
      case 'downloading':
        mode('progress'); progress(s.percent); buttons({ skip: true });
        title('Aktualizacja' + next);
        status('Pobieram nową wersję…');
        $('meta').textContent = s.size && s.bytes != null
          ? `${mb(s.bytes)} / ${mb(s.size)}${s.speed ? ' · ' + mb(s.speed) + '/s' : ''}`
          : '';
        break;
      case 'verifying':
        mode('progress'); progress(100); buttons();
        status('Sprawdzam sumę kontrolną…');
        break;
      case 'ready':
      case 'installing':
        mode('progress', 'installing'); progress(100); buttons();
        title('Instaluję' + next);
        status('Launcher uruchomi się ponownie za chwilę');
        $('meta').textContent = '';
        break;
      case 'latest':
      case 'dev':
        mode('done'); buttons();
        title('Wszystko gotowe');
        status('Masz najnowszą wersję Nore');
        $('meta').textContent = '';
        break;
      case 'updated':
        mode('done'); buttons({ go: true });
        title('Zaktualizowano!');
        status('Nore Launcher ' + s.version + ' jest gotowy');
        break;
      case 'installed':
        mode('done'); buttons({ go: true });
        title('Witaj w Nore!');
        status('Nore Launcher ' + s.version + ' został zainstalowany');
        break;
      case 'error':
        mode('error'); buttons();
        title('Nore Launcher');
        status('Nie udało się sprawdzić aktualizacji');
        $('meta').textContent = s.message || '';
        break;
      default:
        break;
    }
    if (s.notes != null) $('notes').textContent = String(s.notes).replace(/[#*_`>]/g, '').trim();
  }

  $('skip').onclick = () => window.noreUpdater.skip();
  $('go').onclick = () => window.noreUpdater.skip();
  window.noreUpdater.onState(render);

  // ---- drifting violet stars behind the card
  const c = $('stars');
  const g = c.getContext('2d');
  const stars = Array.from({ length: 70 }, () => ({ x: Math.random(), y: Math.random(), z: 0.3 + Math.random() * 0.7, t: Math.random() * 6.28 }));
  function frame(ms) {
    const w = (c.width = innerWidth * devicePixelRatio);
    const h = (c.height = innerHeight * devicePixelRatio);
    for (const s of stars) {
      s.y -= 0.00018 * s.z;
      if (s.y < -0.02) { s.y = 1.02; s.x = Math.random(); }
      const a = 0.25 + 0.45 * (0.5 + 0.5 * Math.sin(ms / 700 + s.t));
      g.fillStyle = `rgba(${s.z > 0.75 ? '232,220,255' : '168,120,255'},${a * s.z})`;
      const r = (0.6 + s.z * 1.4) * devicePixelRatio;
      g.beginPath();
      g.arc(s.x * w, s.y * h, r, 0, 6.283);
      g.fill();
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
