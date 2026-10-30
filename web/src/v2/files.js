/*
 * Release files through the Worker, so downloads and launcher updates keep working when the
 * GitHub repository is private (RELEASES_PRIVATE=true + GITHUB_TOKEN, see src/data.js):
 *
 *   GET /api/v2/files/:version/:name    302 to the file of that release (signed GitHub URL when private)
 *   GET /api/v2/updates/feed/:name      electron-updater "generic" feed of the newest stable release:
 *                                       latest.yml / latest-linux.yml / latest-mac.yml are served as
 *                                       text, every other file (installer, blockmap) is a 302
 */
import { ApiError } from './http.js';
import { releases, assetLocation, assetText, readCache, writeCache } from '../data.js';

const FEED_YML = /^latest(-linux|-mac)?\.yml$/;

function findFile(rel, name) {
  const f = (rel.files || []).find(x => x.name === name);
  if (!f) throw new ApiError(404, 'no_file', `Wydanie ${rel.version} nie ma pliku ${name}`);
  return f;
}

async function redirectTo(env, file) {
  const location = await assetLocation(env, file);
  if (!location) throw new ApiError(502, 'upstream', 'GitHub nie dał linku do pliku');
  return new Response(null, { status: 302, headers: { Location: location, 'Cache-Control': 'no-store', 'X-Nore-File': file.name } });
}

export async function fileRedirect(env, ctx, version, rawName) {
  const name = decodeURIComponent(rawName);
  const { data } = await releases(env, ctx);
  const v = String(version).replace(/^v/, '');
  const rel = data.find(r => r.version === v);
  if (!rel) throw new ApiError(404, 'no_release', `Nie ma wydania ${v}`);
  return redirectTo(env, findFile(rel, name));
}

export async function updateFeed(env, ctx, rawName) {
  const name = decodeURIComponent(rawName);
  const { data } = await releases(env, ctx);
  const rel = data.find(r => !r.prerelease);
  if (!rel) throw new ApiError(404, 'no_release', 'Nie ma jeszcze stabilnego wydania');
  const file = findFile(rel, name);
  if (!FEED_YML.test(name)) return redirectTo(env, file);
  const key = `feed:${rel.version}:${name}`;
  let text = (await readCache(key))?.data;
  if (typeof text !== 'string') {
    text = await assetText(env, file);
    if (text.length > 64 * 1024) throw new ApiError(502, 'upstream', 'Plik aktualizacji jest za duży');
    ctx.waitUntil(writeCache(key, text).catch(() => {}));
  }
  return new Response(text, { headers: { 'Content-Type': 'text/yaml; charset=utf-8', 'Cache-Control': 'public, max-age=60', 'X-Nore-Release': rel.version } });
}
