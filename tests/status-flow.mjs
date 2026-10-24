// ===== اختبار انتقال الحالة: من الفيدباك للحالة =====
// الطلب: «لما أنزل فيد باك لشخص وأحطوه في مرحلة مثل follow up، يقوم منقول
// لـ follow up» — يعني الحالة الصريحة اللي يختارها المندوب هي اللي تحدد
// الحالة في لوحة «المراحل»/«الأرقام» وعدّادات الرئيسية، لا نتيجة المكالمة.
//
// التشغيل: node tests/status-flow.mjs

import assert from 'node:assert/strict';

const { feedbackBucketOf, latestFeedbackStatusOf, buildWorkNumbers, feedbackByPhone } =
  await import('../src/feedbackBuckets.ts');

let passed = 0;
const check = (label, condition, extra = '') => {
  assert.ok(condition, `✗ ${label} ${extra}`);
  passed += 1;
  console.log(`✓ ${label}`);
};

const AT = '2026-10-24T10:00:00.000Z';
const PHONE = '01001234567';

// ===== ١) عميل مسجّل: آخر فيدباك بحالة =====
const clientWith = (status) => ({
  id: 'c1',
  name: 'محمد كامل',
  phone: PHONE,
  stage: 'new',
  activities: [
    { id: 'a2', type: 'call', text: 'اتصال: تم الرد', at: AT },
    { id: 'a1', type: 'feedback', text: 'طلب معاينة', status, at: AT },
  ],
});

check('عميل فيدباكه follow up → حالته follow-up', feedbackBucketOf(clientWith('follow-up')) === 'follow-up');
check('عميل فيدباكه meeting → حالته meeting', feedbackBucketOf(clientWith('meeting')) === 'meeting');
check('عميل فيدباكه done deal → حالته done-deal', feedbackBucketOf(clientWith('done-deal')) === 'done-deal');
check('عميل بلا حالة فيدباك → ويرجع على المرحلة', feedbackBucketOf({ stage: 'contacted', activities: [] }) === 'follow-up');
check('آخر حالة فيدباك = أول حدث carries الحالة', latestFeedbackStatusOf(clientWith('meeting')) === 'meeting');

// ===== ٢) رقم موزَّع (لسه مش عميل): الحالة من بطاقات الفيدباك بالرقم =====
const feedback = (status, at = AT) => ({
  id: `f-${status}`,
  userId: 'u1',
  clientPhone: PHONE,
  clientName: 'محمد كامل',
  date: at,
  feedback: 'طلب معاينة',
  callStatus: 'called',
  status,
  createdAt: at,
});
const callLog = (result, at = AT) => ({
  id: 'l1',
  salesId: 'u1',
  clientPhone: PHONE,
  result,
  comment: 'طلب معاينة',
  createdAt: at,
});

const snapshot = feedbackByPhone([feedback('follow-up')], [callLog('answered')]);
check('رقم موزَّع: فيدباك follow up + مكالمة → الحالة follow-up', snapshot.get('01001234567')?.status === 'follow-up');

const snapshotMeeting = feedbackByPhone([feedback('meeting')], [callLog('answered')]);
check(
  'رقم موزَّع: فيدباك meeting (نفس لحظة المكالمة) → الحالة meeting مش follow-up',
  snapshotMeeting.get('01001234567')?.status === 'meeting'
);

const snapshotNoAnswer = feedbackByPhone([feedback('no-answer')], [callLog('no-answer')]);
check('رقم موزَّع: فيدباك no answer → الحالة no-answer', snapshotNoAnswer.get('01001234567')?.status === 'no-answer');

// فيدباك بلا حالة صريحة ما يمسحش حالة معروفة
const snapshotEmpty = feedbackByPhone(
  [
    feedback('meeting'),
    { ...feedback('', '2026-10-24T11:00:00.000Z'), id: 'f-empty' },
  ],
  [callLog('answered')]
);
check(
  'فيدباك بلا حالة ما بيمسحش حالة معروفة (بقيت meeting)',
  snapshotEmpty.get('01001234567')?.status === 'meeting'
);

// مكالمة أحدث من الفيدباك → هي اللي تتقدّم
const snapshotNewerCall = feedbackByPhone(
  [feedback('meeting', '2026-10-24T09:00:00.000Z')],
  [callLog('answered', '2026-10-24T12:00:00.000Z')]
);
check('مكالمة أحدث من الفيدباك → حالتها هي الأحدث', snapshotNewerCall.get('01001234567')?.status === 'follow-up');

// ===== ٣) لوحة الأرقام: كل رقم في مكان واحد وبالحالة الصح =====
const numbers = buildWorkNumbers(
  [clientWith('follow-up'), { ...clientWith('meeting'), id: 'c2', phone: '01112223344' }],
  [{ id: 'l9', name: 'رقم جديد', phone: '01223334455', status: 'new', salesId: 'u1' }],
  feedbackByPhone([], [])
);
check('لوحة الأرقام: ٣ أرقام (عميلين + رقم موزَّع)', numbers.length === 3);
check(
  'العميل اللي حالته follow-up في العدّاد الصح',
  numbers.filter((n) => n.bucket === 'follow-up').length === 1
);
check(
  'العميل اللي حالته meeting في العدّاد الصح',
  numbers.filter((n) => n.bucket === 'meeting').length === 1
);
check(
  'الرقم الموزَّع من غير فيدباك = fresh-stage',
  numbers.filter((n) => n.bucket === 'fresh-stage').length === 1
);

// ===== ٤) نفس الرقم بعد فيدباك follow up =====
const after = buildWorkNumbers(
  [],
  [{ id: 'l9', name: 'رقم جديد', phone: PHONE, status: 'new', salesId: 'u1' }],
  feedbackByPhone([feedback('follow-up')], [callLog('answered')])
);
check(
  'الرقم الموزَّع بعد فيدباك follow up ينتقل ل.follow-up',
  after.length === 1 && after[0].bucket === 'follow-up'
);
check(
  'الرقم الموزَّع بعد فيدباك meeting ينتقل لـ meeting',
  buildWorkNumbers(
    [],
    [{ id: 'l9', name: 'رقم جديد', phone: PHONE, status: 'new', salesId: 'u1' }],
    feedbackByPhone([feedback('meeting')], [callLog('answered')])
  )[0].bucket === 'meeting'
);

console.log(`\n✅ نجحت ${passed} فحوصات (انتقال الحالة من الفيدباك)`);
