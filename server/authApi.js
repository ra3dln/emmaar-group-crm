// ===== منطق نقاط الدخول (مشترك بين الاستضافة والسيرفر المحلي) =====
// نفس الكود يعمل في المكانين حتى تكون الحماية واحدة تماماً:
//   على Vercel      : api/auth.js  => تخزين Supabase/Redis
//   على سيرفر المكتب: vite.config.js => تخزين ملف JSON المحلي
//
//   POST ?action=login            { username, password, loginType }
//   GET  ?action=me               => المستخدم الحالي (أو 401)
//   POST ?action=logout           => إنهاء الجلسة
//   POST ?action=change-password  { currentPassword, newPassword }
//
// ملاحظات مهمة:
//  - كلمة المرور تُتحقق **على السيرفر**؛ الكلمات المحفوظة نصاً صريحاً أو مشفّرة بالبصمة
//    كلاهما يعمل — فالحسابات الحالية تعمل بلا إعادة ضبط.
//  - **الإدارة تدير كلمات المرور من النظام**: تعديل حساب من الشاشة يعرض كلمة المرور
//    للـ CEO ويسمح بتعيين واحدة جديدة، وأي تغيير من حساب آخر يُهمل على السيرفر.
//  - **لا يوجد أي إلزام لتغيير كلمة المرور**: من دخل بكلمة صحيحة يعمل مباشرة،
//    ولو كانت كلمة المرور الافتراضية admin123 فهي تعمل كما هي.
//  - محاولات الدخول محدودة لكل IP حتى لا يمكن تخمين كلمة المرور بالتجربة المتكررة.

import {
  authConfigured,
  bumpSessionVersion,
  clearSessionCookie,
  isManagerRole,
  isSecureRequest,
  passwordProblem,
  publicUser,
  sessionCookie,
  sessionFromRequest,
  sessionVersionOf,
  signSession,
  verifyPassword,
} from './auth.js';
// حكم «مين صاحب النظام» — نفس الملف في الواجهة، فيبقى الحكم واحداً في المكانين
import { isOwnerAccount } from '../shared/roles.js';

// حد محاولات الدخول (يمنع تخمين كلمة المرور)
const ATTEMPT_WINDOW_MS = 10 * 60_000;
const MAX_ATTEMPTS = 12;
const attempts = new Map();

const clientIp = (req) =>
  String(
    (req.headers && (req.headers['x-forwarded-for'] || req.headers['x-real-ip'])) ||
      req.socket?.remoteAddress ||
      'unknown'
  )
    .split(',')[0]
    .trim();

const tooManyAttempts = (req, username) => {
  const key = `${clientIp(req)}:${username}`;
  const now = Date.now();
  const bucket = attempts.get(key);
  if (!bucket || now - bucket.start > ATTEMPT_WINDOW_MS) {
    attempts.set(key, { start: now, count: 1 });
    if (attempts.size > 5000) {
      for (const [k, v] of attempts) if (now - v.start > ATTEMPT_WINDOW_MS) attempts.delete(k);
    }
    return false;
  }
  bucket.count += 1;
  return bucket.count > MAX_ATTEMPTS;
};

const clearAttempts = (req, username) => attempts.delete(`${clientIp(req)}:${username}`);

const reply = (res, status, payload) => {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
};

const readBody = (req) =>
  new Promise((resolve) => {
    if (req.body !== undefined && req.body !== null) {
      if (typeof req.body === 'object') return resolve(req.body);
      try {
        return resolve(JSON.parse(req.body));
      } catch {
        return resolve(null);
      }
    }
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 64 * 1024) req.destroy();
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

export function createAuthHandler({ storage, env = process.env }) {
  // الجلسة والكوكي + ما يحتاجه المتصفح.
  // لا يوجد أي إلزام بتغيير كلمة المرور: من يدخل بكلمة مرور صحيحة يُفتح له مباشرة.
  const grantSession = (res, req, user) => {
    const token = signSession(env, {
      u: user.id,
      r: user.role,
      n: user.username,
      sv: sessionVersionOf(user),
      // علامة صاحب النظام (أعلى صلاحية) — تُحفظ في الجلسة فيبقى قانوناً
      // حتى لو رتبته المخزَّنة اتغيّرت في نسخة قديمة من أي جهاز
      o: isOwnerAccount(user) ? 1 : 0,
    });
    res.setHeader('Set-Cookie', sessionCookie(token, { secure: isSecureRequest(req) }));
    return reply(res, 200, { ok: true, user: publicUser(user) });
  };

  return async function handle(req, res) {
    try {
      const [path, query] = (req.url || '').split('?');
      if (path !== '/api/auth' && path !== '/api/auth/') {
        return reply(res, 404, { ok: false, error: 'not found' });
      }

      const action =
        (new URLSearchParams(query || '').get('action') || '').trim() || (req.method === 'GET' ? 'me' : '');

      // الحماية نفسها غير مضبوطة: نفشل بوضوح بدل أن نترك البيانات مفتوحة
      if (!authConfigured(env)) {
        return reply(res, 503, {
          ok: false,
          error: 'لم يُضبط AUTH_SECRET',
          hint: 'أضف متغيّر البيئة AUTH_SECRET (نص عشوائي طويل ٣٢ حرفاً) ثم أعد النشر/التشغيل.',
        });
      }

      if (!storage.configured) {
        return reply(res, 503, {
          ok: false,
          error: 'قاعدة البيانات غير مضبوطة',
          hint: 'أضف Supabase (SUPABASE_URL + SUPABASE_SECRET_KEY) ثم أعد النشر.',
        });
      }

      // ===== إنهاء الجلسة =====
      // الخروج يمسح كوكي **هذا الجهاز وحده**. قبل ذلك كان يرفع إصدار جلسات
      // الحساب، فأي خروج من الموبايل يسقط جلسة المكتب وتظهر «خروج تلقائي» على
      // أجهزة أخرى. إسقاط كل الأجهزة يبقى لتغيير كلمة المرور فقط (وهو المقصود).
      if (action === 'logout') {
        if (req.method !== 'POST') return reply(res, 405, { ok: false, error: 'method not allowed' });
        res.setHeader('Set-Cookie', clearSessionCookie(isSecureRequest(req)));
        return reply(res, 200, { ok: true });
      }

      // ===== المستخدم الحالي =====
      if (action === 'me') {
        const session = sessionFromRequest(env, req);
        if (!session) return reply(res, 401, { ok: false, error: 'لا توجد جلسة' });
        const db = await storage.load();
        const users = Array.isArray(db.data?.crm_users) ? db.data.crm_users : [];
        const user = users.find((u) => u && String(u.id) === String(session.u));
        const stale = user && sessionVersionOf(user) !== (Number(session.sv) || 0);
        if (!user || user.isActive === false || stale) {
          res.setHeader('Set-Cookie', clearSessionCookie(isSecureRequest(req)));
          return reply(res, 401, { ok: false, error: 'الحساب غير موجود أو موقوف أو انتهت الجلسة' });
        }
        // تجديد انزلاقي: كل فتح للتطبيق يعيد ضبط مدة الجلسة ١٨٠ يوماً من جديد،
        // فالجهاز الذي يُستخدم لا ينتهي أبداً، ولا يُطلب من صاحبه دخول مفاجئ.
        res.setHeader('Set-Cookie', sessionCookie(
          signSession(env, { u: user.id, r: user.role, n: user.username, sv: sessionVersionOf(user), o: isOwnerAccount(user) ? 1 : 0 }),
          { secure: isSecureRequest(req) }
        ));
        return reply(res, 200, { ok: true, user: publicUser(user) });
      }

      // ===== تغيير كلمة المرور (إجباري للحسابات الضعيفة) =====
      if (action === 'change-password') {
        if (req.method !== 'POST') return reply(res, 405, { ok: false, error: 'method not allowed' });
        const session = sessionFromRequest(env, req);
        if (!session) return reply(res, 401, { ok: false, error: 'لا توجد جلسة — سجّل الدخول أولاً' });

        const body = await readBody(req);
        const current = String(body?.currentPassword || '');
        const next = String(body?.newPassword || '');
        const problem = passwordProblem(next);
        if (problem) return reply(res, 400, { ok: false, error: problem });

        const db = await storage.load();
        const users = Array.isArray(db.data?.crm_users) ? db.data.crm_users : [];
        const user = users.find((u) => u && String(u.id) === String(session.u));
        if (!user || user.isActive === false) return reply(res, 401, { ok: false, error: 'الحساب غير موجود أو موقوف' });

        const check = verifyPassword(current, user.password);
        if (!check.ok) return reply(res, 401, { ok: false, error: 'كلمة المرور الحالية غير صحيحة' });

        // كلمة مرور جديدة تُحفظ كما أُرسلت (نصاً تراها الإدارة في حسابات السيلز)
        // + إسقاط كل الجلسات القديمة (فمن كان يعرف الكلمة القديمة يفقد الوصول).
        // ملاحظة: هذا كود سيرفر موثوق، فلا يمرّ على preserveUserPasswords
        // (التي تمنع غير الإدارة من تغيير كلمات المرور).
        const nextUsers = bumpSessionVersion(
          users.map((u) => (u && String(u.id) === String(user.id) ? { ...u, password: next } : u)),
          user.id
        );
        await storage.save({
          version: (Number(db.version) || 0) + 1,
          data: { ...(db.data || {}), crm_users: nextUsers },
        });
        clearAttempts(req, String(user.username || '').toLowerCase());
        return grantSession(res, req, nextUsers.find((u) => String(u.id) === String(user.id)) || user);
      }

      // ===== تسجيل الدخول =====
      if (action === 'login') {
        if (req.method !== 'POST') return reply(res, 405, { ok: false, error: 'method not allowed' });

        const body = await readBody(req);
        if (!body || typeof body !== 'object') return reply(res, 400, { ok: false, error: 'طلب غير صالح' });

        const username = String(body.username || '').trim().toLowerCase();
        const password = String(body.password || '');
        const loginType = body.loginType === 'admin' ? 'admin' : 'sales';
        if (!username || !password) return reply(res, 400, { ok: false, error: 'أدخل اسم المستخدم وكلمة المرور' });

        if (tooManyAttempts(req, username)) {
          res.setHeader('Retry-After', '600');
          return reply(res, 429, { ok: false, error: 'محاولات كثيرة — انتظر عشر دقائق ثم حاول مرة أخرى' });
        }

        const db = await storage.load();
        const users = Array.isArray(db.data?.crm_users) ? db.data.crm_users : [];
        // البوابة (إدارة / مندوب) اختيار واجهة فقط، والرتبة هي التي تحدد ما يُرى.
        // لذلك حساب المندوب لا يدخل من بوابة الإدارة، بينما حساب الإدارة وقائد الفريق
        // يدخل من أي بوابة — حتى لا يظل أحد يجرّب ويقول «حسابي مش شغّال» وهو محق.
        const candidate = users.find(
          (u) =>
            u &&
            String(u.username || '').trim().toLowerCase() === username &&
            u.isActive !== false &&
            (loginType === 'admin'
              ? isManagerRole(u.role) || isOwnerAccount(u)
              : u.role === 'sales' || isManagerRole(u.role) || isOwnerAccount(u))
        );

        const check = candidate ? verifyPassword(password, candidate.password) : { ok: false };
        if (!candidate || !check.ok) {
          // نفس الرسالة في كل الحالات: لا نكشف إن كان الاسم موجوداً أم لا
          return reply(res, 401, { ok: false, error: 'اسم المستخدم أو كلمة المرور غير صحيحة' });
        }

        clearAttempts(req, username);

        return grantSession(res, req, candidate);
      }

      return reply(res, 404, { ok: false, error: 'not found' });
    } catch (error) {
      return reply(res, 500, { ok: false, error: String(error?.message || error) });
    }
  };
}
