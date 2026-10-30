// Runs the real builder (plan → queued Discord calls → posts, panels, config bindings) against an
// in-memory fake guild, so the whole flow is exercised without a Discord connection.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Collection, ChannelType, PermissionFlagsBits } from 'discord.js';
import { Bot } from '../src/core/bot.js';
import { buildPlan, runJob } from '../src/modules/builder/index.js';
import { createBackup } from '../src/modules/backup.js';
import { loadSchema } from '../src/config/index.js';
import { validate, deepMerge } from '../src/config/validate.js';
import { FakeApi } from './helpers/fake-api.js';

const schema = loadSchema();

let seq = 100_000_000_000_000_000n;
const snowflake = () => String(seq++);
/** Permission bits as discord.js accepts them: bigint, number, string or a list of flags. */
const bits = (x) => (Array.isArray(x) ? x.reduce((a, b) => a | BigInt(b), 0n) : BigInt(x ?? 0));

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
      rawPosition: channels.size, permissionOverwrites: { cache: new Collection((d.permissionOverwrites || []).map(o => [o.id, { id: o.id, type: o.type, allow: { bitfield: bits(o.allow) }, deny: { bitfield: bits(o.deny) } }])) }, availableTags: d.availableTags || [],
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

// ------------------------------------------------------------------ builder → API (panel) → working modules

/** Bot connected to an in-memory Nore API (so config pushes are visible). */
async function botWithApi() {
  const b = await bot();
  const api = new FakeApi(b.config.defaults);
  b.api = api;
  b.config.api = api;
  b.config.pushDelay = 5;
  return { b, api };
}

async function build(b, guild, template, { size = 'full', lang = 'pl' } = {}) {
  const plan = buildPlan(b, guild, { template, lang, size, content: true, settings: true });
  const job = { id: `j-${template}`, template, size, lang, by: '123456789012345678', ops: plan.ops, index: 0, errors: [], compiledRoles: [], progressChannel: null, createdAt: Date.now() };
  b.store.guild(guild.id).builder = { map: {}, posted: [], jobs: { [job.id]: job }, current: job.id };
  return runJob(b, guild, job);
}

/** Every channel / role id in the config (by the schema's x-ui) exists in the guild. */
function danglingIds(cfg, guild, node = schema, path = '') {
  const out = [];
  const check = (n, v, p) => {
    if (n['x-ui'] === 'channel' && v && !guild.channels.cache.has(v)) out.push(p);
    if (n['x-ui'] === 'role' && v && !guild.roles.cache.has(v)) out.push(p);
  };
  if (node.type === 'object' && node.properties) {
    for (const [k, n] of Object.entries(node.properties)) if (cfg?.[k] !== undefined) out.push(...danglingIds(cfg[k], guild, n, `${path}/${k}`));
  } else if (node.type === 'array') {
    (cfg || []).forEach((v, i) => {
      if (node.items?.type === 'object') out.push(...danglingIds(v, guild, node.items, `${path}/${i}`));
      else check(node.items || {}, v, `${path}/${i}`);
    });
  } else check(node, cfg, path);
  return out;
}

function interactionFor(b, guild, { customId, channelId, values, fields, userId = '555000000000000001' }) {
  const replies = [];
  const user = { id: userId, username: 'gracz', tag: 'gracz', displayAvatarURL: () => 'https://x/a.png', send: async () => {} };
  const member = { id: userId, user, displayName: 'gracz', permissions: { bitfield: 0n, has: () => false }, roles: { cache: new Collection(), highest: { position: 1 } } };
  const i = {
    id: snowflake(), guild, guildId: guild.id, channelId, channel: guild.channels.cache.get(channelId), member, user, locale: 'pl', customId, values, replies,
    deferred: false, replied: false,
    fields: fields && { fields: new Map(Object.entries(fields)), getTextInputValue: (k) => fields[k] },
    isChatInputCommand: () => false, isAutocomplete: () => false, isMessageComponent: () => !fields, isModalSubmit: () => !!fields, isRepliable: () => true,
    async reply(p) { i.replied = true; replies.push(p); return {}; },
    async deferReply() { i.deferred = true; },
    async deferUpdate() { i.deferred = true; },
    async editReply(p) { replies.push(p); return {}; },
    async followUp(p) { replies.push(p); return {}; },
    async update(p) { replies.push(p); return {}; },
    async showModal(m) { replies.push({ modal: m.toJSON() }); },
  };
  return i;
}

test('builder: mc-server config is saved to the API (panel) – tickets enabled with valid ids – and a ticket opens', async () => {
  const { b, api } = await botWithApi();
  const guild = fakeGuild();
  b.client.guilds.cache.set(guild.id, guild);
  const res = await build(b, guild, 'mc-server');
  assert.deepEqual(res.errors, []);
  assert.equal(res.sync.ok, true, 'pushed at the end of the build');
  const map = b.store.guild(guild.id).builder.map;

  // the API (what the panel shows) got the wired config, sent by the builder
  const patches = api.patches(guild.id);
  assert.ok(patches.length >= 1);
  assert.ok(patches.every(p => p.body.reason === 'builder' && p.body.by === '123456789012345678'));
  assert.ok(patches.some(p => p.body.config.tickets?.enabled === true && p.body.config.tickets?.category === map['c:cat_tickets']), 'API client called with the tickets config');
  const remote = api.doc(guild.id);
  assert.equal(res.sync.version, remote.version);
  assert.deepEqual(validate(remote.config, schema), [], 'valid against the schema');
  assert.deepEqual(danglingIds(remote.config, guild), [], 'every channel and role id exists');
  const tk = remote.config.tickets;
  assert.equal(tk.enabled, true);
  assert.equal(guild.channels.cache.get(tk.category).type, ChannelType.GuildCategory);
  assert.equal(tk.logChannel, map['c:ticket_log']);
  assert.ok(tk.staffRoles.length >= 5);
  assert.equal(tk.panels.find(p => p.id === 'main').channel, map['c:support_info']);
  assert.ok(tk.categories.length >= 3);
  const c = remote.config;
  for (const m of ['verification', 'suggestions', 'applications', 'welcome', 'goodbye', 'logging', 'automod', 'leveling', 'starboard', 'boosts', 'minecraft', 'status', 'autorole']) assert.equal(c[m].enabled, true, `${m} enabled`);
  for (const f of ['releases', 'news', 'events']) { assert.equal(c.nore[f].enabled, true); assert.ok(c.nore[f].channel); }
  assert.equal(c.verification.channel, map['c:verify']); assert.equal(c.verification.role, map['r:member']);
  assert.equal(c.suggestions.channel, map['c:suggestions']); assert.equal(c.suggestions.reviewChannel, map['c:suggestion_review']);
  assert.equal(c.welcome.channel, map['c:greetings']);
  assert.equal(c.logging.messages, map['c:message_log']); assert.equal(c.moderation.logChannel, map['c:mod_log']);
  assert.equal(c.leveling.announceChannel, map['c:level_ups']); assert.equal(c.leveling.rewards.length, 10);
  assert.equal(c.status.servers[0].channel, map['c:server_ip']); assert.equal(c.status.board.channel, map['c:status']);
  assert.equal(c.applications.forms.find(f => f.id === 'partner').resultChannel, map['c:partners']);
  assert.deepEqual(c.autorole.botRoles, [map['r:bots']]);

  // the bot uses exactly what the panel shows; nothing left only locally
  assert.deepEqual(b.config.record(guild.id).overrides, {});
  assert.deepEqual(b.cfg(guild.id), deepMerge(b.config.defaults, remote.config));

  // ticket flow on the fake guild: panel select → modal → channel in the category, staff can see it, logged
  const panelMsg = guild.sent.find(m => m.channelId === map['c:support_info'] && JSON.stringify(m.payload).includes('ticket:select:main'));
  assert.ok(panelMsg, 'ticket panel posted');
  let i = interactionFor(b, guild, { customId: 'ticket:select:main', channelId: map['c:support_info'], values: ['support'] });
  await b.onInteraction(i);
  const modal = i.replies[0]?.modal;
  assert.ok(modal, `modal shown, got ${JSON.stringify(i.replies[0])}`);
  assert.equal(modal.custom_id, 'ticket:form:support');
  const before = new Set(guild.channels.cache.keys());
  i = interactionFor(b, guild, { customId: modal.custom_id, channelId: map['c:support_info'], fields: { q0: 'Nie mogę wejść na serwer' } });
  await b.onInteraction(i);
  assert.match(JSON.stringify(i.replies.at(-1)), /Utworzono|ticket/i);
  const created = [...guild.channels.cache.values()].filter(ch => !before.has(ch.id));
  assert.equal(created.length, 1, 'one ticket channel');
  const ticketCh = created[0];
  assert.equal(ticketCh.parentId, tk.category, 'inside the tickets category');
  const ow = ticketCh.permissionOverwrites.cache;
  assert.ok(ow.has('555000000000000001'), 'author can see it');
  assert.ok(tk.staffRoles.every(r => ow.has(r)), 'staff roles can see it');
  assert.ok((ow.get(guild.id).deny.bitfield & PermissionFlagsBits.ViewChannel) !== 0n, 'hidden from everyone');
  const open = Object.values(b.store.guild(guild.id).tickets.open);
  assert.equal(open.length, 1); assert.equal(open[0].channelId, ticketCh.id);
  assert.ok(guild.sent.some(m => m.channelId === ticketCh.id && JSON.stringify(m.payload).includes('ticket:close')), 'controls posted in the ticket');
  assert.ok(guild.sent.some(m => m.channelId === tk.logChannel), 'opening logged in the ticket log');
  b.config.stop();
});

test('builder: every template ends with a valid, fully wired config in the API', async () => {
  for (const template of ['nore-client', 'gaming', 'support']) {
    for (const size of ['small', 'full']) {
      const { b, api } = await botWithApi();
      const guild = fakeGuild();
      b.client.guilds.cache.set(guild.id, guild);
      const res = await build(b, guild, template, { size });
      assert.deepEqual(res.errors, [], `${template}/${size}`);
      assert.equal(res.sync.ok, true);
      const cfg = api.doc(guild.id).config;
      assert.deepEqual(validate(cfg, schema), [], `${template}/${size} valid`);
      assert.deepEqual(danglingIds(cfg, guild), [], `${template}/${size} ids exist`);
      assert.equal(cfg.tickets.enabled, true, `${template}/${size} tickets`);
      assert.ok(guild.channels.cache.has(cfg.tickets.category) && guild.channels.cache.has(cfg.tickets.logChannel) && cfg.tickets.staffRoles.length);
      assert.ok(guild.channels.cache.has(cfg.tickets.panels[0].channel), 'ticket panel channel');
      assert.equal(cfg.verification.enabled, true); assert.ok(cfg.verification.role && cfg.verification.channel);
      assert.deepEqual(b.config.record(guild.id).overrides, {});
      b.config.stop();
    }
  }
});

test('builder: with the API offline the config works locally and reaches the panel on reconnect', async () => {
  const { b, api } = await botWithApi();
  const guild = fakeGuild();
  b.client.guilds.cache.set(guild.id, guild);
  api.offline = true;
  const res = await build(b, guild, 'support', { size: 'small' });
  assert.equal(res.sync.ok, false); assert.equal(res.sync.offline, true);
  assert.equal(b.cfg(guild.id).tickets.enabled, true, 'works locally right away');
  assert.equal(api.doc(guild.id).version, 0);
  assert.ok(b.config.dirty.has(guild.id));
  api.offline = false;
  await b.config.flushDirty();
  assert.equal(api.doc(guild.id).config.tickets.enabled, true);
  assert.equal(api.doc(guild.id).config.tickets.category, b.cfg(guild.id).tickets.category);
  assert.deepEqual(b.config.record(guild.id).overrides, {});
  b.config.stop();
});
