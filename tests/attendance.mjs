// ===== اختبار حسابات الحضور/الانصراف =====
// التشغيل: node tests/attendance.mjs
import assert from 'node:assert/strict';

const {
  ATTENDANCE_START_DEFAULT,
  ATTENDANCE_END_DEFAULT,
  ATTENDANCE_GRACE_DEFAULT,
  clockToMinutes,
  lateMinutes,
  earlyMinutes,
  clockLabel,
  attendanceDayRows,
  attendanceCellText,
} = await import('../src/attendance.ts');

let passed = 0;
const check = (label, actual, expected) => {
  assert.equal(actual, expected, `✗ ${label}: المتوقع ${expected} — الناتج ${actual}`);
  passed += 1;
  console.log(`✓ ${label}`);
};

// وقت محلي في يوم ثابت
const at = (hour, minute) => new Date(2026, 9, 18, hour, minute, 0).toISOString();

check('بداية الدوام الافتراضية 10:00', ATTENDANCE_START_DEFAULT, '10:00');
check('نهاية الدوام الافتراضية 18:00', ATTENDANCE_END_DEFAULT, '18:00');
check('سماحية التأخير الافتراضية 30', ATTENDANCE_GRACE_DEFAULT, 30);
check('10:30 = 630 دقيقة', clockToMinutes('10:30'), 630);

// الحضور
check('حضور 10:00 ليس تأخيراً', lateMinutes(at(10, 0)), 0);
check('حضور 10:29 داخل السماحية', lateMinutes(at(10, 29)), 0);
check('حضور 10:30 داخل السماحية', lateMinutes(at(10, 30)), 0);
check('حضور 10:31 = دقيقة تأخير', lateMinutes(at(10, 31)), 1);
check('حضور 11:15 = 45 دقيقة تأخير', lateMinutes(at(11, 15)), 45);
check('حضور 09:55 ليس تأخيراً', lateMinutes(at(9, 55)), 0);
check('بداية 09:00 + سماحية 30: حضور 10:20 = 50', lateMinutes(at(10, 20), '09:00', 30), 50);
check('سماحية 0: حضور 10:01 = دقيقة', lateMinutes(at(10, 1), '10:00', 0), 1);

// الانصراف
check('انصراف 18:00 ليس مبكراً', earlyMinutes(at(18, 0)), 0);
check('انصراف 18:05 ليس مبكراً', earlyMinutes(at(18, 5)), 0);
check('انصراف 17:59 = دقيقة مبكرة', earlyMinutes(at(17, 59)), 1);
check('انصراف 17:00 = 60 دقيقة مبكرة', earlyMinutes(at(17, 0)), 60);
check('بدون انصراف = 0', earlyMinutes(undefined), 0);

check('عرض 630 = 10:30', clockLabel(630), '10:30');
check('عرض null = —', clockLabel(null), '—');

// ===== تفاصيل الأيام بالتاريخ في التقرير الشهري =====
// أكتوبر 2026: يوم 1 خميس، يوم 2 جمعة (راحة)، يوم 3 سبت
const inAt = (day, h, m) => new Date(2026, 9, day, h, m, 0).toISOString();
const days = attendanceDayRows({
  year: 2026,
  month: 10,
  records: [
    { date: '2026-10-01', checkInAt: inAt(1, 10, 5), checkOutAt: inAt(1, 18, 0) },
    { date: '2026-10-03', checkInAt: inAt(3, 11, 0), checkOutAt: inAt(3, 17, 0) },
    { date: '2026-10-04', checkInAt: inAt(4, 10, 0) },
  ],
  restDay: '5',
  today: new Date(2026, 9, 5, 12, 0),
});
check('صف لكل يوم لحد النهارده (٥ أيام)', days.length, 5);
check('التاريخ مكتوب كتاريخ', days[0].date, '2026-10-01');
check('اسم اليوم جنب التاريخ', days[0].dayName, 'الخميس');
check('وقت الحضور', days[0].checkIn, '10:05');
check('يوم في الميعاد = حاضر', days[0].status, 'حاضر');
check('يوم الراحة من غير حضور = راحة', days[1].status, 'راحة');
check('متأخر وانصرف بدري', days[2].status, 'متأخر • انصراف مبكر');
check('دقائق التأخير بعد السماحية', days[2].late, 30);
check('حضور من غير انصراف', days[3].status, 'بلا انصراف');
check('يوم عمل من غير حضور = غياب', days[4].status, 'غياب');
check('ساعات العمل', days[0].workedHours, 7.9);
check('خانة يوم عادي في الإكسيل', attendanceCellText(days[0]), '10:05 - 18:00');
check('خانة يوم متأخر وانصرف بدري', attendanceCellText(days[2]), '11:00 - 17:00 • متأخر 30د • مبكر 60د');
check('خانة يوم بلا انصراف', attendanceCellText(days[3]), '10:00 - ؟ • بلا انصراف');
check('خانة الغياب', attendanceCellText(days[4]), 'غياب');
check('خانة الراحة', attendanceCellText(days[1]), 'راحة');
check('شهر لسه ما جاش = مفيش أيام', attendanceDayRows({ year: 2027, month: 1, records: [], today: new Date(2026, 9, 5) }).length, 0);

console.log(`\n✅ كل اختبارات الحضور والانصراف نجحت (${passed}).`);
