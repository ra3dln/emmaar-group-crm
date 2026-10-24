// ===== اختبار «الرقم الموزَّع = عميل صاحبه» =====
// الشكوى: «الرقم الي ينزل للشخص لازم يكون معاه دايماً» — فطلب المستخدم شيل زر
// «أضف إلى عملائي» من تبويب العملاء والرئيسية.
//
// القاعدة الجديدة: أي رقم في عهدة مندوب يتحوّل لعميله تلقائياً (من غير ضغطة)،
// ومعرّف العميل مشتق من الرقم نفسه — فكل الأجهزة تعمل نفس المعرّف والرقم
// ما بيتكررش ولا يبقى عند أكتر من شخص.
//
// التشغيل: node tests/lead-clients.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  LEAD_CLIENT_ID_PREFIX,
  buildLeadClients,
  clientPhoneKeys,
  leadClientIdFor,
} from '../shared/leadClients.js';

let passed = 0;
const check = (label, condition, extra = '') => {
  assert.ok(condition, `✗ ${label} ${extra}`);
  passed += 1;
  console.log(`✓ ${label}`);
};

const app = fs.readFileSync('src/App.tsx', 'utf8');
const css = fs.readFileSync('src/index.css', 'utf8');
const html = fs.readFileSync('index.html', 'utf8');
const server = fs.readFileSync('server/leadSource.js', 'utf8');

const AT = '2026-01-01T00:00:00.000Z';
const lead = (id, extra = {}) => ({
  id,
  adminId: 'admin-1',
  salesId: '',
  name: 'عميل',
  phone: '01000000001',
  description: 'فيسبوك - كومبيون',
  status: 'new',
  createdAt: AT,
  ...extra,
});

// ===== ١) التحويل التلقائي: رقم في عهدة مندوب يصير عميلاً =====
const one = buildLeadClients({ leads: [lead('l1', { salesId: 'u-ahmed' })], at: AT, by: 'التوزيع' });
check('رقم موزَّع على مندوب يتحوّل لعميل', one.length === 1);
check('العميل الجديد مالكه صاحب الرقم', one[0]?.userId === 'u-ahmed' && one[0]?.assignedTo === 'u-ahmed');
check('العميل الجديد مرحلة «جديد» وحالة حملة', one[0]?.stage === 'new' && one[0]?.status === 'campaign');
check('العميل الجديد اسمه من الرقم', one[0]?.name === 'عميل');
check('مصدر العميل بيوضّح إنه رقم موزَّع', String(one[0]?.source || '').includes('رقم موزّع'));
check('اسم الفورم بينتقل مع العميل', one[0]?.formName === undefined || typeof one[0]?.formName === 'string');
check('العميل بيتسجّل في خطه الزمني', Array.isArray(one[0]?.activities) && one[0].activities.length === 1);
check('العميل بيتسجّل بوقت الإنشاء', one[0]?.createdAt === AT && one[0]?.updatedAt === AT);

// ===== ٢) رقم مش موزَّع = مش عميل (لسه في انتظار التوزيع) =====
check(
  'رقم غير موزَّع ما يتحوّلش لعميل',
  buildLeadClients({ leads: [lead('l2')], at: AT }).length === 0
);

// ===== ٣) رقم واحد = مالك واحد: المعرّف مشتق من الرقم =====
check(
  'نفس الرقم على جهازين = نفس معرّف العميل (ما يتكررش)',
  leadClientIdFor('01000000001') === leadClientIdFor('010 000 00001') &&
    leadClientIdFor('01000000001').startsWith(LEAD_CLIENT_ID_PREFIX)
);
const twice = buildLeadClients({ leads: [lead('l3', { salesId: 'u-ahmed' })], at: AT });
const twiceAgain = buildLeadClients({ leads: [lead('l3', { salesId: 'u-ahmed' })], at: AT });
check('الرقم نفسه = نفس العميل على كل الأجهزة', twice[0]?.id === twiceAgain[0]?.id);

// ===== ٤) رقم عند حدّ سلفاً = ما ينكررش =====
const owned = buildLeadClients({
  leads: [lead('l4', { salesId: 'u-sara' })],
  clients: [{ id: 'c1', phone: '01000000001', phones: [] }],
  at: AT,
});
check('رقم عميل موجود ما يتكررش تاني', owned.length === 0);
const extraPhones = buildLeadClients({
  leads: [lead('l5', { salesId: 'u-sara' })],
  clients: [],
  extraPhones: ['01000000001'],
  at: AT,
});
check('رقم محجوز من لقطة السيرفر ما يتكررش', extraPhones.length === 0);

// ===== ٥) الأرقام العربية والإنجليزية = نفس الرقم =====
check(
  'الرقم بالأرقام العربية = نفس معرّف العميل',
  leadClientIdFor('٠١٠٠٠٠٠٠٠٠١') === leadClientIdFor('01000000001')
);
check(
  'أرقام العملاء بتتقرأ من كل أرقامهم الإضافية',
  clientPhoneKeys([{ phone: '010', phones: ['011', '012'] }]).has('011')
);

// ===== ٦) الزر اتشال من الواجهة =====
check('مفيش زر «أضف إلى عملائي» في الواجهة', !/>\s*أضف إلى عملائي/.test(app));
check('مفيش مسار تحويل يدوي (onConvert)', !app.includes('onConvert'));
check('مفيش دالة التحويل اليدوي', !app.includes('handleConvertLeadToClient'));

// ===== ٧) الربط في الواجهة: التوزيع بيصنع العميل =====
const applyBlock = (() => {
  const i = app.indexOf('const applyLeadOwners');
  return i === -1 ? '' : app.slice(i, i + 4000);
})();
check('توزيع الأرقام بيستدعي تحويل العميل التلقائي', /buildLeadClients\(\{/.test(applyBlock));
check(
  'العميل الجديد بيتضاف لقائمة العملاء fuller',
  /localStorage\.setItem\('crm_clients'/.test(applyBlock)
);
check(
  'فيه أثر بيصنّف كل رقم في عهدة المندوب لعميله',
  /useEffect\(\(\) => \{[\s\S]{0,900}assignedLeads\.filter\([\s\S]{0,400}buildLeadClients\(\{/.test(app)
);
check(
  'تبويب «أرقام جديدة» بيخفي الرقم اللي بقى عميل (ما يتكررش)',
  /!myClientPhones\.has\(phoneKeyOf\(l\.phone\)\)/.test(app)
);

// ===== ٨) السيرفر: السحب التلقائي بيصنع العميل برضه =====
check('السيرفر بيستورد نفس دالة التحويل', /import \{ buildLeadClients \} from '\.\.\/shared\/leadClients\.js'/.test(server));
check(
  'السيرفر بيصنع عميلاً لكل رقم يوزّعه',
  /buildLeadClients\(\{[\s\S]{0,200}leads: auto\.leads/.test(server)
);
check(
  'السيرفر بيعيد قراءة القاعدة قبل الحفظ (ما يمسحش تعديل جهاز)',
  /const freshDb = await storage\.load\(\)/.test(server) &&
    /freshData\.crm_assigned_leads = \[/.test(server)
);

// ===== ٩) آيفون مثبّت على الشاشة الرئيسية: الشاشة الآمنة =====
check('الصفحة بتغطي الشاشة الآمنة (viewport-fit=cover)', /viewport-fit=cover/.test(html));
check(
  'المتغيرات الأربعة للشاشة الآمنة معرّفة',
  /--safe-top:\s*env\(safe-area-inset-top/.test(css) &&
    /--safe-right:\s*env\(safe-area-inset-right/.test(css) &&
    /--safe-left:\s*env\(safe-area-inset-left/.test(css) &&
    /--safe-bottom:\s*env\(safe-area-inset-bottom/.test(css)
);
check(
  'الشريط العلوي بيتحسب مكانه من الشريط اللي فوقه (مش من النوتش مرتين)',
  /\.app-topbar \{[\s\S]{0,400}inset-block-start: var\(--imp-h\)/.test(css) &&
    /padding: calc\(10px \+ var\(--safe-gap\)\)/.test(css)
);
check(
  'شريط «داخل حساب سيلز» بيغطي الشاشة الآمنة',
  /\.has-impersonator \{[\s\S]{0,120}--imp-h: calc\(var\(--imp-bar-h\) \+ var\(--safe-top\)\)/.test(css) &&
    /\.imp-bar \{[\s\S]{0,400}height: calc\(var\(--imp-bar-h\) \+ var\(--safe-top\)\)/.test(css)
);
check(
  'المحتوى محجوز من اليمين واليسار ومن الأسفل (النوتش الأفقي ومؤشرHOME)',
  /\.app-content \{[\s\S]{0,400}padding-right: calc\(16px \+ var\(--safe-right\)\)/.test(css) &&
    /\.app-content \{[\s\S]{0,500}padding-bottom: calc\(36px \+ var\(--safe-bottom\)\)/.test(css)
);
check(
  'لوحة الحالة (صفحة كاملة) بتبعد عن النوتش',
  /\.status-board-head \{[\s\S]{0,400}padding-top: calc\(12px \+ var\(--safe-gap\)\)/.test(css)
);
check(
  'درج القائمة على الهاتف بيبدأ تحت النوتش',
  /@media \(max-width: 900px\)[\s\S]{0,1200}padding-top: calc\(16px \+ var\(--safe-top\)\)/.test(css)
);
check(
  'شاشة الدخول كمان محسوبة (اللوجو ما يقعش تحت النوتش)',
  /\.login-brand \{[\s\S]{0,400}padding-top: calc\(34px \+ var\(--safe-top\)\)/.test(css)
);

console.log(`\n✅ نجحت ${passed} فحوصات لتحويل الرقم الموزَّع إلى عميل + الشاشة الآمنة`);
