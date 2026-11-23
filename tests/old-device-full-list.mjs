// ===== جهاز على نسخة قديمة بيبعت قائمة العملاء كلها مع كل كومنت =====
// الشكوى: «الكومنتات مش بتتكتب في بعض الأكونتات والديلاي مش بيروح».
// السبب: الأجهزة اللي ما اتحدّثتش بتبعت القائمة كلها، والسيرفر كان بينضّف ويدمج
// كل السجلات فيعدّي حد المعالجة في Cloudflare المجاني والطلب يتقطع.
// دلوقتي السيرفر بيشتغل على السجلات اللي اتغيّرت بس — والنتيجة لازم تفضل صح.
// التشغيل: node tests/old-device-full-list.mjs

import http from 'node:http';
import assert from 'node:assert/strict';

process.env.AUTH_SECRET = 'unit-test-secret-0123456789-abcdef';
const { createAuthHandler } = await import('../server/authApi.js');
const { createStoreHandler } = await import('../server/store.js');

// تخزين بنصوص خام زي D1 (loadKeys / saveRaw)
let version = 1;
const raw = new Map();
let writes = 0;
const storage = {
  configured: true,
  async load() {
    const data = {};
    for (const [k, v] of raw) data[k] = JSON.parse(v);
    return { version, data };
  },
  async loadVersion() { return version; },
  async save(next) {
    version = Number(next.version) || 0;
    raw.clear();
    for (const [k, v] of Object.entries(next.data || {})) raw.set(k, JSON.stringify(v));
  },
  async loadRaw() { return { version, raw: Object.fromEntries(raw) }; },
  async loadKeys(names) {
    const data = {};
    for (const n of names) if (raw.has(n)) data[n] = JSON.parse(raw.get(n));
    return { version, data };
  },
  async saveRaw(v, byName) {
    writes += 1;
    version = Number(v) || 0;
    for (const [k, s] of Object.entries(byName)) raw.set(k, String(s));
  },
};

const AT = '2026-11-20T10:00:00.000Z';
const clients = Array.from({ length: 300 }, (_, i) => ({
  id: `c${i}`, userId: 's1', name: `عميل ${i}`, phone: `0100000${String(i).padStart(4, '0')}`, phones: [],
  stage: 'contacted', updatedAt: AT, createdAt: AT,
  activities: [{ id: `a${i}`, type: 'feedback', text: 'قديم', at: AT, status: 'follow-up' }],
}));
raw.set('crm_users', JSON.stringify([
  { id: 's1', username: 'sales', password: 'pw-test', name: 'سيلز', role: 'sales', isActive: true, createdAt: AT },
]));
raw.set('crm_clients', JSON.stringify(clients.filter((c) => c.id !== 'c5')));
raw.set('crm_tombstones', JSON.stringify([{ key: 'crm_clients', id: 'c5', at: Date.parse('2026-11-21T00:00:00.000Z') }]));

const auth = createAuthHandler({ storage, env: process.env });
const store = createStoreHandler({ ...storage, auth: process.env });
const server = http.createServer((req, res) => ((req.url || '').startsWith('/api/auth') ? auth(req, res) : store(req, res)));
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
const call = async (path, method = 'GET', body, cookie) => {
  const res = await fetch(base + path, {
    method, headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: await res.json().catch(() => null), cookie: String(res.headers.get('set-cookie') || '').split(';')[0] };
};

let passed = 0;
const check = (label, ok, extra = '') => { assert.ok(ok, `✗ ${label} ${extra}`); passed += 1; console.log(`✓ ${label}`); };

try {
  const login = await call('/api/auth?action=login', 'POST', { username: 'sales', password: 'pw-test', role: 'sales' });
  check('السيلز دخل', login.status === 200 && !!login.cookie, JSON.stringify(login.json));
  const cookie = login.cookie;

  // ١) نفس القائمة من غير تغيير → ولا كتابة ولا نسخة جديدة
  const v0 = version;
  const w0 = writes;
  const same = await call('/api/store', 'POST', { key: 'crm_clients', value: clients }, cookie);
  check('القائمة زي ما هي ← مفيش كتابة', same.status === 200 && writes === w0 && version === v0, JSON.stringify(same.json));

  // ٢) كومنت جديد على عميل واحد (من غير ما updatedAt يتغيّر) جوه القائمة كلها
  const now = new Date().toISOString();
  const withComment = clients.map((c) => (c.id === 'c7'
    ? { ...c, activities: [{ id: 'new-1', type: 'feedback', text: 'كومنت جديد', at: now, status: 'meeting' }, ...c.activities] }
    : c));
  const saved = await call('/api/store', 'POST', { key: 'crm_clients', value: withComment }, cookie);
  const stored = JSON.parse(raw.get('crm_clients'));
  const c7 = stored.find((c) => c.id === 'c7');
  check('الكومنت وصل السيرفر', saved.status === 200 && c7?.activities?.some((a) => a.id === 'new-1'), JSON.stringify(saved.json));
  check('الكومنت القديم ما اتمسحش', c7?.activities?.some((a) => a.id === 'a7'));
  check('باقي العملا زي ما هم', stored.length === 299 && stored.find((c) => c.id === 'c8')?.activities?.length === 1);
  check('العميل المحذوف (بشاهد حذف) ما رجعش', !stored.some((c) => c.id === 'c5'));

  // ٣) جهاز قديم نسخته أقدم من السيرفر ← نسخة السيرفر بتفضل
  const older = clients.map((c) => (c.id === 'c7' ? { ...c, stage: 'new', updatedAt: '2026-11-01T00:00:00.000Z' } : c));
  await call('/api/store', 'POST', { key: 'crm_clients', value: older }, cookie);
  const after = JSON.parse(raw.get('crm_clients')).find((c) => c.id === 'c7');
  check('نسخة الجهاز القديمة ما بتمسحش الكومنت', after?.activities?.some((a) => a.id === 'new-1'), JSON.stringify(after));

  console.log(`\n✅ نجحت ${passed} فحوصات (جهاز قديم بيبعت القائمة كلها)`);
} catch (error) {
  console.error('❌', error.message);
  process.exitCode = 1;
} finally {
  server.close();
}
