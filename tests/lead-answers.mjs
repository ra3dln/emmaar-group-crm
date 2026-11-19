// ===== كلام العميل في فورم الكامبين =====
// الطلب: الكومنتات اللي العميل بيكتبها وهو بيسجّل في الكامبين تظهر للسيلز لما يضغط
// على كارت العميل وبعدين زرار العين.
// التشغيل: node tests/lead-answers.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';

let passed = 0;
const check = (label, condition, extra = '') => {
  assert.ok(condition, `✗ ${label} ${extra}`);
  passed += 1;
  console.log(`✓ ${label}`);
};

const { answersFromFields, buildAnswerEntries, answersByPhone, questionLabel } = await import('../shared/leadAnswers.js');
const { runAutoImportCore, normalizeConfig } = await import('../server/leadSource.js');

// حقول حقيقية من فورمات الشركة
const fieldData = [
  { name: 'full_name', values: ['Ahmed Saied Salem'] },
  { name: 'phone_number', values: ['+201221804014'] },
  { name: 'برجاء_إدخال_الواتساب_للحجز', values: ['01221804014'] },
  { name: 'job_title', values: ['شف حلوانى'] },
  { name: ':_مهتم_بحجز', values: ['عدد_3_غرف'] },
  { name: ':_الموعد_المناسب_للتواصل', values: ['2026-10-25T15:00:00+0300'] },
  { name: 'work_phone_number', values: ['+201031190099'] },
  { name: 'inbox_url', values: ['https://business.facebook.com/latest/1'] },
];

// ===== ١) استخراج الكلام =====
{
  const answers = answersFromFields(fieldData);
  const text = (q) => answers.find((x) => x.q === q)?.a;
  // كل اللي كتبه العميل بيتعرض — الاسم والرقم والواتساب كمان
  check('الاسم بيتعرض', text('الاسم') === 'Ahmed Saied Salem');
  check('رقم الموبايل بيتعرض', text('رقم الموبايل') === '+201221804014');
  check('رقم الواتساب بيتعرض حتى لو نفس الرقم', text('برجاء إدخال الواتساب للحجز') === '01221804014');
  check('كل حقول العميل موجودة بترتيب الفورم', answers.map((x) => x.q).join('|') === 'الاسم|رقم الموبايل|برجاء إدخال الواتساب للحجز|الوظيفة|مهتم بحجز|الموعد المناسب للتواصل|رقم تاني', answers.map((x) => x.q).join('|'));
  check('لينك الإنبوكس مش من الكلام (فيسبوك بيحطه مش العميل)', !answers.some((x) => /business\.facebook\.com/.test(x.a)));
  check('الوظيفة بالعربي', text('الوظيفة') === 'شف حلوانى');
  check('السؤال من غير «:» ولا «_»', text('مهتم بحجز') === 'عدد 3 غرف', JSON.stringify(answers));
  check('الموعد بيتعرض مقروء', text('الموعد المناسب للتواصل') === '2026-10-25 15:00');
  check('رقم تاني مختلف بيتعرض', text('رقم تاني') === '+201031190099');
  check('اسم سؤال عادي بيتنضّف', questionLabel('ما_نوع_الوحده_التي_تبحث_عنها_؟') === 'ما نوع الوحده التي تبحث عنها ؟');
}

// ===== ٢) السجلات =====
{
  const rows = [
    { phone: '01221804014', formName: 'GO ADS | CAVA', dateIso: '2026-10-25T10:00:00.000Z', answers: [{ q: 'الوظيفة', a: 'بروكر' }] },
    { phone: '01000000001', formName: 'X', answers: [] },
    { phone: '01000000002', formName: 'X', test: true, answers: [{ q: 'a', a: 'b' }] },
  ];
  const first = buildAnswerEntries({ rows });
  check('سجل لكل ليد عنده كلام بس (من غير التجريبي)', first.length === 1);
  check('إعادة السحب ما بتكررش السجل', buildAnswerEntries({ rows, existing: first }).length === 0);
  check('الكلام بيتلاقى بالرقم حتى بصيغة +20', answersByPhone(first).get('1221804014')?.[0]?.answers?.[0]?.a === 'بروكر');
}

// ===== ٣) السحب الحقيقي: الكلام بيتحفظ والعميل ما بيتلمسش =====
{
  const makeStorage = (initial = {}) => {
    let db = { version: 1, data: initial };
    return {
      load: async () => ({ version: db.version, data: JSON.parse(JSON.stringify(db.data)) }),
      save: async (next) => {
        db = { version: next.version, data: JSON.parse(JSON.stringify(next.data)) };
      },
      current: () => db,
    };
  };
  const realFetch = globalThis.fetch;
  const storage = makeStorage({ crm_users: [], crm_assigned_leads: [], crm_clients: [] });
  const cfg = normalizeConfig({ enabled: true, type: 'meta', token: 'T', forms: [{ id: 'f1', name: 'GO ADS | CAVA' }], pages: [], intervalMinutes: 1 });
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ data: [{ id: '1', created_time: '2026-11-14T08:00:00+0000', field_data: fieldData }] }),
  });
  const res = await runAutoImportCore({ storage, config: cfg, saveConfig: async () => {}, force: true });
  globalThis.fetch = realFetch;
  const data = storage.current().data;
  const saved = data.crm_lead_answers || [];
  check('السحب نجح والرقم اتضاف', res.ok && (data.crm_assigned_leads || []).length === 1, String(res.error || ''));
  check('كلام العميل اتحفظ بالفورم', saved.length === 1 && saved[0].formName === 'GO ADS | CAVA' && saved[0].answers.some((x) => x.q === 'الوظيفة'));
}

// ===== ٤) الواجهة: زرار العين بيفتح تفاصيل العميل وفيها الكلام =====
{
  const app = fs.readFileSync('src/App.tsx', 'utf8');
  const sync = fs.readFileSync('src/sync.ts', 'utf8');
  check('الكلام بيتزامن لكل الأجهزة', sync.includes("'crm_lead_answers'"));
  check('زرار العين بيفتح تفاصيل العميل', /onOpenDetails=\{\(target: any(, opts\?: \{ edit\?: boolean \})?\) => \{[\s\S]{0,400}setSelectedClient\(detail\)/.test(app));
  const modal = app.slice(app.indexOf('function ClientDetailModal'), app.indexOf('function ClientDetailModal') + 12000);
  check('تفاصيل العميل فيها «كلام العميل في الفورم»', modal.includes('<LeadFormAnswers phones={[client.phone,'));
}

console.log(`\n✅ نجحت ${passed} فحوصات (كلام العميل في فورم الكامبين)`);
