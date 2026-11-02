// Shared launcher rail for the mocks: <aside class="rail cloth" data-active="start" data-event="halloween|winter|"></aside>
(function () {
  const A = '../../web/public/assets/';
  const rail = document.querySelector('.rail');
  if (!rail) return;
  const act = rail.dataset.active;
  const ev = document.documentElement.dataset.event || '';
  const ico = id => `<svg class="ic"><use href="#i-${id}"/></svg>`;
  const tab = (id, icon, name, end = '', cls = '') => `<a class="tab ${act === id ? 'on' : ''} ${cls}">${icon}<span>${name}</span>${end ? `<span class="end">${end}</span>` : ''}</a>`;
  const eventTab = ev === 'winter'
    ? tab('event', '<img src="assets/flake.png" alt="">', 'Zima', '<i class="dot sm event"></i>', 'event')
    : tab('event', '<img src="assets/pumpkin.png" alt="">', 'Halloween', '<span class="n">6 dni</span><i class="dot sm event"></i>', 'event');
  rail.innerHTML = `
    <div class="brand"><span class="logo-sticker"><img src="${A}logo.png" alt=""></span><div><b>Nore</b><small>Launcher 1.4</small></div></div>
    <nav class="nav">
      <h6>Gra</h6>
      ${tab('start', ico('home'), 'Start')}
      ${tab('instances', ico('layers'), 'Instancje', '<span class="n">4</span>')}
      ${tab('servers', ico('server'), 'Serwery', '<i class="dot sm ready"></i>')}
      ${eventTab}
      <h6>Zawartość</h6>
      ${tab('modpacks', ico('package'), 'Modpacki')}
      ${tab('mods', ico('puzzle'), 'Mody')}
      ${tab('packs', ico('image'), 'Paczki zasobów')}
      ${tab('shaders', ico('sun'), 'Shadery')}
      ${tab('datapacks', ico('database'), 'Datapacki')}
      <h6>Społeczność</h6>
      ${tab('friends', ico('users'), 'Znajomi', '<span class="n">3</span><i class="dot sm ready"></i>')}
      ${tab('gallery', ico('camera'), 'Galeria')}
      ${tab('shop', ico('bag'), 'Sklep', '<span class="n">wkrótce</span>', 'muted')}
      <h6>Launcher</h6>
      ${tab('accounts', ico('user'), 'Konta')}
      ${tab('settings', ico('cog'), 'Ustawienia')}
      ${tab('console', ico('terminal'), 'Konsola')}
    </nav>
    <div class="me"><img class="me-head" src="assets/head-kondzio.png" alt=""><div><b>kondzio</b><small><i class="dot sm off"></i>bez premium</small></div></div>`;
})();
