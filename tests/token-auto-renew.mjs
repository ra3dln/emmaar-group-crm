// ===== التجديد التلقائي لتوكن فيسبوك: المسار المنشور على الاستضافة =====
// المشكلة التي كانت تُوقف الأرقام: توكن Graph API Explorer يعيش ساعتين،
// المسار المنشور (api/lead-source.js) كان يحفظه كما هو — فالتنبيه كان يرجع
// كل يومين والعميل يظن أن «توليد توكن جديد» لا يفيد.
//
// الاختبار يغطي:
//   ١) المسار المنشور فعلاً (api/lead-source.js) يوسّع التوكن قبل الحفظ.
//   ٢) التجديد الذاتي أثناء السحب الدوري (renewExpiringTokens) بيبدّل التوكن ويحفظه.
//   ٣) سر التطبيق يُحفظ على السيرفر ولا يظهر في الردود إطلاقاً.
//   ٤) السحب لا يتوقف بانتهاء توكن المستخدم — توكنات الصفحات بديل دائم.
//   ٥) التنبيه يقول الحقيقة: السحب مستمر بتوكنات الصفحات.
//   ٦) المُشغّل الدوري لا يرمي خطأ ReferenceError (الإشعارات تصل فعلاً).
//
// التشغيل: node tests/token-auto-renew.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

process.env.AUTH_SECRET = 'unit-test-secret-0123456789-abcdef';
delete process.env.FB_APP_SECRET;
delete process.env.META_APP_SECRET;
delete process.env.FB_APP_ID;
delete process.env.META_APP_ID;

const DAY = 24 * 60 * 60 * 1000;
const nowSec = () => Math.floor(Date.now() / 1000);
const realFetch = globalThis.fetch;

const json = (body) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });
const errorJson = (message, code) => ({ ok: false, status: 400, json: async () => ({ error: { message, code } }) });

const SHORT_TOKEN = 'SHORT-USER-TOKEN';
const LONG_TOKEN = 'LONG-LIVED-USER-TOKEN';
const PAGE_TOKEN = 'PAGE-TOKEN-1';

// حالة فيسبوك المزيّفة: توكن المستخدم قصير، وتبديله يدي توكن ٦٠ يوماً
let tokenExpirySeconds = nowSec() + 2 * 60 * 60;
const calls = [];

globalThis.fetch = async (input) => {
  const url = new URL(typeof input === 'string' ? input : input.href || input.url || String(input));
  calls.push(`${url.pathname}`);

  if (url.pathname.endsWith('/debug_token')) {
    const inspected = url.searchParams.get('input_token') || '';
    const access = url.searchParams.get('access_token') || '';
    const expired = inspected === 'EXPIRED-TOKEN';
    // ميتا بترفض فحص توكن مستخدم بـ access_token = التوكن نفسه (رمز 190)
    // — والطريقة الصحيحة هي App Access Token (app_id|app_secret).
    if (!access.includes('|')) {
      return errorJson('Invalid OAuth access token data.', 190);
    }
    return json({
      data: {
        is_valid: !expired,
        type: inspected.includes('PAGE-TOKEN') ? 'PAGE' : 'USER',
        app_id: '2010203473000828',
        expires_at: expired ? nowSec() - 60 : inspected.includes('PAGE-TOKEN') ? 0 : tokenExpirySeconds,
        scopes: ['leads_retrieval', 'pages_show_list'],
      },
    });
  }

  if (url.pathname.endsWith('/oauth/access_token')) {
    assert.equal(url.searchParams.get('grant_type'), 'fb_exchange_token');
    assert.ok(url.searchParams.get('client_id'), 'الـ App ID لازم يتبعت');
    assert.ok(url.searchParams.get('client_secret'), 'الـ App Secret لازم يتبعت');
    tokenExpirySeconds = nowSec() + 60 * DAY;
    // ميتا بترجّع مدة الصلاحية مع التوكن الجديد — وهي أدقّ من قراءة debug_token
    return json({ access_token: LONG_TOKEN, token_type: 'bearer', expires_in: 60 * DAY });
  }

  if (url.pathname.endsWith('/me/accounts')) {
    return json({ data: [{ id: 'page-1', name: 'صفحة تجريبية', access_token: PAGE_TOKEN }] });
  }
  if (url.pathname.endsWith('/me/businesses')) return json({ data: [] });
  if (url.pathname.endsWith('/leadgen_forms')) return json({ data: [{ id: 'form-1', name: 'فورم', status: 'ACTIVE' }] });

  // سحب الأرقام: توكن المستخدم المنتهي يُرفض، وتوكن الصفحة يجيب الأرقام
  if (url.pathname.endsWith('/leads')) {
    const token = url.searchParams.get('access_token') || '';
    if (token === 'EXPIRED-TOKEN') return errorJson('Invalid OAuth access token.', 190);
    return json({ data: [{ created_time: '1760000000', field_data: [{ name: 'phone_number', values: ['01000000000'] }, { name: 'full_name', values: ['عميل'] }] }] });
  }

  return json({ data: [] });
};

const { signSession, COOKIE_NAME } = await import('../server/auth.js');
const {
  applyChannelPatch,
  longLivedCredentials,
  prepareToken,
  publicConfig,
  renewExpiringTokens,
  debugToken,
  tokenExpiryAlerts,
} = await import('../server/leadSource.js');

const managerSession = signSession(process.env, { id: 'boss-1', r: 'admin', u: 'boss' });
const authCookie = `${COOKIE_NAME}=${encodeURIComponent(managerSession)}`;

// ===== ١) المسار المنشور على الاستضافة: الاستكشاف يوسّع التوكن قبل الحفظ =====
{
  // سر التطبيق محفوظ في الإعدادات (على السيرفر) — لا في متغيّرات بيئة
  const config = { appSecret: 'secret-from-settings', appId: '2010203473000828' };
  const prepared = await prepareToken(SHORT_TOKEN, config);
  assert.equal(prepared.extended, true, 'التوكن القصير اتمدّد');
  assert.equal(prepared.token, LONG_TOKEN, 'التوكن المستخدم هو الممدَّد');
  assert.match(prepared.hint, /تمديد/, 'رسالة التمديد واضحة');
  console.log('✓ سر التطبيق المحفوظ في الإعدادات يحوّل التوكن القصير إلى ٦٠ يوماً');
}

// ===== ١ب) تشخيص الصلاحية لازم يمرّ بـ App Access Token =====
// (السبب الجذري: ميتا بترفض /debug_token لما نمرّر توكن المستخدم نفسه —
//  فكان الميعاد بيتقرا «مش معروف» ومفيش تمديد ولا تاريخ.)
{
  const debugCalls = [];
  const prevFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = new URL(typeof input === 'string' ? input : input.href || input.url || String(input));
    if (url.pathname.endsWith('/debug_token')) {
      const access = url.searchParams.get('access_token') || '';
      debugCalls.push(access);
      if (!access.includes('|')) return errorJson('Invalid OAuth access token data.', 190);
      return json({ data: { is_valid: true, type: 'USER', expires_at: nowSec() + 2 * 60 * 60 } });
    }
    return prevFetch(input);
  };
  const info = await debugToken(SHORT_TOKEN, { appSecret: 'secret-from-settings' });
  assert.ok(info, 'التشخيص نجح');
  assert.equal(info.type, 'USER', 'نوع التوكن اتقرا صح');
  assert.ok(info.expiresAt > nowSec(), 'ميعاد الانتهاء اتقرا — مش صفر');
  assert.equal(debugCalls[0].includes('|'), true, 'أول محاولة تستخدم App Access Token (app_id|app_secret)');
  globalThis.fetch = prevFetch;
  console.log('✓ تشخيص صلاحية التوكن بيستخدم App Access Token — فميعاد الانتهاء بيتقرا صح');
}

// ===== ٢) المسار المنشور فعلاً: api/lead-source.js يوسّع التوكن =====
// (هذا هو المسار الذي كان لا يوسّع — التنبيه كان يرجع كل يومين)
{
  const { default: leadSourceHandler } = await import('../api/lead-source.js');
  calls.length = 0;
  tokenExpirySeconds = nowSec() + 2 * 60 * 60; // توكن جديد من Graph Explorer (ساعتين)
  const res = await callHandler(leadSourceHandler, {
    method: 'POST',
    url: '/api/lead-source',
    headers: { cookie: authCookie },
    body: { action: 'discover', channel: 'facebook', token: SHORT_TOKEN, config: { appSecret: 'secret-from-settings' } },
  });
  assert.equal(res.status, 200, `الاستكشاف نجح: ${JSON.stringify(res.payload).slice(0, 200)}`);
  assert.equal(res.payload.extended, true, 'الاستكشاف بيقول إن التوكن اتمدّد');
  assert.equal(res.payload.token, LONG_TOKEN, 'التوكن المرجوع هو الممدَّد (٦٠ يوماً)');
  assert.ok(
    Number(res.payload.tokenExpiresAt) > nowSec() + 50 * DAY,
    'ميعاد الانتهاء الجديد ~٦٠ يوم'
  );
  assert.match(String(res.payload.hint || ''), /تمديد/, 'الرسالة بتقول إن التوكن اتمدّد');
  console.log('✓ المسار المنشور (api/lead-source.js) يوسّع التوكن ويرجّع توكن ٦٠ يوماً');
}

// ===== ٣) التجديد الذاتي أثناء السحب الدوري =====
{
  calls.length = 0;
  tokenExpirySeconds = nowSec() + 2 * 60 * 60;
  const config = {
    enabled: true,
    type: 'meta',
    token: SHORT_TOKEN,
    tokenExpiresAt: nowSec() + 2 * 60 * 60,
    forms: [{ id: 'form-1', pageId: 'page-1', name: 'فورم' }],
    pages: [{ id: 'page-1', name: 'صفحة', token: PAGE_TOKEN }],
    appSecret: 'secret-from-settings',
  };
  const renewed = await renewExpiringTokens(config);
  assert.equal(renewed.changed, true, 'التوكن اتجدّد');
  assert.equal(renewed.config.token, LONG_TOKEN, 'التوكن المبدَّل اتحفظ');
  assert.ok(renewed.config.tokenExpiresAt > nowSec() + 50 * DAY, 'ميعاد الانتهاء الجديد ~٦٠ يوم');
  assert.ok(renewed.notes.length, 'فيه ملاحظة للمستخدم');
  console.log('✓ السحب الدوري يجدّد التوكن لوحده ويحفظه');
}

// توكن لسه صالح طويلاً => ما فيش أي طلب لميناتا (منع الطلبات الزائدة)
{
  calls.length = 0;
  const config = {
    token: LONG_TOKEN,
    tokenExpiresAt: nowSec() + 40 * DAY,
    appSecret: 'secret-from-settings',
  };
  const renewed = await renewExpiringTokens(config);
  assert.equal(renewed.changed, false, 'التوكن السليم ما اتلمسش');
  assert.equal(calls.filter((c) => c.includes('oauth')).length, 0, 'مافيش طلب تمديد بلا داعي');
  console.log('✓ التوكن السليم مايتجدّدش (بلا طلبات زيادة على فيسبوك)');
}

// ===== ٤) سر التطبيق: يُحفظ على السيرفر ولا يظهر في الردود =====
{
  const patched = applyChannelPatch({ token: SHORT_TOKEN }, { channel: 'facebook', appSecret: 'super-secret-value' });
  assert.equal(patched.appSecret, 'super-secret-value', 'السر اتحفظ في الإعدادات');
  const view = publicConfig(patched);
  assert.equal(view.hasAppSecret, true, 'الواجهة تعرف إن السر متسجّل');
  assert.equal(view.autoRenewReady, true, 'التجديد التلقائي جاهز');
  assert.equal(JSON.stringify(view).includes('super-secret-value'), false, 'السر ما يظهرش في الرد');
  const cleared = applyChannelPatch(patched, { channel: 'facebook', clearAppSecret: true });
  assert.equal(cleared.appSecret, undefined, 'مسح السر ممكن');
  assert.equal(publicConfig(cleared).hasAppSecret, false, 'بعد المسح مافيش تجديد تلقائي');
  console.log('✓ سر التطبيق محفوظ على السيرفر ولا يظهر في الردود');
}

// ===== ٥) السحب لا يتوقف بانتهاء توكن المستخدم (توكنات الصفحات بديل) =====
{
  const { fetchLeads } = await import('../server/leadSource.js');
  calls.length = 0;
  const config = {
    type: 'meta',
    token: 'EXPIRED-TOKEN', // توكن المستخدم انتهى
    tokenExpiresAt: nowSec() - 60,
    pages: [{ id: 'page-1', name: 'صفحة', token: PAGE_TOKEN }],
    forms: [{ id: 'form-1', pageId: '', name: 'فورم' }], // فورم بدون pageId
  };
  const rows = await fetchLeads(config, 'facebook');
  assert.equal(rows.length, 1, 'الأرقام وصلت رغم انتهاء توكن المستخدم');
  assert.equal(rows[0].phone, '01000000000', 'الرقم اتقرأ صح');
  console.log('✓ السحب مستمر بتوكن الصفحة حتى لو انتهى توكن المستخدم');
}

// توكن صفحة بلا صلاحية على الفورم => النظام يجرّب توكن الصفحة الصح بدل ما يفشل
{
  globalThis.fetch = async (input) => {
    const url = new URL(typeof input === 'string' ? input : input.href || input.url || String(input));
    if (url.pathname.endsWith('/debug_token')) {
      return json({ data: { is_valid: true, expires_at: 1893456000, type: 'USER', scopes: [] } });
    }
    if (url.pathname.endsWith('/leads')) {
      const token = url.searchParams.get('access_token') || '';
      if (token === 'WRONG-PAGE-TOKEN') {
        return errorJson('(#200) Requires leads_retrieval permission', 200);
      }
      return json({ data: [{ created_time: '1760000000', field_data: [{ name: 'phone_number', values: ['01111111111'] }] }] });
    }
    return json({ data: [] });
  };
  const { fetchLeads } = await import('../server/leadSource.js');
  const rows = await fetchLeads(
    {
      type: 'meta',
      token: 'EXPIRED-TOKEN',
      pages: [
        { id: 'page-x', token: 'WRONG-PAGE-TOKEN' },
        { id: 'page-y', token: PAGE_TOKEN },
      ],
      forms: [{ id: 'form-1', pageId: '', name: 'فورم' }],
    },
    'facebook'
  );
  assert.equal(rows.length, 1, 'النظام جرب توكن الصفحة الصح');
  assert.equal(rows[0].phone, '01111111111', 'الرقم اتقرأ صح');
  globalThis.fetch = async (input) => {
    const url = new URL(typeof input === 'string' ? input : input.href || input.url || String(input));
    if (url.pathname.endsWith('/debug_token')) {
      return json({ data: { is_valid: true, expires_at: 1893456000, type: 'USER', scopes: [] } });
    }
    if (url.pathname.endsWith('/leads')) {
      const token = url.searchParams.get('access_token') || '';
      if (token === 'EXPIRED-TOKEN') return errorJson('Invalid OAuth access token.', 190);
      return json({ data: [{ created_time: '1760000000', field_data: [{ name: 'phone_number', values: ['01000000000'] }] }] });
    }
    return json({ data: [] });
  };
  console.log('✓ توكن صفحة بلا صلاحية ما بيوقّفش السحب — بييجرّب توكن صفحة تانية');
}

// القناة الجاهزة حتى لو انتهى توكن المستخدم (توكن صفحة موجود)
{
  const { isChannelReady } = await import('../server/leadSource.js');
  const ready = isChannelReady({
    type: 'meta',
    token: 'EXPIRED-TOKEN',
    pages: [{ id: 'page-1', token: PAGE_TOKEN }],
    forms: [{ id: 'form-1' }],
  });
  assert.equal(ready, true, 'القناة جاهزة بتوكن الصفحة');
  console.log('✓ القناة جاهزة حتى لو انتهى توكن المستخدم');
}

// ===== ٤ب) الميعاد بيتحسب من expires_in اللي ميتا بترجّعه مع التوكن =====
// (لأن فحص debug_token ممكن يرجع خطأ من ميتا فيبقى الميعاد مجهولاً والتنبيه غلط)
{
  const prevFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = new URL(typeof input === 'string' ? input : input.href || input.url || String(input));
    if (url.pathname.endsWith('/debug_token')) {
      // ميتا بترفض الفحص هنا → الميعاد لازم يبقى معروف من expires_in
      return errorJson('Invalid OAuth access token data.', 190);
    }
    if (url.pathname.endsWith('/oauth/access_token')) {
      return json({ access_token: LONG_TOKEN, token_type: 'bearer', expires_in: 60 * DAY });
    }
    return prevFetch(input);
  };
  const prepared = await prepareToken(SHORT_TOKEN, { appSecret: 'secret-from-settings' });
  assert.equal(prepared.extended, true, 'التوكن اتمدّد');
  assert.ok(prepared.expiresAt > nowSec() + 55 * DAY, 'ميعاد الانتهاء اتحسب من expires_in (~٦٠ يوم)');
  globalThis.fetch = prevFetch;
  console.log('✓ ميعاد انتهاء التوكن بيتحسب من expires_in حتى لو فحص debug_token فشل');
}

// ===== ٦) التنبيه يقول الحقيقة: السحب مستمر بتوكنات الصفحات =====
{
  const alerts = tokenExpiryAlerts({
    token: SHORT_TOKEN,
    tokenExpiresAt: nowSec() + 3600,
    pages: [{ id: 'page-1', token: PAGE_TOKEN }],
    forms: [{ id: 'form-1' }],
  });
  assert.equal(alerts.length, 1, 'في تنبيه واحد');
  assert.match(alerts[0].body, /توكنات الصفحات/, 'التنبيه يقول إن السحب مستمر');
  assert.doesNotMatch(alerts[0].title, /السحب متوقف/, 'العنوان مايقولش إن السحب متوقف');
  console.log('✓ التنبيه صادق: السحب مستمر بتوكنات الصفحات');
}

// ===== ٧) المُشغّل الدوري: ما فيه مرجع لمتغيّر غير معرّف (كان يوقف الإشعارات) =====
{
  const cronSource = fs.readFileSync(path.resolve('api/cron.js'), 'utf8');
  // نشيل التعليقات قبل الفحص: الاسم المسجّل في شرح الكود غير ناقد، المهم الكود نفسه
  const cronCode = cronSource.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  assert.equal(/useSupabase/.test(cronCode), false, 'api/cron.js ما فيهاش useSupabase (كان ReferenceError)');
  assert.match(cronCode, /renewExpiringTokens/, 'المُشغّل الدوري يجدّد التوكن');
  assert.match(cronCode, /pickJsonStore\(process\.env, VAPID_KEY\)/, 'المُشغّل يقرأ مفاتيح الإشعارات من نفس المخزون');
  console.log('✓ المُشغّل الدوري يجدّد التوكن ولا يرمي خطأ في الإشعارات');
}

globalThis.fetch = realFetch;
console.log('\n✅ نجحت فحوصات التجديد التلقائي لتوكن فيسبوك');

function callHandler(handler, { method, url, headers = {}, body }) {
  return new Promise((resolve) => {
    const req = {
      method,
      url,
      headers,
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
