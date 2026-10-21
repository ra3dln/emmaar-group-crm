// ===== اختبار أسماء الفورمات وتقسيم «عملاء كامبين» و«توزيع الأرقام» =====
// يتحقق من:
//  ١) اسم الفورم يُقرأ صريحاً من السجل، أو من وصف الرقم القديم بلا اقتطاع
//     عند «|» أو «-» (فورم «GO ADS | CAVA» كان ينقسم لفورمين).
//  ٢) الفورمات المفعّلة في إعدادات السحب (فيسبوك + إنستجرام) تُجمع بلا تكرار.
//  ٣) الرقم المسحوب يحمل اسم فورمِه معه عند الحفظ (formName).
//  ٤) الواجهة تمرّر الفورمات المفعّلة إلى «عملاء كامبين» و«توزيع الأرقام».
//
// التشغيل: node tests/campaign-forms.mjs

import fs from 'node:fs';
import assert from 'node:assert/strict';
import { buildAssignments } from '../server/leadSource.js';

const { formNameOf, formKeyOf, activeFormNamesOf, UNKNOWN_FORM } = await import('../src/campaignForms.ts');

let passed = 0;
const check = (label, condition, extra = '') => {
  assert.ok(condition, `✗ ${label} ${extra}`);
  passed += 1;
  console.log(`✓ ${label}`);
};

// ===== ١) قراءة اسم الفورم =====
check('اسم الفورم الصريح أولاً', formNameOf({ formName: 'GO ADS | CAVA' }) === 'GO ADS | CAVA');
check(
  'الوصف القديم يُقرأ كاملاً',
  formNameOf({ description: 'استيراد تلقائي • المصدر: فيسبوك - فورم أكتوبر • التاريخ: 12/10/2026' }) === 'فورم أكتوبر'
);
check(
  'اسم فيه «|» لا يُقتطع',
  formNameOf({ description: 'استيراد تلقائي • المصدر: فيسبوك - GO ADS | CAVA • التاريخ: 21/10/2026' }) === 'GO ADS | CAVA'
);
check(
  'اسم فيه «-» لا يُقتطع',
  formNameOf({ source: 'رقم موزّع — المصدر: إنستجرام - Jazeel Residence - EAMAR - M' }) === 'Jazeel Residence - EAMAR - M'
);
check('اسم الفورم الصريح يغلب نص الوصف', formNameOf({ formName: 'فورم جديد', description: 'المصدر: فيسبوك - قديم' }) === 'فورم جديد');
check('سجل بلا فورم لا يعطي اسماً', formNameOf({ description: 'رقم موزّع' }) === '');
check('التجميع يسمّي السجل بلا فورم', formKeyOf({ description: 'إضافة يدوية' }) === UNKNOWN_FORM);

// ===== ٢) الفورمات المفعّلة =====
const activated = activeFormNamesOf({
  forms: [
    { id: '1', name: 'فورم أكتوبر' },
    { id: '2', name: 'GO ADS | CAVA' },
    { id: '3', name: '   ' },
  ],
  instagram: { forms: [{ id: '2', name: 'GO ADS | CAVA' }, { id: '4', name: 'فورم إنستجرام' }] },
});
check(
  'كل الفورمات المفعّلة تجتمع بلا تكرار',
  activated.length === 3 && activated.includes('فورم أكتوبر') && activated.includes('GO ADS | CAVA') && activated.includes('فورم إنستجرام'),
  JSON.stringify(activated)
);
check('إعداد بلا فورمات لا يرمي', activeFormNamesOf({}).length === 0 && activeFormNamesOf(null).length === 0);

// ===== ٣) اسم الفورم يُحفظ مع الرقم =====
const built = buildAssignments({
  fetched: [
    { phone: '01000000001', name: 'أول', source: 'فيسبوك - GO ADS | CAVA', formName: 'GO ADS | CAVA' },
    { phone: '01000000002', name: 'ثاني', source: 'فيسبوك - فورم أكتوبر', formName: '' },
  ],
  knownPhones: [],
});
check('الرقم المسحوب يحمل اسم فورمِه', built.added[0]?.formName === 'GO ADS | CAVA');
check('لا يُكتب مفتاح فورم فارغ', !('formName' in (built.added[1] || {})));
check('الأرقام تدخل غير مخصصة دائماً', built.added.every((lead) => lead.salesId === ''));

// ===== ٤) ربط الواجهة =====
const app = fs.readFileSync('src/App.tsx', 'utf8');
check('«عملاء كامبين» تستقبل الفورمات المفعّلة', app.includes('activeForms={activeCampaignForms}'));
check('قائمة الفورمات المسندلة في «عملاء كامبين»', app.includes('id="campaign-form-select"'));
check('قائمة الفورمات المسندلة في «توزيع الأرقام»', app.includes('id="lead-form-select"'));
check('التحديث التلقائي عند تفعيل فورم وحفظه', app.includes("new Event(ACTIVE_FORMS_EVENT)"));

console.log(`\n✅ نجحت ${passed} فحوصات لأسماء الفورمات وقوائمها`);
