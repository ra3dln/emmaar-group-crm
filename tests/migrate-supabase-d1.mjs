// ===== اختبار نقل كل البيانات والإعدادات من Supabase إلى D1 =====
// الفكرة: Supabase وقّفت الخدمة (تجاوز حد النقل) والبيانات الأساسية اتنقلت من
// متصفح الإدارة، لكن إعدادات سحب الأرقام (توكن فيسبوك + الصفحات + الفورمات)
// ومفاتيح الإشعارات محفوظة على Supabase بس. الاختبار يضمن:
//   ١) كل السجلات بتتنقل، والسجل الموجود في الناحيتين الأحدث وقتاً يكسب.
//   ٢) اللي اتكتب على D1 بعد النقل ما يتمسحش، واللي اتشال في أي ناحية يفضل مشال.
//   ٣) الإعدادات بتتنقل لو D1 فاضية، وما تتمسحش لو فيها شغل جديد (إلا بـ overwrite).
//   ٤) رقم النسخة بيزيد فوق الأكبر من الناحيتين (فكل الأجهزة تنزّل مرة واحدة).
//
// التشغيل: node tests/migrate-supabase-d1.mjs

import assert from 'node:assert/strict';

const { copyAllFromSource } = await import('../server/migrate.js');

let passed = 0;
const check = (label, condition, extra = '') => {
  assert.ok(condition, `✗ ${label} ${extra}`);
  passed += 1;
  console.log(`✓ ${label}`);
};

const memoryStore = ({ version = 0, data = {} } = {}) => {
  const state = { version, data: JSON.parse(JSON.stringify(data)) };
  const settings = new Map();
  return {
    state,
    settings,
    async load() {
      return JSON.parse(JSON.stringify(state));
    },
    async save(db) {
      state.version = Number(db.version) || 0;
      state.data = JSON.parse(JSON.stringify(db.data || {}));
    },
    jsonStore: (key) => ({
      async load() {
        return settings.has(key) ? JSON.parse(settings.get(key)) : {};
      },
      async save(value) {
        settings.set(key, JSON.stringify(value));
        return value;
      },
    }),
  };
};

const ts = (iso) => ({ createdAt: iso, updatedAt: iso });

// ===== ١) نقل كامل: سجلات جديدة + نسخة أحدث + إعدادات =====
const supabase = memoryStore({
  version: 39254,
  data: {
    crm_users: [
      { id: 'admin-001', username: 'admin', role: 'admin', ...ts('2026-01-01T00:00:00.000Z') },
    ],
    crm_clients: [
      { id: 'c1', name: 'عميل قديم', stage: 'new', ...ts('2026-11-01T00:00:00.000Z') },
      { id: 'c2', name: 'عميل Supabase فقط', ...ts('2026-10-01T00:00:00.000Z') },
    ],
    crm_call_logs: [
      { id: 'l1', comment: 'كلام العميل من Supabase', ...ts('2026-11-10T00:00:00.000Z') },
    ],
    crm_tombstones: [{ key: 'crm_clients', id: 'dead-1', at: 1793000000000 }],
  },
});
supabase.settings.set(
  'crm:lead-source:config',
  JSON.stringify({ facebook: { token: 'FB-TOKEN', pages: [{ id: 'p1' }], forms: [{ id: 'f1' }], intervalMinutes: 5 } })
);
supabase.settings.set('crm:push:vapid', JSON.stringify({ publicKey: 'pub', privateKey: 'priv' }));

const d1 = memoryStore({
  version: 29,
  data: {
    crm_users: [{ id: 'admin-001', username: 'admin', role: 'admin', ...ts('2026-01-01T00:00:00.000Z') }],
    crm_clients: [
      // نفس السجل لكن أحدث (تعديل حصل النهاردة على D1)
      { id: 'c1', name: 'عميل قديم', stage: 'meeting', ...ts('2026-11-18T00:00:00.000Z') },
      { id: 'c3', name: 'عميل اتضاف النهاردة', ...ts('2026-11-18T08:00:00.000Z') },
    ],
    crm_call_logs: [{ id: 'l2', comment: 'كومنت النهاردة', ...ts('2026-11-18T09:00:00.000Z') }],
    crm_tombstones: [],
  },
});

const res = await copyAllFromSource({ source: supabase, target: d1 });
const after = d1.state.data;

check('كل السجلات من الناحيتين موجودة', after.crm_clients.length === 3, String(after.crm_clients.length));
check('الأحدث وقتاً هو اللي كسب (تعديل D1)', after.crm_clients.find((c) => c.id === 'c1').stage === 'meeting');
check('سجل موجود على Supabase بس اتنقل', after.crm_clients.some((c) => c.id === 'c2'));
check('سجل اتضاف على D1 ما اتمسحش', after.crm_clients.some((c) => c.id === 'c3'));
check('كومنتات الناحيتين موجودة', after.crm_call_logs.length === 2, String(after.crm_call_logs.length));
check('المستخدمين زي ما هم', after.crm_users.length === 1);
check('شاهد الحذف اتنقل مع البيانات', after.crm_tombstones.some((t) => t.id === 'dead-1'));
check('رقم النسخة فوق الأكبر + ١', res.version === 39255, String(res.version));
check('والتخزين فعلاً اتحفظ', d1.state.version === 39255);

check(
  'إعدادات سحب الأرقام اتنقلت (توكن فيسبوك)',
  JSON.parse(d1.settings.get('crm:lead-source:config')).facebook.token === 'FB-TOKEN'
);
check(
  'مفاتيح الإشعارات اتنقلت',
  JSON.parse(d1.settings.get('crm:push:vapid')).publicKey === 'pub'
);
check('رد النقل بيوضّح اللي اتنقل', res.settings['crm:lead-source:config'].copied === true);

// ===== ٢) ما يتمسحش شغل جديد في D1 =====
const d1WithWork = memoryStore({ version: 5, data: { crm_users: [] } });
d1WithWork.settings.set('crm:lead-source:config', JSON.stringify({ facebook: { token: 'NEW-TOKEN' } }));
const res2 = await copyAllFromSource({ source: supabase, target: d1WithWork });
check(
  'لو D1 فيها إعدادات محدَّثة، ما تتكتبش فوقها',
  JSON.parse(d1WithWork.settings.get('crm:lead-source:config')).facebook.token === 'NEW-TOKEN'
);
check('ورد النقل بيقول السبب', res2.settings['crm:lead-source:config'].reason === 'target-not-empty');

// ===== ٣) overwrite يكتب بالقوة (لو عايزين إعدادات Supabase بالظبط) =====
const d1Force = memoryStore({ version: 5, data: { crm_users: [] } });
d1Force.settings.set('crm:lead-source:config', JSON.stringify({ facebook: { token: 'NEW-TOKEN' } }));
await copyAllFromSource({ source: supabase, target: d1Force, overwrite: true });
check(
  'overwrite بيكتب إعدادات Supabase فوق',
  JSON.parse(d1Force.settings.get('crm:lead-source:config')).facebook.token === 'FB-TOKEN'
);

// ===== ٤) مفيش إعدادات في المصدر => ما نكتبش حاجة =====
const emptySettings = memoryStore({ version: 1, data: { crm_users: [] } });
const res3 = await copyAllFromSource({ source: emptySettings, target: memoryStore({ version: 1, data: {} }) });
check('مصدر بدون إعدادات مايضيعش وقت', res3.settings['crm:lead-source:config'].reason === 'empty');

// ===== ٥) الحذف محترم في الناحيتين =====
const withTomb = memoryStore({
  version: 3,
  data: {
    crm_clients: [
      { id: 'c9', name: 'اتمسح', ...ts('2026-11-01T00:00:00.000Z') },
      { id: 'c10', name: 'حي', ...ts('2026-11-01T00:00:00.000Z') },
    ],
    crm_tombstones: [{ key: 'crm_clients', id: 'c9', at: Date.parse('2026-11-05T00:00:00.000Z') }],
  },
});
const targetTomb = memoryStore({ version: 3, data: { crm_clients: [], crm_tombstones: [] } });
await copyAllFromSource({ source: withTomb, target: targetTomb });
const tombRows = targetTomb.state.data.crm_clients;
check('سجل عليه شاهد حذف ما بيرجعش', !tombRows.some((c) => c.id === 'c9'));
check('والباقي اتنقل', tombRows.some((c) => c.id === 'c10'));

console.log(`\n✅ نجحت ${passed} فحوصات (النقل من Supabase إلى D1)`);
