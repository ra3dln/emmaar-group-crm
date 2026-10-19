// ===== حماية من رجوع خطأ «ذا بيدج كود نوت بي فاوند» =====
// الاستضافة تنشر ملفاً واحداً api/lead-source.js على المسار /api/lead-source فقط،
// والتفريق بين العمليات داخل الطلب عبر action. أي نداء لمسار فرعي
// (/api/lead-source/discover أو /run …) يرجّع صفحة 404 نصية من Vercel،
// فتفشل قراءة JSON برسالة «Unexpected token 'T', "The page c"...».
// الاختبار يقرأ الواجهة نفسها ويمنع رجوع هذا النداء.

import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const file = path.resolve('src/App.tsx');
const raw = fs.readFileSync(file, 'utf8');
// نستبعد التعليقات: كلمة المسار قد تُذكر في تعليق شرح دون أن تُنفَّذ
const src = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

const subpaths = src.match(/\/api\/lead-source\/[A-Za-z-]+/g) || [];
assert.deepEqual(
  [...new Set(subpaths)],
  [],
  `مسارات فرعية غير منشورة على الاستضافة: ${[...new Set(subpaths)].join('، ')} — استخدم /api/lead-source مع action`
);

for (const action of ['discover', 'forms', 'run']) {
  assert.ok(
    src.includes(`action: '${action}'`),
    `طلب «${action}» لازم يرسل action صريحاً إلى /api/lead-source`
  );
}

console.log('✓ كل نداءات سحب الأرقام تذهب إلى /api/lead-source مع action صريح');
