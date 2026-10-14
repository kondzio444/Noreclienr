'use strict';
/*
 * Making a local server reachable from the internet: public / LAN addresses, automatic port
 * forwarding (UPnP IGD with NAT-PMP as a fallback), CGNAT detection, the Windows firewall, a full
 * connection diagnosis and domain binding (DuckDNS, No-IP, Dynu, Cloudflare or manual DNS records).
 */
const os = require('os');
const fs = require('fs');
const path = require('path');
const http = require('http');
const dgram = require('dgram');
const dns = require('dns');
const tcp = require('net');
const { execFile } = require('child_process');
const net = require('./net');

// ------------------------------------------------------------------ addresses

/** Interfaces of VPNs / virtual machines – never the address the router forwards to. */
const VIRTUAL = /vmware|virtualbox|vbox|hyper-v|vethernet|docker|wsl|tailscale|zerotier|hamachi|radmin|wireguard|nordlynx|tun|tap|utun|loopback|bluetooth/i;

function lanAddresses() {
  const out = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const a of list || []) {
      if (a.family === 'IPv4' && !a.internal && !a.address.startsWith('169.254.')) out.push({ name, address: a.address, netmask: a.netmask, virtual: VIRTUAL.test(name) });
    }
  }
  return out.sort((a, b) => a.virtual - b.virtual);
}

function ipToInt(ip) { return ip.split('.').reduce((n, p) => (n << 8) + (+p), 0) >>> 0; }

function sameSubnet(a, b, mask) {
  try { return (ipToInt(a) & ipToInt(mask)) === (ipToInt(b) & ipToInt(mask)); } catch { return false; }
}

/** Private, shared (CGNAT 100.64/10) or otherwise not publicly routable IPv4. */
function isPrivateIp(ip) {
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(ip || '')) return false;
  const [a, b] = ip.split('.').map(Number);
  return a === 10 || a === 127 || (a === 172 && b >= 16 && b < 32) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b < 128) || (a === 169 && b === 254);
}

function isCgnatIp(ip) {
  const [a, b] = String(ip).split('.').map(Number);
  return a === 100 && b >= 64 && b < 128;
}

async function publicIp() {
  for (const url of ['https://api.ipify.org?format=json', 'https://api4.my-ip.io/v2/ip.json', 'https://ipv4.icanhazip.com']) {
    try {
      const res = await net.fetchWithRetry(url, {}, 2);
      const text = (await res.text()).trim();
      const ip = text.startsWith('{') ? JSON.parse(text).ip : text;
      if (/^\d+\.\d+\.\d+\.\d+$/.test(ip)) return ip;
    } catch { /* try the next service */ }
  }
  throw new Error('Nie udało się ustalić publicznego IP (brak internetu?)');
}

function run(cmd, args, timeout = 6000) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout, windowsHide: true }, (e, out) => resolve(e ? '' : String(out || '')));
  });
}

/** IPv4 of the default gateway (the router), read from the OS routing table. */
async function defaultGateway() {
  try {
    if (process.platform === 'linux') {
      for (const l of fs.readFileSync('/proc/net/route', 'utf8').split('\n').slice(1)) {
        const f = l.trim().split(/\s+/);
        if (f[1] === '00000000' && f[2] && f[2] !== '00000000') {
          const h = f[2];
          return [6, 4, 2, 0].map(i => parseInt(h.slice(i, i + 2), 16)).join('.');
        }
      }
    } else if (process.platform === 'win32') {
      const out = await run('route', ['print', '-4', '0.0.0.0']);
      const rows = [...out.matchAll(/^\s*0\.0\.0\.0\s+0\.0\.0\.0\s+(\d+\.\d+\.\d+\.\d+)\s+(\d+\.\d+\.\d+\.\d+)\s+(\d+)/gm)]
        .map(m => ({ gw: m[1], iface: m[2], metric: +m[3] })).filter(r => !VIRTUAL.test(r.iface));
      rows.sort((a, b) => a.metric - b.metric);
      if (rows[0]) return rows[0].gw;
    } else {
      const out = await run('route', ['-n', 'get', 'default']);
      const m = /gateway:\s*(\d+\.\d+\.\d+\.\d+)/.exec(out);
      if (m) return m[1];
    }
  } catch { /* fall back to a guess */ }
  const lan = lanAddresses().find(a => !a.virtual);
  return lan ? lan.address.split('.').slice(0, 3).join('.') + '.1' : null;
}

/** The LAN address in the router's subnet (the one port forwarding must point to). */
function localAddressFor(gatewayHost) {
  const lan = lanAddresses();
  const hit = lan.find(a => sameSubnet(a.address, gatewayHost, a.netmask))
    || lan.find(a => a.address.split('.').slice(0, 3).join('.') === String(gatewayHost).split('.').slice(0, 3).join('.'));
  return (hit || lan.find(a => !a.virtual) || lan[0] || {}).address;
}

/** Asks an outside service (mcsrvstat.us) whether the server answers from the internet. */
async function checkReachable(host, port) {
  const target = port && Number(port) !== 25565 ? `${host}:${port}` : host;
  const j = await net.getJson(`https://api.mcsrvstat.us/3/${encodeURIComponent(target)}`);
  return {
    online: !!j.online,
    ip: j.ip, port: j.port,
    players: j.players ? { online: j.players.online, max: j.players.max } : null,
    version: j.version || null,
    motd: j.motd && j.motd.clean ? j.motd.clean.join('\n') : null,
    srv: !!(j.debug && j.debug.srv),
    cached: !!(j.debug && j.debug.cachehit),
  };
}

/** True when something accepts TCP connections on host:port. */
function portOpen(host, port, timeout = 2500) {
  return new Promise((resolve) => {
    const s = tcp.connect({ host, port: Number(port) });
    const done = (ok) => { s.destroy(); resolve(ok); };
    s.setTimeout(timeout, () => done(false));
    s.once('connect', () => done(true));
    s.once('error', () => done(false));
  });
}

// ------------------------------------------------------------------ UPnP (Internet Gateway Device)

/**
 * One HTTP request on a fresh connection. Routers' tiny web servers often drop kept-alive
 * sockets, which used to surface as "socket hang up" – so no agent, Connection: close and a retry.
 */
function httpRequestOnce(url, { method = 'GET', headers = {}, body, timeout = 6000 } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method, agent: false, headers: { Connection: 'close', 'User-Agent': 'NoreLauncher UPnP/1.1', ...headers }, timeout }, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (d) => { data += d; });
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function httpRequest(url, opts) {
  let last;
  for (let i = 0; i < 3; i++) {
    try { return await httpRequestOnce(url, opts); } catch (e) {
      last = e;
      if (!/hang up|ECONNRESET|EPIPE|timeout|ECONNREFUSED/i.test(e.message || e.code)) break;
      await new Promise(r => setTimeout(r, 350 * (i + 1)));
    }
  }
  throw last;
}

const testLocations = []; // filled by tests (no multicast in CI containers)

const SEARCH_TARGETS = [
  'urn:schemas-upnp-org:device:InternetGatewayDevice:1', 'urn:schemas-upnp-org:device:InternetGatewayDevice:2',
  'urn:schemas-upnp-org:service:WANIPConnection:1', 'urn:schemas-upnp-org:service:WANIPConnection:2',
  'urn:schemas-upnp-org:service:WANPPPConnection:1',
];

/** SSDP discovery sent from every LAN interface (VPN / VM adapters often hijack multicast). */
function discoverGateways(timeoutMs = 3000) {
  return new Promise((resolve) => {
    const found = new Map(); // location -> responder address
    const sockets = [];
    const binds = [null, ...lanAddresses().map(a => a.address)];
    for (const addr of binds) {
      const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
      sockets.push(sock);
      sock.on('message', (m, rinfo) => {
        const loc = /^location:\s*(\S+)/im.exec(m.toString());
        if (loc && !found.has(loc[1])) found.set(loc[1], rinfo.address);
      });
      sock.on('error', () => { /* interface without multicast */ });
      try {
        sock.bind(addr ? { address: addr, port: 0 } : 0, () => {
          for (const st of SEARCH_TARGETS) {
            const msg = Buffer.from(['M-SEARCH * HTTP/1.1', 'HOST: 239.255.255.250:1900', 'MAN: "ssdp:discover"', 'MX: 2', `ST: ${st}`, '', ''].join('\r\n'));
            try { sock.send(msg, 1900, '239.255.255.250'); } catch { /* closed */ }
          }
        });
      } catch { /* cannot bind to this address */ }
    }
    setTimeout(() => {
      for (const l of testLocations) found.set(l, '127.0.0.1');
      for (const s of sockets) { try { s.close(); } catch { /* closed */ } }
      resolve([...found].map(([location, from]) => ({ location, from })));
    }, timeoutMs);
  });
}

const WAN_TYPES = ['urn:schemas-upnp-org:service:WANIPConnection:2', 'urn:schemas-upnp-org:service:WANIPConnection:1', 'urn:schemas-upnp-org:service:WANPPPConnection:1'];

/** All WAN connection services of the routers that answered, the default gateway first. */
async function gatewayServices() {
  const [gateway, found] = await Promise.all([defaultGateway(), discoverGateways()]);
  found.sort((a, b) => (new URL(b.location).hostname === gateway) - (new URL(a.location).hostname === gateway));
  const services = [];
  for (const { location } of found) {
    try {
      const { body } = await httpRequest(location);
      for (const block of body.split(/<service>/i).slice(1)) {
        const type = (/<serviceType>\s*([^<]+?)\s*<\/serviceType>/i.exec(block) || [])[1];
        const ctl = (/<controlURL>\s*([^<]+?)\s*<\/controlURL>/i.exec(block) || [])[1];
        if (!type || !ctl || !WAN_TYPES.includes(type)) continue;
        const base = (/<URLBase>\s*([^<]+?)\s*<\/URLBase>/i.exec(body) || [])[1] || location;
        services.push({ url: new URL(ctl, base).toString(), type, host: new URL(location).hostname, location });
      }
    } catch { /* unreachable device description */ }
  }
  services.sort((a, b) => WAN_TYPES.indexOf(a.type) - WAN_TYPES.indexOf(b.type));
  return { gateway, services };
}

const UPNP_ERRORS = {
  402: 'router odrzucił parametry',
  501: 'router nie wykonał polecenia (UPnP może być w trybie tylko do odczytu)',
  606: 'router nie pozwala programom zmieniać przekierowań – włącz „Zezwalaj na zmiany” / „UPnP: pełny dostęp”',
  714: 'brak takiego przekierowania',
  715: 'router nie obsługuje symboli wieloznacznych',
  716: 'router nie obsługuje symboli wieloznacznych',
  718: 'port jest już przekierowany na inne urządzenie',
  724: 'router wymaga tego samego portu wewnętrznego i zewnętrznego',
  725: 'router obsługuje tylko stałe przekierowania',
  726: 'router nie obsługuje dowolnego zdalnego hosta',
  727: 'router nie obsługuje dowolnego portu zewnętrznego',
  728: 'tablica przekierowań w routerze jest pełna',
};

class UpnpError extends Error {
  constructor(code, text, action) {
    super(`UPnP ${action}: ${UPNP_ERRORS[code] || text || 'błąd ' + code}${code ? ` (kod ${code})` : ''}`);
    this.code = code;
  }
}

async function soap(svc, action, args = {}) {
  const params = Object.entries(args).map(([k, v]) => `<${k}>${v}</${k}>`).join('');
  const body = `<?xml version="1.0" encoding="utf-8"?>\r\n<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body><u:${action} xmlns:u="${svc.type}">${params}</u:${action}></s:Body></s:Envelope>\r\n`;
  const res = await httpRequest(svc.url, {
    method: 'POST', body,
    headers: { 'Content-Type': 'text/xml; charset="utf-8"', SOAPAction: `"${svc.type}#${action}"`, 'Content-Length': Buffer.byteLength(body) },
  });
  if (res.status !== 200) {
    const code = parseInt((/<errorCode>\s*(\d+)/i.exec(res.body) || [])[1], 10) || 0;
    const text = (/<errorDescription>([^<]+)</i.exec(res.body) || [])[1];
    throw new UpnpError(code, text || `HTTP ${res.status}`, action);
  }
  return res.body;
}

function tag(xml, name) { return (new RegExp(`<${name}>([^<]*)<`, 'i').exec(xml) || [])[1]; }

async function addMapping(svc, port, proto, client, description) {
  const args = (lease) => ({
    NewRemoteHost: '', NewExternalPort: port, NewProtocol: proto, NewInternalPort: port,
    NewInternalClient: client, NewEnabled: 1, NewPortMappingDescription: description, NewLeaseDuration: lease,
  });
  try {
    await soap(svc, 'AddPortMapping', args(0));
  } catch (e) {
    if (e.code === 718) {
      // our own stale entry (different IP after DHCP) or another device: replace it
      try { await soap(svc, 'DeletePortMapping', { NewRemoteHost: '', NewExternalPort: port, NewProtocol: proto }); } catch { /* not ours */ }
      return soap(svc, 'AddPortMapping', args(0));
    }
    if (e.code === 725) throw e;
    // some routers refuse permanent leases – ask for a week (renewed at every server start)
    await soap(svc, 'AddPortMapping', args(604800));
  }
}

async function upnpOpen(port, description = 'Nore Server') {
  const { gateway, services } = await gatewayServices();
  const errors = [];
  for (const svc of services) {
    const client = localAddressFor(svc.host);
    try {
      await addMapping(svc, port, 'TCP', client, description);
      await addMapping(svc, port, 'UDP', client, description).catch(() => {}); // UDP is only for query
      let external = null;
      try { external = tag(await soap(svc, 'GetExternalIPAddress'), 'NewExternalIPAddress') || null; } catch { /* optional */ }
      let verified = null;
      try {
        const entry = await soap(svc, 'GetSpecificPortMappingEntry', { NewRemoteHost: '', NewExternalPort: port, NewProtocol: 'TCP' });
        verified = tag(entry, 'NewInternalClient') === client;
      } catch { /* not supported by every router */ }
      return { method: 'upnp', router: svc.host, client, external, verified, cgnat: external ? isPrivateIp(external) : false };
    } catch (e) { errors.push(e.message); }
  }
  // NAT-PMP / PCP (Apple, MikroTik, many OpenWrt / ISP boxes)
  if (gateway) {
    try {
      const r = await natpmpMap(gateway, port, 7200);
      return { method: 'natpmp', router: gateway, client: localAddressFor(gateway), external: r.external, lifetime: r.lifetime, verified: true, cgnat: r.external ? isPrivateIp(r.external) : false };
    } catch (e) { errors.push('NAT-PMP: ' + e.message); }
  }
  if (!services.length) {
    throw new Error(`Router${gateway ? ` (${gateway})` : ''} nie odpowiada na UPnP ani NAT-PMP. Włącz UPnP w panelu routera albo przekieruj port ${port} ręcznie – lub użyj tunelu playit.gg.`);
  }
  throw new Error(errors[0] || 'Nie udało się otworzyć portu.');
}

async function upnpClose(port) {
  const { gateway, services } = await gatewayServices();
  for (const svc of services) {
    for (const proto of ['TCP', 'UDP']) {
      try { await soap(svc, 'DeletePortMapping', { NewRemoteHost: '', NewExternalPort: port, NewProtocol: proto }); } catch { /* not mapped */ }
    }
  }
  if (gateway) await natpmpMap(gateway, port, 0).catch(() => {});
  return true;
}

/** Router status for the diagnosis: UPnP / NAT-PMP support, external IP, our mapping. */
async function routerInfo(port) {
  const { gateway, services } = await gatewayServices();
  const out = { gateway, upnp: services.length > 0, natpmp: false, external: null, mapping: null };
  for (const svc of services) {
    try { out.external = out.external || tag(await soap(svc, 'GetExternalIPAddress'), 'NewExternalIPAddress') || null; } catch { /* optional */ }
    try {
      const entry = await soap(svc, 'GetSpecificPortMappingEntry', { NewRemoteHost: '', NewExternalPort: port, NewProtocol: 'TCP' });
      out.mapping = { client: tag(entry, 'NewInternalClient'), port: tag(entry, 'NewInternalPort'), enabled: tag(entry, 'NewEnabled') !== '0' };
    } catch { /* no mapping */ }
    if (out.external) break;
  }
  if (!out.upnp && gateway) {
    try { out.external = await natpmpExternal(gateway); out.natpmp = true; } catch { /* no NAT-PMP */ }
  }
  return out;
}

// ------------------------------------------------------------------ NAT-PMP (RFC 6886)

function natpmpRequest(gateway, msg, expectOp) {
  return new Promise((resolve, reject) => {
    const sock = dgram.createSocket('udp4');
    let tries = 0, timer;
    const finish = (err, val) => { clearTimeout(timer); try { sock.close(); } catch { /* closed */ } err ? reject(err) : resolve(val); };
    sock.on('message', (m) => {
      if (m.length < 8 || m[1] !== expectOp) return;
      const result = m.readUInt16BE(2);
      if (result !== 0) return finish(new Error(['', 'nieobsługiwana wersja', 'brak uprawnień', 'błąd sieci', 'brak zasobów', 'nieobsługiwana operacja'][result] || `kod ${result}`));
      finish(null, m);
    });
    sock.on('error', (e) => finish(e));
    const send = () => {
      if (tries++ >= 4) return finish(new Error('router nie odpowiada'));
      sock.send(msg, 5351, gateway, () => {});
      timer = setTimeout(send, 250 * 2 ** tries);
    };
    sock.bind(0, send);
  });
}

async function natpmpExternal(gateway) {
  const m = await natpmpRequest(gateway, Buffer.from([0, 0]), 128);
  return [8, 9, 10, 11].map(i => m[i]).join('.');
}

/** Maps TCP + UDP port → port for lifetime seconds (0 removes the mapping). */
async function natpmpMap(gateway, port, lifetime) {
  let granted = lifetime;
  for (const op of [2, 1]) {
    const msg = Buffer.alloc(12);
    msg[0] = 0; msg[1] = op;
    msg.writeUInt16BE(port, 4); msg.writeUInt16BE(lifetime ? port : 0, 6); msg.writeUInt32BE(lifetime, 8);
    const r = await natpmpRequest(gateway, msg, 128 + op);
    if (op === 2) granted = r.readUInt32BE(12);
  }
  const external = lifetime ? await natpmpExternal(gateway).catch(() => null) : null;
  return { external, lifetime: granted };
}

// ------------------------------------------------------------------ Windows firewall

const ruleName = (port) => `Nore Server ${port}`;

async function firewallStatus(port) {
  if (process.platform !== 'win32') return { supported: false };
  const out = await run('netsh', ['advfirewall', 'firewall', 'show', 'rule', `name=${ruleName(port)}`]);
  return { supported: true, rule: out.includes(ruleName(port)) };
}

/** Adds inbound TCP + UDP rules for the port (asks for administrator rights once). */
async function firewallAllow(port) {
  if (process.platform !== 'win32') throw new Error('Zapora jest ustawiana tylko na Windows.');
  const script = path.join(os.tmpdir(), `nore-firewall-${port}.cmd`);
  const name = ruleName(port);
  fs.writeFileSync(script, [
    '@echo off',
    `netsh advfirewall firewall delete rule name="${name}" >nul 2>&1`,
    `netsh advfirewall firewall add rule name="${name}" dir=in action=allow protocol=TCP localport=${port} profile=any`,
    `netsh advfirewall firewall add rule name="${name}" dir=in action=allow protocol=UDP localport=${port} profile=any`,
  ].join('\r\n'));
  await new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command',
      `Start-Process -FilePath 'cmd.exe' -ArgumentList '/c ""${script.replace(/'/g, "''")}""' -Verb RunAs -WindowStyle Hidden -Wait`],
    { windowsHide: true, timeout: 120000 }, (e) => (e ? reject(new Error('Nie dodano reguły – potrzebna zgoda administratora.')) : resolve()));
  });
  fs.rmSync(script, { force: true });
  const st = await firewallStatus(port);
  if (!st.rule) throw new Error('Reguła zapory nie została dodana (odmówiono uprawnień?).');
  return true;
}

// ------------------------------------------------------------------ domains

/** Resolves through public resolvers so a stale local cache does not hide a fresh record. */
async function dnsCheck(host, port) {
  const r = new dns.promises.Resolver({ timeout: 4000, tries: 2 });
  r.setServers(['1.1.1.1', '8.8.8.8']);
  const out = { host, a: [], srv: null };
  try { out.a = await r.resolve4(host); } catch (e) { out.error = e.code === 'ENOTFOUND' || e.code === 'ENODATA' ? 'brak rekordu A' : e.code || e.message; }
  try {
    const srv = await r.resolveSrv(`_minecraft._tcp.${host}`);
    if (srv[0]) out.srv = { target: srv[0].name, port: srv[0].port };
  } catch { /* no SRV */ }
  if (out.srv && port && out.srv.port !== Number(port)) out.srvWrongPort = true;
  return out;
}

/** DuckDNS: free <name>.duckdns.org subdomain pointed at the current public IP. */
async function duckdnsUpdate(subdomain, token, ip) {
  const name = String(subdomain).replace(/\.duckdns\.org$/i, '').trim();
  const url = `https://www.duckdns.org/update?domains=${encodeURIComponent(name)}&token=${encodeURIComponent(token)}&ip=${encodeURIComponent(ip || '')}&verbose=true`;
  const res = await net.fetchWithRetry(url, {}, 2);
  const text = (await res.text()).trim();
  if (!text.startsWith('OK')) throw new Error('DuckDNS odrzucił aktualizację – sprawdź subdomenę (bez .duckdns.org) i token.');
  return `${name}.duckdns.org`;
}

const DYNDNS = {
  noip: { url: 'https://dynupdate.no-ip.com/nic/update', label: 'No-IP' },
  dynu: { url: 'https://api.dynu.com/nic/update', label: 'Dynu' },
};
const DYNDNS_ERRORS = {
  badauth: 'zły login lub hasło', nohost: 'nie ma takiej nazwy hosta na koncie', notfqdn: 'podaj pełną nazwę hosta',
  abuse: 'konto zablokowane za nadużycia', '!donator': 'funkcja wymaga płatnego konta', badagent: 'odrzucono klienta', 911: 'awaria po stronie dostawcy – spróbuj później',
};

/** No-IP and Dynu speak the dyndns2 protocol: basic auth + hostname + IP. */
async function dyndnsUpdate(provider, hostname, user, password, ip) {
  const p = DYNDNS[provider];
  const url = `${p.url}?hostname=${encodeURIComponent(hostname)}&myip=${encodeURIComponent(ip)}`;
  const res = await net.fetchWithRetry(url, { headers: { Authorization: 'Basic ' + Buffer.from(`${user}:${password}`).toString('base64') } }, 2);
  const text = (await res.text()).trim();
  const code = text.split(/\s+/)[0];
  if (code === 'good' || code === 'nochg') return hostname;
  throw new Error(`${p.label}: ${DYNDNS_ERRORS[code] || text || 'HTTP ' + res.status}`);
}

/**
 * Cloudflare: creates or updates an A record (DNS only, not proxied) for the hostname and,
 * when the port is not 25565, a _minecraft._tcp SRV record so players do not type the port.
 */
async function cloudflareUpdate({ token, hostname, ip, port }) {
  const api = 'https://api.cloudflare.com/client/v4';
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const call = async (url, opts = {}) => {
    const res = await net.fetchWithRetry(url, { ...opts, headers }, 2);
    const j = await res.json();
    if (!j.success) throw new Error('Cloudflare: ' + ((j.errors && j.errors[0] && j.errors[0].message) || 'błąd API'));
    return j.result;
  };
  const host = hostname.toLowerCase().replace(/\.$/, '');
  const parts = host.split('.');
  let zone = null;
  for (let i = 0; i < parts.length - 1 && !zone; i++) {
    const name = parts.slice(i).join('.');
    const zones = await call(`${api}/zones?name=${encodeURIComponent(name)}`);
    if (zones.length) zone = zones[0];
  }
  if (!zone) throw new Error(`Domena ${host} nie jest w Twoim koncie Cloudflare (albo token nie ma dostępu Zone:Read).`);
  const upsert = async (type, name, record) => {
    const existing = await call(`${api}/zones/${zone.id}/dns_records?type=${type}&name=${encodeURIComponent(name)}`);
    const body = JSON.stringify({ type, name, ttl: 120, ...record });
    if (existing.length) return call(`${api}/zones/${zone.id}/dns_records/${existing[0].id}`, { method: 'PUT', body });
    return call(`${api}/zones/${zone.id}/dns_records`, { method: 'POST', body });
  };
  // a proxied (orange cloud) CNAME on the same name would hide the A record
  const cname = await call(`${api}/zones/${zone.id}/dns_records?type=CNAME&name=${encodeURIComponent(host)}`);
  if (cname.length) throw new Error(`Cloudflare: ${host} ma już rekord CNAME – usuń go albo wybierz inną nazwę.`);
  await upsert('A', host, { content: ip, proxied: false });
  if (port && Number(port) !== 25565) {
    await upsert('SRV', `_minecraft._tcp.${host}`, { data: { priority: 0, weight: 5, port: Number(port), target: host } });
  }
  return host;
}

/** Points the server's domain at ip with the chosen provider; returns the hostname. */
async function updateDomain(domain, secret, ip, port) {
  switch (domain.provider) {
    case 'duckdns': return duckdnsUpdate(domain.name, secret, ip);
    case 'noip':
    case 'dynu': return dyndnsUpdate(domain.provider, domain.name, domain.user, secret, ip);
    case 'cloudflare': return cloudflareUpdate({ token: secret, hostname: domain.name, ip, port });
    default: return domain.name;
  }
}

/** DNS records to add by hand at any other provider. */
function manualRecords(hostname, ip, port) {
  const host = (hostname || 'mc.twojadomena.pl').replace(/\.$/, '');
  const records = [{ type: 'A', name: host, value: ip || '<twoje publiczne IP>', note: 'Adres serwera (bez proxy / „DNS only”)' }];
  if (port && Number(port) !== 25565) {
    records.push({ type: 'SRV', name: `_minecraft._tcp.${host}`, value: `0 5 ${port} ${host}`, note: 'Pozwala łączyć się bez wpisywania portu' });
  }
  return records;
}

// ------------------------------------------------------------------ diagnosis

/**
 * Step-by-step connection check: local server → router → public IP / CGNAT → port mapping →
 * firewall → domain → test from the internet. Each step: { id, status: ok|warn|bad|skip, title, text, fix }.
 */
async function diagnose({ port, running, domain, tunnel }) {
  const steps = [];
  const add = (id, status, title, text, fix) => steps.push({ id, status, title, text, fix: fix || null });
  const lan = lanAddresses();
  const real = lan.filter(a => !a.virtual);
  add('lan', real.length ? 'ok' : 'bad', 'Sieć lokalna', real.length ? `IP w sieci domowej: ${real.map(a => a.address).join(', ')}` : 'Brak połączenia z siecią lokalną.');

  if (running) {
    const listening = await portOpen('127.0.0.1', port);
    add('local', listening ? 'ok' : 'bad', 'Serwer na tym komputerze', listening ? `Serwer nasłuchuje na porcie ${port}.` : `Nic nie odpowiada na porcie ${port} – sprawdź konsolę serwera.`);
  } else {
    add('local', 'warn', 'Serwer na tym komputerze', 'Serwer jest wyłączony – uruchom go, aby sprawdzić połączenie z internetu.', 'start');
  }

  const [pub, router] = await Promise.all([publicIp().catch(() => null), routerInfo(port).catch(() => ({}))]);
  add('public', pub ? 'ok' : 'bad', 'Publiczne IP', pub ? `Twoje IP w internecie: ${pub}` : 'Brak połączenia z internetem.');

  const ext = router.external;
  const cgnat = (ext && isPrivateIp(ext)) || (pub && isCgnatIp(pub));
  if (router.upnp || router.natpmp) {
    add('router', 'ok', 'Router', `Brama ${router.gateway || '?'} obsługuje ${router.upnp ? 'UPnP' : 'NAT-PMP'}${ext ? ` • IP routera w internecie: ${ext}` : ''}.`);
  } else {
    add('router', 'warn', 'Router', `Brama ${router.gateway || '?'} nie odpowiada na UPnP ani NAT-PMP – włącz UPnP w panelu routera albo przekieruj port ręcznie.`, 'manual');
  }
  if (cgnat) {
    add('cgnat', 'bad', 'CGNAT / podwójny NAT', `Router dostaje adres ${ext || pub}, który nie jest publiczny – dostawca internetu dzieli jedno IP między klientów, więc przekierowanie portu nie zadziała. Użyj tunelu playit.gg albo poproś operatora o publiczne IP.`, 'tunnel');
  } else if (ext && pub && ext !== pub) {
    add('cgnat', 'warn', 'Podwójny NAT', `Router widzi IP ${ext}, a internet ${pub} – przed routerem jest drugi router (np. modem operatora). Przekieruj port także na nim albo ustaw go w trybie bridge.`, 'tunnel');
  }

  const lanIp = router.gateway ? localAddressFor(router.gateway) : (real[0] || {}).address;
  if (router.mapping) {
    const ok = router.mapping.client === lanIp && router.mapping.enabled;
    add('mapping', ok ? 'ok' : 'warn', `Przekierowanie portu ${port}`, ok ? `Router przekierowuje port ${port} na ten komputer (${lanIp}).`
      : `Port ${port} jest przekierowany na ${router.mapping.client}, a ten komputer ma ${lanIp}.`, ok ? null : 'upnp');
  } else if (router.upnp) {
    add('mapping', 'warn', `Przekierowanie portu ${port}`, 'Router nie ma przekierowania tego portu (albo nie pokazuje go przez UPnP).', 'upnp');
  }

  if (process.platform === 'win32') {
    const fw = await firewallStatus(port).catch(() => ({ supported: false }));
    if (fw.supported) add('firewall', fw.rule ? 'ok' : 'warn', 'Zapora Windows', fw.rule ? `Reguła „${ruleName(port)}” przepuszcza połączenia.` : 'Brak reguły dla portu serwera – Windows może blokować połączenia z zewnątrz.', fw.rule ? null : 'firewall');
  }

  if (domain && domain.name && domain.provider && domain.provider !== 'none') {
    const d = await dnsCheck(domain.name, port).catch((e) => ({ error: e.message, a: [] }));
    if (!d.a.length) add('dns', 'bad', `Domena ${domain.name}`, `DNS: ${d.error || 'brak rekordu A'} – kliknij „Zapisz i zastosuj” w sekcji domeny.`, 'domain');
    else if (pub && !d.a.includes(pub)) add('dns', 'warn', `Domena ${domain.name}`, `Wskazuje na ${d.a.join(', ')}, a Twoje IP to ${pub} – zaktualizuj domenę (zmiana DNS może potrwać kilka minut).`, 'domain');
    else add('dns', 'ok', `Domena ${domain.name}`, `Wskazuje na ${d.a.join(', ')}${d.srv ? ` • SRV → port ${d.srv.port}` : ''}.`);
  }

  if (tunnel && tunnel.address) add('tunnel', 'ok', 'Tunel playit.gg', `Znajomi mogą łączyć się przez ${tunnel.address}.`);

  if (running && pub) {
    const r = await checkReachable(pub, port).catch(() => null);
    if (r && r.online) add('internet', 'ok', 'Test z internetu', `Serwer odpowiada pod ${pub}:${port}${r.version ? ` (${r.version})` : ''}. Znajomi mogą dołączyć!`);
    else add('internet', cgnat && tunnel && tunnel.address ? 'warn' : 'bad', 'Test z internetu', `Serwer nie odpowiada pod ${pub}:${port}${cgnat ? ' (CGNAT – użyj tunelu)' : ' – sprawdź kroki powyżej'}. Wynik może pochodzić z pamięci podręcznej (do 5 min).`, cgnat ? 'tunnel' : 'upnp');
  }
  return { steps, publicIp: pub, lanIp, gateway: router.gateway || null, cgnat: !!cgnat };
}

module.exports = {
  lanAddresses, publicIp, defaultGateway, checkReachable, portOpen, isPrivateIp, upnpOpen, upnpClose, routerInfo,
  firewallStatus, firewallAllow, dnsCheck, duckdnsUpdate, dyndnsUpdate, cloudflareUpdate, updateDomain, manualRecords, diagnose,
  DYNDNS, _internal: { natpmpMap, natpmpExternal, gatewayServices, testLocations },
};
