/**
 * Nore Client: /nore status|download|version|news|event|player, /mc server, and the Nore feeds
 * (new releases, news posts, event start/end + reminders) posted to configurable channels.
 */
import { AttachmentBuilder, ButtonStyle } from 'discord.js';
import { opt } from '../core/commands.js';
import { EPHEMERAL, row, linkButton, embed, COLORS, errEmbed } from '../core/ui.js';
import { ts } from '../lib/duration.js';
import { clip, render, colorInt } from '../lib/template.js';
import { eventTimes, dueReminder } from '../lib/events.js';
import { serverStatus, faviconBuffer } from '../lib/mcstatus.js';
import { parseAddress } from '../lib/slp.js';
import { rememberId } from '../lib/store.js';
import { request } from '../lib/http.js';
import { logger } from '../lib/logger.js';

const log = logger.child('nore');
const NICK_RE = /^[A-Za-z0-9_]{2,16}$/;
const OS = [['win', '🪟', 'Windows'], ['linux', '🐧', 'Linux'], ['mac', '🍎', 'macOS']];

export const prettyId = (id) => String(id || '').split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

function downloadRow(t, release, site) {
  const buttons = [];
  for (const [k, emoji, label] of OS) {
    const a = release?.assets?.[k] || (k === 'mac' ? release?.assets?.macZip : null);
    if (a?.url) buttons.push(linkButton(a.url, label, emoji));
  }
  buttons.push(linkButton(`${site}/#download`, t('nore.website'), '🌐'));
  return row(...buttons.slice(0, 5));
}

function releaseEmbed(bot, guildId, t, r, { changelog = true } = {}) {
  const e = bot.embed(guildId).setTitle(`🚀 Nore ${r.version}${r.prerelease ? ' (beta)' : ''}`).setURL(r.url || `${bot.env.noreApi}`)
    .setTimestamp(r.published ? new Date(r.published) : new Date());
  if (changelog && r.notes) e.setDescription(clip(r.notes.replace(/\r/g, ''), 1800));
  const files = [];
  for (const [k, emoji, label] of OS) {
    const a = r.assets?.[k];
    if (a) files.push(`${emoji} ${label}: ${(a.size / 1048576).toFixed(1)} MB`);
  }
  if (files.length) e.addFields({ name: t('nore.files'), value: files.join('\n'), inline: true });
  if (r.downloads !== undefined) e.addFields({ name: t('nore.downloads'), value: String(r.downloads), inline: true });
  if (r.mods?.length) e.addFields({ name: t('nore.mod_files'), value: clip(r.mods.map(m => `\`${m.name}\``).join(', '), 1024) });
  return e;
}

function eventEmbed(bot, guildId, t, ev, now = Date.now()) {
  const times = eventTimes(ev, now);
  const e = embed(colorInt(ev.accent, COLORS.brand)).setTitle(`${ev.id === 'halloween' ? '🎃' : '❄️'} ${ev.name || t(`nore.event_${ev.id}`)}`);
  const lines = [];
  if (times.active) {
    lines.push(t('nore.event_active'));
    if (times.peakAt && times.peakAt > now) lines.push(t('nore.event_peak', { when: ts(times.peakAt), date: ts(times.peakAt, 'D') }));
    if (times.endsAt) lines.push(t('nore.event_ends', { when: ts(times.endsAt) }));
  } else if (times.upcoming) {
    lines.push(t('nore.event_starts', { when: ts(times.startsAt), date: ts(times.startsAt, 'F') }));
    const days = Math.ceil((times.startsAt - now) / 86_400_000);
    lines.push(t('nore.event_days_left', { count: days }));
  } else lines.push(t('nore.event_over'));
  if (ev.features?.length) lines.push('', `**${t('nore.event_features')}**`, ...ev.features.map(f => `• ${f}`));
  return e.setDescription(lines.join('\n'));
}

async function mojangProfile(name) {
  try {
    const res = await request(`https://api.mojang.com/users/profiles/minecraft/${encodeURIComponent(name)}`, { timeout: 5000 });
    return res.status === 200 && res.data?.id ? res.data : null;
  } catch { return null; }
}

export async function serverEmbed(bot, guildId, t, address, status) {
  const files = [];
  const e = bot.embed(guildId, status.online ? COLORS.ok : COLORS.error).setTitle(`${status.online ? '🟢' : '🔴'} ${address}`);
  if (!status.online) {
    e.setDescription(t(status.error === 'private_address' ? 'mc.private' : status.error === 'invalid_address' ? 'mc.invalid' : 'mc.offline'));
    return { embeds: [e], files };
  }
  e.addFields(
    { name: t('mc.players'), value: `${status.players.online} / ${status.players.max}`, inline: true },
    { name: t('mc.version'), value: clip(status.version || '?', 100), inline: true },
    { name: t('mc.latency'), value: status.latency !== null && status.latency !== undefined ? `${status.latency} ms` : '—', inline: true },
  );
  if (status.motd) e.setDescription('```\n' + clip(status.motd, 500) + '\n```');
  if (status.players.sample?.length) e.addFields({ name: t('mc.sample'), value: clip(status.players.sample.map(n => `\`${n}\``).join(' '), 1024) });
  const fav = faviconBuffer(status.favicon);
  if (fav) { files.push(new AttachmentBuilder(fav, { name: 'favicon.png' })); e.setThumbnail('attachment://favicon.png'); }
  e.setFooter({ text: t(status.source === 'api' ? 'mc.via_api' : 'mc.via_ping') }).setTimestamp();
  return { embeds: [e], files };
}

// ------------------------------------------------------------------ feeds (poll every 5 min)

async function postFeed(bot, guild, feedCfg, payload, vars, defaultKey) {
  if (!feedCfg?.enabled || !feedCfg.channel) return;
  const tg = bot.tg(guild.id);
  const role = feedCfg.role ? `<@&${feedCfg.role}>` : '';
  const content = render(feedCfg.template || tg(defaultKey), { ...vars, role }).trim();
  await bot.send(guild, feedCfg.channel, { content: content || undefined, ...payload, allowedMentions: { roles: feedCfg.role ? [feedCfg.role] : [] } });
}

async function pollNore(bot) {
  const [release, news, events] = await Promise.all([bot.api.latestRelease(), bot.api.news(), bot.api.events()]);
  const releases = release ? null : await bot.api.releases(5);
  const latest = release || releases?.[0] || null;
  for (const guild of bot.client.guilds.cache.values()) {
    const cfg = bot.cfg(guild.id).nore;
    if (!cfg.enabled) continue;
    const st = bot.store.ns(guild.id, 'nore', () => ({ releases: null, news: null, events: [] }));
    const tg = bot.tg(guild.id);
    try {
      // releases: the first look only records what exists (no flood when the feed is switched on)
      if (latest && cfg.releases.enabled && (cfg.releases.prereleases || !latest.prerelease)) {
        if (st.releases === null) st.releases = [latest.version];
        else if (rememberId(st.releases, latest.version, 50)) {
          await postFeed(bot, guild, cfg.releases, { embeds: [releaseEmbed(bot, guild.id, tg, latest, { changelog: cfg.releases.changelog })], components: [downloadRow(tg, latest, bot.env.noreApi)] },
            { version: latest.version, name: latest.name || latest.version, url: latest.url || '' }, 'nore.release_template');
        }
      }
      if (news?.length && cfg.news.enabled) {
        if (st.news === null) st.news = news.map(n => n.id);
        for (const n of [...news].reverse()) {
          if (!n.id || !rememberId(st.news, n.id, 100)) continue;
          const e = bot.embed(guild.id).setTitle(`📰 ${clip(n.title, 250)}`).setDescription(clip(n.text || '', 3000)).setURL(`${bot.env.noreApi}/#news`);
          if (n.tag) e.setFooter({ text: n.tag });
          if (n.date) e.setTimestamp(new Date(n.date));
          if (n.image) e.setImage(n.image);
          await postFeed(bot, guild, cfg.news, { embeds: [e] }, { title: n.title, tag: n.tag || '' }, 'nore.news_template');
        }
      }
      if (events?.length && cfg.events.enabled) {
        for (const ev of events) {
          const times = eventTimes(ev);
          const year = new Date(times.startsAt || Date.now()).getUTCFullYear();
          const keyStart = `${ev.id}:${year}:start`, keyEnd = `${ev.id}:${year}:end`;
          const fresh = !st.events.some(k => k.startsWith(`${ev.id}:`));
          if (fresh) { // baseline: do not announce an event that was already running when the feed was enabled
            if (times.active) rememberId(st.events, keyStart);
            st.events.push(`${ev.id}:seen`);
            continue;
          }
          if (times.active && rememberId(st.events, keyStart)) {
            await postFeed(bot, guild, cfg.events, { embeds: [eventEmbed(bot, guild.id, tg, ev)] }, { event: ev.name }, 'nore.event_start_template');
          } else if (!times.active && st.events.includes(keyStart) && rememberId(st.events, keyEnd)) {
            await postFeed(bot, guild, cfg.events, { embeds: [bot.embed(guild.id).setDescription(tg('nore.event_ended', { event: ev.name }))] }, { event: ev.name }, 'nore.event_end_template');
          } else if (cfg.events.reminders) {
            const r = dueReminder(times);
            if (r && rememberId(st.events, `${ev.id}:${year}:${r}`)) {
              await postFeed(bot, guild, cfg.events, { embeds: [eventEmbed(bot, guild.id, tg, ev)] }, { event: ev.name, when: ts(times.startsAt) }, `nore.event_reminder_${r}`);
            }
          }
        }
      }
    } catch (err) { log.warn('nore feed failed', { guildId: guild.id, err }); }
    bot.store.touch(guild.id);
  }
}

// ------------------------------------------------------------------ module

export default {
  name: 'nore',
  ready(bot) {
    setTimeout(() => pollNore(bot).catch(err => log.warn('poll failed', { err })), 20_000).unref?.();
    bot.every(5 * 60_000, () => pollNore(bot), 'nore-feeds');
  },
  commands: [
    {
      name: 'nore', category: 'nore',
      subs: {
        status: {
          async run(ctx) {
            await ctx.defer(false);
            const [status, hub, latest] = await Promise.all([ctx.bot.api.status(), ctx.bot.api.hubStats(), ctx.bot.api.latestRelease()]);
            const t = ctx.t;
            const e = ctx.bot.embed(ctx.guild.id, status?.ok ? COLORS.ok : COLORS.error).setTitle(t('nore.status_title'))
              .addFields(
                { name: t('nore.api'), value: status?.ok ? t('nore.up') : t('nore.down'), inline: true },
                { name: t('nore.latest'), value: latest?.version || status?.latest || '—', inline: true },
                { name: t('nore.players_online'), value: hub ? String(hub.online ?? hub.players?.online ?? '—') : '—', inline: true },
                { name: t('nore.players_known'), value: hub ? String(hub.known ?? hub.players?.known ?? '—') : '—', inline: true },
              );
            if (status?.sync?.at) e.addFields({ name: t('nore.last_sync'), value: ts(Date.parse(status.sync.at)), inline: true });
            e.setFooter({ text: ctx.bot.env.noreApi.replace(/^https?:\/\//, '') }).setTimestamp();
            return ctx.reply({ embeds: [e] });
          },
        },
        download: {
          async run(ctx) {
            await ctx.defer(false);
            const r = await ctx.bot.api.latestRelease();
            const e = ctx.bot.embed(ctx.guild.id).setTitle(t2(ctx, 'nore.download_title')).setDescription(ctx.t('nore.download_text', { version: r?.version || '?' }))
              .setThumbnail(`${ctx.bot.env.noreApi}/assets/logo.png`);
            return ctx.reply({ embeds: [e], components: [downloadRow(ctx.t, r, ctx.bot.env.noreApi)] });
          },
        },
        version: {
          async run(ctx) {
            await ctx.defer(false);
            const r = await ctx.bot.api.latestRelease();
            if (!r) return ctx.reply({ embeds: [errEmbed(ctx.t('nore.api_unavailable'))] });
            return ctx.reply({ embeds: [releaseEmbed(ctx.bot, ctx.guild.id, ctx.t, r)], components: [downloadRow(ctx.t, r, ctx.bot.env.noreApi)] });
          },
        },
        news: {
          async run(ctx) {
            await ctx.defer(false);
            const news = await ctx.bot.api.news();
            if (!news) return ctx.reply({ embeds: [errEmbed(ctx.t('nore.api_unavailable'))] });
            const e = ctx.bot.embed(ctx.guild.id).setTitle(ctx.t('nore.news_title')).setURL(`${ctx.bot.env.noreApi}/#news`);
            for (const n of news.slice(0, 5)) e.addFields({ name: `${n.tag ? `[${n.tag}] ` : ''}${clip(n.title, 200)}`, value: `${clip(n.text || '', 300)}${n.date ? `\n${ts(Date.parse(n.date), 'D')}` : ''}` });
            return ctx.reply({ embeds: [e] });
          },
        },
        event: {
          async run(ctx) {
            await ctx.defer(false);
            let events = await ctx.bot.api.events();
            if (!events?.length) events = [{ id: 'halloween', name: ctx.t('nore.event_halloween') }, { id: 'christmas', name: ctx.t('nore.event_christmas') }];
            return ctx.reply({ embeds: events.slice(0, 5).map(ev => eventEmbed(ctx.bot, ctx.guild.id, ctx.t, ev)) });
          },
        },
        player: {
          options: [opt.string('nick', true, { min: 2, max: 16 })],
          async run(ctx) {
            const nick = ctx.str('nick');
            if (!NICK_RE.test(nick)) return ctx.fail('nore.bad_nick');
            await ctx.defer(false);
            const [p, mojang] = await Promise.all([ctx.bot.api.player(nick), mojangProfile(nick)]);
            const t = ctx.t;
            const name = p?.name || mojang?.name || nick;
            const head = mojang?.id || p?.uuid || name;
            const isNore = !!(p && (p.nore ?? !!p.hex));
            const e = ctx.bot.embed(ctx.guild.id, isNore ? COLORS.brand : COLORS.muted)
              .setAuthor({ name, iconURL: `https://mc-heads.net/avatar/${head}/64` })
              .setThumbnail(`https://mc-heads.net/body/${head}/right`)
              .addFields(
                { name: t('player.nore'), value: isNore ? t('player.yes_nore') : t('player.no_nore'), inline: true },
                { name: t('player.premium'), value: mojang ? '✅' : '❌', inline: true },
              );
            if (isNore) {
              e.addFields(
                { name: t('player.verified'), value: p.verified ? t('player.verified_yes') : t('player.verified_no'), inline: true },
                { name: t('player.online'), value: p.online ? t('player.online_now') : p.seen ? t('player.seen', { when: ts(p.seen) }) : '—', inline: true },
              );
              const slots = Object.entries(p.cosmetics?.slots || {});
              e.addFields({ name: t('player.wardrobe'), value: slots.length ? clip(slots.map(([slot, c]) => `• **${t(`cosmetic.slot.${slot}`) === `cosmetic.slot.${slot}` ? prettyId(slot) : t(`cosmetic.slot.${slot}`)}**: ${prettyId(c.id)}${typeof c.color === 'number' ? ` \`#${c.color.toString(16).padStart(6, '0')}\`` : ''}${c.variant ? ` (${prettyId(c.variant)})` : ''}`).join('\n'), 1024) : t('player.wardrobe_empty') });
              if (p.hex) e.setFooter({ text: `Nore ID: NORE-${p.hex.slice(0, 5).toUpperCase()}-…` });
            } else if (!p) e.setFooter({ text: t('nore.api_unavailable') });
            const components = [row(linkButton(`https://namemc.com/profile/${encodeURIComponent(name)}`, 'NameMC', '🔎'), linkButton(`${ctx.bot.env.noreApi}/#download`, t('player.get_nore'), '🟣'))];
            return ctx.reply({ embeds: [e], components });
          },
        },
      },
    },
    {
      name: 'mc', category: 'nore',
      subs: {
        server: {
          options: [opt.string('address', true, { max: 255 })],
          async run(ctx) {
            const address = ctx.str('address').trim();
            if (!parseAddress(address)) return ctx.fail('mc.invalid');
            await ctx.defer(false);
            const status = await serverStatus(ctx.bot.api, address);
            return ctx.reply(await serverEmbed(ctx.bot, ctx.guild.id, ctx.t, address, status));
          },
        },
      },
    },
  ],
};

const t2 = (ctx, k) => ctx.t(k);
export { releaseEmbed, downloadRow, eventEmbed };
