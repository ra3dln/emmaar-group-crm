// ===== اختبار تمديد توكن فيسبوك إلى ٦٠ يوماً =====
// المشكلة: توكن Graph API Explorer قصير (ساعتان)، فالسحب يتوقف كل فترة ويحتاج
// توكن جديد يدوياً. الحل: تمديده تلقائياً عبر fb_exchange_token عند الحفظ/الاستكشاف.
// الاختبار يضمن:
//   ١) توكن قصير + App Secret متاح => يُبدَّل بتوكن طويل ويُحفظ هو في الإعدادات.
//   ٢) بدون App Secret => التوكن يُحفظ كما هو مع رسالة توضح المطلوب (لا فشل).
//   ٣) توكن طويل باقي فيه أسابيع => لا طلب تمديد أصلاً (مافيش طلبات زيادة على فيسبوك).
//   ٤) توكن صفحة (PAGE) => لا يُمدَّد (التمديد لتوكنات المستخدم فقط).
//   ٥) مسار الاستكشاف يحفظ التوكن الممدَّد وليس التوكن القصير اللي اتلصق.
//
// التشغيل: node tests/token-extend.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DAY = 24 * 60 * 60 * 1000;
const nowSec = () => Math.floor(Date.now() / 1000);

// ---- فيسبوك مزيّف: كل الطلبات تروح لردود محددة ----
const calls = [];
const SHORT_TOKEN = 'SHORT-USER-TOKEN';
const LONG_TOKEN = 'LONG-LIVED-USER-TOKEN';
const PAGE_TOKEN = 'PAGE-TOKEN-123';
let tokenExpirySeconds = nowSec() + 2 * 60 * 60; // ساعتان

globalThis.fetch = async (input) => {
  const url = new URL(typeof input === 'string' ? input : input.href || input.url || String(input));
  const raw = decodeURIComponent(url.search);

  if (url.pathname.endsWith('/debug_token')) {
    calls.push('debug_token');
    const inspected = (raw.match(/input_token=([^&]+)/) || [])[1] || '';
    const isPage = inspected.includes('PAGE-TOKEN');
    return json({
      data: {
        is_valid: true,
        type: isPage ? 'PAGE' : 'USER',
        app_id: '1234567890',
        expires_at: isPage ? 0 : tokenExpirySeconds,
        scopes: ['leads_retrieval', 'pages_show_list', 'pages_read_engagement'],
      },
    });
  }

  if (url.pathname.endsWith('/oauth/access_token')) {
    calls.push('exchange');
    assert.equal(url.searchParams.get('grant_type'), 'fb_exchange_token');
    assert.equal(url.searchParams.get('client_id'), '1234567890');
    assert.equal(url.searchParams.get('client_secret'), 'app-secret-value');
    assert.equal(url.searchParams.get('fb_exchange_token'), SHORT_TOKEN);
    tokenExpirySeconds = nowSec() + 60 * DAY; // ميتا ترجّع توكن ٦٠ يوماً
    return json({ access_token: LONG_TOKEN, token_type: 'bearer', expires_in: 5183944 });
  }

  calls.push(url.pathname);
  // صفحة واحدة عشان الاستكشاف ينجح زي الواقع
  if (url.pathname.endsWith('/me/accounts')) {
    return json({ data: [{ id: 'p1', name: 'صفحة تجريبية', access_token: 'PAGE-TOKEN-123' }] });
  }
  return json({ data: [] }); // /me/businesses، النماذج...
};

function json(body) {
  return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
}

const env = process.env;
const withCreds = () => {
  env.FB_APP_ID = '1234567890';
  env.FB_APP_SECRET = 'app-secret-value';
};
const withoutCreds = () => {
  delete env.FB_APP_ID;
  delete env.FB_APP_SECRET;
  delete env.META_APP_ID;
  delete env.META_APP_SECRET;
};

const { prepareToken, longLivedCredentials, createLeadSourceHandler } = await import('../server/leadSource.js');

// ١) تمديد التوكن القصير
withCreds();
assert.equal(longLivedCredentials().ready, true, 'المفاتيح المقروءة من البيئة');
calls.length = 0;
tokenExpirySeconds = nowSec() + 2 * 60 * 60;
let out = await prepareToken(SHORT_TOKEN);
assert.equal(calls.includes('exchange'), true, 'طلب تمديد ات executed');
assert.equal(out.token, LONG_TOKEN, 'التوكن الممدَّد هو المستخدم');
assert.equal(out.extended, true, 'اتعلّم إنه اتمدّد');
assert.ok(out.expiresAt > nowSec() + 50 * 24 * 60 * 60, 'صلاحيته بقت ~٦٠ يوم');
assert.match(out.hint, /تمديد/, 'رسالة التمديد واضحة');
console.log('✓ التوكن القصير اتمدّد إلى توكن ٦٠ يوم');

// ٢) بدون App Secret: مايفشلش، بس يوضّح المطلوب
withoutCreds();
assert.equal(longLivedCredentials().ready, false);
calls.length = 0;
tokenExpirySeconds = nowSec() + 2 * 60 * 60; // توكن قصير زي اللي جاي من Graph Explorer
out = await prepareToken(SHORT_TOKEN);
assert.equal(out.token, SHORT_TOKEN, 'التوكن زي ما هو');
assert.equal(out.extended, false);
assert.equal(calls.includes('exchange'), false, 'مافيش محاولة تمديد بلا مفاتيح');
assert.match(out.hint, /FB_APP_SECRET/, 'الرسالة بتقول المتغير المطلوب');
console.log('✓ من غير App Secret: التوكن يُحفظ مع رسالة توضّح المطلوب');

// ٣) توكن طويل باقي فيه أسابيع => لا تمديد
withCreds();
calls.length = 0;
tokenExpirySeconds = nowSec() + 40 * DAY;
out = await prepareToken(LONG_TOKEN);
assert.equal(calls.includes('exchange'), false, 'مافيش طلب تمديد لتوكن سليم');
assert.equal(out.token, LONG_TOKEN);
assert.equal(out.hint, '', 'مافيش تنبيه لتوكن سليم');
console.log('✓ التوكن الطويل السليم مايتلمسش (بلا طلبات زيادة)');

// ٤) توكن صفحة مايتمدّدش
calls.length = 0;
tokenExpirySeconds = nowSec() + 2 * 60 * 60;
out = await prepareToken(PAGE_TOKEN);
assert.equal(calls.includes('exchange'), false, 'توكن الصفحة مايتمدّدش');
assert.equal(out.token, PAGE_TOKEN);
console.log('✓ توكن الصفحة يُترك كما هو');

// ٥) مسار الاستكشاف يحفظ التوكن الممدَّد
withCreds();
calls.length = 0;
tokenExpirySeconds = nowSec() + 2 * 60 * 60;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-token-'));
const configFile = path.join(dir, 'lead-source.json');
const handler = createLeadSourceHandler({
  storeFile: path.join(dir, 'store.json'),
  configFile,
  auth: null,
});
const res = await callHandler(handler, {
  method: 'POST',
  url: '/api/lead-source/discover',
  body: { channel: 'facebook', token: SHORT_TOKEN },
});
assert.equal(res.status, 200, `الاستكشاف نجح — الرد: ${JSON.stringify(res.payload).slice(0, 200)}`);
assert.equal(res.payload.extended, true, 'الرد بيقول إنه اتمدّد');
const saved = JSON.parse(fs.readFileSync(configFile, 'utf8'));
assert.equal(String(saved.token || saved.facebook?.token || ''), LONG_TOKEN, 'التوكن المحفوظ هو الممدَّد');
assert.ok(Number(saved.tokenExpiresAt || saved.facebook?.tokenExpiresAt) > nowSec() + 50 * 24 * 60 * 60, 'ميعاد الانتهاء محفوظ صح');
console.log('✓ الاستكشاف بيحفظ التوكن الممدَّد (مش القصير اللي اتلصق)');

fs.rmSync(dir, { recursive: true, force: true });

function callHandler(handler, { method, url, body }) {
  return new Promise((resolve) => {
    const req = {
      method,
      url,
      headers: {},
      on(event, cb) {
        if (event === 'data' && body) cb(Buffer.from(JSON.stringify(body)));
        if (event === 'end') cb();
        return this;
      },
    };
    const res = {
      statusCode: 0,
      headers: {},
      setHeader(k, v) {
        this.headers[k] = v;
      },
      end(text) {
        let payload = null;
        try {
          payload = JSON.parse(text);
        } catch {
          payload = text;
        }
        resolve({ status: this.statusCode, payload });
      },
    };
    handler(req, res).catch((error) => resolve({ status: 500, payload: { error: String(error?.message || error) } }));
  });
}

console.log('\n✅ نجحت ٥ فحوصات (تمديد توكن فيسبوك)');
