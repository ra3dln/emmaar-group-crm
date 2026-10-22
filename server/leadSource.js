// ===== محرك سحب الأرقام تلقائياً =====
// يعمل على سيرفر الشركة (جهاز المكتب) ويسحب الأرقام من المصدر كل عدة دقائق بلا أي تدخل:
//  • مصدر «ملف منشور»: رابط CSV عام (مثل Google Sheet منشور للويب) — يعمل اليوم بدون أي مراجعة.
//  • مصدر «فيسبوك مباشرة»: توكن الصفحة + اختيار النماذج تلقائياً — يكتشف صفحاتك ونماذجك بمجرد لصق التوكن.
//
// ملاحظة: منطق التنظيف هنا مكتوب بلغة JavaScript خالصة ليعمل على السيرفر،
// ونفس القواعد مطبّقة في مستورد المتصفح (src/leadImport.ts).

import fs from 'node:fs';
import path from 'node:path';
import { fileStorage } from './store.js';
import { authConfigured, isManagerRole, sessionFromRequest } from './auth.js';
// قواعد «التوزيع التلقائي» التي تختارها الإدارة (فورم ← مندوبون بعينهم).
// نفس ملف المنطق يعمل في المتصفح، فالنتيجة هنا وهناك متطابقة تماماً.
import { applyAutoRules, AUTO_ASSIGN_KEY, parseRules } from '../shared/autoAssign.js';

const GRAPH_VERSION = 'v25.0';
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;
const MAX_PER_RUN = 200;

// ===== قنوات السحب: فيسبوك وإنستجرام =====
// كل قناة إعداد مستقل تماماً (توكن + صفحات + نماذج + مؤشر آخر سحب + مشغّل خاص).
// ميتا تُنشئ نماذج إنستجرام على الصفحة نفسها وتُسحب بنفس الصلاحيات، لكن الفصل هنا
// يجعل لكل كامبين تبويبه واسمه في وصف الرقم («إنستجرام - …» مقابل «فيسبوك - …»)
// ومؤشره الخاص، فلا يوقف أحدهما الآخر ولا يخلط أرقامه بأرقامه.
export const CHANNELS = ['facebook', 'instagram'];
export const CHANNEL_LABELS = { facebook: 'فيسبوك', instagram: 'إنستجرام' };

// إعدادات قناة واحدة — فيسبوك تُحفظ في جذر الإعدادات (كما كان)، وإنستجرام في مفتاحها الخاص
const CHANNEL_DEFAULTS = {
  enabled: false,
  type: 'sheet', // sheet | meta
  sheetUrl: '',
  token: '', // توكن المستخدم (للاستكشاف)
  pages: [], // [{ id, name, token }] — توكن كل صفحة (يُكتشف تلقائياً)
  forms: [], // [{ id, pageId, name }] — النماذج المختارة
  formCursors: {}, // [{ formId: آخر وقت سحب }] — مؤشر مستقل لكل فورم
  intervalMinutes: 5,
  cursorTime: 0, // آخر وقت سُحبت عنده أرقام من ميتا
  assignCursor: 0, // موضع المناوبة في توزيع الأرقام
  perSalesLimit: 0, // أقصى عدد أرقام لكل مندوب في الدفعة الواحدة (٠ = بلا حد)
  tokenExpiresAt: 0, // ميعاد انتهاء صلاحية التوكن بالثواني (٠ = لا يُعرف أو لا ينتهي)
  lastRun: null,
};

const DEFAULTS = {
  ...CHANNEL_DEFAULTS,
  acceptTestLeads: true, // الليدز التجريبية من أداة اختبار ميتا — لا تُرفض بل تُوسم بوضوح
  instagram: { ...CHANNEL_DEFAULTS, type: 'meta' },
};

// --- تنظيف الأرقام المصرية (نفس قواعد الواجهة) ---
const toLatinDigits = (value) =>
  String(value ?? '')
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[\u06f0-\u06f9]/g, (d) => String(d.charCodeAt(0) - 0x06f0));

export const normalizeEgyptPhone = (raw) => {
  let digits = toLatinDigits(raw).replace(/\D/g, '');
  if (!digits) return '';
  while (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.startsWith('20') && digits.length >= 12) digits = digits.slice(2);
  if (digits.startsWith('1') && digits.length === 10) return `0${digits}`;
  if (digits.startsWith('0')) return digits;
  return digits;
};

export const isValidPhone = (phone) => phone.replace(/\D/g, '').length >= 8;

// --- قراءة CSV (يدعم الفاصلة والمنقوطة ومسافة الجدولة) ---
export function parseCsv(text) {
  const clean = String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  if (!clean) return [];
  const head = clean.split('\n')[0] || '';
  const counts = [',', ';', '\t', '|'].map((d) => ({ d, n: head.split(d).length - 1 }));
  const delimiter = counts.sort((a, b) => b.n - a.n)[0].d;

  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < clean.length; i += 1) {
    const char = clean[i];
    if (quoted) {
      if (char === '"') {
        if (clean[i + 1] === '"') {
          field += '"';
          i += 1;
        } else quoted = false;
      } else field += char;
    } else if (char === '"') quoted = true;
    else if (char === delimiter) {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += char;
  }
  row.push(field);
  rows.push(row);

  return rows.map((cells) => cells.map((c) => c.trim())).filter((cells) => cells.some((c) => c !== ''));
}

// --- التعرّف على الأعمدة (نفس كلمات المستورد في الواجهة) ---
const HINTS = [
  { key: 'source', words: ['campaign_name', 'campaign', 'form_name', 'form', 'source', 'الحملة', 'اسم الحملة', 'المصدر', 'مصدر', 'الفورم', 'النموذج'] },
  { key: 'phone', words: ['phone_number', 'phone', 'mobile', 'whatsapp', 'رقم الهاتف', 'الهاتف', 'رقم الموبايل', 'الموبايل', 'موبايل', 'تليفون', 'رقم العميل', 'الجوال', 'رقم'] },
  { key: 'name', words: ['full_name', 'fullname', 'name', 'client', 'الاسم', 'اسم', 'اسم العميل', 'العميل', 'الاسم الكامل'] },
  { key: 'date', words: ['created_time', 'created', 'date', 'time', 'التاريخ', 'تاريخ', 'الوقت'] },
];

const normalizeHeader = (value) => toLatinDigits(value).toLowerCase().replace(/[\s_\-.:]+/g, ' ').trim();

export function mapTable(table) {
  if (!table.length) return [];
  const header = table[0].map(normalizeHeader);
  const body = table.slice(1);
  const index = {};

  for (const { key, words } of HINTS) {
    for (let i = 0; i < header.length; i += 1) {
      if (Object.values(index).includes(i)) continue;
      if (words.some((word) => header[i].includes(word))) {
        index[key] = i;
        break;
      }
    }
  }

  // لو مافيش عمود رقم واضح: خُذ العمود الذي أغلب قيمه أرقام
  if (index.phone === undefined && body.length) {
    const width = Math.max(...body.map((r) => r.length));
    let best = -1;
    let score = 0;
    for (let i = 0; i < width; i += 1) {
      const values = body.map((r) => r[i] || '').filter(Boolean);
      if (!values.length) continue;
      const ratio = values.filter((v) => isValidPhone(normalizeEgyptPhone(v))).length / values.length;
      if (ratio > score) {
        score = ratio;
        best = i;
      }
    }
    if (best >= 0 && score >= 0.5) index.phone = best;
  }

  return body.map((cells) => {
    const rawPhone = index.phone !== undefined ? cells[index.phone] || '' : '';
    return {
      name: (index.name !== undefined ? cells[index.name] || '' : '').trim(),
      phone: normalizeEgyptPhone(rawPhone),
      source: index.source !== undefined ? cells[index.source] || '' : '',
      date: index.date !== undefined ? cells[index.date] || '' : '',
    };
  });
}

// --- إعدادات كل قناة: فيسبوك في الجذر، وإنستجرام في مفتاحها ---
export const channelConfigOf = (config, channel) =>
  channel === 'instagram' ? (config?.instagram || null) : (config || null);

export const isChannelOn = (config, channel) => {
  const cfg = channelConfigOf(config, channel);
  if (!cfg) return false;
  return channel === 'instagram' ? !!cfg.enabled : !!config.enabled;
};

// هل القناة جاهزة فعلاً للسحب؟ (توكن + نماذج، أو رابط ملف منشور)
// لا نشترط «صفحات» لأن النموذج يمكن سحبه بمعرّفه فقط: /{form-id}/leads
export const isChannelReady = (config) => {
  if (!config) return false;
  if (isMetaSource(config)) return !!(config.token && config.forms?.length);
  return !!String(config.sheetUrl || '').trim();
};

// --- طلبات Graph API ---
// أسماء الصلاحيات كما يعرضها فيسبوك، مع شرح عربي مختصر لكل واحدة
const PERMISSION_LABELS = {
  pages_manage_ads: 'إدارة إعلانات ونماذج الصفحة',
  leads_retrieval: 'قراءة أرقام العملاء (الليدز)',
  pages_show_list: 'عرض قائمة صفحاتك',
  pages_read_engagement: 'قراءة تفاعل الصفحة',
  pages_manage_metadata: 'إدارة بيانات الصفحة',
  ads_management: 'إدارة الإعلانات',
  pages_read_user_content: 'قراءة محتوى الصفحة',
  business_management: 'إدارة أعمال Business Manager',
};

const REQUIRED_PERMISSIONS = ['leads_retrieval', 'pages_manage_ads', 'pages_show_list', 'pages_read_engagement', 'pages_manage_metadata'];

const permissionOf = (message) => /requires\s+([a-z_]+)\s+permission/i.exec(String(message || ''))?.[1] || '';

// خطأ صلاحيات من فيسبوك (مثل #200 أو #10) — نميّزه لنحاول طريقاً بديلاً أو نشرحه بالعربي
export const isPermissionError = (error) =>
  !!error?.permission || error?.code === 200 || error?.code === 10 || /#200|#10\)/.test(String(error?.message || ''));

const graphGet = async (path, params, timeoutMs = 20000) => {
  const url = new URL(`${GRAPH_BASE}${path}`);
  for (const [key, value] of Object.entries(params || {})) url.searchParams.set(key, value);
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  const json = await res.json().catch(() => ({}));
  if (json.error) {
    const message = String(json.error.message || 'خطأ من فيسبوك');
    const code = json.error.code;
    const permission = permissionOf(message);

    if (code === 190) throw new Error('التوكن غير صالح أو انتهت صلاحيته — ولّد توكن جديداً والصقه هنا');
    if (code === 4 || code === 17) throw new Error('فيسبوك حدّد معدل الطلبات مؤقتاً — حاول بعد دقائق');

    // صلاحية ناقصة: نشرحها بالعربي ونجهّز رسالة تعرف المستخدم ماذا يفعل بالضبط
    if (permission || code === 200 || code === 10) {
      const label = PERMISSION_LABELS[permission];
      const name = permission ? `«${permission}»${label ? ` (${label})` : ''}` : '';
      const error = new Error(
        `فيسبوك يطلب صلاحية ${name || 'إضافية'}${permission ? '' : ` — ${message}`}.\n` +
          `الحل: ولّد التوكن من Graph API Explorer من جديد مع تفعيل كل هذه الصلاحيات: ${REQUIRED_PERMISSIONS.join(' + ')}، ثم الصقه واضغط «استكشف صفحاتي».`
      );
      error.permission = permission || 'unknown';
      error.code = code;
      throw error;
    }

    throw new Error(message);
  }
  if (!res.ok) throw new Error(`فيسبوك رد بحالة ${res.status}`);
  return json;
};

// --- جلب الأرقام من المصدر المحدد ---
const fetchText = async (url, timeoutMs = 20000) => {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), redirect: 'follow' });
  if (!res.ok) throw new Error(`المصدر رد بحالة ${res.status}`);
  const text = await res.text();
  if (/^\s*<(!doctype|html)/i.test(text)) throw new Error('الرابط يعيد صفحة ويب وليس ملف CSV — تأكد أنه منشور كـ CSV');
  return text.replace(/^\uFEFF/, '');
};

async function fetchFromSheet(config) {
  if (!config.sheetUrl) throw new Error('لم يتم تحديد رابط المصدر');
  const text = await fetchText(config.sheetUrl);
  return mapTable(parseCsv(text));
}

// ===== الليدز التجريبية من أداة اختبار ميتا =====
// أداة «Create test lead» تكتب قيماً حرفية مثل: "<test lead: dummy data for phone_number>".
// هذه ليست أرقاماً حقيقية، فلو قبلناها كأرقام ستفشل — ولو رفضناها لن يستطيع أحد تجربة النظام.
// الحل: نُميّزها، ونولّد لها رقماً مصرياً صالحاً مشتقاً من معرّف الليد (ثابت لا يتغير)،
// ونوسمها في وصف الليد بأنها «تجريبية» حتى لا تختلط بأرقام حقيقية.
const TEST_LEAD_RE = /dummy data|<\s*test lead/i;

export const isTestLeadValue = (value) => TEST_LEAD_RE.test(String(value || ''));

// رقماً مصرياً صالحاً من ١١ رقماً مشتقاً من معرّف الليد (ثابت لا يتغير لكل ليد تجريبي)
const MOBILE_PREFIXES = ['010', '011', '012', '015'];

const demoPhoneFor = (leadId) => {
  const digits = String(leadId || '').replace(/\D/g, '').padStart(9, '0');
  const prefix = MOBILE_PREFIXES[Number(digits.slice(-1)) % MOBILE_PREFIXES.length];
  return `${prefix}${digits.slice(-8)}`;
};

const readField = (fieldData, keys) => {
  for (const item of fieldData || []) {
    const name = String(item?.name || '').toLowerCase().trim();
    if (keys.some((key) => name === key || name.includes(key))) {
      const value = Array.isArray(item.values) ? item.values[0] : item.values;
      if (value) return String(value);
    }
  }
  return '';
};

// وقت الليد من فيسبوك: يرجع أحياناً نصاً ISO مثل "2026-09-24T10:04:53+0000" وأحياناً رقماً بالثواني.
// نحوله دائماً إلى ثوانٍ unix حتى يعمل مؤشر «آخر سحب» ولا نعيد جلب كل الأرقام كل دورة.
// نص التاريخ المخزّن في وصف الرقم — نجعله مقروءاً بدل ISO خام (2026-09-23T11:30:19.000Z)
const readableDateTime = (value) => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  const hours = date.getHours();
  const period = hours < 12 ? 'ص' : 'م';
  const hour12 = hours % 12 === 0 ? 12 : hours % 12;
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()} - ${pad(hour12)}:${pad(date.getMinutes())} ${period}`;
};

const toUnixSeconds = (value) => {
  const n = Number(value);
  if (Number.isFinite(n) && n > 1e9) return Math.floor(n);
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : 0;
};

async function fetchFromMeta(config, channel = 'facebook') {
  const label = CHANNEL_LABELS[channel] || CHANNEL_LABELS.facebook;
  if (!config.forms?.length) throw new Error('لم تختر نموذجاً (فورم) بعد — أضف معرّف النموذج أو اضغط «استكشف صفحاتي» واختر النماذج');

  const pageToken = (pageId) => config.pages?.find((p) => p.id === pageId)?.token;
  // نموذج بمعرّفه فقط: يكفي توكن المستخدم (أو توكن الصفحة العامة) للسحب من /{form-id}/leads
  const fallbackToken = String(config.token || '').trim();
  const leads = [];
  const errors = [];
  let succeeded = 0;
  const baseCursor = Number(config.cursorTime) || 0;
  const cursors = { ...(config.formCursors || {}) };

  for (const form of config.forms) {
    const token = pageToken(form.pageId) || String(form.token || '').trim() || fallbackToken;
    if (!token) {
      errors.push(`لا يوجد توكن لسحب النموذج «${form.name || form.id}»`);
      continue;
    }

    // مؤشر مستقل لكل فورم: سحب فورم جديد لا يتأثر بمؤشر فورم آخر.
    // الإعداد القديم (فورم واحد) يستخدم cursorTime العام مرة واحدة.
    const hasCursor = Object.prototype.hasOwnProperty.call(cursors, form.id);
    const formCursor = hasCursor
      ? Number(cursors[form.id]) || 0
      : (config.forms.length === 1 ? baseCursor : 0);

    const params = { fields: 'created_time,field_data', limit: '200', access_token: token };
    // نطلب من فيسبوك الأرقام الأحدث من آخر سحب لهذا الفورم فقط
    if (formCursor) {
      params.filtering = JSON.stringify([{ field: 'time_created', operator: 'GREATER_THAN', value: formCursor }]);
    }

    try {
      let json;
      try {
        json = await graphGet(`/${form.id}/leads`, params);
      } catch (error) {
        // لو الصلاحية منعت الفلترة، نجلب الأرقام بدون فلتر (التكرار مرفوض لاحقاً تلقائياً)
        if (!isPermissionError(error)) throw error;
        json = await graphGet(`/${form.id}/leads`, { fields: 'created_time,field_data', limit: '200', access_token: token });
      }

      let formMax = formCursor;
      for (const lead of json.data || []) {
        const created = toUnixSeconds(lead.created_time);
        if (created > formMax) formMax = created;

        const rawName = readField(lead.field_data, ['full_name', 'name', 'الاسم', 'اسم']);
        const rawPhone = readField(lead.field_data, ['phone_number', 'phone', 'رقم الهاتف', 'الهاتف', 'الموبايل', 'الجوال']);
        const test = isTestLeadValue(rawPhone) || isTestLeadValue(rawName);

        // ليد تجريبي: نولّد رقماً صالحاً من معرّف الليد ليجرّب المستخدم الدورة كاملة
        // (لا يُرفض إلا لو أُوقف صراحةً — قبوله هو الأصل حتى لو الإعداد لم يُكتب بعد)
        if (test && config.acceptTestLeads === false) continue;

        leads.push({
          name: isTestLeadValue(rawName) || !String(rawName || '').trim() ? (test ? 'عميل تجريبي' : 'عميل بدون اسم') : rawName,
          phone: test ? demoPhoneFor(lead.id) : normalizeEgyptPhone(rawPhone),
          source: `${label} - ${form.name || form.id}${test ? ' • تجريبي' : ''}`,
          // اسم الفورم يُخزَّن صريحاً مع الرقم: التقسيم في «عملاء كامبين» والتوزيع
          // يعتمد عليه، وليس على تحليل نص الوصف (اسم فيه | أو - كان يقتطع).
          formName: String(form.name || form.id),
          date: created ? readableDateTime(new Date(created * 1000)) : '',
          test,
        });
      }
      cursors[form.id] = formMax;
      succeeded += 1;
    } catch (error) {
      // فشل فورم واحد لا يوقف بقية الفورمات — تُسحب الباقية ويُعرض الخطأ لو فشل الكل
      errors.push(`${form.name || form.id}: ${String(error?.message || error)}`);
    }
  }

  config.formCursors = cursors;
  config.cursorTime = Math.max(baseCursor, ...Object.values(cursors).map((value) => Number(value) || 0));
  if (!succeeded && errors.length) throw new Error(errors.join(' | '));
  return leads;
}

// المصدر الفعلي: نحترم اختيار المستخدم، لكن لو الإعداد مضبوط على «ملف منشور» بلا رابط
// بينما يوجد توكن ميتا ونماذج مختارة، فالنية واضحة أنه فيسبوك — ولا نتركه يفشل بصمت.
export const isMetaSource = (config) =>
  config.type === 'meta' || (!String(config.sheetUrl || '').trim() && !!config.token && !!(config.forms || []).length);

// السحب من قناة واحدة. أرقام قناة إنستجرام تُوسم بمصدرها حتى لو جاءت من ملف منشور
// فتعرف من نظرة واحدة أي كامبين جاء منها الرقم.
export const fetchLeads = async (config, channel = 'facebook') => {
  const rows = isMetaSource(config) ? await fetchFromMeta(config, channel) : await fetchFromSheet(config);
  if (channel !== 'instagram') return rows;
  const label = CHANNEL_LABELS.instagram;
  return rows.map((row) => ({
    ...row,
    source: String(row.source || '').includes(label) ? row.source : `${label} - ${row.source || 'استيراد تلقائي'}`,
  }));
};

// ===== صلاحية التوكن: متى ينتهي؟ =====
// فيسبوك يخبّرنا بموعد انتهاء أي توكن عبر /debug_token (expires_at بالثواني، و٠ = لا ينتهي).
// به ننبّه الإدارة قبل انتهاء التوكن بيومين — فلا يتوقف سحب الأرقام فجأة بصمت.
export async function debugToken(token) {
  try {
    const json = await graphGet('/debug_token', { input_token: token, access_token: token });
    const data = json.data || {};
    return { valid: data.is_valid !== false, expiresAt: Number(data.expires_at) || 0 };
  } catch {
    return null; // التشخيص اختياري — فشله لا يمنع الاستكشاف ولا السحب
  }
}

// قبل كم يوم ننبّه؟ (يومان كما طُلب — قابل للتغيير من هنا)
export const TOKEN_REMIND_BEFORE_MS = 2 * 24 * 60 * 60 * 1000;

// تنبيهات انتهاء صلاحية توكنات السحب — تُمرَّر إلى محرك الإشعارات ليصلها الإدارة
// على أجهزتها حتى لو الموقع مقفول. التنبيه يتكرر كل ١٢ ساعة حتى يُجدَّد التوكن،
// ومعرّف التنبيه يحتوي ميعاد الانتهاء — فبمجرد التجديد يصبح تنبيهاً جديداً لا حاجة له.
export function tokenExpiryAlerts(config = {}, now = Date.now()) {
  const alerts = [];
  for (const channel of CHANNELS) {
    const cfg = channelConfigOf(config, channel) || {};
    const expiresAt = Number(cfg.tokenExpiresAt) || 0;
    const hasToken = !!(String(cfg.token || '').trim() || cfg.hasToken);
    if (!expiresAt || !hasToken) continue; // لا توكن أو ميعاد غير معروف
    const msLeft = expiresAt * 1000 - now;
    if (msLeft > TOKEN_REMIND_BEFORE_MS) continue; // باقي أكثر من يومين — لا إزعاج
    const label = CHANNEL_LABELS[channel];
    const expired = msLeft <= 0;
    const days = Math.max(1, Math.round(msLeft / (24 * 60 * 60 * 1000)));
    alerts.push({
      id: `lead-token-${channel}-${expiresAt}`,
      title: expired ? `⛔ انتهى توكن سحب ${label} — السحب متوقف` : `⏰ توكن سحب ${label} ينتهي قريباً`,
      body: expired
        ? `ولّد توكن جديداً من Graph API Explorer وألصقه في إعدادات سحب الأرقام (${label}) — حتى لا يتوقف وصول أرقام الكامبينات.`
        : `باقٍ ${days} يوم على انتهاء توكن سحب ${label} — ولّد توكن جديداً وألصقه قبل انتهائه حتى لا يتوقف السحب تلقائياً.`,
      url: '/',
    });
  }
  return alerts;
}

// --- الاستكشاف: كل صفحات المستخدم التي يديرها (أدمن/مشرف) + نماذج كل صفحة ---
// الهدف: لا تضيع أي صفحة. ثلاثة أسباب كانت تُخفي صفحات فعلياً:
//   ١) طلب واحد فقط بلا متابعة «التالي» — كل ما بعد أول ١٠٠ صفحة كان يضيع.
//   ٢) الصفحة التي لا يرجع فيسبوك توكنها في القائمة كانت تُهمل بصمت (سبب «صفحة واحدة فقط»).
//   ٣) صفحات الأعمال (Business Manager) لا تظهر في /me/accounts أصلاً — تُجلب من هنا وتُدمج.
export async function discoverPages(token) {
  if (!token) throw new Error('ألصق التوكن أولاً');

  const byId = new Map();
  let firstError = null;

  // ١) صفحات المستخدم — مع متابعة «التالي» حتى آخر دفعة (١٠ طلبات كحد أقصى)
  let after = '';
  for (let request = 0; request < 10; request += 1) {
    const params = { fields: 'id,name,access_token', limit: '100', access_token: token };
    if (after) params.after = after;
    let json;
    try {
      json = await graphGet('/me/accounts', params);
    } catch (error) {
      if (!firstError) firstError = error;
      break;
    }
    for (const row of json.data || []) {
      if (!row || !row.id) continue;
      const id = String(row.id);
      const prev = byId.get(id) || {};
      byId.set(id, {
        id,
        name: row.name || prev.name || id,
        token: String(row.access_token || prev.token || '').trim(),
      });
    }
    after = json.paging?.cursors?.after || '';
    if (!after || !(json.data || []).length) break;
  }

  // ٢) صفحات الأعمال: صفحات الأدمن داخل Business Manager قد لا تظهر في /me/accounts أبداً
  // (يحتاج business_management) — نجلبها وندمجها، وفشلها لا يمنع بقية الاستكشاف.
  try {
    const json = await graphGet('/me/businesses', {
      fields: 'id,name,owned_pages{id,name,access_token}',
      limit: '100',
      access_token: token,
    });
    for (const business of json.data || []) {
      for (const row of business?.owned_pages?.data || []) {
        if (!row || !row.id) continue;
        const id = String(row.id);
        const prev = byId.get(id) || {};
        byId.set(id, {
          id,
          name: row.name || prev.name || id,
          token: String(row.access_token || prev.token || '').trim(),
        });
      }
    }
  } catch {
    // business_management غير ممنوح لهذه الجلسة — نكتفي بصفحات /me/accounts
  }

  if (!byId.size) {
    throw firstError || new Error('التوكن صحيح لكنه لا يرى أي صفحة — تأكد أنك اخترت صلاحيات الصفحات عند توليد التوكن وأن لديك صفحة');
  }

  // ٣) الصفحات التي لم يرجع فيسبوك توكنها في القائمة: نطلب توكن كل واحدة على حدة.
  // (هذا هو سبب «مطلع صفحة واحدة» — الصفحة التي تسقط توكناتها كانت تُهمل صامتاً.)
  const pages = [];
  const skipped = [];
  for (const page of byId.values()) {
    if (page.token) {
      pages.push(page);
      continue;
    }
    try {
      const info = await graphGet(`/${page.id}`, { fields: 'access_token,name', access_token: token });
      if (info.access_token) {
        pages.push({ id: page.id, name: info.name || page.name, token: String(info.access_token).trim() });
        continue;
      }
    } catch {
      /* تُعرض في التحذير أدناه */
    }
    skipped.push(page.name || page.id);
  }

  let warning = '';
  if (skipped.length) {
    warning = `تم تجاهل ${skipped.length} صفحة لأن فيسبوك لم يمنح توكنها: ${skipped.join('، ')} — أعد توليد التوكن مع صلاحية pages_manage_ads.`;
  }

  // ٤) ميعاد انتهاء صلاحية التوكن — نحفظه لننبّه قبل انتهائه بيومين
  const debug = await debugToken(token);
  const tokenExpiresAt = debug && debug.expiresAt > 0 ? debug.expiresAt : 0;

  return { pages, warning, tokenExpiresAt };
}

export async function fetchFormsForPage(pageId, pageToken) {
  let json;
  try {
    json = await graphGet(`/${pageId}/leadgen_forms`, {
      fields: 'id,name,status,leads_count',
      limit: '100',
      access_token: pageToken,
    });
  } catch (error) {
    // حقل status/leads_count قد يحتاج صلاحية إضافية — نكتفي بالحد الأدنى لنجلب النماذج
    if (!isPermissionError(error)) throw error;
    json = await graphGet(`/${pageId}/leadgen_forms`, { fields: 'id,name', limit: '100', access_token: pageToken });
  }
  return (json.data || [])
    .filter((form) => form.status !== 'DELETED')
    .map((form) => ({
      id: String(form.id),
      pageId: String(pageId),
      name: form.name || form.id,
      leadsCount: Number(form.leads_count) || 0,
    }));
}

// --- الإعدادات ---
// كل إعداد يُقرأ من أي مكان (ملف على سيرفر الشركة ، قاعدة بيانات على الاستضافة)
// يمرّ من هنا: القيم الناقصة تُكمَّل من الافتراضي بدل أن تتحول إلى undefined.
// (هذا ما كان يُسقط الأرقام التجريبية على الاستضافة لأن مفتاح acceptTestLeads غير مكتوب.)
export const normalizeConfig = (stored = {}) => ({
  ...DEFAULTS,
  ...(stored || {}),
  instagram: { ...DEFAULTS.instagram, ...((stored || {}).instagram || {}) },
});

export function loadConfig(configFile) {
  try {
    return normalizeConfig(JSON.parse(fs.readFileSync(configFile, 'utf8')));
  } catch {
    return normalizeConfig({});
  }
}

export function saveConfig(configFile, patch) {
  const next = { ...loadConfig(configFile), ...patch };
  fs.mkdirSync(path.dirname(configFile), { recursive: true });
  fs.writeFileSync(configFile, JSON.stringify(next, null, 2), 'utf8');
  return next;
}

// شكل آمن للواجهة: لا يُرسل أي توكن أبداً — فقط هل يوجد توكن محفوظ
const publicChannel = (config = {}) => ({
  enabled: !!config.enabled,
  type: config.type === 'meta' ? 'meta' : 'sheet',
  sheetUrl: config.sheetUrl || '',
  pages: (config.pages || []).map((p) => ({ id: p.id, name: p.name })),
  forms: (config.forms || []).map((f) => ({ id: f.id, pageId: f.pageId, name: f.name })),
  intervalMinutes: config.intervalMinutes || DEFAULTS.intervalMinutes,
  perSalesLimit: Number(config.perSalesLimit) || 0,
  hasToken: !!config.token,
  // ميعاد انتهاء التوكن (ثواني) — تُحسب منه «أيام متبقية» للتنبيه قبل الانتهاء
  tokenExpiresAt: Number(config.tokenExpiresAt) || 0,
  lastRun: config.lastRun || null,
});

export const publicConfig = (config = {}) => ({
  ...publicChannel(config),
  acceptTestLeads: config.acceptTestLeads !== false,
  instagram: publicChannel(config.instagram || DEFAULTS.instagram),
});

// --- التنظيف والحفظ بلا أي تخزين ---
// الرقم يدخل دائماً «غير مخصص» (salesId = '')، ولا يُوزَّع على أحد تلقائياً.
// كان هنا توزيع بالتناوب على السيلز، وأُزيل لأن الرقم كان يصل لمندوب لم يطلبه
// قبل أن تراه الإدارة — والتوزيع الآن قرار بشري من تبويب «توزيع الأرقام».
export function buildAssignments({ fetched, knownPhones = [], at = new Date().toISOString() }) {
  const seen = new Set((knownPhones || []).map((p) => normalizeEgyptPhone(p)).filter(Boolean));
  const added = [];
  let duplicates = 0;
  let invalid = 0;

  for (const row of fetched || []) {
    if (added.length >= MAX_PER_RUN) break;
    if (!isValidPhone(row.phone)) {
      invalid += 1;
      continue;
    }
    if (seen.has(row.phone)) {
      duplicates += 1;
      continue;
    }
    seen.add(row.phone);

    const baseLead = {
      id: crypto.randomUUID(),
      adminId: 'auto-import',
      name: row.name || 'عميل بدون اسم',
      phone: row.phone,
      description: [
        row.test ? '🧪 رقم تجريبي (من أداة اختبار ميتا)' : 'استيراد تلقائي',
        row.source && `المصدر: ${row.source}`,
        row.date && `التاريخ: ${row.date}`,
      ]
        .filter(Boolean)
        .join(' • '),
      status: 'new',
      createdAt: at,
      salesId: '',
      ...(row.formName ? { formName: String(row.formName) } : {}),
    };

    added.push(baseLead);
  }

  return {
    added,
    duplicates,
    invalid,
    assignCursor: 0,
    unassigned: added.length,
    perUser: [],
  };
}

// --- التنظيف + التوزيع + الحفظ ---
// القلب المشترك: يعمل مع أي مخزن (ملف JSON على سيرفر الشركة، أو Redis على الاستضافة).
// وجوده في مكان واحد يعني أن التوزيع التلقائي في الخلفية يعطي نفس النتيجة تماماً
// سواء شغّله السيرفر المحلي أو مُشغّل دوري على الاستضافة.
//   storage    : { load, save }   — مخزن بيانات النظام (crm_users / crm_assigned_leads)
//   config     : كائن الإعدادات (يُعدَّل في مكانه: assignCursor و cursorTime و lastRun)
//   saveConfig : دالة تحفظ الإعدادات بعد التعديل (حتى لا يعيد جلب نفس الأرقام)
// ===== جمع الأرقام من كل قناة مفعّلة =====
// كل قناة تُسحب على حدة: فشل إحداهما لا يوقف الأخرى (توكن فيسبوك منتهٍ لا يمنع
// سحب إنستجرام والعكس)، ومؤشر آخر سحب يخص كل قناة وحدها فلا تتكرر أرقامها.
export async function collectLeads(config) {
  const rows = [];
  const channels = {};

  for (const channel of CHANNELS) {
    const cfg = channelConfigOf(config, channel);
    const label = CHANNEL_LABELS[channel];
    if (!cfg || !isChannelOn(config, channel)) {
      channels[channel] = null;
      continue;
    }
    if (!isChannelReady(cfg)) {
      channels[channel] = {
        ok: false,
        label,
        source: isMetaSource(cfg) ? `${label} مباشرة` : 'ملف منشور',
        error: isMetaSource(cfg)
          ? 'القناة ناقصة: توكن أو نماذج — الصق التوكن وأضف معرّف النموذج'
          : 'القناة ناقصة: لم يُضبط رابط الملف المنشور',
      };
      continue;
    }

    try {
      const fetched = await fetchLeads(cfg, channel);
      rows.push(...fetched);
      channels[channel] = {
        ok: true,
        label,
        source: isMetaSource(cfg) ? `${label} مباشرة` : 'ملف منشور',
        fetched: fetched.length,
      };
    } catch (error) {
      channels[channel] = {
        ok: false,
        label,
        source: isMetaSource(cfg) ? `${label} مباشرة` : 'ملف منشور',
        error: String(error?.message || error),
      };
    }
  }

  return { rows, channels };
}

export async function runAutoImportCore({ storage, config, saveConfig: persist, force = false }) {
  const at = new Date().toISOString();

  // احترام «كل كم دقيقة يسحب؟»: لو السحب الأخير قريب، نتخطى هذه الدورة
  // (الطلب اليدوي force=true يتخطى الانتظار). نأخذ أقصر فاصل بين القنوات المفعّلة.
  const intervals = [Number(config.intervalMinutes) || 5];
  if (config.instagram?.enabled) intervals.push(Number(config.instagram.intervalMinutes) || 5);
  const intervalMinutes = Math.min(Math.max(Math.round(Math.min(...intervals)), 1), 1440);
  const lastRunAt = Math.max(
    Date.parse(config.lastRun?.at || '') || 0,
    Date.parse(config.instagram?.lastRun?.at || '') || 0
  );
  if (!force && Number.isFinite(lastRunAt)) {
    const elapsed = Date.now() - lastRunAt;
    if (elapsed >= 0 && elapsed < intervalMinutes * 60_000) {
      return {
        ...(config.lastRun || {}),
        ok: true,
        skipped: true,
        at,
        nextAt: new Date(lastRunAt + intervalMinutes * 60_000).toISOString(),
        intervalMinutes,
      };
    }
  }

  try {
    const db = await storage.load();
    const data = db.data || {};
    const { rows: fetched, channels } = await collectLeads(config);
    const active = CHANNELS.filter((channel) => channels[channel]);
    if (!active.length) throw new Error('لا توجد قناة سحب مفعّلة — شغّل «فيسبوك» أو «إنستجرام» من تبويبه');
    // كل القنوات فشلت: نُظهر أول خطأ كما كان يظهر سابقاً بدل رسالة نجاح كاذبة
    if (!active.some((channel) => channels[channel].ok)) {
      throw new Error(channels[active[0]].error || 'تعذّر السحب من كل القنوات المفعّلة');
    }

    const assigned = Array.isArray(data.crm_assigned_leads) ? data.crm_assigned_leads : [];
    const clients = Array.isArray(data.crm_clients) ? data.crm_clients : [];
    const knownPhones = [
      ...assigned.map((l) => l.phone),
      ...clients.flatMap((c) => [c.phone, ...(c.phones || [])]),
    ];

    const built = buildAssignments({ fetched, knownPhones, at });

    // ===== التوزيع التلقائي: فورم اختارت له الإدارة مندوبين بعينهم =====
    // القاعدة تُطبَّق هنا لحظة الوصول، فالأرقام تُسحب وتُوزَّع ٢٤/٧ بلا متصفح مفتوح،
    // ومن ليس في قائمة الفورم لا يصله منه رقم (كل رقم يُوزَّع على مختاريه وحدهم).
    const rules = parseRules(data[AUTO_ASSIGN_KEY]);
    const activeSalesIds = (Array.isArray(data.crm_users) ? data.crm_users : [])
      .filter((user) => user && user.isActive !== false && (user.role === 'sales' || user.role === 'supervisor'))
      .map((user) => String(user.id));
    const auto = rules.length
      ? applyAutoRules({
          leads: built.added,
          rules,
          activeSalesIds,
          // الأرقام الجديدة تحمل formName صريحاً، وهو مفتاح القاعدة نفسه
          formOf: (lead) => String(lead?.formName || ''),
        })
      : { leads: built.added, assignments: [], byRule: {} };

    if (auto.leads.length) {
      data.crm_assigned_leads = [...auto.leads, ...assigned];
      await storage.save({ version: (Number(db.version) || 0) + 1, data });
    }

    const labels = active.map((channel) => CHANNEL_LABELS[channel]).join(' + ');
    const summary = {
      at,
      ok: true,
      source: labels,
      fetched: fetched.length,
      added: built.added.length,
      duplicates: built.duplicates,
      invalid: built.invalid,
      perUser: built.perUser,
      unassigned: Math.max(built.unassigned - auto.assignments.length, 0),
      autoAssigned: auto.assignments.length,
      autoByForm: auto.byRule,
      channels,
    };
    config.assignCursor = built.assignCursor;
    // مؤشر "آخر سحب" يُحفظ في القناة نفسها حتى تعرض كل تبويب نتيجته بصدق
    if (channels.facebook) config.lastRun = summary;
    if (channels.instagram && config.instagram) config.instagram.lastRun = summary;
    await persist(config);
    return summary;
  } catch (error) {
    const summary = {
      at,
      ok: false,
      source: 'كل القنوات',
      error: String(error?.message || error),
    };
    config.lastRun = summary;
    await persist(config);
    return summary;
  }
}

// غلاف سيرفر الشركة المحلي: الإعدادات في ملف والتخزين في ملف
export async function runAutoImport({ storeFile, configFile, force = false }) {
  const storage = fileStorage(storeFile);
  const config = loadConfig(configFile);
  return runAutoImportCore({
    storage,
    config,
    force,
    saveConfig: (next) => Promise.resolve(saveConfig(configFile, next)),
  });
}

// ===== تطبيق تعديلات الواجهة على إعدادات قناة بعينها =====
// مكان واحد يمنع اختلاف سلوك الواجهة المحلية وواجهة الاستضافة: نفس المفاتيح،
// ونفس الحفاظ على توكن الصفحة القديم لو أرسلت الواجهة الصفحات بلا توكن.
export function applyChannelPatch(config, body = {}) {
  const channel = body.channel === 'instagram' ? 'instagram' : 'facebook';
  const current = channelConfigOf(config, channel) || {};
  const patch = {};

  if (typeof body.enabled === 'boolean') patch.enabled = body.enabled;
  if (body.type === 'sheet' || body.type === 'meta') patch.type = body.type;
  if (typeof body.sheetUrl === 'string') patch.sheetUrl = body.sheetUrl.trim();

  if (Array.isArray(body.pages)) {
    patch.pages = body.pages
      .filter((p) => p && typeof p.id === 'string')
      .map((p) => ({
        id: String(p.id),
        name: String(p.name || p.id),
        token: typeof p.token === 'string' && p.token ? p.token : (current.pages || []).find((old) => old.id === String(p.id))?.token || '',
      }));
  }
  if (Array.isArray(body.forms)) {
    patch.forms = body.forms
      .filter((f) => f && typeof f.id === 'string' && f.id.trim())
      .map((f) => ({
        id: String(f.id).trim(),
        // نموذج بمعرّفه فقط: pageId فاضي مقصود — السحب يستخدم توكن القناة
        pageId: typeof f.pageId === 'string' ? String(f.pageId) : '',
        name: String(f.name || f.id),
      }));
  }
  if (typeof body.token === 'string' && body.token.trim()) patch.token = body.token.trim();
  if (body.clearToken) {
    patch.token = '';
    patch.tokenExpiresAt = 0; // توكن مُمسوح: لا تنبيه انتهاء لتوكن لم يعد موجوداً
  }
  // ميعاد انتهاء صلاحية التوكن (ثواني، ٠ = لا ينتهي أو مجهول) — يصل من الاستكشاف
  if (Number.isFinite(Number(body.tokenExpiresAt)) && Number(body.tokenExpiresAt) >= 0) {
    patch.tokenExpiresAt = Number(body.tokenExpiresAt);
  }
  if (body.resetCursor) {
    patch.cursorTime = 0;
    patch.formCursors = {};
  }

  const minutes = Number(body.intervalMinutes);
  if (Number.isFinite(minutes)) patch.intervalMinutes = Math.min(Math.max(Math.round(minutes), 1), 1440);

  const next = { ...config };
  if (channel === 'instagram') next.instagram = { ...(config.instagram || {}), ...patch };
  else Object.assign(next, patch);
  // تصفير مؤشر التوزيع يخص النظام كله (مناوبة واحدة على المندوبين)
  if (body.resetCursor) next.assignCursor = 0;

  // عدد الأرقام لكل مندوب سياسة توزيع مشتركة بين القناتين — لا تُحفظ داخل قناة
  // واحدة وإلا صارت بلا أثر (التوزيع يجري مرة واحدة على الدفعة المجمّعة).
  const perSales = Number(body.perSalesLimit);
  if (Number.isFinite(perSales)) next.perSalesLimit = Math.min(Math.max(Math.round(perSales), 0), 1000);

  // لا يوجد توزيع تلقائي إطلاقاً: كل رقم يدخل «غير مخصص» وتوزّعه الإدارة بنفسها.
  delete next.autoAssign;

  return next;
}

// --- واجهة الإعدادات (تُستخدم من تبويبات فيسبوك/إنستجرام في التطبيق) ---
const readJsonBody = (req) =>
  new Promise((resolve) => {
    if (req.body !== undefined && req.body !== null) {
      if (typeof req.body === 'object') return resolve(req.body);
      try {
        return resolve(JSON.parse(req.body));
      } catch {
        return resolve(null);
      }
    }
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 2 * 1024 * 1024) req.destroy();
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(body || '{}'));
      } catch {
        resolve(null);
      }
    });
    req.on('error', () => resolve(null));
  });

const reply = (res, status, payload) => {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
};

// auth اختياري: متغيّرات البيئة التي فيها AUTH_SECRET.
// عند تمريره لا يعمل أي شيء بلا جلسة صحيحة — لأن هنا توكن فيسبوك وبيانات العملاء.
export function createLeadSourceHandler({ storeFile, configFile, auth = null }) {
  return async function handle(req, res) {
    try {
      const [url] = (req.url || '').split('?');

      if (auth) {
        if (!authConfigured(auth)) {
          return reply(res, 503, { ok: false, error: 'auth not configured', hint: 'أضف AUTH_SECRET ثم أعد التشغيل.' });
        }
        const session = sessionFromRequest(auth, req);
        if (!session) return reply(res, 401, { ok: false, error: 'unauthorized' });
        if (!isManagerRole(session.r)) return reply(res, 403, { ok: false, error: 'forbidden' });
      }

      if (req.method === 'GET' && url === '/api/lead-source') {
        const config = loadConfig(configFile);
        return reply(res, 200, { ok: true, config: publicConfig(config) });
      }

      if (req.method === 'POST' && url === '/api/lead-source') {
        const body = await readJsonBody(req);
        if (!body) return reply(res, 400, { ok: false, error: 'طلب غير صالح' });

        // نفس مسار الاستضافة: زر «جلب الأرقام الآن» يرسل action=run
        if (body.action === 'run') {
          const summary = await runAutoImport({ storeFile, configFile, force: true });
          return reply(res, 200, { ok: true, summary, config: publicConfig(loadConfig(configFile)) });
        }

        const current = loadConfig(configFile);
        // المفاتيح العامة للنظام (لیست لقناة بعينها)
        const globalPatch = typeof body.acceptTestLeads === 'boolean' ? { acceptTestLeads: body.acceptTestLeads } : {};
        // لو الواجهة ألصقت توكن جديداً مباشرة (بلا استكشاف) نسجّل ميعاد انتهائه حتى يستمر التنبيه
        const pastedToken = typeof body.token === 'string' && body.token.trim() && !body.clearToken ? body.token.trim() : '';
        const expiryPatch = pastedToken ? { tokenExpiresAt: (await debugToken(pastedToken))?.expiresAt || 0 } : {};
        const saved = saveConfig(configFile, { ...applyChannelPatch(current, { ...body, ...expiryPatch }), ...globalPatch });
        return reply(res, 200, { ok: true, config: publicConfig(saved) });
      }

      if (req.method === 'POST' && url === '/api/lead-source/discover') {
        const body = await readJsonBody(req);
        const current = loadConfig(configFile);
        const channel = body?.channel === 'instagram' ? 'instagram' : 'facebook';
        const channelCfg = channelConfigOf(current, channel) || {};
        const token = String(body?.token || '').trim() || channelCfg.token || '';
        const { pages, warning, tokenExpiresAt } = await discoverPages(token);
        // نحفظ التوكن وبيانات الصفحات في قناته كي يعمل السحب لاحقاً بدون إعادة لصق
        saveConfig(configFile, applyChannelPatch(current, { channel, token, pages, tokenExpiresAt }));
        return reply(res, 200, {
          ok: true,
          pages: pages.map((p) => ({ id: p.id, name: p.name })),
          warning,
          tokenExpiresAt,
        });
      }

      if (req.method === 'POST' && url === '/api/lead-source/page-forms') {
        const body = await readJsonBody(req);
        const current = loadConfig(configFile);
        const channel = body?.channel === 'instagram' ? 'instagram' : 'facebook';
        const channelCfg = channelConfigOf(current, channel) || {};
        const page = (channelCfg.pages || []).find((p) => p.id === String(body?.pageId || ''));
        if (!page) return reply(res, 404, { ok: false, error: 'الصفحة غير موجودة في إعدادات هذه القناة — أعد الاستكشاف' });
        const forms = await fetchFormsForPage(page.id, page.token);
        return reply(res, 200, { ok: true, forms });
      }

      if (req.method === 'POST' && url === '/api/lead-source/run') {
        // طلب يدوي من زر «جلب الأرقام الآن»: يتخطى انتظار الخمس دقائق
        const summary = await runAutoImport({ storeFile, configFile, force: true });
        return reply(res, 200, { ok: true, summary, config: publicConfig(loadConfig(configFile)) });
      }

      return reply(res, 404, { ok: false, error: 'not found' });
    } catch (error) {
      return reply(res, 500, { ok: false, error: String(error?.message || error) });
    }
  };
}

// --- التشغيل الدوري ---
export function startAutoImport({ storeFile, configFile, log = console.log }) {
  const timer = setInterval(async () => {
    const config = loadConfig(configFile);
    if (!CHANNELS.some((channel) => isChannelOn(config, channel))) return;      const summary = await runAutoImport({ storeFile, configFile });
    if (summary.ok && summary.added > 0) {
      log(`[auto-import] دخل ${summary.added} رقم جديد (مكرر: ${summary.duplicates}، غير صالح: ${summary.invalid})`);
    } else if (!summary.ok) {
      log(`[auto-import] فشل السحب: ${summary.error}`);
    }
  }, 60 * 1000);

  if (typeof timer.unref === 'function') timer.unref();
  return () => clearInterval(timer);
}
