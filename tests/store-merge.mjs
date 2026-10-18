// ===== اختبار ثبات السجلات عند رفع الأجهزة (أهم سبب لعطل «الحساب مش شغّال») =====
// كل جهاز يرفع «القائمة كاملة» للمفتاح. فلو كان جهاز لابتوب/هاتف عنده نسخة قديمة
// لم تصله الحسابات الجديدة، فالاستبدال المباشر كان يمسحها من قاعدة البيانات:
// يعمل الحساب قليلاً ثم «يختفي» ويقول السيرفر «اسم المستخدم أو كلمة المرور غير صحيحة».
//
// ما يُختبر هنا على نفس كود الاستضافة (server/store.js):
//   ١) جهاز قديم يرفع قائمة ناقصة => الحساب الجديد يبقى ويدخل عادي
//   ٢) الحذف المقصود بشاهد حذف => الحساب يُحذف فعلاً والدخول يفشل
//   ٣) جهاز قديم بلا شواهد حذف بعد الحذف => السجل المحذوف لا يعود للحياة
//   ٤) إعادة إنشاء سجل بنفس المعرّف أحدث من الحذف => يعيش (فلا نقفل إعادة الإنشاء)
//   ٥) نفس الحماية على بقية السجلات (العملاء) لا على الحسابات وحدها
//
// التشغيل: node tests/store-merge.mjs

import http from 'node:http';
import assert from 'node:assert/strict';

const SECRET = 'unit-test-secret-0123456789-abcdef';
process.env.AUTH_SECRET = SECRET;

const { createAuthHandler } = await import('../server/authApi.js');
const { createStoreHandler } = await import('../server/store.js');

let db = { version: 0, data: {} };
const memoryStorage = {
  configured: true,
  async load() {
    return { version: db.version, data: JSON.parse(JSON.stringify(db.data)) };
  },
  async loadVersion() {
    return db.version;
  },
  async save(next) {
    db = { version: Number(next.version) || 0, data: JSON.parse(JSON.stringify(next.data)) };
  },
};

const authHandler = createAuthHandler({ storage: memoryStorage, env: process.env });
const storeHandler = createStoreHandler({ ...memoryStorage, auth: process.env });

const server = http.createServer((req, res) => {
  const path = (req.url || '').split('?')[0];
  if (path.startsWith('/api/auth')) return authHandler(req, res);
  return storeHandler(req, res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

const call = async (path, { method = 'GET', body, cookie } = {}) => {
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { status: res.status, json, setCookie: res.headers.get('set-cookie') || '' };
};

const login = (body) => call('/api/auth?action=login', { method: 'POST', body });
const cookieOf = (res) => String(res.setCookie).split(';')[0];

let passed = 0;
const check = (label, condition, extra = '') => {
  assert.ok(condition, `✗ ${label} ${extra}`);
  passed += 1;
  console.log(`✓ ${label}`);
};

const ADMIN = {
  id: 'admin-001',
  username: 'admin',
  name: 'إدارة إعمار جروب',
  role: 'admin',
  team: '',
  isActive: true,
  password: 'admin123',
  createdAt: '2026-01-01T00:00:00.000Z',
};
const AHMED = {
  id: 'sales-1',
  username: 'ahmed',
  name: 'أحمد',
  role: 'sales',
  team: 'فريق أ',
  isActive: true,
  password: 'AhmedStrong123',
  createdAt: '2026-02-01T00:00:00.000Z',
};
const MONA = {
  id: 'sales-2',
  username: 'mona',
  name: 'منى',
  role: 'sales',
  team: 'فريق أ',
  isActive: true,
  password: 'MonaStrong123',
  createdAt: '2026-03-01T00:00:00.000Z',
};

const push = (key, value, cookie) => call('/api/store', { method: 'POST', body: { key, value }, cookie });
const pull = async (cookie) => (await call('/api/store', { cookie })).json.data;
const usernames = async (cookie) =>
  (await pull(cookie))
    .crm_users.map((u) => u.username)
    .sort()
    .join(',');

db = { version: 1, data: { crm_users: [ADMIN, AHMED], crm_clients: [], crm_tombstones: [] } };

const admin = await login({ username: 'admin', password: 'admin123', loginType: 'admin' });
check('دخول الإدارة يعمل', admin.status === 200, JSON.stringify(admin.json));
const cookie = cookieOf(admin);

// ===== ١) جهاز قديم (لم يرَ الحساب الجديد) يرفع قائمته الناقصة =====
await push('crm_users', [ADMIN, AHMED, MONA], cookie); // جهاز آخر أنشأ منى
await push('crm_users', [ADMIN, AHMED], cookie); // جهاز قديم يرفع نسخته الناقصة
check('جهاز قديم ما بيمسحش الحساب الجديد', (await usernames(cookie)) === 'admin,ahmed,mona');
check('والحساب الجديد يدخل عادي', (await login({ username: 'mona', password: 'MonaStrong123', loginType: 'sales' })).status === 200);

// ملاحظة: جهاز قديم بلا منى في لقطة مزامنته لا يُنشئ شاهد حذف أصلاً،
// لذلك الرفع الناقص يجب أن يمرّ بلا أي حذف — وهذا ما يثبته السطران أعلاه.

// ===== ٢) الحذف المقصود يعمل (شاهد حذف + القائمة بدون السجل) =====
const removedAt = Date.now();
await push('crm_tombstones', [{ key: 'crm_users', id: MONA.id, at: removedAt }], cookie);
await push('crm_users', [ADMIN, AHMED], cookie);
check('الحذف بشاهد حذف يحذف الحساب فعلاً', (await usernames(cookie)) === 'admin,ahmed');
check('والحساب المحذوف يفشل في الدخول', (await login({ username: 'mona', password: 'MonaStrong123', loginType: 'sales' })).status === 401);

// ===== ٣) جهاز قديم ما زال يحمل الحساب المحذوف يرفعه مرة أخرى =====
await push('crm_users', [ADMIN, AHMED, MONA], cookie); // نسخة قديمة فيها منى
check('السجل المحذوف لا يعود من جهاز قديم', (await usernames(cookie)) === 'admin,ahmed');
await push('crm_tombstones', [], cookie); // محاولة محو شواهد الحذف
await push('crm_users', [ADMIN, AHMED, MONA], cookie);
check('ومحو شواهد الحذف من جهاز قديم لا يُحيي المحذوف', (await usernames(cookie)) === 'admin,ahmed');

// ===== ٤) إعادة إنشاء سجل بنفس المعرّف أحدث من الحذف =====
const recreated = { ...MONA, createdAt: new Date(removedAt + 60_000).toISOString() };
await push('crm_users', [ADMIN, AHMED, recreated], cookie);
check('إعادة الإنشاء الأحدث من الحذف تعيش', (await usernames(cookie)) === 'admin,ahmed,mona');

// ===== ٥) نفس الحماية للعملاء =====
await push('crm_clients', [{ id: 'c1', userId: 'sales-1', name: 'عميل أ', phone: '0100', createdAt: '2026-04-01T00:00:00.000Z' }], cookie);
await push('crm_clients', [{ id: 'c2', userId: 'sales-1', name: 'عميل ب', phone: '0101', createdAt: '2026-04-02T00:00:00.000Z' }], cookie);
await push('crm_clients', [{ id: 'c1', userId: 'sales-1', name: 'عميل أ', phone: '0100', createdAt: '2026-04-01T00:00:00.000Z' }], cookie); // جهاز قديم
const clients = (await pull(cookie)).crm_clients.map((c) => c.id).sort().join(',');
check('جهاز قديم ما بيمسحش عميلاً أُنشئ على جهاز آخر', clients === 'c1,c2');

// حذف عميل بشاهد حذف يعمل
await push('crm_tombstones', [{ key: 'crm_clients', id: 'c1', at: Date.now() }], cookie);
await push('crm_clients', [{ id: 'c2', userId: 'sales-1', name: 'عميل ب', phone: '0101', createdAt: '2026-04-02T00:00:00.000Z' }], cookie);
check('وحذف العميل المقصود يعمل', (await pull(cookie)).crm_clients.map((c) => c.id).join(',') === 'c2');

console.log(`\n✅ كل اختبارات ثبات السجلات نجحت (${passed}).`);
server.close();
