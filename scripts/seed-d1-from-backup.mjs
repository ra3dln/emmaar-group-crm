// ===== تحميل نسخة احتياطية في Cloudflare D1 =====
// Supabase مقفول (exceed_egress_quota) فمش هينفع ننقل منه مباشرة. البيانات بتترجع من:
//   ١) آخر نسخة احتياطية محلية (backup/*.json) — السكريبت ده.
//   ٢) أجهزة الفريق: أول ما الموقع يتصل بـ D1، كل جهاز بيرفع اللي عنده ومش على السيرفر
//      (الدمج بالمعرّف — الأحدث يكسب)، فاللي اتعمل بعد النسخة الاحتياطية بيرجع لوحده.
//
// الدمج (مش استبدال): أي حاجة اتكتبت في D1 قبل أو بعد التحميل بتفضل، والأحدث يكسب.
//
// التشغيل (من مجلد المشروع، وD1_ACCOUNT_ID + D1_DATABASE_ID + D1_API_TOKEN في .env):
//   node scripts/seed-d1-from-backup.mjs                    ← أحدث ملف في backup/
//   node scripts/seed-d1-from-backup.mjs backup/<file>.json ← ملف بعينه

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = { ...process.env };
try {
  for (const line of fs.readFileSync(path.join(root, '.env'), 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (m && !env[m[1]]) env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
  }
} catch {
  /* مفيش .env — هنعتمد على متغيّرات البيئة */
}

const { d1Configured, d1Storage, d1JsonStore } = await import(pathToFileURL(path.join(root, 'server/d1.js')).href);
const { copyAllFromSource } = await import(pathToFileURL(path.join(root, 'server/migrate.js')).href);

if (!d1Configured(env)) {
  console.error('D1 مش مضبوط — ضيف D1_ACCOUNT_ID و D1_DATABASE_ID و D1_API_TOKEN في ملف .env');
  process.exit(1);
}

const pickLatest = () => {
  const dir = path.join(root, 'backup');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
  files.sort((a, b) => fs.statSync(path.join(dir, b)).mtimeMs - fs.statSync(path.join(dir, a)).mtimeMs);
  if (!files.length) throw new Error('مفيش نسخ احتياطية في backup/');
  return path.join(dir, files[0]);
};
const file = process.argv[2] ? path.resolve(process.argv[2]) : pickLatest();
const backup = JSON.parse(fs.readFileSync(file, 'utf8'));
if (!backup || typeof backup.data !== 'object') throw new Error(`الملف مش نسخة بيانات: ${file}`);
console.log('النسخة الاحتياطية:', path.relative(root, file), '| version', backup.version);

const target = d1Storage(env);
const before = await target.load();
const count = (db, key) => (Array.isArray(db?.data?.[key]) ? db.data[key].length : 0);
const KEYS = ['crm_users', 'crm_clients', 'crm_assigned_leads', 'crm_call_logs', 'crm_daily_feedback', 'crm_reminders'];
console.log('D1 قبل التحميل:', KEYS.map((k) => `${k}=${count(before, k)}`).join(' '));

const result = await copyAllFromSource({
  source: { load: async () => backup, jsonStore: () => ({ load: async () => ({}) }) },
  target: { load: () => target.load(), save: (db) => target.save(db), jsonStore: (key) => d1JsonStore(env, key) },
  // إعدادات سحب الأرقام (توكن فيسبوك) مش في النسخة — بتتحط من «مصادر الأرقام» تاني
  settingsKeys: [],
});

const after = await target.load();
console.log('D1 بعد التحميل: ', KEYS.map((k) => `${k}=${count(after, k)}`).join(' '));
console.log('رقم النسخة:', result.version);
for (const key of KEYS) {
  if (count(after, key) < count(backup, key)) {
    console.error(`⚠️ ${key}: في D1 أقل من النسخة الاحتياطية (${count(after, key)} < ${count(backup, key)}) — راجع شواهد الحذف`);
  }
}
console.log('تم ✓ — افتحوا الموقع على كل الأجهزة عشان كل جهاز يرفع اللي عنده بعد تاريخ النسخة.');
