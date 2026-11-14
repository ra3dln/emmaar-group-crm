// ===== كلام العميل في فورم الكامبين =====
// العميل وهو بيسجّل في فورم فيسبوك بيجاوب على أسئلة (الوحدة المناسبة، الموعد المناسب،
// الوظيفة، رقم واتساب…). السحب كان بياخد الاسم والرقم بس ويرمي الباقي — هنا بنحفظ
// الإجابات في قائمة لوحدها (crm_lead_answers) مربوطة بالرقم، والسيلز يشوفها من زرار
// العين على كارت العميل. القائمة منفصلة عن سجل العميل: كده مفيش جهاز قديم يمسحها
// وهو بيرفع نسخته، ومفيش حاجة في العميل نفسه بتتغيّر.
// الملف مشترك بين السيرفر (السحب) والمتصفح (العرض).

import { repeatPhoneKey } from './leadRepeats.js';

export const LEAD_ANSWERS_KEY = 'crm_lead_answers';

// كل اللي كتبه العميل بيتعرض (الاسم والرقم والواتساب وكل الأسئلة) — الحاجة الوحيدة
// اللي بتتشال لينك الإنبوكس، لأن فيسبوك هو اللي بيحطه مش العميل.
const SKIP_FIELDS = new Set(['inbox_url']);

// أسماء الحقول الجاهزة من فيسبوك بالعربي
const KNOWN_LABELS = {
  full_name: 'الاسم',
  name: 'الاسم',
  first_name: 'الاسم الأول',
  last_name: 'اسم العيلة',
  phone_number: 'رقم الموبايل',
  job_title: 'الوظيفة',
  'job title': 'الوظيفة',
  email: 'الإيميل',
  work_phone_number: 'رقم تاني',
  phone: 'رقم تاني',
  city: 'المدينة',
  company_name: 'الشركة',
};

const cleanText = (value) =>
  String(value ?? '')
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

// السؤال: «:_الموعد_المناسب_للتواصل» ← «الموعد المناسب للتواصل»
export const questionLabel = (name) => {
  const raw = String(name || '').trim();
  if (KNOWN_LABELS[raw.toLowerCase()]) return KNOWN_LABELS[raw.toLowerCase()];
  return cleanText(raw).replace(/^[:\s-]+|[:\s-]+$/g, '').trim();
};

// الإجابة: «عدد_3_غرف» ← «عدد 3 غرف»، والتاريخ ISO ← «2026-10-25 15:00»
export const answerText = (values) => {
  const list = Array.isArray(values) ? values : [values];
  return list
    .map((value) => {
      const text = String(value ?? '').trim();
      const iso = text.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/);
      if (iso) return `${iso[1]} ${iso[2]}`;
      return cleanText(text);
    })
    .filter(Boolean)
    .join(' / ');
};

// كل إجابات ليد واحد من field_data — بنفس ترتيب الفورم
export function answersFromFields(fieldData = []) {
  const out = [];
  for (const field of Array.isArray(fieldData) ? fieldData : []) {
    const name = String(field?.name || '').trim();
    if (!name || SKIP_FIELDS.has(name.toLowerCase())) continue;
    const a = answerText(field?.values);
    if (!a) continue;
    out.push({ q: questionLabel(name), a });
  }
  return out;
}

const hash = (text) => {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
};

// تسجيلات جديدة من السحب: كل ليد عنده إجابات = سجل واحد (معرّف ثابت، فما بيتكررش)
export function buildAnswerEntries({ rows = [], existing = [], at = new Date().toISOString() } = {}) {
  const known = new Set((existing || []).map((item) => String(item?.id || '')));
  const out = [];
  for (const row of rows || []) {
    if (row?.test) continue;
    const answers = Array.isArray(row?.answers) ? row.answers.filter((x) => x && x.q && x.a) : [];
    if (!answers.length) continue;
    const key = repeatPhoneKey(row?.phone);
    if (!key) continue;
    const formName = String(row?.formName || '').trim();
    const when = String(row?.dateIso || row?.date || '');
    const id = `ans-${key}-${hash(`${formName}|${when}`)}`;
    if (known.has(id)) continue;
    known.add(id);
    out.push({ id, phone: String(row.phone || ''), formName, campaignAt: when, answers, createdAt: at });
  }
  return out;
}

// الإجابات لكل رقم — الأحدث الأول
export function answersByPhone(list = []) {
  const map = new Map();
  for (const item of list || []) {
    const key = repeatPhoneKey(item?.phone);
    if (!key) continue;
    const arr = map.get(key) || [];
    arr.push(item);
    map.set(key, arr);
  }
  for (const arr of map.values()) {
    arr.sort((a, b) => String(b?.campaignAt || '').localeCompare(String(a?.campaignAt || '')));
  }
  return map;
}
