// ===== السيلز المشترك على العميل =====
//
// صاحب الرقم (العميل أو الرقم الموزّع) يقدر يضيف سيلز تاني شريك معاه:
//   • الشريك يشوف العميل عنده، ويكتب كومنتات وياخد action عليه زي صاحبه.
//   • الكومنتات مشتركة: كومنتات العميل في خطّه الزمني (نفس السجل)، وبطاقات الفيدباك
//     وسجل المكالمات على نفس الرقم بتتحمّل للطرفين (sharedPhonesOf).
//   • الشريك ما يضيفش ولا يشيل شركاء — صاحب الرقم بس.
//
// الشراكة محفوظة على السجل نفسه (partnerIds) — على العميل وعلى الرقم الموزّع بنفس
// الهاتف، عشان تفضل لو الرقم اتحوّل لعميل (buildLeadClients بينقلها).
import { digitsOfPhone } from './feedbackBuckets.ts';

export const partnerIdsOf = (record: any): string[] => {
  const raw = Array.isArray(record?.partnerIds) ? record.partnerIds : [];
  const ids = raw.map((id: any) => String(id ?? '').trim()).filter(Boolean);
  return [...new Set<string>(ids)];
};

// صاحب السجل: المندوب اللي الرقم في عهدته (salesId للرقم الموزّع، assignedTo/userId للعميل)
export const isRecordOwner = (record: any, userId: string): boolean => {
  const id = String(userId || '').trim();
  if (!id) return false;
  return [record?.salesId, record?.assignedTo, record?.userId].some((owner) => String(owner || '').trim() === id);
};

export const isPartnerOf = (record: any, userId: string): boolean => {
  const id = String(userId || '').trim();
  return !!id && partnerIdsOf(record).includes(id);
};

// إضافة شريك — بترجع نفس السجل لو الإضافة مالهاش لزمة (صاحبه أو شريك أصلاً).
// updatedAt بيتحدّث عشان المزامنة («الأحدث يفوز») تاخد النسخة دي.
export const withPartner = (record: any, partnerId: string, at: string): any => {
  const id = String(partnerId || '').trim();
  if (!id || isRecordOwner(record, id) || isPartnerOf(record, id)) return record;
  return { ...record, partnerIds: [...partnerIdsOf(record), id], updatedAt: at };
};

export const withoutPartner = (record: any, partnerId: string, at: string): any => {
  const id = String(partnerId || '').trim();
  if (!isPartnerOf(record, id)) return record;
  return { ...record, partnerIds: partnerIdsOf(record).filter((p) => p !== id), updatedAt: at };
};

const phonesWhere = (records: any[], test: (record: any) => boolean): Set<string> => {
  const out = new Set<string>();
  for (const record of records || []) {
    if (!record || !test(record)) continue;
    const key = digitsOfPhone(record?.phone);
    if (key) out.add(key);
  }
  return out;
};

// أرقام أنا شريك فيها — خانة «Shared Leads» عند الشريك
export const partnerPhonesOf = (records: any[], userId: string): Set<string> =>
  phonesWhere(records, (record) => isPartnerOf(record, userId));

// أرقام شغلها مشترك (أنا شريك فيها، أو بتاعتي وعليها شريك) — كومنتاتها ومكالماتها
// بتتحمّل للطرفين مهما كان كاتبها.
export const sharedPhonesOf = (records: any[], userId: string): Set<string> =>
  phonesWhere(
    records,
    (record) => isPartnerOf(record, userId) || (isRecordOwner(record, userId) && partnerIdsOf(record).length > 0)
  );

const recordsOnPhone = (records: any[], phone: any): any[] => {
  const key = digitsOfPhone(phone);
  if (!key) return [];
  return (records || []).filter((record) => record && digitsOfPhone(record?.phone) === key);
};

// الشركاء على الرقم (من العميل والرقم الموزّع مع بعض)
export const partnersOnPhone = (records: any[], phone: any): string[] => [
  ...new Set(recordsOnPhone(records, phone).flatMap((record) => partnerIdsOf(record))),
];

// يقدر يضيف/يشيل شركاء؟ صاحب الرقم بس
export const ownsPhone = (records: any[], phone: any, userId: string): boolean =>
  recordsOnPhone(records, phone).some((record) => isRecordOwner(record, userId));
