'use strict';
// Preload of the Nore Updater splash window: it only receives update states and can skip.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('noreUpdater', {
  onState: (fn) => ipcRenderer.on('splash:state', (e, s) => fn(s)),
  skip: () => ipcRenderer.send('splash:skip'),
});
