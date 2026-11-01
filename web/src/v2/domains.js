/*
 * Official Nore domains – free <name>.noreclient.pl addresses for Minecraft servers of Nore players
 * (docs/domains.md). State lives in one Durable Object (NoreDomains, src/v2/domains-store.js); DNS
 * changes go through the Cloudflare API (src/v2/cfdns.js).
 *
 *   GET    /api/v2/domains                  limits, zone, whether the feature is on
 *   GET    /api/v2/domains/:name            availability + public lookup
 *   POST   /api/v2/domains/:name            claim            (signed by the Nore ID)
 *   PUT    /api/v2/domains/:name            point at a target (signed; also refreshes the expiry)
 *   DELETE /api/v2/domains/:name            release          (signed)
 *   POST   /api/v2/domains/@mine            my names         (signed)
 *   /api/v2/admin/domains/…                 list, revoke, transfer, reserved names, official mc record
 *
 * Signature: the launcher's chat identity (ECDSA P-256, DER signature in base64, like Nore Hub):
 *   nore-domains/1|<op>|<name>|<hex>|<ts>|sha256hex(JSON.stringify(target ?? null))
 * with op = claim | update | release | mine, hex = first 20 hex chars of sha256(pub).
 */
import { ApiError, readJson, clientIp } from './http.js';
import { unwrap, iso } from './bot.js';
import { adminStore } from './admin-store.js';
import { derToP1363 } from '../hub.js';
import { ipKind, isPrivateIp } from './net.js';
import { zoneOf, dnsConfigured, requireDns } from './cfdns.js';

export const LIMITS = { min: 3, max: 32, perId: 3, expiryDays: 60, clockMs: 5 * 60 * 1000 };
const NAME = /^[a-z0-9](?:[a-z0-9-]{1,30})[a-z0-9]$/;
const HOST = /^(?=.{4,253}$)(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/;
const HEX = /^[0-9a-f]{20}$/;
const utf8 = new TextEncoder();

export const perId = (env) => Math.max(1, Math.min(20, parseInt(env.DOMAINS_MAX_PER_ID || '', 10) || LIMITS.perId));
export const expiryDays = (env) => Math.max(1, Math.min(365, parseInt(env.DOMAINS_EXPIRY_DAYS || '', 10) || LIMITS.expiryDays));

// ---------------------------------------------------------------- names

/** Names that are never handed out (services, the official server, Nore itself). Admins add more. */
export const RESERVED = new Set([
  'www', 'mc', 'mc-srv', 'api', 'panel', 'admin', 'admins', 'mail', 'email', 'smtp', 'imap', 'pop', 'pop3', 'mx', 'ns', 'ns1', 'ns2', 'dns',
  'status', 'play', 'launcher', 'bot', 'cdn', 'dev', 'staging', 'test', 'beta', 'alpha', 'noreclient', 'nore', 'norelauncher', 'norebot',
  'app', 'apps', 'auth', 'login', 'account', 'accounts', 'id', 'sso', 'oauth', 'static', 'assets', 'files', 'download', 'downloads', 'update',
  'updates', 'docs', 'help', 'support', 'blog', 'news', 'shop', 'store', 'pay', 'billing', 'hub', 'server', 'servers', 'official', 'oficjalny',
  'discord', 'forum', 'wiki', 'git', 'github', 'ftp', 'sftp', 'ssh', 'vpn', 'proxy', 'web', 'site', 'host', 'localhost', 'root', 'system',
  'team', 'staff', 'mod', 'mods', 'moderator', 'security', 'abuse', 'postmaster', 'hostmaster', 'webmaster', 'info', 'contact', 'kontakt',
  'autoconfig', 'autodiscover', 'wpad', 'isatap', 'internal', 'intranet', 'cpanel', 'webmail', 'portal', 'dashboard', 'console', 'grafana',
]);

// impersonation of Nore / staff / platforms (checked on the name without hyphens)
const IMPERSONATION = [
  /^nore(client|launcher|bot|mc|team|staff|admin|support|official|oficjal|hub|api|id)/, /noreclient/, /norelauncher/,
  /official/, /oficjal/, /administrat/, /moderat/, /support/, /helpdesk/, /staff/,
  /mojang/, /microsoft/, /xbox/, /minecraftnet/, /minecraftofficial/, /curseforge/, /modrinth/, /discordapp/, /discordgg/, /cloudflare/, /playitgg/,
  /paypal/, /freenitro/, /nitrofree/, /giveaway/, /login/, /verify/, /weryfik/, /phish/,
];
// a basic profanity / hate list (Polish + English), matched after undoing simple leetspeak
const PROFANITY = [
  'kurw', 'chuj', 'huj', 'pizd', 'jeba', 'jebi', 'jebn', 'pierdol', 'cipa', 'dziwk', 'szmat', 'pedal', 'ciota', 'skurwy', 'zjeb', 'spierdal', 'wypierdal',
  'fuck', 'shit', 'cunt', 'nigg', 'nigga', 'faggot', 'bitch', 'whore', 'slut', 'porn', 'xxx', 'hentai', 'hitler', 'nazi', 'kkk',
];
const deleet = (s) => s.replace(/-/g, '').replace(/0/g, 'o').replace(/1/g, 'i').replace(/3/g, 'e').replace(/4/g, 'a').replace(/5/g, 's').replace(/7/g, 't').replace(/8/g, 'b').replace(/\$/g, 's');

/** { name, valid, reason, message } – reason: invalid | reserved | blocked_word | impersonation. */
export function checkName(raw) {
  const name = String(raw || '').trim().toLowerCase().replace(/\.noreclient\.pl\.?$/, '');
  const bad = (reason, message) => ({ name, valid: false, reason, message });
  if (RESERVED.has(name)) return bad('reserved', 'Ta nazwa jest zarezerwowana przez Nore.');
  if (name.length < LIMITS.min || name.length > LIMITS.max) return bad('invalid', `Nazwa musi mieć od ${LIMITS.min} do ${LIMITS.max} znaków.`);
  if (!/^[a-z0-9-]+$/.test(name)) return bad('invalid', 'Dozwolone są tylko małe litery a–z, cyfry i myślnik (bez polskich znaków).');
  if (!NAME.test(name)) return bad('invalid', 'Nazwa nie może zaczynać się ani kończyć myślnikiem.');
  if (name.includes('--')) return bad('invalid', 'Nazwa nie może zawierać dwóch myślników obok siebie.');
  if (/^\d+$/.test(name)) return bad('invalid', 'Nazwa nie może składać się z samych cyfr.');
  if (RESERVED.has(name)) return bad('reserved', 'Ta nazwa jest zarezerwowana przez Nore.');
  const flat = name.replace(/-/g, '');
  const leet = deleet(name);
  if (IMPERSONATION.some(re => re.test(flat) || re.test(leet))) return bad('impersonation', 'Ta nazwa może udawać Nore, obsługę albo znaną usługę – wybierz inną.');
  if (PROFANITY.some(w => flat.includes(w) || leet.includes(w))) return bad('blocked_word', 'Ta nazwa zawiera niedozwolone słowo.');
  return { name, valid: true, reason: null, message: null };
}

// ---------------------------------------------------------------- targets

/**
 * { address, port } from the launcher → { type: A | AAAA | CNAME, address, port } or 400.
 * address: a public IPv4 / IPv6, a host name (e.g. a playit.gg tunnel) or "auto" (the caller's IP).
 */
export function cleanTarget(t, ip, zone) {
  if (t === null || t === undefined) return null;
  if (typeof t !== 'object' || Array.isArray(t)) throw new ApiError(400, 'bad_target', 'target: { address, port }');
  if (Object.keys(t).some(k => k !== 'address' && k !== 'port')) throw new ApiError(400, 'bad_target', 'target: dozwolone są tylko address i port');
  let address = typeof t.address === 'string' ? t.address.trim().toLowerCase().replace(/\.$/, '') : '';
  if (address === 'auto') address = String(ip || '');
  if (!address || address.length > 253) throw new ApiError(400, 'bad_target', 'target.address: adres IP albo nazwa hosta');
  let port = t.port === undefined || t.port === null ? 25565 : t.port;
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new ApiError(400, 'bad_port', 'target.port: liczba od 1 do 65535');
  const kind = ipKind(address);
  if (kind) {
    if (isPrivateIp(address)) throw new ApiError(400, 'private_address', 'To adres prywatny / lokalny – podaj publiczne IP (albo użyj tunelu playit.gg).');
    return { type: kind === 4 ? 'A' : 'AAAA', address, port };
  }
  if (!HOST.test(address)) throw new ApiError(400, 'bad_target', 'target.address: zły adres – podaj IP albo pełną nazwę hosta, np. abc.joinmc.link');
  if (address === zone || address.endsWith('.' + zone)) throw new ApiError(400, 'bad_target', `target.address: nie może wskazywać na inną nazwę w ${zone}`);
  if (/(^|\.)(localhost|local|internal|lan|home\.arpa|invalid|test|example|onion)$/.test(address)) throw new ApiError(400, 'private_address', 'Adresy lokalne są zablokowane.');
  return { type: 'CNAME', address, port };
}

// ---------------------------------------------------------------- signatures

const toHex = (buf) => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
const sha256hex = async (bytes) => toHex(await crypto.subtle.digest('SHA-256', bytes));
const unb64 = (s) => Uint8Array.from(atob(s), ch => ch.charCodeAt(0));

/** The string the launcher signs. Keep in sync with launcher/src/main/nore-domains.js. */
export async function canonical(op, name, hex, ts, target) {
  return `nore-domains/1|${op}|${name}|${hex}|${ts}|${await sha256hex(utf8.encode(JSON.stringify(target ?? null)))}`;
}

/** Checks { hex, pub, ts, sig } over the canonical string; returns { hex, ts } or 400 / 401. */
export async function verifySigned(op, name, b) {
  const { hex, pub, ts, sig } = b || {};
  if (typeof hex !== 'string' || !HEX.test(hex)) throw new ApiError(400, 'bad_signature', 'hex: Nore ID – 20 małych znaków hex');
  if (!Number.isSafeInteger(ts)) throw new ApiError(400, 'bad_signature', 'ts: czas w milisekundach');
  if (typeof pub !== 'string' || pub.length > 400 || typeof sig !== 'string' || sig.length > 200) throw new ApiError(400, 'bad_signature', 'Brak klucza (pub) albo podpisu (sig)');
  let pubDer, sigDer;
  try { pubDer = unb64(pub); sigDer = unb64(sig); } catch { throw new ApiError(400, 'bad_signature', 'pub i sig muszą być w base64'); }
  if ((await sha256hex(pubDer)).slice(0, 20) !== hex) throw new ApiError(401, 'bad_signature', 'Klucz nie pasuje do Nore ID');
  if (Math.abs(Date.now() - ts) >= LIMITS.clockMs) throw new ApiError(401, 'bad_clock', 'Zły czas żądania – sprawdź zegar komputera');
  let key;
  try { key = await crypto.subtle.importKey('spki', pubDer, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']); } catch { throw new ApiError(400, 'bad_signature', 'pub: to nie jest klucz P-256'); }
  const raw = derToP1363(sigDer);
  const text = utf8.encode(await canonical(op, name, hex, ts, b.target));
  if (!raw || !(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, raw, text))) throw new ApiError(401, 'bad_signature', 'Zły podpis Nore ID');
  return { hex, ts };
}

// ---------------------------------------------------------------- store + views

export function domainsStore(env) {
  if (!env.DOMAINS) throw new ApiError(503, 'unavailable', 'Domeny Nore są chwilowo niedostępne (brak powiązania DOMAINS)');
  return env.DOMAINS.get(env.DOMAINS.idFromName('global'));
}

export function publicView(d, zone, days) {
  if (!d) return null;
  const fqdn = `${d.name}.${zone}`;
  const target = d.type ? { type: d.type, address: d.address, port: d.port } : null;
  return {
    name: d.name, fqdn, address: fqdn, target, // port 25565 needs nothing, any other port gets the SRV record
    srv: !!(target && target.port !== 25565), state: d.state,
    createdAt: iso(d.created), updatedAt: iso(d.updated), refreshedAt: iso(d.refreshed), expiresAt: iso(d.refreshed + days * 86400000),
  };
}

const adminView = (d, zone, days, blocked) => ({ ...publicView(d, zone, days), owner: d.owner, error: d.error || null, records: d.records, blocked: !!blocked, by: d.by || null });

async function isBlocked(env, hex) {
  const a = adminStore(env);
  if (!a) return false;
  const hits = await a.blacklistCheck([['nore_id', hex]]);
  return hits.length > 0;
}

async function limitIp(env, ip) {
  if (env.DOMAIN_LIMIT && typeof env.DOMAIN_LIMIT.limit === 'function') {
    try { if (!(await env.DOMAIN_LIMIT.limit({ key: `dom:${ip}` })).success) throw new ApiError(429, 'rate_limited', 'Za dużo zmian domen z tego adresu – spróbuj za minutę', { retryAfter: 60 }); } catch (e) { if (e instanceof ApiError) throw e; }
  }
}

// ---------------------------------------------------------------- public routes

export function info(env) {
  return {
    zone: zoneOf(env), enabled: dnsConfigured(env) && !!env.DOMAINS,
    limits: { minLength: LIMITS.min, maxLength: LIMITS.max, perNoreId: perId(env), expiryDays: expiryDays(env) },
    rules: 'Małe litery a–z, cyfry i myślnik; bez myślnika na początku i końcu. Nazwa wygasa, jeśli serwer nie odświeży jej przez ' + expiryDays(env) + ' dni.',
    signature: 'nore-domains/1|<op>|<name>|<hex>|<ts>|sha256hex(JSON.stringify(target ?? null)) – ECDSA P-256 (DER, base64) kluczem Nore ID',
  };
}

/** GET /domains/:name – availability while typing + public lookup. */
export async function lookup(env, raw) {
  const zone = zoneOf(env);
  const c = checkName(decodeURIComponent(raw));
  const base = { name: c.name, fqdn: `${c.name}.${zone}`, enabled: dnsConfigured(env) };
  if (!c.valid) return { ...base, valid: false, available: false, reason: c.reason, message: c.message, domain: null };
  const r = await domainsStore(env).lookup(c.name);
  if (r.reserved) return { ...base, valid: true, available: false, reason: 'reserved', message: 'Ta nazwa jest zarezerwowana przez Nore.', domain: null };
  if (r.domain) return { ...base, valid: true, available: false, reason: 'taken', message: 'Ta nazwa jest już zajęta.', domain: publicView(r.domain, zone, expiryDays(env)) };
  return { ...base, valid: true, available: true, reason: null, message: null, domain: null };
}

function validName(raw) {
  const c = checkName(decodeURIComponent(raw));
  if (!c.valid) throw new ApiError(c.reason === 'invalid' ? 400 : 409, c.reason, c.message);
  return c.name;
}

/** POST / PUT / DELETE /domains/:name (signed). */
export async function write(request, env, method, raw) {
  requireDns(env);
  const ip = clientIp(request);
  await limitIp(env, ip);
  const name = validName(raw);
  const b = await readJson(request, 4096);
  const op = method === 'POST' ? 'claim' : method === 'PUT' ? 'update' : 'release';
  const { hex, ts } = await verifySigned(op, name, b);
  const zone = zoneOf(env);
  const target = op === 'release' ? null : cleanTarget(b.target, ip, zone);
  if (op === 'update' && !target) throw new ApiError(400, 'bad_target', 'target: { address, port } – dokąd ma wskazywać domena');
  if (op !== 'release' && await isBlocked(env, hex)) throw new ApiError(403, 'blocked', 'Ten Nore ID jest zablokowany – nie może zakładać ani zmieniać domen.');
  const S = domainsStore(env);
  const days = expiryDays(env);
  if (op === 'claim') {
    const r = unwrap(await S.claim({ name, hex, ts, ip, target, max: perId(env) }));
    return { status: r.created ? 201 : 200, body: { created: r.created, domain: publicView(r.domain, zone, days) } };
  }
  if (op === 'update') {
    const r = unwrap(await S.update({ name, hex, ts, ip, target }));
    return { body: { changed: r.changed, domain: publicView(r.domain, zone, days) } };
  }
  const r = unwrap(await S.release({ name, hex, ts }));
  return { body: { released: r.name } };
}

/** POST /domains/@mine (signed) – the caller's names. */
export async function mine(request, env) {
  const b = await readJson(request, 4096);
  const { hex, ts } = await verifySigned('mine', '', b);
  const r = unwrap(await domainsStore(env).mine({ hex, ts }));
  const zone = zoneOf(env), days = expiryDays(env);
  return { count: r.domains.length, max: perId(env), domains: r.domains.map(d => publicView(d, zone, days)) };
}

// ---------------------------------------------------------------- admin (/api/v2/admin/domains/…)

/** Official Nore MC record: SRV _minecraft._tcp.mc.<zone> → host:port (the website on mc.<zone> stays as is). */
function cleanOfficial(b, zone) {
  const host = typeof b.host === 'string' ? b.host.trim().toLowerCase().replace(/\.$/, '') : '';
  const port = b.port === undefined || b.port === null ? 25565 : b.port;
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new ApiError(400, 'bad_port', 'port: liczba od 1 do 65535');
  const kind = ipKind(host);
  if (kind) {
    if (isPrivateIp(host)) throw new ApiError(400, 'private_address', 'host: adres prywatny');
    return { host, port, type: kind === 4 ? 'A' : 'AAAA' };
  }
  if (!HOST.test(host)) throw new ApiError(400, 'bad_target', 'host: IP albo nazwa hosta serwera Minecraft');
  if (host === zone || host === `mc.${zone}` || host === `www.${zone}`) throw new ApiError(400, 'bad_target', `host: ${host} to strona WWW (proxy Cloudflare) – podaj adres serwera gry`);
  return { host, port, type: 'CNAME' };
}

export async function adminDomains({ request, env, m, q, rest, actor, audit }) {
  const S = domainsStore(env);
  const zone = zoneOf(env), days = expiryDays(env);
  const route = (method, re) => (m === method ? re.exec(rest) : null);
  let x;

  if ((x = route('GET', /^domains$/))) {
    const lim = Math.max(1, Math.min(500, parseInt(q.get('limit') || '200', 10) || 200));
    const list = await S.adminList({ q: q.get('q') || '', limit: lim });
    const a = adminStore(env);
    const bl = a ? new Set((await a.blacklist()).filter(e => e.kind === 'nore_id').map(e => e.value)) : new Set();
    const official = await S.official();
    return { count: list.domains.length, total: list.total, zone, enabled: dnsConfigured(env), limits: info(env).limits, official, domains: list.domains.map(d => adminView(d, zone, days, bl.has(d.owner))) };
  }
  if ((x = route('GET', /^domains\/reserved$/))) {
    const list = await S.reservedList();
    return { builtIn: [...RESERVED].sort(), count: list.length, reserved: list.map(r => ({ ...r, created: iso(r.created) })) };
  }
  if ((x = route('POST', /^domains\/reserved$/))) {
    const b = await readJson(request, 4096);
    const c = checkName(b.name);
    if (c.reason === 'invalid') throw new ApiError(400, 'invalid', c.message);
    const reason = typeof b.reason === 'string' ? b.reason.trim().slice(0, 300) : '';
    const r = await S.reserve(c.name, reason, actor);
    await audit('domains.reserve', c.name, { reason, taken: r.taken });
    return { status: 201, body: { reserved: c.name, taken: r.taken } };
  }
  if ((x = route('DELETE', /^domains\/reserved\/([a-z0-9-]{1,64})$/))) {
    const r = unwrap(await S.unreserve(x[1]));
    await audit('domains.unreserve', x[1], null);
    return { removed: r.name };
  }
  if ((x = route('GET', /^domains\/official$/))) return { official: await S.official(), zone, website: `https://mc.${zone}` };
  if ((x = route('PUT', /^domains\/official$/))) {
    requireDns(env);
    const o = cleanOfficial(await readJson(request, 4096), zone);
    const r = unwrap(await S.setOfficial(o, actor));
    await audit('domains.official', `mc.${zone}`, { host: o.host, port: o.port });
    return { official: r.official };
  }
  if ((x = route('DELETE', /^domains\/official$/))) {
    requireDns(env);
    const r = unwrap(await S.clearOfficial());
    await audit('domains.official.clear', `mc.${zone}`, null);
    return { official: r.official };
  }
  if ((x = route('POST', /^domains\/cleanup$/))) {
    requireDns(env);
    const b = request.headers.get('Content-Type') ? await readJson(request, 1024) : {};
    // a simulated clock is accepted only by test Workers
    const asOf = env.TEST_CLOCK === '1' && Number.isSafeInteger(b.asOf) ? b.asOf : Date.now();
    const r = await S.cleanup({ now: asOf, days, force: true });
    await audit('domains.cleanup', zone, r);
    return r;
  }
  if ((x = route('GET', /^domains\/([a-z0-9-]{1,64})$/))) {
    const r = await S.adminGet(x[1]);
    if (!r.domain) throw new ApiError(404, 'not_found', 'Nie ma takiej domeny');
    return { domain: adminView(r.domain, zone, days, await isBlocked(env, r.domain.owner)), reserved: r.reserved };
  }
  if ((x = route('DELETE', /^domains\/([a-z0-9-]{1,64})$/))) {
    requireDns(env);
    const b = request.headers.get('Content-Type') ? await readJson(request, 4096) : {};
    const reason = typeof b.reason === 'string' ? b.reason.trim().slice(0, 300) : '';
    const r = unwrap(await S.adminRevoke(x[1], { reserve: b.reserve === true, reason, by: actor }));
    await audit('domains.revoke', x[1], { owner: r.owner, reason, reserved: b.reserve === true });
    return { revoked: r.name, owner: r.owner, reserved: b.reserve === true };
  }
  if ((x = route('POST', /^domains\/([a-z0-9-]{1,64})\/transfer$/))) {
    const b = await readJson(request, 4096);
    const hex = String(b.noreId || '').toLowerCase().replace(/^nore/, '').replace(/[^0-9a-f]/g, '');
    if (!HEX.test(hex)) throw new ApiError(400, 'bad_value', 'noreId: Nore ID (NORE-XXXXX-… albo 20 znaków hex)');
    if (await isBlocked(env, hex)) throw new ApiError(409, 'blocked', 'Ten Nore ID jest na czarnej liście');
    const r = unwrap(await S.adminTransfer(x[1], hex, perId(env)));
    await audit('domains.transfer', x[1], { from: r.from, to: hex });
    return { domain: adminView(r.domain, zone, days, false), from: r.from };
  }
  throw new ApiError(404, 'not_found', 'Nie ma takiej ścieżki domen – zobacz docs/domains.md');
}

/** Cron: removes names nobody refreshed for expiryDays (at most once an hour, inside the object). */
export async function cronCleanup(env) {
  if (!env.DOMAINS || !dnsConfigured(env)) return null;
  return domainsStore(env).cleanup({ now: Date.now(), days: expiryDays(env), force: false });
}
