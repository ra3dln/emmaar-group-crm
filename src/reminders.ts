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

// هل عمل المندوب حاجة بعد وقت معيّن؟ (كومنت في خط العميل أو مكالمة مسجّلة)
export const actedSince = (client: any, callLogs: any[], since: number): boolean => {
  const acts = Array.isArray(client?.activities) ? client.activities : [];
  if (acts.some((a: any) => timeOf(a?.at || a?.createdAt) > since)) return true;
  const phone = digitsOfPhone(client?.phone);
  if (!phone) return false;
  return (callLogs || []).some(
    (l: any) => digitsOfPhone(l?.clientPhone) === phone && timeOf(l?.createdAt) > since
  );
};

// هل عمل المندوب حاجة بعد التذكير؟ (كومنت في خط العميل أو مكالمة مسجّلة)
const actedAfter = (client: any, callLogs: any[], since: number): boolean =>
  actedSince(client, callLogs, since);

// ===== كل التذكيرات اللي فات موعدها — مش الأحدث وحده =====
// الرقم يبقى «محتاج إجراء» لو **أي** تذكير فات عليه ومفيش أي خطوة بعده.
// (اختيار الأحدث وحده كان يخلّي التذكيرات الأقدم مختفية، فالتأخير ما كانش
//  بيبان على كل الأرقام المتأخرة — بيبان على رقم واحد بس.)
const dueRemindersOf = (reminders: any[], now: number): any[] =>
  (reminders || [])
    .filter((r: any) => {
      if (!r || r.isCompleted) return false;
      const at = timeOf(r?.dateTime);
      return at > 0 && at <= now;
    })
    .sort((a: any, b: any) => timeOf(a?.dateTime) - timeOf(b?.dateTime));

// وقت التذكير (وقت إنشائه هو الأساس)
const sinceOf = (reminder: any): number =>
  timeOf(reminder?.createdAt) || timeOf(reminder?.dateTime);

// ===== اتعمل إجراء على الرقم بعد هذا التذكير؟ =====
// (مكالمة مسجّلة أو كلام على خط العميل) — نفس قاعدة «محتاج إجراء»:
// التذكير يخرج من قائمة «مستحقة الآن» لما يتاخد إجراء، والشارة بتروح معاه.
export const actedAfterReminder = (
  reminder: any,
  clients: any[] = [],
  callLogs: any[] = []
): boolean => {
  const since = sinceOf(reminder);
  if (!since) return false;
  const phone = digitsOfPhone(reminder?.clientPhone);
  const client = (clients || []).find((c: any) => digitsOfPhone(c?.phone) === phone);
  if (client && actedAfter(client, callLogs, since)) return true;
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
  // كل التذكيرات اللي فات موعدها
  const due = dueRemindersOf(open, now);
  if (!due.length) return { needsAction: false };
  // ===== كل التذكيرات المتأخرة، مش الأحدث وحده =====
  // الرقم محتاج إجراء لو **أي** تذكير فات عليه ومفيش خطوة (مكالمة/كومنت) بعده.
  const pending = due.filter((r: any) => !actedAfter(client, callLogs, sinceOf(r)));
  if (!pending.length) return { needsAction: false };
  const target = pending[0];
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
  const due = dueRemindersOf(open, now);
  if (!due.length) return { needsAction: false };
  // كل تذكير فات عليه ومحدش اتصل بالرقم بعده = لسه محتاج إجراء
  const pending = due.filter((r: any) => {
    const since = sinceOf(r);
    return !(callLogs || []).some(
      (l: any) => digitsOfPhone(l?.clientPhone) === phone && timeOf(l?.createdAt) > since
    );
  });
  if (!pending.length) return { needsAction: false };
  const target = pending[0];
  return {
    needsAction: true,
    dueAt: String(target?.dateTime || ''),
    reminderId: String(target?.id || ''),
  };
};
