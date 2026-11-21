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
import zlib from 'node:zlib';
import {
  authConfigured,
  isSecureRequest,
  preserveUserPasswords,
  sessionCookie,
  sessionFromRequest,
  sessionMatchesUsers,
  sessionVersionOf,
  signSession,
  stripUserSecrets,
} from './auth.js';
import { mergeClientActivities, sanitizeClientRecord, sanitizeDailyFeedbackCards } from '../shared/comments.js';
// حكم «مين حساب المطوّر» — نفس الملف في الواجهة (shared/roles.js)
import { isDeveloperAccount } from '../shared/roles.js';
import { keepManualOwner } from '../shared/ownerGuard.js';

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

// ===== الرد مضغوط (gzip) لو كبير =====
// البيانات كلها ~١.٤ ميجا ومضغوطة ~٢٣٠ كيلو. Vercel بيحسب «Fast Origin Transfer» على
// الحجم اللي الوظيفة بتبعته — فالضغط هنا بيقلّل الاستهلاك ٦ مرات تقريباً.
const GZIP_MIN_BYTES = 1024;
const send = (res, status, payload, req = null) => {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  const body = JSON.stringify(payload);
  const accepts = String(req?.headers?.['accept-encoding'] || '');
  if (req && body.length >= GZIP_MIN_BYTES && /gzip/i.test(accepts)) {
    res.setHeader('Content-Encoding', 'gzip');
    res.setHeader('Vary', 'Accept-Encoding');
    res.end(zlib.gzipSync(body));
    return;
  }
  res.end(body);
};

// نفس send بس لنص JSON جاهز (من غير JSON.stringify للبيانات كلها)
const sendRawJson = (res, status, body, req = null) => {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  const accepts = String(req?.headers?.['accept-encoding'] || '');
  if (req && body.length >= GZIP_MIN_BYTES && /gzip/i.test(accepts)) {
    res.setHeader('Content-Encoding', 'gzip');
    res.setHeader('Vary', 'Accept-Encoding');
    res.end(zlib.gzipSync(body));
    return;
  }
  res.end(body);
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

// ===== دمج القوائم بدل استبدالها (الأهم لثبات الحسابات) =====
// كل جهاز يرفع "القائمة كاملة" للمفتاح (مثلاً crm_users كلها). ولو رفع جهاز نسخة قديمة
// لم تصله بعدُ الحسابات التي أُنشئت على جهاز آخر، فالاستبدال المباشر يمسحها من القاعدة:
// فيعمل الحساب الجديد قليلاً ثم "يختفي" ويقول السيرفر «اسم المستخدم أو كلمة المرور
// غير صحيحة» — وهو بالضبط عطل "الحسابات أوقات مش بتشتغل".
//
// لذلك: عند الكتابة نبقي كل سجل موجود في النسختين (دمج بالمعرّف)، ولا يُحذف أي سجل
// إلا بشاهد حذف صريح يرفعه العميل نفسه (crm_tombstones) وهو أحدث من السجل —
// فالحذف المقصود يعمل كما هو، ولا يمسح جهاز قديم شيئاً لم يره بعد.
const TOMBSTONE_DATA_KEY = 'crm_tombstones';
const hasIds = (list) =>
  Array.isArray(list) && list.every((row) => row && typeof row === 'object' && row.id !== undefined && row.id !== null);
// آخر تعديل معروف للسجل — يُقارن بوقت شاهد الحذف (نفس قاعدة العميل في src/sync.ts)
const recordStamp = (record) =>
  Math.max(Date.parse(record?.updatedAt || '') || 0, Date.parse(record?.createdAt || '') || 0);

// وقت آخر تغيير على السجل — نفس حقول الجهاز (src/sync.ts: changeStamp) عشان
// السيرفر والأجهزة يختاروا نفس النسخة «الأحدث».
// وقت في المستقبل (جهاز ساعته متقدّمة) ما يتحسبش: كان بيخلّي نسخة الجهاز ده «الأحدث»
// على طول — فقاعدة توزيع تلقائي اتقفلت كانت بترجع تشتغل لوحدها بعد ثانيتين.
export const CLOCK_SKEW_MS = 2 * 60 * 1000;
const changeStamp = (record) =>
  Math.max(
    0,
    ...[record?.updatedAt, record?.assignedAt, record?.viewedAt, record?.createdAt]
      .map((value) => Date.parse(value || ''))
      .filter((n) => Number.isFinite(n) && n <= Date.now() + CLOCK_SKEW_MS)
  );

export function mergeKeepingRecords(key, incoming, stored, tombstones = []) {
  // شواهد الحذف نفسها تُستبدل كما هي (دمجها بالمعرّف كان سيضيّع شواهد حذف)
  if (key === TOMBSTONE_DATA_KEY) return incoming;
  if (!hasIds(incoming)) return incoming;
  const storedRows = hasIds(stored) ? stored : [];
  const byId = new Map();
  for (const row of storedRows) byId.set(String(row.id), row);
  // نفس المعرّف: النسخة الأحدث تكسب (وعند التساوي نسخة المُرسل).
  // كان المُرسل يكسب دايماً — فجهاز بيرفع كل قائمته كل ثانية كان بيرجّع نسخته
  // القديمة من السجل فوق تعديل أحدث اتعمل من جهاز تاني أو من الإدارة.
  for (const row of incoming) {
    const id = String(row.id);
    const prev = byId.get(id);
    if (!prev) {
      byId.set(id, row);
      continue;
    }
    // التوزيع اليدوي يكسب التلقائي مهما كان وقت الحفظ (shared/ownerGuard.js)
    const winner = changeStamp(prev) > changeStamp(row)
      ? keepManualOwner(key, prev, row)
      : keepManualOwner(key, row, prev);
    // دمج الخط الزمني للعميل (الكومنتات) حتى لا يمسح تعديل مرحلة كومنتات كُتبت على جهاز آخر
    if (key === 'crm_clients') {
      byId.set(id, {
        ...winner,
        activities: mergeClientActivities(row?.activities, prev?.activities),
      });
    } else {
      byId.set(id, winner);
    }
  }

  const deletedAt = new Map();
  for (const tomb of Array.isArray(tombstones) ? tombstones : []) {
    if (tomb && String(tomb.key) === key && tomb.id !== undefined && tomb.id !== null) {
      deletedAt.set(String(tomb.id), Number(tomb.at) || 0);
    }
  }
  return [...byId.values()].filter((row) => {
    const at = deletedAt.get(String(row.id));
    if (at === undefined) return true; // لا شاهد حذف لهذا السجل
    if (!at) return false; // شاهد بلا وقت (شكل قديم) = حذف مباشر
    // سجل أُنشئ/عُدّل بعد الحذف = إعادة إنشاء حقيقية => يعيش (وإلا كنا منعنا إعادة إنشائه)
    return recordStamp(row) > at;
  });
}

// ===== تنظيف الكومنتات عند الدمج =====
// اللوجات (اتصال/تذكير/واتساب) والكومنتات المكررة ما لازمش ترجع من جهاز قديم:
// نفس القاعدة اللي بتطبّقها الواجهة (shared/comments.js) — فكل الأجهزة تشوف نفس الكومنتات.
export function sanitizeMergedKey(key, rows) {
  if (key === 'crm_clients') return (rows || []).map((row) => sanitizeClientRecord(row));
  if (key === 'crm_daily_feedback') return sanitizeDailyFeedbackCards(rows || []);
  return rows;
}

// حساب المطوّر (صاحب النظام): نطاقه «بياناته هو» دائماً — زي أي سيلز.
// أي جهاز قديم يبقى عنده نسخة من سجل الحساب فيها «كل البيانات» ويرفعها
// للسيرفر، فيرث حسابه أرقام كل المندوبين — فبنثبّت النطاق هنا على الخادم
// (نفس القاعدة في shared/roles.js: dataScopeOf).
export function keepOwnerScopeOwn(users) {
  return (Array.isArray(users) ? users : []).map((u) =>
    u && isDeveloperAccount(u) ? { ...u, dataScope: 'own' } : u
  );
}

// شواهد الحذف لا تُستبدل: جهاز قديم يرفع شواهده الناقصة مايقدرش يلغي حذفاً تمّ.
// نُبقي الاتحاد (الشاهد الأحدث وقتاً يفوز) حتى لا يعود سجل محذوف للحياة من نسخة قديمة.
export function mergeTombstones(stored, incoming) {
  const out = new Map();
  const take = (list) => {
    for (const tomb of Array.isArray(list) ? list : []) {
      if (!tomb || typeof tomb.key !== 'string' || typeof tomb.id !== 'string') continue;
      const id = `${tomb.key}:${tomb.id}`;
      const at = Number(tomb.at) || 0;
      const previous = out.get(id);
      if (!previous || at > (Number(previous.at) || 0)) out.set(id, { ...tomb, at });
    }
  };
  take(stored);
  take(incoming);
  return [...out.values()];
}

// شواهد حذف لسجلات أُعيد إنشاؤها بعد الحذف تسقط من القاعدة أيضاً.
// نفس قاعدة الواجهة (src/sync.ts: dropResurrected): لو السجل موجود ووقته أحدث
// من وقت الحذف فهو إعادة إنشاء حقيقية والشاهد مالوش لازمة. من غير التنظيف ده
// العميل بيشيل الشاهد من عنده والسيرفر بيرجّعه (دمج = اتحاد) فكل مزامنة بتغيّر
// رقم النسخة، وكل جهاز ينزّل البيانات كلها من الأول كل فتحة.
export function pruneResurrectedTombstones(data) {
  const tombstones = Array.isArray(data?.[TOMBSTONE_DATA_KEY]) ? data[TOMBSTONE_DATA_KEY] : [];
  const rowsOf = (key) => (Array.isArray(data?.[key]) ? data[key] : []);
  return tombstones.filter((tomb) => {
    if (!tomb || typeof tomb.key !== 'string' || !tomb.id) return true;
    const row = rowsOf(tomb.key).find((r) => r && String(r.id) === String(tomb.id));
    if (!row) return true; // مش موجود => الشاهد باقي
    const at = Number(tomb.at) || 0;
    if (!at) return false; // شاهد قديم بلا وقت = حذف مباشر
    return recordStamp(row) <= at; // أحدث من الحذف => إعادة إنشاء => الشاهد يسقط
  });
}

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
// loadRaw / loadKeys / saveRaw اختيارية (Cloudflare D1): طرق خفيفة عشان حد المعالجة
// في Cloudflare المجاني (١٠ مللي ثانية للطلب) — من غير فك البيانات كلها وإعادة تجميعها.
export function createStoreHandler({ load, save, loadVersion, loadRaw = null, loadKeys = null, saveRaw = null, token = '', auth = null }) {
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

      // تجديد انزلاقي للجلسة: الجهاز الذي يفتح التطبيق يومياً لا تنتهي جلسته أبداً.
      // نجدّد مرة واحدة في اليوم (وليس مع كل طلب كل ثانية) حتى لا نضخّم الردود.
      const maybeRefreshSession = (db) => {
        if (!auth || !session) return;
        if (Date.now() - (Number(session.iat) || 0) < 24 * 60 * 60 * 1000) return;
        const users = Array.isArray(db?.data?.crm_users) ? db.data.crm_users : [];
        const user = users.find((u) => u && String(u.id) === String(session.u));
        if (!user) return;
        const fresh = signSession(auth, {
          u: user.id,
          r: user.role,
          n: user.username,
          sv: sessionVersionOf(user),
        });
        res.setHeader('Set-Cookie', sessionCookie(fresh, { secure: isSecureRequest(req) }));
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
        // ===== التحميل الخفيف: البيانات كنص زي ما هي، والحسابات بس اللي بتتفك =====
        if (loadRaw) {
          const { version, raw } = await loadRaw();
          let users = [];
          try {
            users = JSON.parse(raw.crm_users || '[]');
          } catch {
            users = [];
          }
          const usersDb = { data: { crm_users: Array.isArray(users) ? users : [] } };
          if (isStaleSession(usersDb)) return endStaleSession();
          maybeRefreshSession(usersDb);
          const safeUsers = stripUserSecrets(usersDb.data, { keepPasswords: session?.r === 'admin' }).crm_users;
          const names = Object.keys(raw);
          const parts = names.map(
            (name) => `${JSON.stringify(name)}:${name === 'crm_users' ? JSON.stringify(safeUsers) : raw[name]}`
          );
          const body = `{"version":${Number(version) || 0},"isEmpty":${names.length === 0},"data":{${parts.join(',')}}}`;
          return sendRawJson(res, 200, body, req);
        }
        const db = await load();
        if (isStaleSession(db)) return endStaleSession();
        maybeRefreshSession(db);
        return send(res, 200, {
          version: db.version,
          isEmpty: Object.keys(db.data || {}).length === 0,
          // إصدار الجلسات لا يغادر السيرفر أبداً، وكلمات المرور لا تُرى إلا للإدارة
          // (رتبة admin — صلاحية عرض كلمات مرور السيلز المطلوبة صراحةً)
          data: stripUserSecrets(db.data || {}, { keepPasswords: session?.r === 'admin' }),
        }, req);
      }

      if (req.method === 'POST') {
        const body = await readBody(req);
        if (!body) return send(res, 400, { error: 'bad request' });

        // ===== الحفظ الخفيف: مفتاح واحد (القائمة كلها أو upserts = السجلات اللي اتغيّرت بس) =====
        // بيقرا المفتاح ده + شواهد الحذف + الحسابات بس، وبيكتب المفتاح ده بس.
        const single = !body.data && isValidKey(body.key);
        const incomingRows = single ? (Array.isArray(body.upserts) ? body.upserts : body.value) : null;
        if (loadKeys && saveRaw && single && isValidRecords(incomingRows)) {
          const key = body.key;
          const part = await loadKeys([key, TOMBSTONE_DATA_KEY, 'crm_users']);
          if (isStaleSession(part)) return endStaleSession();
          const pdata = part.data || {};
          const storedRows = Array.isArray(pdata[key]) ? pdata[key] : [];
          const tombs = Array.isArray(pdata[TOMBSTONE_DATA_KEY]) ? pdata[TOMBSTONE_DATA_KEY] : [];
          let merged;
          if (key === TOMBSTONE_DATA_KEY) {
            merged = mergeTombstones(tombs, incomingRows);
          } else {
            // التنظيف للسجلات الجاية بس (المتخزّن اتنضّف وقت كتابته) — تنظيف القائمة كلها
            // مع كل كومنت كان بياخد وقت معالجة كبير.
            let incoming = incomingRows;
            if (key === 'crm_clients') incoming = incomingRows.map((row) => sanitizeClientRecord(row));
            if (key === 'crm_daily_feedback') {
              // نفس منع التكرار بتاع sanitizeDailyFeedbackCards: نفس الرقم + نفس الكلام + نفس الدقيقة
              const sigOf = (card) =>
                `${String(card?.clientPhone || '').replace(/D/g, '')}|${String(card?.feedback || '')}|${String(card?.date || card?.createdAt || '').slice(0, 16)}`;
              const storedSigs = new Map(storedRows.map((card) => [sigOf(card), String(card?.id)]));
              incoming = sanitizeDailyFeedbackCards(incomingRows).filter((card) => {
                const owner = storedSigs.get(sigOf(card));
                return !owner || owner === String(card?.id);
              });
            }
            merged = mergeKeepingRecords(key, incoming, storedRows, tombs);
            if (key === 'crm_users') {
              merged = preserveUserPasswords(keepOwnerScopeOwn(merged), pdata.crm_users, { canManage: session?.r === 'admin' });
            }
          }
          // اتغيّر حاجة؟ من غير تحويل القائمة كلها لنص مرتين: نقارن السجلات اللي اتبعتت
          // بس، وعدد السجلات (شاهد حذف ممكن يشيل سجل).
          let changed = merged.length !== storedRows.length;
          if (!changed) {
            const storedById = new Map(storedRows.map((row) => [String(row?.id), row]));
            const mergedById = new Map(merged.map((row) => [String(row?.id), row]));
            for (const row of incomingRows) {
              const id = String(row?.id);
              if (JSON.stringify(mergedById.get(id)) !== JSON.stringify(storedById.get(id))) {
                changed = true;
                break;
              }
            }
          }
          const writes = {};
          if (changed) writes[key] = JSON.stringify(merged);
          // شاهد حذف لسجل اتعمل تاني بعد الحذف: يسقط (نفس pruneResurrectedTombstones للمفتاح ده)
          if (key !== TOMBSTONE_DATA_KEY && tombs.length) {
            const rowById = new Map(merged.map((row) => [String(row?.id), row]));
            const kept = tombs.filter((tomb) => {
              if (!tomb || tomb.key !== key || !tomb.id) return true;
              const row = rowById.get(String(tomb.id));
              if (!row) return true;
              const at = Number(tomb.at) || 0;
              if (!at) return false;
              return recordStamp(row) <= at;
            });
            if (kept.length !== tombs.length) writes[TOMBSTONE_DATA_KEY] = JSON.stringify(kept);
          }
          if (!Object.keys(writes).length) {
            return send(res, 200, { version: Number(part.version) || 0, unchanged: true });
          }
          const nextVersion = (Number(part.version) || 0) + 1;
          await saveRaw(nextVersion, writes);
          return send(res, 200, { version: nextVersion });
        }

        const db = await load();
        if (isStaleSession(db)) return endStaleSession();
        const data = db.data || {};
        // نسخة البيانات قبل الدمج — عشان لو الرفع ما غيّرش حاجة ما نزوّدش رقم النسخة
        const before = JSON.stringify(data);

        // شواهد الحذف تُطبَّق أولاً (وبالدمج لا الاستبدال) حتى تُحترم في نفس الطلب
        // وحتى لا يمحوها جهاز قديم فتعود السجلات المحذوفة للحياة
        const tombstonesIn = body?.data?.[TOMBSTONE_DATA_KEY];
        if (isValidKey(TOMBSTONE_DATA_KEY) && isValidRecords(tombstonesIn)) {
          data[TOMBSTONE_DATA_KEY] = mergeTombstones(data[TOMBSTONE_DATA_KEY], tombstonesIn);
        }
        const tombstones = () => (Array.isArray(data[TOMBSTONE_DATA_KEY]) ? data[TOMBSTONE_DATA_KEY] : []);

        // الدمج أولاً ثم كلمات المرور: الإدارة (رتبة admin) وحدها تستطيع تغييرها،
        // ولا تُمسح كلمة مرور سجل موجود (server/auth.js: preserveUserPasswords)
        const accept = (key, value) => {
          if (key === TOMBSTONE_DATA_KEY) return mergeTombstones(data[TOMBSTONE_DATA_KEY], value);
          const merged = sanitizeMergedKey(
            key,
            mergeKeepingRecords(key, value, data[key], tombstones())
          );
          return key === 'crm_users'
            ? preserveUserPasswords(
                keepOwnerScopeOwn(merged),
                data.crm_users,
                { canManage: session?.r === 'admin' }
              )
            : merged;
        };

        if (body.data && typeof body.data === 'object' && !Array.isArray(body.data)) {
          const entries = Object.entries(body.data);
          if (entries.length > 40) return send(res, 400, { error: 'too many keys' });
          for (const [key, value] of entries) {
            if (key === TOMBSTONE_DATA_KEY) continue; // عولجت قبل الدمج
            if (isValidKey(key) && isValidRecords(value)) data[key] = accept(key, value);
          }
        } else if (isValidKey(body.key) && isValidRecords(body.value)) {
          data[body.key] = accept(body.key, body.value);
        } else {
          return send(res, 400, { error: 'bad request' });
        }

        // تنظيف شواهد السجلات اللي أُعيد إنشاؤها بعد الحذف (انظر pruneResurrectedTombstones)
        if (Array.isArray(data[TOMBSTONE_DATA_KEY])) {
          data[TOMBSTONE_DATA_KEY] = pruneResurrectedTombstones(data);
        }

        // ===== رفع من غير تغيير = ولا حفظ ولا نسخة جديدة =====
        // كان أي رفع (حتى لو نفس البيانات بالظبط) بيزوّد رقم النسخة، فكل الأجهزة تفتكر
        // إن فيه جديد وتحمّل البيانات كلها من الأول (١.٣ ميجا) — وجهاز بيرفع نفس الحاجة
        // كل ثانية ونص كان بيعمل كده ٨ مرات في الدقيقة، فالموقع بقى بطيء وهو بيفتح.
        if (JSON.stringify(data) === before) {
          return send(res, 200, { version: Number(db.version) || 0, unchanged: true });
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
