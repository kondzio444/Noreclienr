'use strict';
/*
 * Friends chat & voice. Peer-to-peer: messages and audio go straight between launchers over WebRTC,
 * the public PeerJS broker only introduces them. Each launcher is "nore-<id>" on the broker, where
 * id is the hash of its public key (Nore ID). Every connection starts with a handshake in which
 * both sides sign the other's random challenge (keys stay in the main process, see main/chat.js),
 * so a friend cannot be impersonated. Messages to offline friends wait and go out when they come
 * online; history is kept locally.
 */

const CHAT_PROTO = 'nore-chat-v1';
const ICE = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
  { urls: 'stun:stun.cloudflare.com:3478' },
  // free public relay for networks where a direct connection is impossible (symmetric NAT)
  { urls: ['turn:openrelay.metered.ca:80', 'turn:openrelay.metered.ca:443', 'turn:openrelay.metered.ca:443?transport=tcp'], username: 'openrelayproject', credential: 'openrelayproject' },
];

const randomB64 = () => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(18))));
const hexOfPeer = (peerId) => String(peerId || '').replace(/^nore-/, '');
const vsettings = () => { try { return JSON.parse(localStorage.getItem('nore.voice') || '{}'); } catch { return {}; } };
const saveVsettings = (v) => { try { localStorage.setItem('nore.voice', JSON.stringify({ ...vsettings(), ...v })); } catch { /* storage off */ } };

const Chat = {
  me: null,
  peer: null,
  broker: 'off', // off | connecting | online | error
  contacts: [],
  requests: [],
  links: new Map(), // hex → { conn, authed, status, detail, typing }
  pendingConns: new Set(),
  listeners: new Set(),
  call: null, // { hex, mc, local, remote, phase: 'out' | 'in' | 'active', muted, deaf, started }

  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); },
  emit(what, data) { for (const fn of [...this.listeners]) { try { fn(what, data); } catch (e) { console.error(e); } } },
  contact(hex) { return this.contacts.find(c => c.hex === hex) || null; },
  online(hex) { const l = this.links.get(hex); return !!(l && l.authed && l.conn.open); },
  unread() { return this.contacts.reduce((n, c) => n + (c.unread || 0), 0); },

  async start() {
    if (this.peer || typeof Peer === 'undefined') return;
    try { this.me = await nore.chat.identity(); } catch (e) { console.error(e); return; }
    await this.reload();
    this.connectBroker();
    setInterval(() => this.dialAll(), 30000);
    // tell friends whether we are in the launcher or in the game
    let lastStatus = '';
    App.onChange(() => {
      const s = this.myStatus();
      const key = JSON.stringify(s);
      if (key !== lastStatus) { lastStatus = key; this.broadcast({ t: 'status', ...s }); }
    });
  },

  myStatus() {
    if (App.running) {
      const inst = (App.state.instances || []).find(i => i.id === App.running);
      return { state: 'game', detail: inst ? `${inst.name} • ${inst.mcVersion}` : 'Minecraft' };
    }
    return { state: 'launcher', detail: '' };
  },

  async reload() {
    [this.contacts, this.requests] = await Promise.all([nore.chat.contacts(), nore.chat.requests()]);
    this.emit('contacts');
    const badge = document.querySelector('[data-badge="chat"]');
    if (badge) { const n = this.unread() + this.requests.length; badge.hidden = !n; badge.textContent = n; }
  },

  connectBroker() {
    this.broker = 'connecting';
    this.emit('broker');
    const peer = new Peer(this.me.peer, { config: { iceServers: ICE }, debug: 0 });
    this.peer = peer;
    peer.on('open', () => { this.broker = 'online'; this.emit('broker'); this.dialAll(); });
    peer.on('connection', (conn) => this.adopt(conn, false));
    peer.on('call', (mc) => this.incomingCall(mc));
    peer.on('disconnected', () => {
      this.broker = 'connecting'; this.emit('broker');
      setTimeout(() => { if (!peer.destroyed) try { peer.reconnect(); } catch { /* retried below */ } }, 3000);
    });
    peer.on('error', (err) => {
      if (err.type === 'peer-unavailable') {
        const hex = hexOfPeer((/nore-[0-9a-f]+/.exec(err.message) || [])[0]);
        this.pendingConns.delete(hex);
        return;
      }
      if (['unavailable-id', 'network', 'server-error', 'socket-error', 'socket-closed'].includes(err.type)) {
        // our id is still held by a previous session, or the broker is unreachable: start over
        this.broker = 'error'; this.emit('broker');
        try { peer.destroy(); } catch { /* gone */ }
        this.peer = null;
        setTimeout(() => this.connectBroker(), err.type === 'unavailable-id' ? 15000 : 8000);
      }
    });
  },

  dialAll() {
    if (!this.peer || this.broker !== 'online') return;
    for (const c of this.contacts) {
      if (this.online(c.hex) || this.pendingConns.has(c.hex)) continue;
      this.dial(c.hex);
    }
  },

  dial(hex) {
    if (!this.peer || this.broker !== 'online') return;
    this.pendingConns.add(hex);
    const conn = this.peer.connect('nore-' + hex, { reliable: true, serialization: 'json', metadata: { v: CHAT_PROTO } });
    this.adopt(conn, true, hex);
    setTimeout(() => this.pendingConns.delete(hex), 20000);
  },

  /** Handshake on a new data connection (ours or theirs). */
  adopt(conn, outgoing, expectHex) {
    const st = { conn, outgoing, hex: expectHex || hexOfPeer(conn.peer), ch: randomB64(), theirs: null, authed: false };
    const hello = async () => conn.send({ t: 'hello', v: CHAT_PROTO, hex: this.me.hex, pub: this.me.pub, name: this.me.name, ch: st.ch });
    conn.on('open', hello);
    if (conn.open) hello();
    conn.on('data', (msg) => this.receive(st, msg).catch(e => console.error('chat', e)));
    conn.on('close', () => this.dropped(st));
    conn.on('error', () => this.dropped(st));
    setTimeout(() => { if (!st.authed) { try { conn.close(); } catch { /* closed */ } } }, 25000);
  },

  async receive(st, msg) {
    if (!msg || typeof msg !== 'object') return;
    if (!st.authed) {
      if (msg.t === 'hello' && typeof msg.pub === 'string' && typeof msg.ch === 'string') {
        // the claimed id must be the broker id we talk to (and the one we dialled)
        if (msg.hex !== st.hex || msg.hex !== hexOfPeer(st.conn.peer)) return st.conn.close();
        st.theirs = msg;
        const sig = await nore.chat.sign(`${CHAT_PROTO}|${msg.ch}|${this.me.hex}|${msg.hex}`);
        st.conn.send({ t: 'proof', sig });
      } else if (msg.t === 'proof' && st.theirs) {
        const ok = await nore.chat.verify(st.hex, st.theirs.pub, `${CHAT_PROTO}|${st.ch}|${st.hex}|${this.me.hex}`, msg.sig);
        if (!ok) return st.conn.close();
        this.authenticated(st);
      }
      return;
    }
    const hex = st.hex;
    const known = !!this.contact(hex);
    switch (msg.t) {
      case 'status': {
        const l = this.links.get(hex);
        if (l) { l.status = msg.state; l.detail = String(msg.detail || '').slice(0, 80); }
        this.emit('presence', hex);
        break;
      }
      case 'invite':
        if (!known) {
          this.requests = await nore.chat.addRequest(hex, st.theirs.pub, st.theirs.name, msg.text);
          this.reload();
          toast('Zaproszenie do znajomych', `${st.theirs.name} chce dodać Cię do czatu`, 'info', 6000);
          this.notify(`${st.theirs.name} zaprasza Cię do znajomych`, 'Otwórz Czat w Nore Launcher');
        }
        break;
      case 'accepted':
        this.flush(hex);
        break;
      case 'msg': {
        if (!known || typeof msg.text !== 'string' || !msg.mid) return;
        const saved = await nore.chat.put(hex, { mid: String(msg.mid).slice(0, 40), text: msg.text, ts: Math.min(Date.now(), Number(msg.ts) || Date.now()), mine: false, read: this.viewing === hex && document.hasFocus() });
        st.conn.send({ t: 'ack', mid: msg.mid });
        const l = this.links.get(hex); if (l) l.typing = 0;
        this.emit('message', { hex, msg: saved });
        if (!(this.viewing === hex && document.hasFocus())) {
          const c = this.contact(hex);
          if (this.viewing !== hex) toast(c ? c.name : 'Wiadomość', msg.text.slice(0, 120), 'info', 4500);
          this.notify(c ? c.name : 'Nowa wiadomość', msg.text.slice(0, 160));
          nore.chat.attention();
        }
        this.reload();
        break;
      }
      case 'ack':
        await nore.chat.put(hex, { mid: msg.mid, state: 'delivered' });
        this.emit('message', { hex });
        break;
      case 'typing': {
        const l = this.links.get(hex); if (l) l.typing = Date.now();
        this.emit('typing', hex);
        break;
      }
      case 'call-decline':
      case 'call-busy':
        if (this.call && this.call.hex === hex) { toast(this.contact(hex) ? this.contact(hex).name : 'Rozmowa', msg.t === 'call-busy' ? 'Rozmawia z kimś innym' : 'Odrzucił połączenie', 'info'); this.endCall(false); }
        break;
      default: break;
    }
  },

  async authenticated(st) {
    const hex = st.hex;
    const prev = this.links.get(hex);
    if (prev && prev.authed && prev.conn.open && prev.conn !== st.conn) {
      // two connections raced: both sides keep the one opened by the smaller id
      const initiator = (s) => (s.outgoing ? this.me.hex : hex);
      if (initiator(prev) <= initiator(st)) { st.conn.close(); return; }
      prev.closing = true;
      try { prev.conn.close(); } catch { /* closed */ }
    }
    st.authed = true;
    st.status = 'launcher';
    this.links.set(hex, st);
    this.pendingConns.delete(hex);
    const known = await nore.chat.seen(hex, st.theirs.pub, st.theirs.name);
    st.conn.send({ t: 'status', ...this.myStatus() });
    if (known) {
      // 'invite' turns into an invitation on their side if they have not added us yet
      st.conn.send({ t: 'invite', text: '' });
      st.conn.send({ t: 'accepted' });
      await this.flush(hex);
    }
    await this.reload();
    this.emit('presence', hex);
  },

  dropped(st) {
    this.pendingConns.delete(st.hex);
    if (this.links.get(st.hex) === st) {
      this.links.delete(st.hex);
      this.emit('presence', st.hex);
      if (this.call && this.call.hex === st.hex && this.call.phase !== 'active') this.endCall(false);
    }
  },

  /** Sends our messages the friend has not confirmed yet. */
  async flush(hex) {
    const l = this.links.get(hex);
    if (!l || !l.authed) return;
    for (const m of await nore.chat.history(hex)) {
      if (m.mine && m.state !== 'delivered') l.conn.send({ t: 'msg', mid: m.mid, text: m.text, ts: m.ts });
    }
  },

  broadcast(msg) {
    for (const l of this.links.values()) if (l.authed && l.conn.open) { try { l.conn.send(msg); } catch { /* closing */ } }
  },

  async send(hex, text) {
    text = String(text || '').trim().slice(0, 2000);
    if (!text) return null;
    const msg = { mid: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`, text, ts: Date.now(), mine: true, state: 'sent' };
    const saved = await nore.chat.put(hex, { ...msg, state: this.online(hex) ? 'sent' : 'pending' });
    const l = this.links.get(hex);
    if (l && l.authed && l.conn.open) l.conn.send({ t: 'msg', mid: msg.mid, text, ts: msg.ts });
    else this.dial(hex);
    this.emit('message', { hex, msg: saved });
    return saved;
  },

  typing(hex) {
    const l = this.links.get(hex);
    const now = Date.now();
    if (l && l.authed && (!l.sentTyping || now - l.sentTyping > 2500)) { l.sentTyping = now; l.conn.send({ t: 'typing' }); }
  },

  async add(id, name) {
    this.contacts = await nore.chat.add(id, name);
    const c = this.contacts[this.contacts.length - 1];
    await this.reload();
    const l = c && this.links.get(c.hex);
    if (l && l.authed) { await nore.chat.seen(c.hex, l.theirs.pub, l.theirs.name); l.conn.send({ t: 'invite', text: '' }); l.conn.send({ t: 'accepted' }); await this.flush(c.hex); }
    else if (c) this.dial(c.hex);
    return c;
  },

  notify(title, body) {
    if (document.hasFocus()) return;
    try { new Notification(title, { body, silent: false }); } catch { /* notifications off */ }
  },

  // ---------------------------------------------------------------- voice

  async microphone() {
    const v = vsettings();
    return navigator.mediaDevices.getUserMedia({
      audio: { deviceId: v.mic ? { ideal: v.mic } : undefined, echoCancellation: true, noiseSuppression: v.noise !== false, autoGainControl: true },
      video: false,
    });
  },

  async startCall(hex) {
    if (this.call) return toast('Rozmowa', 'Najpierw zakończ obecną rozmowę.', 'error');
    if (!this.online(hex)) return toast('Znajomy jest offline', 'Rozmowy głosowe działają, gdy oboje macie otwarty launcher.', 'error');
    let local;
    try { local = await this.microphone(); } catch (e) { return errorToast(new Error('Brak dostępu do mikrofonu: ' + e.message), 'Rozmowa'); }
    const mc = this.peer.call('nore-' + hex, local, { metadata: { v: CHAT_PROTO } });
    this.call = { hex, mc, local, phase: 'out', muted: false, deaf: false };
    this.wireCall(mc);
    this.ring(true, 'out');
    this.emit('call');
    setTimeout(() => { if (this.call && this.call.mc === mc && this.call.phase === 'out') { toast('Brak odpowiedzi', this.contact(hex) ? this.contact(hex).name : '', 'info'); this.endCall(true); } }, 40000);
  },

  incomingCall(mc) {
    const hex = hexOfPeer(mc.peer);
    // only friends whose identity was just proven on the data channel can ring
    if (!this.contact(hex) || !this.online(hex)) { try { mc.close(); } catch { /* closed */ } return; }
    if (this.call) { const l = this.links.get(hex); if (l) l.conn.send({ t: 'call-busy' }); try { mc.close(); } catch { /* closed */ } return; }
    this.call = { hex, mc, local: null, phase: 'in', muted: false, deaf: false };
    this.wireCall(mc);
    this.ring(true, 'in');
    this.notify(`${this.contact(hex).name} dzwoni`, 'Odbierz w Nore Launcher');
    nore.chat.attention();
    this.emit('call');
  },

  async answer() {
    const c = this.call;
    if (!c || c.phase !== 'in') return;
    try { c.local = await this.microphone(); } catch (e) { errorToast(new Error('Brak dostępu do mikrofonu: ' + e.message), 'Rozmowa'); return this.decline(); }
    c.mc.answer(c.local);
    this.ring(false);
    c.phase = 'active';
    c.started = Date.now();
    this.emit('call');
  },

  decline() {
    const c = this.call;
    if (!c) return;
    const l = this.links.get(c.hex);
    if (l && l.authed) l.conn.send({ t: 'call-decline' });
    this.endCall(true);
  },

  wireCall(mc) {
    mc.on('stream', (remote) => {
      const c = this.call;
      if (!c || c.mc !== mc) return;
      c.remote = remote;
      if (c.phase === 'out') { c.phase = 'active'; c.started = Date.now(); this.ring(false); }
      let audio = document.getElementById('nore-call-audio');
      if (!audio) { audio = document.createElement('audio'); audio.id = 'nore-call-audio'; audio.autoplay = true; document.body.appendChild(audio); }
      audio.srcObject = remote;
      const v = vsettings();
      audio.volume = v.volume != null ? v.volume : 1;
      audio.muted = c.deaf;
      if (v.speaker && audio.setSinkId) audio.setSinkId(v.speaker).catch(() => {});
      this.meter(c);
      this.emit('call');
    });
    mc.on('close', () => { if (this.call && this.call.mc === mc) this.endCall(false); });
    mc.on('error', () => { if (this.call && this.call.mc === mc) this.endCall(false); });
  },

  /** Speaking indicators for both sides. */
  meter(c) {
    try {
      const ctx = c.ctx || (c.ctx = new AudioContext());
      const level = (stream) => {
        const an = ctx.createAnalyser();
        an.fftSize = 512;
        ctx.createMediaStreamSource(stream).connect(an);
        const buf = new Uint8Array(an.fftSize);
        return () => { an.getByteTimeDomainData(buf); let s = 0; for (const x of buf) s += (x - 128) ** 2; return Math.sqrt(s / buf.length) / 128; };
      };
      const me = c.local ? level(c.local) : () => 0, them = c.remote ? level(c.remote) : () => 0;
      clearInterval(c.meterTimer);
      c.meterTimer = setInterval(() => {
        c.levels = { me: c.muted ? 0 : me(), them: them() };
        this.emit('levels');
      }, 120);
    } catch { /* no audio context */ }
  },

  mute(on) {
    const c = this.call; if (!c || !c.local) return;
    c.muted = on != null ? on : !c.muted;
    c.local.getAudioTracks().forEach(t => { t.enabled = !c.muted; });
    this.emit('call');
  },

  deafen(on) {
    const c = this.call; if (!c) return;
    c.deaf = on != null ? on : !c.deaf;
    const a = document.getElementById('nore-call-audio'); if (a) a.muted = c.deaf;
    this.emit('call');
  },

  setVolume(v) {
    saveVsettings({ volume: v });
    const a = document.getElementById('nore-call-audio'); if (a) a.volume = v;
  },

  endCall(local) {
    const c = this.call;
    if (!c) return;
    this.call = null;
    this.ring(false);
    clearInterval(c.meterTimer);
    if (local) { try { c.mc.close(); } catch { /* closed */ } }
    for (const s of [c.local]) if (s) s.getTracks().forEach(t => t.stop());
    if (c.ctx) c.ctx.close().catch(() => {});
    const a = document.getElementById('nore-call-audio'); if (a) a.srcObject = null;
    this.emit('call');
  },

  /** Soft two-tone ring (incoming) or ring-back (outgoing), generated – no audio files. */
  ring(on, kind) {
    clearInterval(this.ringTimer);
    if (this.ringCtx) { this.ringCtx.close().catch(() => {}); this.ringCtx = null; }
    if (!on) return;
    try {
      const ctx = this.ringCtx = new AudioContext();
      const beep = () => {
        const tones = kind === 'in' ? [[880, 0], [660, 0.18], [880, 0.36]] : [[440, 0], [440, 0.25]];
        for (const [f, t] of tones) {
          const o = ctx.createOscillator(), g = ctx.createGain();
          o.frequency.value = f; o.type = 'sine';
          g.gain.setValueAtTime(0, ctx.currentTime + t);
          g.gain.linearRampToValueAtTime(kind === 'in' ? 0.12 : 0.05, ctx.currentTime + t + 0.02);
          g.gain.linearRampToValueAtTime(0, ctx.currentTime + t + 0.16);
          o.connect(g).connect(ctx.destination);
          o.start(ctx.currentTime + t); o.stop(ctx.currentTime + t + 0.2);
        }
      };
      beep();
      this.ringTimer = setInterval(beep, kind === 'in' ? 1800 : 3000);
    } catch { /* no audio */ }
  },
};

// ================================================================== floating call bar (visible on every page)

function renderCallBar() {
  let bar = document.getElementById('call-bar');
  const c = Chat.call;
  if (!c) { if (bar) { bar.classList.add('out'); setTimeout(() => bar.remove(), 200); } return; }
  if (!bar) { bar = el('<div id="call-bar" class="call-bar"></div>'); document.body.appendChild(bar); }
  const f = Chat.contact(c.hex) || { name: 'Znajomy' };
  const v = vsettings();
  bar.className = `call-bar ${c.phase}`;
  bar.innerHTML = `<div class="cb-who"><div class="cb-av" id="cb-them"><img src="${head(f.name, 64)}" alt="" data-fallback></div>
      <div><b>${esc(f.name)}</b><span id="cb-time">${c.phase === 'in' ? 'Dzwoni do Ciebie…' : c.phase === 'out' ? 'Łączenie…' : '00:00'}</span></div></div>
    ${c.phase === 'in' ? `<button class="btn success sm" id="cb-ok">${icon('play')} Odbierz</button><button class="btn danger sm" id="cb-no">${icon('x')} Odrzuć</button>`
      : `<button class="btn ghost sm icon ${c.muted ? 'on-red' : ''}" id="cb-mute" title="${c.muted ? 'Włącz mikrofon' : 'Wycisz mikrofon'}">${c.muted ? '🔇' : '🎙️'}</button>
        <button class="btn ghost sm icon ${c.deaf ? 'on-red' : ''}" id="cb-deaf" title="${c.deaf ? 'Włącz dźwięk' : 'Wyłącz dźwięk'}">${c.deaf ? '🙉' : '🎧'}</button>
        <input type="range" class="slider cb-vol" id="cb-vol" min="0" max="1" step="0.05" value="${v.volume != null ? v.volume : 1}" title="Głośność">
        <button class="btn danger sm" id="cb-end">${icon('x')} Rozłącz</button>`}`;
  const on = (id, fn) => { const b = $(id, bar); if (b) b.onclick = fn; };
  on('#cb-ok', () => Chat.answer());
  on('#cb-no', () => Chat.decline());
  on('#cb-mute', () => Chat.mute());
  on('#cb-deaf', () => Chat.deafen());
  on('#cb-end', () => Chat.endCall(true));
  const vol = $('#cb-vol', bar);
  if (vol) { sliderFill(vol); vol.oninput = () => { Chat.setVolume(+vol.value); sliderFill(vol); }; }
}

setInterval(() => {
  const c = Chat.call, t = document.getElementById('cb-time');
  if (c && c.phase === 'active' && t) {
    const s = Math.floor((Date.now() - c.started) / 1000);
    t.textContent = `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  }
}, 1000);

Chat.on((what) => {
  if (what === 'call') renderCallBar();
  if (what === 'levels' && Chat.call && Chat.call.levels) {
    const t = document.getElementById('cb-them');
    if (t) t.classList.toggle('speaking', Chat.call.levels.them > 0.04);
    document.querySelectorAll('.cv-me').forEach(x => x.classList.toggle('speaking', Chat.call.levels.me > 0.04));
  }
});

// ================================================================== page

function presenceText(hex) {
  const l = Chat.links.get(hex);
  if (l && l.authed) return l.status === 'game' ? `W grze${l.detail ? ': ' + l.detail : ''}` : 'Online w launcherze';
  const c = Chat.contact(hex);
  return c && c.seen ? `Offline • ${fmtAgo(c.seen)}` : 'Offline';
}

function presenceClass(hex) {
  const l = Chat.links.get(hex);
  return l && l.authed ? (l.status === 'game' ? 'game' : 'on') : 'off';
}

Pages.chat = (root, opts = {}) => {
  let sel = opts.hex || Chat.lastViewed || null;
  let alive = true;
  root.innerHTML = `<div class="page-head"><div><h2>${icon('users')} Czat i głos</h2><p>Prywatne wiadomości i rozmowy głosowe ze znajomymi – bezpośrednio między komputerami, szyfrowane.</p></div>
      <div class="actions"><span class="ch-broker" id="ch-broker"></span></div></div>
    <div class="ch-wrap">
      <aside class="card ch-side">
        <div class="ch-me" id="ch-me"></div>
        <div class="ch-add"><input class="input sm" id="ch-id" placeholder="Nore ID znajomego (NORE-…)" spellcheck="false"><input class="input sm" id="ch-name" placeholder="Nazwa (opcjonalnie)" maxlength="24">
          <button class="btn sm" id="ch-addb">${icon('plus')} Dodaj</button></div>
        <div id="ch-req"></div>
        <div class="ch-list" id="ch-list"></div>
      </aside>
      <section class="card ch-main" id="ch-main"></section>
    </div>`;

  const drawBroker = () => {
    const b = $('#ch-broker', root);
    if (!b) return;
    const map = { online: ['on', 'Połączono'], connecting: ['wait', 'Łączenie…'], error: ['off', 'Brak połączenia – ponawiam'], off: ['off', 'Wyłączony'] };
    const [cls, txt] = map[Chat.broker] || map.off;
    b.className = `ch-broker ${cls}`;
    b.innerHTML = `<i></i>${txt}`;
  };

  const drawMe = () => {
    const box = $('#ch-me', root);
    if (!Chat.me) { box.innerHTML = '<div class="muted">Uruchamianie czatu…</div>'; return; }
    box.innerHTML = `<div class="cv-me"><img src="${head(Chat.me.name, 64)}" alt="" data-fallback></div><div class="grow" style="min-width:0"><b>${esc(Chat.me.name)}</b>
        <div class="ch-myid" title="Kopiuj">${esc(Chat.me.id)} ${icon('copy')}</div></div>`;
    $('.ch-myid', box).onclick = () => { navigator.clipboard.writeText(Chat.me.id); toast('Skopiowano Twój Nore ID', 'Wyślij go znajomemu – doda Cię w zakładce Czat.', 'success'); };
  };

  const drawRequests = () => {
    const box = $('#ch-req', root);
    box.innerHTML = Chat.requests.length ? `<div class="ch-sub">Zaproszenia</div>${Chat.requests.map(r => `<div class="ch-reqrow" data-h="${r.hex}">
        <img src="${head(r.name, 40)}" alt="" data-fallback><div class="grow" style="min-width:0"><b>${esc(r.name)}</b><span>${esc(r.id)}</span></div>
        <button class="btn success sm icon" data-a="ok" title="Przyjmij">${icon('check')}</button><button class="btn ghost sm icon" data-a="no" title="Odrzuć">${icon('x')}</button></div>`).join('')}` : '';
    $$('.ch-reqrow', box).forEach(row => {
      const r = Chat.requests.find(x => x.hex === row.dataset.h);
      $('[data-a="ok"]', row).onclick = async () => { try { await Chat.add(r.id, r.name); sel = r.hex; toast('Dodano znajomego', r.name, 'success'); draw(); } catch (e) { errorToast(e); } };
      $('[data-a="no"]', row).onclick = async () => { Chat.requests = await nore.chat.decline(r.hex, false); Chat.reload(); };
    });
  };

  const drawList = () => {
    const box = $('#ch-list', root);
    const list = [...Chat.contacts].sort((a, b) => (Chat.online(b.hex) - Chat.online(a.hex)) || ((b.last && b.last.ts) || 0) - ((a.last && a.last.ts) || 0));
    box.innerHTML = `<div class="ch-sub">Znajomi • ${list.filter(c => Chat.online(c.hex)).length} online</div>` + (list.length ? list.map(c => `<div class="ch-row ${c.hex === sel ? 'on' : ''}" data-h="${c.hex}">
        <div class="ch-av ${presenceClass(c.hex)}"><img src="${head(c.name, 48)}" alt="" data-fallback><i></i></div>
        <div class="grow" style="min-width:0"><b>${esc(c.name)}</b><span>${c.last ? esc((c.last.mine ? 'Ty: ' : '') + c.last.text) : esc(presenceText(c.hex))}</span></div>
        ${c.unread ? `<em>${c.unread}</em>` : ''}</div>`).join('')
      : `<div class="ch-empty-list">${icon('users')}<span>Wyślij znajomemu swój Nore ID albo wpisz jego ID powyżej.</span></div>`);
    $$('.ch-row', box).forEach(r => r.onclick = () => { sel = r.dataset.h; draw(); });
  };

  const bubbles = (list) => {
    let lastDay = '';
    return list.map(m => {
      const d = new Date(m.ts);
      const day = d.toLocaleDateString('pl-PL', { weekday: 'long', day: 'numeric', month: 'long' });
      const sep = day !== lastDay ? `<div class="cv-day">${esc(day)}</div>` : '';
      lastDay = day;
      const state = m.mine ? (m.state === 'delivered' ? '✓✓' : m.state === 'pending' ? '🕓' : '✓') : '';
      return `${sep}<div class="cv-msg ${m.mine ? 'mine' : ''}"><div class="cv-bubble">${linkify(esc(m.text))}</div><span>${d.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' })} ${state}</span></div>`;
    }).join('');
  };
  const linkify = (s) => s.replace(/(https?:\/\/[^\s<]+)/g, '<a href="#" data-ext="$1">$1</a>').replace(/\n/g, '<br>');

  async function drawConversation() {
    const main = $('#ch-main', root);
    const c = sel && Chat.contact(sel);
    Chat.viewing = c ? c.hex : null;
    if (!c) {
      main.innerHTML = `<div class="ch-welcome"><div class="ch-hero">${icon('users')}</div><h3>Czat ze znajomymi</h3>
        <p class="muted">Twój Nore ID to Twój adres w czacie. Wyślij go znajomemu, a gdy doda Cię w launcherze, możecie pisać i rozmawiać głosowo.</p>
        ${Chat.me ? `<button class="btn" id="cw-copy">${icon('copy')} Kopiuj mój Nore ID</button>` : ''}
        <div class="ch-feat"><div>${icon('shield')}<b>Bez serwera</b><span>Wiadomości lecą prosto do znajomego (WebRTC, szyfrowane DTLS).</span></div>
          <div>${icon('key')}<b>Nie do podrobienia</b><span>Każde połączenie potwierdza klucz znajomego – nikt się pod niego nie podszyje.</span></div>
          <div>${icon('activity')}<b>Głos</b><span>Rozmowy z redukcją szumów, wyciszaniem i regulacją głośności.</span></div></div></div>`;
      if ($('#cw-copy', main)) $('#cw-copy', main).onclick = () => { navigator.clipboard.writeText(Chat.me.id); toast('Skopiowano', Chat.me.id, 'success'); };
      return;
    }
    Chat.lastViewed = c.hex;
    const msgs = await nore.chat.history(c.hex);
    if (!alive || sel !== c.hex) return;
    const online = Chat.online(c.hex);
    main.innerHTML = `<div class="cv-head"><div class="ch-av ${presenceClass(c.hex)}"><img src="${head(c.name, 64)}" alt="" data-fallback><i></i></div>
        <div class="grow" style="min-width:0"><b>${esc(c.name)}</b><span id="cv-pres">${esc(presenceText(c.hex))}</span></div>
        <button class="btn ${online ? '' : 'ghost'} sm" id="cv-call" ${Chat.call ? 'disabled' : ''}>${icon('activity')} Zadzwoń</button>
        <button class="btn ghost sm icon" id="cv-more" title="Więcej">${icon('settings')}</button></div>
      <div class="cv-log" id="cv-log">${msgs.length ? bubbles(msgs) : `<div class="cv-start">${icon('sparkles')}<span>Początek rozmowy z ${esc(c.name)}.${online ? '' : ' Wiadomości dotrą, gdy znajomy będzie online.'}</span></div>`}</div>
      <div class="cv-typing" id="cv-typing"></div>
      <div class="cv-compose"><textarea class="input" id="cv-text" rows="1" maxlength="2000" placeholder="Napisz do ${esc(c.name)}…"></textarea><button class="btn" id="cv-send">${icon('arrowRight')}</button></div>`;
    const log = $('#cv-log', main);
    log.scrollTop = log.scrollHeight;
    log.onclick = (e) => { const a = e.target.closest('a[data-ext]'); if (a) { e.preventDefault(); nore.open(a.dataset.ext); } };
    const ta = $('#cv-text', main);
    const grow = () => { ta.style.height = 'auto'; ta.style.height = Math.min(140, ta.scrollHeight) + 'px'; };
    const send = async () => { const v = ta.value; if (!v.trim()) return; ta.value = ''; grow(); await Chat.send(c.hex, v); };
    ta.oninput = () => { grow(); Chat.typing(c.hex); };
    ta.onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } };
    $('#cv-send', main).onclick = send;
    $('#cv-call', main).onclick = () => Chat.startCall(c.hex);
    $('#cv-more', main).onclick = (e) => popMenu(e.currentTarget, [
      { label: 'Kopiuj Nore ID', icon: 'copy', action: () => { navigator.clipboard.writeText(c.id); toast('Skopiowano', c.id, 'success'); } },
      { label: 'Ustawienia głosu', icon: 'settings', action: () => voiceSettingsModal() },
      { label: 'Wyczyść historię', icon: 'trash', action: async () => { if (await confirmModal('Wyczyścić historię?', `Rozmowa z ${c.name} zniknie z tego komputera.`, { ok: 'Wyczyść', danger: true })) { await nore.chat.clear(c.hex); drawConversation(); } } },
      '-',
      { label: 'Usuń znajomego', icon: 'trash', danger: true, action: async () => { if (await confirmModal(`Usunąć ${c.name}?`, 'Znajomy i historia rozmowy znikną z tego komputera.', { ok: 'Usuń', danger: true })) { await nore.chat.remove(c.hex); sel = null; await Chat.reload(); draw(); } } },
    ]);
    setTimeout(() => ta.focus(), 50);
    if (c.unread) { await nore.chat.read(c.hex); Chat.reload(); }
  }

  const draw = () => { if (!alive) return; drawBroker(); drawMe(); drawRequests(); drawList(); drawConversation(); };

  $('#ch-addb', root).onclick = async () => {
    try {
      const c = await Chat.add($('#ch-id', root).value, $('#ch-name', root).value.trim());
      $('#ch-id', root).value = ''; $('#ch-name', root).value = '';
      sel = c.hex;
      toast('Dodano znajomego', 'Gdy znajomy też doda Twój Nore ID, możecie pisać i rozmawiać.', 'success', 6000);
      draw();
    } catch (e) { errorToast(e, 'Czat'); }
  };
  $('#ch-id', root).onkeydown = (e) => { if (e.key === 'Enter') $('#ch-addb', root).click(); };

  const off = Chat.on(async (what, data) => {
    if (!alive) return;
    if (what === 'broker') drawBroker();
    if (what === 'contacts') { drawRequests(); drawList(); }
    if (what === 'presence') {
      drawList();
      if (data === sel) { const p = $('#cv-pres', root); if (p) p.textContent = presenceText(sel); const b = $('#cv-call', root); if (b) b.className = `btn ${Chat.online(sel) ? '' : 'ghost'} sm`; }
    }
    if (what === 'message' && data && data.hex === sel) {
      const log = $('#cv-log', root);
      if (log) {
        const msgs = await nore.chat.history(sel);
        const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 80;
        log.innerHTML = bubbles(msgs);
        if (atBottom || (data.msg && data.msg.mine)) log.scrollTop = log.scrollHeight;
        if (data.msg && !data.msg.mine) nore.chat.read(sel);
      }
    }
    if (what === 'typing' && data === sel) {
      const t = $('#cv-typing', root);
      const c = Chat.contact(sel);
      if (t && c) { t.textContent = `${c.name} pisze…`; clearTimeout(t._h); t._h = setTimeout(() => { t.textContent = ''; }, 3000); }
    }
    if (what === 'call') { const b = $('#cv-call', root); if (b) b.disabled = !!Chat.call; }
  });
  draw();
  if (!Chat.me) Chat.start().then(draw);
  return () => { alive = false; off(); Chat.viewing = null; };
};

/** Microphone / speaker / noise suppression. */
async function voiceSettingsModal() {
  let devices = [];
  try {
    // labels are only visible after the microphone was allowed once
    const s = await navigator.mediaDevices.getUserMedia({ audio: true });
    s.getTracks().forEach(t => t.stop());
    devices = await navigator.mediaDevices.enumerateDevices();
  } catch { /* no microphone */ }
  const v = vsettings();
  const opts = (kind, cur) => `<option value="">Domyślne</option>` + devices.filter(d => d.kind === kind).map(d => `<option value="${esc(d.deviceId)}" ${d.deviceId === cur ? 'selected' : ''}>${esc(d.label || d.kind)}</option>`).join('');
  const m = modal(`<h3>Ustawienia głosu</h3><p class="sub">Dotyczą rozmów ze znajomymi w launcherze.</p>
    <div class="field"><label>Mikrofon</label><select class="input" id="vs-mic">${opts('audioinput', v.mic)}</select></div>
    <div class="field"><label>Głośniki / słuchawki</label><select class="input" id="vs-spk">${opts('audiooutput', v.speaker)}</select></div>
    <div class="setting" style="padding:8px 0"><div class="col"><b>Redukcja szumów</b><span>Wycina klawiaturę i szum wentylatora</span></div><label class="switch"><input type="checkbox" id="vs-noise" ${v.noise !== false ? 'checked' : ''}><i></i></label></div>
    <div class="field"><label>Test mikrofonu</label><div class="vs-meter"><i id="vs-level"></i></div></div>
    <div class="foot"><button class="btn" data-close>Gotowe</button></div>`, { onClose: () => { if (test) test.getTracks().forEach(t => t.stop()); clearInterval(timer); if (ctx) ctx.close().catch(() => {}); } });
  let test = null, timer = null, ctx = null;
  const startTest = async () => {
    if (test) test.getTracks().forEach(t => t.stop());
    clearInterval(timer);
    try {
      test = await Chat.microphone();
      ctx = ctx || new AudioContext();
      const an = ctx.createAnalyser(); an.fftSize = 512;
      ctx.createMediaStreamSource(test).connect(an);
      const buf = new Uint8Array(512);
      timer = setInterval(() => { an.getByteTimeDomainData(buf); let s = 0; for (const x of buf) s += (x - 128) ** 2; const lv = Math.min(1, Math.sqrt(s / 512) / 40); const b = $('#vs-level', m.el); if (b) b.style.width = Math.round(lv * 100) + '%'; }, 80);
    } catch { /* no microphone */ }
  };
  $('#vs-mic', m.el).onchange = (e) => { saveVsettings({ mic: e.target.value }); startTest(); };
  $('#vs-spk', m.el).onchange = (e) => { saveVsettings({ speaker: e.target.value }); const a = document.getElementById('nore-call-audio'); if (a && a.setSinkId) a.setSinkId(e.target.value).catch(() => {}); };
  $('#vs-noise', m.el).onchange = (e) => { saveVsettings({ noise: e.target.checked }); startTest(); };
  startTest();
}

// presence for the in-game chat (Nore Client asks the launcher through the local bridge)
let presenceTimer = null;
Chat.on((what) => {
  if (what !== 'presence' && what !== 'contacts') return;
  clearTimeout(presenceTimer);
  presenceTimer = setTimeout(() => {
    const map = {};
    for (const c of Chat.contacts) {
      const l = Chat.links.get(c.hex);
      map[c.hex] = l && l.authed ? { online: true, status: l.status || 'launcher', detail: l.detail || '' } : { online: false, status: 'offline', detail: '' };
    }
    nore.chat.presence(map).catch(() => {});
  }, 300);
});
nore.on('chat:bridgeSend', ({ hex, text }) => { Chat.send(hex, text).then(() => Chat.reload()).catch(e => console.error('chat', e)); });
nore.on('chat:bridgeRead', () => Chat.reload());

// start with the launcher (after App has loaded its state)
(function bootChat() {
  if (typeof App === 'undefined' || !App.state) return setTimeout(bootChat, 300);
  Chat.start().catch(e => console.error('chat', e));
})();
