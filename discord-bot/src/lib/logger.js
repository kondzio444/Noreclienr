/**
 * Structured logger. LOG_FORMAT=json prints one JSON object per line (for log collectors),
 * LOG_FORMAT=pretty (default) prints a readable line. LOG_LEVEL filters (debug < info < warn < error).
 *
 *   const log = logger.child('tickets');
 *   log.info('ticket opened', { guildId, channelId });
 */
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };
const COLORS = { debug: '\x1b[90m', info: '\x1b[36m', warn: '\x1b[33m', error: '\x1b[31m' };

function serializeError(err) {
  if (!(err instanceof Error)) return err;
  const out = { name: err.name, message: err.message };
  if (err.code !== undefined) out.code = err.code;
  if (err.status !== undefined) out.status = err.status;
  if (err.stack) out.stack = err.stack.split('\n').slice(0, 8).join('\n');
  return out;
}

function clean(fields) {
  if (!fields) return undefined;
  const out = {};
  for (const [k, v] of Object.entries(fields)) out[k] = v instanceof Error ? serializeError(v) : v;
  return out;
}

class Logger {
  constructor(scope = 'bot', opts = {}) {
    this.scope = scope;
    this.base = opts.base || {};
    this.root = opts.root || this;
    if (!opts.root) {
      this.level = LEVELS[(process.env.LOG_LEVEL || 'info').toLowerCase()] ?? LEVELS.info;
      this.format = (process.env.LOG_FORMAT || 'pretty').toLowerCase();
      this.color = this.format === 'pretty' && process.stdout.isTTY;
      this.sink = opts.sink || null; // tests may capture lines
    }
  }

  child(scope, base = {}) {
    return new Logger(`${this.scope}:${scope}`, { root: this.root, base: { ...this.base, ...base } });
  }

  setLevel(level) { this.root.level = LEVELS[level] ?? this.root.level; }

  log(level, msg, fields) {
    const root = this.root;
    if (LEVELS[level] < root.level) return;
    const data = { ...this.base, ...clean(fields) };
    if (process.env.SHARD_ID !== undefined && data.shard === undefined) data.shard = Number(process.env.SHARD_ID);
    let line;
    if (root.format === 'json') {
      line = JSON.stringify({ t: new Date().toISOString(), level, scope: this.scope, msg, ...data });
    } else {
      const extra = Object.keys(data).length ? ' ' + JSON.stringify(data) : '';
      const time = new Date().toISOString().replace('T', ' ').slice(0, 19);
      const lvl = root.color ? `${COLORS[level]}${level.toUpperCase().padEnd(5)}\x1b[0m` : level.toUpperCase().padEnd(5);
      line = `${time} ${lvl} [${this.scope}] ${msg}${extra}`;
    }
    if (root.sink) return root.sink(line, level);
    (level === 'error' || level === 'warn' ? process.stderr : process.stdout).write(line + '\n');
  }

  debug(msg, f) { this.log('debug', msg, f); }
  info(msg, f) { this.log('info', msg, f); }
  warn(msg, f) { this.log('warn', msg, f); }
  error(msg, f) { this.log('error', msg, f); }
}

export const logger = new Logger('nore');
export { Logger, serializeError };
