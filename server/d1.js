// ===== التخزين في Cloudflare D1 (SQLite) عبر واجهة REST =====
// نفس واجهة supabaseStorage/redisStorage بالحرف (configured / load / loadVersion / save)
// حتى يعمل باقي النظام بلا أي تفريع.
//
// ليه D1؟ Cloudflare مابتاخدش فلوس على النقل (Egress) خالص — وده اللي وقّف
// مشروع Supabase (exceed_egress_quota). الحصة المجانية: ٥ جيجا تخزين،
// ٥ مليون قراءة صف و١٠٠ ألف كتابة يومياً — أكبر من احتياج النظام بمراحل.
//
// المتغيّرات (Vercel → Settings → Environment Variables):
//   D1_ACCOUNT_ID    => Account ID من لوحة Cloudflare
//   D1_DATABASE_ID   => رقم قاعدة البيانات (D1 → Databases → crm → Database ID)
//   D1_API_TOKEN     => API Token بصلاحية D1 Edit
//
// لا تُحفظ الأسرار في الكود: كل القيم من البيئة فقط.
//
// جدول واحد مفتاح/قيمة — نفس مفاتيح Supabase/Redis حرفياً:
//   crm:store:data     => كل بيانات النظام (JSON)
//   crm:store:version  => رقم النسخة
//   crm:lead-source:config / crm:push:vapid / crm:push:state => إعدادات

// كل مفتاح من مفاتيح النظام في صف مستقل: crm:data:crm_users / crm:data:crm_clients ...
// ليه؟ D1 أقصى حجم للصف الواحد ~١ ميجا، والبيانات كلها في صف واحد كانت ~١.٩ ميجا
// فالرفع كان بيرجع 500. صف لكل مفتاح = أكبر صف عندنا ~٥٠٠ ك.ب، وأي تعديل بيكتب
// المفاتيح اللي اتغيّرت بس.
const DATA_PREFIX = 'crm:data:';
const VERSION_KEY = 'crm:store:version';
// سقف آمن للصف الواحد (D1 بيقف عند ~١ ميجا)
const MAX_ROW_BYTES = 900 * 1024;

// جدول صغير: مفتاح (نص) ← قيمة (نص JSON). يُنشأ تلقائياً أول مرة.
const TABLE_SQL =
  'CREATE TABLE IF NOT EXISTS crm_kv (key TEXT PRIMARY KEY, value TEXT NOT NULL)';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function d1Configured(env = {}) {
  return Boolean(
    String(env.D1_ACCOUNT_ID || '').trim() &&
      String(env.D1_DATABASE_ID || '').trim() &&
      String(env.D1_API_TOKEN || '').trim()
  );
}

// تنفيذ استعلام واحد على D1. يرجّع مصفوفة الصفوف الناتجة.
// إعادة محاولة قصيرة على 5xx/429 فقط (أخطاء الصلاحيات والحصص تظهر فوراً برسالتها).
export async function d1Query(env, sql, params = []) {
  const accountId = String(env.D1_ACCOUNT_ID || '').trim();
  const databaseId = String(env.D1_DATABASE_ID || '').trim();
  const token = String(env.D1_API_TOKEN || '').trim();
  if (!accountId || !databaseId || !token) {
    throw new Error('D1 غير مضبوط — أضف D1_ACCOUNT_ID و D1_DATABASE_ID و D1_API_TOKEN');
  }
  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    let res;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ sql, params }),
      });
    } catch (err) {
      // خطأ شبكة: يستحق إعادة محاولة قصيرة
      if (attempt < 2) {
        await sleep(250 * (attempt + 1));
        continue;
      }
      throw err;
    }

    const text = await res.text().catch(() => '');
    let payload = null;
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
    if (res.ok && payload?.success !== false) {
      const first = Array.isArray(payload?.result) ? payload.result[0] : payload?.result;
      return Array.isArray(first?.results) ? first.results : [];
    }

    const detail =
      (Array.isArray(payload?.errors) && payload.errors[0]?.message) ||
      text.slice(0, 200) ||
      `d1 ${res.status}`;
    const err = new Error(`d1 ${res.status}: ${detail}`);
    // 5xx/429 فقط هي اللي بتتعاد — خطأ صلاحية أو حصة بيظهر فوراً برسالته
    if ((res.status >= 500 || res.status === 429) && attempt < 2) {
      await sleep(250 * (attempt + 1));
      continue;
    }
    throw err;
  }
  throw new Error('d1: تعذّر تنفيذ الاستعلام');
}

// عميل عام يقرأ ويكتب مفاتيح متعددة (نفس شكل supabaseClient)
export function d1Client(env = {}) {
  const configured = d1Configured(env);
  let tableReady = false;

  const ensureTable = async () => {
    if (tableReady) return;
    await d1Query(env, TABLE_SQL);
    tableReady = true;
  };

  const parseValue = (raw) => {
    if (raw === null || raw === undefined) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  };

  async function getMany(keys) {
    const list = (Array.isArray(keys) ? keys : []).filter(Boolean);
    if (!list.length) return {};
    await ensureTable();
    const placeholders = list.map(() => '?').join(', ');
    const rows = await d1Query(
      env,
      `SELECT key, value FROM crm_kv WHERE key IN (${placeholders})`,
      list
    );
    const out = {};
    for (const row of Array.isArray(rows) ? rows : []) out[row.key] = parseValue(row.value);
    return out;
  }

  async function getOne(key) {
    const map = await getMany([key]);
    return map[key] ?? null;
  }

  async function setMany(pairs) {
    const list = (Array.isArray(pairs) ? pairs : []).filter((p) => Array.isArray(p) && p[0]);
    if (!list.length) return;
    await ensureTable();
    const values = list.map(() => '(?, ?)').join(', ');
    const params = [];
    for (const [key, value] of list) params.push(String(key), JSON.stringify(value));
    await d1Query(
      env,
      `INSERT INTO crm_kv (key, value) VALUES ${values} ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      params
    );
  }

  async function setOne(key, value) {
    await setMany([[key, value]]);
  }

  return { configured, ensureTable, getMany, getOne, setMany, setOne };
}

// ===== مخزن المزامنة الكامل (نفس supabaseStorage) — صف لكل مفتاح =====
export function d1Storage(env = {}) {
  const client = d1Client(env);
  const parseJson = (raw) => {
    if (raw === null || raw === undefined) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  };
  const rowsOfPrefix = () =>
    d1Query(env, "SELECT key, value FROM crm_kv WHERE key LIKE 'crm:data:%'");

  return {
    configured: client.configured,
    // فحص الإصدار بمفتاح واحد فقط (الأكثر تكراراً — كل جهاز يناديه كل ثوانٍ)
    async loadVersion() {
      const value = await client.getOne(VERSION_KEY);
      return Number(value) || 0;
    },
    async load() {
      await client.ensureTable();
      const version = Number(await client.getOne(VERSION_KEY)) || 0;
      const rows = await rowsOfPrefix();
      const data = {};
      for (const row of Array.isArray(rows) ? rows : []) {
        const name = String(row.key || '').slice(DATA_PREFIX.length);
        if (!name) continue;
        const parsed = parseJson(row.value);
        if (parsed !== null) data[name] = parsed;
      }
      return { version, data };
    },
    async save(db) {
      await client.ensureTable();
      const payload = db?.data || {};
      const existing = await rowsOfPrefix();
      const stored = new Map((Array.isArray(existing) ? existing : []).map((row) => [row.key, row.value]));

      const pairs = [];
      for (const [name, value] of Object.entries(payload)) {
        const key = DATA_PREFIX + name;
        const raw = JSON.stringify(value === undefined ? null : value);
        if (raw.length > MAX_ROW_BYTES) {
          throw new Error(
            `المفتاح ${name} أكبر من سقف الصف في Cloudflare D1 (~١ ميجا) — قلّل صور العقارات ثم أعد المحاولة`
          );
        }
        if (stored.get(key) !== raw) pairs.push([key, value === undefined ? null : value]);
        stored.delete(key);
      }

      // مفاتيح اتشالت من البيانات (إعادة ضبط): صفوفها تتمسح
      const gone = [...stored.keys()];
      if (gone.length) {
        const placeholders = gone.map(() => '?').join(', ');
        await d1Query(env, `DELETE FROM crm_kv WHERE key IN (${placeholders})`, gone);
      }

      const versionRow = [VERSION_KEY, Number(db?.version) || 0];
      if (pairs.length) await client.setMany([...pairs, versionRow]);
      else await client.setOne(VERSION_KEY, versionRow[1]);
    },
  };
}

// ===== تخزين كائن JSON واحد في مفتاح مستقل (نفس supabaseJsonStore) =====
// يُستخدم لإعدادات سحب الأرقام ومفاتيح الإشعارات وحالة الإرسال.
export function d1JsonStore(env = {}, key = 'crm:lead-source:config') {
  const client = d1Client(env);
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
