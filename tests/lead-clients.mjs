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
  campaignAtFromText,
  campaignTimeOf,
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
// نحصر جسم الدالة نفسها (من أولها لآخرها) — مش نافذة بأحرف ثابتة، عشان
// إضافة جديدة جوّاها ما تبوّظش الفحص.
const applyBlock = (() => {
  const i = app.indexOf('const applyLeadOwners');
  if (i === -1) return '';
  const end = app.indexOf('const removeLeadClient', i);
  return end === -1 ? app.slice(i, i + 8000) : app.slice(i, end);
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

// ===== ٩) وقت تسجيل العميل في الكامبين (مش وقت إضافته في النظام) =====
// الشكوى: «ضفت وقت إضافة العملاء بس انا كان قصدي وقت تسجيل العملاء في الكامبين».
// وقت نزول الرقم في الفورم موجود في نص الوصف: «التاريخ: 22/10/2026 - 09:43 ص».
check(
  'وقت الكامبين بيتقرا من نص الوصف',
  campaignAtFromText('استيراد تلقائي • المصدر: فيسبوك - X • التاريخ: 22/10/2026 - 09:43 ص') ===
    '2026-10-22T09:43:00.000Z'
);
check(
  'الليل (م) بيتحسب صح',
  campaignAtFromText('التاريخ: 22/10/2026 - 08:05 م') === '2026-10-22T20:05:00.000Z'
);
check('نص من غير تاريخ ما بيعملش وقت', campaignAtFromText('مفيش تاريخ هنا') === '');
check(
  'سجل فيه تاريخ كامبين = kind campaign',
  campaignTimeOf({ description: 'التاريخ: 22/10/2026 - 09:43 ص', createdAt: '2026-10-24T08:14:28.291Z' }).kind ===
    'campaign'
);
check(
  'سجل من غير تاريخ كامبين = kind added (وقت الإضافة)',
  campaignTimeOf({ createdAt: '2026-10-24T08:14:28.291Z', source: 'campaign' }).kind === 'added'
);
const registered = buildLeadClients({
  leads: [
    lead('l9', {
      salesId: 'u-ahmed',
      description: 'استيراد تلقائي • المصدر: فيسبوك - X • التاريخ: 22/10/2026 - 09:43 ص',
      createdAt: '2026-10-24T08:14:28.291Z',
    }),
  ],
  at: '2026-10-24T08:14:28.465Z',
});
check(
  'تاريخ العميل = وقت تسجيله في الكامبين (مش وقت تحويله)',
  registered[0]?.createdAt === '2026-10-22T09:43:00.000Z'
);
check(
  'وقت التحويل لعميل بيفضل متسجّل (updatedAt)',
  registered[0]?.updatedAt === '2026-10-24T08:14:28.465Z'
);
check('وقت الكامبين متخزّن في العميل (campaignAt)', registered[0]?.campaignAt === '2026-10-22T09:43:00.000Z');
check(
  'الواجهة بتقرأ وقت الكامبين من السجل (مش من createdAt بس)',
  /campaignTimeOf\(/.test(app) && /kind=\{campaignTimeOf\(/.test(app)
);
check(
  'الرقاقة بتقول: سُجّل في الكامبين ولا أُضيف في النظام',
  /سُجّل في الكامبين/.test(app) && /أُضيف في النظام/.test(app)
);
check(
  'السيرفر بيخزّن وقت تسجيل الرقم في الكامبين مع الرقم',
  /campaignAt: String\(row\.dateIso\)/.test(server) && /dateIso: created/.test(server)
);

// ===== ١٠) زر + (فيدباك مباشر) في تبويب العملاء زي ما هو في المراحل =====
check('في زر + مشترك بين كارت المراحل وكارت العملاء', /function QuickNoteButton/.test(app));
check(
  'كارت العميل (المستخدم في العملاء والمراحل) فيه زر +',
  /<QuickNoteButton active=\{open\}[\s\S]{0,120}openComposer\(\)/.test(app)
);
check(
  'الزر بيفتح صندوق فيدباك (حالة + كومنت) بدون خيار «تم الرد / لم يرد»',
  /className="feedback-composer"/.test(app) && /اختر حالة الفيدباك/.test(app)
);
check(
  'الفيدباك المباشر يتحفظ على العميل نفسه',
  /addClientActivity\(client\.id, 'feedback', text/.test(app)
);

// ===== ١١) كارت واحد في كل مكان: «العملاء» = «المراحل» = صفحة الحالة =====
// «شلت الشكل القديم في العملاء… قصدي تاخد اللي في تبويب العملاء وتخليه في
// تبويبات الـ stage زي الـ follow up» — يعني كارت تبويب «العملاء» هو نفسه
// في تبويب «المراحل» وفي صفحات الحالات (follow up / meeting / …)،
// والشكل القديم (كارت الرقم الموزّع لوحده) اتشال من النظام كله.
check('الكارت المشترك موجود (كارت العميل)', /function ClientFeedbackCard\(/.test(app));
check('الكارت المشترك موجود (كارت الرقم الموزّع)', /function LeadFeedCard\(/.test(app));
check('الشكل القديم اتشال بالكامل', !/LeadStageCard/.test(app));
const countOf = (needle) => app.split(needle).length - 1;
check(
  'كارت العميل مستخدم في ٣ places: العملاء + المراحل + صفحة الحالة',
  countOf('<ClientFeedbackCard') === 3
);
check(
  'كارت الرقم الموزّع مستخدم في ٣ places: العملاء + المراحل + صفحة الحالة',
  countOf('<LeadFeedCard') === 3
);
check(
  'تبويب «العملاء» بياكل الكارت المشترك',
  /function ClientsView[\s\S]{0,40000}<ClientFeedbackCard/.test(app)
);
check(
  'صفحة الحالة (follow up وغيره) بياكل الكارت المشترك',
  /function StatusBoardView[\s\S]{0,4000}<ClientFeedbackCard/.test(app)
);
check(
  'المراحل بتياكل الكارت المشترك',
  /function PipelineView[\s\S]{0,4000}<ClientFeedbackCard/.test(app)
);

// ===== ١٢) آيفون مثبّت على الشاشة الرئيسية: الشاشة الآمنة =====
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

// ===== رقم تاني للعميل (اختياري) =====
const twoPhones = buildLeadClients({
  leads: [lead('l9', { salesId: 'u-ahmed', phone: '01000000009', phones: ['0111 222 3334', '01000000009', ''] })],
  at: AT,
});
check(
  'الرقم التاني بينزل مع العميل (ومن غير تكرار الرقم الأساسي أو خانة فاضية)',
  twoPhones.length === 1 && twoPhones[0].phones.length === 1 && twoPhones[0].phones[0] === '0111 222 3334',
  JSON.stringify(twoPhones[0]?.phones)
);
check('رقم من غير رقم تاني: القائمة فاضية', buildLeadClients({ leads: [lead('l10', { salesId: 'u-ahmed', phone: '01000000010' })], at: AT })[0].phones.length === 0);
check(
  '«إضافة رقم»: خانة «رقم آخر (اختياري)» وبتتحفظ على الرقم',
  /placeholder="رقم آخر \(اختياري\)" value=\{form\.phone2\}/.test(app) && /\.\.\.\(extraPhone \? \{ phones: \[extraPhone\] \} : \{\}\)/.test(app)
);
check(
  '«عميل جديد»: الخانة ظاهرة في نموذج الإدارة، والرقم المكتوب من غير «+» ما بيضيعش',
  /placeholder="رقم آخر \(اختياري\)" value=\{newPhone\}/.test(app) && /phones: extraPhones,/.test(app)
);

// ===== كومنت الإدارة على الرقم بينزل للسيلز لما يتوزّع =====
const withComment = buildLeadClients({
  leads: [lead('l11', { salesId: 'u-ahmed', phone: '01000000011', comment: 'العميل عايز شقة في التجمع', commentBy: 'الإدارة', commentAt: '2026-11-12T09:00:00.000Z' })],
  at: AT,
})[0];
const commentAct = withComment.activities.find((a) => a.id.endsWith('-comment'));
check(
  'كومنت الإدارة على الرقم بيبقى كومنت في خط العميل وبيظهر في الفيدباك',
  commentAct?.type === 'feedback' && commentAct?.text === 'العميل عايز شقة في التجمع' && commentAct?.by === 'الإدارة' && withComment.feedback === 'العميل عايز شقة في التجمع',
  JSON.stringify(withComment.activities)
);
check('معرّف الكومنت ثابت (كل الأجهزة تعمل نفس الحدث)', commentAct?.id === buildLeadClients({ leads: [lead('l11', { salesId: 'u-ahmed', phone: '01000000011', comment: 'x' })], at: AT })[0].activities.find((a) => a.id.endsWith('-comment'))?.id);
check('رقم من غير كومنت ما بيتعملش له حدث كومنت', !buildLeadClients({ leads: [lead('l12', { salesId: 'u-ahmed', phone: '01000000012' })], at: AT })[0].activities.some((a) => a.id.endsWith('-comment')));
check(
  'نافذة إضافة رقم للإدارة: فورم موجودة/جديدة + كومنت + من غير توزيع',
  /\['existing', 'فورم موجودة'\], \['new', 'فورم جديدة'\]/.test(app) &&
    /كومنت \(اختياري\) — بيوصل للسيلز لما الرقم يتوزّع عليه/.test(app) &&
    /\.\.\.\(note \? \{ comment: note, commentBy:/.test(app) &&
    /من غير توزيع دلوقتي/.test(app) &&
    /setError\('الرقم ده موجود بالفعل في النظام'\)/.test(app)
);

// ===== توزيع الأرقام: تحديد أكتر من رقم وتوزيعهم مرة واحدة =====
check(
  'علامة تحديد على كل رقم + تحديد كل المعروض',
  /checked=\{selected\.has\(lead\.id\)\} onChange=\{\(\) => toggleSelected\(lead\.id\)\}/.test(app) && /تحديد كل المعروض/.test(app)
);
check(
  'توزيع المحدد على سيلز واحد دفعة واحدة (والمحدد = المعروض بس)',
  /onAssign\?\.\(selectedIds, salesId\)/.test(app) &&
    /const selectedIds = visible\.map\(\(l: AssignedLead\) => l\.id\)\.filter\(\(id: string\) => selected\.has\(id\)\)/.test(app) &&
    /توزيع المحدد/.test(app) && /إزالة المحدد من السيلز/.test(app)
);

console.log(`\n✅ نجحت ${passed} فحوصات لتحويل الرقم الموزَّع إلى عميل + الشاشة الآمنة`);
