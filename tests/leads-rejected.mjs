// ===== اختبار «فين الرقمين الناقصين؟» =====
// سؤال الإدارة الدائم: فيسبوك عنده ٣٨ وعندنا ٣٦ — فين الاتنين؟
// قبل هذا الاختبار كان الرقم يختفي بصمت: لا أحد يعرف أمكرر هو أم غير صالح أم لم يُقرأ.
// الآن: كل رقم مستبعد يُسجَّل بسببه (duplicate / invalid / limit) ويعود في نتيجة السحب،
// ومؤشر السحب لا يُسقط الأرقام التي تصل في نفس ثانية آخر ليد تم سحبه.
//
// التشغيل: node tests/leads-rejected.mjs

import assert from 'node:assert/strict';

const { buildAssignments, runAutoImportCore, normalizeConfig } = await import('../server/leadSource.js');

let passed = 0;
const check = (label, condition, extra = '') => {
  assert.ok(condition, `✗ ${label} ${extra}`);
  passed += 1;
  console.log(`✓ ${label}`);
};

// ===== ١) تفصيل الأرقام المستبعدة من المحرك =====
{
  const built = buildAssignments({
    fetched: [
      { phone: '01011112222', name: 'جديد' },
      { phone: '01011113333', name: 'مكرر في النظام' },
      { phone: '123', name: 'رقم قصير' },
      { phone: '01011112222', name: 'مكرر في نفس الدفعة' },
      { phone: '', name: 'بلا رقم' },
    ],
    knownPhones: ['01011113333'],
    at: '2026-10-22T09:00:00.000Z',
  });

  check('الرقم الجديد وحده يدخل', built.added.length === 1, `دخل ${built.added.length}`);
  check('المكرر يُعدّ مرتين (في النظام وداخل الدفعة)', built.duplicates === 2, `مكرر ${built.duplicates}`);
  check('غير الصالح يُعدّ مرتين', built.invalid === 2, `غير صالح ${built.invalid}`);
  check('كل مستبعد له سجل', built.rejected.length === 4, `سجلات ${built.rejected.length}`);

  const dup = built.rejected.filter((r) => r.reason === 'duplicate').map((r) => r.phone);
  check(
    'سبب التكرار مكتوب على كل رقم مكرر',
    dup.length === 2 && dup.includes('01011113333') && dup.includes('01011112222'),
    dup.join(',')
  );
  check(
    'غير الصالح يظهر برقمه كما وصل',
    built.rejected.filter((r) => r.reason === 'invalid').some((r) => r.name === 'رقم قصير')
  );
  check('اسم العميل محفوظ في السجل المستبعد', built.rejected.some((r) => r.name === 'مكرر في النظام'));
}

// ===== ٢) نتيجة السحب تحمل التفصيل (لا اختفاء صامت) =====
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

const json = (data) => ({ ok: true, status: 200, json: async () => data });
const realFetch = globalThis.fetch;

const lead = (id, name, phone, created = '2026-10-20T10:00:00+0000') => ({
  id: String(id),
  created_time: created,
  field_data: [
    { name: 'full_name', values: [name] },
    { name: 'phone', values: [phone] },
  ],
});

const config = () =>
  normalizeConfig({
    enabled: true,
    type: 'meta',
    token: 'USER-TOKEN',
    forms: [{ id: 'form-cava', name: 'GO ADS | CAVA' }],
    pages: [],
    intervalMinutes: 1,
  });

// ===== ٣) مؤشر السحب لا يُسقط ليداً في نفس ثانية آخر ليد =====
{
  const storage = makeStorage({ crm_assigned_leads: [], crm_clients: [], crm_users: [] });
  const cfg = config();

  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 1) return json({ data: [lead('1', 'أول', '01000000001')] });
    // الليد التاني وصل في الثانية نفسها تماماً — كان يُسقط للأبد
    return json({ data: [lead('1', 'أول', '01000000001'), lead('2', 'تاني', '01000000002')] });
  };

  const first = await runAutoImportCore({
    storage,
    config: cfg,
    saveConfig: async () => {},
    force: true,
  });
  check('الدورة الأولى سحبت الرقم الأول', first.ok && first.added === 1, `added=${first.added}`);
  check('مؤشر الفورم حُفظ', Number(cfg.formCursors['form-cava']) > 0, String(cfg.formCursors['form-cava']));

  const savedCursor = Number(cfg.formCursors['form-cava']);
  let filtersent = '';
  globalThis.fetch = async (url) => {
    filtersent = new URL(String(url)).searchParams.get('filtering') || '';
    return json({ data: [lead('1', 'أول', '01000000001'), lead('2', 'تاني', '01000000002')] });
  };

  const second = await runAutoImportCore({
    storage,
    config: cfg,
    saveConfig: async () => {},
    force: true,
  });

  const filterValue = filtersent ? JSON.parse(filtersent)[0].value : 0;
  check('الفلتر يرجع ثانية للوراء (لا يُسقط نفس الثانية)', Number(filterValue) === savedCursor - 1, `value=${filterValue}`);
  check('الليد الجديد في نفس الثانية دخل', second.ok && second.added === 1, `added=${second.added}`);
  check('الليد القديم لم يتكرر', second.duplicates === 1, `مكرر ${second.duplicates}`);
  check('الرقم المستبعد (المكرر) مذكور برقمه', (second.rejected || []).some((r) => r.phone === '01000000001'));
}

// ===== ٤) الأرقام غير الصالحة والمكررة داخل الفورم تظهر بالسبب =====
{
  const storage = makeStorage({ crm_assigned_leads: [], crm_clients: [], crm_users: [] });
  const cfg = config();
  globalThis.fetch = async () =>
    json({
      data: [
        lead('1', 'سليم', '01000000011'),
        lead('2', 'مكرر داخلي', '01000000011'),
        lead('3', 'قصير', '12345'),
      ],
    });

  const res = await runAutoImportCore({ storage, config: cfg, saveConfig: async () => {}, force: true });
  check('رقم واحد فقط مضاف', res.ok && res.added === 1, `added=${res.added}`);
  check('النتيجة تحمل قائمة المستبعدين', Array.isArray(res.rejected) && res.rejected.length === 2, `rejected=${res.rejected?.length}`);
  check('المكرر مكتوب بسببه', res.rejected.some((r) => r.reason === 'duplicate' && r.phone === '01000000011'));
  check('غير الصالح مكتوب بسببه', res.rejected.some((r) => r.reason === 'invalid'));
  check('سبب الاستبعاد يظهر في ملخص آخر سحب المحفوظ', Array.isArray(cfg.lastRun?.rejected) && cfg.lastRun.rejected.length === 2);
}

// ===== ٥) «إداري وسيلز في نفس الوقت»: يستقبل أرقاماً برتبته الإدارية =====
{
  const { isAssignableSales } = await import('../shared/autoAssign.js');
  check('السيلز يستقبل', isAssignableSales({ role: 'sales', isActive: true }));
  check('قائد الفريق يستقبل', isAssignableSales({ role: 'supervisor' }));
  check('غياب isActive = نشط', isAssignableSales({ role: 'sales' }));
  check('الموقوف لا يستقبل', isAssignableSales({ role: 'sales', isActive: false }) === false);
  check(
    'الإداري مع «يعمل سيلزاً» يستقبل',
    isAssignableSales({ role: 'admin', receivesLeads: true })
  );
  check(
    'الإداري العادي لا يستقبل (يبقى إدارياً فقط)',
    isAssignableSales({ role: 'admin' }) === false
  );
  check(
    'حساب المطوّر لا يستقبل أرقاماً تلقائياً (رقمه يوصله بتكليف صريح فقط)',
    isAssignableSales({ role: 'admin', developer: true }) === false &&
      isAssignableSales({ role: 'sales', developer: true }) === false
  );

  // السيرفر يوزّع على الإداري الذي يعمل سيلزاً
  const storage = makeStorage({
    crm_assigned_leads: [],
    crm_clients: [],
    crm_users: [
      { id: 'dev-1', name: 'محمد', role: 'admin', receivesLeads: true, isActive: true },
      { id: 'u-sales', name: 'سيلز', role: 'sales', isActive: true },
      { id: 'admin-plain', name: 'إدارة', role: 'admin', isActive: true },
    ],
    crm_lead_auto_assign: [{ id: 'GO ADS | CAVA', formName: 'GO ADS | CAVA', salesIds: ['dev-1'], active: true }],
  });
  const cfg = config();
  globalThis.fetch = async () => json({ data: [lead('1', 'ليلة', '01000000077')] });
  const res = await runAutoImportCore({ storage, config: cfg, saveConfig: async () => {}, force: true });
  const savedLead = (storage.current().data.crm_assigned_leads || [])[0];
  check('الإداري-السيلز استلم الرقم من القاعدة', res.ok && savedLead?.salesId === 'dev-1', String(savedLead?.salesId));
  check('الإداري العادي لم يستلم', savedLead?.salesId !== 'admin-plain');
}

// ===== ٦) الواجهة تعرض التفصيل وتستخدم نفس قاعدة الاستحقاق =====
{
  const fs = await import('node:fs');
  const app = fs.readFileSync('src/App.tsx', 'utf8');
  check('الواجهة تعرض «أرقام لم تُضف»', app.includes('أرقام لم تُضف'));
  check('الواجهة تترجم سبب الاستبعاد', app.includes("r.reason === 'duplicate'") && app.includes("'رقم غير صالح'"));
  check(
    'قائمة السيلز تستخدم isAssignableSales (نفس السيرفر)',
    app.includes('users.filter((u: User) => isAssignableSales(u))')
  );
  check('نموذج الحساب يعرض خيار «يعمل سيلزاً أيضاً»', app.includes('يعمل سيلزاً أيضاً'));
  check('الخيار محفوظ على الحساب', app.includes('receivesLeads'));
}

globalThis.fetch = realFetch;
console.log(`\n✅ نجحت ${passed} فحوصات لتفسير الأرقام الناقصة`);
