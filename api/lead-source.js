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
  applyChannelPatch,
  buildAssignments,
  CHANNEL_LABELS,
  CHANNELS,
  channelConfigOf,
  collectLeads,
  debugToken,
  discoverPages,
  fetchFormsForPage,
  normalizeConfig,
  publicConfig,
  resetChannelCursors,
  runAutoImportCore,
} from '../server/leadSource.js';
import { redisJsonStore, redisStorage } from '../server/store.js';
import { supabaseJsonStore, supabaseStorage } from '../server/supabase.js';
import { authConfigured, isManagerRole, sessionFromRequest } from '../server/auth.js';

const CONFIG_KEY = 'crm:lead-source:config';

// نفضّل Supabase لو مضبوط، وإلا نرجع لـ Redis — نفس الواجهة تماماً
const supaStorage = supabaseStorage(process.env);
const supaConfig = supabaseJsonStore(process.env, CONFIG_KEY);
const useSupabase = supaStorage.configured && supaConfig.configured;

const storage = useSupabase ? supaStorage : redisStorage(process.env);
const configStore = useSupabase ? supaConfig : redisJsonStore(process.env, CONFIG_KEY);
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
const statelessChannel = (config = {}) => ({
  enabled: !!config.enabled,
  type: config.type === 'meta' ? 'meta' : 'sheet',
  sheetUrl: config.sheetUrl || '',
  intervalMinutes: Number(config.intervalMinutes) || 5,
  perSalesLimit: Number(config.perSalesLimit) || 0,
  cursorTime: Number(config.cursorTime) || 0,
  assignCursor: Number(config.assignCursor) || 0,
  pages: Array.isArray(config.pages) ? config.pages.map((p) => ({ id: p.id, name: p.name || p.id })) : [],
  forms: Array.isArray(config.forms)
    ? config.forms.map((f) => ({ id: f.id, pageId: f.pageId, name: f.name || f.id }))
    : [],
  // فورمات مبنية من رفع شيت (أسماء فقط) — تظهر في القوائم المسندلة
  extraForms: Array.isArray(config.extraForms)
    ? config.extraForms.map((name) => String(name || '').trim()).filter(Boolean)
    : [],
  hasToken: !!config.token,
  // ميعاد انتهاء التوكن (ثواني) — للمتصفح ليحسب «أيام متبقية» وينبّه قبل الانتهاء
  tokenExpiresAt: Number(config.tokenExpiresAt) || 0,
  lastRun: config.lastRun || null,
});

const statelessView = (config = {}) => ({
  ...statelessChannel(config),
  acceptTestLeads: config.acceptTestLeads !== false,
  instagram: statelessChannel(config.instagram || {}),
});

export default async function handler(req, res) {
  try {
    const url = (req.url || '').split('?')[0];

    // ===== لا يُكشف شيء بلا جلسة =====
    // هنا توكن فيسبوك والصفحات والنماذج، ومن يستطيع تشغيل السحب يوزّع أرقام العملاء.
    // فالبوابة هنا **قبل** أي شيء آخر: بلا جلسة صحيحة يرجع 401 ولا يُقرأ ولا يُكتب شيء.
    if (!authConfigured(process.env)) {
      return reply(res, 503, {
        ok: false,
        error: 'auth not configured',
        hint: 'أضف متغيّر البيئة AUTH_SECRET على Vercel ثم أعد النشر.',
      });
    }
    const session = sessionFromRequest(process.env, req);
    if (!session) return reply(res, 401, { ok: false, error: 'unauthorized' });
    // إعدادات سحب الأرقام للإدارة فقط (CEO / Team Leader)
    if (!isManagerRole(session.r)) return reply(res, 403, { ok: false, error: 'forbidden' });

    // بدون قاعدة بيانات: نفس السلوك القديم «بلا ذاكرة» حتى لا تتعطّل الميزة
    if (!hasDatabase) return statelessHandler(req, res, url);

    if (req.method === 'GET') {
      const config = normalizeConfig(await configStore.load());
      return reply(res, 200, { ok: true, stateless: false, config: publicConfig(config) });
    }

    if (req.method !== 'POST') return reply(res, 405, { ok: false, error: 'method not allowed' });

    const body = (await readBody(req)) || {};
    if (!body) return reply(res, 400, { ok: false, error: 'طلب غير صالح' });

    const action = String(body.action || 'save');
    // نفس القيم الافتراضية المستخدمة على سيرفر الشركة — فرق الإعدادات بين المكانين صفر
    const config = normalizeConfig(await configStore.load());

    // استكشاف الصفحات: نحفظ التوكن وتوكنات الصفحات في القناة نفسها على السيرفر
    if (action === 'discover') {
      const channel = body.channel === 'instagram' ? 'instagram' : 'facebook';
      const channelCfg = channelConfigOf(config, channel) || {};
      const token = String(body.token || channelCfg.token || '').trim();
      const { pages, warning, tokenExpiresAt, sources = [], tokenType = '' } = await discoverPages(token);
      const next = applyChannelPatch(config, { channel, token, pages, tokenExpiresAt });
      await configStore.save(next);
      return reply(res, 200, {
        ok: true,
        pages: pages.map((p) => ({ id: p.id, name: p.name })),
        warning,
        tokenExpiresAt,
        // تشخيص المصادر: يبيّن للإدارة ليه صفحة معيّنة ما ظهرتش (توكن صفحة / صلاحية ناقصة)
        sources,
        tokenType,
        config: publicConfig(next),
      });
    }

    // نماذج صفحة معيّنة: التوكن محفوظ على السيرفر فلا نطلب من المتصفح إرساله
    if (action === 'forms') {
      const channel = body.channel === 'instagram' ? 'instagram' : 'facebook';
      const channelCfg = channelConfigOf(config, channel) || {};
      const pageId = String(body.pageId || '');
      const page = (channelCfg.pages || []).find((p) => p.id === pageId);
      if (!page) return reply(res, 404, { ok: false, error: 'الصفحة غير موجودة في إعدادات هذه القناة — أعد الاستكشاف' });
      const forms = await fetchFormsForPage(page.id, page.token);
      return reply(res, 200, { ok: true, forms });
    }

    // إعادة سحب كل الأرقام من البداية (تصفير المؤشرات): تُستخدم لاسترجاع أرقام كامبين
    // مفقودة — السحب يمنع التكرار بالهاتف، والدورة التالية تعيد قراءة كل التاريخ.
    if (action === 'reset') {
      const channel = body.channel === 'instagram' ? 'instagram' : 'facebook';
      const next = normalizeConfig(resetChannelCursors(config, channel));
      await configStore.save(next);
      return reply(res, 200, { ok: true, config: publicConfig(next) });
    }

    // السحب الفعلي: يُنظَّف ويُوزَّع ويُحفظ في قاعدة البيانات مباشرة
    if (action === 'run') {
      const next = normalizeConfig(config);
      const summary = await runAutoImportCore({
        storage: dataStore,
        config: next,
        // الزر اليدوي force افتراضيًا؛ السحب التلقائي من المتصفح يرسل force:false
        force: body.force !== false,
        saveConfig: (updated) => configStore.save(updated),
      });
      return reply(res, 200, { ok: true, summary, config: publicConfig(next) });
    }

    // «حفظ» وأي طلب آخر — لو الواجهة ألصقت توكن جديداً نسجّل ميعاد انتهائه للتنبيه قبله
    const pastedToken = typeof body.token === 'string' && body.token.trim() && !body.clearToken ? body.token.trim() : '';
    const expiryPatch = pastedToken ? { tokenExpiresAt: (await debugToken(pastedToken))?.expiresAt || 0 } : {};
    const next = normalizeConfig(applyChannelPatch(config, { ...body, ...expiryPatch }));
    if (typeof body.acceptTestLeads === 'boolean') next.acceptTestLeads = body.acceptTestLeads;
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
      const channel = body.channel === 'instagram' ? 'instagram' : 'facebook';
      const channelCfg = channelConfigOf(body.config || {}, channel) || {};
      const token = String(body.token || channelCfg.token || '').trim();
      const { pages, warning, tokenExpiresAt, sources = [], tokenType = '' } = await discoverPages(token);
      return reply(res, 200, { ok: true, pages, warning, tokenExpiresAt, sources, tokenType });
    }

    if (action === 'forms') {
      const pageId = String(body.pageId || '');
      const pageToken = String(body.pageToken || '').trim();
      if (!pageToken) return reply(res, 400, { ok: false, error: 'توكن الصفحة غير موجود — أعد الاستكشاف' });
      const forms = await fetchFormsForPage(pageId, pageToken);
      return reply(res, 200, { ok: true, forms });
    }

    if (action === 'run') {
      const config = { ...(body.config || {}), instagram: { ...((body.config || {}).instagram || {}) } };
      // الأرقام تدخل غير موزّعة دائماً — التوزيع قرار الإدارة من «توزيع الأرقام»


      // نفس محرك السيرفر: كل قناة مفعّلة تُسحب على حدة، وفشل إحداهما لا يوقف الأخرى
      const { rows: fetched, channels } = await collectLeads(config);
      const active = CHANNELS.filter((channel) => channels[channel]);
      const anyOk = active.some((channel) => channels[channel].ok);
      if (!active.length || !anyOk) {
        return reply(res, 200, {
          ok: true,
          leads: [],
          summary: {
            at: new Date().toISOString(),
            ok: false,
            source: active.map((channel) => CHANNEL_LABELS[channel]).join(' + ') || 'كل القنوات',
            error: active.length ? channels[active[0]].error || 'تعذّر السحب' : 'لا توجد قناة سحب مفعّلة',
            channels,
          },
        });
      }

      const built = buildAssignments({ fetched, knownPhones: body.knownPhones || [] });

      return reply(res, 200, {
        ok: true,
        leads: built.added,
        summary: {
          at: new Date().toISOString(),
          ok: true,
          source: active.map((channel) => CHANNEL_LABELS[channel]).join(' + '),
          fetched: fetched.length,
          added: built.added.length,
          duplicates: built.duplicates,
          invalid: built.invalid,
          perUser: built.perUser,
          unassigned: built.unassigned,
          channels,
        },
        // مؤشرات كل قناة ليعيد المتصفح كتابتها في إعداداته المحلية فلا تتكرر الأرقام
        cursorTime: Number(config.cursorTime) || 0,
        instagramCursor: Number(config.instagram?.cursorTime) || 0,
        assignCursor: built.assignCursor,
      });
    }

    return reply(res, 200, { ok: true, stateless: true, config: statelessView(body.config || body) });
  } catch (error) {
    return reply(res, 500, { ok: false, error: String(error?.message || error) });
  }
}
