// ===== اختبار سحب أرقام الفورم بكل صفحاتها =====
// المشكلة الحقيقية: فيسبوك بيرجع صفحة واحدة في كل طلب (بيسقّفها حتى لو limit أكبر)،
// والكود القديم كان بيقرأ أول صفحة بس — فأي فورم فيه أكثر من صفحة كان بيفقد أرقامه
// بصمت (مثال: الفورم فيه ٣٨ وعندنا ٣٦).
//
// التشغيل: node tests/leads-pagination.mjs

import assert from 'node:assert/strict';

const { fetchLeads } = await import('../server/leadSource.js');

let passed = 0;
const check = (label, condition, extra = '') => {
  assert.ok(condition, `✗ ${label} ${extra}`);
  passed += 1;
  console.log(`✓ ${label}`);
};

const json = (data) => ({ ok: true, status: 200, json: async () => data });
const realFetch = globalThis.fetch;

// صفحتان: ١٠٠ رقم ثم ٣٠ رقم — لازم كلهم يوصلوا (١٣٠ لا ١٠٠)
const page1 = Array.from({ length: 100 }, (_, i) => ({
  created_time: '2026-10-20T10:00:00+0000',
  field_data: [
    { name: 'full_name', values: [`عميل ${i}`] },
    { name: 'phone', values: [`0100000${String(i).padStart(4, '0')}`] },
  ],
}));
const page2 = Array.from({ length: 30 }, (_, i) => ({
  created_time: '2026-10-20T11:00:00+0000',
  field_data: [
    { name: 'full_name', values: [`عميل إضافي ${i}`] },
    { name: 'phone', values: [`0110000${String(i).padStart(4, '0')}`] },
  ],
}));

{
  let requested = 0;
  globalThis.fetch = async (url) => {
    const parsed = new URL(String(url));
    requested += 1;
    if (parsed.searchParams.get('after') === 'cursor-2') return json({ data: page2 });
    return json({ data: page1, paging: { next: 'https://graph.facebook.com/v26.0/form-x/leads?after=cursor-2' } });
  };

  const rows = await fetchLeads({
    type: 'meta',
    token: 'USER-TOKEN',
    forms: [{ id: 'form-x', name: 'GO ADS | CAVA' }],
    pages: [],
  });
  check('كل صفحات الأرقام اتسحبت (١٣٠ لا ١٠٠)', rows.length === 130, `سحب ${rows.length}`);
  check('الصفحة التانية اتطلبت فعلاً', requested >= 2, `طلبات: ${requested}`);
  check('رقم من الصفحة التانية موجود', rows.some((r) => r.phone === '01100000000'));
  check('اسم الفورم محفوظ على كل رقم', rows.every((r) => r.formName === 'GO ADS | CAVA'));
}

// صفحة واحدة بلا paging: يفضل شغال طبيعي
{
  globalThis.fetch = async () => json({ data: page2 });
  const rows = await fetchLeads({
    type: 'meta',
    token: 'USER-TOKEN',
    forms: [{ id: 'form-y', name: 'فورم صغير' }],
    pages: [],
  });
  check('الصفحة الواحدة تُسحب كاملة', rows.length === 30, `سحب ${rows.length}`);
}

// فشل صفحة إضافية لا يضيّع الصفحة الأولى
{
  globalThis.fetch = async (url) => {
    const parsed = new URL(String(url));
    if (parsed.searchParams.get('after') === 'bad') return { ok: false, status: 500, json: async () => ({ error: { code: 1, message: 'boom' } }) };
    return json({ data: page1, paging: { next: 'https://graph.facebook.com/v26.0/form-z/leads?after=bad' } });
  };
  const rows = await fetchLeads({
    type: 'meta',
    token: 'USER-TOKEN',
    forms: [{ id: 'form-z', name: 'فورم بفشل جزئي' }],
    pages: [],
  });
  check('الصفحة الأولى ما بتضيعش لو التانية فشلت', rows.length === 100, `سحب ${rows.length}`);
}

globalThis.fetch = realFetch;
console.log(`\n✅ نجحت ${passed} فحوصات لسحب صفحات الأرقام`);
