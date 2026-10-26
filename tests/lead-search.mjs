// ===== اختبار بحث أرقام السيلز (شاشة Leads / ENGAZ) =====
// الخطأ اللي كان بيخلي البحث «مش شغال»: التليفون كان بيتقارن بالبحث بعد شيل الحروف،
// فبحث زي «Eman» يبقى سلسلة أرقام فاضية، و`"0100…".includes("")` صحيحة دايماً،
// فكل الأرقام تفضل معروضة. الفحوصات هنا تمنع رجوع الخطأ ده.
//
// التشغيل: node tests/lead-search.mjs

import assert from 'node:assert/strict';

const { matchLeadSearch } = await import('../src/leadSearch.ts');

let passed = 0;
const check = (label, condition, extra = '') => {
  assert.ok(condition, `✗ ${label} ${extra}`);
  passed += 1;
  console.log(`✓ ${label}`);
};

const rows = [
  { name: 'Eman Rehan', phone: '01111711986', formName: 'EMaar X GKAF' },
  { name: 'Emad Galal El-Baz', phone: '01008006644', formName: 'EMaar X GKAF' },
  { name: 'Mohamed Kasem', phone: '01000000003', formName: 'فورم أكتوبر' },
  { name: 'أحمد سيلز', phone: '٠١٢٣٤٥٦٧٨٩', formName: 'GO ADS | CAVA' },
  { name: 'سارة سيلز', phone: '01555555555', formName: 'فورم أكتوبر' },
];
const search = (query, field = 'all') => rows.filter((row) => matchLeadSearch(row, query, field));

// ===== ١) الخطأ الأصلي: بحث بالاسم كان بيرجّع كل الأرقام =====
check('بحث باسم يرجع صاحب الاسم فقط', search('Eman').length === 1 && search('Eman')[0].name === 'Eman Rehan');
check('بحث باسم تاني مش بيطابق الاسم الأول', !search('Eman').some((row) => row.name.includes('Emad')));
check('حروف فقط ما بتطابقش التليفون', search('zzz').length === 0);
check('بحث كامل بالاسم', search('Emad Galal El-Baz').length === 1);

// ===== ٢) تطبيع الحروف العربية =====
check('«احمد» تلاقي «أحمد»', search('احمد').length === 1);
check('«ساره» تلاقي «سارة»', search('ساره').length === 1);
check('البحث مش حساس لحالة الحروف الإنجليزية', search('eman rehan').length === 1);

// ===== ٣) البحث بالأرقام =====
check('جزء من الرقم يلاقيه', search('0111').length === 1 && search('0111')[0].name === 'Eman Rehan');
check('الرقم كامل يلاقيه', search('01008006644').length === 1);
check('أرقام عربية (٠١٢٣) تتقارن صح', search('٠١٢٣٤٥').length === 1);
check('رقم مش موجود مفيش نتايج', search('099999').length === 0);

// ===== ٤) اختيار الحقل =====
check('حقل الاسم ما يطابقش رقم', search('0111', 'name').length === 0);
check('حقل التليفون ما يطابقش اسم', search('Eman', 'phone').length === 0);
check('حقل الفورم يلاقي اسم الفورم', search('فورم أكتوبر', 'form').length === 2);
check('حقل الفورم ما يطابقش اسم عميل', search('Eman', 'form').length === 0);
check('«كل البيانات» تبحث في الاسم والفورم والتليفون', search('GKAF').length === 2);

// ===== ٥) الحالات الحدّية =====
check('بحث فاضي يعرض كل الأرقام', search('').length === rows.length);
check('مسافات فقط تعرض كل الأرقام', search('   ').length === rows.length);
check('صف بلا بيانات لا يرمي', matchLeadSearch({}, 'x') === false && matchLeadSearch(null, '') === true);

console.log(`\n✅ نجحت ${passed} فحوصات لبحث أرقام السيلز`);
