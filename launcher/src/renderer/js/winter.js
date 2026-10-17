'use strict';
/*
 * "Święta w Nore" winter event. Forced on (cannot be switched off) from 10 December 2026 local time:
 * falling snow over the launcher, fairy lights along the title bar, a snow cap on the logo and an
 * event card on the home page. Nothing changes before that date.
 */
(function () {
  const START = new Date(2026, 11, 10, 0, 0, 0).getTime();
  const noAnim = () => document.body.classList.contains('no-anim');
  let started = false;

  function active(now = Date.now()) { return now >= START; }

  // ---------------------------------------------------------------- snow
  function snow() {
    const c = document.createElement('canvas');
    c.id = 'winter-snow';
    document.body.appendChild(c);
    const g = c.getContext('2d');
    const flakes = Array.from({ length: 110 }, () => ({
      x: Math.random(), y: Math.random(), r: 0.6 + Math.random() * 2.2,
      vy: 0.012 + Math.random() * 0.03, sway: Math.random() * 6.28, sp: 0.4 + Math.random() * 0.9,
    }));
    let last = performance.now();
    function frame(now) {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const w = c.clientWidth, h = c.clientHeight, dpr = devicePixelRatio || 1;
      if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, w, h);
      if (!noAnim() && !document.hidden) {
        for (const f of flakes) {
          f.y += f.vy * dt * 6 * f.sp;
          f.sway += dt * f.sp;
          if (f.y > 1.02) { f.y = -0.02; f.x = Math.random(); }
          const x = (f.x + Math.sin(f.sway) * 0.012) * w;
          const a = 0.35 + f.r / 4;
          g.fillStyle = `rgba(240, 236, 255, ${a})`;
          g.beginPath();
          g.arc(x, f.y * h, f.r, 0, 6.283);
          g.fill();
        }
      }
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  // ---------------------------------------------------------------- fairy lights in the title bar
  function lights() {
    const bar = document.getElementById('titlebar');
    if (!bar) return;
    const wrap = document.createElement('div');
    wrap.className = 'winter-lights';
    const colors = ['#ff4d6d', '#ffd166', '#6ee7b7', '#7cc4ff', '#c8a8ff'];
    const n = 34;
    let html = '<svg class="wire" viewBox="0 0 1000 24" preserveAspectRatio="none"><path d="';
    for (let i = 0; i <= 17; i++) html += `${i ? 'Q' : 'M'}${i ? (i - 0.5) * 58.8 + ' 22 ' : ''}${i * 58.8} 4 `;
    html += '"/></svg>';
    for (let i = 0; i < n; i++) {
      const x = (i + 0.5) / n * 100;
      const sag = Math.sin(((i + 0.5) / n * 17) % 1 * Math.PI) * 15;
      html += `<i style="left:${x}%;top:${4 + sag}px;--c:${colors[i % colors.length]};--d:${(i * 0.37) % 2.4}s"></i>`;
    }
    wrap.innerHTML = html;
    bar.appendChild(wrap);
  }

  // ---------------------------------------------------------------- home page card
  function daysTo(month, day) {
    const now = new Date();
    let t = new Date(now.getFullYear(), month, day);
    if (t < new Date(now.getFullYear(), now.getMonth(), now.getDate())) t = new Date(now.getFullYear() + 1, month, day);
    return Math.round((t - new Date(now.getFullYear(), now.getMonth(), now.getDate())) / 86400000);
  }

  function card() {
    const dWigilia = daysTo(11, 24);
    const dNewYear = daysTo(0, 1);
    const line = dWigilia === 0 ? 'Wesołych Świąt! Dziś Wigilia 🎄'
      : dWigilia <= 14 ? `Do Wigilii: ${dWigilia} ${dWigilia === 1 ? 'dzień' : 'dni'}`
      : dNewYear === 0 ? 'Szczęśliwego Nowego Roku!'
      : `Do Nowego Roku: ${dNewYear} ${dNewYear === 1 ? 'dzień' : 'dni'}`;
    const el = document.createElement('section');
    el.className = 'card winter-card';
    el.innerHTML = `
      <div class="wc-tree" aria-hidden="true">${tree()}</div>
      <div class="wc-text">
        <span class="wc-tag">EVENT · ZAWSZE WŁĄCZONY</span>
        <b>Święta w Nore</b>
        <small>Śnieg w launcherze i w menu gry, świąteczne lampki i zimowy motyw.</small>
      </div>
      <div class="wc-count">${line}</div>`;
    return el;
  }

  function tree() {
    // tiny pixel-art tree with blinking baubles
    const rows = ['....*....', '...ggg...', '..gogrg..', '...ggg...', '..ggygg..', '.grgggbg.', '...ggg...', '..gggogg.', '.gbggggrg', '....t....', '....t....'];
    const col = { g: '#3fbf6a', o: '#ffb347', r: '#ff4d6d', y: '#ffd166', b: '#7cc4ff', t: '#7a4a2a', '*': '#ffe27a' };
    let s = '<svg viewBox="0 0 9 11" shape-rendering="crispEdges">';
    rows.forEach((row, y) => [...row].forEach((ch, x) => {
      if (ch === '.') return;
      const blink = 'orby*'.includes(ch) ? ` class="bl" style="animation-delay:${((x * 7 + y * 3) % 10) / 5}s"` : '';
      s += `<rect x="${x}" y="${y}" width="1" height="1" fill="${col[ch]}"${blink}/>`;
    }));
    return s + '</svg>';
  }

  function watchHome() {
    const view = document.getElementById('view');
    if (!view) return;
    const place = () => {
      const hero = view.querySelector('.h14-hero');
      if (hero && !view.querySelector('.winter-card')) hero.insertAdjacentElement('afterend', card());
    };
    new MutationObserver(place).observe(view, { childList: true, subtree: true });
    place();
  }

  function start() {
    if (started) return;
    started = true;
    document.body.classList.add('winter');
    snow();
    lights();
    watchHome();
  }

  function boot() {
    if (active()) return start();
    // a launcher left open over midnight on 10 December starts the event by itself
    const left = START - Date.now();
    if (left < 2147483647) setTimeout(start, left + 1000);
  }

  window.NoreWinter = { active, start, START };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
