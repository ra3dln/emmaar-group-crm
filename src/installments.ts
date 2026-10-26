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

// حقل المبلغ بيكتب بفواصل الآلاف وأنت بتكتب (1,600,000) عشان الرقم الكبير ما يتلخبطش:
// القيمة المحفوظة أرقام فقط، والعرض هو اللي بيتجمّع كل ٣ أرقام.
export function digitsOnly(value: string | number | null | undefined): string {
  return String(value ?? '').replace(/\D/g, '');
}

export function groupThousands(value: string | number | null | undefined): string {
  const digits = digitsOnly(value).replace(/^0+(?=\d)/, '');
  return digits ? digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',') : '';
}

// المساحة ممكن تكون بكسر عشري (120.5 م²): رقم واحد للفاصلة العشرية وبعدها رقمين
// على الأكثر، وأي حاجة غير أرقام بتتشال.
export function normalizeArea(value: string | number | null | undefined): string {
  const cleaned = String(value ?? '').replace(/[^\d.]/g, '');
  const [head, ...rest] = cleaned.split('.');
  const decimals = rest.join('').slice(0, 2);
  return decimals ? `${head}.${decimals}` : head;
}

// إجمالي سعر الشقة = سعر المتر × المساحة.
// لو واحد منهم فاضي (أو صفر) بيرجع صفر، ساعتها الحاسبة بتستخدم المبلغ الكلي
// اللي المستخدم كتبه بنفسه — فالحقول دي اختياربة فعلاً.
export function areaTotal(
  pricePerMeter: string | number | null | undefined,
  area: string | number | null | undefined
): number {
  const price = toAmount(pricePerMeter);
  const size = Number(normalizeArea(area).replace(/\.$/, ''));
  if (!price || !Number.isFinite(size) || size <= 0) return 0;
  return Math.round(price * size * 100) / 100;
}

// موضع المؤشر بعد إضافة الفواصل: بنعدّ الأرقام اللي قبل المؤشر وبنحطّه بعد نفس
// عدد الأرقام في النص المنسّق، فلو عدّلت في وسط الرقم المؤشر ما ينطش لآخره.
export function caretAfterGrouping(formatted: string, digitsBefore: number): number {
  if (digitsBefore <= 0) return 0;
  let seen = 0;
  for (let i = 0; i < formatted.length; i++) {
    if (/\d/.test(formatted[i])) seen++;
    if (seen === digitsBefore) return i + 1;
  }
  return formatted.length;
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
