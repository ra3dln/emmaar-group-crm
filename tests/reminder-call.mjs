// ===== اختبار تسجيل الاتصال من التذكيرات (زرار ✓) =====
// المطلوب: الضغط على ✓ في التذكيرات يفتح تسجيل الاتصال بالعميل (تم الرد / لم يرد
// + كومنت زي تسجيل الفيدباك)، وبمجرد الحفظ ينزل الفيدباك ويتسجل والتذكير ينتهي.
//
// يُفحص في الكود:
//   ١) زرار ✓ ما بقاش ينهي التذكير فوراً — بيستدعي onLog.
//   ٢) فتح التسجيل يبني هدف اتصال من التذكير (عميل مسجّل أو رقم غير مسجّل).
//   ٣) الحفظ بينهي التذكير بعد تسجيل الفيدباك/المكالمة، ويرفع التغييرات للسيرفر.
//   ٤) حالة الفيدباك مش إلزامية في نافذة الاتصال (تفضل زي آخر فيدباك).
//
// التشغيل: node tests/reminder-call.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';

let passed = 0;
const check = (label, condition, extra = '') => {
  assert.ok(condition, `✗ ${label} ${extra}`);
  passed += 1;
  console.log(`✓ ${label}`);
};

const app = fs.readFileSync('src/App.tsx', 'utf8');

const remindersView = app.slice(app.indexOf('function RemindersView'), app.indexOf('function DailyFeedbackView'));
check(
  'زرار ✓ في التذكيرات بيفتح تسجيل الاتصال (مش إنهاء فوري)',
  /onClick=\{\(\) => onLog\(reminder\.id\)\}/.test(remindersView) &&
    !/onClick=\{\(\) => onComplete\(reminder\.id\)\}/.test(remindersView)
);
check(
  'عنوان الزرار بيوضح إنه تسجيل اتصال وإنهاء تذكير',
  remindersView.includes('تسجيل الاتصال (تم الرد / لم يرد) وإنهاء التذكير')
);
check(
  'التذكيرات بتستقبل onLog من الشاشة الرئيسية',
  /<RemindersView reminders=\{reminders\} onLog=/.test(app) && /startReminderCall\(target\)/.test(app)
);

check(
  'فتح التسجيل من التذكير يبني هدف الاتصال من بيانات التذكير',
  /const startReminderCall = \(reminder: Reminder\) => \{/.test(app) &&
    /id: reminder\.clientId \|\| leadClientIdFor\(reminder\.clientPhone\)/.test(app) &&
    /virtualLead: true/.test(app)
);

const saveCall = app.slice(app.indexOf('const handleSaveCall'), app.indexOf('const handleSaveCall') + 9000);
check(
  'الحفظ بيسجّل بطاقة الفيدباك والمكالمة (نفس مسار تسجيل الفيدباك)',
  saveCall.includes("addClientActivity(target.id, 'feedback'") && saveCall.includes('saveCallLogs([')
);
check(
  'الحفظ بيرفع المكالمات والعملاء للسيرفر',
  saveCall.includes("pushKey('crm_call_logs')") && saveCall.includes("pushKey('crm_clients')")
);
check(
  'التذكير بينتهي بعد الحفظ (isCompleted + رفع + تحديث الشاشة)',
  /if \(reminderCallId\) \{[\s\S]{0,800}isCompleted: true/.test(saveCall) &&
    /if \(reminderCallId\) \{[\s\S]{0,800}pushKey\('crm_reminders'\)/.test(saveCall) &&
    /if \(reminderCallId\) \{[\s\S]{0,800}loadData\(\)/.test(saveCall)
);
check(
  'إغلاق نافذة الاتصال بدون حفظ ما يخليش التذكير معلّقاً',
  /onClose=\{\(\) => \{ setCallClient\(null\); setReminderCallId\(null\); \}\}/.test(app)
);

const callModal = app.slice(app.indexOf('function CallFlowModal'), app.indexOf('function CallFlowModal') + 9000);
check(
  'نافذة الاتصال بتبدأ بحالة آخر فيدباك على العميل',
  callModal.includes('useState(() => latestFeedbackStatusOf(client) ||')
);
check(
  'الحفظ في نافذة الاتصال مش بيتطلب اختيار حالة جديدة',
  /const statusId = status \|\| latestFeedbackStatusOf\(client\) \|\| ''/.test(callModal) &&
    !/disabled=\{!status \|\|/.test(callModal)
);
check(
  'مسار التذكير ما بيقترحش موعد اتصال جديد تلقائياً',
  /if \(!fromReminder\)/.test(callModal) && /fromReminder=\{!!reminderCallId\}/.test(app)
);

console.log(`\n✅ كل اختبارات تسجيل الاتصال من التذكيرات نجحت (${passed}).`);
