// ===== «الإجراء القادم»: موعد محدد (يوم + ساعة) على كارت العميل =====
//
// الفكرة: لما المندوب يختار في الفيدباك «يوم وساعة» للإجراء القادم، يتكتب
// على كارت العميل: «الإجراء القادم: 29 أكتوبر 2026، 11:00 ص».
//
// التنفيذ: الاختيار ده بيبني **تذكيراً** بنفس نظام «محتاج إجراء» الموجود
// أصلاً (crm_reminders)، فالموعد:
//   • يظهر على الكارت باليوم والساعة (سطر «الإجراء القادم»).
//   • لما يجي وقته من غير خطوة → الكارت يولّع أصفر «اتأخر» (نفس منطق
//     «محتاج إجراء» القائم في src/reminders.ts).
//   • يروح من الكارت بعد ما المندوب يتصرف (مكالمة أو كومنت) — زي الشارة.
//
// القاعدة: أقرب تذكير مفتوح للعميل (بالمعرّف أو بالرقم) هو «الإجراء القادم».
import { digitsOfPhone } from './feedbackBuckets.ts';
import { actedSince, clientActionState } from './reminders.ts';

export type NextAction = {
  // موعد الإجراء (ISO)
  at: string;
  // ملاحظة اختيارية (وصف الخطوة)
  note?: string;
  // هل الموعد فات والعميل لسه محتاج خطوة؟
  overdue: boolean;
  // هل اتنفّذ فعلاً (الموعد فات والمندوب اتصرف بعده)؟
  done?: boolean;
  // الموعد مختار من الفيدباك (مكتوب على العميل) ولا مستنتج من تذكير؟
  chosen?: boolean;
};

const timeOf = (value: any): number => {
  const t = Date.parse(String(value || ''));
  return Number.isFinite(t) ? t : 0;
};

// ===== بناء تذكير «الإجراء القادمة» =====
// نفس شكل التذكير العادي في النظام (crm_reminders) عشان كل الشاشات
// (التذكيرات، الإشعارات، «محتاج إجراء») تفهمه من غير فروع جديدة.
export const buildNextActionReminder = (params: {
  id: string;
  userId: string;
  clientId?: string;
  clientName?: string;
  clientPhone?: string;
  at: string;
  note?: string;
  createdAt?: string;
}): any => ({
  id: String(params.id || ''),
  userId: String(params.userId || ''),
  clientId: String(params.clientId || ''),
  clientName: String(params.clientName || ''),
  clientPhone: String(params.clientPhone || ''),
  // موعد الإجراء — وقت محدد (يوم + ساعة) مش تاريخ
  dateTime: String(params.at || ''),
  note: String(params.note || 'إجراء قادم'),
  isCompleted: false,
  isDelayed: false,
  delayCount: 0,
  createdAt: String(params.createdAt || new Date().toISOString()),
});

// كل التذكيرات المفتوحة بتاعت العميل (بالمعرّف أو بالرقم)
const openRemindersOf = (client: any, reminders: any[] = []): any[] => {
  const id = String(client?.id || '');
  const phone = digitsOfPhone(client?.phone);
  return (reminders || []).filter((r: any) => {
    if (!r || r.isCompleted) return false;
    if (id && String(r?.clientId || '') === id) return true;
    return !!phone && digitsOfPhone(r?.clientPhone) === phone;
  });
};

// ===== «الإجراء القادم» للعميل واحد =====
//
// الأولوية للموعد اللي **اختاره المندوب في الفيدباك** (مكتوب على سجل العميل
// نفسه: client.nextActionAt) — ده اللي يبان على الكارت باليوم والساعة.
// لو مفيش اختيار، بنرجع لأقرب تذكير مفتوح (زي تذكير المتابعة التلقائية).
//
// null = مفيش إجراء قادم (ولا حاجة متأخرة مفتوحة).
export const nextActionOf = (
  client: any,
  reminders: any[] = [],
  callLogs: any[] = [],
  now: number = Date.now()
): NextAction | null => {
  if (!client) return null;
  // ===== ١) الموعد المختار من الفيدباك (مكتوب على العميل) =====
  const chosen = String(client?.nextActionAt || '');
  if (chosen && timeOf(chosen) > 0) {
    const note = String(client?.nextActionNote || '');
    if (timeOf(chosen) > now) {
      return { at: chosen, note, overdue: false, done: false, chosen: true };
    }
    // الموعد فات: «اتأخر» لو لسه محتاج خطوة، و«تم» لو اتنفّذ
    // (المحاولة بتتحسب من خط العميل والمكالمات — مش من التذكيرات،
    //  عشان الموعد المختار على العميل يفضل مضبوط لو التذكير اتشال).
    const acted = actedSince(client, callLogs, timeOf(chosen));
    return { at: chosen, note, overdue: !acted, done: acted, chosen: true };
  }
  // ===== ٢) أقرب تذكير مفتوح (متابعة تلقائية أو تذكير قديم) =====
  const open = openRemindersOf(client, reminders)
    .filter((r: any) => timeOf(r?.dateTime) > 0)
    .sort((a: any, b: any) => timeOf(a?.dateTime) - timeOf(b?.dateTime));
  if (!open.length) return null;
  const target = open[0];
  const at = String(target?.dateTime || '');
  if (timeOf(at) > now) {
    // لسه ما جهش — يظهر على الكارت عادي
    return { at, note: String(target?.note || ''), overdue: false, done: false, chosen: false };
  }
  // فات الموعد: يفضل ظاهر «اتأخر» بس لو العميل لسه محتاج خطوة
  const state = clientActionState(client, reminders, callLogs, now);
  if (!state.needsAction) return null;
  return { at, note: String(target?.note || ''), overdue: true, done: false, chosen: false };
};

// خريطة «الإجراء القادم» لكل العملاء — المفتاح = أرقام الرقم
// (عشان تتطابق مع كارت العميل في كل الشاشات).
export const nextActionMapOf = (
  clients: any[] = [],
  reminders: any[] = [],
  callLogs: any[] = [],
  now: number = Date.now()
): Map<string, NextAction> => {
  const out = new Map<string, NextAction>();
  for (const client of clients || []) {
    const action = nextActionOf(client, reminders, callLogs, now);
    if (!action) continue;
    const key = digitsOfPhone(client?.phone);
    if (key) out.set(key, action);
  }
  return out;
};

// ===== خريطة «الإجراءUpcoming» من التذكيرات بس =====
// (من غير ما يكون فيه عميل مسجّل — كارت الرقم في صفحة الأرقام)
// المفتاح = أرقام الرقم، والقيمة = أقرب تذكير مفتوح (المعروض على الكارت).
// الترتيب: الأقرب **المستقبلي** هو «الإجراء القادم»؛ ولو مفيش مستقبلي
// (كل التذكيرات فاتت) بيتبان أقدم واحد متأخر مع شارة «اتأخر».
export const nextActionByPhoneOf = (
  reminders: any[] = [],
  now: number = Date.now()
): Map<string, NextAction> => {
  const upcoming = new Map<string, NextAction>();
  const overdue = new Map<string, NextAction>();
  for (const r of reminders || []) {
    if (!r || r.isCompleted) continue;
    const at = String(r?.dateTime || '');
    const t = timeOf(at);
    if (!t) continue;
    const phone = digitsOfPhone(r?.clientPhone);
    if (!phone) continue;
    const action: NextAction = {
      at,
      note: String(r?.note || ''),
      overdue: t <= now,
      done: false,
      chosen: false,
    };
    const bucket = t > now ? upcoming : overdue;
    const current = bucket.get(phone);
    // الأقرب وقتاً داخل كل مجموعة
    if (!current || t < timeOf(current.at)) bucket.set(phone, action);
  }
  const out = new Map<string, NextAction>();
  for (const [phone, action] of overdue) out.set(phone, action);
  for (const [phone, action] of upcoming) out.set(phone, action);
  return out;
};
