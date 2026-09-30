// ===== سحب الأرقام من استضافة Vercel (بدون قاعدة بيانات) =====
// هذه الوظيفة «بلا ذاكرة»: لا تقرأ ولا تكتب أي ملف على الاستضافة.
// تعمل فقط ما يحتاج شبكة (استكشاف الصفحات، جلب النماذج، سحب الأرقام)،
// والإعدادات والأرقام الناتجة يُحفظها متصفح المدير (localStorage) عبر `src/App.tsx`.
// بهذا تعمل ميزة سحب أرقام فيسبوك كاملة على الموقع المنشور رغم غياب قاعدة بيانات.
//
// الفرق عن السيرفر المحلي (vite.config.js + server/leadSource.js): هناك يحفظ
// السيرفر الإعدادات في ملف ويسحب الأرقام في الخلفية ويوزّعها على كل الأجهزة.

import {
  buildAssignments,
  discoverPages,
  fetchFormsForPage,
  fetchLeads,
  isMetaSource,
} from '../server/leadSource.js';

const reply = (res, status, payload) => {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
};

const readBody = (req) =>
  new Promise((resolve) => {
    // Vercel يفكّ JSON تلقائياً عندما يكون المحتوى application/json
    if (req.body && typeof req.body === 'object') return resolve(req.body);
    if (typeof req.body === 'string') {
      try {
        return resolve(JSON.parse(req.body));
      } catch {
        return resolve(null);
      }
    }
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 4 * 1024 * 1024) req.destroy();
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(raw || '{}'));
      } catch {
        resolve(null);
      }
    });
    req.on('error', () => resolve(null));
  });

// نفس شكل publicConfig في السيرفر المحلي حتى تعمل الواجهة ذاتها في الحالتين
const view = (config = {}) => ({
  enabled: !!config.enabled,
  type: config.type === 'meta' ? 'meta' : 'sheet',
  acceptTestLeads: config.acceptTestLeads !== false,
  sheetUrl: config.sheetUrl || '',
  intervalMinutes: Number(config.intervalMinutes) || 5,
  perSalesLimit: Number(config.perSalesLimit) || 0,
  cursorTime: Number(config.cursorTime) || 0,
  assignCursor: Number(config.assignCursor) || 0,
  pages: Array.isArray(config.pages) ? config.pages.map((p) => ({ id: p.id, name: p.name || p.id })) : [],
  forms: Array.isArray(config.forms)
    ? config.forms.map((f) => ({ id: f.id, pageId: f.pageId, name: f.name || f.id }))
    : [],
  hasToken: !!config.token,
  lastRun: config.lastRun || null,
});

export default async function handler(req, res) {
  try {
    // الواجهة تسأل أولاً «هل هناك قاعدة إعدادات؟» — نعلن أننا بلا ذاكرة
    if (req.method === 'GET') {
      return reply(res, 200, { ok: true, stateless: true, config: view({}) });
    }

    const body = await readBody(req);
    if (!body) return reply(res, 400, { ok: false, error: 'طلب غير صالح' });
    const action = String(body.action || 'save');

    // استكشاف الصفحات: نُعيد توكن كل صفحة لأن الاستضافة لا تحفظ شيئاً
    if (action === 'discover') {
      const token = String(body.token || body.config?.token || '').trim();
      const { pages, warning } = await discoverPages(token);
      return reply(res, 200, { ok: true, pages, warning });
    }

    // نماذج صفحة معيّنة: الواجهة ترسل توكن الصفحة المحفوظ عندها
    if (action === 'forms') {
      const pageId = String(body.pageId || '');
      const pageToken = String(body.pageToken || '').trim();
      if (!pageToken) return reply(res, 400, { ok: false, error: 'توكن الصفحة غير موجود — أعد الاستكشاف' });
      const forms = await fetchFormsForPage(pageId, pageToken);
      return reply(res, 200, { ok: true, forms });
    }

    // السحب الفعلي: نُنظّف ونوزّع ثم نُعيد الأرقام ليحفظها متصفح المدير
    if (action === 'run') {
      const config = { ...(body.config || {}) };
      const sales = Array.isArray(body.sales) ? body.sales.filter((u) => u && u.id) : [];
      if (!sales.length) {
        return reply(res, 200, {
          ok: true,
          leads: [],
          summary: {
            at: new Date().toISOString(),
            ok: false,
            error: 'لا يوجد حساب سيلز مفعّل لتوزيع الأرقام عليه',
          },
        });
      }

      const fetched = await fetchLeads(config);
      const built = buildAssignments({ fetched, sales, config, knownPhones: body.knownPhones || [] });

      const summary = {
        at: new Date().toISOString(),
        ok: true,
        source: isMetaSource(config) ? 'فيسبوك مباشرة' : 'ملف منشور',
        fetched: fetched.length,
        added: built.added.length,
        duplicates: built.duplicates,
        invalid: built.invalid,
        perUser: built.perUser,
      };

      return reply(res, 200, {
        ok: true,
        leads: built.added,
        summary,
        // مؤشرات تُحفظ في متصفح المدير بدل ملف السيرفر
        cursorTime: Number(config.cursorTime) || 0,
        assignCursor: built.assignCursor,
      });
    }

    // «حفظ» وأي طلب آخر: نُعيد الإعدادات كما هي — الحفظ في المتصفح
    return reply(res, 200, { ok: true, stateless: true, config: view(body.config || body) });
  } catch (error) {
    return reply(res, 500, { ok: false, error: String(error?.message || error) });
  }
}
