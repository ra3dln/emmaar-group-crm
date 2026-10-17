// ===== واجهة الرابط العام على الاستضافة =====
//   GET  /api/public/property?id=<id>  => بيانات الوحدة للعرض (بلا تسجيل دخول)
//   POST /api/public/lead              => تسجيل اهتمام عميل من الرابط العام
//
// لا تحتاج جلسة (العميل خارج النظام)، ولذلك:
//   • لا تُعيد أي بيانات داخلية: أسماء/أرقام العملاء وتسجيلات المكالمات ممنوعة تماماً
//     (publicProperty في server/publicPage.js هي المصدر الوحيد لبيانات الوحدة).
//   • محمية بحدّ طلبات لكل IP داخل server/publicPage.js (٣٠ طلباً / ١٠ دقائق).
//
// التخزين هو نفسه المستخدم في /api/store (Supabase ثم Redis) — فنفس المنطق المحلي
// يعمل على الاستضافة بلا أي تفريع، والليد الجديد يدخل قاعدة البيانات المشتركة فوراً.
import { redisStorage } from '../../server/store.js';
import { supabaseStorage } from '../../server/supabase.js';
import { createPublicHandler } from '../../server/publicPage.js';

export default async function handler(req, res) {
  const supa = supabaseStorage(process.env);
  const redis = redisStorage(process.env);
  const storage = supa.configured ? supa : redis;

  if (!storage.configured) {
    res.statusCode = 503;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.end(
      JSON.stringify({
        ok: false,
        error: 'no database',
        hint: 'قاعدة البيانات غير مضبوطة — أضف Supabase (SUPABASE_URL + SUPABASE_SECRET_KEY) أو Upstash Redis ثم أعد النشر.',
      })
    );
    return;
  }

  return createPublicHandler({ storage })(req, res);
}
