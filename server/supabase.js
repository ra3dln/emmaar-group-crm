// ===== التخزين في Supabase (Postgres) عبر واجهة REST =====
// نفس الواجهة تماماً مثل redisStorage/redisJsonStore في server/store.js،
// لكن المفتاح/القيمة تُحفظ في جدول public.crm_kv بدل Redis.
// لا يحتاج أي مكتبة خارجية: نستخدم fetch المدمج + PostgREST.
//
// المتغيّرات:
//   SUPABASE_URL           => https://<ref>.supabase.co
//   SUPABASE_SECRET_KEY    => مفتاح السر (server-only — لا يصل للمتصفح أبداً)
//
// لماذا جدول واحد مفتاح/قيمة؟ لأن النظام كله يخزّن كائن JSON واحداً
// (crm:store:data) + رقم إصدار (crm:store:version) + إعدادات (crm:lead-source:config).
// حرفاً بحرف نفس المفاتيح المستخدمة في Redis، فالانتقال بينهما صفر تعديل على باقي الكود.

const DATA_KEY = 'crm:store:data';
const VERSION_KEY = 'crm:store:version';

// قراءة قيمة واحدة: SELECT value WHERE key = ...
// PostgREST يرجع مصفوفة صفوف [{ value }].
async function restFetch(env, pathname, options = {}) {
  const url = String(env.SUPABASE_URL || '').replace(/\/+$/, '');
  const key = String(env.SUPABASE_SECRET_KEY || '').trim();
  if (!url || !key) throw new Error('Supabase غير مضبوط — أضف SUPABASE_URL و SUPABASE_SECRET_KEY');

  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(`${url}/rest/v1/${pathname}`, {
        ...options,
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
          ...options.headers,
        },
      });
      if (res.ok) return res;
      const text = await res.text().catch(() => '');
      const isRetryable = res.status >= 500 || text.includes('57014') || res.status === 429;
      if (isRetryable && attempt < 2) {
        await new Promise((r) => setTimeout(r, 250 * (attempt + 1)));
        continue;
      }
      throw new Error(`supabase ${res.status}: ${text.slice(0, 200)}`);
    } catch (err) {
      lastErr = err;
      if (attempt < 2) {
        await new Promise((r) => setTimeout(r, 250 * (attempt + 1)));
        continue;
      }
      throw lastErr;
    }
  }
}

// عميل عام يقرأ ويكتب مفاتيح متعددة في جدول crm_kv
export function supabaseClient(env = {}) {
  const configured = Boolean(String(env.SUPABASE_URL || '').trim() && String(env.SUPABASE_SECRET_KEY || '').trim());

  // جلب عدة مفاتاح في طلب واحد (ينقص عدد الطلبات والفاتورة)
  async function getMany(keys) {
    if (!keys.length) return {};
    const filter = keys.map((k) => encodeURIComponent(k)).join(',');
    const res = await restFetch(env, `crm_kv?select=key,value&key=in.(${filter})`);
    const rows = await res.json();
    const out = {};
    for (const row of Array.isArray(rows) ? rows : []) out[row.key] = row.value;
    return out;
  }

  async function getOne(key) {
    const map = await getMany([key]);
    return map[key] ?? null;
  }

  // كل الصفوف مرة واحدة — للنقل الكامل (server/migrate.js) والتشخيص
  async function getAll() {
    const res = await restFetch(env, 'crm_kv?select=key,value');
    const rows = await res.json();
    const out = {};
    for (const row of Array.isArray(rows) ? rows : []) out[row.key] = row.value;
    return out;
  }

  // كتابة/تحديث عدة مفاتاح في طلب واحد (upsert بالحقل المركّب key)
  async function setMany(entries) {
    if (!entries.length) return;
    const body = entries.map(([key, value]) => ({ key, value, updated_at: new Date().toISOString() }));
    await restFetch(env, 'crm_kv', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(body),
    });
  }

  async function setOne(key, value) {
    await setMany([[key, value]]);
  }

  return { configured, getMany, getOne, getAll, setMany, setOne };
}

// ===== المخزن الرئيسي (نفس واجهة redisStorage) =====
export function supabaseStorage(env = {}) {
  const client = supabaseClient(env);

  return {
    configured: client.configured,
    // فحص الإصدار بمفتاح واحد فقط (الأكثر تكراراً — كل جهاز يناديه كل ثوانٍ)
    async loadVersion() {
      const version = await client.getOne(VERSION_KEY);
      return Number(version) || 0;
    },
    async load() {
      const map = await client.getMany([DATA_KEY, VERSION_KEY]);
      let data = {};
      try {
        data = map[DATA_KEY] ? map[DATA_KEY] : {};
      } catch {
        data = {};
      }
      return { version: Number(map[VERSION_KEY]) || 0, data: data && typeof data === 'object' ? data : {} };
    },
    async save(db) {
      // سقف لحجم القيمة حتى نفشل برسالة واضحة بدل صمت من القاعدة
      const payload = db.data || {};
      const size = JSON.stringify(payload).length;
      if (size > 40 * 1024 * 1024) {
        throw new Error('حجم البيانات أكبر من الحد المعقول — قلّل صور العقارات ثم أعد المحاولة');
      }
      await client.setMany([
        [DATA_KEY, payload],
        [VERSION_KEY, Number(db.version) || 0],
      ]);
    },
  };
}

// ===== تخزين كائن JSON واحد في مفتاح مستقل (مثل redisJsonStore) =====
export function supabaseJsonStore(env = {}, key = 'crm:lead-source:config') {
  const client = supabaseClient(env);
  return {
    configured: client.configured,
    async load() {
      const value = await client.getOne(key);
      return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    },
    async save(value) {
      const obj = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
      await client.setOne(key, obj);
      return obj;
    },
  };
}
