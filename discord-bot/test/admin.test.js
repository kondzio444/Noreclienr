import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AdminLink } from '../src/core/admin-link.js';

function fakeBot({ feed = { enabled: true, channel: '800000000000000001', role: '', template: '' } } = {}) {
  const sent = [], reported = [], left = [], loaded = [];
  const docs = new Map();
  const guild = (id) => ({ id, leave: async () => { left.push(id); } });
  const embed = () => { const e = { data: {} }; for (const k of ['setTitle', 'setDescription', 'setURL', 'setTimestamp']) e[k] = (v) => { e.data[k] = v; return e; }; return e; };
  const bot = {
    api: {
      botEnabled: true,
      data: null,
      admin: async () => ({ ok: true, data: bot.api.data }),
      actionDone: async (id, ok, result) => { reported.push({ id, ok, result }); return { ok: true }; },
    },
    client: { guilds: { cache: new Map([['900000000000000001', guild('900000000000000001')], ['900000000000000002', guild('900000000000000002')]]) } },
    send: async (g, channelId, payload) => { sent.push({ guildId: g.id, channelId, payload }); return channelId === 'none' ? null : { id: 'm' + sent.length }; },
    cfg: () => ({ nore: { enabled: true, announcements: feed } }),
    tg: () => (key) => (key === 'nore.announcement_template' ? '📢 **{title}** {role}' : key),
    embed,
    store: { ns: (g, n, init) => { const k = `${g}:${n}`; if (!docs.has(k)) docs.set(k, init()); return docs.get(k); }, touch() {} },
    config: { load: async (id) => { loaded.push(id); } },
    reportMeta: () => {},
    every: () => {},
  };
  return { bot, sent, reported, left, loaded };
}

const ANN = { id: 'ann1', title: 'Przerwa techniczna', body: 'Wracamy o 20:00', level: 'warning', link: 'https://noreclient.pl', startsAt: '2026-10-30T10:00:00Z' };

test('blacklist: users are blocked, a blacklisted guild is left', () => {
  const { bot, left } = fakeBot();
  const link = new AdminLink(bot);
  link.apply({ blacklist: { discord: ['222222222222222222', '900000000000000002'] }, announcements: [] });
  assert.equal(link.isBlocked('222222222222222222'), true);
  assert.equal(link.isBlocked('111111111111111111'), false);
  assert.equal(link.isBlocked(undefined), false);
  assert.deepEqual(left, ['900000000000000002']);
});

test('actions run once and are reported (ok and failed)', async () => {
  const { bot, sent, reported, loaded } = fakeBot();
  bot.api.data = {
    blacklist: { discord: [] }, announcements: [],
    actions: [
      { id: 1, type: 'message', guildId: '900000000000000001', data: { channelId: '800000000000000009', content: 'Cześć <@everyone>' } },
      { id: 2, type: 'reload', guildId: null, data: {} },
      { id: 3, type: 'message', guildId: '900000000000000099', data: { channelId: '1', content: 'x' } },
      { id: 4, type: 'teleport', data: {} },
    ],
  };
  const link = new AdminLink(bot);
  await link.poll();
  await link.poll(); // the same pending actions again: not repeated
  assert.deepEqual(reported.map(r => [r.id, r.ok]), [[1, true], [2, true], [3, false], [4, false]]);
  assert.deepEqual(sent[0].payload.allowedMentions, { parse: [] });
  assert.equal(reported[1].result.reloaded, 2); assert.equal(loaded.length, 2);
  assert.match(reported[2].result.error, /nie ma na tym serwerze|Bota nie ma/);
});

test('announcements go to the configured channel once per guild; announce forces it', async () => {
  const { bot, sent, reported } = fakeBot();
  bot.api.data = { blacklist: { discord: [] }, actions: [], announcements: [ANN] };
  const link = new AdminLink(bot);
  await link.poll();
  assert.equal(sent.length, 2);
  assert.equal(sent[0].payload.content, '📢 **Przerwa techniczna**');
  assert.equal(sent[0].payload.embeds[0].data.setURL, 'https://noreclient.pl');
  await link.poll();
  assert.equal(sent.length, 2);
  bot.api.data = { ...bot.api.data, actions: [{ id: 9, type: 'announce', guildId: '900000000000000001', data: { announcementId: 'ann1' } }] };
  await link.poll();
  assert.equal(sent.length, 3);
  assert.deepEqual(reported.at(-1), { id: 9, ok: true, result: { posted: 1 } });
});

test('nothing is posted when the feed is off', async () => {
  const { bot, sent } = fakeBot({ feed: { enabled: false, channel: '1' } });
  bot.api.data = { blacklist: { discord: [] }, actions: [], announcements: [ANN] };
  await new AdminLink(bot).poll();
  assert.equal(sent.length, 0);
});
