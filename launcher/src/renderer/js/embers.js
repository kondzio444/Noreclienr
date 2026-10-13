'use strict';
/* Glowing embers rising over the background, reacting softly to the mouse. */
(function () {
  const canvas = document.getElementById('embers');
  const ctx = canvas.getContext('2d');
  let w = 0, h = 0, dpr = 1, mx = 0.5, my = 0.5;
  const parts = [];
  let enabled = true;

  function resize() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    w = canvas.clientWidth; h = canvas.clientHeight;
    canvas.width = w * dpr; canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function spawn(initial) {
    return {
      x: Math.random() * w,
      y: initial ? Math.random() * h : h + 10,
      r: 0.6 + Math.random() * 2.2,
      vy: 0.15 + Math.random() * 0.55,
      vx: (Math.random() - 0.5) * 0.25,
      life: 0, max: 400 + Math.random() * 700,
      hue: 18 + Math.random() * 22,
      phase: Math.random() * Math.PI * 2,
    };
  }

  function frame(t) {
    requestAnimationFrame(frame);
    if (!enabled || document.hidden) return;
    ctx.clearRect(0, 0, w, h);
    while (parts.length < Math.min(90, (w * h) / 14000)) parts.push(spawn(parts.length < 40));
    ctx.globalCompositeOperation = 'lighter';
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      p.life++;
      p.y -= p.vy;
      p.x += p.vx + Math.sin(t / 1400 + p.phase) * 0.25 + (mx - 0.5) * 0.15;
      const fade = Math.min(1, p.life / 60) * Math.max(0, 1 - p.life / p.max);
      if (p.y < -20 || p.life > p.max) { parts.splice(i, 1); continue; }
      const flicker = 0.7 + 0.3 * Math.sin(t / 200 + p.phase * 3);
      const a = fade * flicker;
      const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r * 5);
      g.addColorStop(0, `hsla(${p.hue}, 100%, 70%, ${0.9 * a})`);
      g.addColorStop(0.35, `hsla(${p.hue}, 100%, 55%, ${0.35 * a})`);
      g.addColorStop(1, `hsla(${p.hue}, 100%, 50%, 0)`);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r * 5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  window.addEventListener('resize', resize);
  window.addEventListener('mousemove', (e) => {
    mx = e.clientX / window.innerWidth; my = e.clientY / window.innerHeight;
    const photo = document.querySelector('#bg .photo');
    if (photo) photo.style.transform = `translate(${(0.5 - mx) * 18}px, ${(0.5 - my) * 12}px)`;
  });
  window.Embers = { setEnabled(v) { enabled = v; if (!v) ctx.clearRect(0, 0, w, h); } };
  resize();
  requestAnimationFrame(frame);
})();
