// ===== تبويب «إضافة فورم»: قراءة الشيت بدقة + الفورم اليدوي + الحذف =====
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const read = (rel) => fs.readFileSync(path.join(root, '..', rel), 'utf8');
const app = read('src/App.tsx');
const view = read('src/ManualFormsView.tsx');
const sync = read('src/sync.ts');

const { buildPreview, normalizeEgyptPhone } = await import('../src/leadImport.ts');
const { plainNumberText } = await import('../src/xlsx.ts');
const { buildManualForm, formNameTaken, planManualFormDeletion, withManualTag, parseManualForms } = await import('../src/manualForms.ts');
const { leadClientIdFor } = await import('../shared/leadClients.js');

let passed = 0;
const check = (name, ok, extra = '') => {
  assert.ok(ok, `✗ ${name} ${extra}`);
  passed++;
  console.log(`✓ ${name}`);
};

// ===== ١) الرقم بأي صيغة =====
check('+20', normalizeEgyptPhone('+201001234567') === '01001234567');
check('رقم من غير صفر (إكسل شاله)', normalizeEgyptPhone('1001234567') === '01001234567');
check('أرقام عربية', normalizeEgyptPhone('٠١٠٠١٢٣٤٥٦٧') === '01001234567');
check('فيه .0 من إكسل', normalizeEgyptPhone('1001234567.0') === '01001234567');
check('رقم إكسل المقرّب (ضاعت خاناته) يبقى غير صالح', normalizeEgyptPhone('2.01001E+11') === '');
check('القيمة الكاملة المخزّنة بصيغة E بترجع رقم عادي', plainNumberText('2.01001234567E11') === '201001234567');
check('القيم العادية ما بتتغيرش', plainNumberText('أحمد') === 'أحمد' && plainNumberText('15') === '15');

// ===== ٢) أعمدة الشيت =====
const fb = buildPreview([
  ['id', 'ad_name', 'campaign_name', 'form_name', 'platform', 'full_name', 'phone_number'],
  ['l:1234567890123456', 'إعلان ١', 'حملة', 'فورم', 'fb', 'أحمد محمود', 'p:+201001234567'],
  ['l:1234567890123457', 'إعلان ٢', 'حملة', 'فورم', 'ig', 'منى سامي', 'p:+201112223334'],
], []);
check('شيت فيسبوك: الاسم من full_name مش ad_name', fb.rows[0].name === 'أحمد محمود', fb.rows[0].name);
check('شيت فيسبوك: الرقم صح', fb.rows[1].phone === '01112223334', fb.rows[1].phone);

const idFirst = buildPreview([
  ['كود', 'العميل', 'تليفون'],
  ['202600000001', 'سارة علي', '01001234567'],
  ['202600000002', 'كريم حسن', '01112223334'],
], []);
check('عمود كود طويل ما يتاخدش مكان الرقم', idFirst.rows[0].phone === '01001234567', idFirst.rows[0].phone);

const noHeader = buildPreview([
  ['1', 'هبة فؤاد', '01001234567'],
  ['2', 'يوسف شريف', '01112223334'],
], []);
check('شيت من غير عناوين: الاسم والرقم صح', noHeader.rows[0].name === 'هبة فؤاد' && noHeader.rows[1].phone === '01112223334', JSON.stringify(noHeader.rows[0]));

const titled = buildPreview([
  ['عملاء معرض أكتوبر'],
  ['2026'],
  ['الاسم', 'الموبايل'],
  ['دينا عمر', '01001234567'],
], []);
check('سطور عنوان فوق الجدول بتتخطى', titled.total === 1 && titled.rows[0].name === 'دينا عمر', JSON.stringify(titled));

const dup = buildPreview([
  ['الاسم', 'الموبايل'],
  ['قديم', '01001234567'],
  ['جديد', '01112223334'],
  ['مكرر في الملف', '01112223334'],
  ['بلا رقم', ''],
], ['+201001234567']);
check('المكرر في النظام وفي الملف والغير صالح', dup.fresh === 1 && dup.duplicates === 2 && dup.invalid === 1, JSON.stringify(dup));

// ملف إكسل حقيقي: كتابة ثم قراءة (الأرقام مخزّنة كأرقام، فالصفر اللي على الشمال ضايع)
const { buildXlsx, readXlsx } = await import('../src/xlsx.ts');
const xlsxBlob = buildXlsx({
  sheetName: 'عملاء',
  rows: [['الاسم', 'الموبايل'], ['عمر خالد', 1001234567], ['ليلى حسن', '+201112223334']],
});
const fromExcel = buildPreview(await readXlsx(await xlsxBlob.arrayBuffer()), []);
check('من ملف إكسل حقيقي: الأسماء والأرقام مظبوطة',
  fromExcel.fresh === 2 && fromExcel.rows[0].name === 'عمر خالد' && fromExcel.rows[0].phone === '01001234567' && fromExcel.rows[1].phone === '01112223334',
  JSON.stringify(fromExcel.rows));

// ===== ٣) بناء الفورم =====
let n = 0;
const built = buildManualForm({
  name: '  معرض أكتوبر ',
  fileName: 'expo.xlsx',
  rows: dup.rows,
  adminId: 'a1',
  adminName: 'الإدارة',
  now: '2026-11-08T10:00:00.000Z',
  newId: () => `id${++n}`,
});
check('سطر واحد سليم وجديد بس', built.leads.length === 1 && built.form.count === 1);
check('الرقم غير موزّع زي أي فورم', built.leads[0].salesId === '' && built.leads[0].status === 'new');
check('الاسم والرقم مضبوطين', built.leads[0].name === 'جديد' && built.leads[0].phone === '01112223334');
check('اسم الفورم متنضّف ومكتوب على الرقم', built.form.name === 'معرض أكتوبر' && built.leads[0].formName === 'معرض أكتوبر');
check('الرقم مش بيتعامل كرقم يدوي للسيلز', !built.leads[0].manual);

check('اسم مستخدم قبل كده مرفوض (من غير فرق حروف)', formNameTaken(' GO ads', ['Go Ads']));
check('اسم جديد مقبول', !formNameTaken('فورم جديد', ['Go Ads']));
check('اللافتة جنب الفورم اليدوي بس', withManualTag('أ', ['أ']) === 'أ (فورم مضافة يدوي)' && withManualTag('ب', ['أ']) === 'ب');
check('قائمة بايظة ما بتكسرش', parseManualForms('x').length === 0);

// ===== ٣ب) كومنتات الشيت + الإضافة على فورم موجودة =====
const { buildManualLeads, addToManualFormCount } = await import('../src/manualForms.ts');
const withNotes = buildPreview([
  ['الاسم', 'الموبايل', 'الكومنت'],
  ['سما', '01001112223', 'عايزة تقسيط ٧ سنين'],
  ['رامي', '01001112224', ''],
], []);
check('عمود «الكومنت» بيتعرف لوحده', withNotes.mapping.note === 'الكومنت' && withNotes.rows[0].note === 'عايزة تقسيط ٧ سنين', JSON.stringify(withNotes.mapping));
let m = 0;
const toExisting = buildManualLeads({ name: 'GO ADS', fileName: 'x.xlsx', rows: withNotes.rows, adminId: 'a1', adminName: 'الإدارة', now: '2026-11-12T10:00:00.000Z', newId: () => `n${++m}` });
check('الأرقام بتتضاف على الفورم الموجودة باسمها', toExisting.length === 2 && toExisting.every((l) => l.formName === 'GO ADS'));
check('كومنت الشيت متخزن على الرقم وبيروح للسيلز لما يتوزّع', toExisting[0].comment === 'عايزة تقسيط ٧ سنين' && toExisting[0].commentBy === 'الإدارة' && !toExisting[1].comment);
check('عدّاد الفورم اليدوية الموجودة بيزيد', addToManualFormCount([{ id: 'f', name: 'GO ADS', count: 3 }], 'GO ADS', 2)[0].count === 5);
check('شاشة الشيت: فورم جديدة أو موجودة + عمود الكومنت', /\['new', 'فورم جديدة'\], \['existing', 'فورم موجودة'\]/.test(view) && /عمود الكومنت \(اختياري\)/.test(view));

// ===== ٤) الحذف =====
const leads = [
  { id: 'l1', phone: '01001234567', formName: 'يدوي', salesId: 'u1' },
  { id: 'l2', phone: '01112223334', formName: 'يدوي', salesId: '' },
  { id: 'l3', phone: '01223334445', formName: 'فورم تاني', salesId: 'u1' },
];
const clients = [
  { id: leadClientIdFor('01001234567'), phone: '01001234567', activities: [{ type: 'feedback', text: 'كلمته' }] },
  { id: 'manual-client', phone: '01112223334', activities: [] },
  { id: leadClientIdFor('01223334445'), phone: '01223334445', activities: [] },
];
const plan = planManualFormDeletion('يدوي', leads, clients);
check('أرقام الفورم ده بس', plan.leadIds.join(',') === 'l1,l2');
check('العميل التلقائي بس — العميل المسجّل بنفسه ما بيتمسش', plan.clientIds.length === 1 && plan.clientIds[0] === leadClientIdFor('01001234567'));
check('عدد الموزّع وعليهم شغل للتحذير', plan.assigned === 1 && plan.worked === 1);

// ===== ٥) الربط =====
check('القائمة بتتزامن بين الأجهزة', /'crm_manual_forms',/.test(sync));
check('الحذف لحساب المطوّر بس', /const canDelete = isDeveloperAccount\(currentUser\);/.test(view) && /!canDelete\) return/.test(view));
check('الحفظ والحذف بيستنوا pushKey', /await pushAdded\(\)/.test(view) && /await Promise\.all\(\[\s*pushKey\('crm_assigned_leads'\),\s*pushKey\('crm_clients'\)/.test(view));
check('تبويب «إضافة فورم» للإدارة', /id: 'admin-add-form', icon: Upload, label: 'إضافة فورم'/.test(app) && /activeTab === 'admin-add-form' && currentUser\.role === 'admin' && <ManualFormsView/.test(app));
check('اللافتة في توزيع الأرقام وعملاء كامبين', (app.match(/withManualTag\(/g) || []).length >= 4);

console.log(`\n✅ نجحت ${passed} فحوصات (إضافة فورم)`);
