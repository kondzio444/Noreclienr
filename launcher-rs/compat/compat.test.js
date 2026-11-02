'use strict';
/*
 * window.nore of the Rust launcher (compat/nore-tauri.js) must have exactly the shape of the Electron
 * preload (launcher/src/preload.js), and every function must reach the same IPC channel.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const PRELOAD = path.join(__dirname, '..', '..', 'launcher', 'src', 'preload.js');
const COMPAT = path.join(__dirname, 'nore-tauri.js');

/** window.nore as Electron's preload builds it, with every invoke / send recorded. */
function electronApi() {
  let api = null;
  const calls = [];
  const electron = {
    contextBridge: { exposeInMainWorld: (name, value) => { api = value; } },
    ipcRenderer: {
      invoke: (ch, ...args) => { calls.push([ch, args]); return Promise.resolve(null); },
      send: (ch, ...args) => calls.push([ch, args]),
      on() {}, removeListener() {},
    },
    webUtils: { getPathForFile: () => null },
  };
  vm.runInNewContext(fs.readFileSync(PRELOAD, 'utf8'), { require: (m) => (m === 'electron' ? electron : require(m)) });
  return { api, calls };
}

/** window.nore as the compat script builds it on a fake Tauri. */
function tauriApi() {
  const calls = [];
  const listened = [];
  const window = {
    __TAURI_INTERNALS__: { invoke: (cmd, payload) => { calls.push([cmd, payload]); return Promise.resolve(null); } },
    __TAURI__: { event: { listen: (ch) => { listened.push(ch); return Promise.resolve(() => {}); } } },
  };
  vm.runInNewContext(fs.readFileSync(COMPAT, 'utf8'), { window });
  return { api: window.nore, calls, listened };
}

function shape(o) {
  return Object.fromEntries(Object.keys(o).sort().map(k => [k, typeof o[k] === 'object' && o[k] ? shape(o[k]) : typeof o[k]]));
}

function each(o, fn, prefix = []) {
  for (const [k, v] of Object.entries(o)) {
    if (typeof v === 'function') fn([...prefix, k], v);
    else if (v && typeof v === 'object') each(v, fn, [...prefix, k]);
  }
}

test('same API shape as the Electron preload', () => {
  assert.deepStrictEqual(shape(tauriApi().api), shape(electronApi().api));
});

test('every function reaches the same channel with the same arguments', async () => {
  const e = electronApi();
  const t = tauriApi();
  const skip = new Set(['on', 'servers.pathForFile']);
  let n = 0;
  each(e.api, (p) => {
    const key = p.join('.');
    if (skip.has(key)) return;
    const get = (api) => p.reduce((o, k) => o[k], api);
    e.calls.length = 0;
    t.calls.length = 0;
    get(e.api)('a', { b: 1 });
    get(t.api)('a', { b: 1 });
    const [ch, args] = e.calls[0];
    const sent = key.startsWith('window.') ? [] : args;
    // values cross vm realms: compare their JSON
    assert.deepStrictEqual(JSON.parse(JSON.stringify(t.calls[0])), ['nore_ipc', { channel: ch, args: sent }], key);
    n++;
  });
  assert.ok(n > 150, `${n} functions`);
});

test('events: allowed channels only, unsubscribe works', async () => {
  const t = tauriApi();
  const off = t.api.on('game:state', () => {});
  assert.deepStrictEqual([...t.listened], ['game:state']);
  assert.strictEqual(typeof off, 'function');
  off();
  t.api.on('not:allowed', () => {});
  assert.deepStrictEqual([...t.listened], ['game:state']);
});

test('the same event channels as the preload allow-list', () => {
  const list = (file, re) => JSON.parse(re.exec(fs.readFileSync(file, 'utf8'))[1].replace(/'/g, '"'));
  assert.deepStrictEqual(list(COMPAT, /const EVENTS = (\[[^\]]+\])/), list(PRELOAD, /const allowed = (\[[^\]]+\])/));
});

test('errors come back as Error with the backend message', async () => {
  const window = { __TAURI_INTERNALS__: { invoke: () => Promise.reject('Funkcja w przygotowaniu w wersji Rust (servers:start).') } };
  vm.runInNewContext(fs.readFileSync(COMPAT, 'utf8'), { window });
  await assert.rejects(window.nore.servers.start('x'), { message: 'Funkcja w przygotowaniu w wersji Rust (servers:start).' });
});

test('an existing window.nore (Electron) is left alone', () => {
  const window = { nore: { electron: true } };
  vm.runInNewContext(fs.readFileSync(COMPAT, 'utf8'), { window });
  assert.strictEqual(window.nore.electron, true);
});
