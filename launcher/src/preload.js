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
  },
  instances: {
    create: invoke('instances:create'),
    update: invoke('instances:update'),
    remove: invoke('instances:remove'),
    select: invoke('instances:select'),
    folder: invoke('instances:folder'),
    worlds: invoke('instances:worlds'),
  },
  game: {
    launch: invoke('game:launch'),
    kill: invoke('game:kill'),
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
    const allowed = ['progress', 'log', 'game:state', 'content:status', 'window:state'];
    if (!allowed.includes(channel)) return () => {};
    const handler = (e, payload) => fn(payload);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  },
});
