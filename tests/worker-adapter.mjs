// ===== الموقع على Cloudflare Workers (worker/index.js) =====
// الطلب: استضافة مجانية من غير كارت ومن غير ما تقفل — نفس الكود على Cloudflare Workers
// مع قاعدة D1 مباشرة (env.DB). الاختبار بيشغّل الـ Worker الحقيقي بقاعدة D1 وهمية بنفس
// شكل الربط المباشر، ويتأكد إن: الواجهة بتتخدم من الملفات، الدخول/الحفظ/المزامنة شغّالين،
// الحفظ من غير تغيير ما بيزوّدش النسخة، والمُشغّل الدوري بيتنادى.
// التشغيل: node tests/worker-adapter.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';

let passed = 0;
const check = (label, condition, extra = '') => {
  assert.ok(condition, `✗ ${label} ${extra}`);
  passed += 1;
  console.log(`✓ ${label}`);
};

// ===== قاعدة D1 وهمية بشكل الربط المباشر (prepare/bind/all) =====
const table = new Map();
const run = (sql, params) => {
  const s = sql.trim();
  if (/CREATE TABLE IF NOT EXISTS/i.test(s)) return [];
  if (/^SELECT key, value FROM crm_kv WHERE key LIKE 'crm:data:%'$/i.test(s)) {
    return [...table.entries()].filter(([k]) => k.startsWith('crm:data:')).map(([key, value]) => ({ key, value }));
  }
  if (/^SELECT key, value FROM crm_kv WHERE key IN \(/i.test(s)) {
    return params.filter((k) => table.has(k)).map((k) => ({ key: k, value: table.get(k) }));
  }
  if (/^DELETE FROM crm_kv WHERE key IN \(/i.test(s)) {
    for (const k of params) table.delete(k);
    return [];
  }
  if (/^INSERT INTO crm_kv/i.test(s)) {
    for (let i = 0; i < params.length; i += 2) table.set(params[i], params[i + 1]);
    return [];
  }
  throw new Error(`استعلام غير متوقع: ${s}`);
};
const DB = {
  prepare(sql) {
    let params = [];
    return {
      bind(...p) {
        params = p;
        return this;
      },
      async all() {
        return { results: run(sql, params), success: true };
      },
    };
  },
};
const assetsHits = [];
const ASSETS = {
  async fetch(request) {
    assetsHits.push(new URL(request.url).pathname);
    return new Response('<!doctype html><title>CRM</title>', { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  },
};
const env = {
  DB,
  ASSETS,
  AUTH_SECRET: 'worker-test-secret-0123456789-abcdef',
  CRON_SECRET: 'worker-cron-secret',
};
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SECRET_KEY;

// بيانات البداية: حساب إدارة (من خلال نفس مخزن D1 بالربط المباشر)
const { useD1Binding, d1Storage } = await import('../server/d1.js');
useD1Binding(DB);
await d1Storage({}).save({
  version: 1,
  data: {
    crm_users: [{ id: 'u-admin', username: 'admin', name: 'الإدارة', role: 'admin', isActive: true, password: 'AdminStrong123' }],
    crm_daily_feedback: [],
    crm_tombstones: [],
  },
});

const worker = (await import('../worker/index.js')).default;
const waits = [];
const ctx = { waitUntil: (p) => waits.push(p) };
const call = (path, init = {}) => worker.fetch(new Request(`https://crm.test${path}`, init), env, ctx);

// ===== ١) الواجهة =====
const home = await call('/');
check('الصفحة الرئيسية بتتخدم من ملفات الواجهة', home.status === 200 && assetsHits.includes('/'));
const pub = await call('/p/abc');
check('صفحة الوحدة العامة /p/<id> من الـ Worker', pub.status === 200 && /text\/html/.test(pub.headers.get('content-type') || '') && !assetsHits.includes('/p/abc'));

// ===== ٢) الدخول والبيانات =====
const locked = await call('/api/store?meta=version');
check('البيانات مقفولة من غير دخول', locked.status === 401, String(locked.status));
const login = await call('/api/auth?action=login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: 'admin', password: 'AdminStrong123', loginType: 'admin' }),
});
check('الدخول شغّال', login.status === 200, String(login.status));
const cookie = String(login.headers.get('set-cookie') || '').split(';')[0];
check('كوكي الجلسة بيرجع', cookie.includes('='));

const feedback = Array.from({ length: 5 }, (_, i) => ({ id: `fb-${i}`, userId: 'u-admin', clientPhone: `0100000${1000 + i}`, feedback: 'كومنت', createdAt: '2026-11-19T08:00:00.000Z' }));
const push = await call('/api/store', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', cookie },
  body: JSON.stringify({ key: 'crm_daily_feedback', value: feedback }),
});
check('الحفظ شغّال', push.status === 200, String(push.status));
const v1 = (await (await call('/api/store?meta=version', { headers: { cookie } })).json()).version;
check('رقم النسخة زاد بعد الحفظ', v1 === 2, String(v1));
const pull = await (await call('/api/store', { headers: { cookie, 'accept-encoding': 'gzip' } })).json();
check('المزامنة بترجّع اللي اتحفظ (من غير ضغط من جوه — Cloudflare بيضغط)', (pull?.data?.crm_daily_feedback || []).length === 5);
const same = await (await call('/api/store', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', cookie },
  body: JSON.stringify({ key: 'crm_daily_feedback', value: pull.data.crm_daily_feedback }),
})).json();
check('حفظ من غير تغيير ما بيزوّدش النسخة', same.version === 2 && same.unchanged === true, JSON.stringify(same));

// ===== ٣) المُشغّل الدوري =====
const cronNo = await call('/api/cron');
check('/api/cron مقفول من غير مفتاح', cronNo.status === 403, String(cronNo.status));
const logs = [];
const realLog = console.log;
console.log = (...a) => logs.push(a.join(' '));
try {
  await worker.scheduled({ cron: '*/5 * * * *' }, env, ctx);
} finally {
  console.log = realLog;
}
check('المُشغّل الدوري (Cron Trigger) بينادي /api/cron بمفتاحه', logs.some((l) => l.startsWith('[cron] 200')), logs.join(' | '));
await Promise.allSettled(waits);

// ===== ٤) الإعداد =====
const toml = fs.readFileSync('wrangler.toml', 'utf8');
check('wrangler.toml: الواجهة + D1 + المُشغّل كل ٥ دقايق + توافق Node', /\[assets\]/.test(toml) && /binding = "DB"/.test(toml) && /crons = \["\*\/5 \* \* \* \*"\]/.test(toml) && /nodejs_compat/.test(toml));
check('مفيش أسرار في wrangler.toml', !/AUTH_SECRET\s*=|CRON_SECRET\s*=|API_TOKEN\s*=/.test(toml));

console.log(`\n✅ نجحت ${passed} فحوصات (الموقع على Cloudflare Workers)`);
