// ===== اختبار حقيقي لنقطة البيانات (/api/store) فوق قاعدة Supabase =====
// يشغّل نفس ملف الاستضافة (api/store.js) داخل سيرفر HTTP محلي بنفس متغيّرات بيئة
// الإنتاج، ويمرّ بنفس الطلبات التي يرسلها المتصفح (فحص الإصدار + حفظ + قراءة)،
// ثم يعيد البيانات كما كانت. هكذا نتأكد أن المسار الكامل يعمل — لا الوحدة وحدها.
//
// التشغيل:  node tests/supabase-api-smoke.mjs

import fs from 'node:fs';
import http from 'node:http';
import assert from 'node:assert/strict';

function loadEnvFile(path = '.env') {
  const env = {};
  let raw = '';
  try {
    raw = fs.readFileSync(path, 'utf8');
  } catch {
    return env;
  }
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
  }
  return env;
}

const fileEnv = loadEnvFile();
process.env.SUPABASE_URL = process.env.SUPABASE_URL || fileEnv.SUPABASE_URL || '';
process.env.SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY || fileEnv.SUPABASE_SECRET_KEY || '';
delete process.env.STORE_TOKEN; // بوابة الحماية مطفأة في الاختبار

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SECRET_KEY) {
  console.log('متخطّى: Supabase غير مضبوط — لا يوجد ما يُختبر.');
  process.exit(0);
}

const { supabaseStorage } = await import('../server/supabase.js');
const storeHandler = (await import('../api/store.js')).default;

const server = http.createServer((req, res) => storeHandler(req, res));
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

const call = async (path, options = {}) => {
  const res = await fetch(base + path, options);
  const text = await res.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: res.status, body };
};

const original = await supabaseStorage(process.env).load();
// ملاحظة: مفتاح النظام يقبل حروفاً صغيرة وشرطات سفلية فقط (^crm_[a-z_]+$)
const SMOKE_KEY = 'crm_smoke_test';
const SMOKE_ID = 'e2e-' + Date.now();

try {
  // ١) فحص الإصدار — أكثر طلب يتكرر في النظام (كل جهاز كل ثوانٍ)
  const version = await call('/api/store?meta=version');
  assert.equal(version.status, 200, 'فحص الإصدار لازم يرجّع 200');
  assert.equal(version.body.version, original.version, 'الإصدار لازم يطابق القاعدة');
  console.log('✓ GET /api/store?meta=version =', version.body.version);

  // ٢) طلب غير موجود — لازم 404 من نفس الموجّه
  const missing = await call('/api/store/other');
  assert.equal(missing.status, 404, 'مسار غير معروف لازم يرجّع 404');
  console.log('✓ مسار غير معروف يرجّع 404');

  // ٣) حفظ سجل عبر POST — نفس ما يفعله pushKey في المتصفح
  const saved = await call('/api/store', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key: SMOKE_KEY, value: [{ id: SMOKE_ID }] }),
  });
  assert.equal(saved.status, 200, 'الحفظ لازم ينجح');
  assert.equal(saved.body.version, original.version + 1, 'الإصدار لازم يزيد واحداً');
  console.log('✓ POST /api/store حفظ سجلاً — الإصدار الجديد:', saved.body.version);

  // ٤) قراءة كاملة — لازم يرجع السجل المحفوظ فعلاً من القاعدة
  const full = await call('/api/store');
  assert.equal(full.status, 200, 'القراءة الكاملة لازم تنجح');
  assert.ok(Array.isArray(full.body.data?.[SMOKE_KEY]), 'المفتاح المحفوظ لازم يرجع');
  assert.equal(full.body.data[SMOKE_KEY][0].id, SMOKE_ID, 'القيمة المحفوظة لازم تكون نفسها');
  console.log('✓ GET /api/store أرجع السجل المحفوظ من القاعدة');

  // ٥) تنظيف: إعادة القاعدة كما كانت بالضبط
  await supabaseStorage(process.env).save(original);
  const restored = await call('/api/store?meta=version');
  assert.equal(restored.body.version, original.version, 'الإصدار لازم يرجع كما كان');
  console.log('✓ أُعيدت القاعدة لحالتها الأصلية');

  console.log('\n✅ كل اختبارات المسار الكامل عبر /api/store نجحت على قاعدة Supabase.');
} finally {
  server.close();
}
