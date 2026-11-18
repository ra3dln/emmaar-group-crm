// ===== المُشغّل الدوري: توزيع الأرقام تلقائياً ٢٤/٧ بلا أي متصفح مفتوح =====
// Vercel المجاني يسمح بمهمة دورية واحدة يومياً فقط، لذلك نعتمد على خدمة جدولة
// خارجية مجانية (Zeabur cron / cron-job.org / GitHub Actions) تنادي هذا الرابط
// كل دقيقة — الإشعارات توصل في وقتها، وسحب الأرقام يظل ٢٤/٧.
// الرابط محميّ بمفتاح سري حتى لا يستطيع أحد إغراق حساب فيسبوك.
//
// الإعداد (مرة واحدة):
//   1) أضف متغيّر بيئة على Vercel باسم CRON_SECRET بقيمة عشوائية طويلة.
//   2) أعد النشر.
//   3) في cron-job.org: أنشئ مهمة كل ٥ دقائق على الرابط
//        https://<موقعك>/api/cron?key=<نفس القيمة>
//
// يعمل أيضاً مع Vercel Cron تلقائياً: Vercel يرسل نفس القيمة في ترويسة
// Authorization: Bearer <CRON_SECRET> — فلا حاجة لأي تعديل إضافي في هذه الحالة.

import { CHANNELS, isChannelOn, normalizeConfig, publicConfig, renewExpiringTokens, runAutoImportCore, tokenExpiryAlerts } from '../server/leadSource.js';
import { safeEqual } from '../server/store.js';
import { pickJsonStore, pickStorage } from '../server/storage.js';
import { processPushesOnce } from '../server/push.js';

const CONFIG_KEY = 'crm:lead-source:config';
const VAPID_KEY = 'crm:push:vapid';
const PUSH_STATE_KEY = 'crm:push:state';

const reply = (res, status, payload) => {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
};

export default async function handler(req, res) {
  try {
    const secret = String(process.env.CRON_SECRET || '');
    if (!secret) {
      return reply(res, 503, {
        ok: false,
        error: 'لم يُضبط CRON_SECRET',
        hint: 'أضف متغيّر البيئة CRON_SECRET على Vercel ثم أعد النشر لتشغيل التوزيع التلقائي.',
      });
    }

    const [path, query] = (req.url || '').split('?');
    const params = new URLSearchParams(query || '');
    const fromQuery = params.get('key') || params.get('secret') || '';
    const auth = String(req.headers?.authorization || '');
    const fromHeader = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : '';

    if (!safeEqual(fromQuery, secret) && !safeEqual(fromHeader, secret)) {
      return reply(res, 403, { ok: false, error: 'غير مسموح' });
    }

    // نفس مخزون باقي النقاط: D1 ← Supabase ← Redis
    const storage = pickStorage(process.env);
    const configStore = pickJsonStore(process.env, CONFIG_KEY);
    if (!storage.configured || !configStore.configured) {
      return reply(res, 503, {
        ok: false,
        error: 'قاعدة البيانات غير مضبوطة',
        hint: 'أضف Cloudflare D1 (D1_ACCOUNT_ID + D1_DATABASE_ID + D1_API_TOKEN) أو Supabase أو Upstash Redis من لوحة Vercel ثم أعد النشر.',
      });
    }

    let config = normalizeConfig(await configStore.load());
    // force=1 للاختبارات/التشغيل اليدوي فقط — المجدول العادي يحترم «كل كم دقيقة»
    const force = params.get('force') === '1';

    // ===== تجديد التوكن قبل السحب (بلا تدخل من المستخدم) =====
    // توكن Graph API Explorer يعيش ساعتين فقط. هنا نبدّله بتوكن ٦٠ يوماً قبل ما
    // ينتهي ونحفظه — فالتنبيه بيختفي لوحده والسحب ما بيقفش.
    const renewed = await renewExpiringTokens(config);
    if (renewed.changed) {
      await configStore.save(renewed.config);
      config = renewed.config;
    }

    // كل قناة لها مشغّلها: يكفي أن تكون قناة واحدة مفعّلة (فيسبوك أو إنستجرام)
    // السحب التلقائي والتذكيرات مستقلان، فلا يوقف توقف القنوات إرسال التذكيرات.
    let summary = null;
    if (CHANNELS.some((channel) => isChannelOn(config, channel))) {
      summary = await runAutoImportCore({
        storage,
        config,
        force,
        saveConfig: (updated) => configStore.save(updated),
      });
    }

    // ===== التذكيرات ورسائل الشات: تُرسَل من المُشغّل الدوري (كل دقيقة) =====
    // هنا يأتي دور processPushesOnce على الاستضافة (بديل setInterval المحلي):
    // يقرأ التذكيرات المستحقة من القاعدة ويرسل إشعاراً لكل جهاز المسجَّل مرة واحدة فقط.
    // ونمرّر معها تنبيهات انتهاء صلاحية توكن السحب — تصل الإدارة قبل الانتهاء بيومين.
    let push = null;
    try {
      // ملاحظة: كان هنا اختيار المخزن بـ useSupabase — وهو متغيّر غير معرّف بعد
      // التحويل إلى D1، فكان السطر يرمي خطأ ReferenceError في كل دورة
      // (فكل الإشعارات — ومنها تنبيه انتهاء التوكن — ما كانت تصل للأجهزة).
      // الحل: نفس اختيار المخزون الموحّد في كل مكان (D1 ← Supabase ← Redis).
      const vapidStore = pickJsonStore(process.env, VAPID_KEY);
      const stateStore = pickJsonStore(process.env, PUSH_STATE_KEY);
      push = await processPushesOnce({ storage, vapidStore, stateStore, systemAlerts: tokenExpiryAlerts(config) });
    } catch (error) {
      // فشل الإشعارات لا يوقف سحب الأرقام — يُسجَّل ويُعاد في الدورة القادمة
      push = { error: String(error?.message || error) };
    }

    return reply(res, 200, {
      ok: true,
      skipped: summary === null,
      summary,
      push,
      config: publicConfig(config),
    });
  } catch (error) {
    return reply(res, 500, { ok: false, error: String(error?.message || error) });
  }
}
