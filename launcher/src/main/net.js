'use strict';
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

const UA = 'NoreLauncher/1.0.0 (github.com/kondzio444/Noreclienr)';

async function fetchWithRetry(url, opts = {}, tries = 4) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { ...opts, headers: { 'User-Agent': UA, ...(opts.headers || {}) } });
      if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status} ${url}`);
      return res;
    } catch (e) {
      lastErr = e;
      await new Promise(r => setTimeout(r, 500 * 2 ** i));
    }
  }
  throw lastErr;
}

async function getJson(url, opts) {
  const res = await fetchWithRetry(url, opts);
  if (!res.ok) throw new Error(`HTTP ${res.status} dla ${url}`);
  return res.json();
}

async function sha1File(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha1');
    fs.createReadStream(file).on('data', d => h.update(d)).on('end', () => resolve(h.digest('hex'))).on('error', reject);
  });
}

async function exists(file) {
  try { await fsp.access(file); return true; } catch { return false; }
}

/** True when the file exists and (if a hash is given) matches it. */
async function isValid(file, sha1, size) {
  try {
    const st = await fsp.stat(file);
    if (size != null && st.size !== size) return false;
    if (!sha1) return true;
    return (await sha1File(file)) === sha1;
  } catch { return false; }
}

/** Downloads url → dest atomically, verifying sha1 when provided. Calls onBytes(delta). */
async function download(url, dest, { sha1, size, onBytes } = {}) {
  if (await isValid(dest, sha1, size)) { if (onBytes && size) onBytes(size, true); return false; }
  await fsp.mkdir(path.dirname(dest), { recursive: true });
  for (let attempt = 0; attempt < 3; attempt++) {
    const tmp = `${dest}.${process.pid}.part`;
    const res = await fetchWithRetry(url);
    if (!res.ok) throw new Error(`HTTP ${res.status} dla ${url}`);
    const hash = crypto.createHash('sha1');
    const out = fs.createWriteStream(tmp);
    const reader = res.body.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        hash.update(value);
        if (!out.write(value)) await new Promise(r => out.once('drain', r));
        if (onBytes) onBytes(value.length, false);
      }
    } finally {
      await new Promise(r => out.end(r));
    }
    if (sha1 && hash.digest('hex') !== sha1) {
      await fsp.rm(tmp, { force: true });
      if (attempt === 2) throw new Error(`Błędna suma kontrolna: ${path.basename(dest)}`);
      continue;
    }
    await fsp.rename(tmp, dest);
    return true;
  }
  return false;
}

/**
 * Downloads many files with limited concurrency. tasks: [{url, dest, sha1, size, name}]
 * progress({done, total, bytes, totalBytes, current}) is throttled by the caller.
 */
async function downloadAll(tasks, { concurrency = 16, progress, signal } = {}) {
  const totalBytes = tasks.reduce((a, t) => a + (t.size || 0), 0);
  let done = 0, bytes = 0, idx = 0;
  const report = (current) => progress && progress({ done, total: tasks.length, bytes, totalBytes, current });
  async function worker() {
    while (idx < tasks.length) {
      if (signal && signal.aborted) throw new Error('Anulowano');
      const t = tasks[idx++];
      await download(t.url, t.dest, {
        sha1: t.sha1, size: t.size,
        onBytes: (n) => { bytes += n; },
      });
      done++;
      report(t.name || path.basename(t.dest));
    }
  }
  report('');
  await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length || 1) }, worker));
  report('');
}

module.exports = { UA, fetchWithRetry, getJson, download, downloadAll, sha1File, exists, isValid };
