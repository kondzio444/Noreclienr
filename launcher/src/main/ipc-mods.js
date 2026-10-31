'use strict';
/*
 * IPC of the mod manager, shared by instances and local servers. A target is
 * { instanceId } (the instance's mods/) or { serverId, kind: 'mod'|'plugin' } (the server's mods/ or plugins/).
 * The logic itself lives in mod-manager.js, mod-meta.js and config-edit.js.
 */
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const mm = require('./mod-manager');
const meta = require('./mod-meta');
const cfg = require('./config-edit');

function register({ ipcMain, dialog, getWin, send, instances, servers, serverContent, modrinth, curseforge, net }) {
  /** Resolves a target to its folder, owner record and storage for pins / profiles. */
  function target(t = {}) {
    if (t.instanceId) {
      const inst = instances.get(t.instanceId);
      if (!inst) throw new Error('Nie znaleziono instancji.');
      return {
        kind: 'mod', dir: path.join(inst.gameDir, 'mods'), root: inst.gameDir, loader: inst.loader, server: false,
        title: inst.name, mcVersion: inst.mcVersion, pins: inst.modPins || [], profiles: (inst.modProfiles || []),
        save: (patch) => instances.update(inst.id, patch), rec: inst, profileKey: 'mod',
      };
    }
    const srv = servers.get(t.serverId);
    if (!srv) throw new Error('Nie znaleziono serwera.');
    const kind = t.kind === 'plugin' ? 'plugin' : 'mod';
    return {
      kind, dir: serverContent.folderOf(srv, kind), root: srv.dir, loader: srv.type, server: true,
      title: srv.name, mcVersion: srv.mcVersion, pins: srv.modPins || [], profiles: (srv.modProfiles || []).filter(p => (p.kind || 'mod') === kind),
      allProfiles: srv.modProfiles || [], save: (patch) => servers.update(srv.id, patch), rec: srv, profileKey: kind,
    };
  }

  const listOf = (tg, ids = {}) => mm.list(tg.dir, { server: tg.server, loader: tg.loader, pins: tg.pins, ids });

  ipcMain.handle('mods:list', async (e, t) => {
    const tg = target(t);
    const r = await listOf(tg);
    return { ...r, dir: tg.dir, profiles: tg.profiles, kind: tg.kind, server: tg.server };
  });

  /** Same list enriched with Modrinth / CurseForge info (names, icons, sides) – needs the internet. */
  ipcMain.handle('mods:identify', async (e, t) => {
    const tg = target(t);
    const mr = await modrinth.identify(tg.dir, ['.jar']).catch(() => ({}));
    const cfMap = await curseforge.identify(tg.dir, ['.jar'], new Set(Object.keys(mr))).catch(() => ({}));
    const r = await listOf(tg, { ...cfMap, ...mr });
    return { ...r, dir: tg.dir, profiles: tg.profiles, kind: tg.kind, server: tg.server };
  });

  ipcMain.handle('mods:toggle', (e, t, file, enabled) => mm.setEnabled(target(t).dir, file, !!enabled));

  ipcMain.handle('mods:bulk', async (e, t, files, action) => {
    const tg = target(t);
    if (!['enable', 'disable', 'remove'].includes(action)) throw new Error('Nieznana akcja');
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    return mm.bulk(tg.dir, Array.isArray(files) ? files : [], action, { backupDir: action === 'remove' ? path.join(tg.root, '.nore-backup', `usuniete-${stamp}`, tg.kind === 'plugin' ? 'plugins' : 'mods') : null });
  });

  ipcMain.handle('mods:pin', (e, t, key, on) => {
    const tg = target(t);
    const pins = mm.togglePin(tg.pins, key, !!on);
    tg.save({ modPins: pins });
    return pins;
  });

  // ---------------------------------------------------------------- profiles
  const saveProfiles = (tg, list) => {
    if (tg.server) tg.save({ modProfiles: [...(tg.allProfiles || []).filter(p => (p.kind || 'mod') !== tg.kind), ...list.map(p => ({ ...p, kind: tg.kind }))] });
    else tg.save({ modProfiles: list });
  };
  ipcMain.handle('mods:saveProfile', async (e, t, name) => {
    const tg = target(t);
    const { mods } = await listOf(tg);
    const list = mm.upsertProfile(tg.profiles, mm.makeProfile(name, mods));
    saveProfiles(tg, list);
    return list;
  });
  ipcMain.handle('mods:applyProfile', async (e, t, name) => {
    const tg = target(t);
    const p = tg.profiles.find(x => x.name === name);
    if (!p) throw new Error('Nie ma takiego profilu.');
    const { mods } = await listOf(tg);
    const changed = await mm.applyProfile(tg.dir, mods, p);
    tg.save(tg.server ? {} : { modProfile: name });
    return { changed };
  });
  ipcMain.handle('mods:deleteProfile', (e, t, name) => {
    const tg = target(t);
    const list = tg.profiles.filter(p => p.name !== name);
    saveProfiles(tg, list);
    return list;
  });

  // ---------------------------------------------------------------- export
  ipcMain.handle('mods:modlist', async (e, t, format) => {
    const tg = target(t);
    const { mods } = await listOf(tg);
    return mm.modlist(mods, format === 'md' ? 'md' : 'txt', { title: tg.title, mcVersion: tg.mcVersion, loader: tg.loader });
  });
  ipcMain.handle('mods:saveModlist', async (e, t, format) => {
    const tg = target(t);
    const { mods } = await listOf(tg);
    const ext = format === 'md' ? 'md' : 'txt';
    const r = await dialog.showSaveDialog(getWin(), { title: 'Zapisz listę modów', defaultPath: `${tg.title.replace(/[\\/:*?"<>|]+/g, '_')} – mody.${ext}`, filters: [{ name: ext === 'md' ? 'Markdown' : 'Tekst', extensions: [ext] }] });
    if (r.canceled || !r.filePath) return null;
    await fsp.writeFile(r.filePath, mm.modlist(mods, ext, { title: tg.title, mcVersion: tg.mcVersion, loader: tg.loader }));
    return r.filePath;
  });
  ipcMain.handle('mods:exportPack', async (e, instanceId, format, opts = {}) => {
    const inst = instances.get(instanceId);
    if (!inst) throw new Error('Nie znaleziono instancji.');
    const mr = format !== 'curseforge';
    const r = await dialog.showSaveDialog(getWin(), {
      title: mr ? 'Eksportuj jako paczkę Modrinth' : 'Eksportuj jako paczkę CurseForge',
      defaultPath: `${inst.name.replace(/[\\/:*?"<>|]+/g, '_')}-${opts.version || '1.0.0'}.${mr ? 'mrpack' : 'zip'}`,
      filters: [{ name: mr ? 'Modrinth (.mrpack)' : 'CurseForge (.zip)', extensions: [mr ? 'mrpack' : 'zip'] }],
    });
    if (r.canceled || !r.filePath) return null;
    try {
      return await mm.exportPack(inst, {
        format: mr ? 'mrpack' : 'curseforge', out: r.filePath, version: opts.version, author: opts.author, includeOptions: opts.includeOptions !== false,
        net, cf: curseforge, onStatus: (stage) => send('mods:status', { stage }),
      });
    } finally { send('mods:status', null); }
  });

  // ---------------------------------------------------------------- changelog
  ipcMain.handle('mods:changelog', async (e, u) => {
    if (!u || !u.versionId) return '';
    if (u.source === 'curseforge') return curseforge.changelog(u.projectId, u.versionId);
    if (u.source === 'hangar') return '';
    const v = await net.getJson(`https://api.modrinth.com/v2/version/${encodeURIComponent(u.versionId)}`).catch(() => null);
    return v ? String(v.changelog || '').slice(0, 20000) : '';
  });

  // ---------------------------------------------------------------- configs
  async function configList(tg) {
    if (!tg.server) return mm.configFiles(tg.root);
    const list = await mm.configFiles(tg.root, ['config', 'plugins', 'defaultconfigs']);
    const skip = /^(ops|whitelist|banned-players|banned-ips|usercache|version_history|eula)\./i;
    for (const n of await fsp.readdir(tg.root).catch(() => [])) {
      if (!/\.(toml|yml|yaml|json|properties)$/i.test(n) || skip.test(n)) continue;
      const st = await fsp.stat(path.join(tg.root, n)).catch(() => null);
      if (st && st.isFile() && st.size < 2 * 1024 * 1024) list.unshift({ path: n, size: st.size, mtime: st.mtimeMs });
    }
    return list;
  }
  ipcMain.handle('mods:configs', async (e, t) => configList(target(t)));
  ipcMain.handle('mods:readConfig', async (e, t, rel) => {
    const tg = target(t);
    const text = await fsp.readFile(mm.insideRoot(tg.root, rel), 'utf8');
    return { path: rel, text, ...cfg.parse(rel, text) };
  });
  ipcMain.handle('mods:saveConfig', async (e, t, rel, { changes, text } = {}) => {
    const tg = target(t);
    const file = mm.insideRoot(tg.root, rel);
    const old = await fsp.readFile(file, 'utf8');
    const next = typeof text === 'string' ? text : cfg.apply(rel, old, changes || {});
    // the first edit keeps the original next to it (config.toml.nore-orig)
    if (!fs.existsSync(file + '.nore-orig')) await fsp.writeFile(file + '.nore-orig', old).catch(() => {});
    await fsp.writeFile(file, next);
    return { path: rel, text: next, ...cfg.parse(rel, next) };
  });
  ipcMain.handle('mods:jarInfo', (e, t, file) => meta.readJar(path.join(target(t).dir, path.basename(file))));
}

module.exports = { register };
