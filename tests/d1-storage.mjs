// ===== اختبار مخزن Cloudflare D1 (البديل الجديد لقاعدة البيانات) =====
// الشكوى: Supabase وقّفت الخدمة بسبب تجاوز حد النقل (exceed_egress_quota)،
// والمطلوب نقل البيانات على تخزين تاني بدون حد نقل. الاختبار يضمن:
//   ١) D1 مش مضبوط => النظام يعلن إنه غير مضبوط (ومايتعطلش).
//   ٢) كل مفتاح بيتحفظ في صف لوحده (crm:data:<name>) — لأن D1 سقف الصف ~١ ميجا
//      والبيانات كلها في صف واحد (~١.٩ ميجا) كانت بترجع 500 عند الرفع.
//   ٣) حفظ وقراءة البيانات ورقم النسخة يلفّوا ويرجعوا زي ما هم، وأكتر من ١ ميجا
//      إجمالي بيتوزّع على صفوف وبيعدّي.
//   ٤) الجدول crm_kv بيتعمل تلقائياً أول مرة (المستخدم مش مطالب يشغّل SQL).
//   ٥) المفاتيح اللي اتشالت (إعادة ضبط) صفوفها تتمسح، والرفع من غير تغيير
//      مايكتبش صفوف تانية.
//   ٦) الإعدادات المفردة (سحب الأرقام/الإشعارات) تحفظ وتقرأ في نفس الجدول.
//   ٧) خطأ صلاحيات Cloudflare يظهر برسالته، وخطأ 5xx بيتعاد.
//   ٨) الاختيار: D1 قبل Supabase قبل Redis (فمافيش خلط بين قاعدتين).
//
// التشغيل: node tests/d1-storage.mjs

import assert from 'node:assert/strict';

const ENV = {
  D1_ACCOUNT_ID: 'acc-123',
  D1_DATABASE_ID: 'db-456',
  D1_API_TOKEN: 'token-789',
};

// ===== محاكاة واجهة Cloudflare D1 REST =====
const table = new Map(); // key -> JSON string
const sqlLog = [];
let failNext = null; // { status, message }
let tableCreated = 0;

globalThis.fetch = async (url, init = {}) => {
  const { sql = '', params = [] } = JSON.parse(init.body || '{}');
  sqlLog.push(sql.trim());
  if (failNext) {
    const { status, message } = failNext;
    failNext = null;
    return {
      ok: false,
      status,
      text: async () => JSON.stringify({ success: false, errors: [{ message }] }),
    };
  }
  const respond = (results) => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ success: true, result: [{ results, success: true }], errors: [] }),
  });
  const s = sql.trim();

  if (/CREATE TABLE IF NOT EXISTS/i.test(s)) {
    tableCreated += 1;
    return respond([]);
  }
  if (/^SELECT key, value FROM crm_kv WHERE key LIKE 'crm:data:%'$/i.test(s)) {
    return respond(
      [...table.entries()]
        .filter(([k]) => k.startsWith('crm:data:'))
        .map(([key, value]) => ({ key, value }))
    );
  }
  if (/^SELECT key, value FROM crm_kv WHERE key IN \(/i.test(s)) {
    return respond(params.filter((k) => table.has(k)).map((k) => ({ key: k, value: table.get(k) })));
  }
  if (/^DELETE FROM crm_kv WHERE key IN \(/i.test(s)) {
    for (const k of params) table.delete(k);
    return respond([]);
  }
  if (/^INSERT INTO crm_kv/i.test(s)) {
    for (let i = 0; i < params.length; i += 2) table.set(params[i], params[i + 1]);
    return respond([]);
  }
  throw new Error(`استعلام غير متوقع: ${sql}`);
};

const { d1Storage, d1JsonStore, d1Configured } = await import('../server/d1.js');
const { pickStorage, activeProviderName, NO_DATABASE_HINT } = await import('../server/storage.js');

let passed = 0;
const check = (label, condition, extra = '') => {
  assert.ok(condition, `✗ ${label} ${extra}`);
  passed += 1;
  console.log(`✓ ${label}`);
};
const insertCalls = () => sqlLog.filter((s) => /^INSERT INTO crm_kv/i.test(s)).length;

// ===== ١) غير مضبوط =====
check('بدون متغيّرات D1: مش مضبوط', d1Configured({}) === false);
check('والتخزين يعلن إنه غير مضبوط بدل ما ينهار', d1Storage({}).configured === false);
check('وفي الاختيار يرجع لـ Redis (غير مضبوط كذلك)', activeProviderName({}) === 'redis');
check('ورسالة «مفيش قاعدة» بتذكر D1', NO_DATABASE_HINT.includes('D1_ACCOUNT_ID'));

// ===== ٢) حفظ وقراءة =====
check('بمتغيّرات D1: مضبوط', d1Configured(ENV) === true);
const storage = d1Storage(ENV);
check('والاختيار يفضّله', activeProviderName(ENV) === 'd1');
check('والـ storage مضبوط', storage.configured === true);

const db = {
  version: 41,
  data: {
    crm_users: [{ id: 'u1', username: 'admin', role: 'admin' }],
    crm_clients: [{ id: 'c1', name: 'عميل', phone: '0100' }],
  },
};
await storage.save(db);
check('الجدول اتعمل تلقائياً أول حفظ', tableCreated === 1, `created=${tableCreated}`);
check('كل مفتاح في صف لوحده', table.has('crm:data:crm_users') && table.has('crm:data:crm_clients'));
check('مفيش صف واحد لكل البيانات', !table.has('crm:store:data'));
check('ورقم النسخة في صفه', table.get('crm:store:version') === '41');

const loaded = await storage.load();
check(
  'البيانات رجعت زي ما هي',
  JSON.stringify(loaded.data) === JSON.stringify(db.data),
  JSON.stringify(loaded).slice(0, 120)
);
check('ورقم النسخة صح', loaded.version === 41, String(loaded.version));
check('فحص النسخة الخفيف يرجّع نفس الرقم', (await storage.loadVersion()) === 41);

// ===== ٣) بيانات أكبر من ١ ميجا إجمالي =====
const bigA = Array.from({ length: 3000 }, (_, i) => ({ id: `a${i}`, note: 'س'.repeat(200) }));
const bigB = Array.from({ length: 3000 }, (_, i) => ({ id: `b${i}`, note: 'ص'.repeat(200) }));
const bigTotal = JSON.stringify(bigA).length + JSON.stringify(bigB).length;
await storage.save({ version: 42, data: { crm_clients: bigA, crm_call_logs: bigB } });
const bigLoaded = await storage.load();
check(
  `بيانات ${Math.round(bigTotal / 1024)} ك.ب (أكبر من سقف الصف الواحد) اتحفظت وقرأت`,
  bigLoaded.data.crm_clients.length === bigA.length && bigLoaded.data.crm_call_logs.length === bigB.length
);
check('والنسخة اتحدّثت', bigLoaded.version === 42);

// ===== ٤) الرفع من غير تغيير مايكتبش صفوف =====
await storage.save({ version: 43, data: { crm_clients: bigA, crm_call_logs: bigB } });
check('رفع نفس البيانات ماكتبش صفوف جديدة', insertCalls() === 3, `inserts=${insertCalls()}`);
check('بس رقم النسخة اتحدّث', (await storage.load()).version === 43);

// ===== ٥) مفتاح اتشال (إعادة ضبط) صفه يتمسح =====
await storage.save({ version: 44, data: { crm_clients: bigA } });
check('المفتاح اللي اتشال صفه اتمسح', !table.has('crm:data:crm_call_logs'));
check('والباقي زي ما هو', (await storage.load()).data.crm_clients.length === bigA.length);

// ===== ٦) مفتاح أكبر من سقف الصف => خطأ واضح باسمه =====
let bigErr = '';
try {
  await storage.save({ version: 45, data: { crm_properties: [{ id: 'x', img: 'ع'.repeat(950 * 1024) }] } });
} catch (err) {
  bigErr = String(err?.message || '');
}
check('مفتاح أكبر من سقف الصف يفشل برسالة فيها اسمه', bigErr.includes('crm_properties') && bigErr.includes('D1'), bigErr);

// ===== ٧) الإعدادات المفردة =====
const cfgStore = d1JsonStore(ENV, 'crm:lead-source:config');
await cfgStore.save({ facebook: { enabled: true, intervalMinutes: 5 } });
check('إعدادات سحب الأرقام اتحفظت وقرأت', (await cfgStore.load()).facebook.enabled === true);
check('والقيمة الفاضية ترجع كائن فاضي', Object.keys(await d1JsonStore(ENV, 'nope').load()).length === 0);

// ===== ٨) الأخطاء =====
failNext = { status: 403, message: 'Authentication error' };
let errText = '';
try {
  await d1Storage(ENV).save({ version: 46, data: {} });
} catch (err) {
  errText = String(err?.message || '');
}
check(
  'خطأ الصلاحيات بيظهر برسالته',
  errText.includes('d1 403') && errText.includes('Authentication error'),
  errText
);

failNext = { status: 503, message: 'temporarily unavailable' };
let retried = true;
try {
  await d1Storage(ENV).save({ version: 47, data: { crm_users: [] } });
} catch {
  retried = false;
}
check('خطأ 5xx مؤقت بيتعاد ويعدّي', retried && (await d1Storage(ENV).load()).version === 47);

// ===== ٩) الأولوية =====
const both = { ...ENV, SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SECRET_KEY: 'k' };
check('لو الاتنين مضبوطين: D1 هو المستخدم', activeProviderName(both) === 'd1');
check(
  'ولو D1 بس ناقص: يرجع Supabase',
  activeProviderName({ SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SECRET_KEY: 'k' }) === 'supabase'
);

console.log(`\n✅ نجحت ${passed} فحوصات (Cloudflare D1)`);
