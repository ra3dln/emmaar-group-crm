// ===== أرقام إضافية للعميل (ميزة للسيلز) =====
// السيلز يقدر يضيف رقم تاني للعميل اللي نازل عليه (رقم واتساب، رقم قريب، …)
// ويكتب ملحوظة اختيارية عليه. الأرقام بتتخزن في `phones` — نفس الحقل اللي
// البحث والواتساب ومنع تكرار الرقم في التوزيع بيقروه أصلاً — والملحوظة في
// `phoneNotes` بمفتاح أرقام الرقم.
// وحدة نقية (بلا DOM) عشان تتختبر في tests/extra-phones.mjs.

export const phoneDigitsOf = (value: any): string =>
  String(value ?? '')
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/\D/g, '');

// أقصر رقم مقبول (رقم أرضي بكود المحافظة)
export const MIN_PHONE_DIGITS = 8;

export type ExtraPhone = { phone: string; note: string };

// الأرقام الإضافية للعميل مع ملحوظة كل رقم
export const extraPhonesOf = (client: any): ExtraPhone[] => {
  const notes = client?.phoneNotes && typeof client.phoneNotes === 'object' ? client.phoneNotes : {};
  return (Array.isArray(client?.phones) ? client.phones : [])
    .map((phone: any) => String(phone || '').trim())
    .filter(Boolean)
    .map((phone: string) => ({ phone, note: String(notes[phoneDigitsOf(phone)] || '') }));
};

export type AddExtraPhoneResult =
  | { ok: true; client: any }
  | { ok: false; error: string };

// إضافة رقم: لازم يكون رقم صحيح، ومش رقم العميل نفسه، ومش عند عميل تاني
// (رقم واحد = صاحب واحد — نفس قاعدة التوزيع).
export const addExtraPhone = (
  client: any,
  rawPhone: string,
  rawNote: string,
  allClients: any[] = [],
  at: string = new Date().toISOString()
): AddExtraPhoneResult => {
  const phone = phoneDigitsOf(rawPhone);
  if (phone.length < MIN_PHONE_DIGITS) return { ok: false, error: 'اكتب رقم صحيح' };
  const own = [client?.phone, ...(Array.isArray(client?.phones) ? client.phones : [])].map(phoneDigitsOf);
  if (own.includes(phone)) return { ok: false, error: 'الرقم ده مسجّل على العميل بالفعل' };
  const owner = (allClients || []).find(
    (c: any) =>
      String(c?.id) !== String(client?.id) &&
      [c?.phone, ...(Array.isArray(c?.phones) ? c.phones : [])].some((p: any) => phoneDigitsOf(p) === phone)
  );
  if (owner) return { ok: false, error: `الرقم ده مسجّل على عميل تاني (${owner.name || 'بدون اسم'})` };
  const note = String(rawNote || '').trim();
  const notes = { ...(client?.phoneNotes && typeof client.phoneNotes === 'object' ? client.phoneNotes : {}) };
  if (note) notes[phone] = note;
  return {
    ok: true,
    client: {
      ...client,
      phones: [...(Array.isArray(client?.phones) ? client.phones : []), phone],
      phoneNotes: notes,
      updatedAt: at,
    },
  };
};

// شيل رقم إضافي (وملحوظته معاه)
export const removeExtraPhone = (client: any, rawPhone: string, at: string = new Date().toISOString()): any => {
  const phone = phoneDigitsOf(rawPhone);
  const notes = { ...(client?.phoneNotes && typeof client.phoneNotes === 'object' ? client.phoneNotes : {}) };
  delete notes[phone];
  return {
    ...client,
    phones: (Array.isArray(client?.phones) ? client.phones : []).filter((p: any) => phoneDigitsOf(p) !== phone),
    phoneNotes: notes,
    updatedAt: at,
  };
};
