'use strict';
const test = require('node:test');
const assert = require('node:assert');
const notices = require('../src/main/notices');

test('client config from the Nore API is reduced to what the banner shows', () => {
  const s = notices.shape({
    maintenance: { enabled: true, message: 'Aktualizujemy serwery' },
    minLauncherVersion: '1.5.0',
    announcements: [
      { id: 'a1', title: 'Przerwa', body: 'Wracamy o 20:00', level: 'warning', link: 'https://noreclient.pl/status', targets: ['launcher'] },
      { id: 'a2', title: 'Zły link', level: 'loud', link: 'javascript:alert(1)' },
      { title: 'bez id' },
      null,
    ],
  }, '1.4.0');
  assert.deepStrictEqual(s.maintenance, { message: 'Aktualizujemy serwery' });
  assert.strictEqual(s.updateRequired, true);
  assert.deepStrictEqual(s.announcements.map(a => [a.id, a.level, a.link]), [['a1', 'warning', 'https://noreclient.pl/status'], ['a2', 'info', null]]);
  assert.strictEqual(s.announcements[0].targets, undefined);
});

test('update required only when the minimum is newer than this launcher', () => {
  assert.strictEqual(notices.shape({ minLauncherVersion: '1.5.0' }, '1.5.0').updateRequired, false);
  assert.strictEqual(notices.shape({ minLauncherVersion: '1.5.1' }, '1.5.0').updateRequired, true);
  assert.strictEqual(notices.shape({ minLauncherVersion: null }, '0.1.0').updateRequired, false);
  assert.strictEqual(notices.shape({ maintenance: { enabled: false, message: 'x' } }, '1.0.0').maintenance, null);
  assert.ok(notices.newer('2.0.0', '1.9.9') && !notices.newer('1.9.9', '2.0.0'));
});
