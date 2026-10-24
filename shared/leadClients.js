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
      createdAt: at,
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
