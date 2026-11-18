// ===== اختبار رسالة «قاعدة البيانات موقوفة» في كارت سحب الأرقام =====
// الشكوى: «الداتا بيز فصلت بعد ما كانت شغالة» — والموقع كان بيعرض
// «على هذه الاستضافة لا توجد قاعدة بيانات مركزية» مع إن القاعدة موجودة
// وبياناتها سليمة، لكن Supabase وقّفتها مؤقتاً (تجاوز حد النقل/supabase 402).
//
// الاختبار يضمن إن الواجهة:
//   ١) بتقرا سبب فشل /api/lead-source (مش بس كود الحالة).
//   ٢) بتترجم exceed_egress_quota لرسالة مفهومة للإدارة.
//   ٣) بتعرض بانر «قاعدة البيانات المركزية موقوفة» بدل رسالة «مفيش قاعدة بيانات».
//   ٤) وبتفضل تشتغل محلياً (remote=false) لحد ما الخدمة ترجع.
//
// التشغيل: node tests/db-down-banner.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';

let passed = 0;
const check = (label, condition, extra = '') => {
  assert.ok(condition, `✗ ${label} ${extra}`);
  passed += 1;
  console.log(`✓ ${label}`);
};

const app = fs.readFileSync('src/App.tsx', 'utf8');

check('في دالة بتترجم سبب وقوف القاعدة', /const databaseIssueText = \(raw: string\)/.test(app));
check(
  'حد النقل (exceed_egress_quota) ليه رسالة مفهومة',
  /exceed_egress_quota\|egress/i.test(app) && app.includes('تجاوز حد النقل')
);
check('حد الإنفاق / الخطة ليه رسالة مفهومة', app.includes('حد الإنفاق'));
check('انتهاء الجلسة ليه رسالة مفهومة', app.includes('الجلسة انتهت — سجّل الدخول من جديد'));

// سبب الفشل لازم يتقرا من الرد، وإلا كل خطأ هايبقى «مفيش قاعدة بيانات»
check(
  'كارت القناة بيقرا نص خطأ السيرفر',
  /if \(!res\.ok\) throw new Error\(`\$\{res\.status\} \$\{await res\.text\(\)/.test(app)
);
check('وبيستخدم databaseIssueText عند الفشل', /setDbIssue\(databaseIssueText\(/.test(app));

// البانر الأحمر بيظهر بالسبب، ورسالة «مفيش قاعدة بيانات» ما تظهرش معاه
check('في بانر لقاعدة البيانات الموقوفة', app.includes('قاعدة البيانات المركزية موقوفة دلوقتي'));
check('وبيبان سبب المشكلة جواه', /\{dbIssue\}/.test(app));
check(
  'رسالة «مفيش قاعدة بيانات» بتتخفي لما يكون فيه سبب',
  app.includes('{remote === false && !dbIssue && (')
);
check('ولسه بيشتغل محلياً لما القاعدة تفصل', /setRemote\(false\);\s*\n\s*applyConfig\(localSourceView\(readLocalSource\(\)\)\);/.test(app));

console.log(`\n✅ نجحت ${passed} فحوصات (رسالة قاعدة البيانات الموقوفة)`);
