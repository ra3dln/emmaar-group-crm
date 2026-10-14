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

const GRAPH_VERSION = 'v25.0';
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;
const MAX_PER_RUN = 200;
const DEFAULTS = {
  enabled: false,
  type: 'sheet', // sheet | meta
  sheetUrl: '',
  token: '', // توكن المستخدم (للاستكشاف)
  pages: [], // [{ id, name, token }] — توكن كل صفحة (يُكتشف تلقائياً)
  forms: [], // [{ id, pageId, name }] — النماذج المختارة
  intervalMinutes: 5,
  cursorTime: 0, // آخر وقت سُحبت عنده أرقام من ميتا
  assignCursor: 0, // موضع المناوبة في توزيع الأرقام
  perSalesLimit: 0, // أقصى عدد أرقام لكل مندوب في الدفعة الواحدة (٠ = بلا حد)
  acceptTestLeads: true, // الليدز التجريبية من أداة اختبار ميتا — لا تُرفض بل تُوسم بوضوح
  lastRun: null,
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

async function fetchFromMeta(config) {
  if (!config.forms?.length) throw new Error('لم تختر نموذجاً (فورم) بعد — اضغط «استكشف صفحاتي» واختر النماذج');
  if (!config.pages?.length) throw new Error('لا توجد صفحات — اضغط «استكشف صفحاتي» أولاً');

  const pageToken = (pageId) => config.pages.find((p) => p.id === pageId)?.token;
  const leads = [];
  let maxTime = Number(config.cursorTime) || 0;

  for (const form of config.forms) {
    const token = pageToken(form.pageId);
    if (!token) throw new Error(`توكن الصفحة الخاصة بالنموذج «${form.name || form.id}» غير موجود — أعد الاستكشاف`);

    const params = { fields: 'created_time,field_data', limit: '200', access_token: token };
    // نطلب من فيسبوك الأرقام الأحدث من آخر سحب فقط (إن وُجد مؤشر)
    if (maxTime) {
      params.filtering = JSON.stringify([{ field: 'time_created', operator: 'GREATER_THAN', value: maxTime }]);
    }
    let json;
    try {
      json = await graphGet(`/${form.id}/leads`, params);
    } catch (error) {
      // لو الصلاحية منعت الفلترة، نجلب الأرقام بدون فلتر (التكرار مرفوض لاحقاً تلقائياً)
      if (!isPermissionError(error)) throw error;
      json = await graphGet(`/${form.id}/leads`, { fields: 'created_time,field_data', limit: '200', access_token: token });
    }

    for (const lead of json.data || []) {
      const created = toUnixSeconds(lead.created_time);
      if (created > maxTime) maxTime = created;

      const rawName = readField(lead.field_data, ['full_name', 'name', 'الاسم', 'اسم']);
      const rawPhone = readField(lead.field_data, ['phone_number', 'phone', 'رقم الهاتف', 'الهاتف', 'الموبايل', 'الجوال']);
      const test = isTestLeadValue(rawPhone) || isTestLeadValue(rawName);

      // ليد تجريبي: نولّد رقماً صالحاً من معرّف الليد ليجرّب المستخدم الدورة كاملة
      if (test && !config.acceptTestLeads) continue;

      leads.push({
        name: isTestLeadValue(rawName) || !String(rawName || '').trim() ? (test ? 'عميل تجريبي' : 'عميل بدون اسم') : rawName,
        phone: test ? demoPhoneFor(lead.id) : normalizeEgyptPhone(rawPhone),
        source: `فيسبوك - ${form.name || form.id}${test ? ' • تجريبي' : ''}`,
        date: created ? readableDateTime(new Date(created * 1000)) : '',
        test,
      });
    }
  }

  config.cursorTime = maxTime;
  return leads;
}

// المصدر الفعلي: نحترم اختيار المستخدم، لكن لو الإعداد مضبوط على «ملف منشور» بلا رابط
// بينما يوجد توكن ميتا ونماذج مختارة، فالنية واضحة أنه فيسبوك — ولا نتركه يفشل بصمت.
export const isMetaSource = (config) =>
  config.type === 'meta' || (!String(config.sheetUrl || '').trim() && !!config.token && !!(config.forms || []).length);

export const fetchLeads = (config) => (isMetaSource(config) ? fetchFromMeta(config) : fetchFromSheet(config));

// --- الاستكشاف: صفحات المستخدم + نماذج كل صفحة ---
export async function discoverPages(token) {
  if (!token) throw new Error('ألصق التوكن أولاً');

  // الطريق الأول (الأسرع): كل الصفحات مع توكنها في طلب واحد.
  // بعض الصلاحيات تسقط هنا فيرد فيسبوك بخطأ صلاحية — عندها نجرّب طريقاً بديلاً واحداً واحداً.
  let pages = [];
  let firstError = null;
  try {
    const json = await graphGet('/me/accounts', {
      fields: 'id,name,access_token',
      limit: '100',
      access_token: token,
    });
    pages = (json.data || [])
      .filter((page) => page.access_token)
      .map((page) => ({ id: String(page.id), name: page.name || page.id, token: page.access_token }));
  } catch (error) {
    firstError = error;
  }

  // الطريق البديل: اجلب قائمة الصفحات فقط، ثم اطلب توكن كل صفحة على حدة.
  // هذا يتجاوز خطأ #200 الذي يظهر عندما يطلب فيسبوك صلاحية معيّنة لكل صفحة.
  let warning = '';
  let skipped = [];
  if (!pages.length) {
    const json = await graphGet('/me/accounts', { fields: 'id,name', limit: '100', access_token: token }).catch((error) => {
      throw firstError || error;
    });
    const list = json.data || [];
    for (const page of list) {
      try {
        const info = await graphGet(`/${page.id}`, { fields: 'access_token,name', access_token: token });
        if (info.access_token) {
          pages.push({ id: String(page.id), name: info.name || page.name || page.id, token: info.access_token });
          continue;
        }
      } catch {
        /* نتجاهلها ونخبر المستخدم بها في التحذير */
      }
      skipped.push(page.name || String(page.id));
    }
    if (skipped.length && pages.length) {
      warning = `تم تجاهل ${skipped.length} صفحة لأن فيسبوك لم يمنح توكنها: ${skipped.join('، ')} — أعد توليد التوكن مع صلاحية pages_manage_ads.`;
    }
  }

  if (!pages.length) {
    throw firstError || new Error('التوكن صحيح لكنه لا يرى أي صفحة — تأكد أنك اخترت صلاحيات الصفحات عند توليد التوكن وأن لديك صفحة');
  }
  return { pages, warning };
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
export function loadConfig(configFile) {
  try {
    return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(configFile, 'utf8')) };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveConfig(configFile, patch) {
  const next = { ...loadConfig(configFile), ...patch };
  fs.mkdirSync(path.dirname(configFile), { recursive: true });
  fs.writeFileSync(configFile, JSON.stringify(next, null, 2), 'utf8');
  return next;
}

export const publicConfig = (config) => ({
  enabled: !!config.enabled,
  type: config.type,
  acceptTestLeads: config.acceptTestLeads !== false,
  sheetUrl: config.sheetUrl || '',
  pages: (config.pages || []).map((p) => ({ id: p.id, name: p.name })),
  forms: (config.forms || []).map((f) => ({ id: f.id, pageId: f.pageId, name: f.name })),
  intervalMinutes: config.intervalMinutes || DEFAULTS.intervalMinutes,
  perSalesLimit: Number(config.perSalesLimit) || 0,
  hasToken: !!config.token,
  lastRun: config.lastRun || null,
});

// --- التنظيف + المناوبة على المندوبين (بلا أي تخزين) ---
// نفس المنطق يعمل في مكانين: سيرفر الشركة (يحفظ في ملف البيانات) ووظيفة الاستضافة
// (Vercel بلا قاعدة بيانات — تُعيد الأرقام جاهزة ليحفظها متصفح المدير).
// وجوده في مكان واحد يمنع اختلاف السلوك بين النسختين.
export function buildAssignments({ fetched, sales, config = {}, knownPhones = [], at = new Date().toISOString() }) {
  const limit = Number(config.perSalesLimit) > 0 ? Number(config.perSalesLimit) : Infinity;
  const team = Array.isArray(sales) ? sales.filter((u) => u && u.id) : [];
  let assignCursor = Number(config.assignCursor) || 0;

  const seen = new Set((knownPhones || []).map((p) => normalizeEgyptPhone(p)).filter(Boolean));
  const counts = new Map();
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

    let owner = null;
    for (let hop = 0; hop < team.length; hop += 1) {
      const candidate = team[(assignCursor + hop) % team.length];
      if ((counts.get(candidate.id) || 0) < limit) {
        owner = candidate;
        assignCursor = (assignCursor + hop + 1) % team.length;
        break;
      }
    }
    // الكل وصل حده الأقصى — نوقف هذه الدفعة والمتبقي يُسحب في المرة القادمة
    if (!owner) break;
    counts.set(owner.id, (counts.get(owner.id) || 0) + 1);

    added.push({
      id: crypto.randomUUID(),
      adminId: 'auto-import',
      salesId: owner.id,
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
    });
  }

  return {
    added,
    duplicates,
    invalid,
    assignCursor,
    perUser: team.filter((u) => counts.has(u.id)).map((u) => ({ name: u.name, count: counts.get(u.id) })),
  };
}

// --- التنظيف + التوزيع + الحفظ ---
// القلب المشترك: يعمل مع أي مخزن (ملف JSON على سيرفر الشركة، أو Redis على الاستضافة).
// وجوده في مكان واحد يعني أن التوزيع التلقائي في الخلفية يعطي نفس النتيجة تماماً
// سواء شغّله السيرفر المحلي أو مُشغّل دوري على الاستضافة.
//   storage    : { load, save }   — مخزن بيانات النظام (crm_users / crm_assigned_leads)
//   config     : كائن الإعدادات (يُعدَّل في مكانه: assignCursor و cursorTime و lastRun)
//   saveConfig : دالة تحفظ الإعدادات بعد التعديل (حتى لا يعيد جلب نفس الأرقام)
export async function runAutoImportCore({ storage, config, saveConfig: persist }) {
  const at = new Date().toISOString();

  try {
    const db = await storage.load();
    const data = db.data || {};
    const fetched = await fetchLeads(config);
    const users = Array.isArray(data.crm_users) ? data.crm_users : [];
    const sales = users.filter((u) => u.isActive && (u.role === 'sales' || u.role === 'supervisor'));
    if (!sales.length) throw new Error('لا يوجد حساب سيلز مفعّل لتوزيع الأرقام عليه');

    const assigned = Array.isArray(data.crm_assigned_leads) ? data.crm_assigned_leads : [];
    const clients = Array.isArray(data.crm_clients) ? data.crm_clients : [];
    const knownPhones = [
      ...assigned.map((l) => l.phone),
      ...clients.flatMap((c) => [c.phone, ...(c.phones || [])]),
    ];

    const built = buildAssignments({ fetched, sales, config, knownPhones, at });

    if (built.added.length) {
      data.crm_assigned_leads = [...built.added, ...assigned];
      await storage.save({ version: (Number(db.version) || 0) + 1, data });
    }

    const summary = {
      at,
      ok: true,
      source: isMetaSource(config) ? 'فيسبوك مباشرة' : 'ملف منشور',
      fetched: fetched.length,
      added: built.added.length,
      duplicates: built.duplicates,
      invalid: built.invalid,
      perUser: built.perUser,
    };
    config.assignCursor = built.assignCursor;
    config.lastRun = summary;
    await persist(config);
    return summary;
  } catch (error) {
    const summary = {
      at,
      ok: false,
      source: isMetaSource(config) ? 'فيسبوك مباشرة' : 'ملف منشور',
      error: String(error?.message || error),
    };
    config.lastRun = summary;
    await persist(config);
    return summary;
  }
}

// غلاف سيرفر الشركة المحلي: الإعدادات في ملف والتخزين في ملف
export async function runAutoImport({ storeFile, configFile }) {
  const storage = fileStorage(storeFile);
  const config = loadConfig(configFile);
  return runAutoImportCore({
    storage,
    config,
    saveConfig: (next) => Promise.resolve(saveConfig(configFile, next)),
  });
}

// --- واجهة الإعدادات (تُستخدم من تبويب الإعدادات في التطبيق) ---
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

export function createLeadSourceHandler({ storeFile, configFile }) {
  return async function handle(req, res) {
    try {
      const [url] = (req.url || '').split('?');

      if (req.method === 'GET' && url === '/api/lead-source') {
        const config = loadConfig(configFile);
        return reply(res, 200, { ok: true, config: publicConfig(config) });
      }

      if (req.method === 'POST' && url === '/api/lead-source') {
        const body = await readJsonBody(req);
        if (!body) return reply(res, 400, { ok: false, error: 'طلب غير صالح' });

        const patch = {};
        if (typeof body.enabled === 'boolean') patch.enabled = body.enabled;
        if (typeof body.acceptTestLeads === 'boolean') patch.acceptTestLeads = body.acceptTestLeads;
        if (body.type === 'sheet' || body.type === 'meta') patch.type = body.type;
        if (typeof body.sheetUrl === 'string') patch.sheetUrl = body.sheetUrl.trim();
        if (Array.isArray(body.pages)) {
          patch.pages = body.pages
            .filter((p) => p && typeof p.id === 'string' && typeof p.token === 'string')
            .map((p) => ({ id: p.id, name: String(p.name || p.id), token: p.token }));
        }
        if (Array.isArray(body.forms)) {
          patch.forms = body.forms
            .filter((f) => f && typeof f.id === 'string' && typeof f.pageId === 'string')
            .map((f) => ({ id: f.id, pageId: f.pageId, name: String(f.name || f.id) }));
        }
        if (typeof body.token === 'string' && body.token.trim()) patch.token = body.token.trim();
        if (body.clearToken) patch.token = '';
        // إيقاف السحب التلقائي عن بُعد أو تصفير مؤشر الأرقام بعد تغيير النماذج
        if (body.resetCursor) {
          patch.cursorTime = 0;
          patch.assignCursor = 0;
        }

        const minutes = Number(body.intervalMinutes);
        if (Number.isFinite(minutes)) patch.intervalMinutes = Math.min(Math.max(Math.round(minutes), 1), 1440);

        // عدد الأرقام لكل مندوب في الدفعة (٠ = بلا حد)
        const perSales = Number(body.perSalesLimit);
        if (Number.isFinite(perSales)) patch.perSalesLimit = Math.min(Math.max(Math.round(perSales), 0), 1000);

        const saved = saveConfig(configFile, patch);
        return reply(res, 200, { ok: true, config: publicConfig(saved) });
      }

      if (req.method === 'POST' && url === '/api/lead-source/discover') {
        const body = await readJsonBody(req);
        const token = String(body?.token || '').trim() || loadConfig(configFile).token;
        const { pages, warning } = await discoverPages(token);
        // نحفظ التوكن وبيانات الصفحات كي يعمل السحب لاحقاً بدون إعادة لصق
        saveConfig(configFile, { token, pages });
        return reply(res, 200, {
          ok: true,
          pages: pages.map((p) => ({ id: p.id, name: p.name })),
          warning,
        });
      }

      if (req.method === 'POST' && url === '/api/lead-source/page-forms') {
        const body = await readJsonBody(req);
        const config = loadConfig(configFile);
        const page = (config.pages || []).find((p) => p.id === String(body?.pageId || ''));
        if (!page) return reply(res, 404, { ok: false, error: 'الصفحة غير موجودة في الإعدادات — أعد الاستكشاف' });
        const forms = await fetchFormsForPage(page.id, page.token);
        return reply(res, 200, { ok: true, forms });
      }

      if (req.method === 'POST' && url === '/api/lead-source/run') {
        const summary = await runAutoImport({ storeFile, configFile });
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
    if (!config.enabled) return;
    const summary = await runAutoImport({ storeFile, configFile });
    if (summary.ok && summary.added > 0) {
      log(`[auto-import] دخل ${summary.added} رقم جديد (مكرر: ${summary.duplicates}، غير صالح: ${summary.invalid})`);
    } else if (!summary.ok) {
      log(`[auto-import] فشل السحب: ${summary.error}`);
    }
  }, 60 * 1000);

  if (typeof timer.unref === 'function') timer.unref();
  return () => clearInterval(timer);
}
