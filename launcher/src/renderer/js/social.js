'use strict';
/* Community pages (1.4 Beta): friends shared with Nore Client, screenshot gallery and the shop teaser. */

const NICK_RE = /^[A-Za-z0-9_]{2,16}$/;
const head = (name, size = 64) => `https://mc-heads.net/avatar/${encodeURIComponent(name)}/${size}`;

// ================================================================== friends: one list for nicks and chat

/*
 * A person is a Minecraft nick on the in-game list (main/social.js, shared with Nore Client) and/or a
 * chat contact keyed by Nore ID (main/chat.js, P2P in js/chat.js). The two are matched by name, so a
 * nick friend who is also a chat contact is one row with status, unread count and the conversation.
 */

/** "NORE-ABCDE-…", "abcde…" (with dashes or spaces) → 20 hex chars, or null. Never a nick (max 16 chars). */
function noreIdHex(text) {
  const t = String(text || '').trim();
  if (!/^(nore)?[\s-]*([0-9a-f][\s-]*)+$/i.test(t)) return null;
  const hex = t.toLowerCase().replace(/^nore/, '').replace(/[^0-9a-f]/g, '');
  return hex.length === 20 ? hex : null;
}

/** Nicks + chat contacts merged by name, with presence. */
function friendPeople(nicks) {
  const people = new Map();
  for (const n of nicks) people.set('n:' + n.toLowerCase(), { key: 'n:' + n.toLowerCase(), name: n, nick: n, contact: null });
  for (const c of (typeof Chat === 'object' ? Chat.contacts : [])) {
    const k = 'n:' + String(c.name).toLowerCase();
    const p = people.get(k);
    if (p && !p.contact) p.contact = c;
    else people.set('h:' + c.hex, { key: 'h:' + c.hex, name: c.name, nick: null, contact: c });
  }
  return [...people.values()].map(p => {
    const c = p.contact;
    const l = c && Chat.links.get(c.hex);
    const online = !!(c && Chat.online(c.hex));
    return {
      ...p,
      status: online ? (l.status === 'game' ? 'game' : 'launcher') : c ? 'off' : 'list',
      detail: online ? l.detail || '' : '',
      pending: !!(c && !c.pub && !online),
      unread: c ? c.unread || 0 : 0,
      last: c ? c.last : null,
      seen: c ? c.seen : null,
    };
  });
}

const FX_RANK = { game: 0, launcher: 1, off: 2, list: 3 };
function sortPeople(list) {
  return list.sort((a, b) => (b.unread > 0) - (a.unread > 0) || FX_RANK[a.status] - FX_RANK[b.status]
    || ((b.last && b.last.ts) || 0) - ((a.last && a.last.ts) || 0) || a.name.localeCompare(b.name, 'pl'));
}

/** The presence line in § codes: §a in game / online, §e waiting, §8 offline, §7 nick list only. */
function personLine(p) {
  if (p.status === 'game') return `§aW grze${p.detail ? '§8: §7' + p.detail : ''}`;
  if (p.status === 'launcher') return '§aOnline w launcherze';
  if (p.pending) return '§eCzeka, aż doda Twój Nore ID';
  if (p.status === 'off') return `§8Offline${p.seen ? ' • ' + fmtAgo(p.seen) : ''}`;
  return '§7Na liście w grze';
}

function personAvatar(p, size = 36, px = 48) {
  return `<span class="fx-av st-${p.status}${p.pending ? ' pending' : ''}" style="--s:${size}px"><b>${esc(p.name.charAt(0).toUpperCase())}</b><img src="${head(p.name, px)}" alt="" data-fallback><i></i></span>`;
}

const linkify = (s) => s.replace(/(https?:\/\/[^\s<]+)/g, '<a href="#" data-ext="$1">$1</a>').replace(/\n/g, '<br>');

/** Message bubbles with day separators; mids not in `known` are marked fresh (they animate in). */
function chatBubbles(list, known) {
  let lastDay = '';
  return list.map(m => {
    const d = new Date(m.ts);
    const day = d.toLocaleDateString('pl-PL', { weekday: 'long', day: 'numeric', month: 'long' });
    const sep = day !== lastDay ? `<div class="cv-day">${esc(day)}</div>` : '';
    lastDay = day;
    const state = m.mine ? icon(m.state === 'delivered' ? 'checks' : m.state === 'pending' ? 'clock' : 'check') : '';
    const fresh = known && !known.has(m.mid) ? ' fresh' : '';
    return `${sep}<div class="cv-msg ${m.mine ? 'mine' : ''}${fresh}"><div class="cv-bubble">${linkify(esc(m.text))}</div><span>${d.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' })} ${state}</span></div>`;
  }).join('');
}

Pages.friends = (root, opts = {}) => {
  let nicks = [];
  let people = [];
  let q = '';
  let alive = true;
  let sel = opts.key || (opts.hex ? 'h:' + opts.hex : null) || (typeof Chat === 'object' && Chat.lastViewed) || null;
  let known = new Set(); // message ids already on screen in the open conversation
  const firstList = { done: false };
  let booted = false;

  root.innerHTML = `
    <div class="page-head"><div><h2>${icon('users')} Znajomi</h2><p>Nicki z gry i czat w jednym miejscu. Lista nicków trafia do każdej instancji Nore Client.</p></div>
      <div class="actions"><span class="ch-broker" id="fx-broker"></span><button class="btn ghost sm" id="fx-voice">${icon('mic')} Głos</button></div></div>
    <div class="fx-wrap">
      <aside class="card fx-side">
        <div class="fx-me" id="fx-me"></div>
        <div class="fx-add">
          <div class="fx-addrow"><input class="input" id="fx-in" maxlength="40" placeholder="Nick albo Nore ID" spellcheck="false" aria-describedby="fx-hint">
            <button class="btn" id="fx-go" disabled>${icon('plus')} Dodaj</button></div>
          <input class="input" id="fx-name" maxlength="16" placeholder="Jego nick w Minecraft (opcjonalnie)" spellcheck="false" hidden>
          <small class="fx-hint" id="fx-hint">Nick trafi na listę w grze, Nore ID zaprasza do czatu.</small>
        </div>
        <label class="fx-search" id="fx-search" hidden>${icon('search')}<input id="fx-q" placeholder="Szukaj wśród znajomych…" spellcheck="false"></label>
        <div class="fx-list" id="fx-list"></div>
      </aside>
      <section class="card fx-main" id="fx-main"></section>
    </div>`;

  const find = (key) => people.find(p => p.key === key) || null;
  const rebuild = () => { people = sortPeople(friendPeople(nicks)); };

  // ---------------------------------------------------------------- header bits
  const drawBroker = () => {
    const b = $('#fx-broker', root);
    if (!b || typeof Chat !== 'object') return;
    const map = { online: ['on', 'Czat połączony'], connecting: ['wait', 'Łączenie z czatem…'], error: ['off', 'Czat offline – ponawiam'], off: ['off', 'Czat wyłączony'] };
    const [cls, txt] = map[Chat.broker] || map.off;
    b.className = `ch-broker ${cls}`;
    Motion.swap(b, `<i></i>${txt}`);
  };
  const drawMe = () => {
    const box = $('#fx-me', root);
    if (!box) return;
    if (!Chat.me) { box.innerHTML = '<div class="muted">Uruchamianie czatu…</div>'; return; }
    box.innerHTML = `<div class="cv-me"><img src="${head(Chat.me.name, 64)}" alt="" data-fallback></div><div class="grow" style="min-width:0"><b>${esc(Chat.me.name)}</b>
        <button class="ch-myid" title="Kopiuj swój Nore ID">${esc(Chat.me.id)} ${icon('copy')}</button></div>`;
    $('.ch-myid', box).onclick = () => { navigator.clipboard.writeText(Chat.me.id); toast('Skopiowano Twój Nore ID', 'Wyślij go znajomemu – doda Cię w zakładce Znajomi.', 'success'); };
  };

  // ---------------------------------------------------------------- add by nick or Nore ID
  const input = $('#fx-in', root), nameIn = $('#fx-name', root), goBtn = $('#fx-go', root), hint = $('#fx-hint', root);
  const kind = () => { const v = input.value.trim(); return noreIdHex(v) ? 'id' : NICK_RE.test(v) ? 'nick' : v ? 'bad' : ''; };
  input.oninput = () => {
    const k = kind(), v = input.value.trim();
    goBtn.disabled = !(k === 'id' || k === 'nick');
    nameIn.hidden = k !== 'id';
    hint.className = `fx-hint ${k}`;
    Motion.swap(hint, k === 'id' ? 'Nore ID: wyślemy zaproszenie do czatu.'
      : k === 'nick' ? `Nick: ${esc(v)} będzie podświetlony w grze.`
      : k === 'bad' ? 'To nie jest nick (2–16 znaków: litery, cyfry, _) ani Nore ID.'
      : 'Nick trafi na listę w grze, Nore ID zaprasza do czatu.');
  };
  const add = async () => {
    const k = kind(), v = input.value.trim();
    try {
      if (k === 'nick') {
        nicks = await nore.friends.add(v);
        sel = 'n:' + v.toLowerCase();
        toast('Dodano znajomego', `${v} będzie podświetlony w grze.`, 'success');
      } else if (k === 'id') {
        const nick = nameIn.value.trim();
        if (nick && !NICK_RE.test(nick)) return toast('Niepoprawny nick', '2–16 znaków: litery, cyfry i podkreślenie.', 'error');
        const c = await Chat.add(v, nick);
        if (nick && !nicks.some(n => n.toLowerCase() === nick.toLowerCase())) nicks = await nore.friends.add(nick).catch(() => nicks);
        sel = nick ? 'n:' + nick.toLowerCase() : 'h:' + c.hex;
        toast('Wysłano zaproszenie', 'Gdy znajomy też doda Twój Nore ID, możecie pisać i rozmawiać.', 'success', 6000);
      } else return;
      input.value = ''; nameIn.value = ''; input.oninput();
      rebuild(); drawList(sel); drawMain();
    } catch (e) { errorToast(e, 'Znajomi'); }
  };
  goBtn.onclick = add;
  input.onkeydown = nameIn.onkeydown = (e) => { if (e.key === 'Enter') add(); };
  $('#fx-q', root).oninput = (e) => { q = e.target.value.trim().toLowerCase(); drawList(); };
  $('#fx-voice', root).onclick = () => voiceSettingsModal();

  // ---------------------------------------------------------------- the list
  const rowHtml = (p) => {
    const line = p.unread && p.last ? `§f${(p.last.mine ? 'Ty: ' : '') + p.last.text}` : personLine(p);
    return `<button class="fx-row ${p.key === sel ? 'on' : ''}" data-k="${esc(p.key)}" title="${esc(p.name)}">
      ${personAvatar(p)}
      <span class="fx-txt"><b>${esc(p.name)}</b><span class="motd">${Motd.html(line.replace(/[\r\n]+/g, ' '))}</span></span>
      ${p.unread ? `<em class="fx-unread">${p.unread}</em>` : ''}</button>`;
  };

  /** fresh = key of a row that just appeared (it pops in); the list itself only staggers on first draw. */
  function drawList(fresh) {
    const box = $('#fx-list', root);
    if (!box) return;
    $('#fx-search', root).hidden = people.length < 7;
    const shown = people.filter(p => !q || p.name.toLowerCase().includes(q));
    const online = shown.filter(p => p.status === 'game' || p.status === 'launcher');
    const rest = shown.filter(p => !online.includes(p));
    const reqs = typeof Chat === 'object' ? Chat.requests : [];
    const prevUnread = new Map($$('.fx-row', box).map(r => [r.dataset.k, +(($('.fx-unread', r) || {}).textContent || 0)]));
    let html = '';
    if (reqs.length && !q) {
      html += `<div class="fx-sub">Zaproszenia <span class="rank fx-n">${reqs.length}</span></div>` + reqs.map(r => `<div class="fx-req" data-h="${esc(r.hex)}">
        <span class="fx-av st-launcher" style="--s:32px"><b>${esc(r.name.charAt(0).toUpperCase())}</b><img src="${head(r.name, 40)}" alt="" data-fallback><i></i></span>
        <span class="fx-txt"><b>${esc(r.name)}</b><span>chce pisać z Tobą</span></span>
        <button class="btn success sm icon" data-a="ok" title="Przyjmij">${icon('check')}</button><button class="btn ghost sm icon" data-a="no" title="Odrzuć">${icon('x')}</button></div>`).join('');
    }
    if (online.length) html += `<div class="fx-sub">Online <span class="rank fx-n on">${online.length}</span></div>` + online.map(rowHtml).join('');
    if (rest.length) html += `<div class="fx-sub">${online.length ? 'Pozostali' : 'Twoja lista'} <span class="rank fx-n">${rest.length}</span></div>` + rest.map(rowHtml).join('');
    if (!people.length && !reqs.length) html = `<div class="fx-empty">${icon('users')}<span>Dodaj nick z Minecrafta albo wklej Nore ID znajomego.</span></div>`;
    else if (!shown.length) html += `<div class="fx-empty small">${icon('search')}<span>Nikt nie pasuje do „${esc(q)}”.</span></div>`;
    box.innerHTML = html;
    stagger(box, !firstList.done);
    firstList.done = true;
    $$('.fx-row', box).forEach(r => {
      r.onclick = () => select(r.dataset.k);
      const u = $('.fx-unread', r);
      if (u && prevUnread.has(r.dataset.k) && prevUnread.get(r.dataset.k) !== +u.textContent) Motion.bump(u);
      if (fresh && r.dataset.k === fresh) Motion.animate(r, [{ opacity: 0, transform: `translateX(${Motion.px(-8)}px)` }, { opacity: 1, transform: 'none' }], { duration: Motion.ms('--dur-page'), easing: Motion.ease('--ease-out') });
    });
    $$('.fx-req', box).forEach(row => {
      const r = Chat.requests.find(x => x.hex === row.dataset.h);
      $('[data-a="ok"]', row).onclick = async () => {
        try {
          await Chat.add(r.id, r.name);
          rebuild();
          const p = people.find(x => x.contact && x.contact.hex === r.hex);
          sel = p ? p.key : sel;
          toast('Dodano znajomego', r.name, 'success');
          drawList(sel); drawMain();
        } catch (e) { errorToast(e); }
      };
      $('[data-a="no"]', row).onclick = async () => {
        Chat.requests = await nore.chat.decline(r.hex, false);
        const out = Motion.animate(row, [{ opacity: 1 }, { opacity: 0, transform: `translateX(${Motion.px(12)}px)` }], { duration: Motion.ms('--dur-exit'), easing: Motion.ease('--ease-in'), fill: 'forwards' });
        const done = () => Chat.reload();
        if (out) out.onfinish = done; else done();
      };
    });
  }

  function select(key) {
    if (key === sel) return;
    sel = key;
    $$('.fx-row', root).forEach(r => r.classList.toggle('on', r.dataset.k === key));
    drawMain(true);
  }

  // ---------------------------------------------------------------- the person panel
  function headHtml(p) {
    const tags = `${p.nick ? '<span class="tag fx-t-nick" title="Podświetlony w grze przez Nore Client">LISTA W GRZE</span>' : ''}${p.contact ? `<span class="tag fx-t-id" title="${esc(p.contact.id)}">NORE ID</span>` : ''}`;
    const canCall = p.contact && p.status !== 'off' && p.status !== 'list';
    return `<div class="fx-head">${personAvatar(p, 46, 64)}
      <div class="grow" style="min-width:0"><h3>${esc(p.name)}</h3><div class="motd fx-pres" id="fx-pres">${Motd.html(personLine(p))}</div></div>
      <div class="fx-tags">${tags}</div>
      ${p.contact ? `<button class="btn ${canCall ? '' : 'ghost'} sm" id="fx-call" ${Chat.call || !canCall ? 'disabled' : ''} title="${canCall ? 'Rozmowa głosowa' : 'Rozmowy działają, gdy oboje macie otwarty launcher'}">${icon('activity')} Zadzwoń</button>` : ''}
      <button class="btn ghost sm icon" id="fx-more" title="Więcej">${icon('settings')}</button></div>`;
  }

  function moreMenu(p, anchor) {
    const items = [];
    if (p.nick) items.push({ label: 'Kopiuj nick', icon: 'copy', action: () => { navigator.clipboard.writeText(p.nick); toast('Skopiowano', p.nick, 'success', 1800); } });
    if (p.nick || NICK_RE.test(p.name)) items.push({ label: 'Profil NameMC', icon: 'external', action: () => nore.open(`https://namemc.com/profile/${encodeURIComponent(p.nick || p.name)}`) });
    if (p.contact) {
      items.push({ label: 'Kopiuj Nore ID', icon: 'copy', action: () => { navigator.clipboard.writeText(p.contact.id); toast('Skopiowano', p.contact.id, 'success'); } });
      items.push({ label: 'Ustawienia głosu', icon: 'mic', action: () => voiceSettingsModal() });
      items.push({ label: 'Wyczyść historię', icon: 'trash', action: async () => { if (await confirmModal('Wyczyścić historię?', `Rozmowa z ${p.name} zniknie z tego komputera.`, { ok: 'Wyczyść', danger: true })) { await nore.chat.clear(p.contact.hex); drawMain(); } } });
    }
    items.push('-');
    if (p.nick) items.push({ label: 'Usuń z listy w grze', icon: 'trash', danger: true, action: () => removeNick(p) });
    if (p.contact) items.push({ label: 'Usuń z czatu', icon: 'trash', danger: true, action: () => removeContact(p) });
    popMenu(anchor, items);
  }

  async function removeNick(p) {
    if (!await confirmModal(`Usunąć ${p.nick} z listy?`, 'Gracz zniknie z listy w launcherze i we wszystkich instancjach Nore Client.' + (p.contact ? ' Czat z nim zostaje.' : ''), { ok: 'Usuń', danger: true })) return;
    nicks = await nore.friends.remove(p.nick);
    leaveRow(p.key, () => { rebuild(); if (!p.contact) sel = null; else sel = 'h:' + p.contact.hex; drawList(); drawMain(); });
  }
  async function removeContact(p) {
    if (!await confirmModal(`Usunąć ${p.name} z czatu?`, 'Kontakt i historia rozmowy znikną z tego komputera.' + (p.nick ? ' Nick zostaje na liście w grze.' : ''), { ok: 'Usuń', danger: true })) return;
    await nore.chat.remove(p.contact.hex);
    await Chat.reload();
    leaveRow(p.key, () => { rebuild(); if (!p.nick) sel = null; drawList(); drawMain(); });
  }
  /** The removed row slides out before the list redraws. */
  function leaveRow(key, then) {
    const row = $(`.fx-row[data-k="${CSS.escape(key)}"]`, root);
    const a = row && Motion.animate(row, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: `translateX(${Motion.px(-12)}px)` }], { duration: Motion.ms('--dur-exit') + 40, easing: Motion.ease('--ease-in'), fill: 'forwards' });
    if (a) a.onfinish = then; else then();
  }

  let drawToken = 0;
  async function drawMain(switched) {
    const main = $('#fx-main', root);
    if (!main) return;
    const token = ++drawToken;
    const p = sel && find(sel);
    if (typeof Chat === 'object') Chat.viewing = p && p.contact ? p.contact.hex : null;
    let html;
    if (!p) {
      html = `<div class="fx-welcome">
        <div class="ch-hero">${icon('users')}</div><h3>Twoi znajomi</h3>
        <p class="muted">Nick z Minecrafta trafia na listę, którą Nore Client podświetla w grze. Nore ID to Twój adres w czacie: wyślij go znajomemu, a gdy doda Cię w launcherze, możecie pisać i rozmawiać głosowo.</p>
        ${Chat.me ? `<button class="btn" id="fw-copy">${icon('copy')} Kopiuj mój Nore ID</button>` : ''}
        <div class="ch-feat"><div>${icon('zap')}<b>Podświetleni w grze</b><span>Nick znajomego świeci nad głową i na liście TAB; dostaniesz znać, gdy wejdzie na serwer.</span></div>
          <div>${icon('shield')}<b>Czat bez serwera</b><span>Wiadomości lecą prosto do znajomego, a każde połączenie potwierdza jego klucz.</span></div>
          <div>${icon('mic')}<b>Głos</b><span>Rozmowy z redukcją szumów, wyciszaniem i regulacją głośności.</span></div></div></div>`;
    } else if (p.contact) {
      const msgs = await nore.chat.history(p.contact.hex);
      if (!alive || token !== drawToken) return;
      known = new Set(msgs.map(m => m.mid));
      const online = p.status === 'game' || p.status === 'launcher';
      html = `${headHtml(p)}
        ${!p.nick && NICK_RE.test(p.name) ? `<div class="fx-strip">${icon('zap')}<span>Dodaj <b>${esc(p.name)}</b> do listy w grze – Nore Client podświetli jego nick.</span><button class="btn ghost sm" id="fx-addnick">${icon('plus')} Dodaj nick</button></div>` : ''}
        <div class="cv-log" id="cv-log">${msgs.length ? chatBubbles(msgs) : `<div class="cv-start">${icon('message')}<span>Początek rozmowy z ${esc(p.name)}.${online ? '' : ' Wiadomości dotrą, gdy znajomy będzie online.'}</span></div>`}</div>
        <div class="cv-typing" id="cv-typing"></div>
        <div class="cv-compose"><textarea class="input" id="cv-text" rows="1" maxlength="2000" placeholder="Napisz do ${esc(p.name)}…" aria-label="Wiadomość"></textarea><button class="btn" id="cv-send" title="Wyślij">${icon('arrowRight')}</button></div>`;
    } else {
      html = `${headHtml(p)}
        <div class="fx-nick">
          <div class="fx-body"><span>${esc(p.name.charAt(0).toUpperCase())}</span><img src="https://mc-heads.net/body/${encodeURIComponent(p.name)}/150" alt="" data-fallback></div>
          <div class="fx-nick-text">
            <p><b>${esc(p.name)}</b> jest na Twojej liście w grze: Nore Client podświetla jego nick nad głową i na liście TAB, a gdy wejdzie na serwer, dostaniesz powiadomienie.</p>
            <div class="section-title">${icon('message')} Czat i głos</div>
            <p class="muted">Poproś ${esc(p.name)} o jego Nore ID (ma go w zakładce Znajomi) i wklej go tutaj.</p>
            <div class="fx-addrow"><input class="input" id="fx-link" placeholder="NORE-XXXXX-XXXXX-XXXXX-XXXXX" spellcheck="false" maxlength="40"><button class="btn" id="fx-linkgo" disabled>${icon('link')} Połącz</button></div>
            ${Chat.me ? `<button class="btn ghost sm" id="fw-copy">${icon('copy')} Kopiuj mój Nore ID</button>` : ''}
          </div>
        </div>`;
    }
    // the panel crossfades between people
    // the panel crossfades between people: the old panel fades over the new one as it fades in
    if (switched) Motion.ghost(main);
    main.innerHTML = html;
    if (switched) [...main.children].forEach(c => c.classList.add('swap-in'));
    wireMain(p);
  }

  function wireMain(p) {
    const main = $('#fx-main', root);
    const copy = $('#fw-copy', main);
    if (copy) copy.onclick = () => { navigator.clipboard.writeText(Chat.me.id); toast('Skopiowano Twój Nore ID', Chat.me.id, 'success'); };
    if (!p) return;
    $('#fx-more', main).onclick = (e) => moreMenu(p, e.currentTarget);
    const call = $('#fx-call', main);
    if (call) call.onclick = () => Chat.startCall(p.contact.hex);
    const addNick = $('#fx-addnick', main);
    if (addNick) addNick.onclick = async () => {
      try { nicks = await nore.friends.add(p.name); sel = 'n:' + p.name.toLowerCase(); toast('Dodano do listy w grze', p.name, 'success'); rebuild(); drawList(); drawMain(); } catch (e) { errorToast(e, 'Znajomi'); }
    };
    const link = $('#fx-link', main);
    if (link) {
      const lgo = $('#fx-linkgo', main);
      link.oninput = () => { lgo.disabled = !noreIdHex(link.value); };
      const doLink = async () => {
        if (!noreIdHex(link.value)) return;
        try { await Chat.add(link.value, p.name); toast('Wysłano zaproszenie', `Gdy ${p.name} doda Twój Nore ID, możecie pisać.`, 'success', 6000); rebuild(); drawList(); drawMain(true); } catch (e) { errorToast(e, 'Znajomi'); }
      };
      lgo.onclick = doLink;
      link.onkeydown = (e) => { if (e.key === 'Enter') doLink(); };
    }
    if (!p.contact) return;
    const log = $('#cv-log', main);
    log.scrollTop = log.scrollHeight;
    log.onclick = (e) => { const a = e.target.closest('a[data-ext]'); if (a) { e.preventDefault(); nore.open(a.dataset.ext); } };
    const ta = $('#cv-text', main);
    const grow = () => { ta.style.height = 'auto'; ta.style.height = Math.min(140, ta.scrollHeight) + 'px'; };
    const send = async () => { const v = ta.value; if (!v.trim()) return; ta.value = ''; grow(); await Chat.send(p.contact.hex, v); };
    ta.oninput = () => { grow(); Chat.typing(p.contact.hex); };
    ta.onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } };
    $('#cv-send', main).onclick = send;
    setTimeout(() => { if (ta.isConnected) ta.focus(); }, 60);
    Chat.lastViewed = p.key;
    if (p.unread) nore.chat.read(p.contact.hex).then(() => Chat.reload());
  }

  /** Presence or messages changed: refresh the list in place and the open header without redrawing the conversation. */
  function refreshPresence() {
    rebuild();
    drawList();
    const p = sel && find(sel);
    const pres = $('#fx-pres', root);
    if (p && pres) Motion.swap(pres, Motd.html(personLine(p)));
    const avatar = $('.fx-head .fx-av', root);
    if (p && avatar) avatar.className = `fx-av st-${p.status}${p.pending ? ' pending' : ''}`;
    const call = $('#fx-call', root);
    if (p && call) { const can = p.status === 'game' || p.status === 'launcher'; call.disabled = !!Chat.call || !can; call.classList.toggle('ghost', !can); }
  }

  const off = typeof Chat === 'object' ? Chat.on(async (what, data) => {
    if (!alive) return;
    if (what === 'broker') drawBroker();
    if (!booted) return;
    if (what === 'contacts' || what === 'presence') refreshPresence();
    const p = sel && find(sel);
    if (what === 'message' && data && p && p.contact && data.hex === p.contact.hex) {
      const log = $('#cv-log', root);
      if (log) {
        const msgs = await nore.chat.history(p.contact.hex);
        const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 80;
        log.innerHTML = chatBubbles(msgs, known);
        msgs.forEach(m => known.add(m.mid));
        if (atBottom || (data.msg && data.msg.mine)) log.scrollTop = log.scrollHeight;
        if (data.msg && !data.msg.mine) nore.chat.read(p.contact.hex);
      }
    }
    if (what === 'typing' && p && p.contact && data === p.contact.hex) {
      const t = $('#cv-typing', root);
      if (t) { t.textContent = `${p.name} pisze…`; t.classList.add('on'); clearTimeout(t._h); t._h = setTimeout(() => { t.classList.remove('on'); }, 3000); }
    }
    if (what === 'call') { const b = $('#fx-call', root); if (b) b.disabled = !!Chat.call || !(p && (p.status === 'game' || p.status === 'launcher')); }
  }) : () => {};

  const boot = async () => {
    try { nicks = await nore.friends.list(); } catch (e) { errorToast(e, 'Znajomi'); }
    if (!alive) return;
    if (typeof Chat === 'object' && !Chat.me) await Chat.start().catch(() => {});
    if (!alive) return;
    rebuild();
    // a remembered or linked key that no longer exists (e.g. hex of a contact now merged with a nick)
    if (sel && !find(sel) && sel.startsWith('h:')) { const p = people.find(x => x.contact && 'h:' + x.contact.hex === sel); sel = p ? p.key : null; }
    if (sel && !find(sel)) sel = null;
    booted = true;
    drawBroker(); drawMe(); drawList(); drawMain();
  };
  boot();
  setTimeout(() => { if (alive && !sel) input.focus(); }, 250);
  return () => { alive = false; off(); if (typeof Chat === 'object') Chat.viewing = null; };
};

// ================================================================== gallery

Pages.gallery = (root) => {
  let shots = [];
  let filter = 'all';
  root.innerHTML = `
    <div class="page-head"><div><h2>${icon('monitor')} Galeria</h2><p>Zrzuty ekranu ze wszystkich instancji (F2 w grze).</p></div>
      <div class="actions"><button class="btn ghost" id="ga-refresh">${icon('refresh')} Odśwież</button></div></div>
    <div class="chips ga-filter" id="ga-filter"></div>
    <div class="ga-grid" id="ga-grid"><div class="card empty" style="grid-column:1/-1"><span class="spinner"></span><div>Wczytywanie zrzutów…</div></div></div>`;

  const filtered = () => shots.filter(s => filter === 'all' || s.instanceId === filter);
  const render = () => {
    const insts = [...new Map(shots.map(s => [s.instanceId, s.instance])).entries()];
    $('#ga-filter', root).innerHTML = shots.length ? [['all', `Wszystkie <i>${shots.length}</i>`], ...insts.map(([id, name]) => [id, `${esc(name)} <i>${shots.filter(s => s.instanceId === id).length}</i>`])]
      .map(([v, l]) => `<button class="lchip ${v === filter ? 'on' : ''}" data-v="${esc(v)}">${l}</button>`).join('') : '';
    $$('#ga-filter .lchip', root).forEach(b => b.onclick = () => { filter = b.dataset.v; render(); });
    const grid = $('#ga-grid', root);
    const list = filtered();
    if (!list.length) {
      grid.innerHTML = `<div class="card empty" style="grid-column:1/-1">${icon('image')}<div>Nie ma jeszcze zrzutów ekranu.<br><small>Naciśnij F2 w grze – Nore Client pokaże podgląd, a zrzut pojawi się tutaj.</small></div></div>`;
      return;
    }
    let lastDay = '';
    grid.innerHTML = list.map((s, i) => {
      const day = new Date(s.time).toLocaleDateString('pl-PL', { day: 'numeric', month: 'long', year: 'numeric' });
      const sep = day !== lastDay ? `<div class="ga-day">${esc(day)}</div>` : '';
      lastDay = day;
      return `${sep}<div class="ga-item" data-i="${i}" style="--i:${Math.min(i, 16)}">
        ${s.thumb ? `<img src="${s.thumb}" alt="" loading="lazy">` : `<div class="ga-missing">${icon('image')}</div>`}
        <div class="ga-meta"><b>${esc(s.instance)}</b><span>${new Date(s.time).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' })} • ${fmtBytes(s.size)}</span></div></div>`;
    }).join('');
    stagger(grid);
    $$('.ga-item', grid).forEach(it => it.onclick = () => lightbox(list, +it.dataset.i));
  };

  const lightbox = (list, index) => {
    const m = modal(`<div class="lb"><div class="lb-stage"><img id="lb-img" alt=""><span class="spinner" id="lb-spin"></span>
        <button class="lb-nav prev" id="lb-prev">${icon('arrowLeft')}</button><button class="lb-nav next" id="lb-next">${icon('arrowRight')}</button></div>
      <div class="lb-bar"><div class="grow"><b id="lb-name"></b><span id="lb-sub"></span></div>
        <button class="btn ghost sm" data-a="copy">${icon('copy')} Kopiuj</button>
        <button class="btn ghost sm" data-a="open">${icon('external')} Otwórz</button>
        <button class="btn ghost sm" data-a="reveal">${icon('folder')} Folder</button>
        <button class="btn danger sm icon" data-a="del" title="Usuń">${icon('trash')}</button>
        <button class="btn ghost sm icon" data-close title="Zamknij">${icon('x')}</button></div></div>`, { onClose: () => document.removeEventListener('keydown', onKey) });
    m.el.classList.add('lb-modal');
    const show = async () => {
      const s = list[index];
      $('#lb-name', m.el).textContent = s.name;
      $('#lb-sub', m.el).textContent = `${s.instance} • ${new Date(s.time).toLocaleString('pl-PL')} • ${index + 1}/${list.length}`;
      const img = $('#lb-img', m.el);
      if (s.thumb) img.src = s.thumb;
      img.classList.add('loading');
      $('#lb-spin', m.el).hidden = false;
      const want = index;
      const full = await nore.gallery.full(s.path).catch(() => null);
      if (want !== index) return;
      if (full) img.src = full;
      img.classList.remove('loading');
      $('#lb-spin', m.el).hidden = true;
      $('#lb-prev', m.el).hidden = index === 0;
      $('#lb-next', m.el).hidden = index === list.length - 1;
    };
    const step = (d) => { const n = index + d; if (n < 0 || n >= list.length) return; index = n; show(); };
    const onKey = (e) => { if (e.key === 'ArrowLeft') step(-1); else if (e.key === 'ArrowRight') step(1); else if (e.key === 'Escape') m.close(); };
    document.addEventListener('keydown', onKey);
    $('#lb-prev', m.el).onclick = () => step(-1);
    $('#lb-next', m.el).onclick = () => step(1);
    const act = (a, fn) => { $(`[data-a="${a}"]`, m.el).onclick = () => fn(list[index]).catch(e => errorToast(e, 'Galeria')); };
    act('copy', async s => { await nore.gallery.copy(s.path); toast('Skopiowano obraz', 'Wklej go np. na Discordzie.', 'success', 2200); });
    act('open', s => nore.gallery.open(s.path));
    act('reveal', s => nore.gallery.reveal(s.path));
    act('del', async s => {
      if (!await confirmModal('Usunąć zrzut?', s.name, { ok: 'Usuń', danger: true })) return;
      await nore.gallery.remove(s.path);
      shots = shots.filter(x => x.path !== s.path);
      list.splice(index, 1);
      render();
      if (!list.length) return m.close();
      index = Math.min(index, list.length - 1);
      show();
    });
    show();
  };

  const load = () => nore.gallery.list().then(l => { shots = l; render(); }).catch(e => errorToast(e, 'Galeria'));
  $('#ga-refresh', root).onclick = load;
  load();
};

// ================================================================== shop (coming soon)

const SHOP_ITEMS = [
  { name: 'Skrzydła Feniksa', kind: 'Skrzydła', cls: 'wings', c1: '#ffb547', c2: '#ff3d1a' },
  { name: 'Aureola Nova', kind: 'Aureola', cls: 'halo', c1: '#c9a4ff', c2: '#7fe3ff' },
  { name: 'Smocze skrzydła', kind: 'Skrzydła', cls: 'wings', c1: '#8af0c0', c2: '#0e7a52' },
  { name: 'Ognisty ślad', kind: 'Efekt', cls: 'trail', c1: '#ffe08a', c2: '#ff6b2c' },
];

Pages.shop = (root) => {
  root.innerHTML = `
    <div class="shop-hero card stagger">
      <div class="shop-glow"></div>
      <div style="--i:0"><span class="tag accent">${icon('clock')} WKRÓTCE</span>
        <h1>Sklep <span>Nore</span></h1>
        <p class="lead">Skrzydła, aureole, efekty i ekskluzywne peleryny – widoczne dla wszystkich graczy Nore Client.
          Sklep ruszy w jednej z kolejnych aktualizacji.</p></div>
      <div class="shop-preview" style="--i:1">${SHOP_ITEMS.map((it, i) => `<div class="shop-item" style="--c1:${it.c1};--c2:${it.c2};--d:${i * 0.4}s">
        <div class="shop-art ${it.cls}"><i></i><i></i></div><b>${esc(it.name)}</b><small>${esc(it.kind)}</small><span class="lock">${icon('key')}</span></div>`).join('')}</div>
    </div>
    <div class="card shop-free stagger">
      <div style="--i:0"><div class="section-title">${icon('sparkles')} Za darmo już teraz: kolekcja „Historia Nore”</div>
        <p class="muted">Trzy peleryny upamiętniające aktualizacje, które zbudowały projekt: <b>Genesis</b> (1.0), <b>Kuźnia 2.1</b> i <b>Nova 1.4</b>.
          Załóż je w grze: menu główne → kafelek <b>Kosmetyki</b>. Są animowane i widać je w widoku F5 oraz na elytrze.</p></div>
      <img src="assets/capes-historia.gif" alt="Peleryny Historia Nore" style="--i:1">
    </div>`;
  stagger(root);
};

// ================================================================== sidebar collapse

(function sidebarToggle() {
  const KEY = 'nore.sidebarCollapsed';
  const apply = (on) => {
    document.body.classList.toggle('sb-collapsed', on);
    setTimeout(() => window.dispatchEvent(new Event('resize')), 320);
  };
  let collapsed = false;
  try { collapsed = localStorage.getItem(KEY) === '1'; } catch { /* storage unavailable */ }
  apply(collapsed);
  const btn = document.getElementById('sb-toggle');
  if (btn) btn.onclick = () => {
    collapsed = !collapsed;
    try { localStorage.setItem(KEY, collapsed ? '1' : '0'); } catch { /* storage unavailable */ }
    apply(collapsed);
  };
})();
