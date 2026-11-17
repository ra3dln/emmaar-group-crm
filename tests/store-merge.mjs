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
// شاهد الحساب اللي أُعيد إنشاؤه لازم يسقط من السيرفر كمان: لو فضل، كل جهاز
// بيشيله من عنده والسيرفر بيرجّعه فكل مزامنة بتزوّد رقم النسخة والموقع بينزّل
// كل البيانات من الأول عند كل فتحة.
const afterRecreate = (await pull(cookie)).crm_tombstones || [];
check(
  'وشاهد السجل اللي أُعيد إنشاؤه اتشال من السيرفر',
  !afterRecreate.some((t) => t && t.key === 'crm_users' && t.id === MONA.id),
  JSON.stringify(afterRecreate)
);

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

// ===== ٥ب) نسخة قديمة من نفس السجل ما تكتبش فوق تعديل أحدث =====
// جهاز بيرفع كل قائمته كل ثانية كان بيرجّع نسخته القديمة من العميل فوق تعديل
// الإدارة (المُرسل كان يكسب دايماً). دلوقتي الأحدث (updatedAt) هو اللي يفضل.
const OLD_C = { id: 'c3', userId: 'sales-1', name: 'عميل ج', phone: '0102', stage: 'contacted', createdAt: '2026-04-03T00:00:00.000Z', updatedAt: '2026-11-01T12:22:00.000Z' };
const NEW_C = { ...OLD_C, stage: 'new', updatedAt: '2026-11-01T12:30:00.000Z' };
await push('crm_clients', [OLD_C], cookie);
await push('crm_clients', [NEW_C], cookie); // تعديل الإدارة
await push('crm_clients', [OLD_C], cookie); // جهاز لسه ما سحبش التعديل
const stageOf = async (id) => (await pull(cookie)).crm_clients.find((c) => c.id === id)?.stage;
check('نسخة الجهاز القديمة ما بتمسحش تعديل أحدث على نفس العميل', (await stageOf('c3')) === 'new');
await push('crm_clients', [{ ...NEW_C, stage: 'meeting', updatedAt: '2026-11-01T12:40:00.000Z' }], cookie);
check('وتعديل أحدث من الجهاز بيتسجّل عادي', (await stageOf('c3')) === 'meeting');
await push('crm_clients', [{ ...NEW_C, stage: 'lost', updatedAt: '2026-11-01T12:40:00.000Z' }], cookie);
check('ونفس الوقت بالظبط: نسخة المُرسل تكسب (زي الأول)', (await stageOf('c3')) === 'lost');
// الأرقام الموزّعة: وقت التوزيع (assignedAt) بيتحسب في «الأحدث» زي الجهاز
const L_OLD = { id: 'l1', phone: '0103', salesId: '', createdAt: '2026-04-03T00:00:00.000Z', assignedAt: '2026-10-28T08:00:00.000Z' };
await push('crm_assigned_leads', [{ ...L_OLD, salesId: 'sales-1', assignedAt: '2026-11-01T12:08:00.000Z' }], cookie);
await push('crm_assigned_leads', [L_OLD], cookie);
check('توزيع رقم ما يرجعش «غير موزّع» من جهاز قديم', (await pull(cookie)).crm_assigned_leads.find((l) => l.id === 'l1')?.salesId === 'sales-1');

// ===== ٥ج) التوزيع اليدوي يكسب التلقائي مهما كان وقت الحفظ =====
// الإدارة وزّعت الرقم على سيلز بنفسها؛ جهاز تاني ما وصلوش الاختيار شاف الرقم
// «غير مخصص» ووزّعه تلقائي بوقت أحدث — كان بيكتب فوق اختيار الإدارة.
const MANUAL = { id: 'l2', phone: '0104', salesId: 'sales-1', assignedVia: 'manual', createdAt: '2026-04-03T00:00:00.000Z', assignedAt: '2026-11-13T10:00:00.000Z' };
await push('crm_assigned_leads', [MANUAL], cookie);
await push('crm_assigned_leads', [{ ...MANUAL, salesId: 'sales-2', assignedVia: 'auto', assignedAt: '2026-11-13T10:00:05.000Z' }], cookie);
const ownerOfL2 = async () => (await pull(cookie)).crm_assigned_leads.find((l) => l.id === 'l2');
check('توزيع تلقائي أحدث ما بيغيّرش اختيار الإدارة اليدوي', (await ownerOfL2())?.salesId === 'sales-1');
await push('crm_assigned_leads', [{ ...MANUAL, salesId: 'sales-3', assignedVia: 'manual', assignedAt: '2026-11-13T11:00:00.000Z' }], cookie);
check('وتوزيع يدوي جديد بيتسجّل عادي', (await ownerOfL2())?.salesId === 'sales-3');
await push('crm_assigned_leads', [{ id: 'l3', phone: '0105', salesId: 'sales-2', assignedVia: 'auto', createdAt: '2026-04-03T00:00:00.000Z', assignedAt: '2026-11-13T12:00:05.000Z' }], cookie);
await push('crm_assigned_leads', [{ id: 'l3', phone: '0105', salesId: 'sales-1', assignedVia: 'manual', createdAt: '2026-04-03T00:00:00.000Z', assignedAt: '2026-11-13T12:00:00.000Z' }], cookie);
check('اليدوي يكسب حتى لو وصل السيرفر بعد التلقائي بوقت أقدم', (await pull(cookie)).crm_assigned_leads.find((l) => l.id === 'l3')?.salesId === 'sales-1');

// ===== ٥د) جهاز ساعته متقدّمة ما يكسبش على طول =====
// قاعدة توزيع اتحفظت من جهاز ساعته قدّام ٧ ساعات: أي إيقاف بعدها كان بيخسر
// قدّامها (هي «الأحدث»)، فالتوزيع التلقائي كان بيرجع يشتغل لوحده.
const future = new Date(Date.now() + 7 * 3600e3).toISOString();
await push('crm_lead_auto_assign', [{ id: 'GO', formName: 'GO', active: true, updatedAt: future }], cookie);
await push('crm_lead_auto_assign', [{ id: 'GO', formName: 'GO', active: false, updatedAt: new Date().toISOString() }], cookie);
const ruleNow = async () => (await pull(cookie)).crm_lead_auto_assign.find((r) => r.id === 'GO');
check('إيقاف القاعدة بيكسب نسخة متسجّلة بوقت في المستقبل', (await ruleNow())?.active === false);
await push('crm_lead_auto_assign', [{ id: 'GO', formName: 'GO', active: true, updatedAt: future }], cookie);
check('والجهاز اللي ساعته غلط ما يقدرش يرجّعها شغالة', (await ruleNow())?.active === false);

// ===== ٦) نطاق حساب المطوّر: «بياناته هو» دائماً (لا يرث أرقام غيره) =====
// المشكلة: جهاز قديم يبقى عنده نسخة من سجل حساب المطوّر فيها «كل البيانات»
// فيرفعها للسيرفر (نسخة المُرسل تكسب عند نفس المعرّف)، فيرث حسابه أرقام
// كل المندوبين. الحل: النطاق مثبّت على «بياناته هو» في الكود وعلى الخادم.
const OWNER = {
  id: 'dev-001',
  username: 'mohamed',
  name: 'محمد',
  role: 'admin',
  developer: true,
  receivesLeads: true,
  dataScope: 'own',
  isActive: true,
  password: 'OwnerStrong123',
  createdAt: '2026-01-01T00:00:00.000Z',
};
await push('crm_users', [ADMIN, AHMED, recreated, OWNER], cookie);
const scopeOf = async (id) => {
  const u = (await pull(cookie)).crm_users.find((x) => x.id === id);
  return u ? u.dataScope : '(مفيش)';
};
check('نطاق حساب المطوّر «بياناته هو» في السجل', (await scopeOf(OWNER.id)) === 'own');
// جهاز قديم يرفع نسخة فيها «كل البيانات»
await push('crm_users', [ADMIN, AHMED, recreated, { ...OWNER, dataScope: 'all' }], cookie);
check('جهاز قديم ما يقدرش يوسّع نطاق حساب المطوّر', (await scopeOf(OWNER.id)) === 'own');
check('وباقي الحسابات ما اتغيرتش', (await usernames(cookie)) === 'admin,ahmed,mohamed,mona');
const ownerScope = (await import('../shared/roles.js')).dataScopeOf(
  { ...OWNER, dataScope: 'all' },
  [ADMIN, AHMED, OWNER]
);
check(
  'والواجهة كمان تتجاهل «كل البيانات» لحساب المطوّر (بياناته هو)',
  ownerScope !== null && [...ownerScope].join(',') === OWNER.id
);

console.log(`\n✅ كل اختبارات ثبات السجلات نجحت (${passed}).`);
server.close();
