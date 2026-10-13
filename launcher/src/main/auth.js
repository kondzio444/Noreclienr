'use strict';
const crypto = require('crypto');
const net = require('./net');

/** UUID v3 like Java's UUID.nameUUIDFromBytes("OfflinePlayer:" + name) – what vanilla servers use in offline mode. */
function offlineUuid(name) {
  const md5 = crypto.createHash('md5').update('OfflinePlayer:' + name, 'utf8').digest();
  md5[6] = (md5[6] & 0x0f) | 0x30;
  md5[8] = (md5[8] & 0x3f) | 0x80;
  const h = md5.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function validOfflineName(name) {
  return /^[A-Za-z0-9_]{3,16}$/.test(name);
}

function createOffline(name) {
  if (!validOfflineName(name)) throw new Error('Nick musi mieć 3–16 znaków: litery, cyfry lub _');
  return { id: 'offline-' + offlineUuid(name), type: 'offline', name, uuid: offlineUuid(name), accessToken: '0' };
}

// ---------------------------------------------------------------- Microsoft (device code flow)
// Requires an Azure application ID that Mojang approved for Minecraft services; set it in Settings.

const MS_DEVICE = 'https://login.microsoftonline.com/consumers/oauth2/v2.0/devicecode';
const MS_TOKEN = 'https://login.microsoftonline.com/consumers/oauth2/v2.0/token';
const SCOPE = 'XboxLive.signin offline_access';

async function postForm(url, body) {
  const res = await net.fetchWithRetry(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString(),
  });
  return { status: res.status, json: await res.json().catch(() => ({})) };
}

async function postJson(url, body, headers = {}) {
  const res = await net.fetchWithRetry(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(json.errorMessage || json.Message || json.error || `HTTP ${res.status} (${url})`);
    err.status = res.status;
    err.xerr = json.XErr;
    throw err;
  }
  return json;
}

async function startDeviceCode(clientId) {
  if (!clientId) throw new Error('Brak Client ID aplikacji Azure – uzupełnij je w Ustawieniach (logowanie Microsoft).');
  const { status, json } = await postForm(MS_DEVICE, { client_id: clientId, scope: SCOPE });
  if (status !== 200) throw new Error(json.error_description || 'Nie udało się rozpocząć logowania Microsoft');
  return json; // { device_code, user_code, verification_uri, expires_in, interval, message }
}

async function pollDeviceCode(clientId, device, { signal } = {}) {
  const deadline = Date.now() + device.expires_in * 1000;
  let interval = (device.interval || 5) * 1000;
  while (Date.now() < deadline) {
    if (signal && signal.aborted) throw new Error('Anulowano logowanie');
    await new Promise(r => setTimeout(r, interval));
    const { json } = await postForm(MS_TOKEN, {
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code', client_id: clientId, device_code: device.device_code,
    });
    if (json.access_token) return json;
    if (json.error === 'authorization_pending') continue;
    if (json.error === 'slow_down') { interval += 5000; continue; }
    throw new Error(json.error_description || json.error || 'Logowanie nie powiodło się');
  }
  throw new Error('Kod logowania wygasł – spróbuj ponownie');
}

const XERR = {
  2148916233: 'To konto Microsoft nie ma konta Xbox – utwórz je na xbox.com.',
  2148916235: 'Xbox Live jest niedostępny w Twoim kraju.',
  2148916236: 'Konto wymaga weryfikacji wieku (Korea).',
  2148916238: 'Konto dziecka – musi zostać dodane do rodziny przez osobę dorosłą.',
};

/** Microsoft access token → Minecraft profile + token. */
async function minecraftFromMs(msAccessToken) {
  const xbl = await postJson('https://user.auth.xboxlive.com/user/authenticate', {
    Properties: { AuthMethod: 'RPS', SiteName: 'user.auth.xboxlive.com', RpsTicket: `d=${msAccessToken}` },
    RelyingParty: 'http://auth.xboxlive.com', TokenType: 'JWT',
  });
  let xsts;
  try {
    xsts = await postJson('https://xsts.auth.xboxlive.com/xsts/authorize', {
      Properties: { SandboxId: 'RETAIL', UserTokens: [xbl.Token] },
      RelyingParty: 'rp://api.minecraftservices.com/', TokenType: 'JWT',
    });
  } catch (e) {
    throw new Error(XERR[e.xerr] || e.message);
  }
  const uhs = xsts.DisplayClaims.xui[0].uhs;
  const mc = await postJson('https://api.minecraftservices.com/authentication/login_with_xbox', {
    identityToken: `XBL3.0 x=${uhs};${xsts.Token}`,
  });
  const res = await net.fetchWithRetry('https://api.minecraftservices.com/minecraft/profile', {
    headers: { Authorization: `Bearer ${mc.access_token}` },
  });
  if (res.status === 404) throw new Error('To konto nie posiada Minecraft: Java Edition.');
  const profile = await res.json();
  if (!profile.id) throw new Error('Nie udało się pobrać profilu Minecraft');
  const uuid = profile.id.replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5');
  return {
    uuid, name: profile.name, accessToken: mc.access_token,
    expiresAt: Date.now() + (mc.expires_in || 86400) * 1000,
    skin: profile.skins && profile.skins[0] && profile.skins[0].url,
  };
}

async function refreshMicrosoft(account, clientId) {
  const { json } = await postForm(MS_TOKEN, {
    grant_type: 'refresh_token', client_id: clientId, refresh_token: account.refreshToken, scope: SCOPE,
  });
  if (!json.access_token) throw new Error('Sesja Microsoft wygasła – zaloguj się ponownie.');
  const mc = await minecraftFromMs(json.access_token);
  return { ...account, ...mc, refreshToken: json.refresh_token || account.refreshToken };
}

module.exports = {
  offlineUuid, validOfflineName, createOffline,
  startDeviceCode, pollDeviceCode, minecraftFromMs, refreshMicrosoft,
};
