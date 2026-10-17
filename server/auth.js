// ===== حماية الدخول على السيرفر =====
// الهدف: **لا يستطيع أي شخص يعرف رابط الموقع قراءة بيانات العملاء**.
// لذلك البيانات لا تُقدَّم إلا لمن يملك «جلسة» موقّعة صادرة من السيرفر نفسه.
//
// كيف تعمل الجلسة:
//   1) العميل يرسل اسم المستخدم وكلمة المرور إلى /api/auth?action=login.
//   2) السيرفر يتحقق من كلمة المرور بنفس بصمة المتصفح (SHA-256 + ملح لكل حساب)
//      — فلا يحتاج أي ترحيل لكلمات المرور الموجودة، وتعمل القديمة كما هي.
//   3) السيرفر يرسل كوكي HttpOnly موقّعاً بـ HMAC-SHA256 بمفتاح AUTH_SECRET.
//      الكوكي لا يستطيع JavaScript قراءته، ولا يمكن تزويره بلا المفتاح.
//   4) كل طلب لاحق للبيانات لازم يحمل هذا الكوكي، وإلا 401.
//
// المفتاح AUTH_SECRET سيرفر فقط ولا يظهر في كود المتصفح إطلاقاً — بخلاف
// «مفتاح» يُحط في الواجهة، أي أحد يقرأ كود الصفحة لا يستطيع تزوير جلسة.

import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const COOKIE_NAME = 'crm_session';
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // ٣٠ يوماً
const MIN_SECRET_LENGTH = 16;
const HASH_PREFIX = 'sha256:';

// ===== أدوات مساعدة =====

// مقارنة بزمن ثابت (تمنع استنتاج القيم من فرق زمن الرد)
export function safeEqualStr(a, b) {
  const x = Buffer.from(String(a ?? ''), 'utf8');
  const y = Buffer.from(String(b ?? ''), 'utf8');
  if (!x.length || x.length !== y.length) return false;
  return timingSafeEqual(x, y);
}

const b64url = (input) => Buffer.from(input).toString('base64url');
const fromB64url = (value) => Buffer.from(value, 'base64url');

const secretOf = (env = {}) => String(env.AUTH_SECRET || '').trim();

// هل الحماية مضبوطة؟ بلا مفتاح طويل نرفض العمل (فشل مغلق) حتى لا تنفتح البيانات بالخطأ
export const authConfigured = (env = {}) => secretOf(env).length >= MIN_SECRET_LENGTH;

// ===== الجلسة =====

export function signSession(env, payload, ttlMs = SESSION_TTL_MS) {
  const secret = secretOf(env);
  if (secret.length < MIN_SECRET_LENGTH) throw new Error('AUTH_SECRET غير مضبوط أو قصير');
  const now = Date.now();
  const body = { ...payload, iat: now, exp: now + ttlMs };
  const data = b64url(JSON.stringify(body));
  const sig = b64url(createHmac('sha256', secret).update(data).digest());
  return `${data}.${sig}`;
}

// يرجع بيانات الجلسة لو التوقيع سليم ولم تنتهِ المدة، وإلا null
export function verifySession(env, token) {
  const secret = secretOf(env);
  if (secret.length < MIN_SECRET_LENGTH) return null;
  if (typeof token !== 'string' || !token) return null;
  const dot = token.indexOf('.');
  if (dot <= 0 || dot === token.length - 1) return null;
  const data = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = b64url(createHmac('sha256', secret).update(data).digest());
  if (!safeEqualStr(sig, expected)) return null;
  let payload = null;
  try {
    payload = JSON.parse(fromB64url(data).toString('utf8'));
  } catch {
    return null;
  }
  if (!payload || typeof payload !== 'object') return null;
  if (!payload.u || typeof payload.u !== 'string') return null;
  if (!Number.isFinite(Number(payload.exp)) || Number(payload.exp) < Date.now()) return null;
  return payload;
}

export function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const eq = part.indexOf('=');
    if (eq <= 0) continue;
    const name = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (!name) continue;
    try {
      out[name] = decodeURIComponent(value);
    } catch {
      out[name] = value;
    }
  }
  return out;
}

// جلسة الطلب الحالي — نقطة الاستخدام الوحيدة في كل نقاط البيانات
export const sessionFromRequest = (env, req) =>
  verifySession(env, parseCookies(req?.headers?.cookie)[COOKIE_NAME]);

// هل الطلب عبر HTTPS؟ (على الاستضافة نضبط Secure دائماً، ومحلياً نتركه مرناً للاختبار)
export const isSecureRequest = (req) => {
  const proto = String(req?.headers?.['x-forwarded-proto'] || '').split(',')[0].trim();
  return proto === 'https' || Boolean(process.env.VERCEL);
};

export function sessionCookie(token, { secure = true, ttlMs = SESSION_TTL_MS } = {}) {
  const maxAge = Math.max(0, Math.floor(ttlMs / 1000));
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}

export const clearSessionCookie = (secure = true) =>
  `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`;

// ===== كلمات المرور =====
// نفس صيغة المتصفح بالحرف: sha256:<ملح>:<بصمة hex> من نص «<ملح>::<كلمة المرور>»
// أي أن كل كلمات المرور المحفوظة حالياً تعمل بلا أي تغيير أو إعادة ضبط.

export const isHashedPassword = (value) => typeof value === 'string' && value.startsWith(HASH_PREFIX);

export function hashPassword(plain, salt) {
  const s = salt || randomBytes(8).toString('hex'); // ١٦ حرفاً
  const digest = createHash('sha256').update(`${s}::${plain}`, 'utf8').digest('hex');
  return `${HASH_PREFIX}${s}:${digest}`;
}

// يتحقق من كلمة المرور: بصمة مشفّرة (مع ملح) أو كلمة محفوظة نصاً صريحاً
// (الكلمات النصية هي ما تضبطه الإدارة من النظام وتراه في حسابات السيلز)
export function verifyPassword(plain, stored) {
  if (typeof stored !== 'string' || !stored) return { ok: false };
  if (!isHashedPassword(stored)) {
    return { ok: safeEqualStr(stored, plain) };
  }
  const rest = stored.slice(HASH_PREFIX.length);
  const sep = rest.indexOf(':');
  if (sep <= 0) return { ok: false };
  const salt = rest.slice(0, sep);
  return { ok: safeEqualStr(hashPassword(plain, salt), stored) };
}

// ===== حماية بيانات المستخدمين =====
export const isManagerRole = (role) => role === 'admin' || role === 'supervisor';

// رقم إصدار جلسات الحساب: يزيد عند الخروج أو تغيير كلمة المرور،
// فتسقط كل الكوكيز القديمة فوراً ولا يمكن استخدام جلسة مسروقة بعدها.
// السيرفر وحده يملك هذا الحقل: لا يُرسل للمتصفح ولا يُقبل منه.
export const sessionVersionOf = (user) => Number(user?.sessionVersion) || 0;

// نسخة آمنة تُرسل للمتصفح: بلا كلمة المرور وبلا إصدار الجلسة إطلاقاً
export function publicUser(user) {
  if (!user || typeof user !== 'object') return null;
  const { password, sessionVersion, ...rest } = user;
  return rest;
}

// يحذف أسرار السيرفر من قائمة المستخدمين داخل كتلة البيانات المرسلة للمتصفح:
// رقم إصدار الجلسة لا يخرج أبداً، وكلمات المرور لا تُرى إلا من حساب الإدارة
// (صلاحية «تشوف باسورد حسابات السيلز» طُلبت صراحةً ومقيدة برتبة admin وحدها)
export function stripUserSecrets(data, { keepPasswords = false } = {}) {
  const out = { ...(data || {}) };
  if (Array.isArray(out.crm_users)) {
    out.crm_users = out.crm_users.map((u) => {
      if (!u || typeof u !== 'object') return u;
      const { password, sessionVersion, ...rest } = u;
      return keepPasswords && typeof password === 'string' ? { ...rest, password } : rest;
    });
  }
  return out;
}

// هل الجلسة ما زالت صالحة بالنسبة لبيانات المستخدمين الحالية؟
// يُفحَص بعد قراءة القاعدة (القراءة تتم أصلاً في كل طلب بيانات).
export function sessionMatchesUsers(session, data) {
  if (!session) return false;
  const users = Array.isArray(data?.crm_users) ? data.crm_users : [];
  // لا يوجد أي حساب بعد (إعادة ضبط / أول تشغيل): نسمح فقط لاستعادة الحسابات
  if (!users.length) return true;
  const user = users.find((u) => u && String(u.id) === String(session.u));
  if (!user || user.isActive === false) return false;
  return sessionVersionOf(user) === (Number(session.sv) || 0);
}

// عند الكتابة: **الإدارة (رتبة admin) وحدها تستطيع تغيير كلمة مرور أي حساب** من النظام،
// وتُحفظ الكلمة كما أُرسلت (نصاً صريحاً تراها الإدارة، أو بصمة إن كانت الأصلية مشفّرة).
// أي كتابة من حساب آخر تُهمل تماماً لكلمة المرور: تبقى المحفوظة على السيرفر كما هي —
// فلا يستطيع مندوب (أو طلب مُصنَّع من DevTools) إعادة تعيين أي كلمة مرور.
//
// الحالات (مهمة جداً كي لا يُقفل النظام ولا يبقى فيه باب خلفي):
//  ١) حساب موجود + الإدارة ترسل كلمة جديدة  => تُحفظ كما أُرسلت (تغيير مقصود)
//  ٢) حساب موجود + بلا كلمة في الطلب        => تبقى المحفوظة (لا يقفل أحد حسابه بالخطأ)
//  ٣) حساب جديد بكلمة مرور                  => تُقبل مرة واحدة كما أُرسلت
//  ٤) إصدار الجلسة                           => من السيرفر فقط أبداً (فلا تُحيى جلسة أسقطها الخروج)
//
// تغيير كلمة المرور بالإدارة من نموذج «تعديل الحساب» في الواجهة؛ ولمن يحب سطر الأوامر:
//   node scripts/set-password.mjs --user admin
// أو تغيير كلمة المرور الخاصة بنفس الحساب (server/authApi.js: action=change-password).
export function preserveUserPasswords(incoming, existing, { canManage = false } = {}) {
  if (!Array.isArray(incoming)) return incoming;
  const byId = new Map();
  for (const user of Array.isArray(existing) ? existing : []) {
    if (user && user.id) byId.set(String(user.id), user);
  }
  return incoming.map((user) => {
    if (!user || typeof user !== 'object') return user;
    const previous = byId.get(String(user.id));
    const { password, sessionVersion, ...rest } = user;
    const incomingPassword = typeof password === 'string' && password.trim() ? password : '';
    // حساب موجود: الإدارة تغيّر عند الإرسال كلمة، وغيرها تبقى المحفوظة — وإصداق الجلسة من السيرفر
    if (previous) {
      const kept = previous.sessionVersion !== undefined ? { sessionVersion: Number(previous.sessionVersion) || 0 } : {};
      const previousPassword = typeof previous.password === 'string' ? previous.password : '';
      if (canManage && incomingPassword) return { ...rest, ...kept, password: incomingPassword };
      return previousPassword ? { ...rest, ...kept, password: previousPassword } : { ...rest, ...kept };
    }
    // حساب جديد: تُقبل كلمة مروره مرة واحدة كما أُرسلت
    return incomingPassword ? { ...rest, password: incomingPassword } : rest;
  });
}

// يزيد إصدار جلسات حساب واحد => كل الكوكيز القديمة لهذا الحساب تسقط فوراً
// يُستخدم عند الخروج وعند تغيير كلمة المرور (فلا تبقى جلسة مسروقة صالحة).
export function bumpSessionVersion(users, userId) {
  if (!Array.isArray(users)) return users;
  return users.map((u) =>
    u && String(u.id) === String(userId) ? { ...u, sessionVersion: sessionVersionOf(u) + 1 } : u
  );
}

// ===== كلمات المرور الضعيفة =====
// كلمة المرور الافتراضية للحساب (admin123) معروفة لأي شخص، ولو بقيت كما هي
// فكل الحماية بلا قيمة: يكفي أن يعرف أحدهم رابط الموقع ويجرّبها فيدخل.
// لذلك: أي حساب بكلمة مرور ضعيفة يُدخل صاحبه **مجبَراً** على تغييرها قبل أن تُفتح البيانات.
const WEAK_PASSWORDS = new Set([
  'admin123',
  'admin',
  '123456',
  '1234567',
  '12345678',
  '123456789',
  '1234567890',
  '12345',
  '1234',
  'password',
  'passw0rd',
  'qwerty',
  'abc123',
  '111111',
  '000000',
  '123123',
  'admin12',
  'emmar',
  'emaar123',
]);

export const isWeakPassword = (plain) => {
  const p = String(plain ?? '').trim().toLowerCase();
  return p.length < 6 || WEAK_PASSWORDS.has(p);
};

// أقل طول مقبول عند تغيير كلمة المرور
const MIN_PASSWORD_LENGTH = 8;

export function passwordProblem(plain) {
  const p = String(plain ?? '');
  if (p.length < MIN_PASSWORD_LENGTH) return `كلمة المرور قصيرة — ${MIN_PASSWORD_LENGTH} أحرف على الأقل`;
  if (isWeakPassword(p)) return 'كلمة المرور شائعة جداً — اختر كلمة مرور مختلفة';
  if (!/[A-Za-z\u0600-\u06FF]/.test(p) || !/[0-9]/.test(p)) return 'اختر كلمة مرور فيها حروف وأرقام';
  return '';
}
