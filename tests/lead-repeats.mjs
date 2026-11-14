// ===== الأرقام المتكررة من الكامبين =====
// الطلب: الرقم اللي اتسحب تاني (موجود أصلاً) يبان في السيستم إنه متكرر في فورم كذا،
// من غير ما يتغيّر السيلز اللي معاه لو الرقم متوزّع.
// التشغيل: node tests/lead-repeats.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';

let passed = 0;
const check = (label, condition, extra = '') => {
  assert.ok(condition, `✗ ${label} ${extra}`);
  passed += 1;
  console.log(`✓ ${label}`);
};

const { buildRepeats, repeatsByPhone, repeatLabel, repeatPhoneKey } = await import('../shared/leadRepeats.js');
const { runAutoImportCore, normalizeConfig } = await import('../server/leadSource.js');

// ===== ١) المنطق =====
{
  const records = [
    { id: 'c1', phone: '01000000077', formName: 'GO ADS | CAVA', campaignAt: '2026-11-01T10:00:00.000Z', userId: 'u-salma' },
  ];
  const fromOther = buildRepeats({
    rows: [{ phone: '01000000077', name: 'ليلى', formName: 'OBOUR GKAF', dateIso: '2026-11-10T09:00:00.000Z' }],
    records,
  });
  check('رقم موجود اتسحب من فورم تانية → يتسجّل تكرار بالفورم', fromOther.length === 1 && fromOther[0].formName === 'OBOUR GKAF');

  const sameForm = buildRepeats({
    rows: [{ phone: '01000000077', formName: 'GO ADS | CAVA', dateIso: '2026-11-12T09:00:00.000Z' }],
    records,
  });
  check('نفس الفورم بتسجيل جديد (وقت تاني) → تكرار', sameForm.length === 1);

  const reread = buildRepeats({
    rows: [{ phone: '01000000077', formName: 'GO ADS | CAVA', dateIso: '2026-11-01T10:00:00.000Z' }],
    records,
  });
  check('نفس التسجيل الأصلي اتقرا تاني (إعادة سحب) → مش تكرار', reread.length === 0);

  const again = buildRepeats({
    rows: [{ phone: '+201000000077', formName: 'OBOUR GKAF', dateIso: '2026-11-10T09:00:00.000Z' }],
    records,
    existing: fromOther,
  });
  check('نفس التكرار ما بيتسجّلش مرتين (حتى بصيغة +20)', again.length === 0);

  const unknown = buildRepeats({ rows: [{ phone: '01099999999', formName: 'X' }], records });
  check('رقم مش موجود أصلاً → مش تكرار', unknown.length === 0);

  check('مفتاح الرقم واحد لـ 010… و+2010…', repeatPhoneKey('01000000077') === repeatPhoneKey('+20 100 000 0077'));
  const map = repeatsByPhone([...fromOther, ...sameForm]);
  check('اللافتة لتكرار واحد', repeatLabel([fromOther[0]]) === 'متكرر في فورم OBOUR GKAF');
  check('اللافتة لأكتر من تكرار فيها الفورمات', /متكرر 2 مرات: .*GO ADS \| CAVA.*OBOUR GKAF|متكرر 2 مرات: .*OBOUR GKAF.*GO ADS \| CAVA/.test(repeatLabel(map.get(repeatPhoneKey('01000000077')))));
}

// ===== ٢) السحب الحقيقي: التكرار يتسجّل والسيلز ما يتغيّرش =====
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
  const json = (data) => ({ ok: true, status: 200, json: async () => data });
  const lead = (id, name, phone, created) => ({
    id: String(id),
    created_time: created,
    field_data: [
      { name: 'full_name', values: [name] },
      { name: 'phone', values: [phone] },
    ],
  });
  const realFetch = globalThis.fetch;

  const storage = makeStorage({
    crm_users: [{ id: 'u-salma', name: 'Salma', role: 'sales', isActive: true }],
    crm_assigned_leads: [
      { id: 'l1', name: 'ليلى', phone: '01000000077', salesId: 'u-salma', assignedVia: 'manual', formName: 'GO ADS | CAVA', status: 'new' },
    ],
    crm_clients: [
      { id: 'c1', name: 'ليلى', phone: '01000000077', userId: 'u-salma', assignedTo: 'u-salma', formName: 'GO ADS | CAVA', stage: 'contacted', activities: [] },
    ],
    // قاعدة توزيع تلقائي شغالة على الفورم التانية — ما يصحّش تاخد الرقم المتكرر
    crm_lead_auto_assign: [{ id: 'OBOUR GKAF', formName: 'OBOUR GKAF', salesIds: ['u-other'], active: true }],
  });
  const cfg = normalizeConfig({
    enabled: true,
    type: 'meta',
    token: 'USER-TOKEN',
    forms: [{ id: 'form-obour', name: 'OBOUR GKAF' }],
    pages: [],
    intervalMinutes: 1,
  });
  globalThis.fetch = async () =>
    json({ data: [lead('9', 'ليلى تاني', '01000000077', '2026-11-13T08:00:00+0000'), lead('10', 'جديد', '01000000088', '2026-11-13T08:01:00+0000')] });
  const res = await runAutoImportCore({ storage, config: cfg, saveConfig: async () => {}, force: true });
  const data = storage.current().data;
  const repeats = data.crm_lead_repeats || [];

  check('السحب نجح وعدّ التكرار', res.ok && res.repeated === 1, JSON.stringify({ ok: res.ok, repeated: res.repeated, error: res.error }));
  check('التكرار محفوظ بالفورم اللي اتكرر فيها', repeats.length === 1 && repeats[0].formName === 'OBOUR GKAF', JSON.stringify(repeats));
  check('الرقم ما اتضافش تاني', data.crm_assigned_leads.filter((l) => l.phone === '01000000077').length === 1);
  check('السيلز اللي معاه الرقم ما اتغيّرش (الرقم)', data.crm_assigned_leads.find((l) => l.id === 'l1')?.salesId === 'u-salma');
  check(
    'السيلز اللي معاه الرقم ما اتغيّرش (العميل)',
    data.crm_clients.find((c) => c.id === 'c1')?.userId === 'u-salma' && data.crm_clients.find((c) => c.id === 'c1')?.assignedTo === 'u-salma'
  );
  check('الرقم الجديد اتضاف عادي', data.crm_assigned_leads.some((l) => l.phone === '01000000088'));

  // نفس السحب تاني (إعادة سحب) ما بيكررش التكرار
  await runAutoImportCore({ storage, config: { ...cfg, lastRun: null, cursorTime: 0 }, saveConfig: async () => {}, force: true });
  check('إعادة السحب ما بتكررش التكرار', (storage.current().data.crm_lead_repeats || []).length === 1);

  globalThis.fetch = realFetch;
}

// ===== ٣) الواجهة والمزامنة =====
{
  const app = fs.readFileSync('src/App.tsx', 'utf8');
  const sync = fs.readFileSync('src/sync.ts', 'utf8');
  check('التكرارات بتتزامن لكل الأجهزة', sync.includes("'crm_lead_repeats'"));
  check('اللافتة على كارت الرقم عند السيلز', /repeat=\{repeatTextOf\(repeatMap, row\.phone/.test(app));
  check('اللافتة في توزيع الأرقام', /<LeadRepeatBadge text=\{repeatTextOf\(repeatMap, lead\.phone\)\} \/>/.test(app));
  check('اللافتة في عملاء كامبين', /<LeadRepeatBadge text=\{repeatTextOf\(repeatMap, client\.phone, client\.phones \|\| \[\]\)\} \/>/.test(app));
}

console.log(`\n✅ نجحت ${passed} فحوصات (الأرقام المتكررة من الكامبين)`);
