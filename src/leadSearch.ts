// ===== بحث أرقام السيلز (شاشة ENGAZ / Leads) =====
// كان البحث بيقارن التليفون بالبحث بعد شيل كل الحروف (`replace(/\D/g, '')`)،
// وأي بحث بالاسم بيطلع سلسلة أرقام فاضية — و`"0100…".includes("")` بترجّع true
// دايماً، فالنتيجة إن أي بحث بالاسم كان بيطابق كل الأرقام وما يفلترش حاجة.
// هنا الفصل واضح: نص الحروف يتقارن بالاسم واسم الفورم، والأرقام تتقارن بالتليفون.

export type LeadSearchField = 'all' | 'name' | 'phone' | 'form';

export type LeadSearchRow = { name?: string; phone?: string; formName?: string };

// توحيد الأرقام العربية والإنجليزية والعربية الفارسية
const unifyDigits = (value: unknown): string =>
  String(value ?? '')
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[\u06f0-\u06f9]/g, (d) => String(d.charCodeAt(0) - 0x06f0));

// توحيد الحروف: ألف بأشكالها، الألف المقصورة، التاء المربوطة، والتشكيل
const unifyText = (value: unknown): string =>
  unifyDigits(value)
    .toLowerCase()
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[\u064b-\u065f\u0670]/g, '');

const digitsOf = (value: unknown): string => unifyDigits(value).replace(/\D/g, '');

export function matchLeadSearch(
  row: LeadSearchRow | null | undefined,
  query: string,
  field: LeadSearchField = 'all'
): boolean {
  const text = unifyText(query).trim();
  const number = digitsOf(query);
  // بحث فاضي = كل الأرقام
  if (!text && !number) return true;

  const name = unifyText(row?.name);
  const form = unifyText(row?.formName);
  const phone = digitsOf(row?.phone);

  const nameHit = !!text && name.includes(text);
  const formHit = !!text && form.includes(text);
  // مقارنة التليفون بتحصل فقط لو المستخدم كتب أرقام فعلاً
  const phoneHit = !!number && phone.includes(number);

  if (field === 'name') return nameHit;
  if (field === 'phone') return phoneHit;
  if (field === 'form') return formHit;
  return nameHit || phoneHit || formHit;
}
