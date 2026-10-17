'use strict';
/* MOTD helpers: § colour codes to HTML, the §k scramble that resolves into a name,
   and "lit until seen" marks for rows whose state just changed. */

const Motd = (() => {
  const GLYPHS = 'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789#$%&?@';
  const quiet = () => document.body.classList.contains('no-anim') || matchMedia('(prefers-reduced-motion: reduce)').matches;
  const escape = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  /** "§dNeoForge §8• §7własne mody" → coloured spans. Unknown codes are dropped, text is escaped. */
  function html(text) {
    let out = '';
    let cls = [];
    for (const part of String(text).split(/(§[0-9a-fk-orx])/i)) {
      const m = /^§([0-9a-fk-orx])$/i.exec(part);
      if (m) {
        const c = m[1].toLowerCase();
        if (/[0-9a-fx]/.test(c)) cls = ['c' + c];
        else if (c === 'r') cls = [];
        else if (c !== 'k') cls.push(c);
        continue;
      }
      if (part) out += cls.length ? `<span class="${cls.join(' ')}">${escape(part)}</span>` : escape(part);
    }
    return out;
  }

  const strip = (text) => String(text).replace(/§[0-9a-fk-orx]/gi, '');

  /** Scrambles el's text with random glyphs, then resolves it left to right (the §k effect). */
  function reveal(el, text, ms = 560) {
    if (!el) return;
    text = String(text);
    el.setAttribute('aria-label', text);
    if (el._motd) cancelAnimationFrame(el._motd);
    if (quiet() || !text) { el.textContent = text; return; }
    const t0 = performance.now();
    const step = (now) => {
      const p = Math.min(1, (now - t0) / ms);
      const done = Math.floor(p * text.length);
      let k = '';
      for (let i = done; i < text.length; i++) k += text[i] === ' ' ? ' ' : GLYPHS[(Math.random() * GLYPHS.length) | 0];
      el.innerHTML = escape(text.slice(0, done)) + (k ? `<span class="mk">${k}</span>` : '');
      if (p < 1) el._motd = requestAnimationFrame(step);
      else { el.textContent = text; el._motd = 0; }
    };
    el._motd = requestAnimationFrame(step);
  }

  /** Marks el as changed until the player hovers or focuses it. */
  function lit(el) {
    if (!el || el.classList.contains('lit')) return;
    el.classList.add('lit');
    const clear = () => { el.classList.remove('lit'); el.removeEventListener('pointerenter', clear); el.removeEventListener('focusin', clear); };
    el.addEventListener('pointerenter', clear);
    el.addEventListener('focusin', clear);
  }

  /** Like lit(), but each key lights only once; seeing it is remembered across restarts. */
  function litOnce(el, key) {
    let seen = {};
    try { seen = JSON.parse(localStorage.getItem('nore.seen') || '{}'); } catch { /* fresh */ }
    if (!el || seen[key]) return;
    lit(el);
    const mark = () => {
      try { seen = JSON.parse(localStorage.getItem('nore.seen') || '{}'); seen[key] = Date.now(); localStorage.setItem('nore.seen', JSON.stringify(seen)); } catch { /* ignore */ }
      el.removeEventListener('pointerenter', mark);
    };
    el.addEventListener('pointerenter', mark);
  }

  return { html, strip, reveal, lit, litOnce };
})();

/** The instance's MOTD line: loader in its colour, then what the instance is. */
const LOADER_CODE = { fabric: '§e', quilt: '§d', forge: '§6', neoforge: '§6', vanilla: '§a' };
function instMotd(i) {
  const sub = instSubtitle(i);
  const code = i.noreClient ? '§x' : LOADER_CODE[i.loader] || '§7';
  const cut = sub.search(/ [–•+] /);
  const line = cut > 0 ? `${code}${sub.slice(0, cut)}§8${sub.slice(cut, cut + 3)}§7${sub.slice(cut + 3)}` : `${code}${sub}`;
  return `<span class="motd">${Motd.html(line)}</span>`;
}
