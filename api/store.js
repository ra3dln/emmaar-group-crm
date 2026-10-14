// ===== نقطة البيانات على الاستضافة (Vercel) =====
// البيانات تُخزَّن في Upstash Redis (خطة مجانية) فتصبح **مشتركة بين كل الأجهزة**
// ومحفوظة للأبد — لا تعتمد على متصفح أي جهاز ولا تختفي مع الوقت.
//
// متغيّرات البيئة المتوافقة (أي واحد منها يعمل):
//   KV_REST_API_URL / KV_REST_API_TOKEN              (Vercel KV)
//   UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN (Upstash مباشرة)
//
// بدون أي منهما ترجع الوظيفة 503 ويعمل النظام محلياً على كل جهاز كما كان
// — لا يتعطّل الموقع، يفقد فقط المزامنة المشتركة.

import { createStoreHandler, redisStorage } from '../server/store.js';

const storage = redisStorage(process.env);
// STORE_TOKEN اختياري: لو أضفته على Vercel يقفل نقطة البيانات، ولازم تضيف نفس
// القيمة في VITE_STORE_TOKEN وقت البناء حتى يتصل التطبيق. راجع .env.example
const handler = createStoreHandler({ ...storage, token: process.env.STORE_TOKEN || '' });

export default async function (req, res) {
  if (!storage.configured) {
    res.statusCode = 503;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.end(
      JSON.stringify({
        error: 'no database',
        hint: 'قاعدة البيانات غير مضبوطة — أضف Upstash Redis من Storage في لوحة Vercel ثم أعد النشر لتعمل المزامنة المشتركة.',
      })
    );
    return;
  }

  return handler(req, res);
}
