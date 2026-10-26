/**
 * fetch() with timeout, JSON helpers and per-source exponential backoff, shared by the Nore API
 * client and the feed pollers. Never throws for network problems when using `safe*` helpers.
 */
export const UA = 'NoreBot/1.0 (+https://noroclient.pl)';

export class HttpError extends Error {
  constructor(status, message, body) { super(message); this.status = status; this.body = body; }
}

export async function request(url, { method = 'GET', headers = {}, body, timeout = 10_000, json = true } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, {
      method,
      headers: { 'User-Agent': UA, Accept: json ? 'application/json' : '*/*', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctrl.signal,
    });
    const text = await res.text();
    let data = text;
    if (json && text) { try { data = JSON.parse(text); } catch { data = text; } }
    if (!res.ok && res.status !== 304) throw new HttpError(res.status, `${method} ${url} → ${res.status}`, data);
    return { status: res.status, data, headers: res.headers };
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw new HttpError(0, err.name === 'AbortError' ? `timeout ${url}` : `${err.cause?.code || err.message} ${url}`);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Backoff state for one remote source: ok() resets, fail() doubles the wait up to `max`.
 * ready() tells whether the next attempt is due.
 */
export class Backoff {
  constructor({ base = 15_000, max = 300_000 } = {}) {
    this.base = base; this.max = max; this.failures = 0; this.nextAt = 0;
  }
  ready(now = Date.now()) { return now >= this.nextAt; }
  ok() { const was = this.failures; this.failures = 0; this.nextAt = 0; return was > 0; }
  fail(now = Date.now()) {
    this.failures++;
    const wait = Math.min(this.max, this.base * 2 ** (this.failures - 1));
    this.nextAt = now + wait * (0.85 + Math.random() * 0.3);
    return this.failures === 1;
  }
  get delay() { return Math.min(this.max, this.base * 2 ** Math.max(0, this.failures - 1)); }
}
