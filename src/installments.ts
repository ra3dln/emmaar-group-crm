// ===== حساب المقدم والأقساط =====
// دوال صافية (بلا واجهة) عشان الحسبة تتحسب وتتختبر لوحدها:
//   المقدم    = المبلغ الكلي × نسبة المقدم
//   المتبقي   = المبلغ الكلي − المقدم
//   القسط     = المتبقي ÷ (عدد السنين × ١٢ شهر)
// أي مدخل غير صالح أو سالب بيتعامل كصفر، والنسبة فوق ١٠٠% ما بتنقصش المتبقي تحت الصفر.

export const MONTHS_PER_YEAR = 12;

export type InstallmentBreakdown = {
  total: number;
  percent: number;
  years: number;
  downPayment: number;
  remaining: number;
  months: number;
  monthly: number;
  // الحسبة مكتملة (مبلغ + مدة) يعني الأرقام النهائية قابلة للعرض
  ready: boolean;
};

export function toAmount(value: string | number | null | undefined): number {
  const n = Number(String(value ?? '').replace(/[,\s]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function installmentBreakdown(
  totalInput: string | number,
  percentInput: string | number,
  yearsInput: string | number
): InstallmentBreakdown {
  const total = toAmount(totalInput);
  const percent = toAmount(percentInput);
  const years = toAmount(yearsInput);

  const downPayment = (total * percent) / 100;
  const remaining = Math.max(0, total - downPayment);
  const months = Math.round(years * MONTHS_PER_YEAR);
  const monthly = months > 0 ? remaining / months : 0;

  return {
    total,
    percent,
    years,
    downPayment,
    remaining,
    months,
    monthly,
    ready: total > 0 && months > 0,
  };
}
