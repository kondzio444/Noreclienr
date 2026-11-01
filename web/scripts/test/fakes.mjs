// Fake upstreams for the web tests: GitHub releases, Discord (OAuth2 + REST), DNS-over-HTTPS and
// Minecraft servers (modern status protocol, legacy 0xFE only, and one that never answers) and the
// Cloudflare DNS API (zone records for the official Nore domains).
import http from 'node:http';
import net from 'node:net';

export const PNG_1PX = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

const asset = (id, name, size, downloads) => ({
  id, name, size, download_count: downloads, digest: `sha256:${String(id).padStart(64, '0')}`,
  browser_download_url: `https://github.com/kondzio444/Noreclienr/releases/download/v${name.match(/\d+\.\d+\.\d+/)?.[0] || '1.5.0'}/${name}`,
});

export const RELEASES = [
  {
    tag_name: 'v1.5.0', name: 'Nore 1.5.0', draft: false, prerelease: false, published_at: '2026-10-20T12:00:00Z',
    body: 'Nowości w 1.5.0', html_url: 'https://github.com/kondzio444/Noreclienr/releases/tag/v1.5.0',
    assets: [
      asset(1, 'NoreLauncher-Setup-1.5.0.exe', 90_000_000, 120),
      asset(2, 'NoreLauncher-1.5.0.AppImage', 110_000_000, 30),
      asset(3, 'NoreLauncher-1.5.0.dmg', 100_000_000, 15),
      asset(4, 'NoreLauncher-1.5.0-mac.zip', 99_000_000, 5),
      asset(5, 'noreclient-fabric-1.21.8.jar', 2_000_000, 40),
      // electron-updater feed files (no downloads, so API v1 counters are unchanged)
      asset(6, 'latest.yml', 350, 0),
      asset(7, 'NoreLauncher-Setup-1.5.0.exe.blockmap', 90_000, 0),
    ],
  },
  { tag_name: 'v1.6.0-beta.1', name: 'draft', draft: true, prerelease: true, published_at: null, body: '', html_url: '', assets: [] },
  {
    tag_name: 'v1.4.0', name: 'Nore 1.4.0', draft: false, prerelease: false, published_at: '2026-09-01T12:00:00Z',
    body: 'Starsze', html_url: 'https://github.com/kondzio444/Noreclienr/releases/tag/v1.4.0',
    assets: [asset(11, 'NoreLauncher-Setup-1.4.0.exe', 80_000_000, 300), asset(12, 'noreclient-fabric-1.21.8.jar', 1_900_000, 10)],
  },
];

export const LATEST_YML = 'version: 1.5.0\nfiles:\n  - url: NoreLauncher-Setup-1.5.0.exe\n    sha512: abc\n    size: 90000000\npath: NoreLauncher-Setup-1.5.0.exe\nsha512: abc\nreleaseDate: 2026-10-20T12:00:00.000Z\n';

export const DISCORD_USERS = {
  'code-alice': { token: 'tok-alice', user: { id: '111111111111111111', username: 'alice', global_name: 'Alice', avatar: 'abc' } },
  'code-bob': { token: 'tok-bob', user: { id: '222222222222222222', username: 'bob', global_name: null, avatar: null } },
};
export const GUILDS = {
  'tok-alice': [
    { id: '900000000000000001', name: 'Nore Polska', icon: 'i1', owner: false, permissions: String(0x20) },      // MANAGE_GUILD
    { id: '900000000000000002', name: 'Admins', icon: null, owner: false, permissions: String(0x8) },             // ADMINISTRATOR
    { id: '900000000000000003', name: 'Own', icon: null, owner: true, permissions: '0' },
    { id: '900000000000000004', name: 'Member only', icon: null, owner: false, permissions: String(0x400 | 0x800) },
  ],
  'tok-bob': [{ id: '900000000000000001', name: 'Nore Polska', icon: 'i1', owner: false, permissions: '0' }],
};

export const CF_TOKEN = 'cf-test-token-0123456789';
export const CF_ZONE = 'zone0123456789abcdef';

/** Cloudflare DNS records API (v4) on one zone; records the mutating calls. */
function fakeCloudflare() {
  let next = 1;
  const records = new Map();
  const calls = [];
  const add = (r) => { const id = `rec${String(next++).padStart(6, '0')}`; const rec = { id, ttl: 1, proxied: false, comment: null, ...r, created_on: new Date().toISOString() }; records.set(id, rec); return rec; };
  // what is already in the zone and must never be touched
  const seed = [
    add({ type: 'A', name: 'noreclient.pl', content: '192.0.2.1', proxied: true }),
    add({ type: 'AAAA', name: 'mc.noreclient.pl', content: '100::', proxied: true, comment: 'Worker custom domain' }),
    add({ type: 'AAAA', name: 'www.noreclient.pl', content: '100::', proxied: true }),
    add({ type: 'A', name: 'manual.noreclient.pl', content: '198.51.100.7' }),
    add({ type: 'TXT', name: '_minecraft._tcp.legacy.noreclient.pl', content: 'x' }),
  ].map(r => ({ ...r }));
  function handle(req, u, body, send) {
    if (req.headers.authorization !== `Bearer ${CF_TOKEN}`) return send(403, { success: false, errors: [{ code: 10000, message: 'Authentication error' }], result: null });
    const m = /^\/cf\/zones\/([^/]+)\/dns_records(?:\/([^/]+))?$/.exec(u.pathname);
    if (!m || m[1] !== CF_ZONE) return send(404, { success: false, errors: [{ code: 7003, message: 'Could not route' }], result: null });
    const id = m[2];
    const out = (status, result) => send(status, { success: true, errors: [], messages: [], result });
    const missing = () => send(404, { success: false, errors: [{ code: 81044, message: 'Record does not exist.' }], result: null });
    let b = null;
    if (body) { try { b = JSON.parse(body); } catch { return send(400, { success: false, errors: [{ code: 9207, message: 'bad json' }] }); } }
    const valid = (r) => {
      if (!['A', 'AAAA', 'CNAME', 'SRV', 'TXT'].includes(r.type) || !r.name) return 'type/name';
      if (r.type === 'SRV' ? !(r.data && r.data.port && r.data.target) : !r.content) return 'content';
      if (r.type !== 'SRV' && r.proxied !== false) return 'proxied must be false';
      // CNAME may not share its name with any other record
      const same = [...records.values()].filter(x => x.name === r.name && x.id !== r.id);
      if (r.type === 'CNAME' ? same.length : same.some(x => x.type === 'CNAME')) return 'conflict with CNAME';
      return null;
    };
    if (req.method === 'GET' && !id) {
      const list = [...records.values()].filter(r => (!u.searchParams.get('name') || r.name === u.searchParams.get('name')) && (!u.searchParams.get('type') || r.type === u.searchParams.get('type')));
      return out(200, list);
    }
    if (req.method === 'GET') return records.has(id) ? out(200, records.get(id)) : missing();
    calls.push({ method: req.method, id: id || null, body: b });
    if (req.method === 'POST' && !id) {
      const why = valid(b);
      if (why) return send(400, { success: false, errors: [{ code: 81057, message: why }], result: null });
      return out(200, add(b));
    }
    if (!records.has(id)) return missing();
    if (req.method === 'DELETE') { records.delete(id); return out(200, { id }); }
    if (req.method === 'PATCH' || req.method === 'PUT') {
      const rec = { ...records.get(id), ...b, id };
      const why = valid(rec);
      if (why) return send(400, { success: false, errors: [{ code: 81057, message: why }], result: null });
      records.set(id, rec);
      return out(200, rec);
    }
    return send(405, { success: false, errors: [{ code: 10405, message: 'method' }] });
  }
  return { records, calls, seed, handle, byName: (name) => [...records.values()].filter(r => r.name === name) };
}

export function startHttpFakes(port) {
  const cf = fakeCloudflare();
  const calls = { token: 0, me: 0, guilds: 0, github: 0, doh: 0, lastToken: null, assetAuth: [], ghPaths: [] };
  const dns = new Map(); // `${name}|${type}` → answers [{ type, data }]
  const send = (res, status, body, headers = {}) => { res.writeHead(status, { 'Content-Type': 'application/json', ...headers }); res.end(JSON.stringify(body)); };
  const server = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x');
    let body = '';
    for await (const c of req) body += c;
    if (u.pathname === '/github/repos/kondzio444/Noreclienr/releases') { calls.github++; return send(res, 200, RELEASES); }
    const gh = u.pathname.startsWith('/github/repos/kondzio444/Noreclienr') ? u.pathname.slice('/github/repos/kondzio444/Noreclienr'.length) : null;
    if (gh !== null) {
      calls.ghPaths.push(gh + u.search);
      const am = /^\/releases\/assets\/(\d+)$/.exec(gh);
      if (am) {
        calls.assetAuth.push(req.headers.authorization || null);
        const a = RELEASES.flatMap(r => r.assets).find(x => String(x.id) === am[1]);
        if (!a || req.headers.accept !== 'application/octet-stream') return send(res, 404, { message: 'Not Found' });
        if (a.name.endsWith('.yml')) { res.writeHead(200, { 'Content-Type': 'application/octet-stream' }); return res.end(LATEST_YML); }
        res.writeHead(302, { Location: `https://objects.githubusercontent.example/signed/${a.id}/${a.name}?sig=x` }); return res.end();
      }
      if (gh === '') return send(res, 200, { full_name: 'kondzio444/Noreclienr', private: false, default_branch: 'main', html_url: 'https://github.com/kondzio444/Noreclienr', pushed_at: '2026-10-29T10:00:00Z', open_issues_count: 3, stargazers_count: 42 });
      if (gh === '/commits') return send(res, 200, [1, 2, 3].map(n => ({ sha: `abc${n}def`.padEnd(40, '0'), html_url: `https://github.com/kondzio444/Noreclienr/commit/abc${n}`, commit: { message: `Commit ${n}\n\nszczegóły`, author: { name: 'kondzio444', date: `2026-10-2${n}T10:00:00Z` } } })));
      if (gh === '/branches') return send(res, 200, [{ name: 'main', commit: { sha: 'abc1' }, protected: true }, { name: 'dev', commit: { sha: 'abc2' }, protected: false }]);
      if (gh === '/actions/runs') return send(res, 200, { total_count: 1, workflow_runs: [{ id: 77, name: 'Build', head_branch: 'main', event: 'push', status: 'completed', conclusion: 'success', head_sha: 'abc1def', created_at: '2026-10-29T10:00:00Z', html_url: 'https://github.com/kondzio444/Noreclienr/actions/runs/77', display_title: 'Commit 1' }] });
      if (gh === '/pulls') return send(res, 200, [{ number: 5, title: 'Nowa szatnia', user: { login: 'kondzio444' }, head: { ref: 'dev' }, created_at: '2026-10-28T10:00:00Z', html_url: 'https://github.com/kondzio444/Noreclienr/pull/5', draft: false }]);
    }
    if (u.pathname === '/discord/oauth2/token' && req.method === 'POST') {
      calls.token++;
      const f = new URLSearchParams(body);
      calls.lastToken = Object.fromEntries(f);
      const known = DISCORD_USERS[f.get('code')];
      if (f.get('client_id') !== 'test-client' || f.get('client_secret') !== 'test-client-secret' || f.get('grant_type') !== 'authorization_code' || !known || !f.get('redirect_uri')) {
        return send(res, 400, { error: 'invalid_grant' });
      }
      return send(res, 200, { access_token: known.token, token_type: 'Bearer', expires_in: 604800, refresh_token: 'r-' + known.token, scope: 'identify guilds' });
    }
    const auth = (req.headers.authorization || '').replace(/^Bearer /, '');
    const who = Object.values(DISCORD_USERS).find(x => x.token === auth);
    if (u.pathname === '/discord/users/@me') { calls.me++; return who ? send(res, 200, who.user) : send(res, 401, { message: '401: Unauthorized' }); }
    if (u.pathname === '/discord/users/@me/guilds') { calls.guilds++; return who ? send(res, 200, GUILDS[auth]) : send(res, 401, { message: '401: Unauthorized' }); }
    if (u.pathname.startsWith('/cf/')) return cf.handle(req, u, body, (status, b) => send(res, status, b));
    if (u.pathname === '/doh') {
      calls.doh++;
      const name = (u.searchParams.get('name') || '').replace(/\.$/, '').toLowerCase();
      const type = u.searchParams.get('type');
      const ans = dns.get(`${name}|${type}`);
      const TYPES = { A: 1, AAAA: 28, SRV: 33, CNAME: 5 };
      return send(res, 200, { Status: ans ? 0 : 3, Answer: (ans || []).map(a => ({ name, type: TYPES[a.type || type], TTL: 60, data: a.data })) }, { 'Content-Type': 'application/dns-json' });
    }
    send(res, 404, { message: 'fake: no route ' + u.pathname });
  });
  return new Promise(r => server.listen(port, '127.0.0.1', () => r({ server, calls, dns, cf })));
}

// ---------------------------------------------------------------- Minecraft

function varint(n) {
  const out = [];
  n >>>= 0;
  do { let b = n & 0x7f; n >>>= 7; if (n) b |= 0x80; out.push(b); } while (n);
  return Buffer.from(out);
}
function readVarint(buf, at) {
  let n = 0, shift = 0, i = at;
  for (;;) {
    if (i >= buf.length) return null;
    const b = buf[i++];
    n |= (b & 0x7f) << shift;
    if (!(b & 0x80)) return [n, i];
    shift += 7;
    if (shift > 35) throw new Error('varint');
  }
}
const packet = (id, payload) => { const body = Buffer.concat([varint(id), payload]); return Buffer.concat([varint(body.length), body]); };
const mcString = (s) => { const b = Buffer.from(s, 'utf8'); return Buffer.concat([varint(b.length), b]); };

export const MODERN_STATUS = {
  version: { name: 'Paper 1.21.8', protocol: 772 },
  players: { max: 100, online: 7, sample: [{ name: 'Steve_PL', id: '0123456789abcdef0123456789abcdef' }, { name: 'Alex', id: 'fedcba9876543210fedcba9876543210' }] },
  description: { text: '', extra: [{ text: 'Nore ', color: 'light_purple', bold: true }, { text: 'Serwer\n', color: 'gray' }, { text: '§aDruga linia' }] },
  favicon: 'data:image/png;base64,' + PNG_1PX,
  enforcesSecureChat: true,
};

/** Modern status server; records the handshakes it saw. */
export function startModernMc(port, status = MODERN_STATUS) {
  const seen = [];
  const server = net.createServer((sock) => {
    let buf = Buffer.alloc(0);
    sock.on('error', () => {});
    sock.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      for (;;) {
        const len = readVarint(buf, 0);
        if (!len || buf.length < len[1] + len[0]) return;
        const body = buf.subarray(len[1], len[1] + len[0]);
        buf = buf.subarray(len[1] + len[0]);
        const [id, at] = readVarint(body, 0);
        if (id === 0 && body.length > 1) {
          const [proto, a1] = readVarint(body, at);
          const [hl, a2] = readVarint(body, a1);
          seen.push({ proto: proto | 0, host: body.subarray(a2, a2 + hl).toString('utf8'), port: body.readUInt16BE(a2 + hl), next: body[a2 + hl + 2] });
        } else if (id === 0) {
          sock.write(packet(0, mcString(JSON.stringify(status))));
        } else if (id === 1) {
          setTimeout(() => sock.write(packet(1, body.subarray(at, at + 8))), 3);
        }
      }
    });
  });
  return new Promise(r => server.listen(port, '127.0.0.1', () => r({ server, seen })));
}

/** Pre-1.7 server: answers only the 0xFE 0x01 legacy ping, closes on anything else. */
export function startLegacyMc(port) {
  const server = net.createServer((sock) => {
    sock.on('error', () => {});
    sock.once('data', (d) => {
      if (d[0] !== 0xfe) return sock.destroy();
      const text = ['§1', '61', '1.5.2', 'Stary serwer §cNore', '3', '20'].join('\u0000');
      const utf16 = Buffer.from(text, 'utf16le').swap16();
      const len = Buffer.alloc(2); len.writeUInt16BE(text.length);
      sock.end(Buffer.concat([Buffer.from([0xff]), len, utf16]));
    });
  });
  return new Promise(r => server.listen(port, '127.0.0.1', () => r({ server })));
}

/** Accepts the connection and never answers (timeouts). */
export function startSilentMc(port) {
  const socks = new Set();
  const server = net.createServer((s) => { socks.add(s); s.on('error', () => {}); });
  server.closeAll = () => { for (const s of socks) s.destroy(); server.close(); };
  return new Promise(r => server.listen(port, '127.0.0.1', () => r({ server })));
}
