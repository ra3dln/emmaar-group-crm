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

for (const action of ['discover', 'forms', 'run', 'reset']) {
  assert.ok(
    src.includes(`action: '${action}'`),
    `طلب «${action}» لازم يرسل action صريحاً إلى /api/lead-source`
  );
}

// ===== إعادة السحب من البداية: تسترجع أرقام الكامبين المفقودة =====
// تصفير المؤشرات يجعل الدورة القادمة تقرأ كل تاريخ النماذج، ومنع التكرار بالهاتف
// يعني أن المفقود فقط هو الذي يُضاف. البديل كان حذف الإعداد وإعادة ضبطه يدوياً.
const { resetChannelCursors } = await import('../server/leadSource.js');
const before = {
  enabled: true,
  cursorTime: 1760000000,
  formCursors: { 'form-1': 1760000000 },
  lastRun: { at: '2026-10-01T00:00:00.000Z' },
  instagram: { enabled: true, cursorTime: 1750000000, formCursors: { 'form-2': 1750000000 }, lastRun: { at: '2026-09-01T00:00:00.000Z' } },
};
const fbReset = resetChannelCursors(before, 'facebook');
assert.equal(fbReset.cursorTime, 0, 'مؤشر فيسبوك لازم يصفّر');
assert.deepEqual(fbReset.formCursors, {}, 'مؤشرات النماذج لازم تتصفّر');
assert.equal(fbReset.lastRun, null, 'آخر سحب يُمسح حتى لا يبدو حديثاً');
assert.equal(fbReset.enabled, true, 'الإعداد نفسه لا يُمسح');
assert.equal(fbReset.instagram.cursorTime, 1750000000, 'قناة إنستجرام لا تتأثر بإعادة سحب فيسبوك');
const igReset = resetChannelCursors(before, 'instagram');
assert.equal(igReset.instagram.cursorTime, 0, 'مؤشر إنستجرام يصفّر');
assert.equal(igReset.cursorTime, 1760000000, 'فيسبوك لا يتأثر بإعادة سحب إنستجرام');
assert.ok(
  fs.readFileSync(path.resolve('api/lead-source.js'), 'utf8').includes("action === 'reset'"),
  'الاستضافة لازم تعرف action=reset وإلا صار الزر بلا أثر'
);

console.log('✓ كل نداءات سحب الأرقام تذهب إلى /api/lead-source مع action صريح');
console.log('✓ إعادة السحب من البداية تصفّر المؤشرات وتسترجع المفقود');
