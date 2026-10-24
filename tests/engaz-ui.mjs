// ===== اختبار إعادة هيكلة الواجهة (موديل ENGAZ) =====
// البنية الجديدة:
//   • «الرئيسية» = لوحة أرقام: شبكة عدّادات للحالات، والضغط على أي عدّاد
//     يفتح صفحة «الأرقام» مفلترة على الحالة.
//   • «الأرقام» (Leads) = كل الأرقام (عميل مسجّل أو رقم موزَّع) مع بحث
//     وفلاتر حالة، والضغط على الرقم يفتح نافذة الإجراء.
//   • «العملاء» = الأرقام اللي أضافها السيلز بنفسه فقط.
//   • التذكيرات: ما بقاش لها تبويب — بقت شارة برتقالية على الجرس + إشعار.
//   • شريط تنقل سفلي: الرئيسية / الأرقام / الفيدباك / المزيد.
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
const preview = bodyOf('DevPreview');

// ===== ١) القائمة: «الأرقام» بدل «التذكيرات» =====
check('في تبويب «الأرقام» في قوائم السيلز', /id: 'leads', icon: Share2, label: 'الأرقام'/.test(navGroups));
check('تبويب «التذكيرات» اتشال من القوائم', !/id: 'reminders'/.test(navGroups));
check('تبويب «العملاء» لسه موجود', /id: 'clients', icon: Users, label: 'العملاء'/.test(navGroups));
check('«المراحل» فضل في المتابعة (مش ضاع)', /id: 'pipeline', icon: Workflow, label: 'المراحل'/.test(navGroups));

// ===== ٢) لوحة الأرقام (الرئيسية) =====
check(
  'الرئيسية فيها شبكة عدّادات الحالات (زي ENGAZ)',
  /eg-dash-grid/.test(dash) && /DASH_CARDS\.map/.test(dash)
);
check(
  'العدّادات: كل الأرقام + جديد + مكالمات باردة + باقي الحالات',
  /label: 'كل الأرقام'/.test(app) &&
    /label: 'أرقام جديدة'/.test(app) &&
    /label: 'مكالمات باردة'/.test(app) &&
    /label: 'متابعة بعد المعاينة'/.test(app) &&
    /label: 'تم البيع'/.test(app) &&
    /label: 'حجز'/.test(app)
);
check(
  'الضغط على أي عدّاد يفتح صفحة «الأرقام» مفلترة على الحالة',
  /onOpenStatus=\{\(id: string\) => \{ setLeadsFilter\(id \|\| ''\); setActiveTab\('leads'\); \}\}/.test(app)
);
check(
  '«مكالمات باردة» = رقم ما اتصلنا بيه خالص',
  /const coldCalls = scopeNumbers\.filter/.test(dash) && /COLD_CALL_ID/.test(dash)
);

// ===== ٣) صفحة الأرقام (Leads) =====
check('صفحة الأرقام فيها بحث + فلاتر حالة + كروت', /eg-search/.test(leadsView) && /eg-filter/.test(leadsView) && /EngazLeadCard/.test(leadsView));
check('فلتر الحالة shared بين اللوحة والصفحة (useState في App)', /const \[leadsFilter, setLeadsFilter\] = useState/.test(app));
check(
  'فلاتر الحالة بالترتيب: كل الأرقام، جديد، مكالمات باردة، متابعة…',
  /LEAD_STATUS_ORDER = \[/.test(app) &&
    /'fresh-stage', COLD_CALL_ID, 'follow-up', 'meeting', 'after-meeting'/.test(app) &&
    /'reschedule', 'cancellation', 'no-answer', 'done-deal', 'reservation'/.test(app)
);
check('اسم الفورم مكتوب زي ما هو في الكارت', /formName: formNameOf\(record\)/.test(leadsView) && /eg-form/.test(card));
check('وقت التسجيل (الكامبين) ظاهر في الكارت', /dateLabel: campaignStamp\(time\.at\)/.test(leadsView) && /eg-date/.test(card));
check('الكارت فيه زرار اتصال + زرار واتساب', /eg-act is-call/.test(card) && /eg-act is-wa/.test(card));
check('الضغط على الرقم بيفتح نافذة الإجراء', /onOpen=\{\(\) => onOpen\(row\.client \|\| row\.lead, row\)\}/.test(leadsView));

// ===== ٤) نافذة الإجراء =====
check('نافذة الإجراء: شريط الأدوات فوق (زي ENGAZ)', /eg-sheet-tools/.test(sheet) && /eg-icon-btn is-primary/.test(sheet));
check('نافذة الإجراء: قائمة الحالة', /StatusMenu/.test(sheet) && /eg-row/.test(sheet));
check('نافذة الإجراء: حقل التاريخ + أزرار الموعد السريع', /eg-date-input/.test(sheet) && /بعد ساعة/.test(sheet) && /بعد ساعتين/.test(sheet) && /بكرة/.test(sheet) && /الأسبوع الجاي/.test(sheet));
check('نافذة الإجراء: تم الرد / لم يرد', /تم الرد/.test(sheet) && /لم يرد/.test(sheet) && /eg-seg/.test(sheet));
check('نافذة الإجراء: خانة الكومنت', /eg-textarea/.test(sheet) && /اكتب الكومنت هنا/.test(sheet));
check('نافذة الإجراء: آخر التعليقات بعدّاد', /آخر التعليقات/.test(sheet) && /eg-comment/.test(sheet) && /comments\.length/.test(sheet));
check('نافذة الإجراء: زر «إضافة إجراء»', /eg-submit/.test(sheet) && /إضافة إجراء/.test(sheet));
check('الاتصال الفعلي من جوه النافذة', /الاتصال بالعميل الآن/.test(sheet) && /href=\{`tel:\$\{client\.phone\}`\}/.test(sheet));
check(
  'التعليقات بتتبني من خط العميل + بطاقات الفيدباك + سجل المكالمات',
  /const commentsOfTarget =/.test(app) && /client\?\.activities/.test(app) && /digitsOfPhone\(f\?\.clientPhone\)/.test(app)
);

// ===== ٥) تبويب «العملاء»: الأرقام اليدوية فقط =====
check(
  '«العملاء» بيعرض الأرقام اليدوية بس (عميلCameras التلقائي مستثنى)',
  /manualClients = clients/.test(app) && /LEAD_CLIENT_ID_PREFIX/.test(app) && /clients=\{manualClients\}/.test(app)
);
check(
  '«العملاء» بيعرض الأرقام اللي أضافها السيلز (يدوية) بس',
  /manualLeads = assignedLeads\.filter/.test(app) && /isManualLead\(l\)/.test(app) && /leads=\{manualLeads\}/.test(app)
);
check('الرقم اليدوي بيتسجّل بعلامة manual', /manual: true/.test(app) && /manual\?: boolean/.test(types));

// ===== ٦) التذكيرات: شارة برتقالية بدل التبويب =====
check('شارة التذكيرات المتأخرة برتقالية على الجرس', /topbar-badge is-delay/.test(app) && /delayedRemindersCount/.test(app));
check('العدّاد = التذكيرات المتأخرة أو المستحقة', /!r\.isCompleted && \(r\.isDelayed \|\| isReminderDue\(r\)\)/.test(app));
check('التذكير لسه إشعار (مفيش تبويب بس)', /function RemindersView/.test(app) && /function AlarmBar/.test(app));
check('مركز الإشعارات لسه فيه تبويب التذكيرات', /id: 'reminders', label: 'التذكيرات'/.test(app));

// ===== ٧) شريط التنقل السفلي =====
check('شريط تنقل سفلي: الرئيسية / الأرقام / الفيدباك / المزيد', /eg-tabbar/.test(tabbar) && /label: 'الرئيسية'/.test(tabbar) && /label: 'الأرقام'/.test(tabbar) && /label: 'الفيدباك'/.test(tabbar) && /eg-tab-label">المزيد/.test(tabbar));
check('الشريط بيتبان على الموبايل بس', /@media \(max-width: 900px\) \{ \.eg-tabbar \{ display: flex; \} \}/.test(css));
check('المساحة تحت المحتوى متظبطة للشريط', /\.app-content \{ padding-bottom: calc\(84px \+ var\(--safe-bottom\)\); \}/.test(css));

// ===== ٨) الوقت: وقت الكامبين بالـUTC (زي ما هو مسجَّل في الفورم) =====
check('توقيت الرقم بيتعرض بـUTC (مش متغيّر بتوقيت الجهاز)', /getUTCHours\(\)/.test(app) && /getUTCMonth\(\) \+ 1/.test(app));
check('وقت التسجيل بيتقرأ من campaignAt/الوصف', /campaignTimeOf\(record\)/.test(leadsView));

// ===== ٩) الستايل =====
check('ستايل لوحة الأرقام موجود', /\.eg-dash-grid \{/.test(css) && /\.eg-dash-bar i \{/.test(css));
check('ستايل كارت الرقم موجود', /\.eg-card \{/.test(css) && /\.eg-chip \{/.test(css) && /\.eg-form \{/.test(css));
check('ستايل نافذة الإجراء موجود', /\.eg-sheet \{/.test(css) && /\.eg-seg \{/.test(css) && /\.eg-submit \{/.test(css));
check('ستايل الشريط السفلي موجود', /\.eg-tabbar \{/.test(css) && /\.eg-tab \{/.test(css));
check('لون «مكالمات باردة» مستقل', /\.fs-cold \{/.test(css));

// ===== ١٠) المعاينة المحلية (تطوير فقط — مش في الإنتاج) =====
check('معاينة الواجهة شغالة بس في وضع التطوير', /import\.meta\.env\.DEV/.test(app) && /DevPreview/.test(app));
check('المعاينة بتعرض الصفحات التلاتة', /preview=dashboard/.test(app) && /preview=leads/.test(app) && /preview=sheet/.test(app));

console.log(`\n✅ نجحت ${passed} فحوصات (إعادة هيكلة الواجهة على موديل ENGAZ)`);
