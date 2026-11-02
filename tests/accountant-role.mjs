// ===== حساب المحاسب: الحضور والانصراف بس + الدخول من بوابة الإدارة =====
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const read = (rel) => fs.readFileSync(path.join(root, '..', rel), 'utf8');
const app = read('src/App.tsx');
const types = read('src/types.ts');

process.env.AUTH_SECRET = 'unit-test-secret-accountant-0123456789';
const { createAuthHandler } = await import('../server/authApi.js');
const { createStoreHandler } = await import('../server/store.js');
const { hashPassword } = await import('../server/auth.js');

let passed = 0;
const check = (name, ok, extra = '') => {
  assert.ok(ok, `✗ ${name} ${extra}`);
  passed++;
  console.log(`✓ ${name}`);
};

// ---------- سيرفر حقيقي بمخزن في الذاكرة ----------
let db = {
  version: 1,
  data: {
    crm_users: [
      { id: 'acc-1', username: 'acc', name: 'محاسب تجربة', role: 'accountant', isActive: true, password: hashPassword('AccTestPass123') },
    ],
  },
};
const storage = {
  configured: true,
  async load() { return { version: db.version, data: JSON.parse(JSON.stringify(db.data)) }; },
  async loadVersion() { return db.version; },
  async save(next) { db = { version: Number(next.version) || 0, data: JSON.parse(JSON.stringify(next.data)) }; },
};
const authHandler = createAuthHandler({ storage, env: process.env });
const storeHandler = createStoreHandler({ ...storage, auth: process.env });
const server = http.createServer((req, res) =>
  (req.url || '').startsWith('/api/auth') ? authHandler(req, res) : storeHandler(req, res)
);
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
const login = async (body) => {
  const res = await fetch(`${base}/api/auth?action=login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
};

try {
  const viaAdmin = await login({ username: 'acc', password: 'AccTestPass123', loginType: 'admin' });
  check('المحاسب يدخل من بوابة الإدارة', viaAdmin.status === 200 && viaAdmin.json?.user?.role === 'accountant', JSON.stringify(viaAdmin.json));
  const wrong = await login({ username: 'acc', password: 'wrong', loginType: 'admin' });
  check('وكلمة مرور غلط مرفوضة', wrong.status === 401);
} finally {
  server.close();
}

// ---------- الواجهة ----------
check('الرتبة accountant في نوع الحساب', /role: 'admin' \| 'supervisor' \| 'sales' \| 'accountant';/.test(types));
check('تحت الاسم بيتكتب «محاسب» بدل CEO', /accountant: 'محاسب' \};\s*\nconst RANK_AR/.test(app) && /accountant: 'محاسب' \};\s*\nconst rankLabel/.test(app));
check(
  'قائمة المحاسب: الحضور بس',
  /if \(role === 'accountant'\) \{\s*\n\s*return \[\{ label: 'الحضور', items: \[\{ id: 'admin-attendance'/.test(app)
);
check(
  'أي صفحة تانية بترجّعه للحضور',
  /guardRole === 'accountant' && activeTab !== 'admin-attendance'/.test(app) &&
    /if \(user\.role === 'accountant'\) return 'admin-attendance';/.test(app)
);
check(
  'بيسجّل حضوره هو ويشوف حضور كل الحسابات',
  /currentUser\.role === 'accountant' && <OwnAttendanceCard currentUser=\{currentUser\} \/>/.test(app) &&
    /<AdminAttendanceView users=\{currentUser\.role === 'accountant' \? users : scopedUsers\} \/>/.test(app)
);
check('ما بيحمّلش عملاء وأرقام الشركة', /const isAdminAccount = isManagerRole\(currentUser\.role\);/.test(app));
check(
  'المدير التنفيذي بس اللي يعمل حساب محاسب',
  /\{ id: 'accountant', label: 'Accountant', sub: 'محاسب' \}/.test(app) &&
    /form\.role === 'accountant' && !canCreateCeo/.test(app)
);

console.log(`\n✅ نجحت ${passed} فحوصات (حساب المحاسب)`);
