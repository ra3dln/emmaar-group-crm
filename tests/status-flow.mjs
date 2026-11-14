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
// الحالة اللي اختارها المندوب (Meeting) تفضل — مكالمة «تم الرد» بعدها ما تغيّرهاش
check('مكالمة «تم الرد» أحدث ما بتغطّيش على الحالة المختارة', snapshotNewerCall.get('01001234567')?.status === 'meeting');
check(
  'رقم من غير أي حالة مختارة + مكالمة «تم الرد» → Follow Up',
  feedbackByPhone([], [callLog('answered')]).get('01001234567')?.status === 'follow-up'
);
check(
  'No Answer مختارة + مكالمة «تم الرد» قديمة → الرقم يفضل في خانته (مش Follow Up)',
  feedbackByPhone([{ ...feedback('no-answer', '2026-11-12T09:20:00.000Z'), id: 'f-na3' }], [callLog('answered', '2026-11-10T09:00:00.000Z')]).get('01001234567')?.status === ''
);
{
  const clientNa = buildWorkNumbers(
    [{ id: 'c-na2', name: 'عميل', phone: PHONE, stage: 'contacted',
      activities: [{ id: 'a1', type: 'feedback', text: 'No answer', status: 'no-answer', at: '2026-11-12T09:20:00.000Z' }] }],
    [],
    feedbackByPhone([], [callLog('answered', '2026-11-12T09:25:00.000Z')])
  )[0];
  check('عميل اختار له No Answer ما يتحسبش Follow Up بسبب مكالمة «تم الرد» (خانة No Answer)', clientNa?.bucket === 'no-answer', clientNa?.bucket);
}

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
  'رقم Fresh اتصلنا بيه وما ردّش → خانة No Answer (مش Cold Calls ولا Follow Up)',
  freshCalledNoAnswer?.bucket === 'no-answer' &&
    !isFreshNumber(freshCalledNoAnswer, new Set([PHONE])) &&
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
  'عميل جديد كل اللي عليه No Answer → خانة No Answer',
  freshClientNoAnswer?.bucket === 'no-answer',
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
check('«Fresh Leads» = الأرقام الجديدة من غير اللي اتصلنا بيها وما ردّتش (٤)', fresh.length === 4, `وجد ${fresh.length}`);
check(
  'الرقم الواحد ما بيحسبش في الاتنين',
  cold.every((n) => !fresh.some((f) => f.key === n.key))
);
check(
  'الرقم اللي اتصلنا بيه وما ردّش راح خانة No Answer',
  !fresh.some((n) => n.phone === '01000000005') && split.find((n) => n.phone === '01000000005')?.bucket === 'no-answer'
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
// الكومنت وصل بطاقة الفيدباك ولسه ما وصلش خط العميل → الكارت يعرض الأحدث
const newerCard = buildWorkNumbers(
  [{
    id: 'c-card', name: 'عميل', phone: PHONE, stage: 'contacted',
    activities: [{ id: 'a1', type: 'feedback', text: 'كومنت قديم', status: 'follow-up', at: '2026-11-07T14:43:20.000Z', by: 'Abdallah' }],
  }],
  [],
  feedbackByPhone(
    [{ ...feedback('follow-up', '2026-11-08T14:59:42.000Z'), feedback: 'كومنت جديد' }],
    [],
    [{ id: 'u1', name: 'Abdallah' }]
  )
)[0];
check('كومنت البطاقة الأحدث يظهر على الكارت', newerCard?.salesNote === 'كومنت جديد' && newerCard?.salesNoteBy === 'Abdallah', newerCard?.salesNote);
const newerActivity = buildWorkNumbers(
  [{
    id: 'c-act', name: 'عميل', phone: PHONE, stage: 'contacted',
    activities: [{ id: 'a1', type: 'feedback', text: 'كومنت أحدث في الخط', at: '2026-11-08T15:00:00.000Z', by: 'Abdallah' }],
  }],
  [],
  feedbackByPhone([{ ...feedback('follow-up', '2026-11-08T14:00:00.000Z'), feedback: 'أقدم' }], [])
)[0];
check('كومنت خط العميل الأحدث يفضل هو اللي ظاهر', newerActivity?.salesNote === 'كومنت أحدث في الخط');

// لوج خالص («تم إنشاء تذكير …») لسه مش بيظهر كملاحظة
check(
  'اللوج الخالص لسه ما بيظهرش كملاحظة',
  !feedbackByPhone([], [{ clientPhone: '01006663333', comment: 'تم إنشاء تذكير للمتابعة', createdAt: AT }]).get('01006663333')?.note
);

// ===== «تم الرد» + «No Answer» في نفس الإجراء =====
// الحالة كانت بتتنقل من أول «No Answer» لكل مكالمة اترد عليها بعدها — فالرقم
// عليه أكشن وفضل في Fresh. في الإجراء الواحد «تم الرد» هي اللي تكسب.
{
  const T1 = '2026-11-01T12:07:54.626Z';
  const T1card = '2026-11-01T12:07:54.788Z';
  const T0 = '2026-10-31T13:04:08.863Z';
  const leadSnap = feedbackByPhone(
    [{ ...feedback('no-answer', T0), id: 'fa' }, { ...feedback('no-answer', T1card), id: 'fb' }],
    [{ ...callLog('no-answer', T0), id: 'la' }, { ...callLog('answered', T1), id: 'lb' }]
  );
  check('رقم موزّع: «تم الرد» مع «No Answer» في نفس الإجراء → Follow Up', leadSnap.get(PHONE)?.status === 'follow-up', leadSnap.get(PHONE)?.status);

  const client = buildWorkNumbers(
    [{ id: 'c-ans', name: 'عميل', phone: PHONE, stage: 'contacted',
      activities: [
        { id: 'a2', type: 'feedback', text: 'عايز شقة استلام فوري', status: 'no-answer', at: T1card },
        { id: 'a1', type: 'feedback', text: 'No answer', status: 'no-answer', at: T0 },
      ] }],
    [],
    feedbackByPhone([], [{ ...callLog('no-answer', T0), id: 'la' }, { ...callLog('answered', T1), id: 'lb' }])
  )[0];
  check('عميل: «تم الرد» مع «No Answer» في نفس الإجراء → Follow Up مش Fresh', client?.bucket === 'follow-up', client?.bucket);

  const onlyNa = buildWorkNumbers(
    [{ id: 'c-na9', name: 'عميل', phone: PHONE, stage: 'contacted',
      activities: [{ id: 'a1', type: 'feedback', text: 'No answer', status: 'no-answer', at: T0 }] }],
    [],
    feedbackByPhone([{ ...feedback('no-answer', T0), id: 'fa' }], [{ ...callLog('no-answer', T0), id: 'la' }])
  )[0];
  check('عميل كل مكالماته «لم يرد» → خانة No Answer', onlyNa?.bucket === 'no-answer', onlyNa?.bucket);

  // المندوب رجّعه «جديد» بنفسه بعد الـ No Answer → يرجع Fresh
  const backToNew = buildWorkNumbers(
    [{ id: 'c-back', name: 'عميل', phone: PHONE, stage: 'new',
      activities: [
        { id: 'a3', type: 'stage', text: 'تغيير المرحلة: تم التواصل ← جديد', status: 'fresh-stage', at: '2026-11-01T12:50:00.000Z' },
        { id: 'a2', type: 'feedback', text: 'No answer', status: 'no-answer', at: T0 },
      ] }],
    [],
    feedbackByPhone([{ ...feedback('no-answer', T0), id: 'fa' }], [{ ...callLog('no-answer', T0), id: 'la' }])
  )[0];
  check('رجّعه «جديد» بإيده بعد No Answer → Fresh', backToNew?.bucket === 'fresh-stage', backToNew?.bucket);

  // No Answer بعد Meeting → يفضل Meeting (الخانة الجديدة للـ Fresh بس)
  const meetingNa = buildWorkNumbers(
    [],
    [{ id: 'l-m', name: 'رقم', phone: PHONE, status: 'contacted', salesId: 'u1' }],
    feedbackByPhone(
      [feedback('meeting', '2026-10-30T10:00:00.000Z'), { ...feedback('no-answer', '2026-11-02T10:00:00.000Z'), id: 'fm' }],
      [{ ...callLog('no-answer', '2026-11-02T10:00:00.000Z'), id: 'lm' }]
    )
  )[0];
  check('Meeting + No Answer بعدها → يفضل Meeting', meetingNa?.bucket === 'meeting', meetingNa?.bucket);

  // رقم موزّع جديد من غير أي مكالمة → Fresh
  const untouched = buildWorkNumbers([], [{ id: 'l-u', name: 'رقم', phone: '01009998887', status: 'new', salesId: 'u1' }], new Map())[0];
  check('رقم ما اتصلناش بيه خالص → Fresh', untouched?.bucket === 'fresh-stage', untouched?.bucket);

  for (const text of ['قالي اكلمه علي الساعة 8', 'في الشغل ساعة وارن عليه', 'عايز يبيع شقتو الاول']) {
    const snap = feedbackByPhone(
      [{ ...feedback('no-answer', T1card), id: 'fy', feedback: text }],
      [{ ...callLog('answered', T1), id: 'ly', comment: text }]
    );
    check(`«تم الرد» + كومنت «${text}» + No Answer في نفس الإجراء → Follow Up`, snap.get(PHONE)?.status === 'follow-up', snap.get(PHONE)?.status);
  }
}

// «Not Answer At All» مرحلة يختارها المندوب بنفسه
{
  const picked = buildWorkNumbers(
    [],
    [{ id: 'l-naa', name: 'رقم', phone: PHONE, status: 'contacted', salesId: 'u1' }],
    feedbackByPhone([{ ...feedback('not-answered', '2026-11-13T10:00:00.000Z'), id: 'f-naa' }], [])
  )[0];
  check('اختيار «Not Answer At All» → الرقم في خانتها', picked?.bucket === 'not-answered', picked?.bucket);
}

console.log(`\n✅ نجحت ${passed} فحوصات (انتقال الحالة من الفيدباك)`);
