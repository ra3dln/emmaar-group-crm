// ===== اختبار حقيقي للمسار السحابي بالكامل (بلا أي حساب أو تكلفة) =====
// نشغّل «محاكي Upstash Redis REST» على منفذ محلي + سيرفر CSV وهمي (بديل Google Sheet)،
// ثم نستدعي نفس دوال الاستضافة (api/store.js و api/lead-source.js و api/cron.js)
// ونتأكد أن: البيانات تُحفظ وتُقرأ، والتوزيع يوزّع الأرقام فعلاً، والتشغيل الدوري يعمل،
// والمكرر لا يُضاف، والمفتاح السري يحمي الرابط.
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
let csvRows = [];
const csvServer = http.createServer((req, res) => {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.end(csvRows.join('\n'));
});

const listen = (server) =>
  new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));

const redisPort = await listen(redisServer);
const csvPort = await listen(csvServer);

// ---------- متغيّرات البيئة قبل تحميل دوال الاستضافة ----------
process.env.UPSTASH_REDIS_REST_URL = `http://127.0.0.1:${redisPort}`;
process.env.UPSTASH_REDIS_REST_TOKEN = 'test-token';
process.env.CRON_SECRET = 'secret-123';
delete process.env.STORE_TOKEN;

const storeApi = (await import('../api/store.js')).default;
const leadSourceApi = (await import('../api/lead-source.js')).default;
const cronApi = (await import('../api/cron.js')).default;
const { createStoreHandler } = await import('../server/store.js');

// ---------- استدعاء دالة استضافة كما يفعل Vercel ----------
const call = async (handler, { method = 'GET', url = '/api/store', body, headers = {} } = {}) => {
  const req = { method, url, headers: { 'x-forwarded-for': '10.0.0.1', ...headers }, body, socket: {} };
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
  return { status: res.statusCode, json };
};

const sales = [
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
  // ===== ١) المزامنة: كتابة ثم قراءة من قاعدة البيانات =====
  const write = await call(storeApi, {
    method: 'POST',
    body: { data: { crm_users: sales, crm_clients: [], crm_assigned_leads: [] } },
  });
  check('حفظ البيانات في القاعدة ينجح', write.status === 200 && write.json.version === 1, JSON.stringify(write.json));

  const read = await call(storeApi);
  check(
    'قراءة البيانات ترجع نفس المستخدمين المحفوظين',
    read.status === 200 && read.json.data.crm_users.length === 3,
    JSON.stringify(read.json).slice(0, 120)
  );

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

  // ===== ٩) إيقاف السحب التلقائي =====
  await call(leadSourceApi, { method: 'POST', url: '/api/lead-source', body: { enabled: false } });
  const offRun = await call(cronApi, { url: '/api/cron?key=secret-123' });
  check('المُشغّل يتخطى العمل لما السحب متوقف', offRun.json?.skipped === true, JSON.stringify(offRun.json));

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
