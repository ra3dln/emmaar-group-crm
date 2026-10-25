// ===== اختبار الواجهة على الهاتف (أندرويد/آيفون) =====
// الشكاوى المُبلَّغ عنها: «الواجهة لا تعمل والأزرار لا تعمل، والكتابة في
// اليوزر والباسورد لا تعمل». الأسباب المعروفة في الكود:
//
//   ١) حقل أصغر من 16px: iOS يكبّر الصفحة عند التركيز، فيزحلق الحقل تحت
//      الكيبورد وتبدو الكتابة معطّلة، والأزرار تختلّ عن مكانها.
//   ٢) transform على عنصر أب للحقول (motion.form): iOS لا يفعّل الكيبورد.
//   ٣) طبقة فوق الشاشة تبتلع كل لمسة (أنيميشن الدخول).
//   ٤) جدول يفيض أفقياً: زواياه (الأزرار) بره الشاشة لأن overflow-x مخفي.
//   ٥) أهداف لمس صغيرة (32-34px) ⇒ الضغطة بخطأ.
//
// التشغيل: node tests/mobile-ui.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';

let passed = 0;
const check = (label, condition, extra = '') => {
  assert.ok(condition, `✗ ${label} ${extra}`);
  passed += 1;
  console.log(`✓ ${label}`);
};

const html = fs.readFileSync('index.html', 'utf8');
const css = fs.readFileSync('src/index.css', 'utf8');
const app = fs.readFileSync('src/App.tsx', 'utf8');
const manifest = fs.readFileSync('public/manifest.webmanifest', 'utf8');

// ===== ١) الشاشة بتتمدد على عرض الجهاز =====
check(
  'الصفحة بتتمدد على عرض الشاشة (مش عرض ثابت)',
  /name="viewport"[\s\S]{0,200}width=device-width/.test(html) &&
    /initial-scale=1/.test(html) &&
    /viewport-fit=cover/.test(html)
);
check(
  'الكيبورد بيقّص المساحة المرئية على أندرويد (الحقل اللي بتكتب فيه يفضل باين)',
  /interactive-widget=resizes-content/.test(html)
);

// ===== ٢) حجم الخط بيتحدّد مع الشاشة (scale أوتوماتيك) =====
check(
  'حجم الخط الأساسي متغيّر مع عرض الشاشة (clamp)',
  /html\s*\{[\s\S]{0,400}font-size:\s*clamp\(/.test(css)
);
check(
  'مفيش حجم خط ثابت لل，推出 تكرار مع الـclamp',
  !/@media \(max-width: 900px\) \{\s*html \{ font-size:/.test(css)
);

// ===== ٣) حقول 16px على أي جهاز بلمس (شرط iOS) =====
const touchBlock = (() => {
  const i = css.indexOf('@media (hover: none) and (pointer: coarse)');
  return i === -1 ? '' : css.slice(i, i + 1600);
})();
check('فيه كتلة قواعد لأجهزة اللمس', touchBlock !== '');
check(
  'كل حقل 16px على الأقل على جهاز بلمس (iOS ما يكبّرش الصفحة)',
  /input, textarea, select \{ font-size: 16px !important; \}/.test(touchBlock)
);
check(
  'بلا تأخير 300ms ولا تكبير بالنقر المزدوج',
  /touch-action: manipulation/.test(touchBlock)
);
check(
  'أهداف لمس أكبر (40-44px) عشان الضغطة تصيب',
  /\.icon-btn \{ width: 40px; height: 40px; \}/.test(touchBlock) &&
    /\.side-link \{ min-height: 44px; \}/.test(touchBlock)
);

// ===== ٤) ما فيش transform على عنصر أب للحقول =====
check(
  'نموذج الدخول مش motion.form (ما فيش transform فوق الحقول)',
  !/<motion\.form/.test(app) && /<form\s+onSubmit=\{handleLogin\}/.test(app)
);
check(
  'اهتزاز خطأ الدخول بقى بالحدّ مش بالتحويل',
  app.includes("className={shake ? 'login-nudge' : ''}") && css.includes('@keyframes login-nudge')
);
check(
  'حقول الدخول مهيّأة لكيبورد الهاتف (بلا تصحيح تلقائي ولا تكبير)',
  app.includes('autoCapitalize="none"') && app.includes('autoCorrect="off"') && app.includes('spellCheck={false}')
);

// ===== ٥) ما فيش طبقة تبتلع اللمسات =====
check(
  'طبقة أنيميشن الدخول ما بتقبضش أي لمسة',
  /z-\[200\][^"']*pointer-events-none/.test(app)
);
check(
  'طبقة أنيميشن الدخول بتتشال لو اتأخرت (شبكة أمان)',
  /setTimeout\(\(\) => setLeaving\(true\), 5000\)/.test(app)
);

// ===== ٦) الجداول تنزلق جوّهها بدل ما تتقص =====
check('فيه أداة انزلاق أفقي للجداول', css.includes('.table-scroll') && css.includes('overflow-x: auto'));
check(
  'جدول معاينة الاستيراد داخل حاوية انزلاق',
  /className="max-h-64 overflow-y-auto[^"]*table-scroll"/.test(app)
);
check(
  'قاعدة التوزيع وشيت الفورمات ما بيقصّوش الشاشة',
  css.includes('.clients-table-wrap { overflow-x: auto; }')
);

// ===== ٧) النوافذ على الهاتف =====
check(
  'ارتفاع النافذة على الهاتف = ارتفاع الشاشة الحقيقي (dvh) عشان أزرارها توصل',
  /\.panel \{ max-height: 92dvh !important; \}/.test(css)
);
check(
  'أرضية الشاشة الآمنة محسوبة (نوتش آيفون)',
  css.includes('env(safe-area-inset-bottom')
);

// ===== ٨) التطبيق مثبّت: في وضع portrait كان محجوب =====
check('التطبيق يعمل في الوضعين طولي وعرضي', /"orientation":\s*"any"/.test(manifest));

// ===== ٩) كارت العميل: واتساب مباشر + وقت وفورم كل رقم + شريط الفيدباك بعد التواصل =====
check(
  'زر واتساب يفتح المحادثة مباشرة (بلا نافذة وسيطة)',
  !app.includes('WhatsAppComposer') && !app.includes('onClick={openWhatsApp}')
);
check(
  'زر واتساب رابط https (wa.me) حتى يختار النظام تطبيق واتساب المناسب',
  /const href = first \? waLink\(first\) : ''/.test(app) && app.includes('href={href || undefined}')
);
check('الخط الزمني اتشال من نافذة تفاصيل العميل', !/الخط الزمني الكامل للعميل/.test(app));
check(
  'شريط الفيدباك لا يظهر قبل أول تواصل مع العميل',
  app.includes('const hasContactedClient =') &&
    (app.match(/hasContactedClient\(client\)/g) || []).length >= 2
);
check(
  'وقت تسجيل الرقم في الكامبين مكتوب جمب الرقم زي اسم الفورم',
  app.includes('function CampaignTimeChip') &&
    (app.match(/<CampaignTimeChip at=/g) || []).length >= 5 &&
    css.includes('.cc-time')
);
check(
  'عدّاد التبويب ينزل صفر بمجرد الدخول على التبويب',
  /activeTab !== 'clients'[\s\S]{0,700}status: 'viewed' as const/.test(app)
);

// ===== ١٠) كومنت مباشر من علامة + جنب اسم الفورم =====
check(
  'علامة + جنب اسم الفورم في المراحل بتفتح صندوق فيدباك (حالة + كومنت) زي تبويب العملاء',
  app.includes('cc-note-add') &&
    (app.match(/<QuickNoteButton/g) || []).length >= 1 &&
    app.includes('إضافة فيدباك (حالة + كومنت)') &&
    css.includes('.cc-note-add')
);
check(
  'حالة الفيدباك مش إلزامية تتغير: بتتحفظ زي آخر فيدباك على العميل',
  app.includes('const statusId = composer.status ||') &&
    app.includes('const statusId = status || latestFeedbackStatusOf(client)') &&
    app.includes('هتتحفظ زي ما هي لو ما غيّرتهاش')
);
check(
  'الفيدباك اليومي للإدارة يقرأ بطاقات الفيدباك أيضاً (مش سجلات العملاء بس)',
  app.includes('function mergeDailyFeedbackCards') &&
    (app.match(/mergeDailyFeedbackCards\(/g) || []).length >= 3 &&
    app.includes('setFullFeedbacks(') &&
    app.includes('AdminFeedbackView')
);
check(
  'الكومنت المباشر يظهر تحت العميل في الكارت فوراً (سطر آخر كومنت)',
  app.includes("addClientActivity(client.id, 'feedback'") && app.includes('cc-lastfb')
);
check(
  'الفيدباك ينزل «الفيدباك اليومي» كبطاقة باسم كاتبه (مش اسم صاحب العميل)',
  /if \(\(type === 'feedback' \|\| type === 'comment'\) && !opts\?\.skipCard\)/.test(app) &&
    app.includes('userId: opts?.authorId || target.userId')
);
check(
  'الضغط على العميل يفتح فيدباكه وكومنتاته',
  app.includes('فيدباك العميل وكومنتاته') && app.includes('feedbackEntries')
);
check(
  'نفس الفيدباك مكتوب مرة واحدة في الكومنتات (دمج الحدث + بطاقة الفيدباك + كلام السيلز من المكالمة)',
  app.includes('dedupeComments(list)') &&
    app.includes('commentActivitiesOf(client)') &&
    // كلام المندوب من سجل المكالمات رجع (مع فلترة اللوجات الآلية)
    app.includes('isSystemOnlyText') &&
    app.includes('for (const l of (callLogs || []))')
);

console.log(`\n✅ نجحت ${passed} فحوصات لواجهة الهاتف`);
