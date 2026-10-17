// ===== نقطة الدخول على الاستضافة (Vercel) =====
// الجهة الوحيدة التي تُصدر «جلسة» تفتح بيانات العملاء:
//   POST /api/auth?action=login            { username, password, loginType }
//   GET  /api/auth?action=me               => المستخدم الحالي (أو 401)
//   POST /api/auth?action=logout           => إنهاء الجلسة
//   POST /api/auth?action=change-password  { currentPassword, newPassword }
//
// المنطق نفسه موجود في server/authApi.js ويُستخدم أيضاً على سيرفر المكتب
// (vite.config.js) حتى تكون الحماية واحدة في المكانين بلا أي فرق.

import { createAuthHandler } from '../server/authApi.js';
import { redisStorage } from '../server/store.js';
import { supabaseStorage } from '../server/supabase.js';

// نفضّل Supabase لو مضبوط، وإلا Redis — نفس الواجهة تماماً
const supa = supabaseStorage(process.env);
const redis = redisStorage(process.env);
const storage = supa.configured ? supa : redis;

export default createAuthHandler({ storage, env: process.env });
