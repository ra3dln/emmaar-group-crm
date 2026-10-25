// ===== اختبار: التذكيرات المستحقة + شارة «اتأخر» لكل الأرقام المتأخرة =====
// الطلب:
//  • «التذكير في التأخير معمول على أحدث رقم — انا عايزو لكل الأرقام اللي اتأخرت»
//  • «التذكير بيتشال من قائمة تذكيرات مستحقة الآن بمجرد اخذ أكشن»
//  • «وشيل كلمة تم من تذكيرات مستحقة الآن — الديلاي ده مينفعش يروح غير لما يتاخد أكشن»
//
// التشغيل: node tests/reminder-due-list.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';

const { clientActionState, leadAlertState, actedAfterReminder } = await import('../src/reminders.ts');

let passed = 0;
const check = (label, condition, extra = '') => {
  assert.ok(condition, `✗ ${label} ${extra}`);
  passed += 1;
  console.log(`✓ ${label}`);
};

const HOUR = 60 * 60 * 1000;
const NOW = Date.now();
const AT = new Date(NOW - 6 * HOUR).toISOString();   // تذكير فات من ٦ ساعات
const LATER = new Date(NOW - 2 * HOUR).toISOString(); // تذكير فات من ساعتين
const ACTION = new Date(NOW - 1 * HOUR).toISOString(); // إجراء (مكالمة/كومنت)

// ===== ١) التذكير اللي اتعمل عليه إجراء يخرج من قائمة «مستحقة الآن» =====
const reminder = {
  id: 'r1',
  clientId: 'c1',
  clientPhone: '01001234567',
  clientName: 'عميل',
  dateTime: AT,
  createdAt: AT,
  isCompleted: false,
};
const clients = [{ id: 'c1', phone: '01001234567', activities: [] }];

check('تذكير من غير أي إجراء = لسه محتاج إجراء', !actedAfterReminder(reminder, clients, []));
check(
  'مكالمة بعد التذكير = اتعمل إجراء (التذكير يخرج من القائمة)',
  actedAfterReminder(reminder, clients, [{ clientPhone: '01001234567', createdAt: ACTION }])
);
check(
  'كلام على خط العميل بعد التذكير = اتعمل إجراء',
  actedAfterReminder(
    { ...reminder, id: 'r2' },
    [{ id: 'c1', phone: '01001234567', activities: [{ type: 'feedback', text: 'كلام', at: ACTION }] }],
    []
  )
);
check(
  'إجراء قبل التذكير مش بيلغي التذكير',
  !actedAfterReminder(reminder, clients, [{ clientPhone: '01001234567', createdAt: AT }])
);

// ===== ٢) شارة «اتأخر» على كل الأرقام المتأخرة =====
const client = { id: 'c1', phone: '01001234567', activities: [] };
const lateTwo = [
  { id: 'r1', clientId: 'c1', clientPhone: '01001234567', dateTime: AT, createdAt: AT },
  { id: 'r2', clientId: 'c1', clientPhone: '01001234567', dateTime: LATER, createdAt: LATER },
];
const state = clientActionState(client, lateTwo, [], NOW);
check('العميل عليه تذكيران متأخران = محتاج إجراء', state.needsAction === true);
check('وقت التأخير = أقدم تذكير فات (مش الأحدث بس)', state.dueAt === AT, state.dueAt);

// إجراء بعد التذكيرين = الشارة تروح
const actedBoth = clientActionState(
  client,
  lateTwo,
  [{ clientPhone: '01001234567', createdAt: ACTION }],
  NOW
);
check('إجراء بعد آخر تذكير = الشارة تروح', actedBoth.needsAction === false);

// إجراء في النص (بعد الأقدم وقبل الأحدث) = لسه في تذكير متأخر
const actedMiddle = clientActionState(
  client,
  lateTwo,
  [{ clientPhone: '01001234567', createdAt: new Date(NOW - 4 * HOUR).toISOString() }],
  NOW
);
check('إجراء في النص = لسه في تذكير متأخر واحد', actedMiddle.needsAction === true);

// رقم موزّع (مش عميل مسجّل) — نفس القاعدة
const leadState = leadAlertState(
  { id: 'l1', phone: '01007654321' },
  [{ id: 'r9', clientPhone: '01007654321', dateTime: AT, createdAt: AT }],
  [],
  NOW
);
check('الرقم الموزّع عليه تذكير متأخر = محتاج إجراء', leadState.needsAction === true);
check(
  'الرقم الموزّع اتصل عليه بعد التذكير = الشارة تروح',
  leadAlertState(
    { id: 'l1', phone: '01007654321' },
    [{ id: 'r9', clientPhone: '01007654321', dateTime: AT, createdAt: AT }],
    [{ clientPhone: '01007654321', createdAt: ACTION }],
    NOW
  ).needsAction === false
);

// ===== ٣) الواجهة: الشريط يعرض كل الأرقام المتأخرة + «تم» مش موجودة =====
const app = fs.readFileSync('src/App.tsx', 'utf8');
const dueRowStart = app.indexOf('className="due-row"');
const dueRowEnd = app.indexOf('</section>', dueRowStart);
const dueRow = dueRowStart === -1 ? '' : app.slice(dueRowStart, dueRowEnd > dueRowStart ? dueRowEnd : dueRowStart + 900);

check(
  'كلمة «تم» اتشالت من قائمة «تذكيرات مستحقة الآن»',
  dueRow.length > 0 && !dueRow.includes('>تم<'),
  dueRow.slice(0, 200)
);
check(
  'زرار الاتصال فضل في القائمة (الإجراء هو اللي بيخرج التذكير)',
  /onClick=\{\(\) => onActed\?\.\(reminder\.id\)\}/.test(dueRow)
);
check(
  'قائمة «مستحقة الآن» بتفلتر التذكيرات اللي اتعمل عليها إجراء',
  /\.filter\(\(r: Reminder\) => !actedAfterReminder\(r, clients, callLogs\)\)/.test(app)
);
check(
  'العدّاد في الشريط بيفلتر كمان',
  /\.filter\(\(r\) => !actedAfterReminder\(r, scopedClients, scopedCallLogs\)\)/.test(app)
);
check(
  'الشريط بيعرض كل الأرقام المتأخرة (مش الأحدث بس)',
  /متأخر: \{lateNames\.slice\(0, 3\)\.join\('، '\)\}/.test(app) &&
    /const lateNames = lateReminders/.test(app)
);

console.log(`\n✅ نجحت ${passed} فحوصات لقائمة المستحق وشارة «اتأخر»`);
