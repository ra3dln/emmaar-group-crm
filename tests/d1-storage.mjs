// ===== اختبار مخزن Cloudflare D1 (البديل الجديد لقاعدة البيانات) =====
// الشكوى: Supabase وقّفت الخدمة بسبب تجاوز حد النقل (exceed_egress_quota)،
// والمطلوب نقل البيانات على تخزين تاني بدون حد نقل. الاختبار يضمن:
//   ١) D1 مش مضبوط => النظام يعلن إنه غير مضبوط (ومايتعطلش).
//   ٢) حفظ وقراءة البيانات ورقم النسخة يلفّوا ويرجعوا زي ما هم.
//   ٣) الجدول crm_kv بيتعمل تلقائياً أول مرة (المستخدم مش مطالب يشغّل SQL).
//   ٤) الإعدادات المفردة (سحب الأرقام/الإشعارات) تحفظ وتقرأ في نفس الجدول.
//   ٥) خطأ صلاحيات Cloudflare يظهر برسالته بدل ما يضيع.
//   ٦) الاختيار: D1 قبل Supabase قبل Redis (فمافيش خلط بين قاعدتين).
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
const calls = [];
let failNext = null; // { status, message }
let tableCreated = 0;

globalThis.fetch = async (url, init = {}) => {
  calls.push({ url: String(url), body: JSON.parse(init.body || '{}') });
  if (failNext) {
    const { status, message } = failNext;
    failNext = null;
    return {
      ok: false,
      status,
      text: async () => JSON.stringify({ success: false, errors: [{ message }] }),
    };
  }
  const { sql, params = [] } = JSON.parse(init.body || '{}');
  const respond = (results) => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ success: true, result: [{ results, success: true }], errors: [] }),
  });

  if (/CREATE TABLE IF NOT EXISTS/i.test(sql)) {
    tableCreated += 1;
    return respond([]);
  }
  if (/^SELECT key, value FROM crm_kv/i.test(sql.trim())) {
    return respond(
      params.filter((k) => table.has(k)).map((k) => ({ key: k, value: table.get(k) }))
    );
  }
  if (/^INSERT INTO crm_kv/i.test(sql.trim())) {
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

const loaded = await storage.load();
check('البيانات رجعت زي ما هي', JSON.stringify(loaded.data) === JSON.stringify(db.data), JSON.stringify(loaded).slice(0, 120));
check('ورقم النسخة صح', loaded.version === 41, String(loaded.version));
check('فحص النسخة الخفيف يرجّع نفس الرقم', (await storage.loadVersion()) === 41);

// حفظ تاني بنفس العملية => تحديث لا تكرار
await storage.save({ version: 42, data: { crm_users: [] } });
check('التحديث بيستبدل القيمة (upsert)', (await storage.load()).version === 42);
check('ومايعملش جدول تاني', tableCreated === 1, `created=${tableCreated}`);
check('ومفتاح واحد لكل سجل (مش تكرار صفوف)', table.size === 2, `rows=${table.size}`);

// ===== ٣) الإعدادات المفردة =====
const cfgStore = d1JsonStore(ENV, 'crm:lead-source:config');
await cfgStore.save({ facebook: { enabled: true, intervalMinutes: 5 } });
check('إعدادات سحب الأرقام اتحفظت وقرأت', (await cfgStore.load()).facebook.enabled === true);
check('والقيمة الفاضية ترجع كائن فاضي', Object.keys(await d1JsonStore(ENV, 'nope').load()).length === 0);

// ===== ٤) خطأ Cloudflare يظهر برسالته =====
failNext = { status: 403, message: 'Authentication error' };
let errText = '';
try {
  await d1Storage(ENV).save({ version: 43, data: {} });
} catch (err) {
  errText = String(err?.message || '');
}
check('خطأ الصلاحيات بيظهر برسالته', errText.includes('d1 403') && errText.includes('Authentication error'), errText);

// خطأ خدمة مؤقت (5xx) بيتعاد وبيعدّي من غير ما يوقّف الحفظ
failNext = { status: 503, message: 'temporarily unavailable' };
let retried = true;
try {
  await d1Storage(ENV).save({ version: 44, data: { crm_users: [] } });
} catch {
  retried = false;
}
check('خطأ 5xx مؤقت بيتعاد ويعدّي', retried && (await d1Storage(ENV).load()).version === 44);

// ===== ٥) الأولوية: D1 قبل Supabase =====
const both = { ...ENV, SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SECRET_KEY: 'k' };
check('لو الاتنين مضبوطين: D1 هو المستخدم', activeProviderName(both) === 'd1');
check('ولو D1 بس ناقص: يرجع Supabase', activeProviderName({ SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SECRET_KEY: 'k' }) === 'supabase');

console.log(`\n✅ نجحت ${passed} فحوصات (Cloudflare D1)`);
