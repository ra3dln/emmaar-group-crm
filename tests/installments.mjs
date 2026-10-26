// ===== فحوصات «حساب المقدم والأقساط» =====
// الحسبة المطلوبة: المقدم = المبلغ × النسبة، المتبقي = المبلغ − المقدم،
// والقسط الشهري = المتبقي ÷ (عدد السنين × ١٢). والأرقام نفسها اللي في الطلب:
// 20000 × 8% = 1600، 20000 − 1600 = 18400، 18400 ÷ 96 = 191.666…
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { installmentBreakdown, MONTHS_PER_YEAR, toAmount } from '../src/installments.ts';

const root = path.dirname(fileURLToPath(import.meta.url));
const read = (rel) => fs.readFileSync(path.join(root, '..', rel), 'utf8');

let passed = 0;
const check = (name, ok, extra = '') => {
  if (ok) {
    passed++;
    console.log(`✓ ${name}`);
  } else {
    console.error(`✗ ${name}${extra ? ` — ${extra}` : ''}`);
    process.exit(1);
  }
};

const near = (a, b) => Math.abs(a - b) < 1e-9;

// ===== ١) المثال المطلوب حرفياً =====
const example = installmentBreakdown(20000, 8, 8);
check('المقدم = 20000 × 8% = 1600', near(example.downPayment, 1600), String(example.downPayment));
check('المتبقي بعد المقدم = 18400', near(example.remaining, 18400), String(example.remaining));
check('عدد الأشهر = 8 × 12 = 96', example.months === 96, String(example.months));
check('القسط الشهري = 18400 ÷ 96 = 191.666…', near(example.monthly, 18400 / 96), String(example.monthly));
check('الحسبة مكتملة وتظهر للعرض', example.ready === true);
check('سنة كاملة = ١٢ شهر', MONTHS_PER_YEAR === 12);

// ===== ٢) مدخلات نصية من الحقول (فيها فواصل مسافات) =====
const typed = installmentBreakdown('20,000', '8', '8');
check('الفاصلة في المبلغ متتجاهلة', near(typed.downPayment, 1600) && near(typed.remaining, 18400));

// ===== ٣) حالات الحدود =====
const noPercent = installmentBreakdown(20000, 0, 8);
check('نسبة 0% ← مقدم صفر والمتبقي كامل', noPercent.downPayment === 0 && noPercent.remaining === 20000);
const noYears = installmentBreakdown(20000, 8, 0);
check('عدد سنين 0 ← مفيش قسط ولا أشهر', noYears.months === 0 && noYears.monthly === 0 && noYears.ready === false);
const empty = installmentBreakdown('', '', '');
check('حقول فاضية ← أصفار بلا NaN', empty.total === 0 && empty.months === 0 && empty.ready === false);
const negative = installmentBreakdown(-5000, -10, -2);
check('المدخلات السالبة بتتعامل كصفر', negative.total === 0 && negative.percent === 0 && negative.years === 0);
const over = installmentBreakdown(20000, 150, 1);
check('نسبة فوق 100% ما بتنزّلش المتبقي تحت الصفر', over.remaining === 0 && over.monthly === 0);
check('toAmount بيرفض النص غير الرقمي', toAmount('abc') === 0 && toAmount('1,500') === 1500);

// ===== ٤) سنة واحدة =====
const oneYear = installmentBreakdown(20000, 2, 1);
check('سنة واحدة: 12 شهر وقسط شهري = المتبقي ÷ 12', oneYear.months === 12 && near(oneYear.monthly, 19600 / 12));

// ===== ٥) التبويب موجود في الواجهة ومربوط بالحسبة =====
const app = read('src/App.tsx');
const types = read('src/types.ts');
check('نوع التبويب مضاف', /'calculator'/.test(types));
check('التبويب في القائمة الجانبية', /id: 'calculator', icon: Calculator, label: 'حساب المقدم والأقساط'/.test(app));
check('التبويب بيظهر للسيلز والإدارة', (app.match(/id: 'calculator'/g) || []).length >= 2);
check('التبويب بيعرض الشاشة', /activeTab === 'calculator' && <InstallmentCalculatorView \/>/.test(app));
check('الشاشة بتستخدم دالة الحسبة المشتركة', /installmentBreakdown\(total, percent, years\)/.test(app));
check('الحقول الثلاثة موجودة', ['المبلغ الكلي (ج.م)', 'المقدم (%)', 'عدد السنين'].every((l) => app.includes(l)));
check('مخرجات الحسبة معروضة', ['المقدم المدفوع', 'المبلغ بعد خصم المقدم', 'القسط الشهري', 'عدد الأشهر'].every((l) => app.includes(l)));

console.log(`\n✅ نجحت ${passed} فحوصات (حساب المقدم والأقساط)`);
