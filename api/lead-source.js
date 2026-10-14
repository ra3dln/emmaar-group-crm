// ===== سحب الأرقام من الكامبين على الاستضافة (Vercel) =====
// نسختان في ملف واحد حسب توفّر قاعدة البيانات:
//
// ١) **مع قاعدة بيانات (Upstash Redis)** — الوضع الطبيعي:
//    الإعدادات (توكن فيسبوك + الصفحات + النماذج + المؤشرات) تُحفظ على السيرفر،
//    والسحب يُنفَّذ في السيرفر ويوزّع الأرقام **داخل قاعدة البيانات** مباشرة.
//    لذلك يعمل التوزيع تلقائياً ٢٤/٧ بلا أي متصفح مفتوح، ويظهر كل رقم على كل الأجهزة.
//
// ٢) **بدون قاعدة بيانات** — الوضع الاحتياطي:
//    الوظيفة «بلا ذاكرة»: لا تقرأ ولا تكتب، تقوم بجزء الشبكة فقط وتُعيد الأرقام
//    ليحفظها متصفح المدير. هكذا لا تتعطّل الميزة أبداً حتى قبل ضبط القاعدة.
//
// نفس منطق التنظيف والتوزيع المستخدم على سيرفر الشركة (`server/leadSource.js`)
// حتى تكون النتيجة متطابقة تماماً في المكانين.

import {
  buildAssignments,
  discoverPages,
  fetchFormsForPage,
  fetchLeads,
  isMetaSource,
  publicConfig,
  runAutoImportCore,
} from '../server/leadSource.js';
import { redisJsonStore, redisStorage } from '../server/store.js';

const CONFIG_KEY = 'crm:lead-source:config';

const storage = redisStorage(process.env);
const configStore = redisJsonStore(process.env, CONFIG_KEY);
// نعمل بالوضع الدائم فقط لو القاعدة مضبوطة فعلاً
const hasDatabase = storage.configured && configStore.configured;

const dataStore = {
  configured: hasDatabase,
  async load() {
    return storage.load();
  },
  async save(db) {
    return storage.save(db);
  },
};

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
const statelessView = (config = {}) => ({
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

// ===== تطبيق التعديلات القادمة من الواجهة على الإعدادات المحفوظة =====
const applyPatch = (config, body = {}) => {
  const patch = {};
  if (typeof body.enabled === 'boolean') patch.enabled = body.enabled;
  if (typeof body.acceptTestLeads === 'boolean') patch.acceptTestLeads = body.acceptTestLeads;
  if (body.type === 'sheet' || body.type === 'meta') patch.type = body.type;
  if (typeof body.sheetUrl === 'string') patch.sheetUrl = body.sheetUrl.trim();

  if (Array.isArray(body.pages)) {
    patch.pages = body.pages
      .filter((p) => p && typeof p.id === 'string')
      .map((p) => ({
        id: String(p.id),
        name: String(p.name || p.id),
        // نُبقي توكن الصفحة القديم لو الواجهة أرسلت الصفحات بلا توكن (وضع القاعدة)
        token: typeof p.token === 'string' && p.token ? p.token : (config.pages || []).find((old) => old.id === String(p.id))?.token || '',
      }));
  }
  if (Array.isArray(body.forms)) {
    patch.forms = body.forms
      .filter((f) => f && typeof f.id === 'string' && typeof f.pageId === 'string')
      .map((f) => ({ id: String(f.id), pageId: String(f.pageId), name: String(f.name || f.id) }));
  }
  if (typeof body.token === 'string' && body.token.trim()) patch.token = body.token.trim();
  if (body.clearToken) patch.token = '';
  if (body.resetCursor) {
    patch.cursorTime = 0;
    patch.assignCursor = 0;
  }

  const minutes = Number(body.intervalMinutes);
  if (Number.isFinite(minutes)) patch.intervalMinutes = Math.min(Math.max(Math.round(minutes), 1), 1440);

  const perSales = Number(body.perSalesLimit);
  if (Number.isFinite(perSales)) patch.perSalesLimit = Math.min(Math.max(Math.round(perSales), 0), 1000);

  return { ...config, ...patch };
};

export default async function handler(req, res) {
  try {
    const url = (req.url || '').split('?')[0];

    // بدون قاعدة بيانات: نفس السلوك القديم «بلا ذاكرة» حتى لا تتعطّل الميزة
    if (!hasDatabase) return statelessHandler(req, res, url);

    if (req.method === 'GET') {
      const config = await configStore.load();
      return reply(res, 200, { ok: true, stateless: false, config: publicConfig(config) });
    }

    if (req.method !== 'POST') return reply(res, 405, { ok: false, error: 'method not allowed' });

    const body = (await readBody(req)) || {};
    if (!body) return reply(res, 400, { ok: false, error: 'طلب غير صالح' });

    const action = String(body.action || 'save');
    const config = await configStore.load();

    // استكشاف الصفحات: نحفظ التوكن وتوكنات الصفحات على السيرفر
    if (action === 'discover') {
      const token = String(body.token || config.token || '').trim();
      const { pages, warning } = await discoverPages(token);
      const next = { ...config, token, pages };
      await configStore.save(next);
      return reply(res, 200, {
        ok: true,
        pages: pages.map((p) => ({ id: p.id, name: p.name })),
        warning,
        config: publicConfig(next),
      });
    }

    // نماذج صفحة معيّنة: التوكن محفوظ على السيرفر فلا نطلب من المتصفح إرساله
    if (action === 'forms') {
      const pageId = String(body.pageId || '');
      const page = (config.pages || []).find((p) => p.id === pageId);
      if (!page) return reply(res, 404, { ok: false, error: 'الصفحة غير موجودة في الإعدادات — أعد الاستكشاف' });
      const forms = await fetchFormsForPage(page.id, page.token);
      return reply(res, 200, { ok: true, forms });
    }

    // السحب الفعلي: يُنظَّف ويُوزَّع ويُحفظ في قاعدة البيانات مباشرة
    if (action === 'run') {
      const next = { ...config };
      const summary = await runAutoImportCore({
        storage: dataStore,
        config: next,
        saveConfig: (updated) => configStore.save(updated),
      });
      return reply(res, 200, { ok: true, summary, config: publicConfig(next) });
    }

    // «حفظ» وأي طلب آخر
    const next = applyPatch(config, body);
    await configStore.save(next);
    return reply(res, 200, { ok: true, stateless: false, config: publicConfig(next) });
  } catch (error) {
    return reply(res, 500, { ok: false, error: String(error?.message || error) });
  }
}

// ===== الوضع الاحتياطي: بلا قاعدة بيانات (الشبكة فقط، والتخزين في المتصفح) =====
async function statelessHandler(req, res, url) {
  try {
    if (req.method === 'GET') {
      return reply(res, 200, { ok: true, stateless: true, config: statelessView({}) });
    }

    const body = await readBody(req);
    if (!body) return reply(res, 400, { ok: false, error: 'طلب غير صالح' });
    const action = String(body.action || 'save');

    if (action === 'discover') {
      const token = String(body.token || body.config?.token || '').trim();
      const { pages, warning } = await discoverPages(token);
      return reply(res, 200, { ok: true, pages, warning });
    }

    if (action === 'forms') {
      const pageId = String(body.pageId || '');
      const pageToken = String(body.pageToken || '').trim();
      if (!pageToken) return reply(res, 400, { ok: false, error: 'توكن الصفحة غير موجود — أعد الاستكشاف' });
      const forms = await fetchFormsForPage(pageId, pageToken);
      return reply(res, 200, { ok: true, forms });
    }

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

      return reply(res, 200, {
        ok: true,
        leads: built.added,
        summary: {
          at: new Date().toISOString(),
          ok: true,
          source: isMetaSource(config) ? 'فيسبوك مباشرة' : 'ملف منشور',
          fetched: fetched.length,
          added: built.added.length,
          duplicates: built.duplicates,
          invalid: built.invalid,
          perUser: built.perUser,
        },
        cursorTime: Number(config.cursorTime) || 0,
        assignCursor: built.assignCursor,
      });
    }

    return reply(res, 200, { ok: true, stateless: true, config: statelessView(body.config || body) });
  } catch (error) {
    return reply(res, 500, { ok: false, error: String(error?.message || error) });
  }
}
