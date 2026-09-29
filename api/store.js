// ===== نقطة البيانات على الاستضافة (Vercel) بدون قاعدة بيانات =====
// الوضع الحالي: بدون Redis، تعمل البيانات محلياً على كل جهاز (localStorage) فقط.
// لا يُحفظ ولا يُ tiếtّر أي بيانات على الخادم.
// تفعيل قاعدة Redis: Storage → Upstash → أعد النشر.

const empty = { version: 0, data: {} };
export default async function handler(req, res) {
  res.statusCode = 503;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(
    JSON.stringify({
      error: 'no external storage',
      hint: 'يعمل النظام محلياً على جهازك فقط (بدون قاعدة بيانات).'
    })
  );
}
