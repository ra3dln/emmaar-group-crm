// ===== الصفحة العامة للعقار + استقبال الليدز من خارج النظام =====
// تعمل على سيرفر الشركة نفسه بدون أي خدمة خارجية:
//   GET  /p/<id>                => صفحة عرض الوحدة (تُفتح لأي عميل بلا تسجيل دخول)
//   GET  /api/public/property   => بيانات الوحدة (للعرض في الصفحة)
//   POST /api/public/lead       => تسجيل اهتمام عميل من الرابط العام => يدخل الليد للنظام فوراً
//
// الرابط يُشارك من داخل النظام (تفاصيل العقار => نسخ الرابط / مشاركة واتساب)،
// وأي عميل يسجّل رقمه يظهر عند صاحب العقار ثم لكل الفريق عبر المزامنة.

import { randomUUID } from 'node:crypto';
import { fileStorage } from './store.js';
import { normalizeEgyptPhone } from './leadSource.js';

const MAX_BODY = 64 * 1024;

// ===== حماية: تحديد معدل طلبات الرابط العام (بلا تسجيل دخول) =====
// 30 طلباً من نفس الـ IP خلال ١٠ دقائق — يمنع الإغراق مع عدم إزعاج الزوار الحقيقيين.
const PUBLIC_WINDOW_MS = 10 * 60_000;
const PUBLIC_MAX = 30;
const publicHits = new Map();
const publicRateLimited = (req) => {
  const ip = String(
    (req.headers && (req.headers['x-forwarded-for'] || req.headers['x-real-ip'])) ||
      req.socket?.remoteAddress ||
      'unknown'
  ).split(',')[0].trim();
  const now = Date.now();
  const bucket = publicHits.get(ip);
  if (!bucket || now - bucket.start > PUBLIC_WINDOW_MS) {
    publicHits.set(ip, { start: now, count: 1 });
    if (publicHits.size > 5000) {
      for (const [k, v] of publicHits) if (now - v.start > PUBLIC_WINDOW_MS) publicHits.delete(k);
    }
    return false;
  }
  bucket.count += 1;
  return bucket.count > PUBLIC_MAX;
};

const send = (res, status, payload, type = 'application/json; charset=utf-8') => {
  res.statusCode = status;
  res.setHeader('Content-Type', type);
  res.setHeader('Cache-Control', 'no-store');
  res.end(typeof payload === 'string' ? payload : JSON.stringify(payload));
};

const readBody = (req) =>
  new Promise((resolve) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > MAX_BODY) req.destroy();
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(body || '{}'));
      } catch {
        resolve(null);
      }
    });
    req.on('error', () => resolve(null));
  });

// بيانات الوحدة التي يجوز عرضها للعامة (بدون أي بيانات داخلية)
const publicProperty = (property = {}) => ({
  id: property.id,
  name: property.name || '',
  type: property.type || '',
  area: property.area || '',
  price: property.price || '',
  priceNumeric: Number(property.priceNumeric) || 0,
  location: property.location || '',
  description: property.description || '',
  images: Array.isArray(property.images) ? property.images.filter(Boolean).slice(0, 8) : [],
  latitude: Number(property.latitude) || 0,
  longitude: Number(property.longitude) || 0,
  project: property.project || '',
  compound: property.compound || '',
  floor: property.floor || '',
  rooms: property.rooms || '',
  bathrooms: property.bathrooms || '',
});

const companyName = (data) => {
  const row = Array.isArray(data?.crm_company) ? data.crm_company[0] : null;
  return (row && row.name) || (data?.crm_company_settings && data.crm_company_settings.name) || 'إعمار جروب';
};

// التخزين يُمرَّر جاهزاً (ملف محلي على سيرفر الشركة، أو قاعدة مشتركة على الاستضافة)
// بنفس واجهة load/save — فالمنطق واحد في المكانين بلا أي تفريع.
export function createPublicHandler({ storeFile, storage: injectedStorage }) {
  const storage = injectedStorage || fileStorage(storeFile);

  return async function handle(req, res) {
    try {
      const [rawUrl, query] = (req.url || '').split('?');
      const url = rawUrl || '';

      // صفحة العرض (نفس الصفحة لكل العقارات — تجلب بياناتها من الـ API)
      if (req.method === 'GET' && (url === '/p' || url === '/p/' || url.startsWith('/p/'))) {
        return send(res, 200, renderPage(), 'text/html; charset=utf-8');
      }

      if (req.method === 'GET' && url === '/api/public/property') {
        const id = new URLSearchParams(query || '').get('id') || '';
        const db = await storage.load();
        const property = (db.data?.crm_properties || []).find((p) => p && p.id === id);
        if (!property) return send(res, 404, { ok: false, error: 'الوحدة غير متاحة أو تم حذفها' });
        // ملاحظة خصوصية: لا نُرسل اسم المندوب صاحب العقار ولا أي بيانات داخلية —
        // الرابط مفتوح لأي شخص، والصفحة ما بتستخدمش غير بيانات الوحدة واسم الشركة.
        return send(res, 200, {
          ok: true,
          company: companyName(db.data),
          property: publicProperty(property),
        });
      }

      if (req.method === 'POST' && url === '/api/public/lead') {
        // حماية من الإغراق: رابط عام مفتوح بلا تسجيل دخول، فنحدّ عدد الطلبات لكل IP
        if (publicRateLimited(req)) {
          return send(res, 429, { ok: false, error: 'عدد كبير من الطلبات — حاول بعد قليل' });
        }
        const body = await readBody(req);
        if (!body) return send(res, 400, { ok: false, error: 'طلب غير صالح' });

        const name = String(body.name || '').trim().slice(0, 120);
        const phone = normalizeEgyptPhone(body.phone || '');
        if (!name || phone.replace(/\D/g, '').length < 8) {
          return send(res, 400, { ok: false, error: 'الاسم ورقم الهاتف مطلوبان' });
        }

        const db = await storage.load();
        const data = db.data || {};
        const properties = Array.isArray(data.crm_properties) ? data.crm_properties : [];
        const users = Array.isArray(data.crm_users) ? data.crm_users : [];
        const clients = Array.isArray(data.crm_clients) ? data.crm_clients : [];

        const property = properties.find((p) => p && p.id === String(body.propertyId || ''));
        const owner = property
          ? users.find((u) => u && u.id === property.userId)
          : users.find((u) => u && u.role === 'admin') || users.find((u) => u && u.role === 'sales');

        const now = new Date().toISOString();
        const note = String(body.note || '').trim().slice(0, 500);
        const entryText = property
          ? `العميل سجّل اهتمامه من الرابط العام لعقار «${property.name}»${note ? ` — ملاحظته: ${note}` : ''}`
          : `وصل من الرابط العام${note ? ` — ملاحظته: ${note}` : ''}`;

        // منع التكرار: لو الرقم موجود بالفعل نُسجّل الاهتمام على نفس العميل
        const existing = clients.find((c) => c && normalizeEgyptPhone(c.phone || '') === phone);
        if (existing) {
          const entry = { id: randomUUID(), type: 'public', text: entryText, at: now, by: 'الرابط العام' };
          const nextClients = clients.map((c) =>
            c.id === existing.id
              ? { ...c, updatedAt: now, activities: [entry, ...(c.activities || [])].slice(0, 60) }
              : c
          );
          await storage.save({ version: (Number(db.version) || 0) + 1, data: { ...data, crm_clients: nextClients } });
          return send(res, 200, { ok: true, duplicate: true });
        }

        const client = {
          id: randomUUID(),
          userId: owner?.id || 'public',
          name,
          phone,
          phones: [],
          property: property ? property.name || '' : '',
          budget: String(body.budget || '').trim().slice(0, 60),
          monthlyInstallment: '',
          deliveryPeriod: '',
          status: 'external',
          stage: 'new',
          feedback: '',
          priority: 'high',
          source: property ? `الرابط العام — ${property.name || ''}` : 'الرابط العام',
          createdAt: now,
          updatedAt: now,
          activities: [{ id: randomUUID(), type: 'public', text: entryText, at: now, by: 'الرابط العام' }],
        };

        await storage.save({ version: (Number(db.version) || 0) + 1, data: { ...data, crm_clients: [client, ...clients] } });
        return send(res, 200, { ok: true });
      }

      return send(res, 404, { ok: false, error: 'not found' });
    } catch (error) {
      return send(res, 500, { ok: false, error: 'server error', message: String(error?.message || error) });
    }
  };
}

// ===== صفحة العرض: عربية بالكامل، خفيفة، تعمل على أي موبايل =====
// تُصدَّر كذلك لتستخدمها دالة الاستضافة التي تخدم /p/<id> بعد إعادة التوجيه الداخلي.
export function renderPublicPageHtml() {
  return renderPage();
}

function renderPage() {
  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<meta name="theme-color" content="#0b0714" />
<title>عرض الوحدة</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
  body {
    margin: 0; min-height: 100vh; font-family: 'Segoe UI', Tahoma, 'Noto Kufi Arabic', system-ui, sans-serif;
    background: radial-gradient(1200px 600px at 80% -10%, #3b1d6e 0%, transparent 60%),
                radial-gradient(900px 500px at -10% 110%, #2b1460 0%, transparent 55%), #0b0714;
    color: #f1eefb; padding: 16px;
  }
  .wrap { max-width: 720px; margin: 0 auto; }
  .brand { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 14px; }
  .logo { font-weight: 800; font-size: 20px; background: linear-gradient(90deg,#a78bfa,#e879f9);
    -webkit-background-clip: text; background-clip: text; color: transparent; }
  .chip { font-size: 12px; color: #c9b8f5; background: rgba(139,92,246,.14); border: 1px solid rgba(139,92,246,.35);
    padding: 6px 10px; border-radius: 999px; }
  .card { background: rgba(255,255,255,.055); border: 1px solid rgba(139,92,246,.22); border-radius: 18px; padding: 16px; margin-bottom: 14px; }
  h1 { font-size: 22px; margin: 0 0 6px; }
  .price { font-size: 24px; font-weight: 800; color: #c084fc; margin: 10px 0 4px; }
  .facts { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
  .fact { font-size: 13px; background: rgba(255,255,255,.06); border: 1px solid rgba(255,255,255,.1);
    padding: 6px 12px; border-radius: 999px; color: #ddd6fe; }
  .muted { color: #a99fc4; font-size: 13px; line-height: 1.7; }
  .gallery-main { width: 100%; height: 240px; object-fit: cover; border-radius: 14px; display: block; }
  .thumbs { display: flex; gap: 8px; overflow-x: auto; padding-top: 8px; }
  .thumbs button { padding: 0; border: 2px solid transparent; background: none; border-radius: 10px; overflow: hidden;
    width: 64px; height: 64px; flex: 0 0 auto; cursor: pointer; opacity: .75; }
  .thumbs button.on { border-color: #a78bfa; opacity: 1; }
  .thumbs img { width: 100%; height: 100%; object-fit: cover; display: block; }
  iframe.map { width: 100%; height: 200px; border: 0; border-radius: 14px; display: block; margin-top: 10px; }
  a.maplink { display: block; text-align: center; font-size: 13px; color: #67e8f9; padding: 8px; text-decoration: none; }
  label { display: block; font-size: 13px; color: #c9b8f5; margin: 12px 0 6px; }
  input, textarea {
    width: 100%; padding: 13px 14px; border-radius: 12px; border: 1px solid rgba(139,92,246,.3);
    background: rgba(255,255,255,.05); color: #fff; font-size: 15px; font-family: inherit;
  }
  input:focus, textarea:focus { outline: none; border-color: #a78bfa; }
  textarea { min-height: 82px; resize: vertical; }
  button.submit {
    width: 100%; margin-top: 16px; padding: 15px; border: 0; border-radius: 14px; cursor: pointer;
    background: linear-gradient(90deg,#7c3aed,#a855f7); color: #fff; font-size: 17px; font-weight: 800; font-family: inherit;
  }
  button.submit:disabled { opacity: .6; cursor: wait; }
  .ok { text-align: center; padding: 26px 16px; }
  .ok .tick { font-size: 44px; }
  .note { font-size: 12px; color: #8b82a6; text-align: center; margin: 18px 0 8px; }
  .err { color: #fca5a5; font-size: 14px; }
</style>
</head>
<body>
  <div class="wrap">
    <div class="brand">
      <div class="logo" id="brand">إعمار جروب</div>
      <div class="chip">عرض وحدة</div>
    </div>
    <main id="content"><div class="card muted">جارٍ تحميل بيانات الوحدة…</div></main>
    <p class="note">صفحة عرض رسمية — البيانات تُحدَّث لحظياً من نظام الشركة.</p>
  </div>
<script>
(function () {
  var content = document.getElementById('content');
  var brand = document.getElementById('brand');
  var parts = location.pathname.split('/').filter(Boolean);
  var id = parts.length > 1 ? decodeURIComponent(parts[1]) : '';

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }

  function formHtml(title) {
    return '<div class="card">' +
      '<h1>' + esc(title) + '</h1>' +
      '<p class="muted">سجّل بياناتك وسيتواصل معك فريق المبيعات في أقرب وقت.</p>' +
      '<form id="leadForm">' +
      '<label for="nm">الاسم</label><input id="nm" name="name" required placeholder="اسمك الكامل" />' +
      '<label for="ph">رقم الموبايل</label><input id="ph" name="phone" required inputmode="tel" dir="ltr" placeholder="01xxxxxxxxx" />' +
      '<label for="nt">ملاحظتك (اختياري)</label><textarea id="nt" name="note" placeholder="مثال: مهتم بالمعاينة يوم الخميس بعد الظهر"></textarea>' +
      '<button class="submit" type="submit">أرسل بياناتي</button>' +
      '</form></div>';
  }

  function bindForm(property) {
    var form = document.getElementById('leadForm');
    if (!form) return;
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var btn = form.querySelector('button.submit');
      btn.disabled = true; btn.textContent = 'جارٍ الإرسال…';
      fetch('/api/public/lead', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name.value,
          phone: form.phone.value,
          note: form.note.value,
          propertyId: property ? property.id : '',
        }),
      })
        .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, data: d }; }); })
        .then(function (res) {
          if (!res.ok || !res.data.ok) throw new Error(res.data.error || 'تعذّر الإرسال');
          content.innerHTML = '<div class="card ok"><div class="tick">✅</div>' +
            '<h1>وصلنا طلبك بنجاح</h1>' +
            '<p class="muted">شكراً لك — سيتواصل معك فريق المبيعات في أقرب وقت.</p></div>';
        })
        .catch(function (err) {
          btn.disabled = false; btn.textContent = 'أرسل بياناتي';
          var old = document.getElementById('formError');
          if (old) old.remove();
          var p = document.createElement('p');
          p.id = 'formError'; p.className = 'err';
          p.textContent = '⚠️ ' + (err && err.message ? err.message : 'تعذّر الإرسال — حاول مرة أخرى');
          form.appendChild(p);
        });
    });
  }

  if (!id) {
    content.innerHTML = formHtml('سجّل اهتمامك');
    bindForm(null);
    return;
  }

  fetch('/api/public/property?id=' + encodeURIComponent(id))
    .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, data: d }; }); })
    .then(function (res) {
      if (!res.ok || !res.data.ok) throw new Error(res.data.error || 'الوحدة غير متاحة');
      var p = res.data.property;
      if (res.data.company) brand.textContent = res.data.company;

      var images = (p.images || []).filter(Boolean);
      var head = '';
      if (images.length) {
        head += '<img id="mainImg" class="gallery-main" src="' + images[0] + '" alt="' + esc(p.name) + '" />';
        if (images.length > 1) {
          head += '<div class="thumbs" id="thumbs">';
          for (var i = 0; i < images.length; i += 1) {
            head += '<button type="button" data-src="' + images[i] + '" class="' + (i === 0 ? 'on' : '') + '"><img src="' + images[i] + '" alt="صورة ' + (i + 1) + '" /></button>';
          }
          head += '</div>';
        }
      }

      var facts = '';
      if (p.type) facts += '<span class="fact">' + esc(p.type) + '</span>';
      if (p.area) facts += '<span class="fact">' + esc(p.area) + ' م</span>';
      if (p.rooms) facts += '<span class="fact">' + esc(p.rooms) + ' غرف</span>';
      if (p.bathrooms) facts += '<span class="fact">' + esc(p.bathrooms) + ' حمام</span>';
      if (p.project) facts += '<span class="fact">مشروع ' + esc(p.project) + '</span>';
      if (p.compound) facts += '<span class="fact">كمبوند ' + esc(p.compound) + '</span>';
      if (p.floor) facts += '<span class="fact">الدور ' + esc(p.floor) + '</span>';

      var mapQuery = (p.latitude && p.longitude) ? (p.latitude + ',' + p.longitude) : (p.location || '');
      var map = '';
      if (mapQuery) {
        map = '<iframe class="map" loading="lazy" title="خريطة الموقع" src="https://www.google.com/maps?q=' + encodeURIComponent(mapQuery) + '&z=15&output=embed"></iframe>' +
          '<a class="maplink" target="_blank" rel="noopener" href="https://www.google.com/maps?q=' + encodeURIComponent(mapQuery) + '">📍 افتح الموقع في خرائط جوجل</a>';
      }

      content.innerHTML =
        '<div class="card">' + head +
        '<h1>' + esc(p.name) + '</h1>' +
        '<p class="price">' + (p.price ? esc(p.price) + ' ج.م' : '') + '</p>' +
        (p.location ? '<p class="muted">📍 ' + esc(p.location) + '</p>' : '') +
        (facts ? '<div class="facts">' + facts + '</div>' : '') +
        (p.description ? '<p class="muted" style="margin-top:12px">📝 ' + esc(p.description) + '</p>' : '') +
        map +
        '</div>' + formHtml('سجّل اهتمامك بهذه الوحدة');

      var thumbs = document.getElementById('thumbs');
      if (thumbs) {
        thumbs.addEventListener('click', function (e) {
          var btn = e.target.closest('button');
          if (!btn) return;
          document.getElementById('mainImg').src = btn.getAttribute('data-src');
          var all = thumbs.querySelectorAll('button');
          for (var i = 0; i < all.length; i += 1) all[i].className = all[i] === btn ? 'on' : '';
        });
      }

      bindForm(p);
    })
    .catch(function (err) {
      content.innerHTML = '<div class="card"><p class="err">⚠️ ' + esc(err.message) + '</p></div>';
    });
})();
</script>
</body>
</html>`;
}
