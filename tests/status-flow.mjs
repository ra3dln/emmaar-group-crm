// ===== اختبار انتقال الحالة: من الفيدباك للحالة =====
// الطلب: «لما أنزل فيد باك لشخص وأحطوه في مرحلة مثل follow up، يقوم منقول
// لـ follow up» — يعني الحالة الصريحة اللي يختارها المندوب هي اللي تحدد
// الحالة في لوحة «المراحل»/«الأرقام» وعدّادات الرئيسية، لا نتيجة المكالمة.
//
// التشغيل: node tests/status-flow.mjs

import assert from 'node:assert/strict';

const { feedbackBucketOf, latestFeedbackStatusOf, buildWorkNumbers, feedbackByPhone, isColdNumber } =
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

// ===== ٥) «Fresh Leads» ≠ «Cold Calls» =====
// الطلب: «الفريش ليدز مش هيا ال cold calls» — فلازم كل رقم يبقى في واحد منهم بس.
// Fresh = رقم جديد ما اتفتحش · Cold = اتفتح (عميل مسجّل / رقم اتفتح من التوزيع) وما اتصلناش.
const split = buildWorkNumbers(
  [
    { id: 'c1', name: 'عميل مسجّل من غير فيدباك', phone: '01000000001', stage: 'new', activities: [] },
    {
      id: 'c2',
      name: 'عميل عليه فيدباك',
      phone: '01000000002',
      stage: 'contacted',
      activities: [{ id: 'a1', type: 'feedback', text: 'طلب معاينة', status: 'follow-up', at: AT }],
    },
  ],
  [
    { id: 'l1', name: 'رقم جديد ما اتفتحش', phone: '01000000003', status: 'new', salesId: 'u1' },
    { id: 'l2', name: 'رقم اتفتح من التوزيع', phone: '01000000004', status: 'viewed', salesId: 'u1' },
    { id: 'l3', name: 'رقم اتفتح واتصلنا بيه', phone: '01000000005', status: 'viewed', salesId: 'u1' },
  ],
  feedbackByPhone(
    [],
    [
      {
        id: 'lg1',
        salesId: 'u1',
        clientPhone: '01000000005',
        result: 'no-answer',
        comment: 'No answer',
        createdAt: AT,
      },
    ]
  )
);
const calledPhones = new Set(['01000000005']);
const cold = split.filter((n) => isColdNumber(n, calledPhones));
const fresh = split.filter((n) => n.bucket === 'fresh-stage' && !isColdNumber(n, calledPhones));
check('«Cold Calls» = العميل المسجّل + الرقم اللي اتفتح (٢)', cold.length === 2, `وجد ${cold.length}`);
check('«Fresh Leads» = الرقم الجديد اللي ما اتفتحش (١)', fresh.length === 1, `وجد ${fresh.length}`);
check(
  'الرقم الواحد ما بيحسبش في الاتنين',
  cold.every((n) => !fresh.some((f) => f.key === n.key))
);
check(
  'الرقم اللي اتصلنا بيه مش بارد ومش جديد',
  !cold.some((n) => n.phone === '01000000005') && !fresh.some((n) => n.phone === '01000000005')
);
check(
  'العميل اللي عليه فيدباك حالته follow-up (مش بارد ولا جديد)',
  split.find((n) => n.phone === '01000000002')?.bucket === 'follow-up'
);

// ===== ٦) الملاحظة = كلام المندوب (مش اللوج) =====
const noteCall = feedbackByPhone(
  [],
  [
    {
      id: 'lg2',
      salesId: 'u1',
      clientPhone: '01007778888',
      result: 'no-answer',
      comment: 'No answer\nمردش هكلمه تاني',
      createdAt: AT,
    },
  ]
);
check(
  'سطر النظام الآلي («No answer») بيتشال من الملاحظة',
  noteCall.get('01007778888')?.note === 'مردش هكلمه تاني'
);
const noteOld = feedbackByPhone(
  [
    {
      id: 'f9',
      clientPhone: '01006665555',
      status: 'follow-up',
      feedback: 'طلب معاينة',
      createdAt: AT,
    },
  ],
  [
    {
      id: 'lg3',
      salesId: 'u1',
      clientPhone: '01006665555',
      result: 'no-answer',
      comment: 'No answer',
      createdAt: '2026-10-24T12:00:00.000Z',
    },
  ]
);
check(
  'اللوج الجديد ما بيمسحش كلام المندوب اللي قبله',
  noteOld.get('01006665555')?.note === 'طلب معاينة'
);

console.log(`\n✅ نجحت ${passed} فحوصات (انتقال الحالة من الفيدباك)`);
