// ===== اختبار حقيقي للمسار السحابي بالكامل (بلا أي حساب أو تكلفة) =====
// نشغّل «محاكي Upstash Redis REST» على منفذ محلي + سيرفر CSV وهمي (بديل Google Sheet)،
// ثم نستدعي نفس دوال الاستضافة (api/store.js و api/lead-source.js و api/cron.js)
// ونتأكد أن: البيانات تُحفظ وتُقرأ، والتوزيع يوزّع الأرقام فعلاً، والتشغيل الدوري يعمل،
// والمكرر لا يُضاف، والمفتاح السري يحمي الرابط.
// وداخل القناتين: فيسبوك وإنستجرام كل قناة بمصدرها ومؤشرها، وفشل إحداهما لا يوقف الأخرى.
//
// التشغيل:  node tests/redis-smoke.mjs

import http from 'node:http';
import assert from 'node:assert/strict';

// ---------- محاكي Redis REST (نفس عقد Upstash: POST /pipeline) ----------
const redisData = new Map();
let redisCommands = 0;

const redisServer = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (chunk) => {
    raw += chunk;
  });
  req.on('end', () => {
    if (!(req.url || '').startsWith('/pipeline')) {
      res.statusCode = 404;
      return res.end(JSON.stringify({ error: 'not found' }));
    }
    if (req.headers.authorization !== 'Bearer test-token') {
      res.statusCode = 401;
      return res.end(JSON.stringify({ error: 'bad token' }));
    }
    let commands = [];
    try {
      commands = JSON.parse(raw || '[]');
    } catch {
      commands = [];
    }
    redisCommands += commands.length;
    const out = commands.map((cmd) => {
      const [op, key, value] = cmd;
      switch (String(op).toUpperCase()) {
        case 'SET':
          redisData.set(key, String(value));
          return { result: 'OK' };
        case 'GET':
          return { result: redisData.has(key) ? redisData.get(key) : null };
        case 'DEL':
          redisData.delete(key);
          return { result: 1 };
        default:
          return { result: null };
      }
    });
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(out));
  });
});

// ---------- سيرفر CSV وهمي (بديل «رابط ملف منشور») ----------
// مساران: /sheet.csv لفيسبوك و /insta.csv لإنستجرام — لكل قناة ملفها المستقل
let csvRows = [];
let instaRows = [];
const csvServer = http.createServer((req, res) => {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.end(((req.url || '').includes('insta') ? instaRows : csvRows).join('\n'));
});

const listen = (server) =>
  new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));

const redisPort = await listen(redisServer);
const csvPort = await listen(csvServer);

// ---------- متغيّرات البيئة قبل تحميل دوال الاستضافة ----------
process.env.UPSTASH_REDIS_REST_URL = `http://127.0.0.1:${redisPort}`;
process.env.UPSTASH_REDIS_REST_TOKEN = 'test-token';
process.env.CRON_SECRET = 'secret-123';
// مفتاح توقيع الجلسات: أصبح إلزامياً لأن نقطة البيانات مغلقة بلا جلسة صحيحة
process.env.AUTH_SECRET = 'test-secret-0123456789-0123456789';
delete process.env.STORE_TOKEN;

const storeApi = (await import('../api/store.js')).default;
const leadSourceApi = (await import('../api/lead-source.js')).default;
const cronApi = (await import('../api/cron.js')).default;
const authApi = (await import('../api/auth.js')).default;
const { createStoreHandler } = await import('../server/store.js');
const { hashPassword } = await import('../server/auth.js');

// ---------- استدعاء دالة استضافة كما يفعل Vercel ----------
// كوكي الجلسة بعد تسجيل الدخول — يُرسل مع كل طلب بيانات كما يفعل المتصفح
let AUTH_COOKIE = '';

const call = async (handler, { method = 'GET', url = '/api/store', body, headers = {} } = {}) => {
  const req = {
    method,
    url,
    headers: {
      'x-forwarded-for': '10.0.0.1',
      ...(AUTH_COOKIE ? { cookie: AUTH_COOKIE } : {}),
      ...headers,
    },
    body,
    socket: {},
  };
  let payload = '';
  const res = {
    statusCode: 0,
    headers: {},
    setHeader(k, v) {
      this.headers[k.toLowerCase()] = v;
    },
    end(chunk) {
      payload = chunk || '';
    },
  };
  await handler(req, res);
  let json = null;
  try {
    json = JSON.parse(payload);
  } catch {
    json = null;
  }
  return { status: res.statusCode, json, headers: res.headers };
};

// ---------- محاكي Graph API لميتا (مسار الكامبين بالتوكن) ----------
// يُعيد نفس شكل ردود فيسبوك الحقيقية: /me/accounts ثم /{page}/leadgen_forms ثم /{form}/leads
// ويحترم فلتر time_created الذي يرسله الكود، فنتحقق من مؤشر «آخر سحب» فعلياً.
function installGraphMock() {
  const realFetch = globalThis.fetch;
  const calls = [];
  const leads = {
    'form-fb': [
      {
        id: 'lead-fb-1',
        created_time: '2026-10-15T09:00:00+0000',
        field_data: [
          { name: 'full_name', values: ['عميل توكن'] },
          { name: 'phone_number', values: ['+20 106 666 0001'] },
        ],
      },
    ],
    'form-ig': [
      {
        id: 'lead-ig-1',
        created_time: '2026-10-15T09:30:00+0000',
        field_data: [
          { name: 'full_name', values: ['عميل إنستجرام توكن'] },
          { name: 'phone_number', values: ['01066660002'] },
        ],
      },
    ],
    // نموذج يُسحب بمعرّفه فقط (بدون صفحة مكتشفة)
    'form-direct': [
      {
        id: 'lead-direct-1',
        created_time: '2026-10-16T10:00:00+0000',
        field_data: [
          { name: 'full_name', values: ['عميل فورم مباشر'] },
          { name: 'phone_number', values: ['01066660003'] },
        ],
      },
    ],
  };
  const json = (data) => ({ ok: true, status: 200, json: async () => data });

  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (!url.includes('graph.facebook.com')) return realFetch(input, init);
    calls.push(url);
    const parsed = new URL(url);
    const path = parsed.pathname;

    if (path.endsWith('/me/accounts')) {
      return json({
        data: [
          { id: 'page-fb', name: 'صفحة إعمار', access_token: 'PAGE-FB-TOKEN' },
          { id: 'page-ig', name: 'صفحة إعمار على إنستجرام', access_token: 'PAGE-IG-TOKEN' },
        ],
      });
    }
    const formsMatch = /^\/v[\d.]+\/([^/]+)\/leadgen_forms$/.exec(path);
    if (formsMatch) return json({ data: [{ id: 'form-fb', name: 'فورم فيسبوك أكتوبر', status: 'ACTIVE', leads_count: 1 }, { id: 'form-ig', name: 'فورم إنستجرام أكتوبر', status: 'ACTIVE', leads_count: 1 }] });

    const leadsMatch = /^\/v[\d.]+\/([^/]+)\/leads$/.exec(path);
    if (leadsMatch) {
      const formId = leadsMatch[1];
      let rows = leads[formId] || [];
      const filtering = parsed.searchParams.get('filtering');
      if (filtering) {
        const since = Number(JSON.parse(filtering)?.[0]?.value) || 0;
        rows = rows.filter((lead) => Math.floor(Date.parse(lead.created_time) / 1000) > since);
      }
      if (process.env.DEBUG_GRAPH) console.error('DEBUG mock returns', formId, rows.length, 'of', (leads[formId] || []).length);
      return json({ data: rows });
    }
    return json({ error: { message: 'unsupported', code: 1 } });
  };

  return {
    calls,
    pushLead: (formId, lead) => leads[formId]?.push(lead),
    restore: () => {
      globalThis.fetch = realFetch;
    },
  };
}

// نفس ما يرسله أي جهاز حقيقي: قائمة المستخدمين كما في المتصفح (بلا أي كلمة مرور)
// حساب الإدارة أولها كي تبقى جلسة الاختبار صالحة طوال التشغيل — تماماً كما في الواقع.
const adminRow = { id: 'admin-1', username: 'admin', name: 'مدير النظام', role: 'admin', isActive: true };
const sales = [
  adminRow,
  { id: 'u1', name: 'أحمد', role: 'sales', isActive: true },
  { id: 'u2', name: 'منى', role: 'sales', isActive: true },
  { id: 'u3', name: 'مدير', role: 'admin', isActive: true },
];

const csvHeader = 'id,created_time,full_name,phone_number,campaign_name,form_name';
const csvLine = (id, phone, name) =>
  `${id},2026-10-14 10:00,${name},${phone},حملة أكتوبر - الشيخ زايد,فورم تجربة CRM`;

let passed = 0;
const check = (label, condition, extra = '') => {
  assert.ok(condition, `✗ ${label} ${extra}`);
  passed += 1;
  console.log(`✓ ${label}`);
};

try {
  // ===== ٠) الأمان: بلا جلسة لا تُقدَّم أي بيانات، والدخول يجري على السيرفر =====
  const anonymous = await call(storeApi, { headers: { cookie: '' } });
  check('بلا جلسة: قراءة البيانات مرفوضة (401)', anonymous.status === 401, JSON.stringify(anonymous.json));
  const anonymousWrite = await call(storeApi, {
    method: 'POST',
    headers: { cookie: '' },
    body: { key: 'crm_clients', value: [{ id: 'hack' }] },
  });
  check('بلا جلسة: الكتابة في البيانات مرفوضة (401)', anonymousWrite.status === 401);

  // حساب إدارة بكلمة مرور قوية نصاً صريحاً (كما هي اليوم في قاعدة الإنتاج — تبقى نصاً كي تراها الإدارة)
  redisData.set('crm:store:data', JSON.stringify({ crm_users: [{ ...adminRow, password: 'StrongPass123' }] }));
  redisData.set('crm:store:version', '0');

  const badLogin = await call(authApi, {
    method: 'POST',
    url: '/api/auth?action=login',
    body: { username: 'admin', password: 'wrong-password', loginType: 'admin' },
  });
  check('دخول بكلمة مرور خطأ يرفض (401)', badLogin.status === 401, JSON.stringify(badLogin.json));

  const login = await call(authApi, {
    method: 'POST',
    url: '/api/auth?action=login',
    body: { username: 'admin', password: 'StrongPass123', loginType: 'admin' },
  });
  AUTH_COOKIE = String(login.headers['set-cookie'] || '').split(';')[0];
  check(
    'دخول صحيح عبر السيرفر يُصدر كوكي جلسة HttpOnly',
    login.status === 200 && AUTH_COOKIE.startsWith('crm_session=') && /HttpOnly/i.test(String(login.headers['set-cookie'])),
    JSON.stringify(login.json)
  );
  check('كلمة المرور لا تُرسل للمتصفح في رد الدخول', !JSON.stringify(login.json).includes('password'), JSON.stringify(login.json));

  const storedAfterLogin = JSON.parse(redisData.get('crm:store:data'));
  check(
    'كلمة المرور النصية تبقى كما هي بعد الدخول (يراها الإدارة)',
    storedAfterLogin.crm_users[0].password === 'StrongPass123'
  );

  // ===== ١) المزامنة: كتابة ثم قراءة من قاعدة البيانات =====
  const write = await call(storeApi, {
    method: 'POST',
    body: { data: { crm_users: sales, crm_clients: [], crm_assigned_leads: [] } },
  });
  // الإصدار ما زال صفر (لا ترقية تلقائية تعدّل القاعدة عند الدخول)، فالكتابة ترفعه إلى ١
  check('حفظ البيانات في القاعدة ينجح', write.status === 200 && write.json.version === 1, JSON.stringify(write.json));

  const read = await call(storeApi);
  check(
    'قراءة البيانات ترجع نفس المستخدمين المحفوظين',
    read.status === 200 && read.json.data.crm_users.length === 4,
    JSON.stringify(read.json).slice(0, 120)
  );
  // الجلسة هنا لإدارة (admin) — وهي وحدها التي ترى كلمات المرور في رد البيانات
  check('الإدارة ترى كلمات المرور في رد البيانات', JSON.stringify(read.json).includes('password'));

  // ===== ٢) حفظ مفتاح واحد (تحديث سجل واحد من جهاز) =====
  const one = await call(storeApi, {
    method: 'POST',
    body: { key: 'crm_clients', value: [{ id: 'c1', name: 'عميل', phone: '01000000001' }] },
  });
  check('تحديث مفتاح واحد يرفع الإصدار', one.status === 200 && one.json.version === 2);

  // ===== ٣) بوابة الحماية الاختيارية =====
  const gated = createStoreHandler({
    load: async () => ({ version: 0, data: {} }),
    save: async () => {},
    token: 'gate-secret',
  });
  const blocked = await call(gated, { url: '/api/store' });
  const allowed = await call(gated, { url: '/api/store', headers: { 'x-store-token': 'gate-secret' } });
  check('بوابة المفتاح تمنع الطلب بلا مفتاح (401)', blocked.status === 401);
  check('بوابة المفتاح تسمح بالمفتاح الصحيح', allowed.status === 200);

  // فحص الإصدار هو أكثر طلب يتكرر في النظام (كل جهاز كل بضعة ثوانٍ)،
  // فأي أمر Redis زايد فيه بيتضاعف على الفاتورة. لازم يكون أمراً واحداً بالضبط.
  const beforeVersion = redisCommands;
  const versionOnly = await call(storeApi, { url: '/api/store?meta=version' });
  const versionCost = redisCommands - beforeVersion;
  check('فحص الإصدار يكلّف أمر Redis واحداً فقط', versionOnly.status === 200 && versionCost === 1, `التكلفة الفعلية: ${versionCost}`);

  const beforeFull = redisCommands;
  await call(storeApi);
  const fullCost = redisCommands - beforeFull;
  check('القراءة الكاملة تكلّف أمرين', fullCost === 2, `التكلفة الفعلية: ${fullCost}`);

  // ===== ٤) إعدادات سحب الأرقام تُحفظ على السيرفر =====
  const getConfig = await call(leadSourceApi, { url: '/api/lead-source' });
  check('سحب الأرقام يعلن وضع قاعدة البيانات (stateless:false)', getConfig.json?.stateless === false);

  csvRows = [csvHeader, csvLine('1001', '01011110001', 'عميل أول'), csvLine('1002', '01011110002', 'عميل ثانٍ')];
  const saved = await call(leadSourceApi, {
    method: 'POST',
    url: '/api/lead-source',
    body: { enabled: true, type: 'sheet', sheetUrl: `http://127.0.0.1:${csvPort}/sheet.csv` },
  });
  check('حفظ إعدادات المصدر ينجح', saved.status === 200 && saved.json.config.enabled === true);

  // ===== ٥) التشغيل الفعلي: سحب ثم تنظيف ثم توزيع بالمناصفة =====
  const run = await call(leadSourceApi, { method: 'POST', url: '/api/lead-source', body: { action: 'run' } });
  const summary = run.json?.summary;
  check('السحب ينجح ويسجل النتيجة', run.status === 200 && summary?.ok === true, JSON.stringify(summary));
  check('عدد الأرقام المسحوبة = ٢', summary?.added === 2, JSON.stringify(summary?.perUser));
  check(
    'التوزيع نزل على السيلز المفعّلين فقط (لا مدير)',
    summary?.perUser?.length === 2 && summary.perUser.every((p) => p.count === 1),
    JSON.stringify(summary?.perUser)
  );

  const afterRun = await call(storeApi);
  const assigned = afterRun.json?.data?.crm_assigned_leads || [];
  check('الأرقام اتكتبت في قاعدة البيانات مش المتصفح', assigned.length === 2);
  check(
    'كل رقم لمندوب مختلف (مناوبة)',
    assigned[0].salesId !== assigned[1].salesId,
    JSON.stringify(assigned.map((a) => a.salesId))
  );

  // ===== ٦) المكرر لا يُضاف مرة ثانية =====
  const again = await call(leadSourceApi, { method: 'POST', url: '/api/lead-source', body: { action: 'run' } });
  check('إعادة التشغيل بلا أرقام جديدة', again.json?.summary?.added === 0);
  check('الأرقام المكررة اترصدت', again.json?.summary?.duplicates === 2, JSON.stringify(again.json?.summary));

  // ===== ٧) المُشغّل الدوري (بدون أي متصفح) =====
  csvRows.push(csvLine('1003', '01011110003', 'عميل ثالث'), csvLine('1004', '01011110004', 'عميل رابع'));
  const wrongKey = await call(cronApi, { url: '/api/cron?key=غلط' });
  check('المُشغّل يرفض مفتاحاً غلطاً (403)', wrongKey.status === 403);

  const rightKey = await call(cronApi, { url: '/api/cron?key=secret-123' });
  check('المُشغّل ينفّذ التوزيع بالمفتاح الصحيح', rightKey.status === 200 && rightKey.json?.summary?.added === 2, JSON.stringify(rightKey.json?.summary));

  const viaHeader = await call(cronApi, {
    url: '/api/cron',
    headers: { authorization: 'Bearer secret-123' },
  });
  check('المُشغّل يعمل أيضاً بترويسة Authorization (Vercel Cron)', viaHeader.status === 200);

  const finalData = await call(storeApi);
  check('إجمالي الأرقام في القاعدة = ٤', (finalData.json?.data?.crm_assigned_leads || []).length === 4);


  // ===== ٨) الرقم المكرر مقابل عملاء النظام =====
  const clients = await call(storeApi, {
    method: 'POST',
    body: { key: 'crm_clients', value: [{ id: 'c1', name: 'عميل', phone: '01011110005' }] },
  });
  check('إضافة عميل برقم جديد تنجح', clients.status === 200);
  csvRows.push(csvLine('1005', '01011110005', 'عميل موجود بالفعل'));
  const dupCheck = await call(cronApi, { url: '/api/cron?key=secret-123' });
  check('رقم موجود عند عميل لا يُوزَّع كرقم جديد', dupCheck.json?.summary?.added === 0, JSON.stringify(dupCheck.json?.summary));

  // ===== ٨.٥) قناة إنستجرام: إعداد مستقل، ومؤشر مستقل، وسحب مشترك =====
  instaRows = [csvHeader, csvLine('3001', '01033330001', 'عميل إنستجرام')];
  const igSaved = await call(leadSourceApi, {
    method: 'POST',
    url: '/api/lead-source',
    body: { channel: 'instagram', enabled: true, type: 'sheet', sheetUrl: `http://127.0.0.1:${csvPort}/insta.csv` },
  });
  check(
    'إعداد إنستجرام يُحفظ في قناته دون المساس بإعداد فيسبوك',
    igSaved.status === 200 &&
      igSaved.json?.config?.instagram?.enabled === true &&
      String(igSaved.json?.config?.instagram?.sheetUrl).includes('/insta.csv') &&
      String(igSaved.json?.config?.sheetUrl).includes('/sheet.csv'),
    JSON.stringify(igSaved.json?.config).slice(0, 240)
  );
  check(
    'التوكن لا يُرسل للواجهة أبداً (فقط هل يوجد)',
    igSaved.json?.config?.hasToken === false && igSaved.json?.config?.instagram?.hasToken === false
  );

  // نوقف فيسبوك ونترك إنستجرام وحده: يجب أن يعمل السحب بلا توقف
  await call(leadSourceApi, { method: 'POST', url: '/api/lead-source', body: { enabled: false } });
  const igOnly = await call(cronApi, { url: '/api/cron?key=secret-123' });
  check(
    'إنستجرام وحده يكفي لتشغيل المُشغّل الدوري',
    igOnly.status === 200 && igOnly.json?.summary?.added === 1 && igOnly.json?.summary?.channels?.facebook == null,
    JSON.stringify(igOnly.json?.summary).slice(0, 240)
  );

  const afterIg = await call(storeApi);
  const igLeads = (afterIg.json?.data?.crm_assigned_leads || []).filter((l) => String(l.phone) === '01033330001');
  check(
    'رقم إنستجرام يدخل موسوماً بمصدره ولا يتكرر',
    igLeads.length === 1 && String(igLeads[0].description).includes('إنستجرام'),
    JSON.stringify(igLeads[0] || {}).slice(0, 200)
  );

  // نُعيد تشغيل فيسبوك ونضيف رقماً جديداً في كل قناة: يجب أن تُسحب القناتان في دورة واحدة
  await call(leadSourceApi, { method: 'POST', url: '/api/lead-source', body: { enabled: true } });
  csvRows.push(csvLine('1006', '01011110006', 'عميل فيسبوك جديد'));
  instaRows.push(csvLine('3002', '01033330002', 'عميل إنستجرام ٢'));
  const bothRun = await call(cronApi, { url: '/api/cron?key=secret-123' });
  check(
    'القناتان تُسحبان في دورة واحدة وتُوزّع أرقامهما معاً',
    bothRun.json?.summary?.added === 2 &&
      bothRun.json?.summary?.channels?.facebook?.ok === true &&
      bothRun.json?.summary?.channels?.instagram?.ok === true,
    JSON.stringify(bothRun.json?.summary).slice(0, 240)
  );

  // توكن منتهٍ في قناة لا يمنع الأخرى: نضبط فيسبوك على رابط لا يستجيب
  await call(leadSourceApi, {
    method: 'POST',
    url: '/api/lead-source',
    body: { type: 'sheet', sheetUrl: 'http://127.0.0.1:1/dead.csv' },
  });
  instaRows.push(csvLine('3003', '01033330003', 'عميل إنستجرام ٣'));
  const partial = await call(cronApi, { url: '/api/cron?key=secret-123' });
  check(
    'فشل قناة لا يوقف القناة الأخرى (عزل القنوات)',
    partial.json?.summary?.added === 1 &&
      partial.json?.summary?.channels?.facebook?.ok === false &&
      partial.json?.summary?.channels?.instagram?.ok === true,
    JSON.stringify(partial.json?.summary).slice(0, 300)
  );

  // ===== ٨.٧) مسار «الكامبين مباشرة (توكن)» بواجهة ميتا محاكاة =====
  // نُحاكي ردود Graph API (صفحات ← نماذج ← أرقام) لنتأكد أن مسار التوكن نفسه هو الذي
  // يُستخرج منه الرقم ويُوسم بمصدره ويحترم مؤشر آخر سحب — بلا حساب فيسبوك حقيقي وبلا توكن صالح.
  const graph = installGraphMock();

  await call(leadSourceApi, { method: 'POST', url: '/api/lead-source', body: { channel: 'facebook', enabled: true, type: 'meta', token: 'EAAG-demo', resetCursor: true } });
  const discovered = await call(leadSourceApi, { method: 'POST', url: '/api/lead-source', body: { channel: 'facebook', action: 'discover', token: 'EAAG-demo' } });
  check(
    'فيسبوك (توكن): استكشاف الصفحات يرجع صفحاتك وتوكناتها',
    discovered.json?.pages?.length === 2 && discovered.json.pages.some((p) => p.id === 'page-fb'),
    JSON.stringify(discovered.json?.pages)
  );

  const pageForms = await call(leadSourceApi, { method: 'POST', url: '/api/lead-source', body: { channel: 'facebook', action: 'forms', pageId: 'page-fb' } });
  check('فيسبوك (توكن): نماذج الصفحة تُقرأ من ميتا', pageForms.json?.forms?.[0]?.id === 'form-fb', JSON.stringify(pageForms.json));

  await call(leadSourceApi, {
    method: 'POST',
    url: '/api/lead-source',
    body: { channel: 'facebook', type: 'meta', forms: [{ id: 'form-fb', pageId: 'page-fb', name: 'فورم فيسبوك أكتوبر' }] },
  });
  await call(leadSourceApi, {
    method: 'POST',
    url: '/api/lead-source',
    body: { channel: 'instagram', enabled: true, type: 'meta', token: 'EAAG-demo-ig', forms: [{ id: 'form-ig', pageId: 'page-ig', name: 'فورم إنستجرام أكتوبر' }], pages: [{ id: 'page-ig', name: 'صفحة إعمار', token: 'PAGE-IG-TOKEN' }] },
  });

  const tokenRun = await call(cronApi, { url: '/api/cron?key=secret-123' });
  check(
    'مسار التوكن يسحب من فيسبوك وإنستجرام معاً',
    tokenRun.json?.summary?.added === 2 && tokenRun.json?.summary?.fetched === 2,
    JSON.stringify(tokenRun.json?.summary).slice(0, 240)
  );

  const tokenData = await call(storeApi);
  const tokenLeads = (tokenData.json?.data?.crm_assigned_leads || []);
  const fbLead = tokenLeads.find((l) => String(l.phone) === '01066660001');
  const igLead2 = tokenLeads.find((l) => String(l.phone) === '01066660002');
  check(
    'رقم الكامبين يدخل موسوماً بمصدره من اسم النموذج',
    !!fbLead && fbLead.name === 'عميل توكن' && String(fbLead.description).includes('فيسبوك - فورم فيسبوك أكتوبر'),
    JSON.stringify(fbLead || {}).slice(0, 200)
  );
  check(
    'رقم إنستجرام من مسار التوكن يبقى في تبويبه',
    !!igLead2 && String(igLead2.description).includes('إنستجرام - فورم إنستجرام أكتوبر'),
    JSON.stringify(igLead2 || {}).slice(0, 200)
  );

  // المؤشر: الدورة التالية تطلب من ميتا الأرقام الأحدث فقط (filtering time_created) فلا تكرار
  const tokenAgain = await call(cronApi, { url: '/api/cron?key=secret-123' });
  check(
    'لا تكرار في مسار التوكن: الدورة التالية تجلب صفراً',
    tokenAgain.json?.summary?.added === 0 && tokenAgain.json?.summary?.fetched === 0,
    JSON.stringify(tokenAgain.json?.summary).slice(0, 200)
  );
  check('مؤشر آخر سحب يُرسل إلى ميتا (filtering time_created)', graph.calls.some((c) => c.includes('time_created')));

  // ليد تجريبي من أداة اختبار ميتا: يُقبل برقم صالح موسوم، أو يُتجاهل حسب الإعداد
  graph.pushLead('form-fb', { id: 'lead-test', created_time: '2026-10-15T11:30:00+0000', field_data: [{ name: 'full_name', values: ['<test lead: dummy data for full_name>'] }, { name: 'phone_number', values: ['<test lead: dummy data for phone_number>'] }] });
  const testLeadRun = await call(cronApi, { url: '/api/cron?key=secret-123' });
  if (process.env.DEBUG_GRAPH) console.error('DEBUG calls:', graph.calls.filter((c) => c.includes('leads')).join('\n'), '\nchannels:', JSON.stringify(testLeadRun.json?.summary?.channels));
  check('أداة اختبار ميتا لا تعطّل السحب ويدخل رقمها موسوماً «تجريبي»', testLeadRun.json?.summary?.added === 1 && /تجريبي/.test(JSON.stringify((await call(storeApi)).json?.data?.crm_assigned_leads || [])), JSON.stringify(testLeadRun.json?.summary).slice(0, 200));

  // ===== ٨.٨) سحب Form ID فقط — بدون استكشاف صفحات نهائياً =====
  await call(leadSourceApi, { method: 'POST', url: '/api/lead-source', body: { channel: 'instagram', enabled: false } });
  await call(leadSourceApi, {
    method: 'POST',
    url: '/api/lead-source',
    body: {
      channel: 'facebook',
      enabled: true,
      type: 'meta',
      token: 'EAAG-demo',
      resetCursor: true,
      pages: [],
      forms: [{ id: 'form-direct', pageId: '', name: 'فورم بمعرّفه' }],
    },
  });
  const directConfig = await call(leadSourceApi);
  check(
    'Form ID فقط: النموذج محفوظ بدون أي صفحة',
    directConfig.json?.config?.forms?.some((f) => f.id === 'form-direct' && f.pageId === '')
      && (directConfig.json?.config?.pages || []).length === 0,
    JSON.stringify(directConfig.json?.config).slice(0, 300)
  );
  const directRun = await call(cronApi, { url: '/api/cron?key=secret-123' });
  check(
    'Form ID فقط: السحب يعمل بالتوكن بدون صفحة',
    directRun.json?.summary?.added === 1 && directRun.json?.summary?.fetched === 1,
    JSON.stringify(directRun.json?.summary).slice(0, 320)
  );
  const directLead = ((await call(storeApi)).json?.data?.crm_assigned_leads || []).find(
    (l) => String(l.phone) === '01066660003'
  );
  check(
    'Form ID فقط: الرقم دخل موسوماً باسم النموذج',
    !!directLead && String(directLead.description).includes('فورم بمعرّفه'),
    JSON.stringify(directLead || {}).slice(0, 200)
  );
  check(
    'Form ID فقط: استُخدم توكن القناة على /form-direct/leads',
    graph.calls.some((c) => c.includes('/form-direct/leads') && c.includes('access_token=EAAG-demo')),
    JSON.stringify(graph.calls.filter((c) => c.includes('/leads')).slice(-3))
  );

  graph.restore();

  // ===== ٩) إيقاف كل القناتين معاً =====
  await call(leadSourceApi, { method: 'POST', url: '/api/lead-source', body: { enabled: false } });
  await call(leadSourceApi, { method: 'POST', url: '/api/lead-source', body: { channel: 'instagram', enabled: false } });
  const offRun = await call(cronApi, { url: '/api/cron?key=secret-123' });
  check('المُشغّل يتخطى العمل لما تتوقف القناتان', offRun.json?.skipped === true, JSON.stringify(offRun.json));

  // ===== ١٠) بدون CRON_SECRET لا يعمل المُشغّل =====
  delete process.env.CRON_SECRET;
  const noSecret = await call(cronApi, { url: '/api/cron?key=secret-123' });
  check('المُشغّل لا يعمل بلا مفتاح مضبوط (503)', noSecret.status === 503, JSON.stringify(noSecret.json));

  console.log(`\n✅ كل الاختبارات نجحت (${passed}) — أوامر Redis المنفَّذة: ${redisCommands}`);
} catch (error) {
  console.error('\n❌ فشل الاختبار:', error.message);
  process.exitCode = 1;
} finally {
  redisServer.close();
  csvServer.close();
}
