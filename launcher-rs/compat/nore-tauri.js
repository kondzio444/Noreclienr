/*
 * window.nore for the Rust launcher (Tauri). The renderer (launcher/src/renderer) is shared with
 * the Electron launcher and talks only to window.nore; Electron builds it in launcher/src/preload.js,
 * here the same shape is built on top of Tauri's invoke / events. Every call goes to the single
 * `nore_ipc` command with the Electron channel name and its arguments, so nore-core answers exactly
 * like main.js does. Tauri injects this script before the page's own scripts; in Electron it never
 * runs (window.nore exists there already).
 */
(function () {
  'use strict';
  if (window.nore) return;

  const internals = () => window.__TAURI_INTERNALS__;
  const call = (channel, args) => {
    const t = internals();
    if (!t) return Promise.reject(new Error('Brak połączenia z launcherem'));
    return t.invoke('nore_ipc', { channel, args }).catch((e) => {
      throw new Error(typeof e === 'string' ? e : (e && e.message) || String(e));
    });
  };
  // undefined arguments become null on the way (JSON), trailing ones are dropped like in IPC
  const invoke = (ch) => (...args) => {
    while (args.length && args[args.length - 1] === undefined) args.pop();
    return call(ch, args.map((a) => (a === undefined ? null : a)));
  };
  const send = (ch) => () => { call(ch, []).catch(() => {}); };

  const EVENTS = ['progress', 'log', 'game:state', 'content:status', 'window:state', 'server:log', 'server:state', 'server:progress', 'server:tunnel', 'chat:bridgeSend', 'chat:bridgeRead', 'chat:bridgeAdd', 'update:state', 'modpack:progress', 'doctor:report', 'content:updatesState', 'auth:logout', 'notices:state', 'server:tps', 'mods:status'];

  /** nore.on(channel, fn) → function that stops listening (synchronously, like ipcRenderer). */
  const on = (channel, fn) => {
    if (!EVENTS.includes(channel)) return () => {};
    let off = null;
    let dead = false;
    const api = window.__TAURI__ && window.__TAURI__.event;
    if (!api) return () => {};
    api.listen(channel, (e) => { if (!dead) fn(e.payload); }).then((u) => { if (dead) u(); else off = u; }).catch(() => {});
    return () => { dead = true; if (off) off(); };
  };

  /*
   * Drag & drop of files: a webview does not give dropped files a path (Electron has
   * webUtils.getPathForFile). Tauri reports native drops with their paths (tauri://drag-*); they are
   * replayed as DOM drag events on the element under the cursor with File objects whose paths
   * pathForFile() knows. Real DOM file drags are stopped so a drop never arrives twice.
   */
  const droppedPaths = new WeakMap();
  const dragDrop = () => {
    const api = window.__TAURI__ && window.__TAURI__.event;
    if (!api) return;
    let target = null;
    let last = [];
    const at = (p) => {
      const r = window.devicePixelRatio || 1;
      return p ? document.elementFromPoint(p.x / r, p.y / r) : null;
    };
    const transfer = (paths) => {
      const dt = new DataTransfer();
      for (const p of paths || []) {
        const f = new File([], String(p).split(/[\\/]/).pop() || 'plik');
        droppedPaths.set(f, p);
        try { dt.items.add(f); } catch { /* not a file */ }
      }
      return dt;
    };
    const fire = (el, type, paths) => {
      if (!el) return;
      const e = new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: transfer(paths) });
      Object.defineProperty(e, '__nore', { value: true });
      el.dispatchEvent(e);
    };
    for (const type of ['dragenter', 'dragover', 'dragleave', 'drop']) {
      window.addEventListener(type, (e) => {
        if (!e.__nore && e.isTrusted && e.dataTransfer && [...(e.dataTransfer.types || [])].includes('Files')) { e.preventDefault(); e.stopImmediatePropagation(); }
      }, true);
    }
    api.listen('tauri://drag-enter', (m) => { last = m.payload.paths || []; target = at(m.payload.position); fire(target, 'dragenter', last); }).catch(() => {});
    api.listen('tauri://drag-over', (m) => {
      const el = at(m.payload.position);
      if (el !== target) { fire(target, 'dragleave', last); target = el; fire(target, 'dragenter', last); }
      fire(target, 'dragover', last);
    }).catch(() => {});
    api.listen('tauri://drag-leave', () => { fire(target, 'dragleave', last); target = null; }).catch(() => {});
    api.listen('tauri://drag-drop', (m) => { const el = at(m.payload.position) || target; fire(el, 'drop', m.payload.paths || last); target = null; }).catch(() => {});
  };
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', dragDrop); else dragDrop();
  }

  const nore = {
    info: invoke('app:info'),
    state: invoke('state:get'),
    setSettings: invoke('settings:set'),
    onboardingDone: invoke('onboarding:done'),
    pickJava: invoke('dialog:java'),
    open: invoke('shell:open'),
    openFolder: invoke('shell:folder'),
    window: {
      minimize: send('window:minimize'),
      maximize: send('window:maximize'),
      close: send('window:close'),
    },
    auth: {
      status: invoke('auth:status'),
      logout: invoke('auth:logout'),
    },
    accounts: {
      offline: invoke('accounts:offline'),
      msStart: invoke('accounts:msStart'),
      msPoll: invoke('accounts:msPoll'),
      msCancel: invoke('accounts:msCancel'),
      select: invoke('accounts:select'),
      remove: invoke('accounts:remove'),
    },
    versions: {
      list: invoke('versions:list'),
      fabricLoaders: invoke('versions:fabricLoaders'),
      installed: invoke('versions:installed'),
      remove: invoke('versions:delete'),
      storage: invoke('storage:info'),
    },
    instances: {
      create: invoke('instances:create'),
      update: invoke('instances:update'),
      remove: invoke('instances:remove'),
      select: invoke('instances:select'),
      folder: invoke('instances:folder'),
      worlds: invoke('instances:worlds'),
      worldsInfo: invoke('instances:worldsInfo'),
      screenshots: invoke('instances:screenshots'),
      deleteWorld: invoke('instances:deleteWorld'),
      backupWorld: invoke('instances:backupWorld'),
      deleteScreenshot: invoke('instances:deleteScreenshot'),
      size: invoke('instances:size'),
      media: invoke('instances:media'),
      setMedia: invoke('instances:setMedia'),
      stats: invoke('instances:stats'),
      duplicate: invoke('instances:duplicate'),
      optionsProfile: invoke('instances:optionsProfile'),
      memoryInfo: invoke('instances:memoryInfo'),
    },
    official: {
      info: invoke('official:info'),
      status: invoke('official:status'),
      pick: invoke('official:pick'),
    },
    game: {
      launch: invoke('game:launch'),
      prepare: invoke('game:prepare'),
      kill: invoke('game:kill'),
    },
    servers: {
      list: invoke('servers:list'),
      create: invoke('servers:create'),
      update: invoke('servers:update'),
      remove: invoke('servers:remove'),
      start: invoke('servers:start'),
      stop: invoke('servers:stop'),
      command: invoke('servers:command'),
      logs: invoke('servers:logs'),
      folder: invoke('servers:folder'),
      restart: invoke('servers:restart'),
      stats: invoke('servers:stats'),
      properties: invoke('servers:properties'),
      players: invoke('servers:players'),
      playerList: invoke('servers:playerList'),
      backup: invoke('servers:backup'),
      backups: invoke('servers:backups'),
      restoreBackup: invoke('servers:restoreBackup'),
      deleteBackup: invoke('servers:deleteBackup'),
      resetWorld: invoke('servers:resetWorld'),
      reinstall: invoke('servers:reinstall'),
      setIcon: invoke('servers:setIcon'),
      icon: invoke('servers:icon'),
      contentKinds: invoke('servers:contentKinds'),
      contentSearch: invoke('servers:contentSearch'),
      contentInstall: invoke('servers:contentInstall'),
      contentList: invoke('servers:contentList'),
      contentToggle: invoke('servers:contentToggle'),
      contentRemove: invoke('servers:contentRemove'),
      contentAddFiles: invoke('servers:contentAddFiles'),
      contentUpdates: invoke('servers:contentUpdates'),
      contentApplyUpdates: invoke('servers:contentApplyUpdates'),
      contentAddPaths: invoke('servers:contentAddPaths'),
      // dropped files: the paths come from Tauri's native drag & drop (see dragDrop below)
      pathForFile: (file) => (file && droppedPaths.get(file)) || null,
      modpackVersions: invoke('servers:modpackVersions'),
      modpackUpdate: invoke('servers:modpackUpdate'),
      modpackApply: invoke('servers:modpackApply'),
      loaderVersions: invoke('servers:loaderVersions'),
      diagnose: invoke('servers:diagnose'),
      firewall: invoke('servers:firewall'),
      dnsCheck: invoke('servers:dnsCheck'),
      tunnelLink: invoke('servers:tunnelLink'),
      tunnelUnlink: invoke('servers:tunnelUnlink'),
      tunnel: invoke('servers:tunnel'),
      netInfo: invoke('servers:netInfo'),
      checkReachable: invoke('servers:checkReachable'),
      upnp: invoke('servers:upnp'),
      applyDomain: invoke('servers:applyDomain'),
      noreDomain: invoke('servers:noreDomain'),
      dnsRecords: invoke('servers:dnsRecords'),
      contentSources: invoke('servers:contentSources'),
      blocked: invoke('servers:blocked'),
      resolveBlocked: invoke('servers:resolveBlocked'),
      propertiesForm: invoke('servers:propertiesForm'),
      saveProperties: invoke('servers:saveProperties'),
      complete: invoke('servers:complete'),
      jvmPreview: invoke('servers:jvmPreview'),
      motdPreview: invoke('servers:motdPreview'),
    },
    mods: {
      list: invoke('mods:list'), identify: invoke('mods:identify'), toggle: invoke('mods:toggle'), bulk: invoke('mods:bulk'), pin: invoke('mods:pin'),
      saveProfile: invoke('mods:saveProfile'), applyProfile: invoke('mods:applyProfile'), deleteProfile: invoke('mods:deleteProfile'),
      modlist: invoke('mods:modlist'), saveModlist: invoke('mods:saveModlist'), exportPack: invoke('mods:exportPack'), changelog: invoke('mods:changelog'),
      configs: invoke('mods:configs'), readConfig: invoke('mods:readConfig'), saveConfig: invoke('mods:saveConfig'),
    },
    content: {
      search: invoke('content:search'),
      project: invoke('content:project'),
      details: invoke('content:details'),
      identify: invoke('content:identify'),
      categories: invoke('content:categories'),
      install: invoke('content:install'),
      installed: invoke('content:installed'),
      toggle: invoke('content:toggle'),
      updates: invoke('content:updates'),
      applyUpdates: invoke('content:applyUpdates'),
      remove: invoke('content:delete'),
      updatesState: invoke('content:updatesState'),
      checkAll: invoke('content:checkAll'),
    },
    chat: {
      identity: invoke('chat:identity'), contacts: invoke('chat:contacts'), add: invoke('chat:add'), remove: invoke('chat:remove'),
      sign: invoke('chat:sign'), verify: invoke('chat:verify'), seen: invoke('chat:seen'), requests: invoke('chat:requests'),
      addRequest: invoke('chat:addRequest'), decline: invoke('chat:decline'), history: invoke('chat:history'), put: invoke('chat:put'),
      read: invoke('chat:read'), clear: invoke('chat:clear'), attention: invoke('chat:attention'), presence: invoke('chat:presence'),
    },
    curseforge: { status: invoke('curseforge:status'), setKey: invoke('curseforge:setKey') },
    modpacks: {
      install: invoke('modpacks:install'),
      import: invoke('modpacks:import'),
      checkUpdate: invoke('modpacks:checkUpdate'),
      update: invoke('modpacks:update'),
      versions: invoke('modpacks:versions'),
      importInstance: invoke('modpacks:importInstance'),
      blocked: invoke('modpacks:blocked'),
      resolveBlocked: invoke('modpacks:resolveBlocked'),
    },
    perf: { preview: invoke('perf:preview'), apply: invoke('perf:apply'), remove: invoke('perf:remove'), decline: invoke('perf:decline') },
    loaders: { versions: invoke('loaders:versions') },
    background: { custom: invoke('bg:custom'), pick: invoke('bg:pick') },
    doctor: { check: invoke('doctor:check'), fix: invoke('doctor:fix') },
    friends: { list: invoke('friends:list'), add: invoke('friends:add'), remove: invoke('friends:remove') },
    gallery: {
      list: invoke('gallery:list'), full: invoke('gallery:full'), copy: invoke('gallery:copy'),
      reveal: invoke('gallery:reveal'), open: invoke('gallery:open'), remove: invoke('gallery:delete'),
    },
    notices: { get: invoke('notices:get') },
    update: {
      state: invoke('update:state'),
      check: invoke('update:check'),
      download: invoke('update:download'),
      install: invoke('update:install'),
    },
    on,
  };

  Object.defineProperty(window, 'nore', { value: nore, writable: false, configurable: false, enumerable: true });
})();
