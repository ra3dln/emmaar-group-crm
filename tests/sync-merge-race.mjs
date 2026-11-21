// ===== اختبار: التعديل الجديد ما يرجعش لنسخته القديمة بعد المزامنة =====
// الشكوى: «لما بضغط على (غير مخصص) عشان أحط رقم لسيلز بيتحط وبعد ثانيتين
// يرجع غير مخصص تاني» + «لما بيشيل رقم من سيلز، حساب السيلز لسه بيلاقيه معاه»
// + «إيقاف التوزيع التلقائي مش بيوقف التوزيع».
//
// السبب: المزامنة كانت **تجلب** نسخة السيرفر قبل ما **ترفع** تعديل هذا الجهاز،
// فنسخة السيرفر القديمة كانت تفوز في الدمج (النسخة البعيدة تفوز دائماً):
//   • التوزيع يرجع «غير مخصص» بعد ثانيتين،
//   • الحذف يرجع من النسخة القديمة،
//   • إيقاف التوزيع التلقائي يرجع مفعّلاً،
// والأرقام بتنوزّع تاني والعميل بيفضل مع السيلز.
//
// التشغيل: node tests/sync-merge-race.mjs

import assert from 'node:assert';
import fs from 'node:fs';

// ===== بيئة وهمية: localStorage + window قبل استيراد وحدة المزامنة =====
const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
  clear: () => mem.clear(),
};
globalThis.window = {
  dispatchEvent: () => {},
  setInterval: () => 0,
  clearInterval: () => {},
  addEventListener: () => {},
  removeEventListener: () => {},
};

// ===== سيرفر مزامنة بذاكرة (نفس عقد /api/store) =====
// `stale` = نسخة قديمة يقدّمها السيرفر في الجلب الواحد ده — بالظبط سباق المزامنة:
// الجهاز جلب النسخة قبل ما رفع تغييره، فالسيرفر يرد بالنسخة الأقدم.
const server = { version: 1, data: {} };
let stale = null;
let gets = 0;
globalThis.fetch = async (url, init = {}) => {
  const method = init.method || 'GET';
  const respond = (payload) => ({ ok: true, status: 200, json: async () => payload });
  if (method === 'POST') {
    const body = JSON.parse(init.body);
    if (body.key !== undefined) {
      if (Array.isArray(body.upserts)) {
        // السجلات اللي اتغيّرت بس: تندمج بالمعرّف في المتخزّن (زي السيرفر الحقيقي)
        const byId = new Map((server.data[body.key] || []).map((row) => [String(row.id), row]));
        for (const row of body.upserts) byId.set(String(row.id), row);
        server.data[body.key] = [...byId.values()];
      } else {
        server.data[body.key] = body.value;
      }
      server.version += 1;
      return respond({ version: server.version });
    }
    if (body.data) {
      server.data = { ...body.data };
      server.version += 1;
      return respond({ version: server.version });
    }
  }
  if (String(url).includes('meta=version')) return respond({ version: server.version });
  gets += 1;
  const data = stale ? stale : server.data;
  stale = null;
  return respond({
    version: server.version,
    data: JSON.parse(JSON.stringify(data)),
    isEmpty: Object.keys(server.data).length === 0,
  });
};

const sync = await import('../src/sync.ts');

const localList = (key) => JSON.parse(globalThis.localStorage.getItem(key) || '[]');
const waitFor = async (fn, ms = 3000) => {
  const start = Date.now();
  while (Date.now() - start < ms) {
    if (fn()) return true;
    await new Promise((r) => setTimeout(r, 20));
  }
  return false;
};

let passed = 0;
const check = (label, condition, extra = '') => {
  assert.ok(condition, `✗ ${label} ${extra}`);
  passed += 1;
  console.log(`✓ ${label}`);
};

const AT = '2026-01-01T00:00:00.000Z';
const LEAD = {
  id: 'l1',
  adminId: 'a1',
  salesId: '',
  name: 'عميل',
  phone: '01001234567',
  description: '',
  status: 'new',
  createdAt: AT,
  formName: 'فورم 1',
};
const RULE_ON = {
  id: 'فورم 1',
  formName: 'فورم 1',
  salesIds: ['s1'],
  allSales: false,
  active: true,
  updatedAt: AT,
};

try {
  // ===== التهيئة: السيرفر فيه رقم غير مخصص + قاعدة توزيع تلقائي مفعّلة =====
  server.data = {
    crm_assigned_leads: [LEAD],
    crm_lead_auto_assign: [RULE_ON],
    crm_tombstones: [],
  };
  server.version = 20;
  await sync.startSync();
  check('الجهاز استلم الرقم والقاعدة من السيرفر', localList('crm_assigned_leads').length === 1
    && localList('crm_lead_auto_assign')[0]?.active === true);

  // ===== ١) التوزيع اليدوي: الرقم لسيلز، والسيرفر يرد بنسخة قديمة =====
  const beforeAssign = JSON.parse(JSON.stringify(server.data));
  const assignedAt = new Date().toISOString();
  globalThis.localStorage.setItem(
    'crm_assigned_leads',
    JSON.stringify([{ ...LEAD, salesId: 's1', assignedAt }])
  );
  await sync.pushKey('crm_assigned_leads');
  check('التوزيع وصل السيرفر', server.data.crm_assigned_leads?.[0]?.salesId === 's1');

  stale = beforeAssign; // السيرفر يرد بالنسخة القديمة (جلب قبل الرفع)
  server.version += 1; // جهاز آخر كتب ⇒ النسخة تغيّرت ⇒ المزامنة تجلب
  const getsBefore = gets;
  sync.markAuthorized();
  await waitFor(() => gets > getsBefore);
  await new Promise((r) => setTimeout(r, 120));
  check(
    'التوزيع ما يرجعش «غير مخصص» بعد جلب نسخة قديمة',
    localList('crm_assigned_leads')[0]?.salesId === 's1',
    JSON.stringify(localList('crm_assigned_leads')[0])
  );

  // ===== ٢) إيقاف التوزيع التلقائي: القاعدة ما ترجعش مفعّلة =====
  const beforeStop = JSON.parse(JSON.stringify(server.data));
  const stopped = { ...RULE_ON, active: false, updatedAt: new Date().toISOString() };
  globalThis.localStorage.setItem('crm_lead_auto_assign', JSON.stringify([stopped]));
  await sync.pushKey('crm_lead_auto_assign');
  check('الإيقاف وصل السيرفر', server.data.crm_lead_auto_assign?.[0]?.active === false);

  stale = beforeStop; // النسخة القديمة فيها القاعدة مفعّلة
  server.version += 1;
  const getsBefore2 = gets;
  sync.markAuthorized();
  await waitFor(() => gets > getsBefore2);
  await new Promise((r) => setTimeout(r, 120));
  check(
    'إيقاف التوزيع التلقائي ما يرجعش مفعّلاً',
    localList('crm_lead_auto_assign')[0]?.active === false,
    JSON.stringify(localList('crm_lead_auto_assign')[0])
  );

  // ===== ٣) حذف الرقم: ما يرجعش من النسخة القديمة =====
  const beforeDelete = JSON.parse(JSON.stringify(server.data));
  globalThis.localStorage.setItem('crm_assigned_leads', JSON.stringify([]));
  await sync.pushKey('crm_assigned_leads');
  check(
    'شاهد الحذف اتسجّل ورُفع',
    (server.data.crm_tombstones || []).some((t) => t.key === 'crm_assigned_leads' && t.id === 'l1')
  );

  stale = beforeDelete; // النسخة القديمة فيها الرقم المحذوف
  server.version += 1;
  const getsBefore3 = gets;
  sync.markAuthorized();
  await waitFor(() => gets > getsBefore3);
  await new Promise((r) => setTimeout(r, 120));
  check(
    'الرقم المحذوف ما يرجعش من النسخة القديمة',
    localList('crm_assigned_leads').length === 0,
    JSON.stringify(localList('crm_assigned_leads'))
  );

  // ===== ٤) فحص المصدر: التعديلات في الواجهة =====
  const app = fs.readFileSync('src/App.tsx', 'utf8');
  const syncSrc = fs.readFileSync('src/sync.ts', 'utf8');
  const applyBlock = (() => {
    const i = app.indexOf('const applyLeadOwners');
    return i === -1 ? '' : app.slice(i, i + 5000);
  })();
  check('الدمج في المزامنة بيقارن الأحدث بين النسختين', /changeStamp/.test(syncSrc)
    && /changeStamp\(mine\) > changeStamp\(item\)/.test(syncSrc));
  check('تغيير صاحب الرقم بيكتب وقت التوزيع دايماً (توزيع أو سحب)',
    /assignedAt: movedAt/.test(applyBlock) && !/owner \? \{ assignedAt: movedAt \}/.test(applyBlock));
  check('سحب الرقم من السيلز بيفرّغ صاحب العميل (مش بيسيبه عنده)',
    /\.find\(\(v\) => v !== undefined\)/.test(applyBlock)
    && /سُحب الرقم من عهادة السيلز|سُحب الرقم من عهدة السيلز/.test(applyBlock));
  check('حذف الرقم بيشيل عميله التلقائي كمان',
    /const removeLeadClient/.test(app) && /removeLeadClient\(id\)/.test(app));
  check('فيه زرار «حفظ التوزيع» فوق الصفحة',
    /حفظ التوزيع/.test(app) && /onSave\?\.\(\)/.test(app));

  console.log(`\n✅ نجحت ${passed} فحوصات لثبات التوزيع والحذف وإيقاف التوزيع التلقائي`);
} catch (error) {
  console.error('❌ فشل اختبار سباق المزامنة:', error.message);
  process.exit(1);
}
