// ===== قواعد الكومنتات: كلام السيلز فقط — بلا لوجات وبلا تكرار =====
// نفس الملف بيشتغل في الواجهة (src) وفي السيرفر (server) فالقاعدة واحدة
// والنتائج واحدة على كل الأجهزة.

// أنواع الأحداث اللي فيها كلام المندوب
export const COMMENT_TYPES = ['feedback', 'comment', 'note'];

// أنواع الأحداث اللي هي لوجات نظام (اتصال / واتساب / تذكير) — ما بتظهرش في الكومنتات
export const LOG_TYPES = ['call', 'whatsapp', 'reminder'];

// بادئات كانت بتتضاف على الكومنت («من المكالمة: …») — بتشيل عشان يبقى كلام صافي
const PREFIX_RE = /^\s*(?:من\s+المكالمة|من\s+المكالمه|فيدباك|Feedback|اتصال)\s*[:\-]\s*/;

// سطر النظام الآلي في أول الكومنت (زي «No answer» لوحده في سطر قبل كلام المندوب) — بيتشال
const SYSTEM_LINE_RE = /^\s*(?:no\s*answer|not\s*called|busy|تم\s*الرد|لم\s*يرد|مشغول)\s*[\r\n]+/i;

// نصوص النظام الآلية (مش كلام المندوب) — ما بتظهرش كومنت
const SYSTEM_TEXT_RE =
  /^(?:no\s*answer|not\s*called|busy|تم\s*الرد|لم\s*يرد|مشغول|بusy|اتصال\s*[:\-].*|تم\s+إنشاء\s+تذكير.*|تم\s+فتح\s+واتساب.*)$/i;

// نص لوج خالص (مفيش فيه كلام مندوب) — بيتشال من البيانات نفسها
// (بعكس «No answer» لأنها بتضع الحالة والنتيجة، فبتفضل محفوظة)
const PURE_LOG_TEXT_RE =
  /^(?:اتصال|تم\s*الرد|لم\s*يرد|مشغول|تم\s+إنشاء\s+تذكير.*|تم\s+فتح\s+واتساب.*)[:\-]?\s*$/i;

// نص الكومنت بعد شيل البادئات
export const cleanCommentText = (value) =>
  String(value || '').replace(PREFIX_RE, '').replace(SYSTEM_LINE_RE, '').trim();

// نص النظام الآلي؟ (ما بيتمثلش كلام مندوب)
export const isSystemOnlyText = (value) => {
  const clean = cleanCommentText(value);
  if (!clean) return true;
  return SYSTEM_TEXT_RE.test(clean);
};

// لوج خالص (اتصال/تذكير/واتساب) — يتشال من البيانات
export const isPureLogText = (value) => {
  const clean = cleanCommentText(value);
  if (!clean) return true;
  return PURE_LOG_TEXT_RE.test(clean);
};

// الحدث ده كومنت مندوب (مش لوج)؟
export const isCommentActivity = (activity) => {
  const type = String(activity?.type || '').trim().toLowerCase();
  if (!type) return false;
  if (LOG_TYPES.includes(type)) return false;
  return COMMENT_TYPES.includes(type);
};

// توقيع الكومنت: النص النظيف + الدقيقة — عشان نعرف إنه نفس الكومنت مكرر
export const commentSignature = (text, at) =>
  `${cleanCommentText(text)}|${String(at || '').slice(0, 16)}`;

// شيل التكرار: نفس النص في نفس الدقيقة = نفس الكومنت (ينكتب في أكتر من مكان)
export const dedupeComments = (items) => {
  const seen = new Set();
  const out = [];
  for (const item of items || []) {
    const text = cleanCommentText(item?.text);
    if (!text) continue;
    const sig = commentSignature(text, item?.at);
    if (seen.has(sig)) continue;
    seen.add(sig);
    out.push({ ...item, text });
  }
  return out;
};

// كل كومنتات العميل: كلام المندوب فقط — بلا لوجات وبلا تكرار
export const commentActivitiesOf = (client) => {
  const acts = Array.isArray(client?.activities) ? client.activities : [];
  const out = [];
  for (const a of acts) {
    if (!isCommentActivity(a)) continue;
    const text = cleanCommentText(a?.text);
    if (!text || isSystemOnlyText(text)) continue;
    out.push({ ...a, text });
  }
  return dedupeComments(out);
}

// ===== تنظيف سجل عميل (للسيرفر: يمنع رجوع اللوجات من جهاز قديم) =====
// اللوجات (اتصال/واتساب/تذكير) بتتشال، والكومنتات المكررة بتتشال،
// وأحداث تانية (تغيير المرحلة) بتتعمل زي ما هي.
//
// ملاحظة مهمة: الكومنتات الآلية (زي «No answer») بنسيبها في البيانات —
// هي اللي بتحمل الحالة (status) والنتيجة، وشيلها كان هيضيّع حالة العميل.
// الإخفاء بيحصل في العرض فقط (commentActivitiesOf).
export const sanitizeClientRecord = (client) => {
  if (!client || typeof client !== 'object') return client;
  if (!Array.isArray(client.activities)) return client;
  const kept = [];
  const seen = new Set();
  for (const a of client.activities) {
    const type = String(a?.type || '').trim().toLowerCase();
    if (LOG_TYPES.includes(type)) continue;
    if (COMMENT_TYPES.includes(type)) {
      const text = cleanCommentText(a?.text);
      if (!text || isPureLogText(text)) continue;
      const sig = commentSignature(text, a?.at);
      if (seen.has(sig)) continue;
      seen.add(sig);
      kept.push({ ...a, text });
      continue;
    }
    kept.push(a);
  }
  client.activities = kept;
  return client;
};

// ===== تنظيف بطاقات الفيدباك اليومي (نفس الرقم + نفس النص + نفس الدقيقة = تكرار) =====
// نفس الكلام في بطاقتين = تكرار. والبطاقة الآلية (زي «No answer») بنسيبها —
// هي اللي فيها الحالة والنتيجة، والإخفاء بيحصل في العرض.
export const sanitizeDailyFeedbackCards = (cards) => {
  const out = [];
  const seen = new Set();
  for (const card of cards || []) {
    if (!card || typeof card !== 'object') continue;
    const text = cleanCommentText(card.feedback);
    if (!text || isPureLogText(text)) continue;
    const phone = String(card.clientPhone || '').replace(/\D/g, '');
    const at = String(card.date || card.createdAt || '');
    const sig = `${phone}|${text}|${at.slice(0, 16)}`;
    if (seen.has(sig)) continue;
    seen.add(sig);
    out.push({ ...card, feedback: text });
  }
  return out;
};
