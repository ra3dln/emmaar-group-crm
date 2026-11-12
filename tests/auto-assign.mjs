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
  'التساوي في نفس الفورم الأول، والحمل الكلي بيفصل عند التعادل بس',
  (() => {
    // محمد عنده ٥ أرقام في فورم تاني، أحمد بلا شيء: أرقام الفورم ده تتقسم بالتساوي
    // بينهم، وأول رقم (التعادل) يروح لأحمد لأن حمله الكلي أقل.
    // (قبل كده أحمد كان بياخد الكل، فواحد يبقى معاه ١٣ من الفورم وغيره صفر.)
    const loaded = [1, 2, 3, 4, 5].map((n) => lead(`9${n}`, { salesId: mohamed, formName: OTHER_FORM }));
    const res = distributeLeads({ leads: [...loaded, lead('31'), lead('32')], salesIds: [mohamed, ahmed], formName: FORM });
    return res.assignments.length === 2 && res.assignments[0].salesId === ahmed && res.assignments[1].salesId === mohamed;
  })()
);
check(
  'سيلز معاه أرقام كتير من الفورم ما ياخدش منه تاني لحد ما الباقيين يحصّلوه',
  (() => {
    const has = [1, 2, 3, 4].map((n) => lead(`8${n}`, { salesId: mohamed }));
    const res = distributeLeads({ leads: [...has, lead('41'), lead('42'), lead('43')], salesIds: [mohamed, ahmed], formName: FORM });
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

// ===== ٣) من يستقبل الأرقام تلقائياً (حساب المطوّر منهم مثل أي سيلز) =====
check('السيلز يستقبل أرقاماً', isAssignableSales({ role: 'sales', isActive: true }));
check('قائد الفريق يستقبل أرقاماً', isAssignableSales({ role: 'supervisor', isActive: true }));
check('الإداري الذي اختار «يعمل سيلزاً» يستقبل', isAssignableSales({ role: 'admin', receivesLeads: true, isActive: true }));
check('الإداري العادي ما يستقبلش', isAssignableSales({ role: 'admin', isActive: true }) === false);
check(
  'حساب المطوّر يظهر في التوزيع ويستقبل أرقاماً زي أي مندوب',
  isAssignableSales({ role: 'admin', developer: true, isActive: true }) &&
    isAssignableSales({ username: 'mohamed', role: 'admin', receivesLeads: true, isActive: true })
);
check('الحساب الموقوف ما يستقبلش', isAssignableSales({ role: 'sales', isActive: false }) === false);
check(
  'قاعدة فورم تختار حساب المطوّر توزّع عليه فعلاً (الواجهة والسيرفر متطابقان)',
  (() => {
    // المتصلون (الواجهة والسيرفر) يحسبون «النشطين» بنفس دالة isAssignableSales
    const team = [
      { id: 'u-dev', username: 'mohamed', role: 'admin', developer: true, isActive: true },
      { id: ahmed, role: 'sales', isActive: true },
    ];
    const activeIds = team.filter(isAssignableSales).map((u) => u.id);
    const res = applyAutoRules({
      leads: [lead('1')],
      rules: upsertRule([], { formName: FORM, salesIds: ['u-dev'] }),
      activeSalesIds: activeIds,
    });
    return res.assignments.length === 1 && res.assignments[0].salesId === 'u-dev';
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
  // التحويل بقى تلقائي: الرقم في عهدة المندوب يصير عميله، فيخرج من قوائم
  // «الأرقام الجديدة» و«العملاء» كرقم موزَّع (يظهر مرة واحدة: كارت العميل).
  app.includes('!clientPhones.has(digitsOf(l.phone))') &&
    app.includes('!myClientPhones.has(phoneKeyOf(l.phone))')
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

// ===== ١٠) العدل الحقيقي: الحصص على كل أرقام كل مندوب، ومش من الدفعة وحدها =====
// العطل المُبلَّغ عنه: «ناس معاها ٢٠ رقم وناس ٤ وناس ٨» — لأن السيرفر كان يوزّع
// رقمًا واحدًا في كل سحب ويحسب الحمل من الدفعة (دائمًا صفر) فيروح لنفس المندوب الأول.
const imbalance = [
  ...Array.from({ length: 20 }, (_, i) => ({ id: `a${i}`, phone: `0100000${i}`, formName: FORM, salesId: ahmed })),
  ...Array.from({ length: 8 }, (_, i) => ({ id: `b${i}`, phone: `0110000${i}`, formName: FORM, salesId: saif })),
  ...Array.from({ length: 4 }, (_, i) => ({ id: `c${i}`, phone: `0120000${i}`, formName: FORM, salesId: abdo })),
];
const oneNew = [{ id: 'new-1', phone: '0155555555', formName: FORM }];
const fairOne = distributeLeads({
  leads: oneNew,
  loadLeads: [...imbalance, ...oneNew],
  salesIds: [ahmed, saif, abdo],
  formName: FORM,
});
check(
  'الرقم الجديد يروح لأقل مندوب حملًا (مش للمندوب الأول في القائمة)',
  fairOne.assignments[0]?.salesId === abdo,
  JSON.stringify(fairOne.assignments)
);

// سحب متتابع: كل رقم في دفعة لوحده — لازم يتوزع بالتساوي مش كله على واحد
let pool = [...imbalance];
const added = [];
for (let i = 0; i < 30; i += 1) {
  const single = [{ id: `seq-${i}`, phone: `01600000${i}0`, formName: FORM }];
  const res = distributeLeads({
    leads: single,
    loadLeads: [...pool, ...single],
    salesIds: [ahmed, saif, abdo],
    formName: FORM,
  });
  const owner = res.assignments[0]?.salesId;
  added.push(owner);
  pool = [...pool, { ...single[0], salesId: owner }];
}
const finalLoads = [ahmed, saif, abdo].map((id) => pool.filter((l) => l.salesId === id).length);
check(
  '٣٠ عملية سحب متتالية تنتهي بحمل متساوٍ (فرق رقم واحد كأقصى) بدل تكدّس على واحد',
  Math.max(...finalLoads) - Math.min(...finalLoads) <= 1,
  JSON.stringify(finalLoads)
);
check('مفيش رقم اتوزّع على مندوب خارج القائمة', added.every((id) => [ahmed, saif, abdo].includes(id)));

// ===== ١١) «كل السيلز»: القاعدة تشمل أي حساب مؤهّل (حتى الجديد) =====
const ruleAll = parseRules([{ formName: FORM, salesIds: [], allSales: true, active: true }])[0];
check('القاعدة بتتقري بخيار «كل السيلز»', ruleAll?.allSales === true);
const allRes = applyAutoRules({
  leads: [{ id: 'z1', phone: '0170000001', formName: FORM }, { id: 'z2', phone: '0170000002', formName: FORM }],
  rules: [ruleAll],
  activeSalesIds: [ahmed, saif, abdo, mohamed],
});
const owners = allRes.assignments.map((a) => a.salesId).sort();
check(
  '«كل السيلز» توزّع على المندوبين المؤهلين كلهم مش على قائمة مختارين',
  owners.length === 2 && owners.every((id) => [ahmed, saif, abdo, mohamed].includes(id)),
  JSON.stringify(owners)
);
check(
  'حفظ القاعدة يحتفظ بخيار «كل السيلز»',
  upsertRule([], { formName: FORM, salesIds: [], allSales: true }).some((r) => r.allSales === true)
);
check(
  'السيرفر بيحسب الحصص على كل الأرقام الحالية (loadLeads)',
  server.includes('loadLeads: [...assigned, ...built.added]')
);
check(
  'الواجهة بتحسب الحصص على كل أرقام السيلز (loadLeads)',
  app.includes('loadLeads: fullLeads') && app.includes('loadLeads: assignedLeads')
);
check(
  'اللوحة فيها خيار «كل السيلز (بالتساوي)»',
  app.includes('كل السيلز (بالتساوي)') && app.includes('setAutoAll')
);

// ===== ١٢) إعادة توزيع التكدّس القديم (٢٠ / ٨ / ٤) بالتساوي =====
const pile = [
  ...Array.from({ length: 20 }, (_, i) => ({ id: `pa${i}`, phone: `0108000${i}`, formName: FORM, salesId: ahmed })),
  ...Array.from({ length: 8 }, (_, i) => ({ id: `pb${i}`, phone: `0118000${i}`, formName: FORM, salesId: saif })),
  ...Array.from({ length: 4 }, (_, i) => ({ id: `pc${i}`, phone: `0128000${i}`, formName: FORM, salesId: abdo })),
  ...Array.from({ length: 6 }, (_, i) => ({ id: `pd${i}`, phone: `0138000${i}`, formName: OTHER_FORM, salesId: ahmed })),
];
const pilePending = pile.filter((l) => l.formName === FORM);
const pileIds = new Set(pilePending.map((l) => l.id));
const otherLoads = pile.filter((l) => !pileIds.has(l.id));
const rebalance = distributeLeads({
  leads: pilePending,
  loadLeads: otherLoads,
  salesIds: [ahmed, saif, abdo],
  formName: FORM,
  onlyUnassigned: false,
});
const afterRebalance = pile.map((l) => {
  const hit = rebalance.assignments.find((a) => a.id === l.id);
  return hit ? { ...l, salesId: hit.salesId } : l;
});
// التساوي في أرقام الفورم نفسه (٢٠ / ٨ / ٤ → ١١ / ١١ / ١٠) — الفورمات التانية ما بتاخدش منه
const rebalancedLoads = [ahmed, saif, abdo].map((id) => afterRebalance.filter((l) => l.salesId === id && l.formName === FORM).length);
check(
  'إعادة التوزيع بتسوّي التكدّس القديم في الفورم (فرق رقم واحد كأقصى)',
  Math.max(...rebalancedLoads) - Math.min(...rebalancedLoads) <= 1,
  JSON.stringify(rebalancedLoads)
);
check(
  'إعادة التوزيع مش بتلمس أرقام خارج قائمة السيلز المؤهّلين',
  afterRebalance.filter((l) => l.formName === OTHER_FORM).every((l) => l.salesId === ahmed)
);
check(
  'الواجهة فيها زرار «إعادة توزيع بالتساوي» بينادي على المعالج',
  app.includes('إعادة توزيع بالتساوي') && app.includes('onRebalanceForm')
);

console.log(`\n✅ نجحت ${passed} فحوصات للتوزيع التلقائي`);
