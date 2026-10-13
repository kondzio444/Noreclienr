'use strict';
const fs = require('fs');
const path = require('path');
const paths = require('./paths');

/** Discord application of Nore Client – Rich Presence is always on. */
const DISCORD_APP_ID = '1559570563339526175';

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
    discordRpc: true,
    autoUpdate: true,
    discordAppId: DISCORD_APP_ID,
    animations: true,
    accent: '#ff8a1f',
    // appearance (Settings → Wygląd)
    bgScene: 'photo',
    bgParticles: 'embers',
    bgMotion: 'kenburns',
    bgDensity: 1,
    bgDim: 55,
    bgBlur: 0,
    bgSpeed: 1,
    bgCustom: '',
    pageTransition: 'rise',
    accentPreset: 'orange',
  },
};

let data = null;

function load() {
  try {
    const raw = JSON.parse(fs.readFileSync(paths.configFile, 'utf8'));
    data = { ...structuredClone(DEFAULTS), ...raw, settings: { ...DEFAULTS.settings, ...(raw.settings || {}) } };
    // older versions stored an empty id / RPC switch – the Nore Client application is now always used
    if (!data.settings.discordAppId) data.settings.discordAppId = DISCORD_APP_ID;
    data.settings.discordRpc = true;
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

module.exports = { load, save, get, update, DEFAULTS, DISCORD_APP_ID };
