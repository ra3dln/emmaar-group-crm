// ===== اختبار حقيقي لمسار الإشعارات (Web Push) =====
// الغرض: نثبت أن التذكير يوصل إشعاراً لجهاز صاحبه **في وقته ومرة واحدة**،
// وأن الاشتراك مربوط بالجلسة لا بمعرّف يرسله المتصفح.
//
// ما يُختبر:
//   ١) مفتاح VAPID العام متاح (بلا جلسة — هو ليس سراً)
//   ٢) الاشتراك بلا جلسة مرفوض (401)
//   ٣) مع جلسة: المعرّف يُؤخذ من الجلسة ويتجاهل userId المرسل من المتصفح
//   ٤) تذكير مستحق → POST واحد للجهاز بترويسات Web Push الصحيحة
//   ٥) نفس التذكير لا يُرسل مرتين في الدورة التالية
//   ٦) تذكير مكتمل أو قديم (أكثر من ٦ ساعات) لا يُرسل
//   ٧) الاشتراك المنتهي (410) يُحذف تلقائياً
//   ٨) تذكير مندوب آخر لا يوصل لجهاز مندوب تاني
//
// التشغيل:  node tests/push-smoke.mjs

import http from 'node:http';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';

const SECRET = 'unit-test-secret-0123456789-abcdef';
process.env.AUTH_SECRET = SECRET;

const { createAuthHandler } = await import('../server/authApi.js');
const { createPushHandlerFromStore, processPushesOnce } = await import('../server/push.js');
const { hashPassword } = await import('../server/auth.js');

// ---------- مخزن ذاكرة بنفس واجهة القاعدة ----------
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
const vapidStore = {
  async load() {
    return vapid;
  },
  async save(value) {
    vapid = value;
  },
};
let pushState = { reminders: {}, messages: {} };
const stateStore = {
  async load() {
    return JSON.parse(JSON.stringify(pushState));
  },
  async save(value) {
    pushState = JSON.parse(JSON.stringify(value));
  },
};

const users = [
  {
    id: 'sales-1', username: 'ahmed', name: 'أحمد', role: 'sales', isActive: true,
    password: hashPassword('AhmedPass123'),
  },
  {
    id: 'sales-2', username: 'sara', name: 'سارة', role: 'sales', isActive: true,
    password: hashPassword('SaraPass1234'),
  },
  {
    // مدير (إدارة فقط): تنبيهات النظام (انتهاء توكن السحب) تصله وحده لا المندوبين
    id: 'boss-1', username: 'nour', name: 'نور', role: 'admin', isActive: true,
    password: hashPassword('NourPass1234'),
  },
];
db = { version: 1, data: { crm_users: users } };

const authHandler = createAuthHandler({ storage, env: process.env });
// نفس مخزن الحالة الذي يقرأه المُشغّل الدوري — وإلا فشاشة التشخيص لا تعرف آخر تشغيل
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

// ---------- جهاز وهمي يستقبل الإشعار ----------
let pushStatus = 201;
const received = [];
const device = http.createServer((req, res) => {
  let size = 0;
  req.on('data', (chunk) => { size += chunk.length; });
  req.on('end', () => {
    received.push({ headers: req.headers, size });
    res.statusCode = pushStatus;
    res.end();
  });
});
await new Promise((r) => device.listen(0, '127.0.0.1', r));
const deviceUrl = `http://127.0.0.1:${device.address().port}/push/device-1`;

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

// مفتاح جهاز حقيقي بصيغة Web Push (P-256 غير مضغوط + سر مصادقة ١٦ بايت)
// لكل جهاز مساره الخاص حتى نميّز أي جهاز استلم الإشعار في الاختبار
const deviceKeys = (suffix = 'device-1') => {
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  return {
    endpoint: `http://127.0.0.1:${device.address().port}/push/${suffix}`,
    keys: {
      p256dh: ecdh.getPublicKey().toString('base64url'),
      auth: crypto.randomBytes(16).toString('base64url'),
    },
  };
};

const iso = (minutesFromNow) => new Date(Date.now() + minutesFromNow * 60000).toISOString();

try {
  // ===== ١) مفتاح VAPID =====
  const key = await call('/api/push/key');
  check('مفتاح الإشعارات متاح', key.status === 200 && typeof key.json?.publicKey === 'string');
  const raw = Buffer.from(String(key.json.publicKey).replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  check('المفتاح العام بصيغة P-256 غير مضغوطة (٦٥ بايت)', raw.length === 65 && raw[0] === 4);

  // ===== ٢) بلا جلسة: لا اشتراك ولا إرسال =====
  const anon = await call('/api/push/subscribe', { method: 'POST', body: { userId: 'sales-1', subscription: deviceKeys() } });
  check('اشتراك بلا جلسة مرفوض (401)', anon.status === 401);
  const anonTest = await call('/api/push/test', { method: 'POST', body: { userId: 'sales-1' } });
  check('إشعار تجريبي بلا جلسة مرفوض (401)', anonTest.status === 401);

  // ===== ٣) مع جلسة: الربط بصاحب الجلسة =====
  const login = await call('/api/auth?action=login', {
    method: 'POST',
    body: { username: 'ahmed', password: 'AhmedPass123', loginType: 'sales' },
  });
  check('دخول المندوب نجح', login.status === 200 && !!login.setCookie);
  const cookie = String(login.setCookie).split(';')[0];

  const sub = await call('/api/push/subscribe', {
    method: 'POST',
    cookie,
    body: { userId: 'sales-2', userName: 'منت impersonation', subscription: deviceKeys() },
  });
  check('الاشتراك مع جلسة ينجح', sub.status === 200 && sub.json?.ok === true);
  const saved = (db.data.crm_push_subs || [])[0];
  check('الاشتراك مربوط بصاحب الجلسة لا بالمعرّف المرسل', saved?.userId === 'sales-1', JSON.stringify(saved?.userId));
  check('اسم الجهاز مأخوذ من الجلسة لا من الطلب', saved?.userName === 'ahmed', String(saved?.userName));

  // ===== ٤) تذكير مستحق: إشعار واحد بترويسات صحيحة =====
  db.data.crm_reminders = [
    { id: 'r-due', userId: 'sales-1', clientName: 'هدى سليم', clientPhone: '01010001001', dateTime: iso(-1), isCompleted: false, note: 'اتصال' },
    { id: 'r-done', userId: 'sales-1', clientName: 'مكتمل', clientPhone: '01010001002', dateTime: iso(-1), isCompleted: true },
    { id: 'r-old', userId: 'sales-1', clientName: 'قديم', clientPhone: '01010001003', dateTime: iso(-60 * 7), isCompleted: false },
    { id: 'r-other', userId: 'sales-2', clientName: 'مندوب تاني', clientPhone: '01010001004', dateTime: iso(-1), isCompleted: false },
    { id: 'r-future', userId: 'sales-1', clientName: 'لسه', clientPhone: '01010001005', dateTime: iso(30), isCompleted: false },
  ];
  const first = await processPushesOnce({ storage, vapidStore, stateStore });
  check('تذكير واحد مستحق أُرسل', first.reminders === 1 && first.sent === 1, JSON.stringify(first));
  check('الجهاز استلم POST واحداً', received.length === 1, String(received.length));
  const req0 = received[0] || { headers: {}, size: 0 };
  check('الترويسة Content-Encoding = aes128gcm', req0.headers['content-encoding'] === 'aes128gcm');
  check('Urgency = high (يوقظ الجهاز)', req0.headers.urgency === 'high');
  check('ترويسة VAPID موقّعة', /^vapid t=/.test(String(req0.headers.authorization || '')));
  check('الحمولة مشفّرة (بايتات فعلية)', req0.size > 40);

  // ===== ٥) لا تكرار في الدورة التالية =====
  const second = await processPushesOnce({ storage, vapidStore, stateStore });
  check('نفس التذكير لا يُرسل مرتين', second.sent === 0 && received.length === 1, JSON.stringify(second));

  // ===== ٦) اشتراك منتهٍ (410) يُحذف، والتذكير يفضل مستني (يُعاد) =====
  pushStatus = 410;
  db.data.crm_reminders.push({ id: 'r-late', userId: 'sales-1', clientName: 'عميل', clientPhone: '01010001006', dateTime: iso(-1), isCompleted: false });
  const third = await processPushesOnce({ storage, vapidStore, stateStore });
  check('الاشتراك المنتهي اتحذف من القاعدة', (db.data.crm_push_subs || []).length === 0, String((db.data.crm_push_subs || []).length));
  check('التذكير لم يُعلَّم كمُرسَل بعد فشل الوصول', third.reminders === 0 && third.sent === 0, JSON.stringify(third));

  // ===== ٧) بعد ما العميل يشترك من جديد، نفس التذكير يوصل =====
  pushStatus = 201;
  const resub = await call('/api/push/subscribe', { method: 'POST', cookie, body: { subscription: deviceKeys() } });
  check('إعادة الاشتراك تنجح', resub.status === 200 && resub.json?.ok === true);
  const afterResub = await processPushesOnce({ storage, vapidStore, stateStore });
  check('التذكير المعلَّق وصل بعد إعادة الاشتراك', afterResub.reminders === 1 && afterResub.sent === 1, JSON.stringify(afterResub));

  // ===== ٨) تذكير مندوب بلا أجهزة لا يُستهلك =====
  const before = db.data.crm_reminders.filter((r) => r.userId === 'sales-2' && !r.isCompleted).length;
  const fifth = await processPushesOnce({ storage, vapidStore, stateStore });
  check('بلا أجهزة لمندوب آخر: لا إرسال ولا استهلاك', fifth.sent === 0 && before === 1, JSON.stringify(fifth));

  // ===== ٩) التشخيص: هل الإشعارات شغّالة فعلاً؟ =====
  const healthAnon = await call('/api/push/health');
  check('التشخيص بلا جلسة مرفوض (401)', healthAnon.status === 401);

  const health = await call('/api/push/health', { cookie });
  check('التشخيص يعرض أجهزة صاحب الجلسة', health.status === 200 && health.json.devices === 1, JSON.stringify(health.json));
  check('التشخيص يعرض وقت آخر تشغيل للمُشغّل', Number(health.json.lastRunAt) > 0);
  check('التشخيص يعرض نتيجة آخر إرسال', !!health.json.lastResult);
  check('التشخيص يعدّ التذكيرات المستحقة', Number(health.json.dueReminders) >= 1);

  // ===== ١٠) الإرسال الفوري من أي جهاز مفتوح =====
  const flushAnon = await call('/api/push/flush', { method: 'POST' });
  check('الإرسال الفوري بلا جلسة مرفوض (401)', flushAnon.status === 401);

  db.data.crm_reminders.push({
    id: 'r-mine-now', userId: 'sales-1', clientName: 'عميل جهازي', clientPhone: '01010001007',
    dateTime: iso(-1), isCompleted: false,
  });
  const beforeFlush = received.length;
  // نُصفّر وقت آخر تشغيل حتى لا يُحجب النداء بفاصل الـ٢٠ ثانية
  pushState = { ...pushState, lastRunAt: 0 };
  const flush = await call('/api/push/flush', { method: 'POST', cookie });
  check(
    'الإرسال الفوري يوصل تذكير صاحب الجهاز نفسه (إشعار خارجي، مفيش بطاقة داخلية)',
    flush.status === 200 && flush.json.reminders === 1 && received.length === beforeFlush + 1,
    JSON.stringify(flush.json)
  );
  const flushAgain = await call('/api/push/flush', { method: 'POST', cookie });
  check('النداء المتكرر خلال ٢٠ ثانية لا يضرب القاعدة', flushAgain.json?.skipped === true, JSON.stringify(flushAgain.json));

  // التذكير اتعلّم مُرسَلاً من نفس النداء — المجدول ما يبعتهوش تاني (مرة واحدة بس)
  const afterFlush = await processPushesOnce({ storage, vapidStore, stateStore });
  check(
    'نفس التذكير ما يتكررش من المجدول بعد إرساله فوراً',
    afterFlush.reminders === 0 && received.length === beforeFlush + 1,
    JSON.stringify(afterFlush)
  );

  // ===== ١١) ربط الواجهة وملف العامل =====
  const fs = await import('node:fs');
  const app = fs.readFileSync('src/App.tsx', 'utf8');
  const pushSrc = fs.readFileSync('src/push.ts', 'utf8');
  const swSrc = fs.readFileSync('public/sw.js', 'utf8');
  const serverPushSrc = fs.readFileSync('server/push.js', 'utf8');
  check('ضغط الجرس يعلّم الرسائل مقروءة في السجل المشترك', /openNotifyCenter[\s\S]{0,800}handleMarkRead\(direct\)/.test(app));
  check('تعليم الرسائل مقروءة يُرفع للسيرفر', /handleMarkRead[\s\S]{0,900}pushKey\('crm_messages'\)/.test(app));
  check('كل جهاز مفتوح يطلب الإرسال المستحق دورياً', app.includes('flushPush()') && app.includes("setInterval(run, 60_000)"));
  // ===== التذكير: إشعار خارجي فقط — مفيش تنبيه داخل البرنامج =====
  check('مفيش بطاقة تنبيه تذكير داخل البرنامج', !app.includes('function AlarmBar') && !app.includes('<AlarmBar'));
  check(
    'التذكير المستحق يروح إشعار خارجي من السيرفر لما الجهاز مشترك',
    /pushIsOn === 'subscribed'[\s\S]{0,300}flushPush\(true\)/.test(app)
  );
  check(
    'ولو الجهاز مش مشترك: إشعار محلي مرة واحدة محفوظة',
    /readNotifiedIds\(\)[\s\S]{0,900}writeNotifiedIds\(notified\)/.test(app) && app.includes("reminderNotifiedKey = 'crm_notified'")
  );
  check('إشعار التذكير يفتح التطبيق بلا رابط منبه داخلي', serverPushSrc.includes("url: '/',"));
  check('مركز الإشعارات يعرض تشخيص الإشعارات الخارجية', app.includes('pushHealth') && app.includes('الإشعارات الخارجية'));
  check('إعادة الاشتراك عند مفتاح قديم (InvalidStateError)', pushSrc.includes('stale.unsubscribe()'));
  check('ملف العامل يعرض الإشعار بمحاولة آمنة', swSrc.includes('showSafe') && swSrc.includes('requireInteraction'));
  check('إشعار الرقم الجديد يفتح الصفحة عند اللمس', swSrc.includes('notificationclick') && swSrc.includes('openWindow'));
  // إشعار «رقم فريش جديد نزل ليك» للمندوب: يُحسب من وقت الإسناد لا الوصول، ويُسجَّل
  // لكل «رقم × مستلم» على حدة، ويحمل اسم الفورم الذي نزل منه الرقم.
  check('إشعار الرقم يُحسب من وقت الإسناد', serverPushSrc.includes('lead.assignedAt || lead.createdAt'));
  check('إشعار الرقم يُسجّل لكل «رقم × مستلم»', serverPushSrc.includes('`${lead.id}|${target}`'));
  check('إشعار الرقم يحمل اسم الفورم', serverPushSrc.includes('one?.formName'));
  check(
    'الإشعار الخارجي يقول «رقم فريش جديد نزل ليك»',
    serverPushSrc.includes('رقم فريش جديد نزل ليك') && serverPushSrc.includes('أرقام فريش جديدة نزلت ليك')
  );
  const centerSrc = app.slice(app.indexOf('function NotificationsCenter'), app.indexOf('function NotificationsPanel'));
  check(
    'مفيش إشعار داخلي «أرقام جديدة» في مركز الإشعارات',
    !centerSrc.includes("{ id: 'leads'") &&
      !centerSrc.includes("tab === 'leads'") &&
      !app.includes('leads={notifLeads}') &&
      !app.includes('`lead-${l.id}`')
  );
  check(
    'الواجهة لسه بتعلّم وقت الإسناد على الرقم (لحساب لحظة الإسناد في الإشعار)',
    app.includes('assignedAt: movedAt')
  );

  // ===== ١٢) تنبيهات النظام (انتهاء توكن السحب) — تصل الإدارة وحدها ولا تتكرر كل دورة =====
  const bossLogin = await call('/api/auth?action=login', {
    method: 'POST',
    body: { username: 'nour', password: 'NourPass1234', loginType: 'admin' },
  });
  check('دخول المدير نجح', bossLogin.status === 200 && !!bossLogin.setCookie);
  const bossCookie = String(bossLogin.setCookie).split(';')[0];
  const bossSub = await call('/api/push/subscribe', {
    method: 'POST',
    cookie: bossCookie,
    body: { subscription: deviceKeys('device-boss') },
  });
  check('المدير اشترك بجهازه', bossSub.status === 200 && bossSub.json?.ok === true);

  const expiringAlert = {
    id: 'lead-token-facebook-1790000000',
    title: '⏰ توكن سحب فيسبوك ينتهي قريباً',
    body: 'باقٍ يوم على انتهاء التوكن — ولّد توكن جديداً قبل أن يتوقف السحب.',
    url: '/',
  };
  const beforeAlert = received.length;
  const alertRun = await processPushesOnce({ storage, vapidStore, stateStore, systemAlerts: [expiringAlert] });
  check('تنبيه انتهاء التوكن أُرسل مرة واحدة', alertRun.alerts === 1 && alertRun.sent === 1, JSON.stringify(alertRun));
  const alertReq = received[received.length - 1] || { headers: {} };
  check(
    'التنبيه وصل لجهاز المدير وحده (جهاز المندوب ساكن)',
    received.length === beforeAlert + 1 && String(alertReq.headers?.authorization || '').startsWith('vapid t='),
    String(received.length - beforeAlert)
  );

  const alertAgain = await processPushesOnce({ storage, vapidStore, stateStore, systemAlerts: [expiringAlert] });
  check('نفس التنبيه لا يتكرر خلال ١٢ ساعة', alertAgain.alerts === 0 && received.length === beforeAlert + 1, JSON.stringify(alertAgain));

  // بلا تنبيهات مستحقة: الدورة العادية لا تُرسل شيئاً إضافياً
  const calmRun = await processPushesOnce({ storage, vapidStore, stateStore, systemAlerts: [] });
  check('دورة بلا تنبيهات لا تُرسل شيئاً', calmRun.sent === 0 && calmRun.alerts === 0, JSON.stringify(calmRun));

  // ===== ١٣) رقم جديد نزل → إشعار فوري لصاحبه حتى لو الموقع مقفول =====
  // المحرك يعمل على السيرفر (cron / setInterval) فلا يعتمد على متصفح مفتوح.
  db.data.crm_assigned_leads = [
    {
      id: 'lead-1', name: 'عميل جديد', phone: '01010002001', salesId: 'sales-1',
      createdAt: new Date(Date.now() - 60_000).toISOString(), formName: 'GO ADS | CAVA',
    },
    // رقم قديم (أكثر من ٦ ساعات) لا ينبّه — لا نزعج الفريق بأرشيف قديم
    {
      id: 'lead-old', name: 'قديم', phone: '01010002009', salesId: 'sales-1',
      createdAt: new Date(Date.now() - 7 * 60 * 60_000).toISOString(),
    },
  ];
  const beforeLead = received.length;
  const leadRun = await processPushesOnce({ storage, vapidStore, stateStore });
  check('الرقم الجديد أرسل إشعاراً واحداً', leadRun.leads === 1 && received.length === beforeLead + 1, JSON.stringify(leadRun));
  check('التاريخ القديم لم يُنبّه', (pushState.leads || {})['lead-old'] === undefined, JSON.stringify(pushState.leads));

  const leadAgain = await processPushesOnce({ storage, vapidStore, stateStore });
  check('نفس الرقم لا يُرسل مرتين', leadAgain.leads === 0 && received.length === beforeLead + 1, JSON.stringify(leadAgain));

  // رقم غير موزّع: مفيش إشعار — «رقم جديد في الفورم» بقى إشعار خارجي لكل سيلز
  // عن أرقامه هو بس (الإدارة بتشوف الأرقام غير الموزّعة في «توزيع الأرقام»).
  db.data.crm_assigned_leads.push({
    id: 'lead-2', name: 'بانتظار التوزيع', phone: '01010002002', salesId: '',
    createdAt: new Date(Date.now() - 30_000).toISOString(), formName: 'فورم فيلات',
  });
  const unassignedRun = await processPushesOnce({ storage, vapidStore, stateStore });
  check(
    'الرقم غير الموزّع ما بيبعتهش إشعار (مفيش إزعاج للإدارة)',
    unassignedRun.leads === 0 && received.length === beforeLead + 1,
    JSON.stringify(unassignedRun)
  );
  check(
    'الرقم غير الموزّع ما اتسجّلش كمُرسَل',
    (pushState.leads || {})['lead-2|managers'] === undefined &&
      Object.keys(pushState.leads || {}).every((k) => !k.startsWith('lead-2')),
    JSON.stringify(pushState.leads)
  );

  // الدفعة الواحدة تُجمَّع في إشعار واحد لا إشعار لكل رقم
  db.data.crm_assigned_leads.push(
    ...Array.from({ length: 5 }, (_, i) => ({
      id: `lead-batch-${i}`,
      name: `عميل دفعة ${i}`,
      phone: `0101000300${i}`,
      salesId: 'sales-1',
      createdAt: new Date(Date.now() - 20_000).toISOString(),
      formName: 'دفعة',
    }))
  );
  const beforeBatch = received.length;
  const batchRun = await processPushesOnce({ storage, vapidStore, stateStore });
  check(
    'دفعة ٥ أرقام = إشعار واحد (لا إغراق)',
    batchRun.leads === 5 && received.length === beforeBatch + 1,
    JSON.stringify(batchRun)
  );

  // ===== ١٤) رقم يوصل غير موزّع ثم يتوزّع: صاحبه وحده يتبنبّه =====
  // «رقم جديد في الفورم» بقى إشعار خارجي لكل سيلز عن أرقامه هو بس — فالرقم غير
  // الموزّع ما بيبعتهش إشعار، ولما يتوزّع على مندوب يوصله إشعار فريش واحد.
  db.data.crm_assigned_leads = [
    {
      id: 'lead-late',
      name: 'رقم اتوزّع بعد شوية',
      phone: '01010004001',
      salesId: '',
      createdAt: new Date(Date.now() - 3 * 24 * 60 * 60_000).toISOString(),
      formName: 'فورم أكتوبر',
    },
  ];
  const beforeLate = received.length;
  const staleRun = await processPushesOnce({ storage, vapidStore, stateStore });
  check('رقم قديم غير موزّع لا يزعج أحداً', staleRun.leads === 0 && received.length === beforeLate, JSON.stringify(staleRun));

  db.data.crm_assigned_leads[0].createdAt = new Date(Date.now() - 60_000).toISOString();
  const arrivedRun = await processPushesOnce({ storage, vapidStore, stateStore });
  check(
    'رقم جديد غير موزّع ما بيبعتهش إشعار لأحد',
    arrivedRun.leads === 0 && received.length === beforeLate,
    JSON.stringify(arrivedRun)
  );

  // دلوقتي بيتوزّع على مندوب: يوصله إشعار واحد (رقم فريش جديد نزل ليك)
  db.data.crm_assigned_leads[0].salesId = 'sales-1';
  db.data.crm_assigned_leads[0].assignedAt = new Date().toISOString();
  const assignedRun = await processPushesOnce({ storage, vapidStore, stateStore });
  check(
    'الرقم لما يتوزّع يوصل صاحبه إشعار واحد',
    assignedRun.leads === 1 && received.length === beforeLate + 1,
    JSON.stringify(assignedRun)
  );
  const repeatRun = await processPushesOnce({ storage, vapidStore, stateStore });
  check('إشعار التوزيع لا يتكرر كل دورة', repeatRun.leads === 0 && received.length === beforeLate + 1, JSON.stringify(repeatRun));

  // نفس الرقم لو اتنقل لمندوب بلا أجهزة: الإشعار ما يضيعش ولا يتسجّل كمُرسَل
  db.data.crm_assigned_leads[0].salesId = 'sales-2';
  db.data.crm_assigned_leads[0].assignedAt = new Date().toISOString();
  const movedRun = await processPushesOnce({ storage, vapidStore, stateStore });
  check(
    'رقم اتنقل لمندوب بلا أجهزة: ما يتسجّلش كمُرسَل (يُعاد لما يشترك)',
    movedRun.leads === 0 &&
      received.length === beforeLate + 1 &&
      (pushState.leads || {})['lead-late|sales-2'] === undefined,
    JSON.stringify(movedRun)
  );

  // ===== التذكيرات إشعار خارجي فقط — مفيش نسخة داخل البرنامج =====
  const appSrc = fs.readFileSync('src/App.tsx', 'utf8');
  const center = appSrc.slice(appSrc.indexOf('function NotificationsCenter'), appSrc.indexOf('function NotificationsPanel'));
  check(
    'مركز الإشعارات مبقاش فيه تبويب «تذكيرات»',
    !center.includes("{ id: 'reminders'") && !center.includes("tab === 'reminders'")
  );
  check(
    'التذكيرات مش بتتحسب في عدّاد الجرس',
    !appSrc.includes('`rem-${r.id}`') && !appSrc.includes('notifReminders')
  );
  check(
    'شارة «تذكير متأخر» اتشالت من الجرس',
    !appSrc.includes('delayedRemindersCount')
  );
  check(
    'التذكير بيتعلّم مُرسَلًا مرة واحدة ويمنع التكرار على السيرفر',
    fs.readFileSync('server/push.js', 'utf8').includes('state.reminders[reminder.id] = now')
  );

  console.log(`\n✅ كل اختبارات الإشعارات نجحت (${passed}).`);
} finally {
  server.close();
  device.close();
}
