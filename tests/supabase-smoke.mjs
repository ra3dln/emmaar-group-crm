// ===== اختبار حقيقي لطبقة Supabase على القاعدة الفعلية =====
// يشغّل نفس الوحدة المستخدمة على الاستضافة (server/supabase.js) ضد مشروع Supabase
// الحقيقي، ويتأكد أن: القراءة تعمل، والكتابة تُحفظ فعلاً، والإصدار يُقرأ،
// وكتابة الإعدادات (config) تعمل — ثم يعيد البيانات كما كانت فلا يمسح شيئاً.
//
// التشغيل:  node tests/supabase-smoke.mjs
// يُقرأ المفتاح من .env (مستبعد من git) أو من متغيّرات البيئة مباشرة.
//
// لو القاعدة غير مضبوطة يخرج بنجاح مع ملاحظة «متخطّى» حتى لا يفشل البناء بلا قاعدة.

import fs from 'node:fs';
import assert from 'node:assert/strict';
import { supabaseJsonStore, supabaseStorage } from '../server/supabase.js';

// ---------- تحميل .env يدوياً (بلا أي مكتبة) ----------
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
const env = {
  ...fileEnv,
  ...process.env,
  SUPABASE_URL: process.env.SUPABASE_URL || fileEnv.SUPABASE_URL || '',
  SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY || fileEnv.SUPABASE_SECRET_KEY || '',
};

const storage = supabaseStorage(env);
if (!storage.configured) {
  console.log('متخطّى: SUPABASE_URL / SUPABASE_SECRET_KEY غير مضبوطين — لا يوجد ما يُختبر.');
  process.exit(0);
}

const TEST_KEY = 'crm:test:smoke';
const configStore = supabaseJsonStore(env, TEST_KEY);

const main = async () => {
  // ١) القراءة الأساسية: لازم ترجع كائن فارغ على الأقل بلا خطأ مصادقة
  const before = await storage.load();
  assert.equal(typeof before.version, 'number', 'الإصدار يجب أن يكون رقماً');
  assert.ok(before.data && typeof before.data === 'object', 'البيانات يجب أن تكون كائناً');
  console.log('✓ القراءة من القاعدة تعمل — الإصدار الحالي:', before.version);

  // ٢) قراءة الإصدار منفصلاً (نفس ما يناديه كل جهاز كل ثوانٍ)
  const versionOnly = await storage.loadVersion();
  assert.equal(versionOnly, before.version, 'loadVersion لازم يطابق إصدار load');
  console.log('✓ قراءة الإصدار تعمل:', versionOnly);

  // ٣) كتابة حقيقية: نحفظ بيانات اختبار ثم نقرأها للتأكد أنها ثُبّتت فعلاً
  const stamp = `smoke-${Date.now()}`;
  await storage.save({ version: before.version + 1, data: { ...before.data, __smoke: stamp } });
  const afterWrite = await storage.load();
  assert.equal(afterWrite.version, before.version + 1, 'الإصدار المكتوب لازم يُقرأ كما هو');
  assert.equal(afterWrite.data.__smoke, stamp, 'القيمة المكتوبة لازم ترجع من القاعدة');
  console.log('✓ الكتابة ثم القراءة مؤكَّدة (round-trip)');

  // ٤) تخزين كائن JSON في مفتاح مستقل (إعدادات مصدر الأرقام)
  await configStore.save({ enabled: true, marker: stamp });
  const config = await configStore.load();
  assert.equal(config.marker, stamp, 'إعدادات JSON لازم ترجع كما كُتبت');
  console.log('✓ تخزين الإعدادات (jsonStore) يعمل');

  // ٥) إعادة كل شيء كما كان — لا نترك أثراً في القاعدة الحقيقية
  await storage.save({ version: before.version, data: before.data });
  const restored = await storage.load();
  assert.equal(restored.version, before.version, 'الإصدار لازم يرجع لقيمته الأصلية');
  assert.equal(restored.data.__smoke, undefined, 'لا يجب أن تبقى بيانات الاختبار');
  await configStore.save({});

  console.log('\n✅ كل اختبارات Supabase نجحت على القاعدة الفعلية.');
};

main().catch((error) => {
  console.error('\n❌ فشل اختبار Supabase:', error?.message || error);
  process.exit(1);
});
