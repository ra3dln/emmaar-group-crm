// ===== اختبار حقيقي للرابط العام للعقار (/p/<id>) =====
// ده الرابط اللي المندوب يبعته للعميل على واتساب: لازم يفتح بلا تسجيل دخول،
// يعرض بيانات الوحدة **بس**، والليد اللي يجي منه يدخل قاعدة البيانات عند صاحب العقار.
//
// ما يُختبر:
//   ١) صفحة /p/<id> تُخدم كـ HTML (بلا جلسة)
//   ٢) بيانات الوحدة تخرج بلا أي حقول داخلية (لا userId ولا رقم عميل ولا ملاحظات)
//   ٣) وحدة غير موجودة => 404 برسالة مفهومة
//   ٤) تسجيل ليد جديد => يظهر في القاعدة عند صاحب العقار بمصدر «الرابط العام»
//   ٥) رقم مسجَّل قبل كده => لا يتكرر العميل، ويتضاف حدث اهتمام على سجله
//   ٦) بيانات ناقصة => 400 (الاسم والرقم مطلوبان)
//
// التشغيل:  node tests/public-page-smoke.mjs

import http from 'node:http';
import assert from 'node:assert/strict';

const { createPublicHandler } = await import('../server/publicPage.js');

// ---------- مخزن ذاكرة بنفس واجهة القاعدة ----------
let db = { version: 1, data: {} };
const storage = {
  configured: true,
  async load() {
    return { version: db.version, data: JSON.parse(JSON.stringify(db.data)) };
  },
  async save(next) {
    db = { version: Number(next.version) || 0, data: JSON.parse(JSON.stringify(next.data)) };
  },
};

db.data = {
  crm_users: [
    { id: 'u-sales', name: 'أحمد سمير', role: 'sales', username: 'ahmed', password: 'hash', isActive: true },
  ],
  crm_properties: [
    {
      id: 'p1',
      userId: 'u-sales',
      name: 'شقة التجمع ١٢٤',
      type: 'شقة',
      area: '140',
      price: '3.2',
      priceNumeric: 3200000,
      location: 'التجمع الخامس',
      description: 'بحري تشطيب كامل',
      images: [],
      finishing: 'fully-finished',
      delivery: 'immediate',
      clientPhone: '01000000000', // رقم داخلي — ممنوع يظهر للعامة
      createdAt: new Date().toISOString(),
    },
  ],
  crm_clients: [],
};

const server = http.createServer(createPublicHandler({ storage }));
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

const call = async (path, { method = 'GET', body, raw } = {}) => {
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { json = null; }
  return { status: res.status, json, text, type: res.headers.get('content-type') || '', raw };
};

let passed = 0;
const check = (label, condition, extra = '') => {
  assert.ok(condition, `✗ ${label} ${extra}`);
  passed += 1;
  console.log(`✓ ${label}`);
};

try {
  // ===== ١) الصفحة تُخدم بلا جلسة =====
  const page = await call('/p/p1');
  check('صفحة /p/<id> تُخدم HTML', page.status === 200 && /text\/html/.test(page.type));
  check('الصفحة فيها فورم تسجيل الاهتمام', /api\/public\/lead/.test(page.text) && /sأرسل بياناتي|أرسل بياناتي/.test(page.text));
  check('الصفحة تقرأ معرّف الوحدة من المسار', /location\.pathname/.test(page.text));

  // ===== ٢) بيانات الوحدة بلا أي حقل داخلي =====
  const prop = await call('/api/public/property?id=p1');
  check('بيانات الوحدة تُقرأ', prop.status === 200 && prop.json?.ok === true && prop.json?.property?.name === 'شقة التجمع ١٢٤');
  const dump = JSON.stringify(prop.json);
  check('لا يُرسل userId للمتصفح', !/u-sales/.test(dump));
  check('لا يُرسل رقم العميل الداخلي', !/01000000000/.test(dump));
  check('لا يُرسل اسم المندوب صاحب العقار', !/أحمد سمير/.test(dump));

  // ===== ٣) وحدة غير موجودة =====
  const missing = await call('/api/public/property?id=nope');
  check('وحدة غير موجودة => 404', missing.status === 404 && missing.json?.ok === false);

  // ===== ٤) ليد جديد يدخل القاعدة =====
  const lead = await call('/api/public/lead', {
    method: 'POST',
    body: { propertyId: 'p1', name: 'عميل الرابط العام', phone: '01122334455', note: 'محتاج معاينة' },
  });
  check('تسجيل ليد جديد ينجح', lead.status === 200 && lead.json?.ok === true && !lead.json?.duplicate);
  const created = (db.data.crm_clients || [])[0];
  check('الليد اتسجّل في القاعدة', !!created && created.name === 'عميل الرابط العام');
  check('الليد منسوب لصاحب العقار', created?.userId === 'u-sales', String(created?.userId));
  check('مصدره «الرابط العام» ومرحلته جديدة', /الرابط العام/.test(created?.source || '') && created?.stage === 'new');
  check('اختير كأولوية عالية (ليد ساخن من رابط عام)', created?.priority === 'high');
  check('حدث في خطه الزمني يوضّح المصدر', /الرابط العام/.test(created?.activities?.[0]?.text || ''));

  // ===== ٥) رقم مكرر لا يُنشئ عميلاً ثانياً =====
  const again = await call('/api/public/lead', {
    method: 'POST',
    body: { propertyId: 'p1', name: 'نفس العميل', phone: '01122334455', note: 'كلمني تاني' },
  });
  check('الرقم المكرر يرجع duplicate', again.status === 200 && again.json?.duplicate === true);
  check('ما اتضافش عميل تاني', (db.data.crm_clients || []).length === 1, String((db.data.crm_clients || []).length));
  check('اتضاف حدث اهتمام على سجل العميل نفسه', (db.data.crm_clients[0].activities || []).length === 2);

  // ===== ٦) بيانات ناقصة =====
  const bad = await call('/api/public/lead', { method: 'POST', body: { propertyId: 'p1', name: '', phone: '12' } });
  check('بيانات ناقصة => 400', bad.status === 400 && bad.json?.ok === false);

  // ===== ٧) مسار غير معروف =====
  const nope = await call('/api/public/whatever');
  check('مسار غير معروف => 404', nope.status === 404);

  console.log(`\n✅ كل اختبارات الرابط العام نجحت (${passed}).`);
} finally {
  server.close();
}
