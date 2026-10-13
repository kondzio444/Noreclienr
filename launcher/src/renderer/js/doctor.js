'use strict';
/* Automatic repair UI: crash report modal, preflight notices and the instance "repair" check. */

const DOCTOR_ICONS = { duplicate: 'copy', 'wrong-loader': 'ban', 'wrong-version': 'layers', 'module-conflict': 'puzzle', 'missing-dep': 'download',
  'dep-version': 'refresh', incompatible: 'ban', java: 'cpu', memory: 'database', mixin: 'zap' };

function doctorList(problems) {
  return `<div class="doc-list">${problems.map(p => `<div class="doc-item">
      <div class="doc-ico">${icon(DOCTOR_ICONS[p.kind] || 'info')}</div>
      <div class="doc-text"><b>${esc(p.title)}</b><span>${esc(p.detail || '')}</span></div>
      ${p.result ? `<span class="doc-res ${/nie udało/.test(p.result) ? 'bad' : ''}">${icon(/nie udało/.test(p.result) ? 'x' : 'check')} ${esc(p.result)}</span>` : ''}
    </div>`).join('')}</div>`;
}

function doctorModal(instId, problems, { crash, applied, code } = {}) {
  const inst = App.state.instances.find(i => i.id === instId);
  const head = crash
    ? (problems.length ? (applied ? 'Gra się wysypała – naprawiono' : 'Gra się wysypała – znaleziono przyczynę') : 'Gra zakończyła się błędem')
    : (problems.length ? (applied ? `Naprawiono ${problems.length} ${problems.length === 1 ? 'problem' : 'problemy'}` : `Znaleziono ${problems.length} ${problems.length === 1 ? 'problem' : 'problemy'}`) : 'Wszystko w porządku');
  const sub = crash
    ? (problems.length ? `${inst ? esc(inst.name) + ' • ' : ''}kod wyjścia ${code}. ${applied ? 'Poprawki zostały zastosowane automatycznie.' : 'Kliknij Napraw, aby zastosować poprawki.'}`
      : 'Nie rozpoznano przyczyny. Sprawdź konsolę albo uruchom pełne sprawdzenie modów.')
    : (problems.length ? (applied ? 'Wyłączone pliki mają końcówkę .disabled – możesz je przywrócić w zakładce Mody.' : 'Te mody mogą wywalić grę.') : 'Mody pasują do wersji gry i loadera, nie ma duplikatów.');
  const m = modal(`<div class="doc-head ${problems.length ? (applied ? 'ok' : 'warn') : crash ? 'bad' : 'ok'}"><div class="doc-badge">${icon(problems.length && !applied ? 'shield' : crash && !problems.length ? 'x' : 'check')}</div>
      <div><h3>${head}</h3><p class="sub">${sub}</p></div></div>
    ${problems.length ? doctorList(problems) : ''}
    <div class="foot">
      <button class="btn ghost" data-close>Zamknij</button>
      ${crash ? `<button class="btn ghost" id="doc-console">${icon('terminal')} Konsola</button>` : ''}
      ${crash && !problems.length ? `<button class="btn ghost" id="doc-deep">${icon('search')} Sprawdź mody</button>` : ''}
      ${problems.length && !applied ? `<button class="btn" id="doc-fix">${icon('shield')} Napraw</button>` : ''}
      ${crash && (applied || !problems.length) && inst ? `<button class="btn" id="doc-play">${icon('play')} Uruchom ponownie</button>` : ''}
    </div>`);
  m.el.style.width = 'min(640px, calc(100vw - 40px))';
  const c = $('#doc-console', m.el); if (c) c.onclick = () => { m.close(); go('console'); };
  const d = $('#doc-deep', m.el); if (d) d.onclick = () => { m.close(); doctorCheck(instId); };
  const p = $('#doc-play', m.el); if (p) p.onclick = () => { m.close(); launchSelected(inst); };
  const f = $('#doc-fix', m.el);
  if (f) f.onclick = async () => {
    f.disabled = true; f.innerHTML = '<span class="spinner"></span> Naprawianie';
    try {
      const res = await nore.doctor.fix(instId, problems);
      m.close();
      doctorModal(instId, res, { crash, applied: true, code });
      toast('Naprawiono', `${res.filter(r => !/nie udało/.test(r.result || '')).length} z ${res.length} problemów`, 'success');
    } catch (e) { errorToast(e, 'Naprawa'); f.disabled = false; }
  };
}

async function doctorCheck(instId) {
  const t = el(`<div class="doc-scan"><span class="spinner"></span> Sprawdzanie modów…</div>`);
  document.body.appendChild(t);
  try {
    const problems = await nore.doctor.check(instId);
    doctorModal(instId, problems, {});
  } catch (e) { errorToast(e, 'Sprawdzanie'); }
  t.remove();
}

nore.on('doctor:report', (r) => {
  if (!r) return;
  if (r.phase === 'preflight') {
    toast('Automatyczna naprawa', r.problems.map(p => `${p.title} – ${p.result}`).join('\n').slice(0, 220), 'success', 7000);
    return;
  }
  App.lastCrash = r;
  setTimeout(() => doctorModal(r.instanceId, r.problems, { crash: true, applied: r.applied && r.problems.length > 0, code: r.code }), 400);
});

// "repair" button in the instance header
const _instancePageDoctor = Pages.instance;
Pages.instance = (root, opts) => {
  const cleanup = _instancePageDoctor(root, opts);
  const add = () => {
    const row = $('.inst-hero > .row', root);
    if (!row || $('#doc-btn', row)) return;
    const b = el(`<button class="btn ghost" id="doc-btn" title="Sprawdza duplikaty, mody z innego loadera i mody dla innej wersji gry">${icon('shield')} Napraw</button>`);
    b.onclick = () => doctorCheck(opts.id);
    row.prepend(b);
  };
  add();
  const mo = new MutationObserver(add);
  mo.observe(root, { childList: true, subtree: true });
  return () => { mo.disconnect(); if (cleanup) cleanup(); };
};
