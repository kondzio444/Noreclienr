'use strict';
/*
 * Making a local server reachable from the internet: public / LAN addresses, automatic port
 * forwarding (UPnP IGD), an outside-in reachability check and domain binding (DuckDNS, Cloudflare,
 * or manual DNS records).
 */
const os = require('os');
const http = require('http');
const dgram = require('dgram');
const net = require('./net');

// ------------------------------------------------------------------ addresses

function lanAddresses() {
  const out = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const a of list || []) {
      if (a.family === 'IPv4' && !a.internal) out.push({ name, address: a.address, netmask: a.netmask });
    }
  }
  return out;
}

async function publicIp() {
  for (const url of ['https://api.ipify.org?format=json', 'https://api64.ipify.org?format=json']) {
    try {
      const j = await net.getJson(url);
      if (j.ip) return j.ip;
    } catch { /* try the next service */ }
  }
  const res = await net.fetchWithRetry('https://icanhazip.com', {}, 2);
  return (await res.text()).trim();
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
  };
}

// ------------------------------------------------------------------ UPnP (Internet Gateway Device)

function httpRequest(url, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method, headers, timeout: 5000 }, (res) => {
      let data = '';
      res.on('data', (d) => { data += d; });
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function discoverGateway(timeoutMs = 3000) {
  return new Promise((resolve) => {
    const sock = dgram.createSocket('udp4');
    const found = [];
    const msg = Buffer.from([
      'M-SEARCH * HTTP/1.1', 'HOST: 239.255.255.250:1900', 'MAN: "ssdp:discover"', 'MX: 2',
      'ST: urn:schemas-upnp-org:device:InternetGatewayDevice:1', '', '',
    ].join('\r\n'));
    sock.on('message', (m) => {
      const loc = /^location:\s*(.+)$/im.exec(m.toString());
      if (loc && !found.includes(loc[1].trim())) found.push(loc[1].trim());
    });
    sock.on('error', () => { /* ignore: resolved by the timer */ });
    sock.bind(() => {
      try { sock.send(msg, 1900, '239.255.255.250'); } catch { /* no multicast */ }
    });
    setTimeout(() => { try { sock.close(); } catch { /* closed */ } resolve(found); }, timeoutMs);
  });
}

async function gatewayService() {
  const locations = await discoverGateway();
  for (const loc of locations) {
    try {
      const { body } = await httpRequest(loc);
      for (const type of ['urn:schemas-upnp-org:service:WANIPConnection:2', 'urn:schemas-upnp-org:service:WANIPConnection:1', 'urn:schemas-upnp-org:service:WANPPPConnection:1']) {
        const i = body.indexOf(type);
        if (i < 0) continue;
        const ctl = /<controlURL>\s*([^<]+)\s*<\/controlURL>/i.exec(body.slice(i));
        if (!ctl) continue;
        const url = new URL(ctl[1].trim(), loc).toString();
        return { url, type, host: new URL(loc).hostname };
      }
    } catch { /* try the next device */ }
  }
  return null;
}

async function soap(svc, action, args) {
  const params = Object.entries(args).map(([k, v]) => `<${k}>${v}</${k}>`).join('');
  const body = `<?xml version="1.0"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body><u:${action} xmlns:u="${svc.type}">${params}</u:${action}></s:Body></s:Envelope>`;
  const res = await httpRequest(svc.url, {
    method: 'POST', body,
    headers: { 'Content-Type': 'text/xml; charset="utf-8"', SOAPAction: `"${svc.type}#${action}"`, 'Content-Length': Buffer.byteLength(body) },
  });
  if (res.status !== 200) {
    const err = /<errorDescription>([^<]+)</i.exec(res.body);
    throw new Error(err ? err[1] : `Router odrzucił ${action} (HTTP ${res.status})`);
  }
  return res.body;
}

/** The LAN address that sits in the same subnet as the router. */
function localAddressFor(gatewayHost) {
  const lan = lanAddresses();
  const prefix = gatewayHost.split('.').slice(0, 3).join('.');
  return (lan.find(a => a.address.startsWith(prefix + '.')) || lan[0] || {}).address;
}

async function upnpOpen(port, description = 'Nore Server') {
  const svc = await gatewayService();
  if (!svc) throw new Error('Nie znaleziono routera z UPnP. Włącz UPnP w routerze albo przekieruj port ręcznie.');
  const client = localAddressFor(svc.host);
  for (const proto of ['TCP', 'UDP']) {
    await soap(svc, 'AddPortMapping', {
      NewRemoteHost: '', NewExternalPort: port, NewProtocol: proto, NewInternalPort: port,
      NewInternalClient: client, NewEnabled: 1, NewPortMappingDescription: description, NewLeaseDuration: 0,
    });
  }
  let external = null;
  try {
    const r = await soap(svc, 'GetExternalIPAddress', {});
    external = (/<NewExternalIPAddress>([^<]*)</i.exec(r) || [])[1] || null;
  } catch { /* optional */ }
  return { router: svc.host, client, external };
}

async function upnpClose(port) {
  const svc = await gatewayService();
  if (!svc) return false;
  for (const proto of ['TCP', 'UDP']) {
    try { await soap(svc, 'DeletePortMapping', { NewRemoteHost: '', NewExternalPort: port, NewProtocol: proto }); } catch { /* not mapped */ }
  }
  return true;
}

// ------------------------------------------------------------------ domains

/** DuckDNS: free <name>.duckdns.org subdomain pointed at the current public IP. */
async function duckdnsUpdate(subdomain, token, ip) {
  const name = String(subdomain).replace(/\.duckdns\.org$/i, '').trim();
  const url = `https://www.duckdns.org/update?domains=${encodeURIComponent(name)}&token=${encodeURIComponent(token)}&ip=${encodeURIComponent(ip || '')}`;
  const res = await net.fetchWithRetry(url, {}, 2);
  const text = (await res.text()).trim();
  if (text !== 'OK') throw new Error('DuckDNS odrzucił aktualizację – sprawdź subdomenę i token.');
  return `${name}.duckdns.org`;
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
  if (!zone) throw new Error(`Domena ${host} nie jest w Twoim koncie Cloudflare (albo token nie ma dostępu).`);
  const upsert = async (type, name, record) => {
    const existing = await call(`${api}/zones/${zone.id}/dns_records?type=${type}&name=${encodeURIComponent(name)}`);
    const body = JSON.stringify({ type, name, ttl: 120, ...record });
    if (existing.length) return call(`${api}/zones/${zone.id}/dns_records/${existing[0].id}`, { method: 'PUT', body });
    return call(`${api}/zones/${zone.id}/dns_records`, { method: 'POST', body });
  };
  await upsert('A', host, { content: ip, proxied: false });
  if (port && Number(port) !== 25565) {
    await upsert('SRV', `_minecraft._tcp.${host}`, { data: { priority: 0, weight: 5, port: Number(port), target: host } });
  }
  return host;
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

module.exports = { lanAddresses, publicIp, checkReachable, upnpOpen, upnpClose, duckdnsUpdate, cloudflareUpdate, manualRecords };
