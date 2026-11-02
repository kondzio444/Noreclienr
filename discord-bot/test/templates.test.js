import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadTemplates, compileTemplate, SIZES, mergeOverwrites } from '../src/lib/templates.js';
import { validateLayout, planLayout, LIMITS, slug, normName } from '../src/lib/layout.js';
import { translator, LANGUAGES, has } from '../src/i18n/index.js';
import { PermissionFlagsBits } from 'discord.js';

const templates = loadTemplates();
const vars = { server: 'Test', website: 'https://noreclient.pl', address: 'MC.noreclient.pl' };

test('the four templates exist', () => {
  assert.deepEqual(Object.keys(templates).sort(), ['gaming', 'mc-server', 'nore-client', 'support']);
});

for (const [id, tpl] of Object.entries(templates)) {
  for (const lang of LANGUAGES) {
    for (const size of SIZES) {
      test(`${id} / ${lang} / ${size} respects Discord limits and is fully translated`, () => {
        const c = compileTemplate(tpl, { t: translator(lang), size, vars });
        assert.deepEqual(validateLayout(c.layout), []);
        assert.ok(c.layout.roles.length <= LIMITS.roles);
        assert.ok(c.layout.channels.length <= LIMITS.channels);
        const perCat = {};
        for (const ch of c.layout.channels) if (ch.parent) perCat[ch.parent] = (perCat[ch.parent] || 0) + 1;
        for (const n of Object.values(perCat)) assert.ok(n <= LIMITS.perCategory);
        for (const x of [...c.layout.roles, ...c.layout.channels]) {
          assert.ok(!/tpl\./.test(x.name), `untranslated ${x.key}: ${x.name}`);
          assert.ok(x.name.length <= 100);
        }
        for (const ch of c.layout.channels) {
          if (ch.topicKey) assert.ok(has(lang, ch.topicKey, { exact: true }), `topic ${ch.topicKey}`);
          for (const o of ch.overwrites) for (const p of [...o.allow, ...o.deny]) assert.ok(p in PermissionFlagsBits, `permission ${p}`);
          const targets = ch.overwrites.map(o => o.target);
          assert.equal(new Set(targets).size, targets.length, `duplicate overwrite in ${ch.key}`);
        }
        for (const r of c.layout.roles) for (const p of r.permissions) assert.ok(p in PermissionFlagsBits, `permission ${p}`);
        // a rerun against what was built creates nothing (idempotent)
        const built = {
          roles: c.layout.roles.map((r, i) => ({ id: `r${i}`, name: r.name, permissions: [] })),
          channels: c.layout.channels.map((x, i) => ({ id: `c${i}`, name: x.name, type: x.type, parentId: x.parent ? `c${c.layout.channels.findIndex(y => y.key === x.parent)}` : null })),
        };
        const again = planLayout(c.layout, built);
        assert.equal(again.summary.create.roles, 0);
        assert.equal(again.summary.create.channels, 0);
      });
    }
  }
}

test('the full MC.noreclient.pl template is big: ~60 roles, 200+ channels with categories', () => {
  const c = compileTemplate(templates['mc-server'], { t: translator('pl'), size: 'full', vars });
  assert.ok(c.layout.roles.length >= 55, `${c.layout.roles.length} roles`);
  assert.ok(c.layout.channels.length >= 200, `${c.layout.channels.length} channels`);
  const keys = c.layout.channels.map(x => x.key);
  for (const k of ['rules', 'verify', 'server_ip', 'partner_info', 'support_info', 'staff_chat', 'mod_log', 'cat_tickets']) assert.ok(keys.includes(k), k);
});

test('sizes grow small < medium < full', () => {
  for (const tpl of Object.values(templates)) {
    const n = SIZES.map(s => compileTemplate(tpl, { t: translator('en'), size: s, vars }).layout.channels.length);
    assert.ok(n[0] <= n[1] && n[1] <= n[2], `${tpl.id}: ${n}`);
  }
});

test('staff channels are hidden from @everyone and members', () => {
  const c = compileTemplate(templates['mc-server'], { t: translator('en'), size: 'full', vars });
  const staff = c.layout.channels.find(x => x.key === 'cat_staff');
  const everyone = staff.overwrites.find(o => o.target === '@everyone');
  assert.ok(everyone.deny.includes('ViewChannel'));
  assert.ok(staff.overwrites.some(o => o.target === 'moderator' && o.allow.includes('ViewChannel')));
  assert.ok(!staff.overwrites.some(o => o.target === 'member' && o.allow.includes('ViewChannel')));
});

test('planLayout matches by id, then by name, and can prune', () => {
  const desired = { roles: [{ key: 'a', name: '👑 Owner', color: '#ff0000' }], channels: [{ key: 'cat', name: 'X', type: 'category' }, { key: 'gen', name: '💬┃general', type: 'text', parent: 'cat' }] };
  const current = { roles: [{ id: '1', name: 'owner', color: 0xff0000, permissions: [] }, { id: '2', name: 'old' }], channels: [{ id: '10', name: 'general', type: 'text', parentId: null }, { id: '11', name: 'junk', type: 'text' }] };
  const p = planLayout(desired, current, { prune: true });
  assert.equal(p.map['r:a'], '1');
  assert.equal(p.map['c:gen'], '10');
  assert.equal(p.summary.create.channels, 1); // the category
  assert.deepEqual(p.ops.filter(o => o.op.endsWith('.delete')).map(o => o.name).sort(), ['junk', 'old']);
});

test('slug, normName and mergeOverwrites', () => {
  assert.equal(slug('📜┃Regulamin Serwera'), '📜┃regulamin-serwera');
  assert.equal(normName('💬┃General Chat'), normName('general-chat'));
  assert.deepEqual(mergeOverwrites([{ target: 'x', allow: ['A'], deny: ['B'] }, { target: 'x', allow: ['B'], deny: ['C'] }]), [{ target: 'x', allow: ['A', 'B'], deny: ['C'] }]);
});

test('validateLayout catches limit violations', () => {
  const roles = Array.from({ length: 251 }, (_, i) => ({ key: `r${i}`, name: `R${i}` }));
  const channels = [{ key: 'c', name: 'c', type: 'category' }, ...Array.from({ length: 51 }, (_, i) => ({ key: `t${i}`, name: `t${i}`, type: 'text', parent: 'c' }))];
  const p = validateLayout({ roles, channels });
  assert.ok(p.some(x => x.includes('roles')));
  assert.ok(p.some(x => x.includes('category c')));
});
