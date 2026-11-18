// ===== نقل كل البيانات والإعدادات من Supabase إلى Cloudflare D1 =====
//   POST /api/admin/migrate            => نقل (الإعدادات تتنقل لو D1 فاضية)
//   POST /api/admin/migrate?overwrite=1 => تكتب إعدادات Supabase فوق اللي في D1
//
// ليه موجودة؟ Supabase وقّفت الخدمة (exceed_egress_quota) فأغلب البيانات اتنقلت
// من متصفح الإدارة، لكن إعدادات سحب الأرقام (توكن فيسبوك + الصفحات + الفورمات)
// ومفاتيح الإشعارات محفوظة على Supabase بس — الأمر ده بينقلها بحرفها أول ما
// الخدمة ترجع، ويكمّل أي سجل ناقص (دمج بالمعرّف: الأحدث يكسب، والمحذوف يفضل محذوف).
//
// الأمان: محتاجة جلسة إدارة (admin) فقط، وPOST بس، وماينفعش تعمل أي حاجة على
// Supabase (قراءة فقط). الرد بيوضح حالة كل مفتاح وسبب عدم النقل لو حصل.

import { d1JsonStore, d1Storage } from '../../server/d1.js';
import { asRecord, copyAllFromSource } from '../../server/migrate.js';

export default async function handler(req, res) {
  const reply = (status, payload) => {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify(payload));
  };

  if (req.method !== 'POST') return reply(405, { ok: false, error: 'method not allowed' });

  try {
    const { sessionFromRequest } = await import('../../server/auth.js');
    const session = sessionFromRequest(process.env, req);
    if (!session) return reply(401, { ok: false, error: 'unauthorized' });
    if (session.r !== 'admin') return reply(403, { ok: false, error: 'forbidden' });

    const target = d1Storage(process.env);
    if (!target.configured) {
      return reply(400, {
        ok: false,
        error: 'D1 غير مضبوط على السيرفر',
        hint: 'أضف D1_ACCOUNT_ID و D1_DATABASE_ID و D1_API_TOKEN على Vercel ثم أعد النشر.',
      });
    }

    const { supabaseClient } = await import('../../server/supabase.js');
    const source = supabaseClient(process.env);
    if (!source.configured) {
      return reply(400, {
        ok: false,
        error: 'Supabase غير مضبوط على السيرفر',
        hint: 'محتاج SUPABASE_URL و SUPABASE_SECRET_KEY على Vercel عشان نقرأ منها.',
      });
    }

    // قراءة كل الصفوف مرة واحدة — لو الخدمة موقوفة (402) بنشرح السبب بوضوح
    let all = {};
    try {
      all = await source.getAll();
    } catch (error) {
      return reply(200, {
        ok: false,
        error: String(error?.message || error),
        hint: 'Supabase موقوفة مؤقتاً (تجاوز حد النقل). أول ما ترجع الخدمة شغّل نفس الأمر تاني.',
      });
    }

    const overwrite = new URLSearchParams((req.url || '').split('?')[1] || '').get('overwrite') === '1';
    const sourceStore = {
      async load() {
        return {
          version: Number(all['crm:store:version']) || 0,
          data: asRecord(all['crm:store:data']),
        };
      },
      jsonStore: (key) => ({
        async load() {
          return asRecord(all[key]);
        },
      }),
    };
    const targetStore = {
      load: () => target.load(),
      save: (db) => target.save(db),
      jsonStore: (key) => d1JsonStore(process.env, key),
    };

    const result = await copyAllFromSource({ source: sourceStore, target: targetStore, overwrite });
    return reply(200, { ok: true, ...result });
  } catch (error) {
    return reply(500, { ok: false, error: String(error?.message || error) });
  }
}
