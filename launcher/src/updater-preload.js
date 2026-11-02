'use strict';
// Preload of the Nore Updater splash window: it only receives update states and can skip or retry.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('noreUpdater', {
  onState: (fn) => ipcRenderer.on('splash:state', (e, s) => fn(s)),
  skip: () => ipcRenderer.send('splash:skip'),
  retry: () => ipcRenderer.send('splash:retry'),
});
