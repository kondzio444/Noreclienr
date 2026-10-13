'use strict';
const fs = require('fs');
const path = require('path');
const paths = require('./paths');

const DEFAULTS = {
  firstRun: true,
  accounts: [],
  selectedAccount: null,
  instances: [],
  selectedInstance: null,
  settings: {
    memoryMb: 4096,
    javaPath: '',
    jvmArgs: '',
    width: 1280,
    height: 720,
    fullscreen: false,
    afterLaunch: 'hide', // hide | keep | close
    concurrency: 16,
    showSnapshots: false,
    msClientId: '',
    animations: true,
    accent: '#ff8a1f',
  },
};

let data = null;

function load() {
  try {
    const raw = JSON.parse(fs.readFileSync(paths.configFile, 'utf8'));
    data = { ...structuredClone(DEFAULTS), ...raw, settings: { ...DEFAULTS.settings, ...(raw.settings || {}) } };
  } catch {
    data = structuredClone(DEFAULTS);
  }
  return data;
}

function save() {
  fs.mkdirSync(path.dirname(paths.configFile), { recursive: true });
  const tmp = paths.configFile + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, paths.configFile);
}

function get() { return data || load(); }

function update(fn) {
  fn(get());
  save();
  return data;
}

module.exports = { load, save, get, update, DEFAULTS };
