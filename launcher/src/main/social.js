'use strict';
/*
 * Friends (shared with Nore Client through <instance>/config/noreclient/friends.json) and a
 * screenshot gallery across all instances.
 */
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { nativeImage } = require('electron');
const store = require('./store');
const instances = require('./instances');

const NICK = /^[A-Za-z0-9_]{2,16}$/;

function friendsFile(inst) { return path.join(inst.gameDir, 'config', 'noreclient', 'friends.json'); }

async function readInstanceFriends(inst) {
  try {
    const j = JSON.parse(await fsp.readFile(friendsFile(inst), 'utf8'));
    return (Array.isArray(j) ? j : j.friends || []).map(x => (typeof x === 'string' ? x : x.name)).filter(n => NICK.test(n));
  } catch { return []; }
}

/** Launcher list merged with friends added in the game. */
async function friends() {
  const list = [...(store.get().friends || [])];
  const removed = new Set((store.get().friendsRemoved || []).map(n => n.toLowerCase()));
  const seen = new Set(list.map(n => n.toLowerCase()));
  for (const inst of instances.list()) {
    for (const n of await readInstanceFriends(inst)) {
      const k = n.toLowerCase();
      if (!seen.has(k) && !removed.has(k)) { seen.add(k); list.push(n); }
    }
  }
  if (list.length !== (store.get().friends || []).length) store.update(d => { d.friends = list; });
  return list;
}

/** Writes the list into every instance so Nore Client sees it. */
async function sync() {
  const list = store.get().friends || [];
  for (const inst of instances.list()) {
    try {
      await fsp.mkdir(path.dirname(friendsFile(inst)), { recursive: true });
      await fsp.writeFile(friendsFile(inst), JSON.stringify(list));
    } catch { /* read-only instance */ }
  }
}

async function addFriend(name) {
  name = String(name || '').trim();
  if (!NICK.test(name)) throw new Error('Nick musi mieć 2–16 znaków: litery, cyfry i _.');
  const list = await friends();
  if (list.some(n => n.toLowerCase() === name.toLowerCase())) throw new Error(`${name} już jest na liście.`);
  store.update(d => {
    d.friends = [...list, name];
    d.friendsRemoved = (d.friendsRemoved || []).filter(n => n.toLowerCase() !== name.toLowerCase());
  });
  await sync();
  return store.get().friends;
}

async function removeFriend(name) {
  store.update(d => {
    d.friends = (d.friends || []).filter(n => n.toLowerCase() !== String(name).toLowerCase());
    d.friendsRemoved = [...new Set([...(d.friendsRemoved || []), String(name)])];
  });
  await sync();
  return store.get().friends;
}

// ------------------------------------------------------------------ gallery

const thumbCache = new Map(); // path|mtime → data URL

async function gallery(limit = 300) {
  const out = [];
  for (const inst of instances.list()) {
    const dir = path.join(inst.gameDir, 'screenshots');
    let files = [];
    try { files = (await fsp.readdir(dir)).filter(f => /\.png$/i.test(f)); } catch { continue; }
    for (const f of files) {
      const p = path.join(dir, f);
      const st = await fsp.stat(p).catch(() => null);
      if (st) out.push({ name: f, path: p, time: st.mtimeMs, size: st.size, instanceId: inst.id, instance: inst.name });
    }
  }
  out.sort((a, b) => b.time - a.time);
  const list = out.slice(0, limit);
  for (const it of list) {
    const key = it.path + '|' + it.time;
    if (!thumbCache.has(key)) {
      try {
        const img = nativeImage.createFromPath(it.path);
        thumbCache.set(key, img.isEmpty() ? null : img.resize({ width: 360, quality: 'good' }).toDataURL());
      } catch { thumbCache.set(key, null); }
    }
    it.thumb = thumbCache.get(key);
  }
  return list;
}

function fullImage(p) {
  const img = nativeImage.createFromPath(p);
  return img.isEmpty() ? null : img.toDataURL();
}

module.exports = { friends, addFriend, removeFriend, sync, gallery, fullImage };
