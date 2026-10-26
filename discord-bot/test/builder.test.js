// Runs the real builder (plan → queued Discord calls → posts, panels, config bindings) against an
// in-memory fake guild, so the whole flow is exercised without a Discord connection.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Collection, ChannelType, PermissionFlagsBits } from 'discord.js';
import { Bot } from '../src/core/bot.js';
import { buildPlan, runJob } from '../src/modules/builder/index.js';
import { createBackup } from '../src/modules/backup.js';

let seq = 100_000_000_000_000_000n;
const snowflake = () => String(seq++);

function fakeGuild({ community = false } = {}) {
  const sent = [];
  const roles = new Collection();
  const channels = new Collection();
  const guild = {
    id: snowflake(), name: 'Test', features: community ? ['COMMUNITY'] : [], verificationLevel: 0, explicitContentFilter: 0, defaultMessageNotifications: 0,
    afkTimeout: 300, afkChannelId: null, systemChannelId: null, rulesChannelId: null, publicUpdatesChannelId: null, description: null, maximumBitrate: 96000,
    iconURL: () => null,
    sent,
  };
  guild.roles = {
    cache: roles,
    everyone: null,
    async create(d) {
      const r = { id: snowflake(), name: d.name, color: d.colors?.primaryColor ?? 0, hoist: d.hoist, mentionable: d.mentionable, position: roles.size + 1, managed: false, permissions: { bitfield: BigInt(d.permissions ?? 0) }, editable: true, members: new Collection() };
      r.toString = () => `<@&${r.id}>`;
      roles.set(r.id, r);
      return r;
    },
    async setPositions(list) { for (const { role, position } of list) roles.get(role).position = position; },
  };
  const everyone = { id: guild.id, name: '@everyone', color: 0, position: 0, managed: false, permissions: { bitfield: 0n } };
  roles.set(guild.id, everyone);
  guild.roles.everyone = everyone;
  guild.members = { me: { id: 'bot', permissions: { bitfield: PermissionFlagsBits.Administrator, has: () => true }, roles: { highest: { position: 1000 } } }, cache: new Collection(), fetch: async () => null };
  const mkChannel = (d) => {
    const ch = {
      id: snowflake(), name: d.name, type: d.type, parentId: d.parent || null, topic: d.topic || '', rateLimitPerUser: d.rateLimitPerUser || 0, nsfw: !!d.nsfw,
      rawPosition: channels.size, permissionOverwrites: { cache: new Collection((d.permissionOverwrites || []).map(o => [o.id, { id: o.id, type: o.type, allow: { bitfield: BigInt(o.allow) }, deny: { bitfield: BigInt(o.deny) } }])) }, availableTags: d.availableTags || [],
      guild, isThread: () => false, isTextBased: () => [ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildVoice].includes(d.type),
      permissionsFor: () => ({ has: () => true }),
      async send(p) { const m = { id: snowflake(), channelId: ch.id, url: `https://discord.com/channels/${guild.id}/${ch.id}`, payload: p, pin: async () => { m.pinned = true; }, react: async () => {}, edit: async () => m }; sent.push(m); return m; },
      messages: { fetch: async () => null },
      async delete() { channels.delete(ch.id); },
    };
    ch.toString = () => `<#${ch.id}>`;
    return ch;
  };
  guild.channels = {
    cache: channels,
    async create(d) { if ([ChannelType.GuildForum, ChannelType.GuildAnnouncement, ChannelType.GuildStageVoice].includes(d.type) && !guild.features.includes('COMMUNITY')) throw new Error('needs community'); const ch = mkChannel(d); channels.set(ch.id, ch); return ch; },
    async setPositions() {},
    async fetch(id) { return channels.get(id) || null; },
  };
  guild.edit = async (d) => {
    if (d.features) guild.features = d.features;
    for (const k of ['rulesChannel', 'publicUpdatesChannel', 'afkChannel', 'systemChannel']) {
      if (d[k] === '1') { const ch = await guild.channels.create({ name: k, type: ChannelType.GuildText }); guild[`${k}Id`] = ch.id; } else if (d[k]) guild[`${k}Id`] = d[k];
    }
    for (const k of ['verificationLevel', 'explicitContentFilter', 'defaultMessageNotifications', 'afkTimeout']) if (d[k] !== undefined) guild[k] = d[k];
    return guild;
  };
  return guild;
}

async function bot() {
  const b = await new Bot({ env: { noreApi: 'https://noreclient.pl', dataDir: '/tmp/none', botSecret: '' }, dryRun: true }).init();
  b.queueSpacingMs = 0;
  b.client = { guilds: { cache: new Collection() }, user: { id: 'bot' } };
  return b;
}

test('builder: full MC.noreclient.pl server on a fresh guild, then an idempotent repair', async () => {
  const b = await bot();
  const guild = fakeGuild();
  b.client.guilds.cache.set(guild.id, guild);
  const plan = buildPlan(b, guild, { template: 'mc-server', lang: 'pl', size: 'full', content: true, settings: true });
  assert.deepEqual(plan.problems, []);
  assert.equal(plan.ops[0].op, 'community.early');
  const job = { id: 'j1', template: 'mc-server', size: 'full', lang: 'pl', ops: plan.ops, index: 0, errors: [], compiledRoles: plan.compiled.layout.roles.filter(r => !r.separator).map(r => ({ key: r.key, base: r.base, n: r.n, item: r.item })), progressChannel: null, createdAt: Date.now() };
  b.store.guild(guild.id).builder = { map: {}, posted: [], jobs: { j1: job }, current: 'j1' };
  const res = await runJob(b, guild, job);
  assert.equal(res.status, 'done');
  assert.deepEqual(res.errors, []);
  // layout
  assert.equal(guild.roles.cache.size - 1, plan.compiled.layout.roles.length);
  const created = guild.channels.cache.filter(c => !['rulesChannel', 'publicUpdatesChannel'].includes(c.name));
  assert.equal(created.size, plan.compiled.layout.channels.length, 'every channel, placeholders removed');
  assert.ok(guild.channels.cache.some(c => c.type === ChannelType.GuildForum), 'Community enabled first → real forums');
  assert.ok(guild.features.includes('COMMUNITY'));
  // config bound to the created channels and roles
  const cfg = b.cfg(guild.id);
  const st = b.store.guild(guild.id).builder;
  assert.equal(cfg.verification.role, st.map['r:member']);
  assert.equal(cfg.verification.channel, st.map['c:verify']);
  assert.equal(cfg.tickets.category, st.map['c:cat_tickets']);
  assert.equal(cfg.moderation.logChannel, st.map['c:mod_log']);
  assert.equal(cfg.applications.forms.find(f => f.id === 'partner').resultChannel, st.map['c:partners']);
  assert.equal(cfg.applications.forms.find(f => f.id === 'staff').role, st.map['r:trial']);
  assert.equal(cfg.minecraft.address, 'MC.noreclient.pl');
  assert.equal(cfg.status.servers[0].channel, st.map['c:server_ip']);
  assert.equal(cfg.minecraft.rankRoles.length, 5);
  assert.equal(cfg.leveling.rewards.length, 10);
  assert.ok(cfg.roles.menus.find(m => m.id === 'pings').roles.length >= 5);
  assert.ok(cfg.general.staffRoles.length >= 5);
  assert.equal(cfg.tickets.enabled, true);
  assert.equal(guild.rulesChannelId, st.map['c:rules']);
  // content and panels were posted (rules pinned, verification button, ticket select, self-role menus)
  const inCh = (key) => guild.sent.filter(m => m.channelId === st.map[`c:${key}`]);
  assert.ok(inCh('rules')[0].pinned);
  assert.ok(inCh('rules')[0].payload.embeds.length >= 3);
  assert.ok(inCh('verify').some(m => JSON.stringify(m.payload).includes('verify:start')));
  assert.ok(inCh('support_info').some(m => JSON.stringify(m.payload).includes('ticket:select:main')));
  assert.ok(inCh('roles').some(m => JSON.stringify(m.payload).includes('sr:')));
  assert.ok(inCh('partner_info').some(m => JSON.stringify(m.payload).includes('app:start:partner')));
  // rerun: nothing to create
  const again = buildPlan(b, guild, { template: 'mc-server', lang: 'pl', size: 'full', content: true, settings: false, update: true });
  assert.equal(again.summary.create.roles, 0);
  assert.equal(again.summary.create.channels, 0);
  assert.equal(again.ops.filter(o => o.op === 'post').length, 0, 'content is not posted twice');
  // backups capture the built layout
  const bk = createBackup(b, guild, { label: 't' });
  assert.equal(bk.layout.roles.length, plan.compiled.layout.roles.length);
});

test('builder: small Nore Client server in English', async () => {
  const b = await bot();
  const guild = fakeGuild({ community: true });
  b.client.guilds.cache.set(guild.id, guild);
  const plan = buildPlan(b, guild, { template: 'nore-client', lang: 'en', size: 'small', content: true, settings: true });
  const job = { id: 'j2', template: 'nore-client', size: 'small', lang: 'en', ops: plan.ops, index: 0, errors: [], compiledRoles: [], progressChannel: null, createdAt: Date.now() };
  b.store.guild(guild.id).builder = { map: {}, posted: [], jobs: { j2: job }, current: 'j2' };
  const res = await runJob(b, guild, job);
  assert.deepEqual(res.errors, []);
  assert.ok(guild.channels.cache.some(c => c.name === '📜┃rules'));
  assert.equal(b.cfg(guild.id).general.language, 'en');
  assert.equal(b.cfg(guild.id).nore.releases.channel, b.store.guild(guild.id).builder.map['c:nore_updates']);
});
