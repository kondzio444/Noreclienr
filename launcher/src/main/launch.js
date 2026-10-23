'use strict';
const fsp = require('fs/promises');
const path = require('path');
const { spawn } = require('child_process');
const crypto = require('crypto');
const paths = require('./paths');
const versions = require('./versions');
const java = require('./java');
const { DISCORD_APP_ID } = require('./store');

const LAUNCHER_NAME = 'nore-launcher';
const LAUNCHER_VERSION = require('../../package.json').version;

// Nore Client refuses to run without a ticket signed with this key (see LaunchAuth in the mod)
const SESSION_KEY = Buffer.from(['65a21dccdb7cc1c0', 'd27f3c431f20a116', 'c2823186b96ef785', 'ef73623d0c1dea4f'].join(''), 'hex');

/** Short-lived signed ticket that lets Nore Client start (time.nonce.hmac). */
function sessionTicket() {
  const time = String(Date.now());
  const nonce = crypto.randomBytes(12).toString('hex');
  const sig = crypto.createHmac('sha256', SESSION_KEY).update(`nore:${time}:${nonce}`).digest('hex');
  return `${time}.${nonce}.${sig}`;
}

function substitute(str, vars) {
  return str.replace(/\$\{([a-zA-Z_]+)\}/g, (m, k) => (k in vars ? vars[k] : m));
}

/** Expands Mojang's modern argument arrays (strings or {rules, value}). */
function expandArgs(list, vars, features) {
  const out = [];
  for (const a of list || []) {
    if (typeof a === 'string') out.push(substitute(a, vars));
    else if (versions.rulesAllow(a.rules, features)) {
      const vals = Array.isArray(a.value) ? a.value : [a.value];
      for (const v of vals) out.push(substitute(v, vars));
    }
  }
  return out;
}

/**
 * Builds the full java command for an installed version.
 * Returns { javaBin, args, cwd }.
 */
async function buildCommand({ instance, account, settings, installed, javaBin }) {
  const { version, jarPath, libs } = installed;
  const gameDir = instance.gameDir;
  await fsp.mkdir(gameDir, { recursive: true });
  const nativesDir = path.join(versions.versionDir(installed.launchId), 'natives');
  await versions.extractNatives(libs.natives, nativesDir);

  const sep = process.platform === 'win32' ? ';' : ':';
  const classpath = [...libs.classpath, jarPath].join(sep);
  const memory = instance.memoryMb || settings.memoryMb;
  const width = instance.width || settings.width;
  const height = instance.height || settings.height;

  const vars = {
    auth_player_name: account.name,
    version_name: installed.launchId,
    game_directory: gameDir,
    assets_root: paths.assets,
    game_assets: path.join(paths.assets, 'virtual', 'legacy'),
    assets_index_name: version.assetIndex.id,
    auth_uuid: account.uuid.replace(/-/g, ''),
    auth_access_token: account.accessToken || '0',
    auth_session: account.accessToken || '0',
    clientid: '',
    auth_xuid: '',
    user_type: account.type === 'microsoft' ? 'msa' : 'legacy',
    version_type: `Nore Launcher`,
    user_properties: '{}',
    resolution_width: String(width),
    resolution_height: String(height),
    natives_directory: nativesDir,
    launcher_name: LAUNCHER_NAME,
    launcher_version: LAUNCHER_VERSION,
    classpath,
    classpath_separator: sep,
    library_directory: paths.libraries,
    quickPlayPath: '',
  };
  const features = { has_custom_resolution: !settings.fullscreen, is_demo_user: false };

  const jvm = [`-Xmx${memory}M`, `-Xms${Math.min(1024, memory)}M`];
  if (version.arguments && version.arguments.jvm) {
    jvm.push(...expandArgs(version.arguments.jvm, vars, features));
  } else {
    jvm.push(`-Djava.library.path=${nativesDir}`, '-cp', classpath);
  }
  if (version.logging && version.logging.client) {
    const f = version.logging.client.file;
    jvm.push(substitute(version.logging.client.argument, { path: path.join(paths.assets, 'log_configs', f.id) }));
  }
  jvm.push(`-Dnoreclient.session=${sessionTicket()}`);
  jvm.push(`-Dnoreclient.discordAppId=${settings.discordAppId || DISCORD_APP_ID}`);
  if (settings.chatBridge) jvm.push(`-Dnoreclient.chatBridge=${settings.chatBridge}`);
  // the Nore Hub address is built into the mod; NORE_HUB points the launcher and the game elsewhere
  if (process.env.NORE_HUB) jvm.push(`-Dnoreclient.hub=${process.env.NORE_HUB.replace(/\/+$/, '')}`);
  const extra = (settings.jvmArgs || '').trim();
  if (extra) jvm.push(...extra.split(/\s+/));
  if (process.platform === 'darwin') jvm.push('-XstartOnFirstThread');

  let game;
  if (version.arguments && version.arguments.game) {
    game = expandArgs(version.arguments.game, vars, features);
  } else {
    game = substitute(version.minecraftArguments || '', vars).split(' ').filter(Boolean);
    if (features.has_custom_resolution) game.push('--width', vars.resolution_width, '--height', vars.resolution_height);
  }
  // drop quick-play options with empty values
  for (let i = game.length - 1; i >= 0; i--) {
    if (game[i].startsWith('--quickPlay') && (i + 1 >= game.length || game[i + 1] === '' || game[i + 1].startsWith('--'))) {
      game.splice(i, game[i + 1] === '' ? 2 : 1);
    }
  }
  if (settings.fullscreen) game.push('--fullscreen');
  if (instance.joinServer) game.push('--quickPlayMultiplayer', instance.joinServer);

  return { javaBin, args: [...jvm, version.mainClass, ...game], cwd: gameDir };
}

/** Starts the game; onLog(line, stream) receives output; resolves with the child process. */
async function launch(opts, { onLog, onExit } = {}) {
  const cmd = await buildCommand(opts);
  const child = spawn(cmd.javaBin, cmd.args, { cwd: cmd.cwd, detached: false, windowsHide: false });
  const pipe = (stream, name) => {
    let buf = '';
    stream.on('data', (d) => {
      buf += d.toString();
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        onLog && onLog(buf.slice(0, i).replace(/\r$/, ''), name);
        buf = buf.slice(i + 1);
      }
    });
  };
  pipe(child.stdout, 'out');
  pipe(child.stderr, 'err');
  child.on('exit', (code) => onExit && onExit(code));
  child.on('error', (e) => { onLog && onLog('Błąd uruchamiania Javy: ' + e.message, 'err'); onExit && onExit(-1); });
  return child;
}

module.exports = { sessionTicket, buildCommand, launch, expandArgs, substitute };
