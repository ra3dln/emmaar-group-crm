// ===== صاحب الرقم في «توزيع الأرقام» = صاحب العميل =====
// الرقم الموزّع بيتحوّل لعميل، وصاحبه محفوظ في مكانين: الرقم (salesId) والعميل
// (userId/assignedTo). لو اختلفوا، الإدارة بتشوف الرقم مع سيلز وهو في حساب سيلز تاني
// (حصل: 3 أرقام في التوزيع مع Salma وفي حساب Hassan). القاعدة:
//   • الرقم موزّع على حد → العميل يروح لنفس الشخص (التوزيع هو الأساس).
//   • الرقم مش موزّع والعميل عند حد → الرقم ياخد صاحب العميل (ما يتوزّعش على حد تاني).
// الملف نقي ومشترك (أجهزة الإدارة + سكريبتات الإصلاح) ومختبَر في tests/owner-sync.mjs.

const digits = (value) =>
  String(value ?? '')
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/\D/g, '');
const phoneKey = (value) => {
  const d = digits(value);
  return d.length >= 10 ? d.slice(-10) : d;
};
const ownerOfClient = (client) => String(client?.userId || client?.assignedTo || '').trim();

//   userIds: الحسابات الموجودة — صاحب محذوف ما بنحطوش على حاجة
// يرجّع التعديلات بس (من غير ما يغيّر القوائم):
//   clientFixes: [{ id, owner, via }]  ·  leadFixes: [{ id, owner }]
export function reconcileOwners({ leads = [], clients = [], userIds = [] } = {}) {
  const users = new Set((userIds || []).map((id) => String(id)));
  const clientByPhone = new Map();
  for (const client of clients || []) {
    for (const phone of [client?.phone, ...(Array.isArray(client?.phones) ? client.phones : [])]) {
      const key = phoneKey(phone);
      if (key && !clientByPhone.has(key)) clientByPhone.set(key, client);
    }
  }
  const clientFixes = [];
  const leadFixes = [];
  const fixedClients = new Set();
  for (const lead of leads || []) {
    if (!lead || lead.status === 'closed') continue;
    const client = clientByPhone.get(phoneKey(lead.phone));
    if (!client) continue;
    const leadOwner = String(lead.salesId || '').trim();
    const clientOwner = ownerOfClient(client);
    if (leadOwner === clientOwner) continue;
    if (leadOwner) {
      if (!users.has(leadOwner) || fixedClients.has(String(client.id))) continue;
      fixedClients.add(String(client.id));
      // «يدوي» دايماً: لو اتسجّل «تلقائي»، قاعدة «اليدوي يكسب» على السيرفر كانت هترجّع
      // الصاحب القديم (اليدوي) — وده بالظبط اللي عمل المشكلة أول مرة.
      clientFixes.push({ id: String(client.id), owner: leadOwner, via: 'manual' });
    } else if (clientOwner && users.has(clientOwner)) {
      leadFixes.push({ id: String(lead.id), owner: clientOwner });
    }
  }
  return { clientFixes, leadFixes };
}
