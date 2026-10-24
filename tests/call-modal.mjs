// ===== اختبار «نافذة رد / لم يرد» بدل الرنّ المباشر =====
// الطلب: لما المندوب يضغط علامة الاتصال في تبويب «المراحل» (follow up / meeting …)
// أو في تبويب «العملاء» — تظهر نافذة «تم الرد / لم يرد» (زي اللي موجودة أصلاً)،
// وميرنّش على العميل لوحده.
//
// القاعدة: كل كارت (عميل أو رقم موزَّع) يفتح نفس النافذة، والاتصال الفعلي
// (الرنّ) بيحصل من جوه النافذة بزر «الاتصال بالعميل الآن».
// والرقم الموزَّع لسه مش عميل: مكالمته بتتسجَّل برقمه (سجل مكالمات + بطاقة
// فيدباك) عشان ينتقل للمرحلة اللي اتفق عليها في لوحة «المراحل».
//
// التشغيل: node tests/call-modal.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';

let passed = 0;
const check = (label, condition, extra = '') => {
  assert.ok(condition, `✗ ${label} ${extra}`);
  passed += 1;
  console.log(`✓ ${label}`);
};

const app = fs.readFileSync('src/App.tsx', 'utf8');
const css = fs.readFileSync('src/index.css', 'utf8');
const types = fs.readFileSync('src/types.ts', 'utf8');

// نص دالة من ملف App.tsx (من أول سطر يبدأ بـ function لحد السطر الجاي)
const bodyOf = (name) => {
  const i = app.indexOf(`function ${name}(`);
  if (i === -1) return '';
  const j = app.indexOf('\nfunction ', i + 1);
  return app.slice(i, j === -1 ? app.length : j);
};

const card = bodyOf('ClientFeedbackCard');
const leadCard = bodyOf('LeadFeedCard');
const pipeline = bodyOf('PipelineView');
const statusBoard = bodyOf('StatusBoardView');
const clientsView = bodyOf('ClientsView');
const modal = bodyOf('CallFlowModal');
const saveCall = app.slice(
  app.indexOf('const handleSaveCall'),
  app.indexOf('setInAppNotification({', app.indexOf('const handleSaveCall'))
);

// ===== ١) الكارت الموحّد (عملاء + مراحل + صفحة الحالة) =====
// زر الاتصال = زرار يفتح النافذة، ومفيش رنّ مباشر (tel:) جواه.
check(
  'الكارت الموحّد: علامة الاتصال زرار بيفتح نافذة «رد / لم يرد»',
  /onClick=\{\(\) => onCall\?\.\(client\)\}/.test(card)
);
check(
  'الكارت الموحّد: مفيش اتصال مباشر (tel:) — الرقم مش بيرنّ لوحده',
  !/tel:/.test(card)
);check(
  'رقم الهاتف في الكارت بيفتح نفس النافذة (مش رنّ مباشر)',
  /className="cc-phone"[\s\S]{0,160}onCall\?\.\(client\)/.test(card)
);

// ===== ٢) كارت الرقم الموزَّع (لسه مش عميل) =====
check(
  'كارت الرقم الموزَّع: يفتح نفس النافذة',
  /onCall\?\.\(leadCallTarget\(lead, record\)\)/.test(leadCard)
);
check(
  'كارت الرقم الموزَّع: مفيش اتصال مباشر (tel:)',
  !/tel:/.test(leadCard)
);
check(
  'هدف الرقم الموزَّع معرّفه مشتق من الرقم (crm-lead-…) زي العميل التلقائي',
  /leadClientIdFor\(phone\)/.test(app) && /virtualLead: true/.test(app)
);

// ===== ٣) تبويب «العملاء» =====
// الكروت والجدول: نفس النافذة.
check(
  'تبويب «العملاء»: الكروت تمرّر onCall للكارت الموحّد',
  /onCall=\{onCall\}/.test(clientsView)
);
check(
  'تبويب «العملاء»: رقم الهاتف في الجدول بيفتح النافذة (مش رنّ)',
  /className="ct-phone"[\s\S]{0,220}onCall\?\./.test(clientsView) && !/href=\{`tel:\$\{phone\}`\}/.test(clientsView)
);
check(
  'تبويب «العملاء»: زر الاتصال في الجدول بيفتح النافذة',
  /onClick=\{\(\) => onCall\?\.\(client\)\}/.test(clientsView)
);

// ===== ٤) تبويب «المراحل» وصفحة الحالة (follow up / meeting …) =====
check(
  'تبويب «المراحل»: الكارت الموحّد بياخد onCall',
  /onCall=\{onCall\}/.test(pipeline)
);
check(
  'تبويب «المراحل»: كارت الرقم الموزَّع بياخد onCall',
  /onCall=\{onCall\}/.test(pipeline) && /LeadFeedCard[\s\S]{0,400}onCall=\{onCall\}/.test(pipeline)
);
check(
  'صفحة الحالة (follow up …): الكارت بياخد onCall',
  /onCall=\{onCall\}/.test(statusBoard)
);
check(
  'صفحة الحالة (follow up …): كارت الرقم الموزَّع بياخد onCall',
  /LeadFeedCard[\s\S]{0,400}onCall=\{onCall\}/.test(statusBoard)
);
check(
  'التطبيق يمرّر onCall لصفحة «المراحل» ولصفحة الحالة',
  /<PipelineView[\s\S]{0,1200}onCall=\{\(c: any\) => setCallClient\(c\)\}/.test(app) &&
    /<StatusBoardView[\s\S]{0,800}onCall=\{\(c: any\) => setCallClient\(c\)\}/.test(app)
);

// ===== ٥) النافذة نفسها: «Answered / No Answer» + الاتصال من جواها =====
check(
  'النافذة فيها نتيجتي Answered و No Answer',
  /Answered/.test(modal) && /No Answer/.test(modal)
);
check(
  'الاتصال الفعلي (الرنّ) من جوه النافذة: زر «Call now»',
  /Call now/.test(modal) && /href=\{`tel:\$\{client\.phone\}`\}/.test(modal)
);
check(
  'النافذة بتوضّح للرقم الموزّع إن المكالمة على الرقم نفسه',
  /client\.virtualLead/.test(modal)
);

// ===== ٦) حفظ مكالمة رقم موزَّع (لسه مش عميل مسجّل) =====
check(
  'حفظ المكالمة بيفرّق: عميل مسجّل (خط زمني) / رقم موزَّع (بطاقة فيدباك)',
  /isRegisteredClient/.test(saveCall) && /addClientActivity\(/.test(saveCall)
);
check(
  'الرقم الموزَّع: بطاقة فيدباك بالرقم (تظهر في «الفيدباك اليومي»)',
  /clientPhone: target\.phone/.test(saveCall) && /const card: DailyFeedback/.test(saveCall)
);
check(
  'الرقم الموزَّع: البطاقة بتترفع للقاعدة فوراً',
  /pushKey\('crm_daily_feedback'\)/.test(saveCall)
);
check(
  'الرقم الموزَّع: حالته في التوزيع تبقى «اتواصل»',
  /status: 'contacted' as const/.test(saveCall)
);
check(
  'سجل المكالمات بيتسجَّل بالرقم (المكالمة تتبعت للقاعدة)',
  /clientPhone: target\.phone/.test(saveCall)
);

// ===== ٧) الأنواع والستايل =====
check(
  'نوع هدف الاتصال (CallTarget) فيه علامة الرقم الموزَّع',
  /export interface CallTarget/.test(types) && /virtualLead\?: boolean/.test(types)
);
check(
  'رقم الهاتف في الكارت شكله زي ما كان (زبار مش نص عادي)',
  /\.cc-phone \{[\s\S]{0,400}cursor: pointer/.test(css)
);
check(
  'رقم الهاتف في الجدول شكله زي ما كان',
  /\.ct-phone button \{[\s\S]{0,300}cursor: pointer/.test(css)
);

console.log(`\n✅ نجحت ${passed} فحوصات (نافذة «رد / لم يرد» بدل الرنّ المباشر)`);
