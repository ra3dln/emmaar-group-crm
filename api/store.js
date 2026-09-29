// ===== نقطة البيانات على الاستضافة (Vercel) =====
// نفس واجهة سيرفر التطوير المحلي، لكن التخزين في Redis لأن ملفات الاستضافة غير قابلة للكتابة.
// لتفعيلها: أضف قاعدة Redis مجانية من Vercel (Storage → Upstash) وسيتم ضبط المتغيرات تلقائياً.
// بدونها يعمل التطبيق لكن كل جهاز يحفظ بياناته محلياً فقط.

import { createStoreHandler, redisStorage } from '../server/store.js';

const storage = redisStorage(process.env);
const empty = { version: 0, data: {} };

const handle = createStoreHandler(
  storage.configured
    ? { load: () => storage.load(), save: (db) => storage.save(db) }
    : {
        load: async () => empty,
        save: async () => {
          throw new Error('storage not configured');
        },
      }
);

export default async function handler(req, res) {
  if (!storage.configured) {
    res.statusCode = 503;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.end(
      JSON.stringify({
        error: 'storage not configured',
        hint: 'أضف قاعدة بيانات Redis مجانية من لوحة Vercel ثم أعد النشر',
      })
    );
    return;
  }
  await handle(req, res);
}
