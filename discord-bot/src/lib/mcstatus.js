/**
 * Minecraft server status: API v2 `/servers/:address` first, local SLP ping as the fallback.
 * Results are cached for 30 s per address so monitors and commands share pings.
 */
import { ping, shapeStatus, parseAddress } from './slp.js';

const cache = new Map();

export async function serverStatus(api, address, { maxAge = 30_000 } = {}) {
  const key = String(address).toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < maxAge) return hit.data;
  let data = null;
  let remote = api ? await api.server(address).catch(() => null) : null;
  if (remote && remote.server) remote = remote.server; // API v2: { ok, server: {…} }
  if (remote && typeof remote === 'object' && 'online' in remote && !remote.error) {
    const p = parseAddress(address) || {};
    const motd = typeof remote.motd === 'object' && remote.motd ? (remote.motd.plain ?? remote.motd.clean ?? remote.motd.raw ?? '') : remote.motd;
    const fav = remote.favicon || remote.faviconUrl || null;
    data = remote.online
      ? {
        ...shapeStatus({ version: { name: remote.version?.name ?? remote.version, protocol: remote.version?.protocol ?? remote.protocol }, players: remote.players, description: motd, favicon: typeof fav === 'string' && fav.startsWith('data:') ? fav : undefined }, { host: p.host, port: p.port, latency: remote.latencyMs ?? remote.latency ?? null }),
        faviconUrl: typeof fav === 'string' && /^https?:/.test(fav) ? fav : null,
        source: 'api',
      }
      : { online: false, host: p.host, port: p.port, error: remote.error || 'offline', source: 'api' };
  } else {
    data = { ...(await ping(address)), source: 'ping' };
  }
  cache.set(key, { at: Date.now(), data });
  if (cache.size > 500) for (const [k, v] of cache) if (Date.now() - v.at > 300_000) cache.delete(k);
  return data;
}

/** Favicon data URL → Buffer (PNG) or null. */
export function faviconBuffer(fav) {
  if (!fav || !fav.startsWith('data:image/png;base64,')) return null;
  try { return Buffer.from(fav.slice(22), 'base64'); } catch { return null; }
}
