// ===== التوزيع التلقائي للأرقام على مندوبين مختارين =====
// الإدارة تختار فورماً بعينه + قائمة مندوبين، فأرقام هذا الفورم — الموجودة والجديدة —
// تتوزّع عليهم هم وحدهم بالدور، وأي مندوب خارج القائمة لا يصله منها شيء.
//
// الملف نقي (بلا شبكة ولا واجهة) ويعمل في مكانين بنفس الكود:
//   • المتصفح (src/App.tsx) — يطبّق القاعدة على الأرقام بعد المزامنة.
//   • السيرفر (server/leadSource.js) — يطبّقها لحظة سحب رقم جديد، فيعمل ٢٤/٧ بلا متصفح.
// نفس الملف محمول هنا حتى لا تختلف نتيجة المكانين أبداً.

import { isDeveloperAccount } from './roles.js';

// مفتاح المزامنة: قواعد التوزيع تسافر بين الأجهزة مثل أي بيانات أخرى
export const AUTO_ASSIGN_KEY = 'crm_lead_auto_assign';

const asList = (value) => (Array.isArray(value) ? value : []);
const cleanIds = (value) =>
  [...new Set(asList(value).map((id) => String(id || '').trim()).filter(Boolean))];

export const formNameOfLead = (lead) => String(lead?.formName || '').trim();

// مفتاح الرقم: أرقام فقط (مع توحيد الأرقام العربية والإنجليزية) —
// نفس المنطق في الواجهة (normalizeDigits) والسيرفر، فيتطابق الرقم في المكانين.
export const phoneKeyOf = (value) =>
  String(value ?? '')
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[\u06f0-\u06f9]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/\D/g, '');

const shortPhoneKey = (value) => {
  const digits = phoneKeyOf(value);
  return digits.length >= 10 ? digits.slice(-10) : digits;
};

// فهرس الفورمات المتكررة لكل رقم (من crm_lead_repeats أو خريطة التكرارات)
const repeatFormsByPhone = (repeats) => {
  const map = new Map();
  if (!repeats) return map;
  const items =
    typeof repeats.values === 'function' && !Array.isArray(repeats)
      ? [...repeats.values()].flat()
      : asList(repeats);
  for (const entry of items) {
    const k = shortPhoneKey(entry?.phone);
    const f = String(entry?.formName || '').trim();
    if (!k || !f) continue;
    let set = map.get(k);
    if (!set) {
      set = new Set();
      map.set(k, set);
    }
    set.add(f);
  }
  return map;
};

const leadMatchesForm = (lead, target, nameOf, repMap) => {
  if (!target) return true;
  if (String(nameOf(lead) || '').trim() === target) return true;
  if (repMap && repMap.size) {
    const phones = [lead?.phone, ...(Array.isArray(lead?.phones) ? lead.phones : [])];
    for (const p of phones) {
      const k = shortPhoneKey(p);
      if (k && repMap.get(k)?.has(target)) return true;
    }
  }
  return false;
};

// من يستقبل أرقاماً؟
//   • سيلز أو قائد فريق (وظيفته الأصلية)
//   • أو حساب إداري اختار صراحةً أن يستقبل أرقاماً (receivesLeads).
// حساب «المطوّر» (إداري في القاعدة، سيلز في الشغل) حساب عادي هنا: كان مستبعداً
// من قائمة التوزيع ومن التوزيع التلقائي مع إنه يعمل سيلزاً، فيقدر يستقبل أرقاماً
// بنفس شرط أي حساب إداري — اختياره صريحاً في قاعدة الفورم أو في توزيع الأرقام.
// غياب isActive يُعتبر نشاطاً: نفس قاعدة السيرفر وباقي القوائم، فلا يختفي حساب
// قديم لم يُكتب له الحقل أصلاً.
// هذا الملف مشترك بين الواجهة والسيرفر، فيبقى حكم «من يستقبل رقماً» واحداً في المكانين.
export const isAssignableSales = (user) =>
  !!user &&
  user.isActive !== false &&
  (user.role === 'sales' ||
    user.role === 'supervisor' ||
    isDeveloperAccount(user) ||
    user.receivesLeads === true);

// سجل القاعدة: معرّفه هو اسم الفورم نفسه، فيبقى للفورم الواحد سجل واحد فقط
export function normalizeRule(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const formName = String(raw.formName || raw.id || '').trim();
  if (!formName) return null;
  return {
    id: String(raw.id || formName),
    formName,
    salesIds: cleanIds(raw.salesIds),
    // «كل السيلز»: الأرقام تتوزع على كل من يستقبل أرقاماً بالدور (حتى الحسابات
    // الجديدة)، بدل قائمة أسماء ثابتة لازم تتعدل مع كل حساب جديد.
    allSales: raw.allSales === true,
    // غياب الحقل يعني «مفعّلة» حتى لا يتوقف توزيع قديم صامتاً
    active: raw.active !== false,
    updatedAt: String(raw.updatedAt || raw.createdAt || ''),
  };
}

export function parseRules(raw) {
  let list = raw;
  if (typeof raw === 'string') {
    try {
      list = JSON.parse(raw || '[]');
    } catch {
      return [];
    }
  }
  return asList(list)
    .map(normalizeRule)
    .filter(Boolean);
}

export const activeRuleFor = (rules, formName) => {
  const target = String(formName || '').trim();
  if (!target) return null;
  return asList(rules).find((rule) => rule && rule.active !== false && String(rule.formName || '') === target) || null;
};

// إضافة/تعديل قاعدة فورم واحد — القاعدة القديمة لنفس الفورم تُستبدل لا تتكرر
export function upsertRule(rules, patch, at = new Date().toISOString()) {
  const formName = String(patch?.formName || '').trim();
  if (!formName) return asList(rules);
  const next = {
    id: formName,
    formName,
    salesIds: cleanIds(patch.salesIds),
    allSales: patch.allSales === true,
    active: patch.active !== false,
    updatedAt: at,
  };
  return [next, ...asList(rules).filter((rule) => rule && String(rule.formName || rule.id) !== formName)];
}

// خيارات التوزيع:
//   onlyUnassigned = true  => لا نلمس رقماً في عهدة أحد (توزيع آمن)
//   excludePhones          => أرقام عند أحد بالفعل (مسجّلة كعميل): ما تتوزّع تاني،
//                            عشان الرقم الواحد ما يبقاش عند أكتر من شخص.
// ===== التوزيع بالدور =====
// التوزيع التلقائي بيمشي بالدور على السيلز بترتيبهم: كل واحد رقم لحد ما الأرقام تخلص،
// والرقم الجاي بيكمّل من بعد آخر واحد خد رقم من الفورم دي. مش لازم الكل يبقى متساوي:
// سيلز جديد بيدخل الدور معاهم من غير ما ياخد أرقام زيادة يلحق بيها الباقيين.
// مكان الدور مش محفوظ لوحده — بيتحسب من البيانات نفسها: آخر رقم اتوزّع تلقائي في
// الفورم (autoTurnKey) ومع مين، فالسيرفر وكل الأجهزة بيكمّلوا من نفس المكان.
export const turnKeyOf = (lead) =>
  String(lead?.autoTurnKey || `${String(lead?.assignedAt || lead?.createdAt || '')}#`);
const turnKeyAt = (at, index) => `${at}#${String(index).padStart(5, '0')}`;

export function lastTurnOwner({ loadLeads = [], salesIds = [], formName = '', formOf } = {}) {
  const order = cleanIds(salesIds);
  const nameOf = typeof formOf === 'function' ? formOf : formNameOfLead;
  const target = String(formName || '').trim();
  let last = '';
  let lastKey = '';
  for (const lead of asList(loadLeads)) {
    if (!lead || lead.assignedVia === 'manual' || lead.status === 'closed') continue;
    const owner = String(lead.salesId || '');
    if (!owner || !order.includes(owner)) continue;
    if (target && String(nameOf(lead) || '').trim() !== target) continue;
    const key = turnKeyOf(lead);
    if (key > lastKey) {
      lastKey = key;
      last = owner;
    }
  }
  return last;
}

// كل التوزيع بالدور — مفيش وضع «بالتساوي» خلاص.
export function distributeLeads({ leads = [], loadLeads, salesIds = [], formName = '', formOf, onlyUnassigned = true, excludePhones = [], repeats = [], at = new Date().toISOString() }) {
  const eligible = cleanIds(salesIds);
  if (!eligible.length) return { assignments: [], loads: {} };
  // حمل كل مندوب يُحسب على **كل** أرقامه في النظام (loadLeads)، لا على دفعة
  // واحدة فقط: لما السيرفر يوزع رقمًا واحدًا في كل سحب وكان الحمل يُحسب من
  // الدفعة وحدها، كان الرقم يروح لنفس المندوب الأول دايمًا (٢٠ رقم مقابل ٤).
  const loadSource = asList(loadLeads === undefined ? leads : loadLeads);
  const nameOf = typeof formOf === 'function' ? formOf : formNameOfLead;

  const target = String(formName || '').trim();
  const excluded = new Set(
    asList(excludePhones)
      .flatMap((value) => [phoneKeyOf(value), shortPhoneKey(value)])
      .filter(Boolean)
  );
  const repMap = repeatFormsByPhone(repeats);

  // عدد أرقام كل مندوب (للتقرير بس — التوزيع نفسه بالدور مش بالعدد)
  const loads = new Map(eligible.map((id) => [id, 0]));
  for (const lead of loadSource) {
    const owner = String(lead?.salesId || '');
    if (lead?.status === 'closed') continue;
    if (loads.has(owner)) loads.set(owner, loads.get(owner) + 1);
  }

  const pending = asList(leads)
    .filter((lead) => {
      if (!lead) return false;
      // الرقم موجود عند حدّ سلفاً (عميل مسجّل) => ما يتوزّعش على حدّ تاني
      const phone = phoneKeyOf(lead.phone);
      const short = shortPhoneKey(lead.phone);
      if ((phone && excluded.has(phone)) || (short && excluded.has(short))) return false;
      const owner = String(lead.salesId || '');
      // رقم الإدارة سحبته بنفسها (يدوي) يفضل غير مخصص — التلقائي ما يرجّعهوش
      if (onlyUnassigned) return !owner && lead.assignedVia !== 'manual';
      // إعادة توزيع: نعيد أرقام المندوبين المؤهّلين حتى لو كانوا في عهدتهم،
      // ومش بنلمس رقم حدّ خارج القائمة.
      return !owner || loads.has(owner) || eligible.includes(owner);
    })
    .filter((lead) => leadMatchesForm(lead, target, nameOf, repMap))
    .sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')));

  const assignments = [];
  // بالدور دايماً (مفيش توزيع بالتساوي): من بعد آخر واحد خد رقم تلقائي من الفورم
  const last = lastTurnOwner({ loadLeads: loadSource, salesIds: eligible, formName: target, formOf: nameOf });
  let index = last ? (eligible.indexOf(last) + 1) % eligible.length : 0;
  pending.forEach((lead, i) => {
    const owner = eligible[index];
    index = (index + 1) % eligible.length;
    loads.set(owner, (loads.get(owner) || 0) + 1);
    assignments.push({ id: String(lead.id), salesId: owner, turnKey: turnKeyAt(at, i) });
  });
  return { assignments, loads: Object.fromEntries(loads) };
}

// تطبيق كل القواعد المفعّلة على قائمة الأرقام كاملة (ترجع نسخة جديدة)
//   activeSalesIds: الحسابات النشطة فعلاً — قاعدة تشير لحساب محذوف/موقوف لا تعمل
//   excludePhones: أرقام عند أحد بالفعل (عملاء مسجّلون) — ما تتوزّع تاني
export function applyAutoRules({ leads = [], loadLeads, rules = [], activeSalesIds = [], formOf, excludePhones = [], repeats = [], at = new Date().toISOString() } = {}) {
  const active = new Set(cleanIds(activeSalesIds));
  const list = asList(leads).map((lead) => ({ ...lead }));
  const loadSource = asList(loadLeads === undefined ? leads : loadLeads);
  const assignments = [];
  const byRule = {};

  for (const rule of asList(rules)) {
    if (!rule || rule.active === false) continue;
    // «كل السيلز» = كل من يستقبل أرقامًا الآن (وتلقائيًا أي حساب جديد بعد كده)،
    // وإلا فالمختارون في القاعدة فقط.
    // الترتيب = ترتيب الحسابات (نفسه في السيرفر وكل الأجهزة)، فالدور واحد في كل مكان
    const chosen = new Set(cleanIds(rule.salesIds));
    const salesIds = rule.allSales ? [...active] : [...active].filter((id) => chosen.has(id));
    if (!salesIds.length) continue;
    const formName = String(rule.formName || rule.id || '').trim();
    if (!formName) continue;
    const result = distributeLeads({ leads: list, loadLeads: loadSource, salesIds, formName, formOf, onlyUnassigned: true, excludePhones, repeats, at });
    if (!result.assignments.length) continue;
    const byId = new Map(result.assignments.map((item) => [item.id, item]));
    for (const lead of list) {
      const item = byId.get(String(lead.id));
      if (!item) continue;
      lead.salesId = item.salesId;
      lead.autoTurnKey = item.turnKey;
    }
    assignments.push(...result.assignments);
    byRule[formName] = (byRule[formName] || 0) + result.assignments.length;
  }

  return { leads: list, assignments, byRule };
}
