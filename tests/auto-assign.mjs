// ===== اختبار التوزيع التلقائي (فورم ← مندوبون بعينهم) =====
// يتحقق من:
//  ١) القاعدة: الأرقام تتوزع على المختارين وحدهم، وغيرهم لا يصله ولا رقم.
//  ٢) التساوي: الفرق بين أي مندوبين لا يزيد عن رقم واحد، والموجود لا يُسحب من أحد.
//  ٣) عزل الفورمات: قاعدة فورم لا تلمس أرقام فورم آخر.
//  ٤) التكامل مع السيرفر: أرقام السحب الجديدة تخرج من buildAssignments موزّعة بالقاعدة.
//  ٥) الربط: المفتاح مزامَن، والواجهة والسيرفر يستخدمون نفس المنطق.
//
// التشغيل: node tests/auto-assign.mjs

import fs from 'node:fs';
import assert from 'node:assert/strict';
import {
  AUTO_ASSIGN_KEY,
  activeRuleFor,
  applyAutoRules,
  distributeLeads,
  isAssignableSales,
  parseRules,
  phoneKeyOf,
  upsertRule,
} from '../shared/autoAssign.js';
import { buildAssignments } from '../server/leadSource.js';

let passed = 0;
const check = (label, condition, extra = '') => {
  assert.ok(condition, `✗ ${label} ${extra}`);
  passed += 1;
  console.log(`✓ ${label}`);
};

const FORM = 'فورم أكتوبر';
const OTHER_FORM = 'فورم فيلات';
const mohamed = 'u-mohamed';
const ahmed = 'u-ahmed';
const saif = 'u-saif';
const abdo = 'u-abdo';
const allSales = [mohamed, ahmed, saif, abdo];

const lead = (id, extra = {}) => ({
  id,
  name: `عميل ${id}`,
  phone: `0100000${id.padStart(4, '0')}`,
  salesId: '',
  status: 'new',
  formName: FORM,
  createdAt: '2026-10-20T10:00:00.000Z',
  ...extra,
});

// ===== ١) القاعدة =====
const rules = upsertRule([], { formName: FORM, salesIds: [mohamed, ahmed] }, '2026-10-22T08:00:00.000Z');
check('قاعدة واحدة للفورم', rules.length === 1 && rules[0].id === FORM && rules[0].active === true);
check(
  'اختيار السيلز محفوظ كما هو',
  rules[0].salesIds.length === 2 && rules[0].salesIds.includes(mohamed) && rules[0].salesIds.includes(ahmed)
);
check('الرموز المكررة تُنظَّف', upsertRule([], { formName: FORM, salesIds: [mohamed, mohamed, ''] })[0].salesIds.length === 1);
check(
  'تعديل نفس الفورم يحدّث نفس السجل بدل تكراره',
  upsertRule(rules, { formName: FORM, salesIds: [ahmed] }).length === 1 &&
    upsertRule(rules, { formName: FORM, salesIds: [ahmed] })[0].salesIds[0] === ahmed
);
check('فورم آخر له سجل مستقل', upsertRule(rules, { formName: OTHER_FORM, salesIds: [saif] }).length === 2);
check('قراءة القواعد من نص المزامنة', parseRules(JSON.stringify(rules)).length === 1);
check('نص تالف لا يكسر التطبيق', parseRules('{ليس JSON').length === 0 && parseRules(null).length === 0);
check('القاعدة المفعّلة تُوجد باسم الفورم', activeRuleFor(rules, FORM)?.id === FORM);
check('قاعدة موقوفة لا تُعتبر مفعّلة', activeRuleFor(upsertRule([], { formName: FORM, salesIds: [mohamed], active: false }), FORM) === null);

// ===== ٢) التوزيع على المختارين وحدهم =====
const snapshot = [
  lead('1'),
  lead('2'),
  lead('3'),
  lead('4'),
  lead('5'),
  lead('6', { formName: OTHER_FORM }),
  // رقم في عهدة سيف (غير مختار) — يجب أن يبقى عنده ولا يُسحب
  lead('7', { salesId: saif }),
];
const result = applyAutoRules({ leads: snapshot, rules, activeSalesIds: allSales });
const assigned = result.assignments;
const ownerOf = new Map(result.leads.map((l) => [l.id, l.salesId]));

check('كل أرقام الفورم غير المخصصة توزّعت', assigned.length === 5, `توزّع ${assigned.length}`);
check(
  'سيف وعبدو لم يصلهما ولا رقم',
  assigned.every((item) => item.salesId === mohamed || item.salesId === ahmed) &&
    result.leads.every((l) => l.salesId !== saif || l.id === '7') &&
    result.leads.every((l) => l.salesId !== abdo)
);
check('الرقم الموجود عند سيف لم يُسحب منه', ownerOf.get('7') === saif);
check('فورم آخر لم يُمسّ', ownerOf.get('6') === '');
check('كل رقم أخذ مندوباً واحداً فقط', assigned.length === new Set(assigned.map((a) => a.id)).size);

const countOf = (id) => result.leads.filter((l) => l.salesId === id).length;
check('التوزيع متساوٍ (فرق رقم واحد كأقصى حد)', Math.abs(countOf(mohamed) - countOf(ahmed)) <= 1, `${countOf(mohamed)} / ${countOf(ahmed)}`);
check(
  'الحمل السابق على المندوب محسوب في الموازنة',
  (() => {
    // محمد عنده ٥ أرقام قديمة، أحمد بلا شيء → الأرقام الجديدة تميل لأحمد
    const loaded = [1, 2, 3, 4, 5].map((n) => lead(`9${n}`, { salesId: mohamed, formName: OTHER_FORM }));
    const res = distributeLeads({ leads: [...loaded, lead('31'), lead('32')], salesIds: [mohamed, ahmed], formName: FORM });
    return res.assignments.every((item) => item.salesId === ahmed);
  })()
);
check('من ليس عنده أرقام غير مخصصة لا شيء يتغير', applyAutoRules({ leads: [lead('1', { salesId: ahmed })], rules, activeSalesIds: allSales }).assignments.length === 0);
check('قاعدة موقوفة لا توزّع شيئاً', applyAutoRules({ leads: [lead('1')], rules: upsertRule([], { formName: FORM, salesIds: [mohamed], active: false }), activeSalesIds: allSales }).assignments.length === 0);
check(
  'حساب موقوف لا يستلم (القاعدة تُقلَّص للنشطين)',
  (() => {
    const res = applyAutoRules({ leads: [lead('1')], rules, activeSalesIds: [mohamed] });
    return res.assignments.length === 1 && res.assignments[0].salesId === mohamed;
  })()
);
check(
  'لو كل مختاري الفورم موقوفين لا يتوزع رقم على أحد',
  applyAutoRules({ leads: [lead('1')], rules, activeSalesIds: [saif, abdo] }).assignments.length === 0
);

// ===== ٣) من يستقبل الأرقام تلقائياً (حساب المطوّر ليس منهم) =====
check('السيلز يستقبل أرقاماً', isAssignableSales({ role: 'sales', isActive: true }));
check('قائد الفريق يستقبل أرقاماً', isAssignableSales({ role: 'supervisor', isActive: true }));
check('الإداري الذي اختار «يعمل سيلزاً» يستقبل', isAssignableSales({ role: 'admin', receivesLeads: true, isActive: true }));
check('الإداري العادي ما يستقبلش', isAssignableSales({ role: 'admin', isActive: true }) === false);
check(
  'حساب المطوّر ما يستقبلش أرقاماً تلقائية (رقمه بتكليف صريح فقط)',
  isAssignableSales({ role: 'admin', developer: true, isActive: true }) === false &&
    isAssignableSales({ role: 'sales', developer: true, isActive: true }) === false
);
check('الحساب الموقوف ما يستقبلش', isAssignableSales({ role: 'sales', isActive: false }) === false);
check(
  'قاعدة تشير لحساب المطوّر تُهمَل عند التوزيع (الواجهة والسيرفر يستبعدانه)',
  (() => {
    // المتصلون (الواجهة والسيرفر) يحسبون «النشطين» بنفس دالة isAssignableSales
    const team = [
      { id: 'u-dev', role: 'admin', developer: true, isActive: true },
      { id: ahmed, role: 'sales', isActive: true },
    ];
    const activeIds = team.filter(isAssignableSales).map((u) => u.id);
    const res = applyAutoRules({
      leads: [lead('1')],
      rules: upsertRule([], { formName: FORM, salesIds: ['u-dev'] }),
      activeSalesIds: activeIds,
    });
    return res.assignments.length === 0 && res.leads[0].salesId === '';
  })()
);

// ===== ٤) رقم واحد ما يبقاش عند أكتر من شخص =====
// رقم مسجّل كعميل عند مندوب ⇒ ما يتوزّعش على حدّ تاني (وإلا بقى الرقم عند اتنين)
const held = applyAutoRules({
  leads: [lead('1'), lead('2'), lead('3')],
  rules,
  activeSalesIds: allSales,
  excludePhones: ['01000000001'],
});
check(
  'الرقم المسجّل كعميل لا يتوزّع',
  held.assignments.length === 2 && held.assignments.every((item) => item.id !== '1'),
  `توزّع ${held.assignments.length}`
);
check('الرقم المحجوز ما بقى في عهدة حد', held.leads.find((l) => l.id === '1').salesId === '');
const direct = distributeLeads({
  leads: [lead('1'), lead('2')],
  salesIds: [mohamed, ahmed],
  formName: FORM,
  excludePhones: ['01000000001'],
});
check('التوزيع المباشر كمان بيحترم الرقم المحجوز', direct.assignments.length === 1 && direct.assignments[0].id === '2');
check('مفتاح الرقم موحّد (أرقام عربية أو إنجليزية)', phoneKeyOf('٠١٠٠٠٠٠٠٠٠١') === '01000000001');

// ===== ٥) عزل الفورمات =====
const twoRules = upsertRule(upsertRule([], { formName: FORM, salesIds: [mohamed] }), {
  formName: OTHER_FORM,
  salesIds: [saif],
});const mixed = applyAutoRules({
  leads: [lead('1'), lead('2', { formName: OTHER_FORM }), lead('3', { formName: 'فورم تالت' })],
  rules: twoRules,
  activeSalesIds: allSales,
});
const mixedOwner = new Map(mixed.leads.map((l) => [l.id, l.salesId]));
check('قاعدة كل فورم تعمل على أرقامها', mixedOwner.get('1') === mohamed && mixedOwner.get('2') === saif);
check('فورم بلا قاعدة يبقى غير مخصص', mixedOwner.get('3') === '');
check('تقرير التوزيع لكل فورم', mixed.byRule[FORM] === 1 && mixed.byRule[OTHER_FORM] === 1);

// ===== ٦) التكامل مع السيرفر: أرقام السحب الجديدة =====
const fetched = [
  { phone: '01011112222', name: 'أحمد من فيسبوك', formName: FORM, source: 'فيسبوك' },
  { phone: '01011113333', name: 'منى من فيسبوك', formName: FORM, source: 'فيسبوك' },
  { phone: '01011114444', name: 'سارة من فيسبوك', formName: OTHER_FORM, source: 'فيسبوك' },
];
const built = buildAssignments({ fetched, knownPhones: [], at: '2026-10-22T09:00:00.000Z' });
check('الأرقام الجديدة تدخل غير مخصصة من المحرك', built.added.every((l) => l.salesId === ''));
check('اسم الفورم محفوظ على كل رقم جديد', built.added.every((l) => l.formName));
const serverApplied = applyAutoRules({
  leads: built.added,
  rules,
  activeSalesIds: allSales,
  formOf: (l) => String(l.formName || ''),
});
check(
  'قاعدة السيرفر توزّع أرقام الفورم على المختارين فقط',
  serverApplied.assignments.length === 2 &&
    serverApplied.assignments.every((item) => [mohamed, ahmed].includes(item.salesId))
);
check(
  'أرقام الفورم التاني لا تتأثر بالقاعدة',
  serverApplied.leads.find((l) => l.formName === OTHER_FORM)?.salesId === ''
);

// ===== ٧) الربط بين الواجهة والسيرفر والمزامنة =====
const app = fs.readFileSync('src/App.tsx', 'utf8');
const sync = fs.readFileSync('src/sync.ts', 'utf8');
const server = fs.readFileSync('server/leadSource.js', 'utf8');
check('مفتاح قواعد التوزيع مزامَن بين الأجهزة', sync.includes(AUTO_ASSIGN_KEY));
check('الواجهة تطبّق نفس منطق التوزيع', app.includes('applyAutoRules') && app.includes('distributeLeads'));
check('الواجهة تحفظ القاعدة للسيرفر بانتظار نتيجة الرفع', app.includes('void pushKey(AUTO_ASSIGN_KEY)'));
check('لوحة التوزيع التلقائي موجودة في «توزيع الأرقام»', app.includes('التوزيع التلقائي') && app.includes('onSaveAutoRule'));
check('قائمة مسندلة لإضافة السيلز', app.includes('id="auto-sales-select"'));
check('اللوحة تعرض اختيار الفورم بدل نص فقط', app.includes('id="auto-form-select"') && app.includes('جديد'));
check('اختيار السيلز بأزرار قابلة للتحديد والمسح', app.includes('aria-pressed={on}') && app.includes('toggleAuto(u.id)'));
check('القاعدة تُطبَّق على أي رقم جديد يصل', app.includes('applyAutoRules({') && app.includes('!lead.salesId'));
check('السيرفر يوزّع لحظة السحب (بلا متصفح مفتوح)', server.includes('applyAutoRules') && server.includes('AUTO_ASSIGN_KEY'));
check('ملخص السحب يبيّن عدد الموزَّع تلقائياً', server.includes('autoAssigned') && server.includes('autoByForm'));
// ===== ٨) الشاشات: التوزيع ما يعيدش رقم حدّ ماسكه، والمخزون الكامل للإدارة =====
check(
  'الواجهة تستثني أرقام العملاء المسجّلين من التوزيع',
  app.includes('excludePhones: phonesOfClients(fullClients)')
);
check(
  'لوحات أرقام الكامبين على المخزون الكامل (الإدارة) واللوحة الشخصية بنطاق الحساب',
  app.includes('const [fullLeads, setFullLeads]') &&
    app.includes('const [fullClients, setFullClients]') &&
    app.includes('assignedLeads={fullLeads}') &&
    app.includes('clients={fullClients}')
);
check(
  'الحساب غير المؤهّل ما يبقىش في قائمة مختاري التوزيع',
  app.includes('users.filter(isAssignableSales)') && app.includes('assignableIds.has(id)')
);
check(
  'الرقم المحوَّل لعميل يخرج من الشغل المعلّق',
  app.includes("status: 'closed' as const")
);
// ===== ٩) رقم واحد = مالك واحد =====
check(
  'لوحة الحالات ما بتعرضش رقم عميل حدّ تاني (ولا بيقع في follow up لوحده)',
  app.includes('const otherClientPhones =') &&
    app.includes('otherClientPhones.has(phoneKeyOf(l.phone))') &&
    sync.includes('clientPhonesOnServer')
);
check(
  'الرقم المسجّل عند غيرك ما يتحوّلش لعميل عندك (ولا لو موزّع عنده)',
  app.includes('ownerOfPhoneOnServer(phoneKey)') &&
    app.includes('leadOwnerOfPhoneOnServer(phoneKey)') &&
    sync.includes('export const ownerOfPhoneOnServer') &&
    sync.includes('export const leadOwnerOfPhoneOnServer')
);
check(
  'الأرقام المحوَّلة لعميل بتخرج من «توزيع الأرقام» (مش معروضة «غير مخصص»)',
  app.includes('const openLeads =') && app.includes("lead.status !== 'closed'")
);
check(
  'نسخة السيرفر بتتفضّح للجرد بس (مالهاش غيرنا في ذاكرة الحساب)',
  sync.includes('lastServerData = null') && sync.includes('lastServerData = store.data')
);

console.log(`\n✅ نجحت ${passed} فحوصات للتوزيع التلقائي`);
