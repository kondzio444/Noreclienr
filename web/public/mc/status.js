'use strict';
/* Placeholder for the Minecraft server site: shows whether the server is online (API v2 ping). */
(async () => {
  const el = document.getElementById('st');
  try {
    const r = await fetch('/api/v2/servers/mc.noreclient.pl?favicon=false');
    const j = await r.json();
    if (!j.ok) { el.textContent = j.error; return; }
    const s = j.server;
    el.textContent = s.online ? `Online: ${s.players.online}/${s.players.max} graczy · ${s.version.name}` : 'Serwer jest teraz offline.';
  } catch { el.textContent = ''; }
})();
