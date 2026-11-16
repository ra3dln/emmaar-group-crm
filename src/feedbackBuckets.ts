// ===== حالة الفيدباك التي تنتمي إليها البطاقة في لوحة «حالات عملائي» =====
// الأصل: أحدث حدث في خط العميل الزمني يحمل حالة (فيدباك من الشريط أو من مكالمة).
// لكن كثيراً ما تُغيّر المرحلة وحدها (أزرار new / follow up / closed deal، أو تغيير
// المرحلة من تبويب «المراحل») بلا أي فيدباك — فكانت البطاقة تظهر في القائمة
// والعداد يبقى صفراً. لذلك عند غياب حالة فيدباك نسقط على المرحلة الحالية.

import { cleanCommentText, isCallResultText, isCommentActivity, isSystemOnlyText } from '../shared/comments.js';

// نص يتعرض كملاحظة على الكارت: كلام المندوب + نص نتيجة الاتصال («No answer» /
// «تم الرد») — لأن «No answer» الأحدث هو آخر كومنت فعلاً ولازم يظهر بدل اللي قبله.
const isNoteText = (text: string): boolean =>
  !!text && (!isSystemOnlyText(text) || isCallResultText(text));

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
  'not-answered': 'contacted',
  meeting: 'meeting',
  'after-meeting': 'meeting',
  reschedule: 'meeting',
  reservation: 'negotiation',
  'hot-case': 'negotiation',
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

// ===== «لم يرد» ما بتنقلش الرقم من خانته =====
// الرقم بيفضل في خانته (Fresh / Follow Up / …) لو اتسجّل عليه «No Answer» —
// سواء نتيجة مكالمة أو حالة اختارها المندوب. فالحالة دي ما بتتحسبش في الخانة.
const NO_ANSWER = 'no-answer';
const bucketStatus = (status: any): string => (String(status || '') === NO_ANSWER ? '' : String(status || ''));

// آخر حالة بتحدد الخانة (من غير «لم يرد») + وقتها
const latestBucketActivityOf = (record: any): any => {
  const activities: any[] = Array.isArray(record?.activities) ? record.activities : [];
  return activities.find((activity) => !!bucketStatus(activity?.status)) || null;
};

// اختيار «No Answer» بيحرّك المرحلة لـ contacted — فلو مفيش غيره على العميل،
// المرحلة دي مش خانة حقيقية: الرقم لسه في Fresh.
const stageBucketOf = (record: any): string => {
  const stage = String(record?.stage || '');
  const activities: any[] = Array.isArray(record?.activities) ? record.activities : [];
  const onlyNoAnswer = activities.some((a) => a?.status === NO_ANSWER);
  if (stage === 'contacted' && onlyNoAnswer) return 'fresh-stage';
  return STAGE_TO_FEEDBACK_STATUS[stage] || '';
};

// ===== «Not Answer At All» =====
// «No Answer» على رقم في Fresh بتنقله لخانة «No Answer».
// ولو الرقم في Follow Up أو أي خانة تانية، «No Answer» ما بتحرّكوش — بيفضل زي ما هو.
// ولو المندوب رجّعه «جديد» بنفسه بعد الـ No Answer → يرجع Fresh.
// («Not Answer At All» مرحلة منفصلة المندوب بيختارها بنفسه.)
const isFreshChoice = (a: any): boolean =>
  a?.status === 'fresh-stage' || (a?.type === 'stage' && /←\s*جديد\s*$/.test(String(a?.text || '')));
const latestAtOf = (activities: any[], pick: (a: any) => boolean): string =>
  activities.reduce((max: string, a: any) => (pick(a) && String(a?.at || '') > max ? String(a.at) : max), '');
const withNoAnswer = (bucket: string, noAnswerAt: string, freshAt: string): string =>
  bucket === 'fresh-stage' && !!noAnswerAt && noAnswerAt > freshAt ? NO_ANSWER : bucket;

export const feedbackBucketOf = (record: any): string => {
  const status = bucketStatus(latestBucketActivityOf(record)?.status);
  if (status) return status;
  const activities: any[] = Array.isArray(record?.activities) ? record.activities : [];
  return withNoAnswer(
    stageBucketOf(record),
    latestAtOf(activities, (a) => a?.status === NO_ANSWER),
    latestAtOf(activities, isFreshChoice)
  );
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
  // وقت آخر كلام — عشان نقارنه بآخر كومنت في خط العميل
  noteAt?: string;
  at: string;
  // وقت الحالة نفسها (at ممكن يكون أحدث: حدث «لم يرد» بعدها ما غيّرش الحالة)
  statusAt?: string;
  // الحالة جاية من نتيجة مكالمة بس (مفيش حالة اختارها المندوب في بطاقة)
  implicit?: boolean;
  // أوقات مكالمات «تم الرد» على الرقم — عشان نعرف «No Answer» المتسجّلة معاها في نفس الإجراء
  answeredAts?: string[];
  // وقت آخر «No Answer» حقيقية على الرقم
  noAnswerAt?: string;
};

// ===== «تم الرد» + «No Answer» في نفس الإجراء =====
// شاشة «إضافة إجراء» كانت بتبدأ بآخر حالة على العميل — فلو أول مكالمة كانت
// «No Answer»، كل مكالمة بعدها اترد عليها اتحفظت حالتها «No Answer» من غير ما
// المندوب ياخد باله، والرقم فضل في Fresh رغم إن عليه أكشن. في الإجراء الواحد
// زرار النتيجة («تم الرد») هو اللي المندوب ضغطه فعلاً، فهو اللي يكسب.
export const SAME_ACTION_MS = 10 * 1000;
export const isAnsweredSameAction = (at: any, answeredAts: string[] = []): boolean => {
  const t = Date.parse(String(at || ''));
  if (!Number.isFinite(t)) return false;
  return answeredAts.some((x) => {
    const c = Date.parse(x);
    return Number.isFinite(c) && Math.abs(c - t) <= SAME_ACTION_MS;
  });
};

export const feedbackByPhone = (
  feedbacks: any[] = [],
  callLogs: any[] = [],
  users: any[] = []
): Map<string, PhoneSnapshot> => {
  const map = new Map<string, PhoneSnapshot>();
  // آخر كومنت على كل رقم — منفصل عن الحالة (الحالة ممكن تيجي من بطاقة بلا كلام).
  // «No answer» الأحدث بيظهر هو، مش الكومنت اللي قبله.
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
    // لوج خالص (اتصال: … / تذكير / واتساب) مش كومنت — ما يتكتبش كملاحظة
    if (!isNoteText(text)) return;
    const prev = notes.get(key);
    if (prev && String(prev.at) > String(at)) return;
    notes.set(key, { note: text, at, by: String(by || '') });
  };

  // الحالة الأحدث بتكسب (ولو نفس اللحظة: اللي اتعالج بعد — الفيدباك بعد المكالمة).
  // حالة فارغة («لم يرد» أو فيدباك من غير حالة) ما بتمسحش حالة معروفة، أيّاً كان
  // ترتيب البيانات — بس بتحدّث وقت آخر حدث على الرقم.
  const put = (phone: any, snapshot: PhoneSnapshot) => {
    const key = digitsOfPhone(phone);
    if (!key) return;
    const status = bucketStatus(snapshot.status);
    const at = String(snapshot.at || '');
    const prev = map.get(key);
    if (!prev) {
      map.set(key, { ...snapshot, status, cancelReason: status ? snapshot.cancelReason : '', statusAt: status ? at : '' });
      return;
    }
    if (at > String(prev.at)) prev.at = at;
    if (status && (!prev.status || at >= String(prev.statusAt || ''))) {
      prev.status = status;
      prev.cancelReason = snapshot.cancelReason;
      prev.statusAt = at;
    }
  };

  // ===== ترتيب مهم =====
  // سجل المكالمات الأول، بعدين بطاقات الفيدباك: لأن أكتر من حدث واحد (مكالمة +
  // فيدباك) بيتسجّل في نفس اللحظة، والفيصل هو **الحالة الصريحة** اللي اختارها
  // المندوب في الفيدباك (follow up / meeting / done deal …)، لا نتيجة المكالمة
  // الضمنية. فلو المعالجة كانت بالعكس، المكالمة كانت هتنسخ الحالة وترجّع
  // الرقم لـ follow-up حتى لو المندوب حطّه meeting.
  const answeredByPhone = new Map<string, string[]>();
  for (const log of callLogs || []) {
    const k = digitsOfPhone(log?.clientPhone);
    if (k && log?.result !== 'no-answer') {
      const list = answeredByPhone.get(k) || [];
      list.push(String(log?.createdAt || ''));
      answeredByPhone.set(k, list);
    }
  }
  const fixedStatus = (feedback: any): string => {
    const raw = String(feedback?.status || '');
    if (raw !== NO_ANSWER) return raw;
    const at = feedback?.createdAt || feedback?.date || '';
    return isAnsweredSameAction(at, answeredByPhone.get(digitsOfPhone(feedback?.clientPhone))) ? 'follow-up' : raw;
  };

  // آخر «No Answer» حقيقية على كل رقم (مكالمة ما اترد عليها أو كارت No Answer) —
  // بتنقل الرقم من Fresh لـ «Not Answer At All»
  const noAnswerAt = new Map<string, string>();
  const markNoAnswer = (phone: any, at: string) => {
    const k = digitsOfPhone(phone);
    if (!k || !at) return;
    if (at > String(noAnswerAt.get(k) || '')) noAnswerAt.set(k, at);
  };

  for (const log of callLogs || []) {
    const missed = log?.result === 'no-answer';
    if (missed) markNoAnswer(log?.clientPhone, String(log?.createdAt || ''));
    put(log?.clientPhone, {
      status: missed ? NO_ANSWER : 'follow-up',
      cancelReason: '',
      note: '',
      at: String(log?.createdAt || ''),
    });
    putNote(log?.clientPhone, log?.comment, String(log?.createdAt || ''), String(log?.salesName || ''));
  }

  for (const feedback of feedbacks || []) {
    const at = String(feedback?.createdAt || feedback?.date || '');
    if (fixedStatus(feedback) === NO_ANSWER) markNoAnswer(feedback?.clientPhone, at);
    put(feedback?.clientPhone, {
      status: fixedStatus(feedback),
      cancelReason: String(feedback?.cancelReason || ''),
      note: '',
      at,
    });
    putNote(
      feedback?.clientPhone,
      feedback?.feedback,
      at,
      String(feedback?.authorName || feedback?.by || nameOf(feedback?.authorId) || nameOf(feedback?.userId))
    );
  }

  // ===== الحالة اللي اختارها المندوب تكسب نتيجة المكالمة الضمنية =====
  // مكالمة «تم الرد» بتعني Follow Up ضمنياً — بس لو الرقم عليه أي حالة اختارها
  // المندوب (حتى No Answer)، الحالة المختارة هي اللي تبان، مش «تم الرد».
  // (كانت مكالمة «تم الرد» أحدث بتغطّي على Meeting / No Answer اللي اختارها.)
  const chosen = new Map<string, { status: string; cancelReason: string; at: string }>();
  for (const feedback of feedbacks || []) {
    const key = digitsOfPhone(feedback?.clientPhone);
    const raw = fixedStatus(feedback);
    if (!key || !raw) continue;
    const at = String(feedback?.createdAt || feedback?.date || '');
    const prev = chosen.get(key) || { status: '', cancelReason: '', at: '' };
    const status = bucketStatus(raw);
    // «No Answer» بيعلّم إن فيه اختيار، بس ما بيغيّرش الخانة
    if (status && at >= String(prev.at)) chosen.set(key, { status, cancelReason: String(feedback?.cancelReason || ''), at });
    else if (!chosen.has(key)) chosen.set(key, prev);
  }
  for (const [key, entry] of map) {
    const pick = chosen.get(key);
    if (!pick) {
      entry.implicit = !!entry.status;
      continue;
    }
    entry.status = pick.status;
    entry.cancelReason = pick.status ? pick.cancelReason : '';
    entry.statusAt = pick.status ? pick.at : '';
  }

  for (const [key, entry] of map) {
    const answered = answeredByPhone.get(key);
    if (answered) entry.answeredAts = answered;
    const missedAt = noAnswerAt.get(key);
    if (missedAt) entry.noAnswerAt = missedAt;
  }

  // الملاحظة = آخر كلام مندوب على الرقم (وليس آخر لوج)
  for (const [key, entry] of map) {
    const note = notes.get(key);
    if (note) {
      entry.note = note.note;
      entry.noteBy = note.by;
      entry.noteAt = note.at;
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

// «Fresh Leads»: رقم في مرحلة جديدة — حتى لو اتصلنا بيه وما ردّش
// («لم يرد» ما بتطلّعش الرقم من Fresh). `calledPhones` باقي للتوافق بس.
export const isFreshNumber = (
  record: any,
  _calledPhones?: Set<string>,
  _now: number = Date.now()
): boolean => String(record?.bucket || feedbackBucketOf(record)) === 'fresh-stage';

// «Cold Calls»: مبقاش بيشيل أرقام — «لم يرد» (نتيجة مكالمة أو حالة مختارة)
// ما بتنقلش الرقم من خانته (Fresh / Follow Up / …). الخانة باقية فاضية.
export const isColdNumber = (
  _record?: any,
  _coldPhones?: Set<string>,
  _now: number = Date.now()
): boolean => false;

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
    // الكومنتات (لا لوجات) — وآخرها بالوقت هو اللي يتعرض كملاحظة على الرقم
    const commentActs = activities
      .filter((a: any) => isCommentActivity(a) && isNoteText(cleanCommentText(a?.text)))
      .map((a: any) => ({ ...a, text: cleanCommentText(a?.text) }));
    const lastActivity = commentActs.reduce(
      (best: any, a: any) => (!best || String(a?.at || '') > String(best?.at || '') ? a : best),
      null
    );
    const snapshot = snapshots.get(key);
    // آخر كلام على الرقم: الأحدث بين خط العميل وبطاقات الفيدباك/المكالمات — الكومنت
    // ممكن يكون وصل البطاقة وما وصلش خط العميل (جهاز تاني أو رفع متأخر)
    const cardIsNewer = !!snapshot?.note && String(snapshot?.noteAt || '') > String(lastActivity?.at || '');
    const noteText = String(cardIsNewer ? snapshot?.note : lastActivity?.text || '');
    const noteBy = String(cardIsNewer ? snapshot?.noteBy || '' : lastActivity?.by || snapshot?.noteBy || '');
    // حالة العميل: الصريحة في خطّه الزمني، وإلا آخر فيدباك/مكالمة على نفس الرقم
    // (مكالمة من جهاز تاني أو رقم اتحوّل لعميل بعد ما اتصلنا بيه).
    // («لم يرد» مش خانة — بيتعدّى عليها في الاتنين)
    // «No Answer» في خط العميل اتسجّلت مع مكالمة «تم الرد» في نفس الإجراء = Follow Up
    const answeredAts = snapshot?.answeredAts || [];
    const statusOfAct = (a: any): string =>
      a?.status === NO_ANSWER && isAnsweredSameAction(a?.at, answeredAts) ? 'follow-up' : String(a?.status || '');
    const actLatest = activities.find((a: any) => !!bucketStatus(statusOfAct(a))) || null;
    const actStatus = bucketStatus(statusOfAct(actLatest));
    const actAt = String(actLatest?.at || '');
    const snapStatus = String(snapshot?.status || '');
    const snapAt = String(snapshot?.statusAt || snapshot?.at || '');
    // «تم الرد» الضمنية ما تغطّيش على حالة اختارها المندوب في خط العميل (حتى No Answer)
    const actChose = activities.some((a: any) => !!a?.status);
    const snapUsable = !!snapStatus && !(snapshot?.implicit && actChose);
    // اتصلنا بيه وكل اللي عليه «لم يرد» → المرحلة contacted مش خانة حقيقية (لسه Fresh)
    const onlyNoAnswerCalls = !!snapshot && !snapUsable && !actStatus;
    const stageBucket =
      onlyNoAnswerCalls && String(client?.stage || '') === 'contacted' ? 'fresh-stage' : stageBucketOf(client);
    const baseBucket =
      snapUsable && (!actAt || snapAt >= actAt)
        ? snapStatus
        : actStatus || stageBucket;
    const actNaAt = latestAtOf(activities, (a) => statusOfAct(a) === NO_ANSWER);
    const snapNaAt = String(snapshot?.noAnswerAt || '');
    const actFreshAt = latestAtOf(activities, isFreshChoice);
    const snapFreshAt = snapUsable && snapStatus === 'fresh-stage' ? snapAt : '';
    const bucket = withNoAnswer(
      baseBucket,
      actNaAt > snapNaAt ? actNaAt : snapNaAt,
      actFreshAt > snapFreshAt ? actFreshAt : snapFreshAt
    );
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
      note: noteText || String(client?.feedback || ''),
      salesNote: noteText,
      // اسم كاتب آخر كلام — محفوظ مع الكومنت أو مع بطاقة الفيدباك
      salesNoteBy: noteBy,
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
    // أي مكالمة بتخلّي حالة الرقم في التوزيع «contacted» — فلو كل اللي عليه
    // «لم يرد»، الحالة دي مش خانة حقيقية: الرقم لسه Fresh.
    const leadStatus = String(lead?.status || '');
    const onlyNoAnswerCalls = !!snapshot && !snapshot.status && leadStatus === 'contacted';
    const bucket = withNoAnswer(
      snapshot?.status ||
        (onlyNoAnswerCalls ? 'fresh-stage' : LEAD_STATUS_TO_FEEDBACK_STATUS[leadStatus]) ||
        'fresh-stage',
      String(snapshot?.noAnswerAt || ''),
      snapshot?.status === 'fresh-stage' ? String(snapshot?.statusAt || '') : ''
    );
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
