// ===== اختبار فهم الأرقام والغرف بالعربي =====
// التشغيل: node tests/arabic-numbers.mjs  (Node ≥ 23.6 يدعم تشغيل .ts مباشرة)
import assert from 'node:assert/strict';

const {
  arabicMoneyValue,
  arabicNumberValue,
  numberWordValue,
  roomsFromText,
  isArabicMoneyWord,
} = await import('../src/arabicNumbers.ts');

let passed = 0;
const check = (label, actual, expected) => {
  assert.equal(actual, expected, `✗ ${label}: المتوقع ${expected} — الناتج ${actual}`);
  passed += 1;
  console.log(`✓ ${label}`);
};

// ===== كلمات الأرقام =====
check('عشر = 10', numberWordValue('عشر'), 10);
check('خمستاشر = 15', numberWordValue('خمستاشر'), 15);
check('مية وعشرين = 120', arabicNumberValue('مية وعشرين'), 120);
check('ثلاث مية = 300', arabicNumberValue('ثلاث مية'), 300);
check('خمسة وتلاتين = 35', arabicNumberValue('خمسة وتلاتين'), 35);
check('مية وخمسين = 150', arabicNumberValue('مية وخمسين'), 150);

// ===== المبالغ بالحروف =====
check('عشر آلاف = 10,000', arabicMoneyValue('عشر آلاف'), 10_000);
check('عشره الاف = 10,000', arabicMoneyValue('عشره الاف'), 10_000);
check('عشرين ألف = 20,000', arabicMoneyValue('عشرين ألف'), 20_000);
check('مية ألف = 100,000', arabicMoneyValue('مية ألف'), 100_000);
check('مية وخمسين ألف = 150,000', arabicMoneyValue('مية وخمسين ألف'), 150_000);
check('مليون وميتين ألف = 1,200,000', arabicMoneyValue('مليون وميتين ألف'), 1_200_000);
check('نص مليون = 500,000', arabicMoneyValue('نص مليون'), 500_000);
check('ربع مليون = 250,000', arabicMoneyValue('ربع مليون'), 250_000);
check('مليون ونص = 1,500,000', arabicMoneyValue('مليون ونص'), 1_500_000);
check('مليونين = 2,000,000', arabicMoneyValue('مليونين'), 2_000_000);
check('3 مليون = 3,000,000', arabicMoneyValue('3 مليون'), 3_000_000);
check('1.5 مليون = 1,500,000', arabicMoneyValue('1.5 مليون'), 1_500_000);
check('ألفين = 2,000', arabicMoneyValue('ألفين'), 2_000);
check('10000 جنيه = 10,000', arabicMoneyValue('10000 جنيه'), 10_000);
check('10 آلاف جنيه = 10,000', arabicMoneyValue('10 آلاف جنيه'), 10_000);
check('بعشر آلاف = 10,000', arabicMoneyValue('بعشر آلاف'), 10_000);
check('بمية وخمسين ألف = 150,000', arabicMoneyValue('بمية وخمسين ألف'), 150_000);
check('بمليون = 1,000,000', arabicMoneyValue('بمليون'), 1_000_000);
check('للمليون = 1,000,000', arabicMoneyValue('للمليون'), 1_000_000);

// لا يُقرأ رقم الغرف أو المساحة كسعر
check('3 غرف ليست سعراً', arabicMoneyValue('3 غرف'), null);
check('120 متر ليست سعراً', arabicMoneyValue('120 متر'), null);

// ===== الغرف =====
check('غرفتين = 2', roomsFromText('شقة غرفتين'), 2);
check('أوضتين = 2', roomsFromText('شقة أوضتين'), 2);
check('3 غرف = 3', roomsFromText('شقة 3 غرف'), 3);
check('ثلاث غرف = 3', roomsFromText('شقة ثلاث غرف'), 3);
check('تلات غرف = 3', roomsFromText('شقة تلات غرف'), 3);
check('٢ غرف = 2', roomsFromText('شقة ٢ غرف'), 2);
check('غرفة واحدة = 1', roomsFromText('شقة غرفة واحدة'), 1);
check('غرفة نوم = 1', roomsFromText('شقة غرفة نوم'), 1);
check('غرف بلا رقم = null', roomsFromText('شقة غرف'), null);
check('غرفتين وحمام = 2', roomsFromText('شقة غرفتين وحمام'), 2);
check('بغرفتين = 2', roomsFromText('شقة بغرفتين'), 2);
check('بأوضتين = 2', roomsFromText('شقة بأوضتين'), 2);

check('ألف وحدة مالية', isArabicMoneyWord('ألف'), true);
check('مليون وحدة مالية', isArabicMoneyWord('مليون'), true);
check('غرف ليست وحدة مالية', isArabicMoneyWord('غرف'), false);

console.log(`\n✅ كل اختبارات فهم الأرقام والغرف نجحت (${passed}).`);
