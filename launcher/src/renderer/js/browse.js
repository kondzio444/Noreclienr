'use strict';
/*
 * Content browser (mods, resource packs, shaders, datapacks, modpacks): Modrinth search with a
 * filter panel, grid / list views, installed badges, and a full project page with description,
 * gallery, versions (install any of them), changelog and dependencies.
 */

// ================================================================== safe Markdown / HTML for project descriptions

const MD_ALLOWED = new Set(['P', 'BR', 'HR', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'B', 'STRONG', 'I', 'EM', 'U', 'S', 'DEL', 'A', 'IMG', 'UL', 'OL', 'LI',
  'CODE', 'PRE', 'BLOCKQUOTE', 'TABLE', 'THEAD', 'TBODY', 'TR', 'TH', 'TD', 'CENTER', 'DIV', 'SPAN', 'DETAILS', 'SUMMARY', 'SUP', 'SUB', 'KBD', 'MARK', 'SMALL', 'BIG', 'FONT']);

function mdInline(s) {
  return s
    .replace(/!\[([^\]]*)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g, '<img alt="$1" src="$2">')
    .replace(/\[([^\]]+)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g, '<a href="$2">$1</a>')
    .replace(/`([^`]+)`/g, (m, c) => '<code>' + c.replace(/</g, '&lt;') + '</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/__([^_]+)__/g, '<b>$1</b>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<i>$2</i>').replace(/(^|\W)_([^_\n]+)_(?=\W|$)/g, '$1<i>$2</i>')
    .replace(/~~([^~]+)~~/g, '<s>$1</s>')
    .replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, '$1<a href="$2">$2</a>');
}

/** Minimal Markdown → HTML (Modrinth bodies mix Markdown with HTML). */
function mdToHtml(src) {
  const lines = String(src || '').replace(/\r/g, '').split('\n');
  const out = [];
  let list = null, para = [], code = null;
  const flushPara = () => { if (para.length) { out.push('<p>' + mdInline(para.join(' ')) + '</p>'); para = []; } };
  const closeList = () => { if (list) { out.push(`</${list}>`); list = null; } };
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    if (code !== null) {
      if (/^```/.test(line)) { out.push('<pre><code>' + code.join('\n').replace(/&/g, '&amp;').replace(/</g, '&lt;') + '</code></pre>'); code = null; } else code.push(raw);
      continue;
    }
    if (/^```/.test(line)) { flushPara(); closeList(); code = []; continue; }
    let m;
    if (!line.trim()) { flushPara(); closeList(); continue; }
    if ((m = /^(#{1,6})\s+(.*)$/.exec(line))) { flushPara(); closeList(); out.push(`<h${m[1].length}>${mdInline(m[2])}</h${m[1].length}>`); continue; }
    if (/^(\*\s*\*\s*\*|-{3,}|_{3,})\s*$/.test(line)) { flushPara(); closeList(); out.push('<hr>'); continue; }
    if ((m = /^\s*[-*+]\s+(.*)$/.exec(line)) || (m = /^\s*\d+[.)]\s+(.*)$/.exec(line))) {
      flushPara();
      const type = /^\s*\d/.test(line) ? 'ol' : 'ul';
      if (list !== type) { closeList(); out.push(`<${type}>`); list = type; }
      out.push('<li>' + mdInline(m[1]) + '</li>');
      continue;
    }
    if ((m = /^>\s?(.*)$/.exec(line))) { flushPara(); closeList(); out.push('<blockquote>' + mdInline(m[1]) + '</blockquote>'); continue; }
    if (/^\s*</.test(line)) { flushPara(); closeList(); out.push(mdInline(line)); continue; }
    closeList();
    para.push(line.trim());
  }
  flushPara(); closeList();
  return out.join('\n');
}

/** Parses HTML without running it and keeps only harmless elements / attributes. */
function sanitizeHtml(html) {
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
  const root = doc.body.firstElementChild;
  const walk = (node) => {
    for (const child of [...node.children]) {
      if (!MD_ALLOWED.has(child.tagName)) {
        if (['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'FORM', 'INPUT', 'BUTTON', 'LINK', 'META'].includes(child.tagName)) child.remove();
        else { walk(child); child.replaceWith(...child.childNodes); }
        continue;
      }
      for (const a of [...child.attributes]) {
        const n = a.name.toLowerCase();
        const keep = (child.tagName === 'A' && n === 'href' && /^https?:/i.test(a.value))
          || (child.tagName === 'IMG' && (n === 'src' && /^https:/i.test(a.value) || n === 'alt' || n === 'width' || n === 'height'))
          || (n === 'align') || (child.tagName === 'DETAILS' && n === 'open') || ((child.tagName === 'TD' || child.tagName === 'TH') && (n === 'colspan' || n === 'rowspan'));
        if (!keep) child.removeAttribute(a.name);
      }
      if (child.tagName === 'IMG') { child.setAttribute('loading', 'lazy'); child.setAttribute('data-fallback', ''); }
      if (child.tagName === 'A') child.setAttribute('data-ext', '');
      walk(child);
    }
  };
  walk(root);
  return root.innerHTML;
}

function richText(md) { return sanitizeHtml(mdToHtml(md)); }

function hookLinks(root) {
  root.addEventListener('click', (e) => {
    const a = e.target.closest('a[data-ext]');
    if (!a) return;
    e.preventDefault();
    nore.open(a.getAttribute('href'));
  });
}

// ================================================================== shared bits

const BROWSE = {
  mods: { kind: 'mod', title: 'Mody', sub: 'Mody z Modrinth dla wybranej instancji – zależności instalują się same.', icon: 'puzzle', folder: 'mods', search: 'Szukaj modów…' },
  modpacks: { kind: 'modpack', title: 'Modpacki', sub: 'Gotowe paczki modów. Każda instaluje się jako nowa instancja z właściwą wersją Minecraft i loaderem.', icon: 'box', search: 'Szukaj modpacków…' },
  resourcepacks: { kind: 'resourcepack', title: 'Paczki zasobów', sub: 'Tekstury, dźwięki i czcionki. Włączysz je w grze: Opcje → Paczki zasobów.', icon: 'image', folder: 'resourcepacks', search: 'Szukaj paczek zasobów…' },
  shaders: { kind: 'shader', title: 'Shadery', sub: 'Wymagają moda Iris albo OptiFine (Iris znajdziesz w Modach).', icon: 'sun', folder: 'shaderpacks', search: 'Szukaj shaderów…' },
  datapacks: { kind: 'datapack', title: 'Datapacki', sub: 'Instalowane bezpośrednio do wybranego świata.', icon: 'database', folder: 'saves', search: 'Szukaj datapacków…' },
};

const LOADER_NAMES = { fabric: 'Fabric', quilt: 'Quilt', forge: 'Forge', neoforge: 'NeoForge', vanilla: 'Vanilla', minecraft: 'Minecraft', iris: 'Iris', optifine: 'OptiFine', canvas: 'Canvas', datapack: 'Datapack' };
const SORTS = [['relevance', 'Trafność'], ['downloads', 'Pobrania'], ['follows', 'Obserwujący'], ['newest', 'Najnowsze'], ['updated', 'Zaktualizowane']];
const VTYPE = { release: ['Wydanie', 'ok'], beta: ['Beta', 'warn'], alpha: ['Alfa', 'bad'] };

const catLabel = (c) => {
  const map = { adventure: 'Przygoda', cursed: 'Dziwne', decoration: 'Dekoracje', economy: 'Ekonomia', equipment: 'Ekwipunek', food: 'Jedzenie',
    'game-mechanics': 'Mechaniki', library: 'Biblioteka', magic: 'Magia', management: 'Zarządzanie', minigame: 'Minigry', mobs: 'Moby',
    optimization: 'Optymalizacja', social: 'Społeczność', storage: 'Przechowywanie', technology: 'Technologia', transportation: 'Transport',
    utility: 'Narzędzia', worldgen: 'Generowanie świata', 'kitchen-sink': 'Wszystko w jednym', lightweight: 'Lekkie', multiplayer: 'Multiplayer',
    quests: 'Questy', challenging: 'Wyzwanie', combat: 'Walka', 'vanilla-like': 'Jak vanilla', realistic: 'Realistyczne', simplistic: 'Proste',
    themed: 'Tematyczne', tweaks: 'Poprawki', audio: 'Dźwięki', blocks: 'Bloki', entities: 'Byty', environment: 'Otoczenie', fonts: 'Czcionki',
    gui: 'Interfejs', items: 'Przedmioty', locale: 'Języki', models: 'Modele', 'core-shaders': 'Core shadery', cartoon: 'Kreskówkowe', fantasy: 'Fantasy',
    'semi-realistic': 'Półrealistyczne', atmosphere: 'Atmosfera', bloom: 'Bloom', 'colored-lighting': 'Kolorowe światło', foliage: 'Roślinność',
    'path-tracing': 'Path tracing', pbr: 'PBR', reflections: 'Odbicia', shadows: 'Cienie', potato: 'Słaby PC', low: 'Niskie wymagania',
    medium: 'Średnie wymagania', high: 'Wysokie wymagania', screenshot: 'Do screenów', 'high-performance': 'Wydajne', '8x-': '8x i mniej',
    '16x': '16x', '32x': '32x', '48x': '48x', '64x': '64x', '128x': '128x', '256x': '256x', '512x+': '512x+' };
  return map[c] || c.replace(/-/g, ' ').replace(/^./, x => x.toUpperCase());
};

function projectIcon(url, title, size = 56) {
  return `<div class="picon" style="width:${size}px;height:${size}px">${url ? `<img src="${esc(url)}" data-fallback alt="">` : ''}${esc((title || '?').charAt(0))}</div>`;
}

// ================================================================== modpack install (progress modal)

function installModpackFlow({ projectId, versionId, title, icon: iconUrl, file }) {
  const m = modal(`<div class="mp-install">
      <div class="mp-head">${projectIcon(iconUrl, title || 'M', 64)}<div><h3>${esc(title || 'Import modpacka')}</h3><p class="sub" id="mp-sub">Przygotowywanie…</p></div></div>
      <div class="mp-steps"><div class="mp-step active" data-s="pack"><span class="dot"></span>Pliki paczki</div><div class="mp-step" data-s="game"><span class="dot"></span>Minecraft i loader</div><div class="mp-step" data-s="done"><span class="dot"></span>Gotowe</div></div>
      <div class="mp-bar"><i id="mp-bar"></i></div>
      <div class="muted mp-cur" id="mp-cur">&nbsp;</div>
      <div class="foot"><button class="btn ghost" data-close id="mp-close" disabled>Zamknij</button><button class="btn" id="mp-play" hidden>${icon('play')} Graj</button></div></div>`, { dismissable: false });
  const step = (s) => {
    const order = ['pack', 'game', 'done'];
    $$('.mp-step', m.el).forEach(x => {
      const i = order.indexOf(x.dataset.s), cur = order.indexOf(s);
      x.className = 'mp-step' + (i < cur ? ' done' : i === cur ? ' active' : '');
    });
  };
  const off = nore.on('modpack:progress', (p) => {
    if (!p) return;
    step(p.phase === 'game' ? 'game' : 'pack');
    $('#mp-sub', m.el).textContent = p.stage || '';
    const frac = p.total ? (p.totalBytes ? p.bytes / p.totalBytes : p.done / p.total) : null;
    $('#mp-bar', m.el).style.width = frac == null ? '' : Math.round(frac * 100) + '%';
    $('#mp-bar', m.el).classList.toggle('indet', frac == null);
    $('#mp-cur', m.el).textContent = p.current || (p.total ? `${p.done || 0} / ${p.total}` : '');
  });
  $('#mp-bar', m.el).classList.add('indet');
  const run = file === true ? nore.modpacks.import() : nore.modpacks.install({ projectId, versionId });
  run.then(async (r) => {
    off();
    if (!r) { m.close(); return; }
    await App.refresh();
    step('done');
    $('#mp-bar', m.el).classList.remove('indet');
    $('#mp-bar', m.el).style.width = '100%';
    $('#mp-sub', m.el).textContent = r.warning ? 'Paczka zainstalowana – gra pobierze się przy pierwszym uruchomieniu.' : 'Instancja jest gotowa do gry!';
    $('#mp-cur', m.el).textContent = `${r.instance.name} • Minecraft ${r.instance.mcVersion} • ${LOADER_NAMES[r.instance.loader] || r.instance.loader}`;
    $('#mp-close', m.el).disabled = false;
    const play = $('#mp-play', m.el);
    play.hidden = false;
    play.onclick = () => { m.close(); launchSelected(r.instance); };
    toast('Zainstalowano modpack', r.instance.name, 'success');
  }).catch((e) => {
    off();
    m.close();
    errorToast(e, 'Instalacja modpacka nie powiodła się');
  });
}

// ================================================================== project page

function projectPage(root, id, ctx) {
  const cfg = ctx.cfg;
  const inst = ctx.instance;
  let data = null, tab = 'desc', onlyCompat = !!inst, alive = true;
  root.innerHTML = `<div class="pd"><button class="btn ghost sm pd-back" id="pd-back">${icon('arrowLeft')} Wróć do wyników</button>
    <div class="pd-hero skeleton" style="height:210px"></div><div class="skeleton" style="height:320px;margin-top:16px"></div></div>`;
  $('#pd-back', root).onclick = () => ctx.back();
  nore.content.details(id).then((d) => { if (alive) { data = d; render(); } }).catch((e) => {
    if (!alive) return;
    root.innerHTML = `<div class="empty">${icon('globe')}<div>Nie udało się wczytać projektu.</div><div class="muted">${esc(e.message)}</div>
      <button class="btn ghost sm" style="margin-top:14px" id="pd-back2">${icon('arrowLeft')} Wróć</button></div>`;
    $('#pd-back2', root).onclick = () => ctx.back();
  });

  const compatible = (v) => !inst || cfg.kind === 'modpack' || (v.gameVersions.includes(inst.mcVersion)
    && (cfg.kind !== 'mod' || v.loaders.some(l => (inst.loader === 'quilt' ? ['quilt', 'fabric'] : [inst.loader]).includes(l))));

  function render() {
    const p = data.project;
    const banner = (p.gallery || []).find(g => g.featured) || (p.gallery || [])[0];
    const compatVersions = data.versions.filter(compatible);
    const best = compatVersions.find(v => v.type === 'release') || compatVersions[0];
    const installed = ctx.installedIds && ctx.installedIds.has(p.id);
    const links = [['source_url', 'Kod źródłowy', 'terminal'], ['issues_url', 'Zgłoś błąd', 'info'], ['wiki_url', 'Wiki', 'list'], ['discord_url', 'Discord', 'users']]
      .filter(([k]) => p[k]).map(([k, label, ic]) => `<button class="btn ghost sm" data-link="${esc(p[k])}">${icon(ic)} ${label}</button>`).join('');
    const loadersAll = [...new Set(data.versions.flatMap(v => v.loaders))];
    const mcAll = [...new Set(data.versions.flatMap(v => v.gameVersions))];
    root.innerHTML = `<div class="pd">
      <button class="btn ghost sm pd-back" id="pd-back">${icon('arrowLeft')} Wróć do wyników</button>
      <div class="pd-hero">
        <div class="pd-banner" ${banner ? `style="background-image:url('${esc(banner.url)}')"` : ''}></div>
        <div class="pd-hero-in">
          ${projectIcon(p.icon_url, p.title, 96)}
          <div class="pd-title">
            <h2>${esc(p.title)}</h2>
            <p>${esc(p.description)}</p>
            <div class="pd-chips">${(p.categories || []).map(c => `<span class="chip">${esc(catLabel(c))}</span>`).join('')}
              ${p.client_side === 'required' ? '<span class="chip on">Klient</span>' : ''}${p.server_side === 'required' ? '<span class="chip on">Serwer</span>' : ''}</div>
          </div>
          <div class="pd-cta">
            ${cfg.kind === 'modpack'
              ? `<button class="btn play" id="pd-install">${icon('download')} Zainstaluj modpack</button><span class="muted">Utworzy nową instancję</span>`
              : installed
                ? `<button class="btn success" id="pd-install">${icon('check')} Zainstalowano</button><span class="muted">Możesz zainstalować inną wersję poniżej</span>`
                : best
                  ? `<button class="btn play" id="pd-install">${icon('download')} Zainstaluj</button><span class="muted">${esc(best.number)} • ${esc(inst ? inst.name : '')}</span>`
                  : `<button class="btn" disabled>${icon('ban')} Brak zgodnej wersji</button><span class="muted">${inst ? `Dla ${esc(inst.mcVersion)} ${esc(LOADER_NAMES[inst.loader] || '')}` : ''}</span>`}
            <button class="btn ghost sm" id="pd-web">${icon('external')} Modrinth</button>
          </div>
        </div>
      </div>
      <div class="pd-stats">
        <div><b>${fmtNum(p.downloads)}</b><span>pobrań</span></div>
        <div><b>${fmtNum(p.followers)}</b><span>obserwujących</span></div>
        <div><b>${data.versions.length}</b><span>wersji</span></div>
        <div><b>${fmtAgo(new Date(p.updated).getTime())}</b><span>aktualizacja</span></div>
        <div><b>${esc((p.license && (p.license.id || p.license.name)) || '—')}</b><span>licencja</span></div>
      </div>
      <div class="pd-body">
        <div class="pd-main">
          <div id="pd-tabs"></div>
          <div class="card pd-panel" id="pd-content"></div>
        </div>
        <aside class="pd-side">
          <div class="card pd-box"><div class="section-title">${icon('layers')} Zgodność</div>
            <div class="kv"><span>Minecraft</span><b>${esc(mcRange(mcAll))}</b></div>
            <div class="kv"><span>Loadery</span><b>${esc(loadersAll.map(l => LOADER_NAMES[l] || l).join(', ') || '—')}</b></div>
            ${inst && cfg.kind !== 'modpack' ? `<div class="kv"><span>Twoja instancja</span><b class="${compatVersions.length ? 'ok' : 'bad'}">${compatVersions.length ? 'Zgodna' : 'Niezgodna'}</b></div>` : ''}
          </div>
          ${data.members.length ? `<div class="card pd-box"><div class="section-title">${icon('users')} Twórcy</div>${data.members.slice(0, 6).map(m => `<div class="member">${m.avatar ? `<img src="${esc(m.avatar)}" data-fallback alt="">` : ''}<div><b>${esc(m.name)}</b><span>${esc(m.role)}</span></div></div>`).join('')}</div>` : ''}
          ${links ? `<div class="card pd-box"><div class="section-title">${icon('link')} Linki</div><div class="pd-links">${links}</div></div>` : ''}
        </aside>
      </div></div>`;
    $('#pd-back', root).onclick = () => ctx.back();
    $('#pd-web', root).onclick = () => nore.open(`https://modrinth.com/${p.project_type}/${p.slug}`);
    $$('[data-link]', root).forEach(b => b.onclick = () => nore.open(b.dataset.link));
    const ib = $('#pd-install', root);
    if (ib) ib.onclick = () => {
      if (cfg.kind === 'modpack') installModpackFlow({ projectId: p.id, title: p.title, icon: p.icon_url });
      else if (!installed && best) ctx.install(p.id, best.id, p.title, ib);
    };
    const tabs = [{ value: 'desc', label: 'Opis' }, { value: 'gallery', label: `Galeria${p.gallery && p.gallery.length ? ' · ' + p.gallery.length : ''}` },
      { value: 'versions', label: `Wersje · ${data.versions.length}` }, { value: 'changelog', label: 'Zmiany' }];
    if (data.dependencies.length) tabs.push({ value: 'deps', label: `Zależności · ${data.dependencies.length}` });
    $('#pd-tabs', root).appendChild(segmented(tabs, tab, (v) => { tab = v; renderTab(); }));
    renderTab();
    hookLinks(root);
  }

  function mcRange(list) {
    const rel = list.filter(v => /^\d+\.\d+(\.\d+)?$/.test(v)).sort((a, b) => cmpVer(a, b));
    if (!rel.length) return list.slice(0, 3).join(', ') || '—';
    return rel.length === 1 ? rel[0] : `${rel[0]} – ${rel[rel.length - 1]}`;
  }

  function renderTab() {
    const box = $('#pd-content', root);
    const p = data.project;
    box.classList.remove('fade-in'); void box.offsetWidth; box.classList.add('fade-in');
    if (tab === 'desc') {
      box.innerHTML = `<div class="md">${richText(p.body || p.description)}</div>`;
    } else if (tab === 'gallery') {
      const g = p.gallery || [];
      box.innerHTML = g.length ? `<div class="gallery">${g.map((x, i) => `<figure data-i="${i}"><img src="${esc(x.url)}" loading="lazy" data-fallback alt=""><figcaption>${esc(x.title || '')}</figcaption></figure>`).join('')}</div>`
        : `<div class="empty small">${icon('image')}<div>Brak zdjęć w galerii.</div></div>`;
      $$('figure', box).forEach(f => f.onclick = () => lightbox(g, +f.dataset.i));
    } else if (tab === 'versions') {
      const list = data.versions.filter(v => !onlyCompat || compatible(v));
      box.innerHTML = `<div class="vt-head"><label class="row muted" style="gap:8px;font-size:12.5px">${inst && cfg.kind !== 'modpack' ? `Tylko zgodne z ${esc(inst.mcVersion)} <span class="switch"><input type="checkbox" id="vc" ${onlyCompat ? 'checked' : ''}><i></i></span>` : ''}</label>
        <span class="muted" style="margin-left:auto;font-size:12.5px">${list.length} z ${data.versions.length}</span></div>
        <div class="vtable">${list.slice(0, 80).map(v => `<div class="vrow" data-v="${esc(v.id)}">
          <span class="vtype ${VTYPE[v.type] ? VTYPE[v.type][1] : ''}">${VTYPE[v.type] ? VTYPE[v.type][0] : esc(v.type)}</span>
          <div class="vname"><b>${esc(v.name || v.number)}</b><span>${esc(v.number)} • ${esc(v.loaders.map(l => LOADER_NAMES[l] || l).join(', '))} • ${esc(mcRange(v.gameVersions))}</span></div>
          <span class="muted vdate">${new Date(v.date).toLocaleDateString('pl-PL')}</span>
          <span class="muted vdl">${icon('download')} ${fmtNum(v.downloads)}</span>
          <button class="btn ghost sm" data-cl title="Lista zmian">${icon('list')}</button>
          <button class="btn sm" data-iv ${cfg.kind !== 'modpack' && !compatible(v) ? 'disabled title="Niezgodna z instancją"' : ''}>${icon('download')}</button>
          <div class="vcl" hidden><div class="md">${richText(v.changelog || '_Brak opisu zmian._')}</div></div></div>`).join('')}</div>`;
      const vc = $('#vc', box);
      if (vc) vc.onchange = () => { onlyCompat = vc.checked; renderTab(); };
      $$('.vrow', box).forEach(row => {
        const v = data.versions.find(x => x.id === row.dataset.v);
        $('[data-cl]', row).onclick = () => { const c = $('.vcl', row); c.hidden = !c.hidden; row.classList.toggle('open', !c.hidden); };
        $('[data-iv]', row).onclick = (e) => {
          if (cfg.kind === 'modpack') installModpackFlow({ projectId: p.id, versionId: v.id, title: `${p.title} ${v.number}`, icon: p.icon_url });
          else ctx.install(p.id, v.id, `${p.title} ${v.number}`, e.currentTarget);
        };
      });
    } else if (tab === 'changelog') {
      const list = data.versions.slice(0, 15);
      box.innerHTML = list.length ? list.map(v => `<div class="cl-item"><div class="cl-head"><span class="vtype ${VTYPE[v.type] ? VTYPE[v.type][1] : ''}">${VTYPE[v.type] ? VTYPE[v.type][0] : ''}</span><b>${esc(v.number)}</b><span class="muted">${new Date(v.date).toLocaleDateString('pl-PL')}</span></div><div class="md">${richText(v.changelog || '_Brak opisu zmian._')}</div></div>`).join('')
        : `<div class="empty small">${icon('list')}<div>Brak wersji.</div></div>`;
    } else if (tab === 'deps') {
      box.innerHTML = `<div class="dep-grid">${data.dependencies.map(d => `<div class="card hover dep" data-id="${esc(d.id)}">${projectIcon(d.icon, d.title, 40)}<div><b>${esc(d.title)}</b><span class="muted">${esc(d.type)}</span></div>${icon('arrowRight')}</div>`).join('')}</div>`;
      $$('.dep', box).forEach(c => c.onclick = () => ctx.open(c.dataset.id));
    }
  }

  return () => { alive = false; };
}

function cmpVer(a, b) {
  const pa = a.split('.').map(Number), pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  return 0;
}

function lightbox(items, start) {
  let i = start;
  const lb = el(`<div class="lightbox"><button class="lb-x">${icon('x')}</button><button class="lb-prev">${icon('arrowLeft')}</button>
    <figure><img alt=""><figcaption></figcaption></figure><button class="lb-next">${icon('arrowRight')}</button></div>`);
  const show = () => {
    const it = items[i];
    $('img', lb).src = it.raw_url || it.url;
    $('figcaption', lb).textContent = [it.title, it.description].filter(Boolean).join(' – ') + `  (${i + 1}/${items.length})`;
  };
  const close = () => { lb.classList.add('out'); document.removeEventListener('keydown', key); setTimeout(() => lb.remove(), 200); };
  const key = (e) => { if (e.key === 'Escape') close(); if (e.key === 'ArrowRight') { i = (i + 1) % items.length; show(); } if (e.key === 'ArrowLeft') { i = (i - 1 + items.length) % items.length; show(); } };
  $('.lb-x', lb).onclick = close;
  $('.lb-prev', lb).onclick = (e) => { e.stopPropagation(); i = (i - 1 + items.length) % items.length; show(); };
  $('.lb-next', lb).onclick = (e) => { e.stopPropagation(); i = (i + 1) % items.length; show(); };
  lb.addEventListener('mousedown', (e) => { if (e.target === lb) close(); });
  document.addEventListener('keydown', key);
  document.body.appendChild(lb);
  show();
}

// ================================================================== browser page

const browseMemory = {}; // per page: last query / filters / view, kept while the launcher runs

function browsePage(key) {
  return (root, opts) => {
    const cfg = BROWSE[key];
    const isPack = cfg.kind === 'modpack';
    const mem = browseMemory[key] || (browseMemory[key] = {
      tab: 'browse', query: '', sort: 'relevance', offset: 0, view: 'grid', cats: [], compat: true, env: '', mc: '', loaders: [], limit: 24,
    });
    let alive = true, timer = null, world = '', installedIds = new Set(), detailCleanup = null, lastRes = null;
    const installing = new Set();
    const inst = () => (isPack ? null : App.instance());

    root.innerHTML = `<div class="browse">
      <div class="page-head"><div><h2>${icon(cfg.icon)} ${cfg.title}</h2><p>${cfg.sub}</p></div>
        <div class="actions">${isPack ? `<button class="btn ghost" id="import">${icon('upload')} Importuj .mrpack</button>` : '<div class="instance-picker" id="pick" style="min-width:230px;padding:6px 12px"></div>'}</div></div>
      <div class="br-top card">
        <div id="tabs"></div>
        <div class="search" id="sbox">${icon('search')}<input id="q" placeholder="${cfg.search}" value="${esc(mem.query)}"><button class="clear" id="qx" title="Wyczyść">${icon('x')}</button></div>
        <select class="input" id="sort">${SORTS.map(([v, l]) => `<option value="${v}" ${v === mem.sort ? 'selected' : ''}>${l}</option>`).join('')}</select>
        <select class="input" id="world" style="display:none;min-width:170px"></select>
        <div class="seg-icons" id="vmode"><button data-v="grid" title="Kafelki">${icon('layers')}</button><button data-v="list" title="Lista">${icon('list')}</button></div>
        ${isPack ? '' : `<button class="btn ghost icon" id="folder" title="Otwórz folder">${icon('folder')}</button>`}
      </div>
      <div class="br-body">
        <aside class="br-filters card" id="filters"></aside>
        <div class="br-main"><div class="br-info" id="info"></div><div id="results"></div></div>
      </div></div>
      <div class="browse-detail" hidden></div>`;
    const browseEl = $('.browse', root), detailEl = $('.browse-detail', root);
    const results = () => $('#results', root);

    // ---------------------------------------------------------------- header controls
    const renderPick = () => {
      const p = $('#pick', root);
      if (!p) return;
      const i = inst();
      p.innerHTML = i ? `${instIcon(i, 34)}<div class="meta"><b style="font-size:13px">${esc(i.name)}</b><span>${esc(i.mcVersion)} • ${esc(LOADER_NAMES[i.loader] || i.loader)}</span></div>${icon('arrowRight')}`
        : '<div class="meta"><b>Brak instancji</b><span>Utwórz instancję</span></div>';
    };
    if ($('#pick', root)) $('#pick', root).onclick = () => instancePickerModal();
    if ($('#import', root)) $('#import', root).onclick = () => installModpackFlow({ file: true, title: 'Import modpacka' });
    const tabs = isPack ? [{ value: 'browse', label: 'Przeglądaj' }]
      : [{ value: 'browse', label: 'Przeglądaj' }, { value: 'installed', label: 'Zainstalowane' }];
    $('#tabs', root).appendChild(segmented(tabs, mem.tab, (v) => { mem.tab = v; mem.offset = 0; load(); }));
    $('#q', root).oninput = (e) => { clearTimeout(timer); timer = setTimeout(() => { mem.query = e.target.value; mem.offset = 0; load(); }, 280); };
    $('#qx', root).onclick = () => { $('#q', root).value = ''; mem.query = ''; mem.offset = 0; load(); };
    $('#sort', root).onchange = (e) => { mem.sort = e.target.value; mem.offset = 0; load(); };
    const setView = () => $$("#vmode button", root).forEach(b => b.classList.toggle('on', b.dataset.v === mem.view));
    $$("#vmode button", root).forEach(b => b.onclick = () => { mem.view = b.dataset.v; setView(); if (lastRes) renderResults(lastRes); });
    setView();
    if ($('#folder', root)) $('#folder', root).onclick = () => { const i = inst(); if (i) nore.instances.folder(i.id, cfg.kind === 'datapack' && world ? `saves/${world}/datapacks` : cfg.folder); };

    // ---------------------------------------------------------------- filters
    async function renderFilters() {
      const f = $('#filters', root);
      const i = inst();
      let cats = [];
      try { cats = await nore.content.categories(cfg.kind); } catch { /* offline */ }
      if (!alive) return;
      const groups = {};
      for (const c of cats) (groups[c.header] = groups[c.header] || []).push(c.name);
      const groupName = { categories: 'Kategorie', features: 'Funkcje', resolutions: 'Rozdzielczość', 'performance impact': 'Wymagania' };
      f.innerHTML = `
        ${isPack ? `<div class="fgroup"><div class="ftitle">Loader</div>${['fabric', 'quilt', 'forge', 'neoforge'].map(l => `<label class="fcheck"><input type="checkbox" data-loader="${l}" ${mem.loaders.includes(l) ? 'checked' : ''}><i></i>${LOADER_NAMES[l]}</label>`).join('')}</div>
          <div class="fgroup"><div class="ftitle">Wersja Minecraft</div><select class="input" id="fmc"><option value="">Wszystkie</option></select></div>`
          : `<div class="fgroup"><div class="ftitle">Zgodność</div><label class="fcheck"><input type="checkbox" id="fcompat" ${mem.compat ? 'checked' : ''}><i></i>Tylko dla ${i ? esc(i.mcVersion) + (cfg.kind === 'mod' ? ' ' + esc(LOADER_NAMES[i.loader] || '') : '') : 'instancji'}</label>
            ${cfg.kind === 'mod' ? `<label class="fcheck"><input type="checkbox" id="fenv" ${mem.env === 'client' ? 'checked' : ''}><i></i>Działa po stronie klienta</label>` : ''}</div>`}
        ${Object.entries(groups).map(([h, list]) => `<div class="fgroup"><div class="ftitle">${esc(groupName[h] || h)}</div>${list.map(c => `<label class="fcheck"><input type="checkbox" data-cat="${esc(c)}" ${mem.cats.includes(c) ? 'checked' : ''}><i></i>${esc(catLabel(c))}</label>`).join('')}</div>`).join('')}
        <button class="btn ghost sm" id="freset" style="width:100%">${icon('refresh')} Wyczyść filtry</button>`;
      $$('[data-cat]', f).forEach(c => c.onchange = () => { mem.cats = $$('[data-cat]:checked', f).map(x => x.dataset.cat); mem.offset = 0; load(); });
      $$('[data-loader]', f).forEach(c => c.onchange = () => { mem.loaders = $$('[data-loader]:checked', f).map(x => x.dataset.loader); mem.offset = 0; load(); });
      if ($('#fcompat', f)) $('#fcompat', f).onchange = (e) => { mem.compat = e.target.checked; mem.offset = 0; load(); };
      if ($('#fenv', f)) $('#fenv', f).onchange = (e) => { mem.env = e.target.checked ? 'client' : ''; mem.offset = 0; load(); };
      $('#freset', f).onclick = () => { mem.cats = []; mem.loaders = []; mem.env = ''; mem.mc = ''; mem.compat = true; mem.offset = 0; renderFilters(); load(); };
      if ($('#fmc', f)) {
        nore.versions.list({}).then(v => {
          const sel = $('#fmc', f);
          if (!sel) return;
          sel.innerHTML = '<option value="">Wszystkie</option>' + v.versions.slice(0, 80).map(x => `<option ${x.id === mem.mc ? 'selected' : ''}>${esc(x.id)}</option>`).join('');
        }).catch(() => {});
        $('#fmc', f).onchange = (e) => { mem.mc = e.target.value; mem.offset = 0; load(); };
      }
    }

    async function loadWorlds() {
      if (cfg.kind !== 'datapack') return;
      const i = inst();
      const worlds = i ? await nore.instances.worlds(i.id) : [];
      if (!worlds.includes(world)) world = worlds[0] || '';
      const sel = $('#world', root);
      sel.style.display = '';
      sel.innerHTML = worlds.length ? worlds.map(w => `<option ${w === world ? 'selected' : ''}>${esc(w)}</option>`).join('') : '<option value="">Brak światów — zagraj najpierw</option>';
      sel.onchange = () => { world = sel.value; refreshInstalled().then(load); };
    }

    async function refreshInstalled() {
      const i = inst();
      if (!i) { installedIds = new Set(); return {}; }
      try {
        const map = await nore.content.identify({ instanceId: i.id, kind: cfg.kind, world });
        installedIds = new Set(Object.values(map).map(x => x.projectId));
        return map;
      } catch { return {}; }
    }

    // ---------------------------------------------------------------- browse
    async function load() {
      if (!alive) return;
      const i = inst();
      const browsing = mem.tab === 'browse';
      $('#sbox', root).style.display = $('#sort', root).style.display = $("#vmode", root).style.display = browsing ? '' : 'none';
      $('#filters', root).style.display = browsing ? '' : 'none';
      browseEl.classList.toggle('no-filters', !browsing);
      if (!isPack && !i) { $('#info', root).textContent = ''; results().innerHTML = `<div class="empty">${icon('layers')}<div>Najpierw utwórz instancję.</div></div>`; return; }
      if (!browsing) return loadInstalled(i);
      $('#info', root).innerHTML = '<span class="spinner"></span> Szukanie…';
      results().innerHTML = `<div class="${mem.view === 'grid' ? 'pgrid' : 'plist'}">` + '<div class="skeleton pcard-sk"></div>'.repeat(8) + '</div>';
      try {
        const res = await nore.content.search({
          query: mem.query, kind: cfg.kind, sort: mem.sort, offset: mem.offset, limit: mem.limit, categories: mem.cats,
          gameVersion: isPack ? (mem.mc || null) : (mem.compat ? i.mcVersion : null),
          loader: !isPack && mem.compat && i.loader !== 'vanilla' ? i.loader : null,
          loaders: isPack ? mem.loaders : null, environment: mem.env || null,
        });
        if (!alive) return;
        lastRes = res;
        renderResults(res);
      } catch (e) {
        $('#info', root).textContent = '';
        results().innerHTML = `<div class="empty">${icon('globe')}<div>Nie udało się połączyć z Modrinth.</div><div class="muted" style="margin-top:6px">${esc(e.message)}</div></div>`;
      }
    }

    function cardHtml(h) {
      const inst2 = installedIds.has(h.project_id);
      const cats = (h.display_categories || h.categories || []).filter(c => !LOADER_NAMES[c]).slice(0, 3);
      const loadersOf = (h.categories || []).filter(c => ['fabric', 'quilt', 'forge', 'neoforge'].includes(c));
      return `<div class="pcard ${inst2 ? 'is-installed' : ''}" data-id="${h.project_id}">
        ${mem.view === 'grid' ? `<div class="pc-banner" ${h.featured_gallery || h.gallery && h.gallery[0] ? `style="background-image:url('${esc(h.featured_gallery || h.gallery[0])}')"` : ''}></div>` : ''}
        <div class="pc-top">${projectIcon(h.icon_url, h.title, mem.view === 'grid' ? 54 : 48)}
          <div class="pc-title"><h4>${esc(h.title)}</h4><small>${esc(h.author)}</small></div></div>
        <p class="pc-desc">${esc(h.description)}</p>
        <div class="pc-tags">${cats.map(c => `<span class="chip">${esc(catLabel(c))}</span>`).join('')}${isPack ? loadersOf.map(l => `<span class="chip on">${LOADER_NAMES[l]}</span>`).join('') : ''}</div>
        <div class="pc-foot"><span>${icon('download')} ${fmtNum(h.downloads)}</span><span>${icon('heart')} ${fmtNum(h.follows)}</span><span>${icon('clock')} ${fmtAgo(new Date(h.date_modified).getTime())}</span>
          <div class="pc-actions">
            <button class="btn ghost sm" data-more title="Szczegóły">${icon('info')}</button>
            ${inst2 ? `<button class="btn success sm" data-open>${icon('check')} Zainstalowano</button>`
              : `<button class="btn sm" data-install>${icon('download')} ${isPack ? 'Instaluj' : 'Pobierz'}</button>`}
          </div></div></div>`;
    }

    function renderResults(res) {
      const pages = Math.max(1, Math.ceil(res.total_hits / mem.limit)), page = Math.floor(mem.offset / mem.limit) + 1;
      $('#info', root).innerHTML = `<b>${fmtNum(res.total_hits)}</b> wyników${mem.query ? ` dla „${esc(mem.query)}”` : ''}${mem.cats.length ? ` • ${mem.cats.map(catLabel).map(esc).join(', ')}` : ''}`;
      if (!res.hits.length) {
        results().innerHTML = `<div class="empty">${icon('search')}<div>Nic nie znaleziono.</div><div class="muted" style="margin-top:6px">Zmień wyszukiwanie albo wyczyść filtry.</div></div>`;
        return;
      }
      const box = el(`<div class="${mem.view === 'grid' ? 'pgrid' : 'plist'}"></div>`);
      box.innerHTML = res.hits.map(cardHtml).join('');
      stagger(box);
      results().innerHTML = '';
      results().appendChild(box);
      if (pages > 1) {
        const nums = [];
        for (let n = Math.max(1, page - 2); n <= Math.min(pages, page + 2); n++) nums.push(n);
        const pager = el(`<div class="pager"><button class="btn ghost sm" data-p="${page - 1}" ${page <= 1 ? 'disabled' : ''}>${icon('arrowLeft')}</button>
          ${nums[0] > 1 ? '<button class="btn ghost sm" data-p="1">1</button><span class="muted">…</span>' : ''}
          ${nums.map(n => `<button class="btn ${n === page ? '' : 'ghost'} sm" data-p="${n}">${n}</button>`).join('')}
          ${nums[nums.length - 1] < pages ? `<span class="muted">…</span><button class="btn ghost sm" data-p="${pages}">${pages}</button>` : ''}
          <button class="btn ghost sm" data-p="${page + 1}" ${page >= pages ? 'disabled' : ''}>${icon('arrowRight')}</button></div>`);
        results().appendChild(pager);
        $$('[data-p]', pager).forEach(b => b.onclick = () => { mem.offset = (+b.dataset.p - 1) * mem.limit; load(); $('#view').scrollTo({ top: 0, behavior: 'smooth' }); });
      }
      $$('.pcard', box).forEach(card => {
        const id = card.dataset.id;
        const hit = res.hits.find(h => h.project_id === id);
        card.onclick = (e) => { if (!e.target.closest('[data-install]')) openDetail(id); };
        const btn = $('[data-install]', card);
        if (!btn) return;
        if (installing.has(id)) { btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>'; }
        btn.onclick = (e) => {
          e.stopPropagation();
          if (isPack) installModpackFlow({ projectId: id, title: hit.title, icon: hit.icon_url });
          else install(id, null, hit.title, btn);
        };
      });
    }

    async function install(projectId, versionId, title, btn) {
      const i = inst();
      if (!i) return toast('Brak instancji', 'Wybierz instancję.', 'error');
      if (cfg.kind === 'datapack' && !world) return toast('Brak świata', 'Wybierz świat albo najpierw stwórz go w grze.', 'error');
      installing.add(projectId);
      const prev = btn ? btn.innerHTML : '';
      if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Pobieranie'; }
      try {
        const files = await nore.content.install({ instanceId: i.id, projectId, kind: cfg.kind, world, versionId });
        installedIds.add(projectId);
        if (btn) { btn.classList.add('success'); btn.innerHTML = `${icon('check')} Zainstalowano`; }
        const card = btn && btn.closest('.pcard');
        if (card) card.classList.add('is-installed', 'pop');
        toast(title, files.length > 1 ? `Zainstalowano z ${files.length - 1} zależnościami` : 'Zainstalowano', 'success');
      } catch (e) {
        if (btn) { btn.disabled = false; btn.innerHTML = prev; }
        errorToast(e, title);
      } finally {
        installing.delete(projectId);
      }
    }

    // ---------------------------------------------------------------- installed
    async function loadInstalled(i) {
      $('#info', root).innerHTML = '<span class="spinner"></span> Wczytywanie…';
      const [list, meta] = await Promise.all([nore.content.installed({ instanceId: i.id, kind: cfg.kind, world }), refreshInstalled()]);
      if (!alive || mem.tab !== 'installed') return;
      const on = list.filter(f => f.enabled).length;
      $('#info', root).innerHTML = `<b>${list.length}</b> plików • ${on} włączonych
        <div class="inst-tools"><input class="input" id="ifilter" placeholder="Filtruj…" style="height:32px;width:180px">
        <button class="btn ghost sm" id="upd">${icon('refresh')} Sprawdź aktualizacje</button></div>`;
      if (!list.length) {
        results().innerHTML = `<div class="empty">${icon(cfg.icon)}<div>${cfg.kind === 'datapack' && !world ? 'Wybierz świat.' : 'Nic tu jeszcze nie ma.'}</div>
          <button class="btn sm" style="margin-top:14px" id="gob">${icon('search')} Przeglądaj Modrinth</button></div>`;
        $('#gob', root).onclick = () => { mem.tab = 'browse'; go(key); };
        return;
      }
      const box = el('<div class="ilist"></div>');
      box.innerHTML = list.map(f => {
        const m = meta[f.file] || null;
        return `<div class="irow ${f.enabled ? '' : 'off'}" data-file="${esc(f.file)}" data-name="${esc(((m && m.title) || f.name).toLowerCase())}">
          ${m ? projectIcon(m.icon, m.title, 42) : `<div class="picon" style="width:42px;height:42px">${icon(cfg.icon)}</div>`}
          <div class="iname"><b>${esc(m ? m.title : f.name)}</b><span>${m ? esc(m.version) + ' • ' : ''}${esc(f.name)} • ${f.dir ? 'folder' : fmtBytes(f.size)}</span></div>
          <span class="iupd" hidden></span>
          ${m ? `<button class="btn ghost sm icon" data-info title="Szczegóły">${icon('info')}</button>` : ''}
          <label class="switch" title="Włącz / wyłącz"><input type="checkbox" ${f.enabled ? 'checked' : ''} data-toggle><i></i></label>
          <button class="btn danger sm icon" data-del title="Usuń">${icon('trash')}</button></div>`;
      }).join('');
      stagger(box);
      results().innerHTML = '';
      results().appendChild(box);
      $('#ifilter', root).oninput = (e) => {
        const q = e.target.value.toLowerCase();
        $$('.irow', box).forEach(r => { r.style.display = r.dataset.name.includes(q) || r.dataset.file.toLowerCase().includes(q) ? '' : 'none'; });
      };
      $('#upd', root).onclick = async (e) => {
        const b = e.currentTarget;
        b.disabled = true; b.innerHTML = '<span class="spinner"></span> Sprawdzanie';
        const ups = await nore.content.updates({ instanceId: i.id, kind: cfg.kind, world }).catch(err => { errorToast(err); return null; });
        b.disabled = false;
        if (!ups) { b.innerHTML = `${icon('refresh')} Sprawdź aktualizacje`; return; }
        if (!ups.length) { b.innerHTML = `${icon('check')} Wszystko aktualne`; return; }
        for (const u of ups) {
          const r = box.querySelector(`.irow[data-file="${CSS.escape(u.oldFile)}"] .iupd`);
          if (r) { r.hidden = false; r.textContent = '→ ' + u.version; }
        }
        b.innerHTML = `${icon('download')} Aktualizuj (${ups.length})`;
        b.onclick = async () => {
          b.disabled = true; b.innerHTML = '<span class="spinner"></span> Aktualizowanie';
          try {
            await nore.content.applyUpdates({ instanceId: i.id, kind: cfg.kind, world, updates: ups });
            toast('Zaktualizowano', `${ups.length} plików`, 'success');
          } catch (err) { errorToast(err); }
          load();
        };
      };
      $$('.irow', box).forEach(row => {
        const file = row.dataset.file;
        const m = meta[file];
        if (m && $('[data-info]', row)) $('[data-info]', row).onclick = () => openDetail(m.projectId);
        $('[data-toggle]', row).onchange = async () => { await nore.content.toggle({ instanceId: i.id, kind: cfg.kind, world, file }); load(); };
        $('[data-del]', row).onclick = async () => {
          if (!(await confirmModal('Usunąć plik?', file, { ok: 'Usuń', danger: true }))) return;
          await nore.content.remove({ instanceId: i.id, kind: cfg.kind, world, file });
          row.style.transition = 'all .3s'; row.style.opacity = 0; row.style.transform = 'translateX(30px)';
          setTimeout(load, 300);
        };
      });
    }

    // ---------------------------------------------------------------- details view
    function openDetail(id) {
      if (detailCleanup) detailCleanup();
      browseEl.hidden = true;
      detailEl.hidden = false;
      detailEl.classList.remove('slide-in'); void detailEl.offsetWidth; detailEl.classList.add('slide-in');
      $('#view').scrollTo({ top: 0 });
      detailCleanup = projectPage(detailEl, id, {
        cfg, instance: inst(), installedIds,
        back: closeDetail,
        open: openDetail,
        install: (pid, vid, title, btn) => install(pid, vid, title, btn),
      });
    }
    function closeDetail() {
      if (detailCleanup) { detailCleanup(); detailCleanup = null; }
      detailEl.hidden = true;
      detailEl.innerHTML = '';
      browseEl.hidden = false;
      if (lastRes && mem.tab === 'browse') renderResults(lastRes); else load();
    }

    // ---------------------------------------------------------------- start
    let lastInst = inst() && inst().id;
    renderPick();
    renderFilters();
    loadWorlds().then(refreshInstalled).then(() => {
      if (opts && opts.project) openDetail(opts.project);
      load();
    });
    const off = App.onChange(() => {
      renderPick();
      const now = inst() && inst().id;
      if (now !== lastInst) { lastInst = now; mem.offset = 0; renderFilters(); loadWorlds().then(refreshInstalled).then(load); }
    });
    return () => { alive = false; off(); if (detailCleanup) detailCleanup(); };
  };
}

Pages.mods = browsePage('mods');
Pages.modpacks = browsePage('modpacks');
Pages.resourcepacks = browsePage('resourcepacks');
Pages.shaders = browsePage('shaders');
Pages.datapacks = browsePage('datapacks');
