'use strict';
/* Nore Updater splash (DESIGN.md §8): the sticker pack whose tear strip follows the download; at 100 % and a
   verified SHA-256 the pack opens and the new version sticker sticks out. States come from main (runSplash). */
(() => {
  const $ = (id) => document.getElementById(id);
  const body = document.body;
  const pack = $('pack');
  let opened = false, lastStatus = '', lastDot = '';
  const api = window.noreUpdater || { skip() {}, retry() {}, onState() {} }; // the preview runs without the preload

  const mb = (b) => (b / 1048576).toFixed(b >= 104857600 ? 0 : 1).replace('.', ',') + ' MB';
  const secs = (s) => (s >= 60 ? `${Math.round(s / 60)} min` : `${Math.max(1, Math.round(s))} s`);

  // launch storyboard: the pack sticks in, then the status line rises
  body.classList.add('launch');
  setTimeout(() => body.classList.remove('launch'), 1000);

  function status(text, dot) {
    if (text !== lastStatus) { lastStatus = text; $('status').textContent = text; }
    if (dot && dot !== lastDot) {
      lastDot = dot;
      const d = $('dot');
      d.className = 'dot ' + dot;
      void d.offsetWidth; d.classList.add('slap');
    }
  }
  function mode(...names) {
    body.classList.remove('is-progress', 'is-done', 'is-error');
    for (const n of names) body.classList.add('is-' + n);
  }
  function progress(pct) {
    const p = Math.max(0, Math.min(100, pct || 0));
    pack.style.setProperty('--p', p.toFixed(1) + '%');
    $('fill').style.setProperty('--v', (p / 100).toFixed(4));
  }
  function buttons({ skip = false, go = false, retry = false } = {}) {
    $('skip').hidden = !skip;
    $('go').hidden = !go;
    $('retry').hidden = !retry;
  }
  function meta(left = '', right = '') { $('meta').textContent = left; $('speed').textContent = right; }
  function title(text) { $('title').textContent = text; }
  function next(v) { const n = $('next'); n.hidden = !v; n.textContent = v ? `nowa wersja ${v}` : ''; }
  function notes(text) {
    const lines = String(text || '').replace(/[#*_`>]/g, '').split(/\r?\n|•/).map(s => s.replace(/^[-\s]+/, '').trim()).filter(Boolean).slice(0, 3);
    $('notes').innerHTML = '';
    for (const l of lines) { const li = document.createElement('li'); li.textContent = l.length > 90 ? l.slice(0, 88) + '…' : l; $('notes').appendChild(li); }
  }
  /** reveal storyboard: the flap peels off, the version sticker sticks out of the pack with spring.soft */
  function open(version, headline) {
    title(headline);
    $('outver').textContent = version ? `wersja ${version}` : 'Nore';
    if (opened) return;
    opened = true;
    progress(100);
    body.classList.add('opened');
  }

  function render(s) {
    if (s.version) $('ver').textContent = s.version;
    switch (s.state) {
      case 'checking':
      case 'idle':
        mode(); buttons(); next(null); progress(0);
        status('Szukam aktualizacji…', 'wait'); meta();
        $('hint').textContent = 'noreclient.pl';
        break;
      case 'available':
        mode('progress'); progress(0); buttons({ skip: true }); next(s.next);
        status('Przygotowuję pobieranie…', 'wait'); meta(s.size ? mb(s.size) : '');
        break;
      case 'downloading': {
        mode('progress'); progress(s.percent); buttons({ skip: true }); next(s.next);
        status('Pobieram aktualizację', 'wait');
        const left = s.speed && s.size && s.bytes != null ? (s.size - s.bytes) / s.speed : null;
        meta(s.size && s.bytes != null ? `${mb(s.bytes)} z ${mb(s.size)}` : `${Math.round(s.percent || 0)}%`, s.speed ? `${mb(s.speed)}/s${left != null ? ' · ' + secs(left) : ''}` : '');
        $('hint').textContent = 'Potem sprawdzę sumę SHA-256';
        break;
      }
      case 'verifying':
        mode('progress'); progress(100); buttons(); next(s.next);
        status('Sprawdzam sumę SHA-256…', 'wait'); meta();
        break;
      case 'ready':
      case 'installing':
        mode('progress', 'done'); buttons(); next(s.next);
        open(s.next, 'Instaluję');
        status('Launcher uruchomi się ponownie za chwilę', 'ready'); meta();
        $('hint').textContent = 'Suma SHA-256 się zgadza';
        break;
      case 'latest':
      case 'dev':
        mode('done'); buttons(); next(null); progress(0);
        status('Masz najnowszą wersję', 'ready'); meta();
        break;
      case 'updated':
        mode('done'); buttons({ go: true });
        open(s.version, `Witaj w ${s.version}`);
        status('Nore Launcher jest zaktualizowany', 'ready'); meta();
        break;
      case 'installed':
        mode('done'); buttons({ go: true });
        open(s.version, 'Witaj w Nore');
        status(`Nore Launcher ${s.version} jest zainstalowany`, 'ready'); meta();
        $('hint').textContent = 'Twój album czeka';
        break;
      case 'error':
        mode('error'); buttons({ skip: true, retry: true });
        status('Nie udało się sprawdzić aktualizacji', 'error'); meta(s.message ? String(s.message).slice(0, 60) : '');
        break;
      default:
        break;
    }
    if (s.notes != null) notes(s.notes);
  }

  $('skip').onclick = () => api.skip();
  $('close').onclick = () => api.skip();
  $('go').onclick = () => api.skip();
  $('retry').onclick = () => { body.classList.remove('is-error'); status('Szukam aktualizacji…', 'wait'); (api.retry || api.skip)(); };
  api.onState(render);
  // design preview: updater.html#state={"state":"downloading","percent":62,...} renders a state without main
  const fromHash = () => { try { if (location.hash.startsWith('#state=')) render(JSON.parse(decodeURIComponent(location.hash.slice(7)))); } catch { /* not a preview */ } };
  window.addEventListener('hashchange', fromHash);
  fromHash();
})();
