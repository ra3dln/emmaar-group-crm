// ===== اختبار وصول فيدباك السيلز إلى «الفيدباك اليومي» عند الإدارة =====
// العطل المُبلَّغ عنه: «السيلز حطّ فيدباك وما وصلش للفيدباك اليومي عند الإدارة».
// السبب: بعض الشاشات كانت تكتب البطاقة في localStorage فقط بلا pushKey، فتبقى
// على جهاز السيلز ولا تصل قاعدة البيانات أصلاً — فمهما صحّت شاشة الإدارة لن تجد شيئًا.
//
// ما يُختبر هنا:
//   ١) السيرفر: بطاقة فيدباك يرفعها حساب سيلز تُقرأ فعلاً بحساب الإدارة.
//   ٢) السيرفر: جهاز قديم يرفع قائمته الناقصة لا يمسح فيدباك غيره (دمج بالمعرّف).
//   ٣) الكود: كل مسار حفظ للفيدباك اليومي بينتظر pushKey ويتعامل مع النتيجة.
//
// التشغيل: node tests/daily-feedback-sync.mjs

import http from 'node:http';
import fs from 'node:fs';
import assert from 'node:assert/strict';

process.env.AUTH_SECRET = 'unit-test-secret-0123456789-abcdef';

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
const push = (key, value, cookie) => call('/api/store', { method: 'POST', body: { key, value }, cookie });
const pull = async (cookie) => (await call('/api/store', { cookie })).json?.data || {};

let passed = 0;
const check = (label, condition, extra = '') => {
  assert.ok(condition, `✗ ${label} ${extra}`);
  passed += 1;
  console.log(`✓ ${label}`);
};

const ADMIN = {
  id: 'admin-001',
  username: 'admin',
  name: 'إدارة MSA',
  role: 'admin',
  team: '',
  isActive: true,
  password: 'admin123',
  createdAt: '2026-01-01T00:00:00.000Z',
};
const SALES = {
  id: 'sales-1',
  username: 'ahmed',
  name: 'أحمد',
  role: 'sales',
  team: 'فريق أ',
  isActive: true,
  password: 'AhmedStrong123',
  createdAt: '2026-02-01T00:00:00.000Z',
};

db = { version: 1, data: { crm_users: [ADMIN, SALES], crm_daily_feedback: [], crm_tombstones: [] } };

const sales = await login({ username: 'ahmed', password: 'AhmedStrong123', loginType: 'sales' });
check('دخول السيلز يعمل', sales.status === 200, JSON.stringify(sales.json));
const salesCookie = cookieOf(sales);

const admin = await login({ username: 'admin', password: 'admin123', loginType: 'admin' });
check('دخول الإدارة يعمل', admin.status === 200, JSON.stringify(admin.json));
const adminCookie = cookieOf(admin);

// ===== ١) فيدباك السيلز يوصل قاعدة البيانات وتقرأه الإدارة =====
const card = {
  id: 'fb-1',
  userId: SALES.id,
  clientPhone: '01111711986',
  clientName: 'Eman Rehan',
  date: '2026-10-24T11:08:00.000Z',
  feedback: 'No answer',
  callStatus: 'no-answer',
  status: 'follow-up',
  createdAt: '2026-10-24T11:08:00.000Z',
};
const pushRes = await push('crm_daily_feedback', [card], salesCookie);
check('رفع بطاقة الفيدباك من جهاز السيلز ينجح', pushRes.status === 200, JSON.stringify(pushRes.json));

const adminData = await pull(adminCookie);
const seenByAdmin = (adminData.crm_daily_feedback || []).find((f) => f.id === card.id);
check('الإدارة تقرأ نفس البطاقة في الفيدباك اليومي', !!seenByAdmin);
check('والبطاقة محفوظة باسم كاتبها (السيلز) لا باسم صاحب العميل', seenByAdmin?.userId === SALES.id);
check('والحالة والكومنت محفوظان كما هما', seenByAdmin?.feedback === 'No answer' && seenByAdmin?.status === 'follow-up');

// ===== ٢) جهاز قديم لا يمسح فيدباك غيره =====
await push('crm_daily_feedback', [card, { ...card, id: 'fb-2', feedback: 'اتصال' }], salesCookie);
await push('crm_daily_feedback', [], salesCookie); // جهاز فاضي يرفع قائمة فارغة
const afterStale = (await pull(adminCookie)).crm_daily_feedback || [];
check(
  'جهاز قديم يرفع قائمة فارغة لا يمسح الفيدباك الموجود',
  afterStale.some((f) => f.id === 'fb-1') && afterStale.some((f) => f.id === 'fb-2'),
  JSON.stringify(afterStale.map((f) => f.id))
);

// ===== ٣) كل مسارات الحفظ في الواجهة تنتظر الرفع =====
const app = fs.readFileSync('src/App.tsx', 'utf8');

const waitForPush = (label, snippet) => check(label, snippet.includes("pushKey('crm_daily_feedback')"));

waitForPush(
  'نافذة «إضافة فيدباك» بتنتظر رفع البطاقة للسيرفر',
  app.slice(app.indexOf('function AddFeedbackModal'), app.indexOf('function AddFeedbackModal') + 6000)
);
waitForPush(
  'صندوق الفيدباك داخل الكارت (العملاء والمراحل) بينتظر الرفع',
  app.slice(app.indexOf('function ClientFeedbackCard'), app.indexOf('function ClientFeedbackCard') + 8000)
);
check(
  'الرفع داخل الكارت بيغطي العميل والبطاقة معاً',
  /\[clientsOk, feedbackOk\] = await Promise\.all\(\[\s*pushKey\('crm_clients'\),\s*pushKey\('crm_daily_feedback'\),/.test(app)
);
check(
  'فشل الرفع بيظهر للمستخدم بدل ما يضيع بصمت',
  app.includes('fc-sync-error') && app.includes('ماوصلش لقاعدة البيانات')
);
check(
  'القيام بالرفع في نافذة الإضافة يغطي العميل لو الفيدباك مربوط بعميل',
  /pushKey\('crm_daily_feedback'\),[\s\S]{0,160}pushKey\('crm_clients'\)/.test(
    app.slice(app.indexOf('function AddFeedbackModal'), app.indexOf('function AddFeedbackModal') + 6000)
  )
);

// كل setItem على مفتاح الفيدباك لازم يتبعه رفع في نفس الدالة (نافذة 1200 حرف)
const writes = [...app.matchAll(/localStorage\.setItem\(\s*'crm_daily_feedback'/g)].map((m) => m.index || 0);
check('كل كتابة للفيدباك اليومي في الكود قابلة للتتبّع', writes.length >= 4, String(writes.length));
for (const at of writes) {
  const windowText = app.slice(at, at + 1600);
  assert.ok(
    windowText.includes("pushKey('crm_daily_feedback')"),
    `✗ كتابة فيدباك بلا رفع للسيرفر عند الموضع ${at}`
  );
}
passed += 1;
console.log('✓ كل كتابة للفيدباك اليومي يتبعها رفع للسيرفر (مفيش حفظ محلي فقط)');

console.log(`\n✅ كل اختبارات وصول الفيدباك اليومي نجحت (${passed}).`);
server.close();
