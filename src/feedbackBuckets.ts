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
  // اسم كاتب آخر كلام على الرقم (يتبان جنب الملاحظة)
  noteBy?: string;
  at: string;
};

export const feedbackByPhone = (
  feedbacks: any[] = [],
  callLogs: any[] = [],
  users: any[] = []
): Map<string, PhoneSnapshot> => {
  const map = new Map<string, PhoneSnapshot>();
  // آخر كلام كتبه المندوب على كل رقم — منفصل عن الحالة، لأن لوج النظام
  // (زي «No answer») مالوش كلام، ومن حقّه ما يمسحش كلام المندوب اللي قبله.
  const notes = new Map<string, { note: string; at: string; by: string }>();
  // اسم الكاتب: من سجل المكالمة (محفوظ) أو من بطاقة الفيدباك (بالمعرّف بس)
  const nameOf = (id: any) => {
    const key = String(id || '').trim();
    if (!key) return '';
    const found = (users || []).find((u: any) => String(u?.id) === key);
    return found?.name ? String(found.name) : '';
  };

  const putNote = (phone: any, raw: any, at: string, by = '') => {
    const key = digitsOfPhone(phone);
    if (!key) return;
    const text = cleanCommentText(raw);
    // نص آلي لوحده (لوج) مش كلام مندوب — ما يتكتبش كملاحظة
    if (!text || isSystemOnlyText(text)) return;
    const prev = notes.get(key);
    if (prev && String(prev.at) > String(at)) return;
    notes.set(key, { note: text, at, by: String(by || '') });
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
    putNote(log?.clientPhone, log?.comment, String(log?.createdAt || ''), String(log?.salesName || ''));
  }

  for (const feedback of feedbacks || []) {
    const at = String(feedback?.createdAt || feedback?.date || '');
    put(feedback?.clientPhone, {
      status: String(feedback?.status || ''),
      cancelReason: String(feedback?.cancelReason || ''),
      note: '',
      at,
    });
    putNote(feedback?.clientPhone, feedback?.feedback, at, nameOf(feedback?.userId));
  }

  // الملاحظة = آخر كلام مندوب على الرقم (وليس آخر لوج)
  for (const [key, entry] of map) {
    const note = notes.get(key);
    if (note) {
      entry.note = note.note;
      entry.noteBy = note.by;
    }
  }

  return map;
};

// ===== «Cold Calls» vs «Fresh Leads» =====
//
// Fresh Leads = الأرقام الجديدة اللي **لسه ما اتصلنا فيها خالص** (نزلت على
//   المندوب وما اتصرفش فيها) — دي شغله الجديد. الرقم بيفضل هنا لحد ما
//   يتصل بيه أو يتحدد موعد.
//
// Cold Calls = الأرقام اللي **اتصلنا فيها وآخر محاولة «لم يرد»** — يعني ساعتها
//   باردة (زي ENGAZ). واللي اتصلنا فيه وردّوا مكانه «متابعة» مش بارد.
//
// ⚠️ القاعدة القديمة كانت **وقتية**: أي رقم ما اتصلناش فيه بعد ٢٤ ساعة كان
//   بيبقى «بارد» — فكانت الأرقام الجديدة (اللي نزلت امبارح) بتزاح من
//   Fresh Leads وتدخل Cold Calls من غير ما حد يتصل. ده الغلط المُبلَّغ عنه.
//   الفرق دلوقتي بالحالة (اتصلنا؟ ردّ؟) مش بالوقت.

export const FRESH_WINDOW_MS = 24 * 60 * 60 * 1000;

// وقت نزول الرقم: وقت توزيعه على المندوب، وإلا وقت استيراده
const arrivedAtOf = (record: any): number => {
  const raw = record?.arrivedAt || record?.assignedAt || record?.createdAt || '';
  const at = Date.parse(String(raw));
  return Number.isFinite(at) ? at : 0;
};

// الرقم نزل حالاً؟
export const isFreshArrival = (record: any, now: number = Date.now()): boolean => {
  const at = arrivedAtOf(record);
  if (!at) return false;
  return now - at <= FRESH_WINDOW_MS;
};

// الأرقام اللي **آخر اتصال فيها «لم يرد»** → هي الـ Cold Calls (ساعتها باردة).
// لو اتصلنا فيه بعد كده وردّ → مش بارد (يبقى متابعة).
export const coldPhonesOf = (callLogs: any[] = []): Set<string> => {
  const latest = new Map<string, { at: string; result: string }>();
  for (const l of callLogs || []) {
    const p = digitsOfPhone(l?.clientPhone);
    if (!p) continue;
    const at = String(l?.createdAt || l?.date || l?.at || '');
    const cur = latest.get(p);
    if (!cur || at >= cur.at) latest.set(p, { at, result: String(l?.result || '') });
  }
  const out = new Set<string>();
  for (const [p, rec] of latest) {
    if (rec.result === 'no-answer') out.add(p);
  }
  return out;
};

// «Fresh Leads»: رقم في مرحلة جديدة **ما اتصلناش فيه خالص** (لسه شغل جديد)
export const isFreshNumber = (
  record: any,
  calledPhones: Set<string>,
  now: number = Date.now()
): boolean => {
  const bucket = String(record?.bucket || feedbackBucketOf(record));
  if (bucket !== 'fresh-stage') return false;
  if (calledPhones.has(digitsOfPhone(record?.phone))) return false;
  return true;
};

// «Cold Calls»: اتصلنا فيه وآخر محاولة «لم يرد» (أو حالته «لم يرد»)
// بنظره: الأرقام اللي حالتها «متابعة/مقابلة» مكانها الحقيقي — مش بارد.
export const isColdNumber = (
  record: any,
  coldPhones: Set<string>,
  now: number = Date.now()
): boolean => {
  const bucket = String(record?.bucket || feedbackBucketOf(record));
  const phone = digitsOfPhone(record?.phone);
  if (!phone) return false;
  // حالة «لم يرد» صراحةً = بارد
  if (bucket === 'no-answer') return true;
  if (bucket !== 'fresh-stage') return false;
  return coldPhones.has(phone);
};

// «Delay»: رقم عليه تذكير فات وقته والمندوب ما اتصرفش بعده — نفس الأرقام اللي
// عليها شارة «اتأخر» الصفرا (alertMap = «محتاج إجراء» من src/reminders.ts).
// خانة إضافية: الرقم بيفضل في خانته الأصلية كمان (Follow Up مثلاً)، وبيخرج من
// Delay أول ما المندوب يتصل أو يكتب كومنت.
export const isDelayedNumber = (record: any, alertMap?: Map<string, string> | null): boolean => {
  const phone = digitsOfPhone(record?.phone);
  return !!phone && !!alertMap && alertMap.has(phone);
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
  // اسم كاتب آخر كلام على الرقم — يتبان جنب الملاحظة على كارت الرقم
  salesNoteBy?: string;
  leadId?: string;
  client?: any;
  // الرقم اتفتح فعلاً (مندوب فتحه من التوزيع / العميل عليه نشاط) — للمعلومات فقط:
  // الفصل بين «Cold Calls» و«Fresh Leads» بقى بالوقت (نزل امبارح = بارد).
  opened?: boolean;
  // وقت نزول الرقم (توزيعه على المندوب) — بيفصل «الجديد» عن «القديم» في الفريش/البارد
  arrivedAt?: string;
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
      // اسم كاتب آخر كلام (من خط العميل الزمني) — الاسم محفوظ مع الكومنت
      salesNoteBy: String(lastActivity?.by || ''),
      client,
      opened: openedBySales || commentActs.length > 0 || !lead,
      // وقت نزول الرقم: توزيعه على المندوب (وإلا وقت استيراده)
      arrivedAt: String(lead?.assignedAt || lead?.createdAt || client?.createdAt || ''),
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
      // اسم كاتب الملاحظة (من سجل المكالمة أو من بطاقة الفيدباك)
      salesNoteBy: String(snapshot?.noteBy || ''),
      leadId: String(lead?.id || ''),
      // الرقم الموزَّع اتفتح = المندوب فتحه من شاشة التوزيع (status = viewed)
      opened:
        lead?.status === 'viewed' || lead?.status === 'contacted' || !!lead?.viewedAt,
      // وقت نزول الرقم: توزيعه على المندوب (وإلا وقت استيراده) — «الجديد» vs «القديم»
      arrivedAt: String(lead?.assignedAt || lead?.createdAt || ''),
    });
    seen.add(key);
  }

  return out;
};
