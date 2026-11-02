// Slash commands through the real interaction router with fake interactions (no Discord connection).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Collection, PermissionFlagsBits, ChannelType } from 'discord.js';
import { Bot } from '../src/core/bot.js';
import { FakeApi } from './helpers/fake-api.js';

const GUILD = '900000000000000001';
const sent = [];

function fakeWorld() {
  const channel = {
    id: '900000000000000010', name: 'ogólny', type: ChannelType.GuildText, guild: null, parentId: null,
    isTextBased: () => true, isThread: () => false, permissionsFor: () => ({ has: () => true }),
    async send(p) { const m = { id: String(Date.now()), channelId: channel.id, url: 'https://discord.com/x', payload: p }; sent.push(m); return m; },
  };
  const roles = new Collection([[GUILD, { id: GUILD, name: '@everyone', position: 0 }]]);
  const guild = {
    id: GUILD, name: 'Nore Test', ownerId: 'owner', memberCount: 42, features: [],
    channels: { cache: new Collection([[channel.id, channel]]), fetch: async (id) => (id === channel.id ? channel : null) },
    roles: { cache: roles },
    members: { me: { id: 'bot', permissions: { bitfield: PermissionFlagsBits.Administrator, has: () => true }, roles: { highest: { position: 100 } } }, fetch: async () => null },
    iconURL: () => null,
  };
  channel.guild = guild;
  return { guild, channel };
}

function member(id, { admin = true, top = 50 } = {}) {
  return {
    id, displayName: id, user: { id, username: id, tag: id, displayAvatarURL: () => 'https://x/a.png', send: async () => {} },
    permissions: { bitfield: admin ? PermissionFlagsBits.Administrator : 0n, has: () => admin },
    roles: { cache: new Collection(), highest: { position: top } },
    moderatable: true, kickable: true, bannable: true,
    timeout: async () => {}, kick: async () => {},
  };
}

function interaction(world, { name, sub = null, group = null, options = {}, user = 'admin', admin = true, locale = 'pl' }) {
  const replies = [];
  const m = member(user, { admin });
  const target = options.user ? member(options.user, { admin: false, top: 1 }) : null;
  const i = {
    id: String(Math.random()), guild: world.guild, guildId: GUILD, channelId: world.channel.id, channel: world.channel,
    member: m, user: m.user, locale, commandName: name, deferred: false, replied: false, replies,
    isChatInputCommand: () => true, isAutocomplete: () => false, isMessageComponent: () => false, isModalSubmit: () => false, isRepliable: () => true,
    options: {
      getSubcommandGroup: () => group, getSubcommand: () => sub,
      getString: (k) => (typeof options[k] === 'string' ? options[k] : null),
      getInteger: (k) => (Number.isInteger(options[k]) ? options[k] : null),
      getNumber: (k) => (typeof options[k] === 'number' ? options[k] : null),
      getBoolean: (k) => (typeof options[k] === 'boolean' ? options[k] : null),
      getUser: (k) => (k === 'user' && target ? target.user : null),
      getMember: (k) => (k === 'user' ? target : null),
      getChannel: () => null, getRole: () => null, getAttachment: () => null, getMentionable: () => null,
    },
    async reply(p) { i.replied = true; replies.push(p); return { resource: { message: { id: 'm1', channelId: world.channel.id } } }; },
    async deferReply() { i.deferred = true; },
    async editReply(p) { replies.push(p); return { id: 'm1', channelId: world.channel.id }; },
    async followUp(p) { replies.push(p); return {}; },
    async fetchReply() { return { id: 'm1', channelId: world.channel.id }; },
    async showModal(mod) { replies.push({ modal: mod.toJSON() }); },
  };
  return i;
}

const text = (p) => JSON.stringify(p);

test('router: commands run end to end with permissions, config and translations', async () => {
  const bot = await new Bot({ env: { noreApi: 'https://noreclient.pl', dataDir: '/tmp/none', botSecret: '' }, dryRun: true }).init();
  const world = fakeWorld();
  bot.client = { guilds: { cache: new Collection([[GUILD, world.guild]]) }, user: { id: 'bot' }, ws: { ping: 42 } };

  let i = interaction(world, { name: 'help' });
  await bot.onInteraction(i);
  assert.match(text(i.replies[0]), /Nore Bot – pomoc/);

  i = interaction(world, { name: 'help', locale: 'en-US' });
  await bot.onInteraction(i);
  assert.match(text(i.replies[0]), /Nore Bot – help/, 'ephemeral replies follow the member locale');

  i = interaction(world, { name: 'config', sub: 'set', options: { key: 'welcome.channel', value: '<#900000000000000010>' } });
  await bot.onInteraction(i);
  assert.match(text(i.replies[0]), /Zapisano/);
  assert.equal(bot.cfg(GUILD).welcome.channel, '900000000000000010');

  i = interaction(world, { name: 'config', sub: 'set', options: { key: 'leveling.xpMin', value: '99999' } });
  await bot.onInteraction(i);
  assert.match(text(i.replies[0]), /Niepoprawna wartość/);

  i = interaction(world, { name: 'config', sub: 'show', options: { module: 'welcome' } });
  await bot.onInteraction(i);
  assert.match(text(i.replies[0]), /<#900000000000000010>/);

  // a member without permissions is refused with a translated permission name
  i = interaction(world, { name: 'config', sub: 'set', admin: false, user: 'pleb', options: { key: 'welcome.enabled', value: 'on' } });
  await bot.onInteraction(i);
  assert.match(text(i.replies[0]), /Zarządzanie serwerem/);

  // moderation: warn creates case #1 and logs to the mod log
  bot.config.set(GUILD, 'moderation.logChannel', '900000000000000010');
  i = interaction(world, { name: 'warn', options: { user: 'victim', reason: 'spam' } });
  await bot.onInteraction(i);
  assert.match(text(i.replies[0]), /ostrzeżenie/);
  assert.match(text(i.replies[0]), /Sprawa #1/);
  assert.ok(sent.some(m => text(m.payload).includes('Sprawa #1')), 'posted to the mod log');

  // a disabled module answers with a friendly error
  bot.config.set(GUILD, 'polls.enabled', false);
  i = interaction(world, { name: 'poll', sub: 'create', options: { question: 'Q?', options: 'a|b' } });
  await bot.onInteraction(i);
  assert.match(text(i.replies[0]), /wyłączony/);

  // reminders schedule a timer
  i = interaction(world, { name: 'remind', sub: 'me', options: { when: '10m', text: 'test' } });
  await bot.onInteraction(i);
  assert.match(text(i.replies[0]), /Przypomnę ci/);
  assert.equal(bot.scheduler.list(GUILD, t => t.type === 'reminder').length, 1);

  // suggestions are off by default
  i = interaction(world, { name: 'suggest' });
  await bot.onInteraction(i);
  assert.match(text(i.replies[0]), /Propozycje jest wyłączony/);

  // unknown errors never crash the process – the user gets the generic message
  const orig = bot.commands.get('ping').run;
  bot.commands.get('ping').run = async () => { throw new Error('boom'); };
  i = interaction(world, { name: 'ping' });
  await bot.onInteraction(i);
  assert.match(text(i.replies.at(-1)), /Coś poszło nie tak/);
  bot.commands.get('ping').run = orig;
});

test('router: /config changes reach the panel (API) and /config show shows what the panel saved', async () => {
  const bot = await new Bot({ env: { noreApi: 'https://noreclient.pl', dataDir: '/tmp/none', botSecret: '' }, dryRun: true }).init();
  const api = new FakeApi(bot.config.defaults);
  bot.api = api; bot.config.api = api; bot.config.pushDelay = 5;
  const world = fakeWorld();
  bot.client = { guilds: { cache: new Collection([[GUILD, world.guild]]) }, user: { id: 'bot' }, ws: { ping: 42 } };

  let i = interaction(world, { name: 'config', sub: 'set', options: { key: 'tickets.category', value: '900000000000000010' } });
  await bot.onInteraction(i);
  i = interaction(world, { name: 'config', sub: 'module', options: { module: 'tickets', enabled: true } });
  await bot.onInteraction(i);
  await bot.config.flush(GUILD);
  const saved = api.doc(GUILD);
  assert.equal(saved.config.tickets.category, '900000000000000010');
  assert.equal(saved.config.tickets.enabled, true);
  assert.ok(api.patches(GUILD).every(p => p.body.reason === 'command'));

  // somebody saves in the panel; /config show fetches it at once (no waiting for the poll)
  api.panelSave(GUILD, { tickets: { maxOpen: 7, logChannel: '900000000000000010' } });
  i = interaction(world, { name: 'config', sub: 'show', options: { module: 'tickets' } });
  await bot.onInteraction(i);
  const shown = text(i.replies[0]);
  assert.match(shown, /maxOpen` · [^:]+: 7/);
  assert.match(shown, /logChannel` · [^:]+: <#900000000000000010>/);
  assert.match(shown, /enabled` · [^:]+: ✅/);
  i = interaction(world, { name: 'config', sub: 'show' });
  await bot.onInteraction(i);
  assert.match(text(i.replies[0]), new RegExp(`(Wersja z panelu|Panel version) ${api.doc(GUILD).version}`));
  bot.config.stop();
});
