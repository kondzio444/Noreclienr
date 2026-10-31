'use strict';
/* Nore MC – the official partner server: a featured card with live status (Start and Serwery) and one-click play. */

const Official = {
  info: null,

  async load() {
    if (!this.info) this.info = await nore.official.info();
    return this.info;
  },

  /** Launches the selected Nore Client instance (or the last played one) straight into Nore MC. */
  async play() {
    const info = await this.load();
    const inst = await nore.official.pick();
    if (!inst) {
      toast('Brak instancji Nore Client', `Utwórz instancję z Nore Client, aby zagrać na ${info.name}.`, 'error', 5000);
      return go('instances');
    }
    if (App.instance() && App.instance().id !== inst.id) toast(info.name, `Gra uruchomi się na instancji ${inst.name}.`, 'info', 3500);
    await launchSelected(inst, { joinServer: info.address });
  },

  /** Renders the featured card into box and keeps its status fresh while it is shown. */
  async card(box) {
    const info = await this.load().catch(() => null);
    if (!info || !box.isConnected) return;
    // Album: Nore MC is a violet sticker (accent-deep, vinyl rim) with an "oficjalny serwer" label and a white Dołącz pill
    box.classList.add('off-card');
    box.innerHTML = `
      <span class="off-pin">oficjalny serwer</span>
      <div class="srv2-line">
        <div class="srv2-ico off-ico">${icon('server')}</div>
        <div class="srv2-text" style="flex:1;min-width:0">
          <h3>${esc(info.name)}</h3>
          <div class="off-line2"><i class="dot sm off" data-f="dot"></i><span data-f="state">Sprawdzanie…</span><span data-f="stats"></span></div>
          <div class="off-sub">${esc(info.tagline)}</div>
          <div class="motd off-motd" data-f="motd"></div>
        </div>
        <button class="btn white sm" data-f="play" title="Graj na ${esc(info.name)}">Dołącz</button>
      </div>
      <div class="srv2-actions off-actions">
        <button class="off-addr" data-f="copy" title="Kopiuj adres">${esc(info.address)}</button>
        <button class="btn ghost sm icon" data-f="refresh" title="Odśwież status" aria-label="Odśwież status">${icon('refresh')}</button>
      </div>`;
    const f = (k) => box.querySelector(`[data-f="${k}"]`);
    f('play').onclick = () => this.play();
    f('copy').onclick = () => navigator.clipboard.writeText(info.address).then(() => toast('Skopiowano adres', info.address, 'success', 1800));
    const fill = (s) => {
      if (!box.isConnected) return;
      const dot = f('dot');
      dot.className = `dot sm ${s.online ? 'ready' : s.state === 'unknown' ? 'off' : 'error'}`;
      f('state').textContent = s.online ? '' : s.state === 'unknown' ? 'Status nieznany' : 'Offline';
      const parts = [];
      if (s.online && s.players >= 0) parts.push(`${s.players}${s.max >= 0 ? `/${s.max}` : ''}`);
      if (s.online && s.version) parts.push(esc(String(s.version).replace(/^[A-Za-z]+\s+/, '')));
      if (s.online && s.ping >= 0) parts.push(`${s.ping} ms`);
      f('stats').innerHTML = parts.join(' · ') || (s.online ? 'Online' : '');
      f('motd').innerHTML = s.motd ? Motd.html(s.motd) : '';
      const ico = box.querySelector('.off-ico');
      if (s.favicon && !ico.querySelector('img')) ico.innerHTML = `<img src="${s.favicon}" alt="">`;
    };
    const refresh = (force) => nore.official.status(force).then(fill).catch(() => fill({ online: false, state: 'unknown' }));
    f('refresh').onclick = () => { f('state').textContent = 'Sprawdzanie…'; f('stats').textContent = ''; refresh(true); };
    refresh(false);
    const timer = setInterval(() => (box.isConnected ? refresh(false) : clearInterval(timer)), 60_000);
  },
};
