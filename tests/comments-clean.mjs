// ===== اختبار الكومنتات: كلام السيلز فقط — بلا لوجات وبلا تكرار =====
// الطلب: «التذكيرات بتتكتب في الكومنتات أو أي لوج… أنا مش عايز لوجات، عايز كلام
// السيلز فقط» + «الكومنتات بتتكرر… احذف المتكررة» — في كل مكان: نافذة الإجراء،
// صفحة تفاصيل العميل، لوحة تعليقات العميل، والفيدباك اليومي عند الإدارة.
//
// التشغيل: node tests/comments-clean.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';

const {
  cleanCommentText,
  commentActivitiesOf,
  dedupeComments,
  isCallResultText,
  isCommentActivity,
  isSystemOnlyText,
  sanitizeClientRecord,
  sanitizeDailyFeedbackCards,
} = await import('../shared/comments.js');

const { sanitizeMergedKey } = await import('../server/store.js');

let passed = 0;
const check = (label, condition, extra = '') => {
  assert.ok(condition, `✗ ${label} ${extra}`);
  passed += 1;
  console.log(`✓ ${label}`);
};

const AT = '2026-10-24T10:00:00.000Z';
const MIN = '2026-10-24T10:01:00.000Z';

// ===== ١) كومنتات العميل: اللوجات ما تظهرش =====
const client = {
  id: 'c1',
  name: 'محمد كامل',
  phone: '01001234567',
  stage: 'new',
  activities: [
    { id: 'a1', type: 'feedback', text: 'طلب معاينة العقار Saturday', status: 'follow-up', at: AT },
    { id: 'a2', type: 'call', text: 'اتصال: تم الرد', at: AT },
    { id: 'a3', type: 'reminder', text: 'تم إنشاء تذكير: معاينة', at: AT },
    { id: 'a4', type: 'whatsapp', text: 'تم فتح واتساب', at: AT },
  ],
};

const comments = commentActivitiesOf(client);
check('لوج «اتصال» ما يظهرش في الكومنتات', !comments.some((c) => c.type === 'call'));
check('لوج «تذكير» ما يظهرش في الكومنتات', !comments.some((c) => c.type === 'reminder'));
check('لوج «واتساب» ما يظهرش في الكومنتات', !comments.some((c) => c.type === 'whatsapp'));
check('كلام السيلز بيفضل موجود', comments.length === 1 && comments[0].text === 'طلب معاينة العقار Saturday');
check('الحالة بتتبعت مع الكومنت', comments[0].status === 'follow-up');

// ===== ٢) التكرار: نفس الكومنت يتكتب في أكتر من مكان =====
const dupClient = {
  activities: [
    { id: 'x1', type: 'feedback', text: 'طلب معاينة', at: AT },
    { id: 'x2', type: 'feedback', text: 'طلب معاينة', at: AT },
    { id: 'x3', type: 'feedback', text: 'كلمة تانية', at: MIN },
  ],
};
check('نفس الكومنت في نفس الدقيقة بيتشال', commentActivitiesOf(dupClient).length === 2);
check(
  'كلام مختلف في نفس الدقيقة بيفضل',
  commentActivitiesOf(dupClient).some((c) => c.text === 'كلمة تانية')
);

// ===== ٣) بادئة «من المكالمة: » — الكومنت يبقى كلام صافي =====
check('بادئة «من المكالمة» بتتشال', cleanCommentText('من المكالمة: طلب معاينة') === 'طلب معاينة');
check('بادئة «فيدباك» بتتشال', cleanCommentText('فيدباك: طلب معاينة') === 'طلب معاينة');
check(
  'سطر النظام الآلي في أول الكومنت بيتشال',
  cleanCommentText('No answer\nالمش مجمع هكلمه تاني') === 'المش مجمع هكلمه تاني'
);
check(
  'كلام المندوب بعد سطر النظام بيفضل',
  commentActivitiesOf({
    activities: [{ id: 's1', type: 'feedback', text: 'No answer\nالمش مجمع هكلمه تاني', at: AT }],
  })[0].text === 'المش مجمع هكلمه تاني'
);
check('نص النظام الآلي مش كلام مندوب', isSystemOnlyText('No answer') && isSystemOnlyText('اتصال: تم الرد'));
// لكن نتيجة الاتصال نفسها هي الكومنت اللي بيتسجّل مع الإجراء، فلازم تتعرض
// في «آخر التعليقات» (كانت بتختفي فيبقى الإجراء شكله ما اتحفظش).
check('نص نتيجة الاتصال يتعرف عليه', isCallResultText('No answer') && isCallResultText('لم يرد'));
check(
  'نص نتيجة الاتصال مع الحالة يتحفظ للعرض',
  isCallResultText('اتصال: تم الرد') && isCallResultText(' busy ')
);
check(
  'لوجات التذكير/الواتساب مش نتيجة اتصال',
  !isCallResultText('تم فتح واتساب') && !isCallResultText('تم إنشاء تذكير: معاينة')
);
check(
  'نص البطاقة التلقائية («عميل جديد») مش كلام مندوب',
  isSystemOnlyText('عميل جديد — لم يتم التواصل معه بعد')
);
check('كلام المندوب مش نظام', !isSystemOnlyText('طلب معاينة العقار Saturday'));
check('نشاط الكومنت يتعرف عليه', isCommentActivity({ type: 'feedback' }) && !isCommentActivity({ type: 'call' }));

// ===== ٥) تنظيف السيرفر: اللوجات ما ترجعش من جهاز قديم =====
const dirty = {
  id: 'c1',
  activities: [
    { id: 'd1', type: 'feedback', text: 'من المكالمة: طلب معاينة', at: AT },
    { id: 'd2', type: 'feedback', text: 'طلب معاينة', at: AT },
    { id: 'd3', type: 'call', text: 'اتصال: تم الرد', at: AT },
    { id: 'd4', type: 'reminder', text: 'تم إنشاء تذكير', at: AT },
    { id: 'd5', type: 'stage', text: 'تغيير المرحلة: متابعة', at: AT },
  ],
};
const cleaned = sanitizeClientRecord(dirty);
check('السيرفر بيشيل لوج الاتصال', !cleaned.activities.some((a) => a.type === 'call'));
check('السيرفر بيشيل لوج التذكير', !cleaned.activities.some((a) => a.type === 'reminder'));
check('السيرفر بيشيل الكومنت المكرر', cleaned.activities.filter((a) => a.type === 'feedback').length === 1);
check('السيرفر بيشيل البادئة', cleaned.activities[0].text === 'طلب معاينة');
check('السيرفر بيحافظ على أحداث تانية', cleaned.activities.some((a) => a.type === 'stage'));

const mergedClients = sanitizeMergedKey('crm_clients', [dirty]);
check('الدمج نضّف كومنتات العميل', mergedClients[0].activities.filter((a) => a.type === 'feedback').length === 1);

const cards = [
  { id: 'f1', clientPhone: '01001234567', feedback: 'طلب معاينة', date: AT, userId: 'u1' },
  { id: 'f2', clientPhone: '01001234567', feedback: 'طلب معاينة', date: AT, userId: 'u1' },
  { id: 'f3', clientPhone: '01001234567', feedback: 'اتصال: تم الرد', date: AT, userId: 'u1' },
  { id: 'f4', clientPhone: '01001234567', feedback: 'كلام تاني', date: MIN, userId: 'u1' },
  { id: 'f5', clientPhone: '01001234567', feedback: 'No answer', date: MIN, userId: 'u1' },
];
const cleanCards = sanitizeDailyFeedbackCards(cards);
check('بطاقات الفيدباك المكررة بتتشال', cleanCards.length === 3);
check('بطاقة اللوج البحتة («اتصال: تم الرد») بتتشال', !cleanCards.some((c) => c.feedback === 'تم الرد'));
check(
  'بطاقة النظام الآلية («No answer») بتفضل — فيها الحالة والنتيجة',
  cleanCards.some((c) => c.feedback === 'No answer')
);

// ===== ٦) ربط الواجهة: الكومنتات من غير لوجات + مفيش كتابة لوج =====
const app = fs.readFileSync('src/App.tsx', 'utf8');

check(
  'نافذة الإجراء بتقرأ الكومنتات من shared/comments.js',
  /commentActivitiesOf\(client\)/.test(app)
);
check(
  'عدّاد الكومنتات = الكومنتات الحقيقية بس',
  /const commentCountOf = \(c: any\): number => commentActivitiesOf\(c\)\.length/.test(app)
);
check(
  'تفاصيل العميل بتعرض الكومنتات الحقيقية بس',
  /const feedbackEntries = useMemo\(\(\) => \{/.test(app) &&
    /commentActivitiesOf\(client\)/.test(app) &&
    /for \(const log of callLogs \|\| \[\]\)/.test(app)
);
check(
  'مفيش كتابة لوج «اتصال» في خط العميل',
  !/addClientActivity\(\s*target\.id,\s*'call'/.test(app)
);
check(
  'مفيش كتابة لوج «تذكير» في خط العميل',
  !/addClientActivity\(form\.clientId, 'reminder'/.test(app)
);
check(
  'الكومنت بيتكتب من غير بادئة «من المكالمة»',
  !/`من المكالمة: \$\{callComment\}`/.test(app)
);
check(
  'الفيدباك اليومي عند الإدارة: كومنتات سجل المكالمات رجعت (كلام السيلز)',
  /for \(const l of callLogs \|\| \[\]\)/.test(app) && /kind: 'مكالمة'/.test(app)
);
check(
  'لوحة تعليقات العميل بتقرأ سجل المكالمات (كلام السيلز اللي كتبوه بإيدهم)',
  /for \(const log of callLogs \|\| \[\]\)/.test(app) &&
    /id: `log-\$\{log\?\.id\}`/.test(app)
);
check(
  'تبويب الفيدباك للمندوب: كلام المكالمات رجع + نفس الكومنت مرة واحدة بس',
  /commentSignature\(text, f\?\.date \|\| f\?\.createdAt\)/.test(app) &&
    /userId: currentUser\?\.id,/.test(app)
);
check(
  'الفيدباك اليومي بيستعمل قواعد التكرار',
  /dedupeComments\(entry\.items\)/.test(app)
);

// ===== ٧) قاعدة السيرفر منصّلة في الدمج =====
const store = fs.readFileSync('server/store.js', 'utf8');
check('السيرفر بيستعمل قواعد التنظيف', /sanitizeMergedKey/.test(store) && /shared\/comments\.js/.test(store));

console.log(`\n✅ نجحت ${passed} فحوصات (الكومنتات: كلام السيلز فقط، بلا لوجات وبلا تكرار)`);
