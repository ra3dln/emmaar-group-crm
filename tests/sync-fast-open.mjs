// ===== فتح الموقع بسرعة: ما ينزّلش البيانات كلها لو مفيش جديد =====
// الشكوى: فتح الموقع كان بياخد وقت طويل لأن كل فتحة كانت بتنزّل النسخة الكاملة
// (١.٣ ميجا) وترفع المفاتيح كلها من جديد. الاختبار ده يتأكد إن:
//   ١) جهاز عنده آخر رقم نسخة محفوظ بيسأل سؤال صغير بس (meta=version) لو مفيش جديد.
//   ٢) لما يكون فيه جديد فعلاً بينزّل النسخة الكاملة ويستلم التحديث.
//
// التشغيل: node tests/sync-fast-open.mjs

import assert from 'node:assert';

// ===== بيئة وهمية: localStorage + window قبل استيراد وحدة المزامنة =====
const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
  clear: () => mem.clear(),
};
globalThis.window = {
  dispatchEvent: () => {},
  setInterval: () => 0,
  clearInterval: () => {},
  addEventListener: () => {},
  removeEventListener: () => {},
};

const USERS = [{ id: 'u-admin', username: 'admin', role: 'admin', createdAt: '2026-01-01T00:00:00.000Z' }];
const server = { version: 7, data: { crm_users: USERS, crm_tombstones: [] } };
const gets = [];
globalThis.fetch = async (url, init = {}) => {
  const method = init.method || 'GET';
  const respond = (payload) => ({ ok: true, status: 200, json: async () => payload });
  if (method === 'POST') {
    const body = JSON.parse(init.body);
    if (body.key !== undefined) {
      server.data[body.key] = body.value;
      server.version += 1;
      return respond({ version: server.version });
    }
    if (body.data) {
      server.data = { ...server.data, ...body.data };
      server.version += 1;
      return respond({ version: server.version });
    }
  }
  if (String(url).includes('meta=version')) {
    gets.push('version');
    return respond({ version: server.version });
  }
  gets.push('full');
  return respond({
    version: server.version,
    data: JSON.parse(JSON.stringify(server.data)),
    isEmpty: false,
  });
};

// الجهاز ده فتح الموقع قبل كده: عنده البيانات ورقم آخر نسخة عرفها
localStorage.setItem('crm_users', JSON.stringify(USERS));
localStorage.setItem('crm_tombstones', '[]');
localStorage.setItem('crm_server_version', String(server.version));

const sync = await import('../src/sync.ts?fast-open=1');
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let passed = 0;
const check = (label, condition, extra = '') => {
  assert.ok(condition, `✗ ${label} ${extra}`);
  passed += 1;
  console.log(`✓ ${label}`);
};

sync.markAuthorized();
await wait(300);
check('مفيش جديد: ما نزّلش البيانات كلها', !gets.includes('full'), `gets=${gets.join(',')}`);
check('سأل عن رقم النسخة بس (طلب صغير)', gets.includes('version'));

// نسخة جديدة على السيرفر => لازم ينزّل البيانات ويستلم التحديث
server.version += 1;
server.data.crm_users = [
  ...USERS,
  { id: 'u-new', username: 'new', role: 'sales', createdAt: '2026-02-01T00:00:00.000Z' },
];
gets.length = 0;
sync.syncNow();
await wait(400);
check('لما فيه جديد: نزّل النسخة الكاملة', gets.includes('full'), `gets=${gets.join(',')}`);
check(
  'والحساب الجديد وصل للجهاز',
  JSON.parse(localStorage.getItem('crm_users')).some((u) => u.id === 'u-new')
);

console.log(`\n✅ نجحت ${passed} فحوصات (فتح الموقع بسرعة)`);
