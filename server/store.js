// ===== منطق تخزين البيانات المشترك =====
// نفس المنطق يعمل في مكانين:
// 1) سيرفر التطوير المحلي  -> يتخزن في ملف JSON على جهاز الشركة (بدون أي حساب أو تكلفة).
// 2) الاستضافة على Vercel   -> يتخزن في Redis (خطة مجانية) لأن ملفات الاستضافة للقراءة فقط.
// الواجهة البرمجية واحدة للطرفين:
//   GET  /api/store              => { version, isEmpty, data }
//   GET  /api/store?meta=version => { version }
//   POST /api/store  { key, value }  => { version }
//   POST /api/store  { data: {...} } => { version }

import fs from 'node:fs';
import path from 'node:path';
import {
  authConfigured,
  preserveUserPasswords,
  sessionFromRequest,
  sessionMatchesUsers,
  stripUserSecrets,
} from './auth.js';

const KEY_PATTERN = /^crm_[a-z_]+$/;
// صور العقارات تُخزَّن داخل نفس قاعدة البيانات (base64)، فحجم الطلب الواحد يهم:
// سقف Vercel الصلب لجسم دالة السيرفر هو ٤.٥ ميجا، وسقف قيمة Upstash ١٠ ميجا.
// ننزل تحت سقف Vercel بهامش أمان حتى يفشل الطلب برسالة عربية مفهومة
// بدل خطأ غامض من الاستضافة نفسها.
const VERCEL_BODY_LIMIT = 4 * 1024 * 1024;
const MAX_BODY =
  Number(process.env.CRM_MAX_BODY) ||
  (process.env.VERCEL ? VERCEL_BODY_LIMIT : 24 * 1024 * 1024);
const REDIS_MAX_VALUE = 10 * 1024 * 1024;

export { VERCEL_BODY_LIMIT, MAX_BODY };
// حد أقصى لعدد السجلات في أي مصفوفة — يمنع إغراق قاعدة البيانات بطلب واحد ضخم
const MAX_RECORDS = 50000;

// ===== حماية: تحديد معدل الطلبات لكل IP =====
// نافذة زمنية متحركة بسيطة في الذاكرة: تكفي لصدّ الإغراق دون أي خدمة خارجية.
const WINDOW_MS = 60_000;
const MAX_WRITE_PER_WINDOW = 240;
const MAX_READ_PER_WINDOW = 1200;
const hits = new Map();

const clientIp = (req) =>
  String(
    (req.headers && (req.headers['x-forwarded-for'] || req.headers['x-real-ip'])) ||
      req.socket?.remoteAddress ||
      'unknown'
  ).split(',')[0].trim();

const rateLimited = (req, isWrite) => {
  const now = Date.now();
  const key = `${clientIp(req)}:${isWrite ? 'w' : 'r'}`;
  const limit = isWrite ? MAX_WRITE_PER_WINDOW : MAX_READ_PER_WINDOW;
  const bucket = hits.get(key);
  if (!bucket || now - bucket.start > WINDOW_MS) {
    hits.set(key, { start: now, count: 1 });
    return false;
  }
  bucket.count += 1;
  // تنظيف دوري بسيط حتى لا تنمو الذاكرة بلا حدود
  if (hits.size > 5000) {
    for (const [k, v] of hits) if (now - v.start > WINDOW_MS) hits.delete(k);
  }
  return bucket.count > limit;
};

export const isValidKey = (key) => typeof key === 'string' && KEY_PATTERN.test(key);
// تحقق من قائمة سجلات: مصفوفة كائنات بحجم معقول (يمنع الحقن ببيانات ضخمة أو غير متوقعة)
const isValidRecords = (value) =>
  Array.isArray(value) && value.length <= MAX_RECORDS && value.every((r) => r && typeof r === 'object');

const send = (res, status, payload) => {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
};

const readBody = (req) =>
  new Promise((resolve) => {
    // على Vercel يكون الجسم مُحللاً مسبقاً، وفي سيرفر التطوير نقرأه من الطلب
    if (req.body !== undefined && req.body !== null) {
      if (typeof req.body === 'object') return resolve(req.body);
      try {
        return resolve(JSON.parse(req.body));
      } catch {
        return resolve(null);
      }
    }
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

// مقارنة بزمن ثابت: تمنع استنتاج المفتاح من فرق زمن الرد
export const safeEqual = (a, b) => {
  const x = String(a || '');
  const y = String(b || '');
  if (!x || x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i += 1) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0;
};

// createStoreHandler({ load, save, loadVersion, token, auth })
// loadVersion اختياري: يقرأ رقم الإصدار وحده. مهم جداً على القاعدة المدفوعة بالأوامر:
// الفحص الدوري للنسخة هو **أكثر طلب يتكرر** في النظام، فقراءة مفتاح واحد بدل مفتاحين
// تنصّف فاتورة/سقف قاعدة البيانات فوراً.
// token اختياري: طبقة إضافية قديمة (x-store-token) — لا تُغني عن الجلسة.
//
// auth (الأهم): متغيّرات البيئة التي فيها AUTH_SECRET. عند تمريرها:
//   **لا يُقدَّم أي شيء — لا قراءة ولا كتابة — إلا لمن يحمل جلسة موقّعة صحيحة**.
//   أي طلب آخر يرجع 401، فتظل بيانات العملاء مغلقة أمام أي شخص يعرف رابط الموقع.
//   ولو لم يُضبط AUTH_SECRET نرفض العمل (503) بدل أن ننفتح بالخطأ.
export function createStoreHandler({ load, save, loadVersion, token = '', auth = null }) {
  return async function handle(req, res) {
    try {
      const [url, query] = (req.url || '').split('?');
      if (url !== '/api/store') return send(res, 404, { error: 'not found' });
      const meta = new URLSearchParams(query || '').get('meta');

      // بوابة اختيارية قديمة: تُغلق تماماً لو لم يُضبط STORE_TOKEN على الاستضافة
      if (token) {
        const provided = req.headers?.['x-store-token'] || '';
        if (!safeEqual(provided, token)) return send(res, 401, { error: 'unauthorized' });
      }

      // ===== بوابة الجلسة: قلب الحماية =====
      let session = null;
      if (auth) {
        if (!authConfigured(auth)) {
          return send(res, 503, {
            error: 'auth not configured',
            hint: 'أضف متغيّر البيئة AUTH_SECRET (نص عشوائي ٣٢ حرفاً على الأقل) على Vercel ثم أعد النشر. بدونها يبقى الوصول للبيانات مغلقاً.',
          });
        }
        session = sessionFromRequest(auth, req);
        if (!session) {
          return send(res, 401, { error: 'unauthorized', hint: 'سجّل الدخول أولاً — بيانات العملاء لا تُقدَّم إلا لحساب مسجَّل.' });
        }
      }

      // الجلسة صالحة فقط إذا كان الحساب موجوداً ونشطاً وإصدار جلسته مطابقاً:
      // فيسقط الكوكي فوراً بعد الخروج أو تغيير كلمة المرور من أي جهاز.
      const isStaleSession = (db) => {
        if (!auth || !session) return false;
        return !sessionMatchesUsers(session, db?.data);
      };
      const endStaleSession = () => send(res, 401, { error: 'unauthorized', hint: 'انتهت الجلسة — سجّل الدخول مرة أخرى.' });

      // حماية من الإغراق (Brute force / DoS)
      if (rateLimited(req, req.method === 'POST')) {
        res.setHeader('Retry-After', '30');
        return send(res, 429, { error: 'rate limited' });
      }

      if (req.method === 'GET') {
        // فحص الإصدار: مفتاح واحد فقط (أخف طلب ممكن) — لأن كل جهاز يناديه كل بضعة ثوانٍ
        if (meta === 'version') {
          const version = loadVersion ? await loadVersion() : (await load()).version;
          return send(res, 200, { version });
        }
        const db = await load();
        if (isStaleSession(db)) return endStaleSession();
        return send(res, 200, {
          version: db.version,
          isEmpty: Object.keys(db.data || {}).length === 0,
          // إصدار الجلسات لا يغادر السيرفر أبداً، وكلمات المرور لا تُرى إلا للإدارة
          // (رتبة admin — صلاحية عرض كلمات مرور السيلز المطلوبة صراحةً)
          data: stripUserSecrets(db.data || {}, { keepPasswords: session?.r === 'admin' }),
        });
      }

      if (req.method === 'POST') {
        const body = await readBody(req);
        if (!body) return send(res, 400, { error: 'bad request' });

        const db = await load();
        if (isStaleSession(db)) return endStaleSession();
        const data = db.data || {};

        // كلمات المرور: الإدارة (رتبة admin) وحدها تستطيع تغييرها، ولا تُمسح لسجل موجود
        const accept = (key, value) =>
          key === 'crm_users'
            ? preserveUserPasswords(value, data.crm_users, { canManage: session?.r === 'admin' })
            : value;

        if (body.data && typeof body.data === 'object' && !Array.isArray(body.data)) {
          const entries = Object.entries(body.data);
          if (entries.length > 40) return send(res, 400, { error: 'too many keys' });
          for (const [key, value] of entries) {
            if (isValidKey(key) && isValidRecords(value)) data[key] = accept(key, value);
          }
        } else if (isValidKey(body.key) && isValidRecords(body.value)) {
          data[body.key] = accept(body.key, body.value);
        } else {
          return send(res, 400, { error: 'bad request' });
        }

        const next = { version: (Number(db.version) || 0) + 1, data };
        await save(next);
        return send(res, 200, { version: next.version });
      }

      return send(res, 405, { error: 'method not allowed' });
    } catch (error) {
      return send(res, 500, { error: 'server error', message: String(error?.message || error) });
    }
  };
}

// ===== التخزين في ملف JSON (سيرفر التطوير المحلي) =====
export function fileStorage(dbFile) {
  const dir = path.dirname(dbFile);
  // نعرّفها كمتغيّر مستقل (وليس دالة تعتمد على this) لأن createStoreHandler
  // يفكّ الكائن إلى دوال منفصلة، فعند استدعاء loadVersion() لن يوجد this أصلاً.
  const load = async () => {
    try {
      const parsed = JSON.parse(fs.readFileSync(dbFile, 'utf8'));
      return { version: Number(parsed.version) || 0, data: parsed.data || {} };
    } catch {
      return { version: 0, data: {} };
    }
  };

  return {
    // المخزن المحلي مضبوط دائماً (ملف على القرص) — نفس الواجهة كي يعمل
    // نفس منطق المصادقة في المكانين بلا أي تفريع
    configured: true,
    load,
    // قراءة ملف محلي مجانية — نُبقي نفس الواجهة حتى يعمل نفس الكود في المكانين
    async loadVersion() {
      return (await load()).version;
    },
    async save(db) {
      fs.mkdirSync(dir, { recursive: true });
      const tmp = `${dbFile}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(db, null, 2), 'utf8');
      fs.renameSync(tmp, dbFile);
    },
  };
}

// ===== عميل Redis REST (Upstash / Vercel KV) =====
// يعمل بمتغيرات Vercel KV أو Upstash مباشرة، ولا يحتاج أي مكتبة خارجية.
// يُستخدم في مكانين: مخزن المزامنة الكامل، ومفاتيح إعدادات مفردة (إعدادات سحب الأرقام).
export function redisClient(env = {}) {
  const url = String(env.KV_REST_API_URL || env.UPSTASH_REDIS_REST_URL || '').replace(/\/+$/, '');
  const token = String(env.KV_REST_API_TOKEN || env.UPSTASH_REDIS_REST_TOKEN || '');
  const configured = Boolean(url && token);

  const pipeline = async (commands) => {
    if (!configured) throw new Error('قاعدة البيانات غير مضبوطة — أضف متغيّرات Upstash ثم أعد النشر');
    const res = await fetch(`${url}/pipeline`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(commands),
    });
    if (!res.ok) throw new Error(`redis ${res.status}`);
    const payload = await res.json();
    return payload.map((item) => (item ? item.result : null));
  };

  return {
    configured,
    pipeline,
    async command(...args) {
      const [result] = await pipeline([args]);
      return result;
    },
    async get(key) {
      const value = await this.command('GET', key);
      return typeof value === 'string' ? value : null;
    },
    async set(key, value) {
      await pipeline([['SET', key, String(value)]]);
    },
  };
}

// ===== التخزين في Redis على Vercel (خطة مجانية) =====
export function redisStorage(env = {}) {
  const client = redisClient(env);
  const dataKey = 'crm:store:data';
  const versionKey = 'crm:store:version';

  return {
    configured: client.configured,
    // أمر Redis واحد فقط — يُستخدم في الفحص الدوري للإصدار
    async loadVersion() {
      const version = await client.command('GET', versionKey);
      return Number(version) || 0;
    },
    async load() {
      const [raw, version] = await client.pipeline([
        ['GET', dataKey],
        ['GET', versionKey],
      ]);
      let data = {};
      try {
        data = raw ? JSON.parse(raw) : {};
      } catch {
        data = {};
      }
      return { version: Number(version) || 0, data: data || {} };
    },
    async save(db) {
      const payload = JSON.stringify(db.data || {});
      if (payload.length > REDIS_MAX_VALUE) {
        throw new Error(
          'حجم البيانات تجاوز سقف قاعدة البيانات المجانية (١٠ ميجا) — قلّل صور العقارات ثم أعد المحاولة'
        );
      }
      if (payload.length > VERCEL_BODY_LIMIT) {
        throw new Error(
          'حجم البيانات أكبر من سقف الرفع على الاستضافة (٤ ميجا) — قلّل صور العقارات ثم أعد المحاولة'
        );
      }
      await client.pipeline([
        ['SET', dataKey, payload],
        ['SET', versionKey, String(db.version || 0)],
      ]);
    },
  };
}

// ===== تخزين كائن JSON واحد في مفتاح مستقل =====
// يُستخدم لإعدادات سحب الأرقام (توكن فيسبوك والصفحات والنماذج والمؤشرات)
// حتى تعيش على السيرفر: يعمل السحب التلقائي في الخلفية بلا أي متصفح مفتوح.
export function redisJsonStore(env = {}, key = 'crm:lead-source:config') {
  const client = redisClient(env);
  return {
    configured: client.configured,
    async load() {
      const raw = await client.get(key);
      if (!raw) return {};
      try {
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
      } catch {
        return {};
      }
    },
    async save(value) {
      await client.set(key, JSON.stringify(value || {}));
      return value;
    },
  };
}
