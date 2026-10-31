// ===== اختبار انتقال الحالة: من الفيدباك للحالة =====
// الطلب: «لما أنزل فيد باك لشخص وأحطوه في مرحلة مثل follow up، يقوم منقول
// لـ follow up» — يعني الحالة الصريحة اللي يختارها المندوب هي اللي تحدد
// الحالة في لوحة «المراحل»/«الأرقام» وعدّادات الرئيسية، لا نتيجة المكالمة.
//
// التشغيل: node tests/status-flow.mjs

import assert from 'node:assert/strict';

const { feedbackBucketOf, latestFeedbackStatusOf, buildWorkNumbers, feedbackByPhone, isColdNumber, isFreshNumber, coldPhonesOf } =
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
check('رقم موزَّع: فيدباك no answer → الرقم بيفضل في خانته (مفيش حالة)', snapshotNoAnswer.get('01001234567')?.status === '');

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

// ===== Follow Up منفصل عن Cold Calls =====
// رقم حالته Follow Up وبعدها سجل مكالمة «لم يرد» من غير حالة مختارة —
// كان بيتحسب no-answer فيروح Cold Calls. لازم يفضل Follow Up.
const snapFollowThenBareNoAnswer = feedbackByPhone(
  [feedback('follow-up', '2026-10-28T12:23:06.000Z')],
  [callLog('no-answer', '2026-10-31T12:49:44.000Z')]
);
check(
  'Follow Up + مكالمة لم يرد بعدها من غير حالة → يفضل follow-up (مش Cold Calls)',
  snapFollowThenBareNoAnswer.get(PHONE)?.status === 'follow-up',
  snapFollowThenBareNoAnswer.get(PHONE)?.status
);
const followClient = buildWorkNumbers(
  [{
    id: 'c-fu', name: 'عميل', phone: PHONE, stage: 'contacted',
    activities: [{ id: 'a1', type: 'feedback', text: 'هكلمه تاني', status: 'follow-up', at: '2026-10-28T12:23:06.000Z' }],
  }],
  [],
  feedbackByPhone([], [callLog('no-answer', '2026-10-31T12:49:44.000Z')])
)[0];
check(
  'عميل Follow Up + مكالمة لم يرد من غير حالة → مش Cold Calls',
  followClient?.bucket === 'follow-up' && !isColdNumber(followClient, coldPhonesOf([callLog('no-answer', '2026-10-31T12:49:44.000Z')])),
  followClient?.bucket
);
check(
  'اختيار No Answer صراحةً بعد Follow Up → يفضل Follow Up',
  feedbackByPhone(
    [{ ...feedback('no-answer', '2026-10-31T12:00:00.000Z'), id: 'f-na' }, feedback('follow-up', '2026-10-28T12:00:00.000Z')],
    [callLog('no-answer', '2026-10-31T12:00:00.000Z')]
  ).get(PHONE)?.status === 'follow-up'
);
const freshCalledNoAnswer = buildWorkNumbers(
  [],
  [{ id: 'l-na', name: 'رقم', phone: PHONE, status: 'contacted', salesId: 'u1' }],
  feedbackByPhone([{ ...feedback('no-answer'), id: 'f-na2' }], [callLog('no-answer')])
)[0];
check(
  'رقم Fresh اتصلنا بيه وما ردّش → يفضل Fresh (مش Cold Calls ولا Follow Up)',
  freshCalledNoAnswer?.bucket === 'fresh-stage' &&
    isFreshNumber(freshCalledNoAnswer, new Set([PHONE])) &&
    !isColdNumber(freshCalledNoAnswer, coldPhonesOf([callLog('no-answer')])),
  freshCalledNoAnswer?.bucket
);
const freshClientNoAnswer = buildWorkNumbers(
  [{
    id: 'c-na', name: 'عميل', phone: PHONE, stage: 'contacted',
    activities: [{ id: 'a1', type: 'feedback', text: 'No answer', status: 'no-answer', at: AT }],
  }],
  [],
  feedbackByPhone([], [callLog('no-answer')])
)[0];
check(
  'عميل جديد كل اللي عليه No Answer → يفضل Fresh',
  freshClientNoAnswer?.bucket === 'fresh-stage',
  freshClientNoAnswer?.bucket
);

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
// الطلب: «الأرقام الجديدة تنزل في Fresh Leads مش Cold Calls» — فلازم كل رقم يبقى
// في واحد منهم بس. Fresh = رقم نزل حالاً (آخر ٢٤ ساعة) · Cold = نزل من زمان وما اتصلناش.
// (فتح السيلز للرقم ما بيخلّيه بارد — الأرقام الجديدة فضلت في Fresh.)
const HOUR = 60 * 60 * 1000;
const OLD = new Date(Date.now() - 5 * 24 * HOUR).toISOString();
const NEW = new Date(Date.now() - 2 * HOUR).toISOString();
const split = buildWorkNumbers(
  [
    { id: 'c1', name: 'عميل مسجّل من غير فيدباك', phone: '01000000001', stage: 'new', createdAt: OLD, activities: [] },
    {
      id: 'c2',
      name: 'عميل عليه فيدباك',
      phone: '01000000002',
      stage: 'contacted',
      createdAt: OLD,
      activities: [{ id: 'a1', type: 'feedback', text: 'طلب معاينة', status: 'follow-up', at: AT }],
    },
  ],
  [
    { id: 'l1', name: 'رقم جديد نزل حالاً', phone: '01000000003', status: 'new', salesId: 'u1', assignedAt: NEW },
    { id: 'l2', name: 'رقم قديم اتفتح من التوزيع', phone: '01000000004', status: 'viewed', salesId: 'u1', assignedAt: OLD },
    { id: 'l3', name: 'رقم اتفتح واتصلنا بيه', phone: '01000000005', status: 'viewed', salesId: 'u1', assignedAt: OLD },
    { id: 'l6', name: 'رقم نزل حالاً واتفتح', phone: '01000000006', status: 'viewed', salesId: 'u1', assignedAt: NEW },
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
// «لم يرد» ما بتنقلش الرقم من خانته: Cold Calls فاضية، والرقم اللي اتصلنا بيه
// وما ردّش بيفضل في Fresh.
const coldPhones = coldPhonesOf([{ clientPhone: '01000000005', result: 'no-answer', createdAt: AT }]);
const cold = split.filter((n) => isColdNumber(n, coldPhones));
const fresh = split.filter((n) => isFreshNumber(n, calledPhones));
check('«Cold Calls» فاضية (لم يرد ما بتنقلش الرقم)', cold.length === 0, `وجد ${cold.length}`);
check('«Fresh Leads» = كل الأرقام الجديدة حتى اللي ما ردّتش (٥)', fresh.length === 5, `وجد ${fresh.length}`);
check(
  'الرقم الواحد ما بيحسبش في الاتنين',
  cold.every((n) => !fresh.some((f) => f.key === n.key))
);
check(
  'الرقم اللي اتصلنا بيه وما ردّنا بيفضل Fresh',
  fresh.some((n) => n.phone === '01000000005')
);
check(
  'الرقم اللي اتفتح من التوزيع (-opening) بيفضل Fresh لحد ما يتصل بيه',
  fresh.some((n) => n.phone === '01000000006') && !cold.some((n) => n.phone === '01000000006')
);
check(
  'الرقم القديم اللي ما اتصلناش فيه بيفضل Fresh (مش بارد)',
  fresh.some((n) => n.phone === '01000000004') && !cold.some((n) => n.phone === '01000000004')
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
  '«No answer» الأحدث هو آخر كومنت على الرقم (مش الكومنت اللي قبله)',
  noteOld.get('01006665555')?.note === 'No answer'
);
const workNoAnswer = buildWorkNumbers(
  [
    {
      id: 'c9',
      name: 'عميل',
      phone: '01006664444',
      stage: 'contacted',
      activities: [
        { id: 'a2', type: 'feedback', text: 'No answer', status: 'no-answer', at: '2026-10-25T12:00:00.000Z', by: 'mohamed' },
        { id: 'a1', type: 'feedback', text: 'Low budget', status: 'cancellation', at: '2026-10-24T12:00:00.000Z', by: 'mohamed' },
      ],
    },
  ],
  [],
  new Map()
);
check(
  'كارت العميل في صفحة الأرقام بيعرض «No answer» الأحدث مش أول كومنت',
  workNoAnswer[0]?.salesNote === 'No answer' && workNoAnswer[0]?.salesNoteBy === 'mohamed',
  JSON.stringify(workNoAnswer[0]?.salesNote)
);
// لوج خالص («تم إنشاء تذكير …») لسه مش بيظهر كملاحظة
check(
  'اللوج الخالص لسه ما بيظهرش كملاحظة',
  !feedbackByPhone([], [{ clientPhone: '01006663333', comment: 'تم إنشاء تذكير للمتابعة', createdAt: AT }]).get('01006663333')?.note
);

console.log(`\n✅ نجحت ${passed} فحوصات (انتقال الحالة من الفيدباك)`);
