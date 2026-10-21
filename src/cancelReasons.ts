// ===== أسباب الإلغاء (cancel reason) =====
// تُعرض كقائمة منسدلة تانية لحظة اختيار حالة «cancellation» في أي مكان في النظام،
// واختيار سبب يكتب الكومنت تلقائياً (زي «no answer») ويُحفظ مع السجل نفسه
// حتى تستطيع قائمة الفلتر في صفحة العملاء تصفية الأرقام بسبب الإلغاء.

export type CancelReason = { id: string; label: string; ar: string };

export const CANCEL_REASONS: CancelReason[] = [
  { id: 'not-interested', label: 'Not interested', ar: 'غير مهتم' },
  { id: 'low-budget', label: 'Low budget', ar: 'الميزانية أقل من المطلوب' },
  { id: 'location', label: 'Location', ar: 'الموقع غير مناسب' },
  { id: 'wrong-request', label: 'Wrong request', ar: 'طلب خاطئ' },
  { id: 'unreachable', label: 'Unreachable', ar: 'يتعذّر الوصول إليه' },
  { id: 'better-option', label: 'Better option', ar: 'وجد خياراً أفضل' },
];

export const CANCEL_REASON_BY_ID: Record<string, CancelReason> = Object.fromEntries(
  CANCEL_REASONS.map((reason) => [reason.id, reason])
);

// نص الكومنت التلقائي عند اختيار السبب — نفس أسلوب NO_ANSWER_COMMENT
export const cancelReasonLabelOf = (id?: string): string =>
  (id && CANCEL_REASON_BY_ID[id]?.label) || '';

// آخر سبب إلغاء محفوظ على العميل: الحقل الصريح أولاً، وإلا أحدث حدث في خطه الزمني
// (السجلات القديمة لا تعرف الحقل، فالتاريخ يُقرأ من الأحداث).
export const latestCancelReasonOf = (record: any): string => {
  const direct = String(record?.cancelReason || '').trim();
  if (direct) return direct;
  const activities: any[] = Array.isArray(record?.activities) ? record.activities : [];
  const found = activities.find((activity) => !!String(activity?.cancelReason || '').trim());
  return found ? String(found.cancelReason).trim() : '';
};
