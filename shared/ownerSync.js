// ===== صاحب الرقم في «توزيع الأرقام» = صاحب العميل =====
// الرقم الموزّع بيتحوّل لعميل، وصاحبه محفوظ في مكانين: الرقم (salesId) والعميل
// (userId/assignedTo). لو اختلفوا، الإدارة بتشوف الرقم مع سيلز وهو في حساب سيلز تاني
// (حصل: أرقام في حساب Hassan والتوزيع مكتوب فيه Salma). القاعدة:
//   • العميل عند حد → التوزيع يكتب نفس الشخص (الحساب اللي فيه العميل هو الأساس).
//   • العميل مش عند حد والرقم موزّع → العميل يروح لصاحب الرقم.
//   • أي رقم أو عميل اتغيّر صاحبه في آخر دقيقتين ما بيتلمسش — ممكن يكون توزيع لسه
//     بيتحفظ (الرقم اترفع والعميل لسه في الطريق)، فما نلخبطوش.
// الملف نقي ومشترك (أجهزة الإدارة + سكريبتات الإصلاح) ومختبَر في tests/owner-sync.mjs.

export const OWNER_SETTLE_MS = 2 * 60 * 1000;

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
const timeOf = (value) => {
  const t = Date.parse(String(value || ''));
  return Number.isFinite(t) ? t : 0;
};

//   userIds: الحسابات الموجودة — صاحب محذوف ما بنحطوش على حاجة
//   now:     الوقت الحالي (للاختبار)
// يرجّع التعديلات بس (من غير ما يغيّر القوائم):
//   clientFixes: [{ id, owner, via }]  ·  leadFixes: [{ id, owner }]
export function reconcileOwners({ leads = [], clients = [], userIds = [], now = Date.now() } = {}) {
  const users = new Set((userIds || []).map((id) => String(id)));
  const clientByPhone = new Map();
  for (const client of clients || []) {
    for (const phone of [client?.phone, ...(Array.isArray(client?.phones) ? client.phones : [])]) {
      const key = phoneKey(phone);
      if (key && !clientByPhone.has(key)) clientByPhone.set(key, client);
    }
  }
  const recent = (value) => now - timeOf(value) < OWNER_SETTLE_MS;
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
    // تغيير لسه طازة على أي ناحية — نستنى لما يستقر
    if (recent(lead.assignedAt) || recent(client.updatedAt)) continue;
    if (clientOwner && users.has(clientOwner)) {
      // العميل في حساب حد → التوزيع يكتب نفس الشخص
      leadFixes.push({ id: String(lead.id), owner: clientOwner });
    } else if (leadOwner && users.has(leadOwner) && !fixedClients.has(String(client.id))) {
      // العميل مش عند حد → يروح لصاحب الرقم. «يدوي» عشان قاعدة «اليدوي يكسب» ما ترجّعش
      // صاحب قديم.
      fixedClients.add(String(client.id));
      clientFixes.push({ id: String(client.id), owner: leadOwner, via: 'manual' });
    }
  }
  return { clientFixes, leadFixes };
}
