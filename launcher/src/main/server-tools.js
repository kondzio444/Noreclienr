'use strict';
/*
 * Small pure helpers of the local server panel: scheduled restarts / backups, TPS from the server's
 * own commands (Paper "tps", Forge / NeoForge "forge tps" / "neoforge tps"), player join / leave
 * lines (also on proxies) and console autocomplete. No processes or files here – easy to port.
 */

// ------------------------------------------------------------------ schedule

/** Milliseconds from `now` to the next "HH:MM" (local time); null for an invalid time. */
function msUntil(now, hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || '').trim());
  if (!m || +m[1] > 23 || +m[2] > 59) return null;
  const d = new Date(now);
  const next = new Date(d.getFullYear(), d.getMonth(), d.getDate(), +m[1], +m[2], 0, 0);
  if (next.getTime() <= d.getTime()) next.setDate(next.getDate() + 1);
  return next.getTime() - d.getTime();
}

/** Normalised schedule: { restartAt: 'HH:MM'|'', backupEveryH: 0|1..168, warnMinutes: 0..30 }. */
function normalizeSchedule(s = {}) {
  const at = /^(\d{1,2}):(\d{2})$/.exec(String(s.restartAt || '').trim());
  const valid = at && +at[1] < 24 && +at[2] < 60;
  return {
    restartAt: valid ? `${at[1].padStart(2, '0')}:${at[2]}` : '',
    backupEveryH: Math.max(0, Math.min(168, parseInt(s.backupEveryH, 10) || 0)),
    warnMinutes: Math.max(0, Math.min(30, s.warnMinutes == null ? 5 : parseInt(s.warnMinutes, 10) || 0)),
  };
}

/** Warning messages before a scheduled restart: [{ inMs, text }] counted back from the restart. */
function restartWarnings(warnMinutes) {
  const marks = [30, 15, 10, 5, 3, 2, 1].filter(m => m <= warnMinutes);
  const out = marks.map(m => ({ before: m * 60000, text: `Restart serwera za ${m} ${m === 1 ? 'minutę' : m < 5 ? 'minuty' : 'minut'}` }));
  if (warnMinutes > 0) out.push({ before: 10000, text: 'Restart serwera za 10 sekund' });
  return out;
}

// ------------------------------------------------------------------ TPS

/** Command that prints TPS on this server type (null when the server has none). */
function tpsCommand(type) {
  if (['paper', 'purpur', 'folia'].includes(type)) return 'tps';
  if (type === 'neoforge') return 'neoforge tps';
  if (type === 'forge') return 'forge tps';
  return null;
}

/**
 * A TPS line → { tps, mspt? } or null.
 *  Paper: "TPS from last 1m, 5m, 15m: 20.0, 19.98, *20.0"
 *  Forge / NeoForge: "Overall: Mean tick time: 2.345 ms. Mean TPS: 20.000"
 *  Folia: "Server Health Report … TPS: 20.00 … MSPT: 3.12"
 */
function parseTps(line) {
  const s = String(line).replace(/§./g, '');
  let m = /TPS from last 1m, 5m, 15m:\s*\*?([\d.]+)/i.exec(s);
  if (m) return { tps: Math.min(20, parseFloat(m[1])) };
  m = /Overall\s*:\s*Mean tick time:\s*([\d.]+)\s*ms\.?\s*Mean TPS:\s*([\d.]+)/i.exec(s);
  if (m) return { tps: Math.min(20, parseFloat(m[2])), mspt: parseFloat(m[1]) };
  m = /TPS:\s*([\d.]+).*MSPT:\s*([\d.]+)/i.exec(s);
  if (m) return { tps: Math.min(20, parseFloat(m[1])), mspt: parseFloat(m[2]) };
  return null;
}

/** Lines printed by our own TPS poll that should stay out of the console. */
function isTpsNoise(line) {
  return /TPS from last 1m|Mean tick time|Server Health Report|^\s*(\[[^\]]*\]\s*)*(Dim|Overall)\b.*Mean TPS|Region #|Lowest Region TPS|Median Region TPS|Highest Region TPS|Utilisation/i.test(String(line));
}

// ------------------------------------------------------------------ players

/** Join / leave events from a console line: { join } | { leave } | null (vanilla, Paper, Velocity, BungeeCord). */
function playerEvent(line) {
  let m = /: (\w{3,16}) joined the game/.exec(line) || /\[connected player\] (\w{3,16}) \(.*\) has connected/.exec(line) || /\[(\w{3,16}),.*\] <-> InitialHandler has connected/.exec(line) || /\[(\w{3,16})\] <-> ServerConnector \[.*\] has connected/.exec(line);
  if (m) return { join: m[1] };
  m = /: (\w{3,16}) left the game/.exec(line) || /\[connected player\] (\w{3,16}) \(.*\) has disconnected/.exec(line) || /\[(\w{3,16})\] -> UpstreamBridge has disconnected/.exec(line) || /\[(\w{3,16})\] disconnected with/.exec(line);
  if (m) return { leave: m[1] };
  return null;
}

/** "Done (3.2s)! For help…" (Minecraft), "Done (1.23s)!" (Velocity), "Listening on /0.0.0.0:25577" (BungeeCord). */
function isReadyLine(line) {
  return /Done \(.*\)!/.test(line) || /Listening on \/[\d.:]+/.test(line);
}

// ------------------------------------------------------------------ console autocomplete

const COMMANDS = {
  // [command, arguments hint]
  common: [
    ['help', ''], ['list', ''], ['say', '<wiadomość>'], ['tell', '<gracz> <wiadomość>'], ['msg', '<gracz> <wiadomość>'], ['me', '<akcja>'],
    ['op', '<gracz>'], ['deop', '<gracz>'], ['kick', '<gracz> [powód]'], ['ban', '<gracz> [powód]'], ['ban-ip', '<ip|gracz>'], ['pardon', '<gracz>'], ['pardon-ip', '<ip>'], ['banlist', ''],
    ['whitelist', 'add|remove|on|off|list|reload'], ['gamemode', 'survival|creative|adventure|spectator [gracz]'], ['defaultgamemode', '<tryb>'],
    ['difficulty', 'peaceful|easy|normal|hard'], ['time', 'set|add|query day|night|noon|midnight'], ['weather', 'clear|rain|thunder [czas]'],
    ['tp', '<gracz> <cel>'], ['teleport', '<gracz> <cel>'], ['give', '<gracz> <przedmiot> [ilość]'], ['clear', '[gracz] [przedmiot]'], ['kill', '[cel]'],
    ['effect', 'give|clear <gracz> <efekt>'], ['enchant', '<gracz> <zaklęcie> [poziom]'], ['xp', 'add|set|query <gracz> <ilość>'], ['experience', 'add|set|query <gracz> <ilość>'],
    ['gamerule', '<reguła> [wartość]'], ['seed', ''], ['setworldspawn', '[x y z]'], ['spawnpoint', '[gracz] [x y z]'], ['worldborder', 'set|center|add|get'],
    ['save-all', '[flush]'], ['save-on', ''], ['save-off', ''], ['stop', ''], ['reload', ''], ['locate', 'structure|biome <nazwa>'],
    ['summon', '<byt> [x y z]'], ['setblock', '<x y z> <blok>'], ['fill', '<od> <do> <blok>'], ['execute', '…'], ['scoreboard', 'objectives|players …'],
    ['team', 'add|remove|join|leave …'], ['title', '<gracz> title|subtitle|actionbar <tekst>'], ['tellraw', '<gracz> <json>'], ['playsound', '<dźwięk> <źródło> <gracz>'],
    ['particle', '<cząsteczka> [x y z]'], ['spreadplayers', '…'], ['forceload', 'add|remove|query'], ['datapack', 'list|enable|disable'], ['function', '<funkcja>'],
    ['schedule', 'function|clear …'], ['bossbar', 'add|set|remove …'], ['attribute', '<cel> <atrybut> get|base …'], ['damage', '<cel> <ilość>'], ['ride', '<cel> mount|dismount'],
    ['tick', 'query|rate|freeze|unfreeze|step|sprint'], ['debug', 'start|stop'], ['perf', 'start|stop'], ['jfr', 'start|stop'], ['publish', ''], ['transfer', '<host> [port] [gracz]'],
  ],
  paper: [['tps', ''], ['mspt', ''], ['plugins', ''], ['pl', ''], ['version', '[plugin]'], ['timings', 'on|off|paste'], ['spark', 'profiler|tps|health'], ['paper', 'heap|dumpitem|entity'], ['restart', '']],
  forge: [['forge', 'tps|track|entity|generate'], ['neoforge', 'tps|track|entity|generate'], ['spark', 'profiler|tps|health']],
  fabric: [['spark', 'profiler|tps|health']],
  proxy: [['end', ''], ['shutdown', ''], ['velocity', 'version|plugins|reload|dump'], ['server', '[serwer]'], ['glist', ''], ['send', '<gracz> <serwer>'], ['alert', '<wiadomość>'], ['find', '<gracz>'], ['greload', '']],
};

const ARG_VALUES = {
  gamemode: ['survival', 'creative', 'adventure', 'spectator'], defaultgamemode: ['survival', 'creative', 'adventure', 'spectator'],
  difficulty: ['peaceful', 'easy', 'normal', 'hard'], weather: ['clear', 'rain', 'thunder'], time: ['set', 'add', 'query'],
  whitelist: ['add', 'remove', 'on', 'off', 'list', 'reload'], 'save-all': ['flush'], effect: ['give', 'clear'], xp: ['add', 'set', 'query'],
  gamerule: ['keepInventory', 'doDaylightCycle', 'doWeatherCycle', 'doMobSpawning', 'mobGriefing', 'doFireTick', 'playersSleepingPercentage', 'randomTickSpeed', 'showDeathMessages', 'announceAdvancements', 'doImmediateRespawn', 'naturalRegeneration', 'spawnRadius', 'doInsomnia', 'doPatrolSpawning', 'doTraderSpawning', 'fallDamage', 'fireDamage', 'drowningDamage', 'commandBlockOutput', 'sendCommandFeedback', 'maxEntityCramming', 'disableRaids', 'forgiveDeadPlayers', 'universalAnger'],
  'time set': ['day', 'night', 'noon', 'midnight'], 'time add': ['1000', '6000', '12000'], forge: ['tps', 'track', 'entity', 'generate'], neoforge: ['tps', 'track', 'entity', 'generate'],
  tick: ['query', 'rate', 'freeze', 'unfreeze', 'step', 'sprint'], datapack: ['list', 'enable', 'disable'], worldborder: ['set', 'center', 'add', 'get'],
};

const PLAYER_ARG = new Set(['op', 'deop', 'kick', 'ban', 'pardon', 'tell', 'msg', 'tp', 'teleport', 'give', 'clear', 'kill', 'spawnpoint', 'whitelist add', 'whitelist remove', 'gamemode survival', 'gamemode creative', 'gamemode adventure', 'gamemode spectator', 'title', 'tellraw', 'send', 'find', 'effect give', 'effect clear', 'xp add', 'xp set', 'xp query']);

function commandsFor(type) {
  const proxy = type === 'velocity' || type === 'bungeecord';
  if (proxy) return COMMANDS.proxy;
  const extra = ['paper', 'purpur', 'folia'].includes(type) ? COMMANDS.paper : ['forge', 'neoforge'].includes(type) ? COMMANDS.forge : ['fabric', 'quilt'].includes(type) ? COMMANDS.fabric : [];
  return [...COMMANDS.common, ...extra];
}

/**
 * Suggestions for the console input: [{ value, label, hint }] where value is the whole new input.
 * ctx: { type, players: [names], history: [commands] }.
 */
function complete(input, { type = 'paper', players = [], history = [] } = {}) {
  const text = String(input || '').replace(/^\//, '');
  const words = text.split(' ');
  const last = words[words.length - 1].toLowerCase();
  const head = words.slice(0, -1);
  const out = [];
  const add = (word, hint = '') => {
    const value = [...head, word].join(' ');
    if (value !== text && !out.some(o => o.value === value)) out.push({ value, label: word, hint });
  };
  if (head.length === 0) {
    for (const h of [...history].reverse()) if (h.toLowerCase().startsWith(text.toLowerCase()) && h !== text && out.length < 3) out.push({ value: h, label: h, hint: 'historia' });
    for (const [c, hint] of commandsFor(type)) if (c.startsWith(last)) add(c, hint);
    return out.slice(0, 12);
  }
  const cmd = head.join(' ').toLowerCase();
  const values = ARG_VALUES[cmd] || null;
  for (const v of values || []) if (v.toLowerCase().startsWith(last)) add(v);
  if (PLAYER_ARG.has(cmd) || (head.length >= 2 && PLAYER_ARG.has(head.slice(0, 2).join(' ').toLowerCase())) || (PLAYER_ARG.has(head[0].toLowerCase()) && head.length === 1)) {
    for (const p of players) if (p.toLowerCase().startsWith(last)) add(p, 'gracz');
    for (const sel of ['@a', '@p', '@r', '@s', '@e']) if (sel.startsWith(last) && last.startsWith('@')) add(sel, 'selektor');
  }
  return out.slice(0, 12);
}

module.exports = { msUntil, normalizeSchedule, restartWarnings, tpsCommand, parseTps, isTpsNoise, playerEvent, isReadyLine, complete, commandsFor };
