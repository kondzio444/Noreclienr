/**
 * Status: Nore services (API, Nore Hub, website) with incident start/resolve messages and uptime,
 * Minecraft server monitors (online/offline notifications, optional live status message edited every
 * minute) and a live "status board" message. Checks run once per minute.
 */
import { opt } from '../core/commands.js';
import { EPHEMERAL, embed, COLORS, row, linkButton } from '../core/ui.js';
import { request } from '../lib/http.js';
import { serverStatus } from '../lib/mcstatus.js';
import { rememberId } from '../lib/store.js';
import { render, clip } from '../lib/template.js';
import { ts, formatDuration } from '../lib/duration.js';
import { serverEmbed } from './nore.js';

export const SERVICES = ['api', 'hub', 'website'];
const HOUR = 3_600_000;

/** Uptime bookkeeping with hourly buckets (pure, unit-tested). */
export function recordCheck(svc, ok, now = Date.now(), keepHours = 24 * 30) {
  const hour = Math.floor(now / HOUR);
  svc.buckets ??= [];
  let b = svc.buckets.at(-1);
  if (!b || b.h !== hour) { b = { h: hour, ok: 0, n: 0 }; svc.buckets.push(b); }
  b.n++; if (ok) b.ok++;
  while (svc.buckets.length && svc.buckets[0].h < hour - keepHours) svc.buckets.shift();
  svc.streak = ok ? 0 : (svc.streak || 0) + 1;
  svc.okSince = ok ? (svc.okSince || now) : null;
  svc.lastCheck = now;
  svc.ok = ok;
}

export function uptime(svc, hours, now = Date.now()) {
  const from = Math.floor(now / HOUR) - hours;
  let ok = 0, n = 0;
  for (const b of svc.buckets || []) if (b.h > from) { ok += b.ok; n += b.n; }
  return n ? (ok / n) * 100 : null;
}

const global = (bot) => {
  const doc = bot.store.global(`status-${bot.client?.shard?.ids?.[0] ?? 0}`);
  doc.services ??= Object.fromEntries(SERVICES.map(s => [s, { buckets: [], streak: 0, incident: null }]));
  return doc;
};

async function check(bot, name) {
  const base = bot.env.noreApi;
  try {
    if (name === 'api') {
      const s = await bot.api.public('/status', '/status', { ttl: 0 });
      return !!(s && (s.ok ?? true));
    }
    if (name === 'hub') return !!(await request(`${base}/api/v1/hub/stats`, { timeout: 8000 })).data;
    if (name === 'website') return (await request(`${base}/`, { timeout: 8000, json: false })).status < 400;
  } catch { return false; }
  return false;
}

async function checkServices(bot) {
  const g = global(bot);
  for (const name of SERVICES) {
    const svc = g.services[name];
    const ok = await check(bot, name);
    recordCheck(svc, ok);
    // a global incident starts after 2 failures; guilds decide when to announce with their threshold
    if (!ok && svc.streak >= 1 && !svc.incident) svc.incident = { id: `${name}-${Date.now()}`, startedAt: Date.now() - 60_000 };
    if (ok && svc.incident) { svc.lastIncident = { ...svc.incident, resolvedAt: Date.now() }; svc.incident = null; }
  }
  bot.store.touchGlobal(`status-${bot.client?.shard?.ids?.[0] ?? 0}`);
}

function serviceLine(t, name, svc) {
  const up = uptime(svc, 24), up7 = uptime(svc, 24 * 7);
  return `${svc.ok === false ? '🔴' : svc.ok ? '🟢' : '⚪'} **${t(`status.svc.${name}`)}** · 24h ${up === null ? '—' : up.toFixed(2) + '%'} · 7d ${up7 === null ? '—' : up7.toFixed(2) + '%'}${svc.incident ? ` · ${t('status.down_since', { when: ts(svc.incident.startedAt) })}` : ''}`;
}

async function announceIncidents(bot, guild) {
  const cfg = bot.cfg(guild.id).status;
  if (!cfg.enabled || !cfg.services.enabled || !cfg.services.channel) return;
  const g = global(bot);
  const st = bot.store.ns(guild.id, 'status', () => ({ incidents: [], servers: {}, board: null }));
  const tg = bot.tg(guild.id);
  const role = cfg.services.role ? `<@&${cfg.services.role}>` : '';
  for (const name of SERVICES) {
    const svc = g.services[name];
    const inc = svc.incident;
    if (inc && svc.streak >= cfg.services.failuresBeforeIncident && rememberId(st.incidents, `${inc.id}:start`, 200)) {
      const text = render(cfg.services.downTemplate || cfg.services.template || tg('status.tpl_down'), { service: tg(`status.svc.${name}`), role, since: ts(inc.startedAt) });
      await bot.send(guild, cfg.services.channel, { content: text, embeds: [embed(COLORS.error).setTitle(`🔴 ${tg('status.incident_title', { service: tg(`status.svc.${name}`) })}`).setDescription(tg('status.incident_text', { since: ts(inc.startedAt) })).setTimestamp()], allowedMentions: { roles: cfg.services.role ? [cfg.services.role] : [] } });
    }
    const last = svc.lastIncident;
    if (!inc && last && st.incidents.includes(`${last.id}:start`) && rememberId(st.incidents, `${last.id}:end`, 200)) {
      const text = render(cfg.services.upTemplate || tg('status.tpl_up'), { service: tg(`status.svc.${name}`), role, duration: formatDuration(last.resolvedAt - last.startedAt) });
      await bot.send(guild, cfg.services.channel, { content: text, embeds: [embed(COLORS.ok).setTitle(`🟢 ${tg('status.resolved_title', { service: tg(`status.svc.${name}`) })}`).setDescription(tg('status.resolved_text', { duration: formatDuration(last.resolvedAt - last.startedAt) })).setTimestamp()], allowedMentions: { roles: [] } });
    }
  }
  bot.store.touch(guild.id);
}

async function liveMessage(bot, guild, st, key, channelId, payload) {
  const rec = st[key];
  const ch = await bot.channel(guild, channelId);
  if (!ch) return;
  let msg = rec && rec.channelId === channelId ? await ch.messages.fetch(rec.messageId).catch(() => null) : null;
  if (msg) { await msg.edit(payload).catch(() => {}); return; }
  msg = await bot.send(guild, channelId, payload);
  if (msg) { st[key] = { channelId, messageId: msg.id }; bot.store.touch(guild.id); }
}

async function monitorServers(bot, guild) {
  const cfg = bot.cfg(guild.id).status;
  const st = bot.store.ns(guild.id, 'status', () => ({ incidents: [], servers: {}, board: null }));
  st.servers ??= {}; st.live ??= {};
  const tg = bot.tg(guild.id);
  const results = [];
  for (const s of cfg.servers) {
    if (!s.address) continue;
    const status = await serverStatus(bot.api, s.address, { maxAge: 50_000 });
    results.push({ s, status });
    const key = s.address.toLowerCase();
    const prev = st.servers[key];
    const now = { online: !!status.online, since: prev && prev.online === !!status.online ? prev.since : Date.now(), fails: status.online ? 0 : (prev?.fails || 0) + 1 };
    // require 2 failed pings before calling a server offline (one lost packet is not an outage)
    const confirmedOffline = !status.online && now.fails >= 2;
    if (prev && s.notify && s.channel) {
      if (status.online && prev.announced === 'offline') {
        await bot.send(guild, s.channel, { content: render(tg('status.tpl_server_up'), { server: s.name || s.address, role: s.role ? `<@&${s.role}>` : '' }), allowedMentions: { roles: s.role ? [s.role] : [] } });
        now.announced = 'online';
      } else if (confirmedOffline && prev.announced !== 'offline') {
        await bot.send(guild, s.channel, { content: render(tg('status.tpl_server_down'), { server: s.name || s.address, role: s.role ? `<@&${s.role}>` : '' }), allowedMentions: { roles: s.role ? [s.role] : [] } });
        now.announced = 'offline';
      } else now.announced = prev.announced;
    } else now.announced = status.online ? 'online' : prev?.announced ?? null;
    st.servers[key] = now;
    if (s.live && s.channel) {
      const p = await serverEmbed(bot, guild.id, tg, s.name || s.address, status);
      p.files = []; // no favicon re-upload every minute
      p.embeds[0].setThumbnail(null);
      p.embeds[0].setDescription(`${p.embeds[0].data.description || ''}\n\n\`${s.address}\`\n${tg('status.updated', { when: ts(Date.now()) })}`.trim());
      await liveMessage(bot, guild, st.live, `srv:${key}`, s.channel, { ...p, attachments: [] });
    }
  }
  bot.store.touch(guild.id);
  return results;
}

async function board(bot, guild, results) {
  const cfg = bot.cfg(guild.id).status;
  if (!cfg.board.enabled || !cfg.board.channel) return;
  const st = bot.store.ns(guild.id, 'status', () => ({}));
  st.live ??= {};
  const tg = bot.tg(guild.id);
  const g = global(bot);
  const e = bot.embed(guild.id).setTitle(tg('status.board_title')).setTimestamp();
  if (cfg.board.services) e.addFields({ name: tg('status.board_services'), value: SERVICES.map(n => serviceLine(tg, n, g.services[n])).join('\n') });
  if (cfg.board.servers && results.length) {
    e.addFields({ name: tg('status.board_servers'), value: clip(results.map(({ s, status }) => `${status.online ? '🟢' : '🔴'} **${s.name || s.address}** \`${s.address}\`${status.online ? ` · ${status.players.online}/${status.players.max} · ${clip(status.version || '', 30)}` : ''}`).join('\n'), 1024) });
  }
  e.setFooter({ text: tg('status.board_footer') });
  await liveMessage(bot, guild, st.live, 'board', cfg.board.channel, { embeds: [e], components: [row(linkButton(`${bot.env.noreApi}`, 'noreclient.pl', '🌐'))] });
}

export default {
  name: 'status',
  ready(bot) {
    bot.every(60_000, async () => {
      const any = bot.client.guilds.cache.some(g => bot.cfg(g.id).status.enabled);
      if (!any) return;
      await checkServices(bot);
      for (const guild of bot.client.guilds.cache.values()) {
        const cfg = bot.cfg(guild.id).status;
        if (!cfg.enabled) continue;
        await announceIncidents(bot, guild);
        const results = await monitorServers(bot, guild);
        await board(bot, guild, results);
      }
    }, 'status');
  },
  commands: [{
    name: 'status', category: 'nore', module: null,
    subs: {
      services: {
        async run(ctx) {
          await ctx.defer(false);
          const g = global(ctx.bot);
          if (!g.services.api.lastCheck || Date.now() - g.services.api.lastCheck > 120_000) await checkServices(ctx.bot);
          const e = ctx.bot.embed(ctx.guild.id).setTitle(ctx.t('status.board_services')).setDescription(SERVICES.map(n => serviceLine(ctx.t, n, g.services[n])).join('\n')).setTimestamp();
          return ctx.reply({ embeds: [e] });
        },
      },
      board: {
        perms: ['ManageGuild'],
        options: [opt.channel('channel', true, { channelTypes: ['text', 'announcement'] })],
        async run(ctx) {
          ctx.bot.config.set(ctx.guild.id, 'status.board.channel', ctx.channelOpt('channel').id, { by: ctx.user.id });
          ctx.bot.config.set(ctx.guild.id, 'status.board.enabled', true, { by: ctx.user.id });
          ctx.bot.config.set(ctx.guild.id, 'status.enabled', true, { by: ctx.user.id });
          await checkServices(ctx.bot);
          await board(ctx.bot, ctx.guild, await monitorServers(ctx.bot, ctx.guild));
          return ctx.ok('status.board_set', { channel: `${ctx.channelOpt('channel')}` });
        },
      },
      monitor: {
        perms: ['ManageGuild'],
        options: [opt.string('address', true, { max: 255 }), opt.channel('channel', true, { channelTypes: ['text', 'announcement'] }), opt.string('name', false, { max: 100 }), opt.bool('live'), opt.role('role')],
        async run(ctx) {
          const list = structuredClone(ctx.cfg.status.servers).filter(s => s.address.toLowerCase() !== ctx.str('address').toLowerCase());
          list.push({ address: ctx.str('address'), name: ctx.str('name') || '', channel: ctx.channelOpt('channel').id, role: ctx.roleOpt('role')?.id || '', notify: true, live: !!ctx.bool('live') });
          const res = ctx.bot.config.set(ctx.guild.id, 'status.servers', list, { by: ctx.user.id });
          if (!res.ok) return ctx.fail('config.invalid_schema', { key: 'status.servers', details: res.errors.map(e => `${e.pointer} ${e.message}`).join('; ') });
          ctx.bot.config.set(ctx.guild.id, 'status.enabled', true, { by: ctx.user.id });
          return ctx.ok('status.monitor_added', { address: ctx.str('address') });
        },
      },
      unmonitor: {
        perms: ['ManageGuild'],
        options: [opt.string('address', true, { autocomplete: true })],
        autocomplete: (ctx) => ctx.cfg.status.servers.map(s => ({ name: s.name ? `${s.name} (${s.address})` : s.address, value: s.address })),
        async run(ctx) {
          ctx.bot.config.set(ctx.guild.id, 'status.servers', ctx.cfg.status.servers.filter(s => s.address !== ctx.str('address')), { by: ctx.user.id });
          return ctx.ok('status.monitor_removed', { address: ctx.str('address') });
        },
      },
    },
  }],
};

export { EPHEMERAL };
