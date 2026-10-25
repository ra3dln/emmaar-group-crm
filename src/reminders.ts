// ===== «محتاج إجراء»: التذكير فات موعده والمندوب مخدش أي خطوة بعده =====
// الميزة: كارت العميل بيتحول للون الأصفر (= مطلوب إجراء) في كل المراحل — مش
// الـ follow up بس — ويفضل أصفر لحد ما المندوب يتصرف (مكالمة أو كومنت)،
// وبعدها يرجع لونه الأصلي (لون المرحلة).
//
// القاعدة: تذكير مفتوح (مش مكمّل) موعده فات، وما فيش كومنت ولا مكالمة بعد
// وقت إنشاء التذكير → «محتاج إجراء».
import { digitsOfPhone } from './feedbackBuckets.ts';

export type ActionState = {
  // محتاج إجراء (= لوّن أصفر)؟
  needsAction: boolean;
  // وقت التذكير اللي فات (لو محتاج إجراء)
  dueAt?: string;
  // معرّف التذكير
  reminderId?: string;
};

// وقت أي تاريخ (٠ لو مش صالح)
const timeOf = (value: any): number => {
  const t = Date.parse(String(value || ''));
  return Number.isFinite(t) ? t : 0;
};

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

// هل عمل المندوب حاجة بعد التذكير؟ (كومنت في خط العميل أو مكالمة مسجّلة)
const actedAfter = (client: any, callLogs: any[], since: number): boolean => {
  const acts = Array.isArray(client?.activities) ? client.activities : [];
  if (acts.some((a: any) => timeOf(a?.at || a?.createdAt) > since)) return true;
  const phone = digitsOfPhone(client?.phone);
  if (!phone) return false;
  return (callLogs || []).some(
    (l: any) => digitsOfPhone(l?.clientPhone) === phone && timeOf(l?.createdAt) > since
  );
};

// حالة العميل: محتاج إجراء ولا لا
export const clientActionState = (
  client: any,
  reminders: any[] = [],
  callLogs: any[] = [],
  now: number = Date.now()
): ActionState => {
  const open = openRemindersOf(client, reminders);
  if (!open.length) return { needsAction: false };
  // اللي فات موعده بس
  const due = open
    .filter((r: any) => {
      const at = timeOf(r?.dateTime);
      return at > 0 && at <= now;
    })
    .sort((a: any, b: any) => timeOf(a?.dateTime) - timeOf(b?.dateTime));
  if (!due.length) return { needsAction: false };
  // ===== أحدث تذكير فات، لا الأقدم =====
  // لو العميل عليه أكتر من متابعة، اختيار الأقدم كان يضيّع التذكيرات الجديدة:
  // أي مكالمة/كومنت بعد التذكير الأول تلغي كل اللي بعده، فلا يظهر «اتأخر» أبداً
  // (وهو سبب عدم ظهور التنبيه في حسابات فيها متابعات متكررة لنفس العميل).
  const target = due[due.length - 1];
  // اتعمل إجراء بعد التذكير (مكالمة أو كومنت)؟ → رجعنا للوضع الطبيعي
  const since = timeOf(target?.createdAt) || timeOf(target?.dateTime);
  if (actedAfter(client, callLogs, since)) return { needsAction: false };
  return {
    needsAction: true,
    dueAt: String(target?.dateTime || ''),
    reminderId: String(target?.id || ''),
  };
};

// أرقام العملاء اللي محتاجة إجراء — بالمفتاح (أرقام الرقم) عشان تتطابق مع
// كارت العميل وكارت الرقم في لوحة الأرقام والصفحات كلها.
// القيمة = وقت التذكير اللي فات (للتلميح).
export const alertMapOf = (
  clients: any[] = [],
  reminders: any[] = [],
  callLogs: any[] = [],
  now: number = Date.now()
): Map<string, string> => {
  const out = new Map<string, string>();
  for (const client of clients || []) {
    const state = clientActionState(client, reminders, callLogs, now);
    if (!state.needsAction) continue;
    const key = digitsOfPhone(client?.phone);
    if (key) out.set(key, String(state.dueAt || ''));
  }
  return out;
};

// نفس الفكرة لرقم موزّع (مش عميل مسجّل): بالتذكير بس — التذكير بيبقى عليه
// برقمه، فنتأكد إن مفيش مكالمة عليه بعد التذكير.
export const leadAlertState = (
  lead: any,
  reminders: any[] = [],
  callLogs: any[] = [],
  now: number = Date.now()
): ActionState => {
  const phone = digitsOfPhone(lead?.phone);
  if (!phone) return { needsAction: false };
  const open = (reminders || []).filter(
    (r: any) => r && !r.isCompleted && digitsOfPhone(r?.clientPhone) === phone
  );
  const due = open
    .filter((r: any) => {
      const at = timeOf(r?.dateTime);
      return at > 0 && at <= now;
    })
    .sort((a: any, b: any) => timeOf(a?.dateTime) - timeOf(b?.dateTime));
  if (!due.length) return { needsAction: false };
  // أحدث تذكير فات (نفس قاعدة العميل) فلا يضيع تذكير جديد بسبب إجراء قديم
  const target = due[due.length - 1];
  const since = timeOf(target?.createdAt) || timeOf(target?.dateTime);
  const called = (callLogs || []).some(
    (l: any) => digitsOfPhone(l?.clientPhone) === phone && timeOf(l?.createdAt) > since
  );
  if (called) return { needsAction: false };
  return {
    needsAction: true,
    dueAt: String(target?.dateTime || ''),
    reminderId: String(target?.id || ''),
  };
};
