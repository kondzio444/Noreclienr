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
    box.classList.add('card', 'off-card');
    box.innerHTML = `
      <div class="srv2-line">
        <div class="srv2-ico off-ico" style="--ec:var(--accent);width:56px;height:56px">${icon('server')}</div>
        <div class="srv2-text" style="flex:1;min-width:0">
          <div class="row" style="gap:8px;align-items:center"><h3>${esc(info.name)}</h3><span class="tag accent">PARTNER</span></div>
          <div class="muted off-sub">${esc(info.tagline)} • <span class="mono">${esc(info.address)}</span></div>
          <div class="motd off-motd" data-f="motd"></div>
        </div>
        <div class="srv2-right off-right">
          <div class="srv2-state" data-f="state"><i></i><span>Sprawdzanie…</span></div>
          <div class="off-stats muted" data-f="stats"></div>
        </div>
      </div>
      <div class="srv2-actions" style="margin-top:12px">
        <button class="btn play" data-f="play">${icon('play')} Graj na ${esc(info.name)}</button>
        <button class="btn ghost sm icon" data-f="refresh" title="Odśwież status">${icon('refresh')}</button>
        <button class="btn ghost sm icon" data-f="copy" title="Kopiuj adres">${icon('copy')}</button>
      </div>`;
    const f = (k) => box.querySelector(`[data-f="${k}"]`);
    f('play').onclick = () => this.play();
    f('copy').onclick = () => navigator.clipboard.writeText(info.address).then(() => toast('Skopiowano adres', info.address, 'success', 1800));
    const fill = (s) => {
      if (!box.isConnected) return;
      const st = f('state');
      st.className = `srv2-state ${s.online ? 'running' : ''}`;
      st.querySelector('span').textContent = s.online ? 'Online' : s.state === 'unknown' ? 'Status nieznany' : 'Offline';
      const parts = [];
      if (s.online && s.players >= 0) parts.push(`${s.players}${s.max >= 0 ? ` / ${s.max}` : ''} graczy`);
      if (s.online && s.version) parts.push(esc(s.version));
      if (s.online && s.ping >= 0) parts.push(`${s.ping} ms`);
      f('stats').innerHTML = parts.join(' • ') || (s.online ? '' : 'Serwer chwilowo niedostępny');
      f('motd').innerHTML = s.motd ? Motd.html(s.motd) : '';
      const ico = box.querySelector('.off-ico');
      if (s.favicon && !ico.querySelector('img')) ico.innerHTML = `<img src="${s.favicon}" alt="">`;
    };
    const refresh = (force) => nore.official.status(force).then(fill).catch(() => fill({ online: false, state: 'unknown' }));
    f('refresh').onclick = () => { f('state').querySelector('span').textContent = 'Sprawdzanie…'; refresh(true); };
    refresh(false);
    const timer = setInterval(() => (box.isConnected ? refresh(false) : clearInterval(timer)), 60_000);
  },
};
