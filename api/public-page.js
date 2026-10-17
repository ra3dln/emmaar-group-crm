// ===== صفحة الوحدة العامة على الاستضافة =====
// الرابط اللي المندوب بيشاركه مع العميل: /p/<id> — يُفتح لأي شخص بلا تسجيل دخول.
// Vercel يخدم هذه الدالة داخلياً عبر إعادة كتابة في vercel.json، فيبقى الرابط في
// المتصفح /p/<id> زي ما هو، والصفحة نفسها تقرأ المعرّف من المسار وتجيب البيانات
// من /api/public/property (وهو مسار مشترك يقرأ من قاعدة البيانات نفسها).
//
// الصفحة ثابتة HTML بلا أي بيانات داخلها — لا أسماء عملاء ولا أرقام ولا أسرار.
import { renderPublicPageHtml } from '../server/publicPage.js';

export default function handler(_req, res) {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  // لا كاش طويل: لو العقار اتحدّث أو اتحذف، العميل يفتح الرابط يلاقي الحالة الحقيقية
  res.setHeader('Cache-Control', 'no-store');
  res.end(renderPublicPageHtml());
}
