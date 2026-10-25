// ===== حالة الفيدباك التي تنتمي إليها البطاقة في لوحة «حالات عملائي» =====
// الأصل: أحدث حدث في خط العميل الزمني يحمل حالة (فيدباك من الشريط أو من مكالمة).
// لكن كثيراً ما تُغيّر المرحلة وحدها (أزرار new / follow up / closed deal، أو تغيير
// المرحلة من تبويب «المراحل») بلا أي فيدباك — فكانت البطاقة تظهر في القائمة
// والعداد يبقى صفراً. لذلك عند غياب حالة فيدباك نسقط على المرحلة الحالية.

import { cleanCommentText, commentActivitiesOf, isSystemOnlyText } from '../shared/comments.js';

export const STAGE_TO_FEEDBACK_STATUS: Record<string, string> = {
  new: 'fresh-stage',
  contacted: 'follow-up',
  meeting: 'meeting',
  negotiation: 'reservation',
  closed: 'done-deal',
  lost: 'cancellation',
};

// العكس: كل حالة فيدباك تنتهي إلى أي مرحلة — يُستخدم لعدّ أرقام التوزيع على المراحل
export const FEEDBACK_STATUS_TO_STAGE: Record<string, string> = {
  'fresh-stage': 'new',
  'follow-up': 'contacted',
  'no-answer': 'contacted',
  meeting: 'meeting',
  'after-meeting': 'meeting',
  reschedule: 'meeting',
  reservation: 'negotiation',
  'done-deal': 'closed',
  cancellation: 'lost',
};

// الحالة التي تبدأ بها الأرقام الواردة قبل أي فيدباك
export const LEAD_STATUS_TO_FEEDBACK_STATUS: Record<string, string> = {
  new: 'fresh-stage',
  viewed: 'fresh-stage',
  contacted: 'follow-up',
  closed: 'done-deal',
};

export const latestFeedbackStatusOf = (record: any): string => {
  const activities: any[] = Array.isArray(record?.activities) ? record.activities : [];
  const found = activities.find((activity) => !!activity?.status);
  return found ? String(found.status) : '';
};

export const feedbackBucketOf = (record: any): string => {
  const status = latestFeedbackStatusOf(record);
  if (status) return status;
  return STAGE_TO_FEEDBACK_STATUS[String(record?.stage || '')] || '';
};

// ===== فهرس الفيدباك بالرقم =====
// أرقام التوزيع ليست عملاء مسجّلين، فحالتها محفوظة في بطاقات «الفيدباك اليومي»
// وفي سجل المكالمات — وكلاهما مربوط بالهاتف. الفهرس يجمع أحدهما بالآخر بالأحدث.
export const digitsOfPhone = (value: any): string =>
  String(value ?? '')
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[\u06f0-\u06f9]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[^\d]/g, '');

export type PhoneSnapshot = {
  status: string;
  cancelReason: string;
  note: string;
  at: string;
};

export const feedbackByPhone = (
  feedbacks: any[] = [],
  callLogs: any[] = []
): Map<string, PhoneSnapshot> => {
  const map = new Map<string, PhoneSnapshot>();
  // آخر كلام كتبه المندوب على كل رقم — منفصل عن الحالة، لأن لوج النظام
  // (زي «No answer») مالوش كلام، ومن حقّه ما يمسحش كلام المندوب اللي قبله.
  const notes = new Map<string, { note: string; at: string }>();

  const putNote = (phone: any, raw: any, at: string) => {
    const key = digitsOfPhone(phone);
    if (!key) return;
    const text = cleanCommentText(raw);
    // نص آلي لوحده (لوج) مش كلام مندوب — ما يتكتبش كملاحظة
    if (!text || isSystemOnlyText(text)) return;
    const prev = notes.get(key);
    if (prev && String(prev.at) > String(at)) return;
    notes.set(key, { note: text, at });
  };

  const put = (phone: any, snapshot: PhoneSnapshot) => {
    const key = digitsOfPhone(phone);
    if (!key) return;
    const prev = map.get(key);
    if (prev && String(prev.at) > String(snapshot.at)) return;
    // حالة فارغة ما بتقدرش تمسح حالة معروفة (فيدباك من غير حالة صريحة)
    if (!snapshot.status && prev?.status) {
      if (String(snapshot.at) > String(prev.at)) prev.at = snapshot.at;
      return;
    }
    map.set(key, snapshot);
  };

  // ===== ترتيب مهم =====
  // سجل المكالمات الأول، بعدين بطاقات الفيدباك: لأن أكتر من حدث واحد (مكالمة +
  // فيدباك) بيتسجّل في نفس اللحظة، والفيصل هو **الحالة الصريحة** اللي اختارها
  // المندوب في الفيدباك (follow up / meeting / done deal …)، لا نتيجة المكالمة
  // الضمنية. فلو المعالجة كانت بالعكس، المكالمة كانت هتنسخ الحالة وترجّع
  // الرقم لـ follow-up حتى لو المندوب حطّه meeting.
  for (const log of callLogs || []) {
    put(log?.clientPhone, {
      status: log?.result === 'no-answer' ? 'no-answer' : 'follow-up',
      cancelReason: '',
      note: '',
      at: String(log?.createdAt || ''),
    });
    putNote(log?.clientPhone, log?.comment, String(log?.createdAt || ''));
  }

  for (const feedback of feedbacks || []) {
    const at = String(feedback?.createdAt || feedback?.date || '');
    put(feedback?.clientPhone, {
      status: String(feedback?.status || ''),
      cancelReason: String(feedback?.cancelReason || ''),
      note: '',
      at,
    });
    putNote(feedback?.clientPhone, feedback?.feedback, at);
  }

  // الملاحظة = آخر كلام مندوب على الرقم (وليس آخر لوج)
  for (const [key, entry] of map) {
    const note = notes.get(key);
    if (note) entry.note = note.note;
  }

  return map;
};

// ===== «Cold Calls» vs «Fresh Leads» =====
//Fresh Leads = الأرقام الجديدة اللي ما اتفتحتش لسه (ما اتحركتش خالص).
// Cold Calls = الأرقام اللي اتفتحت (عميل مسجّل، أو رقم اتفتح من التوزيع) بس ما اتصلنا بيها.
// والاتنين مبنيين على نفس البيانات، بسهم **مش نفس الأرقام** — والفرق واضح في العدّادات.
export const isColdNumber = (record: any, calledPhones: Set<string>): boolean => {
  const bucket = String(record?.bucket || feedbackBucketOf(record));
  if (bucket !== 'fresh-stage') return false;
  if (calledPhones.has(digitsOfPhone(record?.phone))) return false;
  // «مفتوح» = حدّ فتح الرقم أو سجّله: عميل مسجّل أو رقم اتفتح من التوزيع
  if (typeof record?.opened === 'boolean') return record.opened;
  if (record?.client || Array.isArray(record?.activities)) return true;
  return false;
};

export type WorkNumber = {
  key: string;
  name: string;
  phone: string;
  bucket: string;
  stage: string;
  cancelReason: string;
  note: string;
  // آخر كلامكتبه المندوب على الرقم (من الفيدباك أو من المكالمة) — كلام صافي
  // من غير لوجات. بيظهر على كارت الرقم في صفحة «الأرقام».
  salesNote?: string;
  leadId?: string;
  client?: any;
  // الرقم اتفتح فعلاً (مندوب فتحه من التوزيع / العميل عليه نشاط) بس ما اتصلناش فيه.
  // ده اللي بيفصل «Cold Calls» عن «Fresh Leads» — الاتنين مش نفس الأرقام.
  opened?: boolean;
};

// ===== كل رقم يشتغل عليه المستخدم: عملاء مسجّلون + أرقام التوزيع =====
// العدّادات في «الرئيسية» و«المراحل» كانت تحسب العملاء المسجّلين فقط، وأرقام
// التوزيع (شغل المندوب الفعلي) ما كانتش بتتعدّ خالص فيفضل الصفر ثابت. هنا كل
// رقم يظهر مرة واحدة: العميل بحالته خطّه الزمني، والرقم الموزّع بحالة آخر فيدباك
// مسجّل على نفس الهاتف (بطاقة فيدباك أو مكالمة) وإلا بحالته الأصلية في التوزيع.
export const buildWorkNumbers = (
  clients: any[] = [],
  leads: any[] = [],
  snapshots: Map<string, PhoneSnapshot> = new Map(),
  { includeUnassigned = true }: { includeUnassigned?: boolean } = {}
): WorkNumber[] => {
  const out: WorkNumber[] = [];
  const seen = new Set<string>();

  // خريطة الرقم الموزَّع بالهاتف: نعرف منه مين فتح رقمه (viewed) ومن اتصلنا بيه
  const leadByPhone = new Map<string, any>();
  for (const lead of leads || []) {
    // زي ما في اللوب اللي تحته: الرقم غير الموزّع مش شغل حدّ
    if (!includeUnassigned && !String(lead?.salesId || '').trim()) continue;
    const k = digitsOfPhone(lead?.phone);
    if (k && !leadByPhone.has(k)) leadByPhone.set(k, lead);
  }

  for (const client of clients || []) {
    const phone = String(client?.phone || '');
    const key = digitsOfPhone(phone) || `client:${client?.id}`;
    const activities: any[] = Array.isArray(client?.activities) ? client.activities : [];
    // كلام المندوب فقط (لا لوجات) — هو اللي يتعرض كملاحظة على الرقم
    const commentActs = commentActivitiesOf(client);
    const lastActivity = commentActs.find((a: any) => !!String(a?.text || '').trim());
    const snapshot = snapshots.get(key);
    // حالة العميل: الصريحة في خطّه الزمني، وإلا آخر فيدباك/مكالمة على نفس الرقم
    // (مكالمة من جهاز تاني أو رقم اتحوّل لعميل بعد ما اتصلنا بيه).
    const actStatus = latestFeedbackStatusOf(client);
    const actAt = String(activities.find((a: any) => !!a?.status)?.at || '');
    const snapStatus = String(snapshot?.status || '');
    const snapAt = String(snapshot?.at || '');
    const bucket =
      snapStatus && (!actAt || snapAt >= actAt)
        ? snapStatus
        : actStatus || STAGE_TO_FEEDBACK_STATUS[String(client?.stage || '')] || '';
    // «مفتوح» = المندوب فتح الرقم من التوزيع (viewed) أو كتب عليه كلام.
    // وعميل مش من التوزيع (أضافه بنفسه) = مفتوح برضه.
    const lead = leadByPhone.get(key);
    const openedBySales =
      !!lead && (lead?.status === 'viewed' || lead?.status === 'contacted' || !!lead?.viewedAt);
    out.push({
      key,
      name: String(client?.name || 'بدون اسم'),
      phone,
      bucket,
      stage: String(client?.stage || ''),
      cancelReason: String(
        client?.cancelReason ||
          activities.find((a: any) => !!String(a?.cancelReason || '').trim())?.cancelReason ||
          ''
      ),
      note: String(lastActivity?.text || client?.feedback || ''),
      salesNote: String(lastActivity?.text || ''),
      client,
      opened: openedBySales || commentActs.length > 0 || !lead,
    });
    if (key) seen.add(key);
  }

  for (const lead of leads || []) {
    // الأرقام التي لم تُوزّع بعد ليست شغل أحد، فلا تدخل لوحة الحالات ولا المراحل
    // (كانت تُحسب «fresh stage» فتظهر كل أرقام الفورمات وكأنها مرحلة جديدة عند الفريق).
    if (!includeUnassigned && !String(lead?.salesId || '').trim()) continue;
    const phone = String(lead?.phone || '');
    const key = digitsOfPhone(phone) || `lead:${lead?.id}`;
    if (seen.has(key)) continue; // الرقم اتحوّل لعميل مسجّل — ما يتكررش
    const snapshot = snapshots.get(key);
    const bucket =
      snapshot?.status ||
      LEAD_STATUS_TO_FEEDBACK_STATUS[String(lead?.status || '')] ||
      'fresh-stage';
    out.push({
      key,
      name: String(lead?.name || 'بدون اسم'),
      phone,
      bucket,
      stage: FEEDBACK_STATUS_TO_STAGE[bucket] || 'new',
      cancelReason: String(snapshot?.cancelReason || ''),
      note: String(snapshot?.note || lead?.description || ''),
      salesNote: String(snapshot?.note || ''),
      leadId: String(lead?.id || ''),
      // الرقم الموزَّع اتفتح = المندوب فتحه من شاشة التوزيع (status = viewed)
      opened:
        lead?.status === 'viewed' || lead?.status === 'contacted' || !!lead?.viewedAt,
    });
    seen.add(key);
  }

  return out;
};
