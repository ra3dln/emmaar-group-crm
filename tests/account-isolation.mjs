// ===== اختبار «كل حساب منفصل عن التاني» =====
// الغرض: نثبت أن إشعار الرسالة يوصل لصاحب المحادثة **وحده** لا لكل الأعضاء،
// وأن تشغيل البيانات في الواجهة يُرشِّح كل قائمة بحساب صاحبها.
//
// ما يُختبر:
//   ١) رسالة خاصة لمندوب → جهازه وحده يستلم POST (وجهاز زميله ساكن)
//   ٢) رسالة لمندوب تاني → جهازه التاني فقط
//   ٣) رسالة غرفة المدراء → أجهزة المدراء (ما عدا الكاتب) ولا شيء للمندوبين
//   ٤) الواجهة تُصفّي العملاء/الفيدباك/التذكيرات/الأرقام/المكالمات/الرسائل بنطاق الحساب
//      ولا تعود للربط بالرقم الذي كان يعرض فيدباك مندوب عند مندوب آخر
//
// التشغيل:  node tests/account-isolation.mjs

import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import assert from 'node:assert/strict';

const SECRET = 'unit-test-secret-0123456789-abcdef';
process.env.AUTH_SECRET = SECRET;

const { createAuthHandler } = await import('../server/authApi.js');
const { createPushHandlerFromStore, processPushesOnce } = await import('../server/push.js');
const { hashPassword } = await import('../server/auth.js');

let db = { version: 0, data: {} };
const storage = {
  configured: true,
  async load() {
    return { version: db.version, data: JSON.parse(JSON.stringify(db.data)) };
  },
  async save(next) {
    db = { version: Number(next.version) || 0, data: JSON.parse(JSON.stringify(next.data)) };
  },
};

let vapid = null;
const vapidStore = { async load() { return vapid; }, async save(value) { vapid = value; } };
let pushState = { reminders: {}, messages: {} };
const stateStore = {
  async load() { return JSON.parse(JSON.stringify(pushState)); },
  async save(value) { pushState = JSON.parse(JSON.stringify(value)); },
};

const users = [
  { id: 'admin-1', username: 'boss', name: 'الإدارة', role: 'admin', isActive: true, password: hashPassword('BossPass1234') },
  { id: 'sales-1', username: 'ahmed', name: 'أحمد', role: 'sales', isActive: true, password: hashPassword('AhmedPass123') },
  { id: 'sales-2', username: 'sara', name: 'سارة', role: 'sales', isActive: true, password: hashPassword('SaraPass1234') },
];
db = { version: 1, data: { crm_users: users } };

const authHandler = createAuthHandler({ storage, env: process.env });
const { handler: pushHandler } = await createPushHandlerFromStore({ storage, vapidStore, stateStore, auth: process.env });

const server = http.createServer((req, res) => {
  const path = (req.url || '').split('?')[0];
  if (path.startsWith('/api/auth')) return authHandler(req, res);
  if (path.startsWith('/api/push')) return pushHandler(req, res);
  res.statusCode = 404;
  res.end('{}');
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

// جهاز وهمي واحد يسجّل مسار كل إشعار وصل (كل حساب له مسار مختلف)
const received = [];
const device = http.createServer((req, res) => {
  let size = 0;
  req.on('data', (chunk) => { size += chunk.length; });
  req.on('end', () => {
    received.push({ path: String(req.url || ''), headers: req.headers, size });
    res.statusCode = 201;
    res.end();
  });
});
await new Promise((r) => device.listen(0, '127.0.0.1', r));
const devicePort = device.address().port;

const call = async (path, { method = 'GET', body, cookie } = {}) => {
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { json = null; }
  return { status: res.status, json, setCookie: res.headers.get('set-cookie') || '' };
};

let passed = 0;
const check = (label, condition, extra = '') => {
  assert.ok(condition, `✗ ${label} ${extra}`);
  passed += 1;
  console.log(`✓ ${label}`);
};

const deviceKeys = (suffix) => {
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  return {
    endpoint: `http://127.0.0.1:${devicePort}/push/${suffix}`,
    keys: {
      p256dh: ecdh.getPublicKey().toString('base64url'),
      auth: crypto.randomBytes(16).toString('base64url'),
    },
  };
};

const loginCookie = async (username, password, loginType) => {
  const res = await call('/api/auth?action=login', { method: 'POST', body: { username, password, loginType } });
  assert.equal(res.status, 200, `دخول ${username} فشل`);
  return String(res.setCookie).split(';')[0];
};

// كل حساب يشترك بجهازه — أجهزة منفصلة تماماً
const cookies = {
  admin: await loginCookie('boss', 'BossPass1234', 'admin'),
  one: await loginCookie('ahmed', 'AhmedPass123', 'sales'),
  two: await loginCookie('sara', 'SaraPass1234', 'sales'),
};
await call('/api/push/subscribe', { method: 'POST', cookie: cookies.admin, body: { subscription: deviceKeys('boss') } });
await call('/api/push/subscribe', { method: 'POST', cookie: cookies.one, body: { subscription: deviceKeys('ahmed') } });
await call('/api/push/subscribe', { method: 'POST', cookie: cookies.two, body: { subscription: deviceKeys('sara') } });
check('ثلاثة أجهزة مشتركة لثلاثة حسابات', (db.data.crm_push_subs || []).length === 3);

const nowIso = () => new Date().toISOString();
const paths = () => received.map((r) => r.path);

try {
  // ===== ١) رسالة خاصة لأحمد =====
  db.data.crm_messages = [
    { id: 'm-1', fromId: 'admin-1', fromName: 'الإدارة', toId: 'sales-1', text: 'رسالة خاصة بأحمد', createdAt: nowIso() },
  ];
  const run1 = await processPushesOnce({ storage, vapidStore, stateStore });
  check('رسالة أحمد أُرسلت مرة واحدة', run1.messages === 1 && run1.sent === 1, JSON.stringify(run1));
  check(
    'وصلت لجهاز أحمد وحده (سارة والإدارة ساكنين)',
    paths().length === 1 && paths()[0] === '/push/ahmed',
    JSON.stringify(paths())
  );

  // ===== ٢) رسالة خاصة لسارة =====
  db.data.crm_messages.push({ id: 'm-2', fromId: 'admin-1', fromName: 'الإدارة', toId: 'sales-2', text: 'رسالة خاصة بسارة', createdAt: nowIso() });
  await processPushesOnce({ storage, vapidStore, stateStore });
  check(
    'رسالة سارة وصلت لجهازها فقط',
    paths().length === 2 && paths()[1] === '/push/sara',
    JSON.stringify(paths())
  );

  // ===== ٣) غرفة المدراء: إشعار للمدراء لا للمندوبين =====
  // (كانت الرسالة المشتركة لا تُرسل لأحد لأن المعرّف 'managers' ليس حساباً)
  db.data.crm_messages.push({ id: 'm-3', fromId: 'sales-1', fromName: 'أحمد', toId: 'managers', text: 'استفسار للفريق الإداري', createdAt: nowIso() });
  await processPushesOnce({ storage, vapidStore, stateStore });
  check(
    'رسالة الغرفة وصلت لجهاز الإدارة',
    paths().length === 3 && paths()[2] === '/push/boss',
    JSON.stringify(paths())
  );
  check('رسالة الغرفة لم تصل للمندوبين', !paths().slice(0, 2).includes('/push/boss'));

  // ===== ٤) فصل البيانات في الواجهة =====
  const app = fs.readFileSync('src/App.tsx', 'utf8');
  check('بيانات الحساب تُحدَّد بنطاق واحد (inMyScope)', app.includes('const inMyScope =') && app.includes('myScopeIds'));
  check(
    'العملاء والتذكيرات والفيدباك تُرشَّح بنطاق الحساب',
    /setClients\([\s\S]{0,200}inMyScope\(c\.userId\)[\s\S]{0,200}inMyScope\(c\.assignedTo\)/.test(app) &&
      /setReminders\(allReminders\.filter\(\(r: Reminder\) => inMyScope\(r\.userId\)\)\)/.test(app) &&
      /setDailyFeedbacks\(allFeedbacks\.filter\(\(f: DailyFeedback\) => inMyScope\(f\.userId\)\)\)/.test(app)
  );
  check(
    'الأرقام الموزّعة والمكالمات والرسائل تُرشَّح للحساب',
    /setAssignedLeads\(allAssignedLeads\.filter\(\(l: AssignedLead\) => inMyScope\(l\.salesId\)\)\)/.test(app) &&
      /setCallLogs\(getCallLogs\(\)\.filter\(\(l: CallLog\) => inMyScope\(l\.salesId\)\)\)/.test(app) &&
      /setMessages\([\s\S]{0,160}m\.fromId === currentUser\.id \|\| m\.toId === currentUser\.id/.test(app)
  );
  check(
    'لا ربط للفيدباك بالرقم (كان يسرّب فيدباك مندوب لمندوب آخر)',
    !/myNumbers\.has\(digits\(f\.clientPhone\)\)/.test(app) &&
      !/f\.clientPhone && myPhones\.has/.test(app)
  );
  check('الحساب الإداري وحده يرى كل البيانات', /if \(currentUser\.role === 'admin'\) return null;/.test(app));

  console.log(`\n✅ كل اختبارات فصل الحسابات نجحت (${passed}).`);
} finally {
  server.close();
  device.close();
}
