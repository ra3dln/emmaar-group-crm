// ===== اختبار هوية التطبيق على الهاتف (الاسم والأيقونة بعد التثبيت) =====
// الشكوى: «البرنامج على الهواتف لسه اسمه Emaar CRM واللوجو القديم لما أعمل install shortcut».
// السبب أن الاسم والأيقونة يُقرآن من المانيفست، وأي كاش قديم للمانيفست أو للأيقونة
// يُبقي الاختصار المثبّت على الهوية القديمة. الاختبار يضمن:
//
//   ١) الاسم داخل التطبيق وخارجه «MSA CRM» ولا أثر للاسم القديم في أي ملف.
//   ٢) المانيفست مربوط برابط جديد (?v=) في index.html — يجبر المتصفح على قراءته من جديد.
//   ٣) الأيقونات المعلنة في المانيفست موجودة فعلاً بالمقاسات الصحيحة.
//   ٤) عامل الخدمة له بصمة نسخة تتغيّر، فيتحدّث بدون حذف التطبيق.
//   ٥) الشعار داخل التطبيق هو صورة التطبيق الجديدة.
//
// التشغيل: node tests/app-identity.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';

let passed = 0;
const check = (label, condition, extra = '') => {
  assert.ok(condition, `✗ ${label} ${extra}`);
  passed += 1;
  console.log(`✓ ${label}`);
};

const html = fs.readFileSync('index.html', 'utf8');
const manifestText = fs.readFileSync('public/manifest.webmanifest', 'utf8');
const manifest = JSON.parse(manifestText);
const app = fs.readFileSync('src/App.tsx', 'utf8');
const push = fs.readFileSync('src/push.ts', 'utf8');
const sw = fs.readFileSync('public/sw.js', 'utf8');

// ===== ١) الاسم الجديد في كل مكان، والقديم ممسوح =====
check('عنوان الصفحة (تاب المتصفح) باسم MSA CRM', /<title>MSA CRM/.test(html));
check('اسم التطبيق المثبّت على آيفون MSA CRM', /apple-mobile-web-app-title" content="MSA CRM"/.test(html));
check('اسم المانيفست الكامل MSA CRM', manifest.name.startsWith('MSA CRM'));
check('الاسم المختصر على شاشة الهاتف MSA CRM', manifest.short_name === 'MSA CRM');
check('اسم التطبيق داخل الواجهة MSA CRM', app.includes('MSA CRM'));
check(
  'لا أثر للاسم القديم «إعمار/Emaar» في الواجهة أو الصفحة أو المانيفست',
  !/إعمار|Emaar|emaar/i.test(html) && !/إعمار|Emaar|emaar/i.test(manifestText) && !/Emaar CRM|إعمار جروب/.test(app)
);

// ===== ٢) المانيفست مربوط برابط جديد حتى لا يُقرأ من كاش قديم =====
check(
  'رابط المانيفست مُبصوم (?v=) في الصفحة',
  /rel="manifest" href="\/manifest\.webmanifest\?v=\d+"/.test(html)
);
check(
  'أيقونة التبويب وآيفون تشير للأسماء الجديدة',
  /rel="icon"[^>]*href="\/app-icon-192\.png\?v=\d+"/.test(html) &&
    /rel="apple-touch-icon" href="\/apple-touch-icon\.png\?v=\d+"/.test(html)
);
check(
  'معرّف التطبيق ثابت (id) حتى لا يتحوّل التحديث إلى تطبيق تاني',
  manifest.id === '/' && manifest.start_url === '/'
);

// ===== ٣) الأيقونات موجودة بالمقاسات الصح =====
const pngSize = (file) => {
  const buf = fs.readFileSync(file);
  assert.ok(buf.subarray(1, 4).toString() === 'PNG', `✗ ${file} مش صورة PNG`);
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
};
for (const icon of manifest.icons) {
  const file = `public${icon.src}`;
  check(`أيقونة المانيفست موجودة: ${icon.src}`, fs.existsSync(file));
  const [w, h] = icon.sizes.split('x').map(Number);
  const size = pngSize(file);
  check(`مقاس ${icon.src} صح (${w}x${h})`, size.w === w && size.h === h, `وجدنا ${size.w}x${size.h}`);
}
check(
  'فيه أيقونة maskable كاملة الحواف (أندرويد يقصّها زي ما يحب)',
  manifest.icons.some((icon) => icon.purpose === 'maskable' && icon.sizes === '512x512')
);

// ===== ٤) عامل الخدمة يتحدّث بلا إعادة تثبيت =====
check('عامل الخدمة له بصمة نسخة', /const SW_VERSION = '/.test(sw));
check('عامل الخدمة يستخدم الأيقونة الجديدة في الإشعارات', sw.includes("'/app-icon-192.png'"));
check('إشعارات الصفحة تستخدم الأيقونة الجديدة', push.includes("icon: '/app-icon-192.png'"));
check(
  'التطبيق يطلب تحديث عامل الخدمة عند الفتح وعند العودة',
  /reg && reg\.update\(\)/.test(app) && app.includes("visibilitychange")
);

// ===== ٥) الشعار داخل التطبيق هو صورة التطبيق الجديدة =====
check('الشعار داخل التطبيق هو الأيقونة الجديدة', app.includes('/msa-app-icon.png'));
check('صورة الأيقونة داخل التطبيق موجودة', fs.existsSync('public/msa-app-icon.png'));

console.log(`\n✅ نجحت ${passed} فحوصات لهوية التطبيق على الهاتف`);
