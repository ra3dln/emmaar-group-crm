// ===== إشعارات حقيقية تصل والموقع مقفول (Web Push) =====
// بلا أي مكتبة خارجية: مفاتيح VAPID + تشفير الحمولة (RFC 8291 / aes128gcm) بـ node:crypto.
// السيرفر هو الذي يرسل، فالإشعار يصل للهاتف حتى لو الموقع (أو التاب) مقفول تماماً.
//
// يعمل في مكانين بنفس المنطق:
//   1) سيرفر المكتب (vite.config.js)  -> ملفات JSON محلية + setInterval.
//   2) الاستضافة (Vercel)              -> قاعدة بيانات مشتركة (Supabase/Redis) + cron كل ٥ دقائق.
// الفروق محصورة في «مُسبِّب» (accessor) يقرأ ويكتب: ملف محلي أو القاعدة المشتركة.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { authConfigured, sessionFromRequest } from './auth.js';
import { isManagerAccount } from '../shared/roles.js';

const b64u = (buf) => Buffer.from(buf).toString('base64url');
const unb64u = (str) => Buffer.from(String(str).replace(/-/g, '+').replace(/_/g, '/'), 'base64');

// ---------- مفاتيح VAPID (تُولَّد مرة واحدة وتُحفظ على السيرفر) ----------
function generateVapid() {
  const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const privateJwk = privateKey.export({ format: 'jwk' });
  return {
    // المفتاح العام بصيغة النقطة غير المضغوطة (0x04 || x || y) وهو ما يحتاجه المتصفح
    publicKey: b64u(Buffer.concat([Buffer.from([4]), unb64u(privateJwk.x), unb64u(privateJwk.y)])),
    privateJwk,
    createdAt: new Date().toISOString(),
  };
}

const isValidVapid = (value) =>
  value && typeof value === 'object' && value.privateJwk?.d && value.publicKey;

export function loadOrCreateVapid(file) {
  try {
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (isValidVapid(saved)) return saved;
  } catch {
    /* يُولَّد جديد */
  }
  const keys = generateVapid();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(keys, null, 2));
  return keys;
}

// مُسبِّب مفاتيح VAPID يعمل مع أي مخزن JSON (ملف محلي أو القاعدة المشتركة).
// يُولَّد مرة واحدة ويحفظها في القاعدة حتى لا تتبدّل مع كل استدعاء بارد (cold start).
export function createVapidAccessor(store) {
  let cached = null;
  return async () => {
    if (cached) return cached;
    const saved = await store.load();
    if (isValidVapid(saved)) {
      cached = saved;
      return cached;
    }
    cached = generateVapid();
    try {
      await store.save(cached);
    } catch {
      // فشل الحفظ لا يمنع الإرسال في هذه الجلسة — تُولَّد جديدة في الجلسة القادمة
    }
    return cached;
  };
}

// ---------- توقيع VAPID (JWT ES256) ----------
function vapidHeader(endpoint, keys, subject) {
  const aud = new URL(endpoint).origin;
  const header = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const payload = b64u(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 6 * 3600, sub: subject }));
  const signature = crypto.sign('sha256', Buffer.from(`${header}.${payload}`), {
    key: crypto.createPrivateKey({ key: keys.privateJwk, format: 'jwk' }),
    dsaEncoding: 'ieee-p1363', // مهم: JWS يحتاج r||s لا صيغة DER
  });
  return { jwt: `${header}.${payload}.${b64u(signature)}`, publicKey: keys.publicKey };
}

// ---------- تشفير الحمولة (aes128gcm) ----------
function encryptPayload(subscription, payloadBuffer) {
  const uaPublic = unb64u(subscription.keys.p256dh); // 65 بايت
  const authSecret = unb64u(subscription.keys.auth); // 16 بايت
  if (uaPublic.length !== 65 || authSecret.length !== 16) throw new Error('مفاتيح اشتراك غير صالحة');

  const as = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const asJwk = as.publicKey.export({ format: 'jwk' });
  const asPublic = Buffer.concat([Buffer.from([4]), unb64u(asJwk.x), unb64u(asJwk.y)]);

  const uaKey = crypto.createPublicKey({
    key: { kty: 'EC', crv: 'P-256', x: b64u(uaPublic.subarray(1, 33)), y: b64u(uaPublic.subarray(33, 65)) },
    format: 'jwk',
  });
  const sharedSecret = crypto.diffieHellman({ privateKey: as.privateKey, publicKey: uaKey });

  // مفتاح وسيط: HKDF(ikm = السر المشترك، salt = auth، info = "WebPush: info\0" || ua || as)
  const ikm = Buffer.from(
    crypto.hkdfSync(
      'sha256',
      sharedSecret,
      authSecret,
      Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic]),
      32
    )
  );
  const salt = crypto.randomBytes(16);
  const cek = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));

  const cipher = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const record = Buffer.concat([payloadBuffer, Buffer.from([2])]); // 0x02 = نهاية السجل
  const body = Buffer.concat([
    salt,
    Buffer.from([0, 0, 16, 0]), // rs = 4096
    Buffer.from([asPublic.length]),
    asPublic,
    cipher.update(record),
    cipher.final(),
    cipher.getAuthTag(),
  ]);
  return body;
}

// ---------- إرسال إشعار لاشتراك واحد ----------
// موضوع VAPID: بعض خدمات الإشعارات (آبل خاصةً) ترفض `mailto` لنطاق غير حقيقي فيفشل
// الإرسال بصمت. رابط الموقع (https) مقبول من كل الخدمات — ويمكن تجاوزه من البيئة.
export const PUSH_SUBJECT =
  String(process.env.PUSH_SUBJECT || '').trim() || 'https://emmaar-group-crm.vercel.app';

export async function sendPush(subscription, payload, keys, subject = PUSH_SUBJECT) {
  const data = Buffer.from(JSON.stringify(payload));
  const body = encryptPayload(subscription, data);
  const { jwt, publicKey } = vapidHeader(subscription.endpoint, keys, subject);
  const res = await fetch(subscription.endpoint, {
    method: 'POST',
    headers: {
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      // يبقى محفوظاً في خدمة الإشعارات يوماً كاملاً: لو الجهاز كان مقفولاً أو بلا
      // إنترنت وقت الإرسال، يصل الإشعار فور عودته بدل أن يُسقط بعد ربع ساعة.
      TTL: '86400',
      Urgency: 'high', // مهم: يوقظ الجهاز حتى في وضع توفير الطاقة
      Authorization: `vapid t=${jwt}, k=${publicKey}`,
    },
    body,
  });
  return { ok: res.ok, status: res.status, expired: res.status === 404 || res.status === 410 };
}

// ---------- أدوات ملف محلية (سيرفر المكتب فقط) ----------
const readJson = (file, fallback) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
};

const writeJson = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8');
  fs.renameSync(tmp, file);
};

// مُسبِّب كائن JSON واحد في ملف محلي (للمقارنة مع مخزن القاعدة)
const fileJsonStore = (file, fallback) => ({
  load: async () => readJson(file, fallback),
  save: async (value) => writeJson(file, value),
});

const send = (res, status, payload) => {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
};

const readBody = (req) =>
  new Promise((resolve) => {
    if (req.body && typeof req.body === 'object') return resolve(req.body);
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 1024 * 512) req.destroy();
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

// ---------- نواة خدمة الإشعارات (واجهة HTTP) ----------
// كل الوصول للتخزين يمر عبر مُسبِّبات غير متزامنة، فلا يفرق المنطق بين ملف محلي وقاعدة مشتركة.
function buildPushHandler({ getKeys, loadDb, saveDb, stateStore = null, auth = null, logger = console }) {
  // حالة الإرسال (آخر تشغيل/آخر نتيجة) — تُقرأ للتشخيص وتُحدَّث بعد كل دورة
  const loadState = () => (stateStore ? stateStore.load() : Promise.resolve({}));
  const saveState = (value) => (stateStore ? stateStore.save(value) : Promise.resolve(value));
  // إرسال لكل اشتراكات مستخدم معيّن، وحذف الاشتراكات المنتهية تلقائياً
  const pushToUser = async (userId, payload) => {
    const keys = await getKeys();
    const db = await loadDb();
    const subs = db.data.crm_push_subs || [];
    const mine = subs.filter((s) => s.userId === userId);
    if (!mine.length) return { sent: 0, total: 0 };
    let sent = 0;
    const dead = new Set();
    for (const sub of mine) {
      try {
        const result = await sendPush(sub, payload, keys);
        if (result.ok) sent += 1;
        if (result.expired) dead.add(sub.endpoint);
      } catch (error) {
        logger.warn?.('[push] فشل الإرسال:', String(error?.message || error));
      }
    }
    if (dead.size) {
      db.data.crm_push_subs = subs.filter((s) => !dead.has(s.endpoint));
      try {
        await saveDb(db.data, (Number(db.version) || 0) + 1);
      } catch {
        // فشل التنظيف لا يمنع الإرسال — يُنظَّف في المحاولة القادمة
      }
    }
    return { sent, total: mine.length };
  };

  const handler = async (req, res) => {
    try {
      const [url] = (req.url || '').split('?');

      // المفتاح العام للإشعارات ليس سراً — يُقرأ قبل الدخول لعرض حالة الإشعارات
      if (url === '/api/push/key' && req.method === 'GET') {
        const keys = await getKeys();
        return send(res, 200, { publicKey: keys.publicKey });
      }

      // ما بعده: جلسة صحيحة إلزامية
      let session = null;
      if (auth) {
        if (!authConfigured(auth)) {
          return send(res, 503, { error: 'auth not configured', hint: 'أضف AUTH_SECRET ثم أعد التشغيل.' });
        }
        session = sessionFromRequest(auth, req);
        if (!session) return send(res, 401, { error: 'unauthorized' });
      }

      if (url === '/api/push/subscribe' && req.method === 'POST') {
        const body = await readBody(req);
        const sub = body?.subscription;
        // مع جلسة: الاشتراك يُقيَّد بصاحب الجلسة ولا يُقبل userId من الطلب
        const userId = session ? session.u : body?.userId;
        const userName = session ? String(session.n || '') : body?.userName || '';
        if (!userId || !sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) {
          return send(res, 400, { error: 'بيانات اشتراك غير مكتملة' });
        }
        const db = await loadDb();
        const subs = (db.data.crm_push_subs || []).filter((s) => s.endpoint !== sub.endpoint);
        subs.push({
          id: crypto.randomUUID(),
          userId,
          userName,
          endpoint: sub.endpoint,
          keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth },
          userAgent: String(req.headers['user-agent'] || '').slice(0, 120),
          createdAt: new Date().toISOString(),
        });
        db.data.crm_push_subs = subs;
        await saveDb(db.data, (Number(db.version) || 0) + 1);
        return send(res, 200, { ok: true, devices: subs.filter((s) => s.userId === userId).length });
      }

      if (url === '/api/push/unsubscribe' && req.method === 'POST') {
        const body = await readBody(req);
        const db = await loadDb();
        const before = (db.data.crm_push_subs || []).length;
        db.data.crm_push_subs = (db.data.crm_push_subs || []).filter((s) => s.endpoint !== body?.endpoint);
        if (db.data.crm_push_subs.length !== before) await saveDb(db.data, (Number(db.version) || 0) + 1);
        return send(res, 200, { ok: true });
      }

      if (url === '/api/push/test' && req.method === 'POST') {
        const body = await readBody(req);
        const userId = session ? session.u : body?.userId;
        const result = await pushToUser(userId, {
          title: '🔔 إشعار تجريبي — MSA CRM',
          body: 'لو وصلتك الرسالة دي فالموقع شغّال كأنه تطبيق على جهازك ✓',
          tag: `test-${Date.now()}`,
          url: '/',
        });
        return send(res, 200, { ok: result.sent > 0, ...result });
      }

      // ===== تشخيص الإشعارات: لماذا لم يصل الإشعار =====
      // يرجع ما يحتاجه المستخدم ليعرف بنفسه: أجهزته المسجلة، آخر مرة عمل فيها
      // المُشغّل الدوري، نتيجة آخر إرسال، وعدد التذكيرات المستحقة الآن.
      if (url === '/api/push/health' && req.method === 'GET') {
        const db = await loadDb();
        const subs = db.data.crm_push_subs || [];
        const mine = session ? subs.filter((s) => s.userId === session.u) : [];
        const state = (await loadState()) || {};
        const now = Date.now();
        const due = (db.data.crm_reminders || []).filter((r) => {
          if (r.isCompleted || !r.dateTime) return false;
          if (session && r.userId !== session.u) return false;
          const at = Date.parse(r.dateTime);
          return Number.isFinite(at) && at <= now;
        }).length;
        return send(res, 200, {
          ok: true,
          devices: mine.length,
          totalDevices: subs.length,
          lastRunAt: state.lastRunAt || 0,
          lastResult: state.lastResult || null,
          lastError: state.lastError || '',
          dueReminders: due,
          serverTime: now,
        });
      }

      // ===== إرسال فوري للتذكيرات/الرسائل المستحقة =====
      // المجدول الخارجي قد يتأخر أو يتوقف، وفي هذه الحالة تبقى التذكيرات بلا إشعار
      // خارجي. أي جهاز مفتوح للفريق ينادي هذا المسار، فيرسل السيرفر الإشعارات
      // المستحقة لبقية الأجهزة فوراً — بلا انتظار المجدول. الدورة محمية بفاصل زمني
      // حتى لا يتحول كل جهاز إلى مُشغّل دائم على القاعدة.
      if (url === '/api/push/flush' && req.method === 'POST') {
        const result = await processPushTick({
          getKeys,
          loadDb,
          saveDb,
          loadState,
          saveState,
          logger,
          minIntervalMs: 20000,
          // مفيش تنبيه داخل الصفحة خلاص: التذكير يوصل كإشعار خارجي للجهاز،
          // والعلامة في state.reminders تمنع تكراره بعد كده (مجزول أو جهاز تاني).
        });
        return send(res, 200, { ok: true, ...result });
      }

      if (url === '/api/push/state' && req.method === 'GET') {
        const db = await loadDb();
        const subs = db.data.crm_push_subs || [];
        return send(res, 200, {
          devices: subs.length,
          users: [...new Set(subs.map((s) => s.userName || s.userId))],
        });
      }

      return send(res, 404, { error: 'not found' });
    } catch (error) {
      return send(res, 500, { error: 'server error', message: String(error?.message || error) });
    }
  };

  return { handler, pushToUser };
}

// ---------- نواة معالجة التذكيرات والرسائل (مشتركة بين المحلي والاستضافة) ----------
const RECENT_MS = 6 * 60 * 60 * 1000; // لا نرسل لتذكير أقدم من ٦ ساعات
// تنبيهات النظام (مثل انتهاء توكن فيسبوك): لا تتكرر كل دورة — كل ١٢ ساعة مرة كافية
const ALERT_REPEAT_MS = 12 * 60 * 60 * 1000;

async function processPushTick({
  getKeys,
  loadDb,
  saveDb,
  loadState,
  saveState,
  logger = console,
  minIntervalMs = 0,
  systemAlerts = [],
}) {
  const keys = await getKeys();
  const db = await loadDb();
  const data = db.data || {};
  const subs = data.crm_push_subs || [];
  const state = (await loadState()) || { reminders: {}, messages: {} };
  state.reminders = state.reminders || {};
  state.messages = state.messages || {};
  state.alerts = state.alerts || {};
  // سجل الأرقام التي أُرسل عنها إشعار — يمنع التكرار كل دورة
  state.leads = state.leads || {};
  const now = Date.now();
  // من يُبلَّغ بالنظام (الإدارة): تنبيهات التوكن والأرقام غير الموزّعة
  // «مدير» بالمعنى السلوكي: حساب المطوّر (إداري في القاعدة، سيلز في الشغل) ليس
  // من غرفة الإدارة، فإشعارات الإدارة ورسائلها ما توصله — نفس حكم الواجهة بالضبط.
  const managers = (data.crm_users || []).filter(
    (u) => u && u.isActive !== false && isManagerAccount(u)
  );

  // نداء يدوي متكرر (كل جهاز مفتوح): لا نضرب القاعدة أكثر من مرة كل ٢٠ ثانية
  if (minIntervalMs && state.lastRunAt && now - Number(state.lastRunAt) < minIntervalMs) {
    return { sent: 0, reminders: 0, messages: 0, skipped: true, lastRunAt: state.lastRunAt };
  }

  // وقت التشغيل يُسجَّل في نهاية الدورة (مع نتيجتها) — تشخيص «هل المجدول شغّال؟» يعتمد عليه
  if (!subs.length) {
    await saveState({
      ...state,
      lastRunAt: now,
      lastResult: { sent: 0, reminders: 0, messages: 0 },
    }).catch(() => {});
    return { sent: 0, reminders: 0, messages: 0 };
  }

  let changed = false;
  let sent = 0;

  // نُعيد عدد الأجهزة التي وصلها الإشعار فعلاً — علامة «تم الإرسال» لا تُكتب
  // إلا بعد وصوله لجهاز واحد على الأقل. بدون ذلك، تذكير لمندوب بلا أجهزة مشتركة
  // كان يُعلَّم كمُرسَل ويضيع للأبد لو اشترك من جهازه بعد شوية.
  const push = async (userId, payload) => {
    const mine = subs.filter((s) => s.userId === userId);
    let delivered = 0;
    for (const sub of mine) {
      try {
        const result = await sendPush(sub, payload, keys);
        if (result.ok) { sent += 1; delivered += 1; }
        if (result.expired) {
          const fresh = await loadDb();
          fresh.data.crm_push_subs = (fresh.data.crm_push_subs || []).filter((s) => s.endpoint !== sub.endpoint);
          await saveDb(fresh.data, (Number(fresh.version) || 0) + 1);
        }
      } catch (error) {
        logger.warn?.('[push] فشل الإرسال:', String(error?.message || error));
      }
    }
    return delivered;
  };

  // ١) تذكيرات مستحقة
  let reminderCount = 0;
  for (const reminder of data.crm_reminders || []) {
    if (reminder.isCompleted || !reminder.dateTime) continue;
    const dueAt = Date.parse(reminder.dateTime);
    if (Number.isNaN(dueAt)) continue;
    if (dueAt > now || now - dueAt > RECENT_MS) continue;
    if (state.reminders[reminder.id]) continue;
    const delivered = await push(reminder.userId, {
      kind: 'reminder',
      title: `⏰ حان وقت الاتصال بـ ${reminder.clientName || 'عميل'}`,
      body: `${reminder.clientPhone || ''}${reminder.note ? ' — ' + reminder.note : ''}`,
      phone: reminder.clientPhone || '',
      tag: `reminder-${reminder.id}`,
      id: reminder.id,
      url: '/',
    });
    if (!delivered) continue; // لا أجهزة/فشل مؤقت: يُعاد في الدورة القادمة بلا ضياع
    state.reminders[reminder.id] = now;
    reminderCount += 1;
    changed = true;
  }

  // ٢) رسائل الشات الجديدة
  // الرسالة تصل **للطرف الذي تمت المحادثة معه فقط**: رسالة خاصة → جهاز صاحبها وحده،
  // ورسالة غرفة المدراء → أجهزة المدراء (ما عدا كاتبها). لا تُرسل لكل الأجهزة
  // كما كان يحدث حين كانت المحادثة تُعامل كأنها مشتركة.
  let messageCount = 0;
  for (const message of data.crm_messages || []) {
    if (state.messages[message.id]) continue;
    const sentAt = Date.parse(message.createdAt || '');
    if (Number.isNaN(sentAt) || now - sentAt > RECENT_MS) continue;
    // غرفة المدراء معرّفها 'managers' وليس حساباً حقيقياً، فلا بد من تفكيكها
    // إلى أعضائها وإلا لم يصل إشعار الغرفة لأحد أبداً.
    const recipients =
      message.toId === 'managers'
        ? managers.filter((u) => u.id !== message.fromId).map((u) => u.id)
        : [message.toId];
    let delivered = 0;
    for (const recipientId of recipients) {
      delivered += await push(recipientId, {
        kind: 'message',
        title: `💬 رسالة من ${message.fromName || 'الإدارة'}`,
        body: String(message.text || '').slice(0, 160),
        tag: `message-${message.id}`,
        url: '/',
      });
    }
    if (!delivered) continue;
    state.messages[message.id] = now;
    messageCount += 1;
    changed = true;
  }

  // تنظيف السجل القديم حتى لا يكبر بلا حدود
  const prune = (map) => {
    const out = {};
    for (const [key, value] of Object.entries(map || {})) {
      if (now - Number(value) < 7 * 24 * 60 * 60 * 1000) out[key] = value;
    }
    return out;
  };

  // ٣) تنبيهات النظام (انتهاء صلاحية توكن السحب مثلاً) — تصل الإدارة على أجهزتها
  // حتى لو الموقع مقفول. تُرسل لمن يدير التوكن (admin / supervisor) لا للمندوبين،
  // ولا تتكرر إلا كل ١٢ ساعة حتى لا تتحول إلى إزعاج يومي.
  let alertCount = 0;
  for (const alert of systemAlerts) {
    if (!alert?.id || !managers.length) continue;
    const last = Number(state.alerts[alert.id]) || 0;
    if (now - last < ALERT_REPEAT_MS) continue;
    let delivered = 0;
    for (const manager of managers) {
      delivered += await push(manager.id, {
        kind: 'system',
        title: alert.title,
        body: alert.body,
        tag: alert.id,
        url: alert.url || '/',
      });
    }
    // بلا أجهزة للإدارة أو فشل مؤقت: لا يُعلَّم كمُرسَل — يُعاد في الدورة القادمة
    if (!delivered) continue;
    state.alerts[alert.id] = now;
    alertCount += 1;
    changed = true;
  }

  // ٤) رقم فريش جديد نزل على سيلز — إشعار خارجي على جهازه حتى لو الموقع مقفول
  //    • الرقم الموزّع: إشعار لصاحبه بالاسم والرقم واسم الفورم ليبدأ الاتصال فوراً.
  //    • الرقم غير الموزّع: مفيش إشعار — «رقم جديد في الفورم» بقى إشعار خارجي
  //      لكل سيلز عن أرقامه هو بس (مش إزعاج للإدارة برقم مش معروف).
  //    تُجمع أرقام المستلم الواحد في إشعار واحد (دفعة الفورم ٤٠ رقماً لا تتحول ٤٠ إشعاراً).
  //    ولا يُعلَّم الرقم كمُرسَل إلا إذا وصل لجهاز فعلاً — فإن لم توجد أجهزة يُعاد لاحقاً.
  //
  //    ملاحظتان مهمتان (كانتا سبب «السيلز مش بيوصله إشعار»):
  //    ١) العلامة تُكتب لكل «رقم × مستلم» على حدة. قبل ذلك كان إشعار الإدارة عن رقم
  //       وصل غير موزّع يسجّل الرقم نفسه، فلما يتوزّع بعدها على مندوب ما يوصلهش شيء.
  //    ٢) التوقيت يُحسب من **لحظة الإسناد** (`assignedAt`) لا من لحظة وصول الرقم:
  //       رقم وصل امبارح واتوزّع النهاردة لازم يوصل صاحبه إشعار، والعكس صحيح.
  let leadCount = 0;
  const pendingLeads = [];
  const digitsOnly = (v) =>
    String(v ?? '')
      .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
      .replace(/[\u06f0-\u06f9]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
      .replace(/\D/g, '');
  const isLeadDelayed = (lead) => {
    if (lead?.transferredDelayed) return true;
    const phone = digitsOnly(lead?.phone);
    if (!phone) return false;
    const client = (data.crm_clients || []).find((c) => digitsOnly(c?.phone) === phone);
    if (client?.nextActionAt && Date.parse(String(client.nextActionAt)) <= now) return true;
    const openRems = (data.crm_reminders || []).filter(
      (r) => r && !r.isCompleted && digitsOnly(r.clientPhone) === phone
    );
    for (const r of openRems) {
      const dueMs = Date.parse(String(r.dateTime || ''));
      if (r.isDelayed || (Number.isFinite(dueMs) && dueMs <= now)) {
        const since = Date.parse(String(r.createdAt || '')) || dueMs;
        const hasCallAfter = (data.crm_call_logs || []).some(
          (l) => digitsOnly(l?.clientPhone) === phone && Date.parse(String(l?.createdAt || '')) > since
        );
        const hasCommentAfter =
          Array.isArray(client?.activities) &&
          client.activities.some((a) => {
            const t = String(a?.type || '').toLowerCase();
            if (t === 'assign' || t === 'created') return false;
            return Date.parse(String(a?.at || a?.createdAt || '')) > since;
          });
        if (!hasCallAfter && !hasCommentAfter) return true;
      }
    }
    return false;
  };
  const isLeadTransferred = (lead, target) => {
    if (lead?.transferredFrom && String(lead.transferredFrom) !== String(target)) return true;
    if (lead?.transferredAt) return true;
    return Object.keys(state.leads || {}).some(
      (k) => k.startsWith(`${lead.id}|`) && k !== `${lead.id}|${target}`
    );
  };
  for (const lead of data.crm_assigned_leads || []) {
    if (!lead?.id) continue;
    const owner = String(lead.salesId || '').trim();
    if (!owner) continue; // غير موزّع: مفيش إشعار (الإدارة بتشوف الأرقام في «توزيع الأرقام»)
    const prevSent = Number(state.leads[`${lead.id}|${owner}`]) || 0;
    const reAssignedAt = Date.parse(lead.transferredAt || lead.assignedAt || '');
    if (prevSent && (!lead.transferredAt || !Number.isFinite(reAssignedAt) || reAssignedAt <= prevSent)) continue;
    const stamp = lead.assignedAt || lead.createdAt;
    const at = Date.parse(stamp || '');
    if (!Number.isFinite(at) || now - at > RECENT_MS) continue;
    pendingLeads.push({ lead, target: owner });
  }
  if (pendingLeads.length) {
    const byTarget = new Map();
    for (const { lead, target } of pendingLeads) {
      if (!byTarget.has(target)) byTarget.set(target, []);
      byTarget.get(target).push(lead);
    }
    for (const [target, leads] of byTarget) {
      const one = leads[0];
      const form = one?.formName ? ` • ${one.formName}` : '';
      const delayedLeads = leads.filter((l) => isLeadDelayed(l));
      const transferredLeads = leads.filter((l) => isLeadTransferred(l, target) || isLeadDelayed(l));
      const title = delayedLeads.length
        ? leads.length === 1
          ? '⚠️ رقم ديلاي اتنقل ليك'
          : `⚠️ ${leads.length} أرقام اتنقلت ليك (${delayedLeads.length} ديلاي)`
        : transferredLeads.length
        ? leads.length === 1
          ? '🔄 في رقم اتنقل ليك'
          : `🔄 ${leads.length} أرقام اتنقلت ليك`
        : leads.length === 1
        ? '🆕 رقم فريش جديد نزل ليك'
        : `🆕 ${leads.length} أرقام فريش جديدة نزلت ليك`;
      const body =
        leads.length === 1
          ? delayedLeads.length
            ? `رقم ديلاي (متأخر) اتنقل ليك: ${one?.name || 'عميل'} — ${one?.phone || ''}${form}`
            : transferredLeads.length
            ? `تم نقل رقم ليك: ${one?.name || 'عميل'} — ${one?.phone || ''}${form}`
            : `${one?.name || 'عميل'} — ${one?.phone || ''}${form}`
          : `${leads
              .slice(0, 3)
              .map((l) => `${l?.name || 'عميل'} ${l?.phone || ''}`.trim())
              .join(' • ')}${leads.length > 3 ? ` +${leads.length - 3}` : ''}${
              form ||
              (leads.find((l) => l?.formName)
                ? ` • ${leads.find((l) => l?.formName).formName}`
                : '')
            }`;
      const payload = {
        kind: 'lead',
        title,
        body,
        tag: `lead-${one?.id || Date.now()}`,
        url: '/',
      };
      const delivered = await push(target, payload);
      if (!delivered) continue; // لا أجهزة/فشل مؤقت: يُعاد في الدورة القادمة بلا ضياع
      for (const lead of leads) state.leads[`${lead.id}|${target}`] = now;
      leadCount += leads.length;
      changed = true;
    }
  }

  // نحفظ دائمًا وقت التشغيل ونتيجته (ولو لم يُرسل شيئاً) حتى يعرف المستخدم
  // من شاشة التشخيص أن المُشغّل يعمل فعلاً وأن المشكلة في الاشتراك أو الصلاحية.
  try {
    await saveState({
      reminders: prune(state.reminders),
      messages: prune(state.messages),
      alerts: prune(state.alerts),
      leads: prune(state.leads),
      lastRunAt: now,
      lastResult: { sent, reminders: reminderCount, messages: messageCount, alerts: alertCount, leads: leadCount, changed },
    });
  } catch (error) {
    logger.warn?.('[push] تعذّر حفظ حالة الإرسال:', String(error?.message || error));
  }

  return { sent, reminders: reminderCount, messages: messageCount, alerts: alertCount, leads: leadCount };
}

// ---------- مسبار للسيرفر المحلي: ملفات JSON + setInterval ----------
// auth اختياري: متغيّرات البيئة التي فيها AUTH_SECRET.
// عند تمريره تصبح كل نقاط الإشعارات مقفلة على الحسابات المسجّلة، واشتراك أي حساب
// يُقيَّد بصاحبه — فلا يمكن لأي زائر أن يشترك ليستلم إشعارات تحمل أسماء وأرقام العملاء.
export function createPushHandler({ storeFile, vapidFile, stateFile, auth = null, logger = console }) {
  const keys = loadOrCreateVapid(vapidFile);
  const getKeys = async () => keys;
  const loadDb = async () => {
    const db = readJson(storeFile, { version: 0, data: {} });
    return { version: Number(db.version) || 0, data: db.data || {} };
  };
  const saveDb = async (data, version) => writeJson(storeFile, { version, data });
  const stateStore = fileJsonStore(stateFile, { reminders: {}, messages: {} });
  const { handler, pushToUser } = buildPushHandler({ getKeys, loadDb, saveDb, stateStore, auth, logger });
  return { handler, pushToUser, publicKey: keys.publicKey };
}

export function startPushLoop({ storeFile, vapidFile, stateFile, intervalMs = 60000, logger = console, loadAlerts = null }) {
  const keys = loadOrCreateVapid(vapidFile);
  const getKeys = async () => keys;
  const loadDb = async () => {
    const db = readJson(storeFile, { version: 0, data: {} });
    return { version: Number(db.version) || 0, data: db.data || {} };
  };
  const saveDb = async (data, version) => writeJson(storeFile, { version, data });
  const stateStore = fileJsonStore(stateFile, { reminders: {}, messages: {} });

  const tick = async () => {
    // تنبيهات النظام (انتهاء توكن السحب) تُحسب في كل دورة من إعدادات القناة
    let alerts = [];
    if (loadAlerts) {
      try {
        alerts = (await loadAlerts()) || [];
      } catch (error) {
        logger.warn?.('[push] فشل حساب تنبيهات النظام:', String(error?.message || error));
      }
    }
    return processPushTick({
      getKeys,
      loadDb,
      saveDb,
      loadState: stateStore.load,
      saveState: stateStore.save,
      logger,
      systemAlerts: alerts,
    });
  };

  const timer = setInterval(() => {
    tick().catch((error) => logger.warn?.('[push]', String(error?.message || error)));
  }, intervalMs);
  tick().catch(() => {});
  return () => clearInterval(timer);
}

// ---------- مسبار الاستضافة: قاعدة بيانات مشتركة ----------
// نفس المنطق تماماً، لكن الاشتراكات والتذكيرات وحالة الإرسال ومفاتيح VAPID كلها
// في القاعدة المشتركة — فلا تضيع مع الاستدعاء البارد ولا تحتاج ملفاً على القرص.
export async function createPushHandlerFromStore({ storage, vapidStore, stateStore = null, auth = null, logger = console }) {
  const getKeys = createVapidAccessor(vapidStore);
  const loadDb = () => storage.load();
  const saveDb = (data, version) => storage.save({ version, data });
  const { handler, pushToUser } = buildPushHandler({ getKeys, loadDb, saveDb, stateStore, auth, logger });
  return { handler, pushToUser };
}

// معالجة واحدة تُستدعى من المُشغّل الدوري (cron) على الاستضافة:
// ترسل التذكيرات المستحقة ورسائل الشات وتنبيهات النظام مرة واحدة ثم تنتهي (بلا setInterval).
export async function processPushesOnce({ storage, vapidStore, stateStore, logger = console, systemAlerts = [] }) {
  const getKeys = createVapidAccessor(vapidStore);
  const loadDb = () => storage.load();
  const saveDb = (data, version) => storage.save({ version, data });
  return processPushTick({ getKeys, loadDb, saveDb, loadState: stateStore.load, saveState: stateStore.save, logger, systemAlerts });
}
