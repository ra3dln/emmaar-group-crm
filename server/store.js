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

const KEY_PATTERN = /^crm_[a-z_]+$/;
// صور العقارات تُخزَّن داخل نفس قاعدة البيانات (base64)، لذا نرفع السقف حتى لا يفقد التزامن بياناته
// على الاستضافة (Vercel/Upstash) سقف الطلب الواحد ١٠ ميجا، فننزل تحته قليلاً
// حتى يفشل الطلب برسالة مفهومة بدل خطأ غامض من Redis.
const MAX_BODY =
  Number(process.env.CRM_MAX_BODY) ||
  (process.env.VERCEL ? 9 * 1024 * 1024 : 24 * 1024 * 1024);
const REDIS_MAX_VALUE = 10 * 1024 * 1024;
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

export function createStoreHandler({ load, save }) {
  return async function handle(req, res) {
    try {
      const [url, query] = (req.url || '').split('?');
      if (url !== '/api/store') return send(res, 404, { error: 'not found' });
      const meta = new URLSearchParams(query || '').get('meta');

      // حماية من الإغراق (Brute force / DoS)
      if (rateLimited(req, req.method === 'POST')) {
        res.setHeader('Retry-After', '30');
        return send(res, 429, { error: 'rate limited' });
      }

      if (req.method === 'GET') {
        const db = await load();
        if (meta === 'version') return send(res, 200, { version: db.version });
        return send(res, 200, {
          version: db.version,
          isEmpty: Object.keys(db.data || {}).length === 0,
          data: db.data || {},
        });
      }

      if (req.method === 'POST') {
        const body = await readBody(req);
        if (!body) return send(res, 400, { error: 'bad request' });

        const db = await load();
        const data = db.data || {};

        if (body.data && typeof body.data === 'object' && !Array.isArray(body.data)) {
          const entries = Object.entries(body.data);
          if (entries.length > 40) return send(res, 400, { error: 'too many keys' });
          for (const [key, value] of entries) {
            if (isValidKey(key) && isValidRecords(value)) data[key] = value;
          }
        } else if (isValidKey(body.key) && isValidRecords(body.value)) {
          data[body.key] = body.value;
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
  return {
    async load() {
      try {
        const parsed = JSON.parse(fs.readFileSync(dbFile, 'utf8'));
        return { version: Number(parsed.version) || 0, data: parsed.data || {} };
      } catch {
        return { version: 0, data: {} };
      }
    },
    async save(db) {
      fs.mkdirSync(dir, { recursive: true });
      const tmp = `${dbFile}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(db, null, 2), 'utf8');
      fs.renameSync(tmp, dbFile);
    },
  };
}

// ===== التخزين في Redis على Vercel (خطة مجانية) =====
// يعمل مع متغيرات Vercel KV أو Upstash مباشرة، ولا يحتاج أي مكتبة إضافية.
export function redisStorage(env = {}) {
  const url = env.KV_REST_API_URL || env.UPSTASH_REDIS_REST_URL || '';
  const token = env.KV_REST_API_TOKEN || env.UPSTASH_REDIS_REST_TOKEN || '';
  const dataKey = 'crm:store:data';
  const versionKey = 'crm:store:version';

  const pipeline = async (commands) => {
    const res = await fetch(`${url.replace(/\/+$/, '')}/pipeline`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(commands),
    });
    if (!res.ok) throw new Error(`redis ${res.status}`);
    const payload = await res.json();
    return payload.map((item) => (item ? item.result : null));
  };

  return {
    configured: Boolean(url && token),
    async load() {
      const [raw, version] = await pipeline([
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
      await pipeline([
        ['SET', dataKey, payload],
        ['SET', versionKey, String(db.version || 0)],
      ]);
    },
  };
}
