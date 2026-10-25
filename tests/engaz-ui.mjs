// ===== اختبار إعادة هيكلة الواجهة (موديل ENGAZ) =====
// البنية الجديدة:
//   • «الرئيسية» = لوحة أرقام: شبكة عدّادات بالحالات (أسماء إنجليزي + ألوان
//     المراحل)، والضغط على أي عدّاد يفتح صفحة الأرقام مفلترة على الحالة —
//     وكل الأرقام بتتعمل من الرئيسية (مفيش تبويب «أرقام» ولا «فيدباك»).
//   • «عملائي» = الأرقام اللي أضافها السيلز بنفسه فقط.
//   • التذكيرات: ما بقاش لها تبويب — بقت شارة برتقالية على الجرس + إشعار.
//   • شريط تنقل سفلي: الرئيسية / عملائي / المزيد.
//
// التشغيل: node tests/engaz-ui.mjs

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
const buckets = fs.readFileSync('src/feedbackBuckets.ts', 'utf8');

const bodyOf = (name) => {
  const i = app.indexOf(`function ${name}(`);
  if (i === -1) return '';
  const j = app.indexOf('\nfunction ', i + 1);
  return app.slice(i, j === -1 ? app.length : j);
};

const navGroups = app.slice(app.indexOf('function getTabGroups('), app.indexOf('// ===== آخر صفحة فتحها كل مستخدم'));
const leadsView = bodyOf('LeadsView');
const card = bodyOf('EngazLeadCard');
const sheet = bodyOf('CallFlowModal');
const dash = bodyOf('DashboardView');
const tabbar = bodyOf('MobileTabBar');

// ===== ١) القائمة: «الرئيسية» + «عملائي» فقط (مفيش أرقام ولا فيدباك) =====
check('ما بقاش تبويب «الأرقام» — كل الأرقام بتتعمل من الرئيسية', !/id: 'leads'/.test(navGroups));
check('مفيش تبويب أرقام مستقل في الكود', !/activeTab === 'leads'/.test(app));
check('تبويب «الفيدباك» اتشال من القوائم', !/id: 'daily-feedback'/.test(navGroups));
check('تبويب «التذكيرات» اتشال من القوائم', !/id: 'reminders'/.test(navGroups));
check('«العملاء» بقى اسمه «عملائي»', /id: 'clients', icon: Users, label: 'عملائي'/.test(navGroups));
check('«المراحل» فضل في المتابعة (مش ضاع)', /id: 'pipeline', icon: Workflow, label: 'المراحل'/.test(navGroups));

// ===== ٢) العدّادات بتفتح صفحة الأرقام جوه الرئيسية =====
check(
  'الضغط على أي عدّاد يفتح صفحة الأرقام مفلترة على الحالة (من الرئيسية)',
  /setLeadsFilter\(id \|\| ''\); setLeadsOpen\(true\)/.test(app)
);
check('صفحة الأرقام ليها زرار رجوع للوحة', /eg-back/.test(leadsView) && /onBack/.test(leadsView));
check('نقطة «الأرقام» بتتعرض جوه تبويب الرئيسية', /leadsOpen \? \(/.test(app) && /<LeadsView/.test(app));

// ===== ٣) إنجليزي + ألوان المراحل =====
check(
  'أسماء الحالات بالإنجليزي (زي المراحل)',
  /'follow-up': 'Follow Up'/.test(app) &&
    /meeting: 'Meeting'/.test(app) &&
    /'after-meeting': 'Following after Meeting'/.test(app) &&
    /reschedule: 'Reschedule Meeting'/.test(app) &&
    /'no-answer': 'No Answer'/.test(app) &&
    /'done-deal': 'Done Deal'/.test(app) &&
    /reservation: 'Reservation'/.test(app)
);
check(
  'عدّادات اللوحة بالإنجليزي',
  /label: 'All Leads'/.test(app) &&
    /label: 'Fresh Leads'/.test(app) &&
    /label: 'Cold Calls'/.test(app) &&
    /label: 'Follow Up'/.test(app)
);
check(
  'ألوان الحالات هي ألوان المراحل نفسها (fs-*)',
  /FEEDBACK_STATUS_BY_ID\[bucket\]\?\.cls/.test(leadsView) &&
    /statusCls: cold \? 'fs-cold' : \(FEEDBACK_STATUS_BY_ID\[bucket\]\?\.cls \|\| 'fs-fresh'\)/.test(leadsView)
);
check(
  '«Cold Calls» فلتر خاص (رقم اتفتح وما اتصلناش فيه) والعدّاد زي اللوحة',
  /if \(filter === COLD_CALL_ID\) list = list\.filter\(\(row\) => row\.cold\)/.test(leadsView) &&
    /status: cold \? COLD_CALL_ID : bucket/.test(leadsView) &&
    /const cold = isColdNumber\(/.test(leadsView)
);

// ===== ٣‑ب) «Fresh Leads» و«Cold Calls» مبادلينش الأرقام =====
check(
  '«Fresh Leads» و«Cold Calls» عدّادين منفصلين في لوحة الأرقام',
  /const coldCalls = scopeNumbers\.filter\(\(record: any\) => isColdNumber\(record, calledPhones\)\)\.length/.test(dash) &&
    /const freshLeads = scopeNumbers\.filter\(/.test(dash) &&
    /card\.id === 'fresh-stage'\s*\n\s*\? freshLeads/.test(dash)
);
check(
  '«Cold Calls» = اتفتح وما اتصلناش · «Fresh Leads» = لسه ما اتفتحش',
  /export const isColdNumber = \(record: any, calledPhones: Set<string>\): boolean =>/.test(buckets) &&
    /if \(bucket !== 'fresh-stage'\) return false;/.test(buckets) &&
    /if \(calledPhones\.has\(digitsOfPhone\(record\?\.phone\)\)\) return false;/.test(buckets) &&
    /if \(typeof record\?\.opened === 'boolean'\) return record\.opened;/.test(buckets)
);
check(
  'الرقم اللي اتفتح من التوزيع (= viewed) يبقى مكالمة باردة',
  /lead\?\.status === 'viewed' \|\| lead\?\.status === 'contacted' \|\| !!lead\?\.viewedAt/.test(buckets)
);
check(
  'العميل اللي رقمه اتفتح (viewed) أو عليه كلام يبقى مكالمة باردة',
  /opened: openedBySales \|\| commentActs\.length > 0 \|\| !lead/.test(buckets)
);
check(
  'الرقم الواحد ما بيحسبش في الاتنين',
  /!isColdNumber\(record, calledPhones\)/.test(dash)
);
check(
  'نافذة الإجراء بالإنجليزي زي الصور',
  /Answered/.test(sheet) && /No Answer/.test(sheet) && /Add Action/.test(sheet) &&
    /Last comments/.test(sheet) && /Enter your comment here/.test(sheet) && /Call now/.test(sheet) &&
    /Next Action :/.test(sheet)
);
check('صفحة الأرقام بالإنجليزي (Lead Info / Search)', /<option value="all">Lead Info<\/option>/.test(leadsView) && /placeholder="Search…"/.test(leadsView));

// ===== ٤) صفحة الأرقام: بحث + فلاتر + كارت =====
check('صفحة الأرقام فيها بحث + فلاتر حالة + كروت', /eg-search/.test(leadsView) && /eg-filter/.test(leadsView) && /EngazLeadCard/.test(leadsView));
check(
  'فلاتر الحالة بالترتيب: All Leads، Fresh، Cold Calls، Follow Up…',
  /LEAD_STATUS_ORDER = \[/.test(app) &&
    /'fresh-stage', COLD_CALL_ID, 'follow-up', 'meeting', 'after-meeting'/.test(app) &&
    /'reschedule', 'cancellation', 'no-answer', 'done-deal', 'reservation'/.test(app)
);
check('اسم الفورم مكتوب زي ما هو في الكارت', /formName: formNameOf\(record\)/.test(leadsView) && /eg-form/.test(card));
check('وقت التسجيل (الكامبين) ظاهر في الكارت', /dateLabel: campaignStamp\(time\.at\)/.test(leadsView) && /eg-date/.test(card));
check('الكارت فيه زرار اتصال + زرار واتساب', /eg-act is-call/.test(card) && /eg-act is-wa/.test(card));
check('الضغط على الرقم بيفتح نافذة الإجراء', /onOpen=\{\(\) => onOpen\(row\.client \|\| row\.lead, row\)\}/.test(leadsView));

// ===== ٥) نافذة الإجراء =====
check('نافذة الإجراء: شريط الأدوات فوق (زي ENGAZ)', /eg-sheet-tools/.test(sheet) && /eg-icon-btn is-primary/.test(sheet));
check('نافذة الإجراء: قائمة الحالة', /StatusMenu/.test(sheet) && /eg-row/.test(sheet));
check(
  'نافذة الإجراء: حقل التاريخ + أزرار الموعد السريع',
  /eg-date-input/.test(sheet) && /After 1hr/.test(sheet) && /After 2hr/.test(sheet) && /Tomorrow/.test(sheet) && /Next week/.test(sheet)
);
check('نافذة الإجراء: Answered / No Answer', /Answered/.test(sheet) && /No Answer/.test(sheet) && /eg-seg/.test(sheet));
check('نافذة الإجراء: خانة الكومنت', /eg-textarea/.test(sheet));
check('نافذة الإجراء: آخر التعليقات بعدّاد', /Last comments/.test(sheet) && /eg-comment/.test(sheet) && /comments\.length/.test(sheet));
check('نافذة الإجراء: زر Add Action', /eg-submit/.test(sheet) && /Add Action/.test(sheet));
check(
  'التعليقات بتتبني من خط العميل + بطاقات الفيدباك + سجل المكالمات (كلام السيلز)',
  /const commentsOfTarget =/.test(app) &&
    /commentActivitiesOf\(client\)/.test(app) &&
    /digitsOfPhone\(f\?\.clientPhone\)/.test(app) &&
    /for \(const l of \(callLogs \|\| \[\]\)\)/.test(app)
);

// ===== ٦) تبويب «عملائي»: الأرقام اليدوية فقط =====
check(
  '«عملائي» بيعرض الأرقام اليدوية بس (العميل التلقائي مستثنى)',
  /manualClients = clients/.test(app) && /LEAD_CLIENT_ID_PREFIX/.test(app) && /clients=\{manualClients\}/.test(app)
);
check(
  '«عملائي» بيعرض الأرقام اللي أضافها السيلز (يدوية) بس',
  /manualLeads = assignedLeads\.filter/.test(app) && /isManualLead\(l\)/.test(app) && /leads=\{manualLeads\}/.test(app)
);
check('الرقم اليدوي بيتسجّل بعلامة manual', /manual: true/.test(app) && /manual\?: boolean/.test(types));

// ===== ٧) التذكيرات: شارة برتقالية بدل التبويب =====
check('شارة التذكيرات المتأخرة برتقالية على الجرس', /topbar-badge is-delay/.test(app) && /delayedRemindersCount/.test(app));
check('العدّاد = التذكيرات المتأخرة أو المستحقة', /!r\.isCompleted && \(r\.isDelayed \|\| isReminderDue\(r\)\)/.test(app));
check('التذكير لسه إشعار (مفيش تبويب بس)', /function RemindersView/.test(app) && /function AlarmBar/.test(app));
check('مركز الإشعارات لسه فيه تبويب التذكيرات', /id: 'reminders', label: 'التذكيرات'/.test(app));

// ===== ٨) شريط التنقل السفلي =====
check(
  'شريط تنقل سفلي: الرئيسية / عملائي / المزيد',
  /eg-tabbar/.test(tabbar) && /label: 'الرئيسية'/.test(tabbar) && /label: 'عملائي'/.test(tabbar) &&
    /eg-tab-label">المزيد/.test(tabbar) && !/label: 'الفيدباك'/.test(tabbar) && !/label: 'الأرقام'/.test(tabbar)
);
check('الشريط بيتبان على الموبايل بس', /@media \(max-width: 900px\) \{ \.eg-tabbar \{ display: flex; \} \}/.test(css));
check('المساحة تحت المحتوى متظبطة للشريط', /\.app-content \{ padding-bottom: calc\(84px \+ var\(--safe-bottom\)\); \}/.test(css));

// ===== ٩) انتقال الحالة: الفيدباك بالحالة هو الفيصل =====
check(
  'سجل المكالمات بيتقرأ قبل بطاقات الفيدباك (الحالة الصريحة هي الفيصل)',
  /for \(const log of callLogs \|\| \[\]\)/.test(buckets) &&
    buckets.indexOf('for (const log of callLogs') < buckets.indexOf('for (const feedback of feedbacks')
);
check(
  'حالة فارغة ما بتقدرش تمسح حالة معروفة',
  /if \(!snapshot\.status && prev\?\.status\)/.test(buckets)
);

// ===== ١٠) الوقت: وقت الكامبين بالـUTC (زي ما هو مسجَّل في الفورم) =====
check('توقيت الرقم بيتعرض بـUTC (مش متغيّر بتوقيت الجهاز)', /getUTCHours\(\)/.test(app) && /getUTCMonth\(\) \+ 1/.test(app));
check('وقت التسجيل بيتقرأ من campaignAt/الوصف', /campaignTimeOf\(record\)/.test(leadsView));

// ===== ١١) الستايل =====
check('ستايل لوحة الأرقام موجود', /\.eg-dash-grid \{/.test(css) && /\.eg-dash-bar i \{/.test(css));
check('ستايل كارت الرقم موجود', /\.eg-card \{/.test(css) && /\.eg-chip \{/.test(css) && /\.eg-form \{/.test(css));
check('ستايل نافذة الإجراء موجود', /\.eg-sheet \{/.test(css) && /\.eg-seg \{/.test(css) && /\.eg-submit \{/.test(css));
check('ستايل الشريط السفلي موجود', /\.eg-tabbar \{/.test(css) && /\.eg-tab \{/.test(css));
check('ستايل عنوان صفحة الأرقام موجود', /\.eg-leads-head \{/.test(css) && /\.eg-back \{/.test(css));
check('لون «مكالمات باردة» مستقل', /\.fs-cold \{/.test(css));
// وضع الاختصار (standalone) على آيفون: الارتفاع لازم يُقاس بالمساحة المرئية (dvh)
// لا بـ vh — وإلا زرار «Add Action» بيختفي تحت الشاشة والأزرار ما تشتغلش.
check('نافذة الإجراء بتقاس بارتفاع dvh (آيفون في وضع الاختصار)', /\.eg-sheet \{[^}]*max-height: 92dvh/.test(css));
check('المحتوى بيترك مساحة تحت شريط التنقل السفلي', /padding-bottom: calc\(84px \+ var\(--safe-bottom\)\)/.test(css));
check('الدرج الجانبي فوق شريط التنقل (مش متداخل)', /\.app-sidebar\.open|\.app-sidebar \{/.test(css) && /z-index: 110/.test(css));

// ===== ١٢) المعاينة المحلية (تطوير فقط — مش في الإنتاج) =====
check('معاينة الواجهة شغالة بس في وضع التطوير', /import\.meta\.env\.DEV/.test(app) && /DevPreview/.test(app));
check('المعاينة بتعرض الصفحات التلاتة', /preview=dashboard/.test(app) && /preview=leads/.test(app) && /preview=sheet/.test(app));

console.log(`\n✅ نجحت ${passed} فحوصات (إعادة هيكلة الواجهة على موديل ENGAZ)`);
