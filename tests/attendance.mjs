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

console.log(`\n✅ كل اختبارات الحضور والانصراف نجحت (${passed}).`);
