// Starts `wrangler dev` (local, fresh state) for the tests and stops it again.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export async function startDev({ port, vars = {}, cwd = WEB, log = process.env.DEV_LOG === '1' }) {
  const persist = fs.mkdtempSync(path.join(os.tmpdir(), 'nore-dev-'));
  const args = ['wrangler', 'dev', '--port', String(port), '--ip', '127.0.0.1', '--persist-to', persist, '--show-interactive-dev-session=false', '--log-level', log ? 'log' : 'warn'];
  for (const [k, v] of Object.entries(vars)) args.push('--var', `${k}:${v}`);
  const child = spawn('npx', args, { cwd, env: { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false' }, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  let out = '';
  const onData = (d) => { out += d; if (log) process.stderr.write(d); };
  child.stdout.on('data', onData);
  child.stderr.on('data', onData);
  const base = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 90_000;
  for (;;) {
    if (child.exitCode !== null) throw new Error('wrangler dev exited:\n' + out);
    try { const r = await fetch(base + '/api/v1/events'); if (r.status) break; } catch { /* not yet */ }
    if (Date.now() > deadline) { stop(); throw new Error('wrangler dev did not start:\n' + out); }
    await new Promise(r => setTimeout(r, 500));
  }
  function stop() {
    try { process.kill(-child.pid, 'SIGTERM'); } catch { /* gone */ }
    fs.rmSync(persist, { recursive: true, force: true });
  }
  return { base, stop, output: () => out };
}
