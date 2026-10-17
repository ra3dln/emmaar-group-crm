// ===== نقطة البيانات على الاستضافة (Vercel) =====
// البيانات تُخزَّن في قاعدة بيانات مشتركة فتصبح **مشتركة بين كل الأجهزة**
// ومحفوظة للأبد — لا تعتمد على متصفح أي جهاز ولا تختفي مع الوقت.
//
// يُدعم مخزنان، ويُفضَّل Supabase إن كان مضبوطاً:
//   ١) Supabase (Postgres): SUPABASE_URL + SUPABASE_SECRET_KEY
//   ٢) Upstash Redis / Vercel KV: KV_REST_API_URL + KV_REST_API_TOKEN
//      (أو UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN)
//
// ===== الأمان (الأهم) =====
// هذه النقطة **مغلقة تماماً**: لا يُقدَّم أي شيء إلا لمن يحمل كوكي جلسة موقّعاً
// بـ AUTH_SECRET وصادر من /api/auth بعد تسجيل دخول صحيح.
// أي طلب آخر — حتى لو كان يعرف رابط الموقع بالحرف — يرجع 401 ولا يرى شيئاً.
// وكلمات المرور تُحذف من كل رد، فلا تصل للمتصفح إطلاقاً.
//
// بدون أي من المخزنين ترجع الوظيفة 503 ويعمل النظام محلياً على كل جهاز كما كان
// — لا يتعطّل الموقع، يفقد فقط المزامنة المشتركة.

import { createStoreHandler, redisStorage } from '../server/store.js';
import { supabaseStorage } from '../server/supabase.js';

// نفضّل Supabase لو مضبوط، وإلا نرجع لـ Redis — نفس الواجهة تماماً
const supa = supabaseStorage(process.env);
const redis = redisStorage(process.env);
const storage = supa.configured ? supa : redis;
// auth: متغيّرات البيئة التي فيها AUTH_SECRET => بوابة الجلسة إلزامية
const handler = createStoreHandler({ ...storage, auth: process.env });

export default async function (req, res) {
  if (!storage.configured) {
    res.statusCode = 503;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.end(
      JSON.stringify({
        error: 'no database',
        hint: 'قاعدة البيانات غير مضبوطة — أضف Supabase (SUPABASE_URL + SUPABASE_SECRET_KEY) أو Upstash Redis من Storage في لوحة Vercel ثم أعد النشر لتعمل المزامنة المشتركة.',
      })
    );
    return;
  }

  return handler(req, res);
}
