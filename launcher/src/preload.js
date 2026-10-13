'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const invoke = (ch) => (...args) => ipcRenderer.invoke(ch, ...args);

contextBridge.exposeInMainWorld('nore', {
  info: invoke('app:info'),
  state: invoke('state:get'),
  setSettings: invoke('settings:set'),
  onboardingDone: invoke('onboarding:done'),
  pickJava: invoke('dialog:java'),
  open: invoke('shell:open'),
  openFolder: invoke('shell:folder'),
  window: {
    minimize: () => ipcRenderer.send('window:minimize'),
    maximize: () => ipcRenderer.send('window:maximize'),
    close: () => ipcRenderer.send('window:close'),
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
    duplicate: invoke('instances:duplicate'),
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
  },
  content: {
    search: invoke('content:search'),
    project: invoke('content:project'),
    install: invoke('content:install'),
    installed: invoke('content:installed'),
    toggle: invoke('content:toggle'),
    remove: invoke('content:delete'),
  },
  on: (channel, fn) => {
    const allowed = ['progress', 'log', 'game:state', 'content:status', 'window:state', 'server:log', 'server:state', 'server:progress'];
    if (!allowed.includes(channel)) return () => {};
    const handler = (e, payload) => fn(payload);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  },
});
