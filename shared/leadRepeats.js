// ===== الأرقام المتكررة من الكامبين =====
// رقم بيتسحب من فورم وهو موجود أصلاً (رقم في التوزيع أو عميل) ما بيتضافش تاني —
// بس لازم يبان إنه اتكرر وفي أنهي فورم. التكرار بيتسجّل في قائمة لوحده
// (crm_lead_repeats) ومش على سجل الرقم نفسه: كده السيلز اللي معاه الرقم ما
// بيتغيّرش، ولا جهاز قديم يقدر يمسح التكرار وهو بيرفع نسخته من العميل.
// الملف مشترك بين السيرفر (السحب) والمتصفح (اللافتة على الكارت).

export const LEAD_REPEATS_KEY = 'crm_lead_repeats';

// مفتاح الرقم: آخر ١٠ أرقام (01xxxxxxxxx و +201xxxxxxxxx = نفس الرقم)
export const repeatPhoneKey = (value) => {
  const digits = String(value ?? '')
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/\D/g, '');
  return digits.length >= 10 ? digits.slice(-10) : digits;
};

const formOfRow = (row) => String(row?.formName || row?.source || '').trim();
const formOfRecord = (record) => String(record?.formName || '').trim();

// معرّف ثابت للتكرار الواحد: نفس الرقم + نفس الفورم + نفس وقت التسجيل = نفس التكرار
// (إعادة السحب من البداية ما بتكررش التكرار)
const hash = (text) => {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
};
export const repeatIdOf = (phoneKey, formName, when) => `rep-${phoneKey}-${hash(`${formName}|${when}`)}`;

// ===== تسجيلات جديدة متكررة =====
//   rows     : الأرقام اللي اتسحبت ولقيناها موجودة (من buildAssignments.duplicateRows)
//   records  : كل الأرقام والعملاء الموجودين (عشان نعرف التسجيل الأصلي)
//   existing : التكرارات المحفوظة قبل كده
export function buildRepeats({ rows = [], records = [], existing = [], at = new Date().toISOString() }) {
  const byPhone = new Map();
  for (const record of records || []) {
    for (const phone of [record?.phone, ...(Array.isArray(record?.phones) ? record.phones : [])]) {
      const key = repeatPhoneKey(phone);
      if (!key) continue;
      const list = byPhone.get(key) || [];
      list.push(record);
      byPhone.set(key, list);
    }
  }
  const known = new Set((existing || []).map((item) => String(item?.id || '')));
  const out = [];
  for (const row of rows || []) {
    const key = repeatPhoneKey(row?.phone);
    if (!key) continue;
    const originals = byPhone.get(key) || [];
    if (!originals.length) continue;
    const formName = formOfRow(row);
    const when = String(row?.dateIso || row?.date || '');
    // نفس التسجيل الأصلي اتقرا تاني (إعادة سحب) — مش تكرار
    const sameAsOriginal = originals.some(
      (orig) =>
        formOfRecord(orig) === formName &&
        (!orig?.campaignAt || !when || String(orig.campaignAt) === when)
    );
    if (sameAsOriginal) continue;
    const id = repeatIdOf(key, formName, when);
    if (known.has(id)) continue;
    known.add(id);
    out.push({
      id,
      phone: String(row?.phone || ''),
      name: String(row?.name || '').slice(0, 80),
      formName,
      campaignAt: when,
      createdAt: at,
    });
  }
  return out;
}

// التكرارات لكل رقم — الأحدث الأول
export function repeatsByPhone(list = []) {
  const map = new Map();
  for (const item of list || []) {
    const key = repeatPhoneKey(item?.phone);
    if (!key) continue;
    const arr = map.get(key) || [];
    arr.push(item);
    map.set(key, arr);
  }
  for (const arr of map.values()) {
    arr.sort((a, b) => String(b?.campaignAt || b?.createdAt || '').localeCompare(String(a?.campaignAt || a?.createdAt || '')));
  }
  return map;
}

// نص اللافتة: «متكرر في فورم X» (ولو أكتر من فورم: «متكرر ٣ مرات: X، Y»)
export function repeatLabel(entries = []) {
  if (!entries || !entries.length) return '';
  const forms = [...new Set(entries.map((e) => String(e?.formName || '').trim() || 'فورم غير معروف'))];
  if (entries.length === 1) return `متكرر في فورم ${forms[0]}`;
  return `متكرر ${entries.length} مرات: ${forms.join('، ')}`;
}
