/**
 * Minecraft server integration (docs/minecraft-integration.md):
 *  - Minecraft ⇄ Discord chat bridge (server plugin → POST /mc/v1/chat, Discord → GET /mc/v1/outbox),
 *  - account linking with a one-time code (/link in Discord ⇄ /discord link <code> in game, both ways),
 *  - role sync from in-game ranks (POST /mc/v1/ranks) and nickname sync.
 * The HTTP API listens on MC_BRIDGE_PORT (off when empty); each guild has its own token
 * (`/minecraft token`), sent as `Authorization: Bearer <guildId>.<secret>`.
 */
import http from 'node:http';
import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { opt } from '../core/commands.js';
import { EPHEMERAL, okEmbed } from '../core/ui.js';
import { render, clip, escapeMd } from '../lib/template.js';
import { ts } from '../lib/duration.js';
import { logger } from '../lib/logger.js';

const log = logger.child('minecraft');
const NAME_RE = /^[A-Za-z0-9_]{2,16}$/;
const UUID_RE = /^[0-9a-f]{32}$/;
const CODE_TTL = 10 * 60_000;
const outbox = new Map(); // guildId -> { seq, items: [] }
const webhooks = new Map(); // channelId -> webhook

const mc = (bot, gid) => {
  const s = bot.store.ns(gid, 'minecraft', () => ({ tokenHash: null, links: {}, byUuid: {}, codes: {} }));
  s.links ??= {}; s.byUuid ??= {}; s.codes ??= {};
  return s;
};
const sha = (s) => createHash('sha256').update(s).digest('hex');
export const normUuid = (u) => String(u || '').toLowerCase().replace(/-/g, '');

/** "NORE-482913" style codes (pure). */
export function makeCode(rnd = randomInt) { return `NORE-${String(rnd(0, 1_000_000)).padStart(6, '0')}`; }

function sweepCodes(st) {
  for (const [c, v] of Object.entries(st.codes)) if (Date.now() - v.at > CODE_TTL) delete st.codes[c];
}

/** Links a Discord user and a Minecraft account; applies linked role and nickname. */
async function link(bot, guild, discordId, uuid, name) {
  const st = mc(bot, guild.id);
  const old = st.links[discordId];
  if (old) delete st.byUuid[old.uuid];
  const prevOwner = st.byUuid[uuid];
  if (prevOwner) delete st.links[prevOwner];
  st.links[discordId] = { uuid, name, at: Date.now() };
  st.byUuid[uuid] = discordId;
  bot.store.touch(guild.id);
  const cfg = bot.cfg(guild.id).minecraft;
  const member = await guild.members.fetch(discordId).catch(() => null);
  if (member) {
    if (cfg.linkedRole) await member.roles.add(cfg.linkedRole, 'Minecraft account linked').catch(() => {});
    if (cfg.syncNicknames && member.manageable) await member.setNickname(render(cfg.nicknameTemplate || '{name}', { name, discord: member.user.username }).slice(0, 32), 'Minecraft nickname').catch(() => {});
  }
  bot.audit(guild.id, 'minecraft_link', { discordId, uuid, name });
  return member;
}

async function syncRanks(bot, guild, discordId, ranks) {
  const cfg = bot.cfg(guild.id).minecraft;
  const member = await guild.members.fetch(discordId).catch(() => null);
  if (!member) return { added: [], removed: [] };
  const want = new Set(ranks.map(r => String(r).toLowerCase()));
  const top = guild.members.me.roles.highest.position;
  const added = [], removed = [];
  for (const m of cfg.rankRoles) {
    const role = guild.roles.cache.get(m.role);
    if (!role || role.position >= top) continue;
    const should = want.has(m.rank.toLowerCase());
    if (should && !member.roles.cache.has(role.id)) { await member.roles.add(role.id, 'Minecraft rank').catch(() => {}); added.push(role.id); }
    if (!should && member.roles.cache.has(role.id)) { await member.roles.remove(role.id, 'Minecraft rank').catch(() => {}); removed.push(role.id); }
  }
  return { added, removed };
}

async function bridgeWebhook(bot, channel) {
  let wh = webhooks.get(channel.id);
  if (wh) return wh;
  const hooks = await channel.fetchWebhooks().catch(() => null);
  wh = hooks?.find(h => h.owner?.id === bot.client.user.id && h.name === 'Nore Bridge') || await channel.createWebhook({ name: 'Nore Bridge', reason: 'Minecraft chat bridge' }).catch(() => null);
  if (wh) webhooks.set(channel.id, wh);
  return wh;
}

// ------------------------------------------------------------------ HTTP API

function readBody(req, max = 16_384) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > max) { reject(Object.assign(new Error('too large'), { status: 413 })); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch { reject(Object.assign(new Error('bad json'), { status: 400 })); } });
    req.on('error', reject);
  });
}

function authGuild(bot, req) {
  const m = /^Bearer (\d{17,20})\.([A-Za-z0-9_-]{20,})$/.exec(req.headers.authorization || '');
  if (!m) return null;
  const guild = bot.client.guilds.cache.get(m[1]);
  if (!guild) return null;
  const st = mc(bot, guild.id);
  if (!st.tokenHash) return null;
  const a = Buffer.from(sha(m[2]), 'hex'), b = Buffer.from(st.tokenHash, 'hex');
  return a.length === b.length && timingSafeEqual(a, b) ? guild : null;
}

const hits = new Map();
function limited(key) {
  const now = Date.now();
  const h = hits.get(key) || { n: 0, at: now };
  if (now - h.at > 1000) { h.n = 0; h.at = now; }
  h.n++; hits.set(key, h);
  return h.n > 25;
}

export function startBridge(bot) {
  const port = Number(process.env.MC_BRIDGE_PORT || 0);
  if (!port) return null;
  const shard = bot.client.shard?.ids?.[0] ?? 0;
  if (shard !== 0) return null;
  const server = http.createServer(async (req, res) => {
    const send = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); };
    try {
      const url = new URL(req.url, 'http://bridge');
      const guild = authGuild(bot, req);
      if (!guild) return send(401, { error: 'unauthorized' });
      if (limited(guild.id)) return send(429, { error: 'rate_limited' });
      const cfg = bot.cfg(guild.id).minecraft;
      if (!cfg.enabled) return send(403, { error: 'module_disabled' });
      const st = mc(bot, guild.id);
      const p = url.pathname.replace(/\/+$/, '');
      if (req.method === 'GET' && p === '/mc/v1/ping') return send(200, { ok: true, guild: guild.name, chat: !!cfg.chatChannel });
      if (req.method === 'POST' && p === '/mc/v1/chat') {
        const b = await readBody(req);
        if (!cfg.chatChannel) return send(409, { error: 'no_chat_channel' });
        const type = ['chat', 'join', 'leave', 'death', 'advancement', 'server_start', 'server_stop'].includes(b.type) ? b.type : 'chat';
        const player = NAME_RE.test(b.player || '') ? b.player : null;
        if (type === 'chat' && (!player || !b.message)) return send(400, { error: 'player and message required' });
        const ch = await bot.channel(guild, cfg.chatChannel);
        if (!ch) return send(409, { error: 'chat_channel_missing' });
        const tg = bot.tg(guild.id);
        const text = clip(String(b.message || ''), 1900).replace(/@(everyone|here)/g, '@​$1');
        if (type === 'chat') {
          const wh = await bridgeWebhook(bot, ch);
          const avatar = `https://mc-heads.net/avatar/${UUID_RE.test(normUuid(b.uuid)) ? normUuid(b.uuid) : player}/64`;
          if (wh) await wh.send({ username: `${player} · MC`, avatarURL: avatar, content: text, allowedMentions: { parse: [] } });
          else await bot.send(guild, ch.id, { content: `**${escapeMd(player)}**: ${text}`, allowedMentions: { parse: [] } });
        } else {
          await bot.send(guild, ch.id, { content: tg(`mc.bridge.${type}`, { player: escapeMd(player || '?'), message: text }), allowedMentions: { parse: [] } });
        }
        return send(200, { ok: true });
      }
      if (req.method === 'GET' && p === '/mc/v1/outbox') {
        const box = outbox.get(guild.id) || { seq: 0, items: [] };
        const after = Number(url.searchParams.get('after') || 0);
        return send(200, { messages: box.items.filter(m => m.seq > after), next: box.seq });
      }
      if (req.method === 'POST' && p === '/mc/v1/link') {
        const b = await readBody(req);
        const uuid = normUuid(b.uuid);
        if (!UUID_RE.test(uuid) || !NAME_RE.test(b.name || '')) return send(400, { error: 'uuid and name required' });
        sweepCodes(st);
        const code = String(b.code || '').toUpperCase();
        const entry = st.codes[code];
        if (!entry || entry.kind !== 'discord') return send(404, { error: 'invalid_code' });
        delete st.codes[code];
        const member = await link(bot, guild, entry.discordId, uuid, b.name);
        return send(200, { ok: true, discordId: entry.discordId, discordName: member?.user.username ?? null });
      }
      if (req.method === 'POST' && p === '/mc/v1/link/request') {
        const b = await readBody(req);
        const uuid = normUuid(b.uuid);
        if (!UUID_RE.test(uuid) || !NAME_RE.test(b.name || '')) return send(400, { error: 'uuid and name required' });
        sweepCodes(st);
        const code = makeCode();
        st.codes[code] = { kind: 'minecraft', uuid, name: b.name, at: Date.now() };
        bot.store.touch(guild.id);
        return send(200, { code, expiresIn: CODE_TTL / 1000 });
      }
      const linked = /^\/mc\/v1\/linked\/([0-9a-fA-F-]{32,36})$/.exec(p);
      if (req.method === 'GET' && linked) {
        const id = st.byUuid[normUuid(linked[1])];
        if (!id) return send(200, { linked: false });
        const member = await guild.members.fetch(id).catch(() => null);
        return send(200, { linked: true, discordId: id, discordName: member?.user.username ?? null, roles: member ? member.roles.cache.filter(r => r.id !== guild.id).map(r => r.name) : [] });
      }
      if (req.method === 'POST' && p === '/mc/v1/ranks') {
        const b = await readBody(req);
        const id = st.byUuid[normUuid(b.uuid)];
        if (!id) return send(404, { error: 'not_linked' });
        if (!Array.isArray(b.ranks)) return send(400, { error: 'ranks must be an array' });
        return send(200, { ok: true, ...(await syncRanks(bot, guild, id, b.ranks.slice(0, 50))) });
      }
      return send(404, { error: 'not_found' });
    } catch (err) {
      log.warn('bridge request failed', { err: err.message });
      return send(err.status || 500, { error: err.status ? err.message : 'internal' });
    }
  });
  server.on('error', (err) => log.error('bridge server error', { err: err.message }));
  server.listen(port, process.env.MC_BRIDGE_HOST || '0.0.0.0', () => log.info('Minecraft bridge listening', { port }));
  return server;
}

let server = null;

export default {
  name: 'minecraft',
  ready(bot) { server = startBridge(bot); },
  stop() { server?.close(); },
  events: {
    async messageCreate(bot, message) {
      if (!message.guild || message.author.bot || message.webhookId) return;
      const cfg = bot.cfg(message.guild.id).minecraft;
      if (!cfg.enabled || message.channelId !== cfg.chatChannel || !message.content) return;
      const box = outbox.get(message.guild.id) || { seq: 0, items: [] };
      box.seq++;
      box.items.push({ seq: box.seq, author: message.member?.displayName || message.author.username, discordId: message.author.id, content: clip(message.cleanContent, 256), at: message.createdTimestamp });
      if (box.items.length > 200) box.items.shift();
      outbox.set(message.guild.id, box);
    },
  },
  commands: [
    {
      name: 'link', category: 'nore',
      options: [opt.string('code', false, { max: 16 })],
      async run(ctx) {
        const st = mc(ctx.bot, ctx.guild.id);
        sweepCodes(st);
        const given = ctx.str('code')?.toUpperCase().trim();
        if (given) {
          const entry = st.codes[given];
          if (!entry || entry.kind !== 'minecraft') return ctx.fail('mclink.bad_code');
          delete st.codes[given];
          await link(ctx.bot, ctx.guild, ctx.user.id, entry.uuid, entry.name);
          return ctx.ok('mclink.linked', { name: entry.name });
        }
        for (const [c, v] of Object.entries(st.codes)) if (v.discordId === ctx.user.id) delete st.codes[c];
        const code = makeCode();
        st.codes[code] = { kind: 'discord', discordId: ctx.user.id, at: Date.now() };
        ctx.bot.store.touch(ctx.guild.id);
        const linked = st.links[ctx.user.id];
        return ctx.reply({ embeds: [ctx.bot.embed(ctx.guild.id).setTitle(ctx.t('mclink.title')).setDescription(ctx.t('mclink.instructions', { code, address: ctx.cfg.minecraft.address || 'MC.noreclient.pl', expires: ts(Date.now() + CODE_TTL) }) + (linked ? `\n\n${ctx.t('mclink.current', { name: linked.name })}` : ''))], flags: EPHEMERAL });
      },
    },
    {
      name: 'unlink', category: 'nore',
      async run(ctx) {
        const st = mc(ctx.bot, ctx.guild.id);
        const l = st.links[ctx.user.id];
        if (!l) return ctx.fail('mclink.not_linked');
        delete st.byUuid[l.uuid]; delete st.links[ctx.user.id];
        ctx.bot.store.touch(ctx.guild.id);
        const role = ctx.cfg.minecraft.linkedRole;
        if (role) await ctx.member.roles.remove(role).catch(() => {});
        return ctx.ok('mclink.unlinked', { name: l.name });
      },
    },
    {
      name: 'minecraft', category: 'server', perms: ['ManageGuild'], module: null,
      subs: {
        token: {
          async run(ctx) {
            const { confirm } = await import('../core/ui.js');
            const st = mc(ctx.bot, ctx.guild.id);
            if (st.tokenHash && !(await confirm(ctx, { text: ctx.t('mclink.token_replace') }))) return;
            const secret = randomBytes(24).toString('base64url');
            st.tokenHash = sha(secret);
            ctx.bot.store.touch(ctx.guild.id);
            ctx.bot.audit(ctx.guild.id, 'minecraft_token', { by: ctx.user.id });
            const port = process.env.MC_BRIDGE_PORT;
            const payload = { embeds: [okEmbed(ctx.t('mclink.token', { token: `${ctx.guild.id}.${secret}`, port: port || '—' }))], flags: EPHEMERAL };
            return ctx.i.replied ? ctx.i.followUp(payload) : ctx.reply(payload);
          },
        },
        status: {
          async run(ctx) {
            const st = mc(ctx.bot, ctx.guild.id);
            const cfg = ctx.cfg.minecraft;
            const e = ctx.bot.embed(ctx.guild.id).setTitle(ctx.t('mclink.status_title')).addFields(
              { name: ctx.t('mclink.bridge'), value: server ? `🟢 :${process.env.MC_BRIDGE_PORT}` : `⚫ ${ctx.t('mclink.bridge_off')}`, inline: true },
              { name: ctx.t('mclink.token_set'), value: st.tokenHash ? '✅' : '❌', inline: true },
              { name: ctx.t('mclink.linked_count'), value: String(Object.keys(st.links).length), inline: true },
              { name: ctx.t('panel.minecraft.chatChannel'), value: cfg.chatChannel ? `<#${cfg.chatChannel}>` : '—', inline: true },
              { name: ctx.t('panel.minecraft.address'), value: cfg.address || '—', inline: true },
            );
            return ctx.reply({ embeds: [e], flags: EPHEMERAL });
          },
        },
        unlink: {
          options: [opt.user('user', true)],
          async run(ctx) {
            const st = mc(ctx.bot, ctx.guild.id);
            const u = ctx.userOpt('user');
            const l = st.links[u.id];
            if (!l) return ctx.fail('mclink.not_linked');
            delete st.byUuid[l.uuid]; delete st.links[u.id];
            ctx.bot.store.touch(ctx.guild.id);
            ctx.bot.audit(ctx.guild.id, 'minecraft_unlink', { target: u.id, by: ctx.user.id });
            return ctx.ok('mclink.unlinked', { name: l.name });
          },
        },
        whois: {
          options: [opt.user('user', true)],
          async run(ctx) {
            const l = mc(ctx.bot, ctx.guild.id).links[ctx.userOpt('user').id];
            return l ? ctx.info('mclink.whois', { user: `${ctx.userOpt('user')}`, name: l.name, uuid: l.uuid, when: ts(l.at) }) : ctx.fail('mclink.not_linked');
          },
        },
      },
    },
  ],
};
