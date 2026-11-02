/**
 * Social feeds: YouTube (channel RSS, no key), Twitch live start/end (Helix, optional
 * TWITCH_CLIENT_ID/SECRET), TikTok / Instagram / X through a configurable RSS-Bridge instance,
 * any RSS/Atom feed and GitHub releases/commits (Atom feeds, no key).
 *
 * Every source URL is fetched once per interval no matter how many guilds follow it; posted item ids
 * are remembered per guild (dedupe), the first fetch only records what exists (no flood), failing
 * sources back off exponentially.
 */
import { createHash } from 'node:crypto';
import { opt } from '../core/commands.js';
import { EPHEMERAL, embed, COLORS } from '../core/ui.js';
import { parseFeed } from '../lib/feedparse.js';
import { request, Backoff, UA } from '../lib/http.js';
import { rememberId } from '../lib/store.js';
import { render, clip } from '../lib/template.js';
import { ts } from '../lib/duration.js';
import { logger } from '../lib/logger.js';

const log = logger.child('social');
const COLOR = { youtube: 0xff0000, twitch: 0x9146ff, tiktok: 0x25f4ee, instagram: 0xe1306c, x: 0x111111, rss: 0xffa500, github: 0x24292f };
const ICON = { youtube: '📺', twitch: '🟣', tiktok: '🎵', instagram: '📸', x: '𝕏', rss: '📰', github: '🐙' };

/** RSS-Bridge URLs (https://github.com/RSS-Bridge/rss-bridge) for key-free social feeds. */
export function bridgeUrl(base, platform, username) {
  if (!base) return null;
  const u = encodeURIComponent(username.replace(/^@/, ''));
  switch (platform) {
    case 'tiktok': return `${base}/?action=display&bridge=TikTokBridge&context=By+user&username=%40${u}&format=Atom`;
    case 'instagram': return `${base}/?action=display&bridge=InstagramBridge&context=Username&u=${u}&media_type=all&format=Atom`;
    case 'x': return `${base}/?action=display&bridge=TwitterBridge&context=By+username&u=${u}&format=Atom`;
    default: return null;
  }
}

export function githubUrl(repo, kind, branch) {
  return kind === 'commits' ? `https://github.com/${repo}/commits/${encodeURIComponent(branch || 'HEAD')}.atom` : `https://github.com/${repo}/releases.atom`;
}

/** All feed subscriptions of a guild config → [{ key, kind, url, sub }] */
export function subscriptions(cfg, bridgeBase) {
  const out = [];
  const key = (...p) => createHash('sha1').update(p.join('|')).digest('hex').slice(0, 16);
  for (const s of cfg.youtube) if (s.channelId && s.channel) out.push({ kind: 'youtube', url: `https://www.youtube.com/feeds/videos.xml?channel_id=${s.channelId}`, sub: s, key: key('yt', s.channelId, s.channel) });
  for (const s of cfg.bridges) { const url = s.username && s.channel ? bridgeUrl(bridgeBase, s.platform, s.username) : null; if (url) out.push({ kind: s.platform, url, sub: s, key: key('br', s.platform, s.username, s.channel) }); }
  for (const s of cfg.rss) if (s.url && s.channel) out.push({ kind: 'rss', url: s.url, sub: s, key: key('rss', s.url, s.channel) });
  for (const s of cfg.github) if (s.repo && s.channel) out.push({ kind: 'github', url: githubUrl(s.repo, s.kind, s.branch), sub: s, key: key('gh', s.repo, s.kind, s.branch, s.channel) });
  return out;
}

// ------------------------------------------------------------------ fetching with dedupe across guilds

const sources = new Map(); // url -> { backoff, at, items, etag, lastModified }

async function fetchFeed(url, maxAgeMs) {
  let s = sources.get(url);
  if (!s) { s = { backoff: new Backoff({ base: 60_000, max: 3_600_000 }), at: 0, items: null }; sources.set(url, s); }
  if (s.items && Date.now() - s.at < maxAgeMs) return s.items;
  if (!s.backoff.ready()) return s.items;
  try {
    const headers = { Accept: 'application/atom+xml, application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.5' };
    if (s.etag) headers['If-None-Match'] = s.etag;
    if (s.lastModified) headers['If-Modified-Since'] = s.lastModified;
    const res = await request(url, { headers, json: false, timeout: 15_000 });
    s.at = Date.now();
    if (res.status !== 304) {
      s.items = parseFeed(res.data).items.filter(i => i.id);
      s.etag = res.headers.get('etag');
      s.lastModified = res.headers.get('last-modified');
    }
    s.backoff.ok();
  } catch (err) {
    if (s.backoff.fail()) log.warn('feed unreachable, backing off', { url, error: err.message });
  }
  return s.items;
}

// ------------------------------------------------------------------ Twitch

const twitch = { token: null, expires: 0, backoff: new Backoff({ base: 60_000, max: 1_800_000 }), cache: new Map() };

async function twitchToken(env) {
  if (twitch.token && Date.now() < twitch.expires - 60_000) return twitch.token;
  const res = await request(`https://id.twitch.tv/oauth2/token?client_id=${encodeURIComponent(env.twitchClientId)}&client_secret=${encodeURIComponent(env.twitchClientSecret)}&grant_type=client_credentials`, { method: 'POST', timeout: 10_000 });
  twitch.token = res.data.access_token;
  twitch.expires = Date.now() + (res.data.expires_in || 3600) * 1000;
  return twitch.token;
}

/** login -> stream | null for up to 100 logins per request. */
async function twitchStreams(env, logins) {
  const out = new Map();
  if (!env.twitchClientId || !env.twitchClientSecret || !logins.length || !twitch.backoff.ready()) return null;
  try {
    const token = await twitchToken(env);
    for (let i = 0; i < logins.length; i += 100) {
      const q = logins.slice(i, i + 100).map(l => `user_login=${encodeURIComponent(l)}`).join('&');
      const res = await request(`https://api.twitch.tv/helix/streams?${q}`, { headers: { 'Client-Id': env.twitchClientId, Authorization: `Bearer ${token}` } });
      for (const s of res.data.data || []) out.set(s.user_login.toLowerCase(), s);
    }
    for (const l of logins) if (!out.has(l)) out.set(l, null);
    twitch.backoff.ok();
    return out;
  } catch (err) {
    if (err.status === 401) twitch.token = null;
    if (twitch.backoff.fail()) log.warn('Twitch API failed, backing off', { error: err.message, status: err.status });
    return null;
  }
}

// ------------------------------------------------------------------ posting

function itemPayload(bot, guild, kind, sub, item) {
  const tg = bot.tg(guild.id);
  const vars = { title: item.title, url: item.link, author: item.author || sub.name || '', name: sub.name || item.author || '', role: sub.role ? `<@&${sub.role}>` : '', platform: tg(`social.platform.${kind}`) };
  const content = render(sub.template || tg(`social.tpl.${kind}`), vars).trim();
  const payload = { content: clip(content, 2000), allowedMentions: { roles: sub.role ? [sub.role] : [] } };
  if (kind !== 'youtube') {
    const e = embed(COLOR[kind] ?? COLORS.brand).setTitle(clip(`${ICON[kind] || ''} ${item.title || item.link}`, 256)).setURL(item.link || null)
      .setDescription(item.summary ? clip(item.summary, 600) : null);
    if (item.author) e.setAuthor({ name: clip(item.author, 256) });
    if (item.image) e.setImage(item.image);
    if (item.date) e.setTimestamp(new Date(item.date));
    payload.embeds = [e];
  }
  return payload;
}

const seenOf = (bot, gid) => bot.store.ns(gid, 'feeds', () => ({ seen: {}, twitch: {}, lastRun: 0 }));

async function tick(bot) {
  const env = bot.env;
  const now = Date.now();
  const due = [];
  for (const guild of bot.client.guilds.cache.values()) {
    const cfg = bot.cfg(guild.id).social;
    if (!cfg.enabled) continue;
    const st = seenOf(bot, guild.id);
    if (now - (st.lastRun || 0) < cfg.intervalMinutes * 60_000 - 5000) continue;
    st.lastRun = now;
    due.push({ guild, cfg, st });
  }
  if (!due.length) return;
  // feeds
  for (const { guild, cfg, st } of due) {
    for (const s of subscriptions(cfg, env.rssBridgeUrl)) {
      const items = await fetchFeed(s.url, Math.max(60_000, cfg.intervalMinutes * 60_000 - 10_000));
      if (!items) continue;
      if (!st.seen[s.key]) { st.seen[s.key] = items.map(i => i.id).slice(0, 100); continue; }
      const fresh = items.filter(i => !st.seen[s.key].includes(i.id)).reverse().slice(-5);
      for (const item of fresh) {
        rememberId(st.seen[s.key], item.id, 200);
        await bot.send(guild, s.sub.channel, itemPayload(bot, guild, s.kind, s.sub, item));
      }
    }
    // forget subscriptions that were removed from the config
    const keys = new Set(subscriptions(cfg, env.rssBridgeUrl).map(s => s.key));
    for (const k of Object.keys(st.seen)) if (!keys.has(k)) delete st.seen[k];
    bot.store.touch(guild.id);
  }
  // twitch, one batched request for all guilds
  const logins = [...new Set(due.flatMap(d => d.cfg.twitch.filter(t => t.login && t.channel).map(t => t.login.toLowerCase())))];
  const live = await twitchStreams(env, logins);
  if (!live) return;
  for (const { guild, cfg, st } of due) {
    const tg = bot.tg(guild.id);
    for (const t of cfg.twitch) {
      if (!t.login || !t.channel) continue;
      const login = t.login.toLowerCase();
      const stream = live.get(login);
      const key = `${login}:${t.channel}`;
      const prev = st.twitch[key];
      if (stream && prev?.id !== stream.id) {
        const vars = { name: stream.user_name, title: stream.title, game: stream.game_name || '', url: `https://twitch.tv/${login}`, role: t.role ? `<@&${t.role}>` : '' };
        const e = embed(COLOR.twitch).setAuthor({ name: tg('social.twitch_live', { name: stream.user_name }) }).setTitle(clip(stream.title || login, 256)).setURL(vars.url)
          .addFields({ name: tg('social.game'), value: stream.game_name || '—', inline: true }, { name: tg('social.viewers'), value: String(stream.viewer_count ?? 0), inline: true })
          .setImage(stream.thumbnail_url?.replace('{width}', '1280').replace('{height}', '720') + `?t=${Date.now()}`).setTimestamp(new Date(stream.started_at));
        const msg = await bot.send(guild, t.channel, { content: render(t.template || tg('social.tpl.twitch'), vars).trim() || undefined, embeds: [e], allowedMentions: { roles: t.role ? [t.role] : [] } });
        st.twitch[key] = { id: stream.id, messageId: msg?.id || null, startedAt: Date.parse(stream.started_at) || Date.now(), title: stream.title, name: stream.user_name };
      } else if (!stream && prev?.id) {
        if (prev.messageId) {
          const ch = await bot.channel(guild, t.channel);
          const msg = ch ? await ch.messages.fetch(prev.messageId).catch(() => null) : null;
          if (msg) await msg.edit({ embeds: [embed(COLORS.muted).setAuthor({ name: tg('social.twitch_ended', { name: prev.name || login }) }).setTitle(clip(prev.title || login, 256)).setURL(`https://twitch.tv/${login}`).setDescription(tg('social.twitch_duration', { since: ts(prev.startedAt) }))] }).catch(() => {});
        }
        if (t.endMessage) await bot.send(guild, t.channel, { content: tg('social.twitch_end_message', { name: prev.name || login, url: `https://twitch.tv/${login}` }) });
        st.twitch[key] = { id: null };
      }
    }
    bot.store.touch(guild.id);
  }
}

export default {
  name: 'social',
  ready(bot) {
    if (!bot.env.twitchClientId || !bot.env.twitchClientSecret) log.info('Twitch feeds disabled (TWITCH_CLIENT_ID / TWITCH_CLIENT_SECRET not set)');
    bot.every(60_000, () => tick(bot), 'social');
  },
  commands: [{
    name: 'feeds', category: 'automation', perms: ['ManageGuild'], module: null,
    subs: {
      list: {
        async run(ctx) {
          const cfg = ctx.cfg.social;
          const subs = subscriptions(cfg, ctx.bot.env.rssBridgeUrl);
          const lines = [
            ...subs.map(s => `${ICON[s.kind]} **${ctx.t(`social.platform.${s.kind}`)}** · ${clip(s.sub.name || s.sub.repo || s.sub.username || s.sub.channelId || s.url, 60)} → <#${s.sub.channel}>${sources.get(s.url)?.backoff.failures ? ' ⚠️' : ''}`),
            ...cfg.twitch.filter(t => t.login).map(t => `${ICON.twitch} **Twitch** · ${t.login} → <#${t.channel}>${ctx.bot.env.twitchClientId ? '' : ` ⚠️ ${ctx.t('social.twitch_no_key')}`}`),
            ...cfg.bridges.filter(b => b.username && !ctx.bot.env.rssBridgeUrl).map(b => `${ICON[b.platform]} ${b.username} ⚠️ ${ctx.t('social.no_bridge')}`),
          ];
          const e = ctx.bot.embed(ctx.guild.id).setTitle(ctx.t('social.list_title')).setDescription(lines.join('\n') || ctx.t('social.none'))
            .setFooter({ text: `${cfg.enabled ? '🟢' : '⚫'} ${ctx.t('social.interval', { minutes: cfg.intervalMinutes })}` });
          return ctx.reply({ embeds: [e], flags: EPHEMERAL });
        },
      },
      add: {
        options: [
          opt.string('type', true, { choices: { values: ['youtube', 'twitch', 'rss', 'github', 'tiktok', 'instagram', 'x'], key: (v) => `social.platform.${v}` } }),
          opt.string('source', true, { max: 500 }), opt.channel('channel', true, { channelTypes: ['text', 'announcement'] }), opt.role('role'),
          opt.string('template', false, { max: 1500 }),
        ],
        async run(ctx) {
          const type = ctx.str('type');
          const source = ctx.str('source').trim();
          const base = { channel: ctx.channelOpt('channel').id, role: ctx.roleOpt('role')?.id || '', template: ctx.str('template') || '' };
          const cfg = structuredClone(ctx.cfg.social);
          let path, value;
          if (type === 'youtube') {
            const id = (/UC[\w-]{22}/.exec(source) || [])[0];
            if (!id) return ctx.fail('social.bad_youtube');
            path = 'youtube'; value = { channelId: id, name: '', ...base };
          } else if (type === 'twitch') {
            const login = source.replace(/^https?:\/\/(www\.)?twitch\.tv\//, '').replace(/\/.*$/, '');
            path = 'twitch'; value = { login, endMessage: true, ...base };
          } else if (type === 'rss') { path = 'rss'; value = { url: source, name: '', ...base }; }
          else if (type === 'github') {
            const repo = source.replace(/^https?:\/\/github\.com\//, '').split('/').slice(0, 2).join('/');
            path = 'github'; value = { repo, kind: /commit/i.test(source) ? 'commits' : 'releases', branch: '', ...base };
          } else { path = 'bridges'; value = { platform: type, username: source.replace(/^@/, '').replace(/^https?:\/\/[^/]+\/@?/, '').replace(/\/.*$/, ''), ...base }; }
          cfg[path].push(value);
          const res = ctx.bot.config.set(ctx.guild.id, `social.${path}`, cfg[path], { by: ctx.user.id });
          if (!res.ok) return ctx.fail('config.invalid_schema', { key: `social.${path}`, details: res.errors.map(e => `${e.pointer} ${e.message}`).join('; ') });
          if (!ctx.cfg.social.enabled) ctx.bot.config.set(ctx.guild.id, 'social.enabled', true, { by: ctx.user.id });
          return ctx.ok('social.added', { type: ctx.t(`social.platform.${type}`) });
        },
      },
      remove: {
        options: [opt.string('feed', true, { autocomplete: true })],
        autocomplete(ctx) {
          const cfg = ctx.cfg.social;
          const all = [];
          for (const k of ['youtube', 'twitch', 'bridges', 'rss', 'github']) cfg[k].forEach((s, i) => all.push({ name: clip(`${k}: ${s.name || s.channelId || s.login || s.username || s.url || s.repo}`, 100), value: `${k}:${i}` }));
          return all;
        },
        async run(ctx) {
          const [k, i] = ctx.str('feed').split(':');
          const list = ctx.cfg.social[k];
          if (!list || !list[Number(i)]) return ctx.fail('social.not_found');
          ctx.bot.config.set(ctx.guild.id, `social.${k}`, list.filter((_, n) => n !== Number(i)), { by: ctx.user.id });
          return ctx.ok('social.removed');
        },
      },
    },
  }],
};

export { UA };
