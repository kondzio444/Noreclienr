'use strict';
/*
 * Premium login gate. Nore Launcher only opens for a verified Minecraft: Java Edition account:
 * on start the main process checks the session with Microsoft/Mojang, and until that succeeds this
 * full-screen gate is all there is (the main process also refuses every other request).
 * The password is only ever typed on microsoft.com – the launcher receives tokens, encrypted at rest.
 */
const LoginGate = (() => {
  const clean = (e) => String((e && e.message) || e || '').replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

  function ring() {
    return `<div class="lg-orb"><div class="lg-orb-ring r1"></div><div class="lg-orb-ring r2"></div><div class="lg-orb-ring r3"></div>
      <img src="assets/logo.png" alt=""><div class="lg-orb-glow"></div></div>`;
  }

  function build(note) {
    const root = el(`<div id="login-gate">
      <canvas class="lg-stars"></canvas>
      <div class="lg-grid"></div>
      <div class="lg-card">
        <div class="lg-side">
          ${ring()}
          <h1>NORE<span>CLIENT</span></h1>
          <p class="lg-tag">Launcher tylko dla kont <b>Minecraft Premium</b></p>
          <ul class="lg-points">
            <li>${icon('shield')}<span>Hasło wpisujesz wyłącznie na stronie Microsoft – launcher nigdy go nie widzi.</span></li>
            <li>${icon('key')}<span>Tokeny sesji są szyfrowane przez system (Windows DPAPI / Keychain).</span></li>
            <li>${icon('check')}<span>Sesja jest sprawdzana w Mojang przy każdym uruchomieniu.</span></li>
          </ul>
        </div>
        <div class="lg-main" id="lg-main"></div>
      </div>
      <div class="lg-foot">Nore Client nie jest powiązany z Mojang Studios ani Microsoft.</div>
    </div>`);
    document.body.appendChild(root);
    stars($('.lg-stars', root));
    start($('#lg-main', root), note);
    return root;
  }

  function idle(main, note) {
    main.innerHTML = `<div class="lg-step in">
      <div class="lg-kicker">KROK 1 Z 2</div>
      <h2>Zaloguj się kontem Microsoft</h2>
      <p class="lg-sub">Użyj konta, na którym kupiłeś Minecraft: Java Edition (lub masz Game Pass).</p>
      ${note ? `<div class="lg-alert">${icon('info')}<span>${esc(note)}</span></div>` : ''}
      <button class="lg-ms" id="lg-go"><span class="ms-grid"><i style="background:#f25022"></i><i style="background:#7fba00"></i><i style="background:#00a4ef"></i><i style="background:#ffb900"></i></span>Zaloguj przez Microsoft</button>
      <div class="lg-flow">${['Microsoft', 'Xbox Live', 'Minecraft'].map((t, i) => `<div class="lg-flow-step" style="--i:${i}"><i></i><span>${t}</span></div>`).join('<b></b>')}</div>
    </div>`;
  }

  let resolveGate = null;

  async function start(main, note) {
    idle(main, note);
    $('#lg-go', main).onclick = () => login(main);
  }

  async function login(main) {
    let session;
    main.innerHTML = `<div class="lg-step in"><div class="lg-kicker">ŁĄCZENIE</div><h2>Łączenie z Microsoft…</h2><div class="lg-loader"><span></span><span></span><span></span></div></div>`;
    try {
      session = await nore.accounts.msStart();
    } catch (e) {
      return start(main, clean(e));
    }
    const ttl = session.expiresIn * 1000, t0 = Date.now();
    main.innerHTML = `<div class="lg-step in">
      <div class="lg-kicker">KROK 2 Z 2</div>
      <h2>Wpisz ten kod na stronie Microsoft</h2>
      <p class="lg-sub">Strona otworzyła się w przeglądarce. Jeśli nie – kliknij przycisk poniżej.</p>
      <div class="lg-code" id="lg-code" title="Kliknij, aby skopiować">${[...session.userCode].map((c, i) => `<span style="--i:${i}">${esc(c)}</span>`).join('')}</div>
      <div class="row" style="gap:10px;justify-content:center;margin-top:18px">
        <button class="btn" id="lg-open">${icon('external')} Otwórz ${esc(session.uri.replace('https://', ''))}</button>
        <button class="btn ghost" id="lg-copy">${icon('copy')} Kopiuj kod</button>
      </div>
      <div class="lg-wait"><svg viewBox="0 0 36 36"><circle cx="18" cy="18" r="15.5"/><circle id="lg-timer" cx="18" cy="18" r="15.5"/></svg><span>Czekam na zalogowanie…</span></div>
      <button class="lg-link" id="lg-cancel">Anuluj</button>
    </div>`;
    const copy = () => { navigator.clipboard.writeText(session.userCode); toast('Skopiowano kod', session.userCode, 'success'); };
    $('#lg-code', main).onclick = copy;
    $('#lg-copy', main).onclick = copy;
    $('#lg-open', main).onclick = () => nore.open(session.uri);
    let cancelled = false;
    $('#lg-cancel', main).onclick = () => { cancelled = true; nore.accounts.msCancel(session.deviceCode); start(main); };
    const timer = $('#lg-timer', main);
    const tick = setInterval(() => {
      const left = Math.max(0, 1 - (Date.now() - t0) / ttl);
      if (timer) timer.style.strokeDashoffset = String(97.4 * (1 - left));
    }, 500);
    nore.open(session.uri);
    try {
      const acc = await nore.accounts.msPoll(session.deviceCode, session.userCode, session.expiresIn, session.interval);
      clearInterval(tick);
      if (cancelled) return;
      success(main, acc);
    } catch (e) {
      clearInterval(tick);
      if (!cancelled) start(main, clean(e));
    }
  }

  function success(main, acc) {
    main.innerHTML = `<div class="lg-step in lg-done">
      <div class="lg-avatar">${avatarHtml(acc)}<i>${icon('check')}</i></div>
      <h2>Witaj, ${esc(acc.name)}!</h2>
      <p class="lg-sub">Konto premium zweryfikowane. Uruchamianie launchera…</p>
    </div>`;
    setTimeout(() => {
      const gate = $('#login-gate');
      gate.classList.add('leave');
      setTimeout(() => { gate.remove(); if (resolveGate) resolveGate(acc); }, 700);
    }, 1300);
  }

  function stars(canvas) {
    const ctx = canvas.getContext('2d');
    const pts = Array.from({ length: 140 }, () => ({ x: Math.random(), y: Math.random(), z: Math.random(), s: Math.random() * 1.6 + 0.3 }));
    function frame(t) {
      if (!canvas.isConnected) return;
      const w = canvas.width = canvas.clientWidth * devicePixelRatio, h = canvas.height = canvas.clientHeight * devicePixelRatio;
      ctx.clearRect(0, 0, w, h);
      for (const p of pts) {
        const k = 0.2 + p.z * 0.8;
        const x = ((p.x + t * 0.000004 * k) % 1) * w, y = ((p.y + Math.sin(t * 0.0003 + p.x * 9) * 0.004) % 1) * h;
        ctx.globalAlpha = 0.25 + 0.75 * k * (0.6 + 0.4 * Math.sin(t * 0.002 + p.x * 40));
        ctx.fillStyle = p.z > 0.8 ? '#e6d6ff' : '#a98bff';
        ctx.beginPath(); ctx.arc(x, y, p.s * k * devicePixelRatio, 0, Math.PI * 2); ctx.fill();
      }
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  /** Resolves once the launcher may open (a verified premium session). */
  async function ensure() {
    let st;
    try { st = await nore.auth.status(); } catch (e) { st = { loggedIn: false, error: clean(e) }; }
    if (st.loggedIn) {
      if (st.offline) setTimeout(() => toast('Tryb offline', 'Nie można teraz sprawdzić sesji w Mojang – używam ostatniej weryfikacji.', 'info', 6000), 1500);
      return st.account;
    }
    $('#splash') && $('#splash').classList.add('hide');
    return new Promise((resolve) => { resolveGate = resolve; build(st.error); });
  }

  nore.on('auth:logout', () => location.reload());

  return { ensure };
})();
