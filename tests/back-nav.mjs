// ===== اختبار: الرجوع بخطوة واحدة (زرار الرجوع / السحب من حافة الشاشة) =====
// الطلب: «لما يدوس زر الرجوع (أو يسحب من الحافة) بيطلع نهائياً من البرنامج —
// عايز يرجع خطوة واحدة فقط».
// التشغيل: node tests/back-nav.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';

const { pickTopOverlay, runBack } = await import('../src/backNav.ts');

let passed = 0;
const check = (label, condition, extra = '') => {
  assert.ok(condition, `✗ ${label} ${extra}`);
  passed += 1;
  console.log(`✓ ${label}`);
};

// ===== عناصر وهمية تشبه الـ DOM =====
const fakeEl = (classes, zIndex, opts = {}) => ({
  classList: { contains: (c) => classes.includes(c) },
  style: { zIndex },
  getBoundingClientRect: () => ({ width: 390, height: 844 }),
  getAttribute: () => null,
  click: () => { opts.clicked?.(); },
  _hidden: !!opts.hidden,
});

const fakeDoc = (els) => ({
  querySelectorAll: (sel) => (sel === 'div.fixed.inset-0' ? els : []),
});

const fakeView = (hidden = []) => ({
  getComputedStyle: (el) => ({
    display: hidden.includes(el) || el._hidden ? 'none' : 'block',
    visibility: 'visible',
    zIndex: el.style.zIndex,
  }),
});

// ===== ١) أعلى نافذة مفتوحة =====
const root = fakeEl(['app-root', 'fixed', 'inset-0'], '200');
const low = fakeEl(['fixed', 'inset-0'], '50');
const high = fakeEl(['fixed', 'inset-0'], '95');
const hidden = fakeEl(['fixed', 'inset-0'], '99', { hidden: true });

check(
  'أعلى نافذة (z-index) هي اللي بتتقفل',
  pickTopOverlay(fakeDoc([root, low, high]), fakeView()) === high
);
check(
  'جذر التطبيق مش نافذة',
  pickTopOverlay(fakeDoc([root]), fakeView()) === null
);
check(
  'النافذة المخفية ماتتقفلش',
  pickTopOverlay(fakeDoc([root, hidden, low]), fakeView([hidden])) === low
);
check('مفيش نوافذ = مفيش حاجة تتقفل', pickTopOverlay(fakeDoc([]), fakeView()) === null);

// ===== ٢) خطوة واحدة: نقفل النافذة قبل أي حاجة تانية =====
let clicked = 0;
let fallbackRan = 0;
const target = fakeEl(['fixed', 'inset-0'], '90', { clicked: () => { clicked += 1; } });
const ok = runBack(() => { fallbackRan += 1; return true; }, fakeDoc([target]), fakeView());
check('الرجوع يقفل النافذة المفتوحة', ok === true && clicked === 1, `clicked=${clicked}`);
check('ومبيعملش حاجة تانية في نفس الخطوة', fallbackRan === 0);

const ok2 = runBack(() => { fallbackRan += 1; return true; }, fakeDoc([]), fakeView());
check('مفيش نافذة = الرجوع يرجع خطوة في التطبيق', ok2 === true && fallbackRan === 1);

// ===== ٣) التطبيق بيسجّل صفحة للـ history وبيمنع الخروج =====
const app = fs.readFileSync('src/App.tsx', 'utf8');
const backNav = fs.readFileSync('src/backNav.ts', 'utf8');

check(
  'التطبيق مركّب حارس الرجوع',
  /installBackGuard\(/.test(app) && /from '\.\/backNav'/.test(app)
);
check(
  'حارس الرجوع بضيف صفحة للـ history (عشان الرجوع يبقى جوّه البرنامج)',
  /history\.pushState\(\{ crmBack: Date\.now\(\) \}, ''\)/.test(backNav)
);
check(
  'بعد الرجوع بنرجّع صفحة الـ history (المستخدم مبيخرجش من البرنامج)',
  /runBack\(fallback, document, window\);/.test(backNav) && /push\(\);/.test(backNav)
);
check(
  'الرجوع بيقفل آخر نافذة مفتوحة بالضغط عليها',
  /overlay\.click\(\)/.test(backNav) && /querySelectorAll\('div\.fixed\.inset-0'\)/.test(backNav)
);
check(
  'لو مفيش نافذة: يرجع لصفحة «الأرقام» أو صفحة الحالة أو درج القائمة',
  /backStateRef\.current\.leadsOpen/.test(app) &&
    /backStateRef\.current\.statusBoard/.test(app) &&
    /backStateRef\.current\.sidebarOpen/.test(app)
);
check(
  'ولو مفيش حاجة تتقفل: المستخدم يفضل في البرنامج',
  /return false; \/\/ مفيش حاجة تتقفل — المستخدم يفضل في البرنامج/.test(app)
);

console.log(`\n✅ نجحت ${passed} فحوصات للرجوع بخطوة واحدة`);
