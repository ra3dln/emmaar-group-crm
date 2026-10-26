// ===== فحوصات «حساب المقدم والأقساط» =====
// الحسبة المطلوبة: المقدم = المبلغ × النسبة، المتبقي = المبلغ − المقدم،
// والقسط الشهري = المتبقي ÷ (عدد السنين × ١٢). والأرقام نفسها اللي في الطلب:
// 20000 × 8% = 1600، 20000 − 1600 = 18400، 18400 ÷ 96 = 191.666…
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { areaTotal, caretAfterGrouping, digitsOnly, groupThousands, installmentBreakdown, MONTHS_PER_YEAR, normalizeArea, toAmount } from '../src/installments.ts';

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

// ===== ٥) فواصل الآلاف في حقل المبلغ =====
check('المليون بيتكتب بفواصل: 1,600,000', groupThousands('1600000') === '1,600,000', groupThousands('1600000'));
check('عشرين ألف: 20,000', groupThousands('20000') === '20,000');
check('أقل من ألف من غير فاصلة', groupThousands('950') === '950');
check('حقل فاضي يفضل فاضي', groupThousands('') === '');
check('الأصفار اللي في الأول بتتشال', groupThousands('0001600000') === '1,600,000', groupThousands('0001600000'));
check('القيمة المحفوظة أرقام فقط (الفاصلة بتتشال)', digitsOnly('1,600,000') === '1600000');
check('المؤشر بيفضل بعد نفس الرقم عند الإضافة', caretAfterGrouping('20,000', 2) === 2);
check('المؤشر بيتظبط في وسط الرقم الكبير', caretAfterGrouping('1,600,000', 7) === 9, String(caretAfterGrouping('1,600,000', 7)));
check('المؤشر في آخر الرقم', caretAfterGrouping('1,600,000', 7) === 9 && caretAfterGrouping('950', 3) === 3);

// ===== ٦) الفواصل مش بتغيّر نتيجة الحسبة =====
const big = installmentBreakdown('1,600,000', 8, 8);
check('مليون و٦٠٠ ألف: المقدم 128,000', near(big.downPayment, 128000), String(big.downPayment));
check('مليون و٦٠٠ ألف: المتبقي 1,472,000', near(big.remaining, 1472000), String(big.remaining));
check('مليون و٦٠٠ ألف: القسط = 1,472,000 ÷ 96', near(big.monthly, 1472000 / 96), String(big.monthly));

// ===== ٧) إجمالي سعر الشقة من المساحة (اختياري) =====
check('سعر المتر × المساحة: 25,000 × 120 = 3,000,000', areaTotal('25000', '120') === 3000000, String(areaTotal('25000', '120')));
check('الفواصل في سعر المتر مش بتلخبط الحسبة', areaTotal('25,000', '120') === 3000000);
check('مساحة بكسر عشري: 25,000 × 120.5', areaTotal('25000', '120.5') === 3012500, String(areaTotal('25000', '120.5')));
check('لو سعر المتر فاضي ← صفر (يستخدم المبلغ الكلي)', areaTotal('', '120') === 0);
check('لو المساحة فاضية ← صفر (يستخدم المبلغ الكلي)', areaTotal('25000', '') === 0);
check('لو الاتنين فاضيين ← صفر', areaTotal('', '') === 0);
check('مساحة فيها حروف بتتنضف', areaTotal('25000', '1a2b0') === 3000000, String(areaTotal('25000', '1a2b0')));
check('المساحة العشرية: رقمين بعد العلامة', normalizeArea('120.567') === '120.56', normalizeArea('120.567'));
check('نقطة زيادة في المساحة بتتشال', normalizeArea('1.2.3') === '1.23');
check('المساحة العادية زي ما هي', normalizeArea('120') === '120');

// نفس مثال الطلب لكن من المساحة: 25,000 × 120 = 3,000,000 ثم مقدم 8% و8 سنين
const fromAreaCalc = installmentBreakdown(areaTotal('25000', '120'), 8, 8);
check('من المساحة: المقدم = 240,000', near(fromAreaCalc.downPayment, 240000), String(fromAreaCalc.downPayment));
check('من المساحة: المتبقي = 2,760,000', near(fromAreaCalc.remaining, 2760000), String(fromAreaCalc.remaining));
check('من المساحة: القسط = 2,760,000 ÷ 96', near(fromAreaCalc.monthly, 2760000 / 96), String(fromAreaCalc.monthly));
check('إجمالي المساحة بيدخل الحسبة بدل المبلغ المكتوب', fromAreaCalc.total === 3000000);

// ===== ٧ب) الدفعات السنوية (اختياري) =====
const withYearly = installmentBreakdown(20000, 8, 8, ['10', '20', '10']);
check('الدفعات السنوية: المجموع 10+20+10 = 40%', near(withYearly.annualPercent, 40), String(withYearly.annualPercent));
check('الدفعات السنوية بالجنيه: 2,000 + 4,000 + 2,000 = 8,000', near(withYearly.annualTotal, 8000), String(withYearly.annualTotal));
check('المتبقي = 20,000 − 1,600 مقدم − 8,000 دفعات = 10,400', near(withYearly.remaining, 10400), String(withYearly.remaining));
check('القسط = 10,400 ÷ 96', near(withYearly.monthly, 10400 / 96), String(withYearly.monthly));
check('الدفعات محسوبة واحدة واحدة', withYearly.annualPayments.join(',') === '2000,4000,2000', withYearly.annualPayments.join(','));

const noYearly = installmentBreakdown(20000, 8, 8, ['', '', '']);
check('دفعات فاضية ← الحسبة زي ما هي', near(noYearly.remaining, 18400) && noYearly.annualTotal === 0);
check('دفعات فاضية ← مفيش نسب محسوبة', noYearly.annualPercents.length === 0 && noYearly.annualPercent === 0);
check('من غير ما تبعت الدفعات خالص ← نفس الحسبة', near(installmentBreakdown(20000, 8, 8).remaining, 18400));

const oneYearly = installmentBreakdown(20000, 0, 1, ['', '25', '']);
check('دفعة واحدة بس: 25% من 20,000 = 5,000', oneYearly.annualTotal === 5000 && oneYearly.remaining === 15000);
check('القسط بيوزع المتبقي بعد الدفعة', near(oneYearly.monthly, 15000 / 12));

const yearlyOver = installmentBreakdown(20000, 20, 1, ['100']);
check('مجموع المقدم والدفعات فوق المبلغ ← المتبقي صفر', yearlyOver.remaining === 0 && yearlyOver.monthly === 0);

// ===== ٨) التبويب موجود في الواجهة ومربوط بالحسبة =====
const app = read('src/App.tsx');
const types = read('src/types.ts');
check('نوع التبويب مضاف', /'calculator'/.test(types));
check('التبويب في القائمة الجانبية', /id: 'calculator', icon: Calculator, label: 'حساب المقدم والأقساط'/.test(app));
check('التبويب بيظهر للسيلز والإدارة', (app.match(/id: 'calculator'/g) || []).length >= 2);
check('التبويب بيعرض الشاشة', /activeTab === 'calculator' && <InstallmentCalculatorView \/>/.test(app));
check('الشاشة بتستخدم دالة الحسبة المشتركة', /const calc: InstallmentBreakdown = installmentBreakdown\(/.test(app));
check('الحقول الثلاثة موجودة', ['المبلغ الكلي (ج.م)', 'المقدم (%)', 'عدد السنين'].every((l) => app.includes(l)));
check('مخرجات الحسبة معروضة', ['المقدم المدفوع', 'المبلغ بعد خصم المقدم', 'القسط الشهري', 'عدد الأشهر'].every((l) => app.includes(l)));
check('حقل المبلغ بيعرض الفواصل وأنت بتكتب', app.includes('groupThousands(total)'));
check('حقل سعر المتر كمان بفواصل', app.includes('groupThousands(pricePerMeter)'));
check('حقل المبلغ نصي (عشان يقبل الفاصلة)', /inputMode="numeric"/.test(app));
check('الكتابة بتتحفظ أرقاماً فقط', /const digits = digitsOnly\(input\.value\)/.test(app));
check('حقل سعر المتر موجود', app.includes('سعر المتر (ج.م)'));
check('حقل مساحة الشقة موجود', app.includes('مساحة الشقة (م²)'));
check('الخانتان اختياريتان وبتتحسب منهم الحسبة', /const computedTotal = areaTotal\(pricePerMeter, area\)/.test(app));
check('لو الخانتين مليانين المبلغ الكلي بيتحسب منهم', /installmentBreakdown\(fromArea \? computedTotal : total, percent, years/.test(app));
check('حقل المبلغ بيتقفل لما يتحسب من المساحة', /disabled=\{fromArea\}/.test(app));
check('إجمالي سعر الشقة معروض', app.includes('إجمالي سعر الشقة'));
check('خانات الدفعات السنوية الثلاثة موجودة', ['الدفعة السنوية ١ (%)', 'الدفعة السنوية ٢ (%)', 'الدفعة السنوية ٣ (%)'].every((l) => app.includes(l)));
check('الدفعات السنوية بتدخل الحسبة', /installmentBreakdown\(fromArea \? computedTotal : total, percent, years, yearly\)/.test(app));
check('قيمة كل دفعة سنوية معروضة بالجنيه', app.includes('annualPayments[i]'));
check('المتبقي بيوضح خصم الدفعات', app.includes('المبلغ بعد خصم المقدم والدفعات'));

console.log(`\n✅ نجحت ${passed} فحوصات (حساب المقدم والأقساط)`);
