// ===== حالة الفيدباك التي تنتمي إليها البطاقة في لوحة «حالات عملائي» =====
// الأصل: أحدث حدث في خط العميل الزمني يحمل حالة (فيدباك من الشريط أو من مكالمة).
// لكن كثيراً ما تُغيّر المرحلة وحدها (أزرار new / follow up / closed deal، أو تغيير
// المرحلة من تبويب «المراحل») بلا أي فيدباك — فكانت البطاقة تظهر في القائمة
// والعداد يبقى صفراً. لذلك عند غياب حالة فيدباك نسقط على المرحلة الحالية.

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
export const digitsOfPhone = (value: any): string => String(value ?? '').replace(/[^\d]/g, '');

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
  const put = (phone: any, snapshot: PhoneSnapshot) => {
    const key = digitsOfPhone(phone);
    if (!key) return;
    const prev = map.get(key);
    if (prev && String(prev.at) > String(snapshot.at)) return;
    map.set(key, snapshot);
  };

  for (const feedback of feedbacks || []) {
    put(feedback?.clientPhone, {
      status: String(feedback?.status || ''),
      cancelReason: String(feedback?.cancelReason || ''),
      note: String(feedback?.feedback || ''),
      at: String(feedback?.createdAt || feedback?.date || ''),
    });
  }

  // سجل المكالمة يحمل حالة ضمنية (تم الرد / لم يرد) حتى لو ما اختارش المندوب حالة
  for (const log of callLogs || []) {
    put(log?.clientPhone, {
      status: log?.result === 'no-answer' ? 'no-answer' : 'follow-up',
      cancelReason: '',
      note: String(log?.comment || ''),
      at: String(log?.createdAt || ''),
    });
  }

  return map;
};

export type WorkNumber = {
  key: string;
  name: string;
  phone: string;
  bucket: string;
  stage: string;
  cancelReason: string;
  note: string;
  leadId?: string;
  client?: any;
};

// ===== كل رقم يشتغل عليه المستخدم: عملاء مسجّلون + أرقام التوزيع =====
// العدّادات في «الرئيسية» و«المراحل» كانت تحسب العملاء المسجّلين فقط، وأرقام
// التوزيع (شغل المندوب الفعلي) ما كانتش بتتعدّ خالص فيفضل الصفر ثابت. هنا كل
// رقم يظهر مرة واحدة: العميل بحالته خطّه الزمني، والرقم الموزّع بحالة آخر فيدباك
// مسجّل على نفس الهاتف (بطاقة فيدباك أو مكالمة) وإلا بحالته الأصلية في التوزيع.
export const buildWorkNumbers = (
  clients: any[] = [],
  leads: any[] = [],
  snapshots: Map<string, PhoneSnapshot> = new Map()
): WorkNumber[] => {
  const out: WorkNumber[] = [];
  const seen = new Set<string>();

  for (const client of clients || []) {
    const phone = String(client?.phone || '');
    const key = digitsOfPhone(phone) || `client:${client?.id}`;
    const activities: any[] = Array.isArray(client?.activities) ? client.activities : [];
    const lastActivity = activities.find((a) => !!String(a?.text || '').trim());
    out.push({
      key,
      name: String(client?.name || 'بدون اسم'),
      phone,
      bucket: feedbackBucketOf(client),
      stage: String(client?.stage || ''),
      cancelReason: String(
        client?.cancelReason ||
          activities.find((a) => !!String(a?.cancelReason || '').trim())?.cancelReason ||
          ''
      ),
      note: String(lastActivity?.text || client?.feedback || ''),
      client,
    });
    if (key) seen.add(key);
  }

  for (const lead of leads || []) {
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
      leadId: String(lead?.id || ''),
    });
    seen.add(key);
  }

  return out;
};
