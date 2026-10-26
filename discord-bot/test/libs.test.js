import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDuration, formatDuration, ts } from '../src/lib/duration.js';
import { render, escapeMd, clip, colorInt } from '../src/lib/template.js';
import { xpToNext, totalXpForLevel, levelFromXp, grantXp, rewardsFor, progressBar, rollXp } from '../src/lib/xp.js';
import { AutoModEngine, normalizeText, findInvites, findDomains, domainAllowed, findBadWord, capsRatio, isNewAccount } from '../src/lib/automod.js';
import { missingPermissions, hierarchyCheck, canManageRole, bitsOf, hasRoleOrPerm } from '../src/lib/permissions.js';
import { parseFeed, decodeEntities } from '../src/lib/feedparse.js';
import { eventTimes, dueReminder } from '../src/lib/events.js';
import { Backoff } from '../src/lib/http.js';
import { Scheduler } from '../src/core/scheduler.js';
import { Store, rememberId } from '../src/lib/store.js';
import { PermissionFlagsBits as P } from 'discord.js';

test('parseDuration', () => {
  assert.equal(parseDuration('10m'), 600_000);
  assert.equal(parseDuration('1h30m'), 5_400_000);
  assert.equal(parseDuration('1h 15m'), 4_500_000);
  assert.equal(parseDuration('2d'), 172_800_000);
  assert.equal(parseDuration('1w'), 604_800_000);
  assert.equal(parseDuration('90'), 5_400_000);
  assert.equal(parseDuration('30', { defaultUnit: 's' }), 30_000);
  assert.equal(parseDuration('2g'), 7_200_000, 'Polish g = godzina');
  assert.equal(parseDuration('1.5h'), 5_400_000);
  assert.equal(parseDuration('abc'), null);
  assert.equal(parseDuration('10x'), null);
  assert.equal(parseDuration(''), null);
});

test('formatDuration and ts', () => {
  assert.equal(formatDuration(90_061_000), '1d 1h 1m');
  assert.equal(formatDuration(45_000), '45s');
  assert.equal(formatDuration(0), '0s');
  assert.equal(ts(1_700_000_000_000), '<t:1700000000:R>');
});

test('template rendering', () => {
  assert.equal(render('Hi {user} on {server}! {missing}', { user: '<@1>', server: 'Nore' }), 'Hi <@1> on Nore! {missing}');
  assert.equal(render('{a.b}', { a: { b: 2 } }), '2');
  assert.equal(escapeMd('*x* @everyone'), '\\*x\\* @​everyone');
  assert.equal(clip('abcdef', 4), 'abc…');
  assert.equal(colorInt('#9d5cff'), 0x9d5cff);
  assert.equal(colorInt('bad', 1), 1);
});

test('XP math', () => {
  assert.equal(xpToNext(0), 100);
  assert.equal(xpToNext(1), 155);
  assert.equal(totalXpForLevel(0), 0);
  assert.equal(totalXpForLevel(1), 100);
  assert.equal(totalXpForLevel(5), 1150);
  assert.deepEqual(levelFromXp(0), { level: 0, current: 0, needed: 100, total: 0 });
  assert.equal(levelFromXp(1150).level, 5);
  assert.equal(levelFromXp(1149).level, 4);
  for (let l = 0; l < 60; l++) assert.equal(levelFromXp(totalXpForLevel(l)).level, l);
  assert.equal(rollXp(15, 25, 1, () => 0), 15);
  assert.equal(rollXp(15, 25, 2, () => 0.9999), 50);
  const rec = { xp: 90 };
  const r1 = grantXp(rec, { now: 1000, cooldownMs: 60_000, min: 20, max: 20 });
  assert.deepEqual([r1.gained, r1.leveledUp, r1.to], [20, true, 1]);
  const r2 = grantXp(rec, { now: 2000, cooldownMs: 60_000, min: 20, max: 20 });
  assert.equal(r2.gained, 0, 'cooldown');
  const rewards = [{ level: 10, role: 'b' }, { level: 5, role: 'a' }, { level: 20, role: 'c' }];
  assert.deepEqual(rewardsFor(12, rewards).map(r => r.role), ['a', 'b']);
  assert.deepEqual(rewardsFor(12, rewards, false).map(r => r.role), ['b']);
  assert.equal(progressBar(5, 10, 10), '▰▰▰▰▰▱▱▱▱▱');
});

test('AutoMod helpers', () => {
  assert.equal(normalizeText('KuUuRRRWa 1337 Żółć'), 'kuurrwa ieet zolc');
  assert.deepEqual(findInvites('join discord.gg/abc123 and discord.com/invite/xyz'), ['abc123', 'xyz']);
  assert.deepEqual(findDomains('see https://www.youtube.com/watch?v=1 and evil.xyz/path'), ['youtube.com', 'evil.xyz']);
  assert.ok(domainAllowed('m.youtube.com', ['youtube.com']));
  assert.ok(!domainAllowed('youtube.com.evil.io', ['youtube.com']));
  assert.equal(findBadWord('ty k*rwo', ['kurw*']), null);
  assert.equal(findBadWord('ty kurwo jedna', ['kurw*']), 'kurw*');
  assert.equal(findBadWord('IDIOTA!', ['idiota']), 'idiota');
  assert.equal(findBadWord('xxidiotaxx', ['idiota']), null);
  assert.equal(findBadWord('xxidiotaxx', ['*idiota*']), '*idiota*');
  assert.equal(findBadWord('1d10t4', ['idiota']), 'idiota', 'leetspeak');
  assert.deepEqual(capsRatio('HELLO world'), { percent: 50, letters: 10 });
  assert.ok(isNewAccount(Date.now() - 86_400_000, 3));
  assert.ok(!isNewAccount(Date.now() - 5 * 86_400_000, 3));
});

test('AutoMod engine rules', () => {
  const cfg = {
    enabled: true,
    spam: { enabled: true, maxMessages: 3, perSeconds: 5, action: 'timeout' },
    duplicates: { enabled: true, max: 3, action: 'delete' },
    mentions: { enabled: true, max: 3, action: 'warn' },
    invites: { enabled: true, allowed: ['nore'], action: 'delete' },
    links: { enabled: true, allowList: ['noroclient.pl'], action: 'delete' },
    badWords: { enabled: true, words: ['noob*'], action: 'warn' },
    caps: { enabled: true, minLength: 8, percent: 70, action: 'delete' },
    raid: { enabled: true, joins: 3, perSeconds: 10 },
  };
  const e = new AutoModEngine();
  const m = (content, extra = {}) => ({ guildId: 'g', authorId: 'u', content, mentions: 0, ...extra });
  assert.equal(e.check(m('hello'), cfg, 0), null);
  assert.equal(e.check(m('discord.gg/nore'), cfg, 10_000), null, 'allowed invite');
  assert.equal(e.check(m('discord.gg/other'), cfg, 20_000).rule, 'invites');
  assert.equal(e.check(m('https://noroclient.pl ok'), cfg, 30_000), null);
  assert.equal(e.check(m('go to https://scam.xyz'), cfg, 40_000).rule, 'links');
  assert.equal(e.check(m('you noobs'), cfg, 50_000).rule, 'badWords');
  assert.equal(e.check(m('THIS IS LOUD TEXT'), cfg, 60_000).rule, 'caps');
  assert.equal(e.check(m('hi', { mentions: 4 }), cfg, 70_000).rule, 'mentions');
  e.reset('g', 'u');
  assert.equal(e.check(m('same msg'), cfg, 100_000), null);
  assert.equal(e.check(m('same msg'), cfg, 107_000), null);
  assert.equal(e.check(m('same msg'), cfg, 114_000).rule, 'duplicates');
  e.reset('g', 'u');
  const hits = [1, 2, 3, 4].map(i => e.check(m(`msg ${i}`), cfg, 200_000 + i * 100));
  assert.equal(hits[3].rule, 'spam');
  assert.equal(hits[3].action, 'timeout');
  assert.equal(e.check(m('x'), { ...cfg, enabled: false }), null);
  assert.equal(e.recordJoin('g', cfg.raid, 0), false);
  assert.equal(e.recordJoin('g', cfg.raid, 1000), false);
  assert.equal(e.recordJoin('g', cfg.raid, 2000), true);
  assert.equal(e.recordJoin('h', cfg.raid, 50_000), false);
});

test('permission helpers', () => {
  const bits = P.SendMessages | P.ViewChannel;
  assert.deepEqual(missingPermissions(bits, ['SendMessages', 'BanMembers']), ['BanMembers']);
  assert.deepEqual(missingPermissions(P.Administrator, ['BanMembers', 'ManageGuild']), []);
  assert.equal(bitsOf(['BanMembers', 'KickMembers']), P.BanMembers | P.KickMembers);
  assert.throws(() => bitsOf(['Nope']));
  const base = { actorId: 'a', targetId: 't', ownerId: 'o', botId: 'b', actorTop: 10, targetTop: 5, botTop: 20 };
  assert.equal(hierarchyCheck(base), null);
  assert.equal(hierarchyCheck({ ...base, targetId: 'a' }), 'self');
  assert.equal(hierarchyCheck({ ...base, targetId: 'o' }), 'owner');
  assert.equal(hierarchyCheck({ ...base, targetId: 'b' }), 'bot_self');
  assert.equal(hierarchyCheck({ ...base, targetTop: 10 }), 'actor_hierarchy');
  assert.equal(hierarchyCheck({ ...base, actorId: 'o', targetTop: 15 }), null, 'owner outranks');
  assert.equal(hierarchyCheck({ ...base, actorId: 'o', targetTop: 25 }), 'bot_hierarchy');
  assert.ok(canManageRole({ botTop: 5, rolePosition: 3 }));
  assert.ok(!canManageRole({ botTop: 5, rolePosition: 5 }));
  assert.ok(!canManageRole({ botTop: 5, rolePosition: 1, managed: true }));
  assert.ok(hasRoleOrPerm(['r1'], 0n, ['r1']));
  assert.ok(hasRoleOrPerm([], P.BanMembers, [], ['BanMembers', 'KickMembers']));
  assert.ok(!hasRoleOrPerm([], 0n, ['r1'], ['BanMembers']));
});

test('RSS and Atom parsing', () => {
  const rss = `<?xml version="1.0"?><rss><channel><title>Blog</title><link>https://b</link>
    <item><title>Post &amp; more</title><link>https://b/1</link><guid>id-1</guid><pubDate>Mon, 26 Oct 2026 10:00:00 GMT</pubDate><description><![CDATA[<p>Hello <b>world</b></p><img src="https://img/1.png">]]></description></item>
  </channel></rss>`;
  const f = parseFeed(rss);
  assert.equal(f.title, 'Blog');
  assert.equal(f.items[0].title, 'Post & more');
  assert.equal(f.items[0].id, 'id-1');
  assert.equal(f.items[0].summary, 'Hello world');
  assert.equal(f.items[0].image, 'https://img/1.png');
  assert.equal(f.items[0].date, Date.parse('2026-10-26T10:00:00Z'));
  const atom = `<feed xmlns="http://www.w3.org/2005/Atom" xmlns:yt="http://www.youtube.com/xml/schemas/2015"><title>Chan</title>
    <link rel="self" href="https://self"/><link rel="alternate" href="https://chan"/>
    <entry><id>yt:video:abc</id><yt:videoId>abc</yt:videoId><title>Video</title><link rel="alternate" href="https://youtu.be/abc"/><author><name>Nore</name></author><published>2026-10-25T12:00:00+00:00</published></entry></feed>`;
  const a = parseFeed(atom);
  assert.equal(a.link, 'https://chan');
  assert.deepEqual([a.items[0].id, a.items[0].link, a.items[0].author, a.items[0].videoId], ['yt:video:abc', 'https://youtu.be/abc', 'Nore', 'abc']);
  assert.equal(a.items[0].image, 'https://i.ytimg.com/vi/abc/hqdefault.jpg');
  assert.equal(decodeEntities('&#x1F600;&lt;'), '😀<');
});

test('Nore event windows', () => {
  const oct25 = Date.parse('2026-10-25T12:00:00Z');
  const h = eventTimes({ id: 'halloween', active: true }, oct25);
  assert.equal(h.active, true);
  assert.ok(h.peakAt > oct25);
  const x = eventTimes({ id: 'christmas', active: false, startsAt: '2026-12-10T00:00:00+01:00' }, oct25);
  assert.equal(x.upcoming, true);
  assert.equal(x.startsAt, Date.parse('2026-12-10T00:00:00+01:00'));
  assert.equal(dueReminder(x, oct25), null);
  assert.equal(dueReminder(x, Date.parse('2026-12-05T00:00:00Z')), '7d');
  assert.equal(dueReminder(x, Date.parse('2026-12-09T12:00:00Z')), '1d');
  assert.equal(eventTimes({ id: 'halloween', active: true }, Date.parse('2026-11-20T00:00:00Z')).active, false, 'API flag ignored after the window');
});

test('backoff doubles and resets', () => {
  const b = new Backoff({ base: 1000, max: 8000 });
  assert.ok(b.ready(0));
  assert.equal(b.fail(0), true, 'first failure is reported');
  assert.equal(b.fail(0), false);
  assert.equal(b.delay, 2000);
  b.fail(0); b.fail(0); b.fail(0);
  assert.equal(b.delay, 8000);
  assert.equal(b.ok(), true);
  assert.ok(b.ready());
});

test('scheduler fires due timers once and survives a restart (store)', async () => {
  const store = new Store(null);
  const s = new Scheduler(store);
  const fired = [];
  s.on('ping', (g, d) => fired.push(`${g}:${d.n}`));
  s.add('g1', 'ping', 1000, { n: 1 });
  s.add('g1', 'ping', 5000, { n: 2 });
  await s.tick(2000);
  assert.deepEqual(fired, ['g1:1']);
  const s2 = new Scheduler(store); // "restart"
  s2.on('ping', (g, d) => fired.push(`${g}:${d.n}`));
  s2.arm(['g1']);
  await s2.tick(6000);
  assert.deepEqual(fired, ['g1:1', 'g1:2']);
  assert.equal(store.guild('g1').timers.length, 0);
  const list = [];
  assert.ok(rememberId(list, 'a', 2));
  assert.ok(!rememberId(list, 'a', 2));
  rememberId(list, 'b', 2); rememberId(list, 'c', 2);
  assert.deepEqual(list, ['b', 'c']);
});
