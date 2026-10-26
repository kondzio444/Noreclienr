import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Bot } from '../src/core/bot.js';
import { lintCommand, requiredKeys } from '../src/core/commands.js';
import { has } from '../src/i18n/index.js';
import { matches } from '../src/modules/custom.js';
import { isDue, zoned } from '../src/modules/scheduled.js';
import { makeCaptcha } from '../src/modules/verification.js';
import { pickWinners } from '../src/modules/giveaways.js';
import { tally } from '../src/modules/polls.js';
import { recordCheck, uptime } from '../src/modules/status.js';
import { bridgeUrl, githubUrl, subscriptions } from '../src/modules/social.js';
import { makeCode, normUuid } from '../src/modules/minecraft.js';
import { discoveryChecklist, onboardingFromMenus } from '../src/modules/community.js';
import { formQuestions } from '../src/modules/applications.js';
import { translator } from '../src/i18n/index.js';
import { htmlTranscript, escapeHtml } from '../src/lib/transcript.js';

const env = { noreApi: 'https://noroclient.pl', dataDir: '/tmp/none', botSecret: '' };

test('every command builds, passes Discord limits and is translated in pl and en', async () => {
  const bot = await new Bot({ env, dryRun: true }).init();
  const json = bot.commandJson();
  assert.ok(json.length >= 50 && json.length <= 100, `${json.length} commands`);
  for (const c of json) assert.deepEqual(lintCommand(c), [], c.name);
  for (const def of bot.commands.values()) for (const k of requiredKeys(def)) for (const l of ['pl', 'en']) assert.ok(has(l, k, { exact: true }), `${l} ${k}`);
  const help = json.find(c => c.name === 'help');
  assert.equal(help.name_localizations.pl, 'pomoc');
  assert.equal(help.description_localizations.pl, 'Pokaż komendy bota');
  assert.equal(json.find(c => c.name === 'ban').default_member_permissions, String(1n << 2n));
});

test('custom command matching', () => {
  assert.ok(matches({ trigger: 'rules', match: 'command' }, '!rules', '!'));
  assert.ok(matches({ trigger: 'rules', match: 'command' }, '!RULES please', '!'));
  assert.ok(!matches({ trigger: 'rules', match: 'command' }, '!rulesx', '!'));
  assert.ok(matches({ trigger: 'hello', match: 'exact' }, ' Hello ', '!'));
  assert.ok(matches({ trigger: 'ip', match: 'word' }, 'what is the IP?', '!'));
  assert.ok(!matches({ trigger: 'ip', match: 'word' }, 'shipping', '!'));
  assert.ok(matches({ trigger: 'ip', match: 'contains' }, 'shipping', '!'));
});

test('scheduled messages', () => {
  const tz = 'Europe/Warsaw';
  const at = Date.parse('2026-10-26T11:00:00Z'); // 12:00 in Warsaw (CET)
  assert.equal(zoned(at, tz).hm, '12:00');
  assert.ok(isDue({ mode: 'daily', time: '12:00' }, at, null, tz));
  assert.ok(isDue({ mode: 'daily', time: '12:00' }, at + 3 * 60_000, null, tz), 'grace window');
  assert.ok(!isDue({ mode: 'daily', time: '12:00' }, at + 10 * 60_000, null, tz));
  assert.ok(!isDue({ mode: 'daily', time: '12:00' }, at, at - 60_000, tz), 'already sent today');
  assert.ok(isDue({ mode: 'weekly', time: '12:00', weekday: 1 }, at, null, tz), 'Monday');
  assert.ok(!isDue({ mode: 'weekly', time: '12:00', weekday: 2 }, at, null, tz));
  assert.ok(isDue({ mode: 'interval', everyMinutes: 30 }, at, at - 31 * 60_000, tz));
  assert.ok(!isDue({ mode: 'interval', everyMinutes: 30 }, at, at - 10 * 60_000, tz));
});

test('captcha, giveaway draw, poll tally', () => {
  const c = makeCaptcha((a) => a); // deterministic: op '+', 2 + 2
  assert.deepEqual(c, { question: '2 + 2', answer: 4 });
  for (let i = 0; i < 50; i++) { const r = makeCaptcha(); assert.equal(typeof r.answer, 'number'); assert.ok(r.answer >= 0); }
  const w = pickWinners(['a', 'b', 'b', 'c'], 2);
  assert.equal(w.length, 2);
  assert.equal(new Set(w).size, 2);
  assert.deepEqual(pickWinners([], 3), []);
  assert.deepEqual(tally({ options: ['x', 'y'], votes: { u1: [0], u2: [0, 1] } }), { counts: [2, 1], voters: 2 });
});

test('status uptime buckets', () => {
  const svc = {};
  const h = 3_600_000;
  recordCheck(svc, true, 0); recordCheck(svc, false, 1000); recordCheck(svc, true, h + 1);
  assert.equal(svc.streak, 0);
  assert.equal(Math.round(uptime(svc, 24, h + 2)), 67);
});

test('social feed URLs and subscriptions', () => {
  assert.equal(bridgeUrl('', 'tiktok', 'x'), null);
  assert.match(bridgeUrl('https://rb.example', 'tiktok', '@nore'), /bridge=TikTokBridge.*username=%40nore/);
  assert.match(bridgeUrl('https://rb.example', 'instagram', 'nore'), /InstagramBridge/);
  assert.equal(githubUrl('kondzio444/Noreclienr', 'releases'), 'https://github.com/kondzio444/Noreclienr/releases.atom');
  assert.equal(githubUrl('a/b', 'commits', 'main'), 'https://github.com/a/b/commits/main.atom');
  const subs = subscriptions({ youtube: [{ channelId: 'UC1234567890123456789012', channel: '1' }], bridges: [{ platform: 'x', username: 'n', channel: '1' }], rss: [{ url: 'https://f', channel: '2' }], github: [], twitch: [] }, '');
  assert.deepEqual(subs.map(s => s.kind), ['youtube', 'rss'], 'bridges skipped without RSS_BRIDGE_URL');
  assert.equal(new Set(subs.map(s => s.key)).size, 2);
});

test('Minecraft link codes and UUIDs', () => {
  assert.match(makeCode(), /^NORE-\d{6}$/);
  assert.equal(normUuid('0123ABCD-0123-4567-89ab-0123456789AB'), '0123abcd0123456789ab0123456789ab');
});

test('community helpers', () => {
  const list = discoveryChecklist({ features: ['COMMUNITY'], createdTimestamp: 0, memberCount: 50, verificationLevel: 2, explicitContentFilter: 2, mfaLevel: 1, rulesChannelId: '1', publicUpdatesChannelId: '2', description: 'x', icon: 'i', onboardingEnabled: false }, 100 * 7 * 86_400_000);
  assert.deepEqual(list.filter(x => !x.ok).map(x => x.key), ['members', 'onboarding']);
  const roles = new Map([['1', { name: 'Ping' }]]);
  const ob = onboardingFromMenus([{ id: 'pings', title: 'Pings', multiple: true, roles: [{ role: '1', label: '', emoji: '🔔' }, { role: '9' }] }], roles, ['a', 'b']);
  assert.equal(ob.prompts.length, 1);
  assert.deepEqual(ob.prompts[0].options.map(o => [o.title, o.role_ids[0], o.emoji_name]), [['Ping', '1', '🔔']]);
  assert.equal(ob.prompts[0].single_select, false);
});

test('application default questions and transcripts', () => {
  assert.equal(formQuestions(translator('pl'), 'pl', { id: 'staff', questions: [] }).length, 5);
  assert.equal(formQuestions(translator('en'), 'en', { id: 'whatever', questions: [] }).length, 2);
  assert.equal(formQuestions(translator('en'), 'en', { id: 'x', questions: [{ label: 'Q', style: 'short', required: true }] })[0].label, 'Q');
  const html = htmlTranscript({ title: 'T <x>', guild: 'G', channel: 'c', messages: [{ author: { name: 'A', avatar: 'u', bot: false }, content: '**hi** <script>', createdAt: 0, attachments: [], embeds: [] }] });
  assert.ok(html.includes('<b>hi</b> &lt;script&gt;'));
  assert.ok(!html.includes('<script>'));
  assert.equal(escapeHtml('"&'), '&quot;&amp;');
});
