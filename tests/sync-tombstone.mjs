// ===== اختبار رجression: الحساب المحذوف لا يعود بعد تحديث الصفحة =====
// يشغّل منطق المزامنة نفسه (src/sync.ts) على بيئة وهمية: localStorage + سيرفر مزامنة
// بذاكرة، ويتحقق من ثلاث سلوكيات:
//   ١) حذف حساب من الإدارة يرفع شاهد الحذف قبل القائمة، ولا يعود بعد «تحديث الصفحة»
//      حتى لو أعاد جهاز قديم رفع نفس السجل (نفس المعرّف ووقت إنشاء قديم).
//   ٢) إعادة إنشاء حساب بنفس المعرّف بعد الحذف (وقت إنشاء أحدث) تُسقط الشاهد وتعيده —
//      حماية حساب الإدارة من مسح المزامنة.
//   ٣) تحديث الصفحة في منتصف رفع الحذف (الشاهد على الجهاز فقط) يبقى الحذف ثابتاً
//      ويُرفع للسيرفر من أول دورة مزامنة.
//
// التشغيل: node tests/sync-tombstone.mjs  (يتطلب Node يدعم strip-types — ≥23.6)

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

// ===== سيرفر مزامنة بذاكرة (نفس عقد /api/store) =====
const server = { version: 1, data: {} };
const pushes = []; // ترتيب الرفعات للتحقق أن الشواهد تسبق القوائم
globalThis.fetch = async (url, init = {}) => {
  const method = init.method || 'GET';
  const respond = (payload) => ({ ok: true, status: 200, json: async () => payload });
  if (method === 'POST') {
    const body = JSON.parse(init.body);
    if (body.key !== undefined) {
      pushes.push(body.key);
      server.data[body.key] = body.value;
      server.version += 1;
      return respond({ version: server.version });
    }
    if (body.data) {
      pushes.push('bulk');
      server.data = { ...body.data };
      server.version += 1;
      return respond({ version: server.version });
    }
  }
  if (String(url).includes('meta=version')) return respond({ version: server.version });
  return respond({
    version: server.version,
    data: JSON.parse(JSON.stringify(server.data)),
    isEmpty: Object.keys(server.data).length === 0,
  });
};

const sync = await import('../src/sync.ts');

const localList = (key) => JSON.parse(globalThis.localStorage.getItem(key) || '[]');
const waitFor = async (fn, ms = 2000) => {
  const start = Date.now();
  while (Date.now() - start < ms) {
    if (fn()) return true;
    await new Promise((r) => setTimeout(r, 20));
  }
  return false;
};

const ADMIN = { id: 'u-admin', username: 'admin', role: 'admin', createdAt: '2026-01-01T00:00:00.000Z' };
const SALES = { id: 'u-sales', username: 'haidy', role: 'sales', createdAt: '2026-01-01T00:00:00.000Z' };
let passed = 0;
const check = (label, condition, extra = '') => {
  assert.ok(condition, `✗ ${label} ${extra}`);
  passed += 1;
  console.log(`✓ ${label}`);
};

try {
  // ===== التهيئة: السيرفر فيه حسابان والجهاز نظيف =====
  server.data = { crm_users: [ADMIN, SALES], crm_tombstones: [] };
  server.version = 10;
  await sync.startSync();
  check('الجهاز استلم الحسابين من السيرفر', localList('crm_users').length === 2);

  // ===== ١) حذف حساب سيلز من الإدارة (نفس مسار handleDeleteUser: إزالة + pushKey) =====
  globalThis.localStorage.setItem(
    'crm_users',
    JSON.stringify(localList('crm_users').filter((u) => u.id !== 'u-sales'))
  );
  await sync.pushKey('crm_users');

  const tombAt = pushes.lastIndexOf('crm_tombstones');
  const usersAt = pushes.lastIndexOf('crm_users');
  check('شاهد الحذف رُفع قبل القائمة الجديدة', tombAt !== -1 && usersAt !== -1 && tombAt < usersAt,
    `tomb=${tombAt} users=${usersAt}`);
  check('الشاهد وصل السيرفر بوقت حذف', (server.data.crm_tombstones || []).some((t) => t.key === 'crm_users' && t.id === 'u-sales' && Number(t.at) > 0));
  check('الحساب اختفى من السيرفر', !(server.data.crm_users || []).some((u) => u.id === 'u-sales'));

  // «تحديث الصفحة»: الجهاز يجلب من السيرفر من جديد — الحذف يبقى
  await sync.startSync();
  check('بعد تحديث الصفحة الحساب لا يعود', !localList('crm_users').some((u) => u.id === 'u-sales'));

  // جهاز قديم ما زال يحمل الحساب ويعيد رفعه (نفس المعرّف ووقت إنشاء قديم)
  server.data.crm_users = [ADMIN, SALES];
  server.version += 1;
  sync.markAuthorized(); // دورة مزامنة كما تعمل كل ٢٫٥ ثانية
  const healed = await waitFor(() => !(server.data.crm_users || []).some((u) => u.id === 'u-sales'));
  check('جهاز قديم أعاد رفع السجل => المزامنة تحذفه ثانية من السيرفر', healed);
  check('السجل لا عاد محلياً بعد دورة الجهاز القديم', !localList('crm_users').some((u) => u.id === 'u-sales'));

  // ===== ٢) إعادة إنشاء الحساب بنفس المعرّف بعد الحذف => إعادة الإحياء تفوز =====
  const REBORN = { id: 'u-sales', username: 'haidy2', role: 'sales', createdAt: new Date(Date.now() + 5000).toISOString() };
  server.data.crm_users = [ADMIN, REBORN];
  server.version += 1;
  await sync.startSync();
  check('إعادة إنشاء أحدث من شاهد الحذف => الشاهد سقط', !(server.data.crm_tombstones || []).some((t) => t.id === 'u-sales'));
  check('الحساب المُعاد إنشاؤه عاد للحياة', localList('crm_users').some((u) => u.id === 'u-sales' && u.username === 'haidy2'));

  // ===== ٣) تحديث الصفحة في منتصف رفع حذف آخر (الشاهد على الجهاز فقط) =====
  const LEAD = { id: 'u-lead', username: 'lead', role: 'sales', createdAt: '2026-01-01T00:00:00.000Z' };
  server.data.crm_users = [ADMIN, LEAD];
  server.data.crm_tombstones = [];
  server.version += 1;
  // الجهاز: الحساب مُزيل وشاهد الحذف مكتوب محلياً، لكن الرفع لم يصل السيرفر
  globalThis.localStorage.setItem('crm_users', JSON.stringify([ADMIN]));
  globalThis.localStorage.setItem('crm_tombstones', JSON.stringify([{ key: 'crm_users', id: 'u-lead', at: Date.now() - 1000 }]));
  await sync.startSync();
  check('شاهد محلي بلا رفع سابق: الحذف ثابت بعد التحميل', !localList('crm_users').some((u) => u.id === 'u-lead'));
  check('الأول دورة مزامنة رفعت الحذف للسيرفر', !(server.data.crm_users || []).some((u) => u.id === 'u-lead')
    && (server.data.crm_tombstones || []).some((t) => t.id === 'u-lead'));

  console.log(`\n✅ كل اختبارات المزامنة نجحت (${passed})`);
} catch (error) {
  console.error('❌ فشل اختبار المزامنة:', error.message);
  process.exit(1);
}
