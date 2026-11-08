// ===== فورم جديد من رفع شيت =====
// المدير يرفع شيت (Excel أو CSV) فيُبنى منه فورم بنفس اسم الملف، ويُحفظ في إعدادات
// سحب الأرقام حتى يظهر في القوائم المسندلة («عملاء كامبين» و«توزيع الأرقام»).
//
// الأسماء فقط — بلا معرّف ميتا — في نقطتين:
//  ١) السحب التلقائي ما يحاولش يجلب أرقام من فورم غير موجود على فيسبوك.
//  ٢) الفرق بين فورم ميتا (له معرّف ويُسحب منه) وفورم شيت (سجلات جاهزة) يبقى واضح.
//
// الملف نقي في الدوال Helpers (تتكتب في الاختبار)، ودالة الحفظ تستخدم الشبكة.

import { ACTIVE_FORMS_EVENT } from './campaignForms.ts';

export const LEAD_SOURCE_PATH = '/api/lead-source';

// مفتاح الإعدادات المحلية (وضع «بلا قاعدة بيانات»): نفس مفتاح صفحة إعدادات السحب
const LOCAL_SOURCE_KEY = 'crm_lead_source';

// ===== اسم الفورم الافتراضي = اسم الملف بدون الامتداد =====
export const formNameFromFileName = (fileName: string): string =>
  String(fileName || '')
    .replace(/\.[A-Za-z0-9]{1,8}$/, '')
    .replace(/[\\/]+$/, '')
    .trim();

// ===== إضافة اسم فورم لقائمة الأسماء بلا تكرار =====
export const withExtraFormName = (existing: string[], name: string): string[] => {
  const list = (Array.isArray(existing) ? existing : [])
    .map((item) => String(item || '').trim())
    .filter(Boolean);
  const clean = String(name || '').trim();
  if (!clean) return [...new Set(list)];
  const exists = list.some((item) => item.toLowerCase() === clean.toLowerCase());
  return exists ? [...new Set(list)] : [...new Set([...list, clean])];
};

// ===== الوضع المحلي (بلا قاعدة بيانات): الإعدادات في متصفح المدير =====
const readLocalConfig = (): any => {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_SOURCE_KEY) || '{}') || {};
  } catch {
    return {};
  }
};

const writeLocalExtraForms = (names: string[]) => {
  try {
    const current = readLocalConfig();
    localStorage.setItem(LOCAL_SOURCE_KEY, JSON.stringify({ ...current, extraForms: names }));
  } catch {
    /* المتصفح ما سمحش بالكتابة — نكمل بالقائمة المتبقية */
  }
};

// ===== قراءة إعدادات السحب الحالية =====
export const readLeadSourceConfig = async (): Promise<any> => {
  try {
    const res = await fetch(LEAD_SOURCE_PATH, { cache: 'no-store', credentials: 'same-origin' });
    if (!res.ok) return null;
    const json = await res.json();
    return json?.config || null;
  } catch {
    return null;
  }
};

// ===== شيل فورم من إعدادات السحب (لما فورم يدوي يتحذف) =====
export const removeExtraFormName = async (name: string): Promise<boolean> => {
  const clean = String(name || '').trim().toLowerCase();
  if (!clean) return true;
  const without = (list: any[]) => list.filter((item) => String(item || '').trim().toLowerCase() !== clean);
  try {
    const res = await fetch(LEAD_SOURCE_PATH, { cache: 'no-store', credentials: 'same-origin' });
    const json = res.ok ? await res.json().catch(() => ({})) : {};
    const local = Array.isArray(readLocalConfig().extraForms) ? readLocalConfig().extraForms : [];
    const current = Array.isArray(json?.config?.extraForms) ? json.config.extraForms : local;
    if (json?.stateless) {
      writeLocalExtraForms(without(current));
    } else {
      const save = await fetch(LEAD_SOURCE_PATH, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ channel: 'facebook', extraForms: without(current) }),
      });
      const saved = await save.json().catch(() => ({}));
      if (!save.ok || !saved?.ok) return false;
    }
    try {
      window.dispatchEvent(new Event(ACTIVE_FORMS_EVENT));
    } catch {
      /* بلا نافذة (اختبار) — لا بأس */
    }
    return true;
  } catch {
    return false;
  }
};

// ===== حفظ فورم جديد في إعدادات السحب =====
// يرجّع true عند النجاح. الفشل معناه أن الأرقام المسجّلة باسم الفورم لن تظهر في
// القوائم المسندلة (لأنها مُخفّاة بكل فورم غير مفعّل) — فالمستدعي يوقف الحفظ.
export const saveExtraFormName = async (name: string): Promise<boolean> => {
  const clean = String(name || '').trim();
  if (!clean) return true;
  try {
    const res = await fetch(LEAD_SOURCE_PATH, { cache: 'no-store', credentials: 'same-origin' });
    const json = res.ok ? await res.json().catch(() => ({})) : {};
    const config = json?.config || null;
    const localNames = Array.isArray(readLocalConfig().extraForms) ? readLocalConfig().extraForms : [];
    const current = Array.isArray(config?.extraForms) ? config.extraForms : localNames;
    const merged = withExtraFormName(current, clean);

    if (json?.stateless) {
      // بلا قاعدة بيانات: الإعدادات في متصفح المدير
      writeLocalExtraForms(merged);
    } else {
      const save = await fetch(LEAD_SOURCE_PATH, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ channel: 'facebook', extraForms: merged }),
      });
      const saved = await save.json().catch(() => ({}));
      if (!save.ok || !saved?.ok) return false;
    }

    // القوائم المسندلة تتحدّث فوراً بلا إعادة تحميل الصفحة
    try {
      window.dispatchEvent(new Event(ACTIVE_FORMS_EVENT));
    } catch {
      /* بلا نافذة (اختبار) — لا بأس */
    }
    return true;
  } catch {
    return false;
  }
};
