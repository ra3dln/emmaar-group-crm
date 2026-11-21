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

import { keepManualOwner } from '../shared/ownerGuard.js';
import { mergeClientActivities } from '../shared/comments.js';

export const SYNC_EVENT = 'crm-sync';
// يُطلَق عندما يرفض السيرفر الطلب (401/403): لا جلسة أو كلمة مرور ضعيفة
// => التطبيق يعرض شاشة الدخول ويتوقف عن أي محاولة حتى يسجّل المستخدم دخوله.
export const AUTH_EVENT = 'crm-auth-required';

export const API = '/api/store';
export const AUTH_API = '/api/auth';
// كل جهاز بيسأل السيرفر «فيه جديد؟» كل ٥ ثواني (كانت ١.٥ ثانية): كل سؤال طلب على
// Vercel، ومع كذا جهاز طول اليوم ده كان بيستهلك حصة الاستضافة المجانية.
// (لما الصفحة ترجع للشاشة بتتزامن فوراً من غير ما تستنى — attachWakeListeners)
const POLL_MS = 5000;

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
  serverBaseline.clear();
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
  // الأرقام المتكررة من الكامبين (shared/leadRepeats.js) — السيرفر بيكتبها وقت السحب
  'crm_lead_repeats',
  // كلام العميل في فورم الكامبين (shared/leadAnswers.js) — السيرفر بيكتبه وقت السحب
  'crm_lead_answers',
];
const ALL_KEYS = [...SYNC_KEYS, TOMBSTONE_KEY];
// مفاتيح البيانات التي تُستبدل بالكامل عند إعادة الضبط
const DATA_KEYS = SYNC_KEYS;

// نفس السجلات بغض النظر عن الترتيب؟ المزامنة كانت بتعتبر أي اختلاف في الترتيب
// «تغيير» فترفع ١.٣ ميجا لكل فتحة وتزوّد رقم النسخة، فكل فتحة تنزّل البيانات
// كلها من جديد. المقارنة هنا بتحمي من الرفع والكتابة بلا داعي.
const sameRecordSet = (left: any[], right: any[]): boolean => {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
  const a = left.map((row) => JSON.stringify(row)).sort();
  const b = right.map((row) => JSON.stringify(row)).sort();
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
  return true;
};

type Tombstone = { key: string; id: string; at?: number };
type StoreData = Record<string, unknown>;

let serverVersion = -1;
let snapshot: Record<string, string> = {};
// آخر رقم نسخة عرفناه من السيرفر — بنحفظه على الجهاز، فالفتحة الجاية لو مفيش
// أي جديد ما بننزّلش البيانات كلها (١.٣ ميجا) — قوة الفتح بتفرق جداً.
const SERVER_VERSION_KEY = 'crm_server_version';
const cachedServerVersion = (): number => {
  try {
    const raw = localStorage.getItem(SERVER_VERSION_KEY);
    if (raw === null) return -1;
    const value = Number(raw);
    return Number.isFinite(value) ? value : -1;
  } catch {
    return -1;
  }
};
const rememberVersion = (version: number): void => {
  if (!Number.isFinite(version) || version < 0) return;
  try {
    localStorage.setItem(SERVER_VERSION_KEY, String(version));
  } catch {
    /* التخزين معطّل — نستخدم الذاكرة فقط */
  }
};
// فيه رفعة فشلت (شبكة/سيرفر)؟ معناها إن في بيانات على الجهاز لسه ما وصلتش
// السيرفر، فلازم الفتحة الجاية تسحب نسخة السيرفر وتدمج وترفع — ما ينفعش نختصرها.
const PENDING_PUSH_KEY = 'crm_pending_push';
const setPendingPush = (): void => {
  try {
    localStorage.setItem(PENDING_PUSH_KEY, '1');
  } catch {
    /* لا شيء */
  }
};
const clearPendingPush = (): void => {
  try {
    if (localStorage.getItem(PENDING_PUSH_KEY)) localStorage.removeItem(PENDING_PUSH_KEY);
  } catch {
    /* لا شيء */
  }
};
const hasPendingPush = (): boolean => {
  try {
    return localStorage.getItem(PENDING_PUSH_KEY) === '1';
  } catch {
    return true;
  }
};
// "آخر نسخة عرفناها" تبدأ من بيانات هذا الجهاز؛ قبل كده كانت فاضية، فأول دورة
// بعد الفتح كانت بتعتبر كل المفاتيح "متغيّرة" وترفعها كلها للسيرفر بلا داعي.
let snapshotReady = false;
const initSnapshot = (): void => {
  if (snapshotReady) return;
  snapshotReady = true;
  // لو الذاكرة اتملت خلاص (مزامنة أولى/دفع سابق) ما نمسحهاش — وإلا الحذف
  // اللي حصل بعدها ما يتسجلش شاهد حذف ويرجع السجل للحياة.
  if (Object.keys(snapshot).length) return;
  try {
    snapshot = readAll();
  } catch {
    snapshot = {};
  }
};
let busy = false;
let online = false;
// آخر نسخة كاملة جاية من السيرفر (كل الحسابات) — للسؤال «الرقم ده عند حدّ تاني؟»
// من غير ما نحط بيانات غيرنا في ذاكرة الحساب. تُمسح مع تسجيل الخروج.
let lastServerData: StoreData | null = null;

// ===== نسخة السيرفر من كل سجل (عشان نبعت اللي اتغيّر بس) =====
// السيرفر على Cloudflare المجاني ليه حد معالجة (١٠ مللي ثانية للطلب): بعت قائمة العملاء
// كلها (٣٣٠ كيلو) مع كل كومنت كان بيتخطّاه فالحفظ يفشل. دلوقتي الجهاز بيبعت السجلات اللي
// اتغيّرت عن آخر نسخة وصلته من السيرفر بس (upserts)، والسيرفر بيدمجها في المتخزّن.
const serverBaseline = new Map<string, Map<string, string>>();
const rememberServerList = (key: string, list: any) => {
  if (!Array.isArray(list)) return;
  const map = new Map<string, string>();
  for (const row of list) if (row && row.id !== undefined && row.id !== null) map.set(String(row.id), JSON.stringify(row));
  serverBaseline.set(key, map);
};
const rememberServerData = (data: any) => {
  if (!data || typeof data !== 'object') return;
  for (const [key, list] of Object.entries(data)) rememberServerList(key, list);
};
// السجلات اللي مش زي نسخة السيرفر — null لو ماعندناش نسخة (يتبعت كله زي الأول)
const changedRows = (key: string, list: any[]): any[] | null => {
  const base = serverBaseline.get(key);
  if (!base || key === TOMBSTONE_KEY) return null;
  return list.filter((row) => !row || row.id === undefined || row.id === null || base.get(String(row.id)) !== JSON.stringify(row));
};

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
// وقت في المستقبل (جهاز ساعته متقدّمة) ما يتحسبش — نفس قاعدة السيرفر (server/store.js)
const changeStamp = (record: any): number => {
  const limit = Date.now() + 2 * 60 * 1000;
  const times = [
    Date.parse(record?.updatedAt || ''),
    Date.parse(record?.assignedAt || ''),
    Date.parse(record?.viewedAt || ''),
    Date.parse(record?.createdAt || ''),
  ].filter((n) => Number.isFinite(n) && n <= limit);
  return times.length ? Math.max(...times) : 0;
};

// اتحاد السجلين بالمعرّف — الأحدث يفوز.
// كان «النسخة البعيدة تفوز دائماً»، فأي تعديل جديد على هذا الجهاز يرجع لنسخته
// القديمة: المزامنة تجلب نسخة السيرفر **قبل** ما ترفع تغيير هذا الجهاز، فتتراجع
// التوزيعات إلى «غير مخصص» بعد ثانيتين، ويضيع الحذف، ولا يتوقف التوزيع التلقائي.
// الآن: لو نسختنا أحدث فهي الأصح، وعند التساوي يبقى السيرفر هو المرجع.
const mergeUnion = (remote: any[], local: any[], key = ''): any[] => {
  const byId = new Map<string, any>();
  for (const item of local) {
    if (item && item.id) byId.set(String(item.id), item);
  }
  for (const item of remote) {
    if (!item || !item.id) continue;
    const id = String(item.id);
    const mine = byId.get(id);
    if (!mine) {
      byId.set(id, item);
      continue;
    }
    // التوزيع اليدوي يكسب التلقائي مهما كان وقت الحفظ (shared/ownerGuard.js)
    const winner = changeStamp(mine) > changeStamp(item)
      ? keepManualOwner(key, mine, item) // نسختنا أحدث ⇒ هي الأصح
      : keepManualOwner(key, item, mine);
    // دمج الخط الزمني للعميل (الكومنتات) حتى لا يمسح تعديل مرحلة كومنتات كُتبت على جهاز آخر
    if (key === 'crm_clients') {
      byId.set(id, {
        ...winner,
        activities: mergeClientActivities(mine?.activities, item?.activities),
      });
    } else {
      byId.set(id, winner);
    }
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
  rememberVersion(serverVersion);
  clearPendingPush();
};

const pushOne = async (key: string): Promise<void> => {
  const list = safeParse(localStorage.getItem(key));
  const upserts = changedRows(key, list);
  // مفيش أي سجل مختلف عن نسخة السيرفر = مفيش حاجة تتبعت — إلا لو فيه سجلات اتحذفت
  // من الجهاز: المفتاح لازم يتبعت (ولو فاضي) عشان السيرفر يطبّق شواهد الحذف عليه.
  const base = serverBaseline.get(key);
  const localIds = new Set(list.map((row: any) => String(row?.id)));
  const removedHere = !!base && [...base.keys()].some((id) => !localIds.has(id));
  if (upserts && !upserts.length && !removedHere) {
    clearPendingPush();
    return;
  }
  const res = await apiFetch(API, {
    method: 'POST',
    headers: apiHeaders(true),
    body: JSON.stringify(upserts ? { key, upserts } : { key, value: list }),
  });
  if (!res.ok) throw new Error(`push failed: ${res.status}`);
  const payload = await res.json();
  serverVersion = payload.version;
  rememberVersion(serverVersion);
  clearPendingPush();
  // السيرفر دلوقتي عنده كل سجلات الجهاز ده (الدمج بيحتفظ بالكل)، والمحذوف اتشال
  const next = new Map<string, string>();
  for (const row of list) if (row && row.id !== undefined && row.id !== null) next.set(String(row.id), JSON.stringify(row));
  if (base) for (const [id, raw] of base) if (!next.has(id) && localIds.has(id)) next.set(id, raw);
  serverBaseline.set(key, next);
};

const pushOneWithRetry = async (key: string): Promise<void> => {
  let lastErr: any = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await pushOne(key);
      return;
    } catch (err) {
      lastErr = err;
      if (attempt === 0) await new Promise((r) => setTimeout(r, 350));
    }
  }
  throw lastErr;
};

// كل ثانيتين: نرفع تغييرات هذا الجهاز ثم نجلب تغييرات الأجهزة الأخرى
const tick = async (): Promise<void> => {
  // بلا جلسة صحيحة لا نفعل شيئاً: لا قراءة ولا كتابة — البيانات تبقى مغلقة
  if (busy || authRequired) return;
  // في الخلفية المتصفح بيوقف المؤقتات غالباً؛ نرجّع المزامنة فوراً عند العودة
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
  busy = true;
  try {
    initSnapshot();
    // 0) هل تغيّر شيء على السيرفر؟ (نفحص قبل الرفع حتى نكتشف إعادة الضبط قبل رفع أي بيانات قديمة)
    let prefetched: any = null;
    let version = 0;
    const knownVersion = serverVersion < 0 ? cachedServerVersion() : serverVersion;
    if (serverVersion < 0 && knownVersion < 0) {
      // أول مرة على الجهاز: نجيب النسخة الكاملة على طول (ردّها فيه رقم النسخة)
      // بدل ما نضيّع دورة كاملة على سؤال «فيه جديد؟» — بيفرّق في سرعة الفتح.
      const fullRes = await apiFetch(API, { cache: 'no-store', headers: apiHeaders() });
      if (!fullRes.ok) throw new Error(`pull failed: ${fullRes.status}`);
      prefetched = await fullRes.json();
      version = Number(prefetched?.version) || 0;
    } else if (serverVersion < 0) {
      // عندنا رقم آخر نسخة محفوظ: نسأل سؤال صغير «فيه جديد؟» — لو نفس النسخة
      // ما بننزّلش البيانات كلها، وده اللي بيخلّي الفتح سريع.
      const versionRes = await apiFetch(`${API}?meta=version`, { cache: 'no-store', headers: apiHeaders() });
      if (!versionRes.ok) throw new Error(`version failed: ${versionRes.status}`);
      version = Number((await versionRes.json()).version) || 0;
      serverVersion = knownVersion;
    } else {
      const versionRes = await apiFetch(`${API}?meta=version`, { cache: 'no-store', headers: apiHeaders() });
      if (!versionRes.ok) throw new Error(`version failed: ${versionRes.status}`);
      version = Number((await versionRes.json()).version) || 0;
    }
    if (version !== serverVersion) {
      if (!prefetched) {
        const fullRes = await apiFetch(API, { cache: 'no-store', headers: apiHeaders() });
        if (!fullRes.ok) throw new Error(`pull failed: ${fullRes.status}`);
        prefetched = await fullRes.json();
      }
      const store = prefetched;
      // نسخة السيرفر الكاملة: نستخدمها بسؤال «الرقم ده عند حدّ تاني؟»
      // (من غير ما تدخل ذاكرة الحساب — تتبقى في المزامنة فقط)
      if (store?.data && typeof store.data === 'object') {
        lastServerData = store.data as StoreData;
        rememberServerData(store.data);
      }
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
    rememberVersion(serverVersion);

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
      const union = mergeUnion(remote, local, key);
      const kept = dropResurrected(key, union, allTombstones);
      if (kept.length !== allTombstones.length) {
        allTombstones.splice(0, allTombstones.length, ...kept);
        if (!repush.includes(TOMBSTONE_KEY)) repush.push(TOMBSTONE_KEY);
      }
      const merged = afterTombstones(union, allTombstones, key);
      const mergedRaw = JSON.stringify(merged);
      if (mergedRaw !== JSON.stringify(local) && !sameRecordSet(merged, local)) {
        localStorage.setItem(key, mergedRaw);
        changed = true;
      }
      // سجلات موجودة هنا ولم تصل السيرفر بعد (مثل جهاز كان غير متصل)
      if (mergedRaw !== JSON.stringify(remote) && !sameRecordSet(merged, remote)) repush.push(key);
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

// دفع دفعة من المفاتيح في طلب واحد مؤمَّن (ذرّي) بدل طلبات منفصلة تتسابق
export async function pushKeys(keys: string[]): Promise<boolean> {
  const uniqueKeys = [...new Set(keys.filter(Boolean))];
  if (!uniqueKeys.length) return true;
  if (uniqueKeys.length === 1) return pushKey(uniqueKeys[0]);

  try {
    initSnapshot();
    const dataToSend: Record<string, any[]> = {};
    for (const key of uniqueKeys) {
      const raw = localStorage.getItem(key);
      if (raw === null) continue;
      const before = idSet(snapshot[key]);
      const currentList = safeParse(raw);
      const removed = [...before].filter((id) => !idSet(raw).has(id));
      await recordDeletions(key, removed);
      dataToSend[key] = currentList;
    }

    if (!Object.keys(dataToSend).length) return true;

    // كل مفتاح لوحده بالطريق الخفيف (السجلات اللي اتغيّرت بس) — طلب واحد بكل المفاتيح
    // كان بيعدّي حد المعالجة على Cloudflare. شواهد الحذف الأول.
    const ordered = Object.keys(dataToSend).sort((a, b) => (a === TOMBSTONE_KEY ? -1 : b === TOMBSTONE_KEY ? 1 : 0));
    for (const key of ordered) {
      await pushOneWithRetry(key);
      snapshot[key] = localStorage.getItem(key) || '[]';
    }
    return true;
  } catch (err) {
    console.warn('[sync] pushKeys failed:', err);
    // في بيانات لسه ما وصلتش السيرفر: الفتحة الجاية لازم تسحب وتدمج وترفع
    setPendingPush();
    return false;
  }
}

// القيمة الراجعة: true لو وصل التغيير لقاعدة البيانات فعلاً.
// الشاشات التي تُنشئ حساباً أو عميلاً تحتاج هذه الإجابة، لأن الحفظ المحلي وحده
// يجعل السجل موجوداً على هذا الجهاز فقط — فيبدو لمن يجرّب الدخول من جهازه «مش شغّال».
export async function pushKey(key: string): Promise<boolean> {
  try {
    initSnapshot();
    const raw = localStorage.getItem(key);
    if (raw === null) return false;
    // أي معرّف اختفى عن القائمة منذ آخر مزامنة = حذف حقيقي، وله شاهد حذف يسبق الرفع
    const before = idSet(snapshot[key]);
    const removed = [...before].filter((id) => !idSet(raw).has(id));
    await recordDeletions(key, removed);
    await pushOneWithRetry(key);
    snapshot[key] = raw;
    return true;
  } catch {
    // الرفع فشل: لازم الفتحة الجاية تسحب وتدمج وترفع بدل الاختصار السريع
    setPendingPush();
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
  // ===== فتح سريع =====
  // لو الجهاز عنده رقم آخر نسخة عرفها ومفيش أي رفعة معلّقة، فمفيش جديد على
  // السيرفر: بنسأل طلب صغير (meta=version) بدل تنزيل النسخة الكاملة (١.٣ ميجا)
  // ورفعها من جديد — ودي كانت أكبر حاجة بتطوّل فتح الموقع.
  const knownOnOpen = cachedServerVersion();
  if (knownOnOpen >= 0 && !hasPendingPush()) {
    try {
      const versionRes = await apiFetch(`${API}?meta=version`, { cache: 'no-store', headers: apiHeaders() });
      if (versionRes.ok) {
        const current = Number((await versionRes.json()).version) || 0;
        if (current === knownOnOpen) {
          serverVersion = current;
          online = true;
          snapshot = readAll();
          window.setInterval(() => {
            void tick();
          }, POLL_MS);
          attachWakeListeners();
          return;
        }
      }
    } catch {
      /* أي خطأ: نكمل بالمسار العادي (سحب كامل) */
    }
  }

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
      rememberServerData(store?.data);

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
          const union = mergeUnion(remote, local, key);
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