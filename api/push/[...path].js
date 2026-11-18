// ===== نقاط الإشعارات على الاستضافة (Vercel) =====
// ملف التقاطع [...path] يلتقط كل المسارات الفرعية:
//   GET  /api/push/key
//   POST /api/push/subscribe
//   POST /api/push/unsubscribe
//   POST /api/push/test
//   GET  /api/push/state
//
// نفس منطق server/push.js تماماً، لكن الاشتراكات ومفاتيح VAPID وحالة الإرسال
// كلها في القاعدة المشتركة (Supabase/Redis) — فلا تضيع مع الاستدعاء البارد على Vercel.
//
// ===== الأمان =====
// المفتاح العام (/key) ليس سراً ويُقرأ قبل الدخول. أما بقية النقاط فتُقفل
// بإلزام جلسة صحيحة (AUTH_SECRET) — فلا يشترك أحد ليستلم إشعارات بأسماء وأرقام العملاء.

import { createPushHandlerFromStore } from '../../server/push.js';
import { pickJsonStore, pickStorage } from '../../server/storage.js';

const VAPID_KEY = 'crm:push:vapid';
const STATE_KEY = 'crm:push:state';

// نفس مخزون باقي النقاط: D1 ← Supabase ← Redis
const storage = pickStorage(process.env);
const vapidStore = pickJsonStore(process.env, VAPID_KEY);
// نفس مخزن حالة الإرسال الذي يقرأه/يكتبه المُشغّل الدوري — به يعرف التشخيص
// آخر مرة عمل فيها المُشغّل فعلاً ونتيجة آخر إرسال.
const stateStore = pickJsonStore(process.env, STATE_KEY);

// مُسبِّب الإشعارات يُبنى مرة واحدة لكل استدعاء دالة (الدالة قد تُعاد استخدامها عبر حافة واحدة)
let cached = null;
async function getHandler() {
  if (cached) return cached;
  cached = createPushHandlerFromStore({ storage, vapidStore, stateStore, auth: process.env });
  return cached;
}

const reply = (res, status, payload) => {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
};

export default async function handler(req, res) {
  // المفتاح العام متاح قبل فحص القاعدة (يحتاجه المتصفح قبل أي اشتراك)
  const url = (req.url || '').split('?')[0];
  if (url === '/api/push/key' && req.method === 'GET') {
    if (!storage.configured || !vapidStore.configured) {
      return reply(res, 503, {
        error: 'no database',
        hint: 'قاعدة البيانات غير مضبوطة — أضف Supabase (SUPABASE_URL + SUPABASE_SECRET_KEY) أو Upstash Redis من Storage في لوحة Vercel ثم أعد النشر لتعمل الإشعارات.',
      });
    }
    const { handler: h } = await getHandler();
    return h(req, res);
  }

  // بقية النقاط تحتاج قاعدة بيانات مشتركة + جلسة صحيحة
  if (!storage.configured || !vapidStore.configured) {
    return reply(res, 503, {
      error: 'no database',
      hint: 'قاعدة البيانات غير مضبوطة — أضف Supabase (SUPABASE_URL + SUPABASE_SECRET_KEY) أو Upstash Redis من Storage في لوحة Vercel ثم أعد النشر لتعمل الإشعارات.',
    });
  }

  const { handler: h } = await getHandler();
  return h(req, res);
}
