// Every API v1 answer (status, relevant headers, body) for a fixed set of requests, with the
// time-dependent fields blanked – used to prove that API v1 is byte-for-byte unchanged.
export const V1_REQUESTS = [
  ['GET', '/api/v1'], ['GET', '/api/v1/'], ['GET', '/api/v1/openapi.json'], ['GET', '/api/v1/events'], ['GET', '/api/v1/news'],
  ['GET', '/api/v1/platforms'], ['GET', '/api/v1/version'], ['GET', '/api/v1/releases'], ['GET', '/api/v1/releases?limit=1'],
  ['GET', '/api/v1/releases?limit=999'], ['GET', '/api/v1/stats'], ['GET', '/api/v1/updates/launcher?platform=win&current=1.4.0'],
  ['GET', '/api/v1/updates/launcher?platform=mac&current=9.9.9'], ['GET', '/api/v1/updates/launcher?platform=xbox'],
  ['GET', '/api/v1/updates/mod?mc=1.21.8'], ['GET', '/api/v1/updates/mod?mc=1.21.8&loader=forge'], ['GET', '/api/v1/updates/mod'],
  ['GET', '/api/v1/updates/mod?mc=0.1'], ['GET', '/api/v1/download/win'], ['GET', '/api/v1/download/linux'], ['GET', '/api/v1/download/mac'],
  ['GET', '/api/v1/download/xbox'], ['GET', '/api/v1/launcher/config'], ['GET', '/api/v1/hub/stats'], ['GET', '/api/v1/hub/players?names=a,b'],
  ['GET', '/api/v1/hub/players?names=' + Array.from({ length: 101 }, (_, i) => 'p' + i).join(',')], ['GET', '/api/v1/hub/hello'],
  ['POST', '/api/v1/hub/hello'], ['GET', '/api/v1/hub/nope'], ['POST', '/api/v1/version'], ['GET', '/api/v1/nope'], ['OPTIONS', '/api/v1/version'],
  ['PUT', '/api/v1/version'], ['GET', '/api/v1/cf/v1/nope'], ['GET', '/api/v1/cf/v1/categories'], ['HEAD', '/api/v1/news'],
];

const HEADERS = ['content-type', 'cache-control', 'etag', 'x-nore-api', 'location', 'access-control-allow-origin', 'access-control-allow-methods',
  'access-control-allow-headers', 'access-control-expose-headers', 'x-content-type-options', 'strict-transport-security', 'referrer-policy'];

export async function snapshotV1(base) {
  const out = [];
  for (const [method, p] of V1_REQUESTS) {
    const res = await fetch(base + p, { method, redirect: 'manual', headers: method === 'POST' ? { 'Content-Type': 'application/json' } : {}, body: method === 'POST' ? '{}' : undefined });
    const headers = {};
    for (const h of HEADERS) if (res.headers.has(h)) headers[h] = res.headers.get(h);
    let body = await res.text();
    out.push({ method, path: p, status: res.status, headers, body });
  }
  return out;
}

export async function v1Status(base) {
  const res = await fetch(base + '/api/v1/status');
  const j = await res.json();
  return { status: res.status, keys: Object.keys(j), cacheKeys: j.cache && Object.keys(j.cache) };
}
