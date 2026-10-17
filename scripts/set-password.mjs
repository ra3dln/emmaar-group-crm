// ===== ضبط كلمة مرور أي حساب من سطر الأوامر (بديل لنظام الإدارة) =====
// التغيير المعتاد من النظام: فريق العمل ← تعديل الحساب ← حقل كلمة المرور (للإدارة وحدها).
// هذا الأمر بديل يعمل على القاعدة مباشرة، وتُحفظ النتيجة مشفّرة فلا تُعرض في النظام.
// ومن غير الإدارة لا يقبل السيرفر أي تغيير لكلمة مرور مهما كان المصدر.
//
// التشغيل (من جهاز المكتب، في مجلد المشروع):
//   node scripts/set-password.mjs --list                      عرض الحسابات
//   node scripts/set-password.mjs --user admin                توليد كلمة مرور قوية وعرضها مرة واحدة
//   node scripts/set-password.mjs --user admin --password "..."   تحديد كلمة المرور بنفسك
//   node scripts/set-password.mjs --user admin --local         على ملف البيانات المحلي data/db.json
//
// بدون --local يعمل على قاعدة الاستضافة (Supabase/Redis) المسجّلة في .env —
// أي أنك تغيّر كلمة مرور الإدارة الحقيقية لموقعك من جهازك مباشرة.

import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { hashPassword, sessionVersionOf } from '../server/auth.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// قراءة .env (نفس أسماء المتغيّرات الموجودة على Vercel)
const fileEnv = (() => {
  try {
    const raw = fs.readFileSync(path.join(root, '.env'), 'utf8');
    const out = {};
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
    }
    return out;
  } catch {
    return {};
  }
})();

const args = process.argv.slice(2);
const flagValue = (name) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : '';
};
const username = flagValue('--user') || flagValue('-u');
const passwordArg = flagValue('--password') || flagValue('-p');
const useLocal = args.includes('--local');
const listOnly = args.includes('--list');

const env = { ...process.env, ...fileEnv };

const loadStorage = async () => {
  if (useLocal) {
    const { fileStorage } = await import('../server/store.js');
    const dbFile = path.resolve(env.CRM_DB_FILE || path.join(root, 'data', 'db.json'));
    return { storage: fileStorage(dbFile), where: dbFile };
  }
  const { supabaseStorage } = await import('../server/supabase.js');
  const { redisStorage } = await import('../server/store.js');
  const supa = supabaseStorage(env);
  if (supa.configured) return { storage: supa, where: 'Supabase' };
  const redis = redisStorage(env);
  if (redis.configured) return { storage: redis, where: 'Redis' };
  return { storage: null, where: '' };
};

const { storage, where } = await loadStorage();
if (!storage) {
  console.error('لا توجد قاعدة بيانات مضبوطة في .env — أضف SUPABASE_URL و SUPABASE_SECRET_KEY، أو استخدم --local للملف المحلي.');
  process.exit(1);
}

const db = await storage.load();
const users = Array.isArray(db.data?.crm_users) ? db.data.crm_users : [];

if (listOnly || !username) {
  console.log(`المصدر: ${where}`);
  console.log('الحسابات:');
  for (const u of users) {
    const kind = !u.password ? 'بلا كلمة مرور' : String(u.password).startsWith('sha256:') ? 'مشفّرة ✓' : 'نصية قديمة';
    console.log(`  - ${u.username} | ${u.name || ''} | ${u.role} | ${kind}`);
  }
  if (!username) console.log('\nللتغيير:  node scripts/set-password.mjs --user <اسم المستخدم>');
  process.exit(0);
}

const target = users.find((u) => String(u.username || '').toLowerCase() === String(username).toLowerCase());
if (!target) {
  console.error(`لا يوجد حساب باسم «${username}». استخدم --list لعرض الأسماء.`);
  process.exit(1);
}

// كلمة مرور قوية افتراضية تُعرض مرة واحدة (أو التي حدّدتها أنت)
const generated = passwordArg || randomBytes(9).toString('base64url');
const nextUsers = users.map((u) =>
  String(u.id) === String(target.id)
    ? {
        ...u,
        password: hashPassword(generated),
        // إسقاط كل الجلسات القديمة للحساب (فمن كان يعرف الكلمة القديمة يفقد الوصول)
        sessionVersion: sessionVersionOf(u) + 1,
        passwordChangedAt: new Date().toISOString(),
      }
    : u
);

await storage.save({ version: (Number(db.version) || 0) + 1, data: { ...(db.data || {}), crm_users: nextUsers } });

console.log(`✔ تم ضبط كلمة مرور «${target.username}» (${target.name || ''}) على ${where}`);
console.log(`  كلمة المرور: ${generated}`);
console.log('  احفظها الآن — لن تُعرض مرة أخرى. وكل الأجهزة المسجّلة دخولها بالحساب ده لازم تدخل من جديد.');
