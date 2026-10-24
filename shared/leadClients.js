// ===== الرقم الموزَّع يصير عميلاً تلقائياً =====
// كل رقم ينزل على مندوب يصير عميله من أول لحظة: ما فيش زر «أضف إلى عملائي»
// ولا رقم موزَّع بلا عميل. المندوب يشوفه في «عملائي» و«مراحل العملاء»
// و«الفيدباك» فوراً، فتبقى الأرقام عند صاحبها واحد لا مبعثرة ولا «نازلة» بلا صاحب.
//
// المعرّف مشتق من الرقم نفسه (مش UUID عشوائي): نفس الرقم = نفس المعرّف على كل
// الأجهزة، فالسجلات بتتدمج في القاعدة بدل ما يتكرر (وهو شرط المزامنة: كل مفتاح
// يُرفع قائمة كاملة، والسيرفر يدمج بالمعرّف ولا يستبدل).
//
// الملف نقي (بلا شبكة ولا واجهة) ليشتغل في المتصفح والسيرفر بنفس الكود.

import { phoneKeyOf } from './autoAssign.js';

// بادئة معرّف العميل التلقائي — تميّزه عن العميل اليدوي (معرّف عشوائي)
export const LEAD_CLIENT_ID_PREFIX = 'crm-lead-';

// ===== وقت تسجيل الرقم في الكامبين =====
// الرقم المسجَّل في الفورم (كامبين) له وقت تسجيل حقيقي: وقت ما الـlead اتسجّل
// عند ميتا. النص ده بيوصلنا في وصف الرقم: «التاريخ: 22/10/2026 - 09:43 ص».
// (السيرفر بيكتب التوقيت بتوقيته = UTC، فبنقراه بنفس التوقيت عشان يبقى مطابق.)
//
// مهم: ده مش وقت إضافة العميل في النظام (ده وقت التحويل لعميل)، واللي كان
// بيتبان غلط في كل القوائم — فبقى فيه فرق واضح بين التنين.
const CAMPAIGN_DATE_RE = /التاريخ:\s*(\d{1,2})\/(\d{1,2})\/(\d{4})\s*(?:-\s*(\d{1,2}):(\d{2}))?\s*(ص|م)?/;

// يحوّل نص «التاريخ: …» إلى وقت ISO (UTC) — أو '' لو النص مش موجود
export const campaignAtFromText = (text) => {
  const m = CAMPAIGN_DATE_RE.exec(String(text || ''));
  if (!m) return '';
  const [, dd, mm, yyyy, hh, min, period] = m;
  let hours = Number(hh || 0) % 12;
  if (period === 'م') hours += 12;
  const date = new Date(
    Date.UTC(Number(yyyy), Number(mm) - 1, Number(dd), hours, Number(min || 0))
  );
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
};

// وقت الرقم: وقت تسجيله في الكامبين إن وُجد، وإلا وقت إضافته في النظام.
// kind = 'campaign' (سُجّل في الكامبين) أو 'added' (أُضيف في النظام)
export const campaignTimeOf = (record) => {
  const explicit = String(record?.campaignAt || '');
  if (explicit) return { at: explicit, kind: 'campaign' };
  const parsed = campaignAtFromText(record?.description || record?.source || '');
  if (parsed) return { at: parsed, kind: 'campaign' };
  return { at: String(record?.createdAt || ''), kind: 'added' };
};

const asList = (value) => (Array.isArray(value) ? value : []);

// معرّف العميل التلقائي لرقم معيّن — نفس الرقم = نفس المعرّف على كل الأجهزة
export const leadClientIdFor = (phone) => {
  const key = phoneKeyOf(phone);
  return key ? `${LEAD_CLIENT_ID_PREFIX}${key}` : '';
};

// أرقام كل العملاء المسجَّلين (الرقم الأساسي + الأرقام الإضافية)
export const clientPhoneKeys = (clients = []) => {
  const out = new Set();
  for (const client of asList(clients)) {
    const phones = [client?.phone, ...(Array.isArray(client?.phones) ? client.phones : [])];
    for (const phone of phones) {
      const key = phoneKeyOf(phone);
      if (key) out.add(key);
    }
  }
  return out;
};

// يبني عملاء جدد من الأرقام الموزَّعة التي ما عندها عميل لسه.
//   leads       : الأرقام الموزَّعة (salesId = صاحب الرقم)
//   clients     : العملاء الموجودون — أرقامهم محجوزة (رقم واحد = مالك واحد)
//   extraPhones : أرقام إضافية محجوزة (مثل لقطة السيرفر) فلا يتكرر السجل
//   by          : اسم من نفّذ الإسناد (يكتب في الخط الزمني للعميل)
export function buildLeadClients({
  leads = [],
  clients = [],
  extraPhones = [],
  at = new Date().toISOString(),
  by = '',
} = {}) {
  const taken = clientPhoneKeys(clients);
  for (const phone of asList(extraPhones)) {
    const key = phoneKeyOf(phone);
    if (key) taken.add(key);
  }

  const created = [];
  for (const lead of asList(leads)) {
    const owner = String(lead?.salesId || '').trim();
    if (!owner) continue; // لسه مش موزَّع على حدّ
    const key = phoneKeyOf(lead?.phone);
    if (!key) continue; // رقم بلا أرقام
    if (taken.has(key)) continue; // الرقم عند حدّ سلفاً — ما نكرّرش العميل
    taken.add(key);
    const description = String(lead?.description || '').trim();
    // وقت تسجيل الرقم في الكامبين (وقت نزوله في الفورم) — مش وقت تحويله لعميل.
    // بنقراه من نص الوصف لأن المصدر الأصلي (created_time) ما كانش متخزّن.
    const registeredAt =
      String(lead?.campaignAt || '') ||
      campaignAtFromText(description) ||
      String(lead?.createdAt || at);
    created.push({
      id: leadClientIdFor(lead.phone),
      userId: owner,
      assignedTo: owner,
      name: String(lead?.name || '').trim() || 'عميل بدون اسم',
      phone: String(lead?.phone || ''),
      phones: [],
      property: '',
      budget: '',
      monthlyInstallment: '',
      deliveryPeriod: '',
      status: 'campaign',
      stage: 'new',
      feedback: '',
      priority: 'high',
      source: description ? `رقم موزّع — ${description}` : 'رقم موزّع',
      ...(lead?.formName ? { formName: String(lead.formName) } : {}),
      // وقت التسجيل في الكامبين هو تاريخ العميل — وتحويله لعميل وقت منفصل (updatedAt)
      createdAt: registeredAt,
      campaignAt: registeredAt,
      updatedAt: at,
      activities: [
        {
          id: `${LEAD_CLIENT_ID_PREFIX}${key}-created`,
          type: 'created',
          text: 'الرقم نزل على المندوب وتحوّل عميلاً تلقائياً',
          at,
          by,
        },
      ],
    });
  }
  return created;
}
