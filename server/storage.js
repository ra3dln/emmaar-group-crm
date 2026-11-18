// ===== اختيار مخزن البيانات في مكان واحد =====
// النظام كان يختار في كل ملف على حدة: «Supabase لو مضبوط وإلا Redis».
// بعد ما Supabase وقّفت الخدمة (تجاوز حد النقل) بقى فيه بديل ثالث: Cloudflare D1.
//
// الأفضلية: D1 ← Supabase ← Redis — وأول مخزون **مضبوط فعلاً** هو المستخدم،
// ويُختار مرة واحدة لكل نقطة نهاية حتى لا يحدث خلط (بيانات في D1 وإعدادات في Redis).
//
// إضافة أي مخزن جديد بعد كده: تكتب ملف بنفس الواجهة (configured/load/loadVersion/save)
// + jsonStore، وتضيفه في القائمة هنا فقط.

import { d1JsonStore, d1Storage, d1Configured } from './d1.js';
import { redisJsonStore, redisStorage } from './store.js';
import { supabaseJsonStore, supabaseStorage } from './supabase.js';

const PROVIDERS = [
  {
    name: 'd1',
    storage: (env) => d1Storage(env),
    jsonStore: (env, key) => d1JsonStore(env, key),
    ready: (env) => d1Configured(env),
  },
  {
    name: 'supabase',
    storage: (env) => supabaseStorage(env),
    jsonStore: (env, key) => supabaseJsonStore(env, key),
    ready: (env) => supabaseStorage(env).configured,
  },
  {
    name: 'redis',
    storage: (env) => redisStorage(env),
    jsonStore: (env, key) => redisJsonStore(env, key),
    ready: (env) => redisStorage(env).configured,
  },
];

// أول مخزون مضبوط. لو مفيش أي واحد: نرجّع الأخير (غير مضبوط) فيشتغل النظام
// محلياً على الجهاز وترجع 503 برسالة واضحة بدل انهيار.
export function activeProvider(env = process.env) {
  return PROVIDERS.find((p) => p.ready(env)) || PROVIDERS[PROVIDERS.length - 1];
}

export function pickStorage(env = process.env) {
  return activeProvider(env).storage(env);
}

export function pickJsonStore(env = process.env, key = 'crm:lead-source:config') {
  return activeProvider(env).jsonStore(env, key);
}

export function activeProviderName(env = process.env) {
  return activeProvider(env).name;
}

// رسالة واحدة لكل النقاط لما مفيش قاعدة بيانات — تذكر البدائل الثلاثة
export const NO_DATABASE_HINT =
  'قاعدة البيانات غير مضبوطة — أضف Cloudflare D1 (D1_ACCOUNT_ID + D1_DATABASE_ID + D1_API_TOKEN) أو Supabase (SUPABASE_URL + SUPABASE_SECRET_KEY) أو Upstash Redis من لوحة Vercel ثم أعد النشر لتعمل المزامنة المشتركة.';
