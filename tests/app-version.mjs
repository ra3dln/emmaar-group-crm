// ===== الموقع بيحدّث لوحده لما نسخة جديدة تنزل =====
// الشكوى: «تم الرد» فضل يقدّم يوم عند حسن بعد التصليح — جهازه كان فاتح نسخة قديمة.
// التشغيل: node tests/app-version.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';

const { bundleOf, isNewVersion } = await import('../src/appVersion.ts');
let passed = 0;
const check = (label, ok) => { assert.ok(ok, `✗ ${label}`); passed += 1; console.log(`✓ ${label}`); };

const html = '<script type="module" crossorigin src="/assets/index-CEMPCMxh.js"></script>';
check('بيقرا اسم ملف الواجهة من الصفحة', bundleOf(html) === '/assets/index-CEMPCMxh.js');
check('نفس النسخة ← مفيش تحديث', !isNewVersion('/assets/index-A.js', '/assets/index-A.js'));
check('نسخة جديدة ← تحديث', isNewVersion('/assets/index-A.js', '/assets/index-B.js'));
check('صفحة فاضية (خطأ) ← مفيش تحديث', !isNewVersion('/assets/index-A.js', bundleOf('')));
const app = fs.readFileSync('src/App.tsx', 'utf8');
check('التطبيق بيشغّل مراقبة النسخة', /useEffect\(\(\) => startVersionWatch\(\), \[\]\)/.test(app));
console.log(`\n✅ نجحت ${passed} فحوصات (التحديث التلقائي للنسخة)`);
