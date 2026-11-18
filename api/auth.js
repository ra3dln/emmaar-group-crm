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
import { pickStorage } from '../server/storage.js';

// نفس اختيار باقي النقاط: D1 ← Supabase ← Redis (server/storage.js)
const storage = pickStorage(process.env);

export default createAuthHandler({ storage, env: process.env });
