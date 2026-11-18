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
import { applyAutoRules, AUTO_ASSIGN_KEY, isAssignableSales, parseRules } from '../shared/autoAssign.js';
// تحويل الرقم الموزَّع إلى عميل صاحبه — نفس دالة الواجهة (معرّف مشتق من الرقم)
import { buildLeadClients } from '../shared/leadClients.js';
import { buildRepeats, LEAD_REPEATS_KEY } from '../shared/leadRepeats.js';
import { answersFromFields, buildAnswerEntries, LEAD_ANSWERS_KEY } from '../shared/leadAnswers.js';

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
  extraForms: [], // [name] — فورمات مبنية من رفع شيت (أسماء فقط، لا تُسحب منها أرقام)
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

// إعادة سحب تاريخي كامل لقناة: تصفير مؤشرات آخر سحب حتى تُقرأ أرقام الكامبين من جديد.
// آمنة تماماً: السحب يمنع التكرار بمقارنة الهاتف، ومعرّفات الأرقام تُولَّد جديدة
// فلو ضاع رقم (بحذف أو جهاز قديم) يعود بدل أن يظل مفقوداً للأبد.
export function resetChannelCursors(config = {}, channel = 'facebook') {
  const clear = (cfg) => ({ ...(cfg || {}), cursorTime: 0, formCursors: {}, lastRun: null });
  if (channel === 'instagram') return { ...config, instagram: clear(config.instagram) };
  const { instagram, ...rest } = config;
  return { ...clear(rest), ...(instagram ? { instagram } : {}) };
}

export const isChannelOn = (config, channel) => {
  const cfg = channelConfigOf(config, channel);
  if (!cfg) return false;
  return channel === 'instagram' ? !!cfg.enabled : !!config.enabled;
};

// هل القناة جاهزة فعلاً للسحب؟ (توكن + نماذج، أو رابط ملف منشور)
// لا نشترط «صفحات» لأن النموذج يمكن سحبه بمعرّفه فقط: /{form-id}/leads
export const isChannelReady = (config) => {
  if (!config) return false;
  if (isMetaSource(config)) return !!(hasAnyUsableToken(config) && config.forms?.length);
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

// خطأ «التوكن غير صالح أو انتهت صلاحيته» (كود 190 من فيسبوك):
// هو الوحيد الذي يستحق تجريب توكن آخر — أما خطأ الصلاحيات فيبقى كما هو.
export const isTokenError = (error) =>
  error?.code === 190 ||
  /غير صالح أو انتهت|انتهت صلاحيته|Invalid OAuth|OAuthException|invalid_token/i.test(String(error?.message || ''));

const graphGet = async (path, params, timeoutMs = 20000) => {
  const url = new URL(`${GRAPH_BASE}${path}`);
  for (const [key, value] of Object.entries(params || {})) url.searchParams.set(key, value);
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  const json = await res.json().catch(() => ({}));
  if (json.error) {
    const message = String(json.error.message || 'خطأ من فيسبوك');
    const code = json.error.code;
    const permission = permissionOf(message);

    if (code === 190) {
      const error = new Error('التوكن غير صالح أو انتهت صلاحيته — ولّد توكن جديداً والصقه هنا');
      error.code = 190;
      throw error;
    }
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
    // سلسلة توكنات تجرّب واحدة واحدة: توكن صفحة النموذج أولاً، ثم بقية توكنات
    // الصفحات (فهي لا تنتهي)، ثم توكن المستخدم. فسحب النموذج لا يتوقف لمجرد
    // انتهاء توكن المستخدم — المشكلة التي كانت تُوقف الأرقام كل فترة.
    const candidates = [
      pageToken(form.pageId),
      String(form.token || '').trim(),
      ...(config.pages || []).map((p) => String(p?.token || '').trim()),
      fallbackToken,
    ].filter(Boolean);
    const tokens = [...new Set(candidates)];
    if (!tokens.length) {
      errors.push(`لا يوجد توكن لسحب النموذج «${form.name || form.id}»`);
      continue;
    }

    // مؤشر مستقل لكل فورم: سحب فورم جديد لا يتأثر بمؤشر فورم آخر.
    // الإعداد القديم (فورم واحد) يستخدم cursorTime العام مرة واحدة.
    const hasCursor = Object.prototype.hasOwnProperty.call(cursors, form.id);
    const formCursor = hasCursor
      ? Number(cursors[form.id]) || 0
      : (config.forms.length === 1 ? baseCursor : 0);

    const params = { fields: 'created_time,field_data', limit: '200', access_token: tokens[0] };
    // نطلب من فيسبوك الأرقام الأحدث من آخر سحب لهذا الفورم فقط.
    // نرجع ثانية للوراء: فيسبوك يخزّن الوقت بدقة الثانية، والليدز التي تصل في نفس
    // ثانية آخر ليد تم سحبه كانت تُسقط للأبد بصمت (سبب «الرقمين الناقصين»).
    // التكرار الناتج عن هذه الثانية مرفوض تلقائياً في buildAssignments فلا ضرر.
    if (formCursor) {
      const from = Math.max(formCursor - 1, 1);
      params.filtering = JSON.stringify([{ field: 'time_created', operator: 'GREATER_THAN', value: from }]);
    }

    try {
      let json = null;
      let lastError = null;
      for (const token of tokens) {
        params.access_token = token;
        try {
          json = await graphGet(`/${form.id}/leads`, params);
          break;
        } catch (error) {
          lastError = error;
          // لو الصلاحية منعت الفلترة، نجلب الأرقام بدون فلتر (التكرار مرفوض لاحقاً تلقائياً)
          if (isPermissionError(error)) {
            try {
              json = await graphGet(`/${form.id}/leads`, { fields: 'created_time,field_data', limit: '200', access_token: token });
              break;
            } catch (retryError) {
              lastError = retryError;
              // خطأ صلاحية أو توكن منتهٍ => نجرّب توكن الصفحة التالي
              if (!isPermissionError(retryError) && !isTokenError(retryError)) throw retryError;
              continue;
            }
          }
          // توكن منتهٍ أو مرفوض => نجرّب توكن الصفحة التالي
          if (!isTokenError(error)) throw error;
        }
      }
      if (!json) throw lastError || new Error(`تعذّر سحب النموذج «${form.name || form.id}»`);

      // ===== متابعة «التالي» في الأرقام =====
      // طلب واحد بيرجع صفحة واحدة بس (فيسبوك بيسقّفها ١٠٠–٢٠٠ حتى لو limit أكبر).
      // من غير المتابعة دي، أي فورم فيه أكثر من صفحة كان بيفقد أرقامه بصمت —
      // نفس سبب «فيسبوك عنده ٣٨ وعندنا ٣٦».
      const extraPages = [];
      let nextUrl = json?.paging?.next || '';
      for (let page = 0; nextUrl && page < 20; page += 1) {
        const res = await fetch(nextUrl, { signal: AbortSignal.timeout(20000) });
        const chunk = await res.json().catch(() => ({}));
        if (!chunk || chunk.error) break;
        extraPages.push(chunk);
        nextUrl = chunk.paging?.next || '';
      }

      let formMax = formCursor;
      for (const lead of [...(json.data || []), ...extraPages.flatMap((chunk) => chunk.data || [])]) {
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
          // وقت التسجيل في الكامبين (وقت الـlead في الفورم) — بيتبان للعميل في كل القوائم
          dateIso: created ? new Date(created * 1000).toISOString() : '',
          test,
          // كلام العميل في الفورم (إجابات الأسئلة) — بيظهر للسيلز من زرار العين
          answers: answersFromFields(lead.field_data),
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
// وجود توكن صفحة يفي بالغرض أيضاً: توكنات الصفحات لا تنتهي، فالسحب يبقى شغّالاً
// حتى لو انتهى توكن المستخدم (اللي بيستخدمه في الاستكشاف فقط).
export const isMetaSource = (config) =>
  config.type === 'meta' ||
  (!String(config.sheetUrl || '').trim() && hasAnyUsableToken(config) && !!(config.forms || []).length);

// أي توكن صالح للاستخدام: توكن المستخدم أو توكن صفحة واحدة على الأقل
export const hasAnyUsableToken = (config = {}) =>
  !!String(config.token || '').trim() ||
  (Array.isArray(config.pages) && config.pages.some((p) => !!String(p?.token || '').trim()));

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

// ===== تشخيص صلاحية التوكن: متى ينتهي؟ =====
// فيسبوك يخبّرنا بموعد انتهاء أي توكن عبر /debug_token (expires_at بالثواني، و٠ = لا ينتهي).
// به ننبّه الإدارة قبل انتهاء التوكن بيومين — فلا يتوقف سحب الأرقام فجأة بصمت.
//
// ===== ملاحظة مهمة (سبب فشل التشخيص سابقاً) =====
// طلب /debug_token لازم يتعمل بـ **App Access Token** (app_id|app_secret) —
// لأنه بيفحص توكن مستخدم. لو مرّرنا توكن المستخدم نفسه كـ access_token
// بتاع الطلب، ميتا بترفض الطلب برمز 190، فنقرأ «ميتاعرفش» (٠) بدل ميعاد الانتهاء
// الحقيقي. والنتيجة: مفيش تمديد، مفيش تاريخ، والتنبيه بيطلع فاضي أو غلط.
// فبنستخدم App Access Token أول ما يكون السر متاح، وبنجرب التوكن نفسه كبديل.
// تشخيص خام: بيرجّع بيانات ميتا كما هي — حتى لو الميعاد مجهول — للتشخيص.
// (بعض توكنات ميتا ما بتحدّدش تاريخ انتهاء، فبنفضل نعرف السبب صريح)
export async function inspectTokenRaw(token, config = {}) {
  const input = String(token || '').trim();
  if (!input) return null;
  const { id, secret, ready } = longLivedCredentials(config);
  const accessTokens = ready ? [input, `${id}|${secret}`] : [input];
  let last = null;
  for (const access of accessTokens) {
    try {
      const url = new URL(`${GRAPH_BASE}/debug_token`);
      url.searchParams.set('input_token', input);
      url.searchParams.set('access_token', access);
      const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
      const json = await res.json().catch(() => ({}));
      if (json.error) {
        last = { error: String(json.error.message || '') };
        continue;
      }
      last = { data: json.data || {} };
      break;
    } catch (error) {
      last = { error: String(error?.message || error) };
    }
  }
  return last;
}

// أقصى عمر للتوكن الممتد قبل ما نعيد تمديده — بنستخدمه لما ميتا ما بتقولش تاريخ انتهاء
export const TOKEN_EXTENDED_MAX_AGE_MS = 20 * 24 * 60 * 60 * 1000;

export async function debugToken(token, config = {}) {
  const input = String(token || '').trim();
  if (!input) return null;
  const { id, secret, ready } = longLivedCredentials(config);
  // ترتيب المحاولات مهم: التوكن نفسه أولاً — ميتا بترجّع بيه بيانات توكن المستخدم
  // كاملة (التاريخ والصلاحيات). أما لو بدأنا بـ App Access Token فميتا بترجّع
  // بيانات التطبيق نفسه (من غير تاريخ انتهاء) فيبقى الميعاد «صفر» والتمديد
  // والتذكير بيشتغلوا على رقم غلط.
  const accessTokens = ready ? [input, `${id}|${secret}`] : [input];
  for (const access of accessTokens) {
    try {
      const json = await graphGet('/debug_token', { input_token: input, access_token: access });
      const data = json.data || {};
      if (data.is_valid === false) continue; // توكن غير صالح => نجرب الوسيلة التالية
      const expiresAt = Number(data.expires_at) || 0;
      const type = String(data.type || '').toUpperCase();
      // نتيجة ناقصة (من غير تاريخ ومن غير نوع صفحة) => مش نتيجة موثوقة
      if (!expiresAt && type !== 'PAGE') continue;
      return {
        valid: true,
        expiresAt,
        // نوع التوكن يهم الاستكشاف: توكن الصفحة (PAGE) لا يرى صفحات المستخدم
        type,
        scopes: Array.isArray(data.scopes) ? data.scopes.map(String) : [],
        profileId: String(data.profile_id || ''),
      };
    } catch {
      /* نجرب وسيلة أخرى */
    }
  }
  return null; // التشخيص اختياري — فشله لا يمنع الاستكشاف ولا السحب
}

// قبل كم يوم ننبّه؟ (يومان كما طُلب — قابل للتغيير من هنا)
export const TOKEN_REMIND_BEFORE_MS = 2 * 24 * 60 * 60 * 1000;

// ===== تمديد التوكن تلقائياً إلى ٦٠ يوماً =====
// Graph API Explorer يعطي «توكن مستخدم قصير» ينتهي في ساعتين — وهو السبب الحقيقي
// لتوقف السحب كل فترة. ميتا تسمح بتبديله بتوكن طويل (٦٠ يوماً) عبر
// oauth/access_token?grant_type=fb_exchange_token، بشرط App ID + App Secret
// (متغيّرا بيئة على السيرفر فقط — لا يُكتبان في الكود ولا في الواجهة).
const EXTEND_BEFORE_MS = 7 * 24 * 60 * 60 * 1000; // نمدّد لما يبقى على الانتهاء أقل من أسبوع

// App ID تطبيق فيسبوك — رقم عام (ميتا تنشره في واجهة التطبيق) وليس سراً.
// من متغيّرات البيئة إن وُجد، وإلا فالقيمة الافتراضية لتطبيق إعمار جروب.
export const DEFAULT_FB_APP_ID = '2010203473000828';

// مفتاح التمديد من مكانين: متغيّر بيئة على السيرفر (لمن يضبطه في Vercel)،
// أو سر التطبيق المحفوظ في إعدادات النظام على الخادم (D1) — وهذا ما يجعل
// التمديد يعمل بلا أي إعداد على لوحة Vercel.
export function longLivedCredentials(config = {}) {
  const id = String(
    process.env.FB_APP_ID || process.env.META_APP_ID || config?.fbAppId || DEFAULT_FB_APP_ID || ''
  ).trim();
  const secret = String(
    process.env.FB_APP_SECRET || process.env.META_APP_SECRET || config?.appSecret || config?.facebook?.appSecret || ''
  ).trim();
  return { id, secret, ready: !!(id && secret) };
}

async function exchangeForLongLived(token, config = {}) {
  const { id, secret, ready } = longLivedCredentials(config);
  if (!ready) return { token: '', expiresAt: 0, error: '' };
  try {
    const url = new URL('https://graph.facebook.com/oauth/access_token');
    url.searchParams.set('grant_type', 'fb_exchange_token');
    url.searchParams.set('client_id', id);
    url.searchParams.set('client_secret', secret);
    url.searchParams.set('fb_exchange_token', token);
    const response = await fetch(url);
    const json = await response.json();
    const accessToken = String(json?.access_token || '').trim();
    if (!accessToken) {
      // ميتا رفضت التبديل — أهم سبب: التوكن صادر من تطبيق تاني
      // (Graph API Explorer issued tokens belong to Meta's Explorer app,
      //  ولا يقبل facebookswap them with another app's credentials).
      const message = String(json?.error?.message || json?.error_message || '').trim();
      return { token: '', expiresAt: 0, error: message };
    }
    const debug = await debugToken(accessToken, config);
    // ميتا بترجّع مدة الصلاحية مع التوكن الجديد (expires_in بالثواني) — دي أدقّ
    // من قراءة debug_token، لأن فحص الصلاحية ممكن يرجع خطأ من ميتا فيبقى الميعاد مجهولاً.
    const expiresIn = Number(json?.expires_in) || 0;
    const expiresAt = expiresIn
      ? Math.floor(Date.now() / 1000) + expiresIn
      : Number(debug?.expiresAt) || 0;
    return { token: accessToken, expiresAt, error: '' };
  } catch (error) {
    // فشل التمديد لا يمنع الاستكشاف — نكمل بالتوكن كما هو
    return { token: '', expiresAt: 0, error: String(error?.message || error) };
  }
}

// يعيد التوكن الصالح للاستخدام: يمدّ القصير (ساعتين) إلى طويل (٦٠ يوماً) لو
// App Secret متاح، ويحسب ميعاد الانتهاء الفعلي في كل الأحوال.
export async function prepareToken(raw, config = {}) {
  const token = String(raw || '').trim();
  if (!token) return { token: '', expiresAt: 0, extended: false, hint: '' };
  const info = await debugToken(token, config);
  const expiresAt = Number(info?.expiresAt) || 0;
  const isPageToken = String(info?.type || '').toUpperCase() === 'PAGE';
  const msLeft = expiresAt ? expiresAt * 1000 - Date.now() : Infinity;

  let finalToken = token;
  let finalExpiry = expiresAt;
  let extended = false;
  let exchangeError = '';
  // التمديد مطلوب لو: الميعاد معروف وقارب على الانتهاء، أو الميعاد مجهول أصلاً
  // (يعني التشخيص ما اشتغلش — نجرّب التبديل على أي حال).
  const shouldExtend = !isPageToken && longLivedCredentials(config).ready && (expiresAt === 0 || msLeft < EXTEND_BEFORE_MS);
  if (shouldExtend) {
    const longLived = await exchangeForLongLived(token, config);
    exchangeError = String(longLived?.error || '');
    if (longLived?.token) {
      finalToken = longLived.token;
      finalExpiry = longLived.expiresAt || 0;
      extended = true;
    }
  }

  // رسالة واحدة واضحة: ليه التوكن فاضل فيه ساعات، وإيه اللازم عشان يبقى ٦٠ يوم
  let hint = '';
  const leftMs = finalExpiry ? finalExpiry * 1000 - Date.now() : Infinity;
  if (extended) {
    const days = finalExpiry ? Math.max(1, Math.round(leftMs / 86400000)) : 60;
    hint = `تم تمديد التوكن تلقائياً — صالح ${days} يوم.`;
  } else if (finalExpiry && leftMs < EXTEND_BEFORE_MS) {
    const hours = Math.max(1, Math.round(leftMs / 3600000));
    const hasSecret = longLivedCredentials(config).ready;
    hint = hasSecret
      ? `التوكن صالح ${hours} ساعة فقط — ولم يتم تمديده${exchangeError ? `: ${exchangeError}` : '. تأكد أن سر التطبيق صحيح في الإعدادات.'}`
      : `التوكن صالح ${hours} ساعة فقط. لتحويله إلى ٦٠ يوماً: أضف «App Secret» في إعدادات هذه القناة (يبقى محفوظاً على السيرفر ولا يُعرض بعد الحفظ).`;
  } else if (exchangeError) {
    hint = `لم يتم تمديد التوكن: ${exchangeError}`;
  }

  return { token: finalToken, expiresAt: finalExpiry, extended, hint, extendedAt: extended ? Date.now() : 0 };
}

// ===== تجديد تلقائي للتوكن قبل انتهائه (بلا تدخل من المستخدم) =====
// المشكلة: توكن Graph API Explorer يعيش ساعتين، فلو لم يُجدَّد توقّف السحب.
// هنا نُجدّد التوكن بأنفسنا في كل دورة سحب: لو التوكن المحفوظ قارب على الانتهاء
// (أو انتهى) نبدّله بتوكن ٦٠ يوماً عبر fb_exchange_token ونحفظه فوراً —
// فالتنبيه بيختفي لوحده من غير ما يضطر المستخدم يلصق توكن جديد كل مرة.
export async function renewExpiringTokens(config = {}, { now = Date.now() } = {}) {
  let next = config;
  const notes = [];
  let changed = false;
  for (const channel of CHANNELS) {
    const cfg = channelConfigOf(config, channel) || {};
    const token = String(cfg.token || '').trim();
    const expiresAt = Number(cfg.tokenExpiresAt) || 0;
    const extendedAt = Number(cfg.tokenExtendedAt) || 0;
    if (!token) continue; // لا توكن — لا نلمس فيسبوك
    const msLeft = expiresAt ? expiresAt * 1000 - now : Infinity;
    // لها نتجدّد: الميعاد معروف وقارب على الانتهاء، أو الميعاد مجهول (ميتا ما
    // بتحدّدش تاريخ للتوكن الممتد) بس آخر تمديد بقاله مدة طويلة.
    const dueByExpiry = expiresAt > 0 && msLeft < EXTEND_BEFORE_MS;
    const dueByAge = !expiresAt && extendedAt > 0 && now - extendedAt > TOKEN_EXTENDED_MAX_AGE_MS;
    if (!dueByExpiry && !dueByAge) continue; // لسه قدام — لا نُجدّد بلا داعي
    const prepared = await prepareToken(token, config);
    if (prepared.extended) {
      next = applyChannelPatch(next, {
        channel,
        token: prepared.token,
        tokenExpiresAt: prepared.expiresAt,
        tokenExtendedAt: prepared.extendedAt || now,
      });
      changed = true;
      notes.push(`${CHANNEL_LABELS[channel]}: ${prepared.hint}`);
    } else if (prepared.hint) {
      notes.push(`${CHANNEL_LABELS[channel]}: ${prepared.hint}`);
    }
  }
  return { config: next, notes, changed };
}

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
    // هل السحب ما زال شغّالاً بدون توكن المستخدم؟ (توكنات الصفحات لا تنتهي)
    const pagesReady = (cfg.pages || []).some((p) => !!String(p?.token || '').trim());
    const pullKeepsRunning = pagesReady;
    const canAutoRenew = longLivedCredentials(config).ready;
    let body;
    if (expired) {
      body = pullKeepsRunning
        ? `انتهى توكن استكشاف ${label} — لكن السحب ما زال شغّالاً بتوكنات الصفحات. ولّد توكن مستخدم جديداً متى شئت للاستكشاف والتحديث التلقائي.`
        : `ولّد توكن جديداً من Graph API Explorer وألصقه في إعدادات سحب الأرقام (${label}) — حتى لا يتوقف وصول أرقام الكامبينات.`;
    } else {
      body = pullKeepsRunning
        ? `باقٍ ${days} يوم على انتهاء توكن استكشاف ${label} — والسحب مستمر بتوكنات الصفحات${canAutoRenew ? '، والتجديد التلقائي جاهز' : ''}.`
        : `باقٍ ${days} يوم على انتهاء توكن سحب ${label} — ولّد توكن جديداً وألصقه قبل انتهائه حتى لا يتوقف السحب تلقائياً.`;
    }
    alerts.push({
      id: `lead-token-${channel}-${expiresAt}`,
      title: expired
        ? pullKeepsRunning
          ? `⛔ انتهى توكن استكشاف ${label} — السحب مستمر بتوكنات الصفحات`
          : `⛔ انتهى توكن سحب ${label} — السحب متوقف`
        : `⏰ توكن سحب ${label} ينتهي قريباً`,
      body,
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
// قراءة كل صفحات أي قائمة فيسبوك (بمتابعة «التالي») — أي صفحة بعد أول ١٠٠ كانت تضيع
async function graphList(path, params, maxPages = 10) {
  const rows = [];
  let after = '';
  for (let request = 0; request < maxPages; request += 1) {
    const json = await graphGet(path, { ...params, ...(after ? { after } : {}) });
    rows.push(...(json.data || []));
    after = json.paging?.cursors?.after || '';
    if (!after || !(json.data || []).length) break;
  }
  return rows;
}

export async function discoverPages(token, config = {}) {
  if (!token) throw new Error('ألصق التوكن أولاً');

  const byId = new Map();
  let firstError = null;
  // تشخيص لكل مصدر: تعرف بالضبط ليه صفحة معيّنة ما ظهرتش
  const sources = [];
  const pushPages = (rows) => {
    for (const row of rows || []) {
      if (!row || !row.id) continue;
      const id = String(row.id);
      const prev = byId.get(id) || {};
      byId.set(id, {
        id,
        name: row.name || prev.name || id,
        token: String(row.access_token || prev.token || '').trim(),
      });
    }
  };

  // نوع التوكن أولاً: توكن صفحة واحدة (Page Token) هو أشهر سبب لظهور صفحة واحدة فقط
  const debug = await debugToken(token, config);
  const isPageToken = debug?.type === 'PAGE';

  // ١) صفحات المستخدم — مع متابعة «التالي» حتى آخر دفعة
  try {
    const rows = await graphList('/me/accounts', { fields: 'id,name,access_token', limit: '100', access_token: token });
    pushPages(rows);
    sources.push({ name: 'صفحات حسابك', ok: true, count: rows.length });
  } catch (error) {
    if (!firstError) firstError = error;
    sources.push({
      name: 'صفحات حسابك',
      ok: false,
      error: String(error?.message || error),
      permission: error?.permission || '',
    });
  }

  // ٢) صفحات Business Manager: صفحات الأدمن داخل الأعمال لا تظهر في /me/accounts
  // أحياناً. نجيبها من owned_pages و client_pages لكل بيزنس (تحتاج business_management).
  let businessesListed = 0;
  let businessPages = 0;
  let businessError = null;
  try {
    // الصفحات المدمجة داخل القائمة نفسها تُقرأ أولاً (توفر طلباً لكل بيزنس)،
    // ثم نجيب الاتصالين كاملين لأن القائمة المدمجة لا تُرجع كل الصفحات دائماً.
    const businesses = await graphList(
      '/me/businesses',
      { fields: 'id,name,owned_pages{id,name,access_token}', limit: '100', access_token: token },
      5
    );
    businessesListed = businesses.length;
    for (const business of businesses) {
      const inlinePages = business?.owned_pages?.data || [];
      businessPages += inlinePages.filter((row) => row && row.id).length;
      pushPages(inlinePages);
      for (const connection of ['owned_pages', 'client_pages']) {
        try {
          const rows = await graphList(
            `/${business.id}/${connection}`,
            { fields: 'id,name,access_token', limit: '100', access_token: token },
            5
          );
          businessPages += rows.filter((row) => row && row.id).length;
          pushPages(rows);
        } catch (error) {
          if (!businessError) businessError = error;
        }
      }
    }
    sources.push({
      name: 'صفحات الأعمال (Business Manager)',
      ok: !businessError,
      count: businessPages,
      businesses: businessesListed,
      ...(businessError
        ? { error: String(businessError?.message || businessError), permission: businessError?.permission || 'business_management' }
        : {}),
    });
  } catch (error) {
    sources.push({
      name: 'صفحات الأعمال (Business Manager)',
      ok: false,
      error: String(error?.message || error),
      // السبب الأشهر: الصلاحية دي مش من ضمن الخمسة المعتادة
      permission: error?.permission || 'business_management',
      hint: 'الصفحات اللي جوّه Business Manager تحتاج صلاحية business_management في التوكن — أضفها من Graph API Explorer ثم أعد الاستكشاف.',
    });
  }

  if (!byId.size) {
    if (isPageToken) {
      throw new Error(
        'التوكن اللي ألصقته هو توكن صفحة (Page Access Token) — يرى صفحة واحدة فقط ولا يعرف بقية صفحات حسابك.\n' +
          'الحل: من Graph API Explorer اختر «Get User Access Token» (مش «Get Page Access Token») وفلّت الصلاحيات الخمس، ثم الصق التوكن ده.'
      );
    }
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

  const notes = [];
  if (skipped.length) {
    notes.push(`تم تجاهل ${skipped.length} صفحة لأن فيسبوك لم يمنح توكنها: ${skipped.join('، ')} — أعد توليد التوكن مع صلاحية pages_manage_ads.`);
  }
  // توكن صفحة واحدة: يشرح للمستخدم من غير ما يوقفه — الصفحات اللي ظهرت صحيحة لكن الناقصة محتاجة توكن مستخدم
  if (isPageToken) {
    notes.push(
      'التوكن اللي ألصقته توكن صفحة واحدة (Page Access Token)، فيرى صفحة واحدة فقط. لجلب بقية الصفحات اللي أنت أدمن فيها: ولّد «User Access Token» من Graph API Explorer (مش Page Token) بنفس الصلاحيات ثم أعد الاستكشاف.'
    );
  }
  // فشل مصدر لا يمنع بقية الاستكشاف، لكنه يُعرض بوضوح حتى لا تختفي صفحة بصمت
  for (const source of sources) {
    if (source.ok) continue;
    notes.push(
      `${source.name}: ${source.hint || source.error || 'فشل الطلب'}${source.permission && !source.hint ? ` (الصلاحية: ${source.permission})` : ''}`
    );
  }
  const warning = notes.join('\n');

  // ٤) ميعاد انتهاء صلاحية التوكن — نحفظه لننبّه قبل انتهائه بيومين
  const tokenExpiresAt = debug && debug.expiresAt > 0 ? debug.expiresAt : 0;

  return {
    pages,
    warning,
    tokenExpiresAt,
    sources,
    tokenType: debug?.type || '',
    scopes: debug?.scopes || [],
  };
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

// ===== البحث عن فورم بالآيدي: يجيب اسمه وصفحته بس (من غير ما يفعّله) =====
// بنجرّب توكنات الصفحات المحفوظة الأول، وبعدين توكن القناة.
export async function fetchFormInfo(formId, tokens = []) {
  const id = String(formId || '').trim();
  if (!/^\d+$/.test(id)) throw new Error(`معرّف النموذج غير صالح: ${id}`);
  const list = [...new Set((tokens || []).map((t) => String(t || '').trim()).filter(Boolean))];
  if (!list.length) throw new Error('الصق توكن فيسبوك أولاً');
  let lastError = null;
  for (const token of list) {
    try {
      const json = await graphGet(`/${id}`, { fields: 'id,name,page', access_token: token });
      return { id: String(json.id || id), name: String(json.name || ''), pageId: String(json.page?.id || '') };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error(`ملقيتش النموذج ${id}`);
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
  // فورمات مبنية من رفع شيت — أسماء فقط (تظهر في القوائم المسندلة بلا سحب)
  extraForms: (config.extraForms || []).map((name) => String(name || '').trim()).filter(Boolean),
  intervalMinutes: config.intervalMinutes || DEFAULTS.intervalMinutes,
  perSalesLimit: Number(config.perSalesLimit) || 0,
  hasToken: !!config.token,
  // هل عندنا توكنات صفحات؟ (هي لا تنتهي، فالسحب يستمر لو انتهى توكن المستخدم)
  hasPageTokens: (config.pages || []).some((p) => !!String(p?.token || '').trim()),
  // ميعاد انتهاء التوكن (ثواني) — تُحسب منه «أيام متبقية» للتنبيه قبل الانتهاء
  tokenExpiresAt: Number(config.tokenExpiresAt) || 0,
  lastRun: config.lastRun || null,
});

export const publicConfig = (config = {}) => ({
  ...publicChannel(config),
  acceptTestLeads: config.acceptTestLeads !== false,
  instagram: publicChannel(config.instagram || DEFAULTS.instagram),
  // سر التطبيق: لا يُرسل أبداً — الواجهة تعرض «متسجّل ✓» فقط.
  hasAppSecret: !!String(config.appSecret || '').trim(),
  // هل التجديد التلقائي جاهز؟ (سر موجود ⇒ التوكن القصير يتحوّل لـ ٦٠ يوماً)
  autoRenewReady: longLivedCredentials(config).ready,
});

// --- التنظيف والحفظ بلا أي تخزين ---
// الرقم يدخل دائماً «غير مخصص» (salesId = '')، ولا يُوزَّع على أحد تلقائياً.
// كان هنا توزيع بالتناوب على السيلز، وأُزيل لأن الرقم كان يصل لمندوب لم يطلبه
// قبل أن تراه الإدارة — والتوزيع الآن قرار بشري من تبويب «توزيع الأرقام».
export function buildAssignments({ fetched, knownPhones = [], at = new Date().toISOString() }) {
  const seen = new Set((knownPhones || []).map((p) => normalizeEgyptPhone(p)).filter(Boolean));
  const added = [];
  // الأرقام المتكررة بكل بياناتها (الفورم + وقت التسجيل) — عشان يبان في السيستم
  // إن الرقم اتكرر في فورم كذا (shared/leadRepeats.js)
  const duplicateRows = [];
  let duplicates = 0;
  let invalid = 0;
  // تفصيل كل رقم لم يُضف ولماذا — هذا ما يجيب عن سؤال «فيسبوك عنده ٣٨ وعندنا ٣٦، فين الاتنين؟»
  // بلا هذه القائمة كان الرقم يختفي بصمت ولا يعرف أحد: مكرر؟ غير صالح؟ أم لم يُقرأ أصلاً؟
  const rejected = [];
  const reject = (row, reason, rawPhone) => {
    if (rejected.length >= 200) return;
    rejected.push({
      phone: normalizeEgyptPhone(rawPhone || row.phone || ''),
      name: String(row.name || '').slice(0, 80),
      reason, // duplicate | invalid | limit
      at: row.date || '',
      source: String(row.source || '').slice(0, 120),
    });
  };

  for (const row of fetched || []) {
    if (added.length >= MAX_PER_RUN) {
      reject(row, 'limit');
      continue;
    }
    if (!isValidPhone(row.phone)) {
      invalid += 1;
      reject(row, 'invalid');
      continue;
    }
    if (seen.has(row.phone)) {
      duplicates += 1;
      reject(row, 'duplicate');
      if (duplicateRows.length < 1000) duplicateRows.push(row);
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
      // وقت تسجيله في الكامبين (وقت الـlead في الفورم) — منفصل عن وقت الاستيراد
      ...(row.dateIso ? { campaignAt: String(row.dateIso) } : {}),
    };

    added.push(baseLead);
  }

  return {
    added,
    duplicates,
    duplicateRows,
    invalid,
    rejected,
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

    // ===== الأرقام المتكررة: تتسجّل بالفورم، والرقم الأصلي وسيلزه زي ما هما =====
    // ===== كلام العميل في الفورم: سجل لكل ليد عنده إجابات (جديد أو متكرر) =====
    const newAnswers = buildAnswerEntries({
      rows: fetched,
      existing: Array.isArray(data[LEAD_ANSWERS_KEY]) ? data[LEAD_ANSWERS_KEY] : [],
      at,
    });

    const newRepeats = buildRepeats({
      rows: built.duplicateRows,
      records: [...assigned, ...clients, ...built.added],
      existing: Array.isArray(data[LEAD_REPEATS_KEY]) ? data[LEAD_REPEATS_KEY] : [],
      at,
    });

    // ===== التوزيع التلقائي: فورم اختارت له الإدارة مندوبين بعينهم =====
    // القاعدة تُطبَّق هنا لحظة الوصول، فالأرقام تُسحب وتُوزَّع ٢٤/٧ بلا متصفح مفتوح،
    // ومن ليس في قائمة الفورم لا يصله منه رقم (كل رقم يُوزَّع على مختاريه وحدهم).
    // ولو الرقم المكرر مش متوزع أصلاً والتوزيع التلقائي شغال في أحد الفورمين، يتوزع تلقائي.
    const rules = parseRules(data[AUTO_ASSIGN_KEY]);
    const allRepeats = [
      ...newRepeats,
      ...(Array.isArray(data[LEAD_REPEATS_KEY]) ? data[LEAD_REPEATS_KEY] : []),
    ];
    const unassignedExisting = assigned.filter(
      (l) => l && !String(l.salesId || '').trim() && l.assignedVia !== 'manual' && l.status !== 'closed'
    );
    // نفس دالة الواجهة: سيلز/قائد فريق + حساب «مطوّر» الإداري الذي يعمل سيلزاً أيضاً
    const activeSalesIds = (Array.isArray(data.crm_users) ? data.crm_users : [])
      .filter(isAssignableSales)
      .map((user) => String(user.id));
    const auto = rules.length
      ? applyAutoRules({
          // التوزيع على الأرقام الجديدة + الأرقام غير الموزعة المكررة في الفورم،
          // وحساب الحصص على **كل** أرقام كل مندوب (assigned + الجديدة).
          leads: [...unassignedExisting, ...built.added],
          loadLeads: [...assigned, ...built.added],
          rules,
          activeSalesIds,
          repeats: allRepeats,
          // الأرقام الجديدة تحمل formName صريحاً، وهو مفتاح القاعدة نفسه
          formOf: (lead) => String(lead?.formName || ''),
          // وقت الدور = وقت السحب (autoTurnKey على كل رقم بيحدد مين عليه الدور بعده)
          at,
        })
      : { leads: built.added, assignments: [], byRule: {} };

    if (auto.leads.length || newRepeats.length || newAnswers.length) {
      // ===== وقت الإسناد معلَّم على الرقم =====
      // إشعار المندوب يُحسب من لحظة الإسناد لا من لحظة وصول الرقم: رقم وارد من ساعات
      // واتوزّع الآن لازم يوصل صاحبه إشعار، والعكس.
      const assignedNow = new Set(auto.assignments.map((item) => String(item.id)));
      for (const lead of auto.leads) {
        if (assignedNow.has(String(lead.id)) && lead.salesId) lead.assignedAt = at;
      }
      const addedIdSet = new Set(built.added.map((l) => String(l.id)));
      const savedLeads = auto.leads.filter(
        (l) => addedIdSet.has(String(l.id)) || assignedNow.has(String(l.id))
      );

      // ===== الحفظ: نعيد القراءة قبل الكتابة =====
      // السحب بياخد وقت، وأي رقم أو عميل أُضيف من جهاز مندوب أثناء السحب ما ينفعش
      // يضيع لما نكتب القوائم كاملة. فنعيد تحميل القاعدة وندمج الجديد فيها
      // (دمج بالمعرّف — نفس قاعدة كل مفتاح يُرفع كقائمة كاملة).
      const freshDb = await storage.load();
      const freshData = freshDb.data || {};
      const freshLeads = Array.isArray(freshData.crm_assigned_leads) ? freshData.crm_assigned_leads : [];
      const freshClients = Array.isArray(freshData.crm_clients) ? freshData.crm_clients : [];
      const newIds = new Set(savedLeads.map((l) => String(l.id)));
      freshData.crm_assigned_leads = [
        ...savedLeads,
        ...freshLeads.filter((l) => !newIds.has(String(l?.id))),
      ];

      // ===== الرقم الموزَّع يصير عميلاً لصاحبه =====
      // نفس دالة الواجهة (shared/leadClients.js): المعرّف مشتق من الرقم نفسه
      // فيتدمج السجل مع أي جهاز عمل نفس التحويل — ولا يتكرر ولا يتنازع.
      const newClients = buildLeadClients({
        leads: auto.leads,
        clients: freshClients,
        at,
        by: 'التوزيع التلقائي',
      });
      if (newClients.length) freshData.crm_clients = [...newClients, ...freshClients];

      // كلام العميل في الفورم: قائمة لوحدها، تندمج بالمعرّف
      if (newAnswers.length) {
        const freshAnswers = Array.isArray(freshData[LEAD_ANSWERS_KEY]) ? freshData[LEAD_ANSWERS_KEY] : [];
        const answerIds = new Set(freshAnswers.map((item) => String(item?.id || '')));
        freshData[LEAD_ANSWERS_KEY] = [...newAnswers.filter((item) => !answerIds.has(item.id)), ...freshAnswers];
      }

      // التكرارات: قائمة لوحدها، تندمج بالمعرّف (المعرّف ثابت فما بيتكررش)
      if (newRepeats.length) {
        const freshRepeats = Array.isArray(freshData[LEAD_REPEATS_KEY]) ? freshData[LEAD_REPEATS_KEY] : [];
        const repeatIds = new Set(freshRepeats.map((item) => String(item?.id || '')));
        freshData[LEAD_REPEATS_KEY] = [
          ...newRepeats.filter((item) => !repeatIds.has(item.id)),
          ...freshRepeats,
        ];
      }

      await storage.save({ version: (Number(freshDb.version) || 0) + 1, data: freshData });
    }

    const labels = active.map((channel) => CHANNEL_LABELS[channel]).join(' + ');
    const summary = {
      at,
      ok: true,
      source: labels,
      fetched: fetched.length,
      added: built.added.length,
      duplicates: built.duplicates,
      // كام رقم متكرر اتسجّل تكراره في فورم جديدة
      repeated: newRepeats.length,
      invalid: built.invalid,
      // قائمة الأرقام المستبعدة بالسبب — تظهر للإدارة في نتيجة السحب
      rejected: built.rejected || [],
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
  // فورمات إضافية (من رفع شيت): أسماء فقط — تُحفظ في الإعدادات فتظهر في القوائم
  // المسندلة، ولا تدخل في السحب التلقائي (لا معرّف ميتا لها).
  if (Array.isArray(body.extraForms)) {
    patch.extraForms = [
      ...new Set(
        body.extraForms
          .map((f) => String(typeof f === 'string' ? f : f?.name || '').trim())
          .filter(Boolean)
      ),
    ];
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
  // آخر مرة اتمدّد فيها التوكن (ms) — بيخلينا نجدّد حتى لو ميتا ما بتحدّدش تاريخ انتهاء
  if (Number.isFinite(Number(body.tokenExtendedAt)) && Number(body.tokenExtendedAt) > 0) {
    patch.tokenExtendedAt = Number(body.tokenExtendedAt);
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

  // ===== سر تطبيق فيسبوك (App Secret) =====
  // سرّ على مستوى التطبيق كله (مش لكل قناة): يُحفظ على السيرفر فقط — في إعدادات
  // النظام على قاعدة البيانات — ولا يُرسل للواجهة أبداً (يُعرض «متسجّل ✓» فقط).
  // وجوده يجعل السيرفر يبدّل التوكن القصير (ساعتين) بتوكن ٦٠ يوماً تلقائياً.
  if (typeof body.appSecret === 'string' && body.appSecret.trim()) {
    next.appSecret = body.appSecret.trim();
  }
  if (body.clearAppSecret) delete next.appSecret;
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
        // لو الواجهة ألصقت توكن جديداً مباشرة (بلا استكشاف): نمدّده ونحفظ ميعاده
        const pastedToken = typeof body.token === 'string' && body.token.trim() && !body.clearToken ? body.token.trim() : '';
        const prepared = pastedToken ? await prepareToken(pastedToken) : null;
        const expiryPatch = prepared ? { token: prepared.token, tokenExpiresAt: prepared.expiresAt } : {};
        const saved = saveConfig(configFile, { ...applyChannelPatch(current, { ...body, ...expiryPatch }), ...globalPatch });
        return reply(res, 200, { ok: true, config: publicConfig(saved) });
      }

      if (req.method === 'POST' && url === '/api/lead-source/discover') {
        const body = await readJsonBody(req);
        const current = loadConfig(configFile);
        const channel = body?.channel === 'instagram' ? 'instagram' : 'facebook';
        const channelCfg = channelConfigOf(current, channel) || {};
        const token = String(body?.token || '').trim() || channelCfg.token || '';
        // تمديد تلقائي إلى توكن ٦٠ يوماً قبل الاستكشاف (Graph Explorer يعطي ساعتين)
        const prepared = await prepareToken(token);
        const { pages, warning, tokenExpiresAt } = await discoverPages(prepared.token, current);
        const expiresAt = tokenExpiresAt || prepared.expiresAt;
        // نحفظ التوكن (الممدَّد) وبيانات الصفحات في قناته كي يعمل السحب لاحقاً بدون إعادة لصق
        saveConfig(configFile, applyChannelPatch(current, { channel, token: prepared.token, pages, tokenExpiresAt: expiresAt }));
        return reply(res, 200, {
          ok: true,
          pages: pages.map((p) => ({ id: p.id, name: p.name })),
          warning: warning || '',
          tokenExpiresAt: expiresAt,
          extended: prepared.extended,
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
