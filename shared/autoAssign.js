// ===== التوزيع التلقائي للأرقام على مندوبين مختارين =====
// الإدارة تختار فورماً بعينه + قائمة مندوبين، فأرقام هذا الفورم — الموجودة والجديدة —
// تتوزّع عليهم هم وحدهم بالتساوي، وأي مندوب خارج القائمة لا يصله منها شيء.
//
// الملف نقي (بلا شبكة ولا واجهة) ويعمل في مكانين بنفس الكود:
//   • المتصفح (src/App.tsx) — يطبّق القاعدة على الأرقام بعد المزامنة.
//   • السيرفر (server/leadSource.js) — يطبّقها لحظة سحب رقم جديد، فيعمل ٢٤/٧ بلا متصفح.
// نفس الملف محمول هنا حتى لا تختلف نتيجة المكانين أبداً.

// مفتاح المزامنة: قواعد التوزيع تسافر بين الأجهزة مثل أي بيانات أخرى
export const AUTO_ASSIGN_KEY = 'crm_lead_auto_assign';

const asList = (value) => (Array.isArray(value) ? value : []);
const cleanIds = (value) =>
  [...new Set(asList(value).map((id) => String(id || '').trim()).filter(Boolean))];

export const formNameOfLead = (lead) => String(lead?.formName || '').trim();

// سجل القاعدة: معرّفه هو اسم الفورم نفسه، فيبقى للفورم الواحد سجل واحد فقط
export function normalizeRule(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const formName = String(raw.formName || raw.id || '').trim();
  if (!formName) return null;
  return {
    id: String(raw.id || formName),
    formName,
    salesIds: cleanIds(raw.salesIds),
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
    active: patch.active !== false,
    updatedAt: at,
  };
  return [next, ...asList(rules).filter((rule) => rule && String(rule.formName || rule.id) !== formName)];
}

// ===== التوزيع بالتساوي =====
// الموازنة على الحمل الحقيقي لكل مندوب (كل أرقامه في النظام، لا هذا الفورم فقط)،
// ثم الأقدم وصولاً أولاً. المندوبون المتساوون في الحمل يُخدَمون بالتناوب.
//   onlyUnassigned = true  => لا نلمس رقماً في عهدة أحد (توزيع آمن)
//   onlyUnassigned = false => كل أرقام الفورم تُعاد وتُقسم من جديد
export function distributeLeads({ leads = [], salesIds = [], formName = '', formOf, onlyUnassigned = true }) {
  const eligible = cleanIds(salesIds);
  if (!eligible.length) return { assignments: [], loads: {} };

  const nameOf = typeof formOf === 'function' ? formOf : formNameOfLead;
  const target = String(formName || '').trim();

  const loads = new Map(eligible.map((id) => [id, 0]));
  for (const lead of asList(leads)) {
    const owner = String(lead?.salesId || '');
    if (loads.has(owner)) loads.set(owner, loads.get(owner) + 1);
  }

  const pending = asList(leads)
    .filter((lead) => {
      if (!lead) return false;
      const owner = String(lead.salesId || '');
      if (onlyUnassigned) return !owner;
      return !owner || loads.has(owner);
    })
    .filter((lead) => !target || String(nameOf(lead) || '').trim() === target)
    .sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')));

  const assignments = [];
  let turn = 0;
  for (const lead of pending) {
    let best = Infinity;
    let pool = [];
    for (const id of eligible) {
      const load = loads.get(id) || 0;
      if (load < best) {
        best = load;
        pool = [id];
      } else if (load === best) {
        pool.push(id);
      }
    }
    const owner = pool[turn % pool.length];
    turn += 1;
    loads.set(owner, (loads.get(owner) || 0) + 1);
    assignments.push({ id: String(lead.id), salesId: owner });
  }

  return { assignments, loads: Object.fromEntries(loads) };
}

// تطبيق كل القواعد المفعّلة على قائمة الأرقام كاملة (ترجع نسخة جديدة)
//   activeSalesIds: الحسابات النشطة فعلاً — قاعدة تشير لحساب محذوف/موقوف لا تعمل
export function applyAutoRules({ leads = [], rules = [], activeSalesIds = [], formOf } = {}) {
  const active = new Set(cleanIds(activeSalesIds));
  const list = asList(leads).map((lead) => ({ ...lead }));
  const assignments = [];
  const byRule = {};

  for (const rule of asList(rules)) {
    if (!rule || rule.active === false) continue;
    const salesIds = cleanIds(rule.salesIds).filter((id) => active.has(id));
    if (!salesIds.length) continue;
    const formName = String(rule.formName || rule.id || '').trim();
    if (!formName) continue;
    const result = distributeLeads({ leads: list, salesIds, formName, formOf, onlyUnassigned: true });
    if (!result.assignments.length) continue;
    const ownerOf = new Map(result.assignments.map((item) => [item.id, item.salesId]));
    for (const lead of list) {
      const owner = ownerOf.get(String(lead.id));
      if (owner) lead.salesId = owner;
    }
    assignments.push(...result.assignments);
    byRule[formName] = (byRule[formName] || 0) + result.assignments.length;
  }

  return { leads: list, assignments, byRule };
}
