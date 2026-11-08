// ===== مزامنة البيانات بين كل الأجهزة =====
// البيانات تُحفظ محلياً (localStorage) للسرعة، ويتم تبادلها مع سيرفر البيانات المحلي
// (ملف data/db.json) كل ثانيتين، فتصبح نفس البيانات على الكمبيوتر والموبايل.
//
// قواعد الدمج:
// 1) أي سجل أضافه جهاز موجود على كل الأجهزة (اتحاد بالمعرّف).
// 2) أي سجل حُذف من جهاز يُحفظ كـ «شاهد حذف» حتى لا يعود من الأجهزة الأخرى.
// 3) السيرفر هو المرجع لأي تعديل على سجل موجود (لمنع رجوع البيانات القديمة).

// ===== مزامنة البيانات بين كل الأجهزة =====
// البيانات تُحفظ محلياً (localStorage) للسرعة، ويتم تبادلها مع سيرفر البيانات المحلي
// (ملف data/db.json) كل ثانيتين، فتصبح نفس البيانات على الكمبيوتر والموبايل.
//
// قواعد الدمج:
// 1) أي سجل أضافه جهاز موجود على كل الأجهزة (اتحاد بالمعرّف).
// 2) أي سجل حُذف من جهاز يُحفظ كـ «شاهد حذف» حتى لا يعود من الأجهزة الأخرى.
// 3) السيرفر هو المرجع لأي تعديل على سجل موجود (لمنع رجوع البيانات القديمة).
//
// ملاحظة: بدون قاعدة بيانات خارجية (Redis/Upstash) على Vercel،
// لا توجد نقطة مركزية للتخزين — النظام يعمل محلياً على كل جهاز فقط.
// أي محاولة لاستدعاء `/api/store` على الاستضافة ترجع 503 (لا توجد قاعدة)،
// وفيها النظام يظل يعمل بالكامل من localStorage.

export const SYNC_EVENT = 'crm-sync';
// يُطلَق عندما يرفض السيرفر الطلب (401/403): لا جلسة أو كلمة مرور ضعيفة
// => التطبيق يعرض شاشة الدخول ويتوقف عن أي محاولة حتى يسجّل المستخدم دخوله.
export const AUTH_EVENT = 'crm-auth-required';

export const API = '/api/store';
export const AUTH_API = '/api/auth';
const POLL_MS = 1500;

// ===== حالة التفويض =====
// لا يوجد أي مفتاح في كود المتصفح: التفويض كله بكوكي جلسة HttpOnly موقع من السيرفر.
// أي شخص يعرف رابط الموقع ويحاول قراءة البيانات يحصل على 401 ولا يرى شيئاً.
let authRequired = false;

export const isAuthRequired = (): boolean => authRequired;

export const markUnauthorized = (): void => {
  if (authRequired) return;
  authRequired = true;
  online = false;
  // ما نُبقيش نسخة من بيانات غيرنا بعد ما الجلسة تنتهي
  lastServerData = null;
  try {
    window.dispatchEvent(new Event(AUTH_EVENT));
  } catch {
    /* لا شيء */
  }
};

// بعد دخول ناجح: نفتح المزامنة من جديد ونجلب البيانات فوراً بلا انتظار دورة كاملة
export const markAuthorized = (): void => {
  authRequired = false;
  void tick();
};

const apiHeaders = (json = false): Record<string, string> =>
  json ? { 'Content-Type': 'application/json' } : {};

// كل طلبات البيانات تمر من هنا: الكوكي يُرسل تلقائياً (نفس الأصل)، وأي رفض
// من السيرفر (٤٠١ بلا جلسة / ٤٠٣ كلمة مرور ضعيفة) يُوقف المزامنة فوراً.
// ٤٠١ = لا جلسة (نوقف ونعرض شاشة الدخول).
// ٤٠٣ = ممنوع لهذا الحساب بعينه (صلاحية) ولا يعني انتهاء الجلسة.
const apiFetch = async (path: string, init: RequestInit = {}): Promise<Response> => {
  const res = await fetch(path, { credentials: 'same-origin', ...init });
  if (res.status === 401) markUnauthorized();
  return res;
};

// شغّال خبيث: بدون استضافة قاعدة، كل طلب لـ /api/store بيرجع 503.
// عشان النظام مايقفش، بنوكّل المزامنة كلها على localStorage فقط.
// (السيرفر المحلي file-based بيكون موجود فقط locally via vite proxy، وماينزلش على Vercel)
const TOMBSTONE_KEY = 'crm_tombstones';
// «علامة إعادة الضبط»: سجل واحد يحتوي وقت آخر إعادة ضبط للنظام.
// أي جهاز يرى علامة أحدث من التي طبّقها يمسح بياناته المحلية ويأخذ نسخة السيرفر كما هي
// — بدون ذلك، أي جهاز قديم (لابتوب أو هاتف) كان سيرفع بياناته المحذوفة إلى السيرفر مرة أخرى.
const RESET_KEY = 'crm_reset';
const RESET_STAMP_KEY = 'crm_reset_stamp'; // يبقى على هذا الجهاز فقط

// المفاتيح المشتركة فقط — جلسة الدخول (current_user) وحالة الإشعارات تبقى لكل جهاز
const SYNC_KEYS: string[] = [
  'crm_users',
  'crm_clients',
  'crm_properties',
  'crm_reminders',
  'crm_daily_feedback',
  'crm_assigned_leads',
  'crm_teams',
  'crm_attendance',
  'crm_messages',
  'crm_call_logs',
  // قواعد «التوزيع التلقائي» (فورم ← مندوبون بعينهم): سياسة مشتركة لازم توصل لكل الأجهزة
  'crm_lead_auto_assign',
  // الفورمات المضافة يدوي من تبويب «إضافة فورم» (src/manualForms.ts)
  'crm_manual_forms',
];
const ALL_KEYS = [...SYNC_KEYS, TOMBSTONE_KEY];
// مفاتيح البيانات التي تُستبدل بالكامل عند إعادة الضبط
const DATA_KEYS = SYNC_KEYS;

type Tombstone = { key: string; id: string; at?: number };
type StoreData = Record<string, unknown>;

let serverVersion = -1;
let snapshot: Record<string, string> = {};
let busy = false;
let online = false;
// آخر نسخة كاملة جاية من السيرفر (كل الحسابات) — للسؤال «الرقم ده عند حدّ تاني؟»
// من غير ما نحط بيانات غيرنا في ذاكرة الحساب. تُمسح مع تسجيل الخروج.
let lastServerData: StoreData | null = null;

// من صاحب هذا الرقم (عميل مسجّل) في آخر نسخة من السيرفر — '' يعني مش موجود
export const ownerOfPhoneOnServer = (phone: string): { ownerId: string; ownerName: string } | null => {
  const key = String(phone || '').replace(/\D/g, '');
  if (!key || !lastServerData) return null;
  const users = Array.isArray(lastServerData.crm_users) ? (lastServerData.crm_users as any[]) : [];
  const clients = Array.isArray(lastServerData.crm_clients) ? (lastServerData.crm_clients as any[]) : [];
  for (const client of clients) {
    const phones = [client?.phone, ...(client?.phones || [])].map((p: unknown) => String(p || '').replace(/\D/g, ''));
    if (!phones.includes(key)) continue;
    const ownerId = String(client?.assignedTo || client?.userId || '');
    const owner = users.find((u: any) => String(u?.id) === ownerId);
    return { ownerId, ownerName: String(owner?.name || ownerId || 'غير معروف') };
  }
  return null;
};

// كل الأرقام المسجّلة كعملاء على السيرفر (لكل الحسابات) — لمقارنة الأرقام
export const clientPhonesOnServer = (): Set<string> => {
  const out = new Set<string>();
  if (!lastServerData) return out;
  const clients = Array.isArray(lastServerData.crm_clients) ? (lastServerData.crm_clients as any[]) : [];
  for (const client of clients) {
    for (const p of [client?.phone, ...(client?.phones || [])]) {
      const key = String(p || '').replace(/\D/g, '');
      if (key) out.add(key);
    }
  }
  return out;
};

// صاحب الرقم كرقم موزّع (في عهدة مندوب) على السيرفر — '' يعني الرقم حر
export const leadOwnerOfPhoneOnServer = (phone: string): { ownerId: string; ownerName: string } | null => {
  const key = String(phone || '').replace(/\D/g, '');
  if (!key || !lastServerData) return null;
  const users = Array.isArray(lastServerData.crm_users) ? (lastServerData.crm_users as any[]) : [];
  const leads = Array.isArray(lastServerData.crm_assigned_leads) ? (lastServerData.crm_assigned_leads as any[]) : [];
  for (const lead of leads) {
    if (String(lead?.phone || '').replace(/\D/g, '') !== key) continue;
    const ownerId = String(lead?.salesId || '');
    if (!ownerId) return null;
    const owner = users.find((u: any) => String(u?.id) === ownerId);
    return { ownerId, ownerName: String(owner?.name || ownerId || 'غير معروف') };
  }
  return null;
};

const safeParse = (raw: string | null): any[] => {
  try {
    const parsed = JSON.parse(raw || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const parseTombstones = (value: unknown): Tombstone[] => {
  const raw = typeof value === 'string' ? safeParse(value) : Array.isArray(value) ? value : [];
  return raw.filter((item: any) => item && typeof item.key === 'string' && typeof item.id === 'string');
};

// وقت شاهد الحذف (0 للشواهد القديمة بلا وقت — تُعامَل كأقدم شاهد)
const tombAt = (t: Tombstone): number => Number(t?.at) || 0;

// آخر تعديل معروف للسجل (أي حقل زمني فيه) — يُقارَن بوقت شاهد الحذف
const recordStamp = (record: any): number => {
  const times = [Date.parse(record?.updatedAt || ''), Date.parse(record?.createdAt || '')].filter((n) =>
    Number.isFinite(n)
  );
  return times.length ? Math.max(...times) : 0;
};

// «الإحياء يفوز» بقيد الزمن: شاهد الحذف يسقط فقط إذا كان السجل الموجود أحدث منه فعلاً
// (يعيد إنشاء حقيقي بعد الحذف، مثل حساب الإدارة المُعاد إنشاؤه). بدون قيد الزمن كان
// أي جهاز قديم ما زال يحمل السجل يُلغي شاهد الحذف ويعيد السجل المحذوف للحياة في كل دورة.
const dropResurrected = (key: string, union: any[], tombstones: Tombstone[]): Tombstone[] =>
  tombstones.filter((t) => {
    if (t?.key !== key || !t?.id) return true;
    const record = union.find((r: any) => String(r?.id) === String(t.id));
    if (!record) return true; // غير موجود في أي نسخة => الشاهد باقٍ
    return recordStamp(record) <= tombAt(t); // أقدم من الحذف => حذفه سليم؛ أحدث => إعادة إنشاء
  });

const mergeTombstones = (...lists: Tombstone[][]): Tombstone[] => {
  const byTag = new Map<string, Tombstone>();
  for (const list of lists) {
    for (const item of list) {
      const tag = `${item.key}::${item.id}`;
      const prev = byTag.get(tag);
      const prevAt = prev ? tombAt(prev) : 0;
      // عند التكرار نحتفظ بأحدث وقت حذف حتى لا يضيع قيد الزمن بمزامنة أقدم
      if (!prev || tombAt(item) > prevAt) {
        byTag.set(tag, { key: item.key, id: item.id, at: tombAt(item) || prevAt });
      }
    }
  }
  return Array.from(byTag.values());
};

const isDeleted = (tombstones: Tombstone[], key: string, id: string): boolean =>
  tombstones.some((item) => item.key === key && item.id === id);

// وقت آخر إعادة ضبط مسجَّل في بيانات السيرفر (0 لو لا يوجد)
const resetAt = (data: StoreData | undefined): number => {
  const list = Array.isArray(data?.[RESET_KEY]) ? (data![RESET_KEY] as any[]) : [];
  return list.reduce((max, item) => Math.max(max, Date.parse(item?.at) || 0), 0);
};

const localResetStamp = (): number => {
  try {
    return Number(localStorage.getItem(RESET_STAMP_KEY)) || 0;
  } catch {
    return 0;
  }
};

// إعادة ضبط هذا الجهاز: يأخذ نسخة السيرفر كما هي بلا دمج ولا شواهد حذف قديمة
const applyServerReset = (data: StoreData | undefined, at: number): void => {
  try {
    for (const key of DATA_KEYS) {
      const remote = Array.isArray(data?.[key]) ? data![key] : [];
      localStorage.setItem(key, JSON.stringify(remote));
    }
    localStorage.setItem(TOMBSTONE_KEY, JSON.stringify(Array.isArray(data?.[TOMBSTONE_KEY]) ? data![TOMBSTONE_KEY] : []));
    localStorage.setItem(RESET_STAMP_KEY, String(at));
  } catch {
    /* لا شيء */
  }
};

const idSet = (raw?: string): Set<string> => new Set(safeParse(raw ?? null).map((item: any) => item?.id).filter(Boolean));

const readAll = (): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const key of ALL_KEYS) {
    try {
      out[key] = localStorage.getItem(key) || '[]';
    } catch {
      out[key] = '[]';
    }
  }
  return out;
};

const localData = (): StoreData => {
  const out: StoreData = {};
  for (const key of ALL_KEYS) {
    try {
      out[key] = safeParse(localStorage.getItem(key));
    } catch {
      out[key] = [];
    }
  }
  return out;
};

// وقت آخر تعديل على السجل (أي حقل زمني معروف فيه) — يُستخدم لاختيار الأحدث
// بين نسختين للسجل نفسه: نسخة هذا الجهاز ونسخة السيرفر.
const changeStamp = (record: any): number => {
  const times = [
    Date.parse(record?.updatedAt || ''),
    Date.parse(record?.assignedAt || ''),
    Date.parse(record?.viewedAt || ''),
    Date.parse(record?.createdAt || ''),
  ].filter((n) => Number.isFinite(n));
  return times.length ? Math.max(...times) : 0;
};

// اتحاد السجلين بالمعرّف — الأحدث يفوز.
// كان «النسخة البعيدة تفوز دائماً»، فأي تعديل جديد على هذا الجهاز يرجع لنسخته
// القديمة: المزامنة تجلب نسخة السيرفر **قبل** ما ترفع تغيير هذا الجهاز، فتتراجع
// التوزيعات إلى «غير مخصص» بعد ثانيتين، ويضيع الحذف، ولا يتوقف التوزيع التلقائي.
// الآن: لو نسختنا أحدث فهي الأصح، وعند التساوي يبقى السيرفر هو المرجع.
const mergeUnion = (remote: any[], local: any[]): any[] => {
  const byId = new Map<string, any>();
  for (const item of local) {
    if (item && item.id) byId.set(String(item.id), item);
  }
  for (const item of remote) {
    if (!item || !item.id) continue;
    const id = String(item.id);
    const mine = byId.get(id);
    if (mine && changeStamp(mine) > changeStamp(item)) continue; // نسختنا أحدث ⇒ هي الأصح
    byId.set(id, item);
  }
  return Array.from(byId.values());
};

const afterTombstones = (records: any[], tombstones: Tombstone[], key: string): any[] =>
  records.filter((item) => !item?.id || !isDeleted(tombstones, key, item.id));

const pushAll = async (): Promise<void> => {
  const res = await apiFetch(API, {
    method: 'POST',
    headers: apiHeaders(true),
    body: JSON.stringify({ data: localData() }),
  });
  if (!res.ok) throw new Error(`bulk failed: ${res.status}`);
  const payload = await res.json();
  serverVersion = payload.version;
};

const pushOne = async (key: string): Promise<void> => {
  const res = await apiFetch(API, {
    method: 'POST',
    headers: apiHeaders(true),
    body: JSON.stringify({ key, value: safeParse(localStorage.getItem(key)) }),
  });
  if (!res.ok) throw new Error(`push failed: ${res.status}`);
  const payload = await res.json();
  serverVersion = payload.version;
};

// كل ثانيتين: نرفع تغييرات هذا الجهاز ثم نجلب تغييرات الأجهزة الأخرى
const tick = async (): Promise<void> => {
  // بلا جلسة صحيحة لا نفعل شيئاً: لا قراءة ولا كتابة — البيانات تبقى مغلقة
  if (busy || authRequired) return;
  // في الخلفية المتصفح بيوقف المؤقتات غالباً؛ نرجّع المزامنة فوراً عند العودة
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
  busy = true;
  try {
    // 0) هل تغيّر شيء على السيرفر؟ (نفحص قبل الرفع حتى نكتشف إعادة الضبط قبل رفع أي بيانات قديمة)
    let prefetched: any = null;
    const versionRes = await apiFetch(`${API}?meta=version`, { cache: 'no-store', headers: apiHeaders() });
    if (!versionRes.ok) throw new Error(`version failed: ${versionRes.status}`);
    const { version } = await versionRes.json();
    if (version !== serverVersion) {
      const fullRes = await apiFetch(API, { cache: 'no-store', headers: apiHeaders() });
      if (!fullRes.ok) throw new Error(`pull failed: ${fullRes.status}`);
      const store = await fullRes.json();
      // نسخة السيرفر الكاملة: نستخدمها بسؤال «الرقم ده عند حدّ تاني؟»
      // (من غير ما تدخل ذاكرة الحساب — تتبقى في المزامنة فقط)
      if (store?.data && typeof store.data === 'object') lastServerData = store.data as StoreData;
      const serverReset = resetAt(store.data);
      if (serverReset > localResetStamp()) {
        // النظام أُعيد ضبطه من جهاز آخر: نمسح بيانات هذا الجهاز ونأخذ نسخة السيرفر كما هي
        applyServerReset(store.data, serverReset);
        serverVersion = Number(store.version) || 0;
        online = true;
        snapshot = readAll();
        window.dispatchEvent(new Event(SYNC_EVENT));
        return;
      }
      prefetched = store;
    }

    const current = readAll();
    const dirty = ALL_KEYS.filter((key) => current[key] !== snapshot[key]);
    const tombstones = parseTombstones(current[TOMBSTONE_KEY]);

    // 1) رصد أي سجل حذفه هذا الجهاز وتسجيل شاهد حذف له
    let added = false;
    for (const key of SYNC_KEYS) {
      const before = idSet(snapshot[key]);
      const now = idSet(current[key]);
      for (const id of before) {
        if (!now.has(id) && !isDeleted(tombstones, key, id)) {
          // الوقت مهم: به يفرّق السيرفر بين «محذوف» و«أُعيد إنشاؤه لاحقاً»
          tombstones.push({ key, id, at: Date.now() });
          added = true;
        }
      }
    }
    if (added) {
      const raw = JSON.stringify(tombstones);
      localStorage.setItem(TOMBSTONE_KEY, raw);
      current[TOMBSTONE_KEY] = raw;
      if (!dirty.includes(TOMBSTONE_KEY)) dirty.push(TOMBSTONE_KEY);
    }

    // 2) رفع التغييرات — شواهد الحذف أولاً حتى لا تُحيي الأجهزة الأخرى السجل
    if (dirty.includes(TOMBSTONE_KEY)) await pushOne(TOMBSTONE_KEY);
    for (const key of dirty) {
      if (key !== TOMBSTONE_KEY) await pushOne(key);
    }
    snapshot = readAll();

    // 3) تطبيق تحديثات الأجهزة الأخرى (جُلبت في الخطوة صفر إن وُجدت)
    if (!prefetched) {
      online = true;
      return;
    }
    const store = prefetched;
    serverVersion = Math.max(serverVersion, Number(store.version) || 0);

    const latest = readAll();
    // أي مفتاح تغيّر محلياً أثناء الجلب نتركه لنسخة هذا الجهاز
    const fresh = ALL_KEYS.filter((key) => latest[key] !== snapshot[key]);
    const toApply = ALL_KEYS.filter((key) => !fresh.includes(key));
    const allTombstones = mergeTombstones(tombstones, parseTombstones(store.data?.[TOMBSTONE_KEY]));

    let changed = false;
    const repush: string[] = [];

    for (const key of toApply) {
      if (key === TOMBSTONE_KEY) {
        const raw = JSON.stringify(allTombstones);
        if (raw !== latest[TOMBSTONE_KEY]) {
          localStorage.setItem(TOMBSTONE_KEY, raw);
          changed = true;
        }
        continue;
      }
      const remote: any[] = Array.isArray(store.data?.[key]) ? store.data[key] : [];
      const local = safeParse(latest[key]);
      const union = mergeUnion(remote, local);
      const kept = dropResurrected(key, union, allTombstones);
      if (kept.length !== allTombstones.length) {
        allTombstones.splice(0, allTombstones.length, ...kept);
        if (!repush.includes(TOMBSTONE_KEY)) repush.push(TOMBSTONE_KEY);
      }
      const merged = afterTombstones(union, allTombstones, key);
      const mergedRaw = JSON.stringify(merged);
      if (mergedRaw !== JSON.stringify(local)) {
        localStorage.setItem(key, mergedRaw);
        changed = true;
      }
      // سجلات موجودة هنا ولم تصل السيرفر بعد (مثل جهاز كان غير متصل)
      if (mergedRaw !== JSON.stringify(remote)) repush.push(key);
    }

    // كتابة قائمة الشواهد النهائية (بعد سقوط شواهد الإحياء) ودفعها للسيرفر
    const finalTombs = JSON.stringify(allTombstones);
    if (finalTombs !== latest[TOMBSTONE_KEY]) {
      localStorage.setItem(TOMBSTONE_KEY, finalTombs);
      changed = true;
      if (!repush.includes(TOMBSTONE_KEY)) repush.push(TOMBSTONE_KEY);
    }

    snapshot = readAll();
    for (const key of repush) await pushOne(key);

    online = true;
    if (changed) window.dispatchEvent(new Event(SYNC_EVENT));
  } catch {
    online = false;
  } finally {
    busy = false;
  }
};

export const isOnline = (): boolean => online;

// دفع فوري لمفتاح واحد بعد تغيير محلي (مثل إنشاء حساب أو تسجيل حضور)
// حتى يظهر على كل الأجهزة في نفس اللحظة بدل انتطار دورة التزامن
// (إن فشل — مثل انعدام الاتصال — يرفعه التزامن الدوري تلقائياً لاحقاً)
// تسجيل شواهد حذف للسجلات التي اختفت من قائمة محلية ورفعها قبل رفع القائمة الجديدة —
// بدونها تُحيي المزامنة السجل المحذوف من أي جهاز قديم (أو من نفس الجهاز بعد تحديث الصفحة)
const recordDeletions = async (key: string, removedIds: string[]): Promise<void> => {
  if (!removedIds.length) return;
  const tombs = parseTombstones(localStorage.getItem(TOMBSTONE_KEY));
  const at = Date.now();
  let added = false;
  for (const id of removedIds) {
    if (!tombs.some((t) => t.key === key && t.id === id)) {
      tombs.push({ key, id, at });
      added = true;
    }
  }
  if (!added) return;
  const raw = JSON.stringify(tombs);
  localStorage.setItem(TOMBSTONE_KEY, raw);
  snapshot[TOMBSTONE_KEY] = raw;
  await pushOne(TOMBSTONE_KEY); // الشواهد أولاً حتى لا تُحيي القائمة الجديدة السجل المحذوف
};

// القيمة الراجعة: true لو وصل التغيير لقاعدة البيانات فعلاً.
// الشاشات التي تُنشئ حساباً أو عميلاً تحتاج هذه الإجابة، لأن الحفظ المحلي وحده
// يجعل السجل موجوداً على هذا الجهاز فقط — فيبدو لمن يجرّب الدخول من جهازه «مش شغّال».
export async function pushKey(key: string): Promise<boolean> {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return false;
    // أي معرّف اختفى عن القائمة منذ آخر مزامنة = حذف حقيقي، وله شاهد حذف يسبق الرفع
    const before = idSet(snapshot[key]);
    const removed = [...before].filter((id) => !idSet(raw).has(id));
    await recordDeletions(key, removed);
    await pushOne(key);
    // تُسجَّل "مرفوعة" فقط بعد نجاح الرفع: لو فشل (انقطاع الشبكة أو خطأ في القاعدة)
    // يظل المفتاح "مُعدَّلاً" في العين التالية للمزامنة فيُعاد رفعه تلقائياً،
    // بدل أن يضيع التغيير (وهو ما يجعل حساباً منشأً لا يصل للقاعدة أبداً).
    snapshot[key] = raw;
    return true;
  } catch {
    return false;
  }
}

// مزامنة فورية — تُنادى عند رجوع التاب/النافذة أو تغيّر بيانات في تاب آخر
export const syncNow = (): void => {
  void tick();
};

let wakeListenersAttached = false;
const attachWakeListeners = (): void => {
  if (wakeListenersAttached || typeof window === 'undefined') return;
  wakeListenersAttached = true;
  const wake = () => {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    void tick();
  };
  window.addEventListener('focus', wake);
  window.addEventListener('online', wake);
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') wake();
    });
  }
  // تاب آخر على نفس المتصفح كتب بيانات: نعيد المزامنة فوراً بدل انتظار الدورة
  window.addEventListener('storage', (event) => {
    if (!event.key || event.key.startsWith('crm_')) wake();
  });
};

// تُنادى مرة واحدة قبل تشغيل التطبيق: نجلب بيانات السيرفر أولاً ثم نبدأ المزامنة الدورية
export async function startSync(): Promise<void> {
  // بدون قاعدة بيانات خارجية، النظام يعمل محلياً على هذا الجهاز فقط.
  // أي محاولة لاتصال بـ /api/store ستفشل (503 no external storage)،
  // وسيعتمد كل شيء على localStorage محلياً.
  //
  // ملاحظة: إذا كانت الاستضافة مرمّمة بـ Redis/Upstash لاحقاً،
  // ستعمل المزامنة تلقائياً لأن /api/store هيبدا يعطي بيانات حقيقية.
  //
  // إذا كان السيرفر المحلي (local file-based vite proxy) موجوداً فقط locally,
  // فهذا الكود بيعمل من غير مشاكل.

  online = false; // عشان مفيش قاعدة، لا يوجد "online" حقيقي

  try {
    const res = await apiFetch(API, { cache: 'no-store', headers: apiHeaders() });
    if (res.ok) {
      // لو فجأة اتعملت قاعدة (مثلاً أضيف Redis لاحقاً)
      const store = await res.json();
      serverVersion = Number(store.version) || 0;
      online = true;

      // إعادة ضبط النظام من جهاز آخر؟ نتجاهل بيانات هذا الجهاز تماماً ونأخذ نسخة السيرفر
      const serverReset = resetAt(store.data);
      if (serverReset > localResetStamp()) {
        applyServerReset(store.data, serverReset);
        window.dispatchEvent(new Event(SYNC_EVENT));
        snapshot = readAll();
        window.setInterval(() => {
          void tick();
        }, POLL_MS);
        attachWakeListeners();
        return;
      }

      const tombstones = mergeTombstones(
        parseTombstones(localStorage.getItem(TOMBSTONE_KEY)),
        parseTombstones(store.data?.[TOMBSTONE_KEY])
      );

      if (!store.isEmpty) {
        let changed = false;
        let sync = false;
        for (const key of SYNC_KEYS) {
          const remote: any[] = Array.isArray(store.data?.[key]) ? store.data[key] : [];
          const local = safeParse(localStorage.getItem(key));
          const union = mergeUnion(remote, local);
          const kept = dropResurrected(key, union, tombstones);
          if (kept.length !== tombstones.length) {
            tombstones.splice(0, tombstones.length, ...kept);
            sync = true;
          }
          const merged = afterTombstones(union, tombstones, key);
          const mergedRaw = JSON.stringify(merged);
          if (mergedRaw !== JSON.stringify(local)) {
            localStorage.setItem(key, mergedRaw);
            changed = true;
          }
          // ما اختلف عن نسخة السيرفر (حذف محلي مثلًا) يجب رفعه الآن لا لاحقًا
          if (mergedRaw !== JSON.stringify(remote)) sync = true;
        }
        // حذف محلي لم يبلغ السيرفر بعد (مثل تحديث الصفحة في منتصف رفع الحذف):
        // شاهده على الجهاز فقط، وبدون رفعه الآن تعيد أي دورة لاحقة السجل المحذوف للحياة
        const serverTombs = new Set(
          parseTombstones(store.data?.[TOMBSTONE_KEY]).map((t) => `${t.key}::${t.id}`)
        );
        if (tombstones.some((t) => !serverTombs.has(`${t.key}::${t.id}`))) sync = true;
        const finalTombs = JSON.stringify(tombstones);
        if (finalTombs !== localStorage.getItem(TOMBSTONE_KEY)) sync = true;
        localStorage.setItem(TOMBSTONE_KEY, finalTombs);
        if (sync) await pushAll();
        if (changed) window.dispatchEvent(new Event(SYNC_EVENT));
      } else {
        localStorage.setItem(TOMBSTONE_KEY, JSON.stringify(tombstones));
        await pushAll();
      }
    } else if (authRequired) {
      // لا جلسة: البيانات مغلقة — شاشة الدخول تظهر من التطبيق
      console.warn('[sync] لا توجد جلسة — بيانات العملاء مغلقة حتى تسجيل الدخول');
    } else {
      // بدون قاعدة — 503 — يستمر local-only
      console.warn('[sync] استضافة بدون قاعدة — يعمل محلياً على هذا الجهاز فقط');
    }
  } catch (error) {
    online = false;
    console.warn('[sync] تعذّر الاتصال بسيرفر البيانات — سيعمل التطبيق ببيانات هذا الجهاز فقط', error);
  }

  snapshot = readAll();
  // بدون قاعدة، الدورة الدورية بتديء بس على local-only (ماينقلش حاجة)
  window.setInterval(() => {
    void tick();
  }, POLL_MS);
  attachWakeListeners();
}