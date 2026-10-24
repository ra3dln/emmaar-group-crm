// ===== تنظيف الكومنتات: حذف اللوجات والكومنتات المكررة من قاعدة البيانات =====
// المشكلة: تسجيل مكالمة كان بيكتب نفس الحكاية في أكتر من مكان (لوج «اتصال» في خط
// العميل + كومنت فيه بادئة «من المكالمة: » + بطاقة فيدباك + سجل مكالمة)،
// فكان الكومنت بيظهر في الكومنتات ٢-٣ مرات، واللوجات بتلخبط السيلز.
//
// هذا الأمر ينظّف القاعدة نفسها (نفس قواعد shared/comments.js):
//   ١) يشيل اللوجات (اتصال / واتساب / تذكير) من خط العميل الزمني.
//   ٢) يشيل الكومنتات المكررة (نفس النص في نفس الدقيقة) ويشيل بادئة «من المكالمة: ».
//   ٣) ينضّف بطاقات «الفيدباك اليومي» من التكرار ومن النصوص الآلية.
//
// التشغيل (من مجلد المشروع):
//   node scripts/clean-comments.mjs --dry     تقرير بدون أي تعديل (الأمن)
//   node scripts/clean-comments.mjs           تطبيق التنظيف على قاعدة الاستضافة
//   node scripts/clean-comments.mjs --local   على ملف البيانات المحلي data/db.json

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sanitizeClientRecord, sanitizeDailyFeedbackCards } from '../shared/comments.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const dryRun = args.includes('--dry');
const useLocal = args.includes('--local');

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
const data = db.data || {};
const clients = Array.isArray(data.crm_clients) ? data.crm_clients : [];
const cards = Array.isArray(data.crm_daily_feedback) ? data.crm_daily_feedback : [];

let removedLogs = 0;
let removedDupes = 0;
let cleanedClients = 0;

const nextClients = clients.map((client) => {
  const before = Array.isArray(client?.activities) ? client.activities : [];
  const copy = JSON.parse(JSON.stringify(client || {}));
  sanitizeClientRecord(copy);
  const after = Array.isArray(copy.activities) ? copy.activities : [];
  removedLogs += Math.max(0, before.length - after.length);
  if (JSON.stringify(before) !== JSON.stringify(after)) cleanedClients += 1;
  return copy;
});

// التكرار داخل كل عميل: نفس النص (مندوب) في نفس الدقيقة
for (const client of nextClients) {
  const acts = Array.isArray(client.activities) ? client.activities : [];
  const seen = new Set();
  for (const a of acts) {
    const type = String(a?.type || '').toLowerCase();
    if (!['feedback', 'comment', 'note'].includes(type)) continue;
    const text = String(a?.text || '').trim();
    const sig = `${text}|${String(a?.at || '').slice(0, 16)}`;
    if (seen.has(sig)) removedDupes += 1;
    else seen.add(sig);
  }
}

const beforeCards = cards.length;
const nextCards = sanitizeDailyFeedbackCards(cards);
const removedCards = beforeCards - nextCards.length;

console.log(`المصدر: ${where}`);
console.log(`العملاء: ${nextClients.length} | عملاء اتغيّر خطهم الزمني: ${cleanedClients}`);
console.log(`لوجات واتصالات/تذكيرات متشالة: ${removedLogs}`);
console.log(`كومنتات مكررة متشالة: ${removedDupes}`);
console.log(`بطاقات فيدباك يومي: ${beforeCards} ← ${nextCards.length} (اتشالة ${removedCards})`);

if (dryRun) {
  console.log('\nوضع المعاينة (--dry): لم يتغيّر شيء في القاعدة.');
  process.exit(0);
}

data.crm_clients = nextClients;
data.crm_daily_feedback = nextCards;
const next = { version: (Number(db.version) || 0) + 1, data };
await storage.save(next);
console.log(`\nتم الحفظ. الإصدار الجديد: ${next.version} — الأجهزة هتسحب البيانات المنظّفة تلقائياً.`);
