// ===== اختبار أسباب الإلغاء وعدّادات الحالات =====
// يتحقق من:
//  ١) قائمة أسباب الإلغاء الستة المعتمدة (نفس ترتيب وأسماء طلب الإدارة).
//  ٢) آخر سبب إلغاء محفوظ على العميل (حقل صريح أو حدث في الخط الزمني).
//  ٣) عدّاد «حالات عملائي» يسقط على المرحلة عند غياب فيدباك — فلا يبقى صفراً.
//  ٤) الواجهة: سبب الإلغاء موجود في كل صناديق الفيدباك، وفلتر الإلغاء في القائمة،
//     والسيلز لا يختار مندوباً عند إضافة رقم (ينزل باسمه تلقائياً).
//
// التشغيل: node tests/cancel-reasons.mjs

import fs from 'node:fs';
import assert from 'node:assert/strict';

const { CANCEL_REASONS, CANCEL_REASON_BY_ID, cancelReasonLabelOf, latestCancelReasonOf } = await import('../src/cancelReasons.ts');
const { feedbackBucketOf, latestFeedbackStatusOf, buildWorkNumbers, feedbackByPhone, LEAD_STATUS_TO_FEEDBACK_STATUS } =
  await import('../src/feedbackBuckets.ts');

let passed = 0;
const check = (label, condition, extra = '') => {
  assert.ok(condition, `✗ ${label} ${extra}`);
  passed += 1;
  console.log(`✓ ${label}`);
};

// ===== ١) أسباب الإلغاء =====
const expected = [
  ['not-interested', 'Not interested'],
  ['low-budget', 'Low budget'],
  ['location', 'Location'],
  ['wrong-request', 'Wrong request'],
  ['unreachable', 'Unreachable'],
  ['better-option', 'Better option'],
];
check('ستة أسباب بالترتيب المطلوب', CANCEL_REASONS.length === 6, JSON.stringify(CANCEL_REASONS.map((r) => r.id)));
for (const [id, label] of expected) {
  check(`السبب ${label}`, CANCEL_REASON_BY_ID[id]?.label === label && cancelReasonLabelOf(id) === label);
}
check('سبب غير معروف لا يكسر الكومنت', cancelReasonLabelOf('nope') === '' && cancelReasonLabelOf(undefined) === '');

// ===== ٢) آخر سبب إلغاء =====
check('السبب المحفوظ على العميل', latestCancelReasonOf({ cancelReason: 'low-budget' }) === 'low-budget');
check(
  'السبب من الخط الزمني للسجلات القديمة',
  latestCancelReasonOf({
    activities: [
      { id: '1', type: 'stage', text: 'تغيير المرحلة' },
      { id: '2', type: 'feedback', text: 'Not interested', cancelReason: 'not-interested' },
      { id: '3', type: 'feedback', text: 'قديم', cancelReason: 'location' },
    ],
  }) === 'not-interested'
);
check('عميل بلا إلغاء ليس له سبب', latestCancelReasonOf({ activities: [] }) === '');

// ===== ٣) عدّاد الحالات =====
check('الفيدباك الصريح يغلب المرحلة', feedbackBucketOf({ stage: 'lost', activities: [{ status: 'meeting' }] }) === 'meeting');
check('تغيير المرحلة وحده لا يترك العدّاد صفراً', feedbackBucketOf({ stage: 'meeting', activities: [{ type: 'stage' }] }) === 'meeting');
const fallbacks = {
  new: 'fresh-stage',
  contacted: 'follow-up',
  meeting: 'meeting',
  negotiation: 'reservation',
  closed: 'done-deal',
  lost: 'cancellation',
};
for (const [stage, status] of Object.entries(fallbacks)) {
  check(`المرحلة ${stage} → ${status}`, feedbackBucketOf({ stage }) === status);
}
check('سجل بلا مرحلة وبلا فيدباك لا ينتمي لحالة', feedbackBucketOf({}) === '');
check('قراءة الحالة الصريحة', latestFeedbackStatusOf({ activities: [{ status: 'cancellation' }] }) === 'cancellation');

// ===== ٤) ربط الواجهة =====
const app = fs.readFileSync('src/App.tsx', 'utf8');
const pickerUses = (app.match(/<CancelReasonPicker/g) || []).length;
check('سبب الإلغاء في كل صناديق الفيدباك (٤ أماكن)', pickerUses >= 4, `وجد ${pickerUses}`);
check('حالة الإلغاء تطلب السبب قبل الحفظ', (app.match(/=== 'cancellation' && !/g) || []).length >= 3);
check('الفلتر مبني على أسباب الإلغاء', app.includes('setCancelFilter(reason.id)') && app.includes('CANCEL_REASONS.map'));
check('أيقونة فلتر في قائمة العملاء', app.includes('aria-label="فلتر الإلغاء"'));
check('السيلز لا يختار مندوباً لنفسه', app.includes("const isSalesAgent = currentUser?.role === 'sales'"));
check(
  'إضافة الرقم تنتظر وصولها للسيرفر',
  app.includes("await pushKey('crm_assigned_leads')") || /await Promise\.all\(\[\s*pushKey\('crm_assigned_leads'\)/.test(app)
);
check('زر إضافة رقم ظاهر للسيلز', app.includes('إضافة رقم') && app.includes('onAddNumber'));

// ===== ٥) عدّادات الأرقام الموزّعة (الرقم لم يبقَ صفراً) =====
// أرقام التوزيع ليست عملاء مسجّلين، فكانت لوحة «حالات عملائي» و«المراحل» تعدّ
// العملاء فقط وتظهر ٠ رغم وجود ١٠٣ رقم في التوزيع. الفهرس يجمع بطاقات الفيدباك
// وسجل المكالمات بالهاتف، وbuildWorkNumbers يضم الأرقام كلها مرة واحدة.
const snapshots = feedbackByPhone(
  [
    { clientPhone: '0100-000-0099', status: 'meeting', feedback: 'موعد الخميس', createdAt: '2026-10-20T10:00:00.000Z' },
    { clientPhone: '01000000099', status: 'follow-up', feedback: 'أقدم', createdAt: '2026-10-19T10:00:00.000Z' },
    { clientPhone: '01000000077', status: 'cancellation', cancelReason: 'low-budget', feedback: 'Low budget', createdAt: '2026-10-21T10:00:00.000Z' },
  ],
  [{ clientPhone: '01000000066', result: 'no-answer', comment: 'No answer', createdAt: '2026-10-21T09:00:00.000Z' }]
);
check('الفهرس يوحّد صيغة الهاتف', snapshots.get('01000000099')?.status === 'meeting');
check('الأحدث هو الذي يحدد الحالة', snapshots.get('01000000099')?.note === 'موعد الخميس');
// «لم يرد» ما بتنقلش الرقم من خانته — فمالهاش حالة في الفهرس
check('المكالمة بلا رد ما بتغيّرش خانة الرقم', snapshots.has('01000000066') && snapshots.get('01000000066')?.status === '');
check('سبب الإلغاء يصل مع بطاقة الفيدباك', snapshots.get('01000000077')?.cancelReason === 'low-budget');

const numbers = buildWorkNumbers(
  [{ id: 'c1', name: 'عميل مسجّل', phone: '01000000009', stage: 'lost', activities: [] }],
  [
    { id: 'l1', name: 'رقم بموعد', phone: '01000000099', status: 'new' },
    { id: 'l2', name: 'رقم جديد', phone: '01000000088', status: 'new' },
    { id: 'l3', name: 'رقم ملغي', phone: '01000000077', status: 'contacted' },
    { id: 'l4', name: 'رقم اتصل', phone: '01000000066', status: 'contacted' },
    { id: 'l5', name: 'نفس العميل', phone: '01000000009', status: 'new' },
  ],
  snapshots
);
check('كل رقم يظهر مرة واحدة (لا تكرار للعميل)', numbers.length === 5, `وجد ${numbers.length}`);
check(
  'الرقم الموزّع يُحسب بحالة فيدباكه لا بحالته الأصلية',
  numbers.find((n) => n.phone === '01000000099')?.bucket === 'meeting'
);
check('الرقم الجديد يقع على «مرحلة جديدة»', numbers.find((n) => n.phone === '01000000088')?.bucket === 'fresh-stage');
check('الرقم الملغي يظهر بإلغائه وسببه', numbers.find((n) => n.phone === '01000000077')?.bucket === 'cancellation' &&
  numbers.find((n) => n.phone === '01000000077')?.cancelReason === 'low-budget');
check('المكالمة بلا رد بتنقل رقم Fresh لـ «Not Answer At All»', numbers.find((n) => n.phone === '01000000066')?.bucket === 'not-answered');
check('العميل المسجّل يحمل مرحلة المراحل', numbers.find((n) => n.phone === '01000000009')?.stage === 'lost');
check('كل رقم له مرحلة نهائية', numbers.every((n) => !!n.stage));
check('حالة التوزيع الجديدة تنتهي لمرحلة جديدة', LEAD_STATUS_TO_FEEDBACK_STATUS.new === 'fresh-stage');
check(
  'لوحة الرئيسية تعدّ الأرقام لا العملاء فقط',
  app.includes('numbers={workNumbers}') && app.includes('record.bucket || feedbackBucketOf(record)')
);
check('صفحة الحالة الواحدة تعرض أرقام التوزيع', app.includes('numbers={numbers}') || app.includes('numbers = []'));
check('تبويب المراحل يعدّ أرقام التوزيع', app.includes('const stageItems = numbers.length'));
check('مراحل «عملاء كامبين» تضم أرقام التوزيع', app.includes('campaignLeads.filter((l: AssignedLead) => leadInStage(l, id)).length'));
// «جديد» في عملاء كامبين = الأرقام اللي لسه ما اتوزّعتش بس (مش العملاء الموزّعين في مرحلة جديد)
check(
  '«جديد» في عملاء كامبين بيعدّ غير الموزّع بس',
  app.includes("id === 'new' ? clientUnassigned(c) : c.stage === id") &&
    app.includes("id === 'new' ? leadUnassigned(l) : leadStage(l) === id")
);
check('فلتر الإلغاء يشمل أرقام التوزيع', app.includes('const leadCancelReasonOf'));

// ===== fresh stage أولاً + الأرقام الموزّعة فقط =====
check(
  '«fresh stage» أول خانة قبل «follow up» في لوحة الحالات',
  app.indexOf("id: 'fresh-stage'") > -1 && app.indexOf("id: 'fresh-stage'") < app.indexOf("id: 'follow-up'"),
  `fresh=${app.indexOf("id: 'fresh-stage'")} follow=${app.indexOf("id: 'follow-up'")}`
);
check(
  'لوحة الحالات لا تُدخل الأرقام غير الموزّعة',
  app.includes('includeUnassigned: false')
);

const mixed = buildWorkNumbers(
  [],
  [
    { id: 'a', name: 'موزّع', phone: '01000000001', status: 'new', salesId: 'u-1' },
    { id: 'b', name: 'غير موزّع', phone: '01000000002', status: 'new', salesId: '' },
    { id: 'c', name: 'بلا حقل', phone: '01000000003', status: 'new' },
  ],
  new Map()
);
check('بلا خيار: كل الأرقام تعد (لعملاء كامبين والتقارير)', mixed.length === 3, `وجد ${mixed.length}`);

const distributed = buildWorkNumbers(
  [],
  [
    { id: 'a', name: 'موزّع', phone: '01000000001', status: 'new', salesId: 'u-1' },
    { id: 'b', name: 'غير موزّع', phone: '01000000002', status: 'new', salesId: '' },
    { id: 'c', name: 'بلا حقل', phone: '01000000003', status: 'new' },
  ],
  new Map(),
  { includeUnassigned: false }
);
check('الموزّع فقط يبقى في لوحة الحالات', distributed.length === 1, `وجد ${distributed.length}`);
check(
  'والموزّع الجديد هو الذي يُعدّ في fresh stage',
  distributed.length === 1 && distributed[0].bucket === 'fresh-stage' && distributed[0].phone === '01000000001'
);

console.log(`\n✅ نجحت ${passed} فحوصات لأسباب الإلغاء والعدّادات`);
