// ===== اختبار حقيقي لطبقة الحماية (بلا قاعدة بيانات وبلا حساب) =====
// يشغّل نقاط الاستضافة الفعلية (api/auth.js + /api/store) داخل سيرفر HTTP محلي،
// ويمرّ بنفس الطلبات التي يرسلها المتصفح، ويتحقّق من الغرض الأصلي:
//   **من يعرف رابط الموقع ولا يملك كلمة مرور صحيحة لا يرى أي بيانات.**
//
// ما يُختبر:
//   ١) بلا جلسة: قراءة وكتابة البيانات => 401 (مرفوض تماماً)
//   ٢) كلمة مرور خطأ / نوع دخول خطأ / حساب موقوف => 401 بنفس الرسالة (بلا كشف)
//   ٣) كوكي مُزوَّر أو موقّع بمفتاح آخر => 401
//   ٤) كلمة المرور الافتراضية (admin123): الدخول ينجح لكن البيانات تبقى مغلقة (403)
//      حتى تُغيَّر إلى كلمة قوية — فلا يفيد معرفة الرابط بالكلمة المعروفة
//   ٥) كلمات المرور تُرى وتُغيَّر من الإدارة (رتبة admin) وحدها، ولا تُمسح
//      لسجل موجود (فلا يقفل أحد حسابه بالخطأ)
//   ٦) تغيير كلمة المرور يعمل، والجلسة الجديدة تفتح البيانات
//   ٧) الخروج يُبطل الكوكي فوراً
//   ٨) بلا AUTH_SECRET يفشل كل شيء بوضوح (503) بدل أن ينفتح بالخطأ
//   ٩) تخمين كلمة المرور بالتجربة المتكررة محدود (429)
//
// التشغيل:  node tests/auth-smoke.mjs

import http from 'node:http';
import assert from 'node:assert/strict';

const SECRET = 'unit-test-secret-0123456789-abcdef';
process.env.AUTH_SECRET = SECRET;

const { createAuthHandler } = await import('../server/authApi.js');
const { createStoreHandler } = await import('../server/store.js');
const { hashPassword } = await import('../server/auth.js');

// ---------- مخزن ذاكرة (نفس واجهة Supabase/Redis: configured/load/save/loadVersion) ----------
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
// نقطة سحب الأرقام الحقيقية من الاستضافة: بوابتها أيضاً لازم ترد ٤٠١ بلا جلسة
const leadSourceHandler = (await import('../api/lead-source.js')).default;

const server = http.createServer((req, res) => {
  const path = (req.url || '').split('?')[0];
  if (path.startsWith('/api/auth')) return authHandler(req, res);
  if (path.startsWith('/api/lead-source')) return leadSourceHandler(req, res);
  return storeHandler(req, res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

const call = async (path, { method = 'GET', body, cookie } = {}) => {
  const res = await fetch(base + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(cookie ? { cookie } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { status: res.status, json, setCookie: res.headers.get('set-cookie') || '', text };
};

const login = (body) => call('/api/auth?action=login', { method: 'POST', body });
const cookieOf = (res) => String(res.setCookie).split(';')[0];

let passed = 0;
const check = (label, condition, extra = '') => {
  assert.ok(condition, `✗ ${label} ${extra}`);
  passed += 1;
  console.log(`✓ ${label}`);
};

const DEFAULT_ADMIN = {
  id: 'admin-001',
  username: 'admin',
  name: 'إدارة إعمار جروب',
  role: 'admin',
  team: '',
  isActive: true,
  // كلمة المرور الافتراضية كما هي اليوم في قاعدة الإنتاج (نصاً صريحاً)
  password: 'admin123',
};

const SALES = {
  id: 'sales-1',
  username: 'ahmed',
  name: 'أحمد',
  role: 'sales',
  isActive: true,
  password: hashPassword('AhmedPass123'),
};

const seed = (users) => {
  db = { version: 1, data: { crm_users: users, crm_clients: [{ id: 'c1', name: 'عميل سري', phone: '01000000009' }] } };
};

try {
  // ===== ١) بلا جلسة: لا شيء إطلاقاً =====
  seed([DEFAULT_ADMIN, SALES]);
  const anonRead = await call('/api/store');
  check('بلا جلسة: قراءة البيانات مرفوضة (401)', anonRead.status === 401, JSON.stringify(anonRead.json));
  check('رد الرفض لا يحتوي أي بيانات عملاء', !/عميل سري|01000000009/.test(anonRead.text));
  const anonWrite = await call('/api/store', { method: 'POST', body: { key: 'crm_clients', value: [{ id: 'x' }] } });
  check('بلا جلسة: الكتابة مرفوضة (401)', anonWrite.status === 401);
  const anonVersion = await call('/api/store?meta=version');
  check('بلا جلسة: حتى أرقام الإصدار مرفوضة (401)', anonVersion.status === 401);
  const anonLeadSource = await call('/api/lead-source');
  check('بلا جلسة: إعدادات سحب الأرقام مرفوضة (401)', anonLeadSource.status === 401);
  check(
    'لم تُكتب أي بيانات في القاعدة بفعل الطلبات المرفوضة',
    db.data.crm_clients.length === 1 && db.data.crm_clients[0].id === 'c1'
  );

  // ===== ٢) الدخول: لا كشف لأي معلومة =====
  const wrongPassword = await login({ username: 'admin', password: 'wrong', loginType: 'admin' });
  const unknownUser = await login({ username: 'nobody', password: 'wrong', loginType: 'admin' });
  check('كلمة مرور خطأ: 401', wrongPassword.status === 401);
  check(
    'نفس الرسالة لاسم موجود واسم غير موجود (لا كشف للمستخدمين)',
    wrongPassword.json?.error === unknownUser.json?.error
  );
  const wrongType = await login({ username: 'ahmed', password: 'AhmedPass123', loginType: 'admin' });
  check('سيلز يحاول الدخول من بوابة الإدارة: 401', wrongType.status === 401);
  // أما حساب الإدارة/قائد الفريق فيدخل من أي بوابة: البوابة شكل واجهة والرتبة تحدد الصلاحيات،
  // ورفضه كان يجعل قائد الفريق يقول «حسابي مش شغّال» وهو يكتب كلمة المرور الصحيحة.
  const managerOnSalesGate = await login({ username: 'admin', password: 'admin123', loginType: 'sales' });
  check(
    'حساب الإدارة يدخل من بوابة المندوبين أيضاً (بلا قفل)',
    managerOnSalesGate.status === 200 && managerOnSalesGate.json?.user?.role === 'admin',
    JSON.stringify(managerOnSalesGate.json)
  );

  db = { ...db, data: { ...db.data, crm_users: [{ ...SALES, isActive: false }, DEFAULT_ADMIN] } };
  const inactive = await login({ username: 'ahmed', password: 'AhmedPass123', loginType: 'sales' });
  check('حساب موقوف لا يدخل (401)', inactive.status === 401);
  seed([DEFAULT_ADMIN, SALES]);

  // ===== ٣) تزوير الجلسة مستحيل بلا المفتاح =====
  const good = await login({ username: 'ahmed', password: 'AhmedPass123', loginType: 'sales' });
  check('دخول سيلز صحيح ينجح ويعطي كوكي HttpOnly', good.status === 200 && /HttpOnly/i.test(good.setCookie));
  check('رد الدخول لا يحمل كلمة المرور', !JSON.stringify(good.json).includes('password'), JSON.stringify(good.json));
  const realCookie = cookieOf(good);
  const tamperedCookie = `${realCookie.slice(0, -2)}XY`;
  const forged = await call('/api/store', { cookie: tamperedCookie });
  check('كوكي معدّل => 401', forged.status === 401, JSON.stringify(forged.json));
  const withRealCookie = await call('/api/store', { cookie: realCookie });
  check('كوكي حقيقي يفتح البيانات', withRealCookie.status === 200 && withRealCookie.json.data.crm_clients[0].id === 'c1');

  // كوكي موقّع بمفتاح آخر (مثل مفتاح مسرّب من مكان آخر) لا يُقبل
  const savedSecret = process.env.AUTH_SECRET;
  process.env.AUTH_SECRET = 'another-secret-9876543210-abcdef';
  const strangerLogin = await login({ username: 'ahmed', password: 'AhmedPass123', loginType: 'sales' });
  process.env.AUTH_SECRET = savedSecret;
  const alien = await call('/api/store', { cookie: cookieOf(strangerLogin) });
  check('كوكي موقّع بمفتاح آخر => 401', alien.status === 401);
  const forgedPayload = Buffer.from(JSON.stringify({ u: 'admin-001', r: 'admin', exp: Date.now() + 60000 })).toString('base64url');
  const madeUp = await call('/api/store', { cookie: `crm_session=${forgedPayload}.${Buffer.from('sig').toString('base64url')}` });
  check('جلسة مصنوعة يدوياً => 401', madeUp.status === 401);

  // ===== ٤) كلمة المرور الافتراضية تعمل مباشرة (لا إلزام بتغييرها) =====
  const defaultLogin = await login({ username: 'admin', password: 'admin123', loginType: 'admin' });
  check('الدخول بكلمة المرور الافتراضية يعمل بلا أي شاشة تغيير إجبارية', defaultLogin.status === 200);
  check('ولا يوجد أي أثر لإلزام تغيير الكلمة في رد الدخول', !/mustChange|must_change/i.test(JSON.stringify(defaultLogin.json)), JSON.stringify(defaultLogin.json));
  const defaultCookie = cookieOf(defaultLogin);
  const defaultStore = await call('/api/store', { cookie: defaultCookie });
  check('والبيانات تُفتح فوراً بهذه الجلسة', defaultStore.status === 200 && defaultStore.json.data.crm_clients[0].id === 'c1');

  // ===== ٥) تغيير كلمة المرور الخاصة بالحساب =====
  const wrongCurrent = await call('/api/auth?action=change-password', {
    method: 'POST',
    cookie: defaultCookie,
    body: { currentPassword: 'not-it', newPassword: 'NewStrong123' },
  });
  check('تغيير الكلمة بكلمة حالية خطأ => 401', wrongCurrent.status === 401, JSON.stringify(wrongCurrent.json));
  const shortNew = await call('/api/auth?action=change-password', {
    method: 'POST',
    cookie: defaultCookie,
    body: { currentPassword: 'admin123', newPassword: 'abc' },
  });
  check('كلمة مرور جديدة قصيرة => 400', shortNew.status === 400, JSON.stringify(shortNew.json));
  const weakNew = await call('/api/auth?action=change-password', {
    method: 'POST',
    cookie: defaultCookie,
    body: { currentPassword: 'admin123', newPassword: 'password' },
  });
  check('كلمة مرور جديدة شائعة => 400', weakNew.status === 400, JSON.stringify(weakNew.json));

  const changed = await call('/api/auth?action=change-password', {
    method: 'POST',
    cookie: defaultCookie,
    body: { currentPassword: 'admin123', newPassword: 'EmaarGroup2026' },
  });
  check('تغيير ناجح يُصدر جلسة جديدة', changed.status === 200, JSON.stringify(changed.json));
  const changedCookie = cookieOf(changed);
  const unlockedStore = await call('/api/store', { cookie: changedCookie });
  check('وتظل البيانات مفتوحة', unlockedStore.status === 200 && unlockedStore.json.data.crm_clients[0].id === 'c1');
  check('الكلمة القديمة لم تعد تعمل', (await login({ username: 'admin', password: 'admin123', loginType: 'admin' })).status === 401);
  check('الكلمة الجديدة تعمل', (await login({ username: 'admin', password: 'EmaarGroup2026', loginType: 'admin' })).status === 200);
  check(
    'الكلمة الجديدة محفوظة نصاً في القاعدة (يراها الإدارة)',
    db.data.crm_users.find((u) => u.id === 'admin-001').password === 'EmaarGroup2026'
  );

  // ===== ٦) كلمات المرور: الإدارة تراها وتغيّرها، وغير الإدارة لا سلطة لهم =====
  const pulled = await call('/api/store', { cookie: changedCookie });
  check('الإدارة ترى كلمات المرور في رد البيانات', JSON.stringify(pulled.json.data.crm_users).includes('password'));

  const salesEarlyLogin = await login({ username: 'ahmed', password: 'AhmedPass123', loginType: 'sales' });
  const salesEarly = await call('/api/store', { cookie: cookieOf(salesEarlyLogin) });
  check('والسيلز لا يرى أي كلمة مرور في رد البيانات', !JSON.stringify(salesEarly.json).includes('password'));

  // إنشاء حساب **جديد** بكلمة مرور نصية (كما في شاشة إضافة حساب الآن)
  const newUser = { id: 'sales-2', username: 'mona', name: 'منى', role: 'sales', isActive: true, password: 'MonaPass1234' };
  await call('/api/store', {
    method: 'POST',
    cookie: changedCookie,
    body: { key: 'crm_users', value: [...db.data.crm_users, newUser] },
  });
  check('إنشاء حساب جديد بكلمة مرور يعمل', (await login({ username: 'mona', password: 'MonaPass1234', loginType: 'sales' })).status === 200);
  check('وكلمة مروره محفوظة كما أُرسلت (يراها الإدارة)', db.data.crm_users.find((u) => u.id === 'sales-2')?.password === 'MonaPass1234');

  // الإدارة تغيّر كلمة مرور سيلز من النظام => الجديدة تعمل فوراً
  await call('/api/store', {
    method: 'POST',
    cookie: changedCookie,
    body: { key: 'crm_users', value: db.data.crm_users.map((u) => (u.id === 'sales-2' ? { ...u, password: 'MonaChanged456' } : u)) },
  });
  check('تغيير كلمة مرور سيلز من الإدارة يُحفظ', db.data.crm_users.find((u) => u.id === 'sales-2')?.password === 'MonaChanged456');
  check(
    'والكلمة الجديدة تعمل والقديمة لا',
    (await login({ username: 'mona', password: 'MonaChanged456', loginType: 'sales' })).status === 200 &&
      (await login({ username: 'mona', password: 'MonaPass1234', loginType: 'sales' })).status === 401
  );

  // محاولة تغيير كلمة مرور من حساب سيلز => تُهمل تماماً على السيرفر
  await call('/api/store', {
    method: 'POST',
    cookie: cookieOf(salesEarlyLogin),
    body: { key: 'crm_users', value: db.data.crm_users.map((u) => ({ ...u, password: 'AttackerPass1' })) },
  });
  check(
    'كتابة كلمات مرور من حساب سيلز تُهمل تماماً',
    (await login({ username: 'mona', password: 'MonaChanged456', loginType: 'sales' })).status === 200 &&
      (await login({ username: 'admin', password: 'AttackerPass1', loginType: 'admin' })).status === 401 &&
      (await login({ username: 'admin', password: 'EmaarGroup2026', loginType: 'admin' })).status === 200
  );

  // الكتابة بلا كلمة مرور لا تقفل الحساب (حتى من الإدارة)
  const pushWithoutPassword = await call('/api/store', {
    method: 'POST',
    cookie: changedCookie,
    body: { key: 'crm_users', value: db.data.crm_users.map((u) => (u.id === 'sales-1' ? { ...u, password: undefined, name: 'أحمد محمد' } : u)) },
  });
  check('الكتابة بلا كلمة مرور لا تقفل الحساب', pushWithoutPassword.status === 200);
  const salesRow2 = db.data.crm_users.find((u) => u.id === 'sales-1');
  check('كلمة المرور القديمة محفوظة والاسم تغيّر', salesRow2.password.startsWith('sha256:') && salesRow2.name === 'أحمد محمد');
  check('ودخول السيلز ما زال يعمل بكلمته', (await login({ username: 'ahmed', password: 'AhmedPass123', loginType: 'sales' })).status === 200);

  const salesLogin = await login({ username: 'ahmed', password: 'AhmedPass123', loginType: 'sales' });
  check('دخول السيلز يعمل', salesLogin.status === 200);
  const salesCookie = cookieOf(salesLogin);

  // ===== ٧) الجلسة الحالية والخروج =====
  const me = await call('/api/auth?action=me', { cookie: changedCookie });
  check('‎/api/auth?action=me يرجع المستخدم الحالي', me.status === 200 && me.json.user.username === 'admin');
  check('‎/me أيضاً لا يحمل كلمة المرور', !JSON.stringify(me.json).includes('password'));
  check('‎/me بلا كوكي => 401', (await call('/api/auth?action=me')).status === 401);

  const out = await call('/api/auth?action=logout', { method: 'POST', cookie: changedCookie });
  check('الخروج يُبطل الكوكي (Set-Cookie فارغ)', out.status === 200 && /crm_session=;/.test(out.setCookie));
  // الخروج ليس مسحاً للكوكي في المتصفح فقط: السيرفر يرفع إصدار جلسات الحساب،
  // فحتى لو احتُفظ بنسخة من الكوكي القديم فهي ميتة من الآن.
  check('وبعد الخروج يُرفض الكوكي القديم نفسه', (await call('/api/store', { cookie: changedCookie })).status === 401);
  check('وكذلك نقاط الدخول الأخرى', (await call('/api/auth?action=me', { cookie: changedCookie })).status === 401);
  check('وجلسة حساب آخر لم تسقط (الخروج يخص صاحبه)', (await call('/api/store', { cookie: salesCookie })).status === 200);
  const salesOut = await call('/api/auth?action=logout', { method: 'POST', cookie: salesCookie });
  check('وبخروج السيلز تسقط جلسته أيضاً', salesOut.status === 200 && (await call('/api/store', { cookie: salesCookie })).status === 401);
  check('والدخول من جديد بكلمة المرور الحالية يعمل', (await login({ username: 'admin', password: 'EmaarGroup2026', loginType: 'admin' })).status === 200);

  // ===== ٨) بلا AUTH_SECRET: فشل مغلق لا انفتاح =====
  delete process.env.AUTH_SECRET;
  const noSecretStore = await call('/api/store', { cookie: changedCookie });
  check('بلا AUTH_SECRET: البيانات مغلقة (503) وليست مفتوحة', noSecretStore.status === 503, JSON.stringify(noSecretStore.json));
  const noSecretLogin = await login({ username: 'admin', password: 'EmaarGroup2026', loginType: 'admin' });
  check('بلا AUTH_SECRET: الدخول مرفوض بوضوح (503)', noSecretLogin.status === 503);
  process.env.AUTH_SECRET = SECRET;

  // ===== ٩) حد محاولات الدخول =====
  let limited = false;
  for (let i = 0; i < 15; i += 1) {
    const attempt = await login({ username: 'brute', password: 'guess', loginType: 'sales' });
    if (attempt.status === 429) limited = true;
  }
  check('تخمين كلمة المرور بالتجربة المتكررة محدود (429)', limited);

  console.log(`\n✅ كل اختبارات الحماية نجحت (${passed}).`);
} catch (error) {
  console.error('\n❌ فشل اختبار الحماية:', error.message);
  process.exitCode = 1;
} finally {
  server.close();
}
