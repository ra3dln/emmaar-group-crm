// ===== اسم الفورم (حملة الكامبين) داخل سجلات النظام =====
// الرقم المسحوب من ميتا يُخزَّن معه اسم الفورم صريحاً (`formName`)، والسجلات القديمة
// تحمل الاسم داخل نص الوصف: «استيراد تلقائي • المصدر: فيسبوك - فورم أكتوبر • التاريخ…».
// هذه الدوال تُستخدم في «عملاء كامبين» و«توزيع الأرقام» وفي التحويل لعميل،
// وموجودة هنا (لا داخل App.tsx) حتى يغطّيها اختبار مستقل.

export const UNKNOWN_FORM = 'بدون اسم فورم';

export type FormNamedRecord = { source?: string; description?: string; formName?: string };

// الفاصل بين حقول الوصف هو «•» فقط؛ فلا نقطع الاسم عند «|» أو «-».
// (مثال حقيقي: «GO ADS | CAVA» كان يُقرأ «GO ADS» فينقسم الفورم لفورمين.)
const cleanFormName = (value?: string) =>
  String(value || '')
    .replace(/[\s|·,،\-]+$/, '')
    .trim();

export const formNameOf = (record: FormNamedRecord | null | undefined): string => {
  if (!record) return '';
  if (record.formName && String(record.formName).trim()) return String(record.formName).trim();
  const text = String(record.description || record.source || '');
  if (!text) return '';
  const labelled = text.match(
    /(?:المصدر|Form|فورم|نموذج)\s*[:：-]?\s*(?:فيسبوك|إنستجرام|انستجرام|Facebook|Instagram)?\s*[-–—:]?\s*([^•]+)/i
  );
  if (labelled && cleanFormName(labelled[1])) return cleanFormName(labelled[1]);
  const dashed = text.match(/(?:فيسبوك|إنستجرام|انستجرام|Facebook|Instagram)\s*[-–—]\s*([^•]+)/i);
  if (dashed && cleanFormName(dashed[1])) return cleanFormName(dashed[1]);
  return '';
};

// اسم السجل في التجميع: اسم الفورم، أو «بدون اسم فورم» لسجلات غير مرتبطة بفورم
export const formKeyOf = (record: FormNamedRecord | null | undefined): string =>
  formNameOf(record) || UNKNOWN_FORM;

// ===== الفورمات المفعّلة في إعدادات سحب الأرقام =====
// القناتان (فيسبوك وإنستجرام) لكل منهما نماذجه، والقائمة تجمعهما بلا تكرار
// حتى تظهر كل الفورمات المفعّلة في القوائم المسندلة قبل وصول أي رقم منها.
export const activeFormNamesOf = (config: any): string[] => {
  const list = [
    ...(Array.isArray(config?.forms) ? config.forms : []),
    ...(Array.isArray(config?.instagram?.forms) ? config.instagram.forms : []),
  ];
  const names = new Set<string>();
  for (const item of list) {
    const name = String(item?.name || '').trim();
    if (name) names.add(name);
  }
  return [...names];
};

// القائمة النهائية للاختيار: الفورمات المفعّلة + أي فورم موجود في السجلات
// (حتى لا يختفي رقم قديم من فورم أُوقف تفعيله). الأكثر أرقاماً أولاً.
export const mergeFormNames = (activeForms: string[] = [], recorded: string[] = []): string[] =>
  [...new Set([...activeForms.map((name) => String(name || '').trim()).filter(Boolean), ...recorded])].sort();
