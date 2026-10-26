/*
 * API v2 – response envelope, ETag/304, CORS and request-body helpers.
 *
 * Every JSON answer is an object:
 *   success  { "ok": true, ...fields }
 *   failure  { "ok": false, "status": 404, "code": "not_found", "error": "<Polish message>", "errors"?: [...] }
 */
export const API2_VERSION = '2.0.0';

export const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'Cross-Origin-Opener-Policy': 'same-origin',
};

/** Sites that may call the cookie-authenticated routes (panel, /me, logout) from a browser. */
export const SITE_ORIGINS = ['https://noreclient.pl', 'https://mc.noreclient.pl'];

export class ApiError extends Error {
  /** @param {number} status @param {string} code @param {string} message @param {object} [extra] fields added to the error body */
  constructor(status, code, message, extra) { super(message); this.status = status; this.code = code; this.extra = extra; }
}

const CODES = { 400: 'bad_request', 401: 'unauthorized', 403: 'forbidden', 404: 'not_found', 405: 'method_not_allowed', 409: 'conflict', 413: 'too_large', 415: 'unsupported_media_type', 429: 'rate_limited', 500: 'internal', 502: 'upstream', 503: 'unavailable', 504: 'timeout' };

/** Origins allowed for credentialed CORS: the Nore sites, the request's own origin and PANEL_ORIGINS (comma list, dev only). */
export function allowedOrigin(request, env) {
  const origin = request.headers.get('Origin');
  if (!origin) return null;
  const own = new URL(request.url).origin;
  const extra = String(env.PANEL_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
  return origin === own || SITE_ORIGINS.includes(origin) || extra.includes(origin) ? origin : null;
}

/**
 * CORS headers for a route kind:
 *   public  – anyone (no credentials)
 *   session – the Nore sites only, with credentials
 *   bot     – none (server to server)
 */
export function corsHeaders(kind, request, env, methods = 'GET, HEAD, OPTIONS') {
  if (kind === 'public') {
    return {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': methods,
      'Access-Control-Allow-Headers': 'Content-Type, If-None-Match',
      'Access-Control-Expose-Headers': 'ETag, X-Nore-Api, X-Nore-Cache, Retry-After, X-RateLimit-Limit',
      'Access-Control-Max-Age': '86400',
    };
  }
  if (kind === 'session') {
    const origin = allowedOrigin(request, env);
    const h = { Vary: 'Origin' };
    if (origin) {
      Object.assign(h, {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Credentials': 'true',
        'Access-Control-Allow-Methods': methods,
        'Access-Control-Allow-Headers': 'Content-Type, If-None-Match',
        'Access-Control-Expose-Headers': 'ETag, X-Nore-Api',
        'Access-Control-Max-Age': '600',
      });
    }
    return h;
  }
  return {};
}

const enc = new TextEncoder();

export async function etagOf(text) {
  const d = await crypto.subtle.digest('SHA-1', enc.encode(text));
  return '"' + [...new Uint8Array(d)].slice(0, 12).map(b => b.toString(16).padStart(2, '0')).join('') + '"';
}

/** If-None-Match may be a list and may use weak tags. */
export function etagMatches(header, etag) {
  if (!header) return false;
  if (header.trim() === '*') return true;
  return header.split(',').map(s => s.trim().replace(/^W\//, '')).includes(etag);
}

/**
 * JSON answer. `maxAge` 0 = no-store (still with an ETag), `priv` = per-user data (private, no-store).
 * @returns {Promise<Response>}
 */
export async function send(request, data, { status = 200, maxAge = 0, swr = 0, cors = {}, headers = {}, cacheState, priv = false } = {}) {
  const ok = status < 400;
  const body = JSON.stringify(ok ? { ok: true, ...data } : data, null, 2);
  const etag = await etagOf(body);
  const h = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': priv ? 'private, no-store' : maxAge && ok ? `public, max-age=${maxAge}${swr ? `, stale-while-revalidate=${swr}` : ''}` : 'no-store',
    ETag: etag,
    'X-Nore-Api': API2_VERSION,
    ...SECURITY_HEADERS,
    ...cors,
    ...headers,
  };
  if (cacheState) h['X-Nore-Cache'] = cacheState;
  const method = request.method;
  if (ok && (method === 'GET' || method === 'HEAD') && etagMatches(request.headers.get('If-None-Match'), etag)) {
    return new Response(null, { status: 304, headers: h });
  }
  return new Response(method === 'HEAD' ? null : body, { status, headers: h });
}

export function errorBody(e) {
  const status = e.status || 500;
  return { ok: false, status, code: e.code || CODES[status] || 'error', error: String(e.message || e), ...(e.extra || {}) };
}

export const sendError = (request, e, opts = {}) => send(request, errorBody(e), { ...opts, status: e.status || 500 });

/** Reads a JSON object body (Content-Type application/json, at most `max` bytes). */
export async function readJson(request, max = 64 * 1024) {
  const type = request.headers.get('Content-Type') || '';
  if (!/^application\/json\b/i.test(type)) throw new ApiError(415, 'unsupported_media_type', 'Treść musi mieć Content-Type: application/json');
  if (Number(request.headers.get('Content-Length') || 0) > max) throw new ApiError(413, 'too_large', `Za duże żądanie – najwyżej ${Math.round(max / 1024)} KB`);
  const buf = await request.arrayBuffer();
  if (buf.byteLength > max) throw new ApiError(413, 'too_large', `Za duże żądanie – najwyżej ${Math.round(max / 1024)} KB`);
  let v;
  try { v = JSON.parse(new TextDecoder().decode(buf)); } catch { throw new ApiError(400, 'invalid_json', 'Treść nie jest poprawnym JSON-em'); }
  if (v === null || typeof v !== 'object' || Array.isArray(v)) throw new ApiError(400, 'invalid_json', 'Treść musi być obiektem JSON');
  return v;
}

/** Constant-time comparison of two strings (hashes both, so the lengths do not leak either). */
export async function safeEqual(a, b) {
  const [x, y] = await Promise.all([a, b].map(s => crypto.subtle.digest('SHA-256', enc.encode(String(s)))));
  const ua = new Uint8Array(x), ub = new Uint8Array(y);
  if (crypto.subtle.timingSafeEqual) return crypto.subtle.timingSafeEqual(ua, ub);
  let d = 0;
  for (let i = 0; i < ua.length; i++) d |= ua[i] ^ ub[i];
  return d === 0;
}

export const clientIp = (request) => request.headers.get('CF-Connecting-IP') || request.headers.get('X-Real-IP') || '0.0.0.0';

export function b64url(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function unb64url(s) {
  const t = s.replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(t + '='.repeat((4 - t.length % 4) % 4)), c => c.charCodeAt(0));
}
export const randomToken = (n = 32) => b64url(crypto.getRandomValues(new Uint8Array(n)));
