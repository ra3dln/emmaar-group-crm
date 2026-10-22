// ===== اختبار استكشاف الصفحات (ليه كانت بتظهر صفحة واحدة بس) =====
// يتحقق من:
//  ١) توكن صفحة (Page Token): يُكتشف ويُشرح للمستخدم، وما يمنعش عرض اللي ظهر.
//  ٢) متابعة «التالي» في /me/accounts — صفحة بعد أول ١٠٠ ما تضيعش.
//  ٣) صفحات الأعمال: owned_pages و client_pages تُدمج بلا تكرار (صفحة الأدمن داخل
//     Business Manager كانت تختفي تماماً).
//  ٤) الصفحة اللي رجعت بلا توكن: يُطلب توكنها على حدة.
//  ٥) فشل مصدر واحد لا يمنع الباقي، ويظهر في التشخيص بصلاحيته (business_management).
//  ٦) لو مفيش أي صفحة: خطأ واضح — وتوكن الصفحة رسالته مختلفة.
//
// التشغيل: node tests/discover-pages.mjs

import assert from 'node:assert/strict';

const { discoverPages } = await import('../server/leadSource.js');

let passed = 0;
const check = (label, condition, extra = '') => {
  assert.ok(condition, `✗ ${label} ${extra}`);
  passed += 1;
  console.log(`✓ ${label}`);
};

// رد فيسبوك الوهمي: graphGet يفحص ok ثم يقرأ json()
const json = (data) => ({ ok: true, status: 200, json: async () => data });
const realFetch = globalThis.fetch;

// ===== ١) استكشاف كامل: ترقيم + أعمال + إكمال توكن الصفحة =====
{
  const calls = [];
  globalThis.fetch = async (url) => {
    const parsed = new URL(String(url));
    calls.push(`${parsed.pathname}${parsed.search}`);
    if (parsed.pathname.endsWith('/debug_token')) {
      return json({ data: { is_valid: true, expires_at: 1893456000, type: 'USER', scopes: ['pages_show_list'] } });
    }
    if (parsed.pathname.endsWith('/me/accounts')) {
      if (parsed.searchParams.get('after') === 'cursor-1') {
        return json({ data: [{ id: 'page-b', name: 'صفحة ب' }] }); // بلا توكن
      }
      return json({
        data: [{ id: 'page-a', name: 'أفضل الشركات المطورة في العبور', access_token: 'TOKEN-A' }],
        paging: { cursors: { after: 'cursor-1' } },
      });
    }
    if (parsed.pathname.endsWith('/me/businesses')) {
      return json({ data: [{ id: 'biz-1', name: 'إعمار' }] });
    }
    if (parsed.pathname.endsWith('/biz-1/owned_pages')) {
      // page-a مكررة (ظهرت في الحساب) — لازم تتدمج لا تتكرر
      return json({
        data: [
          { id: 'page-a', name: 'أفضل الشركات المطورة في العبور' },
          { id: 'page-c', name: 'صفحة الأدمن في الأعمال', access_token: 'TOKEN-C' },
        ],
      });
    }
    if (parsed.pathname.endsWith('/biz-1/client_pages')) {
      return json({ data: [{ id: 'page-d', name: 'صفحة عميل', access_token: 'TOKEN-D' }] });
    }
    if (parsed.pathname.endsWith('/page-b')) {
      return json({ id: 'page-b', name: 'صفحة ب', access_token: 'TOKEN-B' });
    }
    return json({ error: { message: 'unexpected ' + parsed.pathname, code: 100 } });
  };

  const result = await discoverPages('USER-TOKEN');
  const ids = result.pages.map((p) => p.id).sort();
  check('كل الصفحات اكتُشفت بلا تكرار', JSON.stringify(ids) === JSON.stringify(['page-a', 'page-b', 'page-c', 'page-d']), JSON.stringify(ids));
  check('صفحة الأعمال (owned) ظهرت', ids.includes('page-c'));
  check('صفحة العميل (client) ظهرت', ids.includes('page-d'));
  check('الصفحة اللي بلا توكن أكملت توكنها', result.pages.find((p) => p.id === 'page-b')?.token === 'TOKEN-B');
  check('ميعاد انتهاء التوكن رجع من التشخيص', result.tokenExpiresAt === 1893456000);
  check('نوع التوكن USER معروف', result.tokenType === 'USER');
  check(
    'مصدر صفحات الحساب اتقرأ بالترقيم',
    result.sources.find((s) => s.name === 'صفحات حسابك')?.count === 2,
    JSON.stringify(result.sources)
  );
  check(
    'مصدر صفحات الأعمال نجح',
    result.sources.find((s) => s.name.includes('الأعمال'))?.ok === true
  );
  check('لا تحذير في الاستكشاف الكامل', result.warning === '', result.warning);
  check('طلبنا صفحة «التالي» فعلاً', calls.some((c) => c.includes('after=cursor-1')));
  check('طلبنا صفحة التوكن المفقود', calls.some((c) => c.includes('/page-b')));
}

// ===== ٢) توكن صفحة واحدة + فشل الأعمال =====
{
  globalThis.fetch = async (url) => {
    const parsed = new URL(String(url));
    if (parsed.pathname.endsWith('/debug_token')) {
      return json({ data: { is_valid: true, expires_at: 0, type: 'PAGE' } });
    }
    if (parsed.pathname.endsWith('/me/accounts')) {
      return json({ data: [{ id: 'page-a', name: 'أفضل الشركات المطورة في العبور', access_token: 'PAGE-TOKEN' }] });
    }
    if (parsed.pathname.endsWith('/me/businesses')) {
      return json({ error: { message: 'Requires business_management permission', code: 200 } });
    }
    return json({ error: { message: 'unexpected', code: 100 } });
  };

  const result = await discoverPages('PAGE-TOKEN');
  check('صفحة التوكن الواحد ظهرت', result.pages.length === 1 && result.pages[0].id === 'page-a');
  check('نوع التوكن PAGE مكشوف', result.tokenType === 'PAGE');
  check('التحذير يشرح أن المطلوب User Access Token', result.warning.includes('Page Access Token'));
  check('التحذير يذكر business_management', result.warning.includes('business_management'), result.warning);
  check(
    'فشل الأعمال مسجّل بتشخيصه',
    result.sources.find((s) => s.name.includes('الأعمال'))?.ok === false
  );
}

// ===== ٣) فشل /me/accounts وصلاحياته — الأعمال تنقذ الاستكشاف =====
{
  globalThis.fetch = async (url) => {
    const parsed = new URL(String(url));
    if (parsed.pathname.endsWith('/debug_token')) {
      return json({ data: { is_valid: true, expires_at: 0, type: 'USER' } });
    }
    if (parsed.pathname.endsWith('/me/accounts')) {
      return json({ error: { message: 'Requires pages_show_list permission', code: 200 } });
    }
    if (parsed.pathname.endsWith('/me/businesses')) {
      return json({ data: [{ id: 'biz-1', name: 'إعمار' }] });
    }
    if (parsed.pathname.endsWith('/biz-1/owned_pages')) {
      return json({ data: [{ id: 'page-x', name: 'صفحة الأعمال', access_token: 'TOKEN-X' }] });
    }
    if (parsed.pathname.endsWith('/biz-1/client_pages')) {
      return json({ data: [] });
    }
    return json({ error: { message: 'unexpected', code: 100 } });
  };

  const result = await discoverPages('USER-TOKEN');
  check('صفحة الأعمال ظهرت رغم فشل /me/accounts', result.pages.length === 1 && result.pages[0].id === 'page-x');
  const failed = result.sources.find((s) => s.name === 'صفحات حسابك');
  check('فشل صفحات الحساب مسجّل بصلاحيته', failed?.ok === false && failed?.permission === 'pages_show_list');
  check('التحذير يوضّح سبب الفشل', result.warning.includes('صفحات حسابك'), result.warning);
}

// ===== ٤) لا صفحات إطلاقاً =====
{
  globalThis.fetch = async (url) => {
    const parsed = new URL(String(url));
    if (parsed.pathname.endsWith('/debug_token')) {
      return json({ data: { is_valid: true, expires_at: 0, type: 'PAGE' } });
    }
    return json({ data: [] });
  };

  await assert.rejects(
    () => discoverPages('PAGE-TOKEN'),
    (error) => {
      check('رسالة الخطأ ترشد لاستخدام User Access Token', /Page Access Token/.test(error.message), error.message);
      return true;
    }
  );
}

// ===== ٥) ربط الواجهة بالتشخيص =====
{
  const fs = await import('node:fs');
  const app = fs.readFileSync('src/App.tsx', 'utf8');
  const api = fs.readFileSync('api/lead-source.js', 'utf8');
  check('الواجهة تعرض مصادر الصفحات', app.includes('مصادر الصفحات في آخر استكشاف') && app.includes('setPageSources'));
  check('الواجهة تحذّر من Page Token', app.includes("tokenKind === 'PAGE'") && app.includes('business_management'));
  check('تنبيه الاستكشاف يحفظ أسطره', app.includes('whitespace-pre-line'));
  check('الاستضافة تُرجع التشخيص مع الصفحات', api.includes('sources = []') && api.includes('tokenType'));
}

globalThis.fetch = realFetch;
console.log(`\n✅ نجحت ${passed} فحوصات لاكتشاف الصفحات`);
