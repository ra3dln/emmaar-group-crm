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
export async function sendPush(subscription, payload, keys, subject = 'mailto:crm@emmagroup.local') {
  const data = Buffer.from(JSON.stringify(payload));
  const body = encryptPayload(subscription, data);
  const { jwt, publicKey } = vapidHeader(subscription.endpoint, keys, subject);
  const res = await fetch(subscription.endpoint, {
    method: 'POST',
    headers: {
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: '900',
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
function buildPushHandler({ getKeys, loadDb, saveDb, auth = null, logger = console }) {
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
          title: '🔔 إشعار تجريبي — إعمار جروب',
          body: 'لو وصلتك الرسالة دي فالموقع شغّال كأنه تطبيق على جهازك ✓',
          tag: `test-${Date.now()}`,
          url: '/',
        });
        return send(res, 200, { ok: result.sent > 0, ...result });
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

async function processPushTick({ getKeys, loadDb, saveDb, loadState, saveState, logger = console }) {
  const keys = await getKeys();
  const db = await loadDb();
  const data = db.data || {};
  const subs = data.crm_push_subs || [];
  if (!subs.length) return { sent: 0, reminders: 0, messages: 0 };

  const state = (await loadState()) || { reminders: {}, messages: {} };
  state.reminders = state.reminders || {};
  state.messages = state.messages || {};
  const now = Date.now();
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
      url: `/#alarm=${reminder.id}`,
    });
    if (!delivered) continue; // لا أجهزة/فشل مؤقت: يُعاد في الدورة القادمة بلا ضياع
    state.reminders[reminder.id] = now;
    reminderCount += 1;
    changed = true;
  }

  // ٢) رسائل الشات الجديدة
  let messageCount = 0;
  for (const message of data.crm_messages || []) {
    if (state.messages[message.id]) continue;
    const sentAt = Date.parse(message.createdAt || '');
    if (Number.isNaN(sentAt) || now - sentAt > RECENT_MS) continue;
    const delivered = await push(message.toId, {
      kind: 'message',
      title: `💬 رسالة من ${message.fromName || 'الإدارة'}`,
      body: String(message.text || '').slice(0, 160),
      tag: `message-${message.id}`,
      url: '/',
    });
    if (!delivered) continue;
    state.messages[message.id] = now;
    messageCount += 1;
    changed = true;
  }

  if (changed) {
    // تنظيف السجل القديم حتى لا يكبر بلا حدود
    const prune = (map) => {
      const out = {};
      for (const [key, value] of Object.entries(map || {})) {
        if (now - Number(value) < 7 * 24 * 60 * 60 * 1000) out[key] = value;
      }
      return out;
    };
    try {
      await saveState({ reminders: prune(state.reminders), messages: prune(state.messages) });
    } catch (error) {
      logger.warn?.('[push] تعذّر حفظ حالة الإرسال:', String(error?.message || error));
    }
  }

  return { sent, reminders: reminderCount, messages: messageCount };
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
  const { handler, pushToUser } = buildPushHandler({ getKeys, loadDb, saveDb, auth, logger });
  return { handler, pushToUser, publicKey: keys.publicKey };
}

export function startPushLoop({ storeFile, vapidFile, stateFile, intervalMs = 60000, logger = console }) {
  const keys = loadOrCreateVapid(vapidFile);
  const getKeys = async () => keys;
  const loadDb = async () => {
    const db = readJson(storeFile, { version: 0, data: {} });
    return { version: Number(db.version) || 0, data: db.data || {} };
  };
  const saveDb = async (data, version) => writeJson(storeFile, { version, data });
  const stateStore = fileJsonStore(stateFile, { reminders: {}, messages: {} });

  const tick = () =>
    processPushTick({
      getKeys,
      loadDb,
      saveDb,
      loadState: stateStore.load,
      saveState: stateStore.save,
      logger,
    });

  const timer = setInterval(() => {
    tick().catch((error) => logger.warn?.('[push]', String(error?.message || error)));
  }, intervalMs);
  tick().catch(() => {});
  return () => clearInterval(timer);
}

// ---------- مسبار الاستضافة: قاعدة بيانات مشتركة ----------
// نفس المنطق تماماً، لكن الاشتراكات والتذكيرات وحالة الإرسال ومفاتيح VAPID كلها
// في القاعدة المشتركة — فلا تضيع مع الاستدعاء البارد ولا تحتاج ملفاً على القرص.
export async function createPushHandlerFromStore({ storage, vapidStore, auth = null, logger = console }) {
  const getKeys = createVapidAccessor(vapidStore);
  const loadDb = () => storage.load();
  const saveDb = (data, version) => storage.save({ version, data });
  const { handler, pushToUser } = buildPushHandler({ getKeys, loadDb, saveDb, auth, logger });
  return { handler, pushToUser };
}

// معالجة واحدة تُستدعى من المُشغّل الدوري (cron) على الاستضافة:
// ترسل التذكيرات المستحقة ورسائل الشات مرة واحدة ثم تنتهي (بلا setInterval).
export async function processPushesOnce({ storage, vapidStore, stateStore, logger = console }) {
  const getKeys = createVapidAccessor(vapidStore);
  const loadDb = () => storage.load();
  const saveDb = (data, version) => storage.save({ version, data });
  return processPushTick({ getKeys, loadDb, saveDb, loadState: stateStore.load, saveState: stateStore.save, logger });
}
