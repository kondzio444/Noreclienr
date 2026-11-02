'use strict';
/*
 * What the Nore team says to launcher users (docs/admin-api.md): active announcements, maintenance
 * and the minimum launcher version, from GET /api/v2/client/config?target=launcher. Read at start
 * and every 15 minutes; failures keep the last good copy. When this launcher is older than
 * minLauncherVersion the update check runs at once (the banner tells the user why).
 */
const net = require('./net');

const API = (process.env.NORE_API || 'https://noreclient.pl').replace(/\/+$/, '');
const EVERY_MS = 15 * 60 * 1000;
const LEVELS = ['info', 'warning', 'event'];

let current = { announcements: [], maintenance: null, updateRequired: false, minLauncherVersion: null, at: 0 };
let timer = null;

function newer(a, b) {
  const pa = String(a).replace(/^v/, '').split(/[.+-]/).map(n => parseInt(n, 10) || 0);
  const pb = String(b).replace(/^v/, '').split(/[.+-]/).map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  return false;
}

const text = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');

/** Keeps only what the banner shows, from an untrusted answer. */
function shape(cfg, version) {
  const list = Array.isArray(cfg && cfg.announcements) ? cfg.announcements : [];
  const announcements = list.slice(0, 5).filter(a => a && typeof a.id === 'string' && typeof a.title === 'string').map(a => ({
    id: text(a.id, 40), title: text(a.title, 120), body: text(a.body, 600),
    level: LEVELS.includes(a.level) ? a.level : 'info',
    link: typeof a.link === 'string' && /^https:\/\/\S+$/.test(a.link) ? a.link.slice(0, 300) : null,
  }));
  const m = cfg && cfg.maintenance;
  const min = cfg && typeof cfg.minLauncherVersion === 'string' ? cfg.minLauncherVersion : null;
  return {
    announcements,
    maintenance: m && m.enabled === true ? { message: text(m.message, 300) } : null,
    minLauncherVersion: min,
    updateRequired: !!(min && newer(min, version)),
    at: Date.now(),
  };
}

/**
 * Starts polling. `version` is this launcher's version, `send(state)` gets every new state and
 * `onUpdateRequired()` runs once when the launcher is too old.
 */
function start({ version, send = () => {}, onUpdateRequired = () => {} }) {
  let asked = false;
  const load = async () => {
    try {
      const cfg = await net.getJson(`${API}/api/v2/client/config?target=launcher`);
      current = shape(cfg, version);
      send(current);
      if (current.updateRequired && !asked) { asked = true; onUpdateRequired(current.minLauncherVersion); }
    } catch { /* offline: keep the last copy */ }
  };
  setTimeout(load, 4000);
  timer = setInterval(load, EVERY_MS);
  if (timer.unref) timer.unref();
}

function get() { return current; }
function stop() { clearInterval(timer); }

module.exports = { start, get, stop, shape, newer };
