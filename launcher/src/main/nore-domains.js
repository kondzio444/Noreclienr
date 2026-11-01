'use strict';
/*
 * Official Nore domains – a free <name>.noreclient.pl address for a server hosted here
 * (contract: docs/domains.md, worker: web/src/v2/domains.js).
 *
 * Requests that change something are signed with this launcher's Nore ID (the chat identity in
 * chat.js, ECDSA P-256 – the same key Nore Hub uses):
 *   nore-domains/1|<op>|<name>|<hex>|<ts>|sha256hex(JSON.stringify(target ?? null))
 * The worker wants ts strictly increasing per Nore ID, so requests go through one queue.
 */
const crypto = require('crypto');
const chat = require('./chat');

const ZONE = 'noreclient.pl';
const API = () => (process.env.NORE_API || 'https://noreclient.pl').replace(/\/+$/, '');
const NAME = /^[a-z0-9](?:[a-z0-9-]{1,30})[a-z0-9]$/;

let fetchImpl = (...a) => fetch(...a);
/** Tests only: replaces fetch. */
function setFetch(fn) { fetchImpl = fn || ((...a) => fetch(...a)); }

/** Local check before asking the API (the worker has the full rules: reserved, profanity, …). */
function normalize(raw) {
  return String(raw || '').trim().toLowerCase().replace(/\.noreclient\.pl\.?$/, '');
}
function localError(name) {
  if (name.length < 3 || name.length > 32) return 'Nazwa musi mieć od 3 do 32 znaków.';
  if (!/^[a-z0-9-]+$/.test(name)) return 'Dozwolone są tylko małe litery a–z, cyfry i myślnik (bez polskich znaków).';
  if (!NAME.test(name)) return 'Nazwa nie może zaczynać się ani kończyć myślnikiem.';
  if (name.includes('--')) return 'Nazwa nie może zawierać dwóch myślników obok siebie.';
  return null;
}

/** The string the worker verifies. */
function canonical(op, name, hex, ts, target) {
  const digest = crypto.createHash('sha256').update(JSON.stringify(target ?? null)).digest('hex');
  return `nore-domains/1|${op}|${name}|${hex}|${ts}|${digest}`;
}

let lastTs = 0;
/** { hex, pub, ts, sig, target? } for op on name. */
function signedBody(op, name, target) {
  const me = chat.identity();
  const ts = Math.max(Date.now(), lastTs + 1);
  lastTs = ts;
  const body = { hex: me.hex, pub: me.pub, ts, sig: chat.sign(canonical(op, name, me.hex, ts, target)) };
  if (target !== undefined) body.target = target;
  return body;
}

class DomainError extends Error {
  constructor(message, status, code) { super(message); this.status = status; this.code = code; }
}

async function call(method, path, body) {
  let res;
  try {
    res = await fetchImpl(API() + '/api/v2/domains' + path, {
      method,
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'NoreLauncher' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
  } catch { throw new DomainError('Brak połączenia z Nore API – sprawdź internet.', 0, 'network'); }
  const j = await res.json().catch(() => null);
  if (!res.ok || !j || j.ok === false) throw new DomainError((j && j.error) || `Nore API odpowiedziało ${res.status}`, res.status, j && j.code);
  return j;
}

let chain = Promise.resolve();
function queued(fn) {
  const run = chain.then(fn, fn);
  chain = run.catch(() => {});
  return run;
}

/** Availability while typing: { name, fqdn, valid, available, reason, message, domain }. */
async function check(raw) {
  const name = normalize(raw);
  const bad = localError(name);
  if (bad) return { name, fqdn: `${name}.${ZONE}`, valid: false, available: false, reason: 'invalid', message: bad, domain: null };
  return call('GET', '/' + encodeURIComponent(name));
}

function cleanTarget(target) {
  if (!target || !target.address) return undefined;
  return { address: String(target.address), port: Number(target.port) || 25565 };
}

function claim(raw, target) {
  const name = normalize(raw);
  const bad = localError(name);
  if (bad) return Promise.reject(new DomainError(bad, 400, 'invalid'));
  return queued(() => call('POST', '/' + name, signedBody('claim', name, cleanTarget(target))));
}

function update(raw, target) {
  const name = normalize(raw);
  const t = cleanTarget(target);
  if (!t) return Promise.reject(new DomainError('Brak adresu docelowego.', 400, 'bad_target'));
  return queued(() => call('PUT', '/' + name, signedBody('update', name, t)));
}

function release(raw) {
  const name = normalize(raw);
  return queued(() => call('DELETE', '/' + name, signedBody('release', name)));
}

function mine() {
  return queued(() => call('POST', '/@mine', signedBody('mine', '')));
}

/**
 * Where the domain should point for a server: the playit.gg tunnel when it is on (host + port of
 * the tunnel address), else the public IP and the server port.
 */
function targetFor({ tunnelAddress, publicIp, port }) {
  if (tunnelAddress) {
    const m = /^([a-z0-9.-]+?)(?::(\d{1,5}))?$/i.exec(String(tunnelAddress).trim());
    if (m) return { address: m[1].toLowerCase(), port: m[2] ? Number(m[2]) : 25565 };
  }
  if (!publicIp) throw new DomainError('Nie udało się ustalić publicznego IP (brak internetu?)', 0, 'no_ip');
  return { address: publicIp, port: Number(port) || 25565 };
}

module.exports = { ZONE, normalize, localError, canonical, signedBody, check, claim, update, release, mine, targetFor, setFetch, DomainError };
