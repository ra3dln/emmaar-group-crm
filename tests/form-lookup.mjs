// ===== إضافة نموذج بالآيدي: يدوّر على الفورم ويجيب اسمه بس — من غير ما يفعّله =====
// التشغيل: node tests/form-lookup.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';

let passed = 0;
const check = (label, condition, extra = '') => {
  assert.ok(condition, `✗ ${label} ${extra}`);
  passed += 1;
  console.log(`✓ ${label}`);
};

// فيسبوك وهمي: الفورم 111 موجود بتوكن الصفحة بس، والتوكن الغلط بيرجّع خطأ
const realFetch = globalThis.fetch;
const calls = [];
globalThis.fetch = async (url) => {
  const u = new URL(String(url));
  calls.push(u.pathname + '?' + u.searchParams.get('access_token'));
  const token = u.searchParams.get('access_token');
  if (u.pathname.endsWith('/111') && token === 'page-token') {
    return new Response(JSON.stringify({ id: '111', name: 'فورم التجمع', page: { id: '999' } }));
  }
  return new Response(JSON.stringify({ error: { message: 'Unsupported get request', code: 100 } }));
};

const { fetchFormInfo } = await import('../server/leadSource.js');

const info = await fetchFormInfo('111', ['bad-token', 'page-token']);
check('بيجيب اسم الفورم من الآيدي', info.name === 'فورم التجمع', JSON.stringify(info));
check('بيجيب صفحة الفورم', info.pageId === '999');
check('بيجرّب التوكنات بالترتيب لحد ما واحد ينفع', calls.length === 2);

let error = null;
try {
  await fetchFormInfo('222', ['page-token']);
} catch (e) {
  error = e;
}
check('آيدي مش موجود → خطأ (ما بيتضافش باسم وهمي)', !!error);

let badId = null;
try {
  await fetchFormInfo('abc', ['page-token']);
} catch (e) {
  badId = e;
}
check('آيدي مش أرقام → خطأ من غير ما يكلّم فيسبوك', !!badId && calls.length === 3);

globalThis.fetch = realFetch;

// ===== الواجهة: الإضافة ما بتفعّلش الفورم =====
const app = fs.readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const fn = app.slice(app.indexOf('const addManualForm = async'), app.indexOf('const nextSourceType'));
check('زرار «أضف النموذج» بيدوّر بالآيدي (form-info)', /action: 'form-info'/.test(fn));
check('الإضافة ما بتعلّمش على الفورم (من غير تفعيل)', fn.length > 0 && !/setSelected/.test(fn));
check('ما بيضيفش اسم وهمي «نموذج <آيدي>»', !/name: `نموذج \$\{id\}`/.test(fn));

const api = fs.readFileSync(new URL('../api/lead-source.js', import.meta.url), 'utf8');
check('الـ API فيها form-info في الوضعين', api.split("action === 'form-info'").length === 3);

console.log(`\n✅ نجحت ${passed} فحوصات (البحث عن نموذج بالآيدي)`);
