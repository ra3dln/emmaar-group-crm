// ===== السيرفر المستقل (server.mjs) — الموقع كله برّه Vercel =====
// الطلب: الاستضافة (Vercel) بتقفل الموقع، وقاعدة البيانات (Supabase) اتقفلت. المطلوب
// الموقع يشتغل على أي استضافة Node، بنفس الكود والبيانات. الاختبار بيشغّل server.mjs
// الحقيقي على قاعدة D1 وهمية ويتأكد إن: الصفحات بتتخدم، الدخول شغّال، الحفظ والمزامنة
// شغّالين (ومضغوطين)، والمُشغّل الدوري بيتنادى بمفتاحه بس.
// التشغيل: node tests/standalone-server.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';

let passed = 0;
const check = (label, condition, extra = '') => {
  assert.ok(condition, `✗ ${label} ${extra}`);
  passed += 1;
  console.log(`✓ ${label}`);
};

// ===== البيئة: D1 وهمية + سر الجلسات + سر المُشغّل =====
Object.assign(process.env, {
  D1_ACCOUNT_ID: 'acc-test',
  D1_DATABASE_ID: 'db-test',
  D1_API_TOKEN: 'token-test',
  AUTH_SECRET: 'standalone-test-secret-0123456789-abcdef',
  CRON_SECRET: 'cron-test-secret-abcdef',
});
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SECRET_KEY;

// ===== محاكاة Cloudflare D1 REST (طلبات تانية بتعدّي للشبكة عادي) =====
const table = new Map();
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  if (!String(url).includes('api.cloudflare.com')) return realFetch(url, init);
  const { sql = '', params = [] } = JSON.parse(init.body || '{}');
  const respond = (results) => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ success: true, result: [{ results, success: true }], errors: [] }),
  });
  const s = sql.trim();
  if (/CREATE TABLE IF NOT EXISTS/i.test(s)) return respond([]);
  if (/^SELECT key, value FROM crm_kv WHERE key LIKE 'crm:data:%'$/i.test(s)) {
    return respond([...table.entries()].filter(([k]) => k.startsWith('crm:data:')).map(([key, value]) => ({ key, value })));
  }
  if (/^SELECT key, value FROM crm_kv WHERE key IN \(/i.test(s)) {
    return respond(params.filter((k) => table.has(k)).map((k) => ({ key: k, value: table.get(k) })));
  }
  if (/^DELETE FROM crm_kv WHERE key IN \(/i.test(s)) {
    for (const k of params) table.delete(k);
    return respond([]);
  }
  if (/^INSERT INTO crm_kv/i.test(s)) {
    for (let i = 0; i < params.length; i += 2) table.set(params[i], params[i + 1]);
    return respond([]);
  }
  throw new Error(`استعلام غير متوقع: ${sql}`);
};

// بيانات البداية: حساب إدارة
const { d1Storage } = await import('../server/d1.js');
await d1Storage(process.env).save({
  version: 1,
  data: {
    crm_users: [{ id: 'u-admin', username: 'admin', name: 'الإدارة', role: 'admin', isActive: true, password: 'AdminStrong123' }],
    crm_daily_feedback: [],
    crm_tombstones: [],
  },
});

// ===== السيرفر الحقيقي =====
const { server } = await import('../server.mjs');
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

try {
  // ===== ١) الصفحات =====
  const hasDist = fs.existsSync('dist/index.html');
  const home = await realFetch(`${base}/`);
  check('الصفحة الرئيسية بتتخدم', home.status === 200 || (!hasDist && home.status === 503));
  if (hasDist) {
    const deep = await realFetch(`${base}/clients/some-page`);
    check('أي مسار في التطبيق بيرجّع الصفحة الرئيسية', deep.status === 200 && /text\/html/.test(deep.headers.get('content-type') || ''));
    check('الصفحة الرئيسية ما بتتخزّنش (دايماً أحدث نسخة)', /no-store/.test(home.headers.get('cache-control') || ''));
  }
  const pub = await realFetch(`${base}/p/abc`);
  check('رابط الوحدة العامة /p/<id> شغّال', pub.status === 200 && /text\/html/.test(pub.headers.get('content-type') || ''));
  const escape = await realFetch(`${base}/%2e%2e/package.json`);
  check('ممنوع قراءة ملفات برّه الواجهة', !(await escape.text()).includes('"dependencies"'));

  // ===== ٢) الدخول والبيانات =====
  const noAuth = await realFetch(`${base}/api/store?meta=version`);
  check('البيانات مقفولة من غير دخول', noAuth.status === 401, String(noAuth.status));
  const login = await realFetch(`${base}/api/auth?action=login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'AdminStrong123', loginType: 'admin' }),
  });
  check('الدخول شغّال', login.status === 200, String(login.status));
  const cookie = String(login.headers.get('set-cookie') || '').split(';')[0];

  const push = await realFetch(`${base}/api/store`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify({
      key: 'crm_daily_feedback',
      value: Array.from({ length: 30 }, (_, i) => ({ id: `fb-${i}`, userId: 'u-admin', clientPhone: `0100000${1000 + i}`, feedback: 'كومنت', createdAt: '2026-11-19T08:00:00.000Z' })),
    }),
  });
  check('الحفظ شغّال', push.status === 200, String(push.status));
  const version = await (await realFetch(`${base}/api/store?meta=version`, { headers: { cookie } })).json();
  check('رقم النسخة بيزيد بعد الحفظ', version.version === 2, JSON.stringify(version));
  const pull = await realFetch(`${base}/api/store`, { headers: { cookie, 'accept-encoding': 'gzip' } });
  const data = await pull.json();
  check('المزامنة بترجّع اللي اتحفظ', (data?.data?.crm_daily_feedback || []).length === 30);
  check('والبيانات بتتبعت مضغوطة', pull.headers.get('content-encoding') === 'gzip');

  // ===== ٣) المُشغّل الدوري =====
  const cronNo = await realFetch(`${base}/api/cron`);
  check('المُشغّل الدوري مقفول من غير مفتاح', cronNo.status === 403, String(cronNo.status));
  const cronYes = await realFetch(`${base}/api/cron`, { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } });
  check('وبالمفتاح بيشتغل', cronYes.status !== 403 && cronYes.status < 500, String(cronYes.status));

  // ===== ٤) التشغيل على أي استضافة =====
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  check('أمر التشغيل npm start موجود', pkg.scripts?.start === 'node server.mjs');
  const src = fs.readFileSync('server.mjs', 'utf8');
  check('السيرفر بياخد المنفذ من الاستضافة (PORT)', /process\.env\.PORT/.test(src));
  check('والسحب الدوري بيشتغل من جوه السيرفر', /setInterval\(runCron/.test(src));
} finally {
  server.close();
}

console.log(`\n✅ نجحت ${passed} فحوصات (السيرفر المستقل برّه Vercel)`);
