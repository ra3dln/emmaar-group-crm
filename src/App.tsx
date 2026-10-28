import { useState, useEffect, useRef, useCallback, useMemo, Fragment } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Users, Bell, Plus, Home, Phone, Clock, Check, 
  AlertTriangle, Star, Calendar, 
  MessageSquare, X, Edit3, Trash2, Search,
  PhoneCall, UserPlus, Building2, Sparkles,
  Zap, Target, Award, Volume2, VolumeX,
  LogOut, TrendingUp, DollarSign,
  BarChart3, PieChart, Activity, FileText,
  Shield, UserCheck, Settings, Eye, EyeOff, Upload, Download,
  LogIn, Undo2, UserCog, MessageCircle, Send, ArrowRight, Moon, Sun, Menu,
  Rows, LayoutList, List, ShieldAlert, MapPinOff, Navigation,
  ChevronRight, ChevronLeft, Filter, KeyRound,
  Workflow, BellRing, ClipboardList, MessagesSquare, Share2, LineChart,
  Megaphone, Globe, Link2, Facebook, ChevronDown, Palette, Scale, Calculator,
  CalendarClock
} from 'lucide-react';
import { Client, ClientActivity, Reminder, Property, DailyFeedback, User, Team, AssignedLead, Attendance, ChatMessage, CallLog, CallTarget, TabType } from './types';
import { isOnline, SYNC_EVENT, AUTH_EVENT, AUTH_API, markAuthorized, pushKey, syncNow, ownerOfPhoneOnServer, leadOwnerOfPhoneOnServer, clientPhonesOnServer } from './sync';
import { buildPreview, buildSampleCsv, buildFakeCampaignCsv, decodeText, parseTable, readSheetTable, type ImportPreview } from './leadImport';
import { alarm, loadAlarmSettings, saveAlarmSettings, DEFAULT_ALARM_SETTINGS, type AlarmSettings } from './alarm';
import { enablePush, disablePush, pushState, sendTestPush, pushSupported, registerWorker, resyncPush, localNotification, flushPush, pushHealth, type PushState, type PushHealth } from './push';
import {
  arabicMoneyValue,
  arabicNumberValue,
  isArabicMoneyWord,
  isRoomWord,
  numberWordValue,
  roomsFromText,
} from './arabicNumbers';
import { buildXlsx, downloadBlob } from './xlsx';
import { matchLeadSearch } from './leadSearch';
import { formNameOf, formKeyOf, activeFormNamesOf, isSelectedFormRecord, UNKNOWN_FORM, ACTIVE_FORMS_EVENT } from './campaignForms';
import { formNameFromFileName, saveExtraFormName } from './leadForms';
import {
  AUTO_ASSIGN_KEY,
  activeRuleFor,
  applyAutoRules,
  distributeLeads,
  isAssignableSales,
  parseRules,
  phoneKeyOf,
  upsertRule,
  type AutoAssignRule,
  type LeadAssignment,
} from '../shared/autoAssign.js';
import { dataScopeOf, effectiveRoleOf, isDeveloperAccount, isManagerAccount, worksAsSales } from '../shared/roles.js';
import { buildLeadClients, campaignAtFromText, campaignTimeOf, leadClientIdFor, LEAD_CLIENT_ID_PREFIX } from '../shared/leadClients.js';
import {
  cleanCommentText,
  commentActivitiesOf,
  commentSignature,
  commentsByPhone,
  dedupeComments,
  isCallResultText,
  isCommentActivity,
  isSystemOnlyText,
} from '../shared/comments.js';
import { CANCEL_REASONS, CANCEL_REASON_BY_ID, cancelReasonLabelOf, latestCancelReasonOf } from './cancelReasons';
import { MONTHS_PER_YEAR, areaTotal, caretAfterGrouping, digitsOnly, groupThousands, installmentBreakdown, normalizeArea, type InstallmentBreakdown } from './installments';
import {
  FEEDBACK_STATUS_TO_STAGE,
  LEAD_STATUS_TO_FEEDBACK_STATUS,
  buildWorkNumbers,
  digitsOfPhone,
  feedbackBucketOf,
  feedbackByPhone,
  isColdNumber,
  isFreshNumber,
  latestFeedbackStatusOf,
} from './feedbackBuckets';
import { applyThemeForUser, reapplyCurrentTheme } from './theme';
import { alertMapOf, clientActionState, leadAlertState, actedAfterReminder } from './reminders';
import { buildNextActionReminder, nextActionByPhoneOf, nextActionMapOf, type NextAction } from './nextAction';
import { installBackGuard } from './backNav';
import { ThemePaletteButton, ThemeSettingsPanel } from './ThemeWheel';
import {
  ATTENDANCE_END_DEFAULT,
  ATTENDANCE_GRACE_DEFAULT,
  ATTENDANCE_START_DEFAULT,
  clockLabel,
  clockToMinutes,
  earlyMinutes as earlyMinutesOf,
  lateMinutes as lateMinutesOf,
  minutesOfIso,
} from './attendance';

// ===== الحضور والانصراف =====
const ATTENDANCE_KEY = 'crm_attendance';

const getAttendance = (): Attendance[] => {
  try {
    return JSON.parse(localStorage.getItem(ATTENDANCE_KEY) || '[]');
  } catch {
    return [];
  }
};

const saveAttendance = (records: Attendance[]): void => {
  localStorage.setItem(ATTENDANCE_KEY, JSON.stringify(records));
};

// ===== الشات الداخلي (الإدارة ↔ كل سيلز) =====
// الرسائل تُحفظ في نفس مخزن البيانات المشترك، فتصل بين أي جهازين خلال ثانيتين.
const MESSAGES_KEY = 'crm_messages';

const getMessages = (): ChatMessage[] => {
  try {
    const parsed = JSON.parse(localStorage.getItem(MESSAGES_KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const saveMessages = (messages: ChatMessage[]): void => {
  localStorage.setItem(MESSAGES_KEY, JSON.stringify(messages));
};

// ===== سجل المكالمات (تم الرد / لم يرد + الكومنت + موعد الاتصال القادم) =====
// يُخزَّن في نفس مخزن البيانات المشترك فتصل كل مكالمة لحساب الإدارة فوراً.
const CALL_LOGS_KEY = 'crm_call_logs';

const getCallLogs = (): CallLog[] => {
  try {
    const parsed = JSON.parse(localStorage.getItem(CALL_LOGS_KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const saveCallLogs = (logs: CallLog[]): void => {
  localStorage.setItem(CALL_LOGS_KEY, JSON.stringify(logs));
};

// ===== هدف الاتصال لرقم موزَّع (لسه مش عميل مسجّل) =====
// المعرّف مشتق من الرقم نفسه (crm-lead-<أرقام>) — نفس قاعدة العميل التلقائي
// بالظبط، فإذا العميل اتحوّل على جهاز آخر السجلات بتتدمج ولا تتكرر.
// لحد ما يتحوّل عميلاً: المكالمة بتتسجَّل برقمه في سجل المكالمات وبطاقة
// الفيدباك، فالرقم بينتقل للمرحلة اللي اتفق عليها في «المراحل».
const leadCallTarget = (lead: any, record?: any): CallTarget => {
  const phone = String(record?.phone || lead?.phone || '');
  return {
    id: leadClientIdFor(phone) || `lead-${String(lead?.id || record?.id || '')}`,
    name: String(record?.name || lead?.name || 'بدون اسم'),
    phone,
    stage: 'new',
    virtualLead: true,
  };
};

// ===== الرقم اليدوي: اللي أضافه السيلز بنفسه (مش رقم كامبين) =====
// أرقام الكامبين جايها باسم الفورم (formName) ووقت تسجيلها في الفورم
// (campaignAt)، فاللي مالوش الاتنين = رقم أضافه السيلز بنفسه.
// وتبويب «العملاء» بيعرض الأرقام دي فقط — وأرقام الكامبين في صفحة «الأرقام».
const isManualLead = (lead: any): boolean =>
  !!(lead?.manual) || (!lead?.formName && !lead?.campaignAt);

// ===== آخر التعليقات على رقم (عميل أو رقم موزَّع) =====
// **كلام السيلز فقط**: لا لوجات (اتصال/تذكير/واتساب) ولا تكرار.
// العميل: كومنتاته في خطّه الزمني + بطاقات الفيدباك على نفس الهاتف.
// الرقم الموزَّع: بطاقات الفيدباك فقط. كلهم مربوطين بالهاتف فتبقى القصة كاملة.
const commentsOfTarget = (
  target: any,
  clients: any[] = [],
  feedbacks: any[] = [],
  callLogs: any[] = [],
  users: any[] = []
): Array<{ id: string; by: string; at: string; text: string; status?: string; result?: string; nextAt?: string }> => {
  const phone = digitsOfPhone(target?.phone);
  const nameOf = (userId: any) =>
    String((users || []).find((u: any) => String(u?.id) === String(userId))?.name || 'المندوب');
  const out: Array<{ id: string; by: string; at: string; text: string; status?: string; result?: string; nextAt?: string }> = [];

  // عميل الهدف: بالمعرّف، وبالرقم كمان — لأن رقم التوزيع المعرّفه «crm-lead-<رقم>»
  // قد يكون لسه lead في الشاشة، والعميل اللي خطّه الزمني فيه الكومنتات القديمة
  // (من مندوب اتمسح حسابه) هو نفسه الرقم.
  const client =
    (clients || []).find((c: any) => String(c?.id) === String(target?.id)) ||
    (clients || []).find((c: any) => digitsOfPhone(c?.phone) === phone);
  // كومنتات العميل: بلا لوجات وبلا تكرار (shared/comments.js) — ما عدا نص نتيجة
  // الاتصال نفسه («No answer» / «تم الرد»)، فهو الكومنت اللي بيسجّله المندوب
  // مع الإجراء فلازم يظهر في «آخر التعليقات».
  const keepText = (text: string) =>
    !!text && (!isSystemOnlyText(text) || isCallResultText(text));
  const clientActs = Array.isArray((client as any)?.activities) ? (client as any).activities : [];
  for (const a of clientActs) {
    if (!isCommentActivity(a)) continue;
    const text = cleanCommentText(a?.text);
    if (!keepText(text)) continue;
    out.push({
      id: String(a?.id || ''),
      by: String(a?.by || nameOf(a?.authorId)),
      at: String(a?.at || ''),
      text,
      status: String(a?.status || ''),
    });
  }

  // بطاقات الفيدباك اليومي: نفس كلام المندوب — بتتدمج مع الكومنت فوقيه
  for (const f of (feedbacks || [])) {
    if (digitsOfPhone(f?.clientPhone) !== phone) continue;
    const text = cleanCommentText(f?.feedback);
    if (!keepText(text)) continue;
    out.push({
      id: String(f?.id || ''),
      by: nameOf(f?.userId),
      at: String(f?.createdAt || f?.date || ''),
      text,
      status: String(f?.status || ''),
      result: f?.callStatus === 'called' ? 'answered' : f?.callStatus === 'no-answer' ? 'no-answer' : '',
    });
  }

  // سجل المكالمات: فيه كلام المندوب نفسه (نص المكالمة) — وده مصدر الكومنتات
  // القديمة. بنجيبه، بس **النص الآلي** (لوج) بيتشال، ونفس الكومنت بيتدمج مرة واحدة.
  for (const l of (callLogs || [])) {
    if (digitsOfPhone(l?.clientPhone) !== phone) continue;
    const text = cleanCommentText(l?.comment);
    if (!keepText(text)) continue;
    out.push({
      id: String(l?.id || ''),
      by: nameOf(l?.salesId),
      at: String(l?.createdAt || ''),
      text,
      result: l?.result === 'no-answer' ? 'no-answer' : 'answered',
    });
  }

  out.sort((a, b) => String(b.at).localeCompare(String(a.at)));
  // نفس الكومنت ممكن يتكتب في أكتر من مكان — نخليه مرة واحدة بس
  return dedupeComments(out);
};

// وقت مختصر للرسالة: الساعة لو اليوم، وإلا اليوم والشهر
// (ساعة بلا صفر بادئ: ١:٥٠ م بدل ٠١:٥٠ م — أوضح للقراءة)
const chatTime = (iso: string): string => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const time = d.toLocaleTimeString('ar-EG', { hour: 'numeric', minute: '2-digit' });
  if (d.toDateString() === new Date().toDateString()) return time;
  return `${d.toLocaleDateString('ar-EG', { day: 'numeric', month: 'short' })} • ${time}`;
};

const todayKey = (): string => {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
};

const formatTime = (iso: string): string =>
  new Date(iso).toLocaleTimeString('ar-EG', { hour: 'numeric', minute: '2-digit' });

const formatDayLabel = (dateKey: string): string => {
  const [y, m, d] = dateKey.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('ar-EG', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
};

const getTodayCheckIn = (userId: string): Attendance | undefined =>
  getAttendance().find((a) => a.userId === userId && a.date === todayKey());

const updateAttendanceRecord = (updated: Attendance): Attendance => {
  const record: Attendance = { ...updated, updatedAt: new Date().toISOString() };
  saveAttendance(getAttendance().map((a) => (a.id === record.id ? record : a)));
  return record;
};

// مدة العمل بين الحضور والانصراف
const workedMinutes = (rec: Attendance): number =>
  rec.checkOutAt
    ? Math.max(0, Math.round((Date.parse(rec.checkOutAt) - Date.parse(rec.checkInAt)) / 60000))
    : 0;

const formatDuration = (minutes: number): string => {
  if (!minutes) return '';
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours && mins) return `${hours} س ${mins} د`;
  if (hours) return `${hours} ساعة`;
  return `${mins} دقيقة`;
};

// ===== كشف التلاعب في الموقع (Fake GPS / VPN) =====
// مؤشرات اشتباه لا حكم قاطع — الهدف تنبيه الإدارة لا منع الموظف (المنع الصارم يضر من إنترنتهم ضعيف)
const haversineKm = (aLat: number, aLng: number, bLat: number, bLng: number): number => {
  const R = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
};

const detectLocationFlags = (pos: GeolocationPosition, prev?: Attendance): string[] => {
  const flags: string[] = [];
  const c = pos.coords;
  // دقة مستحيلة: تطبيقات الموقع المزيّف تُرجع دقة أقل من متر أو صفراً
  if (typeof c.accuracy === 'number' && c.accuracy >= 0 && c.accuracy < 1) {
    flags.push('دقة GPS غير طبيعية (أقل من متر)');
  }
  // تنقل مستحيل بين تسجيلين متتاليين (سرعة أكبر من أي وسيلة نقل)
  if (prev && typeof prev.latitude === 'number') {
    const km = haversineKm(prev.latitude, prev.longitude, c.latitude, c.longitude);
    const hours = Math.max(1 / 60, (Date.now() - new Date(prev.checkInAt).getTime()) / 3_600_000);
    const speed = km / hours;
    if (km > 3 && speed > 900) flags.push(`تنقّل مستحيل (${Math.round(speed)} كم/س)`);
    // نفس الإحداثيات بالضبط في يوم مختلف = إحداثيات ثابتة من تطبيق تزييف
    const sameDay = new Date(prev.checkInAt).toDateString() === new Date().toDateString();
    if (!sameDay && Math.abs(prev.latitude - c.latitude) < 1e-6 && Math.abs(prev.longitude - c.longitude) < 1e-6) {
      flags.push('نفس الإحداثيات بالضبط في يوم مختلف');
    }
  }
  // تعارض المنطقة الزمنية للجهاز مع خط الطول (مؤشر VPN أو تغيير موقع الجهاز)
  const expectedOffset = Math.round(c.longitude / 15);
  const deviceOffset = -new Date().getTimezoneOffset() / 60;
  if (Math.abs(expectedOffset - deviceOffset) >= 3) flags.push('توقيت الجهاز لا يطابق الموقع (VPN محتمل)');
  return flags;
};

// أخذ الموقع من الجهاز بأعلى دقة ممكنة
const getPosition = (): Promise<GeolocationPosition> =>
  new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) {
      reject(new Error('الجهاز لا يدعم تحديد الموقع'));
      return;
    }
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 15000,
      maximumAge: 0,
    });
  });

const mapsLink = (lat: number, lng: number): string =>
  `https://www.google.com/maps?q=${lat},${lng}`;

// ===== كلمات المرور: النص يُحفظ كما هو وتُدار من النظام =====
// لا يوجد أي تشفير ولا مقارنة في المتصفح إطلاقاً — التحقق كله على السيرفر
// (server/auth.js + server/authApi.js). الإدارة (CEO) ترى كلمات مرور السيلز
// في نموذج «تعديل الحساب» وتستطيع تعيين كلمة جديدة من هناك؛ وأي محاولة تغيير
// من حساب آخر تُهمل على السيرفر تماماً (server/auth.js: preserveUserPasswords).

// ===== الرتب الثلاث: CEO / Team Leader / Sales Agent =====
// الرتبة تُشتق من الدور الداخلي (admin = CEO، supervisor = Team Leader، sales = Sales Agent)
const RANK_LABEL: Record<string, string> = { admin: 'CEO', supervisor: 'Team Leader', sales: 'Sales Agent', developer: 'System Dev' };
const RANK_AR: Record<string, string> = { admin: 'المدير التنفيذي', supervisor: 'قائد فريق', sales: 'سيلز', developer: 'مطوّر النظام' };
const rankLabel = (role?: string): string => RANK_LABEL[role || 'sales'] || 'Sales Agent';
// لقب يظهر تحت الاسم في المحادثة: حساب المطوّر يُكتب تحته «System Developer»
// حتى لو كانت رتبته إدارية (مثل حساب mohamed).
// القاعدة نفسها في shared/roles.js — يستعملها السيرفر كمان في غرفة المدراء
// فيبقى حكم «مين مدير» واحداً في المتصفح والسيرفر.
const chatRank = (user?: { role?: string; developer?: boolean; username?: string } | null): string =>
  isDeveloperAccount(user) ? 'System Developer' : rankLabel(user?.role);
const rankAr = (role?: string): string => RANK_AR[role || 'sales'] || 'سيلز';
const rankClass = (role?: string): string =>
  role === 'admin'
    ? 'rank-chip rank-ceo'
    : role === 'supervisor'
      ? 'rank-chip rank-leader'
      : role === 'developer'
        ? 'rank-chip rank-dev'
        : 'rank-chip rank-sales';
// حساب «المطوّر» رتبته إدارية فعلياً (كل الصلاحيات + تغيير كلمات المرور)،
// لكنه يُعرَض في كل مكان كحساب سيلز عادي — بطلب صريح من صاحب النظام.
const displayRoleOf = (user?: { role?: string; developer?: boolean } | null): string =>
  user && user.developer ? 'sales' : (user?.role || 'sales');
// الرتبة التي يراها صاحب الحساب عن نفسه: المطوّر يرى «System Dev»
// بينما يبقى معروضاً كسيلز عادي في قوائم الحسابات عند الإدارة.
const selfRoleOf = (user?: { role?: string; developer?: boolean } | null): string =>
  user && user.developer ? 'developer' : (user?.role || 'sales');
// المدير التنفيذي (CEO) فقط يملك صلاحيات النظام الكاملة — قائد الفريق يدير فريقه
const isCeoRole = (role?: string): boolean => role === 'admin';
const isManagerRole = (role?: string): boolean => role === 'admin' || role === 'supervisor';

// ===== نطاق بيانات الحساب — مصدر واحد للحقيقة =====
// القاعدة نفسها في shared/roles.js (dataScopeOf) عشان تتختبر لوحدها وتبقى واحدة
// في المتصفح: null = يرى كل بيانات الشركة، والمجموعة = الحسابات المسموح له بها.
//   • المدير التنفيذي (admin): كل بيانات الشركة — هو صاحب النظام ومَن يدير التوزيع.
//   • حساب «المطوّر» (إداري في القاعدة، سيلز في الشغل): بياناته هو فقط، مثل أي
//     سيلز. كان دوره الإداري في القاعدة يمنحه نطاقاً كاملاً، فيرى أرقام كل
//     المندوبين وفيدباكهم مختلطة في حسابه (وهو الخلط المُبلَّغ عنه: حساب محمد
//     وحساب SHEROQ). شغله الإداري (إدارة الحسابات والإعدادات والدخول إلى حساب
//     غيره) ما زال شغّالاً — فقط نطاق بياناته رجع لبياناته.
//   • قائد الفريق: فريقه (لو عنده فريق فعلي — فريق فارغ ما يبقاش «كل الحسابات»).
//   • السيلز: نفسه فقط.
// «بياناته فقط» ما تُطبَّق على الإدارة إلا لو اختارها بنفسه من «تعديل الحساب».
// تقييد الإدارة تلقائياً كان يخفي عنها أرقام الكامبين الموزّعة على مندوبين آخرين —
// ولهذا تبقى شاشات أرقام الكامبين (توزيع الأرقام/عملاء كامبين/شيت الفورمات)
// على المخزون الكامل، لا على نطاق الحساب.

// ===== غرفة المدراء الجماعية =====
// كل حساب إدارة حقيقي (CEO أو Team Leader) — الحالي أو الذي يُضاف لاحقاً — يدخل
// الغرفة تلقائياً. حساب «المطوّر» ليس منها: إدارته في القاعدة لا تعني أنه في غرفة
// الإدارة، وإلا وصلت إليه إشعارات الإدارة ورسائلها وهي مش ليه.
const MANAGERS_GROUP_ID = 'managers';
const MANAGERS_GROUP_NAME = 'غرفة المدراء';
// رسالة وصلت لهذا المستخدم؟ (غرفة المدراء تُقرأ لكل عضو على حدة)
const messageTargetsUser = (m: ChatMessage, user: User): boolean =>
  isManagerAccount(user)
    ? m.toId === user.id || (m.toId === MANAGERS_GROUP_ID && m.fromId !== user.id)
    : m.toId === user.id;
const isMessageReadBy = (m: ChatMessage, userId: string): boolean =>
  m.toId === MANAGERS_GROUP_ID ? (m.readBy || []).includes(userId) : !!m.readAt;

// Initialize default admin account
const initializeSystem = () => {
  try {
    const usersData = localStorage.getItem('crm_users');
    let users: User[] = [];
    
    if (usersData) {
      users = JSON.parse(usersData);
    }
    
    const adminExists = users.some(u => u.username === 'admin' && u.role === 'admin');
    
    if (!adminExists) {
      const adminUser: User = {
        id: 'admin-001',
        username: 'admin',
        password: 'admin123',
        name: 'إدارة إعمار جروب',
        phone: '',
        role: 'admin',
        team: '',
        isActive: true,
        createdAt: new Date().toISOString(),
        createdBy: 'system',
      };
      
      const updatedUsers = [...users.filter(u => u.username !== 'admin'), adminUser];
      localStorage.setItem('crm_users', JSON.stringify(updatedUsers));
      // إزالة «شاهد الحذف» الخاص بحساب النظام حتى لا تمسحه المزامنة مجدداً بعد كل تحميل
      // (بدون هذا تختفي الإدارة من قائمة المستخدمين فتتعطل محادثة السيلز مع الإدارة)
      try {
        const tombs = JSON.parse(localStorage.getItem('crm_tombstones') || '[]');
        if (Array.isArray(tombs) && tombs.some((t: any) => t?.key === 'crm_users' && t?.id === 'admin-001')) {
          localStorage.setItem('crm_tombstones', JSON.stringify(tombs.filter((t: any) => !(t?.key === 'crm_users' && t?.id === 'admin-001'))));
        }
      } catch { /* لا شيء */ }
    }
  } catch (error) {
    console.error('Error initializing system:', error);
  }
};

// Utility functions
// توحيد الأرقام العربية والإنجليزية حتى يبحث المستخدم بأي لغة
const normalizeDigits = (value: string): string =>
  String(value ?? '')
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[\u06f0-\u06f9]/g, (d) => String(d.charCodeAt(0) - 0x06f0));

// أرقام كل العملاء المسجّلين (أرقامهم الأساسية وأي أرقام إضافية).
// تُستخدم كـ«استثناء» في التوزيع: رقم عند حدّ سلفاً ما يتوزّعش على حدّ تاني،
// عشان الرقم الواحد ما يبقاش عند أكتر من شخص.
const phonesOfClients = (list: Client[] = []): string[] =>
  (list || [])
    .flatMap((c: Client) => [c?.phone, ...(c?.phones || [])])
    .map((p: unknown) => normalizeDigits(String(p || '')).replace(/\D/g, ''))
    .filter(Boolean);

// توحيد الحروف العربية: (ألف) = (الف) و (أسعار) بإشكال مختلفة
const normalizeArabicText = (value: string): string =>
  normalizeDigits(value)
    .toLowerCase()
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[\u064b-\u065f\u0670]/g, '');

// المضاعفات مرتبة من الأطول للأقصر حتى لا تُقرأ (نصف مليون) كمليون
const PRICE_MULTIPLIERS: Array<{ words: string[]; value: number }> = [
  { words: ['نصف مليون', 'نص مليون'], value: 500000 },
  { words: ['ربع مليون'], value: 250000 },
  { words: ['مليونين', 'مليونان'], value: 2000000 },
  { words: ['مليار'], value: 1000000000 },
  { words: ['مليون'], value: 1000000 },
  { words: ['الفين'], value: 2000 },
  { words: ['الف'], value: 1000 },
];

const SUFFIX_MULTIPLIERS: Array<{ keys: string[]; value: number }> = [
  { keys: ['مليار'], value: 1000000000 },
  { keys: ['مليونين'], value: 2000000 },
  { keys: ['مليون'], value: 1000000 },
  { keys: ['الفين'], value: 2000 },
  { keys: ['الف'], value: 1000 },
  { keys: ['م', 'm'], value: 1000000 },
  { keys: ['ك', 'k'], value: 1000 },
];

// يستخرج كل القيم المالية المحتملة من نص البحث:
// مليون => 1,000,000 | 1.5 مليون => 1,500,000 | ٢ مليون => 2,000,000 | 1,500,000 => 1500000
const parseMoneyQuery = (raw: string): number[] => {
  const values = new Set<number>();
  if (!raw) return [];

  // الأرقام المكتوبة بالحروف: (عشر آلاف) (مية وخمسين ألف) (نص مليون)…
  // لو فهمناها بدقة لا نضيف تخمينات الكلمات المفردة تحتها (كانت تخلي «نص مليون» مليون كامل)
  const arabicMoney = arabicMoneyValue(raw);
  if (arabicMoney !== null) values.add(arabicMoney);

  let text = normalizeArabicText(raw);
  // إزالة فواصل الآلاف: 1,000,000 أو 1 000 000
  for (let i = 0; i < 4; i += 1) {
    text = text.replace(/(\d)[,\u060c\u066c\s](?=\d{3}(?!\d))/g, '$1');
  }

  // رقم متبوع بمضاعف: 1.5 مليون / 800 الف / 3k
  text = text.replace(
    /(\d+(?:[.,]\d+)?)\s*(مليار|مليونين|مليون|الفين|الف|م|m|ك|k)(?![\u0600-\u06ffa-z])/g,
    (_all, digits: string, unit: string) => {
      const multiplier = SUFFIX_MULTIPLIERS.find((entry) => entry.keys.includes(unit));
      const value = parseFloat(String(digits).replace(',', '.'));
      if (multiplier && !isNaN(value)) values.add(value * multiplier.value);
      return ' ';
    }
  );

  // أي أرقام متبقية في البحث
  for (const match of text.matchAll(/(\d+(?:[.,]\d+)?)/g)) {
    const value = parseFloat(match[1].replace(',', '.'));
    if (!isNaN(value) && value > 0) values.add(value);
  }

  // كلمات مالية بدون رقم قبلها: (مليون) (نصف مليون) (ألفين)
  // نتخطاها لو التعبير العربي اتفهم بالكامل فوق
  if (arabicMoney === null) {
    let masked = normalizeArabicText(raw);
    for (const entry of [...PRICE_MULTIPLIERS].sort((a, b) => b.words[0].length - a.words[0].length)) {
      for (const word of entry.words) {
        let index = masked.indexOf(word);
        while (index !== -1) {
          const before = masked.slice(Math.max(0, index - 12), index);
          const numMatch = before.match(/(\d+(?:[.,]\d+)?)\s*$/);
          values.add(numMatch ? parseFloat(numMatch[1].replace(',', '.')) * entry.value : entry.value);
          masked = `${masked.slice(0, index)}${'#'.repeat(word.length)}${masked.slice(index + word.length)}`;
          index = masked.indexOf(word);
        }
      }
    }
  }

  return Array.from(values).filter((value) => value > 0);
};

// مطابقة مبلغ (أرقام / أرقام بفواصل / حروف عربية) مع سعر محفوظ
const moneyMatches = (rawQuery: string, rawValue: string, numeric: number): boolean => {
  const value = numeric || parsePrice(rawValue);
  if (!value) return false;
  for (const candidate of parseMoneyQuery(rawQuery)) {
    const tolerance = Math.max(1000, candidate * 0.02);
    if (Math.abs(value - candidate) <= tolerance) return true;
  }
  // مقارنة مباشرة بعد إزالة الفواصل: 1,000,000 = 1000000
  const queryDigits = normalizeDigits(rawQuery).replace(/\D/g, '');
  return queryDigits.length >= 4 && queryDigits === String(Math.round(value));
};

const formatPrice = (price: string): string => {
  const num = parsePrice(price);
  if (!num) return String(price ?? '');
  return num.toLocaleString('en-US');
};

// عرض السعر مع فواصل الآلاف (وإن كان مكتوباً بالحروف يُعرض رقماً)
const displayPrice = (price?: string): string => (price ? formatPrice(price) : '0');

const parsePrice = (price: string): number => {
  if (price === undefined || price === null) return 0;
  const values = parseMoneyQuery(String(price));
  if (values.length) return Math.max(...values);
  const digits = normalizeDigits(String(price)).replace(/[^\d.\-]/g, '');
  const num = parseFloat(digits);
  return isNaN(num) ? 0 : num;
};

// ===== واتساب: فتح محادثة على رقم العميل مباشرة =====
// بلا أي رسالة مكتوبة مسبقاً: النظام يفتح واتساب على الرقم فقط،
// والمندوب يكتب بنفسه ما يناسب العميل. (لا يوجد قالب ولا نص يُحقن في المحادثة.)
// الصيغة الدولية التي يقبلها واتساب (مصر 20 هي الافتراضية)
const waPhone = (raw: string): string => {
  let digits = normalizeDigits(String(raw ?? '')).replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.startsWith('20')) return digits;
  if (digits.startsWith('0')) return `20${digits.slice(1)}`;
  if (digits.length === 10 && digits.startsWith('1')) return `20${digits}`;
  return digits;
};

const waLink = (phone: string): string => `https://wa.me/${waPhone(phone)}`;

// ===== رابط المشاركة العامة لصفحة العقار (تُفتح لأي عميل بلا تسجيل دخول) =====
const publicPropertyUrl = (id: string): string => {
  try {
    return `${window.location.origin}/p/${id}`;
  } catch {
    return `/p/${id}`;
  }
};

// نسخ نص إلى الحافظة — بطريقتين: الواجهة الحديثة ثم الطريقة البديلة
// (بعض المتصفحات على أندرويد تمنع الواجهة الحديثة خارج HTTPS)
const copyText = async (text: string): Promise<boolean> => {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* نكمل بالطريقة البديلة */
  }
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.top = '-1000px';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
};

// ===== صور العقارات: ضغط الصورة داخل المتصفح قبل الحفظ =====
// الصور تُحفظ داخل قاعدة البيانات نفسها (ملف JSON) فلا نحتاج أي خدمة تخزين خارجية،
// لكن نصغّرها حتى لا يتضخّم الملف: أقصى طول ١١٠٠ بكسل بجودة مناسبة للعرض.
const compressImage = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('تعذّر قراءة الصورة'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('صورة غير صالحة'));
      img.onload = () => {
        const maxSide = 1100;
        const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
        const width = Math.max(1, Math.round(img.width * scale));
        const height = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return reject(new Error('تعذّر تجهيز الصورة'));
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', 0.72));
      };
      img.src = String(reader.result || '');
    };
    reader.readAsDataURL(file);
  });

// ===== الخط الزمني لكل عميل =====
// كل حدث على العميل يُسجَّل داخل سجل العميل نفسه، فيسافر مع المزامنة لكل الأجهزة
// ويظهر في كارت العميل — بلا أي جدول إضافي.
// opts.authorId: **كاتب الكومنت** وليس صاحب العميل — وبهذا يظهر الكومنت في
// «الفيدباك اليومي» الخاص بمن كتبه فعلاً، حتى لو كان العميل مسجَّلاً باسم الإدارة
// أو باسم مندوب آخر. (بدون ذلك كان كومنت المندوب يُنسَب لصاحب العميل فيختفي من تبويبه)
const addClientActivity = (
  clientId: string,
  type: string,
  text: string,
  by?: string,
  opts?: { authorId?: string; callStatus?: DailyFeedback['callStatus']; cardId?: string; skipCard?: boolean; status?: string; cancelReason?: string; nextActionAt?: string; nextActionNote?: string }
): void => {
  if (!clientId) return;
  try {
    const all: Client[] = JSON.parse(localStorage.getItem('crm_clients') || '[]');
    const nowIso = new Date().toISOString();
    const entryId = crypto.randomUUID();
    const next = all.map((c) => {
      if (c.id !== clientId) return c;
      const entry: ClientActivity = {
        id: entryId,
        type,
        text,
        at: nowIso,
        by: by || '',
        // كاتب الكومنت بالمعرّف كمان — فيدباك اليومي يلاقي كومنتاته حتى لو الاسم اتغيّر
        ...(opts?.authorId ? { authorId: opts.authorId } : {}),
        // حالة الفيدباك تسافر مع الحدث نفسه فتظهر في الشريط وبجوار الكومنت
        ...(opts?.status ? { status: opts.status } : {}),
        // سبب الإلغاء يُحفظ مع الحدث **وعلى العميل** — فلتر القائمة يقرأه مباشرة
        ...(opts?.cancelReason ? { cancelReason: opts.cancelReason } : {}),
      };
      return {
        ...c,
        ...(opts?.cancelReason ? { cancelReason: opts.cancelReason } : {}),
        // ===== «الإجراء القادم»: الموعد بيتكتب على سجل العميل نفسه =====
        // عشان يبان على الكارت باليوم والساعة (مش بس في التذكيرات).
        ...(opts?.nextActionAt
          ? { nextActionAt: opts.nextActionAt, nextActionNote: opts.nextActionNote || 'إجراء قادم' }
          : {}),
        activities: [entry, ...(c.activities || [])].slice(0, 60),
        updatedAt: nowIso,
      };
    });
    localStorage.setItem('crm_clients', JSON.stringify(next));

    // الكومنت ينزل تلقائياً في «الفيدباك اليومي» كبطاقة باسم كاتبه —
    // حتى يظهر عنده وفي تبويب الفيدباك عند الإدارة بدون أي خطوة إضافية
    // الكومنت المباشر (بدون مكالمة) ينزل برضه كبطاقة في «الفيدباك اليومي»
    // بحالة «لم يتم الاتصال» — فيظهر عند كاتبه وفي تبويب الفيدباك.
    if ((type === 'feedback' || type === 'comment') && !opts?.skipCard) {
      const target = all.find((c) => c.id === clientId);
      if (target) {
        const feedbacks: DailyFeedback[] = JSON.parse(localStorage.getItem('crm_daily_feedback') || '[]');
        const cardId = opts?.cardId || entryId;
        const fb: DailyFeedback = {
          id: cardId,
          userId: opts?.authorId || target.userId,
          clientPhone: target.phone,
          clientName: target.name,
          date: nowIso,
          feedback: text,
          callStatus: opts?.callStatus || 'called',
          ...(opts?.status ? { status: opts.status } : {}),
          createdAt: nowIso,
        };
        // upsert: لو البطاقة موجودة بنفس المعرّف تُحدَّث بدل أن تتكرر
        localStorage.setItem('crm_daily_feedback', JSON.stringify([fb, ...feedbacks.filter((f) => f.id !== cardId)]));
        void pushKey('crm_daily_feedback');
      }
    }
  } catch {
    /* لا شيء */
  }
};

// ===== المتابعة التلقائية =====
// بعد أي تغيير في مرحلة العميل يُنشئ النظام تذكير متابعة بعد ٢٤ ساعة من تلقاء نفسه،
// فلا يبقى عميل بلا متابعة. (لا يُكرَّر لو يوجد تذكير قائم لنفس العميل)
const scheduleFollowUp = (client: Client, stageLabel: string, ownerId?: string): boolean => {
  try {
    const reminders: Reminder[] = JSON.parse(localStorage.getItem('crm_reminders') || '[]');
    if (reminders.some((r) => !r.isCompleted && r.clientId === client.id)) return false;
    const at = new Date(Date.now() + 24 * 60 * 60 * 1000);
    at.setHours(10, 0, 0, 0);
    const reminder: Reminder = {
      id: crypto.randomUUID(),
      userId: ownerId || client.userId,
      clientId: client.id,
      clientName: client.name,
      clientPhone: client.phone,
      dateTime: at.toISOString(),
      note: `متابعة تلقائية: ${client.name} — المرحلة: ${stageLabel}`,
      isCompleted: false,
      isDelayed: false,
      delayCount: 0,
      createdAt: new Date().toISOString(),
    };
    localStorage.setItem('crm_reminders', JSON.stringify([reminder, ...reminders]));
    return true;
  } catch {
    return false;
  }
};

// ===== «الإجراء القادم»: يوم + ساعة يختارها المندوب في الفيدباك =====
// يبني تذكيراً بنفس نظام «محتاج إجراء» الموجود، فيبقى الموعد ظاهر على كارت
// العميل (يوم + ساعة)، ولما يجي وقته من غير خطوة → الكارت يولّع أصفر «اتأخر».
// التذكير بيتحفظ في نفس جدول التذكيرات، فتبان في تبويب التذكيرات كمان.
const addNextActionReminder = (
  client: any,
  at: string,
  note: string,
  ownerId: string
): Reminder | null => {
  try {
    const parsed = new Date(at);
    if (!at || Number.isNaN(parsed.getTime())) return null;
    const reminders: Reminder[] = JSON.parse(localStorage.getItem('crm_reminders') || '[]');
    const reminder = buildNextActionReminder({
      id: crypto.randomUUID(),
      userId: ownerId,
      clientId: String(client?.id || ''),
      clientName: String(client?.name || ''),
      clientPhone: String(client?.phone || ''),
      at: parsed.toISOString(),
      note: note || 'إجراء قادم',
    }) as Reminder;
    localStorage.setItem('crm_reminders', JSON.stringify([reminder, ...reminders]));
    return reminder;
  } catch {
    return null;
  }
};

// ===== اختصارات «الإجراء القادم»: اليوم / بكرة / بعد غد =====
// «اليوم» = الساعة ١٠ لو لسه قدامها، وإلا أقرب وقت بعد دلوقتي (نص ساعة).
const nextActionQuickValue = (kind: 'today' | 'tomorrow' | 'dayAfter'): string => {
  const at = new Date();
  if (kind === 'tomorrow') {
    at.setDate(at.getDate() + 1);
    at.setHours(10, 0, 0, 0);
  } else if (kind === 'dayAfter') {
    at.setDate(at.getDate() + 2);
    at.setHours(10, 0, 0, 0);
  } else {
    const ten = new Date(at);
    ten.setHours(10, 0, 0, 0);
    if (ten.getTime() > at.getTime()) {
      at.setHours(10, 0, 0, 0);
    } else {
      // أقرب نصف ساعة بعد دلوقتي
      at.setMinutes(Math.ceil(at.getMinutes() / 30) * 30, 0, 0);
      if (at.getTime() <= Date.now()) at.setHours(at.getHours() + 1);
    }
  }
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}T${pad(at.getHours())}:${pad(at.getMinutes())}`;
};

// قيمة حقل <input type="datetime-local"> الافتراضية عند إضافة عميل:
// اليوم السادسة مساءً، وإذا فات الوقت فبكرة — فيبقى الحقل صالحاً دائماً
// بدون أن يحتاج أحد لكتابة تاريخ يدوياً (مع إمكانية تفريغه).
const nextReminderInput = (): string => {
  const at = new Date();
  at.setHours(18, 0, 0, 0);
  if (at.getTime() <= Date.now()) at.setDate(at.getDate() + 1);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}T${pad(at.getHours())}:${pad(at.getMinutes())}`;
};

// ===== البحث الذكي: فهم احتياجات العميل من نص عربي حر =====
// مثال: «العميل محتاج شقة ب اتنين مليون في التجمع بمساحة مية وعشرين متر و٣ غرف»
const NEEDS_TYPE_WORDS: Array<{ keys: string[]; label: string }> = [
  { keys: ['شقة', 'شقق'], label: 'شقة' },
  { keys: ['فيلا', 'فلل', 'فيلات', 'villa'], label: 'فيلا' },
  { keys: ['توين هاوس', 'توينهاوس', 'twin house'], label: 'توين هاوس' },
  { keys: ['دوبلكس', 'duplex'], label: 'دوبلكس' },
  { keys: ['بنتهاوس'], label: 'بنتهاوس' },
  { keys: ['استوديو', 'studio'], label: 'استوديو' },
  { keys: ['شاليه'], label: 'شاليه' },
  { keys: ['أرض', 'أراضي', 'اراضي'], label: 'أرض' },
  { keys: ['مكتب', 'مكاتب', 'إداري', 'اداري'], label: 'مكتب' },
  { keys: ['محل', 'محلات', 'تجاري'], label: 'محل' },
  { keys: ['عمارة', 'بناية', 'عقار'], label: 'عمارة' },
];

// الأرقام والوحدات المالية والغرف تُفهم في src/arabicNumbers.ts
// (مختبرة في tests/arabic-numbers.mjs: غرفتين، عشر آلاف، مية وخمسين ألف، نص مليون…)
const needsTokens = (normalized: string): string[] =>
  normalized.split(/[^\u0621-\u064A0-9a-zA-Z]+/).filter(Boolean);

const findValueWord = (word: string): number | null => numberWordValue(word);

// مجموع كلمات الأرقام في نافذة: (مية وعشرين) => 120 | (خمسة وتلاتين) => 35
const arabicWordsToNumber = (words: string[]): number | null => arabicNumberValue(words.join(' '));

// الرقم الذي يسبق كلمة (متر / مليون / غرف) سواء مكتوباً بالأرقام أو بالحروف
const numberBeforeToken = (
  tokens: string[],
  index: number,
  opts: { min: number; max: number; wordWindow?: number }
): number | null => {
  let digit: number | null = null;
  const words: string[] = [];
  const window = opts.wordWindow ?? 3;
  for (let back = 1; back <= window && index - back >= 0; back += 1) {
    const prev = tokens[index - back];
    if (!prev) break;
    const bare = prev.replace(/^و/, '');
    if (!bare) continue;
    if (/^[\d.,]+$/.test(bare)) {
      const asNumber = parseFloat(bare.replace(',', '.'));
      if (!Number.isNaN(asNumber) && asNumber >= opts.min && asNumber <= opts.max) digit = asNumber;
      break;
    }
    if (findValueWord(prev)) {
      words.push(prev);
      continue;
    }
    break;
  }
  if (digit !== null) return digit;
  // الكلمات مجموعة بالعكس (من الأقرب للأبعد) فنعيدها لترتيبها الطبيعي
  const total = arabicWordsToNumber(words.slice().reverse());
  return total !== null && total >= opts.min && total <= opts.max ? total : null;
};

// أقل مبلغ يُحسب سعراً للعقار (بالجنيه). 10,000 لأن ما دونها غالباً غرف/مساحة،
// وتسمح بقراءة «10000» نفسها كسعر — وكذلك «عشر آلاف» بالحروف.
const PRICE_FLOOR = 10000;

const moneyFrom = (text: string): number | null => {
  // التعبير العربي الكامل أدق: (مية وخمسين ألف) = 150,000 و(نص مليون) = 500,000
  const explicit = arabicMoneyValue(text);
  if (explicit !== null) return explicit;
  const candidates = [...parseMoneyQuery(text)].filter((value) => value >= PRICE_FLOOR);
  if (!candidates.length) return null;
  return Math.max(...candidates);
};

export type NeedsQuery = {
  kinds: string[];
  priceMin: number | null;
  priceMax: number | null;
  areaMin: number | null;
  areaMax: number | null;
  rooms: number | null;
  places: string[];
  finishing: 'fully-finished' | 'semi-finished' | 'core-and-shell' | null;
  delivery: 'immediate' | 'delayed' | null;
  raw: string;
};

// هل النص أفاد أي فلتر فعلي؟ (يُستخدم في نافذة الاحتياجات والبحث العام)
const hasNeedsFilter = (needs: NeedsQuery): boolean =>
  needs.kinds.length > 0
  || needs.priceMin !== null
  || needs.priceMax !== null
  || needs.areaMin !== null
  || needs.areaMax !== null
  || needs.rooms !== null
  || needs.places.length > 0
  || needs.finishing !== null
  || needs.delivery !== null;

// تقريب لأقرب خطوة — لا يرجع صفراً لمبلغ صغير (1,500 مع خطوة 5,000 كانت تصبح 0)
const roundTo = (value: number, step: number): number => {
  const rounded = Math.round(value / step) * step;
  return rounded > 0 ? rounded : value;
};

const NEEDS_STOP_WORDS = new Set(
  [
    'العميل', 'عميل', 'محتاج', 'محتاجه', 'عايز', 'عاوز', 'عايزه', 'يريد', 'بدور', 'يدور', 'بيدور',
    'شقه', 'شقق', 'فيلا', 'فلل', 'فيلات', 'ارض', 'اراضي', 'مكتب', 'مكاتب', 'محل', 'محلات', 'عماره',
    'سعر', 'بسعر', 'ميزانيه', 'ميزانية', 'مبلغ', 'سعرها', 'فوق', 'تحت', 'اقل', 'اكتر', 'اكثر', 'حد', 'لحد', 'حتي',
    'اقصي', 'امكانيات', 'حدود', 'تقريبا', 'حوالي', 'من', 'الي', 'في', 'علي', 'مع', 'عن', 'هو', 'هي', 'ده', 'دي',
    'مساحه', 'مساحة', 'امتار', 'متر', 'مترمربع', 'مربع',
    // كل صيغ الغرف (وإلا تُقرأ كأنها «منطقة»)
    'غرف', 'غرفه', 'غرفة', 'غرفتين', 'غرفتان', 'اوض', 'اوضه', 'اوضة', 'اوضتين', 'اوضتان', 'اودتين', 'اودتان',
    'نوم', 'سرير', 'bedroom', 'bedrooms', 'room', 'rooms',
    // كلمات الحمامات/الريسبشن/المطبخ مش أماكن
    'حمام', 'حمامات', 'باث', 'باثروم', 'ريسبشن', 'صاله', 'صالون', 'مطبخ', 'بلكونه', 'تراس', 'جاردن', 'حديقه',
    'تشطيب', 'متشطب', 'سوبر', 'لوكس', 'طوب', 'محاره', 'نص', 'نصف', 'ربع', 'تلت', 'ثلث',
    'تسليم', 'فوري', 'جاهز', 'جنيه', 'مليون', 'الف', 'مليونين', 'ملايين', 'مليار', 'الاف', 'آلاف', 'الفين',
    'مقدم', 'اقساط', 'قسط', 'تقسيط', 'استلام', 'صافي', 'متبقي',
    'بيع', 'شراء', 'يرغب', 'يبحث', 'يبحثون', 'جدا', 'اكون', 'يكون', 'تكون', 'ممكن', 'لو', 'سمحت', 'السلام', 'عليكم',
  ].map((word) => normalizeArabicText(word))
);

// صيغة اسم المنطقة: نزيل «ال» التعريف وحروف الجر المركبة فقط،
// ولا نلمس أول حرف في أسماء حقيقية مثل (بورسعيد) (فيصل) (لوران) (كفر).
const placeForm = (word: string): string => {
  const w = word.replace(/^و/, '');
  if (w.startsWith('لل')) return w.slice(2);
  if (/^(?:بال|فال|لال|كال)/.test(w)) return w.slice(3);
  if (w.startsWith('ال')) return w.slice(2);
  return w;
};

// صيغ الكلمة بعد إزالة «و» وحروف الجر والـ«ال»:
// (بالتجمع) (للتجمع) (بعشر) (بغرفتين) — عشان البحث يفهمها صح
const needsWordForms = (word: string): string[] => {
  const forms = new Set<string>();
  const noWaw = word.replace(/^و/, '');
  forms.add(word);
  forms.add(noWaw);
  const noPrep = noWaw.replace(/^[بلف]+/, '');
  forms.add(noPrep);
  forms.add(noPrep.replace(/^ال/, ''));
  forms.add(noWaw.replace(/^ال/, ''));
  return [...forms].filter(Boolean);
};

const parseNeeds = (raw: string): NeedsQuery => {
  const result: NeedsQuery = {
    kinds: [], priceMin: null, priceMax: null, areaMin: null, areaMax: null,
    rooms: null, places: [], finishing: null, delivery: null, raw: String(raw || ''),
  };
  const q = normalizeArabicText(raw).trim();
  if (!q) return result;
  const qFlat = q.replace(/\s+/g, '');

  // 1) النوع
  for (const entry of NEEDS_TYPE_WORDS) {
    const hit = entry.keys.some((key) => {
      const normalized = normalizeArabicText(key).trim();
      return q.includes(normalized) || qFlat.includes(normalized.replace(/\s+/g, ''));
    });
    if (hit) result.kinds.push(entry.label);
  }

  // 2) استبعاد مدى المساحة أولاً حتى لا يُقرأ كمدى سعري: (من ١٠٠ الي ١٥٠ متر)
  let rest = q;
  const areaRange = q.match(/من\s+([^\s]{1,12}(?:\s+[^\s]{1,12})?)\s+(?:الي|لحد|حتي|ل)\s+([^\s]{1,12}(?:\s+[^\s]{1,12})?)\s*متر/);
  if (areaRange) {
    const low = numberFromSpan(areaRange[1]);
    const high = numberFromSpan(areaRange[2]);
    if (low && high && low < high) {
      result.areaMin = low;
      result.areaMax = high;
      rest = q.replace(areaRange[0], ' ');
    }
  }

  // 3) المساحة المفردة: (ميه وعشرين متر) (120 متر)
  const tokens = needsTokens(rest);
  if (result.areaMin === null) {
    for (let index = 0; index < tokens.length; index += 1) {
      if (!/^(متر|مترمربع|م2|مترا)$/.test(tokens[index])) continue;
      const area = numberBeforeToken(tokens, index, { min: 15, max: 3000 });
      if (area) {
        result.areaMin = roundTo(area * 0.85, 5);
        result.areaMax = roundTo(area * 1.25, 5);
        break;
      }
    }
  }

  // 3-ب) (مساحة 120) (بمساحة مية وعشرين) بدون كلمة «متر»
  if (result.areaMin === null) {
    for (let index = 0; index < tokens.length; index += 1) {
      if (!/^(مساحه|بمساحه|مساحة|بمساحة)$/.test(tokens[index])) continue;
      const area = numberFromSpan(tokens.slice(index + 1, index + 4).join(' '));
      if (area && area >= 15 && area <= 3000) {
        result.areaMin = roundTo(area * 0.85, 5);
        result.areaMax = roundTo(area * 1.25, 5);
        break;
      }
    }
  }

  // 4) الغرف: (٣ غرف) (تلات غرف) (غرفتين) (أوضتين) (غرفة واحدة)
  const rooms = roomsFromText(q);
  if (rooms) result.rooms = rooms;

  // 5) السعر: مدى صريح ثم قيمة مفردة مع حد أعلى ١.٥ ضعف
  const priceRange = rest.match(/(?:^|\s)من\s+(.+?)\s+(?:الي|لحد|حتي|ل)\s*(.+)/);
  let priceMax: number | null = null;
  let priceMin: number | null = null;
  if (priceRange) {
    const low = moneyFrom(priceRange[1]);
    const high = moneyFrom(priceRange[2]);
    if (low && high && low < high) {
      priceMin = low;
      priceMax = high;
    }
  }
  if (priceMax === null) {
    const value = moneyFrom(rest.replace(/متر/g, ' '));
    if (value) {
      // «ميزانية / معايا / لحد» = سقف أعلى، مش بداية نطاق
      const maxOnly = /(لحد|حتي|اقصي|مش اكتر|لا يزيد|تحت|ميزانيه|مبلغ|معايا|حدود|حدودي)/.test(q);
      const minOnly = /(فوق|اكتر من|اكثر من|يبدا من|مش اقل من|ابدا من)/.test(q);
      if (maxOnly && !minOnly) {
        priceMax = value;
      } else {
        priceMin = value;
        priceMax = roundTo(value * 1.5, value >= 1000000 ? 100000 : 5000);
      }
    }
  }
  result.priceMin = priceMin;
  result.priceMax = priceMax;

  // 6) المنطقة: أي كلمة متبقية ليست رقماً ولا كلمة معروفة
  const seen = new Set<string>();
  for (const token of tokens) {
    const word = token.replace(/^و/, '');
    if (word.length < 3) continue;
    if (/^[\d.,]+$/.test(word)) continue;
    const forms = needsWordForms(token);
    // الأرقام والوحدات المالية والغرف وكلمات الحشو لا تُعتبر «منطقة»
    if (forms.some((form) => findValueWord(form))) continue;
    if (forms.some((form) => NEEDS_STOP_WORDS.has(form))) continue;
    if (forms.some((form) => isArabicMoneyWord(form))) continue;
    if (forms.some((form) => isRoomWord(form))) continue;
    // نطبّع اسم المنطقة فقط (إزالة ال/لل/بال…) بدون كسر أسماء مثل بورسعيد
    const place = placeForm(word);
    if (place.length < 3) continue;
    if (seen.has(place)) continue;
    seen.add(place);
    result.places.push(place);
  }

  // 7) التشطيب والتسليم
  if (/(سوبر لوكس|متشطب|تشطيب كامل|مفروش|fully)/.test(q)) result.finishing = 'fully-finished';
  else if (/(نص تشطيب|نصف تشطيب|سيمي|semi)/.test(q)) result.finishing = 'semi-finished';
  else if (/(طوب|علي الطوب|محاره|كور اند شل|core)/.test(q)) result.finishing = 'core-and-shell';

  if (/(تسليم فوري|فوري|جاهز للاستلام|ready)/.test(q)) result.delivery = 'immediate';
  else if (/(تسليم بعد|بعد سنتين|بعد سنه|متاخر|delayed)/.test(q)) result.delivery = 'delayed';

  return result;
};

// رقم من مقطع نصي (للأرقام داخل صيغة «من ... إلى ...»)
function numberFromSpan(span: string): number | null {
  const money = moneyFrom(span);
  if (money) return money;
  const tokens = needsTokens(normalizeArabicText(span));
  for (let index = 0; index < tokens.length; index += 1) {
    const bare = tokens[index].replace(/^و/, '');
    if (/^[\d.,]+$/.test(bare)) {
      const value = parseFloat(bare.replace(',', '.'));
      if (!Number.isNaN(value)) return value;
    }
  }
  // كلمات الأرقام تُجمع: (مئة وعشرين) => 120
  return arabicWordsToNumber(tokens);
}

export type NeedsMatch = { ok: boolean; score: number; reasons: string[]; warns: string[]; skip: string | null };

// مطابقة عقار واحد باحتياجات العميل مع سبب واضح لكل نتيجة
const matchPropertyNeeds = (property: Property, needs: NeedsQuery): NeedsMatch => {
  const reasons: string[] = [];
  const warns: string[] = [];
  let score = 0;
  let skip: string | null = null;
  const price = property.priceNumeric || parsePrice(String(property.price || ''));
  // المساحة قد تكون مكتوبة بالحروف: (مئة وعشرين)
  const area = parseFloat(normalizeDigits(String(property.area || '')).replace(/[^\d.]/g, ''))
    || numberFromSpan(String(property.area || ''))
    || 0;
  const rooms = parseFloat(normalizeDigits(String(property.rooms || '')).replace(/[^\d.]/g, ''))
    || roomsFromText(String(property.rooms || ''))
    || 0;
  // الملاحظات تدخل في المطابقة أيضاً: (العقار مطلوب بيعه بسرعة) (القبضة متبقية) إلخ
  const haystack = normalizeArabicText(
    [property.name, property.type, property.location, property.project, property.compound, property.description, (property as any).floor]
      .filter(Boolean)
      .join(' | ')
  );

  if (needs.kinds.length) {
    const typeText = normalizeArabicText(`${property.type || ''} ${property.name || ''} ${property.description || ''}`);
    const hit = needs.kinds.find((kind) => typeText.includes(normalizeArabicText(kind)));
    if (hit) {
      score += 30;
      reasons.push(`النوع: ${hit}`);
    } else {
      skip = `النوع (${property.type || 'غير محدد'})`;
    }
  }

  if (needs.priceMin !== null || needs.priceMax !== null) {
    const min = needs.priceMin ?? 0;
    const max = needs.priceMax ?? Number.POSITIVE_INFINITY;
    if (!price) warns.push('بدون سعر مسجّل');
    else if (price >= min && price <= max) {
      score += 40;
      reasons.push(`السعر ${price.toLocaleString('en-US')} داخل النطاق`);
    } else if (price >= min * 0.85 && price <= max * 1.15) {
      score += 10;
      warns.push(`السعر ${price.toLocaleString('en-US')} قريب`);
    } else if (skip === null) {
      skip = `السعر ${price.toLocaleString('en-US')} خارج النطاق`;
    }
  }

  if (needs.areaMin !== null || needs.areaMax !== null) {
    const min = needs.areaMin ?? 0;
    const max = needs.areaMax ?? Number.POSITIVE_INFINITY;
    if (!area) warns.push('بدون مساحة مسجّلة');
    else if (area >= min && area <= max) {
      score += 25;
      reasons.push(`المساحة ${area}م`);
    } else if (area >= min * 0.85 && area <= max * 1.15) {
      score += 8;
      warns.push(`المساحة ${area}م قريبة`);
    } else if (skip === null) {
      skip = `المساحة ${area}م خارج النطاق`;
    }
  }

  if (needs.rooms) {
    if (!rooms) warns.push('الغرف غير مسجّلة');
    else if (rooms === needs.rooms) {
      score += 15;
      reasons.push(`${rooms} غرف`);
    } else if (Math.abs(rooms - needs.rooms) === 1) {
      warns.push(`${rooms} غرف بدل ${needs.rooms}`);
    } else if (skip === null) {
      skip = `${rooms} غرف بدل ${needs.rooms}`;
    }
  }

  if (needs.places.length) {
    const hits = needs.places.filter((word) => haystack.includes(word));
    if (hits.length) {
      score += 12 * hits.length;
      reasons.push(`المنطقة: ${hits.join(' / ')}`);
    } else if (property.location || property.compound || property.project) {
      warns.push('منطقة مختلفة');
    } else {
      warns.push('بدون موقع مسجّل');
    }
  }

  if (needs.finishing) {
    if (property.finishing === needs.finishing) {
      score += 10;
      reasons.push('التشطيب مطابق');
    } else {
      warns.push('تشطيب مختلف');
    }
  }

  if (needs.delivery) {
    if (property.delivery === needs.delivery) {
      score += 10;
      reasons.push(needs.delivery === 'immediate' ? 'تسليم فوري' : 'تسليم بعد فترة');
    } else {
      warns.push('تسليم مختلف');
    }
  }

  return { ok: skip === null, score, reasons, warns, skip };
};

// ملخّص نصي للفلتر النشط (يظهر في شريط العقارات)
const needsSummary = (needs: NeedsQuery): string => {
  const parts: string[] = [];
  if (needs.kinds.length) parts.push(needs.kinds.join(' / '));
  if (needs.priceMin !== null || needs.priceMax !== null) {
    const low = needs.priceMin !== null ? Number(needs.priceMin).toLocaleString('en-US') : '0';
    const high = needs.priceMax !== null ? Number(needs.priceMax).toLocaleString('en-US') : 'بلا حد';
    parts.push(`${low} → ${high} ج.م`);
  }
  if (needs.areaMin !== null || needs.areaMax !== null) parts.push(`${needs.areaMin ?? 0} → ${needs.areaMax ?? 'بلا حد'} م`);
  if (needs.rooms) parts.push(`${needs.rooms} غرف`);
  if (needs.places.length) parts.push(needs.places.join(' / '));
  if (needs.finishing) parts.push(needs.finishing === 'fully-finished' ? 'متشطب' : needs.finishing === 'semi-finished' ? 'نصف تشطيب' : 'طوب');
  if (needs.delivery) parts.push(needs.delivery === 'immediate' ? 'تسليم فوري' : 'تسليم بعد فترة');
  return parts.join(' • ') || '—';
};

const formatDateTime = (dateString: string): string => {
  const date = new Date(dateString);
  return date.toLocaleDateString('ar-EG', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const isReminderDue = (reminder: Reminder): boolean => {
  if (reminder.isCompleted) return false;
  return new Date(reminder.dateTime) <= new Date();
};

const getTimeUntil = (reminder: Reminder): string => {
  const now = new Date();
  const reminderTime = new Date(reminder.dateTime);
  const diff = reminderTime.getTime() - now.getTime();
  
  if (diff <= 0) return 'الآن!';
  
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  
  if (days > 0) return `${days} يوم`;
  if (hours > 0) return `${hours} ساعة`;
  return `${minutes} دقيقة`;
};

const playNotificationSound = () => {
  try {
    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    
    const playTone = (frequency: number, startTime: number, duration: number) => {
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();
      
      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);
      
      oscillator.frequency.value = frequency;
      oscillator.type = 'sine';
      
      gainNode.gain.setValueAtTime(0, startTime);
      gainNode.gain.linearRampToValueAtTime(0.3, startTime + 0.01);
      gainNode.gain.exponentialRampToValueAtTime(0.01, startTime + duration);
      
      oscillator.start(startTime);
      oscillator.stop(startTime + duration);
    };

    const now = audioContext.currentTime;
    playTone(523.25, now, 0.2);
    playTone(659.25, now + 0.15, 0.2);
    playTone(783.99, now + 0.3, 0.2);
    playTone(1046.50, now + 0.45, 0.4);
  } catch (e) {
    console.log('Audio not supported');
  }
};

const vibrateDevice = () => {
  if ('vibrate' in navigator) {
    navigator.vibrate([200, 100, 200, 100, 200, 100, 200]);
  }
};

// إشعار الجهاز: يمر عبر Service Worker (يعمل على آيفون وأندرويد)
// وبصامت — نوتفكيشن فقط بلا رنة أو اهتزاز متكرر.
const sendNotification = (title: string, body: string, tag?: string) => {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  void localNotification(title, body, tag || `crm-${Date.now()}`);
};

// ===== معاينة الواجهة الجديدة (وضع التطوير فقط) =====
// تفتح بـ ?preview=dashboard أو ?preview=leads أو ?preview=sheet — بتعرض نفس
// الكومبوننتس اللي في النسخة الحقيقية ببيانات وهمية، عشان تشوف الشكل قبل الرفع.
// الكود ده بيتشال بالكامل من نسخة الإنتاج (import.meta.env.DEV = false).
function DevPreview({ screen: initial }: { screen: string }) {
  const [screen, setScreen] = useState(initial);

  const mockUser = { id: 'u1', name: 'محمد سمير', role: 'sales' } as any;
  const mockClients: any[] = [
    {
      id: 'crm-lead-01001234567', name: 'محمد كامل', phone: '01001234567',
      stage: 'contacted', createdAt: '2026-10-10T14:00:00.000Z', campaignAt: '2026-10-10T14:00:00.000Z',
      updatedAt: '2026-10-24T08:00:00.000Z', formName: 'New CAVA',
      source: 'رقم موزّع — استيراد تلقائي • المصدر: فيسبوك - New CAVA • التاريخ: 10/10/2026 - 02:00 م',
      activities: [
        { id: 'a1', type: 'feedback', text: 'طلب معاينة العقار Saturday', status: 'follow-up', at: '2026-10-23T12:10:00.000Z', by: 'محمد سمير' },
        { id: 'a2', type: 'call', text: 'اتصال: تم الرد', at: '2026-10-23T12:00:00.000Z', by: 'محمد سمير' },
      ],
    },
    {
      id: 'crm-lead-01112223344', name: 'عمر ياسر', phone: '01112223344',
      stage: 'meeting', createdAt: '2026-10-23T12:00:00.000Z', campaignAt: '2026-10-23T12:00:00.000Z',
      updatedAt: '2026-10-24T08:00:00.000Z', formName: 'CAVA VIP',
      source: 'رقم موزّع — استيراد تلقائي • المصدر: فيسبوك - CAVA VIP • التاريخ: 23/10/2026 - 03:00 م',
      activities: [
        { id: 'b1', type: 'feedback', text: 'اتفق على معاينة units 12', status: 'meeting', at: '2026-10-24T09:00:00.000Z', by: 'محمد سمير' },
      ],
    },
    {
      id: 'crm-lead-01223334455', name: 'محمود احمد', phone: '01223334455',
      stage: 'new', createdAt: '2026-10-22T07:43:00.000Z', campaignAt: '2026-10-22T07:43:00.000Z',
      updatedAt: '2026-10-22T09:43:00.000Z', formName: 'GO ADS',
      source: 'رقم موزّع — استيراد تلقائي • المصدر: فيسبوك - GO ADS • التاريخ: 22/10/2026 - 09:43 ص',
      activities: [],
    },
  ];
  const mockLeads: any[] = [
    {
      id: 'l1', name: 'OmYazed WeEyad', phone: '01099887766', formName: 'New CAVA',
      campaignAt: '2026-10-23T12:00:00.000Z', status: 'new', salesId: 'u1',
      description: 'استيراد تلقائي • المصدر: فيسبوك - New CAVA • التاريخ: 23/10/2026 - 03:00 م',
      createdAt: '2026-10-23T12:05:00.000Z',
    },
    {
      id: 'l2', name: 'محمود احمد', phone: '01088776655', formName: 'Palm Hills',
      campaignAt: '2026-10-22T07:43:00.000Z', status: 'new', salesId: 'u1',
      description: 'استيراد تلقائي • المصدر: فيسبوك - Palm Hills • التاريخ: 22/10/2026 - 09:43 ص',
      createdAt: '2026-10-22T09:43:00.000Z',
    },
  ];
  const mockCallLogs: any[] = [
    { id: 'cl1', salesId: 'u1', clientPhone: '01001234567', result: 'answered', comment: 'طلب معاينة', createdAt: '2026-10-23T12:00:00.000Z' },
  ];
  const mockNumbers = buildWorkNumbers(mockClients, mockLeads, new Map());
  const mockStats = {
    totalClients: mockClients.length, campaignClients: mockClients.length,
    facebookClients: 0, externalClients: 0, totalProperties: 0, dueNow: 0,
  };
  const mockComments = [
    { id: 'k1', by: 'محمد سمير', at: '2026-10-23T12:10:00.000Z', text: 'طلب معاينة العقار Saturday', status: 'follow-up', result: 'answered' },
    { id: 'k2', by: 'محمد سمير', at: '2026-10-23T12:00:00.000Z', text: 'اتصال: تم الرد', result: 'answered' },
  ];

  return (
    <div className="min-h-screen bg-[var(--bg)] p-4">
      {/* المعاينة على شاشة الموبايل: الشريط السفلي يبان جوه الإطار */}
      <style>{`
        .eg-preview .eg-tabbar { display: flex; position: static; margin-top: 14px; border-radius: var(--r-lg); border: 1px solid var(--border); }
        .eg-preview-body { background: var(--surface); border: 1px solid var(--border); border-radius: var(--r-lg); padding: 14px; }
        /* إطار موبايل 390px: التحويل (transform) بيخلي العناصر fixed جوّه الإطار
           تتحسب جوّه الإطار نفسه — زي ما هي على شاشة الموبايل فعلاً */
        .eg-phone {
          width: 390px; margin: 0 auto; overflow: hidden;
          border-radius: 28px; border: 1px solid var(--border);
          background: var(--bg); position: relative; transform: translateZ(0);
          box-shadow: 0 18px 50px rgba(0,0,0,.45);
        }
        .eg-phone.is-screen { height: 760px; }
      `}</style>
      <div className="mx-auto eg-preview" style={{ maxWidth: 430 }}>
        <div className="eg-filters mb-4">
          {[
            { id: 'dashboard', label: 'Dashboard (Leads Board)' },
            { id: 'leads', label: 'Leads' },
            { id: 'sheet', label: 'Action sheet' },
          ].map((s) => (
            <button key={s.id} type="button" className={`eg-filter ${screen === s.id ? 'is-on' : ''}`}
              onClick={() => setScreen(s.id)}>{s.label}</button>
          ))}
        </div>

        <div className={`eg-phone ${screen === 'sheet' ? 'is-screen' : ''}`}>
          <div className="eg-preview-body">
            {screen === 'dashboard' && (
              <DashboardView
                stats={mockStats} clients={mockClients} numbers={mockNumbers} reminders={[]}
                properties={[]} currentUser={mockUser} impersonating={true} callLogs={mockCallLogs}
                onOpenStatus={() => {}} onCompleteReminder={() => {}} onActed={() => {}}
              />
            )}
            {screen === 'leads' && (
              <LeadsView
                currentUser={mockUser} numbers={mockNumbers} leads={mockLeads} callLogs={mockCallLogs}
                filter="" onFilter={() => {}} onOpen={() => {}} onBack={() => setScreen('dashboard')}
              />
            )}
          </div>

          {screen === 'sheet' && (
            <CallFlowModal
              client={{ id: 'crm-lead-01001234567', name: 'محمد كامل', phone: '01001234567' }}
              comments={mockComments}
              onClose={() => setScreen('leads')}
              onSave={() => {}}
            />
          )}

          {screen !== 'sheet' && (
            <MobileTabBar activeTab={screen === 'leads' ? 'leads' : 'dashboard'} onTab={() => {}} onMore={() => {}} badge={2} />
          )}
        </div>
      </div>
    </div>
  );
}

function App() {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  // نبدأ من آخر تبويب محفوظ للحساب (بدل «الرئيسية» في كل ريفريش)، فالاستعادة
  // بتحصل قبل الرسم الأول حتى ما يحصلش وميض ثم قفزة.
  const [activeTab, setActiveTab] = useState<TabType>(() => {
    try {
      const stored = localStorage.getItem('current_user');
      return stored ? startTabFor(JSON.parse(stored) as User) : 'dashboard';
    } catch {
      return 'dashboard';
    }
  });
  
  const [clients, setClients] = useState<Client[]>([]);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  // ===== نبضة كل ٣٠ ثانية: عشان الكارت يتحوّل لأصفر في وقته بالظبط =====
  // (لما التذكير يعدي وقت الاتصال والسيلز مخدش خطوة، الكارت يطلب إجراء).
  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNowTick(Date.now()), 30000);
    return () => window.clearInterval(timer);
  }, []);
  const [properties, setProperties] = useState<Property[]>([]);
  const [dailyFeedbacks, setDailyFeedbacks] = useState<DailyFeedback[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [assignedLeads, setAssignedLeads] = useState<AssignedLead[]>([]);
  // ===== المخزون الكامل لأرقام الكامبين والعملاء (لحسابات الإدارة فقط) =====
  // شاشات أرقام الكامبين (توزيع الأرقام / عملاء كامبين / شيت الفورمات) تعرض مخزون
  // الشركة كله — وهي لوحة إدارة، فرؤيتها ما تتأثر بنطاق الحساب.
// أما لوحة السيلز (عملائي/المراحل/الفيدباك) فتبقى بنطاق الحساب وحده.
  // الحساب السيلز ما بيحمّلش المخزون الكامل أصلاً (مفيش داعي — وهو الممنوع أصلاً).
  const [fullLeads, setFullLeads] = useState<AssignedLead[]>([]);
  const [fullClients, setFullClients] = useState<Client[]>([]);
  // ===== مخزون الفيدباك الكامل (حسابات الإدارة فقط) =====
  // «الفيدباك اليومي لكل سيلز» لوحة إدارة: لازم تشوف فيدباك كل المندوبين مهما ضُبط
  // نطاق الحساب الشخصي (حساب المطوّر مثلاً محدود النطاق في شاشاته هو، لكن لوحة
  // الإدارة لازم تعرض شغل الفريق كله وإلا كانت فاضية دائماً).
  const [fullFeedbacks, setFullFeedbacks] = useState<DailyFeedback[]>([]);
  const [fullCallLogs, setFullCallLogs] = useState<CallLog[]>([]);
  // قواعد «التوزيع التلقائي»: فورم ← مندوبون بعينهم (تسافر بين الأجهزة)
  const [autoAssignRules, setAutoAssignRules] = useState<AutoAssignRule[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  // قائمة التبويبات الجانبية على الشاشات الصغيرة
  const [sidebarOpen, setSidebarOpen] = useState(false);
  // إخفاء/إظهار القائمة الجانبية على الشاشات الكبيرة (زر ☰ يظل ظاهراً دائماً)
  const [desktopNavHidden, setDesktopNavHidden] = useState(false);
  // مركز الإشعارات (مقسّم: تذكيرات / أرقام جديدة / رسائل / اتصالات الفريق)
  const [showNotifyCenter, setShowNotifyCenter] = useState(false);
  // هدف المكالمة الآن: عميل مسجّل، أو رقم موزَّع لسه مش عميل ( CallTarget )
  const [callClient, setCallClient] = useState<CallTarget | null>(null);
  // التذكير اللي اتفتح من زرار ✓: بعد حفظ الاتصال/الفيدباك ينتهي التذكير تلقائياً
  const [reminderCallId, setReminderCallId] = useState<string | null>(null);
  const [callLogs, setCallLogs] = useState<CallLog[]>([]);
  // الإشعارات التي رآها هذا المستخدم (على هذا الجهاز) — لحساب العدّاد الأحمر
  const [seenNotifIds, setSeenNotifIds] = useState<string[]>([]);
  const [selectedUserFeedback, setSelectedUserFeedback] = useState<User | null>(null);
  
  const [showAddClient, setShowAddClient] = useState(false);
  // مصدر/فورم جاهز لنافذة «إضافة عميل» (عملاء كامبين يفتحوها بمصدر «كامبين»)
  const [addClientPreset, setAddClientPreset] = useState<any>(null);
  // فتح نافذة «إضافة عميل» — مع مصدر جاهز (من «عملاء كامبين» ⇒ مصدر «كامبين»
  // عشان العميل المضاف يدوياً يظهر في تبويب عملاء كامبين زي ما يكون جاي من شيت)
  const openAddClient = (preset?: any) => {
    setAddClientPreset(preset || null);
    setShowAddClient(true);
  };
  const [showAddReminder, setShowAddReminder] = useState(false);
  const [showAddProperty, setShowAddProperty] = useState(false);
  const [showAddFeedback, setShowAddFeedback] = useState(false);
  // فتح «إضافة فيدباك» برقم محدد مسبقاً (من مراحل الرئيسية أو من كارت العميل)
  const [feedbackPreset, setFeedbackPreset] = useState<{ clientId?: string; clientName?: string; clientPhone?: string } | null>(null);
  const [showAddUser, setShowAddUser] = useState(false);
  const [showAddTeam, setShowAddTeam] = useState(false);
  const [showAddAssignedLead, setShowAddAssignedLead] = useState(false);
  const [showImportLeads, setShowImportLeads] = useState(false);
  // رفع شيت عملاء في «عملاء كامبين» (أي شيت فيه اسم الشخص ورقمه)
  const [showImportClients, setShowImportClients] = useState(false);
  
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [selectedProperty, setSelectedProperty] = useState<Property | null>(null);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [selectedTeam, setSelectedTeam] = useState<Team | null>(null);
  
  const [searchTerm, setSearchTerm] = useState('');
  const [propertySearch, setPropertySearch] = useState('');
  // بند ٤: الحالة المفتوحة — صفحة فيها كل أرقام الحالة دي
  const [statusBoard, setStatusBoard] = useState<string | null>(null);
  // فلتر الحالة في صفحة «الأرقام» ('' = كل الأرقام) — العدّادات في «الرئيسية»
  // بتفتح نفس الصفحة مفلترة على الحالة اللي اتضغطت.
  const [leadsFilter, setLeadsFilter] = useState<string>('');
  // صفحة الأرقام مفتوحة جوه الرئيسية (مش تبويب مستقل) — دي «الرقم» في ENGAZ
  const [leadsOpen, setLeadsOpen] = useState(false);
  // صوت رسائل المحادثة فقط — التذكيرات نوتفكيشن صامتة (بند ٦) وما بتستخدمش الصوت.
  const [soundEnabled, setSoundEnabled] = useState(true);
  // صلاحية إشعارات المتصفح على هذا الجهاز (default = لم يُسأل بعد)
  const [notifPermission, setNotifPermission] = useState<string>(() =>
    typeof Notification === 'undefined' ? 'unsupported' : Notification.permission
  );
  // تنبيه تفعيل الإشعارات: يظهر مرة واحدة حتى يضغط «لاحقاً»
  const [notifPromptDismissed, setNotifPromptDismissed] = useState<boolean>(() => {
    try {
      return localStorage.getItem('crm_notif_prompt_hidden') === '1';
    } catch {
      return false;
    }
  });
  const [inAppNotification, setInAppNotification] = useState<{title: string, body: string} | null>(null);

  // ===== المنبه والإشعارات الحقيقية =====
  const [alarmSettings, setAlarmSettings] = useState<AlarmSettings>(() => loadAlarmSettings());
  // تذكيرات طُلب لها إشعار خارجي في هذه الجلسة (منع نداء الإرسال كل ثانيتين)
  const flushAskedRef = useRef<Set<string>>(new Set());
  const [showNotifyPanel, setShowNotifyPanel] = useState(false);
  const [notifState, setNotifState] = useState<PushState>('default');
  const [notifBusy, setNotifBusy] = useState(false);
  const [notifMessage, setNotifMessage] = useState('');

  // ----- بند ٦ (التذكيرات نوتفكيشن خارجي فقط) وبند ٨ (التأخير بعد ٥ دقايق) -----
  const reminderFiredKey = 'crm_reminder_fired';
  // تذكيرات ظهر لها إشعار على هذا الجهاز — محفوظة فلا يتكرر الإشعار أبداً
  const reminderNotifiedKey = 'crm_notified';
  const reminderActedKey = 'crm_reminder_acted';
  const REMINDER_ACTION_WINDOW_MS = 5 * 60 * 1000; // لو مافيش إجراء خلال ٥ دقايق → «متأخر»

  const readIdMap = (key: string): Record<string, string> => {
    try {
      return JSON.parse(localStorage.getItem(key) || '{}');
    } catch {
      return {};
    }
  };

  // لحظة وصول التذكير: منها يبدأ عدّاد الخمس دقايق
  const markReminderFired = (id: string) => {
    const map = readIdMap(reminderFiredKey);
    if (!map[id]) {
      map[id] = new Date().toISOString();
      localStorage.setItem(reminderFiredKey, JSON.stringify(map));
    }
  };

  // أي إجراء (إتمام / تأجيل / فتح التذكير) يقفل نافذة الخمس دقايق
  const markReminderAction = (id: string) => {
    const map = readIdMap(reminderActedKey);
    map[id] = new Date().toISOString();
    localStorage.setItem(reminderActedKey, JSON.stringify(map));
  };

  // تذكير مرّ عليه ٥ دقايق بلا أي إجراء → يُسجّل «متأخر» مرة واحدة
  const applyReminderDelays = () => {
    try {
      const all: Reminder[] = JSON.parse(localStorage.getItem('crm_reminders') || '[]');
      const fired = readIdMap(reminderFiredKey);
      const acted = readIdMap(reminderActedKey);
      let delayedName = '';
      const next = all.map((r) => {
        if (r.isCompleted || r.isDelayed) return r;
        const at = fired[r.id];
        if (!at || acted[r.id]) return r;
        if (Date.now() - new Date(at).getTime() < REMINDER_ACTION_WINDOW_MS) return r;
        delayedName = delayedName || r.clientName || '';
        return { ...r, isDelayed: true, delayCount: (r.delayCount || 0) + 1 };
      });
      if (delayedName) {
        // التسجيل بيحصل في البيانات فقط (بدون أي تنبيه داخلي): التذكير له
        // إشعار خارجي واحد في وقته، والتأخير يبان في شارة الجرس والتبويبات.
        localStorage.setItem('crm_reminders', JSON.stringify(next));
        if (currentUser) loadData();
      }
    } catch {
      /* لا شيء */
    }
  };

  const readReminders = (): Reminder[] => {
    try {
      return JSON.parse(localStorage.getItem('crm_reminders') || '[]');
    } catch {
      return [];
    }
  };

  // تذكيرات ظهر لها إشعار على هذا الجهاز (بديل محلي لما الجهاز مش مشترك في الدفع)
  const readNotifiedIds = (): Set<string> => {
    try {
      const parsed = JSON.parse(localStorage.getItem(reminderNotifiedKey) || '[]');
      return new Set(Array.isArray(parsed) ? parsed.map(String) : []);
    } catch {
      return new Set();
    }
  };

  const writeNotifiedIds = (ids: Set<string>) => {
    try {
      localStorage.setItem(reminderNotifiedKey, JSON.stringify(Array.from(ids).slice(-500)));
    } catch {
      /* لا شيء */
    }
  };

  const completeReminder = (id: string) => {
    markReminderAction(id);
    const next = readReminders().map((r) => (r.id === id ? { ...r, isCompleted: true } : r));
    localStorage.setItem('crm_reminders', JSON.stringify(next));
    void pushKey('crm_reminders');
    loadData();
  };

  // ===== زرار ✓ في التذكيرات: يسجّل الاتصال (تم الرد / لم يرد) والفيدباك أولاً،
  // وبمجرد الحفظ ينتهي التذكير. الحفظ نفسه يمر على نفس مسار تسجيل الفيدباك
  // (خط زمني + بطاقة في الفيدباك اليومي + مكالمة + تحريك المرحلة).
  const startReminderCall = (reminder: Reminder) => {
    if (!reminder) return;
    const norm = (v: any) => String(v || '').replace(/\D/g, '');
    const client = clients.find((c: Client) => c.id === reminder.clientId)
      || clients.find((c: Client) => norm(c.phone) && norm(c.phone) === norm(reminder.clientPhone));
    const target: CallTarget = client
      ? { ...client, name: reminder.clientName || client.name, phone: reminder.clientPhone || client.phone }
      : {
          // التذكير على رقم مش مسجّل كعميل: يتسجّل بمعرّفه من الرقم، فيتدمج ولا يتكرر
          id: reminder.clientId || leadClientIdFor(reminder.clientPhone) || `reminder-${reminder.id}`,
          name: reminder.clientName || 'بدون اسم',
          phone: reminder.clientPhone || '',
          stage: 'new',
          virtualLead: true,
        };
    setReminderCallId(reminder.id);
    setCallClient(target);
  };

  const snoozeReminder = (id: string, minutes: number) => {
    // التأجيل إجراء متعمد: يقفل عدّاد الخمس دقائق ولا يُحسب «متأخر».
    markReminderAction(id);
    const next = readReminders().map((r) => {
      if (r.id !== id) return r;
      return { ...r, dateTime: new Date(Date.now() + minutes * 60000).toISOString() };
    });
    localStorage.setItem('crm_reminders', JSON.stringify(next));
    void pushKey('crm_reminders');
    // نُخرجه من قائمة «تم إشعاره» حتى يظهر إشعار آخر في موعده الجديد
    const notified = readNotifiedIds();
    notified.delete(id);
    writeNotifiedIds(notified);
    flushAskedRef.current.delete(id);
    loadData();
  };

  // ملاحظة: التنبيه الداخلي (بطاقة التذكير العائمة) اتشال خلاص —
  // التذكير بيظهر كإشعار خارجي على الجهاز مرة واحدة في وقته بس.

  // تحديث الهوية على الأجهزة المثبّتة: المتصفح يقرأ المانيفست من السيرفر لما نطلب
  // منه يعيد تحميل عامل الخدمة، فيتغيّر الاسم والأيقونة على الاختصار المثبّت
  // بدون حذف التطبيق ولا إعادة تثبيته. نطلب التحديث عند الفتح وعند العودة للتطبيق.
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    const refresh = () => {
      navigator.serviceWorker
        .getRegistration()
        .then((reg) => reg && reg.update())
        .catch(() => {});
    };
    refresh();
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);

  // رسائل من خدمة الإشعارات: زر «تأجيل ٥ د» على الإشعار الخارجي
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    const onMessage = (event: MessageEvent) => {
      const msg = event.data || {};
      if (msg.type === 'snooze' && msg.id) snoozeReminder(msg.id, Number(msg.minutes) || loadAlarmSettings().snoozeMin);
    };
    navigator.serviceWorker.addEventListener('message', onMessage);
    return () => navigator.serviceWorker.removeEventListener('message', onMessage);
  }, []);

  // حالة الإشعارات على هذا الجهاز + إعادة تسجيل الاشتراك تلقائياً عند كل دخول
  // (آيفون يجدّد الاشتراك بعد تحديث التطبيق، والقاعدة قد تكون اتغيّرت — بهذا
  // يظل الجهاز مسجّلاً بلا أن يضغط المستخدم «تفعيل» من جديد).
  useEffect(() => {
    if (!currentUser) return;
    resyncPush({ id: currentUser.id, name: currentUser.name }).then(setNotifState).catch(() => {});
  }, [currentUser?.id, showNotifyPanel]);

  // ===== تنبيه انتهاء صلاحية توكن السحب (للإدارة فقط) =====
  // التوكن ينتهي بعد مدة محددة (ساعتان للمستكشف، أو ٦٠ يوماً بعد التمديد)، وعند انتهائه
  // يتوقف سحب أرقام الكامبينات بصمت. هنا نقرأ الإعدادات مرة عند الدخول ونعرض شريط
  // تذكير قبل الانتهاء بيومين — حتى يجدّده الإدارة قبل أن ينقطع السحب.
  const [tokenNotice, setTokenNotice] = useState<{ channel: 'facebook' | 'instagram'; label: string; expired: boolean } | null>(null);
  useEffect(() => {
    if (!currentUser || currentUser.role === 'sales') return;
    let alive = true;
    fetch('/api/lead-source', { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((json) => {
        if (!alive || json?.stateless || !json?.config) return;
        const now = Date.now();
        const warnOf = (cfg: any, channel: 'facebook' | 'instagram', label: string) => {
          const expiresAt = Number(cfg?.tokenExpiresAt) || 0;
          if (!cfg?.hasToken || !expiresAt || expiresAt * 1000 - now > 2 * 24 * 60 * 60 * 1000) return null;
          return { channel, label, expired: expiresAt * 1000 <= now };
        };
        setTokenNotice(warnOf(json.config, 'facebook', 'فيسبوك') || warnOf(json.config.instagram, 'instagram', 'إنستجرام'));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [currentUser?.id, currentUser?.role]);

  // ===== إرسال التذكيرات المستحقة من أي جهاز مفتوح =====
  // الإشعار الخارجي كان يعتمد على مجدول خارجي وحده؛ فلو تأخر أو توقف تبقى التذكيرات
  // بلا إشعار. كل جهاز مفتوح يطلب من السيرفر (مرة كل دقيقة) إرسال المستحق الآن،
  // فيوصل إشعار للأجهزة — حتى لو الموقع مقفول عندها — مرة واحدة لكل تذكير.
  useEffect(() => {
    if (!currentUser) return;
    const run = () => {
      if (document.visibilityState !== 'visible') return;
      void flushPush();
    };
    run();
    const timer = window.setInterval(run, 60_000);
    document.addEventListener('visibilitychange', run);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', run);
    };
  }, [currentUser?.id]);

  // ===== قياس ارتفاع الشريط العلوي فعلياً =====
  // الشريط ثابت (fixed)، فالمحتوى يحتاج مساحة محجوزة بمقداره — وارتفاعه يتغيّر
  // مع حجم الشاشة والخط وطول اسم الحساب. القياس هنا يمنع أي نص يمرّ تحته.
  useEffect(() => {
    const root = document.documentElement;
    const measure = () => {
      const bar = document.querySelector('.app-topbar');
      const height = bar ? Math.round(bar.getBoundingClientRect().height) : 0;
      if (height > 0) root.style.setProperty('--topbar-h', `${height}px`);
    };
    measure();
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    const bar = document.querySelector('.app-topbar');
    if (observer && bar) observer.observe(bar);
    window.addEventListener('resize', measure);
    window.addEventListener('orientationchange', measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
      window.removeEventListener('orientationchange', measure);
    };
  }, [currentUser?.id, desktopNavHidden, sidebarOpen]);
  const [loginAnimation, setLoginAnimation] = useState<User | null>(null);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [deletingUser, setDeletingUser] = useState<User | null>(null);
  const [syncOnline, setSyncOnline] = useState(isOnline());
  // المدير الذي «دخل» إلى حساب سيلز — محفوظ على هذا الجهاز فقط ولا يُزامَن
  const [impersonator, setImpersonator] = useState<User | null>(null);

  // نقرأ «ما رآه المستخدم من إشعارات» من جهازه كلما تبدّل الحساب
  useEffect(() => {
    if (!currentUser) {
      setSeenNotifIds([]);
      return;
    }
    try {
      const raw = JSON.parse(localStorage.getItem(`crm_notif_seen_${currentUser.id}`) || '[]');
      setSeenNotifIds(Array.isArray(raw) ? raw : []);
    } catch {
      setSeenNotifIds([]);
    }
  }, [currentUser?.id]);

  useEffect(() => {
    initializeSystem();
    applyMode(readMode()); // تطبيق وضع المظهر (ليلي/نهاري) المحفوظ قبل أي شيء
    // نسجّل عامل الخدمة مبكراً حتى يكون جاهزاً للإشعارات (بدل انتظار أول اشتراك)
    void registerWorker();
    setNotifPermission(typeof Notification === 'undefined' ? 'unsupported' : Notification.permission);
    // استرجاع جلسة «الدخول لحساب سيلز» بعد تحديث الصفحة
    const imp = localStorage.getItem('impersonator_user');
    if (imp) {
      try {
        setImpersonator(JSON.parse(imp));
      } catch {
        localStorage.removeItem('impersonator_user');
      }
    }
  }, []);

  // ===== التحقق من الجلسة **قبل** إظهار أي بيانات =====
  // الحماية الحقيقية: بيانات العملاء لا تُقرأ إلا بكوكي جلسة صادر من السيرفر.
  // فلا يكفي أن يكون في هذا المتصفح «جلسة» قديمة، ولا أن يعرف أحدهم رابط الموقع.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let authorized = false;
      let reachable = true;
      // «مرفوض» تعني 401 فقط: السيرفر رفض الجلسة صراحة. أي خطأ آخر (500/503،
      // صفحة HTML من الاستضافة، انقطاع شبكة) **لا** يُخرج المستخدم — لأن الخروج
      // على خطأ عابر هو سبب «سجّل دخول تلقائياً» على بعض الأجهزة.
      let rejected = false;
      const checkMe = async () => {
        const res = await fetch(`${AUTH_API}?action=me`, { cache: 'no-store', credentials: 'same-origin' });
        if (res.status === 401) {
          rejected = true;
          return;
        }
        const data: any = await res.json().catch(() => null);
        if (res.ok && data?.ok) authorized = true;
      };
      try {
        await checkMe();
        // محاولة ثانية سريعة قبل أي حكم (تغطي تعثّر دالة السيرفر للحظة)
        if (!authorized && !rejected) {
          await new Promise((resolve) => setTimeout(resolve, 1200));
          if (!cancelled) await checkMe();
        }
      } catch {
        // تعذّر الوصول للسيرفر (انقطاع مؤقت) — لا نُخرج المستخدم، تبقى جلسته على جهازه
        reachable = false;
      }
      if (cancelled) return;
      if (rejected) {
        handleLogout();
        return;
      }
      if (!reachable) return;
      if (!authorized) {
        // السيرفر رد بشيء غير مفهوم (خطأ داخلي/صيانة): نُبقي الجلسة المحلية
        // ونكمل؛ أول 401 حقيقي من المزامنة سيظهر شاشة الدخول.
        return;
      }
      markAuthorized();
      // الجلسة سليمة: نستعيد المستخدم المحفوظ على هذا الجهاز
      try {
        const stored = localStorage.getItem('current_user');
        if (!stored) return;
        const restored: User = JSON.parse(stored);
        setCurrentUser(restored);
        // نفس الصفحة اللي كان عليها قبل الريفريش
        setActiveTab(startTabFor(restored));
      } catch {
        localStorage.removeItem('current_user');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // نحفظ الصفحة الحالية مع كل تنقل — مثال: من «توزيع الأرقام» إلى «الإعدادات»
  // فلو عملت ريفريش ترجع لنفس المكان، ولو قفلت الموقع وفتحته تاني كذلك.
  useEffect(() => {
    if (!currentUser) return;
    // صفحة الأرقام جوه الرئيسية: لو خرجنا للتبويب تاني نرجع للوحة الأرقام
    if (activeTab !== 'dashboard') setLeadsOpen(false);
    // لو تغيّرت صلاحية الحساب أثناء فتح الصفحة، نرجع لتبويب مسموح بدل شاشة فاضية
    // قوائم السلبرز + الإدارة معاً لكل من يعمل سيلزاً (المطوّر أو إداري يستقبل أرقاماً)
    const devMenus = worksAsSales(currentUser) && !impersonator;
    const guardRole = impersonator && worksAsSales(currentUser) ? 'sales' : currentUser.role;
    if (!isTabAllowed(guardRole, activeTab, devMenus)) {
      setActiveTab(guardRole === 'sales' || devMenus ? 'dashboard' : 'admin-users');
      return;
    }
    try {
      localStorage.setItem(tabKeyOf(currentUser.id), activeTab);
    } catch {
      /* التخزين قد يكون معطّلاً — التنقل يعمل عادي بلا حفظ */
    }
  }, [activeTab, currentUser?.id, currentUser?.role, (currentUser as User)?.developer, (currentUser as User)?.receivesLeads, impersonator?.id]);

  // السيرفر رفض أي طلب بيانات (لا جلسة) => نخفي كل شيء ونعرض شاشة الدخول فوراً
  useEffect(() => {
    const onAuthRequired = () => handleLogout();
    window.addEventListener(AUTH_EVENT, onAuthRequired);
    return () => window.removeEventListener(AUTH_EVENT, onAuthRequired);
  }, []);

  // عند وصول تحديثات من جهاز آخر (مزامنة) نعيد تحميل البيانات فوراً
  useEffect(() => {
    const onSync = () => loadData();
    window.addEventListener(SYNC_EVENT, onSync);
    return () => window.removeEventListener(SYNC_EVENT, onSync);
  }, [currentUser]);

  // مؤشر حالة الاتصال بسيرفر البيانات المشترك
  useEffect(() => {
    const timer = setInterval(() => setSyncOnline(isOnline()), 3000);
    const onSync = () => setSyncOnline(isOnline());
    window.addEventListener(SYNC_EVENT, onSync);
    return () => {
      clearInterval(timer);
      window.removeEventListener(SYNC_EVENT, onSync);
    };
  }, []);

  useEffect(() => {
    if (!currentUser) return;
    loadData();
  }, [currentUser]);

  // ===== تحديث لحظي =====
  // الرجوع للتاب/التطبيق المثبّت، عودة الإنترنت، أو كتابة من تاب آخر:
  // نطلب مزامنة فورية ونعيد قراءة البيانات بدل انتظار الدورة الدورية.
  useEffect(() => {
    if (!currentUser) return;
    const refresh = () => {
      syncNow();
      loadData();
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    const onStorage = (event: StorageEvent) => {
      if (!event.key || event.key.startsWith('crm_')) loadData();
    };
    window.addEventListener('focus', refresh);
    window.addEventListener('online', refresh);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener('focus', refresh);
      window.removeEventListener('online', refresh);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('storage', onStorage);
    };
  }, [currentUser?.id]);

  // ألوان الموقع الخاصة بهذا المستخدم (تُحفظ على جهازه ولا تؤثر على غيره)
  useEffect(() => {
    applyThemeForUser(currentUser?.id);
  }, [currentUser?.id]);

  // ===== سحب تلقائي احتياطي من متصفح الإدارة =====
  // على الاستضافة بدون cron مضبوط لا توجد حلقة خلفية. طالما صفحة الإدارة مفتوحة،
  // نشغّل السحب كل X دقيقة (نفس إعداد القناة) حتى لا تتوقف الأرقام.
  // للعمل 24/7 بدون متصفح مفتوح: CRON_SECRET + cron-job.org (انظر README).
  useEffect(() => {
    if (!currentUser || currentUser.role === 'sales') return;
    let stopped = false;
    let timer: number | undefined;
    const start = async () => {
      try {
        const res = await fetch('/api/lead-source', { cache: 'no-store', credentials: 'same-origin' });
        if (!res.ok) return;
        const json = await res.json();
        if (json.stateless) return; // الوضع بلا قاعدة يعالجه كارت إعدادات القناة
        const config = json.config || {};
        const channels = [config, config.instagram].filter((c: any) => c && c.enabled);
        if (!channels.length) return;
        const minutes = Math.max(1, Math.min(...channels.map((c: any) => Number(c.intervalMinutes) || 5)));
        const run = async () => {
          if (stopped) return;
          try {
            await fetch('/api/lead-source', {
              method: 'POST',
              credentials: 'same-origin',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ action: 'run', force: false }),
            });
          } catch {
            /* الدورة القادمة تحاول */
          }
        };
        await run();
        if (!stopped) timer = window.setInterval(run, minutes * 60 * 1000);
      } catch {
        /* لا شيء */
      }
    };
    void start();
    return () => {
      stopped = true;
      if (timer) window.clearInterval(timer);
    };
  }, [currentUser?.id, currentUser?.role]);

  useEffect(() => {
    if (!currentUser) return;
    let stopped = false;

    const checkReminders = async () => {
      if (stopped) return;
      let allReminders: Reminder[] = [];
      try {
        const parsed = JSON.parse(localStorage.getItem('crm_reminders') || '[]');
        allReminders = Array.isArray(parsed) ? parsed : [];
      } catch {
        allReminders = [];
      }

      // إشعارات التذكير تخص صاحب التذكير فقط — لا تصل للإدارة كإشعار عن تذكيرات السيلز
      const scoped = allReminders.filter(
        (r) => r && !r.isCompleted && r.userId === currentUser.id
      );
      // الأجدد أولاً
      const due = scoped
        .filter(isReminderDue)
        .slice()
        .sort((a, b) => String(b.dateTime || '').localeCompare(String(a.dateTime || '')));

      // ===== إشعار خارجي فقط — مرة واحدة عند وقت الاتصال =====
      // مفيش تنبيه داخل البرنامج. لو الجهاز مشترك في إشعارات الدفع، نطلب من
      // السيرفر يرسل التذكير المستحق فوراً، وهو يعلّمه مُرسَلاً في قاعدة الحالة
      // فلا يتكرر (لا من المجدول ولا من بقية الأجهزة). ولو مش مشترك، يظهر
      // إشعار من الجهاز نفسه — ومحفوظ في crm_notified فلا يتكرر بعد كده أبداً.
      if (due.length) {
        for (const reminder of due) markReminderFired(reminder.id);
        const pushIsOn = await pushState();
        if (pushIsOn === 'subscribed') {
          const fresh = due.filter((r) => !flushAskedRef.current.has(r.id));
          if (fresh.length) {
            fresh.forEach((r) => flushAskedRef.current.add(r.id));
            void flushPush(true);
          }
        } else {
          const notified = readNotifiedIds();
          let changed = false;
          for (const reminder of due) {
            if (notified.has(reminder.id)) continue;
            // ما نعلّمش التذكير كمُنبَّه إلا لو الإشعار ظهر فعلاً — لو الصلاحية
            // اتقفلت وقتها، يفضل قابلاً للظهور لما المستخدم يفعّلها.
            const shown = await localNotification(
              `⏰ حان وقت الاتصال بـ ${reminder.clientName || 'عميل'}`,
              `${reminder.clientPhone || ''}${reminder.note ? ' — ' + reminder.note : ''}`.trim(),
              `reminder-${reminder.id}`
            );
            if (!shown) continue;
            notified.add(reminder.id);
            changed = true;
          }
          if (changed) writeNotifiedIds(notified);
        }
      }

      // بند ٨: تذكير بلا إجراء خلال ٥ دقايق يتسجّل «متأخر»
      applyReminderDelays();
    };

    checkReminders();
    // كل ثانيتين: أقرب ما يمكن لوقت التذكير الفعلي بدل دورة كل ٥ ثوانٍ
    const interval = window.setInterval(checkReminders, 2000);
    // العودة إلى التاب بعد تركه: نفحص فوراً بدل انتظار الدورة
    const onVisible = () => {
      if (document.visibilityState === 'visible') checkReminders();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      stopped = true;
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [currentUser?.id, currentUser?.role]);

  const loadData = () => {
    if (!currentUser) return;
    
    const allClients = JSON.parse(localStorage.getItem('crm_clients') || '[]');
    const allReminders = JSON.parse(localStorage.getItem('crm_reminders') || '[]');
    const allProperties = JSON.parse(localStorage.getItem('crm_properties') || '[]');
    const allFeedbacks = JSON.parse(localStorage.getItem('crm_daily_feedback') || '[]');
    const allUsers = JSON.parse(localStorage.getItem('crm_users') || '[]');
    const allTeams = JSON.parse(localStorage.getItem('crm_teams') || '[]');
    const allAssignedLeads = JSON.parse(localStorage.getItem('crm_assigned_leads') || '[]');
    
    // ===== نطاق هذا الحساب =====
    // «كل حساب منفصل عن التاني»: السيلز لا يستلم في متصفحه إلا سجلاته هو.
    // كانت الرسائل والأرقام والمكالمات تُحمَّل كاملة لكل حساب ثم تُرشَّح في العرض،
    // وأي مكان ينسى الفلتر كان يعرض شغل زميله عليه (فوضي حسابات مفتوحة على بعض).
    // الإدارة (CEO) ترى الكل، وقائد الفريق يرى فريقه فقط بشرط وجود فريق فعلي
    // (فريق فارغ ما يبقاش معناه «كل الحسابات»).
    //
    // **استثناء المطوّر**: حسابه إداري في القاعدة (ليقدر يدير الحسابات) لكنه يُعرَض
    // في كل الواجهة كسيلز عادي. كان دوره الإداري يمنحه نطاقاً كاملاً — فيرى أرقام كل
    // المندوبين وفيدباكهم (وهو الخلط المُبلَّغ عنه: حساب محمد وحساب SHEROQ).
    // نطاقه الآن بياناته هو فقط، ولو احتاج يشوف شغل غيره يستخدم «الدخول إلى الحساب».
    const myScopeIds: Set<string> | null = dataScopeOf(currentUser, allUsers);
    const inMyScope = (id?: string) => !myScopeIds || (!!id && myScopeIds.has(id));

    setUsers(allUsers);
    setTeams(allTeams);
    setAssignedLeads(allAssignedLeads.filter((l: AssignedLead) => inMyScope(l.salesId)));
    // المخزون الكامل — لحسابات الإدارة فقط (لوحات أرقام الكامبين).
    // حساب السيلز ما بيحمّلوش (مفيش داعي، وهو الممنوع أصلاً: خلط شغل الزملاء).
    const isAdminAccount = currentUser.role !== 'sales';
    setFullLeads(isAdminAccount ? allAssignedLeads : []);
    setFullClients(isAdminAccount ? allClients : []);
    setFullFeedbacks(isAdminAccount ? allFeedbacks : []);
    setFullCallLogs(isAdminAccount ? getCallLogs() : []);
    setAutoAssignRules(parseRules(localStorage.getItem(AUTO_ASSIGN_KEY)));
    // الرسائل: السيلز لا يحمل في ذاكرته إلا محادثاته هو — لا محادثات غيره
    // (غرفة المدراء للحسابات الإدارية وحدها).
    setMessages(
      getMessages().filter((m: ChatMessage) =>
        myScopeIds ? m.fromId === currentUser.id || m.toId === currentUser.id : true
      )
    );
    setCallLogs(getCallLogs().filter((l: CallLog) => inMyScope(l.salesId)));
    // الحساب لم يعد موجوداً (حُذف، أو أُعيد ضبط النظام وبدأنا من جديد) → خروج تلقائي لشاشة الدخول
    // بشرط وجود قائمة حسابات فعلاً: قائمة فاضية (تزامن لم يصل بعد) ليست دليلاً على حذف
    // الحساب، وكانت تُخرج المستخدم بلا سبب على الأجهزة التي تفتح قبل اكتمال المزامنة.
    const me = allUsers.find((u: User) => u.id === currentUser.id);
    if (allUsers.length > 0 && !me) {
      handleLogout();
      return;
    }

    // لو تغيّر اسم حسابك أو اسم المستخدم أو صلاحيتك من شاشة الإدارة،
    // نحدّث الجلسة فوراً حتى يظهر الاسم الجديد بلا حاجة لتسجيل خروج ودخول.
    if (me &&
      (me.name !== currentUser.name ||
        me.role !== currentUser.role ||
        me.username !== currentUser.username ||
        me.isActive !== currentUser.isActive)
    ) {
      localStorage.setItem('current_user', JSON.stringify(me));
      setCurrentUser(me);
    }

    setClients(
      allClients.filter((c: Client) => inMyScope(c.userId) || inMyScope(c.assignedTo))
    );
    setReminders(allReminders.filter((r: Reminder) => inMyScope(r.userId)));
    // الفيدباك لصاحبه فقط. الربط بالرقم كان يجعل كومنت مندوب يظهر لمندوب آخر
    // حصل على نفس الرقم — وهو بالضبط «الفيدباك بينزل للشخص التاني».
    setDailyFeedbacks(allFeedbacks.filter((f: DailyFeedback) => inMyScope(f.userId)));
    // العقارات: عقارات الفريق تظهر للجميع، والعقار الخاص لا يخرج من جهاز صاحبه
    // ولا يُحمَّل أصلاً في متصفح مندوب آخر (الإدارة وقائد الفريق يرون عقارات فريقهم).
    const ownerOf = (p: Property) => p.userId;
    const teamIds = currentUser.team
      ? new Set<string>([currentUser.id, ...allUsers.filter((u: User) => u.team === currentUser.team).map((u: User) => u.id)])
      : null;
    setProperties(
      allProperties.filter((p: Property) => {
        if (p.scope !== 'private') return true;
        if (!myScopeIds) return true;
        if (currentUser.role === 'supervisor') return !!teamIds && teamIds.has(ownerOf(p));
        return ownerOf(p) === currentUser.id;
      })
    );
  };

  // ===== أي تعديل على الأرقام الموزّعة يتم على القائمة الكاملة المحفوظة =====
  // الذاكرة (assignedLeads) لا تحمل إلا أرقام هذا الحساب. الكتابة منها مباشرة كانت
  // ترفع قائمة ناقصة، فتُسجَّل شواهد حذف لكل رقم خارج النطاق فيختفي من كل الأجهزة
  // (وهو سبب اختفاء أرقام الكامبين). هنا يُطبَّق التعديل على المخزون الكامل ثم يُرشَّح للعرض.
  const writeAssignedLeads = (mutate: (all: AssignedLead[]) => AssignedLead[]) => {
    let all: AssignedLead[] = [];
    try {
      const parsed = JSON.parse(localStorage.getItem('crm_assigned_leads') || '[]');
      all = Array.isArray(parsed) ? parsed : [];
    } catch {
      all = [];
    }
    const next = mutate(all);
    localStorage.setItem('crm_assigned_leads', JSON.stringify(next));
    const scope = dataScopeOf(currentUser, JSON.parse(localStorage.getItem('crm_users') || '[]'));
    setAssignedLeads(scope ? next.filter((l: AssignedLead) => scope.has(String(l.salesId || ''))) : next);
    // اللوحات الإدارية (توزيع الأرقام والحصص) تقرأ fullLeads: كانت تتحدّث بعد المزامنة
    // فقط، فيبدو التوزيع اليدوي وإلغاء التوزيع كأنهما لم يُحفَظا حتى يعمل ريفرش.
    // نفس شرط loadData: أي حساب غير سيلز يحمل المخزون الكامل.
    if (currentUser?.role !== 'sales') setFullLeads(next);
    // نُرجع وعد الرفع حتى ينتظر من يحتاج إشعاراً بعد وصول التوزيع للسيرفر
    return pushKey('crm_assigned_leads');
  };

  // فتح تبويب العملاء = شوفت الأرقام النازلة: العدّاد الأحمر جمب التبويب ينزل صفر.
  // قبل كده كان العدّاد يفضل مكتوب بعد الدخول، لأن الأرقام ما كانتش تُعلَّم «تم العرض».
  useEffect(() => {
    if (!currentUser || activeTab !== 'clients') return;
    if (!(currentUser.role === 'sales' || effectiveRoleOf(currentUser) === 'sales')) return;
    const pending = assignedLeads.filter(
      (l: AssignedLead) => l.salesId === currentUser.id && l.status === 'new'
    );
    if (!pending.length) return;
    const viewedAt = new Date().toISOString();
    writeAssignedLeads((all) =>
      all.map((l: AssignedLead) =>
        l.salesId === currentUser.id && l.status === 'new'
          ? { ...l, status: 'viewed' as const, viewedAt }
          : l
      )
    );
  }, [activeTab, assignedLeads.length, currentUser?.id]);

  const handleLogout = () => {
    // إنهاء الجلسة على السيرفر أيضاً: الكوكي يُبطَل فلا تُقرأ بيانات بلا دخول جديد
    try {
      void fetch(`${AUTH_API}?action=logout`, { method: 'POST', credentials: 'same-origin' });
    } catch {
      /* لا شيء */
    }
    localStorage.removeItem('current_user');
    // الخروج النهائي ينهي أيضاً أي «دخول لحساب سيلز»
    localStorage.removeItem('impersonator_user');
    setCurrentUser(null);
    setImpersonator(null);
    setActiveTab('dashboard');
    setLoginAnimation(null);
  };

  // ===== دخول الإدارة إلى حساب أي سيلز (حساب جوا حساب) =====
  // المدير يرى النظام بنفس عيون السيلز: نفس التبويبات ونفس البيانات المسموح بها له،
  // بدون كلمة مرور ولا اسم مستخدم. جلسة المدير تُحفظ جانباً حتى يرجع بضغطة واحدة.
  const handleImpersonate = (target: User) => {
    if (!currentUser || currentUser.role === 'sales') return;
    if (!target || target.id === currentUser.id) return;

    localStorage.setItem('impersonator_user', JSON.stringify(currentUser));
    setImpersonator(currentUser);
    setCurrentUser(target);
    localStorage.setItem('current_user', JSON.stringify(target));
    // نبدأ من صفحة نظيفة: لا تبقى لوحة أو نافذة من حساب الإدارة مفتوحة
    setStatusBoard(null);
    setSelectedClient(null);
    setCallClient(null);
    setSelectedUserFeedback(null);
    setActiveTab(target.role === 'sales' || worksAsSales(target) ? 'dashboard' : 'admin-users');
    setLoginAnimation(target);
  };

  // الرجوع لحساب الإدارة: بدون أي بيانات دخول، ونقرأ أحدث نسخة من الحساب
  const handleReturnToAdmin = () => {
    if (!impersonator) return;

    const allUsers: User[] = JSON.parse(localStorage.getItem('crm_users') || '[]');
    const restored = allUsers.find((u: User) => u.id === impersonator.id) || impersonator;

    localStorage.removeItem('impersonator_user');
    setImpersonator(null);
    setCurrentUser(restored);
    localStorage.setItem('current_user', JSON.stringify(restored));
    // نغلق أي صفحة/نافذة فُتحت من داخل حساب السيلز (لوحة حالة، عميل، مكالمة):
    // لو بقيت مفتوحة كانت ستُعاد بنفس بياناتها فوق حساب الإدارة، فيبدو كأن
    // بيانات المندوب انتقلت للمدير بدل أن تكون شاشة عالقة.
    setStatusBoard(null);
    setSelectedClient(null);
    setCallClient(null);
    setSelectedUserFeedback(null);
    // نرجع المدير لنفس الصفحة التي كان فيها قبل الدخول لحساب السيلز
    setActiveTab(startTabFor(restored));
    setLoginAnimation(restored);
  };

  // ===== الشات الداخلي (الإدارة ↔ كل سيلز) =====
  const handleSendMessage = (text: string, toId: string) => {
    if (!currentUser || !text.trim() || !toId) return;
    const message: ChatMessage = {
      id: crypto.randomUUID(),
      fromId: currentUser.id,
      fromName: currentUser.name,
      toId,
      text: text.trim(),
      createdAt: new Date().toISOString(),
    };
    const next = [...getMessages(), message];
    saveMessages(next);
    setMessages(next);
    // الرفع الفوري ضروري لإشعار الطرف الآخر والموقع مقفول (السيرفر يرسل Web Push)
    void pushKey('crm_messages');
    // وندفع الإشعار للطرف الآخر في نفس اللحظة (بدل انتظار المجدول أو الدورة)
    void flushPush(true);
  };

  // تعليم رسائل غرفة المدراء كمقروءة لهذا العضو فقط (كل مدير له علامة قراءة مستقلة)
  const handleMarkGroupRead = (ids: string[]) => {
    if (!ids.length || !currentUser) return;
    const target = new Set(ids);
    let changed = false;
    const next = getMessages().map((m) => {
      if (target.has(m.id) && !(m.readBy || []).includes(currentUser!.id)) {
        changed = true;
        return { ...m, readBy: [...(m.readBy || []), currentUser!.id] };
      }
      return m;
    });
    if (!changed) return;
    saveMessages(next);
    setMessages(next);
    // «قرأتها» تسافر لباقي الأجهزة والسيرفر فوراً — لا تبقى حالة هذا الجهاز
    void pushKey('crm_messages');
  };

  // تعليم الرسائل الواردة كمقروءة (يظهر للمُرسِل «تم القراءة»)
  const handleMarkRead = (ids: string[]) => {
    if (!ids.length) return;
    const target = new Set(ids);
    const now = new Date().toISOString();
    let changed = false;
    const next = getMessages().map((m) => {
      if (target.has(m.id) && !m.readAt) {
        changed = true;
        return { ...m, readAt: now };
      }
      return m;
    });
    if (!changed) return;
    saveMessages(next);
    setMessages(next);
    void pushKey('crm_messages');
  };

  // ===== توزيع الأرقام: رقم واحد أو دفعة كاملة أو توزيع تلقائي مختلط =====
  // كان التوزيع الجماعي بينادي التخصيص رقم رقم على نفس الحالة القديمة،
  // فينتج عنه رقم واحد فقط مُوزَّع (باقي الأرقام تُلغى). هنا تُطبَّق الدفعة كلها مرة واحدة.
  //
  // ownerOf = «رقم ← مندوب» لكل رقم على حدة، فتصلح لحالة واحدة:
  //   • توزيع دفعة على مندوب واحد (كل القيم نفس المعرّف)
  //   • التوزيع التلقائي بالتساوي على عدة مندوبين (كل رقم يأخذ مندوبه)
  const applyLeadOwners = (ownerOf: Map<string, string>) => {
    if (!currentUser || !ownerOf.size) return null;
    const movedAt = new Date().toISOString();
    // `assignedAt` = وقت آخر تغيير في التوزيع (توزيع أو سحب رقم من السيلز):
    // إشعار المندوب يُحسب منه لا من تاريخ وصول الرقم، فرقم قديم اتوزّع النهاردة
    // يوصل صاحبه إشعار برضه. وهو أيضاً وقت المقارنة عند المزامنة: هو اللي بيحدد
    // أي نسخة من السجل هي الأحدث (نسخة الجهاز ولا نسخة السيرفر القديمة).
    const synced = writeAssignedLeads((all) =>
      all.map((l: AssignedLead) => {
        if (!ownerOf.has(l.id)) return l;
        const owner = ownerOf.get(l.id) || '';
        if (owner === String(l.salesId || '')) return l;
        return { ...l, salesId: owner, assignedAt: movedAt };
      })
    );

    // لو أي رقم من الموزَّعين تحوَّل لعميل بالفعل، ينتقل العميل نفسه لمندوبه الجديد (مع حدث في خطه الزمني)
    const digits = (v: string) => normalizeDigits(String(v || '')).replace(/\D/g, '');
    const ownerByPhone = new Map<string, string>();
    for (const lead of fullLeads) {
      const owner = ownerOf.get(lead.id);
      // `owner === undefined`: الرقم ده مش من الأرقام المتغيّرة في الحركة دي.
      // `owner` فارغ: سحب الرقم من عهدة السيلز ⇒ لازم يخرج العميل من عنده كمان
      // (كان يفضل مع المندوب في «عملائي» بعد ما الإدارة تسحبه منه).
      if (owner === undefined || owner === (lead.salesId || '') || !lead.phone) continue;
      const key = digits(lead.phone);
      if (key) ownerByPhone.set(key, owner);
    }

    // ===== الكومنت ينزل مع الرقم على المندوب =====
    // الرقم ممكن يكون اتكتب عليه كلام قبل ما ينزل (مندوب تاني، أو مندوب اتمسح
    // حسابه فبطاقته ما ظهرتش لحدّ). بنجمع آخر كلام على كل رقم من بطاقات الفيدباك
    // وسجلات المكالمات (كل الحسابات) وبنضيفه في خط العميل لو ناقص — فالرقم
    // بيوصل صاحبه الجديد بكلامه.
    const phoneComments = commentsByPhone(dailyFeedbacks, callLogs, users);
    const noteOfPhone = (phone: string) => {
      const key = digits(phone);
      return key ? phoneComments.get(key) || null : null;
    };

    let all: Client[] = [];
    try {
      const parsed = JSON.parse(localStorage.getItem('crm_clients') || '[]');
      all = Array.isArray(parsed) ? parsed : [];
    } catch {
      all = [];
    }
    let next = all;
    let touched = false;

    if (ownerByPhone.size) {
      next = all.map((c) => {
        const own = [c.phone, ...(c.phones || [])].map((p) => digits(p));
        // البحث بـ«معرّف» مش «قيمة»: صاحب فارغ (سحب الرقم من السيلز) لازم يتلقط كمان.
        const owner = own.map((p) => (p ? ownerByPhone.get(p) : undefined)).find((v) => v !== undefined);
        if (owner === undefined) return c;
        touched = true;
        const ownerName = owner ? (users.find((u: User) => u.id === owner)?.name || 'سيلز آخر') : '';
        // الكومنت المكتوب على الرقم: لو مش في خط العميل بنضيفه (مرة واحدة)
        const note = noteOfPhone(c.phone);
        const acts = c.activities || [];
        const hasNote = !note || acts.some((a: any) => isCommentActivity(a) && cleanCommentText(a?.text) === note.text);
        const noteActivity = note && !hasNote
          ? [{
              id: crypto.randomUUID(),
              type: 'feedback',
              text: note.text,
              at: note.at || movedAt,
              by: note.by,
              ...(note.status ? { status: note.status } : {}),
            }]
          : [];
        return {
          ...c,
          userId: owner,
          assignedTo: owner,
          updatedAt: movedAt,
          // «الفيدباك» = آخر كلام على العميل — يبان في الكارت من أول نظرة
          feedback: note?.text || c.feedback,
          activities: [
            {
              id: crypto.randomUUID(),
              type: 'assign',
              text: owner ? `تم تخصيص العميل إلى ${ownerName}` : 'سُحب الرقم من عهدة السيلز',
              at: movedAt,
              by: currentUser.name,
            },
            ...noteActivity,
            ...acts,
          ],
        };
      });
    }

    // ===== الرقم الموزَّع يصير عميل مندوبه من أول لحظة =====
    // ما فيش زر «أضف إلى عملائي» بعد اليوم: أي رقم ينزل على مندوب يتحوّل لعميله
    // تلقائياً (بمعرّف مشتق من الرقم نفسه فيتدمج على كل الأجهزة ولا يتكرر).
    const assigned = fullLeads
      .filter((l: AssignedLead) => ownerOf.get(l.id))
      .map((l: AssignedLead) => ({ ...l, salesId: ownerOf.get(l.id) as string }));
    const fresh = buildLeadClients({
      leads: assigned,
      clients: next,
      at: movedAt,
      by: currentUser.name,
      // الكومنت المكتوب على الرقم قبل ما ينزل — ينزل معاه (من مندوب تاني أو
      // من مندوب اتمسح حسابه، فبطاقته ما هيبانش لحدّ)
      comments: phoneComments,
    });
    if (fresh.length) {
      next = [...fresh, ...next];
      touched = true;
    }

    if (touched) {
      setClients(next);
      localStorage.setItem('crm_clients', JSON.stringify(next));
      void pushKey('crm_clients');
    }

    // ===== بطاقة الفيدباك بتنتقل مع الرقم =====
    // بطاقة صاحبها حساب محذوف ما بيظهرش لحدّ (مش في قائمة حدّ). فلما الرقم ينزل
    // على مندوب، البطاقة بتنتقل ليه — فيشوف الكومنت في «الفيدباك اليومي» بتاعه.
    // بطاقة صاحبها لسه موجود بتفضل عنده (تاريخه هو).
    if (ownerByPhone.size) {
      let cardsChanged = false;
      const nextCards = dailyFeedbacks.map((card: any) => {
        const key = digits(card?.clientPhone);
        const owner = key ? ownerByPhone.get(key) : undefined;
        if (!owner || !key) return card;
        if (users.some((u: User) => String(u.id) === String(card?.userId || ''))) return card;
        cardsChanged = true;
        return { ...card, userId: owner };
      });
      if (cardsChanged) {
        setDailyFeedbacks(nextCards);
        localStorage.setItem('crm_daily_feedback', JSON.stringify(nextCards));
        void pushKey('crm_daily_feedback');
      }
    }
    return synced;
  };

  // ===== حذف الرقم من التوزيع يشيل عميله التلقائي كمان =====
  // الرقم الموزَّع بيتحوّل لعميل بصاحب رقمه (معرّف مشتق من الرقم نفسه)، فكان
  // حذف الرقم من «توزيع الأرقام» يسيب العميل عند المندوب في «عملائي» — يعنى
  // الرقم المحذوف لسه موجود عنده. هنا العميل التلقائي للرقم ده بيتشال برضه.
  // العميل اليدوي (اللي اتسجّل برقم تاني) ما بيتمسش — بيانات العملاء محفوظة.
  const removeLeadClient = (leadId: string) => {
    const lead = fullLeads.find((l: AssignedLead) => String(l.id) === String(leadId));
    if (!lead?.phone) return;
    const clientId = leadClientIdFor(lead.phone);
    if (!clientId) return;
    let all: Client[] = [];
    try {
      const parsed = JSON.parse(localStorage.getItem('crm_clients') || '[]');
      all = Array.isArray(parsed) ? parsed : [];
    } catch {
      all = [];
    }
    if (!all.some((c: Client) => String(c.id) === clientId)) return;
    const next = all.filter((c: Client) => String(c.id) !== clientId);
    setClients(next);
    localStorage.setItem('crm_clients', JSON.stringify(next));
    // pushKey يسجّل شاهد الحذف لوحده فيرفعه قبل القائمة ⇒ ما يرجعش من جهاز قديم
    void pushKey('crm_clients');
  };

  const handleAssignLeads = (ids: string[], salesId: string) => {
    const unique = [...new Set((ids || []).filter(Boolean))];
    if (!unique.length) return;
    const synced = applyLeadOwners(new Map(unique.map((id) => [id, salesId])));
    // الإشعار الخارجي للمندوب ينطلق بعد ما يوصل التوزيع للسيرفر — بدل انتظار الدورة
    if (synced) void synced.then(() => flushPush(true)).catch(() => {});
  };

  // ===== حفظ قاعدة «التوزيع التلقائي» لفورم =====
  // القاعدة تسافر مع باقي البيانات، فتصبح سياسة النظام لا إعداداً على جهاز واحد.
  // عند التفعيل نوزّع فوراً الأرقام الموجودة غير المخصصة، والباقي يلحقه تلقائياً.
  const handleSaveAutoRule = (formName: string, salesIds: string[], active: boolean, allSales = false) => {
    const name = String(formName || '').trim();
    if (!name) return 0;
    // كل من يستقبل أرقاماً فعلاً (سيلز/مشرف/حساب مطوّر/إداري مختار أنه يسيلز)
    const assignableIds = new Set(users.filter(isAssignableSales).map((u: User) => String(u.id)));
    const targets = allSales
      ? [...assignableIds]
      : (salesIds || []).map((id) => String(id)).filter((id) => assignableIds.has(id));
    const next = upsertRule(autoAssignRules, { formName: name, salesIds: targets, allSales, active });
    setAutoAssignRules(next);
    localStorage.setItem(AUTO_ASSIGN_KEY, JSON.stringify(next));
    void pushKey(AUTO_ASSIGN_KEY);
    if (!active) return 0;

    const { assignments } = distributeLeads({
      leads: fullLeads,
      // الحمل الحقيقي: كل الأرقام الحالية لكل مندوب (وليس أرقام هذا الفورم فقط)
      loadLeads: fullLeads,
      salesIds: targets,
      formName: name,
      formOf: formKeyOf,
      onlyUnassigned: true,
      // رقم عند حدّ سلفاً (عميل مسجّل) ما يتوزّعش على حدّ تاني
      excludePhones: phonesOfClients(fullClients),
    });
    if (!assignments.length) return 0;
    applyLeadOwners(new Map(assignments.map((item) => [item.id, item.salesId])));
    return assignments.length;
  };

  // ===== إعادة توزيع أرقام فورم بالتساوي على كل السيلز =====
  // يحلّ تكدّس قديم (٢٠ رقم عند واحد و٤ عند غيره): كل أرقام الفورم المفتوحة
  // تُعاد على كل من يستقبل أرقاماً — بما فيهم حساب محمد وفريدة — بالحمل الحقيقي
  // (أرقام الفورمات التانية محسوبة)، والعميل يروح مع صاحب رقمه الجديد.
  const handleRebalanceForm = (formName: string) => {
    const name = String(formName || '').trim();
    if (!name) return 0;
    const targets = users.filter(isAssignableSales).map((u: User) => String(u.id));
    if (!targets.length) return 0;
    const pending = fullLeads.filter(
      (l: AssignedLead) => formKeyOf(l) === name && l.status !== 'closed'
    );
    if (!pending.length) return 0;
    const pendingIds = new Set(pending.map((l: AssignedLead) => String(l.id)));
    // الحمل اللي يبدأ منه التوزيع = أرقام الفورمات الأخرى فقط (أرقام هذا الفورم
    // هي اللي بتتوزع، فما ينفعش تتحسب مرتين).
    const otherLoads = fullLeads.filter((l: AssignedLead) => !pendingIds.has(String(l.id)));
    const { assignments } = distributeLeads({
      leads: pending,
      loadLeads: otherLoads,
      salesIds: targets,
      formName: name,
      formOf: formKeyOf,
      onlyUnassigned: false,
    });
    if (!assignments.length) return 0;
    applyLeadOwners(new Map(assignments.map((item: LeadAssignment) => [item.id, item.salesId])));
    return assignments.length;
  };

  // ===== تطبيق القواعد على أي رقم جديد يصل =====
  // أول ما يوصل رقم من فورم له قاعدة (سحب تلقائي أو استيراد)، يتوزّع على مختاريه وحدهم
  // بالتساوي بلا أي ضغطة — ومن ليس في قائمة الفورم لا يصله منه شيء.
  useEffect(() => {
    if (!currentUser || effectiveRoleOf(currentUser) === 'sales') return;
    // قاعدة مفعّلة إما بقائمة أسماء أو بـ«كل السيلز»
    if (!autoAssignRules.some((rule) => rule.active !== false && (rule.allSales || rule.salesIds.length))) return;
    // لا رقم غير مخصّص = لا عمل (المزامنة تنادي هذا الفحص كل ثانية تقريباً)
    if (!fullLeads.some((lead: AssignedLead) => !lead.salesId)) return;
    const activeSalesIds = users
      .filter((u: User) => isAssignableSales(u))
      .map((u: User) => String(u.id));
    const { assignments } = applyAutoRules({
      leads: fullLeads,
      rules: autoAssignRules,
      activeSalesIds,
      formOf: formKeyOf,
      // رقم عند حدّ سلفاً (عميل مسجّل) ما يتوزّعش على حدّ تاني
      excludePhones: phonesOfClients(fullClients),
    });
    if (!assignments.length) return;
    applyLeadOwners(new Map(assignments.map((item: LeadAssignment) => [item.id, item.salesId])));
  }, [fullLeads, fullClients, autoAssignRules, users.length, currentUser?.id]);

  // ===== الرقم الموزَّع يصير عميل مندوبه تلقائياً (على كل الأجهزة) =====
  // السيرفر يوزّع الأرقام ٢٤/٧ من غير متصفح مفتوح، والمندوب يشوفها بعد المزامنة.
  // هنا يتحوّل كل رقم في عهدة المندوب إلى عميله لو ماكانش عميلاً لسه — المعرّف
  // مشتق من الرقم نفسه، فكل الأجهزة تعمل نفس المعرّف ولا يتكرر السجل أبداً.
  // (رقم واحد = مالك واحد: هو في عهدة المندوب فهو عميله، وما فيش زر «أضف إلى عملائي»)
  useEffect(() => {
    if (!currentUser) return;
    // صاحب الرقم لازم يكون حساب موجود فعلاً — رقم حساب محذوف ما يتعملوش عميل يتيم
    const ownerIds = new Set(users.map((u: User) => String(u.id)));
    const mine = assignedLeads.filter(
      (l: AssignedLead) => ownerIds.has(String(l.salesId || '').trim()) && l.phone
    );
    if (!mine.length) return;
    let all: Client[] = [];
    try {
      const parsed = JSON.parse(localStorage.getItem('crm_clients') || '[]');
      all = Array.isArray(parsed) ? parsed : [];
    } catch {
      all = [];
    }
    const fresh = buildLeadClients({
      leads: mine,
      clients: all,
      at: new Date().toISOString(),
      by: 'التوزيع التلقائي',
    });
    if (!fresh.length) return;
    localStorage.setItem('crm_clients', JSON.stringify([...fresh, ...all]));
    void pushKey('crm_clients');
    loadData();
  }, [assignedLeads.length, users.length, currentUser?.id]);

  // ===== تغيير مرحلة عميل: تسجيلها في الخط الزمني + إنشاء تذكير متابعة تلقائي =====
  const handleUpdateClientStage = (id: string, stage: Client['stage']) => {
    const labels: Record<string, string> = {
      new: 'جديد', contacted: 'تم التواصل', meeting: 'موعد معاينة',
      negotiation: 'تفاوض', closed: 'تم البيع', lost: 'ضائع',
    };
    let allClients: Client[] = [];
    try {
      allClients = JSON.parse(localStorage.getItem('crm_clients') || '[]');
    } catch {
      allClients = [];
    }
    const target = allClients.find((c) => c.id === id);
    if (!target) return;
    const from = labels[target.stage] || target.stage;
    const to = labels[stage] || stage;
    const nowIso = new Date().toISOString();
    const entry: ClientActivity = {
      id: crypto.randomUUID(),
      type: 'stage',
      text: `تغيير المرحلة: ${from} ← ${to}`,
      at: nowIso,
      by: currentUser?.name || '',
    };
    const next = allClients.map((c) =>
      c.id === id ? { ...c, stage, updatedAt: nowIso, activities: [entry, ...(c.activities || [])].slice(0, 60) } : c
    );
    localStorage.setItem('crm_clients', JSON.stringify(next));
    const updated = next.find((c) => c.id === id);
    if (updated && stage !== 'lost' && stage !== 'closed') {
      // تذكير المتابعة التلقائي يُرفع فوراً (وإلا لم يعرفه السيرفر لإشعار الموقع المقفول)
      if (scheduleFollowUp(updated, to)) void pushKey('crm_reminders');
    }
    loadData();
  };

  // إشعار فوري عند وصول رسالة جديدة (صوت + اهتزاز + إشعار على الشاشة)
  const seenMessagesRef = useRef<{ userId: string; ids: Set<string> } | null>(null);
  useEffect(() => {
    if (!currentUser) return;
    const incoming = messages.filter((m) => messageTargetsUser(m, currentUser));
    const ids = new Set(incoming.map((m) => m.id));

    // أول تحميل (أو تغيّر المستخدم): لا نُشعر بالرسائل القديمة
    if (!seenMessagesRef.current || seenMessagesRef.current.userId !== currentUser.id) {
      seenMessagesRef.current = { userId: currentUser.id, ids };
      return;
    }

    const fresh = incoming.filter((m) => !seenMessagesRef.current!.ids.has(m.id));
    seenMessagesRef.current = { userId: currentUser.id, ids };
    if (!fresh.length) return;

    const latest = fresh[fresh.length - 1];
    if (soundEnabled) playNotificationSound();
    vibrateDevice();
    sendNotification(` رسالة من ${latest.fromName}`, latest.text.slice(0, 120));
    setInAppNotification({ title: ` رسالة من ${latest.fromName}`, body: latest.text.slice(0, 120) });
    setTimeout(() => setInAppNotification(null), 10000);
  }, [messages, currentUser, soundEnabled]);

  // طلب صلاحية الإشعارات من ضغطة المستخدم (المتصفحات ترفض الطلب التلقائي).
  // بعد السماح: نسجّل العامل ونشترك في Web Push حتى تصل التذكيرات والموقع مقفول.
  const requestNotifications = async () => {
    if (typeof Notification === 'undefined') {
      setInAppNotification({ title: 'المتصفح لا يدعم الإشعارات', body: 'استخدم Chrome أو Edge على الكمبيوتر، أو ثبّت الموقع على الهاتف.' });
      setTimeout(() => setInAppNotification(null), 7000);
      return;
    }
    try {
      const permission = await Notification.requestPermission();
      setNotifPermission(permission);
      if (permission !== 'granted') {
        setInAppNotification({
          title: 'الإشعارات غير مفعّلة',
          body: 'لم تسمح بها — افتح إعدادات الموقع في المتصفح ← الإشعارات ← سماح، ثم جرّب مرة أخرى.',
        });
        setTimeout(() => setInAppNotification(null), 9000);
        return;
      }
      void registerWorker();
      // نسمح بمحاولة إشعار جديدة للتذكيرات المستحقة فوراً بعد السماح
      flushAskedRef.current = new Set();
      let subscribed = false;
      if (currentUser) {
        try {
          const result = await enablePush({ id: currentUser.id, name: currentUser.name });
          subscribed = result.ok;
          setNotifState(await pushState());
        } catch {
          /* الإشعار المحلي يعمل حتى لو تعذّر الاشتراك */
        }
      }
      setInAppNotification({
        title: '✅ إشعارات الكمبيوتر مفعّلة',
        body: subscribed
          ? 'التذكيرات هتظهر لك حتى لو الموقع مقفول.'
          : 'الإشعارات هتظهر والموقع مفتوح — لو حاببها والموقع مقفول اضغط «تفعيل الإشعارات» من زر الجرس.',
      });
      setTimeout(() => setInAppNotification(null), 7000);
    } catch {
      /* لا شيء */
    }
  };

  // بعد تعديل حساب (مثلاً تعديل حسابك الحالي) نحدّث بيانات الجلسة أيضاً
  const handleUserUpdated = () => {
    loadData();
    const allUsers: User[] = JSON.parse(localStorage.getItem('crm_users') || '[]');
    const me = allUsers.find((u: User) => u.id === currentUser?.id);
    if (me) {
      setCurrentUser(me);
      localStorage.setItem('current_user', JSON.stringify(me));
    }
  };

  // حذف حساب سيلز/مشرف مع تنظيف كل ما يتعلق به
  const handleDeleteUser = (userId: string, deleteRelatedData: boolean) => {
    const allUsers: User[] = JSON.parse(localStorage.getItem('crm_users') || '[]');
    const updatedUsers = allUsers.filter((u: User) => u.id !== userId);
    localStorage.setItem('crm_users', JSON.stringify(updatedUsers));

    if (deleteRelatedData) {
      const clients = JSON.parse(localStorage.getItem('crm_clients') || '[]')
        .filter((c: Client) => c.userId !== userId && c.assignedTo !== userId);
      localStorage.setItem('crm_clients', JSON.stringify(clients));

      const reminders = JSON.parse(localStorage.getItem('crm_reminders') || '[]')
        .filter((r: Reminder) => r.userId !== userId);
      localStorage.setItem('crm_reminders', JSON.stringify(reminders));

      const feedbacks = JSON.parse(localStorage.getItem('crm_daily_feedback') || '[]')
        .filter((f: DailyFeedback) => f.userId !== userId);
      localStorage.setItem('crm_daily_feedback', JSON.stringify(feedbacks));
      void pushKey('crm_daily_feedback');

      const leads = JSON.parse(localStorage.getItem('crm_assigned_leads') || '[]')
        .filter((l: AssignedLead) => l.salesId !== userId && l.adminId !== userId);
      localStorage.setItem('crm_assigned_leads', JSON.stringify(leads));

      // سجلات حضوره وانصرافه
      saveAttendance(getAttendance().filter((a: Attendance) => a.userId !== userId));
    } else {
      // ===== الأرقام والعملاء ترجع «غير مخصص» بدل ما تضيع مع الحساب =====
      // حذف حساب المندوب ما يمسحش شغل الشركة: الأرقام ترجع لتوزيع الأرقام
      // «غير مخصصة» ( ومعها كومنتاتها في خط العميل )، والعملاء يرجعوا بلا مالك
      // لحد ما الإدارة توزّعهم. التذكيرات والحضور شخصية المندوب ⇒ بتتشال.
      // (قبل التعديل كانت الأرقام بتفضل مربوطة بحساب مش موجود ⇒ مختفية عن الكل.)
      const now = new Date().toISOString();
      const leads: AssignedLead[] = JSON.parse(localStorage.getItem('crm_assigned_leads') || '[]')
        .map((l: AssignedLead) => (String(l.salesId || '') === userId ? { ...l, salesId: '', assignedAt: now } : l));
      localStorage.setItem('crm_assigned_leads', JSON.stringify(leads));

      const clients: Client[] = JSON.parse(localStorage.getItem('crm_clients') || '[]')
        .map((c: Client) => (
          String(c.assignedTo || '') === userId || String(c.userId || '') === userId
            ? { ...c, userId: '', assignedTo: '', updatedAt: now }
            : c
        ));
      localStorage.setItem('crm_clients', JSON.stringify(clients));

      // التذكيرات والحضور: شخصية المندوب — بتتشال
      const reminders = JSON.parse(localStorage.getItem('crm_reminders') || '[]')
        .filter((r: Reminder) => r.userId !== userId);
      localStorage.setItem('crm_reminders', JSON.stringify(reminders));
      saveAttendance(getAttendance().filter((a: Attendance) => a.userId !== userId));

      // بطاقات الفيدباك (الكومنتات) بتفضل محفوظة مع أرقامها — مش بتتشال.
      // ولما الرقم ينزل على مندوب، البطاقة بتنتقل ليه (في applyLeadOwners).

      // التوزيع التلقائي: الحساب المحذوف ما يوزّعش عليه حدّ بعد كده
      const rules = parseRules(JSON.parse(localStorage.getItem('crm_lead_auto_assign') || '[]'));
      const nextRules = rules.map((rule) => (
        rule.salesIds.includes(userId)
          ? { ...rule, salesIds: rule.salesIds.filter((id) => id !== userId), updatedAt: now }
          : rule
      ));
      if (nextRules.length !== rules.length || nextRules.some((rule, i) => rule !== rules[i])) {
        localStorage.setItem('crm_lead_auto_assign', JSON.stringify(nextRules));
        void pushKey('crm_lead_auto_assign');
      }
      void pushKey('crm_assigned_leads');
      void pushKey('crm_clients');
      void pushKey('crm_reminders');
    }

    // إزالة العضو من الفرق وحذف الفرق التي كان مشرفاً عليها
    const teams: Team[] = JSON.parse(localStorage.getItem('crm_teams') || '[]')
      .map((t: Team) => ({ ...t, memberIds: t.memberIds.filter((id: string) => id !== userId) }))
      .filter((t: Team) => t.supervisorId !== userId);
    localStorage.setItem('crm_teams', JSON.stringify(teams));

    // رفع الحذف فوراً مع شواهد الحذف — بدونها يعود الحساب المحذوف بعد تحديث الصفحة
    // (pushKey ترصد المعرّفات المزيلة بنفسها وتسجّل لها شاهد حذف قبل رفع القائمة)
    void pushKey('crm_users');
    void pushKey('crm_teams');
    if (deleteRelatedData) {
      void pushKey('crm_clients');
      void pushKey('crm_reminders');
      void pushKey('crm_daily_feedback');
      void pushKey('crm_assigned_leads');
      void pushKey('crm_attendance');
    }

    setTeams(teams);
    setUsers(updatedUsers);
    loadData();
  };

  // إغلاق درج القائمة بزر Escape (هاتف/كيبورد) — قبل أي return شرطي احتراماً لقواعد الـ Hooks
  useEffect(() => {
    if (!sidebarOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setSidebarOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sidebarOpen]);

  // ===== زرار الرجوع في الجهاز (أو السحب من حافة الشاشة) =====
  // المشكلة: السحب من اليمين/الشمال — أو زرار الرجوع في الأندرويد — كان بيطلع
  // المستخدم من البرنامج خالص. دلوقتي: أول ما يفتح التطبيق بنضيف صفحة للـ history،
  // فالرجوع بيرجع جوّه البرنامج: بيقفل آخر نافذة مفتوحة (خطوة واحدة) ويفضل
  // المستخدم في البرنامج — بدل ما يقفله خالص.
  const backStateRef = useRef<{ leadsOpen: boolean; statusBoard: string | null; sidebarOpen: boolean }>({
    leadsOpen: false,
    statusBoard: null,
    sidebarOpen: false,
  });
  useEffect(() => {
    backStateRef.current = { leadsOpen, statusBoard, sidebarOpen };
  });
  useEffect(() => {
    // خطوة واحدة ورا: نقفل آخر نافذة مفتوحة، ولو مفيش نافذة نرجع بخطوة في التطبيق
    return installBackGuard(() => {
      if (backStateRef.current.leadsOpen) { setLeadsOpen(false); return true; }   // «الأرقام» → الرئيسية
      if (backStateRef.current.statusBoard) { setStatusBoard(null); return true; } // صفحة الحالة → التبويب
      if (backStateRef.current.sidebarOpen) { setSidebarOpen(false); return true; } // درج القائمة
      return false; // مفيش حاجة تتقفل — المستخدم يفضل في البرنامج
    });
  }, []);

  // أسماء الفورمات المفعّلة في إعدادات السحب — تُغذّي القوائم المسندلة في
  // «عملاء كامبين» و«توزيع الأرقام» (قبل أي return شرطي احتراماً لقواعد الـ Hooks)
  const activeCampaignForms = useActiveCampaignForms(!!currentUser && currentUser.role !== 'sales');

  // ===== معاينة الواجهة الجديدة (وضع التطوير فقط) =====
  // ?preview=dashboard|leads|sheet — نفس الكومبوننتس الحقيقية ببيانات وهمية،
  // عشان نتفق على الشكل قبل الرفع. الكود ده مش موجود في نسخة الإنتاج.
  if (import.meta.env.DEV && typeof window !== 'undefined') {
    const preview = new URLSearchParams(window.location.search).get('preview');
    if (preview) return <DevPreview screen={preview} />;
  }

  if (!currentUser) {
    return <LoginScreen onLogin={(user) => {
      setCurrentUser(user);
      localStorage.setItem('current_user', JSON.stringify(user));
      // نكمل من آخر صفحة فتحها هذا الحساب، وأول مرة: الإدارة من فريق العمل والسيلز من الرئيسية
      setActiveTab(startTabFor(user));
      setLoginAnimation(user);
    }} />;
  }

  // الرسائل غير المقروءة + تبويب المحادثة المناسب للدور
  // (تشمل غرفة المدراء لكل حساب إدارة — كل عضو يُقرأ لها على حدة)
  const unreadCount = messages.filter((m) => messageTargetsUser(m, currentUser) && !isMessageReadBy(m, currentUser.id)).length;
  const chatTab: TabType = currentUser.role === 'sales' ? 'chat' : 'admin-chat';
  // مجموعات القائمة الجانبية + عنوان الصفحة الحالية + الحرف الأول من الاسم داخل الصورة الرمزية
  // أثناء «الدخول لحساب» من الإدارة يظهر لحساب المطوّر قوائم السيلز فقط
  // (الإدارة تشوفه زي أي مندوب)، أما صاحبه فيرى القوائمتين.
  // كل من يعمل سيلزاً يرى قوائم السلبرز والإدارة معاً: المطوّر، أو إداري يستقبل أرقاماً
  const developerMenus = worksAsSales(currentUser) && !impersonator;
  const menuRole = impersonator && worksAsSales(currentUser) ? 'sales' : currentUser.role;
  const navGroups = getTabGroups(menuRole, developerMenus);
  // يرى واجهات السيلز والإدارة معاً (بلا لقب «مطوّر» — اللقب يتبع الرتبة)
  const isDeveloper = worksAsSales(currentUser);
  const isSalesView = currentUser.role === 'sales' || isDeveloper;
  const activeTabMeta = navGroups.flatMap((g) => g.items).find((t) => t.id === activeTab);
  const userInitial = (currentUser.name || '؟').trim().charAt(0);
  const closeSidebar = () => setSidebarOpen(false);

  // كلمات البحث (٣ أحرف على الأقل) لمطابقة الكلمات مهما كان ترتيبها
  const queryWords = (value: string): string[] =>
    normalizeArabicText(value).split(/\s+/).filter((word) => word.length >= 3);

  // بحث العميل: نفس الفلتر لكل القوائم (كل العملاء، أو الأرقام اليدوية بس)
  const matchesClientQuery = (c: Client): boolean => {
    const query = normalizeArabicText(searchTerm).trim();
    if (!query) return true;
    const ownerName = users.find((u: User) => u.id === c.userId || u.id === c.assignedTo)?.name || '';
    const haystack = normalizeArabicText(
      [
        c.name, c.phone, (c.phones || []).join(' '), c.property, c.budget,
        c.monthlyInstallment, c.deliveryPeriod, c.source, c.feedback, ownerName,
      ].filter(Boolean).join(' | ')
    );
    if (haystack.includes(query)) return true;

    // كل كلمات البحث موجودة (بأي ترتيب): «أحمد التجمع» = «التجمع أحمد»
    const words = queryWords(searchTerm);
    if (words.length > 1 && words.every((word) => haystack.includes(word))) return true;

    // بحث برقم الهاتف حتى لو فيه مسافات أو رموز
    const digitsQuery = normalizeDigits(searchTerm).replace(/\D/g, '');
    if (digitsQuery.length >= 3 && normalizeDigits(haystack).replace(/\D/g, '').includes(digitsQuery)) return true;

    return moneyMatches(searchTerm, c.budget || '', parsePrice(c.budget || ''));
  };
  const filteredClients = clients.filter(matchesClientQuery);

  // ===== تبويب «العملاء»: الأرقام اللي أضافها السيلز بنفسه فقط =====
  // عملاء الكامبين التلقائيين (المعرّف crm-lead-…) مش في العملاء: هم في صفحة
  // «الأرقام» مع باقي الأرقام، عشان العدّادات تبقى صورة واحدة للحقيقة.
  const manualClients = clients
    .filter((c: Client) => !String(c?.id || '').startsWith(LEAD_CLIENT_ID_PREFIX))
    .filter(matchesClientQuery);
  const manualLeads = assignedLeads.filter(
    (l: AssignedLead) => l.salesId === currentUser.id && isManualLead(l)
  );

  // فلتر الاحتياجات يُستخدم أيضاً في البحث العام (غرفتين، عشر آلاف، متشطبة…)
  const propertyNeeds = propertySearch.trim() ? parseNeeds(propertySearch) : null;
  const propertyNeedsActive = !!propertyNeeds && hasNeedsFilter(propertyNeeds);

  const filteredProperties = properties.filter((p) => {
    const query = normalizeArabicText(propertySearch).trim();
    if (!query) return true;

    // بحث بالاسم أو النوع أو الموقع أو الغرف/المساحة أو العميل أو التشطيب
    const finishingLabel = p.finishing === 'fully-finished'
      ? 'سوبر لوكس متشطب مفروش'
      : p.finishing === 'semi-finished' ? 'نصف تشطيب سيمي' : 'طوب محاره';
    const deliveryLabel = p.delivery === 'immediate' ? 'تسليم فوري جاهز للاستلام' : 'تسليم بعد فترة متأخر';
    const haystack = normalizeArabicText(
      [
        p.name, p.type, p.location, p.project, p.compound, p.area, p.rooms, p.bathrooms, p.floor,
        p.description, (p as any).notes, p.clientName, p.clientPhone, p.clientPhone2,
        finishingLabel, deliveryLabel,
      ].filter(Boolean).join(' | ')
    );
    if (haystack.includes(query)) return true;

    // كل كلمات البحث موجودة (بأي ترتيب)
    const words = queryWords(propertySearch);
    if (words.length > 1 && words.every((word) => haystack.includes(word))) return true;

    // بحث بالمبلغ: بالأرقام أو بفواصل أو بالحروف (مليون / ألف / عشر آلاف)
    if (moneyMatches(propertySearch, p.price || '', p.priceNumeric)) return true;

    // فهم الاحتياجات: غرفتين، أوضتين، 3 غرف، مساحة، تشطيب…
    // في البحث العام نعرض المطابق بدقة فقط؛ النتائج «القريبة» مكانها نافذة الاحتياجات.
    if (propertyNeedsActive && propertyNeeds) {
      const match = matchPropertyNeeds(p, propertyNeeds);
      if (match.ok && match.warns.length === 0) return true;
    }

    // «مليون» تطابق عقاراً مكتوباً (1.5 مليون)
    const priceWords = normalizeArabicText(p.price || '');
    return !/\d/.test(query) && priceWords.includes(query);
  });

  // ===== نطاق رؤية قائد الفريق (Team Leader): فريقه فقط =====
  const isTeamLeader = currentUser.role === 'supervisor';
  const teamMemberIds = isTeamLeader
    ? new Set<string>([currentUser.id, ...users.filter((u) => !!currentUser.team && u.team === currentUser.team).map((u) => u.id)])
    : null;
  const inTeam = (id?: string) => !teamMemberIds || !!id && teamMemberIds.has(id);
  const scopedUsers = teamMemberIds ? users.filter((u) => teamMemberIds.has(u.id)) : users;
  const scopedClients = teamMemberIds ? clients.filter((c) => inTeam(c.userId) || inTeam(c.assignedTo)) : clients;
  const scopedLeads = teamMemberIds ? assignedLeads.filter((l) => inTeam(l.salesId) || !l.salesId) : assignedLeads;
  const scopedCallLogs = teamMemberIds ? callLogs.filter((l) => inTeam(l.salesId)) : callLogs;
  const scopedFeedbacks = teamMemberIds ? dailyFeedbacks.filter((f) => inTeam(f.userId)) : dailyFeedbacks;
  const scopedReminders = teamMemberIds ? reminders.filter((r) => inTeam(r.userId)) : reminders;
  const scopedProperties = teamMemberIds ? properties.filter((p) => inTeam(p.userId)) : properties;

  // النطاق نفسه المستخدم في تحميل البيانات (dataScopeOf) — للتصفية وقت العرض كذلك،
  // حتى لا يعتمد أي تبويب على «currentUser.role === 'admin'» فيفتح كل شيء لحساب
  // إداري محدود النطاق (حساب المطوّر).
  const scopeIds = dataScopeOf(currentUser, users);
  const inMyScope = (id?: string) => !scopeIds || (!!id && scopeIds.has(id));

  const activeReminders = reminders.filter(r => !r.isCompleted);

  // ===== أرقام العملاء المسجّلين عند غيري =====
  // الرقم الواحد عند مالك واحد: لو رقم معمول كعميل عند مندوب تاني، ما يظهرش
  // في لوحة Cases/Marhal ولا في «عملاء كامبين» عند غيره ولا يتحط في follow up لوحده.
  // المصدر: نسخة السيرفر (كل الحسابات) — من غير ما تدخل ذاكرة الحساب.
  const otherClientPhones = (() => {
    const mine = new Set(phonesOfClients(clients));
    const out = new Set<string>();
    for (const p of clientPhonesOnServer()) if (!mine.has(p)) out.add(p);
    return out;
  })();

  // أرقام عملائي المسجّلين (كل رقم نزل عليّ من التوزيع صار عميلاً تلقائياً).
  // الرقم اللي بقى عميلاً ما يظهرش تاني كـ«رقم جديد» — الرقم واحد في مكان واحد.
  const myClientPhones = new Set(phonesOfClients(clients));

  // ===== كل رقم في نطاق المستخدم: عملاء مسجّلون + أرقام التوزيع =====
  // لوحة «حالات عملائي» و«المراحل» كانتا تعدّان العملاء المسجّلين فقط، فأرقام
  // التوزيع — وهي شغل المندوب الحقيقي — ما كانتش بتتعدّ والرقم يفضل صفر ثابت.
  const workNumbers = (() => {
    const snapshots = feedbackByPhone(scopedFeedbacks, scopedCallLogs, users);
    const myLeads = scopedLeads.filter(
      (l: AssignedLead) => inMyScope(l.salesId) && !otherClientPhones.has(phoneKeyOf(l.phone))
    );
    // الأرقام الموزّعة فقط تدخل لوحة الحالات: الرقم غير الموزّع ليس «مرحلة جديدة»
    // عند أحد، وكان يظهر في fresh stage وكأنه شغل الفريق (فكل أرقام الفورمات تُعدّ).
    // مكانه «توزيع الأرقام» حتى يُوزّع فعلاً.
    return buildWorkNumbers(scopedClients, myLeads, snapshots, { includeUnassigned: false });
  })();

  // ===== «محتاج إجراء»: التذكير فات موعده والمندوب مخدش خطوة =====
  // الكارت بيتلوّن أصفر (في كل المراحل — مش الـ follow up بس) لحد ما المندوب
  // يتصرف، وبعدها يرجع لونه الأصلي. المفتاح = أرقام الرقم عشان يتطابق مع
  // كارت العميل وكارت الرقم في كل الشاشات.
  const alertMap = (() => {
    const map = alertMapOf(scopedClients, scopedReminders, scopedCallLogs, nowTick);
    // أرقام موزّعة (مش عملاء مسجّلين) — التذكير بيبقى عليها برقمها
    for (const lead of scopedLeads || []) {
      const state = leadAlertState(lead, scopedReminders, scopedCallLogs, nowTick);
      if (!state.needsAction) continue;
      const key = digitsOfPhone(lead?.phone);
      if (key && !map.has(key)) map.set(key, String(state.dueAt || ''));
    }
    return map;
  })();

  // ===== «الإجراء القادم»: موعد محدد (يوم + ساعة) على كارت العميل =====
  // مبني على التذكيرات: أقرب تذكير مفتوح للعميل = الإجراء القادم.
  // لو فات موعده من غير خطوة → يبقى ظاهر «اتأخر» (نفس منطق «محتاج إجراء»).
  const nextActionMap = nextActionMapOf(scopedClients, scopedReminders, scopedCallLogs, nowTick);
  // نفس الخريطة من التذكيرات بس (من غير عميل مسجّل) — لكارت الرقم في صفحة الأرقام
  const nextActionByPhone = nextActionByPhoneOf(scopedReminders, nowTick);

  // المستحق الآن — الأحدث أولاً (نفس ترتيب تبويب التذكيرات)
  // التذكير اللي اتعمل عليه إجراء (مكالمة أو كومنت) بيخرج من القائمة فوراً،
  // والشارة «اتأخر» بتروح معاه — يعني الشارة ما بتروحش غير لما يتاخد إجراء فعلاً.
  const dueReminders = reminders
    .filter((r) => isReminderDue(r) && (currentUser.role !== 'admin' || r.userId === currentUser.id))
    .filter((r) => !actedAfterReminder(r, scopedClients, scopedCallLogs))
    .slice()
    .sort((a, b) => String(b.dateTime || '').localeCompare(String(a.dateTime || '')));
  // الأرقام المتأخرة كلها — مش الأحدث بس (الشارة تتبان على كل رقم اتأخر)
  const lateReminders = dueReminders.filter((r) => !!r.isDelayed);
  const lateNames = lateReminders
    .map((r) => String(r.clientName || '').trim())
    .filter(Boolean);
  
  const stats = {
    totalClients: clients.length,
    activeReminders: activeReminders.length,
    dueNow: dueReminders.length,
    campaignClients: clients.filter(c => c.status === 'campaign').length,
    facebookClients: clients.filter(c => c.status === 'facebook').length,
    externalClients: clients.filter(c => c.status === 'external').length,
    newStage: clients.filter(c => c.stage === 'new').length,
    contactedStage: clients.filter(c => c.stage === 'contacted').length,
    meetingStage: clients.filter(c => c.stage === 'meeting').length,
    negotiationStage: clients.filter(c => c.stage === 'negotiation').length,
    closedStage: clients.filter(c => c.stage === 'closed').length,
    lostStage: clients.filter(c => c.stage === 'lost').length,
    totalProperties: properties.length,
  };

  // ===== بيانات مركز الإشعارات (رسائل / اتصالات الفريق) =====
  // التذكيرات اتشالت من هنا: بقت إشعارًا خارجيًّا على الجهاز في وقتها فقط.
  // و«رقم جديد في الفورم» كمان اتشال من جوّه البرنامج: بقى إشعار خارجي على
  // جهاز السيلز («رقم فريش جديد نزل ليك») — فمفيش عدّاد أحمر ولا تكرار.

  const notifMessages = messages
    .filter((m) => messageTargetsUser(m, currentUser))
    .slice()
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 40);

  const notifCalls = callLogs.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 60);

  // العدّاد الأحمر: ما لم يره المستخدم بعد
  // «اتصالات الفريق» إشعار إدارة: حساب المطوّر (سلوكه سيلز) ما يحسبش اتصالات زملائه
  // في العدّاد، وإلا ظهرت له إشعارات مش ليه.
  const unseenNotifIds = [
    // «رقم جديد في الفورم» مش إشعار داخلي — إشعار خارجي على جهاز السيلز بس
    ...notifMessages.filter((m) => !isMessageReadBy(m, currentUser.id)).map((m) => `msg-${m.id}`),
    ...(effectiveRoleOf(currentUser) !== 'sales' ? notifCalls.slice(0, 30).map((c) => `call-${c.id}`) : []),
  ];
  const unseenNotifCount = unseenNotifIds.filter((id) => !seenNotifIds.includes(id)).length;

  // شارة «عملاء كامبين»: أرقام جديدة لسه ما اتضافتش لعملاء السيلز
  const newCampaignLeadsCount = isSalesView
    ? assignedLeads.filter((l) => l.salesId === currentUser.id && l.status === 'new' && isCampaignRecord(l)).length
    : 0;

  // فتح جرس الإشعارات = قراءة كل الإشعارات دفعة واحدة (كل التبويبات)،
  // لا التبويب المعروض فقط — وإلا يظل العدّاد الأحمر عالقاً بعد الإغلاق.
  // فتح الجرس = قراءة الإشعارات فعلاً: التذكيرات والمكالمات تُعلَّم مقروءة على
  // هذا الجهاز، والرسائل تُعلَّم مقروءة في السجل المشترك نفسه (readAt / readBy)
  // — وليس في ذاكرة المتصفح فقط. بدونه كانت الرسائل ترجع «جديدة» بعد كل تحديث.
  const openNotifyCenter = () => {
    setShowNotifyCenter(true);
    markNotifsSeen(unseenNotifIds);
    const unread = notifMessages.filter((m: ChatMessage) => !isMessageReadBy(m, currentUser.id));
    const direct = unread.filter((m: ChatMessage) => m.toId !== MANAGERS_GROUP_ID).map((m) => m.id);
    const group = unread.filter((m: ChatMessage) => m.toId === MANAGERS_GROUP_ID).map((m) => m.id);
    if (direct.length) handleMarkRead(direct);
    if (group.length) handleMarkGroupRead(group);
    // الإشعارات الخارجية: نطلب من السيرفر إرسال أي تذكير/رسالة مستحقة الآن
    void flushPush();
  };

  const markNotifsSeen = (idsToMark: string[]) => {
    if (!idsToMark.length) return;
    const merged = Array.from(new Set([...seenNotifIds, ...idsToMark])).slice(-500);
    setSeenNotifIds(merged);
    try {
      localStorage.setItem(`crm_notif_seen_${currentUser.id}`, JSON.stringify(merged));
    } catch {}
  };

  // حفظ مكالمة: سجل مشترك للإدارة + حدث في الخط الزمني للعميل + تذكير بموعد الاتصال القادم
  // + الكومنت ينزل تلقائياً كبطاقة في «الفيدباك اليومي» (فوق: خط العميل الزمني ينزل هو كذلك من addClientActivity)
  const handleSaveCall = (payload: { result: 'answered' | 'no-answer'; comment: string; status?: string; cancelReason?: string; nextCallAt: string }) => {
    const target = callClient;
    if (!target) return;
    // الحالة المختارة من القائمة المنسدلة (follow up / done deal …) هي الحالة المسجّلة،
    // ولو مافيش اختيار نرجع للحالة الافتراضية حسب نتيجة الاتصال.
    const pickedStatus = payload.status || (payload.result === 'answered' ? 'follow-up' : 'no-answer');
    // «لم يرد» و«إلغاء» يكتبان الكومنت تلقائياً — حتى لو لم يكتب المندوب شيئاً
    const callComment =
      payload.comment.trim() ||
      (payload.result === 'no-answer' ? NO_ANSWER_COMMENT : '') ||
      (pickedStatus === 'cancellation' ? cancelReasonLabelOf(payload.cancelReason) : '');
    const log: CallLog = {
      id: crypto.randomUUID(),
      clientId: target.id,
      clientName: target.name,
      clientPhone: target.phone,
      salesId: currentUser.id,
      salesName: currentUser.name,
      result: payload.result,
      comment: callComment,
      nextCallAt: payload.nextCallAt ? new Date(payload.nextCallAt).toISOString() : undefined,
      createdAt: new Date().toISOString(),
    };
    saveCallLogs([log, ...getCallLogs()]);
    // سجل المكالمات كان محلياً فقط — يُرفع الآن حتى يظهر في «كل التعليقات»
    // وفي أرقام الفيدباك اليومي عند الإدارة.
    void pushKey('crm_call_logs');
    void pushKey('crm_clients');
    // سجل هذا الحساب فقط — بنفس نطاقه (الإدارة الكاملة ترى الكل، والحساب المحدود النطاق
    // يبقى على سجله هو؛ كان الاعتماد على الرتبة يرمي كل مكالمات الشركة في ذاكرته
    // فتظهر أرقام وفيدباك الجميع على لوحته).
    setCallLogs(getCallLogs().filter((l: CallLog) => inMyScope(l.salesId)));

    // ===== رقم موزَّع لسه مش عميل مسجّل =====
    // مفيش سجل عميل نضيف عليه الخط الزمني، فالمكالمة بتتسجَّل برقمه: سجل
    // المكالمات (فوق) + بطاقة فيدباك — وبكده الرقم بينتقل للمرحلة اللي اتفق
    // عليها، لأن لوحة «المراحل» بتقرأ حالة كل رقم من بطاقات الفيدباك.
    const storeClients: Client[] = (() => {
      try {
        const parsed = JSON.parse(localStorage.getItem('crm_clients') || '[]');
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    })();
    const isRegisteredClient = storeClients.some((c) => c.id === target.id);

    if (isRegisteredClient) {
      // الكومنت بس — ما فيش لوج «اتصال: تم الرد» في خط العميل:
      // سجل المكالمات (crm_call_logs) هو اللي بيحفظ نتيجة المكالمة،
      // والكومنتات بتعرض كلام السيلز فقط.
      if (callComment) {
        addClientActivity(target.id, 'feedback', callComment, currentUser.name, {
          authorId: currentUser.id,
          callStatus: payload.result === 'answered' ? 'called' : 'no-answer',
          cardId: log.id,
          status: pickedStatus,
          // ===== «الإجراء القادم» (موعد الاتصال القادم) ===== 
          // بيتكتب على سجل العميل نفسه فيبان سطر «الإجراء القادم» على الكارت
          ...(payload.nextCallAt
            ? {
                nextActionAt: new Date(payload.nextCallAt).toISOString(),
                nextActionNote: payload.result === 'answered' ? 'متابعة اتصال (تم الرد)' : 'إعادة اتصال (لم يرد)',
              }
            : {}),
          ...(pickedStatus === 'cancellation' && payload.cancelReason ? { cancelReason: payload.cancelReason } : {}),
        });
      }
    } else {
      // بطاقة الفيدباك بنفس شكل كارت العميل: تظهر في «الفيدباك اليومي» وبها
      // رقم العميل — فتبقى الحالة مقروءة من كل الأجهزة (مش جهاز واحد).
      const card: DailyFeedback = {
        id: log.id,
        userId: currentUser.id,
        clientPhone: target.phone,
        clientName: target.name,
        date: log.createdAt,
        feedback: callComment || (payload.result === 'answered' ? 'اتصال: تم الرد' : NO_ANSWER_COMMENT),
        callStatus: payload.result === 'answered' ? 'called' : 'no-answer',
        status: pickedStatus,
        createdAt: log.createdAt,
      };
      try {
        const feedbacks: DailyFeedback[] = JSON.parse(localStorage.getItem('crm_daily_feedback') || '[]');
        localStorage.setItem('crm_daily_feedback', JSON.stringify([card, ...feedbacks.filter((f) => f.id !== card.id)]));
      } catch {
        /* لا شيء */
      }
      void pushKey('crm_daily_feedback');
      // وحالة الرقم في قائمة التوزيع تبقى «اتواصل» (مش «نزل جديد»)
      const phoneKey = String(target.phone || '').replace(/\D/g, '');
      if (phoneKey) {
        let hasLead = false;
        try {
          const leads: AssignedLead[] = JSON.parse(localStorage.getItem('crm_assigned_leads') || '[]');
          hasLead = leads.some((l) =>
            String(l.phone || '').replace(/\D/g, '') === phoneKey && l.status !== 'closed'
          );
        } catch {
          hasLead = false;
        }
        if (hasLead) {
          void writeAssignedLeads((all) => all.map((l) =>
            String(l.phone || '').replace(/\D/g, '') === phoneKey && l.status !== 'closed'
              ? { ...l, status: 'contacted' as const, viewedAt: l.viewedAt || new Date().toISOString() }
              : l
          ));
        }
      }
    }
    // المرحلة تتحرّك تلقائياً مع الحالة المختارة (زي صندوق الفيدباك)
    const pickedMeta = FEEDBACK_STATUS_BY_ID[pickedStatus];
    if (pickedMeta?.stage && target.stage !== pickedMeta.stage) {
      handleUpdateClientStage(target.id, pickedMeta.stage);
    }

    if (payload.nextCallAt) {
      const allReminders: Reminder[] = JSON.parse(localStorage.getItem('crm_reminders') || '[]');
      const reminder: Reminder = {
        id: crypto.randomUUID(),
        userId: currentUser.id,
        clientId: target.id,
        clientName: target.name,
        clientPhone: target.phone,
        dateTime: new Date(payload.nextCallAt).toISOString(),
        note: payload.result === 'answered' ? 'متابعة اتصال (تم الرد)' : 'إعادة اتصال (لم يرد)',
        isCompleted: false,
        isDelayed: false,
        delayCount: 0,
        createdAt: new Date().toISOString(),
      };
      localStorage.setItem('crm_reminders', JSON.stringify([reminder, ...allReminders]));
      setReminders(currentUser.role === 'sales' ? [...reminders, reminder] : [...reminders, reminder]);
      // يرفع فوراً حتى يُرسل السيرفر إشعاره والموقع مقفول
      void pushKey('crm_reminders');
    }

    // ===== التذكير اللي اتفتح من ✓: ينتهي بمجرد تسجيل الاتصال والفيدباك =====
    if (reminderCallId) {
      markReminderAction(reminderCallId);
      const nextReminders = readReminders().map((r) =>
        r.id === reminderCallId ? { ...r, isCompleted: true } : r
      );
      localStorage.setItem('crm_reminders', JSON.stringify(nextReminders));
      void pushKey('crm_reminders');
      setReminderCallId(null);
      loadData();
    }

    setInAppNotification({
      title: ' تم تسجيل الاتصال',
      body: `كومنتك اتسجلت في الفيدباك اليومي — ${target.name}`,
    });
    setTimeout(() => setInAppNotification(null), 6000);
    setCallClient(null);
  };

  // ملاحظة: الدخول بتلاشي فقط، بلا `scale` عمداً.
  // أي `transform` على جذر التطبيق يجعل العناصر الثابتة داخله (الشريط العلوي
  // والقائمة الجانبية) مثبّتة بالنسبة له لا بالنسبة للشاشة، فتتحرك مع التمرير.
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.35, ease: 'easeOut' }}
      className={`app-root${impersonator ? ' has-impersonator' : ''}`}
    >
      <div className="bg-orb bg-orb-1"></div>
      <div className="bg-orb bg-orb-2"></div>
      <div className="bg-orb bg-orb-3"></div>

      <AnimatePresence>
        {inAppNotification && (
          <motion.div
            initial={{ opacity: 0, y: -100 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -100 }}
            className="alarm-float fixed left-1/2 -translate-x-1/2 z-[100] w-full max-w-md px-4"
          >
            <div className="panel p-4 border-[var(--brand-primary-soft)] glow-primary">
              <div className="flex items-start gap-3">
                <motion.div
                  animate={{ scale: [1, 1.2, 1] }}
                  transition={{ duration: 0.5, repeat: Infinity }}
                  className="w-10 h-10 gradient-primary rounded-full flex items-center justify-center"
                >
                  <Bell className="w-5 h-5 text-[var(--text-strong)]" />
                </motion.div>
                <div className="flex-1">
                  <p className="font-bold text-[var(--text-strong)] text-sm">{inAppNotification.title}</p>
                  <p className="text-[var(--text)] text-xs mt-1">{inAppNotification.body}</p>
                </div>
                <button onClick={() => setInAppNotification(null)} className="p-1 hover:bg-[var(--tint-2)] rounded-[var(--r-sm)]">
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* شريط «أنت داخل حساب سيلز» — يُرسم عبر Portal خارج شجرة التطبيق.
          السبب: جذر التطبيق يتحرك بحركة دخول (transform)، وأي عنصر `fixed` داخل
          عنصر متحرك يصبح مثبتاً بالنسبة له لا بالنسبة للشاشة — فيتحرك مع التمرير
          ويتداخل مع العنوان. الـ Portal يضعه في `body` مباشرة فيثبت على الشاشة. */}
      {impersonator && createPortal(
        <div className="imp-bar" role="status">
          <span className="imp-bar-mark" aria-hidden="true"><UserCog className="w-3.5 h-3.5" /></span>
          <span className="imp-bar-text">
            <span className="imp-bar-title">
              داخل حساب <b className="imp-bar-who">{currentUser.name}</b>
              <span className="imp-bar-role">{rankLabel(selfRoleOf(currentUser))}</span>
            </span>
            <span className="imp-bar-note">ما تراه الآن هو ما يراه هذا الحساب بالضبط</span>
          </span>
          <div className="imp-bar-actions">
            <button onClick={handleReturnToAdmin} className="imp-bar-back">
              <Undo2 className="w-3.5 h-3.5" aria-hidden="true" />
              <span className="sm:hidden">الرجوع للإدارة</span>
              <span className="hidden sm:inline">الرجوع لحساب {impersonator.name}</span>
            </button>
            <button
              onClick={handleLogout}
              title="خروج نهائي من النظام"
              aria-label="خروج نهائي من النظام"
              className="imp-bar-logout"
            >
              <LogOut className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>
        </div>,
        document.body
      )}

      <div className={`app-shell ${impersonator ? 'has-impersonator' : ''} ${desktopNavHidden ? 'nav-rail' : ''}`}>
        {/* القائمة الجانبية — على يمين الشاشة */}
        <aside className={`app-sidebar ${sidebarOpen ? 'open' : ''} ${desktopNavHidden ? 'rail' : ''}`}>
          <div className="sidebar-brand">
            <img src="/msa-app-icon.png?v=4" alt="MSA CRM" className="brand-mark object-cover" />
            <div className="min-w-0">
              <h1 className="text-[13px] font-semibold text-[var(--text-strong)] leading-tight truncate">MSA CRM</h1>
              <p className="text-[10.5px] text-[var(--text-dim)] truncate">
                {(currentUser as User).developer ? 'MSA CRM — System Developer' : 'إعمار جروب — إدارة العملاء'}
              </p>
            </div>
          </div>

          <div className="sidebar-scroll">
            {navGroups.map((group, groupIndex) => (
              <div key={`${group.section || ''}-${group.label}`} className="mb-1">
                {/* فاصل قسم كبير فوق مجموعة القوائم (قوائم السيلز / قوائم الادارة) */}
                {group.section && group.section !== navGroups[groupIndex - 1]?.section && (
                  <p className="nav-section-title">{group.section}</p>
                )}
                <p className="nav-group-title">{group.label}</p>
                {group.items.map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => { setActiveTab(tab.id); closeSidebar(); }}
                    className={`side-link ${activeTab === tab.id ? 'active' : ''}`}
                  >
                    <span className="side-icon"><tab.icon className="w-4 h-4" /></span>
                    <span className="truncate">{tab.label}</span>
                    {tab.id === chatTab && unreadCount > 0 && (
                      <span className="side-badge">{unreadCount > 9 ? '9+' : unreadCount}</span>
                    )}
                  </button>
                ))}
              </div>
            ))}
          </div>

          <div className="sidebar-foot space-y-3">
            {/* زر الرجوع للإدارة موجود في الشريط العلوي الثابت دائماً —
                تكراره هنا كان يزحم المساحة بنفس اللون والوظيفة. */}
            <div className="flex items-center justify-between gap-2">
              <ModeToggle />
              <button
                onClick={() => setSoundEnabled(!soundEnabled)}
                className="icon-btn !w-9 !h-9"
                title={soundEnabled ? 'صوت رسائل المحادثة: مفعّل' : 'صوت رسائل المحادثة: مكتوم'}
              >
                {soundEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
              </button>
            </div>
            <div className="user-card">
              <span className="avatar">{userInitial}</span>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-bold text-[var(--text-strong)] truncate">{currentUser.name}</p>
                <span className={`${rankClass(selfRoleOf(currentUser))} !mt-0.5`}>
                  {rankLabel(selfRoleOf(currentUser))}
                </span>
              </div>
              <button
                onClick={impersonator ? handleReturnToAdmin : handleLogout}
                className="icon-btn !w-9 !h-9 !bg-transparent"
                title={impersonator ? `الرجوع لحساب: ${impersonator.name}` : 'تسجيل الخروج'}
              >
                {impersonator ? <Undo2 className="w-4 h-4" /> : <LogOut className="w-4 h-4" />}
              </button>
            </div>
          </div>
        </aside>

        {sidebarOpen && <div className="sidebar-backdrop min-[901px]:hidden" onClick={closeSidebar} />}

        {/* المنطقة الرئيسية */}
        <div className="app-main">
          <header className="app-topbar">
            <button
              onClick={() => {
                // موبايل: فتح/إغلاق الدرج — كمبيوتر: طي القائمة إلى أيقونات فقط
                if (window.matchMedia('(max-width: 900px)').matches) setSidebarOpen((v) => !v);
                else setDesktopNavHidden((v) => !v);
              }}
              className="icon-btn"
              title={sidebarOpen ? 'إغلاق القائمة' : desktopNavHidden ? 'إظهار الأسماء' : 'إظهار الأيقونات فقط'}
            >
              <Menu className="w-5 h-5" />
            </button>

            <div className="min-w-0 flex-1">
              <h2 className="page-heading">{activeTabMeta?.label || 'الرئيسية'}</h2>
              <p className="page-sub">{navGroups.find((g) => g.items.some((t) => t.id === activeTab))?.label || ''}</p>
            </div>

            {/* أيقونة دائرية + الاسم وتحته الرتبة (CEO / Team Leader / Sales Agent) — يظهران حتى على الهاتف */}
            <div className="top-user" title={`${currentUser.name} — ${rankAr(selfRoleOf(currentUser))}`}>
              <span className="top-avatar">{userInitial}</span>
              <span className="who">
                <b>{currentUser.name}</b>
                <span className={rankClass(selfRoleOf(currentUser))}>
                  {rankLabel(selfRoleOf(currentUser))}
                </span>
              </span>
            </div>
          
          <div className="flex items-center gap-1.5 md:gap-2 shrink-0">
            {/* الإشعارات — مقسّمة: تذكيرات / أرقام جديدة / رسائل / اتصالات الفريق */}
            <motion.button
              whileHover={{ scale: 1.05 }}
              onClick={() => { alarm.unlock(); openNotifyCenter(); }}
              title="الإشعارات"
              className="icon-btn relative"
            >
              <Bell className="w-4 h-4" />
              {/* التذكيرات ما بقتش إشعار داخلي: بتوصل إشعارًا خارجيًّا على الجهاز
                  مرة واحدة في وقتها. الجرس بيفضل للأرقام الجديدة والرسائل. */}
              {unseenNotifCount > 0 ? (
                <span className="topbar-badge">{unseenNotifCount > 9 ? '9+' : unseenNotifCount}</span>
              ) : null}
              {notifState !== 'subscribed' && unseenNotifCount === 0 && (
                <span className="topbar-badge is-warn" />
              )}
            </motion.button>

            {/* ألوان الموقع (لكل مستخدم) */}
            <ThemePaletteButton userId={currentUser.id} />

            {/* أيقونة المظهر (ليلي/نهاري) — جنب الإشعارات */}
            <ModeIconButton />
            
            {/* المحادثات — نقطة حمراء بعدد الرسائل الجديدة */}
            <motion.button
              whileHover={{ scale: 1.1 }}
              onClick={() => setActiveTab(chatTab)}
              title="المحادثات"
              className="icon-btn relative top-chat-btn"
            >
              <MessageCircle className="w-4 h-4" />
              {unreadCount > 0 && (
                <span className="topbar-badge">{unreadCount > 9 ? '9+' : unreadCount}</span>
              )}
            </motion.button>

            {/* تبويب «الفيدباك» عرض فقط (قراءة سجل الفيدباك) — فزر إضافة عميل مخفي فيه */}
            {activeTab !== 'daily-feedback' && activeTab !== 'admin-feedback' && (
              <motion.button
                whileHover={{ scale: 1.05 }}
                onClick={() => openAddClient()}
                title="عميل جديد"
                className="btn-primary"
              >
                <Plus className="w-4 h-4" />
                <span className="hidden lg:inline">عميل جديد</span>
              </motion.button>
            )}

            {/* زر واحد للخروج: داخل حساب سيلز يرجعك للإدارة، وفي حسابك يُسجّل الخروج */}
            <motion.button
              whileHover={{ scale: 1.05 }}
              onClick={impersonator ? handleReturnToAdmin : handleLogout}
              title={impersonator ? `الرجوع لحساب: ${impersonator.name}` : 'تسجيل الخروج'}
              className="icon-btn"
            >
              {impersonator ? <Undo2 className="w-4 h-4" /> : <LogOut className="w-4 h-4" />}
            </motion.button>
          </div>
        </header>

        <main className="app-content">
        {/* تنبيه داخل الموقع يظل ظاهراً ما دام فيه تذكير مستحق — لا يختفي بعد ١٠ ثوانٍ */}
        {dueReminders.length > 0 && (
          <div className="reminder-strip" role="status" aria-live="polite">
            <span className="rs-icon" aria-hidden="true"><BellRing className="w-4 h-4" /></span>
            <div className="rs-body">
              <b>{dueReminders.length} تذكير مستحق الآن</b>
              <small>
                {lateNames.length ? (
                  // كل الأرقام المتأخرة — مش الأحدث بس
                  <>متأخر: {lateNames.slice(0, 3).join('، ')}{lateNames.length > 3 ? ` (+${lateNames.length - 3})` : ''}</>
                ) : (
                  <>الأحدث: {dueReminders[0].clientName} — {formatDateTime(dueReminders[0].dateTime)}</>
                )}
              </small>
            </div>
            <div className="rs-actions">
              {notifPermission === 'default' && (
                <button type="button" className="rc-action is-done" onClick={() => void requestNotifications()}>
                  تفعيل إشعارات الكمبيوتر
                </button>
              )}
              <button
                type="button"
                className="rc-action"
                onClick={() => {
                  if (currentUser.role === 'sales') setActiveTab('reminders');
                  else openNotifyCenter();
                }}
              >
                عرض التذكيرات
              </button>
            </div>
          </div>
        )}
        {/* طلب تفعيل إشعارات الكمبيوتر مرة واحدة — بدونها المتصفح لا يسمح بأي إشعار */}
        {dueReminders.length === 0 && notifPermission === 'default' && !notifPromptDismissed && (
          <div className="reminder-strip is-perm" role="status">
            <span className="rs-icon" aria-hidden="true"><Bell className="w-4 h-4" /></span>
            <div className="rs-body">
              <b>فعّل إشعارات الكمبيوتر</b>
              <small>مرة واحدة فقط — عشان التذكيرات ورسائل الفريق توصلك حتى لو الموقع مقفول.</small>
            </div>
            <div className="rs-actions">
              <button type="button" className="rc-action is-done" onClick={() => void requestNotifications()}>
                تفعيل الإشعارات
              </button>
              <button
                type="button"
                className="rc-action"
                onClick={() => {
                  setNotifPromptDismissed(true);
                  try {
                    localStorage.setItem('crm_notif_prompt_hidden', '1');
                  } catch {
                    /* لا شيء */
                  }
                }}
              >
                لاحقاً
              </button>
            </div>
          </div>
        )}
        {/* تنبيه صلاحية توكن السحب: يظهر للإدارة قبل الانتهاء بيومين — لا يُغلق ولا يختفي */}
        {tokenNotice && (
          <div className={`reminder-strip${tokenNotice.expired ? ' is-danger' : ''}`} role="status" aria-live="polite">
            <span className="rs-icon" aria-hidden="true"><KeyRound className="w-4 h-4" /></span>
            <div className="rs-body">
              <b>{tokenNotice.expired ? `انتهى توكن سحب ${tokenNotice.label} — السحب متوقف` : `توكن سحب ${tokenNotice.label} ينتهي خلال يومين`}</b>
              <small>
                ولّد توكن جديداً من Graph API Explorer (بصلاحياته الخمس) وألصقه في إعدادات سحب الأرقام — حتى لا يتوقف وصول أرقام الكامبينات.
              </small>
            </div>
            <div className="rs-actions">
              <button
                type="button"
                className="rc-action is-done"
                onClick={() => {
                  // نفتح تبويب القناة مباشرة في «فريق العمل» — نفس التبويب المحفوظ داخلياً
                  try {
                    localStorage.setItem('crm_admin_users_tab', tokenNotice.channel);
                  } catch {
                    /* لا شيء */
                  }
                  setActiveTab('admin-users');
                }}
              >
                تجديد التوكن الآن
              </button>
            </div>
          </div>
        )}
        <AnimatePresence mode="wait">
          {activeTab === 'dashboard' && isSalesView && (leadsOpen ? (
            /* ===== كل الأرقام بتتعمل من الرئيسية: العدّادات بتفتح الصفحة دي ===== */
            <LeadsView
              currentUser={currentUser}
              numbers={workNumbers}
              leads={assignedLeads}
              callLogs={callLogs}
              alertMap={alertMap}
              nextActionMap={nextActionByPhone}
              filter={leadsFilter}
              onFilter={setLeadsFilter}
              onBack={() => setLeadsOpen(false)}
              onOpen={(target: any) => {
                if (!target) return;
                const client = (clients || []).find((c: Client) => String(c.id) === String(target.id));
                setCallClient(client || leadCallTarget(target));
              }}
            />
          ) : (
            <DashboardView stats={stats} clients={clients} numbers={workNumbers} reminders={reminders} properties={properties} currentUser={currentUser} impersonating={!!impersonator} callLogs={callLogs} onOpenStatus={(id: string) => { setLeadsFilter(id || ''); setLeadsOpen(true); }} onCompleteReminder={completeReminder} onActed={markReminderAction} />
          ))}
          {activeTab === 'clients' && isSalesView && <ClientsView
            currentUser={currentUser}
            users={scopedUsers}
            onRefresh={loadData}
            clients={manualClients}
            leads={manualLeads}
            callLogs={callLogs.filter((l: CallLog) => l.salesId === currentUser.id)}
            feedbacks={dailyFeedbacks}
            alertMap={alertMap}
            nextActionMap={nextActionMap}
            searchTerm={searchTerm}
            onSearch={setSearchTerm}
            onSelect={setSelectedClient}
            onAdd={() => openAddClient()}
            onAddNumber={currentUser.role === 'sales' ? () => setShowAddAssignedLead(true) : undefined}
            onCall={(c: Client) => setCallClient(c)}
            // شريط الفيدباك في الكارت: كل حالة تنقل العميل إلى مرحلتها تلقائياً
            onSetStage={(id: string, stage: Client['stage']) => {
              if (!id || !stage) return; // نفس المرحلة → لا نعيد كتابتها
              handleUpdateClientStage(id, stage);
            }}
            onLeadViewed={(id: string) => {
              const target = assignedLeads.find((l: AssignedLead) => l.id === id);
              if (!target || target.status !== 'new') return;
              writeAssignedLeads((all) => all.map((l: AssignedLead) =>
                l.id === id ? { ...l, status: 'viewed' as const, viewedAt: new Date().toISOString() } : l
              ));
            }}
          />}
          {activeTab === 'pipeline' && (!scopeIds || currentUser.role === 'supervisor') && <AdminPipelineView clients={scopedClients} users={scopedUsers} currentUser={currentUser} onUpdateStage={handleUpdateClientStage} onSelectClient={setSelectedClient} onAddFeedback={(client: Client) => {
            setFeedbackPreset({ clientId: client.id, clientName: client.name, clientPhone: client.phone });
            setShowAddFeedback(true);
          }} />}
          {activeTab === 'pipeline' && !!scopeIds && currentUser.role !== 'supervisor' && <PipelineView clients={clients} users={scopedUsers} numbers={workNumbers} leads={assignedLeads.filter((l: AssignedLead) => l.salesId === currentUser.id)} alertMap={alertMap} nextActionMap={nextActionMap} onUpdateStage={handleUpdateClientStage} currentUser={currentUser} onSelectClient={setSelectedClient} onRefresh={loadData} onCall={(c: any) => setCallClient(c)} onLeadViewed={(id: string) => {
            const target = assignedLeads.find((l: AssignedLead) => l.id === id);
            if (!target || target.status !== 'new') return;
            writeAssignedLeads((all) => all.map((l: AssignedLead) =>
              l.id === id ? { ...l, status: 'viewed' as const, viewedAt: new Date().toISOString() } : l
            ));
          }} />}
          {activeTab === 'properties' && <PropertiesView properties={filteredProperties} users={users} currentUser={currentUser} searchTerm={propertySearch} onSearch={setPropertySearch} onSelect={setSelectedProperty} onAdd={() => setShowAddProperty(true)} />}
          {/* زرار ✓ في التذكيرات يفتح تسجيل الاتصال (تم الرد / لم يرد + كومنت)،
              والسجل ينتهي تلقائياً بعد الحفظ — بدل إغلاق التذكير بلا أي فيدباك. */}
          {activeTab === 'reminders' && isSalesView && <RemindersView reminders={reminders} onLog={(id: string) => {
            const target = reminders.find((r: Reminder) => r.id === id);
            if (target) startReminderCall(target);
          }} onDelay={(id: string, minutes: number) => {
            // «تأجيل» إجراء مقصود — مش تأخير. عدّاد التأخير يزيد فقط عند
            // مرور ٥ دقائق بلا أي إجراء (applyReminderDelays).
            markReminderAction(id);
            const reschedule = (r: Reminder) => ({
              ...r,
              dateTime: new Date(new Date(r.dateTime).getTime() + minutes * 60000).toISOString(),
            });
            setReminders(reminders.map((r: Reminder) => (r.id === id ? reschedule(r) : r)));
            const stored = JSON.parse(localStorage.getItem('crm_reminders') || '[]')
              .map((r: Reminder) => (r.id === id ? reschedule(r) : r));
            localStorage.setItem('crm_reminders', JSON.stringify(stored));
            void pushKey('crm_reminders');
          }} onDelete={(id: string) => {
            setReminders(reminders.filter(r => r.id !== id));
            localStorage.setItem('crm_reminders', JSON.stringify(JSON.parse(localStorage.getItem('crm_reminders') || '[]').filter((r: Reminder) => r.id !== id)));
            void pushKey('crm_reminders');
          }} onAdd={() => setShowAddReminder(true)} />}
          {activeTab === 'daily-feedback' && isSalesView && <DailyFeedbackView feedbacks={dailyFeedbacks} clients={clients} currentUser={currentUser} users={users} callLogs={callLogs.filter((l: CallLog) => l.salesId === currentUser.id)} onDelete={(id: string) => {
            setDailyFeedbacks(dailyFeedbacks.filter(f => f.id !== id));
            localStorage.setItem('crm_daily_feedback', JSON.stringify(JSON.parse(localStorage.getItem('crm_daily_feedback') || '[]').filter((f: DailyFeedback) => f.id !== id)));
            void pushKey('crm_daily_feedback');
            // حذف الكومنت من الخط الزمني أيضاً حتى لا يعود للظهور من مصدر آخر
            const all: Client[] = JSON.parse(localStorage.getItem('crm_clients') || '[]');
            let touched = false;
            const next = all.map((c) => {
              const acts = c.activities || [];
              if (!acts.some((a) => a.id === id)) return c;
              touched = true;
              return { ...c, activities: acts.filter((a) => a.id !== id) };
            });
            if (touched) {
              localStorage.setItem('crm_clients', JSON.stringify(next));
              void pushKey('crm_clients');
              loadData();
            }
          }} onAdd={() => setShowAddFeedback(true)} />}
          {activeTab === 'reports' && isSalesView && <ReportsView clients={clients} feedbacks={dailyFeedbacks} reminders={reminders} />}
          {activeTab === 'calculator' && <InstallmentCalculatorView />}
          {activeTab === 'admin-users' && currentUser.role !== 'sales' && <AdminUsersView users={scopedUsers} currentUser={currentUser} onSelect={setSelectedUserFeedback} onAdd={() => setShowAddUser(true)} onEdit={setEditingUser} onDelete={setDeletingUser} onImpersonate={handleImpersonate} />}
          {/* «الفيدباك اليومي لكل سيلز» = لوحة إدارة: تُبنى على مخزون الشركة الكامل،
              لا على نطاق الحساب (وإلا تظهر فاضية لحساب إداري محدود النطاق مثل المطوّر). */}
          {activeTab === 'admin-feedback' && currentUser.role !== 'sales' && <AdminFeedbackView
            users={(currentUser.role === 'admin' ? users : scopedUsers).filter((u: User) => {
              // حساب المطوّر إداري في القاعدة لكنه بيشتغل سيلز — لازم يظهر معاهم
              const role = effectiveRoleOf(u);
              return role === 'sales' || role === 'supervisor';
            })}
            dailyFeedbacks={currentUser.role === 'admin' ? fullFeedbacks : scopedFeedbacks}
            clients={currentUser.role === 'admin' ? fullClients : scopedClients}
            // الأرقام الموزّعة اللي لسه ما اتحولتش لعميل تتحسب برضه في «أرقامه»
            leads={currentUser.role === 'admin' ? fullLeads : assignedLeads}
            callLogs={currentUser.role === 'admin' ? fullCallLogs : scopedCallLogs}
            onSelect={setSelectedUserFeedback}
          />}
          {/* كل عملاء الشركة: العدد + كارت لكل عميل يفتح التفاصيل كاملة */}
          {/* لوحات أرقام الكامبين على المخزون الكامل (fullClients/fullLeads): هي لوحة
              إدارة تدير أرقام الكامبين لكل المندوبين — ما تتأثر بنطاق الحساب.
              أما لوحة السيلز (عملائي/المراحل/الفيدباك) فتبقى بنطاق الحساب وحده. */}
          {activeTab === 'admin-clients' && currentUser.role !== 'sales' && <AdminClientsView
            clients={fullClients}
            leads={fullLeads}
            users={scopedUsers}
            activeForms={activeCampaignForms}
            onSelect={(c: Client) => setSelectedClient(c)}
            onCall={(c: Client) => setCallClient(c)}
            onAdd={() => openAddClient({ source: 'كامبين — إضافة يدوية' })}
            onImport={() => setShowImportClients(true)}
          />}
          {/* شيت الفورمات: كل فورم لوحده مع تصدير أرقامه وفيدباكه العام */}
          {activeTab === 'admin-forms' && currentUser.role !== 'sales' && <AdminFormsSheetView clients={fullClients} leads={fullLeads} />}
          {/* الأرقام الجديدة التي وصلت للمندوب من الكامبينات — الكارت يفتح التفاصيل */}
          {activeTab === 'new-leads' && isSalesView && <NewLeadsViewForSales
            assignedLeads={assignedLeads.filter((l: AssignedLead) =>
              l.salesId === currentUser.id &&
              l.status !== 'closed' &&
              !otherClientPhones.has(phoneKeyOf(l.phone)) &&
              // الرقم بقى عميلاً (تحوّل تلقائياً عند الإسناد) ⇒ يظهر في «عملائي» لا هنا
              !myClientPhones.has(phoneKeyOf(l.phone))
            )}
            onAdd={() => setShowAddAssignedLead(true)}
            onMarkViewed={(id: string) => {
              const target = assignedLeads.find((l: AssignedLead) => l.id === id);
              if (!target || target.status !== 'new') return;
              writeAssignedLeads((all) => all.map((l: AssignedLead) =>
                l.id === id ? { ...l, status: 'viewed' as const, viewedAt: new Date().toISOString() } : l
              ));
            }}
          />}
          {activeTab === 'admin-leads' && currentUser.role !== 'sales' && <AdminLeadsView assignedLeads={fullLeads} users={scopedUsers} currentUser={currentUser} activeForms={activeCampaignForms} onAdd={() => setShowAddAssignedLead(true)} onImport={() => setShowImportLeads(true)} onDelete={(id: string) => {
            // الحذف يقع على القائمة الكاملة المحفوظة لا على المعروض في الذاكرة:
            // الحساب محدود النطاق يحمل أرقامه وحده، والكتابة من نسخته المعروضة
            // كانت تمسح أرقام بقية الفريق من قاعدة البيانات.
            writeAssignedLeads((all) => all.filter((l: AssignedLead) => l.id !== id));
            // العميل التلقائي للرقم ده كمان يتشال — وإلا فضل عند المندوب في «عملائي»
            removeLeadClient(id);
          }} onDeleteMany={(ids: string[]) => {
            const target = new Set(ids);
            writeAssignedLeads((all) => all.filter((l: AssignedLead) => !target.has(l.id)));
            ids.forEach((id: string) => removeLeadClient(id));
          }} onAssign={handleAssignLeads} onSave={() => writeAssignedLeads((all) => all)} autoRules={autoAssignRules} onSaveAutoRule={handleSaveAutoRule} onRebalanceForm={handleRebalanceForm} />}
          {activeTab === 'admin-attendance' && currentUser.role !== 'sales' && <AdminAttendanceView users={scopedUsers} />}
          {activeTab === 'admin-analytics' && currentUser.role !== 'sales' && <AdminAnalyticsView clients={scopedClients} users={scopedUsers} feedbacks={scopedFeedbacks} properties={scopedProperties} reminders={scopedReminders} />}
          {activeTab === 'chat' && isSalesView && <SalesChatView currentUser={currentUser} users={users} messages={messages} onSend={handleSendMessage} onRead={handleMarkRead} readOnly={!!impersonator} />}
          {activeTab === 'admin-chat' && currentUser.role !== 'sales' && <AdminChatView currentUser={currentUser} users={users} messages={messages} onSend={handleSendMessage} onRead={handleMarkRead} onGroupRead={handleMarkGroupRead} />}
          {activeTab === 'admin-settings' && currentUser.role === 'admin' && <AdminSettingsView currentUser={currentUser} />}
        </AnimatePresence>
        </main>
        {isSalesView && (
          <MobileTabBar
            activeTab={activeTab}
            onTab={(id: string) => setActiveTab(id as TabType)}
            onMore={() => setSidebarOpen(true)}
            badge={0}
          />
        )}
        </div>
      </div>

      <AnimatePresence>
        {showAddClient && <AddClientModal currentUser={currentUser} users={users} preset={addClientPreset} onClose={() => setShowAddClient(false)} onSuccess={loadData} />}
        {showAddReminder && <AddReminderModal clients={clients} currentUser={currentUser} onClose={() => setShowAddReminder(false)} onSuccess={loadData} />}
        {showAddProperty && <AddPropertyModal clients={clients} currentUser={currentUser} onClose={() => setShowAddProperty(false)} onSuccess={loadData} />}
        {showAddFeedback && <AddFeedbackModal clients={clients} currentUser={currentUser} preset={feedbackPreset} onClose={() => { setShowAddFeedback(false); setFeedbackPreset(null); }} onSuccess={() => { setFeedbackPreset(null); loadData(); }} />}
        {showAddUser && <AddUserModal currentUser={currentUser} onClose={() => setShowAddUser(false)} onSuccess={loadData} />}
        {showAddTeam && <AddTeamModal users={users} currentUser={currentUser} onClose={() => setShowAddTeam(false)} onSuccess={loadData} />}
        {showAddAssignedLead && <AddAssignedLeadModal users={users} currentUser={currentUser} onClose={() => setShowAddAssignedLead(false)} onSuccess={loadData} />}
        {showImportLeads && <ImportLeadsModal users={users} clients={clients} assignedLeads={assignedLeads} currentUser={currentUser} onClose={() => setShowImportLeads(false)} onSuccess={loadData} />}
        {showImportClients && <ImportClientsModal users={users} clients={fullClients} assignedLeads={fullLeads} currentUser={currentUser} activeForms={activeCampaignForms} onClose={() => setShowImportClients(false)} onSuccess={loadData} />}          {selectedUserFeedback && <UserFeedbackModal
            user={selectedUserFeedback}
            clients={currentUser.role === 'admin' ? fullClients : clients}
            leads={currentUser.role === 'admin' ? fullLeads : assignedLeads}
            callLogs={currentUser.role === 'admin' ? fullCallLogs : callLogs}
            dailyFeedbacks={currentUser.role === 'admin' ? fullFeedbacks : dailyFeedbacks}
            onClose={() => setSelectedUserFeedback(null)}
          />}
        {selectedClient && <ClientDetailModal client={selectedClient} users={users} callLogs={currentUser.role === 'admin' ? fullCallLogs : callLogs} onClose={() => setSelectedClient(null)} onSuccess={loadData} onCall={() => { setCallClient(selectedClient); setSelectedClient(null); }} />}
        {callClient && <CallFlowModal
          client={callClient}
          user={currentUser}
          fromReminder={!!reminderCallId}
          comments={commentsOfTarget(callClient, clients, dailyFeedbacks, callLogs, users)}
          onOpenDetails={(target: any) => {
            const detail = (clients || []).find((x: Client) => String(x.id) === String(target?.id));
            if (!detail) return;
            setCallClient(null);
            setReminderCallId(null);
            setSelectedClient(detail);
          }}
          onClose={() => { setCallClient(null); setReminderCallId(null); }}
          onSave={handleSaveCall}
        />}
        {selectedProperty && <PropertyDetailModal property={selectedProperty} users={users} onClose={() => setSelectedProperty(null)} onSuccess={loadData} />}
        {selectedUser && <UserDetailModal user={selectedUser} currentUser={currentUser} onClose={() => setSelectedUser(null)} onSuccess={loadData} />}
        {selectedTeam && <TeamDetailModal team={selectedTeam} users={users} currentUser={currentUser} onClose={() => setSelectedTeam(null)} onSuccess={loadData} />}
      </AnimatePresence>

      {/* تعديل / حذف حسابات الفريق */}
      <AnimatePresence>
        {editingUser && (
          <EditUserModal
            user={editingUser}
            users={users}
            currentUser={currentUser}
            onClose={() => setEditingUser(null)}
            onSuccess={handleUserUpdated}
          />
        )}
        {deletingUser && (
          <ConfirmDeleteUserModal
            user={deletingUser}
            currentUser={currentUser}
            onClose={() => setDeletingUser(null)}
            onConfirm={(deleteRelatedData: boolean) => {
              handleDeleteUser(deletingUser.id, deleteRelatedData);
              setDeletingUser(null);
            }}
          />
        )}
      </AnimatePresence>

      {/* مركز الإشعارات — مقسَّم على تبويبات (رسائل / اتصالات الفريق).
          التذكيرات مش هنا: بتوصل إشعارًا خارجيًّا على الجهاز في وقتها مرة واحدة.
          و«رقم جديد في الفورم» كمان: إشعار خارجي على جهاز السيلز بس («فريش جديد»). */}
      <AnimatePresence>
        {showNotifyCenter && (
          <NotificationsCenter
            user={currentUser}
            messages={notifMessages}
            callLogs={effectiveRoleOf(currentUser) === 'sales' ? [] : notifCalls}
            unseenIds={unseenNotifIds}
            onSeen={markNotifsSeen}
            onClose={() => setShowNotifyCenter(false)}
            onOpenAlarm={() => { setShowNotifyCenter(false); setShowNotifyPanel(true); }}
            onGo={(tab: TabType) => { setActiveTab(tab); setShowNotifyCenter(false); }}
          />
        )}
      </AnimatePresence>

      {/* نافذة الإشعارات والمنبه */}
      <AnimatePresence>
        {showNotifyPanel && (
          <NotificationsPanel
            user={currentUser}
            notifState={notifState}
            setNotifState={setNotifState}
            settings={alarmSettings}
            onSaveSettings={handleAlarmSettings}
            busy={notifBusy}
            setBusy={setNotifBusy}
            message={notifMessage}
            setMessage={setNotifMessage}
            onClose={() => setShowNotifyPanel(false)}
          />
        )}
      </AnimatePresence>

      {/* بند ٤: صفحة كل الأرقام في حالة واحدة */}
      <AnimatePresence>
        {statusBoard && (
          <StatusBoardView
            statusId={statusBoard}
            users={scopedUsers}
            numbers={workNumbers}
            leads={assignedLeads}
            alertMap={alertMap}
            nextActionMap={nextActionMap}
            currentUser={currentUser}
            onSetStage={handleUpdateClientStage}
            onRefresh={loadData}
            onCall={(c: any) => setCallClient(c)}
            onLeadViewed={(id: string) => {
              const target = assignedLeads.find((l: AssignedLead) => l.id === id);
              if (!target || target.status !== 'new') return;
              writeAssignedLeads((all) => all.map((l: AssignedLead) =>
                l.id === id ? { ...l, status: 'viewed' as const, viewedAt: new Date().toISOString() } : l
              ));
            }}
            onClose={() => setStatusBoard(null)}
            onSelect={(c: Client) => { setStatusBoard(null); setSelectedClient(c); }}
          />
        )}
      </AnimatePresence>

      {/* أنيميشن الدخول — يُرسم عبر Portal ويُزيل نفسه بنفسه.
          لا نضعه داخل AnimatePresence: الحركة داخل Portal، فلا يراها الـ AnimatePresence
          ولا يحذف العنصر بعد انتهاء الخروج — فيبقى طبقة بيضاء/شفافة فوق الشاشة تمنع كل
          اللمسات (كانت هي سبب «الشاشة البيضاء» و«الموقع مش بيستجيب» على الهاتف). */}
      {loginAnimation && <LoginTransition user={loginAnimation} onDone={() => setLoginAnimation(null)} />}
    </motion.div>
  );
}

// حفظ إعدادات المنبه (موجودة خارج المكوّن ليستدعيها زر الحفظ)
function handleAlarmSettings(settings: AlarmSettings): void {
  saveAlarmSettings(settings);
}

// ===== الشات الداخلي (الإدارة ↔ كل سيلز) =====
// محادثة خاصة بين كل سيلز والإدارة. السيلز لا يرى إلا محادثته، والإدارة ترى الجميع.
// otherIds = الطرف الآخر: سيلز واحد في محادثة الإدارة، وأي حساب إدارة في محادثة السيلز
function ChatThread({ me, otherIds, messages, onSend, emptyHint, disabledReason, disabled, groupId }: any) {
  const [text, setText] = useState('');
  const endRef = useRef<HTMLDivElement | null>(null);

  const counterparty = new Set<string>(otherIds || []);
  // groupId: غرفة مشتركة — أي رسالة موجّهة للغرفة ومن أي عضو تظهر للجميع
  const thread = messages
    .filter((m: ChatMessage) =>
      groupId
        ? m.toId === groupId
        : (m.fromId === me.id && counterparty.has(m.toId)) || (counterparty.has(m.fromId) && m.toId === me.id)
    )
    .sort((a: ChatMessage, b: ChatMessage) => a.createdAt.localeCompare(b.createdAt));

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [thread.length]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const target = groupId || (otherIds || [])[0];
    if (!text.trim() || !target) return;
    onSend(text, target);
    setText('');
  };

  if (!groupId && !(otherIds || []).length) {
    return (
      <div className="p-10 text-center text-sm text-[var(--text-muted)]">
        {disabledReason || 'المحادثة غير متاحة حالياً'}
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      <div className="h-[60vh] min-h-64 lg:h-[52vh] overflow-y-auto p-4 space-y-3">
        {thread.length === 0 && (
          <div className="text-center py-16 text-sm text-[var(--text-dim)]">{emptyHint}</div>
        )}

        {thread.map((m: ChatMessage) => {
          const mine = m.fromId === me.id;
          return (
            <div key={m.id} className={`flex ${mine ? 'justify-start' : 'justify-end'}`}>
              <div
                className={`max-w-[80%] rounded-[var(--r-xl)] px-4 py-2.5 text-sm leading-relaxed border ${
                  mine
                    ? 'bg-[var(--brand-fill)] text-[var(--on-brand)] border-[var(--brand-primary-soft)] rounded-tr-sm'
                    : 'bg-[var(--tint-2)] text-[var(--text-strong)] border-[var(--border)] rounded-tl-sm'
                }`}
              >
                {!mine && groupId && (
                  <span className="block text-[10px] font-bold mb-0.5 opacity-80">{m.fromName || 'عضو'}</span>
                )}
                <p className="whitespace-pre-wrap break-words">{m.text}</p>
                <span
                  className={`block text-[10px] mt-1 ${
                    mine ? 'text-[var(--on-brand)]' : 'text-[var(--text-muted)]'
                  }`}
                >
                  {chatTime(m.createdAt)}
                  {mine &&
                    (groupId
                      ? (m.readBy || []).filter((id: string) => id !== me.id).length > 0
                        ? ' • اطلع عليها أحد المدراء ✓✓'
                        : ' • أُرسلت ✓'
                      : m.readAt
                      ? ' • تم القراءة ✓✓'
                      : ' • أُرسلت ✓')}
                </span>
              </div>
            </div>
          );
        })}
        <div ref={endRef} />
      </div>

      <form onSubmit={submit} className="border-t border-[var(--border)] p-2.5 sm:p-3 flex items-center gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={disabled ? 'الإرسال معطّل أثناء التصفح' : 'اكتب رسالتك...'}
          disabled={disabled}
          className="flex-1 min-w-0 bg-[var(--tint-1)] border border-[var(--border)] rounded-[var(--r-md)] px-3 sm:px-4 py-2.5 sm:py-3 text-[var(--text-strong)] text-sm focus:border-[var(--brand)] disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={disabled || !text.trim()}
          title="إرسال"
          className="gradient-primary text-[var(--text-strong)] p-2.5 sm:px-5 sm:py-3 rounded-[var(--r-md)] font-bold text-sm disabled:opacity-40 flex items-center gap-2 whitespace-nowrap shrink-0"
        >
          <Send className="w-4 h-4" />
          <span className="hidden sm:inline">إرسال</span>
        </button>
      </form>
    </div>
  );
}

// محادثة السيلز: لكل حساب إدارة محادثة خاصة على حدة (CEO أو Team Leader)
// وأي حساب إدارة جديد يُضاف تظهر له محادثة تلقائياً مع كل السيلز.
// readOnly = الإدارة تتصفح محادثة السيلز من داخل حسابه:
// لا تُعلَّم رسائله كمقروءة حتى لا تفوته، وممنوع الإرسال نيابةً عنه.
function SalesChatView({ currentUser, users, messages, onSend, onRead, readOnly }: any) {
  const [openId, setOpenId] = useState<string | null>(null);
  const isMobile = useIsMobile();
  const [threadOpen, setThreadOpen] = useState(false);

  // كل حسابات الإدارة المفعّلة — كل واحد محادثة مستقلة
  const managers = (users || []).filter((u: User) => isManagerAccount(u) && u.isActive);
  const selected = managers.find((u: User) => u.id === openId) || managers[0] || null;

  const threadWith = (otherId: string) =>
    messages.filter(
      (m: ChatMessage) =>
        (m.fromId === currentUser.id && m.toId === otherId) || (m.fromId === otherId && m.toId === currentUser.id)
    );
  const unreadFrom = (otherId: string) =>
    messages.filter((m: ChatMessage) => m.fromId === otherId && m.toId === currentUser.id && !m.readAt).length;

  // أول ما تُفتح محادثة مدير تُعلَّم رسائله كمقروءة
  const unreadIds = selected
    ? messages
        .filter((m: ChatMessage) => m.fromId === selected.id && m.toId === currentUser.id && !m.readAt)
        .map((m: ChatMessage) => m.id)
    : [];
  useEffect(() => {
    if (!readOnly && unreadIds.length) onRead(unreadIds);
  }, [unreadIds.join('|'), readOnly]);

  const visible = threadOpen || !isMobile ? selected : null;

  if (!managers.length) {
    return (
      <div className="panel p-12 text-center">
        <MessageCircle className="w-14 h-14 text-[var(--text-dim)] mx-auto mb-3" />
        <p className="text-[var(--text-muted)]">لا يوجد حساب إدارة في النظام بعد</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {readOnly && (
        <div className="rounded-[var(--r-md)] border border-amber-400/40 bg-amber-500/10 px-4 py-3 text-xs text-amber-200">
           أنت تتصفّح محادثة <span className="font-bold">{currentUser.name}</span> من حساب الإدارة —
          الإرسال معطّل والرسائل لا تُعلَّم كمقروءة، حتى لا تفوت رسائل على السيلز.
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-xl font-bold gradient-text flex items-center gap-2">
            <MessageCircle className="w-5 h-5 text-[var(--brand)]" /> المحادثة
          </h2>
          <p className="text-xs text-[var(--text-muted)] mt-1">
            محادثة خاصة مع كل حساب من حسابات الإدارة ({managers.length}) — الرسائل تصل خلال ثوانٍ
          </p>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
        {/* قائمة حسابات الإدارة */}
        <div className={`panel overflow-hidden ${threadOpen ? 'hidden lg:block' : ''}`}>
          <div className="max-h-[60vh] lg:max-h-[56vh] overflow-y-auto divide-y divide-[var(--border)]">
            {managers.map((mgr: User) => {
              const convo = threadWith(mgr.id);
              const last = convo[convo.length - 1];
              const unread = unreadFrom(mgr.id);
              const isOpen = selected?.id === mgr.id;
              return (
                <button
                  key={mgr.id}
                  onClick={() => { setOpenId(mgr.id); setThreadOpen(true); }}
                  className={`w-full text-right p-3.5 flex items-center gap-3 transition-colors ${isOpen ? 'bg-[var(--brand-primary-softer)]' : 'hover:bg-[var(--tint-1)]'}`}>
                  <div className={`w-11 h-11 rounded-full flex items-center justify-center shrink-0 ${unread ? 'bg-[var(--brand)]' : 'bg-[var(--tint-2)]'}`}>
                    <span className={`font-bold ${unread ? 'text-[var(--text-strong)]' : 'text-[var(--text)]'}`}>{mgr.name[0]}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-bold text-[var(--text-strong)] text-sm truncate">{mgr.name}</span>
                      {last && <span className="text-[10px] text-[var(--text-dim)] whitespace-nowrap">{chatTime(last.createdAt)}</span>}
                    </div>
                    <div className="flex items-center justify-between gap-2 mt-0.5">
                      <span className="text-[10.5px] text-[var(--text-dim)]">{chatRank(mgr)}</span>
                      {unread > 0 && (
                        <span className="min-w-5 h-5 px-1.5 bg-red-500 rounded-full text-[10px] flex items-center justify-center font-bold text-white shrink-0">
                          {unread > 9 ? '9+' : unread}
                        </span>
                      )}
                    </div>
                    <span className="block text-[11px] text-[var(--text-muted)] truncate mt-0.5">
                      {last ? `${last.fromId === currentUser.id ? 'أنت: ' : ''}${last.text}` : 'لا توجد رسائل بعد'}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* المحادثة المفتوحة */}
        <div className={`panel overflow-hidden ${!threadOpen ? 'hidden lg:block' : ''}`}>
          {visible ? (
            <>
              <div className="flex items-center gap-3 p-4 border-b border-[var(--border)] bg-[var(--tint-1)]">
                <button
                  onClick={() => setThreadOpen(false)}
                  title="رجوع إلى قائمة حسابات الإدارة"
                  className="lg:hidden p-2 -ms-1 bg-[var(--tint-2)] rounded-[var(--r-sm)] hover:bg-[var(--tint-3)] transition-colors shrink-0">
                  <ArrowRight className="w-4 h-4 text-[var(--text-strong)]" />
                </button>
                <div className="w-11 h-11 gradient-primary rounded-full flex items-center justify-center shrink-0">
                  <Shield className="w-5 h-5 text-[var(--text-strong)]" />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-bold text-[var(--text-strong)] truncate">{visible.name}</h3>
                  <p className="text-[11px] text-[var(--text-muted)]">{chatRank(visible)} — محادثة خاصة</p>
                </div>
              </div>
              <ChatThread
                me={currentUser}
                otherIds={[visible.id]}
                messages={messages}
                onSend={onSend}
                disabled={readOnly}
                emptyHint={`لا توجد رسائل بينك وبين ${visible.name} بعد — اكتب أول رسالة.`}
              />
            </>
          ) : (
            <div className="p-12 text-center text-sm text-[var(--text-muted)]">اختر حساباً من القائمة لبدء المحادثة</div>
          )}
        </div>
      </div>

      <p className="text-[11px] text-[var(--text-dim)] text-center">
        * لكل حساب إدارة محادثة خاصة معك على حدة، وأي حساب إدارة جديد يُضاف تظهر له محادثة مع كل السيلز تلقائياً.
      </p>
    </div>
  );
}

// محادثات الإدارة: قائمة بكل السيلز + عداد الرسائل الجديدة لكل واحد
// يتابع إن كانت الشاشة صغيرة (موبايل/تابلت) — يُستخدم لعرض المحادثات على صفحتين
// (القائمة ثم المحادثة بزر رجوع) مثل تطبيقات الشات على الهاتف.
function useIsMobile(breakpoint = 1024) {
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth < breakpoint : false
  );
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${breakpoint - 1}px)`);
    const onChange = () => setIsMobile(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [breakpoint]);
  return isMobile;
}

function AdminChatView({ currentUser, users, messages, onSend, onRead, onGroupRead }: any) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const isMobile = useIsMobile();
  // على الموبايل: القائمة أولاً، ثم تفتح المحادثة ملء الشاشة مع زر رجوع
  const [threadOpen, setThreadOpen] = useState(false);
  // غرفة المدراء مفتوحة افتراضياً في أول القائمة
  const [groupOpen, setGroupOpen] = useState(false);

  // «إداري» بالمعنى السلوكي: حساب المطوّر (إداري في القاعدة، سيلز في الشغل)
  // يُعامل سيلزاً فيظهر في المحادثات مع بقية الفريق.
  const people = (users || []).filter((u: User) => effectiveRoleOf(u) !== 'admin');
  const searchQuery = normalizeArabicText(query).trim();
  const filtered = people.filter((u: User) => !searchQuery || normalizeArabicText(u.name).includes(searchQuery));

  // غرفة المدراء: كل حسابات الإدارة المفعّلة (أي حساب جديد يدخلها تلقائياً)
  const managers = (users || []).filter((u: User) => isManagerAccount(u) && u.isActive);
  const groupMessages = messages.filter((m: ChatMessage) => m.toId === MANAGERS_GROUP_ID);
  const groupUnread = groupMessages.filter(
    (m: ChatMessage) => m.fromId !== currentUser.id && !(m.readBy || []).includes(currentUser.id)
  ).length;
  const groupLast = groupMessages[groupMessages.length - 1];
  useEffect(() => {
    if (!groupOpen) return;
    const ids = groupMessages
      .filter((m: ChatMessage) => m.fromId !== currentUser.id && !(m.readBy || []).includes(currentUser.id))
      .map((m: ChatMessage) => m.id);
    if (ids.length) onGroupRead?.(ids);
  }, [groupOpen, groupMessages.map((m: ChatMessage) => m.id + (m.readBy || []).length).join('|')]);

  const conversationWith = (otherId: string) =>
    messages.filter(
      (m: ChatMessage) =>
        (m.fromId === currentUser.id && m.toId === otherId) || (m.fromId === otherId && m.toId === currentUser.id)
    );

  const unreadFrom = (otherId: string) =>
    messages.filter((m: ChatMessage) => m.fromId === otherId && m.toId === currentUser.id && !m.readAt).length;

  // على الموبايل لا نفتح أي محادثة تلقائياً (حتى لا تُعلَّم رسائل لم يقرأها المدير)
  const selected = !groupOpen && (threadOpen || !isMobile)
    ? people.find((u: User) => u.id === selectedId) || people[0] || null
    : null;

  // تعليم رسائل المحادثة المفتوحة كمقروءة
  const unreadIds = selected
    ? messages.filter((m: ChatMessage) => m.fromId === selected.id && m.toId === currentUser.id && !m.readAt).map((m: ChatMessage) => m.id)
    : [];
  useEffect(() => {
    if (unreadIds.length) onRead(unreadIds);
  }, [unreadIds.join('|')]);

  const totalUnread = groupUnread + messages.filter((m: ChatMessage) => m.toId === currentUser.id && !m.readAt).length;

  // لا يوجد سيلز بعد؟ تبقى غرفة المدراء متاحة — فالغرفة لا تعتمد على وجود مندوبين
  const noPeople = !people.length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold gradient-text flex items-center gap-2">
            <MessageCircle className="w-5 h-5 text-[var(--brand)]" /> المحادثات
          </h2>
          <p className="text-xs text-[var(--text-muted)] mt-1">
            محادثة خاصة مع كل سيلز + غرفة المدراء • رسائل جديدة: <span className="text-red-400 font-bold">{totalUnread}</span>
          </p>
        </div>
        <div className="relative">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-muted)]" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="ابحث باسم السيلز..."
            className="w-full sm:w-56 bg-[var(--tint-1)] border border-[var(--border)] rounded-[var(--r-md)] pr-9 pl-3 py-2.5 text-[var(--text-strong)] text-sm"
          />
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
        {/* قائمة الأشخاص */}
        <div className={`panel overflow-hidden ${threadOpen || groupOpen ? 'hidden lg:block' : ''}`}>
          {/* غرفة المدراء: كل حساب إدارة — الحالي والذي يُضاف لاحقاً — عضو فيها تلقائياً */}
          <button
            onClick={() => { setGroupOpen(true); setThreadOpen(false); }}
            className={`w-full text-right p-3.5 flex items-center gap-3 transition-colors border-b border-[var(--border)] ${groupOpen ? 'bg-[var(--brand-primary-softer)]' : 'hover:bg-[var(--tint-1)]'}`}>
            <div className={`w-11 h-11 rounded-full flex items-center justify-center shrink-0 ${groupUnread ? 'gradient-primary' : 'bg-[var(--tint-2)]'}`}>
              <Users className={`w-5 h-5 ${groupUnread ? 'text-[var(--text-strong)]' : 'text-[var(--text)]'}`} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2">
                <span className="font-bold text-[var(--text-strong)] text-sm truncate">{MANAGERS_GROUP_NAME}</span>
                {groupLast && <span className="text-[10px] text-[var(--text-dim)] whitespace-nowrap">{chatTime(groupLast.createdAt)}</span>}
              </div>
              <div className="flex items-center justify-between gap-2 mt-0.5">
                <span className="text-[10.5px] text-[var(--text-dim)]">{managers.length} من المدراء</span>
                {groupUnread > 0 && (
                  <span className="min-w-5 h-5 px-1.5 bg-red-500 rounded-full text-[10px] flex items-center justify-center font-bold text-white shrink-0">
                    {groupUnread > 9 ? '9+' : groupUnread}
                  </span>
                )}
              </div>
              <span className="block text-[11px] text-[var(--text-muted)] truncate mt-0.5">
                {groupLast ? `${groupLast.fromId === currentUser.id ? 'أنت: ' : `${groupLast.fromName}: `}${groupLast.text}` : 'لا توجد رسائل بعد'}
              </span>
            </div>
          </button>
          <div className="max-h-[65vh] lg:max-h-[58vh] overflow-y-auto divide-y divide-[var(--border)]">
            {noPeople && <p className="p-6 text-center text-sm text-[var(--text-dim)]">لا يوجد حسابات سيلز بعد</p>}
            {!noPeople && filtered.length === 0 && <p className="p-6 text-center text-sm text-[var(--text-dim)]">لا يوجد نتائج مطابقة</p>}
            {filtered.map((person: User) => {
              const convo = conversationWith(person.id);
              const last = convo[convo.length - 1];
              const unread = unreadFrom(person.id);
              const isOpen = selected?.id === person.id;
              return (
                <button
                  key={person.id}
                  onClick={() => { setSelectedId(person.id); setThreadOpen(true); setGroupOpen(false); }}
                  className={`w-full text-right p-3.5 flex items-center gap-3 transition-colors ${
                    isOpen ? 'bg-[var(--brand-primary-softer)]' : 'hover:bg-[var(--tint-1)]'
                  }`}
                >
                  <div className={`w-11 h-11 rounded-full flex items-center justify-center shrink-0 ${unread ? 'bg-[var(--brand)]' : 'bg-[var(--tint-2)]'}`}>
                    <span className={`font-bold ${unread ? 'text-[var(--text-strong)]' : 'text-[var(--text)]'}`}>{person.name[0]}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-bold text-[var(--text-strong)] text-sm truncate">{person.name}</span>
                      {last && <span className="text-[10px] text-[var(--text-dim)] whitespace-nowrap">{chatTime(last.createdAt)}</span>}
                    </div>
                    <div className="flex items-center justify-between gap-2 mt-0.5">
                      <span className="text-[10.5px] text-[var(--text-dim)] truncate">{chatRank(person)}</span>
                      {unread > 0 && (
                        <span className="min-w-5 h-5 px-1.5 bg-red-500 rounded-full text-[10px] flex items-center justify-center font-bold text-white shrink-0">
                          {unread > 9 ? '9+' : unread}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center justify-between gap-2 mt-0.5">
                      <span className="text-[11px] text-[var(--text-muted)] truncate">
                        {last ? `${last.fromId === currentUser.id ? 'أنت: ' : ''}${last.text}` : 'لا توجد رسائل بعد'}
                      </span>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* المحادثة المفتوحة */}
        <div className={`panel overflow-hidden ${!threadOpen && !groupOpen ? 'hidden lg:block' : ''}`}>
          {groupOpen ? (
            <>
              <div className="flex items-center gap-3 p-4 border-b border-[var(--border)] bg-[var(--tint-1)]">
                <button
                  onClick={() => setGroupOpen(false)}
                  title="رجوع إلى القائمة"
                  className="lg:hidden p-2 -ms-1 bg-[var(--tint-2)] rounded-[var(--r-sm)] hover:bg-[var(--tint-3)] transition-colors shrink-0">
                  <ArrowRight className="w-4 h-4 text-[var(--text-strong)]" />
                </button>
                <div className="w-11 h-11 gradient-primary rounded-full flex items-center justify-center shrink-0">
                  <Users className="w-5 h-5 text-[var(--text-strong)]" />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-bold text-[var(--text-strong)] truncate">{MANAGERS_GROUP_NAME}</h3>
                  <p className="text-[11px] text-[var(--text-muted)]">
                    محادثة جماعية لكل المدراء ({managers.length}) — أي حساب إدارة جديد يُضاف يدخلها تلقائياً
                  </p>
                </div>
              </div>
              <ChatThread
                me={currentUser}
                otherIds={managers.map((m: User) => m.id)}
                groupId={MANAGERS_GROUP_ID}
                messages={messages}
                onSend={onSend}
                emptyHint="غرفة المدراء فارغة — اكتب أول رسالة للفريق الإداري."
              />
            </>
          ) : selected ? (
            <>
              <div className="flex items-center gap-3 p-4 border-b border-[var(--border)] bg-[var(--tint-1)]">
                <button
                  onClick={() => setThreadOpen(false)}
                  title="رجوع إلى قائمة السيلز"
                  className="lg:hidden p-2 -ms-1 bg-[var(--tint-2)] rounded-[var(--r-sm)] hover:bg-[var(--tint-3)] transition-colors shrink-0"
                >
                  <ArrowRight className="w-4 h-4 text-[var(--text-strong)]" />
                </button>
                <div className="w-11 h-11 gradient-primary rounded-full flex items-center justify-center shrink-0">
                  <span className="text-[var(--text-strong)] font-bold">{selected.name[0]}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-bold text-[var(--text-strong)] truncate">{selected.name}</h3>
                  <p className="text-[11px] text-[var(--text-muted)]">
                    {chatRank(selected)}
                    {selected.username ? ` • @${selected.username}` : ''}
                  </p>
                </div>
              </div>
              <ChatThread
                me={currentUser}
                otherIds={[selected.id]}
                messages={messages}
                onSend={onSend}
                emptyHint={`لا توجد رسائل بينك وبين ${selected.name} بعد — اكتب أول رسالة.`}
              />
            </>
          ) : (
            <div className="p-12 text-center text-sm text-[var(--text-muted)]">اختر شخصاً من القائمة لبدء المحادثة</div>
          )}
        </div>
      </div>

      <p className="text-[11px] text-[var(--text-dim)] text-center">
        * كل سيلز يرى محادثته مع الإدارة فقط ولا يرى محادثات غيره، والرسائل تُزامَن بين كل الأجهزة تلقائياً.
      </p>
    </div>
  );
}

// تبويبات القائمة الجانبية — كل تبويب له مهمة واحدة، مقسّمة في مجموعات واضحة
type NavItem = { id: TabType; icon: typeof Home; label: string };
type NavGroup = { label: string; items: NavItem[]; section?: string };

function getTabGroups(role: string, developer = false): NavGroup[] {
  const salesGroups: NavGroup[] = [
    {
      label: 'لوحة العمل',
      items: [
        { id: 'dashboard', icon: Home, label: 'الرئيسية' },
        // «العملاء» = الأرقام اللي أضافها السيلز بنفسه فقط (مش أرقام الكامبين)
        { id: 'clients', icon: Users, label: 'عملائي' },
      ],
    },
    {
      label: 'العقارات',
      items: [{ id: 'properties', icon: Building2, label: 'العقارات' }],
    },
    {
      label: 'المتابعة',
      items: [
        // التذكيرات ما بقاش لها تبويب: بقيت إشعار + شارة برتقالية على الجرس
        // والفيدباك: كومنتاته بتظهر جوّه نافذة الإجراء على كل رقم
        { id: 'chat', icon: MessagesSquare, label: 'المحادثة' },
        { id: 'reports', icon: BarChart3, label: 'التقارير' },
        { id: 'pipeline', icon: Workflow, label: 'المراحل' },
        { id: 'calculator', icon: Calculator, label: 'حساب المقدم والأقساط' },
      ],
    },
  ];

  const adminGroups: NavGroup[] = [
    {
      label: 'لوحة الإدارة',
      items: [
        { id: 'admin-users', icon: UserCheck, label: 'فريق العمل' },
        { id: 'admin-attendance', icon: Clock, label: 'الحضور' },
        { id: 'admin-analytics', icon: LineChart, label: 'التحليلات' },
      ],
    },
    {
      label: 'متابعة العمل',
      items: [
        // كل عملاء الشركة وعددهم في تبويب واحد، والكارت يفتح التفاصيل
        { id: 'admin-clients', icon: Users, label: 'عملاء كامبين' },
        // شيت الفورمات: كل فورم لوحده وأرقامه وفيدباكه العام في ملف Excel
        { id: 'admin-forms', icon: FileText, label: 'شيت الفورمات' },
        { id: 'pipeline', icon: Workflow, label: 'المراحل' },
        { id: 'calculator', icon: Calculator, label: 'حساب المقدم والأقساط' },
        { id: 'admin-leads', icon: Share2, label: 'توزيع الأرقام' },
        { id: 'admin-feedback', icon: ClipboardList, label: 'الفيدباك اليومي' },
        { id: 'admin-chat', icon: MessagesSquare, label: 'المحادثات' },
      ],
    },
    {
      label: 'المخزون والنظام',
      items: [
        { id: 'properties', icon: Building2, label: 'العقارات' },
        { id: 'admin-settings', icon: Settings, label: 'الإعدادات' },
      ],
    },
  ];

  // قائد الفريق (Team Leader) يرى لوحة الإدارة الخاصة بفريقه بدون أدوات النظام العامة
  if (role === 'supervisor') {
    return [
      {
        label: 'لوحة الفريق',
        items: [
          { id: 'admin-users', icon: UserCheck, label: 'فريقي' },
          { id: 'admin-attendance', icon: Clock, label: 'الحضور' },
          { id: 'admin-analytics', icon: LineChart, label: 'التحليلات' },
        ],
      },
      {
        label: 'متابعة العمل',
        items: [
          { id: 'admin-clients', icon: Users, label: 'عملاء كامبين' },
          { id: 'admin-forms', icon: FileText, label: 'شيت الفورمات' },
          { id: 'pipeline', icon: Workflow, label: 'المراحل' },
          { id: 'calculator', icon: Calculator, label: 'حساب المقدم والأقساط' },
          { id: 'admin-leads', icon: Share2, label: 'توزيع الأرقام' },
          { id: 'admin-feedback', icon: ClipboardList, label: 'الفيدباك اليومي' },
          { id: 'admin-chat', icon: MessagesSquare, label: 'المحادثات' },
        ],
      },
      {
        label: 'المخزون',
        items: [{ id: 'properties', icon: Building2, label: 'العقارات' }],
      },
    ];
  }

  // حساب المطوّر: قوائم السيلز أولاً ثم قوائم الإدارة (بلا تكرار التبويب نفسه)،
  // مع عنوان قسم واضح فوق كل مجموعة.
  if (developer) {
    const seen = new Set<TabType>();
    const merged: NavGroup[] = [];
    const addSection = (groups: NavGroup[], section: string) => {
      for (const group of groups) {
        const items = group.items.filter((item) => !seen.has(item.id));
        items.forEach((item) => seen.add(item.id));
        if (items.length) merged.push({ ...group, section, items });
      }
    };
    addSection(salesGroups, 'قوائم السيلز');
    addSection(adminGroups, 'قوائم الادارة');
    return merged;
  }

  return role === 'sales' ? salesGroups : adminGroups;
}

// ===== آخر صفحة فتحها كل مستخدم =====
// بلا هذا، كل ريفريش (أو فتح للموقع من جديد) يرجع للرئيسية ويضيّع مكانه.
// المفتاح لكل حساب على حدة، والقيمة تُفحص مقابل تبويبات دوره: لو كان محفوظاً
// تبويب لم يعد مسموحاً (تغيّرت الصلاحية مثلاً) نرجع للافتراضي بدل شاشة فاضية.
const tabKeyOf = (userId: string) => `crm_active_tab_${userId}`;

// كل تبويب ممكن يفتحه الدور: تبويبات القائمة الجانبية + تبويبات بتفتح من كارت
// جوه صفحة تانية من غير زر في القائمة (مثل «الأرقام الجديدة» للسيلز).
// بلا القايمة الزيادة دي، أي تبويب من النوع ده كان بيتقفل فوراً وينط للرئيسية.
const EXTRA_TABS: Record<string, TabType[]> = { sales: ['new-leads'] };

function isTabAllowed(role: string, tab: string, developer = false): boolean {
  const inNav = getTabGroups(role, developer).some((group) => group.items.some((item) => item.id === tab));
  return inNav || (EXTRA_TABS[role] || []).includes(tab as TabType);
}

function startTabFor(user: User): TabType {
  const fallback: TabType = user.role === 'sales' || worksAsSales(user) ? 'dashboard' : 'admin-users';
  try {
    const saved = localStorage.getItem(tabKeyOf(user.id));
    if (!saved) return fallback;
    return isTabAllowed(user.role, saved, worksAsSales(user)) ? (saved as TabType) : fallback;
  } catch {
    return fallback;
  }
}

// Animated screen shown right after a successful login (admin & sales)
function LoginTransition({ user, onDone }: { user: User; onDone: () => void }) {
  const [done, setDone] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const isAdmin = user.role !== 'sales';

  // بعد اكتمال الشريط: لحظة تأكيد قصيرة ثم تلاشٍ ثم إزالة من الشجرة
  useEffect(() => {
    if (!done) return;
    const timer = setTimeout(() => setLeaving(true), 700);
    return () => clearTimeout(timer);
  }, [done]);

  useEffect(() => {
    if (!leaving) return;
    const timer = setTimeout(onDone, 320);
    return () => clearTimeout(timer);
  }, [leaving, onDone]);

  // شبكة أمان: تبويب في الخلفية أو «تقليل الحركة» يمنع اكتمال حركة الشريط،
  // فلا تبقى شاشة الدخول عالقة إلى الأبد.
  useEffect(() => {
    const timer = setTimeout(() => setLeaving(true), 5000);
    return () => clearTimeout(timer);
  }, []);

  const accent = isAdmin
    ? { icon: Shield, ring: 'border-[var(--brand-primary-soft)]', text: 'text-[var(--text-muted)]' }
    : { icon: UserCheck, ring: 'border-[var(--brand-primary-soft)]', text: 'text-[var(--brand)]' };
  const Icon = accent.icon;

  // نعرض الشاشة عبر Portal حتى لا تتأثر بأنيميشن الدخول للجذر (transform)
  return createPortal(
    <motion.div
      initial={{ opacity: 0 }}
      animate={leaving ? { opacity: 0, scale: 1.06 } : { opacity: 1, scale: 1 }}
      transition={{ duration: 0.3 }}
      aria-hidden={leaving}
      /* pointer-events-none دائماً: الطبقة دي زخرفة فقط، وما تبقطش أي لمسة
         على الشاشة تحتها — حتى لو اتأخرت إزالتها، الموقع يفضل شغّال. */
      className="app-root fixed inset-0 z-[200] flex items-center justify-center overflow-hidden pointer-events-none"
      dir="rtl"
    >

      <div className="relative z-10 flex flex-col items-center text-center px-6">
        <div className="relative w-28 h-28 mb-8">
          {[0, 0.45, 0.9].map((delay) => (
            <motion.span
              key={delay}
              className={`absolute inset-0 rounded-full border-2 ${accent.ring}`}
              initial={{ scale: 1, opacity: 0.7 }}
              animate={{ scale: 2.2, opacity: 0 }}
              transition={{ duration: 1.8, repeat: Infinity, delay, ease: 'easeOut' }}
            />
          ))}
          <motion.div
            initial={{ scale: 0.4, rotate: -180, opacity: 0 }}
            animate={{ scale: 1, rotate: 0, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 160, damping: 14 }}
            className="w-28 h-28 rounded-full bg-[var(--brand-fill)] flex items-center justify-center"
          >
            <AnimatePresence mode="wait">
              {done ? (
                <motion.span
                  key="check"
                  initial={{ scale: 0, rotate: -90 }}
                  animate={{ scale: 1, rotate: 0 }}
                  transition={{ type: 'spring', stiffness: 220, damping: 12 }}
                >
                  <Check className="w-14 h-14 text-[var(--text-strong)]" />
                </motion.span>
              ) : (
                <motion.span
                  key="icon"
                  animate={{ scale: [1, 1.12, 1] }}
                  transition={{ duration: 1.2, repeat: Infinity, ease: 'easeInOut' }}
                >
                  <Icon className="w-14 h-14 text-[var(--text-strong)]" />
                </motion.span>
              )}
            </AnimatePresence>
          </motion.div>
        </div>

        <motion.h1
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="text-3xl sm:text-4xl font-bold gradient-text mb-3"
        >
          {done ? 'تم تسجيل الدخول' : `مرحباً ${user.developer ? 'مطور النظام' : user.name}`}
        </motion.h1>

        <motion.p
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.35 }}
          className="text-[var(--text-muted)] mb-8"
        >
          {done
            ? 'جارٍ فتح النظام...'
            : isAdmin
            ? 'جارٍ تحضير لوحة تحكم الإدارة...'
            : 'جارٍ تحضير مساحة العمل...'}
        </motion.p>

        <div className="w-64 h-1.5 bg-[var(--tint-2)] rounded-full overflow-hidden">
          <motion.div
            className="h-full bg-[var(--brand-fill)] rounded-full"
            initial={{ width: '0%' }}
            animate={{ width: '100%' }}
            transition={{ duration: 1.5, ease: 'easeInOut' }}
            onAnimationComplete={() => setDone(true)}
          />
        </div>

        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.6 }}
          className={`mt-4 text-xs ${accent.text}`}
        >
          {isAdmin ? 'صلاحيات الإدارة الكاملة مفعّلة' : `حساب سيلز - ${user.username}`}
        </motion.p>
      </div>
    </motion.div>,
    document.body
  );
}

// Login Screen
// الدخول يمر بـ /api/auth **على السيرفر** — لا مقارنة كلمة مرور في المتصفح.
// هذا هو الفرق الجوهري: من يعرف رابط الموقع يحصل على شاشة دخول فقط،
// وبلا كلمة مرور صحيحة لا تُقدَّم له أي بيانات (٤٠١ من السيرفر).
function LoginScreen({ onLogin, initialNotice = '' }: { onLogin: (user: User) => void; initialNotice?: string }) {
  // ملاحظة: لا يوجد في المتصفح أي تحقق من كلمة المرور — كل دخول يمرّ بالسيرفر
  // (/api/auth)، فلا يُفيد تعديل كود الصفحة من Inspect في تسجيل دخول أو استخراج بيانات.
  const [loginType, setLoginType] = useState<'admin' | 'sales' | null>(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(initialNotice);
  const [loading, setLoading] = useState(false);
  const [shake, setShake] = useState(false);

  useEffect(() => {
    initializeSystem();
  }, []);

  // بعد نجاح الدخول: نُضيف الحساب لقائمة المستخدمين على هذا الجهاز
  // (حتى لا يخرج التطبيق نفسه لعدم وجود بيانات محلية قبل أول مزامنة) ثم نفتح المزامنة
  const finishLogin = (user: User) => {
    try {
      const store: User[] = JSON.parse(localStorage.getItem('crm_users') || '[]');
      localStorage.setItem('crm_users', JSON.stringify([...store.filter((u) => u.id !== user.id), user]));
    } catch {
      /* لا شيء */
    }
    markAuthorized();
    setLoading(true);
    setTimeout(() => onLogin(user), 900);
  };

  const fail = (message: string) => {
    setLoading(false);
    setError(message);
    setShake(true);
    setTimeout(() => setShake(false), 600);
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    setError('');
    setLoading(true);
    try {
      const res = await fetch(`${AUTH_API}?action=login`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), password, loginType }),
      });
      const data: any = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        fail(data?.error || 'تعذّر تسجيل الدخول — حاول مرة أخرى');
        return;
      }
      // الدخول مباشر بكلمة المرور الصحيحة: لا توجد أي شاشة إلزامية بعدها
      finishLogin({ ...data.user, password: '' } as User);
    } catch {
      fail('تعذّر الاتصال بالسيرفر — تأكد من اتصالك بالإنترنت');
    }
  };

  if (!loginType) {
    return (
      <div className="login-wrap">
        <div className="login-brand">
          <div className="flex items-center gap-3">
            <img src="/msa-app-icon.png?v=4" alt="MSA CRM" className="login-mark" />
            <div className="min-w-0">
              <p className="text-[13px] font-semibold text-[var(--text-strong)] leading-tight">MSA CRM</p>
              <p className="text-[11px] text-[var(--text-dim)] leading-tight">إدارة العملاء العقارية</p>
            </div>
          </div>

          <h1 className="login-title">تسجيل الدخول</h1>

          <div className="login-roles">
            <button type="button" onClick={() => setLoginType('admin')} className="login-role">
              <span className="login-role-icon"><Shield className="w-4.5 h-4.5" /></span>
              <span className="login-role-body">
                <span className="login-role-name">الإدارة</span>
                <span className="login-role-note">CEO / Team Leader</span>
              </span>
              <ChevronLeft className="login-role-go w-4 h-4" />
            </button>

            <button type="button" onClick={() => setLoginType('sales')} className="login-role">
              <span className="login-role-icon"><UserCheck className="w-4.5 h-4.5" /></span>
              <span className="login-role-body">
                <span className="login-role-name">مندوب مبيعات</span>
                <span className="login-role-note">Sales Agent</span>
              </span>
              <ChevronLeft className="login-role-go w-4 h-4" />
            </button>
          </div>

          <p className="login-code">MSA CRM</p>
        </div>

        <LoginPlan lines={['متصل بقاعدة بيانات الفريق', 'أي تعديل يظهر على كل الأجهزة في ثوانٍ.']} />
      </div>
    );
  }

  return (
    <div className="login-wrap">
      <div className="login-brand">
        <div className="flex items-center gap-3">
          <img src="/msa-app-icon.png?v=4" alt="MSA CRM" className="login-mark" />
          <div className="min-w-0">
            <p className="text-[13px] font-semibold text-[var(--text-strong)] leading-tight">MSA CRM</p>
            <p className="text-[11px] text-[var(--text-dim)] leading-tight">إدارة العملاء العقارية</p>
          </div>
        </div>

        <h1 className="login-title">
          {loginType === 'admin' ? 'دخول الإدارة' : 'دخول المندوبين'}
        </h1>

        {/* توضيح يمنع أشهر سبب لتدويس «الحساب مش شغّال»: كلمة المرور نفسها تفتح
            البوابتين لحساب الإدارة/قائد الفريق، والرتبة هي التي تحدد ما يُرى. */}
        <p className="text-[11px] leading-relaxed text-[var(--text-muted)] mb-3">
          {loginType === 'admin'
            ? 'هنا يدخل حساب الإدارة (CEO) وقادة الفرق (Team Leader).'
            : 'هنا يدخل حساب المندوب (Sales Agent)، وكذلك قائد الفريق بنفس كلمة مروره — والرتبة هي التي تحدد ما يظهر.'}
        </p>

        <div className="login-card">
          {/* نموذج عادي (مش motion.form): أي تحويل (transform) على عنصر أب للحقول
              يجعل iOS لا يفعّل الكيبورد عند الضغط — فيبدو الحقل «مش شغّال»
              والكتابة لا تعمل. الاهتزاز عند الخطأ بقى بالحدّ (box-shadow). */}
          <form
            onSubmit={handleLogin}
            className={shake ? 'login-nudge' : ''}
          >
            <div className="login-field">
              <label className="login-label" htmlFor="login-username">اسم المستخدم</label>
              <input
                id="login-username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="login-input"
                placeholder="اسم المستخدم"
                dir="ltr"
                autoComplete="username"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                enterKeyHint="next"
                required
              />
            </div>

            <div className="login-field">
              <label className="login-label" htmlFor="login-password">كلمة المرور</label>
              <input
                id="login-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="login-input"
                placeholder="كلمة المرور"
                dir="ltr"
                autoComplete="current-password"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                enterKeyHint="go"
                required
              />
            </div>

            <AnimatePresence>
              {error && (
                <motion.p
                  initial={{ opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="login-error"
                >
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  {error}
                </motion.p>
              )}
            </AnimatePresence>

            <button type="submit" disabled={loading} className="login-submit">
              {loading ? (
                <>
                  <motion.span
                    animate={{ rotate: 360 }}
                    transition={{ duration: 0.8, repeat: Infinity, ease: 'linear' }}
                    className="w-4 h-4 rounded-full border-2"
                    style={{
                      borderColor: 'color-mix(in srgb, var(--on-brand) 30%, transparent)',
                      borderTopColor: 'var(--on-brand)',
                    }}
                  />
                  جارٍ التحقق...
                </>
              ) : (
                <>
                  {loginType === 'admin' ? <Shield className="w-4.5 h-4.5" /> : <UserCheck className="w-4.5 h-4.5" />}
                  تسجيل الدخول
                </>
              )}
            </button>
          </form>
        </div>

        <button type="button" onClick={() => setLoginType(null)} className="login-back">
          <ChevronRight className="w-4 h-4" />
          رجوع
        </button>
      </div>

      <LoginPlan lines={['متصل بقاعدة بيانات الفريق']} />
    </div>
  );
}

// ===== شريط التنقل السفلي (موديل ENGAZ) =====
// على الموبايل: ٣ أزرار ثابتة في أسفل الشاشة — الرئيسية، عملائي، والمزيد
// (بيفتح القائمة الجانبية بكل التبويبات). الأرقام كلها بتتعمل من الرئيسية:
// العدّادات بتفتح صفحة الأرقام، وكل رقم بيفتح نافذة الإجراء.
// على الشاشات الكبيرة القائمة الجانبية هي اللي بتضل هي والأيقونات دي بتختفي.
function MobileTabBar({ activeTab, onTab, onMore, badge = 0 }: any) {
  const items = [
    { id: 'dashboard', label: 'الرئيسية', icon: Home },
    { id: 'clients', label: 'عملائي', icon: Users },
  ];
  return (
    <nav className="eg-tabbar" aria-label="تنقل سريع">
      {items.map((item) => (
        <button key={item.id} type="button" className={`eg-tab ${activeTab === item.id ? 'is-on' : ''}`}
          onClick={() => onTab(item.id)} aria-current={activeTab === item.id ? 'page' : undefined}>
          <span className="eg-tab-icon">
            <item.icon className="w-5 h-5" />
            {item.id === 'clients' && badge > 0 && <i className="eg-tab-badge">{badge > 9 ? '9+' : badge}</i>}
          </span>
          <span className="eg-tab-label">{item.label}</span>
        </button>
      ))}
      <button type="button" className="eg-tab" onClick={onMore}>
        <span className="eg-tab-icon"><Menu className="w-5 h-5" /></span>
        <span className="eg-tab-label">المزيد</span>
      </button>
    </nav>
  );
}

// Dashboard View
function DashboardView({ stats, clients, numbers = [], reminders, properties, currentUser, impersonating, onOpenStatus, onCompleteReminder, onActed, callLogs = [] }: any) {
  // المستحق الآن — الأحدث أولاً. والتذكير اللي اتعمل عليه إجراء (مكالمة أو كومنت)
  // بيخرج من القائمة فوراً — عشان الشارة «اتأخر» ما تروحش غير لما يتاخد إجراء.
  const dueReminders = reminders
    .filter((r: Reminder) => isReminderDue(r) && !r.isCompleted)
    .filter((r: Reminder) => !actedAfterReminder(r, clients, callLogs))
    .slice()
    .sort((a: Reminder, b: Reminder) => String(b.dateTime || '').localeCompare(String(a.dateTime || '')));
  // عدد التذكيرات المتأخرة لكل رقم — «متأخر ×N» يعني كل المتأخرات للرقم ده
  const lateCountByPhone = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of dueReminders as Reminder[]) {
      if (!r.isDelayed) continue;
      const k = digitsOfPhone(r.clientPhone);
      if (!k) continue;
      map.set(k, (map.get(k) || 0) + 1);
    }
    return map;
  }, [dueReminders]);
  // عدّادات الحالات تحسب الأرقام المعروضة في هذه الصفحة نفسها.
  // البيانات محصورة أصلاً في loadData (السيلز يرى عملاءه، والأدمن/المطوّر يرون الكل)،
  // وكانت التصفية الثانية هنا تُفرّغ العدّادات لصفر لكل رقم ليس باسم صاحب الحساب
  // مباشرةً (حساب المطوّر مثلاً) رغم أن الرقم ظاهر في القائمة — وهو العيب المُبلّغ عنه.
  const myClients = (clients || []) as Client[];
  // لوحة الحالات تعدّ كل رقم في نطاقي (عميل مسجّل أو رقم في التوزيع) — لا العملاء وحدهم
  const scopeNumbers: any[] = numbers.length ? numbers : myClients;
  // «مكالمات باردة» (زي ENGAZ): أرقام نازلة من زمان وما اتصلناش بيها — منفصلة عن
  // «Fresh Leads» (الأرقام الجديدة اللي نازلة حالاً). والاتنين مش نفس الأرقام.
  const calledPhones = new Set<string>(
    (callLogs || []).map((l: any) => digitsOfPhone(l?.clientPhone)).filter(Boolean)
  );
  const coldCalls = scopeNumbers.filter((record: any) => isColdNumber(record, calledPhones)).length;
  // «Fresh Leads» = الأرقام الجديدة (نازلة حالاً) اللي ما اتصلناش بيها
  const freshLeads = scopeNumbers.filter((record: any) => isFreshNumber(record, calledPhones)).length;
  const [todayRecord, setTodayRecord] = useState<Attendance | undefined>(() => getTodayCheckIn(currentUser.id));
  const myHistory = getAttendance().filter((a: Attendance) => a.userId === currentUser.id).sort((a: Attendance, b: Attendance) => b.checkInAt.localeCompare(a.checkInAt)).slice(0, 7);
  
  return (
    <div className="space-y-6">
      <div className="page-intro">
        <div className="min-w-0">
          <h2>أهلاً {currentUser.developer ? 'مطور النظام' : String(currentUser.name || '').split(' ')[0]}</h2>
          <p>{new Date().toLocaleDateString('ar-EG', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
        </div>
        <div className="page-intro-facts">
          <div className="page-fact"><b>{stats.totalClients}</b><span>إجمالي العملاء</span></div>
          <div className="page-fact"><b>{stats.dueNow}</b><span>مستحق الآن</span></div>
          <div className="page-fact"><b>{dueReminders.length}</b><span>تذكير مستحق</span></div>
        </div>
      </div>

      {/* الحضور والانصراف للسيلز فقط — لا يظهر أثناء دخول الإدارة إلى حسابه،
          لأن الإدارة لا تسجّل حضوراً بدلاً منه. */}
      {!impersonating && (
        <AttendanceCard
          currentUser={currentUser}
          record={todayRecord}
          onUpdate={(rec) => setTodayRecord(rec)}
        />
      )}

      {/* بند ٤: لوحة الأرقام — العدّادات هي البطل (زي ENGAZ)، والضغط على أي
          عدّاد يفتح صفحة «الأرقام» مفلترة على الحالة دي. */}
      <section className="eg-dash">
        <div className="eg-dash-head">
          <h3>Leads Board</h3>
          <span className="chip">{scopeNumbers.length} leads</span>
        </div>
        <div className="eg-dash-grid">
          {DASH_CARDS.map((card) => {
            const n = card.id === ''
              ? scopeNumbers.length
              : card.id === COLD_CALL_ID
              ? coldCalls
              : card.id === 'fresh-stage'
              ? freshLeads
              : scopeNumbers.filter((record: any) => (record.bucket || feedbackBucketOf(record)) === card.id).length;
            const pct = scopeNumbers.length ? Math.min(100, Math.round((n / scopeNumbers.length) * 100)) : 0;
            return (
              <button key={card.id || 'all'} type="button" title={card.label}
                className={`eg-dash-card ${card.cls}${n === 0 ? ' is-empty' : ''}`}
                onClick={() => onOpenStatus?.(card.id)}>
                <span className="eg-dash-label">{card.label}</span>
                <span className="eg-dash-count">{n}</span>
                <span className="eg-dash-bar"><i style={{ width: `${pct}%` }} /></span>
              </button>
            );
          })}
        </div>
      </section>

      {dueReminders.length > 0 && (
        <section className="panel">
          <div className="panel-head">
            <h3>تذكيرات مستحقة الآن</h3>
            <span className="chip">{dueReminders.length}</span>
          </div>
          <div className="due-list">
            {dueReminders.map((reminder: Reminder) => (
              <div key={reminder.id} className="due-row">
                <div className="due-who">
                  <b>{reminder.clientName}</b>
                  <span dir="ltr">{reminder.clientPhone}</span>
                </div>
                {reminder.isDelayed && (
                  <span className="due-late">متأخر{(lateCountByPhone.get(digitsOfPhone(reminder.clientPhone)) || 1) > 1
                    ? ` ×${lateCountByPhone.get(digitsOfPhone(reminder.clientPhone))}`
                    : ''}</span>
                )}
                <div className="due-acts">
                  {/* «تم» اتشال من القائمة: إنهاء التذكير بلا إجراء حقيقي كان بيخلي
                      شارة «اتأخر» تروح على طول. الإجراء الحقيقي = مكالمة مسجّلة أو
                      كلام على الرقم، وهو اللي بيخرج التذكير من القائمة. */}
                  <a href={`tel:${reminder.clientPhone}`} className="rc-action" dir="ltr"
                    onClick={() => onActed?.(reminder.id)}>اتصال</a>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* سجل حضوري الشخصي - بدون أي إحداثيات (لا يظهر أثناء دخول الإدارة) */}
      {!impersonating && myHistory.length > 0 && (
        <div className="panel">
          <div className="panel-head">
            <h3><Clock className="w-4 h-4" />سجل حضورك وانصرافك</h3>
          </div>
          <div className="divide-y divide-[var(--border)]">
            {myHistory.map((rec: Attendance) => (
              <div key={rec.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 px-4 py-3">
                <span className="text-[12.5px] text-[var(--text)]">{formatDayLabel(rec.date)}</span>
                <div className="flex flex-wrap items-center gap-3">
                  <span className="text-[12.5px] font-bold text-emerald-400">حضور {formatTime(rec.checkInAt)}</span>
                  {rec.checkOutAt ? (
                    <span className="text-[12.5px] font-bold text-amber-400">انصراف {formatTime(rec.checkOutAt)}</span>
                  ) : (
                    <span className="text-[12.5px] text-[var(--text-dim)]">لم تسجل انصرافاً</span>
                  )}
                  {workedMinutes(rec) > 0 && (
                    <span className="text-[11px] text-[var(--text-muted)] border border-[var(--border)] rounded-full px-2 py-0.5 tabular">{formatDuration(workedMinutes(rec))}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
          <p className="px-4 py-3 text-[11px] text-[var(--text-dim)] border-t border-[var(--border)]">
            * سجلك الشخصي يعرض الوقت فقط — الموقع التفصيلي يظهر للإدارة فقط.
          </p>
        </div>
      )}
    </div>
  );
}

// كارت الحضور والانصراف للسيلز
function AttendanceCard({ currentUser, record, onUpdate }: { currentUser: User; record?: Attendance; onUpdate: (rec: Attendance) => void }) {
  const [status, setStatus] = useState<'' | 'locating' | 'checking-in' | 'checking-out'>('');
  const [error, setError] = useState('');
  const [gpsHelp, setGpsHelp] = useState<'' | 'denied' | 'off'>('');
  const [flags, setFlags] = useState<string[]>([]);

  const locationError = (err: any) => {
    const code = err?.code;
    if (code === 1) {
      setGpsHelp('denied');
      return 'تم رفض صلاحية الموقع';
    }
    if (code === 2 || code === 3) {
      setGpsHelp('off');
      return code === 2 ? 'خدمة الموقع (GPS) مغلقة في الجهاز' : 'استغرقت قراءة الموقع وقتاً طويلاً';
    }
    if (err?.message === 'الجهاز لا يدعم تحديد الموقع') setGpsHelp('off');
    return err?.message || 'تعذر تحديد موقعك، حاول مرة أخرى';
  };

  // تسجيل الحضور أو الانصراف بعد تأكيد الموقع من الجهاز
  const stamp = async (kind: 'in' | 'out') => {
    setError('');
    setFlags([]);
    if (kind === 'in' && record) return;
    if (kind === 'out' && (!record || record.checkOutAt)) return;
    setStatus('locating');
    try {
      const pos = await getPosition();
      setStatus(kind === 'in' ? 'checking-in' : 'checking-out');
      const now = new Date().toISOString();
      const coords = {
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
        accuracy: Math.round(pos.coords.accuracy),
      };
      // فحص مؤشرات التزييف (تسجيل فقط — لا يمنع صاحب الموقع الحقيقي)
      const prev = getAttendance().filter((a) => a.userId === currentUser.id).sort((a, b) => new Date(b.checkInAt).getTime() - new Date(a.checkInAt).getTime())[0];
      const found = detectLocationFlags(pos, prev);
      setFlags(found);

      if (kind === 'in') {
        const created: Attendance = {
          id: crypto.randomUUID(),
          userId: currentUser.id,
          date: todayKey(),
          checkInAt: now,
          ...coords,
          createdAt: now,
          flags: found.length ? found : undefined,
        };
        saveAttendance([created, ...getAttendance()]);
        onUpdate(created);
      } else if (record) {
        const updated = updateAttendanceRecord({
          ...record,
          checkOutAt: now,
          checkOutLatitude: coords.latitude,
          checkOutLongitude: coords.longitude,
          checkOutAccuracy: coords.accuracy,
          flags: [...(record.flags || []), ...found],
        });
        onUpdate(updated);
      }
    } catch (err: any) {
      setError(locationError(err));
    } finally {
      setStatus('');
    }
  };

  const busy = !!status;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="panel"
    >
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 p-4">
        <div className="text-center lg:text-right">
          <h3 className="panel-title flex items-center gap-2 justify-center lg:justify-start">
            <Clock className="w-4 h-4" />
            الحضور والانصراف
          </h3>
          <p className="text-[11.5px] text-[var(--text-muted)] mt-1">{formatDayLabel(todayKey())}</p>

          {!record && <p className="text-[12.5px] text-[var(--text)] mt-2">لم تسجل حضورك اليوم بعد</p>}

          {record && (
            <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="mt-2.5 space-y-1">
              <p className="text-[12.5px] text-emerald-400 font-semibold">
                حضرت الساعة <span className="text-[var(--text-strong)]">{formatTime(record.checkInAt)}</span> — تم تأكيد موقعك
              </p>
              {record.checkOutAt ? (
                <p className="text-[12.5px] text-amber-400 font-semibold">
                  انصرفت الساعة <span className="text-[var(--text-strong)]">{formatTime(record.checkOutAt)}</span>
                  {workedMinutes(record) > 0 && <span className="text-[var(--text)] font-normal"> — مدة العمل {formatDuration(workedMinutes(record))}</span>}
                </p>
              ) : (
                <p className="text-[12.5px] text-[var(--text-muted)]">لم تسجل انصرافك بعد</p>
              )}
            </motion.div>
          )}
        </div>

        <div className="flex flex-col sm:flex-row items-stretch gap-3 w-full lg:w-auto">
          {!record && (
            <motion.button
              whileHover={{ scale: busy ? 1 : 1.04 }}
              whileTap={{ scale: busy ? 1 : 0.96 }}
              onClick={() => stamp('in')}
              disabled={busy}
              className="btn-success !px-7 !py-3"
            >
              {status ? (
                <>
                  <motion.span
                    animate={{ rotate: 360 }}
                    transition={{ duration: 0.8, repeat: Infinity, ease: 'linear' }}
                    className="w-4 h-4 rounded-full border-2"
                    style={{ borderColor: 'color-mix(in srgb, currentColor 30%, transparent)', borderTopColor: 'currentColor' }}
                  />
                  {status === 'locating' ? 'جارٍ تحديد موقعك...' : 'جارٍ تسجيل الحضور...'}
                </>
              ) : (
                <>
                  <Check className="w-4.5 h-4.5" />
                  تسجيل حضور
                </>
              )}
            </motion.button>
          )}

          {record && !record.checkOutAt && (
            <motion.button
              whileHover={{ scale: busy ? 1 : 1.04 }}
              whileTap={{ scale: busy ? 1 : 0.96 }}
              onClick={() => stamp('out')}
              disabled={busy}
              className="btn-warn !px-7 !py-3"
            >
              {status ? (
                <>
                  <motion.span
                    animate={{ rotate: 360 }}
                    transition={{ duration: 0.8, repeat: Infinity, ease: 'linear' }}
                    className="w-4 h-4 rounded-full border-2"
                    style={{ borderColor: 'color-mix(in srgb, currentColor 30%, transparent)', borderTopColor: 'currentColor' }}
                  />
                  {status === 'locating' ? 'جارٍ تحديد موقعك...' : 'جارٍ تسجيل الانصراف...'}
                </>
              ) : (
                <>
                  <LogOut className="w-4.5 h-4.5" />
                  تسجيل انصراف
                </>
              )}
            </motion.button>
          )}

          {record && record.checkOutAt && (
            <div className="px-5 py-3 rounded-[var(--r-sm)] bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-[12.5px] font-semibold flex items-center gap-2">
              <Check className="w-4 h-4" /> يوم عمل مكتمل
            </div>
          )}
        </div>
      </div>

      <AnimatePresence>
        {error && (
          <motion.p
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="relative z-10 mt-4 text-red-400 text-sm text-center bg-red-500/10 border border-red-500/20 rounded-[var(--r-md)] py-2 px-3 flex items-center justify-center gap-2"
          >
            <AlertTriangle className="w-4 h-4 shrink-0" />
            {error}
          </motion.p>
        )}
        {/* تحذير مؤشرات التزييف — غير مانع، لكنه يسجّل ويظهر للإدارة */}
        {flags.length > 0 && (
          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            className="relative z-10 mt-4 text-amber-300 text-xs bg-amber-500/10 border border-amber-500/30 rounded-[var(--r-md)] py-2 px-3">
            <p className="font-bold flex items-center gap-2"><ShieldAlert className="w-4 h-4" /> تم تسجيل الحضور مع مؤشرات تحتاج مراجعة:</p>
            <ul className="list-disc pr-5 mt-1 space-y-0.5">
              {flags.map((f) => <li key={f}>{f}</li>)}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>

      {/* إرشاد تفعيل الموقع: المتصفح لا يفتح إعدادات الجهاز تلقائياً، فنعرض الخطوات دقيقة بخطوة */}
      <AnimatePresence>
        {gpsHelp && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-[95] flex items-center justify-center p-4 bg-black/60"
            onClick={() => setGpsHelp('')}>
            <motion.div initial={{ scale: 0.97, y: 10 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.97, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="glass-card rounded-[var(--r-md)] p-5 w-full max-w-md">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-[var(--r-sm)] bg-amber-400/15 border border-amber-400/30 grid place-items-center">
                  <MapPinOff className="w-5 h-5 text-amber-300" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-[var(--text-strong)]">لازم تشغيل الموقع (GPS) أولاً</h3>
                  <p className="text-[11px] text-[var(--text-muted)]">
                    {gpsHelp === 'denied' ? 'المتصفح يحجب صلاحية الموقع' : 'خدمة الموقع مغلقة في الجهاز'}
                  </p>
                </div>
              </div>
              <ol className="space-y-2.5 text-sm text-[var(--text)] list-decimal pr-5">
                <li>افتح <b>إعدادات الهاتف</b> ← <b>الموقع / Location</b> وشغّله.</li>
                <li>اضبط الدقة على <b>عالي الدقة / High accuracy</b>.</li>
                <li>ارجع للمتصفح: اضغط أيقونة <b>القفل </b> جنب العنوان ← <b>الموقع</b> ← <b>اسمح (Allow)</b>.</li>
                <li>لو الموبايل: اسحب من أعلى الشاشة وشغّل أيقونة <b>GPS </b> ثم أعد المحاولة.</li>
              </ol>
              <p className="text-[11px] text-amber-300 bg-amber-400/10 border border-amber-400/25 rounded-[var(--r-md)] px-3 py-2 mt-3">
                لا يمكن للمتصفح فتح شاشة إعدادات الهاتف مباشرة لأسباب أمنية — نفّذ الخطوات أعله ثم اضغط «حاول مرة أخرى» وسيُسجّل حضورك فوراً.
              </p>
              <div className="flex gap-2 mt-4">
                <button onClick={() => { setGpsHelp(''); void stamp(record ? 'out' : 'in'); }}
                  className="btn-primary flex-1 !py-3">
                  <Navigation className="w-4 h-4" /> حاول مرة أخرى
                </button>
                <button onClick={() => setGpsHelp('')}
                  className="px-5 py-3 rounded-[var(--r-sm)] text-[12.5px] font-semibold text-[var(--text)] border border-[var(--border)] hover:bg-[var(--tint-1)]">
                  إغلاق
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// Clients View
// ===== شرائح الحالة بألوان منظمة لكل مرحلة =====
const STAGE_META: Record<string, { label: string; cls: string; icon: string }> = {
  new: { label: 'جديد', cls: 'st-chip st-new', icon: '🆕' },
  contacted: { label: 'تم التواصل', cls: 'st-chip st-contacted', icon: '' },
  meeting: { label: 'موعد معاينة', cls: 'st-chip st-meeting', icon: '' },
  negotiation: { label: 'تفاوض', cls: 'st-chip st-negotiation', icon: '' },
  closed: { label: 'تم البيع', cls: 'st-chip st-closed', icon: '' },
  lost: { label: 'ضائع', cls: 'st-chip st-lost', icon: '' },
};
const LEAD_STATUS_META: Record<string, { label: string; cls: string; icon: string }> = {
  new: { label: 'رقم جديد', cls: 'st-chip st-new', icon: '🆕' },
  viewed: { label: 'تم العرض', cls: 'st-chip st-meeting', icon: '' },
  contacted: { label: 'تم التواصل', cls: 'st-chip st-contacted', icon: '' },
  closed: { label: 'مغلق', cls: 'st-chip st-closed', icon: '' },
};
const SOURCE_LABEL: Record<string, string> = {
  campaign: 'Facebook Campaign',
  facebook: 'Facebook Ads',
  external: 'مصدر خارجي',
};

// ===== مصدر العميل بلون وأيقونة مميزة: يبان من نظرة واحدة =====
const SOURCE_KINDS = {
  facebook: { cls: 'src-facebook', label: 'Facebook', Icon: Facebook },
  campaign: { cls: 'src-campaign', label: 'Campaign', Icon: Megaphone },
  external: { cls: 'src-external', label: 'External', Icon: Globe },
  other: { cls: 'src-other', label: 'Source', Icon: Link2 },
};
const sourceKindOf = (text: string): keyof typeof SOURCE_KINDS => {
  const t = String(text || '').toLowerCase();
  if (/campaign|كامبين|كامپين|رقم موزّع|استيراد/.test(t)) return 'campaign';
  if (/facebook|face ?book|\bfb\b|فيسبوك|فيس بوك|instagram|إنستجرام|انستجرام/.test(t)) return 'facebook';
  if (/external|externe|خارجي|خارج/.test(t)) return 'external';
  return 'other';
};

// ===== أسماء الفورمات المفعّلة (من إعدادات سحب الأرقام) =====
// «عملاء كامبين» و«توزيع الأرقام» يقرآن قائمتهما المسندلة من هنا: الفورم الجديد
// يظهر فيهما بمجرد تفعيله وحفظ الإعدادات، حتى قبل وصول أي رقم منه.
// (اسم الحدث نفسه معرّف في campaignForms.ts حتى تشترك فيه نافذة رفع الشيت.)

const useActiveCampaignForms = (enabled: boolean) => {
  const [forms, setForms] = useState<string[]>([]);
  useEffect(() => {
    if (!enabled) {
      setForms([]);
      return;
    }
    let stopped = false;
    const load = async () => {
      try {
        const res = await fetch('/api/lead-source', { cache: 'no-store', credentials: 'same-origin' });
        if (!res.ok) return; // بلا صلاحية/شبكة: القوائم تكمل بالفورمات الموجودة في السجلات
        const json = await res.json();
        const config = json.stateless ? localSourceView(readLocalSource()) : json.config || {};
        if (!stopped) setForms(activeFormNamesOf(config));
      } catch {
        /* لا شيء */
      }
    };
    void load();
    const refresh = () => void load();
    window.addEventListener(ACTIVE_FORMS_EVENT, refresh);
    window.addEventListener('focus', refresh);
    return () => {
      stopped = true;
      window.removeEventListener(ACTIVE_FORMS_EVENT, refresh);
      window.removeEventListener('focus', refresh);
    };
  }, [enabled]);
  return forms;
};

// هل السجل أصله رقم اتسحب من الكامبين؟ (للعميل أو الرقم الموزّع)
const isCampaignRecord = (record: any): boolean => {
  const text = String(`${record?.source || ''} ${record?.description || ''} ${record?.formName || ''}`);
  return /رقم موزّع|استيراد|campaign|كامبين|كامپين|فيسبوك|فيس بوك|facebook|إنستجرام|انستجرام|instagram|المصدر/i.test(text);
};

// ===== المرحلة التفصيلية ← أي زر من الأزرار الثلاثة (new / follow up / closed deal) يعبّر عنها =====
// تُستخدم في تبويب «المراحل» عند الإدارة، بعد أن صار شريط الفيدباك هو وسيلة السيلز في كروت العملاء.
const quickStageOf = (stage?: string): 'new' | 'followup' | 'closed' =>
  stage === 'closed'
    ? 'closed'
    : stage === 'contacted' || stage === 'meeting' || stage === 'negotiation'
    ? 'followup'
    : 'new';
const sourceLabelOf = (c: any): string =>
  (c.source && String(c.source).trim()) || SOURCE_LABEL[c.status] || 'غير محدد';
// عدد كومنتات العميل: كلام المندوب فقط (لا لوجات ولا تكرار)
const commentCountOf = (c: any): number => commentActivitiesOf(c).length;

// ===== شريط الفيدباك: ٩ حالات، كل حالة بلون مضيء يظهر في الشريط بعد الاختيار =====
// كل فيدباك = **حالة + كومنت إلزامي**: لا يُحفظ فيدباك بحالة بلا كومنت ولا كومنت بلا حالة.
// ويُسجَّل في خط العميل الزمني فيظهر في خانة الكومنتات (الفيدباك) وفي تبويب «الفيدباك اليومي».
// المرحلة تتحرك تلقائياً مع الحالة (بلا ضغطة إضافية) فيبقى تبويب «المراحل» صادقاً.
// الترتيب مقصود: «fresh stage» أول خانة لأنها نقطة البداية التي لم يُتواصل معها بعد،
// ثم «follow up» وما بعدها. نفس الترتيب يُستخدم في لوحة الحالات وفي القائمة المنسدلة.
const FEEDBACK_STATUSES: Array<{ id: string; label: string; ar: string; cls: string; stage: Client['stage'] }> = [
  { id: 'fresh-stage', label: 'fresh stage', ar: 'مرحلة جديدة (لم يُتواصل معه بعد)', cls: 'fs-fresh', stage: 'new' },
  { id: 'follow-up', label: 'follow up', ar: 'متابعة (تم التواصل / معاينة / تفاوض)', cls: 'fs-follow', stage: 'contacted' },
  { id: 'meeting', label: 'meeting', ar: 'موعد معاينة أو اجتماع', cls: 'fs-meeting', stage: 'meeting' },
  { id: 'after-meeting', label: 'following after meeting', ar: 'متابعة بعد الاجتماع', cls: 'fs-after', stage: 'meeting' },
  { id: 'reschedule', label: 'reschedule meeting', ar: 'إعادة جدولة الاجتماع', cls: 'fs-reschedule', stage: 'meeting' },
  { id: 'cancellation', label: 'cancellation', ar: 'إلغاء', cls: 'fs-cancel', stage: 'lost' },
  { id: 'no-answer', label: 'no answer', ar: 'لا يوجد رد (لا يرد على الهاتف)', cls: 'fs-noanswer', stage: 'contacted' },
  { id: 'done-deal', label: 'done deal', ar: 'تم البيع', cls: 'fs-done', stage: 'closed' },
  { id: 'reservation', label: 'reservation', ar: 'حجز', cls: 'fs-reservation', stage: 'negotiation' },
];
const FEEDBACK_STATUS_BY_ID: Record<string, { id: string; label: string; ar: string; cls: string; stage: Client['stage'] }> =
  Object.fromEntries(FEEDBACK_STATUSES.map((status) => [status.id, status]));
// الكومنت المكتوب تلقائياً عند اختيار «no answer» — يظهر في خانة الكومنتات كما هو
const NO_ANSWER_COMMENT = 'No answer';
// كومنت البطاقة التلقائية عند إضافة عميل جديد بلا كومنت مكتوب —
// فالعميل يظهر في تبويب الفيدباك من لحظته الأولى بلا أي خطوة يدوية.
const NEW_CLIENT_FEEDBACK = 'عميل جديد — لم يتم التواصل معه بعد';

// آخر حالة فيدباك على العميل — انظر src/feedbackBuckets.ts
// (فيه أيضاً السقوط على المرحلة عند غياب حالة، حتى لا تبقى عدّادات اللوحة صفراً)
// آخر فيدباك للعميل: نُفضّل آخر كومنت حقيقي يحمل حالة، وإلا آخر كومنت خالص.
// (اللوجات — اتصال/تذكير/واتساب — ما بتظهرش هنا: الكومنت هو كلام المندوب.)
const lastCommentOf = (c: any): ClientActivity | null => {
  const comments = commentActivitiesOf(c) as ClientActivity[];
  return (
    comments.find((a: ClientActivity) => a?.status) ||
    comments[0] ||
    null
  );
};

// ===== اسم كاتب الكومنت =====
// كل كومنت بيتسجّل باسم صاحبه (by) ومعرّفه (authorId). لو الاسم مش موجود
// بنلفيه من الحسابات (الاسم بيتغيّر مع الوقت)، ولو الحساب اتمسح بنكتب
// «مندوب سابق» — عشان الكومنت يفضل معروف مين كتبه.
const commentAuthorName = (activity: any, users: any[] = []): string => {
  const by = String(activity?.by || '').trim();
  if (by) return by;
  const authorId = String(activity?.authorId || '').trim();
  if (!authorId) return '';
  const found = (users || []).find((u: any) => String(u?.id) === authorId);
  if (found?.name) return String(found.name);
  return 'مندوب سابق';
};

// قائمة الحالات المنسدلة: زر يعرض الحالة بلونها المضيء، ويفتح قائمة منسدلة بـ٩ حالات
// (بدل الشريط المسطّح الملاصق للاسم). القائمة تُرسم عبر Portal لتخرج من حدود الكارت/الجدول.
function StatusMenu({ value, onPick, label = 'تسجيل فيدباك', className = '', stopPropagation = true }:
  { value?: string; onPick: (id: string) => void; label?: string; className?: string; stopPropagation?: boolean }) {
  const meta = value ? FEEDBACK_STATUS_BY_ID[value] : null;
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [up, setUp] = useState(false);
  const [style, setStyle] = useState<React.CSSProperties>({});

  // القائمة تُرسم داخل البورتال، وكل قياساتها من الشاشة نفسها:
  // العرض كافي لوصف الحالة، والارتفاع محصور في المساحة المتاحة
  // (تفتح لفوق لو المساحة تحت قليلة) — فما تتقطعش أبداً من حدود الشاشة.
  const place = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const width = Math.min(Math.max(r.width, 300), window.innerWidth - 16);
    const spaceBelow = window.innerHeight - r.bottom - 10;
    const spaceAbove = r.top - 10;
    const flip = spaceBelow < 300 && spaceAbove > spaceBelow;
    const maxHeight = Math.max(160, Math.min(460, flip ? spaceAbove : spaceBelow));
    setUp(flip);
    let left = r.left;
    if (left + width > window.innerWidth - 8) left = Math.max(8, window.innerWidth - width - 8);
    setStyle({
      position: 'fixed',
      left,
      width,
      maxHeight,
      ...(flip ? { bottom: window.innerHeight - r.top + 6 } : { top: r.bottom + 6 }),
    });
  }, []);

  useEffect(() => {
    if (!open) return;
    place();
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (wrapRef.current?.contains(t)) return;
      if (document.getElementById('fs-menu-portal')?.contains(t)) return;
      setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    const onScroll = () => setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onEsc);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onEsc);
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [open, place]);

  return (
    <div ref={wrapRef} className={`fs-menu-wrap ${className}`.trim()}
      onClick={stopPropagation ? (e) => e.stopPropagation() : undefined}>
      <button
        ref={triggerRef}
        type="button"
        className={`fs-trigger ${meta ? meta.cls : ''} ${meta ? 'on' : ''}`.trim()}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="fs-trigger-dot" />
        <span className="fs-trigger-label">{meta ? meta.label : label}</span>
        <ChevronDown className={`w-3.5 h-3.5 fs-trigger-chev ${open ? 'open' : ''}`} />
      </button>
      {open && createPortal(
        <div id="fs-menu-portal" className={`fs-menu ${up ? 'up' : ''}`} role="menu" style={style}>
          {FEEDBACK_STATUSES.map((status) => (
            <button
              key={status.id}
              type="button"
              role="menuitem"
              title={status.ar}
              className={`fs-item ${status.cls} ${value === status.id ? 'on' : ''}`}
              onClick={() => { setOpen(false); onPick(status.id); }}
            >
              <span className="fs-item-dot" />
              <span className="fs-item-en">{status.label}</span>
              <span className="fs-item-ar">{status.ar}</span>
            </button>
          ))}
        </div>,
        document.body
      )}
    </div>
  );
}

// ===== هل السيلز تواصل مع العميل فعلاً؟ =====
// شريط الفيدباك لا يظهر إلا بعد أول تواصل (مكالمة أو واتساب أو ملاحظة مسجّلة)،
// لأن تسجيل حالة لعميل لم يُكلَّم بعد لا معنى له.
const CLIENT_CONTACT_TYPES = /feedback|call|whatsapp|note|اتصال/i;
const hasContactedClient = (client: any): boolean =>
  !!client &&
  (client.activities || []).some((a: any) => CLIENT_CONTACT_TYPES.test(String(a?.type || '')));

// شريط الفيدباك بجوار اسم العميل: قائمة منسدلة تعرض الحالة المختارة بلونها المضيء
function FeedbackBar({ client, onPick }: { client: any; onPick?: (statusId: string) => void }) {
  const active = latestFeedbackStatusOf(client);
  return <StatusMenu value={active} onPick={(id) => onPick?.(id)} className="fb-bar-menu" />;
}

// ===== اسم الفورم جنب كل رقم =====
// كل رقم في النظام له فورم نزل منه؛ الاسم يظهر جمب الهاتف في كل القوائم
// (السجلات القديمة اللي ما فيهاش `formName` يُقرأ اسمها من نص الوصف).
function FormNameChip({ record, className = '' }: { record: any; className?: string }) {
  const name = formNameOf(record);
  if (!name) return null;
  return (
    <span className={`cc-form ${className}`.trim()} title={`الفورم: ${name}`} dir="auto">
      <ClipboardList className="w-3 h-3 shrink-0" />
      <span translate="no">{name}</span>
    </span>
  );
}

// ===== توقيت تسجيل الرقم في الكامبين: اليوم/الشهر + الساعة =====
// يُكتب جمب الرقم زي اسم الفورم بالظبط (٢٤/١٠ • ١١:٢٦ ص)
// التوقيت المخزَّن هو وقت التسجيل نفسه (بتوقيت UTC كما كتبه السيرفر)،
// فنعرضه بتوقيت UTC باش يطلع بنفس الوقت المسجَّل في الفورم — مش متغيّر بتوقيت الجهاز.
const campaignTimeLabel = (value?: string): string => {
  const at = Date.parse(String(value || ''));
  if (!value || Number.isNaN(at)) return '';
  const d = new Date(at);
  const pad = (n: number) => String(n).padStart(2, '0');
  const hours = d.getUTCHours();
  const period = hours < 12 ? 'ص' : 'م';
  const hour12 = hours % 12 === 0 ? 12 : hours % 12;
  return `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)} • ${pad(hour12)}:${pad(d.getUTCMinutes())} ${period}`;
};

// ===== توقيت تسجيل الرقم في الكامبين: اليوم/الشهر + الساعة =====
// يُكتب جمب الرقم زي اسم الفورم بالظبط (٢٤/١٠ • ١١:٢٦ ص)
// kind: 'campaign' = سُجّل في الكامبين (وقت نزول الرقم في الفورم)
//       'added'    = أُضيف في النظام (وقت إضافة العميل يدوياً — مفيش وقت كامبين)
function CampaignTimeChip({ at, kind = 'campaign', className = '' }: { at?: string; kind?: 'campaign' | 'added'; className?: string }) {
  const label = campaignTimeLabel(at);
  if (!label) return null;
  const title = kind === 'campaign' ? `سُجّل في الكامبين: ${label}` : `أُضيف في النظام: ${label}`;
  return (
    <span className={`cc-time ${className}`.trim()} title={title}>
      <Clock className="w-3 h-3 shrink-0" />
      <span dir="ltr">{label}</span>
    </span>
  );
}

// ===== زر + لإضافة فيدباك مباشر: نفس الزر في كارت المراحل وكارت تبويب العملاء =====
// يفتح صندوق الفيدباك (حالة + كومنت) نفسه الموجود في تبويب العملاء، بدون أي
// سؤال «تم الرد / لم يرد» — والحالة تفضل زي آخر فيدباك على العميل.
function QuickNoteButton({ active, onToggle }: { active: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      className={`cc-note-add ${active ? 'on' : ''}`.trim()}
      title="إضافة فيدباك (حالة + كومنت) — بدون مكالمة"
      aria-label="إضافة فيدباك"
      aria-expanded={active}
      onClick={(e) => { e.stopPropagation(); onToggle(); }}
    >
      <Plus className="w-3 h-3" />
    </button>
  );
}

// ===== كارت العميل الواحد: نفس الكارت في تبويب «العملاء» وفي «المراحل» =====
// نفس الشكل بالحرف (الأفاتار + مصدر الرقم + شريط الفيدباك بتسع حالات + آخر كومنت +
// الهاتف + الأزرار)، لأن المراحل كانت تعرض سطرين بلا وسيلة لتسجيل فيدباك.
// صندوق الفيدباك (حالة + كومنت إلزامي) داخلي هنا، والحفظ يتحرك معه المرحلة تلقائياً،
// فالسيلز يسجّل الفيدباك من المراحل بلا رجوع لتبويب العملاء.
function ClientFeedbackCard({ client, currentUser, users = [], onSelect, onOpenComments, onSetStage, onRefresh, onCall, alertMap, nextActionMap }: any) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState('');
  const [commentText, setCommentText] = useState('');
  const [cancelReason, setCancelReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [syncError, setSyncError] = useState('');
  // «الإجراء القادم» — يوم + ساعة (اختياري): يكتب تذكيراً يبان على الكارت
  const [nextActionAt, setNextActionAt] = useState('');
  // مرجع حقل الموعد — عشان زر «حدّد الإجراء القادم» يفتح الصندوق ويركّز عليه
  const nextActionRef = useRef<HTMLInputElement | null>(null);
  const src = SOURCE_KINDS[sourceKindOf(`${client?.source} ${client?.status}`)];
  const SrcIcon = src.Icon;
  const sourceText = sourceLabelOf(client);
  const comments = commentCountOf(client);
  const last = lastCommentOf(client);
  // اسم كاتب آخر كومنت — يبان جنب الكومنت نفسه
  const lastAuthor = commentAuthorName(last, users);
  // ===== «محتاج إجراء»: التذكير فات موعده والمندوب مخدش خطوة بعده =====
  // الكارت بيتلوّن أصفر (في كل المراحل) لحد ما المندوب يتصرف، وبعدها يرجع
  // لونه الأصلي (لون المرحلة) زي ما كان.
  const alertDue = String(alertMap?.get(digitsOfPhone(client?.phone)) || '');
  const needsAction = !!alertDue;
  // ===== «الإجراء القادم»: أقرب موعد مفتوح للعميل (يوم + ساعة) =====
  const nextAction: NextAction | null = nextActionMap?.get(digitsOfPhone(client?.phone)) || null;
  const facts = ([
    client?.budget ? { k: 'الميزانية', v: displayPrice(client.budget) } : null,
    client?.property ? { k: 'العقار', v: client.property } : null,
    client?.monthlyInstallment ? { k: 'القسط', v: displayPrice(client.monthlyInstallment) } : null,
    client?.deliveryPeriod ? { k: 'التسليم', v: client.deliveryPeriod } : null,
  ].filter(Boolean) as Array<{ k: string; v: string }>);
  const meta = status ? FEEDBACK_STATUS_BY_ID[status] : null;

  // فتح الصندوق: من شريط الحالة (بقيمة مختارة) أو من زر الفيدباك
  const openComposer = (statusId?: string) => {
    const picked = statusId || latestFeedbackStatusOf(client) || '';
    const keptReason = picked === 'cancellation' ? latestCancelReasonOf(client) : '';
    setOpen(true);
    setStatus(picked);
    setCancelReason(keptReason);
    setSyncError('');
    setCommentText(
      picked === 'no-answer' ? NO_ANSWER_COMMENT : picked === 'cancellation' ? cancelReasonLabelOf(keptReason) : ''
    );
  };
  // فتح الصندوق مع التركيز على حقل «الإجراء القادم» (من زر «حدّد الإجراء القادم»)
  const openNextActionPicker = () => {
    openComposer();
    setTimeout(() => nextActionRef.current?.focus(), 30);
  };

  const closeComposer = () => {
    setOpen(false);
    setStatus('');
    setCommentText('');
    setCancelReason('');
    setNextActionAt('');
    setSyncError('');
  };

  const submit = async () => {
    const text = commentText.trim();
    // الحالة مش إلزامية: لو ما اختارش، بيتحفظ على حالة آخر فيدباك على العميل
    const statusId = status || latestFeedbackStatusOf(client) || '';
    if (!text || (statusId === 'cancellation' && !cancelReason) || saving) return;
    const picked = statusId ? FEEDBACK_STATUS_BY_ID[statusId] : null;
    setSaving(true);
    setSyncError('');
    // نفس مسار تبويب العملاء: كومنت + حالة في الخط الزمني، والمصدر واحد
    addClientActivity(client.id, 'feedback', text, currentUser?.name || '', {
      authorId: currentUser?.id,
      ...(statusId ? { status: statusId } : {}),
      ...(statusId === 'cancellation' && cancelReason ? { cancelReason } : {}),
      // «الإجراء القادم» (يوم + ساعة) — بيتكتب على سجل العميل فيبان على الكارت
      ...(nextActionAt
        ? { nextActionAt: new Date(nextActionAt).toISOString(), nextActionNote: 'إجراء قادم' }
        : {}),
      callStatus: statusId === 'no-answer' ? 'no-answer' : 'called',
    });
    if (picked?.stage && client.stage !== picked.stage) onSetStage?.(client.id, picked.stage);
    // ===== «الإجراء القادم»: اختيار يوم + ساعة → تذكير يبان على الكارت =====
    // الموعد بيتحفظ في جدول التذكيرات (نفس نظام «محتاج إجراء»)، فتبان
    // على الكارت باليوم والساعة، ولما يجي وقتها من غير خطوة → «اتأخر».
    const nextReminder = nextActionAt
      ? addNextActionReminder(client, nextActionAt, 'إجراء قادم', currentUser?.id || client?.userId || '')
      : null;
    // انتظار الرفع: الفيدباك لازم يوصل قاعدة البيانات حتى يظهر في «الفيدباك اليومي»
    // عند الإدارة — الحفظ المحلي وحده يخلّيه على جهاز السيلز.
    const [clientsOk, feedbackOk, remindersOk] = await Promise.all([
      pushKey('crm_clients'),
      pushKey('crm_daily_feedback'),
      nextReminder ? pushKey('crm_reminders') : Promise.resolve(true),
    ]);
    setSaving(false);
    if (!(clientsOk && feedbackOk && remindersOk)) {
      setSyncError('اتسجل على الشاشة دي لكن ماوصلش لقاعدة البيانات — تأكد من الاتصال واضغط «حفظ» تاني.');
      return;
    }
    closeComposer();
    onRefresh?.();
  };

  return (
    <>
      <motion.article
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        whileHover={{ y: -1 }}
        onClick={() => onSelect?.(client)}
        className={`client-card ${src.cls} ${needsAction ? 'cc-alert' : ''}`}
      >
        <div className="cc-avatar">{client?.name?.[0] || '#'}</div>

        <div className="cc-body">
          <div className="cc-line">
            <b className="cc-name">{client?.name}</b>
            <span className={`cc-src ${src.cls}`} title={sourceText}>
              <SrcIcon className="w-3 h-3" />
              {sourceText}
            </span>
            {needsAction && (
              <span className="cc-alert-badge" title={`فات وقت التذكير — ${formatDateTime(alertDue)}`}>
                <AlertTriangle className="w-3 h-3" />
                اتأخر
              </span>
            )}
            {client?.stage === 'lost' && <span className="st-chip st-lost">ضائع</span>}
            {hasContactedClient(client) && (
              <FeedbackBar client={client} onPick={(statusId: string) => openComposer(statusId)} />
            )}
          </div>

          {last?.text && (
            <p className="cc-lastfb">
              <FeedbackChip status={last.status} alert={needsAction} />
              {lastAuthor && <span className="cc-author" title="كاتب الكومنت">{lastAuthor}</span>}
              <span className="cc-lastfb-text">{last.text}</span>
            </p>
          )}

          <div className="cc-phone-row">
            {/* الرقم نفسه يفتح نافذة «رد / لم يرد» زي علامة الاتصال — الرقم مايرنّش
                لوحده (الاتصال الفعلي من جوه النافذة). */}
            <button type="button" className="cc-phone" dir="ltr"
              onClick={(e) => { e.stopPropagation(); onCall?.(client); }}>{client?.phone}</button>
            <FormNameChip record={client} />
            <CampaignTimeChip at={campaignTimeOf(client).at} kind={campaignTimeOf(client).kind} />
            {/* إضافة فيدباك من المراحل بنفس صندوق تبويب العملاء: حالة (اختيارية،
                تبقى زي آخر فيدباك) + كومنت — بدون أي سؤال «تم الرد / لم يرد». */}
            <QuickNoteButton active={open} onToggle={() => (open ? closeComposer() : openComposer())} />
          </div>

          {nextAction ? (
            <p className={`cc-next ${nextAction.overdue ? 'is-late' : ''} ${nextAction.done ? 'is-done' : ''}`} title={nextAction.note || 'الإجراء القادم'}>
              <CalendarClock className="w-3 h-3" />
              <span className="cc-next-label">الإجراء القادم</span>
              <b className="cc-next-time">{formatDateTime(nextAction.at)}</b>
              {nextAction.overdue && <span className="cc-next-late">اتأخر</span>}
              {nextAction.done && <span className="cc-next-done">تم</span>}
            </p>
          ) : (
            // زر واضح عشان الموعد يتحدد في خطوة واحدة (من غير ما يفتح الصندوق الأول)
            <button type="button" className="cc-next is-empty" onClick={(e) => { e.stopPropagation(); openNextActionPicker(); }}
              title="حدّد موعد الإجراء القادم (يوم + ساعة) — يظهر على الكارت">
              <CalendarClock className="w-3 h-3" />
              حدّد الإجراء القادم (يوم + ساعة)
            </button>
          )}

          {facts.length > 0 && (
            <div className="cc-facts">
              {facts.map((f) => (
                <span className="cc-fact" key={f.k}><i>{f.k}</i>{f.v}</span>
              ))}
            </div>
          )}
        </div>

        <div className="cc-actions" onClick={(e) => e.stopPropagation()}>
          <button type="button" className="comments-pill" title="كل التعليقات بالتوقيت — اضغط لعرضها"
            onClick={() => onOpenComments?.(client)}>
            <MessageSquare className="w-3.5 h-3.5" />
            <b>{comments}</b>
          </button>
          {/* نفس ترتيب كارت العملاء بعد شيل الزر الأصفر: الأزرار تحت الکارت */}
          <button type="button" onClick={() => onCall?.(client)} title="الاتصال بالعميل (تسجيل: رد / لم يرد)"
            className="icon-btn !w-8 !h-8 text-emerald-300"><PhoneCall className="w-3.5 h-3.5" /></button>
          <WhatsAppButton name={client?.name} phones={[client?.phone, ...(client?.phones || [])]} />
        </div>
      </motion.article>

      {open && (
        <form
          className="feedback-composer"
          onClick={(e) => e.stopPropagation()}
          onSubmit={(e) => { e.preventDefault(); submit(); }}
        >
          <StatusMenu
            value={status}
            label="اختر حالة الفيدباك"
            className="fc-status-menu"
            stopPropagation={false}
            onPick={(optionId) => {
              setStatus(optionId);
              if (optionId === 'cancellation') {
                setCancelReason('');
                setCommentText('');
                return;
              }
              setCancelReason('');
              if (optionId === 'no-answer' && !commentText.trim()) setCommentText(NO_ANSWER_COMMENT);
            }}
          />
          {status === 'cancellation' && (
            <CancelReasonPicker
              value={cancelReason}
              onChange={(reason) => {
                setCancelReason(reason);
                setCommentText(reason ? cancelReasonLabelOf(reason) : '');
              }}
            />
          )}
          <div className="fc-row">
            <input
              autoFocus
              value={commentText}
              onChange={(e) => setCommentText(e.target.value)}
              placeholder={meta ? `اكتب كومنت «${meta.label}» — إلزامي ليُحفظ الفيدباك` : 'اختر حالة الفيدباك ثم اكتب الكومنت'}
              className="quick-comment-input"
            />
            <button type="submit" disabled={saving || !commentText.trim() || (status === 'cancellation' && !cancelReason)}
              title={status === 'cancellation' && !cancelReason ? 'اختر سبب الإلغاء' : 'حفظ الفيدباك (الكومنت والحالة)'}>
              {saving ? '…' : 'حفظ'}
            </button>
            <button type="button" title="إلغاء" onClick={closeComposer}>✕</button>
          </div>
          {/* ===== «الإجراء القادم»: يوم + ساعة (اختياري) ===== */}
          {/* الاختيار ده بيكتب تذكيراً بنفس نظام «محتاج إجراء»، فيبقى الموعد
              مكتوب على كارت العميل: «الإجراء القادم: يوم كذا الساعة كذا». */}
          <label className="fc-next">
            <span className="fc-next-label">
              <CalendarClock className="w-3 h-3" />
              الإجراء القادم (يوم + ساعة)
            </span>
            <span className="fc-next-quick">
              <button type="button" onClick={() => setNextActionAt(nextActionQuickValue('today'))}>اليوم</button>
              <button type="button" onClick={() => setNextActionAt(nextActionQuickValue('tomorrow'))}>بكرة</button>
              <button type="button" onClick={() => setNextActionAt(nextActionQuickValue('dayAfter'))}>بعد غد</button>
            </span>
            <input
              ref={nextActionRef}
              type="datetime-local"
              value={nextActionAt}
              onChange={(e) => setNextActionAt(e.target.value)}
              className="fc-next-input"
            />
            {nextActionAt && (
              <button type="button" className="fc-next-clear" title="إلغاء الموعد" onClick={() => setNextActionAt('')}>✕</button>
            )}
          </label>
          <p className={syncError ? 'fc-hint fc-sync-error' : 'fc-hint'}>
            {syncError
              ? syncError
              : status === 'cancellation' && !cancelReason
              ? 'اختر سبب الإلغاء — والكومنت هيتكتب تلقائياً'
              : meta
              ? `الحالة: ${meta.label} — ${meta.ar} (هتتحفظ زي ما هي لو ما غيّرتهاش)`
              : 'اكتب الكومنت — والحالة هتتحفظ زي آخر فيدباك على العميل'}
          </p>
        </form>
      )}
    </>
  );
}

// ===== قائمة سبب الإلغاء =====
// تظهر لحظة اختيار «cancellation» في أي صندوق فيدباك في النظام، واختيار سبب يكتب
// الكومنت تلقائياً (نفس سلوك «no answer») ويُحفظ السبب مع العميل فلترةً لاحقاً.
function CancelReasonPicker({ value, onChange, className = '' }:
  { value?: string; onChange: (id: string) => void; className?: string }) {
  return (
    <label className={`cancel-reason ${className}`.trim()}>
      <span className="cr-label">سبب الإلغاء — cancel reason *</span>
      <select value={value || ''} onChange={(e) => onChange(e.target.value)} className="cr-select">
        <option value="">— اختر سبب الإلغاء —</option>
        {CANCEL_REASONS.map((reason) => (
          <option key={reason.id} value={reason.id}>
            {reason.label} — {reason.ar}
          </option>
        ))}
      </select>
      <span className="cr-hint">
        {value ? `الكومنت هيتكتب: ${cancelReasonLabelOf(value)}` : 'اختيار السبب يكتب الكومنت تلقائياً ويحفظه مع الرقم'}
      </span>
    </label>
  );
}

// حالة فيدباك صغيرة تُعرض بجوار الكومنت (في الخط الزمني وفي تبويب الفيدباك)
function FeedbackChip({ status, alert = false }: { status?: string; alert?: boolean }) {
  const meta = status ? FEEDBACK_STATUS_BY_ID[status] : null;
  if (!meta) return null;
  // «محتاج إجراء» = التذكير فات موعده → الشارة أصفر (أهم من لون المرحلة)
  return <b className={`fs-chip ${alert ? 'fs-alert' : meta.cls}`} title={meta.ar}>{meta.label}</b>;
}

// ===== لوحة كل التعليقات + الملخص (للـ CEO ولفريق العمل) =====
function CommentsBoardModal({ clients = [], callLogs = [], onClose }: any) {
  const [mode, setMode] = useState<'list' | 'summary'>('list');

  // نجمع التعليقات من خطوط العملاء الزمنية ومن سجل المكالمات
  const entries = useMemo(() => {
    const out: Array<{ id: string; client: string; sales: string; text: string; at: string; kind: string; status?: string }> = [];
    for (const c of clients) {
      for (const a of c.activities || []) {
        if (/feedback|call|comment|note|فيدباك|اتصال/i.test(`${a.type}`) && a.text) {
          out.push({ id: a.id, client: c.name, sales: a.by || '', text: a.text, at: a.at, kind: `${a.type}`, status: a.status });
        }
      }
    }
    for (const log of callLogs) {
      // كلام المندوب بس — اللوج الآلي (من غير كلام) ما بيظهرش
      const logText = cleanCommentText(log?.comment);
      if (!logText || (isSystemOnlyText(logText) && !isCallResultText(logText))) continue;
      out.push({
        id: log.id,
        client: log.clientName || '',
        sales: log.salesName || '',
        text: logText,
        at: log.createdAt,
        kind: log.result === 'answered' ? 'مكالمة: تم الرد' : 'مكالمة: لم يرد',
        status: log.result === 'answered' ? 'follow-up' : 'no-answer',
      });
    }
    return out.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  }, [clients, callLogs]);

  const summary = useMemo(() => {
    const answered = callLogs.filter((l: any) => l.result === 'answered').length;
    const noAnswer = callLogs.filter((l: any) => l.result === 'no-answer').length;
    const byStage: Record<string, number> = {};
    for (const c of clients) byStage[c.stage] = (byStage[c.stage] || 0) + 1;
    const bySales: Record<string, number> = {};
    for (const e of entries) if (e.sales) bySales[e.sales] = (bySales[e.sales] || 0) + 1;
    return { answered, noAnswer, byStage, bySales };
  }, [clients, callLogs, entries]);

  const salesRows = Object.entries(summary.bySales).sort((a, b) => b[1] - a[1]);

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-[90] flex items-center justify-center p-4 bg-black/80" onClick={onClose}>
      <motion.div initial={{ scale: 0.95, y: 12 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.95, opacity: 0 }}
        onClick={(e) => e.stopPropagation()}
        className="panel w-full max-w-2xl max-h-[88vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between gap-3 p-5 border-b border-[var(--border)]">
          <div>
            <h3 className="text-lg font-bold text-[var(--text-strong)]">مركز التعليقات والفيدباك</h3>
            <p className="text-[11px] text-[var(--text-muted)]">إجمالي التعليقات: <b className="text-[var(--text-strong)]">{entries.length}</b> — كل التعليقات محفوظة لكل عميل على حدة</p>
          </div>
          <div className="flex items-center gap-2">
            <div className="view-toggle">
              <button className={mode === 'list' ? 'on' : ''} onClick={() => setMode('list')} title="عرض كل التعليقات"><List className="w-4 h-4" /></button>
              <button className={mode === 'summary' ? 'on' : ''} onClick={() => setMode('summary')} title="تلخيص"><FileText className="w-4 h-4" /></button>
            </div>
            <button onClick={onClose} className="icon-btn" title="إغلاق"><X className="w-4 h-4" /></button>
          </div>
        </div>

        <div className="p-5 overflow-y-auto space-y-3">
          {mode === 'summary' ? (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                <div className="glass-card rounded-[var(--r-md)] p-3 text-center"><p className="text-xl font-extrabold text-[var(--text-strong)]">{entries.length}</p><p className="text-[10.5px] text-[var(--text-muted)]">إجمالي التعليقات</p></div>
                <div className="glass-card rounded-[var(--r-md)] p-3 text-center"><p className="text-xl font-extrabold text-emerald-300">{summary.answered}</p><p className="text-[10.5px] text-[var(--text-muted)]">تم الرد</p></div>
                <div className="glass-card rounded-[var(--r-md)] p-3 text-center"><p className="text-xl font-extrabold text-red-300">{summary.noAnswer}</p><p className="text-[10.5px] text-[var(--text-muted)]">لم يرد</p></div>
                <div className="glass-card rounded-[var(--r-md)] p-3 text-center"><p className="text-xl font-extrabold text-[var(--brand)]">{clients.length}</p><p className="text-[10.5px] text-[var(--text-muted)]">عملاء لديهم سجل</p></div>
              </div>
              <div className="glass-card rounded-[var(--r-md)] p-4">
                <h4 className="text-sm font-bold text-[var(--text-strong)] mb-2">توزيع العملاء على المراحل</h4>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(STAGE_META).map(([key, meta]) => (
                    <span key={key} className={meta.cls}>
                      {meta.icon} {meta.label}: {summary.byStage[key] || 0}
                    </span>
                  ))}
                </div>
              </div>
              {salesRows.length > 0 && (
                <div className="glass-card rounded-[var(--r-md)] p-4">
                  <h4 className="text-sm font-bold text-[var(--text-strong)] mb-2">عدد التعليقات لكل سيلز</h4>
                  <div className="space-y-1.5">
                    {salesRows.map(([name, count]) => (
                      <div key={name} className="flex items-center justify-between text-xs">
                        <span className="text-[var(--text)]">{name}</span>
                        <span className="font-bold text-[var(--text-strong)]">{count}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : entries.length === 0 ? (
            <p className="text-center text-sm text-[var(--text-dim)] py-10">لا توجد تعليقات بعد</p>
          ) : (
            entries.map((e) => (
              <div key={`${e.kind}-${e.id}`} className="fb-item">
                <div className="fb-head">
                  <span className="font-bold text-[var(--text)]">{e.client}{e.sales ? ` — ${e.sales}` : ''}</span>
                  <span>{formatDateTime(e.at)}</span>
                </div>
                <p className="fb-text"><FeedbackChip status={e.status} /> {e.text}</p>
              </div>
            ))
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}

// ===== سجل كل تعليقات عميل واحد =====
// يُفتح بالضغط على كارت الفيدباك أو زر الكومنتات — يعرض كل الكومنتات/المكالمات
// مرتّبة بالأحدث، ومجمّعة باليوم، مع الوقت واسم الكاتب وحالة الفيدباك.
function ClientCommentsModal({ client, users = [], callLogs = [], feedbacks = [], onClose }: any) {
  const entries = useMemo(() => {
    const digits = normalizeDigits(String(client?.phone || '')).replace(/\D/g, '');
    const name = normalizeArabicText(String(client?.name || ''));
    // اسم كاتب كل سطر: من الاسم المحفوظ، ولا من الحسابات (بطاقة الفيدباك ما بتخزّنش الاسم)
    const nameOfUser = (id: any) => {
      const found = (users || []).find((u: any) => String(u?.id) === String(id || ''));
      return found?.name ? String(found.name) : 'مندوب سابق';
    };

    const list: Array<{ id: string; at: string; text: string; by?: string; status?: string; kind: string; result?: string }> = [];

    // كومنتات العميل: كلام المندوب فقط — لا لوجات (اتصال/تذكير/واتساب)
    for (const activity of commentActivitiesOf(client)) {
      list.push({
        id: `act-${activity.id}`,
        at: activity.at,
        text: activity.text,
        by: commentAuthorName(activity, users),
        status: activity.status,
        kind: activity.type,
      });
    }

    for (const feedback of feedbacks || []) {
      const samePhone = digits && normalizeDigits(String(feedback.clientPhone || '')).replace(/\D/g, '') === digits;
      const sameName = name && normalizeArabicText(String(feedback.clientName || '')) === name;
      if (!samePhone && !sameName) continue;
      const fbText = cleanCommentText(feedback.feedback);
      if (!fbText || isSystemOnlyText(fbText)) continue;
      list.push({
        id: `fb-${feedback.id}`,
        at: feedback.date || feedback.createdAt,
        text: fbText,
        by: nameOfUser(feedback.userId),
        status: feedback.status,
        kind: 'feedback',
        result: feedback.callStatus,
      });
    }

    // سجل المكالمات: فيه كلام المندوب بنفسه (نص المكالمة) — وده مصدر الكومنتات
    // القديمة. النص الآلي (لوج) بيتشال، ونفس الكومنت بيتدمج مرة واحدة.
    for (const log of callLogs || []) {
      const logPhone = normalizeDigits(String(log?.clientPhone || '')).replace(/\D/g, '');
      if (!digits || logPhone !== digits) continue;
      const logText = cleanCommentText(log?.comment);
      if (!logText || isSystemOnlyText(logText)) continue;
      list.push({
        id: `log-${log?.id}`,
        at: String(log?.createdAt || ''),
        text: logText,
        by: String(log?.salesName || '') || nameOfUser(log?.userId || log?.salesId),
        kind: 'call',
        result: log?.result,
      });
    }

    // ===== كل كومنت يظهر مرة واحدة فقط =====
    // نفس الكلام بينكتب في أكتر من مكان (حدث على العميل + بطاقة فيدباك في «الفيدباك
    // اليومي»)، فكان نفس الكومنت بيتكرّر مرتين أو ثلاث. هنا ندمجهم في سطر واحد.
    return dedupeComments(list).sort((a, b) => String(b.at).localeCompare(String(a.at)));
  }, [client, feedbacks, callLogs, users]);

  const days = useMemo(() => {
    const map = new Map<string, typeof entries>();
    for (const entry of entries) {
      const date = new Date(entry.at);
      const key = Number.isNaN(date.getTime())
        ? 'غير معروف'
        : date.toLocaleDateString('ar-EG', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
      map.set(key, [...(map.get(key) || []), entry]);
    }
    return Array.from(map.entries());
  }, [entries]);

  const kindLabel = (kind: string): string => {
    if (kind === 'call') return 'مكالمة';
    if (kind === 'feedback') return 'فيدباك';
    if (kind === 'note') return 'ملاحظة';
    if (kind === 'reminder') return 'تذكير';
    return 'تعليق';
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[80] flex items-center justify-center p-3 sm:p-4 bg-black/85"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.96, y: 10 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.96, y: 10 }}
        className="panel w-full max-w-2xl max-h-[92vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 p-4 border-b border-[var(--border)]">
          <div className="flex items-center gap-3 min-w-0">
            <span className="w-11 h-11 rounded-full gradient-primary flex items-center justify-center shrink-0 font-bold text-[var(--text-strong)]">
              {String(client?.name || '؟').trim().charAt(0)}
            </span>
            <div className="min-w-0">
              <h2 className="font-bold text-[var(--text-strong)] truncate">{client?.name || 'عميل'}</h2>
              <p className="text-xs text-[var(--text-muted)]" dir="ltr">{client?.phone || ''}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className="chip">{entries.length} تعليق</span>
            <button type="button" onClick={onClose} title="إغلاق" className="icon-btn !w-9 !h-9">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {entries.length === 0 && (
            <div className="text-center py-12 text-sm text-[var(--text-dim)]">
              لا توجد تعليقات أو مكالمات مسجّلة لهذا العميل بعد.
            </div>
          )}
          {days.map(([day, dayEntries]) => (
            <div key={day}>
              <p className="text-[11px] font-bold text-[var(--text-dim)] mb-2 sticky top-0 bg-[var(--surface)] py-1">
                {day}
              </p>
              <div className="space-y-2">
                {(dayEntries as typeof entries).map((entry) => (
                  <div key={entry.id} className="rounded-[var(--r-md)] border border-[var(--border)] bg-[var(--tint-1)] p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-[var(--tint-2)] text-[var(--text-muted)]">
                          {kindLabel(entry.kind)}
                        </span>
                        {entry.status && <FeedbackChip status={entry.status} />}
                        {entry.result && entry.result !== 'not-called' && (
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${entry.result === 'answered' ? 'bg-emerald-500/15 text-emerald-300' : 'bg-red-500/15 text-red-300'}`}>
                            {entry.result === 'answered' ? 'تم الرد' : entry.result === 'busy' ? 'مشغول' : 'لم يرد'}
                          </span>
                        )}
                      </div>
                      <span className="text-[10px] text-[var(--text-dim)]">
                        {formatDateTime(entry.at)}
                        {entry.by ? ` • ${entry.by}` : ''}
                      </span>
                    </div>
                    <p className="text-sm text-[var(--text)] leading-relaxed whitespace-pre-wrap">
                      {String(entry.text).replace(/^فيدباك:\s*/, '').replace(/^من المكالمة:\s*/, '')}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </motion.div>
    </motion.div>
  );
}

// ===== قائمة العملاء: وضعان (شريط / كروت مكدسة) + شرائح حالة ملونة + الأرقام الجديدة =====
// قائمة العملاء للمندوب: الأرقام الواردة من الإدارة + عملاؤه في **قائمة واحدة** بلا أي تقسيم،
// وكل كارت يحمل شريطاً لونياً وشارة توضح مصدر العميل (Facebook / Campaign / External…)
// مع صندوق اختيارات سريع جمب الاسم: new / follow up / closed deal.
function ClientsView({ currentUser, clients, users = [], leads = [], callLogs = [], feedbacks = [], alertMap, nextActionMap, searchTerm, onSearch, onSelect, onAdd, onAddNumber, onCall, onLeadViewed, onSetStage, onRefresh }: any) {
  const [view, setView] = useState<'cards' | 'table'>(() => (localStorage.getItem('crm_clients_view') === 'table' ? 'table' : 'cards'));
  const [showComments, setShowComments] = useState(false);
  const [commentsClient, setCommentsClient] = useState<Client | null>(null);
  // صندوق الفيدباك: حالة إلزامية + كومنت إلزامي — لا يُحفظ فيدباك ناقص
  const [composer, setComposer] = useState<{ key: string; clientId: string; status: string } | null>(null);
  const [commentText, setCommentText] = useState('');
  // سبب الإلغاء — يُطلب مع حالة «cancellation» فقط
  const [cancelReason, setCancelReason] = useState('');
  const [savingFeedback, setSavingFeedback] = useState(false);
  const [syncError, setSyncError] = useState('');
  // فلتر الإلغاء في القائمة (أيقونة الفلتر بجوار البحث)
  const [cancelFilter, setCancelFilter] = useState('');
  const [showCancelFilter, setShowCancelFilter] = useState(false);
  // ملاحظة: كومنت الفيدباك المباشر (علامة +) وصندوق الحالة بقوا جوّه الكارت
  // نفسه (ClientFeedbackCard) — فالكارت واحد في تبويب العملاء وفي المراحل
  // وفي صفحة الحالة، وبما فيهم كارت العرض الجدولي.

  // فتح الصندوق: بضغطة على حالة في الشريط (تتحدد تلقائياً) أو من زر الكومنت
  const openComposer = (client: Client, status?: string) => {
    const picked = status || latestFeedbackStatusOf(client) || '';
    setComposer({ key: `client-${client.id}`, clientId: client.id, status: picked });
    // سبب الإلغاء المحفوظ سابقاً يرجع كما هو، والكومنت يُكتب منه تلقائياً
    const keptReason = picked === 'cancellation' ? latestCancelReasonOf(client) : '';
    setCancelReason(keptReason);
    setSyncError('');
    // «no answer» تعني حرفياً لا يوجد رد — تُكتب في الكومنتات تلقائياً (ويمكن للشخص تعديلها)
    setCommentText(
      picked === 'no-answer' ? NO_ANSWER_COMMENT : picked === 'cancellation' ? cancelReasonLabelOf(keptReason) : ''
    );
  };

  const closeComposer = () => {
    setComposer(null);
    setCommentText('');
    setCancelReason('');
    setSyncError('');
  };

  const submitFeedback = async () => {
    const text = commentText.trim();
    if (!composer || !text || savingFeedback) return;
    const target = (clients || []).find((c: Client) => c.id === composer.clientId);
    // الحالة مش إلزامي تتغير في كل فيدباك: لو المستخدم ما اختارش، الفيدباك
    // بيتحفظ على **حالة آخر فيدباك** زي ما هي — فيبقى الشريط محفوظ زي ما هو.
    const statusId = composer.status || (target ? latestFeedbackStatusOf(target) : '') || '';
    const status = statusId ? FEEDBACK_STATUS_BY_ID[statusId] : null;
    // حالة الإلغاء بلا سبب لا تُحفظ — القائمة المنسدلة للسبب إلزامية
    if (statusId === 'cancellation' && !cancelReason) return;
    // الفيدباك = كومنت + حالة، وينزل في الخط الزمني فيظهر في خانة الكومنتات (الفيدباك)
    addClientActivity(composer.clientId, 'feedback', text, currentUser?.name || '', {
      authorId: currentUser?.id,
      ...(statusId ? { status: statusId } : {}),
      // سبب الإلغاء يُسجَّل مع الحدث وعلى العميل — فلتر القائمة يقرأه
      ...(statusId === 'cancellation' && cancelReason ? { cancelReason } : {}),
      // «no answer» تعني مكالمة بلا رد — فتظهر هكذا في الفيدباك اليومي أيضاً
      callStatus: statusId === 'no-answer' ? 'no-answer' : 'called',
    });
    // المرحلة تتحرك تلقائياً مع الحالة (مثل الشريط القديم) فلا يحتاج أحد لضغطة ثانية
    if (target && status?.stage && target.stage !== status.stage) onSetStage?.(target.id, status.stage);
    // انتظار الرفع: بدون ذلك يبقى الفيدباك على جهاز السيلز ولا يظهر للإدارة
    setSavingFeedback(true);
    const [clientsOk, feedbackOk] = await Promise.all([
      pushKey('crm_clients'),
      pushKey('crm_daily_feedback'),
    ]);
    setSavingFeedback(false);
    if (!(clientsOk && feedbackOk)) {
      setSyncError('اتسجل على الشاشة دي لكن ماوصلش لقاعدة البيانات — تأكد من الاتصال واضغط «حفظ» تاني.');
      return;
    }
    closeComposer();
    onRefresh?.();
  };

  // صندوق الفيدباك: حالة + كومنت، والحفظ يتوقّف حتى يكتمل الاثنان
  const FeedbackComposer = () => {
    if (!composer) return null;
    const status = FEEDBACK_STATUS_BY_ID[composer.status];
    return (
      <form
        className="feedback-composer"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => { e.preventDefault(); submitFeedback(); }}
      >
        <StatusMenu
          value={composer.status}
          label="اختر حالة الفيدباك"
          className="fc-status-menu"
          stopPropagation={false}
          onPick={(optionId) => {
            setComposer({ ...composer, status: optionId });
            if (optionId === 'cancellation') {
              // لا نكتب كومنت قبل اختيار السبب — سببه هو الكومنت
              setCancelReason('');
              setCommentText('');
              return;
            }
            setCancelReason('');
            if (optionId === 'no-answer' && !commentText.trim()) setCommentText(NO_ANSWER_COMMENT);
          }}
        />
        {composer.status === 'cancellation' && (
          <CancelReasonPicker
            value={cancelReason}
            onChange={(reason) => {
              setCancelReason(reason);
              // اختيار السبب يكتب الكومنت فوراً — نفس سلوك «no answer»
              setCommentText(reason ? cancelReasonLabelOf(reason) : '');
            }}
          />
        )}
        <div className="fc-row">
          <input
            autoFocus
            value={commentText}
            onChange={(e) => setCommentText(e.target.value)}
            placeholder={status ? `اكتب كومنت «${status.label}» — إلزامي ليُحفظ الفيدباك` : 'اختر حالة الفيدباك ثم اكتب الكومنت'}
            className="quick-comment-input"
          />
          <button type="submit" disabled={savingFeedback || !commentText.trim() || (composer.status === 'cancellation' && !cancelReason)}
            title={composer.status === 'cancellation' && !cancelReason ? 'اختر سبب الإلغاء' : 'حفظ الفيدباك (الكومنت والحالة)'}>
            {savingFeedback ? '…' : 'حفظ'}
          </button>
          <button type="button" title="إلغاء" onClick={closeComposer}>✕</button>
        </div>
        <p className={syncError ? 'fc-hint fc-sync-error' : 'fc-hint'}>
          {syncError
            ? syncError
            : composer.status === 'cancellation' && !cancelReason
            ? 'اختر سبب الإلغاء — والكومنت هيتكتب تلقائياً'
            : status
            ? `الحالة: ${status.label} — ${status.ar} (هتتحفظ زي ما هي لو ما غيّرتهاش)`
            : 'اكتب الكومنت — والحالة هتتحفظ زي آخر فيدباك على العميل'}
        </p>
      </form>
    );
  };

  const switchView = (v: 'cards' | 'table') => {
    setView(v);
    localStorage.setItem('crm_clients_view', v);
  };

  // بحث واحد يشمل الأرقام والعملاء معاً
  const q = normalizeArabicText(searchTerm || '').trim();
  const digitsOf = (value: any) => normalizeDigits(String(value || '')).replace(/\D/g, '');
  // الرقم اللي اتحوّل لعميل ما يتكررش ككارت رقم
  const clientPhones = new Set((clients || []).map((c: Client) => digitsOf(c.phone)).filter(Boolean));
  const baseLeads = (leads || []).filter((l: AssignedLead) => l.status !== 'closed' && !clientPhones.has(digitsOf(l.phone)));

  // ===== فلتر الإلغاء =====
  // عند اختيار سبب (أو «كل حالات الإلغاء») تظهر الأرقام الملغاة بسببها فقط؛
  // والأرقام الواردة التي لم تُحوّل لعميل لا علاقة لها بالإلغاء فتختفي.
  // إلغاء الأرقام الموزّعة محفوظ في بطاقات الفيدباك/المكالمات بالهاتف، فيُقرأ من فهرس
  // الهاتف كي يشمل الفلتر كل الأرقام — لا العملاء المسجّلين فقط.
  const phoneSnapshots = feedbackByPhone(feedbacks, callLogs, users);
  const leadCancelReasonOf = (lead: AssignedLead) =>
    String(phoneSnapshots.get(digitsOf(lead.phone))?.cancelReason || '');
  const leadIsCancelled = (lead: AssignedLead) =>
    String(phoneSnapshots.get(digitsOf(lead.phone))?.status || '') === 'cancellation' ||
    !!leadCancelReasonOf(lead);
  const cancelCounts = (() => {
    const byReason: Record<string, number> = {};
    let total = 0;
    for (const c of clients || []) {
      if (latestFeedbackStatusOf(c) !== 'cancellation') continue;
      total += 1;
      const reason = latestCancelReasonOf(c);
      if (reason) byReason[reason] = (byReason[reason] || 0) + 1;
    }
    for (const lead of baseLeads) {
      if (!leadIsCancelled(lead)) continue;
      total += 1;
      const reason = leadCancelReasonOf(lead);
      if (reason) byReason[reason] = (byReason[reason] || 0) + 1;
    }
    return { byReason, total };
  })();
  const cancelMatch = (c: Client) => {
    if (!cancelFilter) return true;
    if (latestFeedbackStatusOf(c) !== 'cancellation') return false;
    return cancelFilter === 'any' || latestCancelReasonOf(c) === cancelFilter;
  };
  const cancelMatchLead = (lead: AssignedLead) => {
    if (!cancelFilter) return true;
    if (!leadIsCancelled(lead)) return false;
    return cancelFilter === 'any' || leadCancelReasonOf(lead) === cancelFilter;
  };
  const cancelFilterLabel = !cancelFilter
    ? ''
    : cancelFilter === 'any'
    ? 'كل حالات الإلغاء'
    : `${CANCEL_REASON_BY_ID[cancelFilter]?.label || ''} — ${CANCEL_REASON_BY_ID[cancelFilter]?.ar || ''}`;

  const visibleLeads = (q
    ? baseLeads.filter((l: AssignedLead) =>
        normalizeArabicText(`${l.name} ${l.phone} ${l.description || ''}`).includes(q)
      )
    : baseLeads
  ).filter(cancelMatchLead);
  const visibleClients = (q
    ? (clients || []).filter((c: Client) =>
        normalizeArabicText(`${c.name} ${c.phone} ${(c.phones || []).join(' ')} ${c.property || ''} ${c.source || ''}`).includes(q)
      )
    : (clients || [])
  ).filter(cancelMatch);

  // ===== قائمة موحّدة: الأرقام والعملاء مرصوصون معاً بالأحدث أولاً =====
  type FeedItem =
    | { kind: 'lead'; at: string; lead: AssignedLead }
    | { kind: 'client'; at: string; client: Client };
  const feed: FeedItem[] = useMemo(() => {
    const items: FeedItem[] = [
      ...visibleLeads.map((lead: AssignedLead) => ({ kind: 'lead' as const, at: lead.createdAt || '', lead })),
      ...visibleClients.map((client: Client) => ({ kind: 'client' as const, at: client.updatedAt || client.createdAt || '', client })),
    ];
    return items.sort((a, b) => String(b.at).localeCompare(String(a.at)));
  }, [visibleLeads, visibleClients]);

  return (
    <div className="space-y-4">
      {/* شريط البحث + الأدوات */}
      <div className="flex flex-col md:flex-row gap-3">
        <div className="flex-1 relative">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4.5 h-4.5 text-[var(--text-muted)]" />
          <input type="text" placeholder="ابحث بالاسم أو الرقم أو العقار أو المبلغ (مثال: مليون)" value={searchTerm} onChange={(e) => onSearch(e.target.value)}
            className="w-full bg-[var(--tint-1)] border border-[var(--border)] rounded-[var(--r-sm)] pr-10 pl-4 py-2.5 text-[13.5px] text-[var(--text-strong)]" />
        </div>
        {/* أدوات القائمة: تلتف على الهاتف الضيق (320px) بدل ما تخرج من الشاشة */}
        <div className="flex flex-wrap items-center gap-2">
          {/* ===== فلتر الإلغاء: أيقونة + لوحة أسباب ===== */}
          <button
            type="button"
            onClick={() => setShowCancelFilter((v) => !v)}
            className={`icon-btn !w-10 !h-10 relative ${cancelFilter ? 'is-on' : ''}`}
            title="فلتر الإلغاء — اعرض الأرقام حسب سبب الإلغاء"
            aria-expanded={showCancelFilter}
            aria-label="فلتر الإلغاء"
          >
            <Filter className="w-4 h-4" />
            {cancelCounts.total > 0 && (
              <span className="cf-badge">{cancelCounts.total > 99 ? '99+' : cancelCounts.total}</span>
            )}
          </button>
          {/* أيقونتان لتحديد شكل العرض */}
          <div className="view-toggle">
            <button className={view === 'cards' ? 'on' : ''} onClick={() => switchView('cards')} title="مربعات (شكل قديم محفوظ)"><LayoutList className="w-4 h-4" /></button>
            <button className={view === 'table' ? 'on' : ''} onClick={() => switchView('table')} title="جدول بأعمدة"><Rows className="w-4 h-4" /></button>
          </div>
          <button onClick={() => setShowComments(true)}
            className="flex items-center gap-1.5 text-[11.5px] font-semibold text-amber-300 border border-amber-400/30 rounded-[var(--r-sm)] px-2.5 py-2.5 shrink-0"
            title="يعرض كل التعليقات وعددها وزرار التلخيص للـ CEO">
            <MessageSquare className="w-4 h-4" /> <span className="hidden min-[380px]:inline">كل التعليقات</span>
          </button>
          {/* السيلز يضيف رقمه بنفسه: ينزل في «أرقام جديدة» باسمه بلا اختيار مندوب */}
          {onAddNumber && (
            <button onClick={onAddNumber}
              className="text-[11.5px] font-bold text-[var(--text)] bg-[var(--tint-1)] border border-[var(--border)] rounded-[var(--r-sm)] px-3 py-2.5 hover:bg-[var(--tint-2)] inline-flex items-center gap-1.5"
              title="رقم جديد ينزل باسمك أنت مباشرة">
              <Plus className="w-3.5 h-3.5" /> إضافة رقم
            </button>
          )}
          <button onClick={onAdd} className="btn-primary shrink-0">
            <Plus className="w-4 h-4" /> <span>إضافة عميل</span>
          </button>
        </div>
      </div>

      {/* ===== لوحة فلتر الإلغاء ===== */}
      {showCancelFilter && (
        <div className="cancel-filter-panel">
          <div className="cfp-head">
            <span className="cfp-title"><Filter className="w-3.5 h-3.5" /> فلترة الأرقام حسب الإلغاء</span>
            <button type="button" className="cfp-close" onClick={() => setShowCancelFilter(false)} title="إغلاق الفلتر">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="cfp-list">
            <button
              type="button"
              className={`cfp-item${!cancelFilter ? ' on' : ''}`}
              onClick={() => { setCancelFilter(''); setShowCancelFilter(false); }}
            >
              <span className="cfp-dot" />
              <span className="cfp-name">كل الأرقام</span>
              <b>{(clients || []).length + baseLeads.length}</b>
            </button>
            <button
              type="button"
              className={`cfp-item${cancelFilter === 'any' ? ' on' : ''}`}
              onClick={() => { setCancelFilter('any'); setShowCancelFilter(false); }}
            >
              <span className="cfp-dot danger" />
              <span className="cfp-name">كل حالات الإلغاء</span>
              <b>{cancelCounts.total}</b>
            </button>
            <span className="cfp-sep" />
            {CANCEL_REASONS.map((reason) => (
              <button
                key={reason.id}
                type="button"
                className={`cfp-item${cancelFilter === reason.id ? ' on' : ''}`}
                onClick={() => { setCancelFilter(reason.id); setShowCancelFilter(false); }}
                title={reason.ar}
              >
                <span className="cfp-dot" />
                <span className="cfp-name">{reason.label} <small>{reason.ar}</small></span>
                <b>{cancelCounts.byReason[reason.id] || 0}</b>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* سطر ملخص واحد — بلا أي تقسيم للقائمة */}
      <div className="clients-summary">
        <span>الإجمالي: <b>{feed.length}</b></span>
        {cancelFilter ? (
          <span className="cs-cancel">
            <i>فلتر:</i> {cancelFilterLabel}
            <button type="button" onClick={() => setCancelFilter('')} title="مسح فلتر الإلغاء">
              مسح <X className="w-3 h-3" />
            </button>
          </span>
        ) : (
          <span className="cs-dim">مرتبة بالأحدث أولاً</span>
        )}
      </div>

      {/* قائمة واحدة: الأرقام الواردة والعملاء مرصوصون معاً */}
      {feed.length === 0 ? (
        <div className="text-center py-16">
          <Users className="w-14 h-14 text-[var(--text-dim)] mx-auto mb-3" />
          <p className="text-[var(--text-muted)] text-sm">
            {q
              ? 'لا نتائج مطابقة للبحث'
              : cancelFilter
              ? 'لا توجد أرقام ملغاة بهذا السبب'
              : 'لا يوجد عملاء بعد — أضف عميلاً وسيظهر هنا فوراً'}
          </p>
        </div>
      ) : view === 'table' ? (
        /* ===== العرض الجدولي: عمود لكل معلومة — شكل الجدول النظيف ===== */
        <div className="clients-table-wrap glass-card">
          <div className="clients-table" role="table">
            <div className="ct-head" role="row">
              <span>العميل</span>
              <span>الهاتف</span>
              <span>المصدر</span>
              <span>الميزانية</span>
              <span>الفيدباك</span>
              <span>الكومنتات</span>
              <span></span>
            </div>
            {feed.map((item) => {
              const isLead = item.kind === 'lead';
              const lead = isLead ? (item as any).lead as AssignedLead : null;
              const client = !isLead ? (item as any).client as Client : null;
              const name = isLead ? (lead!.name || 'بدون اسم') : client!.name;
              const phone = isLead ? lead!.phone : client!.phone;
              const src = SOURCE_KINDS[sourceKindOf(isLead ? lead!.description : `${client!.source} ${client!.status}`)];
              const SrcIcon = src.Icon;
              const sourceText = isLead ? (formatLeadDescription(lead!.description) || 'رقم وارد') : sourceLabelOf(client);
              const comments = isLead ? 0 : commentCountOf(client);
              const last = isLead ? null : lastCommentOf(client);
              const open = composer?.key === (isLead ? `lead-${lead!.id}` : `client-${client!.id}`);
              return (
                <Fragment key={isLead ? `lead-${lead!.id}` : `client-${client!.id}`}>
                  <div
                    role="row"
                    className={`ct-row ${src.cls}`}
                    onClick={() => (isLead ? onLeadViewed?.(lead!.id) : onSelect(client))}
                  >
                    <span role="cell" className="ct-name">
                      <i className="ct-avatar">{name?.[0] || '#'}</i>
                      <b>{name}</b>
                      {client?.stage === 'lost' && <span className="st-chip st-lost">ضائع</span>}
                      {isLead && leadIsCancelled(lead!) && (
                        <span className="st-chip st-lost" title="سبب الإلغاء">
                          إلغاء{leadCancelReasonOf(lead!) ? ` · ${CANCEL_REASON_BY_ID[leadCancelReasonOf(lead!)]?.label || ''}` : ''}
                        </span>
                      )}
                    </span>
                    <span role="cell" className="ct-phone">
                      <button type="button" dir="ltr"
                        onClick={(e) => { e.stopPropagation(); onCall?.(isLead ? leadCallTarget(lead) : client); }}>{phone}</button>
                      <FormNameChip record={isLead ? lead : client} />
                      <CampaignTimeChip
                        at={campaignTimeOf(isLead ? lead : client).at}
                        kind={campaignTimeOf(isLead ? lead : client).kind}
                      />
                    </span>
                    <span role="cell">
                      <span className={`cc-src ${src.cls}`} title={sourceText}><SrcIcon className="w-3 h-3" />{sourceText}</span>
                    </span>
                    <span role="cell" className="ct-budget">{(!isLead && client!.budget) ? displayPrice(client!.budget) : '—'}</span>
                    <span role="cell">
                      {!isLead ? (
                        hasContactedClient(client) ? (
                          <FeedbackBar client={client} onPick={(statusId: string) => openComposer(client!, statusId)} />
                        ) : (
                          <span className="ct-dim">لسه ما اتواصَلش</span>
                        )
                      ) : (
                        <span className="ct-dim">{lead!.status === 'new' ? 'رقم وارد' : 'تم فتحه'}</span>
                      )}
                    </span>
                    <span role="cell" className="ct-comments">
                      <button
                        type="button"
                        title="الكومنتات وخط العميل الزمني"
                        onClick={(e) => { e.stopPropagation(); if (!isLead) setCommentsClient(client); }}
                      >
                        <MessageSquare className="w-3.5 h-3.5" />
                        <b>{comments}</b>
                      </button>
                    </span>
                    <span role="cell" className="ct-acts" onClick={(e) => e.stopPropagation()}>
                      {isLead ? (
                        <>
                          <button type="button" onClick={() => onCall?.(leadCallTarget(lead!))}
                            className="icon-btn !w-8 !h-8 text-emerald-300" title="الاتصال بالعميل (تسجيل: رد / لم يرد)"><PhoneCall className="w-3.5 h-3.5" /></button>
                        </>
                      ) : (
                        <>
                          {/* زر «إضافة كومنت» الأصفر اتشال: الكومنت بيتكتب بعد المكالمة
                              من شريط الحالات نفسه، فما بقاش له ضرورة هنا. */}
                          <button type="button" onClick={() => onCall?.(client)} title="الاتصال بالعميل"
                            className="icon-btn !w-8 !h-8 text-emerald-300"><PhoneCall className="w-3.5 h-3.5" /></button>
                          <WhatsAppButton name={client!.name} phones={[client!.phone, ...(client!.phones || [])]} />
                        </>
                      )}
                    </span>
                  </div>
                  {open && !isLead && <FeedbackComposer />}
                  {!open && !isLead && last?.text && (
                    <div className="ct-lastnote" onClick={() => onSelect(client)}>
                      <FeedbackChip status={last.status} alert={!!alertMap?.get(digitsOfPhone(client?.phone))} />
                      {' '}آخر ملاحظة{commentAuthorName(last, users) ? ` — ${commentAuthorName(last, users)}` : ''}: {last.text}
                    </div>
                  )}
                </Fragment>
              );
            })}
          </div>
        </div>
      ) : (
        /* ===== عرض المربعات (الافتراضي): كروت بعرضين على الكمبيوتر وعمود واحد على الهاتف ===== */
        <div className="clients-grid">
          {feed.map((item) => {
            const isLead = item.kind === 'lead';
            const lead = isLead ? (item as any).lead as AssignedLead : null;
            const client = !isLead ? (item as any).client as Client : null;
            // ===== كارت واحد في كل مكان =====
            // نفس كارت تبويب «العملاء» بالظبط في «المراحل» وصفحة الحالة
            // (follow up وغيره) — فمفيش شكل قديم ولا شكل تاني في النظام.
            return isLead ? (
              <LeadFeedCard
                key={`lead-${lead!.id}`}
                lead={lead}
                record={item}
                nextActionMap={nextActionMap}
                onLeadViewed={onLeadViewed}
                onCall={onCall}
                cancelled={leadIsCancelled(lead!)}
                cancelReason={leadCancelReasonOf(lead!)}
              />
            ) : (
              <ClientFeedbackCard
                key={`client-${client!.id}`}
                client={client}
                currentUser={currentUser}
                users={users}
                alertMap={alertMap}
                nextActionMap={nextActionMap}
                onSelect={onSelect}
                onOpenComments={() => setCommentsClient(client)}
                onSetStage={onSetStage}
                onRefresh={onRefresh}
                onCall={onCall}
              />
            );
          })}
        </div>
      )}

      <AnimatePresence>
        {showComments && <CommentsBoardModal clients={clients} callLogs={callLogs} onClose={() => setShowComments(false)} />}
        {commentsClient && (
          <ClientCommentsModal client={commentsClient} users={users} callLogs={callLogs} feedbacks={feedbacks} onClose={() => setCommentsClient(null)} />
        )}
      </AnimatePresence>
    </div>
  );
}

// Pipeline View
// ===== تبويب المراحل للإدارة: اسم السيلز ← أرقامه وعدد كومنتات كل رقم ← ضغطة على الرقم تفتح الكومنتات =====
function AdminPipelineView({ clients, users, currentUser, onUpdateStage, onSelectClient, onAddFeedback }: any) {
  const quick = [
    { id: 'new', label: 'new', cls: 'qs-new' },
    { id: 'followup', label: 'follow up', cls: 'qs-follow' },
    { id: 'closed', label: 'closed deal', cls: 'qs-closed' },
  ];
  const stageOfQuick = (q: string) => (q === 'closed' ? 'closed' : q === 'followup' ? 'contacted' : 'new');
  const salesUsers = users.filter((u: User) => ['sales', 'supervisor'].includes(effectiveRoleOf(u)));
  const [openUser, setOpenUser] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const q = normalizeArabicText(query).trim();

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <div className="page-intro"><div><h2>المراحل — لكل سيلز</h2></div></div>
          <p className="text-xs text-[var(--text-muted)] mt-1">اضغط اسم السيلز لعرض أرقامه وعدد الكومنتات، واضغط أي رقم لفتح كومنتاته</p>
        </div>
        <div className="relative">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-muted)]" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="ابحث عن سيلز أو عميل..."
            className="w-full sm:w-56 bg-[var(--tint-1)] border border-[var(--border)] rounded-[var(--r-md)] pr-9 pl-3 py-2.5 text-[var(--text-strong)] text-sm" />
        </div>
      </div>

      {salesUsers.map((user: User) => {
        const all = clients.filter((c: Client) => c.userId === user.id || c.assignedTo === user.id);
        const userClients = q
          ? all.filter((c: Client) => normalizeArabicText(`${c.name} ${c.phone}`).includes(q))
          : all;
        const totalComments = all.reduce((sum: number, c: Client) => sum + commentCountOf(c), 0);
        const isOpen = openUser === user.id || (openUser === null && !q && all.length > 0 && salesUsers.filter((u: User) => (clients.filter((c: Client) => c.userId === u.id || c.assignedTo === u.id)).length > 0).length === 1);
        return (
          <div key={user.id} className={`pipe-user ${isOpen ? 'open' : ''}`}>
            <button type="button" onClick={() => setOpenUser(isOpen ? null : user.id)}
              className="pipe-user-head">
              <i className="pipe-avatar">{user.name?.[0] || '?'}</i>
              <span className="pipe-who">
                <b>{user.name}</b>
                <small>{rankLabel(user.role)} • {all.length} عميل • {totalComments} كومنت</small>
              </span>
              <span className="pipe-chev">{isOpen ? '▲' : '▼'}</span>
            </button>
            {isOpen && (
              <div className="pipe-list">
                {userClients.length === 0 ? (
                  <p className="text-sm text-[var(--text-dim)] text-center py-4">{all.length === 0 ? 'لا يوجد عملاء لهذا السيلز بعد' : 'لا نتائج مطابقة للبحث'}</p>
                ) : (
                  userClients.map((client: Client) => {
                    const src = SOURCE_KINDS[sourceKindOf(`${client.source} ${client.status}`)];
                    const comments = commentCountOf(client);
                    // آخر كومنت حقيقي (مش آخر حدث — الحدث ممكن يكون لوج اتصال)
                    const last = lastCommentOf(client);
                    const lastAuthor = commentAuthorName(last, users);
                    const cur = quickStageOf(client.stage);
                    return (
                      <div key={client.id} className={`pipe-client ${src.cls}`}>
                        <button type="button" className="pipe-client-main" onClick={() => onSelectClient?.(client)}
                          title="فتح كومنتات العميل والخط الزمني">
                          <i className="pipe-c-avatar">{client.name?.[0] || '#'}</i>
                          <span className="pipe-c-info">
                            <b>{client.name}</b>
                            <small dir="ltr">{client.phone}</small>
                            <small className="pipe-c-note">{last?.text ? `آخر كومنت${lastAuthor ? ` — ${lastAuthor}` : ''}: ${last.text}` : 'لا كومنتات بعد'}</small>
                          </span>
                          <span className="comments-pill"><MessageSquare className="w-3.5 h-3.5" /><b>{comments}</b></span>
                        </button>
                        <div className="quick-status" onClick={(e) => e.stopPropagation()}>
                          {quick.map((s) => (
                            <button key={s.id} type="button"
                              aria-pressed={cur === s.id}
                              className={`qs-btn ${cur === s.id ? `on ${s.cls}` : ''}`}
                              onClick={() => onUpdateStage?.(client.id, stageOfQuick(s.id))}>
                              {s.label}
                            </button>
                          ))}
                          {/* نفس فيدباك تبويب العملاء (حالة + كومنت) من شاشة المراحل */}
                          <button type="button" className="qs-btn" title="إضافة فيدباك (حالة + كومنت)"
                            onClick={() => onAddFeedback?.(client)}>
                            فيدباك
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </div>
        );
      })}
      {salesUsers.length === 0 && (
        <div className="text-center py-16">
          <Users className="w-16 h-16 text-[var(--text-dim)] mx-auto mb-4" />
          <p className="text-[var(--text-muted)]">لا يوجد سيلز في الفريق</p>
        </div>
      )}
    </div>
  );
}

// ===== كارت الرقم الموزّع: نفس شكل كارت العميل بالظبط =====
// الرقم لسه مش عميل مسجّل (نزل في التوزيع): من غير شريط فيدباك وبلا زر +
// (مالوش عميل بعد يتحمّل الكومنت)، بس بالشكل نفسه — عشان تبويب «المراحل»
// وصفحة الحالة (follow up وغيره) يبانوا زي «العملاء» بالحرف، والرقم بيبان
// بنفس الشكل في كل مكان.
function LeadFeedCard({ lead, record, onLeadViewed, onCall, cancelled = false, cancelReason = '', nextActionMap }: any) {
  const src = SOURCE_KINDS[sourceKindOf(String(lead?.description || record?.note || ''))];
  const SrcIcon = src.Icon;
  const sourceText = formatLeadDescription(lead?.description || '') || 'رقم وارد';
  const name = record?.name || lead?.name || 'بدون اسم';
  const phone = record?.phone || lead?.phone || '';
  const time = campaignTimeOf(lead || record);
  // ===== «الإجراء القادم»: موعد محدد (يوم + ساعة) على كارت الرقم =====
  const nextAction: NextAction | null = nextActionMap?.get(digitsOfPhone(phone)) || null;
  return (
    <motion.article
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ y: -1 }}
      onClick={() => lead && onLeadViewed?.(lead.id)}
      className={`client-card ${src.cls}`}
    >
      <div className="cc-avatar">{String(name || '#').trim().charAt(0) || '#'}</div>

      <div className="cc-body">
        <div className="cc-line">
          <b className="cc-name">{name}</b>
          <span className={`cc-src ${src.cls}`} title={sourceText}>
            <SrcIcon className="w-3 h-3" />
            {sourceText}
          </span>
          {(cancelled || cancelReason) && (
            <span className="st-chip st-lost" title="سبب الإلغاء">
              إلغاء{cancelReason ? ` · ${CANCEL_REASON_BY_ID[cancelReason]?.label || ''}` : ''}
            </span>
          )}
        </div>

        <div className="cc-phone-row">
          <button type="button" className="cc-phone" dir="ltr"
            onClick={(e) => { e.stopPropagation(); onCall?.(leadCallTarget(lead, record)); }}>{phone}</button>
          <FormNameChip record={lead || record} />
          <CampaignTimeChip at={time.at} kind={time.kind} />
        </div>

        <p className="cc-note">
          وصل من {sourceText}{lead?.createdAt ? ` — ${formatDateTime(time.at)}` : ''}
        </p>

        {/* آخر كلام اتكتب على الرقم (قبل ما ينزل) — واسم كاتبه */}
        {record?.note && (
          <p className="cc-lastfb">
            {record?.salesNoteBy && <span className="cc-author">{record.salesNoteBy}</span>}
            <span className="cc-lastfb-text">{record.note}</span>
          </p>
        )}

        {/* ===== «الإجراء القادم» على كارت الرقم (يوم + ساعة) ===== */}
        {nextAction && (
          <p className={`cc-next ${nextAction.overdue ? 'is-late' : ''} ${nextAction.done ? 'is-done' : ''}`} title={nextAction.note || 'الإجراء القادم'}>
            <CalendarClock className="w-3 h-3" />
            <span className="cc-next-label">الإجراء القادم</span>
            <b className="cc-next-time">{formatDateTime(nextAction.at)}</b>
            {nextAction.overdue && <span className="cc-next-late">اتأخر</span>}
            {nextAction.done && <span className="cc-next-done">تم</span>}
          </p>
        )}
      </div>

      <div className="cc-actions" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="comments-pill" title="الرقم لسه في التوزيع — الفيدباك يُكتب بعد تحويله عميلاً">
          <MessageSquare className="w-3.5 h-3.5" />
          <b>0</b>
        </button>
        <button type="button" onClick={() => onCall?.(leadCallTarget(lead, record))}
          className="icon-btn !w-8 !h-8 text-emerald-300" title="الاتصال بالعميل (تسجيل: رد / لم يرد)"><PhoneCall className="w-3.5 h-3.5" /></button>
      </div>
    </motion.article>
  );
}

// ===== الحالات كما في ENGAZ =====
// الأسماء بالإنجليزي زي ما كانت في لوحة «المراحل» (follow up / meeting / done deal)،
// والألوان هي ألوان المراحل نفسها (fs-follow / fs-meeting …).
// «مكالمات باردة» مش حالة فيدباك: هو رقم لسه ما اتصلنا بيه خالص.
// والترتيب هو ترتيب ENGAZ: كل الأرقام، جديد، مكالمات باردة، متابعة، معاينة…
const COLD_CALL_ID = 'cold-call';
const LEAD_STATUS_LABELS: Record<string, string> = {
  '': 'All Leads',
  'fresh-stage': 'Fresh Leads',
  [COLD_CALL_ID]: 'Cold Calls',
  'follow-up': 'Follow Up',
  meeting: 'Meeting',
  'after-meeting': 'Following after Meeting',
  reschedule: 'Reschedule Meeting',
  cancellation: 'Cancellation',
  'no-answer': 'No Answer',
  'done-deal': 'Done Deal',
  reservation: 'Reservation',
};
const LEAD_STATUS_ORDER = [
  'fresh-stage', COLD_CALL_ID, 'follow-up', 'meeting', 'after-meeting',
  'reschedule', 'cancellation', 'no-answer', 'done-deal', 'reservation',
];

// ===== عدّادات لوحة الأرقام (ترتيب ENGAZ — أسماء إنجليزي) =====
// All Leads, Fresh Leads, Cold Calls, Follow Up, Meeting, Following after
// Meeting, Reschedule Meeting, Cancellation, No Answer, Done Deal, Reservation.
const DASH_CARDS: Array<{ id: string; label: string; cls: string }> = [
  { id: '', label: 'All Leads', cls: '' },
  { id: 'fresh-stage', label: 'Fresh Leads', cls: 'fs-fresh' },
  { id: COLD_CALL_ID, label: 'Cold Calls', cls: 'fs-cold' },
  { id: 'follow-up', label: 'Follow Up', cls: 'fs-follow' },
  { id: 'meeting', label: 'Meeting', cls: 'fs-meeting' },
  { id: 'after-meeting', label: 'Following after Meeting', cls: 'fs-after' },
  { id: 'reschedule', label: 'Reschedule Meeting', cls: 'fs-reschedule' },
  { id: 'cancellation', label: 'Cancellation', cls: 'fs-cancel' },
  { id: 'no-answer', label: 'No Answer', cls: 'fs-noanswer' },
  { id: 'done-deal', label: 'Done Deal', cls: 'fs-done' },
  { id: 'reservation', label: 'Reservation', cls: 'fs-reservation' },
];

// ملاحظة الرقم: نص الوصف بدون جزء «التاريخ: …» (الوقت معروض في مكانه)
// ومن غير سطور المصدر والاستيراد (اسم الفورم معروض في مكانه أصلاً).
const leadNoteOf = (record: any): string =>
  String(record?.description || record?.source || '')
    .replace(/^رقم\s*موز[\u064B-\u0652]*ع\s*[—–-]\s*/u, '')
    .split('•')
    .map((part) => part.trim())
    .filter((part) => part && !/^(التاريخ|المصدر)\s*:/.test(part))
    .filter((part) => !/^(استيراد تلقائي|رقم تجريبي)/.test(part))
    .join(' • ');

// ===== توقيت الرقم بالشكل ENGAZ (ميلادي، LTR) =====
// التوقيت المخزَّن هو وقت التسجيل نفسه بتوقيت UTC (كما كتبه السيرفر)،
// فنعرضه بتوقيت UTC باش يطلع بنفس الرقم المسجَّل في الفورم بالظبط.
const campaignStamp = (value?: string): string => {
  const at = Date.parse(String(value || ''));
  if (!value || Number.isNaN(at)) return '';
  const d = new Date(at);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
};

// ===== صف الرقم في صفحة الأرقام =====
type LeadRow = {
  key: string;
  name: string;
  phone: string;
  status: string;
  statusLabel: string;
  statusCls: string;
  dateLabel: string;
  formName: string;
  note: string;
  // اسم كاتب آخر كلام على الرقم — يتبان جنب الملاحظة
  noteBy?: string;
  isLead: boolean;
  // رقم جديد ما اتصلناش فيه خالص (يدخل في فلتر «Cold Calls»)
  cold?: boolean;
  // رقم جديد نازل حالاً (يدخل في فلتر «Fresh Leads»)
  fresh?: boolean;
  // التذكير فات موعده والمندوب مخدش خطوة → الكارت أصفر (مطلوب إجراء)
  alertDue?: string;
  // «الإجراء القادم»: موعد محدد (يوم + ساعة) من التذكير — يتبان على الكارت
  nextActionAt?: string;
  nextActionOverdue?: boolean;
  client?: any;
  lead?: any;
};

// ===== كارت الرقم (موديل ENGAZ) =====
// الحالة بنقطة ملوّنة + وقت التسجيل + الاسم + الرقم + اسم الفورم (زي ما هو)
// + الملاحظة + زرار الاتصال والواتساب. الضغط على الكارت يفتح نافذة الإجراء.
function EngazLeadCard({ row, onOpen, onCall }: { row: LeadRow; onOpen: () => void; onCall: () => void }) {
  const alert = !!row.alertDue;
  return (
    <article className={`eg-card ${alert ? 'cc-alert' : ''}`} onClick={onOpen}>
      <div className="eg-card-top">
        <span className="eg-chip-wrap">
          <span className={`eg-chip ${alert ? 'cc-alert' : row.statusCls}`}>
            <i className="eg-dot" />
            {row.statusLabel}
          </span>
          {alert && (
            <span className="eg-alert-badge" title={`فات وقت التذكير — ${formatDateTime(row.alertDue || '')}`}>
              <AlertTriangle className="w-3 h-3" />
              اتأخر
            </span>
          )}
        </span>
        <span className="eg-date" dir="ltr">{row.dateLabel}</span>
      </div>

      <div className="eg-card-main">
        <div className="eg-name">{row.name}</div>
        <div className="eg-phone" dir="ltr">{row.phone}</div>
        {/* ===== «الإجراء القادم»: التذكير + وقته (يوم + ساعة) ===== */}
        {row.nextActionAt && (
          <div className={`eg-next ${row.nextActionOverdue ? 'is-late' : ''}`}>
            <CalendarClock className="w-3.5 h-3.5 shrink-0" />
            <span className="eg-next-label">Next Action</span>
            <b className="eg-next-time" dir="ltr">{campaignStamp(row.nextActionAt)}</b>
            {row.nextActionOverdue && <span className="eg-next-late">اتأخر</span>}
          </div>
        )}
        {row.note && (
          <p className="eg-note">
            {row.noteBy && <span className="cc-author">{row.noteBy}: </span>}
            {row.note}
          </p>
        )}
      </div>

      <div className="eg-card-side">
        {row.formName && (
          <span className="eg-form" title={`الفورم: ${row.formName}`}>
            <Building2 className="w-3.5 h-3.5 shrink-0" />
            <span translate="no">{row.formName}</span>
          </span>
        )}
        <div className="eg-acts" onClick={(e) => e.stopPropagation()}>
          <button type="button" className="eg-act is-call" title="تسجيل اتصال (رد / لم يرد)"
            onClick={(e) => { e.stopPropagation(); onCall(); }}>
            <PhoneCall className="w-4.5 h-4.5" />
          </button>
          <a className="eg-act is-wa" title="واتساب" dir="ltr" target="_blank" rel="noreferrer"
            href={waLink(row.phone)} onClick={(e) => e.stopPropagation()}>
            <MessageCircle className="w-4.5 h-4.5" />
          </a>
        </div>
      </div>
    </article>
  );
}

// ===== صفحة الأرقام (موديل ENGAZ: Leads) =====
// كل رقم شغّال عليه المندوب في مكان واحد: عميل مسجّل أو رقم موزَّع. فوقه فلاتر
// الحالة (زي ENGAZ)، وضغط أي حالة بيصفّي الأرقام، والضغط على رقم بيفتح نافذة
// الإجراء (الحالة + الكومنت + التذكير + آخر التعليقات).
function LeadsView({
  currentUser, numbers = [], leads = [], callLogs = [], alertMap, nextActionMap, filter = '', onFilter, onOpen, onBack,
}: any) {
  const [query, setQuery] = useState('');
  const [field, setField] = useState<'all' | 'name' | 'phone' | 'form'>('all');

  // كل الأرقام مرة واحدة: العميل بحالته، والرقم الموزَّع بحالة آخر فيدباك عليه
  const rows: LeadRow[] = useMemo(() => {
    const leadByKey = new Map<string, any>();
    for (const lead of leads || []) {
      const key = digitsOfPhone(lead?.phone);
      if (key && !leadByKey.has(key)) leadByKey.set(key, lead);
    }
    const calledKeys = new Set<string>(
      (callLogs || []).map((l: any) => digitsOfPhone(l?.clientPhone)).filter(Boolean)
    );
    const out: LeadRow[] = [];
    for (const n of numbers || []) {
      const client = n?.client;
      const key = digitsOfPhone(n?.phone);
      const lead = n?.leadId
        ? (leads || []).find((l: any) => String(l?.id) === String(n.leadId))
        : leadByKey.get(key);
      const record = client || lead || {};
      const bucket = String(n?.bucket || 'fresh-stage');
      // «Fresh Leads» = رقم نزل حالاً · «Cold Calls» = رقم نزل من زمان وما اتصلناش.
      // والاتنين منفصلين: الرقم الواحد ما بيحسبش في الاتنين.
      const cold = isColdNumber({ ...n, phone: n?.phone || record?.phone, bucket }, calledKeys);
      // «Fresh Leads» = رقم نزل حالاً (مش بارد) · «Cold Calls» = نزل من زمان (مش جديد)
      const fresh = isFreshNumber({ ...n, phone: n?.phone || record?.phone, bucket }, calledKeys);
      const time = campaignTimeOf(record);
      // التذكير فات موعده والمندوب مخدش خطوة → الرقم «محتاج إجراء» (أصفر)
      const alertDue = String(alertMap?.get(digitsOfPhone(n?.phone || record?.phone)) || '');
      // ===== «الإجراء القادم»: أقرب تذكير مفتوح للرقم (يوم + ساعة) =====
      // من التذكير نفسه: لو حطّينا تذكير للعميل/الرقم، يظهر وقته على الكارت.
      const next = nextActionMap?.get(digitsOfPhone(n?.phone || record?.phone)) || null;
      const nextActionAt = String(next?.at || client?.nextActionAt || '');
      const nextActionOverdue = !!next?.overdue;
      out.push({
        key: String(n?.key || key || ''),
        name: String(n?.name || record?.name || 'بدون اسم'),
        phone: String(n?.phone || record?.phone || ''),
        status: cold ? COLD_CALL_ID : bucket,
        statusLabel: cold ? LEAD_STATUS_LABELS[COLD_CALL_ID] : (LEAD_STATUS_LABELS[bucket] || LEAD_STATUS_LABELS['fresh-stage']),
        statusCls: cold ? 'fs-cold' : (FEEDBACK_STATUS_BY_ID[bucket]?.cls || 'fs-fresh'),
        dateLabel: campaignStamp(time.at),
        formName: formNameOf(record),
        note: String(n?.salesNote || '') || leadNoteOf(lead || client || {}),
        noteBy: String(n?.salesNoteBy || ''),
        isLead: !client,
        cold,
        fresh,
        alertDue,
        nextActionAt,
        nextActionOverdue,
        client,
        lead,
      });
    }
    return out;
  }, [numbers, leads, callLogs, alertMap, nextActionMap]);

  // العدّادات: كل الأرقام + كل حالة (الباردة اتفتحت وما اتصلناش — منفصلة عن الجديدة)
  const counts = useMemo(() => {
    const map: Record<string, number> = {};
    for (const row of rows) {
      map[row.status] = (map[row.status] || 0) + 1;
    }
    return map;
  }, [rows]);

  const visible = useMemo(() => {
    let list = rows;
    // «Cold Calls» فلتر خاص: الأرقام القديمة اللي ما اتصلناش فيها
    // «Fresh Leads» فلتر تاني: الأرقام الجديدة اللي نازلة حالاً
    if (filter === COLD_CALL_ID) list = list.filter((row) => row.cold);
    else if (filter === 'fresh-stage') list = list.filter((row) => row.fresh);
    else if (filter) list = list.filter((row) => row.status === filter);
    // المقارنة في دالة مستقلة ومختبَرة: البحث بالحروف للاسم/الفورم وبالأرقام للتليفون
    return list.filter((row) => matchLeadSearch(row, query, field));
  }, [rows, filter, query, field]);

  return (
    <div className="eg-leads">
      {/* ===== العنوان + الرجوع للوحة الأرقام ===== */}
      <div className="eg-leads-head">
        <button type="button" className="eg-back" onClick={onBack} title="رجوع" aria-label="رجوع">
          <ChevronRight className="w-4.5 h-4.5" />
        </button>
        <h3 className="eg-leads-title">{LEAD_STATUS_LABELS[filter] || LEAD_STATUS_LABELS['']}</h3>
        <span className="eg-leads-count">{visible.length}</span>
      </div>

      {/* ===== شريط البحث: نبحث في كل البيانات أو في حقل واحد ===== */}
      <div className="eg-search">
        <select className="eg-search-field" value={field} onChange={(e) => setField(e.target.value as any)}
          aria-label="Search in">
          <option value="all">Lead Info</option>
          <option value="name">Name</option>
          <option value="phone">Phone</option>
          <option value="form">Form</option>
        </select>
        <input className="eg-search-input" value={query} onChange={(e) => setQuery(e.target.value)}
          placeholder="Search…" aria-label="Search leads" />
        <button type="button" className="eg-search-btn" title="Search" aria-label="Search">
          <Search className="w-4.5 h-4.5" />
        </button>
      </div>

      {/* ===== فلاتر الحالة (نفس ترتيب ENGAZ) ===== */}
      <div className="eg-filters nav-scroll">
        <button type="button" className={`eg-filter ${!filter ? 'is-on' : ''}`} onClick={() => onFilter('')}>
          {LEAD_STATUS_LABELS['']} <b>{rows.length}</b>
        </button>
        {LEAD_STATUS_ORDER.map((id) => (
          <button key={id} type="button" className={`eg-filter ${filter === id ? 'is-on' : ''}`}
            onClick={() => onFilter(filter === id ? '' : id)}>
            {LEAD_STATUS_LABELS[id]} <b>{counts[id] || 0}</b>
          </button>
        ))}
      </div>

      {/* ===== الأرقام ===== */}
      <div className="eg-list">
        {visible.length === 0 ? (
          <p className="eg-empty">
            {rows.length === 0 ? 'No leads yet — get leads from the admin or add one yourself.' : 'No leads in this filter.'}
          </p>
        ) : (
          visible.map((row) => (
            <EngazLeadCard
              key={row.key}
              row={row}
              onOpen={() => onOpen(row.client || row.lead, row)}
              onCall={() => onOpen(row.client || row.lead, row)}
            />
          ))
        )}
      </div>
    </div>
  );
}

function PipelineView({ clients, users = [], numbers = [], leads = [], alertMap, nextActionMap, onUpdateStage, currentUser, onSelectClient, onRefresh, onLeadViewed, onCall }: any) {
  // كل رقم في نطاقي: العميل بحالته، والرقم الموزّع بحالة آخر فيدباك عليه.
  // بدون كده أعمدة المراحل كانت تعرض صفراً رغم وجود أرقام في التوزيع.
  // كل بطاقة عميل تحمل نفس كارت تبويب «العملاء» (بشريط الفيدباك بتسع حالات وصندوق
  // الحالة + الكومنت)، فتسجيل الفيدباك وتحرّك المرحلة يتم من هنا مباشرة.
  const clientById = new Map<string, Client>((clients || []).map((c: Client) => [String(c.id), c]));
  const leadById = new Map<string, any>((leads || []).map((l: any) => [String(l.id), l]));
  const stageItems = numbers.length
    ? numbers.map((record: any) => ({
        ...record,
        stage: record.stage,
        client: record.client || (record.clientId ? clientById.get(String(record.clientId)) : undefined),
      }))
    : (clients || []).map((client: Client) => ({ key: client.id, client, stage: client.stage, name: client.name, phone: client.phone }));
  const stages = [
    { id: 'new', label: 'جديد', color: 'stg-new' },
    { id: 'contacted', label: 'تم التواصل', color: 'stg-contacted' },
    { id: 'meeting', label: 'موعد معاينة', color: 'stg-meeting' },
    { id: 'negotiation', label: 'تفاوض', color: 'stg-negotiation' },
    { id: 'closed', label: 'تم البيع', color: 'stg-closed' },
    { id: 'lost', label: 'ضائع', color: 'stg-lost' },
  ];

  return (
    <div className="space-y-6">
      <div className="page-intro"><div><h2>مراحل العملاء</h2></div></div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
        {stages.map((stage) => {
          const stageClients = stageItems.filter((record: any) => record.stage === stage.id);
          return (
            <div key={stage.id} className="panel p-4">
              <div className="flex items-center gap-2.5 pb-3 mb-3 border-b border-[var(--border)]">
                <span className={`w-2 h-2 rounded-full shrink-0 ${stage.color}`} />
                <h3 className="panel-title flex-1">{stage.label}</h3>
                <span className="text-xs font-bold text-[var(--text-muted)] tabular-nums">{stageClients.length}</span>
              </div>
              <div className="space-y-2">
                {stageClients.map((record: any) => (
                  record.client ? (
                    <ClientFeedbackCard
                      key={`client-${record.client.id}`}
                      client={record.client}
                      currentUser={currentUser}
                      users={users}
                      alertMap={alertMap}
                      nextActionMap={nextActionMap}
                      onSelect={onSelectClient}
                      onOpenComments={onSelectClient}
                      onSetStage={onUpdateStage}
                      onRefresh={onRefresh}
                      onCall={onCall}
                    />
                  ) : (
                    <LeadFeedCard
                      key={`lead-${record.leadId || record.key || record.id}`}
                      record={record}
                      lead={leadById.get(String(record.leadId))}
                      nextActionMap={nextActionMap}
                      onLeadViewed={onLeadViewed}
                      onCall={onCall}
                    />
                  )
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ===== شريط التذكير الرنّان: نفس شكل الإشعار الأصلي + أزرار الإسكات والإتمام والتأجيل =====
// ===== بند ٤: صفحة حالة واحدة — كل الأرقام اللي عليها الحالة دي =====
function StatusBoardView({ statusId, users = [], numbers = [], leads = [], alertMap, nextActionMap, currentUser, onClose, onSelect, onSetStage, onRefresh, onLeadViewed, onCall }: any) {
  const meta = FEEDBACK_STATUS_BY_ID[statusId];
  // نفس قاعدة لوحة الحالات: كل رقم بحالته (عميل مسجّل أو رقم في التوزيع)
  const items: any[] = (numbers || []).filter(
    (record: any) => (record.bucket || feedbackBucketOf(record)) === statusId
  );
  const leadById = new Map<string, any>((leads || []).map((l: any) => [String(l.id), l]));
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="status-board">
      <div className="status-board-head">
        <button type="button" onClick={onClose} className="icon-btn" title="رجوع">
          <ChevronLeft className="w-5 h-5" />
        </button>
        <span className={`sb-dot ${meta?.cls || ''}`} />
        <div className="min-w-0 flex-1">
          <h2 className="page-heading">{meta?.ar || meta?.label || 'حالة'}</h2>
          <p className="page-sub">{meta?.label} — {items.length} رقم</p>
        </div>
      </div>

      <div className="status-board-body">
        {items.length === 0 ? (
          <div className="panel p-10 text-center">
            <p className="text-[var(--text-muted)]">مفيش أرقام في الحالة دي لسه</p>
          </div>
        ) : (
          /* نفس كارت تبويب «العملاء» بالحرف: أفاتار + مصدر + شريط الحالات التسعة
             + آخر كومنت + الهاتف + الأزرار — فالرقم هنا يُقرأ ويُسجَّل عليه الفيدباك
             من نفس المكان. أما الرقم الموزّع (لسه مش عميل) فياخد كارت الرقم. */
          <div className="clients-grid">
            {items.map((record: any) =>
              record.client ? (
                <ClientFeedbackCard
                  key={`client-${record.client.id}`}
                  client={record.client}
                  currentUser={currentUser}
                  users={users}
                  alertMap={alertMap}
                  onSelect={onSelect}
                  onOpenComments={onSelect}
                  onSetStage={onSetStage}
                  onRefresh={onRefresh}
                  onCall={onCall}
                />
              ) : (
                <LeadFeedCard
                  key={`lead-${record.leadId || record.key || record.id}`}
                  record={record}
                  lead={leadById.get(String(record.leadId))}
                  nextActionMap={nextActionMap}
                  onLeadViewed={onLeadViewed}
                  onCall={onCall}
                />
              )
            )}
          </div>
        )}
      </div>
    </motion.div>
  );
}

// ===== لوحة المخطط في شاشة الدخول (نفسها في شاشتي الدخول) =====
// مخطط معماري مرسوم خطوطاً: الجدران والقواطع والأبواب والنوافذ وخط القياس.
function LoginPlan({ lines }: { lines: string[] }) {
  return (
    <aside className="login-plan" aria-hidden="true">
      <svg
        className="login-plan-figure"
        viewBox="0 0 400 300"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.2}
        strokeLinecap="square"
      >
        <rect x="20" y="24" width="250" height="180" />
        <rect x="27" y="31" width="236" height="166" />
        <path d="M20 120h70" />
        <path d="M120 120h60" />
        <path d="M180 24v36" />
        <path d="M180 85v119" />
        <path d="M90 120V95" />
        <path d="M90 95a25 25 0 0 1 25 25" />
        <path d="M180 60V40" />
        <path d="M180 40a20 20 0 0 1 20 20" />
        <path d="M60 27.5h50" strokeWidth={4} />
        <path d="M200 27.5h44" strokeWidth={4} />
        <path d="M20 204v28h150v-28" />
        <path d="M20 218h150" strokeDasharray="6 6" />
        {/* خط القياس وسهم الشمال — طبقة القياس هي موضع لون الهوية الوحيد */}
        <g className="plan-accent">
          <path d="M20 256h250" />
          <path d="M20 250v12" />
          <path d="M270 250v12" />
          <path d="M300 24v180" />
          <path d="M294 24h12" />
          <path d="M294 204h12" />
          <circle cx="352" cy="56" r="16" />
          <path d="M352 46v20" />
          <path d="M346 52l6-6 6 6" />
        </g>
      </svg>
      <div className="login-plan-text">
        {lines.map((line, i) => (
          <p key={line} className="login-plan-line">
            {i === 0 && <span className="login-live-dot" />}
            {line}
          </p>
        ))}
      </div>
    </aside>
  );
}

// ===== نافذة الإشعارات والمنبه (تُفتح من زر الجرس في الشريط العلوي) =====
// تحويل تاريخ إلى صيغة حقل datetime-local (بتوقيت الجهاز)
const toLocalInput = (d: Date): string => {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

// ===== الاتصال بالعميل: اتصال ← تم الرد / لم يرد ← كومنت ← موعد الاتصال القادم (تذكير) =====
// ===== نافذة الإجراء (موديل ENGAZ) =====
// تفتح بالضغط على أي رقم: الحالة، موعد الإجراء القادم (تذكير)، نتيجة الاتصال
// (تم الرد / لم يرد)، الكومنت، وآخر التعليقات — وكلها تتحفظ بزر «إضافة إجراء».
function CallFlowModal({ client, user, onClose, onSave, fromReminder = false, comments = [], onOpenDetails }: any) {
  const [result, setResult] = useState<'' | 'answered' | 'no-answer'>('');
  const [comment, setComment] = useState('');
  // الحالة تبدأ بحالة آخر فيدباك على العميل: مش إلزامي يغيّرها مع كل إجراء
  const [status, setStatus] = useState(() => latestFeedbackStatusOf(client) || '');
  // سبب الإلغاء — يُطلب فقط عند اختيار حالة «cancellation»
  const [cancelReason, setCancelReason] = useState('');
  const [nextCallAt, setNextCallAt] = useState('');
  const [dialed, setDialed] = useState(false);
  const [done, setDone] = useState(false);
  const commentRef = useRef<HTMLTextAreaElement>(null);

  // الموعد المقترح: بعد ساعتين لو لم يرد، وبعد يوم لو تم الرد
  const pick = (r: 'answered' | 'no-answer') => {
    setResult(r);
    // في مسار التذكير لا نقترح موعداً جديداً تلقائياً — التذكير الحالي ينتهي،
    // ولو عايز متابعة يحددها بنفسه من حقل الموعد.
    if (!fromReminder) {
      const base = new Date();
      base.setMinutes(base.getMinutes() + (r === 'no-answer' ? 120 : 1440));
      setNextCallAt(toLocalInput(base));
    }
    // «لم يرد» = لا يوجد رد: تُكتب في الكومنتات تلقائياً حتى لا يحتاج المندوب لكتابتها
    if (r === 'no-answer' && !comment.trim()) setComment(NO_ANSWER_COMMENT);
  };

  // الحفظ يتوقّف على النتيجة + الكومنت. الحالة مش إلزامية: لو ما اتغيرتش
  // بتتحفظ زي آخر فيدباك على العميل (نفس قاعدة صندوق الفيدباك).
  const save = () => {
    if (!result) return;
    const statusId = status || latestFeedbackStatusOf(client) || '';
    // إلغاء بلا سبب لا يُحفظ
    if (statusId === 'cancellation' && !cancelReason) return;
    const text =
      comment.trim() ||
      (result === 'no-answer' ? NO_ANSWER_COMMENT : '') ||
      (statusId === 'cancellation' ? cancelReasonLabelOf(cancelReason) : '');
    if (!text) return;
    // الإلغاء ما يسجّلش موعد اتصال قادم — مفيش تواصل تاني ولا تذكير
    const nextAt = statusId === 'cancellation' ? '' : nextCallAt;
    onSave({ result, comment: text, status: statusId, cancelReason, nextCallAt: nextAt });
    setDone(true);
  };

  const copyPhone = async () => {
    try {
      await navigator.clipboard.writeText(String(client?.phone || ''));
    } catch {
      /* المتصفح رافض النسخ — الرقم ظاهر فوق */
    }
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-[75] flex items-end sm:items-center justify-center bg-black/85" onClick={onClose}>
      <motion.div initial={{ scale: 0.98, y: 24 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.98, y: 24 }}
        className="eg-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="eg-sheet-handle" />

        {done ? (
          <div className="text-center py-6">
            <div className="w-16 h-16 mx-auto rounded-[var(--r-xl)] gradient-success flex items-center justify-center mb-4">
              <Check className="w-8 h-8 text-[var(--text-strong)]" />
            </div>
            <h3 className="text-lg font-bold text-[var(--text-strong)] mb-1">Action saved</h3>
            <p className="text-xs text-[var(--text-muted)] mb-5">
              {result === 'answered' ? 'Saved: Answered ' : 'Saved: No Answer '}
              {nextCallAt ? ' • a reminder was scheduled for the next action' : ''}
            </p>
            <button onClick={onClose} className="btn-primary w-full justify-center">Close</button>
          </div>
        ) : (
          <>
            {/* ===== شريط الأدوات فوق (زي ENGAZ) ===== */}
            <div className="eg-sheet-tools">
              <button type="button" className="eg-icon-btn" title="View details" onClick={() => onOpenDetails?.(client)}>
                <Eye className="w-4.5 h-4.5" />
              </button>
              <button type="button" className="eg-icon-btn" title="Write comment" onClick={() => commentRef.current?.focus()}>
                <Edit3 className="w-4.5 h-4.5" />
              </button>
              <button type="button" className="eg-icon-btn is-primary" title="New action"
                onClick={() => { setComment(''); setResult(''); setTimeout(() => commentRef.current?.focus(), 30); }}>
                <Plus className="w-4.5 h-4.5" />
              </button>
              <button type="button" className="eg-icon-btn" title="Copy number" onClick={() => void copyPhone()}>
                <Menu className="w-4.5 h-4.5" />
              </button>
              <button type="button" className="eg-icon-btn" title="Close" onClick={onClose}>
                <LogOut className="w-4.5 h-4.5" />
              </button>
            </div>

            {/* ===== اسم العميل + الرقم ===== */}
            <div className="eg-sheet-head">
              <div className="min-w-0">
                <h2 className="eg-sheet-name">{client.name}</h2>
                <p className="eg-sheet-phone" dir="ltr">{client.phone}</p>
                {client.virtualLead && (
                  <p className="eg-sheet-tag">Distributed lead — the call is saved on the number itself</p>
                )}
              </div>
            </div>

            {/* ===== الاتصال (الرنّ الحقيقي بيحصل هنا) ===== */}
            <a href={`tel:${client.phone}`} onClick={() => setDialed(true)} className="eg-call">
              <PhoneCall className="w-4.5 h-4.5" /> Call now
            </a>
            {dialed && <p className="eg-hint">Set the result after you end the call.</p>}

            {/* ===== الحالة ===== */}
            <div className="eg-row">
              <StatusMenu
                value={status}
                label="Select status (follow up / done deal …)"
                className="fc-status-menu"
                stopPropagation={false}
                onPick={(id: string) => {
                  setStatus(id);
                  // الحالة غير الإلغاء تمسح أي سبب قديم
                  setCancelReason('');
                  if (id === 'cancellation') {
                    // إلغاء = خلاص مش هيتواصل معاه تاني: مفيش كومنت قديم ولا تذكير
                    setComment('');
                    setNextCallAt('');
                  }
                }}
              />
            </div>

            {/* ===== موعد الإجراء القادم (يتسجّل تذكير في وقته) =====
                إلغاء = مفيش تواصل تاني، فمفيش موعد ولا تذكير. */}
            {status !== 'cancellation' && (
              <>
                <div className="eg-row eg-date-row">
                  <Calendar className="w-4.5 h-4.5 shrink-0 text-[var(--text-muted)]" />
                  <input type="datetime-local" value={nextCallAt} dir="ltr" className="eg-date-input"
                    onChange={(e) => setNextCallAt(e.target.value)} />
                  {nextCallAt && (
                    <button type="button" className="eg-clear" title="Clear date" onClick={() => setNextCallAt('')}>
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>

                <div className="eg-quick">
                  {[['After 1hr', 60], ['After 2hr', 120], ['Tomorrow', 1440], ['Next week', 10080]].map(([label, mins]) => (
                    <button key={label as string} type="button"
                      onClick={() => { const d = new Date(); d.setMinutes(d.getMinutes() + (mins as number)); setNextCallAt(toLocalInput(d)); }}
                      className="eg-quick-btn">
                      {label as string}
                    </button>
                  ))}
                </div>
              </>
            )}

            {/* ===== تم الرد / لم يرد ===== */}
            <div className="eg-seg">
              <button type="button" className={result === 'answered' ? 'is-on is-yes' : ''} onClick={() => pick('answered')}>
                Answered
              </button>
              <button type="button" className={result === 'no-answer' ? 'is-on is-no' : ''} onClick={() => pick('no-answer')}>
                No Answer
              </button>
            </div>

            {/* ===== الكومنت ===== */}
            <textarea ref={commentRef} value={comment} onChange={(e) => setComment(e.target.value)}
              placeholder="Enter your comment here…"
              className="eg-textarea" />

            {status === 'cancellation' && (
              <div className="eg-row">
                <CancelReasonPicker
                  value={cancelReason}
                  onChange={(reason) => {
                    setCancelReason(reason);
                    // اختيار السبب يكتب الكومنت فوراً
                    setComment(reason ? cancelReasonLabelOf(reason) : '');
                  }}
                />
              </div>
            )}

            {/* ===== آخر التعليقات ===== */}
            <div className="eg-comments">
              <div className="eg-comments-head">
                Last comments <b>{comments.length}</b>
              </div>
              {comments.length === 0 ? (
                <p className="eg-empty">No comments on this lead yet.</p>
              ) : (
                comments.map((c: any) => (
                  <div key={c.id} className="eg-comment">
                    <span className="eg-avatar">{String(c.by || '?').trim().charAt(0) || '?'}</span>
                    <div className="eg-comment-body">
                      <div className="eg-comment-top">
                        <b>{c.by}</b>
                        {c.status && FEEDBACK_STATUS_BY_ID[c.status] && (
                          <span className={`eg-chip ${FEEDBACK_STATUS_BY_ID[c.status].cls}`}>
                            {LEAD_STATUS_LABELS[c.status] || FEEDBACK_STATUS_BY_ID[c.status].label}
                          </span>
                        )}
                      </div>
                      {c.at && <span className="eg-comment-at">{formatDateTime(c.at)}</span>}
                      {c.text && <p className="eg-comment-text">{c.text}</p>}
                      {c.nextAt && <p className="eg-comment-next">Next Action : {c.nextAt}</p>}
                    </div>
                  </div>
                ))
              )}
            </div>

            <button type="button" onClick={save} className="eg-submit"
              disabled={!result || (status === 'cancellation' && !cancelReason)}>
              Add Action
            </button>
            {!result && <p className="eg-hint text-center">Pick “Answered” or “No Answer”, then write your comment.</p>}
          </>
        )}
      </motion.div>
    </motion.div>
  );
}

// ===== مركز الإشعارات: كل ما يخصك مقسَّماً على تبويبات =====
function NotificationsCenter({ user, messages, callLogs, unseenIds, onSeen, onClose, onOpenAlarm, onGo }: any) {
  const isSales = effectiveRoleOf(user) === 'sales';
  // ===== مفيش تبويب «أرقام جديدة» هنا =====
  // إشعار «رقم جديد في الفورم» اتشال من جوّه البرنامج: بقى إشعار خارجي على
  // جهاز السيلز بس («رقم فريش جديد نزل ليك») — فمفيش تكرار ولا إزعاج بالجرس.
  // ومفيش تبويب «تذكيرات» كمان: إشعار التذكير خارجي على الجهاز مرة واحدة في وقته،
  // ومفيش أي نسخة داخل البرنامج.
  const tabs = isSales
    ? [{ id: 'messages', label: 'الرسائل', icon: MessageCircle }]
    : [
        { id: 'calls', label: 'اتصالات الفريق', icon: PhoneCall },
        { id: 'messages', label: 'الرسائل', icon: MessageCircle },
      ];

  const [tab, setTab] = useState<string>(tabs[0].id);
  // ===== حالة الإشعارات الخارجية =====
  // الرقم الغايب في الشكوى: هل الجهاز مسجّل؟ هل السيرفر بعت فعلاً؟ هنا يظهر
  // الجواب من السيرفر نفسه بدل التخمين — مع زر تفعيل وزر إشعار تجريبي.
  const [device, setDevice] = useState<PushState>('default');
  const [health, setHealth] = useState<PushHealth | null>(null);
  const [pushBusy, setPushBusy] = useState(false);
  const [pushNote, setPushNote] = useState('');
  const refreshPush = useCallback(async () => {
    setDevice(await pushState());
    setHealth(await pushHealth());
  }, []);
  useEffect(() => { void refreshPush(); }, [refreshPush]);
  const ago = (ms: number) => {
    if (!ms) return 'لسه ما اشتغلش';
    const diff = Math.max(0, Date.now() - ms);
    if (diff < 60_000) return 'قبل لحظات';
    if (diff < 3_600_000) return `قبل ${Math.floor(diff / 60_000)} دقيقة`;
    if (diff < 86_400_000) return `قبل ${Math.floor(diff / 3_600_000)} ساعة`;
    return `قبل ${Math.floor(diff / 86_400_000)} يوم`;
  };
  const enableHere = async () => {
    setPushBusy(true);
    setPushNote('');
    const result = await enablePush({ id: user.id, name: user.name });
    setPushNote(result.message);
    setPushBusy(false);
    void refreshPush();
  };
  const testHere = async () => {
    setPushBusy(true);
    setPushNote('');
    const result = await sendTestPush({ id: user.id });
    setPushNote(result.message);
    setPushBusy(false);
    void refreshPush();
  };
  // فتح المركز كلّياً = قراءة كل الإشعارات (كل التبويبات)، والعدّادات تختفي
  // فوراً — المطلوب: بمجرد ضغط الجرس تكون الإشعارات اتقرأت خلاص.
  const [allSeen, setAllSeen] = useState(false);
  useEffect(() => {
    onSeen(unseenIds);
    setAllSeen(true);
  }, [unseenIds.join('|')]);
  const countFor = (id: string) =>
    allSeen
      ? 0
      : unseenIds.filter((x: string) =>
          x.startsWith(id === 'calls' ? 'call-' : 'msg-')
        ).length;

  const goTarget = tab === 'calls' ? (isSales ? 'daily-feedback' : 'admin-feedback') : (isSales ? 'chat' : 'admin-chat');

  const now = Date.now();
  const empty = (text: string) => <p className="text-sm text-[var(--text-dim)] text-center py-10">{text}</p>;

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-[72] flex items-center justify-center p-3 sm:p-4 bg-black/85" onClick={onClose}>
      <motion.div initial={{ scale: 0.95, y: 12 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.95 }}
        className="panel p-4 sm:p-5 w-full max-w-xl max-h-[92vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}>

        <div className="flex items-center justify-between gap-3 mb-3">
          <h2 className="text-lg font-bold gradient-text flex items-center gap-2">
            <Bell className="w-5 h-5 text-[var(--text)]" /> الإشعارات
          </h2>
          <button type="button" onClick={onClose} title="إغلاق"
            className="p-2 rounded-[var(--r-sm)] bg-[var(--tint-1)] hover:bg-[var(--tint-3)] transition-colors shrink-0">
            <X className="w-4 h-4 text-[var(--text)]" />
          </button>
        </div>

        <div className="flex gap-1.5 mb-3 overflow-x-auto nav-scroll">
          {tabs.map((t: any) => {
            const n = countFor(t.id);
            return (
              <button key={t.id} type="button" onClick={() => setTab(t.id)}
                className={`shrink-0 flex items-center gap-1.5 px-3.5 py-2 rounded-[var(--r-md)] text-xs font-bold border transition-all ${
                  tab === t.id
                    ? 'bg-[var(--brand-primary-softer)] border-[var(--brand-primary-soft)] text-[var(--text)]'
                    : 'bg-[var(--tint-1)] border-[var(--border)] text-[var(--text-muted)] hover:border-[var(--border-strong)]'
                }`}>
                <t.icon className="w-4 h-4" />
                {t.label}
                {n > 0 && <span className="min-w-4 h-4 px-1 rounded-full bg-red-500 text-white text-[10px] grid place-items-center">{n}</span>}
              </button>
            );
          })}
        </div>

        {/* ===== شريط الإشعارات الخارجية: هل توصل للجهاز فعلاً؟ ===== */}
        <div className={`push-health ${device === 'subscribed' ? 'is-on' : 'is-off'}`}>
          <div className="push-health-head">
            <span className="ph-dot" />
            <b>{device === 'subscribed' ? 'الإشعارات الخارجية مفعّلة على هذا الجهاز' : 'الإشعارات الخارجية غير مفعّلة على هذا الجهاز'}</b>
            <span className="ph-devices">
              {health ? `${health.devices} جهاز لك` : '—'}
            </span>
          </div>
          <p className="ph-line">
            آخر إرسال من السيرفر: <b>{health ? ago(health.lastRunAt) : '—'}</b>
            {health?.lastResult ? ` • ${health.lastResult.reminders || 0} تذكير / ${health.lastResult.messages || 0} رسالة` : ''}
            {health ? ` • تذكيرات مستحقة: ${health.dueReminders}` : ''}
          </p>
          {device !== 'subscribed' && (
            <p className="ph-line ph-warn">
              {device === 'denied'
                ? 'المتصفح حاظر الإشعارات لهذا الموقع — اسمح بها من أيقونة 🔒 ثم أعد التحميل.'
                : 'إشعارات هذا الجهاز مش مفعّلة — من غيرها الجهاز مش هيستقبل تذكيرات والموقع مقفول.'}
            </p>
          )}
          {health && health.lastRunAt > 0 && Date.now() - health.lastRunAt > 10 * 60_000 && (
            <p className="ph-line ph-warn">
              مُشغّل الإشعارات متوقف منذ {ago(health.lastRunAt)} — التذكيرات لن تصل لو كل الأجهزة مقفولة.
              سيولة الحل: افتح الموقع على أي جهاز أو ضع جدولة خارجية تنادي /api/cron.
            </p>
          )}
          <div className="ph-actions">
            <button type="button" onClick={() => void enableHere()} disabled={pushBusy || device === 'unsupported'}>
              {device === 'subscribed' ? 'إعادة تسجيل هذا الجهاز' : 'تفعيل على هذا الجهاز'}
            </button>
            <button type="button" onClick={() => void testHere()} disabled={pushBusy || device !== 'subscribed'}>إشعار تجريبي</button>
            <button type="button" onClick={() => void refreshPush()} disabled={pushBusy}>تحديث</button>
          </div>
          {pushNote && <p className="ph-note">{pushNote}</p>}
        </div>

        <div className="flex-1 overflow-y-auto space-y-2 min-h-[180px]">
          {tab === 'messages' && (messages.length === 0 ? empty('لا توجد رسائل') : messages.map((m: ChatMessage) => (
            <div key={m.id} className="rounded-[var(--r-md)] border border-[var(--border)] bg-[var(--tint-1)] p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="font-bold text-[var(--text-strong)] text-sm truncate">{m.fromName}</p>
                <span className="text-[10px] text-[var(--text-dim)]">{formatDateTime(m.createdAt)}</span>
              </div>
              <p className="text-sm text-[var(--text)] mt-1">{m.text}</p>
            </div>
          )))}

          {tab === 'calls' && (callLogs.length === 0 ? empty('لا توجد مكالمات من الفريق بعد') : callLogs.map((c: CallLog) => (
            <div key={c.id} className="rounded-[var(--r-md)] border border-[var(--border)] bg-[var(--tint-1)] p-3">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <p className="font-bold text-[var(--text-strong)] text-sm truncate">{c.clientName}</p>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${c.result === 'answered' ? 'bg-emerald-500/20 text-emerald-300' : 'bg-red-500/20 text-red-300'}`}>
                  {c.result === 'answered' ? 'answered ✓' : 'not answered ✕'}
                </span>
              </div>
              <p className="text-[11px] text-[var(--text-muted)] mt-1">
                {c.salesName} • <span dir="ltr">{c.clientPhone}</span> • {formatDateTime(c.createdAt)}
              </p>
              {c.comment && <p className="text-sm text-[var(--text)] mt-1.5 bg-black/20 rounded-[var(--r-sm)] px-2.5 py-1.5">{c.comment}</p>}
              {c.nextCallAt && (
                <p className="text-[11px] text-amber-300 mt-1.5 flex items-center gap-1">
                  <Clock className="w-3 h-3" /> اتصال قادم: {formatDateTime(c.nextCallAt)}
                </p>
              )}
            </div>
          )))}
        </div>

        <div className="flex flex-col sm:flex-row gap-2 mt-3 pt-3 border-t border-[var(--border)]">
          <button type="button" onClick={onOpenAlarm} className="flex-1 bg-[var(--tint-1)] hover:bg-[var(--tint-3)] border border-[var(--border)] text-[var(--text)] py-2.5 rounded-[var(--r-md)] text-xs font-bold flex items-center justify-center gap-2">
            ⚙️ إعدادات الإشعارات والمنبه
          </button>
          <button type="button" onClick={() => onGo(goTarget)} className="flex-1 gradient-primary text-[var(--text-strong)] py-2.5 rounded-[var(--r-md)] text-xs font-bold flex items-center justify-center gap-2">
            فتح {tabs.find((t: any) => t.id === tab)?.label} ←
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

function NotificationsPanel({ user, notifState, setNotifState, settings, onSaveSettings, busy, setBusy, message, setMessage, onClose }: any) {
  const [local, setLocal] = useState<AlarmSettings>(settings);
  const supported = pushSupported();

  const enable = async () => {
    setBusy(true);
    setMessage('');
    const result = await enablePush({ id: user.id, name: user.name });
    setMessage(result.message);
    setNotifState(await pushState());
    setBusy(false);
  };

  const disable = async () => {
    setBusy(true);
    const result = await disablePush();
    setMessage(result.message);
    setNotifState(await pushState());
    setBusy(false);
  };

  const test = async () => {
    setBusy(true);
    const result = await sendTestPush({ id: user.id });
    setMessage(result.message);
    setBusy(false);
  };

  const active = notifState === 'subscribed';

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-[70] flex items-center justify-center p-3 sm:p-4 bg-black/85" onClick={onClose}>
      <motion.div initial={{ scale: 0.95, y: 12 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.95 }}
        className="panel p-5 sm:p-6 w-full max-w-xl max-h-[92vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-3 mb-4">
          <h2 className="text-lg font-bold gradient-text flex items-center gap-2">
            <Bell className="w-5 h-5 text-[var(--text)]" /> الإشعارات والتذكيرات
          </h2>
          <button type="button" onClick={onClose} title="إغلاق"
            className="p-2 rounded-[var(--r-sm)] bg-[var(--tint-1)] hover:bg-[var(--tint-3)] transition-colors shrink-0">
            <X className="w-4 h-4 text-[var(--text)]" />
          </button>
        </div>

        {/* الحالة */}
        <div className={`rounded-[var(--r-xl)] px-4 py-4 border ${active ? 'bg-emerald-500/10 border-emerald-500/30' : notifState === 'denied' ? 'bg-red-500/10 border-red-500/30' : 'bg-[var(--tint-1)] border-[var(--border)]'}`}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="font-bold text-[var(--text-strong)]">
                {active ? ' الإشعارات مفعّلة على هذا الجهاز' : notifState === 'denied' ? ' الإشعارات محظورة من إعدادات المتصفح' : supported ? ' الإشعارات غير مفعّلة على هذا الجهاز' : ' المتصفح لا يدعم الإشعارات'}
              </p>
              <p className="text-xs text-[var(--text-muted)] mt-1">
                {active
                  ? 'هذا الجهاز يستقبل رسائل الشات والتذكيرات حتى لو الموقع مقفول.'
                  : notifState === 'denied'
                  ? 'الإشعارات مرفوضة سابقاً — افتح إعدادات الموقع من المتصفح واسمح بها ثم أعد المحاولة. على الهاتف: أيقونة الموقع بجانب الرابط ← الأذونات ← الإشعارات ← سماح.'
                  : 'فعّلها مرة واحدة على هاتفك لتصلك الرسائل والتذكيرات والموقع مقفول.'}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {active ? (
                <button type="button" disabled={busy} onClick={disable}
                  className="bg-[var(--tint-2)] hover:bg-[var(--tint-3)] text-[var(--text-strong)] px-4 py-2.5 rounded-[var(--r-md)] font-bold text-sm disabled:opacity-50">
                  إيقاف على هذا الجهاز
                </button>
              ) : (
                <button type="button" disabled={busy || !supported} onClick={enable}
                  className="gradient-primary text-[var(--text-strong)] px-4 py-2.5 rounded-[var(--r-md)] font-bold text-sm disabled:opacity-50">
                  {busy ? 'جارٍ التفعيل…' : 'تفعيل الإشعارات'}
                </button>
              )}
              <button type="button" disabled={busy} onClick={test}
                className="bg-[var(--brand-primary-softer)] border border-[var(--brand-primary-soft)] text-[var(--brand)] px-4 py-2.5 rounded-[var(--r-md)] font-bold text-sm disabled:opacity-50">
                إشعار تجريبي
              </button>
            </div>
          </div>
        </div>

        {/* إعدادات المنبه */}
        <div className="mt-4 rounded-[var(--r-xl)] bg-[var(--tint-1)] border border-[var(--border)] px-4 py-4 space-y-4">
          <div>
            <h3 className="font-bold text-[var(--text-strong)] mb-1">التذكيرات</h3>
            <p className="text-xs text-[var(--text-muted)] leading-relaxed">
              في وقت التذكير بالظبط يوصل: بطاقة على الشاشة + إشعار في الجهاز — بلا رنة وبلا تكرار.
              ولو مرّت ٥ دقائق بلا أي إجراء (اتصال / تأجيل / تم) يتسجّل التذكير «متأخر» ويظهر عليه العدّاد.
            </p>
          </div>

          <label className="block sm:max-w-xs">
            <span className="text-xs text-[var(--text-muted)] block mb-1">مدة التأجيل عند الضغط على «تأجيل»</span>
            <select value={local.snoozeMin} onChange={(e) => setLocal({ ...local, snoozeMin: Number(e.target.value) })}
              className="w-full bg-[var(--tint-1)] border border-[var(--border)] rounded-[var(--r-sm)] px-3 py-2 text-[var(--text-strong)] text-sm">
              <option value={5} className="bg-gray-900">٥ دقائق</option>
              <option value={10} className="bg-gray-900">١٠ دقائق</option>
              <option value={15} className="bg-gray-900">١٥ دقيقة</option>
              <option value={30} className="bg-gray-900">٣٠ دقيقة</option>
            </select>
          </label>

          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => { alarm.stop(); onSaveSettings(local); setMessage('تم حفظ إعدادات التذكيرات ✓'); }}
              className="gradient-primary text-[var(--text-strong)] px-4 py-2.5 rounded-[var(--r-md)] font-bold text-sm">
              حفظ الإعدادات
            </button>
          </div>
        </div>

        {message && (
          <p className="mt-3 text-sm text-amber-300 bg-amber-500/10 border border-amber-500/25 rounded-[var(--r-md)] px-4 py-2.5">{message}</p>
        )}

        {/* حدود تقنية مهمة — بصراحة */}
        <div className="mt-4 rounded-[var(--r-xl)] bg-[var(--tint-1)] border border-[var(--border)] px-4 py-4">
          <p className="text-xs font-bold text-[var(--text)] mb-2">ما يعمل وكيف — بصراحة:</p>
          <ul className="text-[11px] text-[var(--text-muted)] space-y-1.5 leading-relaxed">
            <li>• <span className="text-[var(--text)]">الإشعارات تصل والموقع مقفول</span> لأن السيرفر هو الذي يرسلها لمنصة إشعارات المتصفح (كل دقيقة).</li>
            <li>• على <span className="text-[var(--text)]">أندرويد</span>: من قائمة المتصفح اختر <span className="text-[var(--text)]">«إضافة إلى الشاشة الرئيسية»</span> — بعدها يعمل الإشعار كتطبيق حقيقي.</li>
            <li>• على <span className="text-[var(--text)]">آيفون</span>: الإشعارات تعمل فقط بعد إضافة الموقع للشاشة الرئيسية (iOS 16.4 وأحدث)، ولازم تضغط <span className="text-[var(--text)]">تفعيل الإشعارات</span> من داخل التطبيق مرة واحدة.</li>
            <li>• <span className="text-[var(--text)]">تسجيل الجهاز يتجدّد تلقائياً</span> عند كل دخول، فلو تحدّث التطبيق أو تغيّرت قاعدة البيانات تفضل الإشعارات واصلة.</li>
            <li>• الإشعار <span className="text-[var(--text)]">صامت</span>: يظهر مرة واحدة في وقته بلا رنة متكررة ولا اهتزاز مستمر. آيفون قد يضيف نغمة النظام مرة واحدة حسب إعدادات الجهاز.</li>
            <li>• لو اتصلت بالعميل أو أجّلت أو أتممت التذكير من أول ٥ دقائق — التذكير ما يتسجّلش «متأخر».</li>
          </ul>
        </div>

        <button type="button" onClick={onClose}
          className="w-full mt-4 bg-[var(--tint-2)] hover:bg-[var(--tint-3)] text-[var(--text-strong)] py-3 rounded-[var(--r-md)] font-bold">إغلاق</button>
      </motion.div>
    </motion.div>
  );
}

// زر واتساب: يفتح المحادثة على الرقم مباشرة بلا نافذة وسيطة.
// الرابط https (wa.me) مقصود: لو على الجهاز واتساب عادي وواتساب بيزنس، النظام نفسه
// هو اللي يسأل أي تطبيق يفتح — أما whatsapp:// فكان يفتح البيزنس على طول.
function WhatsAppButton({ phones, label = 'واتساب', className = '', onOpened }: any) {
  const first = (Array.isArray(phones) ? phones : [])
    .map((p: any) => String(p || '').trim())
    .filter(Boolean)[0] || '';
  const href = first ? waLink(first) : '';
  return (
    <a
      href={href || undefined}
      target={href ? '_blank' : undefined}
      rel="noopener noreferrer"
      title={href ? 'فتح واتساب على رقم العميل' : 'لا يوجد رقم مسجّل'}
      onClick={(e) => {
        e.stopPropagation();
        if (!href) { e.preventDefault(); return; }
        onOpened?.();
      }}
      className={`inline-flex items-center gap-1.5 text-xs font-bold px-2.5 py-1.5 rounded-[var(--r-sm)] border transition-colors ${
        href
          ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/30'
          : 'bg-[var(--tint-1)] border-[var(--border)] text-[var(--text-dim)] cursor-not-allowed'
      } ${className}`}
    >
      <MessageCircle className="w-3.5 h-3.5" /> {label}
    </a>
  );
}

// ===== البحث الذكي باحتياجات العميل (تبويب العقارات) =====
function NeedsSearchModal({ properties, onClose, onApply }: any) {
  const [text, setText] = useState('');
  const [override, setOverride] = useState<any>(null);
  const needs = parseNeeds(text);

  useEffect(() => setOverride(null), [text]);

  const effective: NeedsQuery = override
    ? {
        ...needs,
        priceMin: override.priceMin === '' ? null : Number(override.priceMin),
        priceMax: override.priceMax === '' ? null : Number(override.priceMax),
        areaMin: override.areaMin === '' ? null : Number(override.areaMin),
        areaMax: override.areaMax === '' ? null : Number(override.areaMax),
      }
    : needs;

  const hasFilter = hasNeedsFilter(effective);

  const rows = (properties as Property[]).map((property) => ({ property, match: matchPropertyNeeds(property, effective) }));
  const exact = rows.filter((r) => r.match.ok && r.match.warns.length === 0).sort((a, b) => b.match.score - a.match.score);
  const near = rows.filter((r) => r.match.ok && r.match.warns.length > 0).sort((a, b) => b.match.score - a.match.score);
  const skipped = rows.filter((r) => !r.match.ok);
  const shown = [...exact, ...near].slice(0, 40);

  const chip = (label: string, value: string) => (
    <span key={`${label}-${value}`} className="inline-flex items-center gap-1 text-xs bg-[var(--brand-primary-softer)] border border-[var(--brand-primary-soft)] text-[var(--text)] px-2.5 py-1 rounded-full">
      <span className="text-[var(--text-muted)]/80">{label}:</span> {value}
    </span>
  );

  const boundField = (label: string, key: 'priceMin' | 'priceMax' | 'areaMin' | 'areaMax', value: number | null) => (
    <label className="flex-1 min-w-[120px]">
      <span className="text-[11px] text-[var(--text-muted)] block mb-1">{label}</span>
      <input
        type="number"
        value={override ? override[key] : value === null ? '' : String(value)}
        onChange={(e) => {
          const base = override ?? {
            priceMin: needs.priceMin === null ? '' : String(needs.priceMin),
            priceMax: needs.priceMax === null ? '' : String(needs.priceMax),
            areaMin: needs.areaMin === null ? '' : String(needs.areaMin),
            areaMax: needs.areaMax === null ? '' : String(needs.areaMax),
          };
          setOverride({ ...base, [key]: e.target.value });
        }}
        className="w-full bg-[var(--tint-1)] border border-[var(--border)] rounded-[var(--r-sm)] px-3 py-2 text-[var(--text-strong)] text-sm"
        dir="ltr"
      />
    </label>
  );

  const resultCard = (row: any) => (
    <div key={row.property.id} className="bg-[var(--tint-1)] rounded-[var(--r-md)] px-4 py-3 border border-[var(--border)]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-bold text-[var(--text-strong)] text-sm">{row.property.name}</p>
        <span className="text-sm text-[var(--text)] font-bold">{displayPrice(row.property.price)} ج.م</span>
      </div>
      <p className="text-xs text-[var(--text-muted)] mt-1">
        {[row.property.type, row.property.area ? `${row.property.area}م` : '', row.property.rooms ? `${row.property.rooms} غرف` : '', row.property.location]
          .filter(Boolean).join(' • ')}
      </p>
      {row.match.reasons.length > 0 && (
        <p className="text-[11px] text-emerald-300 mt-2">✓ {row.match.reasons.join(' • ')}</p>
      )}
      {row.match.warns.length > 0 && (
        <p className="text-[11px] text-amber-300 mt-1"> {row.match.warns.join(' • ')}</p>
      )}
      {(row.property.clientPhone || row.property.clientPhone2 || row.property.clientName) && (
        <div className="flex flex-wrap items-center gap-2 mt-2">
          {row.property.clientName && <span className="text-[11px] text-[var(--text-muted)]">{row.property.clientName}</span>}
          {row.property.clientPhone && <span className="text-[11px] text-[var(--text)]" dir="ltr">{row.property.clientPhone}</span>}
          {row.property.clientPhone2 && <span className="text-[11px] text-[var(--text)]" dir="ltr">{row.property.clientPhone2}</span>}
          <WhatsAppButton name={row.property.clientName} phones={[row.property.clientPhone, row.property.clientPhone2]} />
        </div>
      )}
    </div>
  );

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-[60] flex items-center justify-center p-3 sm:p-4 bg-black/80" onClick={onClose}>
      <motion.div initial={{ scale: 0.95, y: 12 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.95 }}
        className="panel p-4 sm:p-6 w-full max-w-3xl max-h-[92vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-3 mb-3">
          <h2 className="text-lg font-bold gradient-text flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-[var(--text)]" /> بحث باحتياجات العميل
          </h2>
          <button type="button" onClick={onClose} title="إغلاق"
            className="p-2 rounded-[var(--r-sm)] bg-[var(--tint-1)] hover:bg-[var(--tint-3)] transition-colors shrink-0">
            <X className="w-4 h-4 text-[var(--text)]" />
          </button>
        </div>

        <p className="text-xs text-[var(--text-muted)] mb-2">
          اكتب احتياجات العميل بكلامك العادي: النوع، المبلغ، المساحة، الغرف، المنطقة — والنظام يفهمها ويرشّح العقارات.
        </p>
        <p className="text-[11px] text-[var(--text-dim)] mb-2">
          يفهم الصيغ المكتوبة: «غرفتين» أو «أوضتين» = ٢، «عشر آلاف» = ١٠٬٠٠٠، «مية وخمسين ألف» = ١٥٠٬٠٠٠، «مليون وميتين ألف» = ١٬٢٠٠٬٠٠٠، «نص مليون» = ٥٠٠٬٠٠٠.
        </p>
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3}
          placeholder="مثال: العميل محتاج شقة غرفتين في التجمع الخامس بمساحة مية وعشرين متر بعشر آلاف جنيه"
          className="w-full bg-[var(--tint-1)] border border-[var(--border)] rounded-[var(--r-md)] px-4 py-3 text-[var(--text-strong)] text-sm resize-y" />

        <div className="flex flex-wrap gap-2 mt-2">
          {['شقة غرفتين في التجمع', 'فيلا ٤ غرف بمليون وميتين ألف', 'شقة 90 متر لحد 3 مليون متشطبة', 'شقة بعشر آلاف جنيه'].map((sample) => (
            <button key={sample} type="button" onClick={() => setText(sample)}
              className="text-[11px] bg-[var(--tint-1)] hover:bg-[var(--tint-2)] border border-[var(--border)] text-[var(--text)] px-2.5 py-1 rounded-full">
              {sample}
            </button>
          ))}
        </div>

        {hasFilter && (
          <div className="mt-4 space-y-3">
            <div className="flex flex-wrap gap-2">
              {effective.kinds.length > 0 && chip('النوع', effective.kinds.join(' / '))}
              {(effective.priceMin !== null || effective.priceMax !== null) &&
                chip('السعر', `${effective.priceMin !== null ? Number(effective.priceMin).toLocaleString('en-US') : '0'} → ${effective.priceMax !== null ? Number(effective.priceMax).toLocaleString('en-US') : 'بلا حد'}`)}
              {(effective.areaMin !== null || effective.areaMax !== null) &&
                chip('المساحة', `${effective.areaMin ?? 0} → ${effective.areaMax ?? 'بلا حد'} م`)}
              {effective.rooms && chip('الغرف', String(effective.rooms))}
              {effective.places.length > 0 && chip('المنطقة', effective.places.join(' / '))}
              {effective.finishing && chip('التشطيب', effective.finishing === 'fully-finished' ? 'متشطب' : effective.finishing === 'semi-finished' ? 'نصف تشطيب' : 'طوب')}
              {effective.delivery && chip('التسليم', effective.delivery === 'immediate' ? 'فوري' : 'بعد فترة')}
            </div>

            <div className="bg-[var(--tint-1)] border border-[var(--border)] rounded-[var(--r-md)] px-4 py-3">
              <p className="text-[11px] text-[var(--text-muted)] mb-2">يمكنك تعديل حدود البحث (النظام يوسّع تلقائياً حول ما فهمه):</p>
              <div className="flex flex-wrap gap-3">
                {boundField('أقل سعر', 'priceMin', effective.priceMin)}
                {boundField('أعلى سعر', 'priceMax', effective.priceMax)}
                {boundField('أقل مساحة', 'areaMin', effective.areaMin)}
                {boundField('أعلى مساحة', 'areaMax', effective.areaMax)}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3 text-sm">
              <span className="text-emerald-400 font-bold">نتائج مطابقة: {exact.length}</span>
              <span className="text-amber-400 font-bold">قريبة (تحتاج مراجعة): {near.length}</span>
              {skipped.length > 0 && <span className="text-[var(--text-dim)] text-xs">استبعدنا {skipped.length}</span>}
            </div>

            {shown.length === 0 && (
              <div className="rounded-[var(--r-md)] bg-[var(--tint-1)] border border-[var(--border)] px-4 py-6 text-center text-[var(--text-muted)] text-sm">
                لا يوجد عقار مطابق — جرّب توسيع حدود السعر أو المساحة من الحقول أعلاه.
              </div>
            )}

            <div className="space-y-2">
              {shown.map((row) => {
                const color = row.match.warns.length ? 'border-amber-500/30 bg-amber-500/5' : 'border-emerald-500/25 bg-emerald-500/5';
                return <div key={row.property.id} className={`rounded-[var(--r-xl)] border ${color} p-1`}>{resultCard(row)}</div>;
              })}
            </div>
            {shown.length < exact.length + near.length && (
              <p className="text-xs text-[var(--text-dim)] text-center">… و {exact.length + near.length - shown.length} عقار آخر</p>
            )}
            {shown.length > 0 && skipped.length > 0 && (
              <div className="text-[11px] text-[var(--text-dim)]">
                <p>أمثلة لما استبعدناه:</p>
                <ul className="mt-1 space-y-0.5">
                  {skipped.slice(0, 3).map((r) => (
                    <li key={r.property.id}>• {r.property.name}: {r.match.skip}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        <div className="flex flex-col sm:flex-row gap-2 mt-5">
          <button type="button" disabled={!hasFilter} onClick={() => onApply(effective)}
            className="flex-1 gradient-primary disabled:bg-[var(--tint-1)] disabled:text-[var(--text-dim)] text-[var(--text-strong)] py-3 rounded-[var(--r-md)] font-bold flex items-center justify-center gap-2">
            <Search className="w-4 h-4" /> طبّق هذا الفلتر على قائمة العقارات
          </button>
          <button type="button" onClick={onClose}
            className="sm:w-32 bg-[var(--tint-2)] hover:bg-[var(--tint-3)] text-[var(--text-strong)] py-3 rounded-[var(--r-md)] font-bold">إغلاق</button>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ===== تقرير الحضور الشهري (لكل مندوب) =====
// الدوام الافتراضي: حضور 10:00 — سماحية 30 دقيقة — انصراف 18:00.
function AttendanceMonthlyReport({ users }: any) {
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(() => todayKey().slice(0, 7));
  const [workStart, setWorkStart] = useState(() => {
    const saved = localStorage.getItem('crm_work_start');
    // 09:00 كانت القيمة الافتراضية القديمة — نرقّيها مرة واحدة إلى 10:00
    return saved && saved !== '09:00' ? saved : ATTENDANCE_START_DEFAULT;
  });
  const [workEnd, setWorkEnd] = useState(() => localStorage.getItem('crm_work_end') || ATTENDANCE_END_DEFAULT);
  const [graceMinutes, setGraceMinutes] = useState(() => {
    const raw = localStorage.getItem('crm_attendance_grace');
    const saved = raw === null ? NaN : Number(raw);
    return Number.isFinite(saved) && saved >= 0 ? Math.min(180, saved) : ATTENDANCE_GRACE_DEFAULT;
  });
  const [restDay, setRestDay] = useState(() => localStorage.getItem('crm_rest_day') || '5');

  useEffect(() => {
    try {
      localStorage.setItem('crm_work_start', workStart);
      localStorage.setItem('crm_work_end', workEnd);
      localStorage.setItem('crm_attendance_grace', String(graceMinutes));
      localStorage.setItem('crm_rest_day', restDay);
    } catch {
      /* لا شيء */
    }
  }, [workStart, workEnd, graceMinutes, restDay]);

  const [year, monthNumber] = month.split('-').map(Number);
  const monthLabel = new Date(year, monthNumber - 1, 1).toLocaleDateString('ar-EG', { month: 'long', year: 'numeric' });
  const startMinutes = clockToMinutes(workStart);
  // التأخير يبدأ بعد انتهاء السماحية: 10:00 + 30 دقيقة = 10:30
  const lateAfterMinutes = startMinutes + graceMinutes;
  const restLabel = restDay === '5' ? 'الجمعة' : restDay === '6' ? 'السبت' : 'لا يوجد';
  const restPhrase = restDay === 'none' ? 'كل الأيام أيام عمل' : `بلا ${restLabel}`;

  // أيام العمل المتوقعة في الشهر (باستثناء يوم الراحة المختار)
  const expectedDays = (() => {
    const last = new Date(year, monthNumber, 0).getDate();
    const today = new Date();
    const isCurrentMonth = today.getFullYear() === year && today.getMonth() + 1 === monthNumber;
    const upto = isCurrentMonth ? today.getDate() : last;
    let count = 0;
    for (let day = 1; day <= upto; day += 1) {
      const weekday = new Date(year, monthNumber - 1, day).getDay();
      if (restDay !== 'none' && weekday === Number(restDay)) continue;
      count += 1;
    }
    return count;
  })();

  const records = getAttendance().filter((rec) => String(rec.date || '').startsWith(month));

  const rows = (users as User[])
    .filter((user) => effectiveRoleOf(user) !== 'admin')
    .map((user) => {
      const mine = records.filter((rec) => rec.userId === user.id);
      const days = new Set(mine.map((rec) => rec.date));
      // التأخير بعد السماحية فقط: 10:30 وما بعدها
      const lateRecords = mine.filter((rec) => lateMinutesOf(rec.checkInAt, workStart, graceMinutes) > 0);
      const lateMinutes = lateRecords.reduce(
        (sum, rec) => sum + lateMinutesOf(rec.checkInAt, workStart, graceMinutes),
        0
      );
      const noCheckout = mine.filter((rec) => !rec.checkOutAt).length;
      const done = mine.filter((rec) => rec.checkOutAt);
      // الانصراف المبكر: قبل 18:00
      const earlyRecords = done.filter((rec) => earlyMinutesOf(rec.checkOutAt, workEnd) > 0);
      const earlyMinutes = earlyRecords.reduce(
        (sum, rec) => sum + earlyMinutesOf(rec.checkOutAt, workEnd),
        0
      );
      const totalMinutes = done.reduce((sum, rec) => sum + workedMinutes(rec), 0);
      const times = mine.map((rec) => minutesOfIso(rec.checkInAt)).filter((v): v is number => v !== null);
      const outTimes = done.map((rec) => minutesOfIso(rec.checkOutAt)).filter((v): v is number => v !== null);
      return {
        user,
        days: days.size,
        lateDays: lateRecords.length,
        lateMinutes,
        noCheckout,
        earlyDays: earlyRecords.length,
        earlyMinutes,
        missing: Math.max(0, expectedDays - days.size),
        hours: Math.round((totalMinutes / 60) * 10) / 10,
        avgHours: done.length ? Math.round((totalMinutes / done.length / 60) * 10) / 10 : 0,
        earliest: clockLabel(times.length ? Math.min(...times) : null),
        latest: clockLabel(outTimes.length ? Math.max(...outTimes) : null),
      };
    });

  const totals = rows.reduce(
    (acc, row) => ({
      days: acc.days + row.days,
      lateDays: acc.lateDays + row.lateDays,
      lateMinutes: acc.lateMinutes + row.lateMinutes,
      noCheckout: acc.noCheckout + row.noCheckout,
      earlyDays: acc.earlyDays + row.earlyDays,
      earlyMinutes: acc.earlyMinutes + row.earlyMinutes,
      hours: Math.round((acc.hours + row.hours) * 10) / 10,
    }),
    { days: 0, lateDays: 0, lateMinutes: 0, noCheckout: 0, earlyDays: 0, earlyMinutes: 0, hours: 0 }
  );

  // ===== تصدير Excel حقيقي (.xlsx) =====
  // كان CSV، وبعض برامج العرض كانت تفتحه كخطأ «unrecoverable problem».
  // الآن ملف xlsx قياسي: أرقام كأرقام، RTL، وعناوين بولد.
  const exportExcel = () => {
    const header = [
      'السيلز', 'أيام الحضور', 'أيام التأخير', 'إجمالي التأخير (دقيقة)',
      'أيام بلا انصراف', 'أيام انصراف مبكر', 'إجمالي الانصراف المبكر (دقيقة)',
      'أيام بلا تسجيل', 'إجمالي ساعات العمل', 'متوسط ساعات اليوم', 'أبكر حضور', 'آخر انصراف',
    ];
    const data = rows.map((row) => [
      row.user.name, row.days, row.lateDays, row.lateMinutes, row.noCheckout,
      row.earlyDays, row.earlyMinutes, row.missing, row.hours, row.avgHours,
      row.earliest, row.latest,
    ]);
    const totalRow = [
      'الإجمالي', totals.days, totals.lateDays, totals.lateMinutes, totals.noCheckout,
      totals.earlyDays, totals.earlyMinutes, '—', totals.hours, '—', '—', '—',
    ];
    const note = `«بلا تسجيل» = أيام العمل المتوقعة (${expectedDays} يوم، ${restPhrase}) ناقص أيام الحضور. • التأخير يُحسب بعد ${graceMinutes} دقيقة سماح من ${workStart} (أي بعد ${clockLabel(lateAfterMinutes)}). • الانصراف المبكر قبل ${workEnd}.`;
    const noteRow = rows.length + 5; // عنوان + سطر الإعدادات + العنوان + البيانات + الإجمالي

    const blob = buildXlsx({
      sheetName: 'الحضور',
      rows: [
        [`تقرير الحضور الشهري — ${monthLabel}`],
        [`بداية الدوام ${workStart} • سماحية التأخير ${graceMinutes} دقيقة • نهاية الدوام ${workEnd} • يوم الراحة ${restLabel}`],
        header,
        ...data,
        totalRow,
        [note],
      ],
      headerRows: [3],
      titleRows: [1],
      columnWidths: [22, 12, 12, 18, 14, 16, 20, 14, 16, 16, 12, 12],
      merges: ['A1:L1', 'A2:L2', `A${noteRow}:L${noteRow}`],
    });
    downloadBlob(blob, `تقرير-الحضور-${month}.xlsx`);
  };

  return (
    <div className="panel p-4 sm:p-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h3 className="font-bold text-[var(--text-strong)] flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-[var(--text)]" /> التقرير الشهري للحضور
          </h3>
          <p className="text-xs text-[var(--text-muted)] mt-1">
            عدد أيام التأخير والغياب وساعات العمل لكل سيلز في شهر {monthLabel} — جاهز للتسليم للمحاسبة.
          </p>
        </div>
        <button type="button" onClick={() => setOpen(!open)}
          className="bg-[var(--tint-1)] hover:bg-[var(--tint-2)] border border-[var(--border)] text-[var(--text)] px-4 py-2.5 rounded-[var(--r-md)] text-sm font-bold whitespace-nowrap">
          {open ? 'إخفاء التقرير' : 'عرض التقرير'}
        </button>
      </div>

      <AnimatePresence>
        {open && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
            <div className="flex flex-wrap gap-3 mt-4">
              <label>
                <span className="text-[11px] text-[var(--text-muted)] block mb-1">الشهر</span>
                <input type="month" value={month} onChange={(e) => setMonth(e.target.value || todayKey().slice(0, 7))}
                  className="bg-[var(--tint-1)] border border-[var(--border)] rounded-[var(--r-sm)] px-3 py-2 text-[var(--text-strong)] text-sm" dir="ltr" />
              </label>
              <label>
                <span className="text-[11px] text-[var(--text-muted)] block mb-1">بداية الدوام</span>
                <input type="time" value={workStart} onChange={(e) => setWorkStart(e.target.value || ATTENDANCE_START_DEFAULT)}
                  className="bg-[var(--tint-1)] border border-[var(--border)] rounded-[var(--r-sm)] px-3 py-2 text-[var(--text-strong)] text-sm" dir="ltr" />
              </label>
              <label>
                <span className="text-[11px] text-[var(--text-muted)] block mb-1">سماحية التأخير (دقيقة)</span>
                <input type="number" min={0} max={180} step={5} value={graceMinutes}
                  onChange={(e) => setGraceMinutes(Math.max(0, Math.min(180, Number(e.target.value) || 0)))}
                  className="w-24 bg-[var(--tint-1)] border border-[var(--border)] rounded-[var(--r-sm)] px-3 py-2 text-[var(--text-strong)] text-sm" dir="ltr" />
              </label>
              <label>
                <span className="text-[11px] text-[var(--text-muted)] block mb-1">نهاية الدوام</span>
                <input type="time" value={workEnd} onChange={(e) => setWorkEnd(e.target.value || ATTENDANCE_END_DEFAULT)}
                  className="bg-[var(--tint-1)] border border-[var(--border)] rounded-[var(--r-sm)] px-3 py-2 text-[var(--text-strong)] text-sm" dir="ltr" />
              </label>
              <label>
                <span className="text-[11px] text-[var(--text-muted)] block mb-1">يوم الراحة</span>
                <select value={restDay} onChange={(e) => setRestDay(e.target.value)}
                  className="bg-[var(--tint-1)] border border-[var(--border)] rounded-[var(--r-sm)] px-3 py-2 text-[var(--text-strong)] text-sm">
                  <option value="5" className="bg-gray-900">الجمعة</option>
                  <option value="6" className="bg-gray-900">السبت</option>
                  <option value="none" className="bg-gray-900">لا يوجد</option>
                </select>
              </label>
            </div>
            <p className="text-[11px] text-[var(--text-dim)] mt-2">
              الحضور من {workStart} • سماحية حتى {clockLabel(lateAfterMinutes)} • الانصراف {workEnd} • التأخير يُحسب بعد السماحية والانصراف المبكر قبل نهاية الدوام.
            </p>

            <div className="overflow-x-auto mt-4">
              <table className="w-full text-sm min-w-[1020px]">
                <thead>
                  <tr className="text-[var(--text-muted)] text-xs">
                    <th className="text-right py-2 px-2 font-bold">السيلز</th>
                    <th className="py-2 px-2">أيام الحضور</th>
                    <th className="py-2 px-2">أيام التأخير</th>
                    <th className="py-2 px-2">إجمالي التأخير</th>
                    <th className="py-2 px-2">بلا انصراف</th>
                    <th className="py-2 px-2">انصراف مبكر</th>
                    <th className="py-2 px-2">إجمالي الانصراف المبكر</th>
                    <th className="py-2 px-2">بلا تسجيل</th>
                    <th className="py-2 px-2">ساعات العمل</th>
                    <th className="py-2 px-2">متوسط اليوم</th>
                    <th className="py-2 px-2">أبكر حضور</th>
                    <th className="py-2 px-2">آخر انصراف</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.user.id} className="border-t border-[var(--border)]">
                      <td className="py-2.5 px-2 text-[var(--text-strong)] font-bold text-right whitespace-nowrap">
                        {row.user.name}
                        <span className="text-[11px] text-[var(--text-dim)] mr-1">{row.user.role === 'supervisor' ? 'مشرف' : 'سيلز'}</span>
                      </td>
                      <td className="py-2.5 px-2 text-center text-emerald-300 font-bold">{row.days}</td>
                      <td className={`py-2.5 px-2 text-center font-bold ${row.lateDays ? 'text-amber-400' : 'text-[var(--text-dim)]'}`}>{row.lateDays}</td>
                      <td className="py-2.5 px-2 text-center text-[var(--text)]">{row.lateMinutes ? formatDuration(row.lateMinutes) : '—'}</td>
                      <td className={`py-2.5 px-2 text-center ${row.noCheckout ? 'text-amber-400' : 'text-[var(--text-dim)]'}`}>{row.noCheckout}</td>
                      <td className={`py-2.5 px-2 text-center ${row.earlyDays ? 'text-amber-400' : 'text-[var(--text-dim)]'}`}>{row.earlyDays}</td>
                      <td className="py-2.5 px-2 text-center text-[var(--text)]">{row.earlyMinutes ? formatDuration(row.earlyMinutes) : '—'}</td>
                      <td className={`py-2.5 px-2 text-center ${row.missing ? 'text-red-400' : 'text-emerald-300'}`}>{row.missing}</td>
                      <td className="py-2.5 px-2 text-center text-[var(--text)]">{row.hours} س</td>
                      <td className="py-2.5 px-2 text-center text-[var(--text)]">{row.avgHours || '—'} {row.avgHours ? 'س' : ''}</td>
                      <td className="py-2.5 px-2 text-center text-[var(--text)]" dir="ltr">{row.earliest}</td>
                      <td className="py-2.5 px-2 text-center text-[var(--text)]" dir="ltr">{row.latest}</td>
                    </tr>
                  ))}
                  {rows.length > 0 && (
                    <tr className="border-t border-[var(--brand-primary-soft)] bg-[var(--tint-1)]">
                      <td className="py-2.5 px-2 text-[var(--text)] font-bold text-right">الإجمالي</td>
                      <td className="py-2.5 px-2 text-center text-emerald-300 font-bold">{totals.days}</td>
                      <td className="py-2.5 px-2 text-center text-amber-300 font-bold">{totals.lateDays}</td>
                      <td className="py-2.5 px-2 text-center text-[var(--text)]">{totals.lateMinutes ? formatDuration(totals.lateMinutes) : '—'}</td>
                      <td className="py-2.5 px-2 text-center text-[var(--text)]">{totals.noCheckout}</td>
                      <td className="py-2.5 px-2 text-center text-amber-300 font-bold">{totals.earlyDays}</td>
                      <td className="py-2.5 px-2 text-center text-[var(--text)]">{totals.earlyMinutes ? formatDuration(totals.earlyMinutes) : '—'}</td>
                      <td className="py-2.5 px-2 text-center text-[var(--text-dim)]">—</td>
                      <td className="py-2.5 px-2 text-center text-[var(--text)]">{totals.hours} س</td>
                      <td className="py-2.5 px-2 text-center text-[var(--text-dim)]">—</td>
                      <td className="py-2.5 px-2 text-center text-[var(--text-dim)]">—</td>
                      <td className="py-2.5 px-2 text-center text-[var(--text-dim)]">—</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {rows.length === 0 && (
              <p className="text-sm text-[var(--text-muted)] text-center py-6">لا يوجد سيلز لعرض تقريره</p>
            )}

            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mt-4">
              <p className="text-[11px] text-[var(--text-dim)]">
                «بلا تسجيل» = أيام العمل المتوقعة في الشهر ({expectedDays} يوم، {restPhrase}) ناقص أيام الحضور الفعلية.
                • «بلا انصراف» = سجّل حضوراً ولم يسجّل انصرافه.
                • التأخير يُحسب بعد {graceMinutes} دقيقة سماح من {workStart} (أي بعد {clockLabel(lateAfterMinutes)}).
                • «انصراف مبكر» = انصرف قبل {workEnd}.
              </p>
              <button type="button" onClick={exportExcel} disabled={rows.length === 0}
                className="bg-emerald-600 hover:bg-emerald-500 disabled:bg-[var(--tint-1)] disabled:text-[var(--text-dim)] text-white px-5 py-2.5 rounded-[var(--r-md)] font-bold text-sm flex items-center justify-center gap-2 whitespace-nowrap">
                <Download className="w-4 h-4" /> تنزيل التقرير (Excel .xlsx)
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// Properties View
function PropertiesView({ properties, users, currentUser, searchTerm, onSearch, onSelect, onAdd }: any) {
  // بند ٣: تبويبان — «أسهم عقارات الفريق» و«عقاراتي الخاصة»
  const [tab, setTab] = useState<'team' | 'private'>(() => (localStorage.getItem('crm_props_tab') === 'private' ? 'private' : 'team'));
  const [showNeeds, setShowNeeds] = useState(false);
  const [needs, setNeeds] = useState<NeedsQuery | null>(null);
  const nameOf = (userId: string) =>
    users?.find((u: User) => u.id === userId)?.name || 'عضو محذوف';

  // العقار الخاص: يشوفه صاحبه والإدارة فقط؛ والعقار بلا نطاق = عام للفريق
  const isPrivate = (p: Property) => p.scope === 'private';
  const canSeePrivate = (p: Property) => p.userId === currentUser?.id || currentUser?.role !== 'sales';
  const teamCount = (properties || []).filter((p: Property) => !isPrivate(p)).length;
  const privateCount = (properties || []).filter((p: Property) => isPrivate(p) && canSeePrivate(p)).length;
  const switchTab = (next: 'team' | 'private') => {
    setTab(next);
    localStorage.setItem('crm_props_tab', next);
  };

  // فلتر احتياجات العميل + ترتيب: الأقرب للطلب أولاً
  const visible = (properties || [])
    .filter((p: Property) => (tab === 'team' ? !isPrivate(p) : isPrivate(p) && canSeePrivate(p)))
    .map((p: Property) => ({ property: p, match: needs ? matchPropertyNeeds(p, needs) : null }))
    .filter((row: any) => !needs || row.match.ok)
    .sort((a: any, b: any) => (needs && b.match ? b.match.score - a.match.score : 0))
    .map((row: any) => row.property);

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="flex-1 relative">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-[var(--text-muted)]" />
          <input type="text" placeholder="بحث ذكي: اسم، نوع، موقع، غرف (غرفتين / 3 غرف)، أو مبلغ (عشر آلاف / مليون)..." value={searchTerm} onChange={(e) => onSearch(e.target.value)}
            className="w-full bg-[var(--tint-1)] border border-[var(--border)] rounded-[var(--r-md)] pr-11 pl-4 py-3 text-[var(--text-strong)] focus:border-[var(--brand)]" />
        </div>
        <button
          onClick={() => setShowNeeds(true)}
          className={`px-4 py-3 rounded-[var(--r-md)] font-bold border transition-colors whitespace-nowrap ${
            needs ? 'bg-[var(--brand-primary-soft)] border-[var(--brand-primary-soft)] text-[var(--text)]' : 'bg-[var(--tint-1)] border-[var(--border)] text-[var(--text)] hover:text-[var(--text-strong)]'
          }`}
        >
           احتياجات العميل
        </button>
        <button onClick={onAdd} className="btn-primary">
          <Plus className="w-4.5 h-4.5" /> إضافة عقار
        </button>
      </div>

      {/* التبويبان: عقارات الفريق العامة / عقاراتي الخاصة */}
      <div className="seg-bar" role="tablist" aria-label="نطاق العقارات">
        <button type="button" role="tab" aria-selected={tab === 'team'}
          className={`seg-item${tab === 'team' ? ' on' : ''}`} onClick={() => switchTab('team')}>
          <Globe className="w-4 h-4" /> عقارات الفريق
          <span className="seg-count">{teamCount}</span>
        </button>
        <button type="button" role="tab" aria-selected={tab === 'private'}
          className={`seg-item${tab === 'private' ? ' on' : ''}`} onClick={() => switchTab('private')}>
          <Shield className="w-4 h-4" /> عقاراتي الخاصة
          <span className="seg-count">{privateCount}</span>
        </button>
      </div>

      {needs && (
        <div className="rounded-[var(--r-xl)] bg-[var(--brand-primary-softer)] border border-[var(--brand-primary-soft)] px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <p className="text-xs text-[var(--text)]"> فلتر احتياجات العميل مُفعّل: {needsSummary(needs)}</p>
          <button type="button" onClick={() => setNeeds(null)}
            className="text-xs bg-[var(--tint-2)] hover:bg-[var(--tint-3)] text-[var(--text-strong)] px-3 py-1.5 rounded-[var(--r-sm)] font-bold whitespace-nowrap self-start sm:self-auto">
            إزالة الفلتر
          </button>
        </div>
      )}

      <p className="text-xs text-[var(--text-muted)]">
        {tab === 'team'
          ? `عقارات الفريق يراها الجميع — عدد النتائج: ${visible.length}`
          : currentUser?.role === 'sales'
          ? `عقاراتك الخاصة — تظهر لك وحدك — عدد النتائج: ${visible.length}`
          : `العقارات الخاصة لكل مندوب — تشوفها الإدارة — عدد النتائج: ${visible.length}`}
      </p>

      {visible.length === 0 && (
        <div className="panel p-10 text-center">
          <Building2 className="w-14 h-14 text-[var(--text-dim)] mx-auto mb-3" />
          <p className="text-[var(--text-muted)]">
            {tab === 'team' ? 'لا توجد عقارات مطابقة' : 'لسه مفيش عقارات خاصة — ضيف أول عقار خاص بيك'}
          </p>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {visible.map((property: Property) => (
          <motion.div key={property.id} whileHover={{ scale: 1.02 }} onClick={() => onSelect(property)}
            className="panel p-5 cursor-pointer">
            {property.images?.[0] && (
              <div className="relative mb-3">
                <img src={property.images[0]} alt={property.name} loading="lazy" className="w-full h-36 object-cover rounded-[var(--r-md)]" />
                {property.images.length > 1 && (
                  <span className="absolute bottom-2 left-2 bg-black/70 text-white text-[11px] px-2 py-0.5 rounded-full"> {property.images.length} صور</span>
                )}
                {property.latitude && property.longitude ? (
                  <span className="absolute bottom-2 right-2 bg-black/70 text-emerald-300 text-[11px] px-2 py-0.5 rounded-full"> على الخريطة</span>
                ) : null}
              </div>
            )}
            <div className="flex items-center gap-3 mb-3">
              <div className="w-12 h-12 gradient-primary rounded-full flex items-center justify-center">
                <Building2 className="w-6 h-6 text-[var(--text-strong)]" />
              </div>
              <div className="min-w-0 flex-1">
                <h4 className="font-bold text-[var(--text-strong)] truncate">{property.name}</h4>
                <p className="text-sm text-[var(--text-muted)]">{property.type}{property.area ? ` • ${property.area}م` : ''}</p>
              </div>
            </div>
            {tab === 'private' && property.userId !== currentUser?.id && (
              <p className="text-[11px] text-[var(--text-dim)] mb-1.5">خاص بـ {nameOf(property.userId)}</p>
            )}
            {property.location && <p className="text-xs text-[var(--text-muted)] mb-2"> {property.location}</p>}
            {property.description && (
              <p className="text-xs text-[var(--text-muted)] mb-2 line-clamp-2"> {property.description}</p>
            )}
            <div className="flex items-center justify-between gap-2 pt-3 border-t border-[var(--border)]">
              <span className="text-sm text-[var(--text-muted)] font-bold">{displayPrice(property.price)} ج.م</span>
              <span className="text-[11px] text-[var(--text-muted)] bg-[var(--tint-1)] border border-[var(--border)] rounded-full px-2 py-0.5 whitespace-nowrap">
                {property.userId === currentUser?.id ? 'أضفته أنت' : nameOf(property.userId)}
              </span>
            </div>
          </motion.div>
        ))}
      </div>

      <AnimatePresence>
        {showNeeds && (
          <NeedsSearchModal
            properties={properties}
            onClose={() => setShowNeeds(false)}
            onApply={(parsed: NeedsQuery) => { setNeeds(parsed); setShowNeeds(false); }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// Reminders View
function RemindersView({ reminders, onLog, onDelay, onDelete, onAdd }: any) {
  // الأحدث أولاً: التذكير الأقرب/الأجدد فوق، والأقدم تحت
  const pending = reminders
    .filter((r: Reminder) => !r.isCompleted)
    .slice()
    .sort((a: Reminder, b: Reminder) => String(b.dateTime || '').localeCompare(String(a.dateTime || '')));
  
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="page-intro"><div><h2>التذكيرات</h2></div></div>
        <button onClick={onAdd} className="gradient-primary text-[var(--text-strong)] px-5 py-2.5 rounded-[var(--r-md)] font-bold text-sm flex items-center gap-2 glow-primary">
          <Plus className="w-4 h-4" /> تذكير جديد
        </button>
      </div>

      <div className="space-y-3">
        {pending.map((reminder: Reminder) => {
          const isDue = isReminderDue(reminder);
          return (
            <div key={reminder.id} className={`panel p-4 ${isDue ? 'border-red-500/50' : ''}`}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <h4 className="font-bold text-[var(--text-strong)] text-lg">{reminder.clientName}</h4>
                  <p className="text-sm text-[var(--text-muted)]" dir="ltr">{reminder.clientPhone}</p>
                  <p className="text-xs text-[var(--text-muted)] mt-1">{formatDateTime(reminder.dateTime)}</p>
                  {reminder.note && (
                    <p className="text-xs text-[var(--text)] mt-1.5 flex items-center gap-1.5">
                      {reminder.note.startsWith('متابعة تلقائية') && (
                        <span className="text-[10px] bg-[var(--brand-primary-softer)] border border-[var(--brand-primary-soft)] text-[var(--text)] rounded-full px-1.5 py-0.5 shrink-0">تلقائي</span>
                      )}
                      <span className="truncate">{reminder.note}</span>
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {/* ✓ = سجّل الاتصال والفيدباك ثم انتهى التذكير (بدل إغلاقه بلا سجل) */}
                  <button onClick={() => onLog(reminder.id)} title="تسجيل الاتصال (تم الرد / لم يرد) وإنهاء التذكير" className="p-2 bg-emerald-500/20 rounded-[var(--r-sm)]">
                    <Check className="w-4 h-4 text-emerald-400" />
                  </button>
                  <button onClick={() => onDelay(reminder.id, 30)} title="تأجيل نصف ساعة" className="p-2 bg-amber-500/20 rounded-[var(--r-sm)]">
                    <Clock className="w-4 h-4 text-amber-400" />
                  </button>
                  <button onClick={() => onDelay(reminder.id, 60)} title="تأجيل ساعة" className="p-2 bg-orange-500/20 rounded-[var(--r-sm)]">
                    <Clock className="w-4 h-4 text-orange-400" />
                  </button>
                  <button onClick={() => onDelete(reminder.id)} title="حذف" className="p-2 bg-red-500/20 rounded-[var(--r-sm)]">
                    <Trash2 className="w-4 h-4 text-red-400" />
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Daily Feedback View
// ===== الفيدباك اليومي للمندوب: **كارت لكل رقم**، والكومنتات مرصوصة تحت بعضها =====
// أى كومنت يكتبه المندوب على أى عميل (من تبويب العملاء أو من الاتصال أو من إضافة فيدباك)
// ينزل هنا فوراً منسوباً لكاتبه — حتى لو كان العميل مسجلاً باسم الإدارة أو باسم مندوب آخر.
function DailyFeedbackView({ feedbacks, clients, currentUser, users = [], callLogs = [] }: any) {
  const [historyClient, setHistoryClient] = useState<Client | null>(null);
  const norm = (value: any) => normalizeDigits(String(value || '')).replace(/\D/g, '');
  // فيدباكي أنا وحدي: الفيدباك منسوب لصاحبه (userId)، والربط بالرقم كان يجعل
  // فيدباك مندوب يظهر لمندوب آخر حصل على نفس الرقم.
  const mine = (feedbacks || []).filter((f: DailyFeedback) => f.userId === currentUser?.id);
  const byPhone = new Map<string, DailyFeedback[]>();
  for (const f of mine) {
    const key = norm(f.clientPhone) || `name:${normalizeArabicText(f.clientName || '')}`;
    byPhone.set(key, [...(byPhone.get(key) || []), f]);
  }
  // كلام المندوب من سجل المكالمات (نص المكالمة) — مصدر الكومنتات القديمة.
  // اللوج الآلي لوحده (من غير كلام) ما بيظهرش.
  for (const l of callLogs || []) {
    const text = cleanCommentText(l?.comment);
    // نص نتيجة الاتصال (No answer / تم الرد) كومنت حقيقي — ما يتشالش
    if (!text || (isSystemOnlyText(text) && !isCallResultText(text))) continue;
    const key = norm(l?.clientPhone) || `name:${normalizeArabicText(l?.clientName || '')}`;
    const entry: any = {
      id: `log-${l?.id}`,
      clientPhone: l?.clientPhone,
      clientName: l?.clientName,
      status: '',
      feedback: text,
      date: String(l?.createdAt || ''),
      createdAt: String(l?.createdAt || ''),
      userId: currentUser?.id,
    };
    byPhone.set(key, [...(byPhone.get(key) || []), entry]);
  }
  // نفس الكومنت اتكتب في كارت الفيدباك اليومي وكمان في سجل المكالمات = نسخة واحدة
  for (const [key, list] of byPhone) {
    const seen = new Set<string>();
    const unique: any[] = [];
    for (const f of list) {
      const text = cleanCommentText(f?.feedback);
      if (!text || (isSystemOnlyText(text) && !isCallResultText(text))) continue;
      const sig = commentSignature(text, f?.date || f?.createdAt);
      if (seen.has(sig)) continue;
      seen.add(sig);
      unique.push(f);
    }
    byPhone.set(key, unique);
  }
  // التبويب يعرض **عملاءك** لا قائمة كومنتات: كارت لكل عميل، والضغط عليه يفتح
  // كل الفيدباك بتاعه في الخط الزمني — عرض فقط، لا كتابة ولا حذف من هنا.
  const cards = (clients || [])
    .map((client: Client) => {
      const list = (byPhone.get(norm(client.phone)) || [])
        .slice()
        .sort((a: DailyFeedback, b: DailyFeedback) => Date.parse(b.date || b.createdAt) - Date.parse(a.date || a.createdAt));
      return {
        client,
        list,
        lastStatus: list[0]?.status || latestFeedbackStatusOf(client) || '',
        lastText: String(list[0]?.feedback || '').replace(/^فيدباك:\s*/, '').replace(/^من المكالمة:\s*/, ''),
        latest: Date.parse(list[0]?.date || list[0]?.createdAt) || 0,
        updated: Date.parse(client.updatedAt) || 0,
      };
    })
    .sort((a: any, b: any) => b.latest - a.latest || b.updated - a.updated);
  const totalFeedbacks = cards.reduce((sum: number, card: any) => sum + card.list.length, 0);

  return (
    <div className="space-y-4">
      <div className="page-intro">
        <div>
          <h2>الفيدباك</h2>
          <p className="text-xs text-[var(--text-muted)] mt-1">
            {cards.length} عميل • {totalFeedbacks} فيدباك — اضغط على أي عميل لعرض كل الفيدباك بتاعه (عرض فقط)
          </p>
        </div>
      </div>

      {cards.length === 0 && (
        <div className="panel p-8 text-center">
          <MessageSquare className="w-12 h-12 text-[var(--text-dim)] mx-auto mb-3" />
          <p className="text-[var(--text-muted)] text-sm">لا يوجد عملاء عندك بعد — أول عميل يتحوّل من أرقامك هيظهر هنا بكل فيدباكه.</p>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
        {cards.map((card: any) => (
          <button
            key={card.client.id}
            type="button"
            onClick={() => setHistoryClient(card.client)}
            className="panel p-4 text-right w-full hover:border-[var(--accent-border)] transition-colors"
            title="عرض كل الفيدباك والخط الزمني لهذا العميل"
          >
            <div className="flex items-center gap-2.5">
              <span className="fb-avatar">{String(card.client.name || '؟').trim().charAt(0)}</span>
              <span className="min-w-0 flex-1">
                <b className="block text-sm font-bold text-[var(--text-strong)] truncate">{card.client.name}</b>
                <span className="block text-xs text-[var(--text-muted)]" dir="ltr">{card.client.phone}</span>
              </span>
              <span className="fb-count shrink-0">{card.list.length} فيدباك</span>
            </div>
            <div className="flex items-center gap-1.5 mt-2 flex-wrap">
              {card.lastStatus ? <FeedbackChip status={card.lastStatus} /> : <span className="text-[10.5px] text-[var(--text-dim)]">بدون فيدباك بعد</span>}
              {card.list[0] && <span className="text-[10.5px] text-[var(--text-dim)]">{formatDateTime(card.list[0].date || card.list[0].createdAt)}</span>}
            </div>
            {card.lastText && (
              <p className="mt-2 text-xs text-[var(--text)] leading-relaxed line-clamp-2">{card.lastText}</p>
            )}
          </button>
        ))}
      </div>

      <AnimatePresence>
        {historyClient && (
          <ClientCommentsModal
            client={historyClient}
            users={users}
            callLogs={callLogs}
            feedbacks={feedbacks}
            onClose={() => setHistoryClient(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// Reports View
// ===== لوحة تحليلات الإدارة: قمع المراحل + أداء الفريق + مصادر الليدز =====
function AdminAnalyticsView({ clients, users, feedbacks, properties, reminders }: any) {
  const stages = [
    { id: 'new', label: 'جديد', color: 'stg-new' },
    { id: 'contacted', label: 'تم التواصل', color: 'stg-contacted' },
    { id: 'meeting', label: 'موعد معاينة', color: 'stg-meeting' },
    { id: 'negotiation', label: 'تفاوض', color: 'stg-negotiation' },
    { id: 'closed', label: 'تم البيع', color: 'stg-closed' },
    { id: 'lost', label: 'ضائع', color: 'stg-lost' },
  ];
  const total = clients.length;
  const countOf = (id: string) => clients.filter((c: Client) => c.stage === id).length;
  const closed = countOf('closed');
  const conversion = total ? ((closed / total) * 100).toFixed(1) : '0';
  const maxStage = Math.max(1, ...stages.map((s) => countOf(s.id)));
  const overdue = (reminders || []).filter((r: Reminder) => !r.isCompleted && new Date(r.dateTime) <= new Date()).length;

  // مصادر الليدز
  const sources = new Map<string, number>();
  clients.forEach((c: Client) => {
    const key = (c.source || '').trim() ||
      (c.status === 'campaign' ? 'كامبين' : c.status === 'facebook' ? 'فيسبوك' : 'غير محدد');
    sources.set(key, (sources.get(key) || 0) + 1);
  });
  const topSources = Array.from(sources.entries()).sort((a: [string, number], b: [string, number]) => b[1] - a[1]).slice(0, 6);
  const maxSource = Math.max(1, ...topSources.map(([, n]) => n));

  // أكثر أنواع العقارات المعروضة
  const types = new Map<string, number>();
  (properties || []).forEach((p: Property) => {
    const key = p.type || 'غير محدد';
    types.set(key, (types.get(key) || 0) + 1);
  });
  const topTypes = Array.from(types.entries()).sort((a: [string, number], b: [string, number]) => b[1] - a[1]).slice(0, 6);

  // أداء كل سيلز — بما فيهم حساب المطوّر (إداري في القاعدة، سيلز في الشغل)
  const salesUsers = (users || []).filter((u: User) => ['sales', 'supervisor'].includes(effectiveRoleOf(u)));
  const rows = salesUsers
    .map((u: User) => {
      const mine = clients.filter((c: Client) => c.userId === u.id || c.assignedTo === u.id);
      const mineClosed = mine.filter((c: Client) => c.stage === 'closed').length;
      const mineLost = mine.filter((c: Client) => c.stage === 'lost').length;
      const mineFeedbacks = (feedbacks || []).filter((f: DailyFeedback) => f.userId === u.id);
      const mineOverdue = (reminders || []).filter((r: Reminder) => !r.isCompleted && r.userId === u.id && new Date(r.dateTime) <= new Date()).length;
      const lastTouch = mine.reduce((max: string, c: Client) => (c.updatedAt && c.updatedAt > max ? c.updatedAt : max), '');
      return {
        user: u,
        total: mine.length,
        closed: mineClosed,
        lost: mineLost,
        feedbacks: mineFeedbacks.length,
        overdue: mineOverdue,
        conversion: mine.length ? Math.round((mineClosed / mine.length) * 100) : 0,
        lastTouch,
      };
    })
    .sort((a: any, b: any) => b.closed - a.closed || b.total - a.total);

  const kpis = [
    { label: 'إجمالي العملاء', value: total, icon: Users },
    { label: 'صفقات مغلقة', value: closed, icon: Award },
    { label: 'نسبة التحويل', value: `${conversion}%`, icon: TrendingUp },
    { label: 'تذكيرات متأخرة', value: overdue, icon: Bell },
    { label: 'العقارات', value: (properties || []).length, icon: Building2 },
  ];

  return (
    <div className="space-y-6">
      <div className="page-intro"><div><h2>لوحة التحليلات</h2></div></div>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {kpis.map((k) => (
          <div key={k.label} className="panel p-4">
            <div className="kpi-icon mb-2">
              <k.icon className="w-5 h-5" />
            </div>
            <p className="text-2xl font-bold text-[var(--text-strong)]">{k.value}</p>
            <p className="text-xs text-[var(--text-muted)] mt-0.5">{k.label}</p>
          </div>
        ))}
      </div>

      <div className="panel p-5">
        <h3 className="font-bold text-[var(--text-strong)] mb-1 flex items-center gap-2"><Target className="w-4 h-4 text-[var(--text-muted)]" /> قمع المراحل</h3>
        <p className="text-xs text-[var(--text-muted)] mb-4">عدد العملاء في كل مرحلة ونسبتهم من إجمالي {total} عميل</p>
        <div className="space-y-3">
          {stages.map((s) => {
            const n = countOf(s.id);
            const pct = total ? Math.round((n / total) * 100) : 0;
            return (
              <div key={s.id}>
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="text-[var(--text)]">{s.label}</span>
                  <span className="text-[var(--text-muted)]">{n} عميل • {pct}%</span>
                </div>
                <div className="h-2.5 bg-[var(--tint-1)] rounded-full overflow-hidden">
                  <div className={`h-full ${s.color} rounded-full`} style={{ width: `${(n / maxStage) * 100}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="panel p-5">
          <h3 className="font-bold text-[var(--text-strong)] mb-4 flex items-center gap-2"><Zap className="w-4 h-4 text-[var(--brand)]" /> مصادر الليدز</h3>
          {topSources.length === 0 ? (
            <p className="text-sm text-[var(--text-dim)]">لا توجد بيانات بعد</p>
          ) : (
            <div className="space-y-3">
              {topSources.map(([name, n]) => (
                <div key={name}>
                  <div className="flex items-center justify-between text-xs mb-1 gap-2">
                    <span className="text-[var(--text)] truncate">{name}</span>
                    <span className="text-[var(--text-muted)] shrink-0">{n}</span>
                  </div>
                  <div className="h-2 bg-[var(--tint-1)] rounded-full overflow-hidden">
                    <div className="h-full bg-[var(--brand-fill)] rounded-full" style={{ width: `${(n / maxSource) * 100}%` }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="panel p-5">
          <h3 className="font-bold text-[var(--text-strong)] mb-4 flex items-center gap-2"><Building2 className="w-4 h-4 text-[var(--text-muted)]" /> أنواع العقارات المعروضة</h3>
          {topTypes.length === 0 ? (
            <p className="text-sm text-[var(--text-dim)]">لا توجد عقارات بعد</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {topTypes.map(([name, n]) => (
                <span key={name} className="text-xs bg-[var(--tint-1)] border border-[var(--border)] text-[var(--text)] rounded-full px-3 py-1.5">
                  {name} • <span className="text-[var(--text)] font-bold">{n}</span>
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="panel p-5">
        <h3 className="font-bold text-[var(--text-strong)] mb-4 flex items-center gap-2"><Users className="w-4 h-4 text-[var(--text-muted)]" /> أداء فريق المبيعات</h3>
        {rows.length === 0 ? (
          <p className="text-sm text-[var(--text-dim)]">لا يوجد سيلز بعد</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[var(--text-muted)] text-xs">
                  <th className="text-right font-medium pb-2">السيلز</th>
                  <th className="text-center font-medium pb-2">العملاء</th>
                  <th className="text-center font-medium pb-2">مغلقة</th>
                  <th className="text-center font-medium pb-2">ضائعة</th>
                  <th className="text-center font-medium pb-2">التحويل</th>
                  <th className="text-center font-medium pb-2">فيدباك</th>
                  <th className="text-center font-medium pb-2">متأخرة</th>
                  <th className="text-right font-medium pb-2">آخر نشاط</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r: any) => (
                  <tr key={r.user.id} className="border-t border-[var(--border-soft)]">
                    <td className="py-2.5 text-[var(--text-strong)] font-medium">{r.user.name}</td>
                    <td className="text-center text-[var(--text)]">{r.total}</td>
                    <td className="text-center text-emerald-400 font-bold">{r.closed}</td>
                    <td className="text-center text-red-400">{r.lost}</td>
                    <td className="text-center text-[var(--brand)] font-bold">{r.conversion}%</td>
                    <td className="text-center text-[var(--text)]">{r.feedbacks}</td>
                    <td className={`text-center ${r.overdue ? 'text-amber-400 font-bold' : 'text-[var(--text-dim)]'}`}>{r.overdue}</td>
                    <td className="text-left text-xs text-[var(--text-muted)]" dir="ltr">{r.lastTouch ? formatDateTime(r.lastTouch) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// عناوين الدفعات السنوية الثلاث (اختيارية)
const YEARLY_LABELS = ['الدفعة السنوية ١ (%)', 'الدفعة السنوية ٢ (%)', 'الدفعة السنوية ٣ (%)'];

// ===== حساب المقدم والأقساط =====
// أداة عرض سعر للسيلز: المبلغ الكلي + نسبة المقدم + عدد السنين، وتطلع
// المقدم بالجنيه، المتبقي بعد المقدم، والقسط الشهري (المتبقي ÷ عدد الأشهر).
// الحساب كله في المتصفح — لا يُحفظ ولا يُزامَن؛ أرقام معروضة على العميل فقط.
function InstallmentCalculatorView() {
  const [total, setTotal] = useState('');
  const [percent, setPercent] = useState('');
  const [years, setYears] = useState('');
  // حقول اختيارية: سعر المتر × المساحة = إجمالي سعر الشقة (بدل المبلغ الكلي)
  const [pricePerMeter, setPricePerMeter] = useState('');
  const [area, setArea] = useState('');
  // ثلاث دفعات سنوية اختيارية (نسب %): مجموعها يتخصم مع المقدم من المبلغ الكلي
  const [yearly, setYearly] = useState<string[]>(['', '', '']);
  const writeYearly = (index: number, value: string) =>
    setYearly((prev) => prev.map((v, i) => (i === index ? value : v)));
  const totalRef = useRef<HTMLInputElement | null>(null);
  const meterRef = useRef<HTMLInputElement | null>(null);
  const caretRef = useRef<number | null>(null);
  const meterCaretRef = useRef<number | null>(null);

  // بعد ما الفواصل تتضاف، نرجّع المؤشر مكانه: لو عدّلت في وسط الرقم ما ينطش لآخره
  useEffect(() => {
    const pairs = [
      [totalRef, caretRef],
      [meterRef, meterCaretRef],
    ] as const;
    for (const [inputRef, caret] of pairs) {
      if (caret.current === null || !inputRef.current) continue;
      inputRef.current.setSelectionRange(caret.current, caret.current);
      caret.current = null;
    }
  }, [total, pricePerMeter]);

  // الإجمالي: لو سعر المتر والمساحة موجودين يتحسب منهم، وإلا المبلغ اللي اتكتب بنفسه
  const computedTotal = areaTotal(pricePerMeter, area);
  const fromArea = computedTotal > 0;
  const calc: InstallmentBreakdown = installmentBreakdown(fromArea ? computedTotal : total, percent, years, yearly);
  const { percent: percentNum, years: yearsNum, downPayment: down, remaining, months, monthly, ready } = calc;
  const { annualPercents, annualPercent, annualPayments, annualTotal } = calc;
  const totalNum = calc.total;
  const areaNum = Number(normalizeArea(area).replace(/\.$/, '')) || 0;

  const money = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 2 });

  // حقل مبلغ بفواصل آلاف: القيمة المحفوظة أرقام فقط، والمعروضة منسّقة (1,600,000)
  const writeGrouped = (
    input: HTMLInputElement,
    setter: (value: string) => void,
    caret: { current: number | null }
  ) => {
    const at = input.selectionStart ?? input.value.length;
    const digitsBefore = digitsOnly(input.value.slice(0, at)).length;
    const digits = digitsOnly(input.value).slice(0, 12);
    setter(digits);
    caret.current = caretAfterGrouping(groupThousands(digits), digitsBefore);
  };

  const reset = () => {
    setTotal('');
    setPricePerMeter('');
    setArea('');
    setYearly(['', '', '']);
    caretRef.current = null;
    meterCaretRef.current = null;
    setPercent('');
    setYears('');
  };

  const rows = [
    {
      label: 'المقدم المدفوع',
      value: percentNum > 0 && totalNum > 0 ? `${money(down)} ج.م` : '—',
      note: percentNum > 0 && totalNum > 0 ? `${money(percentNum)}% من ${money(totalNum)}` : '',
    },
    ...(annualTotal > 0
      ? [
          {
            label: 'الدفعات السنوية',
            value: `${money(annualTotal)} ج.م`,
            note: `${annualPercents.map((p) => `${money(p)}%`).join(' + ')} = ${money(annualPercent)}% من ${money(totalNum)}`,
          },
        ]
      : []),
    {
      label: annualTotal > 0 ? 'المبلغ بعد خصم المقدم والدفعات' : 'المبلغ بعد خصم المقدم',
      value: totalNum > 0 ? `${money(remaining)} ج.م` : '—',
      note: annualTotal > 0 ? `${money(down)} مقدم + ${money(annualTotal)} دفعات` : '',
    },
    {
      label: 'عدد الأشهر',
      value: months > 0 ? `${money(months)} شهر` : '—',
      note: yearsNum > 0 ? `${money(yearsNum)} سنة × ${MONTHS_PER_YEAR} شهر` : '',
    },
  ];

  const field = (label: string, value: string, onChange: (v: string) => void, placeholder: string) => (
    <label className="block">
      <span className="block text-[11.5px] text-[var(--text-muted)] mb-1">{label}</span>
      <input
        type="number"
        min={0}
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        dir="ltr"
        className="w-full bg-[var(--tint-1)] border border-[var(--border)] rounded-[var(--r-sm)] px-3 py-2 text-[var(--text-strong)] text-sm tabular-nums focus:outline-none focus:border-[var(--brand)]"
      />
    </label>
  );

  return (
    <div className="space-y-6">
      <div className="page-intro">
        <div className="min-w-0">
          <h2>حساب المقدم والأقساط</h2>
          <p>اعرف المقدم والمتبقي والقسط الشهري قبل ما تعرض السعر على العميل</p>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(280px,340px)]">
        <section className="panel p-5">
          <div className="flex items-center justify-between gap-3 mb-4">
            <h3 className="font-bold text-[var(--text-strong)] flex items-center gap-2">
              <Calculator className="w-4 h-4 text-[var(--text-dim)]" /> بيانات العرض
            </h3>
            <button
              type="button"
              onClick={reset}
              className="text-[11.5px] text-[var(--text-muted)] hover:text-[var(--text)] transition-colors"
            >
              مسح الحقول
            </button>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <label className="block">
              <span className="block text-[11.5px] text-[var(--text-muted)] mb-1">
                المبلغ الكلي (ج.م){fromArea && <span className="text-[var(--text-dim)]"> — محسوب</span>}
              </span>
              <input
                ref={totalRef}
                type="text"
                inputMode="numeric"
                autoComplete="off"
                value={fromArea ? money(computedTotal) : groupThousands(total)}
                onChange={(e) => writeGrouped(e.currentTarget, setTotal, caretRef)}
                disabled={fromArea}
                placeholder="1,600,000"
                dir="ltr"
                className={`w-full bg-[var(--tint-1)] border border-[var(--border)] rounded-[var(--r-sm)] px-3 py-2 text-[var(--text-strong)] text-sm tabular-nums focus:outline-none focus:border-[var(--brand)]${fromArea ? ' opacity-70 cursor-not-allowed' : ''}`}
              />
            </label>
            {field('المقدم (%)', percent, setPercent, '8')}
            {field('عدد السنين', years, setYears, '8')}
          </div>

          {/* اختياري: سعر المتر × المساحة = إجمالي سعر الشقة، ويُستخدم بدل المبلغ الكلي */}
          <div className="mt-4 pt-3 border-t border-[var(--border-soft)]">
            <p className="text-[11.5px] text-[var(--text-muted)] mb-2">
              أو احسبها من المساحة <span className="text-[var(--text-dim)]">— اختياري، وبيستخدم بدل المبلغ الكلي</span>
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="block text-[11.5px] text-[var(--text-muted)] mb-1">سعر المتر (ج.م)</span>
                <input
                  ref={meterRef}
                  type="text"
                  inputMode="numeric"
                  autoComplete="off"
                  value={groupThousands(pricePerMeter)}
                  onChange={(e) => writeGrouped(e.currentTarget, setPricePerMeter, meterCaretRef)}
                  placeholder="25,000"
                  dir="ltr"
                  className="w-full bg-[var(--tint-1)] border border-[var(--border)] rounded-[var(--r-sm)] px-3 py-2 text-[var(--text-strong)] text-sm tabular-nums focus:outline-none focus:border-[var(--brand)]"
                />
              </label>
              <label className="block">
                <span className="block text-[11.5px] text-[var(--text-muted)] mb-1">مساحة الشقة (م²)</span>
                <input
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  value={area}
                  onChange={(e) => setArea(normalizeArea(e.currentTarget.value))}
                  placeholder="120"
                  dir="ltr"
                  className="w-full bg-[var(--tint-1)] border border-[var(--border)] rounded-[var(--r-sm)] px-3 py-2 text-[var(--text-strong)] text-sm tabular-nums focus:outline-none focus:border-[var(--brand)]"
                />
              </label>
            </div>
            <p className="text-[11px] leading-relaxed text-[var(--text-dim)] mt-2">
              {fromArea
                ? `إجمالي سعر الشقة: ${money(computedTotal)} ج.م (${money(areaNum)} م² × ${money(Number(pricePerMeter))} ج.م)`
                : 'لو مليت سعر المتر والمساحة، الإجمالي يتحسب منهم تلقائيًا — ولو سيبتهم فاضيين بنستخدم المبلغ الكلي اللي فوق.'}
            </p>
          </div>

          {/* اختياري: ثلاث دفعات سنوية — مجموع نسبها يتخصم مع المقدم */}
          <div className="mt-4 pt-3 border-t border-[var(--border-soft)]">
            <p className="text-[11.5px] text-[var(--text-muted)] mb-2">
              دفعات سنوية <span className="text-[var(--text-dim)]">— اختياري، مجموعها بيتخصم من المبلغ الكلي مع المقدم</span>
            </p>
            <div className="grid gap-3 sm:grid-cols-3">
              {YEARLY_LABELS.map((label, i) => (
                <label key={label} className="block">
                  <span className="block text-[11.5px] text-[var(--text-muted)] mb-1">{label}</span>
                  <input
                    type="number"
                    min={0}
                    inputMode="decimal"
                    value={yearly[i] ?? ''}
                    onChange={(e) => writeYearly(i, e.target.value)}
                    placeholder={['10', '20', '10'][i]}
                    dir="ltr"
                    className="w-full bg-[var(--tint-1)] border border-[var(--border)] rounded-[var(--r-sm)] px-3 py-2 text-[var(--text-strong)] text-sm tabular-nums focus:outline-none focus:border-[var(--brand)]"
                  />
                  <span className="block text-[10.5px] text-[var(--text-dim)] mt-1 tabular-nums" dir="ltr">
                    {annualPayments[i] ? `= ${money(annualPayments[i])} ج.م` : '\u00a0'}
                  </span>
                </label>
              ))}
            </div>
            <p className="text-[11px] leading-relaxed text-[var(--text-dim)] mt-2">
              {annualPercent > 0
                ? `${annualPercents.map((p) => `${money(p)}%`).join(' + ')} = ${money(annualPercent)}% من المبلغ الكلي (${money(annualTotal)} ج.م) بتتخصم مع المقدم.`
                : 'لو مليهاش، الحسبة بتفضل على المقدم بس زي ما هي.'}
            </p>
          </div>

          {(percentNum > 100 || percentNum + annualPercent > 100) && (
            <p className="text-[11.5px] text-[var(--warn)] mt-2">
              {percentNum > 100
                ? 'نسبة المقدم أكبر من 100% — راجع الرقم.'
                : 'مجموع المقدم والدفعات السنوية أكبر من 100% — راجع الأرقام.'}
            </p>
          )}

          <p className="text-[11px] leading-relaxed text-[var(--text-dim)] mt-4 pt-3 border-t border-[var(--border-soft)]">
            المقدم = المبلغ الكلي × نسبة المقدم. المتبقي = المبلغ الكلي − المقدم − الدفعات السنوية. القسط الشهري = المتبقي ÷ (عدد السنين × ١٢ شهر).
          </p>
        </section>

        <section className="panel p-5 flex flex-col">
          <p className="text-[11.5px] text-[var(--text-muted)]">القسط الشهري</p>
          <p className="mt-1 leading-none font-bold text-[32px] tabular-nums text-[var(--text-strong)]" dir="ltr">
            {ready ? money(monthly) : '—'}
          </p>
          <p className="text-[11px] text-[var(--text-dim)] mt-2">
            {ready ? `جنيه شهريًا لمدة ${money(months)} شهر` : 'اكتب المبلغ وعدد السنين عشان يظهر القسط'}
          </p>

          <div className="mt-4 pt-3 border-t border-dashed border-[var(--border)] space-y-2.5">
            {rows.map((row) => (
              <div key={row.label} className="flex items-baseline justify-between gap-2">
                <span className="text-[12px] text-[var(--text-muted)]">
                  {row.label}
                  {row.note && <span className="block text-[10.5px] text-[var(--text-dim)]">{row.note}</span>}
                </span>
                <span className="text-[13px] font-bold text-[var(--text)] tabular-nums whitespace-nowrap">{row.value}</span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

// ===== «التقارير» = تقريرك الشخصي أنت فقط (لا علاقة له بإحصائيات الرئيسية) =====
function ReportsView({ clients, feedbacks, reminders }: any) {
  const mine: Client[] = clients || [];
  const closed = mine.filter((c) => c.stage === 'closed').length;
  const lost = mine.filter((c) => c.stage === 'lost').length;
  const conversion = mine.length ? Math.round((closed / mine.length) * 100) : 0;
  const myFeedbacks: DailyFeedback[] = feedbacks || [];
  const calls = myFeedbacks.filter((f) => f.callStatus === 'called').length;
  const noAnswer = myFeedbacks.filter((f) => f.callStatus === 'no-answer').length + myFeedbacks.filter((f) => f.callStatus === 'busy').length;
  const overdue = (reminders || []).filter((r: Reminder) => !r.isCompleted && isReminderDue(r)).length;

  const stages = [
    { id: 'new', label: 'جديد', color: 'stg-new' },
    { id: 'contacted', label: 'تم التواصل', color: 'stg-contacted' },
    { id: 'meeting', label: 'موعد معاينة', color: 'stg-meeting' },
    { id: 'negotiation', label: 'تفاوض', color: 'stg-negotiation' },
    { id: 'closed', label: 'تم البيع', color: 'stg-closed' },
    { id: 'lost', label: 'ضائع', color: 'stg-lost' },
  ];
  const maxStage = Math.max(1, ...stages.map((s) => mine.filter((c) => c.stage === s.id).length));

  // نشاطي في آخر ٧ أيام — محسوب من الخط الزمني لعملائي
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (6 - i));
    return { key: d.toDateString(), label: d.toLocaleDateString('ar-EG', { weekday: 'short' }), count: 0 };
  });
  mine.forEach((c) => {
    (c.activities || []).forEach((a) => {
      const hit = days.find((d) => d.key === new Date(a.at).toDateString());
      if (hit) hit.count += 1;
    });
  });
  const maxDay = Math.max(1, ...days.map((d) => d.count));
  const weekTotal = days.reduce((sum, d) => sum + d.count, 0);

  const kpis = [
    { label: 'صفقاتي المغلقة', value: closed, icon: Award },
    { label: 'نسبة تحويلي', value: `${conversion}%`, icon: TrendingUp },
    { label: 'عملاء تحت المتابعة', value: mine.length - closed - lost, icon: Users },
    { label: 'مكالماتي المسجلة', value: calls, icon: PhoneCall },
    { label: 'لم يُردّ عليها', value: noAnswer, icon: AlertTriangle },
    { label: 'تذكيرات متأخرة', value: overdue, icon: Bell },
  ];

  return (
    <div className="space-y-6">
      <div>
        <div className="page-intro"><div><h2>تقريري الشخصي</h2></div></div>
        <p className="text-xs text-[var(--text-muted)] mt-1">أداؤك أنت فقط خلال فترة عملك — ليس إحصائيات الفريق.</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        {kpis.map((k) => (
          <div key={k.label} className="panel p-4">
            <div className="kpi-icon mb-2">
              <k.icon className="w-5 h-5" />
            </div>
            <p className="text-2xl font-bold text-[var(--text-strong)]">{k.value}</p>
            <p className="text-xs text-[var(--text-muted)] mt-0.5">{k.label}</p>
          </div>
        ))}
      </div>

      <div className="panel p-5">
        <h3 className="font-bold text-[var(--text-strong)] mb-1 flex items-center gap-2"><Target className="w-4 h-4 text-[var(--text-muted)]" /> عملائي على المراحل</h3>
        <p className="text-xs text-[var(--text-muted)] mb-4">إجمالي عملائك: {mine.length} — مغلقة: {closed} • ضائعة: {lost}</p>
        <div className="space-y-3">
          {stages.map((s) => {
            const n = mine.filter((c) => c.stage === s.id).length;
            return (
              <div key={s.id}>
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="text-[var(--text)]">{s.label}</span>
                  <span className="text-[var(--text-muted)]">{n}</span>
                </div>
                <div className="h-2.5 bg-[var(--tint-1)] rounded-full overflow-hidden">
                  <div className={`h-full ${s.color} rounded-full`} style={{ width: `${(n / maxStage) * 100}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="panel p-5">
        <h3 className="font-bold text-[var(--text-strong)] mb-1 flex items-center gap-2"><Activity className="w-4 h-4 text-[var(--text-dim)]" /> نشاطي في آخر ٧ أيام</h3>
        <p className="text-xs text-[var(--text-muted)] mb-4">إجمالي الأحداث: {weekTotal} (مكالمات، فيديباك، تغيير مراحل، واتساب)</p>
        <div className="flex items-end justify-between gap-1.5 h-28">
          {days.map((d) => (
            <div key={d.key} className="flex-1 flex flex-col items-center gap-1.5">
              <span className="text-[10px] text-[var(--text-muted)]">{d.count || ''}</span>
              <div className="w-full bg-[var(--brand)] rounded-[var(--r-xs)]"
                style={{ height: `${Math.max(4, (d.count / maxDay) * 80)}px` }} />
              <span className="text-[10px] text-[var(--text-dim)]">{d.label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// Admin Feedback View - Show feedback for each sales person
function AdminFeedbackView({ users, dailyFeedbacks, clients, leads = [], callLogs = [], onSelect }: any) {
  // كل من يعمل «سيلز» فعلياً — بما فيهم حساب المطوّر (role في القاعدة admin لكن
  // سلوكه سيلز)، وإلا كان حسابه غايباً عن لوحة الفيدباك اليومي وكومنتاته كمان.
  const salesUsers = users.filter((u: User) => {
    const role = effectiveRoleOf(u);
    return role === 'sales' || role === 'supervisor';
  });
  const [showComments, setShowComments] = useState(false);
  const totalComments = callLogs.filter((l: CallLog) => l.comment).length +
    clients.reduce((acc: number, c: Client) => acc + (c.activities || []).filter((a: ClientActivity) => /feedback|call|comment|note/i.test(`${a.type}`)).length, 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <h2 className="text-xl font-bold gradient-text flex items-center gap-2">
          <MessageSquare className="w-6 h-6" />
          الفيدباك اليومي لكل سيلز
        </h2>
        {/* زرار يعرض كل التعليقات وعددهم + زرار تلخيص للـ CEO */}
        <button onClick={() => setShowComments(true)}
          className="flex items-center gap-2 text-xs font-bold text-amber-300 bg-amber-400/15 border border-amber-400/30 rounded-[var(--r-md)] px-3.5 py-2.5 hover:bg-amber-400/25 transition-colors self-start">
          <MessageSquare className="w-4 h-4" /> كل التعليقات
          <span className="bg-amber-400/25 rounded-full px-2 py-0.5">{totalComments}</span>
          <span className="text-[var(--text-muted)] font-normal">+ تلخيص</span>
        </button>
      </div>

      <AnimatePresence>
        {showComments && <CommentsBoardModal clients={clients} callLogs={callLogs} onClose={() => setShowComments(false)} />}
      </AnimatePresence>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {salesUsers.map((user: User) => {
          // نفس مصدر صفحة التفاصيل بالأسفل (بما فيها بطاقات «الفيدباك اليومي»)
          // حتى تتطابق الأرقام مع ما يفتح بالضغط
          const nums = mergeDailyFeedbackCards(
            salesFeedbackByNumber(user.id, clients, leads, callLogs, user.name),
            user.id,
            dailyFeedbacks
          );
          const today = new Date().toDateString();
          const allItems = nums.flatMap((n) => n.items);
          const todayFeedbacks = allItems.filter((i) => new Date(i.at).toDateString() === today);
          const withFeedback = nums.filter((n) => n.items.length).length;
          const userLogs = (callLogs || []).filter((l: CallLog) => l.salesId === user.id);
          const calledToday = userLogs.filter((l: CallLog) => l.result === 'answered' && new Date(l.createdAt).toDateString() === today).length;
          const totalCalls = userLogs.length;
          
          return (
            <motion.div
              key={user.id}
              whileHover={{ scale: 1.02, y: -5 }}
              onClick={() => onSelect(user)}
              className="panel p-5 cursor-pointer"
            >
              <div className="flex items-center gap-3 mb-4">
                <div className="w-12 h-12 gradient-primary rounded-full flex items-center justify-center">
                  <span className="text-[var(--text-strong)] font-bold">{user.name[0]}</span>
                </div>
                <div>
                  <h4 className="font-bold text-[var(--text-strong)]">{user.name}</h4>
                  {/* الرتبة الحقيقية: الإداري الذي يعمل سيلزاً (فريدة) يظهر «CEO»،
                      وحساب المطوّر يبقى يظهر «سيلز» كما هو. */}
                  <p className="text-sm text-[var(--text-muted)]">{isDeveloperAccount(user) ? 'سيلز' : user.role === 'admin' ? 'CEO' : effectiveRoleOf(user) === 'supervisor' ? 'مشرف' : 'سيلز'}</p>
                </div>
              </div>
              
              <div className="grid grid-cols-2 gap-2">
                <div className="bg-[var(--brand-primary-softer)] rounded-[var(--r-sm)] p-3 text-center">
                  <p className="text-2xl font-bold text-[var(--text-muted)]">{todayFeedbacks.length}</p>
                  <p className="text-xs text-[var(--text-muted)]">فيدباك اليوم</p>
                </div>
                <div className="bg-[var(--brand-primary-softer)] rounded-[var(--r-sm)] p-3 text-center col-span-2">
                  <p className="text-2xl font-bold text-[var(--brand)]">{nums.length} <span className="text-sm text-[var(--text-muted)] font-normal">رقم — {withFeedback} فيه فيدباك</span></p>
                  <p className="text-xs text-[var(--text-muted)]">أرقامه المسجّلة</p>
                </div>
                <div className="bg-emerald-500/10 rounded-[var(--r-sm)] p-3 text-center">
                  <p className="text-2xl font-bold text-emerald-400">{calledToday}</p>
                  <p className="text-xs text-[var(--text-muted)]">مكالمات اليوم</p>
                </div>
                <div className="bg-[var(--brand-primary-softer)] rounded-[var(--r-sm)] p-3 text-center">
                  <p className="text-2xl font-bold text-[var(--brand)]">{allItems.length}</p>
                  <p className="text-xs text-[var(--text-muted)]">إجمالي الفيدباك</p>
                </div>
                <div className="bg-amber-500/10 rounded-[var(--r-sm)] p-3 text-center">
                  <p className="text-2xl font-bold text-amber-400">{totalCalls}</p>
                  <p className="text-xs text-[var(--text-muted)]">إجمالي المكالمات</p>
                </div>
              </div>

              {/* مراحل عملاء هذا السيلز — نظرة سريعة بجانب الفيدباك */}
              {(() => {
                const userClients = clients.filter((c: Client) => c.userId === user.id || c.assignedTo === user.id);
                if (!userClients.length) return null;
                return (
                  <div className="mt-3 border-t border-[var(--border)] pt-3" onClick={(e) => e.stopPropagation()}>
                    <p className="text-[11px] text-[var(--text-muted)] mb-1.5">مراحل عملائه ({userClients.length}):</p>
                    <div className="flex flex-wrap gap-1.5">
                      {Object.entries(STAGE_META).map(([id, meta]) => {
                        const count = userClients.filter((c: Client) => c.stage === id).length;
                        if (!count) return null;
                        return (
                          <span key={id} className={meta.cls}>
                            {meta.icon} {meta.label}: {count}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}
              
              <p className="text-xs text-[var(--text-dim)] mt-3 text-center">اضغط لفتح صفحة الأرقام والفيدباك</p>
            </motion.div>
          );
        })}
      </div>

      {salesUsers.length === 0 && (
        <div className="text-center py-16">
          <Users className="w-16 h-16 text-[var(--text-dim)] mx-auto mb-4" />
          <p className="text-[var(--text-muted)]">لا يوجد سيلز في الفريق</p>
        </div>
      )}
    </div>
  );
}

// Admin Users View - Simplified
function AdminUsersView({ users, currentUser, onSelect, onAdd, onEdit, onDelete, onImpersonate }: any) {
  // التبويبات داخل «فريق العمل»: الحسابات، ثم قناة سحب الأرقام (فيسبوك / إنستجرام).
  // الإعداد يبقى محفوظاً على هذا الجهاز فقط ليعود المدير لنفس التبويب الذي تركه.
  const [view, setView] = useState<'accounts' | LeadChannel>(() => {
    const saved = localStorage.getItem('crm_admin_users_tab');
    return saved === 'facebook' || saved === 'instagram' ? saved : 'accounts';
  });
  const switchView = (next: 'accounts' | LeadChannel) => {
    setView(next);
    localStorage.setItem('crm_admin_users_tab', next);
  };
  const isAdmin = currentUser?.role === 'admin';
  // سحب أرقام الكامبين متاح للإدارة كلها: CEO و Team Leader.
  // السيرفر يسمح للرتبتين بنفس الصلاحية (isManagerRole في api/lead-source)،
  // فقائد الفريق يستطيع لصق التوكن (الكود) وسحب أرقام كامبين لتوزيعها على فريقه.
  const canPullCampaigns = currentUser?.role === 'admin' || currentUser?.role === 'supervisor';
  // حماية: لا يُحذف حساب CEO الرئيسي، ولا يستطيع قائد الفريق حذف أو تعديل الـ CEO
  // حساب الإدارة الأساسي (admin) يمكنه حذف حسابات المدراء (supervisor) وحسابات الإدارة الأخرى
  const isMainAdmin = currentUser?.role === 'admin' && currentUser?.username === 'admin';
  const canDelete = (user: User) => {
    if (user.id === currentUser.id) return false;
    if (user.role === 'admin' && user.username === 'admin' && currentUser.username === 'admin') return false; // لا يحذف نفسه
    // admin الرئيسي يمكنه حذف أي حساب ماعدا نفسه وحساب admin الرئيسي إن وجد آخر
    if (isMainAdmin) {
      // لا يسمح بحذف حساب admin الرئيسي نفسه
      if (user.username === 'admin' && user.role === 'admin') return false;
      return true; // يمكنه حذف المدراء والإداريين الآخرين
    }
    // بقية الإداريين: لا يستطيعون حذف حسابات admin
    if (user.role === 'admin') return false;
    // قائد الفريق لا يستطيع حذف قائد فريق آخر
    if (currentUser.role === 'supervisor' && user.role === 'supervisor') return false;
    return true;
  };
  const canEdit = (user: User) =>
    user.id !== currentUser.id ? !(currentUser.role === 'supervisor' && user.role === 'admin') : true;
  // ===== الدخول لحساب أي مستخدم (بدون كلمة مرور) =====
  // الإدارة بتدخل حسابات السيلز عادي. وحساب الـ CEO (admin) محمي من الدخول عليه
  // — إلا حساب «المطوّر» (system dev): أعلى صلاحية في النظام، فيدخل أي حساب
  // متاح (ومنهم حساب الـ CEO) ويشوف كل البيانات بعيون الحساب ده.
  const canImpersonate = (user: User) => {
    if (!onImpersonate) return false;
    if (user.id === currentUser.id) return false;
    if (!user.isActive) return false;
    if (isDeveloperAccount(currentUser)) return true;
    return user.role !== 'admin' || !!user.developer;
  };

  // ===== بحث حسابات السيلز =====
  // يفلتر الكروت فوراً بالاسم أو اسم المستخدم أو الرقم أو الفريق أو الرتبة،
  // وبنفس تطبيع النص العربي المستخدم في باقي الحقول عشان «أحمد» تلاقي «احمد».
  const [accountQuery, setAccountQuery] = useState('');
  const accountTerm = normalizeArabicText(accountQuery).trim();
  const accountRows = (users as User[]).filter(
    (u: User) =>
      !accountTerm ||
      normalizeArabicText(
        `${u.name || ''} ${u.username || ''} ${u.phone || ''} ${u.team || ''} ${rankLabel(displayRoleOf(u))}`
      ).includes(accountTerm)
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="page-intro"><div><h2>فريق العمل</h2></div></div>
        {view === 'accounts' && (
          <button onClick={onAdd} className="gradient-primary text-[var(--text-strong)] px-5 py-2.5 rounded-[var(--r-md)] font-bold text-sm flex items-center gap-2 glow-primary">
            <Plus className="w-4 h-4" /> إضافة حساب
          </button>
        )}
      </div>

      {/* التبويبات: الحسابات / كامبين فيسبوك / كامبين إنستجرام — كل قناة معزولة بإعدادها.
          نفس شكل شريط التبديل المستخدم في كل مكان تاني في النظام. */}
      {canPullCampaigns && (
        <div className="seg-bar" role="tablist" aria-label="فريق العمل والكامبينات">
          {([['accounts', 'الحسابات'], ['facebook', 'فيسبوك'], ['instagram', 'إنستجرام']] as Array<['accounts' | LeadChannel, string]>).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={view === id}
              onClick={() => switchView(id)}
              className={`seg-item${view === id ? ' on' : ''}`}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {view !== 'accounts' ? (
        <ChannelSourceCard channel={view} />
      ) : (
      <>
      <div className="panel p-3.5">
        <div className="relative">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-muted)]" />
          <input
            value={accountQuery}
            onChange={(e) => setAccountQuery(e.target.value)}
            placeholder="ابحث بالاسم أو اسم المستخدم أو الرقم أو الفريق..."
            aria-label="بحث حسابات الفريق"
            className="w-full bg-[var(--tint-1)] border border-[var(--border)] rounded-[var(--r-md)] pr-9 pl-3 py-2.5 text-[var(--text-strong)] text-sm"
          />
        </div>
      </div>
      {accountRows.length === 0 && (
        <p className="panel p-8 text-center text-sm text-[var(--text-muted)]">لا يوجد حساب مطابق للبحث</p>
      )}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <AnimatePresence>
          {accountRows.map((user: User) => (
            <motion.div
              key={user.id}
              layout
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.85 }}
              whileHover={{ scale: 1.02 }}
              onClick={() => onSelect(user)}
              className={`panel p-5 cursor-pointer ${user.isActive ? '' : 'opacity-60'}`}
            >
              <div className="flex items-center gap-3">
                <span className={`avatar-plate rank-${displayRoleOf(user)}`} aria-hidden="true">{user.name[0]}</span>
                <div className="flex-1 min-w-0">
                  <h4 className="font-bold text-[var(--text-strong)] truncate">{user.name}</h4>
                  <div className="flex items-center gap-1.5 flex-wrap mt-1">
                    <span className={rankClass(displayRoleOf(user))}>{rankLabel(displayRoleOf(user))}</span>
                    {user.team && <span className="chip">فريق: {user.team}</span>}
                    {!user.isActive && <span className="st-chip st-lost">موقوف</span>}
                  </div>
                </div>
              </div>
              <div className="flex items-center justify-between mt-4 pt-3 border-t border-[var(--border)]">
                <p className="text-xs text-[var(--text-dim)] truncate" dir="ltr">{user.username ? `@${user.username}` : '—'}</p>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={(e) => { e.stopPropagation(); onImpersonate?.(user); }}
                    disabled={!canImpersonate(user)}
                    title={
                      canImpersonate(user)
                        ? `الدخول إلى حساب ${user.name} — ترى النظام بعيونه بدون كلمة مرور`
                        : user.isActive
                          ? (user.role === 'admin' ? 'حساب إداري — الدخول متاح لحساب المطوّر (system dev) فقط' : 'غير متاح لهذا الحساب')
                          : 'الحساب موقوف — لا يمكن الدخول إليه'
                    }
                    className="icon-btn is-brand disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    <LogIn />
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); onEdit(user); }}
                    disabled={!canEdit(user)}
                    title={canEdit(user) ? 'تعديل الحساب (الاسم / كلمة المرور / الرتبة)' : 'لا يمكن تعديل حساب الـ CEO'}
                    className="icon-btn disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    <Edit3 />
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); onDelete(user); }}
                    disabled={!canDelete(user)}
                    title={canDelete(user) ? 'حذف الحساب' : 'لا يمكن حذف هذا الحساب'}
                    className="icon-btn is-danger disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    <Trash2 />
                  </button>
                </div>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
      </>
      )}
    </div>
  );
}

// تواريخ الأرقام المستوردة تُخزَّن أحياناً كنص ISO خام (مثال: 2026-09-23T11:30:19.000Z)
// فنُظهرها هنا بشكل مقروء: 23/09/2026 - 02:30 م
function formatLeadDescription(description?: string): string {
  if (!description) return '';
  return description.replace(
    /(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?/g,
    (full, y, m, d, hh, mm, tz) => {
      // لو النص بلا منطقة زمنية صريحة نتركه كما هو لتفادي تغيير التوقيت
      if (!tz) return full;
      const date = new Date(full);
      if (Number.isNaN(date.getTime())) return full;
      const pad = (n: number) => String(n).padStart(2, '0');
      const hours = date.getHours();
      const period = hours < 12 ? 'ص' : 'م';
      const hour12 = hours % 12 === 0 ? 12 : hours % 12;
      return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()} - ${pad(hour12)}:${pad(date.getMinutes())} ${period}`;
    }
  );
}

// New Leads View - For Sales (shows leads assigned to this sales person)
// ملاحظة: أي رقم في عهدة المندوب بيصير عميله تلقائياً، فما فيش هنا زر تحويل.
function NewLeadsViewForSales({ assignedLeads, onMarkViewed, onAdd }: any) {
  const [selectedLead, setSelectedLead] = useState<AssignedLead | null>(null);

  const handleLeadClick = (lead: AssignedLead) => {
    setSelectedLead(lead);
    if (lead.status === 'new') {
      onMarkViewed(lead.id);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div className="page-intro"><div><h2>أرقام جديدة</h2></div></div>
        {/* السيلز يضيف رقمه بنفسه — بينزل باسمه هو بلا اختيار مندوب */}
        {onAdd && (
          <button type="button" onClick={onAdd} className="btn-primary">
            <Plus className="w-4 h-4" /> إضافة رقم
          </button>
        )}
      </div>

      <div className="space-y-3">
        {assignedLeads.map((lead: AssignedLead) => (
          <motion.div 
            key={lead.id} 
            whileHover={{ scale: 1.01 }}
            onClick={() => handleLeadClick(lead)}
            className={`panel p-4 cursor-pointer ${lead.status === 'new' ? 'border-2 border-[var(--brand-primary-soft)] hover:border-[var(--brand)]' : ''}`}
          >
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <h4 className="font-bold text-[var(--text-strong)] text-lg">{lead.name}</h4>
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-[var(--text-muted)] text-lg" dir="ltr">{lead.phone}</p>
                  <FormNameChip record={lead} />
                  <CampaignTimeChip at={campaignTimeOf(lead).at} kind={campaignTimeOf(lead).kind} />
                </div>
                {lead.description && <p className="text-sm text-[var(--text-muted)] mt-2">{formatLeadDescription(lead.description)}</p>}
                <p className="text-xs text-[var(--text-dim)] mt-2">
                  {formatDateTime(campaignTimeOf(lead).at)}
                </p>
              </div>
              <div className="flex flex-col gap-2 items-end">
                {lead.status === 'new' && (
                  <span className="text-sm px-4 py-2 rounded-full bg-[var(--brand-primary-softer)] text-[var(--brand)] font-bold animate-pulse">
                    رقم جديد
                  </span>
                )}
                
                {lead.status === 'viewed' && (
                  <span className="text-sm px-4 py-2 rounded-full bg-[var(--brand-primary-softer)] text-[var(--text-muted)] font-bold">
                    تم العرض
                  </span>
                )}
                
                {lead.status === 'contacted' && (
                  <span className="text-sm px-4 py-2 rounded-full bg-amber-500/20 text-amber-400 font-bold">
                    تم التواصل
                  </span>
                )}
                
                {lead.status === 'closed' && (
                  <span className="text-sm px-4 py-2 rounded-full bg-emerald-500/20 text-emerald-400 font-bold">
                    مغلق
                  </span>
                )}
              </div>
            </div>
          </motion.div>
        ))}
      </div>

      {assignedLeads.length === 0 && (
        <div className="text-center py-16">
          <UserPlus className="w-16 h-16 text-[var(--text-dim)] mx-auto mb-4" />
          <p className="text-[var(--text-muted)]">لا يوجد أرقام جديدة</p>
        </div>
      )}

      {/* نافذة تفاصيل الرقم */}
      <AnimatePresence>
        {selectedLead && (
          <motion.div 
            initial={{ opacity: 0 }} 
            animate={{ opacity: 1 }} 
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80"
            onClick={() => setSelectedLead(null)}
          >
            <motion.div 
              initial={{ scale: 0.9 }} 
              animate={{ scale: 1 }} 
              exit={{ scale: 0.9 }}
              className="panel p-6 w-full max-w-lg border-[var(--brand-primary-soft)] glow-primary"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-6">
                <div className="page-intro"><div><h2>تفاصيل الرقم</h2></div></div>
                <button 
                  onClick={() => setSelectedLead(null)}
                  className="p-2 hover:bg-[var(--tint-2)] rounded-[var(--r-sm)] transition-colors"
                >
                  <X className="w-5 h-5 text-[var(--text-muted)]" />
                </button>
              </div>

              <div className="space-y-4">
                <div className="bg-[var(--tint-1)] rounded-[var(--r-md)] p-4">
                  <p className="text-xs text-[var(--text-muted)] mb-1">اسم العميل</p>
                  <p className="text-[var(--text-strong)] font-bold text-lg">{selectedLead.name}</p>
                </div>

                <div className="bg-[var(--tint-1)] rounded-[var(--r-md)] p-4">
                  <p className="text-xs text-[var(--text-muted)] mb-1">رقم الهاتف</p>
                  <p className="text-[var(--text-muted)] font-bold text-lg" dir="ltr">{selectedLead.phone}</p>
                </div>

                {selectedLead.description && (
                  <div className="bg-[var(--tint-1)] rounded-[var(--r-md)] p-4">
                    <p className="text-xs text-[var(--text-muted)] mb-1">الوصف / الملاحظات</p>
                    <p className="text-[var(--text-strong)]">{formatLeadDescription(selectedLead.description)}</p>
                  </div>
                )}

                <div className="bg-[var(--tint-1)] rounded-[var(--r-md)] p-4">
                  <p className="text-xs text-[var(--text-muted)] mb-1">تاريخ الإضافة</p>
                  <p className="text-[var(--text-strong)]">{formatDateTime(selectedLead.createdAt)}</p>
                </div>

                <div className="bg-[var(--tint-1)] rounded-[var(--r-md)] p-4">
                  <p className="text-xs text-[var(--text-muted)] mb-1">الحالة</p>
                  <span className={`text-sm px-4 py-2 rounded-full font-bold ${
                    selectedLead.status === 'new' ? 'bg-[var(--brand-primary-softer)] text-[var(--brand)]' :
                    selectedLead.status === 'viewed' ? 'bg-[var(--brand-primary-softer)] text-[var(--text-muted)]' :
                    selectedLead.status === 'contacted' ? 'bg-amber-500/20 text-amber-400' :
                    'bg-emerald-500/20 text-emerald-400'
                  }`}>
                    {selectedLead.status === 'new' ? 'رقم جديد' :
                     selectedLead.status === 'viewed' ? 'تم العرض' :
                     selectedLead.status === 'contacted' ? 'تم التواصل' : 'مغلق'}
                  </span>
                </div>

                <div className="flex flex-col sm:flex-row gap-3 pt-2">
                  <a 
                    href={`tel:${selectedLead.phone}`}
                    className="flex-1 bg-emerald-500/20 text-emerald-400 py-3 rounded-[var(--r-md)] font-bold text-center hover:bg-emerald-500/30 transition-colors border border-emerald-500/20"
                  >
                    <PhoneCall className="w-4 h-4 inline mr-2" />
                    اتصال
                  </a>
                  <button
                    onClick={() => setSelectedLead(null)}
                    className="sm:w-24 bg-[var(--tint-2)] text-[var(--text-strong)] py-3 rounded-[var(--r-md)] font-bold hover:bg-[var(--tint-3)] transition-colors"
                  >
                    إغلاق
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// Admin Leads View - For Admin to assign leads to sales
// ===== حصة كل سيلز: زر واحد يفتح كل السيلز، والضغط على اسم يفتح كم رقم اتوزّع له =====
function SalesShareModal({ leads, users, onClose, onDeleteMany }: any) {
  const [q, setQ] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);

  const team = useMemo(
    () => users.filter((u: User) => isAssignableSales(u)),
    [users]
  );

  const rows = useMemo(() => {
    const term = normalizeArabicText(q).trim();
    return team
      .map((u: User) => {
        const mine = leads.filter((l: AssignedLead) => l.salesId === u.id);
        const count = (s: AssignedLead['status']) => mine.filter((l: AssignedLead) => l.status === s).length;
        return {
          user: u,
          total: mine.length,
          fresh: count('new'),
          contacted: count('contacted'),
          closed: count('closed'),
          leads: [...mine].sort((a: AssignedLead, b: AssignedLead) => String(b.createdAt || '').localeCompare(String(a.createdAt || ''))),
        };
      })
      .filter((row: any) => !term || normalizeArabicText(row.user.name).includes(term))
      .sort((a: any, b: any) => b.total - a.total);
  }, [team, leads, q]);

  const assignedTotal = rows.reduce((acc: number, row: any) => acc + row.total, 0);
  const unassigned = leads.length - assignedTotal;
  const top = Math.max(1, ...rows.map((row: any) => row.total));
  const current = openId ? rows.find((row: any) => row.user.id === openId) : null;

  const shortDate = (value?: string) => {
    const d = new Date(value || '');
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('ar-EG', { day: 'numeric', month: 'short' });
  };

  const statusChip = (status: AssignedLead['status']) => {
    const meta = LEAD_STATUS_META[status];
    return meta ? <span className={meta.cls}>{meta.icon} {meta.label}</span> : null;
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-black/80" onClick={onClose}>
      <motion.div initial={{ scale: 0.96, y: 10 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.96 }} className="panel p-4 sm:p-6 w-full max-w-3xl h-[88vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-3 pb-4 border-b border-[var(--border)]">
          <div className="flex items-center gap-3 min-w-0">
            {current ? (
              <button onClick={() => setOpenId(null)} title="رجوع لكل السيلز" className="p-2 rounded-[var(--r-md)] bg-[var(--tint-1)] hover:bg-[var(--tint-3)] text-[var(--text)] shrink-0">
                <ChevronRight className="w-5 h-5" />
              </button>
            ) : (
              <div className="w-11 h-11 gradient-primary rounded-full flex items-center justify-center shrink-0">
                <BarChart3 className="w-5 h-5 text-[var(--text-strong)]" />
              </div>
            )}
            <div className="min-w-0">
              <h2 className="text-lg sm:text-xl font-bold gradient-text truncate">
                {current ? current.user.name : 'حصة كل سيلز من الأرقام'}
              </h2>
              <p className="text-xs text-[var(--text-muted)] truncate">
                {current
                  ? `${rankLabel(current.user.role)} • اتوزّع له ${current.total} ${current.total === 1 ? 'رقم' : 'أرقام'}`
                  : `الإجمالي ${leads.length} رقم • موزَّعة ${assignedTotal} • غير مخصصة ${unassigned} • ${rows.length} سيلز`}
              </p>
            </div>
          </div>
          <button onClick={onClose} title="إغلاق" className="p-2 hover:bg-[var(--tint-2)] rounded-[var(--r-sm)] shrink-0">
            <X className="w-5 h-5" />
          </button>
        </div>

        {!current && (
          <div className="flex-1 overflow-y-auto pt-4 space-y-3">
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ابحث باسم السيلز…"
              className="w-full bg-[var(--tint-1)] border border-[var(--border)] rounded-[var(--r-md)] px-4 py-2.5 text-[var(--text-strong)] text-sm" />

            {rows.length === 0 && (
              <div className="text-center py-16 text-[var(--text-muted)] text-sm">لا يوجد سيلز مطابق</div>
            )}

            {rows.map((row: any) => (
              <button key={row.user.id} onClick={() => setOpenId(row.user.id)}
                className="w-full text-right rounded-[var(--r-xl)] border border-[var(--border)] bg-white/[0.03] hover:bg-white/[0.08] transition-colors p-3.5">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-full bg-[var(--tint-2)] flex items-center justify-center font-bold text-[var(--text-strong)] shrink-0">
                    {row.user.name?.[0] || '؟'}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-bold text-[var(--text-strong)] text-sm truncate">{row.user.name}</span>
                      <span className="shrink-0 flex items-baseline gap-1">
                        <span className="text-xl font-extrabold gradient-text">{row.total}</span>
                        <span className="text-[11px] text-[var(--text-muted)]">رقم</span>
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2 mt-0.5">
                      <span className="text-[11px] text-[var(--text-dim)]">{rankLabel(row.user.role)}</span>
                      <span className="text-[11px] text-[var(--text-dim)]">اضغط لعرض أرقامه ›</span>
                    </div>
                    <div className="h-1.5 bg-[var(--tint-1)] rounded-full mt-2 overflow-hidden">
                      <div className="h-full gradient-primary rounded-full" style={{ width: `${Math.round((row.total / top) * 100)}%` }} />
                    </div>
                    <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                      {row.fresh > 0 && <span className="st-chip st-new">{row.fresh} جديد</span>}
                      {row.contacted > 0 && <span className="st-chip st-contacted">{row.contacted} تم التواصل</span>}
                      {row.closed > 0 && <span className="st-chip st-closed">{row.closed} مغلق</span>}
                      {row.total > 0 && row.fresh === 0 && row.contacted === 0 && row.closed === 0 && (
                        <span className="text-[11px] text-[var(--text-dim)]">كل الأرقام لم تُفتح بعد</span>
                      )}
                      {row.total === 0 && <span className="text-[11px] text-amber-300/80">لم يُوزَّع له أي رقم بعد</span>}
                    </div>
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}

        {current && (
          <div className="flex-1 overflow-y-auto pt-4 space-y-2.5">
            {/* حذف كل أرقام هذا الحساب مرة واحدة — بدل حذفها رقماً رقماً */}
            {current.total > 0 && onDeleteMany && (
              <button
                type="button"
                onClick={() => {
                  const count = current.total;
                  if (!window.confirm(`حذف ${count} رقم من حساب ${current.user.name} نهائياً؟ لا يمكن الرجوع بعدها.`)) return;
                  onDeleteMany(current.leads.map((l: AssignedLead) => l.id));
                  setOpenId(null);
                }}
                className="w-full py-2.5 rounded-[var(--r-md)] border border-red-500/40 bg-red-500/10 text-red-300 font-bold text-sm hover:bg-red-500/20 transition-colors"
              >
                حذف كل أرقام {current.user.name} ({current.total})
              </button>
            )}
            {current.leads.length === 0 && (
              <div className="text-center py-16 text-[var(--text-muted)] text-sm">لم يُوزَّع له أي رقم بعد</div>
            )}
            {current.leads.map((l: AssignedLead) => (
              <div key={l.id} className="rounded-[var(--r-md)] border border-[var(--border)] bg-white/[0.03] p-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-bold text-[var(--text-strong)] truncate">{l.name}</p>
                  <p className="text-xs text-[var(--text-muted)]" dir="ltr">{l.phone || 'بدون رقم'}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {statusChip(l.status)}
                  <span className="text-[11px] text-[var(--text-dim)]">{shortDate(l.createdAt)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}

// ===== شيت فورم واحد: اسم الفورم + اسم العميل + الرقم + الفيدباك العام =====
const FORM_SHEET_HEADER = ['اسم الفورم', 'اسم العميل', 'الأرقام', 'الفيدباك العام'];

type FormSheetRow = { name: string; phone: string; feedback: string };

function formSheetBlob(formName: string, rows: FormSheetRow[]): Blob {
  const label = String(formName || '').trim() || 'بدون اسم فورم';
  const sheetName = label.replace(/[\\[\]:*?/\\]/g, ' ').trim().slice(0, 31) || 'فورم';
  return buildXlsx({
    sheetName,
    rows: [
      [`شيت أرقام الفورم — ${label}`],
      [`تاريخ التصدير: ${formatDateTime(new Date().toISOString())}`],
      FORM_SHEET_HEADER,
      ...rows.map((row) => [label, row.name || '—', row.phone || '—', row.feedback || '—']),
    ],
    headerRows: [3],
    titleRows: [1],
    columnWidths: [26, 24, 18, 60],
    merges: ['A1:D1', 'A2:D2'],
  });
}

// تجميع أرقام الكامبين حسب اسم الفورم، مرتّبة من الأحدث للأقدم
// (الأحدث = آخر حركة/فيدباك/إضافة على أي رقم جوه الفورم).
function campaignFormsOf(clients: Client[] = [], leads: AssignedLead[] = []) {
  const digitsOf = (value: any) => String(value || '').replace(/\D/g, '');
  const timeOf = (value?: string) => {
    const time = Date.parse(String(value || ''));
    return Number.isFinite(time) ? time : 0;
  };
  const grouped = new Map<string, { rows: FormSheetRow[]; latest: number }>();
  const push = (name: string, row: FormSheetRow, at: number) => {
    const key = String(name || '').trim() || 'بدون اسم فورم';
    if (!grouped.has(key)) grouped.set(key, { rows: [], latest: 0 });
    const group = grouped.get(key)!;
    group.rows.push(row);
    group.latest = Math.max(group.latest, at);
  };

  const campaignClients = clients.filter((c) => isCampaignRecord(c) || !!formNameOf(c));
  const knownPhones = new Set(campaignClients.map((c) => digitsOf(c.phone)).filter(Boolean));
  for (const c of campaignClients) {
    const lastActivity = Math.max(0, ...(c.activities || []).map((a) => timeOf(a.at)));
    push(
      formNameOf(c),
      { name: c.name, phone: c.phone, feedback: lastCommentOf(c)?.text || c.feedback || '—' },
      Math.max(timeOf(c.createdAt), timeOf(c.updatedAt), lastActivity)
    );
  }
  // أرقام لسه في «توزيع الأرقام» مالهاش فيدباك بعد، لكن بتظهر عشان الشيت يكون كامل
  for (const lead of leads) {
    if (lead.status === 'closed' || knownPhones.has(digitsOf(lead.phone))) continue;
    push(formNameOf(lead), { name: lead.name || '—', phone: lead.phone, feedback: '—' }, timeOf(lead.createdAt));
  }

  return [...grouped.entries()]
    .map(([name, group]) => ({ name, rows: group.rows, latest: group.latest }))
    .sort((a, b) => b.latest - a.latest);
}

// ===== تبويب «شيت الفورمات» =====
// سطر لكل فورم: اسم الفورم وجمبه زر «تصدير» بس — بلا تفاصيل ولا أرقام.
// الفورمات فوق بعضها مرتّبة من الأحدث للأقدم (آخر حركة على أي رقم جوه الفورم).
function AdminFormsSheetView({ clients = [], leads = [] }: { clients?: Client[]; leads?: AssignedLead[] }) {
  const forms = useMemo(() => campaignFormsOf(clients, leads), [clients, leads]);

  const exportSheet = (form: { name: string; rows: FormSheetRow[] }) => {
    const safeName = form.name.replace(/[\\/:*?"<>|]/g, '-');
    downloadBlob(formSheetBlob(form.name, form.rows), `شيت-${safeName}-${todayKey()}.xlsx`);
  };

  return (
    <div className="space-y-4">
      <div className="page-intro"><div><h2>شيت الفورمات</h2></div></div>

      {forms.length === 0 ? (
        <div className="text-center py-16">
          <FileText className="w-16 h-16 text-[var(--text-dim)] mx-auto mb-4" />
          <p className="text-[var(--text-muted)]">لا توجد فورمات بعد</p>
        </div>
      ) : (
        forms.map((form) => (
          <div key={form.name} className="panel p-4 flex items-center justify-between gap-3">
            <h3 className="font-extrabold text-[var(--text-strong)] truncate">{form.name}</h3>
            <button
              type="button"
              onClick={() => exportSheet(form)}
              className="shrink-0 gradient-primary text-[var(--text-strong)] px-4 py-2.5 rounded-[var(--r-md)] text-sm font-bold inline-flex items-center gap-2"
            >
              <Download className="w-4 h-4" /> تصدير
            </button>
          </div>
        ))
      )}
    </div>
  );
}

// ===== رفع شيت عملاء: أي ملف فيه اسم الشخص ورقمه =====
// «عملاء كامبين» بقى فيه زرارين: إضافة عميل يدوي، ورفع شيت.
// الشيت بيتقرأ (CSV / TXT / إكسل حقيقي)، ونتعرف فيه على عمود الاسم وعمود الرقم
// (تلقائياً أو بتحديد المدير)، وبعدها كل سطر سليم بيتسجّل عميل في «عملاء كامبين».
function ImportClientsModal({ users, clients = [], assignedLeads = [], currentUser, activeForms = [], onClose, onSuccess }: any) {
  const salesUsers = (users || []).filter((u: User) => isAssignableSales(u));
  const [stage, setStage] = useState<'pick' | 'preview' | 'done'>('pick');
  const [fileName, setFileName] = useState('');
  const [table, setTable] = useState<string[][]>([]);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [error, setError] = useState('');
  const [dragging, setDragging] = useState(false);
  const [ownerId, setOwnerId] = useState(String(currentUser?.id || ''));
  // اسم الفورم = اسم الملف بدون الامتداد افتراضياً — والمدير يقدر يغيّره
  const [formName, setFormName] = useState('');
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<{ added: number; duplicates: number; invalid: number; leads: number; form: string } | null>(null);

  // كل الأرقام الموجودة بالفعل (عملاء أو أرقام موزّعة) — عشان نكشف المكرر
  const existingPhones = [
    ...(assignedLeads || []).map((l: AssignedLead) => l.phone),
    ...(clients || []).flatMap((c: Client) => [c.phone, ...(c.phones || [])]),
  ].filter(Boolean);

  const readFile = async (file: File) => {
    setError('');
    try {
      const rows = await readSheetTable(file);
      if (!rows.length) {
        setError('الملف فارغ أو غير مقروء');
        return;
      }
      const built = buildPreview(rows, existingPhones);
      if (!built.rows.length) {
        setError('لم نجد أي صفوف قابلة للقراءة في الملف');
        return;
      }
      setTable(rows);
      setPreview(built);
      setFileName(file.name);
      // اسم الفورم = اسم الملف بدون الامتداد — ويظهر في القوائم بنفس الاسم
      setFormName(formNameFromFileName(file.name));
      setStage('preview');
    } catch (e: any) {
      setError(e?.message || 'تعذّر قراءة الملف — تأكد أنه بصيغة CSV أو إكسل');
    }
  };

  // تصحيح أعمدة الشيت يدوياً (لو التعرّف التلقائي مش مظبوط)
  const remap = (next: ImportPreview['mapping']) => {
    setPreview(buildPreview(table, existingPhones, next));
  };
  const headerCells = (table[0] || []).map((cell, index) => ({ label: cell || `العمود ${index + 1}`, index }));

  // ===== الحفظ: فورم بنفس اسم الملف + عميل لكل سطر + الأرقام في «توزيع الأرقام» =====
  const handleSave = async () => {
    if (!preview || saving) return;
    setError('');
    const now = new Date().toISOString();
    const finalForm = formName.trim();
    const existing: Client[] = JSON.parse(localStorage.getItem('crm_clients') || '[]');
    const known = new Set(existing.map((c: Client) => phoneKeyOf(c.phone)).filter(Boolean));
    const added: Client[] = [];
    for (const row of preview.rows) {
      if (row.invalid || row.duplicate || !row.phone) continue;
      const key = phoneKeyOf(row.phone);
      if (!key || known.has(key)) continue;
      known.add(key);
      added.push({
        id: crypto.randomUUID(),
        name: row.name || 'عميل بدون اسم',
        phone: row.phone,
        phones: [],
        property: '',
        budget: '',
        monthlyInstallment: '',
        deliveryPeriod: '',
        status: 'campaign',
        stage: 'new',
        feedback: '',
        priority: 'medium',
        source: finalForm ? `كامبين — ${finalForm}` : 'كامبين — شيت مرفوع',
        ...(finalForm ? { formName: finalForm } : {}),
        userId: ownerId,
        assignedTo: ownerId,
        createdAt: now,
        updatedAt: now,
        activities: [
          { id: crypto.randomUUID(), type: 'created', text: `تمت إضافة العميل من ملف ${fileName}`, at: now, by: currentUser?.name || '' },
        ],
      } as Client);
    }
    if (!added.length) {
      setError('كل أرقام الملف موجودة بالفعل — مش في جديد');
      return;
    }
    setSaving(true);
    // ===== ١) الفورم: بنفس اسم الملف، محفوظ في إعدادات السحب =====
    // لازم يتحفظ قبل السجلات: الأرقام المسجّلة باسم فورم غير مفعّل بتتخفي من
    // «عملاء كامبين» و«توزيع الأرقام». فإحنا بنوقف الحفظ كله لو الحفظ فشل.
    if (finalForm) {
      const formSaved = await saveExtraFormName(finalForm);
      if (!formSaved) {
        setSaving(false);
        setError('تعذّر حفظ الفورم في إعدادات السحب — لم يُسجّل أي عميل. اتأكد من الاتصال وجرّب تاني.');
        return;
      }
    }
    // ===== ٢) العملاء =====
    localStorage.setItem('crm_clients', JSON.stringify([...added, ...existing]));
    // ===== ٣) نفس الأرقام في «توزيع الأرقام» — غير مخصصة، فالإدارة توزّعها بنفسها =====
    const newLeads: AssignedLead[] = added.map((client) => ({
      id: crypto.randomUUID(),
      adminId: String(currentUser?.id || ''),
      salesId: '',
      name: client.name,
      phone: client.phone,
      description: `رفع شيت: ${fileName}`,
      status: 'new',
      createdAt: now,
      ...(finalForm ? { formName: finalForm } : {}),
    }));
    // ندمج مع المخزون المحلي كاملاً (مش المسحوف في الشاشة) ونشيل أي رقم مكرر
    let stored: AssignedLead[] = [];
    try {
      const parsed = JSON.parse(localStorage.getItem('crm_assigned_leads') || '[]');
      stored = Array.isArray(parsed) ? parsed : [];
    } catch {
      stored = [];
    }
    const byId = new Map<string, AssignedLead>();
    for (const lead of [...stored, ...(assignedLeads || [])]) {
      byId.set(String(lead.id), lead);
    }
    const newPhones = new Set(added.map((client) => phoneKeyOf(client.phone)));
    const kept = [...byId.values()].filter((lead) => !newPhones.has(phoneKeyOf(lead.phone)));
    localStorage.setItem('crm_assigned_leads', JSON.stringify([...newLeads, ...kept]));
    // ===== ٤) الرفع للسيرفر: ننتظر النتيجة عشان ما يفضل السجل على جهاز واحد =====
    const [clientsOk, leadsOk] = await Promise.all([
      pushKey('crm_clients'),
      pushKey('crm_assigned_leads'),
    ]);
    setSaving(false);
    onSuccess();
    if (!clientsOk || !leadsOk) {
      setError('اتسجّل على الشاشة دي بس ماوصلش للسيرفر — جرّب ترفع الملف تاني.');
      return;
    }
    setResult({ added: added.length, duplicates: preview.duplicates, invalid: preview.invalid, leads: newLeads.length, form: finalForm });
    setStage('done');
  };

  const summary = preview
    ? [
        { label: 'إجمالي الصفوف', value: preview.total, className: 'text-[var(--text-strong)]' },
        { label: 'عملاء جدد', value: preview.fresh, className: 'text-emerald-400' },
        { label: 'مكررة (تُتجاهل)', value: preview.duplicates, className: 'text-amber-400' },
        { label: 'غير صالحة', value: preview.invalid, className: 'text-red-400' },
      ]
    : [];

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80" onClick={onClose}>
      <motion.div
        initial={{ scale: 0.94, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.94, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 220, damping: 22 }}
        className="panel p-6 w-full max-w-3xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-[var(--brand-fill)] rounded-full flex items-center justify-center">
              <Upload className="w-6 h-6 text-[var(--text-strong)]" />
            </div>
            <div>
              <div className="page-intro"><div><h2>رفع شيت عملاء</h2></div></div>
              <p className="text-xs text-[var(--text-muted)]">أي شيت فيه اسم الشخص ورقمه — بنقراه ونسجّل كل سطر عميل</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-[var(--tint-2)] rounded-[var(--r-sm)] transition-colors">
            <X className="w-5 h-5 text-[var(--text-muted)]" />
          </button>
        </div>

        {/* الخطوة ١: اختيار الملف */}
        {stage === 'pick' && (
          <div className="space-y-4">
            <div
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                const file = e.dataTransfer.files?.[0];
                if (file) void readFile(file);
              }}
              className={`rounded-[var(--r-xl)] border-2 border-dashed p-8 text-center transition-colors ${dragging ? 'border-[var(--brand)] bg-[var(--brand-primary-softer)]' : 'border-[var(--brand-primary-soft)] bg-[var(--tint-1)]'}`}
            >
              <Upload className="w-12 h-12 text-[var(--brand)] mx-auto mb-3" />
              <p className="text-[var(--text-strong)] font-bold mb-1">اسحب الشيت هنا أو اختره من جهازك</p>
              <p className="text-xs text-[var(--text-muted)] mb-4">
                مدعوم: Excel (xlsx) · CSV · TXT — ولو الأرقام مكتوبة عربي (+20 و 010 و ٠١٠) بيتحوّلوا صح
              </p>
              <label className="inline-block cursor-pointer gradient-primary text-[var(--text-strong)] px-6 py-3 rounded-[var(--r-md)] font-bold">
                اختر الملف
                <input type="file" accept=".csv,.txt,.xlsx,.xlsm,text/csv" className="hidden"
                  onChange={(e) => { const file = e.target.files?.[0]; if (file) void readFile(file); }} />
              </label>
            </div>
            <p className="text-xs text-[var(--text-muted)] bg-[var(--tint-1)] rounded-[var(--r-md)] px-4 py-3">
              المطلوب في الشيت عمودين بس: <b className="text-[var(--text-strong)]">اسم الشخص</b> و<b className="text-[var(--text-strong)]"> رقمه</b>.
              لو الأعمدة بأسماء تانية، بنكتشفها ونقدر تختارها بنفسك في الخطوة الجاية.
            </p>
            {error && (
              <p className="text-amber-400 text-sm bg-amber-500/10 border border-amber-500/20 rounded-[var(--r-md)] py-2 px-3 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0" /> {error}
              </p>
            )}
          </div>
        )}

        {/* الخطوة ٢: المراجعة قبل الحفظ */}
        {stage === 'preview' && preview && (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm text-[var(--text)]">
                <FileText className="w-4 h-4 inline ml-1 text-[var(--text-muted)]" />
                الملف: <span className="text-[var(--text-strong)] font-bold">{fileName}</span>
              </p>
              <button onClick={() => { setPreview(null); setError(''); setStage('pick'); }}
                className="text-xs text-[var(--brand)] hover:text-[var(--brand)] font-bold">اختيار ملف آخر</button>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {summary.map((item) => (
                <div key={item.label} className="rounded-[var(--r-md)] bg-[var(--tint-1)] border border-[var(--border)] p-3 text-center">
                  <p className={`text-2xl font-bold ${item.className}`}>{item.value}</p>
                  <p className="text-[11px] text-[var(--text-muted)] mt-1">{item.label}</p>
                </div>
              ))}
            </div>

            {/* أعمدة الشيت — يقدر المدير يصحّحها */}
            <div className="rounded-[var(--r-md)] bg-[var(--tint-1)] border border-[var(--border)] p-4 space-y-3">
              <p className="text-sm font-bold text-[var(--text-strong)]">أعمدة الشيت</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="text-xs text-[var(--text-muted)]">
                  عمود الاسم
                  <select
                    value={preview.mapping.name || ''}
                    onChange={(e) => remap({ ...preview.mapping, name: e.target.value })}
                    className="w-full mt-1 bg-[var(--bg)] border border-[var(--border)] rounded-[var(--r-sm)] px-3 py-2 text-sm text-[var(--text)]"
                  >
                    <option value="">— بلا اسم —</option>
                    {headerCells.map((cell) => <option key={cell.index} value={cell.label}>{cell.label}</option>)}
                  </select>
                </label>
                <label className="text-xs text-[var(--text-muted)]">
                  عمود الرقم
                  <select
                    value={preview.mapping.phone || ''}
                    onChange={(e) => remap({ ...preview.mapping, phone: e.target.value })}
                    className="w-full mt-1 bg-[var(--bg)] border border-[var(--border)] rounded-[var(--r-sm)] px-3 py-2 text-sm text-[var(--text)]"
                  >
                    <option value="">— بلا رقم —</option>
                    {headerCells.map((cell) => <option key={cell.index} value={cell.label}>{cell.label}</option>)}
                  </select>
                </label>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="text-xs text-[var(--text-muted)]">
                  صاحب العميل
                  <select
                    value={ownerId}
                    onChange={(e) => setOwnerId(e.target.value)}
                    className="w-full mt-1 bg-[var(--bg)] border border-[var(--border)] rounded-[var(--r-sm)] px-3 py-2 text-sm text-[var(--text)]"
                  >
                    <option value={String(currentUser?.id || '')}>الإدارة (أنا)</option>
                    {salesUsers.map((u: User) => <option key={u.id} value={u.id}>{u.name}</option>)}
                  </select>
                </label>
                <label className="text-xs text-[var(--text-muted)]">
                  فورم الكامبين (بنفس اسم الملف)
                  <input
                    type="text"
                    list="crm-form-names"
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    placeholder="اسم الملف بدون امتداد"
                    className="w-full mt-1 bg-[var(--bg)] border border-[var(--border)] rounded-[var(--r-sm)] px-3 py-2 text-sm text-[var(--text)]"
                  />
                  <datalist id="crm-form-names">
                    {(activeForms || []).map((name: string) => <option key={name} value={name} />)}
                  </datalist>
                  <span className="block mt-1 text-[11px] text-[var(--text-dim)]">
                    بينحفظ في إعدادات سحب الأرقام ⇒ يظهر فوراً في «عملاء كامبين» و«توزيع الأرقام».
                  </span>
                </label>
              </div>
            </div>

            <div className="max-h-64 overflow-y-auto rounded-[var(--r-md)] border border-[var(--border)] table-scroll">
              <table className="w-full text-sm">
                <thead className="bg-[var(--tint-1)] sticky top-0">
                  <tr className="text-[var(--text-muted)] text-xs">
                    <th className="py-2 px-3 text-right font-bold">الاسم</th>
                    <th className="py-2 px-3 text-right font-bold">الرقم</th>
                    <th className="py-2 px-3 text-right font-bold">الحالة</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.slice(0, 50).map((row, index) => (
                    <tr key={index} className="border-t border-[var(--border-soft)]">
                      <td className="py-2 px-3 text-[var(--text-strong)]">{row.name || <span className="text-[var(--text-dim)]">بدون اسم</span>}</td>
                      <td className="py-2 px-3 text-[var(--text)]" dir="ltr">{row.phone || row.rawPhone}</td>
                      <td className="py-2 px-3">
                        {row.invalid ? (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-red-500/20 text-red-400">رقم غير صالح</span>
                        ) : row.duplicate ? (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-400">مكرر</span>
                        ) : (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400">جديد</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {preview.rows.length > 50 && (
              <p className="text-[11px] text-[var(--text-dim)] text-center">معروض أول ٥٠ صفاً من إجمالي {preview.rows.length}</p>
            )}

            {error && (
              <p className="text-amber-400 text-sm bg-amber-500/10 border border-amber-500/20 rounded-[var(--r-md)] py-2 px-3 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0" /> {error}
              </p>
            )}

            <div className="flex gap-2">
              <button onClick={() => void handleSave()} disabled={!preview.fresh || saving}
                className="flex-1 gradient-primary text-[var(--text-strong)] py-3 rounded-[var(--r-md)] font-bold disabled:opacity-40">
                {saving ? 'جارٍ الحفظ...' : `حفظ ${preview.fresh} عميل + ${preview.fresh} رقم في «توزيع الأرقام»`}
              </button>
              <button onClick={onClose} className="px-5 py-3 rounded-[var(--r-md)] font-bold bg-[var(--tint-1)] border border-[var(--border)] text-[var(--text)]">
                إلغاء
              </button>
            </div>
          </div>
        )}

        {/* الخطوة ٣: تم */}
        {stage === 'done' && result && (
          <div className="space-y-4 text-center">
            <div className="w-16 h-16 mx-auto rounded-full bg-emerald-500/15 flex items-center justify-center">
              <Check className="w-8 h-8 text-emerald-400" />
            </div>
            <p className="text-lg font-bold text-[var(--text-strong)]">
              اتسجّل <span className="text-emerald-400">{result.added}</span> عميل جديد
            </p>
            <p className="text-xs text-[var(--text-muted)]">
              اتجاهل {result.duplicates} مكرر و{result.invalid} رقم غير صالح.
            </p>
            <p className="text-xs text-[var(--text-muted)]">
              و<b className="text-[var(--text)]">{result.leads}</b> رقم اتسجّل في «توزيع الأرقام» غير مخصص
              {result.form ? <> — والفورم <b className="text-[var(--text)]">{result.form}</b> اتحفظ في إعدادات السحب</> : null}.
            </p>
            <p className="text-xs text-[var(--text-muted)]">
              وظهر كل العملاء في «عملاء كامبين».
            </p>
            <button onClick={onClose} className="gradient-primary text-[var(--text-strong)] px-8 py-3 rounded-[var(--r-md)] font-bold">
              تمام
            </button>
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}

// ===== تبويب «العملاء» للإدارة =====
// كل عملاء الشركة في مكان واحد: العدد الحالي في المقدمة، وكارت لكل عميل يفتح
// نافذة التفاصيل نفسها المستخدمة في «المراحل» (البيانات + الخط الزمني + الاتصال).
function AdminClientsView({ clients, leads = [], users, onSelect, onCall, onAdd, onImport, activeForms = [] }: any) {
  const [query, setQuery] = useState('');
  const [stage, setStage] = useState<'all' | Client['stage']>('all');
  // افتراضياً عملاء الكامبين فقط — وزر واحد يعرض كل العملاء (بما فيهم المضافون يدوياً)
  const [campaignOnly, setCampaignOnly] = useState(true);

  const ownerName = (c: Client) =>
    users.find((u: User) => u.id === (c.assignedTo || c.userId))?.name || 'غير مخصص';
  const userName = (id?: string) => users.find((u: User) => u.id === id)?.name || 'غير مخصص';
  const digitsOf = (value: any) => normalizeDigits(String(value || '')).replace(/\D/g, '');
  const clientPhones = new Set((clients || []).map((c: Client) => digitsOf(c.phone)).filter(Boolean));
  const leadPhones = new Set((leads || []).map((l: AssignedLead) => digitsOf(l.phone)).filter(Boolean));
  const q = normalizeArabicText(query).trim();
  // الفورم غير المحدّد في صفحة القناة لا يظهر هنا (ولا يُحذف — يرجع بتحديده)
  const campaignClients = (clients || []).filter(
    (c: Client) =>
      isSelectedFormRecord(activeForms, c) &&
      (!campaignOnly || isCampaignRecord(c) || leadPhones.has(digitsOf(c.phone)))
  );
  // الأرقام اللي لسه في «توزيع الأرقام» ولم تتحول لسجل عميل — تظهر هنا كأرقام كامبين
  // (كل الأرقام الموزعة أرقام كامبين/توزيع، حتى لو وصفها القديم بلا «المصدر»)
  const campaignLeads = (leads || []).filter((lead: AssignedLead) => {
    if (lead.status === 'closed') return false;
    if (clientPhones.has(digitsOf(lead.phone))) return false;
    return isSelectedFormRecord(activeForms, lead);
  });
  const matches = (c: Client) =>
    !q ||
    normalizeArabicText(`${c.name} ${c.phone} ${(c.phones || []).join(' ')} ${c.source || ''} ${formNameOf(c)} ${ownerName(c)}`).includes(q);
  const matchesLead = (lead: AssignedLead) =>
    !q ||
    normalizeArabicText(`${lead.name} ${lead.phone} ${lead.description || ''} ${formNameOf(lead)} ${userName(lead.salesId)}`).includes(q);

  // المرحلة اللي يقف عليها الرقم الموزّع — من حالته في التوزيع (جديد/تم التواصل/مغلق)
  // حتى تتحسب أرقام التوزيع على المراحل، وما يفضل العدّاد صفراً رغم وجودها.
  const leadStage = (lead: AssignedLead): Client['stage'] =>
    (FEEDBACK_STATUS_TO_STAGE[LEAD_STATUS_TO_FEEDBACK_STATUS[String(lead.status || '')] || 'fresh-stage'] ||
      'new') as Client['stage'];
  const visible = campaignClients.filter((c: Client) => (stage === 'all' || c.stage === stage) && matches(c));
  const visibleLeads = campaignLeads.filter(
    (lead: AssignedLead) => (stage === 'all' || leadStage(lead) === stage) && matchesLead(lead)
  );
  const stageCount = (id: 'all' | Client['stage']) => {
    const fromClients =
      id === 'all' ? campaignClients.length : campaignClients.filter((c: Client) => c.stage === id).length;
    const fromLeads =
      id === 'all' ? campaignLeads.length : campaignLeads.filter((l: AssignedLead) => leadStage(l) === id).length;
    return fromClients + fromLeads;
  };
  const inProgress =
    campaignClients.filter((c: Client) => c.stage !== 'closed' && c.stage !== 'lost').length +
    campaignLeads.filter((l: AssignedLead) => l.status !== 'closed').length;
  const sold = campaignClients.filter((c: Client) => c.stage === 'closed').length;
  const formNameCount = [...campaignClients, ...campaignLeads].filter((record: any) => !!formNameOf(record)).length;
  const totalCampaign = campaignClients.length + campaignLeads.length;
  const leadStatusLabel = (status: string) =>
    status === 'viewed' ? 'تم العرض' : status === 'contacted' ? 'تم التواصل' : status === 'closed' ? 'مغلق' : 'جديد';

  const chips: { id: 'all' | Client['stage']; label: string }[] = [
    { id: 'all', label: 'الكل' },
    ...(['new', 'contacted', 'meeting', 'negotiation', 'closed', 'lost'] as Client['stage'][]).map((id) => ({
      id,
      label: STAGE_META[id]?.label || id,
    })),
  ];

  // ===== كل فورم لوحده =====
  // الفورم هو اللي الفريق بيتابع عليه فعلاً (فورم أكتوبر، فورم التجمع…)؛ فبنقسّم
  // الأرقام الظاهرة بقسم لكل فورم بعدده وحالته. الشيت نفسه في تبويب «شيت الفورمات».
  type CampaignGroup = { name: string; clients: Client[]; leads: AssignedLead[] };
  const groupMap = new Map<string, CampaignGroup>();
  const groupOf = (name: string) => {
    const key = name || 'بدون اسم فورم';
    if (!groupMap.has(key)) groupMap.set(key, { name: key, clients: [], leads: [] });
    return groupMap.get(key)!;
  };
  visible.forEach((c: Client) => groupOf(formNameOf(c)).clients.push(c));
  visibleLeads.forEach((l: AssignedLead) => groupOf(formNameOf(l)).leads.push(l));
  const formGroups = [...groupMap.values()].sort(
    (a, b) => b.clients.length + b.leads.length - (a.clients.length + a.leads.length)
  );

  // ===== القائمة المسندلة للفورمات =====
  // كل فورم مفعّل في الإعدادات يظهر في القائمة ولو لم يصل منه رقم بعد (بعدد ٠)،
  // ومعاه أي فورم موجود في السجلات القديمة حتى لا يختفي أي رقم من الشاشة.
  const formCounts = new Map<string, { clients: number; leads: number }>();
  const bump = (name: string, kind: 'clients' | 'leads') => {
    const key = name || UNKNOWN_FORM;
    const cell = formCounts.get(key) || { clients: 0, leads: 0 };
    cell[kind] += 1;
    formCounts.set(key, cell);
  };
  campaignClients.filter(matches).forEach((c: Client) => bump(formNameOf(c), 'clients'));
  campaignLeads.filter(matchesLead).forEach((l: AssignedLead) => bump(formNameOf(l), 'leads'));
  const formOptions = [...new Set([
    ...(activeForms || []).map((name: string) => String(name || '').trim()).filter(Boolean),
    ...formCounts.keys(),
  ])]
    .map((name) => ({ name, ...(formCounts.get(name) || { clients: 0, leads: 0 }) }))
    .sort((a, b) => b.clients + b.leads - (a.clients + a.leads));

  // فلتر الفورم: لو الفورم المختار مابقاش ظاهر (بعد بحث أو تصفية) نرجع لـ«كل الفورمات»
  const [form, setForm] = useState('all');
  const activeForm = form === 'all' || formOptions.some((option) => option.name === form) ? form : 'all';
  const selectedCounts = formOptions.find((option) => option.name === activeForm);
  // الفورم المختار يظهر له قسم حتى لو لم يصل منه أي رقم بعد
  const shownGroups =
    activeForm === 'all'
      ? formGroups
      : [formGroups.find((g) => g.name === activeForm) || { name: activeForm, clients: [], leads: [] }];

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div>
          <div className="page-intro"><div><h2>عملاء كامبين</h2></div></div>
          <p className="text-xs text-[var(--text-muted)] mt-1">
            أرقام الكامبين مقسومة فورم فورم: كل فورم في قسم لوحده بعدده وحالته.
            تصدير شيت كل فورم بقى في تبويب «شيت الفورمات». اضغط على الكارت لعرض التفاصيل الكاملة.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 self-start sm:self-auto">
          {/* إضافة عميل يدوي + رفع شيت (أي شيت فيه اسم الشخص ورقمه) */}
          <button
            type="button"
            onClick={() => onAdd?.()}
            className="text-[11.5px] font-bold bg-[var(--brand-primary-softer)] border border-[var(--brand-primary-soft)] text-[var(--text)] px-3 py-2 rounded-[var(--r-sm)] hover:bg-[var(--brand-primary-soft)] flex items-center gap-1.5"
            title="إضافة عميل واحد يدوياً"
          >
            <Plus className="w-3.5 h-3.5" /> إضافة عميل
          </button>
          <button
            type="button"
            onClick={() => onImport?.()}
            className="text-[11.5px] font-bold bg-[var(--tint-1)] border border-[var(--border)] text-[var(--text)] px-3 py-2 rounded-[var(--r-sm)] hover:bg-[var(--tint-2)] flex items-center gap-1.5"
            title="رفع شيت فيه اسم الشخص ورقمه"
          >
            <Upload className="w-3.5 h-3.5" /> رفع شيت
          </button>
          <button
            type="button"
            onClick={() => setCampaignOnly((value) => !value)}
            className="text-[11.5px] font-bold bg-[var(--tint-1)] border border-[var(--border)] text-[var(--text)] px-3 py-2 rounded-[var(--r-sm)] hover:bg-[var(--tint-2)]"
          >
            {campaignOnly ? 'عرض كل العملاء' : 'كامبين فقط'}
          </button>
        </div>
      </div>

      {/* العدد الحالي — ثلاث خانات تكفي للنظرة السريعة */}
      <div className="grid grid-cols-3 gap-3">
        <div className="panel p-4">
          <p className="text-[11px] text-[var(--text-muted)]">إجمالي أرقام الكامبين</p>
          <p className="text-3xl font-extrabold text-[var(--brand)] mt-1" dir="ltr">{totalCampaign}</p>
        </div>
        <div className="panel p-4">
          <p className="text-[11px] text-[var(--text-muted)]">قيد المتابعة</p>
          <p className="text-3xl font-extrabold text-[var(--text-strong)] mt-1" dir="ltr">{inProgress}</p>
        </div>
        <div className="panel p-4">
          <p className="text-[11px] text-[var(--text-muted)]">تم البيع</p>
          <p className="text-3xl font-extrabold text-emerald-400 mt-1" dir="ltr">{sold}</p>
        </div>
      </div>
      <p className="text-[11px] text-[var(--text-dim)]">
        منهم <b className="text-[var(--text)]">{campaignClients.length}</b> عميل مسجّل، و<b className="text-[var(--text)]">{campaignLeads.length}</b> رقم لسه في «توزيع الأرقام» ما اتحوّلش لعميل.
      </p>
      {formNameCount > 0 && (
        <p className="text-[11px] text-[var(--text-dim)]">منهم {formNameCount} سجل مسجّل باسم الفورم.</p>
      )}

      <div className="panel p-3.5 flex flex-col lg:flex-row gap-2.5 lg:items-center">
        <div className="relative flex-1">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-muted)]" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="ابحث بالاسم أو الرقم أو اسم الفورم أو المصدر..."
            className="w-full bg-[var(--tint-1)] border border-[var(--border)] rounded-[var(--r-md)] pr-9 pl-3 py-2.5 text-[var(--text-strong)] text-sm"
          />
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {chips.map((chip) => (
            <button
              key={chip.id}
              onClick={() => setStage(chip.id)}
              className={`text-xs font-bold px-3 py-2.5 rounded-[var(--r-md)] border transition-colors ${
                stage === chip.id
                  ? 'bg-[var(--brand-primary-softer)] border-[var(--brand-primary-soft)] text-[var(--brand)]'
                  : 'bg-[var(--tint-1)] border-[var(--border)] text-[var(--text-muted)]'
              }`}
            >
              {chip.label} ({stageCount(chip.id)})
            </button>
          ))}
        </div>
      </div>

      {/* ===== قائمة الفورمات المسندلة =====
          كل فورم مفعّل في إعدادات السحب يظهر هنا تلقائياً، واختياره يعرض أرقامه
          وعدده فقط. العدد المكتوب جوه القائمة هو عدد العملاء المسجّلين في الفورم. */}
      <div className="panel p-3.5">
        <div className="flex flex-col sm:flex-row sm:items-center gap-2.5">
          <label htmlFor="campaign-form-select" className="text-[11px] font-bold text-[var(--text-dim)] shrink-0">
            الفورم
          </label>
          <select
            id="campaign-form-select"
            value={activeForm}
            onChange={(e) => setForm(e.target.value)}
            className="flex-1 min-w-0 bg-[var(--tint-1)] border border-[var(--border)] rounded-[var(--r-md)] px-3 py-2.5 text-sm font-bold text-[var(--text-strong)]"
          >
            <option value="all" className="bg-gray-900">كل الفورمات ({totalCampaign})</option>
            {formOptions.map((option) => (
              <option key={option.name} value={option.name} className="bg-gray-900">
                {option.name} — {option.clients} عميل مسجّل • {option.leads} في التوزيع
              </option>
            ))}
          </select>
        </div>

        {activeForm === 'all' ? (
          <p className="text-[11px] text-[var(--text-dim)] mt-2">
            اختر فورم من القائمة لعرض أرقامه وعدد العملاء المسجّلين فيه. الفورمات المفعّلة
            في إعدادات السحب تظهر هنا تلقائياً.
          </p>
        ) : (
          <div className="mt-3 grid grid-cols-3 gap-2">
            <div className="rounded-[var(--r-md)] bg-[var(--brand-primary-softer)] border border-[var(--brand-primary-soft)] px-3 py-2.5">
              <p className="text-[10.5px] text-[var(--text-muted)]">عملاء مسجّلون</p>
              <p className="text-2xl font-extrabold text-[var(--brand)] leading-tight" dir="ltr">{selectedCounts?.clients || 0}</p>
            </div>
            <div className="rounded-[var(--r-md)] bg-[var(--tint-1)] border border-[var(--border)] px-3 py-2.5">
              <p className="text-[10.5px] text-[var(--text-muted)]">في توزيع الأرقام</p>
              <p className="text-2xl font-extrabold text-[var(--text-strong)] leading-tight" dir="ltr">{selectedCounts?.leads || 0}</p>
            </div>
            <div className="rounded-[var(--r-md)] bg-[var(--tint-1)] border border-[var(--border)] px-3 py-2.5">
              <p className="text-[10.5px] text-[var(--text-muted)]">إجمالي الفورم</p>
              <p className="text-2xl font-extrabold text-[var(--text-strong)] leading-tight" dir="ltr">{(selectedCounts?.clients || 0) + (selectedCounts?.leads || 0)}</p>
            </div>
          </div>
        )}
      </div>

      {shownGroups.map((group) => (
        <section key={group.name} className="space-y-3">
          {/* رأس الفورم: اسمه وعدده */}
          <div className="panel p-3.5 flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0 flex items-start gap-2">
              <Megaphone className="w-4 h-4 text-[var(--brand)] mt-0.5 shrink-0" />
              <div className="min-w-0">
                <h3 className="font-extrabold text-[var(--text-strong)] truncate">{group.name}</h3>
                <p className="text-[11px] text-[var(--text-muted)]">
                  <b className="text-[var(--text)]" dir="ltr">{group.clients.length + group.leads.length}</b> رقم •{' '}
                  {group.clients.length} عميل مسجّل • {group.leads.length} لسه في «توزيع الأرقام»
                </p>
              </div>
            </div>
          </div>

          {group.clients.length + group.leads.length === 0 && (
            <div className="rounded-[var(--r-md)] border border-dashed border-[var(--border)] px-4 py-6 text-center">
              <p className="text-sm text-[var(--text-muted)]">لا توجد أرقام في هذا الفورم بعد</p>
              <p className="text-[11px] text-[var(--text-dim)] mt-1">
                الفورم مفعّل في الإعدادات — أول ما يوصل منه رقم يظهر هنا وفي «توزيع الأرقام» تلقائياً.
              </p>
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {group.clients.map((client: Client) => {
              const meta = STAGE_META[client.stage] || STAGE_META.new;
              return (
                <motion.div
                  key={client.id}
                  whileHover={{ scale: 1.01 }}
                  onClick={() => onSelect(client)}
                  className="panel p-4 cursor-pointer"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h4 className="font-bold text-[var(--text-strong)] truncate">{client.name}</h4>
                      <p className="text-[var(--brand)] text-sm mt-0.5" dir="ltr">{client.phone}</p>
                    </div>
                    <span className={meta.cls}>{meta.label}</span>
                  </div>
                  <div className="mt-3 pt-3 border-t border-[var(--border)] space-y-1 text-[11.5px] text-[var(--text-muted)]">
                    <p>المسؤول: <span className="text-[var(--text)] font-bold">{ownerName(client)}</span></p>
                    <p className="truncate">المصدر: {client.source || '—'}</p>
                    {formNameOf(client) && (
                      <p className="truncate text-[var(--brand)] font-bold">الفورم: {formNameOf(client)}</p>
                    )}
                    <p>
                      {campaignTimeOf(client).kind === 'campaign' ? 'سُجّل في الكامبين: ' : 'أُضيف في النظام: '}
                      {formatDateTime(campaignTimeOf(client).at)}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); onCall?.(client); }}
                    className="icon-btn !w-9 !h-9 text-emerald-300 mt-3"
                    title="الاتصال بالعميل"
                  >
                    <PhoneCall className="w-4 h-4" />
                  </button>
                </motion.div>
              );
            })}

            {/* أرقام الكامبين اللي لسه في «توزيع الأرقام» — تظهر هنا أيضًا */}
            {group.leads.map((lead: AssignedLead) => (
              <motion.div key={`lead-${lead.id}`} className="panel p-4 border border-dashed border-[var(--brand-primary-soft)]">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h4 className="font-bold text-[var(--text-strong)] truncate">{lead.name || 'بدون اسم'}</h4>
                    <p className="text-[var(--brand)] text-sm mt-0.5" dir="ltr">{lead.phone}</p>
                  </div>
                  <span className="text-[10px] font-bold px-2 py-1 rounded-full bg-[var(--brand-primary-softer)] text-[var(--brand)] whitespace-nowrap">
                    رقم كامبين • {leadStatusLabel(lead.status)}
                  </span>
                </div>
                <div className="mt-3 pt-3 border-t border-[var(--border)] space-y-1 text-[11.5px] text-[var(--text-muted)]">
                  <p>المسؤول: <span className="text-[var(--text)] font-bold">{userName(lead.salesId)}</span></p>
                  <p className="truncate">المصدر: {formatLeadDescription(lead.description) || 'رقم كامبين'}</p>
                  {formNameOf(lead) && (
                    <p className="truncate text-[var(--brand)] font-bold">الفورم: {formNameOf(lead)}</p>
                  )}
                  <p>
                    {campaignTimeOf(lead).kind === 'campaign' ? 'سُجّل في الكامبين: ' : 'أُضيف في النظام: '}
                    {formatDateTime(campaignTimeOf(lead).at)}
                  </p>
                  <p className="text-[10.5px] text-[var(--text-dim)]">لسه ما اتحوّلش لسجل عميل — موجود في «توزيع الأرقام».</p>
                </div>
                <a
                  href={`tel:${lead.phone}`}
                  className="icon-btn !w-9 !h-9 text-emerald-300 mt-3 inline-flex"
                  title="الاتصال بالرقم"
                >
                  <PhoneCall className="w-4 h-4" />
                </a>
              </motion.div>
            ))}
          </div>
        </section>
      ))}

      {campaignClients.length === 0 && campaignLeads.length === 0 && (
        <div className="text-center py-16">
          <Users className="w-16 h-16 text-[var(--text-dim)] mx-auto mb-4" />
          <p className="text-[var(--text-muted)]">
            {clients.length === 0 ? 'لا يوجد عملاء بعد' : 'لا يوجد عملاء كامبين — جرّب «عرض كل العملاء»'}
          </p>
        </div>
      )}
      {totalCampaign > 0 && visible.length === 0 && visibleLeads.length === 0 && (
        <p className="text-center text-sm text-[var(--text-dim)] py-8">لا نتائج مطابقة للبحث أو التصفية</p>
      )}
    </div>
  );
}

function AdminLeadsView({ assignedLeads, users, currentUser, onAdd, onDelete, onDeleteMany, onImport, onAssign, onSave, activeForms = [], autoRules = [], onSaveAutoRule, onRebalanceForm }: any) {
  // نفس قاعدة السيرفر حرفياً (isAssignableSales): سيلز/قائد فريق + حساب «مطوّر»
  // إداري يعمل سيلزاً أيضاً. والاشتراط بـ u.isActive كان يُخفي أي حساب قديم
  // لم يُكتب له الحقل أصلاً، فلا يظهر في توزيع الأرقام ولا يقبل رقمأ.
  const salesUsers = users.filter((u: User) => isAssignableSales(u));
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'unassigned'>('all');

  // ===== الفورمات: القائمة المسندلة تحدد نطاق التوزيع =====
  // اختيار فورم يحصر الأرقام المعروضة في هذا الفورم فقط، وكل توزيع من هذا التبويب
  // (فردي أو دفعة أو جماعي) يقع على أرقام الفورم المختار وحده.
  const [form, setForm] = useState('all');
  // العدّاد للفورمات المحدّدة فقط — الفورم غير المحدّد لا يظهر في القائمة ولا في العدّ
  const formCounts = new Map<string, number>();
  for (const lead of assignedLeads) {
    if (!isSelectedFormRecord(activeForms, lead)) continue;
    const key = formKeyOf(lead);
    formCounts.set(key, (formCounts.get(key) || 0) + 1);
  }
  const formOptions = [...new Set([
    ...(activeForms || []).map((name: string) => String(name || '').trim()).filter(Boolean),
    ...formCounts.keys(),
  ])]
    .map((name) => ({ name, count: formCounts.get(name) || 0 }))
    .sort((a, b) => b.count - a.count);
  const activeForm = form === 'all' || formOptions.some((option) => option.name === form) ? form : 'all';
  // الأرقام المحوَّلة لعميل (status = closed) خرجت من «توزيع الأرقام»:
  // سجلها بقى هو العميل نفسه (تبان في «عملاء كامبين»)، فما ينفعش تفضل
  // معروضة هنا كرقم «غير مخصص» وكأنها لسه متاحة للتوزيع.
  const openLeads = (assignedLeads as AssignedLead[]).filter(
    (lead: AssignedLead) => lead.status !== 'closed' && isSelectedFormRecord(activeForms, lead)
  );
  const formLeads = activeForm === 'all'
    ? openLeads
    : openLeads.filter((lead: AssignedLead) => formKeyOf(lead) === activeForm);

  const nameOf = (id?: string) => users.find((u: User) => u.id === id)?.name || 'غير مخصص';
  const q = normalizeArabicText(query).trim();
  const visible = formLeads
    .filter((l: AssignedLead) => (filter === 'unassigned' ? !salesUsers.some((u: User) => u.id === l.salesId) : true))
    .filter((l: AssignedLead) =>
      !q || normalizeArabicText(`${l.name} ${l.phone} ${nameOf(l.salesId)} ${l.description || ''} ${formNameOf(l)}`).includes(q)
    );
  const unassignedCount = formLeads.filter((l: AssignedLead) => !salesUsers.some((u: User) => u.id === l.salesId)).length;

  // حصة كل سيلز: نافذة تعرض كل السيلز وعدد الأرقام لكل واحد
  const [showShare, setShowShare] = useState(false);
  // توزيع دفعة: قائمة السيلز + عدد الأرقام — في الصفحة مباشرة
  const [batchSalesId, setBatchSalesId] = useState('');
  const [batchCount, setBatchCount] = useState('');

  // توزيع جماعي: كل الأرقام المعروضة تُنقل لمندوب واحد بضغطة واحدة (دفعة واحدة، لا رقم رقم)
  const [flash, setFlash] = useState('');
  useEffect(() => {
    if (!flash) return;
    const timer = setTimeout(() => setFlash(''), 4000);
    return () => clearTimeout(timer);
  }, [flash]);
  const assignAllVisible = (salesId: string) => {
    if (!salesId || !visible.length) return;
    const count = visible.length;
    onAssign?.(visible.map((l: AssignedLead) => l.id), salesId);
    setFlash(`تم توزيع ${count} ${count === 1 ? 'رقم' : 'أرقام'} على ${nameOf(salesId)} ✓`);
  };

  // ===== التوزيع التلقائي: فورم ← مندوبون بعينهم =====
  // القاعدة محفوظة لكل فورم على حدة (وتسافر بين الأجهزة)، والتعديل هنا مسودة
  // لا تُحفظ إلا بالضغط على «تشغيل/تحديث» حتى لا تتغير سياسة التوزيع بالخطأ في أثناء الاختيار.
  const ruleOf = (autoRules as AutoAssignRule[]).find(
    (rule) => String(rule.formName || '') === activeForm
  ) || null;
  // ===== «كل السيلز» (الوضع الافتراضي) =====
  // التوزيع على كل من يستقبل أرقاماً بالتساوي — بما فيهم أي حساب جديد بعد كده —
  // بدل قائمة أسماء تُنسى فتخلي الأرقام تتكدس عند واحد.
  const [autoAll, setAutoAll] = useState(true);
  const ruleActive = !!(ruleOf && ruleOf.active !== false && (ruleOf.allSales || (ruleOf.salesIds || []).length));
  const [autoIds, setAutoIds] = useState<string[]>([]);
  const savedIdsKey = ruleOf ? `${ruleOf.allSales ? 'all' : ''}|${(ruleOf.salesIds || []).join(',')}` : '';
  useEffect(() => {
    // عند تغيير الفورم نعرض مختاري هذا الفورم بدل مختاري الفورم السابق،
    // و«كل السيلز» تبقى مفعّلة افتراضياً لو مفيش قاعدة محفوظة للفورم.
    setAutoAll(ruleOf ? ruleOf.allSales === true : true);
    setAutoIds((savedIdsKey.split('|')[1] ? savedIdsKey.split('|')[1].split(',') : []).filter((id: string) => salesUsers.some((u: User) => u.id === id)));
  }, [activeForm, savedIdsKey]);
  // المندوبون الفعليون للتوزيع: «كل السيلز» أو المختارون
  const effectiveAutoIds = autoAll ? salesUsers.map((u: User) => String(u.id)) : autoIds;

  const toggleAuto = (id: string) =>
    setAutoIds((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]));

  // عدد الأرقام غير المخصصة في هذا الفورم — هي التي ستتوزع الآن
  const autoPending = activeForm === 'all' ? 0 : formLeads.filter((l: AssignedLead) => !l.salesId).length;
  const autoNow = activeForm !== 'all' && effectiveAutoIds.length
    ? distributeLeads({
        leads: formLeads,
        // الحصص على كل أرقام السيلز (وليس هذا الفورم فقط) → توزيع متوازن فعلاً
        loadLeads: assignedLeads,
        salesIds: effectiveAutoIds,
        formName: activeForm,
        formOf: formKeyOf,
        onlyUnassigned: true,
      }).assignments.length
    : 0;

  const startAuto = () => {
    if (activeForm === 'all' || !effectiveAutoIds.length) return;
    const done = Number(onSaveAutoRule?.(activeForm, effectiveAutoIds, true, autoAll)) || 0;
    const names = autoAll ? 'كل السيلز' : autoIds.map((id) => nameOf(id)).join(' و');
    setFlash(
      done > 0
        ? `تم توزيع ${done} رقم بالتساوي على ${names} ✓ — وأي رقم جديد من «${activeForm}» هيتوزع عليهم أوتوماتيك بالتساوي.`
        : `التوزيع التلقائي شغّال على «${activeForm}» ← ${names} ✓ — أول ما يوصل رقم جديد هيوصله واحد منهم بالتساوي.`
    );
  };
  const stopAuto = () => {
    if (activeForm === 'all') return;
    onSaveAutoRule?.(activeForm, effectiveAutoIds, false, autoAll);
    setFlash(`تم إيقاف التوزيع التلقائي لفورم «${activeForm}» — الأرقام الجديدة هتستنى التوزيع اليدوي.`);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <div className="page-intro"><div><h2>توزيع الأرقام</h2></div></div>
          <p className="text-xs text-[var(--text-muted)] mt-1">
            إجمالي الأرقام: <span className="text-[var(--brand)] font-bold">{formLeads.length}</span>
            {' '}• غير مخصصة: <span className="text-amber-300 font-bold">{unassignedCount}</span>
            {' '}• عدد السيلز: {salesUsers.length}
            {activeForm !== 'all' && (
              <> {' '}• الفورم: <span className="text-[var(--text)] font-bold">{activeForm}</span></>
            )}
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {/* حفظ التوزيع: رفع فوري لكل الأجهزة — reassurance إن التعديل اتحفظ فعلاً */}
          <button
            onClick={async () => {
              const ok = await onSave?.();
              setFlash(ok ? 'تم حفظ التوزيع وإرساله لكل الأجهزة ✓' : 'تعذّر الحفظ — اتأكد من الاتصال ثم حاول تاني');
            }}
            className="bg-emerald-500/10 border border-emerald-400/40 text-emerald-200 px-5 py-2.5 rounded-[var(--r-md)] font-bold text-sm flex items-center gap-2 hover:bg-emerald-500/20 transition-colors"
            title="حفظ التوزيع وإرساله لكل الأجهزة فوراً"
          >
            <Check className="w-4 h-4" /> حفظ التوزيع
          </button>
          <button onClick={() => setShowShare(true)} className="bg-[var(--brand-primary-softer)] border border-[var(--brand-primary-soft)] text-[var(--text)] px-5 py-2.5 rounded-[var(--r-md)] font-bold text-sm flex items-center gap-2 hover:bg-[var(--brand-primary-soft)] transition-colors">
            <BarChart3 className="w-4 h-4" /> الأرقام لكل سيلز
          </button>
          {/* إصلاح أي توزيع قديم: سحب كل الأرقام من عهدة السيلز مرة واحدة */}
          {formLeads.some((l: AssignedLead) => l.salesId) && (
            <button
              onClick={() => {
                const ids = formLeads.filter((l: AssignedLead) => l.salesId).map((l: AssignedLead) => l.id);
                if (!ids.length) return;
                if (!window.confirm(`إرجاع ${ids.length} رقم من عهدة السيلز إلى «غير مخصص»؟`)) return;
                onAssign?.(ids, '');
                setFlash(`تم إرجاع ${ids.length} رقم إلى «غير مخصص» ✓`);
              }}
              className="bg-amber-500/10 border border-amber-400/40 text-amber-200 px-5 py-2.5 rounded-[var(--r-md)] font-bold text-sm flex items-center gap-2 hover:bg-amber-500/20 transition-colors"
              title="يسحب كل الأرقام من عهدة السيلز ويرجعها لقائمة غير المخصصة"
            >
              <Undo2 className="w-4 h-4" /> إرجاع كل الأرقام
            </button>
          )}
          <button onClick={onImport} className="bg-[var(--brand-primary-softer)] border border-[var(--brand-primary-soft)] text-[var(--brand)] px-5 py-2.5 rounded-[var(--r-md)] font-bold text-sm flex items-center gap-2 hover:bg-[var(--brand-primary-soft)] transition-colors">
            <Upload className="w-4 h-4" /> استيراد ملف أرقام
          </button>
          <button onClick={onAdd} className="gradient-primary text-[var(--text-strong)] px-5 py-2.5 rounded-[var(--r-md)] font-bold text-sm flex items-center gap-2 glow-primary">
            <Plus className="w-4 h-4" /> إضافة رقم
          </button>
        </div>
      </div>

      {/* ===== الفورم: قائمة مسندلة تعرض كل فورم مفعّل وعدد أرقامه =====
          اختيار فورم يفتح أرقامه وحدها، والتوزيع بعدها يقع على أرقام هذا الفورم فقط. */}
      <div className="panel p-3.5">
        <div className="flex flex-col sm:flex-row sm:items-center gap-2.5">
          <label htmlFor="lead-form-select" className="text-[11px] font-bold text-[var(--text-dim)] shrink-0">
            الفورم
          </label>
          <select
            id="lead-form-select"
            value={activeForm}
            onChange={(e) => setForm(e.target.value)}
            className="flex-1 min-w-0 bg-[var(--tint-1)] border border-[var(--border)] rounded-[var(--r-md)] px-3 py-2.5 text-sm font-bold text-[var(--text-strong)]"
          >
            <option value="all" className="bg-gray-900">كل الفورمات ({openLeads.length})</option>
            {formOptions.map((option) => (
              <option key={option.name} value={option.name} className="bg-gray-900">
                {option.name} ({option.count} رقم)
              </option>
            ))}
          </select>
        </div>
        <p className="text-[11px] text-[var(--text-dim)] mt-2">
          {activeForm === 'all'
            ? 'اختر فورم لتوزيع أرقامه وحدها على السيلز. الفورمات المفعّلة في إعدادات السحب تظهر هنا تلقائياً.'
            : `كل توزيع من هذه الشاشة يقع على أرقام «${activeForm}» فقط — ${formLeads.length} رقم.`}
        </p>
      </div>

      {/* ===== التوزيع التلقائي: اختار الفورم ← اختار السيلز ← أرقامه تتوزع عليهم بس =====
          اللي مش مختار في القائمة مايصلهوش من الفورم ده ولا رقم، لا الموجود ولا الجديد. */}
      {salesUsers.length > 0 && (
        <div className="panel p-3.5">
          <div className="flex items-start justify-between gap-2 flex-wrap">
            <div className="min-w-0">
              <p className="text-xs font-bold text-[var(--text)] flex items-center gap-1.5">
                <Zap className="w-3.5 h-3.5 text-[var(--brand)]" /> التوزيع التلقائي
                <span className="text-[9.5px] font-bold text-[var(--brand)] bg-[var(--brand-primary-softer)] border border-[var(--brand-primary-soft)] rounded-full px-1.5 py-0.5">جديد</span>
              </p>
              <p className="text-[11px] text-[var(--text-dim)] mt-1 leading-relaxed">
                اختار السيلز اللي أرقام الفورم دي تتوزع عليهم بس، واضغط «تشغيل التوزيع التلقائي» — كل رقم جديد
                من الفورم هيتوزع عليهم بالتساوي أوتوماتيك، واللي مش مختار مايصلهوش منها ولا رقم.
              </p>
            </div>
            <span className={`st-chip ${ruleActive ? 'st-closed' : 'st-negotiation'} shrink-0`}>
              {ruleActive ? 'مفعّل' : 'موقوف'}
            </span>
          </div>

          {activeForm === 'all' ? (
            // بدون تحديد فورم لا نعرف أرقام مين تتوزع — فنعرض الاختيار هنا مباشرة
            // بدل سطر نص فقط، حتى لا تبدو اللوحة فاضية أو غير موجودة.
            <div className="mt-3 rounded-[var(--r-md)] border border-[var(--border)] bg-[var(--tint-1)] p-3">
              <label htmlFor="auto-form-select" className="block text-[11px] font-bold text-[var(--text)] mb-1.5">
                اختار الفورم اللي أرقامه تتوزع أوتوماتيك
              </label>
              <select
                id="auto-form-select"
                value=""
                onChange={(e) => e.target.value && setForm(e.target.value)}
                className="w-full sm:w-80 bg-[var(--surface)] border border-[var(--border)] rounded-[var(--r-md)] px-3 py-2.5 text-sm text-[var(--text-strong)]"
              >
                <option value="" className="bg-gray-900">— اختر الفورم —</option>
                {formOptions.map((option) => (
                  <option key={option.name} value={option.name} className="bg-gray-900">
                    {option.name} ({option.count} رقم)
                  </option>
                ))}
              </select>
              <p className="text-[11px] text-[var(--text-dim)] mt-2 leading-relaxed">
                التوزيع التلقائي يتظبط لكل فورم لوحده — بعد اختيار الفورم هتظهر أسماء السيلز تختار منهم.
              </p>
            </div>
          ) : (
            <>
              {/* ===== كل السيلز (الافتراضي): توزيع بالتساوي على الجميع ===== */}
              <label className="mt-3 flex items-start gap-2.5 rounded-[var(--r-md)] border border-[var(--border)] bg-[var(--tint-1)] p-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoAll}
                  onChange={(e) => setAutoAll(e.target.checked)}
                  className="w-4 h-4 mt-0.5 accent-[var(--brand)]"
                />
                <span className="min-w-0">
                  <b className="block text-xs text-[var(--text-strong)]">كل السيلز (بالتساوي)</b>
                  <span className="block text-[11px] text-[var(--text-dim)] mt-0.5 leading-relaxed">
                    التوزيع على كل من يستقبل أرقاماً — {salesUsers.length} حساب، ومنهم أي حساب جديد —
                    بالتساوي حسب عدد الأرقام اللي مع كل واحد، مش على أسماء مختارة بس.
                  </span>
                </span>
              </label>

              {/* قائمة مسندلة: اختار اسم من هنا ينضم لقائمة المختارين (والضغط عليه تحت يشيله) */}
              <div className="mt-3">
                <label htmlFor="auto-sales-select" className="block text-[11px] font-bold text-[var(--text-dim)] mb-1">
                  أضف سيلز للقائمة
                </label>
                <select
                  id="auto-sales-select"
                  value=""
                  onChange={(e) => {
                    const id = e.target.value;
                    if (id) setAutoIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
                  }}
                  className="w-full sm:w-72 bg-[var(--tint-1)] border border-[var(--border)] rounded-[var(--r-md)] px-3 py-2.5 text-sm text-[var(--text-strong)]"
                >
                  <option value="" className="bg-gray-900">— اختر السيلز —</option>
                  {salesUsers
                    .filter((u: User) => !autoIds.includes(u.id))
                    .map((u: User) => (
                      <option key={u.id} value={u.id} className="bg-gray-900">
                        {u.name}
                      </option>
                    ))}
                </select>
              </div>

              <div className="mt-3 flex flex-wrap gap-1.5">
                {salesUsers.map((u: User) => {
                  const on = autoIds.includes(u.id);
                  const mine = formLeads.filter((l: AssignedLead) => l.salesId === u.id).length;
                  return (
                    <button
                      key={u.id}
                      type="button"
                      onClick={() => toggleAuto(u.id)}
                      aria-pressed={on}
                      title={on ? 'مختار — الأرقام الجديدة تتوزع عليه' : 'غير مختار — مايصلهوش من الفورم ده'}
                      className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11.5px] font-bold transition-colors ${
                        on
                          ? 'bg-[var(--brand-primary-softer)] border-[var(--brand-primary-soft)] text-[var(--brand)]'
                          : 'bg-[var(--tint-1)] border-[var(--border)] text-[var(--text-muted)]'
                      }`}
                    >
                      <span className={`w-3.5 h-3.5 rounded-full grid place-items-center border ${on ? 'border-[var(--brand)] bg-[var(--brand)] text-black' : 'border-[var(--border-strong)]'}`}>
                        {on ? <Check className="w-2.5 h-2.5" /> : null}
                      </span>
                      {u.name}
                      <span className="text-[10px] text-[var(--text-dim)]">{mine}</span>
                    </button>
                  );
                })}
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button
                  onClick={startAuto}
                  disabled={!effectiveAutoIds.length}
                  className="gradient-primary text-[var(--text-strong)] px-4 py-2 rounded-[var(--r-md)] font-bold text-xs disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
                >
                  <Zap className="w-3.5 h-3.5" /> {ruleActive ? 'تحديث التوزيع التلقائي' : 'تشغيل التوزيع التلقائي'}
                </button>
                <button
                  onClick={() => { setAutoAll(false); setAutoIds(salesUsers.map((u: User) => u.id)); }}
                  className="bg-[var(--tint-1)] border border-[var(--border)] text-[var(--text-muted)] px-3 py-2 rounded-[var(--r-md)] font-bold text-xs hover:text-[var(--text)] transition-colors"
                >
                  تحديد الكل
                </button>
                <button
                  onClick={() => { setAutoAll(false); setAutoIds([]); }}
                  disabled={!autoIds.length}
                  className="bg-[var(--tint-1)] border border-[var(--border)] text-[var(--text-muted)] px-3 py-2 rounded-[var(--r-md)] font-bold text-xs disabled:opacity-40 hover:text-[var(--text)] transition-colors"
                >
                  مسح الاختيار
                </button>
                {/* إصلاح تكدّس قديم: توزيع كل أرقام الفورم الحالية بالتساوي من جديد */}
                {onRebalanceForm && activeForm !== 'all' && formLeads.length > 0 && (
                  <button
                    onClick={() => {
                      if (!window.confirm(`إعادة توزيع ${formLeads.length} رقم من «${activeForm}» بالتساوي على كل السيلز؟ سيتم نقل الأرقام من المندوبين المحمّلين زيادة.`)) return;
                      const moved = Number(onRebalanceForm(activeForm)) || 0;
                      setFlash(moved > 0 ? `تم إعادة توزيع ${moved} رقم بالتساوي على كل السيلز ✓` : 'كل الأرقام متساوية بالفعل — مفيش حاجة تتحرك');
                    }}
                    className="bg-[var(--tint-1)] border border-[var(--border)] text-[var(--text)] px-3 py-2 rounded-[var(--r-md)] font-bold text-xs hover:border-[var(--brand-primary-soft)] transition-colors"
                    title="إعادة توزيع أرقام الفورم كلها بالتساوي على كل من يستقبل أرقاماً"
                  >
                    <Scale className="w-3.5 h-3.5 inline-block ml-1" /> إعادة توزيع بالتساوي
                  </button>
                )}
                {ruleActive && (
                  <button
                    onClick={stopAuto}
                    className="bg-amber-500/10 border border-amber-400/40 text-amber-200 px-3 py-2 rounded-[var(--r-md)] font-bold text-xs hover:bg-amber-500/20 transition-colors"
                  >
                    إيقاف التلقائي
                  </button>
                )}
              </div>

              <p className="text-[11px] text-[var(--text-dim)] mt-2 leading-relaxed">
                {!effectiveAutoIds.length
                  ? 'مفيش سيلز مختار — اختار اسم واحد على الأقل من فوق.'
                  : autoAll
                  ? `كل السيلز (${effectiveAutoIds.length}) — الأرقام الجديدة بتتوزع عليهم بالتساوي حسب الحمل الحالي لكل واحد.`
                  : `المختارون: ${autoIds.map((id) => nameOf(id)).join(' • ')} — عندهم ${autoIds.reduce((sum, id) => sum + formLeads.filter((l: AssignedLead) => l.salesId === id).length, 0)} رقم من هذا الفورم.`}
                {autoNow > 0 && (
                  <span className="block text-emerald-300 mt-1">
                    {autoNow} رقم غير مخصص هيتوزع عليهم بالتساوي دلوقتي ({autoPending} غير مخصص في الفورم).
                  </span>
                )}
                {ruleActive && (
                  <span className="block text-[var(--brand)] mt-1">
                    شغّال بالفعل على: {ruleOf!.allSales ? 'كل السيلز' : (ruleOf!.salesIds || []).map((id: string) => nameOf(id)).join(' • ')} — أي رقم جديد من «{activeForm}» يتوزع عليهم بالتساوي.
                  </span>
                )}
              </p>
            </>
          )}
        </div>
      )}

      {/* أدوات التوزيع: بحث + تصفية + توزيع جماعي */}
      <div className="panel p-3.5 flex flex-col lg:flex-row gap-2.5 lg:items-center">
        <div className="relative flex-1">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-muted)]" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="ابحث بالاسم أو الرقم أو السيلز..."
            className="w-full bg-[var(--tint-1)] border border-[var(--border)] rounded-[var(--r-md)] pr-9 pl-3 py-2.5 text-[var(--text-strong)] text-sm" />
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={() => setFilter('all')}
            className={`text-xs font-bold px-3 py-2.5 rounded-[var(--r-md)] border transition-colors ${filter === 'all' ? 'bg-[var(--brand-primary-softer)] border-[var(--brand-primary-soft)] text-[var(--brand)]' : 'bg-[var(--tint-1)] border-[var(--border)] text-[var(--text-muted)]'}`}>
            الكل ({formLeads.length})
          </button>
          <button onClick={() => setFilter('unassigned')}
            className={`text-xs font-bold px-3 py-2.5 rounded-[var(--r-md)] border transition-colors ${filter === 'unassigned' ? 'bg-amber-500/20 border-amber-400/50 text-amber-200' : 'bg-[var(--tint-1)] border-[var(--border)] text-[var(--text-muted)]'}`}>
            غير مخصصة ({unassignedCount})
          </button>
        </div>
      </div>

      {/* لا يوجد مندوبون بعد: نوضّح السبب بدل قائمة فارغة صامتة */}
      {salesUsers.length === 0 && (
        <div className="rounded-[var(--r-md)] border border-amber-400/40 bg-amber-500/10 px-4 py-3 text-xs text-amber-200 leading-relaxed">
           لا يوجد أي حساب سيلز (Sales Agent) بعد، ولهذا لا يمكن توزيع أي رقم على أحد.
          أنشئ حساب سيلز من تبويب «فريق العمل» ← «إضافة حساب»، واربطه بالفريق إن أردت، ثم عُد إلى هنا.
        </div>
      )}

      {flash && (
        <div className="rounded-[var(--r-md)] border border-emerald-400/40 bg-emerald-500/10 px-4 py-3 text-xs font-bold text-emerald-200">
          {flash}
        </div>
      )}

      {/* توزيع دفعة: اختر السيلز من القائمة ← اكتب عدد الأرقام ← توزيع فوري */}
      {salesUsers.length > 0 && (
        <div className="panel p-3.5">
          <p className="text-xs font-bold text-[var(--text)] mb-2.5">توزيع دفعة على سيلز ({visible.length} رقم معروض):</p>
          <div className="flex flex-col sm:flex-row gap-2">
            <select value={batchSalesId} onChange={(e) => setBatchSalesId(e.target.value)}
              className="flex-1 bg-[var(--tint-1)] border border-[var(--border)] rounded-[var(--r-md)] px-3 py-2.5 text-sm text-[var(--text-strong)]">
              <option value="" className="bg-gray-900">— اختر السيلز —</option>
              {salesUsers.map((u: User) => (
                <option key={u.id} value={u.id} className="bg-gray-900">
                  {u.name} (عنده {formLeads.filter((l: AssignedLead) => l.salesId === u.id).length} من هذا الفورم)
                </option>
              ))}
            </select>
            <input type="number" min={1} max={visible.length} value={batchCount} dir="ltr"
              onChange={(e) => setBatchCount(e.target.value)}
              placeholder="عدد الأرقام"
              className="w-full sm:w-32 bg-[var(--tint-1)] border border-[var(--border)] rounded-[var(--r-md)] px-3 py-2.5 text-sm text-[var(--text-strong)] text-center font-bold" />
            <button
              onClick={() => {
                const n = Math.floor(Number(batchCount) || 0);
                if (!batchSalesId || n < 1) return;
                const batch = visible.filter((l: AssignedLead) => l.salesId !== batchSalesId).slice(0, n);
                if (!batch.length) { setFlash('كل الأرقام المعروضة عنده بالفعل'); return; }
                onAssign?.(batch.map((l: AssignedLead) => l.id), batchSalesId);
                setFlash(`تم توزيع ${batch.length} رقم على ${nameOf(batchSalesId)} ✓`);
                setBatchCount('');
              }}
              disabled={!batchSalesId || !(Number(batchCount) >= 1)}
              className="gradient-primary text-[var(--text-strong)] px-6 py-2.5 rounded-[var(--r-md)] font-bold text-sm disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap">
              توزيع
            </button>
          </div>
        </div>
      )}

      <div className="space-y-3">
        {visible.map((lead: AssignedLead) => {
          const owner = salesUsers.find((u: User) => u.id === lead.salesId);
          return (
            <motion.div key={lead.id} whileHover={{ scale: 1.005 }}
              className="panel p-4">
              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h4 className="font-bold text-[var(--text-strong)] text-base">{lead.name}</h4>
                    <span className={`st-chip ${lead.status === 'new' ? 'st-new' : lead.status === 'viewed' ? 'st-meeting' : lead.status === 'contacted' ? 'st-contacted' : 'st-closed'}`}>
                      {lead.status === 'new' ? 'رقم جديد' : lead.status === 'viewed' ? 'تم العرض' : lead.status === 'contacted' ? 'تم التواصل' : 'مغلق'}
                    </span>
                    {!owner && <span className="st-chip st-negotiation">غير مخصص</span>}
                  </div>
                  <div className="flex items-center gap-2 flex-wrap mt-1">
                    <p className="text-[var(--brand)]" dir="ltr">{lead.phone}</p>
                    <FormNameChip record={lead} />
                    <CampaignTimeChip at={campaignTimeOf(lead).at} kind={campaignTimeOf(lead).kind} />
                  </div>
                  {lead.description && <p className="text-[11.5px] text-[var(--text-muted)] mt-1.5">{formatLeadDescription(lead.description)}</p>}
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <a href={`tel:${lead.phone}`} className="icon-btn !w-9 !h-9 text-emerald-300" title="الاتصال بالعميل"><PhoneCall className="w-4 h-4" /></a>
                  <button onClick={() => onDelete(lead.id)} className="icon-btn !w-9 !h-9 text-red-400" title="حذف الرقم نهائياً من النظام">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* تخصيص الرقم لمندوب — هذا هو التوزيع المباشر */}
              <div className="mt-3 pt-3 border-t border-[var(--border)] flex flex-wrap items-center gap-2">
                <span className="text-[11px] text-[var(--text-muted)]">مخصص لـ:</span>
                <select
                  value={lead.salesId || ''}
                  onChange={(e) => onAssign?.([lead.id], e.target.value)}
                  className="bg-[var(--tint-1)] border border-[var(--border)] rounded-[var(--r-sm)] px-2.5 py-1.5 text-xs text-[var(--text-strong)]">
                  <option value="" className="bg-gray-900">— غير مخصص —</option>
                  {salesUsers.map((u: User) => (
                    <option key={u.id} value={u.id} className="bg-gray-900">{u.name}</option>
                  ))}
                </select>
                {owner && (
                  <>
                    <span className="st-chip st-closed">✓ مع {owner.name}</span>
                    {/* سحب الرقم من السيلز بلا حذفه: يرجع «غير مخصص» ويظهر في التصفية */}
                    <button
                      onClick={() => onAssign?.([lead.id], '')}
                      className="text-[11px] font-bold text-amber-300 border border-amber-400/40 bg-amber-500/10 px-2.5 py-1.5 rounded-[var(--r-sm)] hover:bg-amber-500/20 transition-colors"
                      title="يسحب الرقم من عهدة السيلز ويرجعه لقائمة غير المخصصة"
                    >
                      إزالة من السيلز
                    </button>
                  </>
                )}
              </div>
            </motion.div>
          );
        })}
      </div>

      {assignedLeads.length === 0 && (
        <div className="text-center py-16">
          <UserPlus className="w-16 h-16 text-[var(--text-dim)] mx-auto mb-4" />
          <p className="text-[var(--text-muted)]">لا يوجد أرقام موزعة</p>
        </div>
      )}
      {activeForm !== 'all' && formLeads.length === 0 && assignedLeads.length > 0 && (
        <p className="text-center text-sm text-[var(--text-dim)] py-8">
          لا توجد أرقام في هذا الفورم بعد — أول ما يوصل منه رقم يظهر هنا تلقائياً
        </p>
      )}
      {formLeads.length > 0 && visible.length === 0 && (
        <p className="text-center text-sm text-[var(--text-dim)] py-8">لا نتائج مطابقة للبحث أو التصفية</p>
      )}

      {/* حصة كل سيلز: كل السيلز وعدد الأرقام لكل واحد، والضغط على الاسم يفتح أرقامه */}
      {showShare && <SalesShareModal leads={formLeads} users={users} onClose={() => setShowShare(false)} onDeleteMany={onDeleteMany} />}
    </div>
  );
}

// Admin Create Sales View - For Admin to create sales accounts
// Admin Teams View
function AdminTeamsView({ teams, users, currentUser, onSelect, onAdd }: any) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="page-intro"><div><h2>الفرق</h2></div></div>
        <button onClick={onAdd} className="gradient-primary text-[var(--text-strong)] px-5 py-2.5 rounded-[var(--r-md)] font-bold text-sm flex items-center gap-2 glow-primary">
          <Plus className="w-4 h-4" /> إضافة فريق
        </button>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {teams.map((team: Team) => (
          <motion.div key={team.id} whileHover={{ scale: 1.02 }} onClick={() => onSelect(team)}
            className="panel p-5 cursor-pointer">
            <h4 className="font-bold text-[var(--text-strong)]">{team.name}</h4>
            <p className="text-sm text-[var(--text-muted)]">المشرف: {team.supervisorName}</p>
            <p className="text-sm text-[var(--text-muted)]">عدد الأعضاء: {team.memberIds.length}</p>
          </motion.div>
        ))}
      </div>
    </div>
  );
}

// Admin Attendance View - تبويب الحضور للإدارة
function AdminAttendanceView({ users }: any) {
  const [query, setQuery] = useState('');
  const [period, setPeriod] = useState<'today' | 'week' | 'month' | 'all'>('today');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [, setRefresh] = useState(0);

  // قراءة دورية حتى تظهر سجلات الأجهزة الأخرى بمجرد وصولها من سيرفر البيانات
  useEffect(() => {
    const timer = setInterval(() => setRefresh((r) => r + 1), 10000);
    return () => clearInterval(timer);
  }, []);

  const allRecords = getAttendance();
  const today = todayKey();
  const periodStart = (() => {
    const d = new Date();
    if (period === 'week') d.setDate(d.getDate() - 6);
    if (period === 'month') d.setDate(d.getDate() - 29);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  })();

  const inPeriod = (rec: Attendance) =>
    period === 'all'
      ? true
      : period === 'today'
      ? rec.date === today
      : Date.parse(`${rec.date}T00:00:00`) >= periodStart;

  const searchQuery = normalizeArabicText(query).trim();

  // حسابات المديرين لا تسجّل حضوراً ولا تظهر في القائمة — الحضور للسيلز والمشرفين فقط.
  // الحكم بالرتبة السلوكية: حساب المطوّر/الإداري-السيلز (محمد وفريدة) يسجّل حضوراً
  // ويظهر مع الفريق، وإلا كان غايباً عن شاشة الحضور رغم أنه يشتغل سيلزاً.
  const persons = users
    .filter((u: User) => effectiveRoleOf(u) !== 'admin')
    .filter((u: User) => !searchQuery || normalizeArabicText(u.name).includes(searchQuery))
    .map((u: User) => ({
      user: u,
      total: allRecords.filter((a: Attendance) => a.userId === u.id).length,
      todayRecord: allRecords.find((a: Attendance) => a.userId === u.id && a.date === today),
      records: allRecords
        .filter((a: Attendance) => a.userId === u.id && inPeriod(a))
        .sort((a: Attendance, b: Attendance) => b.checkInAt.localeCompare(a.checkInAt)),
    }));

  const checkedToday = persons.filter((p: any) => p.todayRecord).length;
  const outToday = persons.filter((p: any) => p.todayRecord?.checkOutAt).length;

  const locationButton = (lat?: number, lng?: number, accuracy?: number, label = ' الموقع') =>
    typeof lat === 'number' && typeof lng === 'number' ? (
      <a
        href={mapsLink(lat, lng)}
        target="_blank"
        rel="noreferrer"
        title={accuracy ? `فتح الموقع في خرائط جوجل (دقة ±${accuracy}م)` : 'فتح الموقع في خرائط جوجل'}
        className="inline-flex items-center gap-1.5 text-xs font-bold text-[var(--brand)] bg-[var(--brand-primary-softer)] border border-[var(--brand-primary-soft)] px-2.5 py-1 rounded-[var(--r-sm)] hover:bg-[var(--brand-primary-soft)] transition-colors"
      >
        {label}
        {accuracy ? ` ±${accuracy}م` : ''}
      </a>
    ) : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold gradient-text flex items-center gap-2">
            <Clock className="w-5 h-5 text-[var(--brand)]" /> الحضور والانصراف
          </h2>
          <p className="text-xs text-[var(--text-muted)] mt-1">
            {formatDayLabel(today)} — حضر اليوم: <span className="text-emerald-400 font-bold">{checkedToday}</span> من {persons.length}
            {' '}• انصرف: <span className="text-amber-400 font-bold">{outToday}</span>
          </p>
        </div>
        <div className="flex flex-col sm:flex-row gap-2">
          <div className="relative">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-muted)]" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="ابحث باسم السيلز..."
              className="w-full sm:w-56 bg-[var(--tint-1)] border border-[var(--border)] rounded-[var(--r-md)] pr-9 pl-3 py-2.5 text-[var(--text-strong)] text-sm" />
          </div>
          <select value={period} onChange={(e) => setPeriod(e.target.value as any)}
            className="bg-[var(--tint-1)] border border-[var(--border)] rounded-[var(--r-md)] px-4 py-2.5 text-[var(--text-strong)] text-sm">
            <option value="today" className="bg-gray-900">اليوم</option>
            <option value="week" className="bg-gray-900">آخر ٧ أيام</option>
            <option value="month" className="bg-gray-900">آخر ٣٠ يوم</option>
            <option value="all" className="bg-gray-900">كل السجلات</option>
          </select>
        </div>
      </div>

      <AttendanceMonthlyReport users={users} />

      {persons.length === 0 && (
        <div className="panel p-10 text-center">
          <Users className="w-14 h-14 text-[var(--text-dim)] mx-auto mb-3" />
          <p className="text-[var(--text-muted)]">لا يوجد أعضاء مطابقون للبحث</p>
        </div>
      )}

      <div className="space-y-4">
        {persons.map(({ user, records, todayRecord, total }: any) => {
          const hasToday = !!todayRecord;
          const hasOut = !!todayRecord?.checkOutAt;
          const isOpen = expandedId === user.id;
          return (
            <motion.div
              key={user.id}
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              className="panel p-5"
            >
              <div className="flex flex-wrap items-center gap-3">
                <div className={`w-12 h-12 rounded-full flex items-center justify-center shrink-0 ${
                  hasOut ? 'bg-[var(--warn)]' : hasToday ? 'gradient-success' : 'bg-[var(--tint-2)]'
                }`}>
                  <span className={`font-bold ${hasToday ? 'text-[var(--text-strong)]' : 'text-[var(--text-muted)]'}`}>{user.name[0]}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <h4 className="font-bold text-[var(--text-strong)] truncate">{user.name}</h4>
                  <p className="text-xs text-[var(--text-muted)]">
                    {user.role === 'supervisor' ? 'مشرف' : 'سيلز'} • إجمالي أيام الحضور: {total}
                  </p>
                </div>
                {/* تحذير التلاعب في الموقع — مؤشرات Fake GPS / VPN */}
                {(todayRecord?.flags?.length || 0) > 0 && (
                  <span className="text-[10.5px] px-2.5 py-1 rounded-full font-bold whitespace-nowrap bg-red-500/20 text-red-300 border border-red-500/40"
                    title={todayRecord?.flags?.join(' • ')}>
                    <ShieldAlert className="w-3 h-3 inline-block" /> مشكوك في الموقع ({todayRecord?.flags?.length})
                  </span>
                )}
                <span className={`text-xs px-3 py-1.5 rounded-full font-bold whitespace-nowrap ${
                  hasOut ? 'bg-amber-500/20 text-amber-400' : hasToday ? 'bg-emerald-500/20 text-emerald-400' : 'bg-gray-500/20 text-[var(--text-muted)]'
                }`}>
                  {hasOut ? '🚪 انصرف' : hasToday ? ' حاضر' : 'لم يسجل بعد'}
                </span>
              </div>

              {(todayRecord?.flags?.length || 0) > 0 && (
                <div className="mt-3 rounded-[var(--r-md)] bg-red-500/10 border border-red-500/25 px-3.5 py-2.5">
                  <p className="text-[11.5px] font-bold text-red-300 flex items-center gap-1.5">
                    <ShieldAlert className="w-3.5 h-3.5" /> مؤشرات اشتباه في موقع الحضور:
                  </p>
                  <ul className="list-disc pr-5 mt-1 space-y-0.5">
                    {todayRecord.flags.map((f: string) => (
                      <li key={f} className="text-[11px] text-red-200/90">{f}</li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <div className={`rounded-[var(--r-md)] px-4 py-3 border ${hasToday ? 'bg-emerald-500/10 border-emerald-500/25' : 'bg-[var(--tint-1)] border-[var(--border)]'}`}>
                  <p className="text-xs text-[var(--text-muted)] mb-1">الحضور</p>
                  {todayRecord ? (
                    <>
                      <p className="text-sm text-[var(--text-strong)] font-bold">حضر الساعة {formatTime(todayRecord.checkInAt)}</p>
                      <div className="mt-2">{locationButton(todayRecord.latitude, todayRecord.longitude, todayRecord.accuracy)}</div>
                    </>
                  ) : (
                    <p className="text-sm text-[var(--text-dim)]">لا يوجد حضور اليوم</p>
                  )}
                </div>

                <div className={`rounded-[var(--r-md)] px-4 py-3 border ${hasOut ? 'bg-amber-500/10 border-amber-500/25' : 'bg-[var(--tint-1)] border-[var(--border)]'}`}>
                  <p className="text-xs text-[var(--text-muted)] mb-1">الانصراف</p>
                  {todayRecord?.checkOutAt ? (
                    <>
                      <p className="text-sm text-[var(--text-strong)] font-bold">
                        انصرف الساعة {formatTime(todayRecord.checkOutAt)}
                        {workedMinutes(todayRecord) > 0 && (
                          <span className="text-[var(--text-muted)] font-normal text-xs"> • {formatDuration(workedMinutes(todayRecord))}</span>
                        )}
                      </p>
                      <div className="mt-2">
                        {locationButton(todayRecord.checkOutLatitude, todayRecord.checkOutLongitude, todayRecord.checkOutAccuracy)}
                      </div>
                    </>
                  ) : (
                    <p className="text-sm text-[var(--text-dim)]">{hasToday ? 'لم يسجل انصرافه بعد' : 'لا يوجد انصراف اليوم'}</p>
                  )}
                </div>
              </div>

              {records.length > 0 && (
                <div className="mt-4 pt-4 border-t border-[var(--border)]">
                  <button
                    onClick={() => setExpandedId(isOpen ? null : user.id)}
                    className="text-sm font-bold text-[var(--text)] flex items-center gap-2 hover:text-[var(--text)] transition-colors"
                  >
                    <Calendar className="w-4 h-4" />
                    {isOpen ? 'إخفاء' : 'عرض'} سجل هذا الحساب ({records.length})
                  </button>
                  <AnimatePresence>
                    {isOpen && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        className="overflow-hidden"
                      >
                        <div className="space-y-2 mt-3">
                          {records.map((rec: Attendance) => (
                            <div key={rec.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 bg-[var(--tint-1)] rounded-[var(--r-md)] px-4 py-3">
                              <span className="text-sm text-[var(--text)]">{formatDayLabel(rec.date)}</span>
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="text-sm font-bold text-emerald-400">حضور {formatTime(rec.checkInAt)}</span>
                                {locationButton(rec.latitude, rec.longitude, rec.accuracy, '')}
                                {(rec.flags?.length || 0) > 0 && (
                                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-red-500/20 text-red-300 font-bold" title={rec.flags?.join(' • ')}>
                                    مشكوك ({rec.flags?.length})
                                  </span>
                                )}
                                {rec.checkOutAt ? (
                                  <>
                                    <span className="text-sm font-bold text-amber-400">انصراف {formatTime(rec.checkOutAt)}</span>
                                    {locationButton(rec.checkOutLatitude, rec.checkOutLongitude, rec.checkOutAccuracy, '')}
                                  </>
                                ) : (
                                  <span className="text-xs text-[var(--text-dim)]">لم يسجل انصرافاً</span>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              )}
            </motion.div>
          );
        })}
      </div>

      <p className="text-[11px] text-[var(--text-dim)] text-center">
        * كل حساب معروض بشكل منفصل، واضغط «عرض سجل هذا الحساب» لرؤية كل أيامه مع موقع الحضور والانصراف.
      </p>
    </div>
  );
}

// Admin Settings View
// ===== سحب الأرقام تلقائياً من المصدر (يعمل على سيرفر الشركة) =====
// ===== إعدادات سحب الأرقام عندما يكون الموقع على استضافة بلا قاعدة بيانات =====
// على سيرفر الشركة يحفظ السيرفر الإعدادات في ملف ويسحب في الخلفية.
// على Vercel (بلا قاعدة) نحفظ الإعدادات في متصفح المدير، ووظيفة /api/lead-source
// تقوم بجزء الشبكة فقط وتُعيد الأرقام لتحفظ هنا — فتظل الميزة تعمل كاملة.
const LEAD_SOURCE_KEY = 'crm_lead_source';
const LEAD_SOURCE_DEFAULTS = {
  enabled: false,
  type: 'sheet',
  sheetUrl: '',
  token: '',
  pages: [] as any[],
  forms: [] as any[],
  extraForms: [] as string[],
  intervalMinutes: 5,
  cursorTime: 0,
  assignCursor: 0,
  perSalesLimit: 0,
  acceptTestLeads: true,
  // ميعاد انتهاء صلاحية التوكن (ثواني) — ننبّه قبله بيومين حتى لا يتوقف السحب فجأة
  tokenExpiresAt: 0,
  lastRun: null as any,
};

const readLocalSource = () => {
  try {
    return { ...LEAD_SOURCE_DEFAULTS, ...(JSON.parse(localStorage.getItem(LEAD_SOURCE_KEY) || '{}') || {}) };
  } catch {
    return { ...LEAD_SOURCE_DEFAULTS };
  }
};

const writeLocalSource = (patch: any) => {
  const next = { ...readLocalSource(), ...patch };
  localStorage.setItem(LEAD_SOURCE_KEY, JSON.stringify(next));
  return next;
};

// الإعدادات المحفوظة محلياً تُعرض بنفس شكل الإعدادات القادمة من السيرفر
const localSourceView = (next: any) => ({ ...next, hasToken: !!next.token });

// إضافة الأرقام المسحوبة إلى بيانات هذا الجهاز ثم إخبار التطبيق ليحدّث الشاشة
const ingestLocalLeads = (leads: any[]) => {
  if (!Array.isArray(leads) || !leads.length) return;
  let existing: any[] = [];
  try {
    existing = JSON.parse(localStorage.getItem('crm_assigned_leads') || '[]');
  } catch {
    existing = [];
  }
  const known = new Set(existing.map((l: any) => l?.phone).filter(Boolean));
  const fresh = leads.filter((l: any) => l?.phone && !known.has(l.phone));
  if (!fresh.length) return;
  localStorage.setItem('crm_assigned_leads', JSON.stringify([...fresh, ...existing]));
  window.dispatchEvent(new Event(SYNC_EVENT));
};

// المندوبون المفعّلون على هذا الجهاز (نفس شرط التوزيع في السيرفر)
const localSalesTeam = () => {
  try {
    const users = JSON.parse(localStorage.getItem('crm_users') || '[]');
    return users
      .filter((u: any) => isAssignableSales(u))
      .map((u: any) => ({ id: u.id, name: u.name }));
  } catch {
    return [];
  }
};

// كل الأرقام المعروفة على هذا الجهاز — لتجاهل المكرر قبل إضافته
const localKnownPhones = () => {
  try {
    const leads = JSON.parse(localStorage.getItem('crm_assigned_leads') || '[]');
    const clients = JSON.parse(localStorage.getItem('crm_clients') || '[]');
    return [
      ...leads.map((l: any) => l?.phone),
      ...clients.flatMap((c: any) => [c?.phone, ...(c?.phones || [])]),
    ].filter(Boolean);
  } catch {
    return [];
  }
};

// ===== قنوات سحب الأرقام: فيسبوك وإنستجرام =====
// كل قناة تبويب مستقل بإعداداته الخاصة: التوكن، الصفحات، النماذج، كل كم دقيقة، ومؤشر
// آخر سحب. (ميتا تُنشئ نماذج إنستجرام على الصفحة نفسها وتُسحب بنفس الصلاحيات، لكن
// الفصل هنا يجعل لكل كامبين تبويبه واسمه «إنستجرام - …» أو «فيسبوك - …» في وصف الرقم.)
type LeadChannel = 'facebook' | 'instagram';
const CHANNEL_META: Record<LeadChannel, { label: string; ar: string; metaType: string; icon: string; hint: string }> = {
  facebook: {
    label: 'Facebook',
    ar: 'فيسبوك',
    metaType: 'فيسبوك مباشرة (توكن)',
    icon: '📘',
    hint: 'أرقام كامبينات فيسبوك تُوسم «فيسبوك - اسم النموذج».',
  },
  instagram: {
    label: 'Instagram',
    ar: 'إنستجرام',
    metaType: 'إنستجرام مباشرة (توكن)',
    icon: '📸',
    hint: 'ميتا تُنشئ نماذج إنستجرام على الصفحة نفسها، وتُسحب بنفس التوكن — لكن إعدادها ومؤشرها مستقلان هنا، فتبقى أرقام كامبينات إنستجرام في تبويبها باسم «إنستجرام - اسم النموذج».',
  },
};
// إعدادات قناة بعينها من إعدادات النظام (فيسبوك في الجذر، وإنستجرام في مفتاحها)
const channelViewOf = (config: any, channel: LeadChannel) =>
  (channel === 'facebook' ? config : config?.instagram) || {};
// كتابة تعديل في القناة المطلوبة داخل إعدادات المتصفح (وضع بلا قاعدة بيانات)
const writeLocalChannel = (channel: LeadChannel, patch: any) => {
  if (channel === 'facebook') return writeLocalSource(patch);
  const current = readLocalSource();
  return writeLocalSource({ instagram: { ...((current as any).instagram || {}), ...patch } });
};

function ChannelSourceCard({ channel }: { channel: LeadChannel }) {
  const meta = CHANNEL_META[channel];
  const [config, setConfig] = useState<any>(null);
  // true = سيرفر الشركة (يخزّن في ملف) · false = استضافة بلا قاعدة بيانات (التخزين في المتصفح)
  const [remote, setRemote] = useState<boolean | null>(null);
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');
  const [form, setForm] = useState({ sheetUrl: '', token: '', intervalMinutes: 5, perSalesLimit: 0 });
  const [pages, setPages] = useState<any[]>([]);
  // تشخيص آخر استكشاف: لكل مصدر (صفحات الحساب / الأعمال) هل نجح وكام صفحة رجع
  const [pageSources, setPageSources] = useState<any[]>([]);
  const [tokenKind, setTokenKind] = useState('');
  const [forms, setForms] = useState<any[]>([]);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [manual, setManual] = useState({ pageId: '', formId: '' });
  const busyRef = useRef('');
  const runRef = useRef<null | (() => Promise<void>)>(null);
  busyRef.current = busy;

  const applyConfig = (next: any) => {
    setConfig(next);
    // القيم المعروضة تخص هذه القناة وحدها
    const view = channelViewOf(next, channel);
    setForm({
      sheetUrl: view.sheetUrl || '',
      token: '',
      intervalMinutes: view.intervalMinutes || 5,
      perSalesLimit: Number(next.perSalesLimit) || 0,
    });
    // النماذج المحفوظة تظهر محدَّدة حتى لو أعدنا تحميل الصفحة
    if (Array.isArray(view.forms) && view.forms.length) {
      setForms((prev) => {
        const merged = [...prev];
        for (const f of view.forms) if (!merged.some((m) => m.id === f.id)) merged.push({ ...f });
        return merged;
      });
      setSelected((prev) => ({ ...prev, ...Object.fromEntries(view.forms.map((f: any) => [f.id, true])) }));
    }
  };

  useEffect(() => {
    fetch('/api/lead-source', { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((json) => {
        // على الاستضافة تعلن الوظيفة أنها بلا ذاكرة => الإعدادات تُحفظ في المتصفح
        setRemote(!json.stateless);
        applyConfig(json.stateless ? localSourceView(readLocalSource()) : json.config);
      })
      .catch(() => {
        // لا يوجد خادم إعدادات أصلاً: نعمل محلياً في كل الأحوال — الميزة تظل ظاهرة
        setRemote(false);
        applyConfig(localSourceView(readLocalSource()));
      });
  }, []);

  const save = async (body: any, message: string) => {
    setBusy('save');
    setNotice('');
    try {
      if (remote === false) {
        applyConfig(localSourceView(writeLocalChannel(channel, body)));
      } else {
        const res = await fetch('/api/lead-source', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ channel, ...body }),
        });
        const json = await res.json();
        if (!res.ok || !json.ok) throw new Error(json.error || 'تعذّر الحفظ');
        applyConfig(json.config);
      }
      // القوائم المسندلة في «عملاء كامبين» و«توزيع الأرقام» تتحدّث فوراً:
      // الفورم المفعّل الآن يظهر فيهما بلا حاجة لإعادة تحميل الصفحة.
      window.dispatchEvent(new Event(ACTIVE_FORMS_EVENT));
      setNotice(message);
    } catch (error: any) {
      setNotice(error?.message || 'تعذّر الحفظ');
    } finally {
      setBusy('');
    }
  };

  const discover = async () => {
    setBusy('discover');
    setNotice('');
    try {
      const token = form.token.trim() || String(channelViewOf(config, channel)?.token || '');
      if (remote === false) {
        // بلا قاعدة بيانات: نحفظ التوكن وتوكنات الصفحات في المتصفح لأن الوظيفة لا تحفظ شيئاً
        const res = await fetch('/api/lead-source', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'discover', channel, token, config: readLocalSource() }),
        });
        const json = await res.json();
        if (!res.ok || !json.ok) throw new Error(json.error || 'تعذّر الاستكشاف');
        applyConfig(localSourceView(writeLocalChannel(channel, { type: 'meta', token, pages: json.pages, tokenExpiresAt: json.tokenExpiresAt || 0 })));
        setPages(json.pages.map((p: any) => ({ id: p.id, name: p.name })));
        setPageSources(Array.isArray(json.sources) ? json.sources : []);
        setTokenKind(String(json.tokenType || ''));
        setForms([]);
        setSelected({});
        setNotice(json.warning || `وجدت ${json.pages.length} صفحة — اضغط صفحة لعرض نماذجها`);
        return;
      }

      // مسار واحد فقط على الاستضافة: /api/lead-source والفرق في action.
      // (كان هنا /api/lead-source/discover وده غير موجود على Vercel فيرجّع صفحة 404
      // نصية، فيفشل res.json() برسالة "Unexpected token 'T'" بدل خطأ واضح.)
      const res = await fetch('/api/lead-source', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'discover', channel, token: form.token.trim() }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || 'تعذّر الاستكشاف');
      setPages(json.pages);
      setPageSources(Array.isArray(json.sources) ? json.sources : []);
      setTokenKind(String(json.tokenType || ''));
      // استكشاف الصفحات = إعداد القناة، فنبدّل المصدر فوراً بدل انتظار ضغطة «حفظ»
      await save({ type: 'meta' }, '');
      setForms([]);
      setSelected({});
      setNotice(json.warning || `وجدت ${json.pages.length} صفحة — اضغط صفحة لعرض نماذجها`);
    } catch (error: any) {
      setNotice(error?.message || 'تعذّر الاستكشاف');
    } finally {
      setBusy('');
    }
  };

  const loadForms = async (pageId: string) => {
    setBusy(`forms-${pageId}`);
    setNotice('');
    try {
      // بلا قاعدة بيانات نرسل توكن الصفحة المحفوظ في المتصفح (الوظيفة لا تحفظ شيئاً)
      const pageToken = (channelViewOf(config, channel).pages || []).find((p: any) => p.id === pageId)?.token;
      const res = await fetch('/api/lead-source', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // في الوضعين نرسل action صريحاً: بدونها يُفهم الطلب كـ«حفظ» ولا تُرجَع نماذج
        body:
          remote === false
            ? JSON.stringify({ action: 'forms', channel, pageId, pageToken })
            : JSON.stringify({ action: 'forms', channel, pageId }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || 'تعذّر جلب النماذج');
      // دمج نماذج الصفحة مع النماذج المختارة من صفحات أخرى — لا نستبدل اختياراتك
      setForms((prev) => {
        const merged = [...prev];
        for (const f of json.forms) {
          if (!merged.some((m: any) => m.id === f.id)) merged.push({ ...f });
        }
        return merged;
      });
      if (!json.forms.length) setNotice('هذه الصفحة لا تحتوي على نماذج تسجيل (Instant Forms) بعد');
    } catch (error: any) {
      setNotice(error?.message || 'تعذّر جلب النماذج');
    } finally {
      setBusy('');
    }
  };

  // الصفحات المتاحة للإضافة اليدوية (المكتشفة أو المحفوظة)
  const pageOptions = (pages.length ? pages : channelViewOf(config, channel).pages || []).map((p: any) => ({ id: p.id, name: p.name }));

  // يقبل أكثر من معرّف في نفس المرة: كل واحد في سطر، أو مفصولاً بفاصلة/مسافة
  const addManualForm = () => {
    const ids = [...new Set(
      manual.formId
        .split(/[\s,،;]+/)
        .map((part) => part.trim())
        .filter(Boolean)
    )];
    // Form ID فقط كافٍ: لو مافيش صفحة مكتشفة نستخدم توكن القناة مباشرة على /{form-id}/leads
    const pageId = manual.pageId || pageOptions[0]?.id || '';
    if (!ids.length) return setNotice('اكتب معرّف النموذج أولاً');
    const fresh = ids.filter((id) => !forms.some((f) => f.id === id));
    if (!fresh.length) return setNotice('كل هذه النماذج مضافة بالفعل');
    setForms([...forms, ...fresh.map((id) => ({ id, pageId, name: `نموذج ${id}` }))]);
    setSelected((prev) => ({ ...prev, ...Object.fromEntries(fresh.map((id) => [id, true])) }));
    setManual({ pageId, formId: '' });
    const count = fresh.length > 1 ? `${fresh.length} نماذج` : 'النموذج';
    const hasSavedToken = !!channelViewOf(config, channel)?.hasToken;
    if (!form.token.trim() && !hasSavedToken) {
      setNotice(`أُضيف ${count} ✓ — لكن الصق توكن فيسبوك أولاً ثم اضغط «حفظ الإعدادات»`);
    } else {
      setNotice(`أُضيف ${count} ✓ — اضغط «حفظ الإعدادات» ليعمل السحب من كل النماذج المحددة`);
    }
  };

  // لو المستخدم لصق توكن (أو اختار نماذج) وهو على تبويب «ملف منشور» بلا رابط،
  // فالمقصود بالضرورة فيسبوك — نبدّل المصدر تلقائياً حتى لا يظل السحب يفشل بصمت.
  const nextSourceType = () => {
    const hasForms = forms.some((f) => selected[f.id]);
    if (form.token.trim() || (!form.sheetUrl.trim() && hasForms)) return 'meta';
    return channelViewOf(config, channel).type || 'sheet';
  };

  const saveSettings = () =>
    save(
      {
        type: nextSourceType(),
        sheetUrl: form.sheetUrl,
        forms: forms.filter((f) => selected[f.id]).map((f) => ({ id: f.id, pageId: f.pageId, name: f.name })),
        intervalMinutes: Number(form.intervalMinutes) || 5,
        // إعداد التوزيع (عدد الأرقام لكل مندوب) إعداد عام للفريق — لا يخص قناة دون أخرى
        ...(Number(form.perSalesLimit) >= 0 ? { perSalesLimit: Math.max(0, Number(form.perSalesLimit) || 0) } : {}),
        ...(form.token.trim() ? { token: form.token.trim() } : {}),
      },
      'تم حفظ الإعدادات ✓'
    );

  const runNow = async () => {
    if (busyRef.current) return;
    setBusy('run');
    setNotice('');
    try {
      let summary: any;

      if (remote === false) {
        // بلا قاعدة بيانات: الوظيفة تسحب وتوزّع، وهنا نحفظ الأرقام في هذا الجهاز
        const res = await fetch('/api/lead-source', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'run',
            config: readLocalSource(),
            sales: localSalesTeam(),
            knownPhones: localKnownPhones(),
          }),
        });
        const json = await res.json();
        if (!res.ok || !json.ok) throw new Error(json.error || 'تعذّر السحب');
        summary = json.summary;
        if (summary?.ok) ingestLocalLeads(json.leads || []);
        const local = readLocalSource();
        applyConfig(
          localSourceView(
            writeLocalSource({
              lastRun: summary,
              cursorTime: json.cursorTime ?? local.cursorTime,
              assignCursor: json.assignCursor ?? local.assignCursor,
              // مؤشر إنستجرام منفصل — وإلا أعاد جلب نفس أرقامه في كل مرة
              instagram: {
                ...((local as any).instagram || {}),
                lastRun: summary,
                cursorTime: json.instagramCursor ?? (local as any).instagram?.cursorTime ?? 0,
              },
            })
          )
        );
      } else {
        const res = await fetch('/api/lead-source', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'run', channel }),
        });
        const json = await res.json();
        if (!res.ok || !json.ok) throw new Error(json.error || 'تعذّر السحب');
        applyConfig(json.config);
        summary = json.summary;
      }

      // تفصيل الأرقام المستبعدة: بدونها يختفي الرقم بصمت ولا يعرف أحد أكان مكرراً أم غير صالح
      const rejectedList = Array.isArray(summary?.rejected) ? summary.rejected : [];
      const reasonAr: Record<string, string> = { duplicate: 'مكرر', invalid: 'غير صالح', limit: 'تجاوز الحد' };
      const rejectedLine = rejectedList.length
        ? ` — أرقام لم تُضف: ${rejectedList
            .slice(0, 6)
            .map((r: any) => `${r.phone || 'بدون رقم'} (${reasonAr[r.reason] || r.reason})`)
            .join('، ')}${rejectedList.length > 6 ? ` و${rejectedList.length - 6} غيرها` : ''}`
        : '';
      setNotice(
        summary?.ok
          ? `تم السحب: ${summary.added} رقم جديد (مكرر ${summary.duplicates} - غير صالح ${summary.invalid})${rejectedLine}`
          : `فشل السحب: ${summary?.error}`
      );
    } catch (error: any) {
      setNotice(error?.message || 'تعذّر السحب');
    } finally {
      setBusy('');
    }
  };
  // ===== إعادة سحب تاريخي كامل: تسترجع أرقام الكامبين المفقودة =====
  // تصفير مؤشر «آخر سحب» يجعل الدورة القادمة تقرأ كل تاريخ النماذج المختارة،
  // والسحب يمنع التكرار بالهاتف فيُضاف المفقود فقط — بلا نسخ ولا حذف يدوي.
  const resetAndPull = async () => {
    if (busyRef.current) return;
    const ok = window.confirm('إعادة سحب كل أرقام الكامبين من البداية؟\nيقرأ النظام كل تاريخ النماذج المختارة ويعيد إضافة أي رقم مفقود بدون تكرار.');
    if (!ok) return;
    setBusy('reset');
    setNotice('');
    try {
      if (remote === false) {
        const local: any = readLocalSource();
        applyConfig(localSourceView(writeLocalSource({
          cursorTime: 0,
          formCursors: {},
          lastRun: null,
          instagram: { ...(local.instagram || {}), cursorTime: 0, formCursors: {}, lastRun: null },
        })));
      } else {
        const res = await fetch('/api/lead-source', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'reset', channel }),
        });
        const json = await res.json();
        if (!res.ok || !json.ok) throw new Error(json.error || 'تعذّر تصفير مؤشر السحب');
        applyConfig(json.config);
      }
      busyRef.current = '';
      setBusy('');
      await runNow();
    } catch (error: any) {
      setNotice(error?.message || 'تعذّر إعادة السحب');
      setBusy('');
    }
  };

  runRef.current = runNow;

  // على الاستضافة لا توجد حلقة سحب في الخلفية — نشغّلها في المتصفح ما دام الموقع مفتوحاً
  // (تكفي قناة واحدة مفعّلة، ونأخذ أقصر مدة بين القناتين المفعّلتين)
  const enabledViews = (['facebook', 'instagram'] as LeadChannel[])
    .map((c) => channelViewOf(config, c))
    .filter((c) => c?.enabled);
  const anyChannelEnabled = enabledViews.length > 0;
  const shortestInterval = Math.max(1, Math.min(...enabledViews.map((c) => Number(c.intervalMinutes) || 5)));
  useEffect(() => {
    if (remote !== false || !anyChannelEnabled) return;
    const timer = setInterval(() => void runRef.current?.(), shortestInterval * 60 * 1000);
    return () => clearInterval(timer);
  }, [remote, anyChannelEnabled, shortestInterval]);

  if (!config) return null;
  const view = channelViewOf(config, channel);
  const last = view.lastRun;
  const selectedCount = forms.filter((f) => selected[f.id]).length;

  return (
    <div className="glass-card rounded-[var(--r-md)] p-6">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
        <h3 className="text-lg font-bold text-[var(--text-strong)] flex items-center gap-2">
          <Zap className="w-5 h-5 text-amber-400" /> سحب أرقام كامبين {meta.ar}
        </h3>
        <button
          onClick={() => save({ enabled: !view.enabled }, view.enabled ? 'تم إيقاف السحب التلقائي لهذه القناة' : 'تم تشغيل السحب التلقائي لهذه القناة ✓')}
          disabled={busy === 'save'}
          className={`px-4 py-2 rounded-[var(--r-md)] font-bold text-xs border transition-colors ${
            view.enabled ? 'bg-emerald-500/20 border-emerald-400/40 text-emerald-300' : 'bg-[var(--tint-1)] border-[var(--border)] text-[var(--text-muted)]'
          }`}
        >
          {view.enabled ? '● مُشغّل — اضغط للإيقاف' : 'متوقف — اضغط للتشغيل'}
        </button>
      </div>
      <p className="text-xs text-[var(--text-muted)] leading-relaxed mb-2">
        يقرأ النظام الأرقام من مصدر هذه القناة من نفسه كل بضع دقائق، ينظّفها ويحذف المكرر ويحفظها «غير مخصصة» — والتوزيع على السيلز بيدك من تبويب «توزيع الأرقام».
      </p>
      <p className="text-[11px] text-[var(--text-dim)] leading-relaxed mb-4">{meta.hint}</p>

      {remote === false && (
        <p className="text-[11px] text-amber-300/90 leading-relaxed mb-4 bg-amber-500/10 border border-amber-400/20 rounded-[var(--r-md)] px-3 py-2">
          على هذه الاستضافة لا توجد قاعدة بيانات مركزية: الإعدادات والأرقام تُحفظ في متصفح هذا الجهاز، والسحب التلقائي يعمل ما دام
          الموقع مفتوحاً. على سيرفر الشركة يعمل السحب في الخلفية وتظهر الأرقام على كل الأجهزة.
        </p>
      )}
      {remote === true && (
        <p className="text-[11px] text-[var(--text-dim)] leading-relaxed mb-4 bg-[var(--tint-1)] border border-[var(--border)] rounded-[var(--r-md)] px-3 py-2">
          السحب التلقائي يحترم «كل كم دقيقة» (الحالي: {view.intervalMinutes || 5} دقيقة). على Vercel يعمل من متصفح الإدارة
          ما دامت الصفحة مفتوحة؛ وللعمل 24/7 بدون متصفح أضف <span dir="ltr">CRON_SECRET</span> على Vercel
          وجدول رابط <span dir="ltr">/api/cron?key=...</span> كل دقيقة.
        </p>
      )}

      <div className="flex flex-col sm:flex-row gap-2 mb-4">
        {[
          { id: 'sheet', label: 'رابط ملف منشور (CSV)' },
          { id: 'meta', label: meta.metaType },
        ].map((option) => (
          <button
            key={option.id}
            onClick={() => save({ type: option.id }, '')}
            className={`flex-1 py-2.5 rounded-[var(--r-md)] font-bold text-xs border transition-colors ${
              view.type === option.id ? 'bg-[var(--brand-primary-softer)] border-[var(--brand-primary-soft)] text-[var(--text)]' : 'bg-[var(--tint-1)] border-[var(--border)] text-[var(--text-muted)]'
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>

      {view.type === 'sheet' ? (
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-[var(--text)] mb-1">رابط الملف المنشور (CSV)</label>
            <input
              dir="ltr"
              value={form.sheetUrl}
              onChange={(e) => setForm({ ...form, sheetUrl: e.target.value })}
              placeholder="https://docs.google.com/spreadsheets/d/e/.../pub?output=csv"
              className="w-full bg-[var(--tint-1)] border border-[var(--border)] rounded-[var(--r-md)] px-4 py-3 text-[var(--text-strong)] text-sm"
            />
            <p className="text-[11px] text-[var(--text-dim)] mt-1">
              في Google Sheets: ملف ← مشاركة ← نشر على الويب ← اختر (قيم مفصولة بفواصل .csv) ← انسخ الرابط والصقه هنا.
            </p>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-[var(--text)] mb-1">توكن المستخدم (User Access Token)</label>
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                dir="ltr"
                type="password"
                value={form.token}
                onChange={(e) => setForm({ ...form, token: e.target.value })}
                placeholder={view.hasToken ? 'توكن محفوظ ✓ — ألصق توكن جديداً لتغييره' : 'EAAG...'}
                className="flex-1 bg-[var(--tint-1)] border border-[var(--border)] rounded-[var(--r-md)] px-4 py-3 text-[var(--text-strong)] text-sm"
              />
              <button
                onClick={discover}
                disabled={busy !== '' || (!form.token.trim() && !view.hasToken)}
                className="gradient-primary text-[var(--text-strong)] px-5 py-3 rounded-[var(--r-md)] font-bold text-xs disabled:opacity-50 whitespace-nowrap"
              >
                {busy === 'discover' ? 'جارٍ الاستكشاف...' : 'استكشف صفحاتي'}
              </button>
            </div>
            <p className="text-[11px] text-[var(--text-dim)] mt-1">
              ولّد التوكن من Graph API Explorer على developers.facebook.com وامنحه هذه الصلاحيات الخمس معاً:{' '}
              <span dir="ltr">leads_retrieval + pages_manage_ads + pages_show_list + pages_read_engagement + pages_manage_metadata</span>، ثم الصقه واضغط «استكشف صفحاتي».
              <span className="block mt-1 text-amber-400/80">
                لو ظهر خطأ <span dir="ltr">Requires pages_manage_ads permission (#200)</span> فمعناه أن التوكن ناقص هذه الصلاحية — أعد توليده وأضفها ثم أعد المحاولة.
              </span>
              <span className="block mt-1 text-emerald-400/80">
                 توكن Graph API Explorer يعيش ساعتين فقط. لتجنّب انتهائه: بعد توليده اضغط <span dir="ltr">Open in Access Token Debugger</span> ثم <span dir="ltr">Extend Access Token</span> — فيصبح صالحاً ٦٠ يوماً.
              </span>
              <span className="block mt-1 text-amber-300/90">
                صفحة داخل Business Manager مش بتظهر؟ أضف صلاحية <span dir="ltr">business_management</span> معاهم — صفحات الأعمال (owned + client) تُطلب بعد كده تلقائياً.
              </span>
              <span className="block mt-1 text-amber-300/90">
                ولازم يكون <b>User Access Token</b> (من «Get User Access Token») مش توكن صفحة — توكن الصفحة بيشوف صفحة واحدة بس.
              </span>
            </p>

            {/* تنبيه صلاحية التوكن: ننبّه قبل الانتهاء بيومين — فلا يتوقف السحب فجأة */}
            {view.hasToken && Number(view.tokenExpiresAt) > 0 && (() => {
              const msLeft = Number(view.tokenExpiresAt) * 1000 - Date.now();
              const days = Math.ceil(msLeft / (24 * 60 * 60 * 1000));
              if (msLeft <= 0) {
                return (
                  <div className="mt-2 rounded-[var(--r-md)] px-3 py-2 text-[11px] font-bold bg-red-500/10 border border-red-400/30 text-red-300">
                    ⛔ انتهت صلاحية هذا التوكن — السحب متوقف حتى تولّد توكن جديداً وتلصقه هنا.
                  </div>
                );
              }
              if (msLeft <= 2 * 24 * 60 * 60 * 1000) {
                return (
                  <div className="mt-2 rounded-[var(--r-md)] px-3 py-2 text-[11px] font-bold bg-amber-500/10 border border-amber-400/30 text-amber-300">
                    ⏰ التوكن ينتهي خلال {days <= 1 ? 'أقل من يوم' : `${days} أيام`} — ولّد توكن جديداً الآن (من Graph API Explorer مع صلاحياته الخمس) قبل أن يتوقف السحب تلقائياً.
                  </div>
                );
              }
              return (
                <p className="mt-2 text-[11px] text-emerald-400/75">
                  ✓ التوكن محفوظ — صالح حتى {new Date(Number(view.tokenExpiresAt) * 1000).toLocaleDateString('ar-EG')}. سيصلك تنبيه قبل انتهائه بيومين.
                </p>
              );
            })()}
          </div>

          {/* تشخيص الاستكشاف: يبيّن منين جت الصفحات وإيه اللي فشل بالضبط
              — بدل ما صفحة تختفي بصمت ويقول المستخدم «مطلع صفحة واحدة». */}
          {(pageSources.length > 0 || tokenKind) && (
            <div className="rounded-[var(--r-md)] border border-[var(--border)] bg-[var(--tint-1)] px-3 py-2.5 space-y-1.5">
              <p className="text-[11px] font-bold text-[var(--text)]">مصادر الصفحات في آخر استكشاف</p>
              {tokenKind === 'PAGE' && (
                <p className="text-[11px] text-amber-300 leading-relaxed">
                  ⚠️ التوكن الحالي <b>Page Token</b> — يشوف صفحة واحدة فقط ولا يعرف بقية صفحات حسابك. ولّد User Access Token وأعد الاستكشاف.
                </p>
              )}
              {pageSources.map((source: any) => (
                <p key={source.name} className="text-[11px] leading-relaxed">
                  <span className={source.ok ? 'text-emerald-300' : 'text-amber-300'}>{source.ok ? '✓' : '✗'}</span>{' '}
                  <span className="text-[var(--text)] font-bold">{source.name}</span>
                  {source.ok ? (
                    <span className="text-[var(--text-dim)]"> — {Number(source.count) || 0} صفحة</span>
                  ) : (
                    <span className="text-[var(--text-dim)]"> — {source.hint || source.error || 'فشل الطلب'}</span>
                  )}
                </p>
              ))}
              <p className="text-[10.5px] text-[var(--text-dim)] leading-relaxed">
                لو صفحة أدمن مش ظاهرة في المصدرين: تأكد أنك أدمن عليها فعلاً من إعدادات الصفحة، وأن التوكن مولّد على نفس الحساب.
              </p>
            </div>
          )}

          {pageOptions.length > 0 && (
            <div>
              <label className="block text-xs text-[var(--text)] mb-1">صفحاتك — اضغط الصفحة لعرض نماذجها</label>
              <div className="space-y-1.5">
                {pageOptions.map((page: any) => (
                  <button
                    key={page.id}
                    onClick={() => loadForms(page.id)}
                    disabled={busy !== ''}
                    className="w-full text-right bg-[var(--tint-1)] border border-[var(--border)] rounded-[var(--r-md)] px-4 py-2.5 text-sm text-[var(--text-strong)] hover:bg-[var(--tint-2)] transition-colors disabled:opacity-60"
                  >
                    <span className="font-bold">{page.name}</span>
                    <span className="block text-[10px] text-[var(--text-dim)]" dir="ltr">ID: {page.id}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {forms.length > 0 && (
            <div>
              <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
                <label className="block text-xs text-[var(--text)]">
                  النماذج التي تُسحب منها الأرقام — السحب يعمل من كل المحدد في نفس الوقت
                  <span className="text-[var(--brand)] font-bold"> (مختار {selectedCount})</span>
                </label>
                <div className="flex gap-1.5">
                  <button
                    type="button"
                    onClick={() => setSelected(Object.fromEntries(forms.map((f: any) => [f.id, true])))}
                    className="text-[10px] font-bold px-2.5 py-1 rounded-[var(--r-xs)] border border-[var(--border)] bg-[var(--tint-1)] text-[var(--text-muted)] hover:bg-[var(--tint-2)] transition-colors"
                  >
                    تحديد الكل
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelected({})}
                    className="text-[10px] font-bold px-2.5 py-1 rounded-[var(--r-xs)] border border-[var(--border)] bg-[var(--tint-1)] text-[var(--text-muted)] hover:bg-[var(--tint-2)] transition-colors"
                  >
                    إلغاء الكل
                  </button>
                </div>
              </div>
              <div className="space-y-1.5">
                {forms.map((f: any) => {
                  const checked = !!selected[f.id];
                  return (
                    <button
                      key={f.id}
                      onClick={() => setSelected({ ...selected, [f.id]: !checked })}
                      className={`w-full text-right rounded-[var(--r-md)] px-4 py-2.5 text-sm border transition-colors ${
                        checked ? 'bg-emerald-500/15 border-emerald-400/40 text-emerald-200' : 'bg-[var(--tint-1)] border-[var(--border)] text-[var(--text)]'
                      }`}
                    >
                      <span className="font-bold">{checked ? '✓ ' : ''}{f.name}</span>
                      <span className="block text-[10px] text-[var(--text-dim)]">
                        {Number.isFinite(f.leadsCount) ? `${f.leadsCount} رقم مسجل حتى الآن` : 'نموذج مضاف يدوياً'}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* إضافة نموذج بمعرّفه: يعمل حتى لو منع فيسبوك عرض قائمة النماذج */}
          <div className="border border-[var(--border)] rounded-[var(--r-md)] p-3 space-y-2">
            <label className="block text-xs text-[var(--text)]">أو أضف نموذجاً أو أكثر بمعرّفه فقط (Form ID)</label>
            <p className="text-[11px] text-[var(--text-dim)]">
              لو معاك Form ID ومش عايز تستكشف الصفحات: الصق توكن فيسبوك في الأعلى، واكتب معرّف النموذج هنا.
              تقدر تلصق <span className="text-[var(--text)] font-bold">عدة معرّفات معاً</span> (كل واحد في سطر أو مفصولين بفاصلة)
              والسحب يشتغل من كلهم في نفس الوقت. السحب يتم مباشرة من{' '}
              <span dir="ltr">/{'{'}form-id{'}'}/leads</span> — الصفحة مش مطلوبة.
              تقدر تلاقي الرقم في رابط الفورم داخل Meta Business Suite (id أو asset_id).
            </p>
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                dir="ltr"
                value={manual.formId}
                onChange={(e) => setManual({ ...manual, formId: e.target.value })}
                placeholder="معرّف أو أكثر — مثال 123456789012345, 987654321098765"
                className="flex-1 bg-[var(--tint-1)] border border-[var(--border)] rounded-[var(--r-md)] px-4 py-2.5 text-[var(--text-strong)] text-sm"
              />
              {pageOptions.length > 1 && (
                <select
                  value={manual.pageId || pageOptions[0]?.id || ''}
                  onChange={(e) => setManual({ ...manual, pageId: e.target.value })}
                  className="bg-[var(--tint-1)] border border-[var(--border)] rounded-[var(--r-md)] px-3 py-2.5 text-[var(--text-strong)] text-xs"
                >
                  {pageOptions.map((p: any) => (
                    <option key={p.id} value={p.id} className="bg-slate-900">
                      {p.name}
                    </option>
                  ))}
                </select>
              )}
              <button
                onClick={addManualForm}
                disabled={busy !== ''}
                className="gradient-primary text-[var(--text-strong)] px-4 py-2.5 rounded-[var(--r-md)] font-bold text-xs disabled:opacity-50 whitespace-nowrap"
              >
                أضف النموذج
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="grid sm:grid-cols-2 gap-3 mt-4">
        <div>
          <label className="block text-xs text-[var(--text)] mb-1">كل كم دقيقة يسحب؟</label>
          <input
            type="number"
            min={1}
            max={1440}
            value={form.intervalMinutes}
            onChange={(e) => setForm({ ...form, intervalMinutes: Number(e.target.value) })}
            className="w-full bg-[var(--tint-1)] border border-[var(--border)] rounded-[var(--r-md)] px-4 py-3 text-[var(--text-strong)] text-sm"
          />
        </div>
        <div className="rounded-[var(--r-md)] bg-[var(--tint-1)] border border-[var(--border)] p-3 text-xs">
          <p className="text-[var(--text-muted)] mb-1">آخر عملية سحب:</p>
          {!last && <p className="text-[var(--text-dim)]">لم تحدث بعد</p>}
          {last?.ok && (
            <p className="text-emerald-300">
              دخل {last.added} رقم — مكرر {last.duplicates} — غير صالح {last.invalid}
              <span className="block text-[var(--text-dim)] mt-0.5">{formatDateTime(last.at)}</span>
            </p>
          )}
          {last?.ok && Array.isArray(last.rejected) && last.rejected.length > 0 && (
            <div className="mt-2 rounded-[var(--r-sm)] bg-[var(--tint-1)] border border-[var(--border)] p-2">
              <p className="text-[var(--text-muted)] mb-1">أرقام لم تُضف (السبب):</p>
              <ul className="space-y-0.5">
                {last.rejected.slice(0, 12).map((r: any, index: number) => (
                  <li key={`${r.phone}-${index}`} className="text-[var(--text-dim)]" dir="ltr">
                    {r.phone || 'بدون رقم'}
                    <span className="mx-1">—</span>
                    {r.reason === 'duplicate' ? 'مكرر في النظام' : r.reason === 'invalid' ? 'رقم غير صالح' : 'تجاوز حد الدفعة'}
                    {r.name ? ` (${r.name})` : ''}
                  </li>
                ))}
              </ul>
              {last.rejected.length > 12 && (
                <p className="text-[var(--text-dim)] mt-1">+{last.rejected.length - 12} أخرى</p>
              )}
            </div>
          )}
          {last && !last.ok && <p className="text-red-400">{last.error}</p>}
        </div>
      </div>

      <div className="mt-4 rounded-[var(--r-md)] px-4 py-3 text-xs border bg-emerald-500/10 border-emerald-400/30 text-emerald-200">
        <span className="font-bold">التوزيع يدوي بالكامل — مفيش توزيع تلقائي</span>
        <span className="block text-[11px] text-[var(--text-dim)] mt-0.5">
          كل رقم جديد يدخل «غير مخصص» ويستنى في «توزيع الأرقام» لحد ما توزعه بنفسك على اللي تختاره.
        </span>
      </div>

      <button
        onClick={() => save({ acceptTestLeads: config.acceptTestLeads === false }, config.acceptTestLeads === false ? 'سيقبل النظام الأرقام التجريبية ✓' : 'سيتم تجاهل الأرقام التجريبية')}
        disabled={busy !== ''}
        className={`w-full mt-4 text-right rounded-[var(--r-md)] px-4 py-3 text-xs border transition-colors ${
          config.acceptTestLeads !== false ? 'bg-emerald-500/10 border-emerald-400/30 text-emerald-200' : 'bg-[var(--tint-1)] border-[var(--border)] text-[var(--text-muted)]'
        }`}
      >
        <span className="font-bold">{config.acceptTestLeads !== false ? '☑' : '☐'} قبول الأرقام التجريبية من أداة اختبار ميتا</span>
        <span className="block text-[11px] text-[var(--text-dim)] mt-0.5">
          أداة «Create test lead» في ميتا تُنشئ أرقاماً وهمية للتجربة. عند التفعيل يدخلها النظام برقم صالح موسوم «🧪 تجريبي» — وعند الإيقاف تُتجاهل.
        </span>
      </button>

      <div className="flex flex-col sm:flex-row gap-3 mt-4">
        <button onClick={saveSettings} disabled={busy !== ''} className="flex-1 gradient-primary text-[var(--text-strong)] py-3 rounded-[var(--r-md)] font-bold text-sm disabled:opacity-60">
          حفظ الإعدادات
        </button>
        <button onClick={runNow} disabled={busy !== ''} className="flex-1 bg-[var(--brand-primary-softer)] border border-[var(--brand-primary-soft)] text-[var(--brand)] py-3 rounded-[var(--r-md)] font-bold text-sm hover:bg-[var(--brand-primary-soft)] transition-colors disabled:opacity-60">
          {busy === 'run' ? 'جارٍ السحب...' : 'جلب الأرقام الآن (تجربة)'}
        </button>
      </div>

      {/* أرقام كامبين ناقصة؟ هذا الزر يقرأ كل تاريخ النماذج المختارة من جديد */}
      <button
        onClick={resetAndPull}
        disabled={busy !== ''}
        className="w-full mt-2 bg-amber-500/10 border border-amber-400/30 text-amber-200 py-2.5 rounded-[var(--r-md)] font-bold text-xs hover:bg-amber-500/20 transition-colors disabled:opacity-60"
      >
        {busy === 'reset' ? 'جارٍ إعادة السحب...' : 'إعادة سحب كل الأرقام من البداية (لاسترجاع المفقود)'}
      </button>

      {notice && <p className="text-xs text-amber-300 mt-3 whitespace-pre-line leading-relaxed">{notice}</p>}
    </div>
  );
}

// ===== المظهر: وضعان فقط (ليلي / نهاري) =====
// الوضع يُحفظ على كل جهاز، ويُطبّق بسمة واحدة على <html> فتبدّل كل ألوان الموقع من ملف الأنماط.
type AppMode = 'dark' | 'light';

const MODE_KEY = 'crm_mode';
const MODE_META: Record<AppMode, string> = { dark: '#0b1220', light: '#f7f9fc' };

const readMode = (): AppMode => {
  try {
    const saved = localStorage.getItem(MODE_KEY);
    if (saved === 'light' || saved === 'dark') return saved;
  } catch {}
  return typeof document !== 'undefined' && document.documentElement.dataset.mode === 'light' ? 'light' : 'dark';
};

const applyMode = (mode: AppMode) => {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.mode = mode;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', MODE_META[mode]);
  // أعد تطبيق ألوان المستخدم بعد تبديل الوضع (لكل وضع درجات مختلفة)
  reapplyCurrentTheme();
};

// يطبّق الوضع و يحفظه، ويُبلّغ بقية المكوّنات (زر المظهر في الإعدادات أيضاً) فيبقى الزران متزامنين
const setMode = (mode: AppMode) => {
  try {
    localStorage.setItem(MODE_KEY, mode);
  } catch {}
  applyMode(mode);
  window.dispatchEvent(new Event('crm-mode-change'));
};

// يقرأ الوضع الحالي ويبقى متزامناً مع أي تغيير يحدث في أي مكان بالصفحة
function useAppMode() {
  const [mode, setLocalMode] = useState<AppMode>(readMode);
  useEffect(() => {
    const onChange = () => setLocalMode(readMode());
    window.addEventListener('crm-mode-change', onChange);
    return () => window.removeEventListener('crm-mode-change', onChange);
  }, []);
  return [mode, setMode] as const;
}


// زر تبديل المظهر (ليلي / نهاري) — في الشريط العلوي وفي الإعدادات
function ModeToggle({ withLabels = true }: { withLabels?: boolean }) {
  const [mode, changeMode] = useAppMode();
  return (
    <div className="mode-toggle" role="group" aria-label="وضع المظهر">
      <button
        type="button"
        onClick={() => changeMode('dark')}
        className={mode === 'dark' ? 'active' : ''}
        title="الوضع الليلي"
      >
        <Moon className="w-4 h-4" />
        {withLabels && <span>ليلي</span>}
      </button>
      <button
        type="button"
        onClick={() => changeMode('light')}
        className={mode === 'light' ? 'active' : ''}
        title="الوضع النهاري"
      >
        <Sun className="w-4 h-4" />
        {withLabels && <span>نهاري</span>}
      </button>
    </div>
  );
}

// زر أيقونة واحد لتبديل المظهر — في الشريط العلوي (ظاهر على كل المقاسات)
function ModeIconButton() {
  const [mode, changeMode] = useAppMode();
  const next = mode === 'dark' ? 'light' : 'dark';
  return (
    <motion.button
      whileHover={{ scale: 1.08 }}
      whileTap={{ scale: 0.92 }}
      onClick={() => changeMode(next)}
      className="icon-btn mode-icon-btn"
      title={next === 'light' ? 'التحويل للوضع النهاري ' : 'التحويل للوضع الليلي '}
      aria-label={next === 'light' ? 'الوضع النهاري' : 'الوضع الليلي'}
    >
      {mode === 'dark' ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
    </motion.button>
  );
}

// إعدادات المظهر — داخل تبويب الإعدادات بالكامل
function AppearanceSettings({ userId }: { userId?: string }) {
  const [mode] = useAppMode();

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-4">
        <ModeToggle />
        <p className="text-xs text-[var(--text-muted)] leading-relaxed">
          الوضع الحالي:{' '}
          <span className="font-bold text-[var(--text)]">{mode === 'dark' ? 'ليلي ' : 'نهاري '}</span>
          {' '}— لكل موظف أن يختار ما يريح عينه، والاختيار يُحفظ على جهازه وحده.
        </p>
      </div>

      {/* نفس بكرة الألوان اللي في الشريط العلوي — ظاهرة هنا كمان عشان تبقى سهلة الوصول */}
      <div className="rounded-[var(--r-md)] border border-[var(--border)] bg-[var(--tint-1)] p-4">
        <ThemeSettingsPanel userId={userId} />
      </div>
    </div>
  );
}

// الإعدادات: مكان واحد لإعدادات النظام فقط (الألوان + النسخة الاحتياطية).
// إدارة الحسابات انتقلت كلها إلى تبويب «فريق العمل» حتى لا يتكرر نفس الشغل في مكانين.
// وشيت أرقام الكامبين انتقل إلى تبويب مستقل باسم «شيت الفورمات».
function AdminSettingsView({ currentUser }: { currentUser?: User }) {
  const handleExportData = () => {
    const data = {
      clients: JSON.parse(localStorage.getItem('crm_clients') || '[]'),
      reminders: JSON.parse(localStorage.getItem('crm_reminders') || '[]'),
      properties: JSON.parse(localStorage.getItem('crm_properties') || '[]'),
      feedbacks: JSON.parse(localStorage.getItem('crm_daily_feedback') || '[]'),
      users: JSON.parse(localStorage.getItem('crm_users') || '[]'),
      teams: JSON.parse(localStorage.getItem('crm_teams') || '[]'),
      exportDate: new Date().toISOString(),
    };
    
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `crm-backup-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
  };
  
  return (
    <div className="space-y-6">
      <div className="page-intro"><div><h2>الإعدادات</h2></div></div>

      {/* سحب الأرقام من كامبينات فيسبوك وإنستجرام انتقل إلى «فريق العمل»:
          تبويبان مستقلان لكل قناة (توكنها ونماذجها ومؤشرها) بجوار حسابات الفريق. */}
      <div className="panel p-5">
        <h3 className="text-sm font-bold text-[var(--text-strong)] mb-1 flex items-center gap-2">
          <Zap className="w-4 h-4 text-amber-400" /> سحب أرقام الكامبينات
        </h3>
        <p className="text-xs text-[var(--text-muted)] leading-relaxed">
          إعداد كامبينات فيسبوك وإنستجرام انتقل إلى تبويب «فريق العمل» ← تبويب «فيسبوك» أو «إنستجرام».
          من هناك تضع التوكن، تختار النماذج، وتشغّل السحب التلقائي لكل قناة على حدة.
        </p>
      </div>

      {/* المظهر: الوضع الليلي / النهاري */}
      <div className="panel p-6">
        <h3 className="text-lg font-bold text-[var(--text-strong)] mb-1 flex items-center gap-2">
          <Moon className="w-5 h-5 text-[var(--text-muted)]" /> مظهر الموقع
        </h3>
        <p className="text-xs text-[var(--text-muted)] mb-4">
          اختر الوضع الذي يريحك: ليلي هادئ للإضاءة المنخفضة، أو نهاري مريح للضوء القوي. التغيير فوري ويُحفظ على هذا الجهاز.
        </p>
        <AppearanceSettings userId={currentUser?.id} />
      </div>

      <div className="glass-card rounded-[var(--r-md)] p-6">
        <h3 className="text-lg font-bold text-[var(--text-strong)] mb-2">النسخ الاحتياطي</h3>
        <p className="text-xs text-[var(--text-muted)] mb-4">نزّل نسخة من كل البيانات (عملاء، عقارات، حسابات، حضور).</p>
        <button onClick={handleExportData} className="w-full gradient-primary text-[var(--text-strong)] py-3 rounded-[var(--r-md)] font-bold">
          تصدير البيانات
        </button>
      </div>
    </div>
  );
}

// Status Badge
function StatusBadge({ status }: { status: Client['status'] }) {
  const config = {
    campaign: { label: 'كامبين', className: 'bg-[var(--brand-primary-softer)] text-[var(--text-muted)]' },
    facebook: { label: 'فيسبوك', className: 'bg-[var(--brand-primary-softer)] text-[var(--brand)]' },
    external: { label: 'خارجي', className: 'bg-emerald-500/20 text-emerald-400' },
  };
  
  const { label, className } = config[status];
  return <span className={`text-xs px-2.5 py-1 rounded-full ${className}`}>{label}</span>;
}

// Modal Components (simplified)
function AddClientModal({ currentUser, users, onClose, onSuccess, preset }: any) {
  // حساب «المطوّر» إداري في القاعدة لكنه يعمل سيلزاً — فالعميل يُسجّل باسمه هو،
  // بلا قائمة اختيار مندوب (كانت تطلب منه اختيار سيلز قبل الحفظ).
  // الإداري الذي يعمل سيلزاً (المطوّر/فريدة) يسجّل العميل باسمه هو بلا قائمة مندوبين
  const isAdmin = currentUser?.role !== 'sales' && !worksAsSales(currentUser);
  // ===== نموذج مبسّط للإدارة =====
  // الإدارة بتضيف عميل بالاسم والرقم بس — حقول السيلز (الفيدباك وحالة المتابعة
  // والتذكير وسبب الإلغاء) ما بتفرقش معاها، فبتتخفي والنموذج يبقى بسيط.
  const simple = isAdmin;
  // المدير يضيف العميل لمندوب بعينه حتى يظهر للفريق (الإدارة مالها تبويب عملاء خاص)
  const reps = (users || []).filter((u: User) => ['sales', 'supervisor'].includes(effectiveRoleOf(u)));
  const [form, setForm] = useState<{
    name: string; phone: string; phones: string[]; property: string; budget: string;
    monthlyInstallment: string; deliveryPeriod: string; status: 'campaign' | 'facebook' | 'external';
    stage: 'new' | 'contacted' | 'meeting' | 'negotiation' | 'closed' | 'lost';
    feedback: string; feedbackStatus: string; cancelReason: string; reminderAt: string;
    priority: 'high' | 'medium' | 'low'; source: string; ownerId: string;
  }>({
    name: '', phone: '', phones: [] as string[], property: '', budget: '', monthlyInstallment: '', deliveryPeriod: '',
    status: 'campaign', stage: 'new', feedback: '', feedbackStatus: 'follow-up', cancelReason: '',
    // الإدارة (النموذج المبسّط): بلا تذكير تلقائي — التذكير مهمة السيلز
    reminderAt: simple ? '' : nextReminderInput(),
    priority: 'medium', source: '',
    // الإدارة تسجّل العميل باسمها افتراضياً (اختيار مندوب اختياري)
    ownerId: simple ? String(currentUser?.id || '') : '',
    // قيم جاهزة من نقطة الفتح (مثل «عملاء كامبين» ⇒ المصدر «كامبين» فيظهر في تبويبهم)
    ...(preset || {}),
  });
  const [newPhone, setNewPhone] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  // معرّف العميل بعد حفظه محلياً: لو فشل الوصول لقاعدة البيانات نعيد المحاولة
  // على نفس السجل بدل إنشاء نسخة مكرّرة.
  const [createdId, setCreatedId] = useState('');
  
  const addPhone = () => {
    if (newPhone && !form.phones.includes(newPhone)) {
      setForm({ ...form, phones: [...form.phones, newPhone] });
      setNewPhone('');
    }
  };
  
  const removePhone = (phone: string) => {
    setForm({ ...form, phones: form.phones.filter(p => p !== phone) });
  };
  
  // ===== الحفظ: العميل + الفيدباك + التذكير في خطوة واحدة، ثم رفعهم لقاعدة البيانات =====
  // الحفظ المحلي وحده كان يجعل العميل/الفيدباك موجودين على هذا الجهاز فقط،
  // فلا يراه صاحب العميل ولا الإدارة ولا التذكيرات — وهذا هو سبب إحساس
  // «الميزة مش شغّالة». هنا تُكتب البطاقات فعلاً ويُتحقق من وصولها للسيرفر.
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    setError('');
    const owner = isAdmin ? form.ownerId.trim() : currentUser.id;
    if (!owner) {
      setError('اختر السيلز المسؤول عن العميل أولاً');
      return;
    }
    // ===== رقم واحد = مالك واحد =====
    // لو الرقم ده عميل عند مندوب تاني، ما يتسجّلش عند اتنين.
    // ولو الرقم موزّع (في عهدة مندوب تاني) ما ينفعش يتحوّل لعميل عند غيره.
    const phoneKey = phoneKeyOf(form.phone);
    if (phoneKey) {
      const clientOwner = ownerOfPhoneOnServer(phoneKey);
      if (clientOwner && clientOwner.ownerId && clientOwner.ownerId !== owner) {
        setError(`الرقم ده مسجّل بالفعل عند ${clientOwner.ownerName} — الرقم ما يتسجّلش عند اتنين.`);
        return;
      }
      const leadOwner = leadOwnerOfPhoneOnServer(phoneKey);
      if (leadOwner && leadOwner.ownerId && leadOwner.ownerId !== owner) {
        setError(`الرقم ده موزّع على ${leadOwner.ownerName} — سيبه له أو رجّعه للتوزيع الأول.`);
        return;
      }
    }
    // إلغاء بلا سبب لا يُحفظ — السبب هو الذي يكتب الكومنت ويُحفظ للفلترة
    if (form.feedbackStatus === 'cancellation' && !form.cancelReason) {
      setError('اختر سبب الإلغاء أولاً');
      return;
    }
    const comment = form.feedback.trim();
    setSaving(true);
    try {
      const now = new Date().toISOString();
      const existing: Client[] = JSON.parse(localStorage.getItem('crm_clients') || '[]');
      const alreadySaved = !!createdId && existing.some((c) => c.id === createdId);

      if (!alreadySaved) {
        const { ownerId, feedbackStatus, reminderAt, cancelReason, ...rest } = form;
        const newClient: Client = {
          ...rest,
          id: crypto.randomUUID(),
          userId: owner,
          assignedTo: owner,
          createdAt: now,
          updatedAt: now,
          activities: [{ id: crypto.randomUUID(), type: 'created', text: 'تمت إضافة العميل', at: now, by: currentUser?.name || '' }],
        } as Client;
        localStorage.setItem('crm_clients', JSON.stringify([newClient, ...existing]));
        setCreatedId(newClient.id);

        // الفيدباك الأول: يُصبح بطاقة في «الفيدباك اليومي» باسم كاتبه + حدثاً في خط العميل.
        // ولو مافيش كومنت مكتوب: تُنشأ بطاقة «مرحلة جديدة» باسم صاحب العميل،
        // فالعميل الجديد يظهر في تبويب الفيدباك مباشرة بلا خطوة يدوية.
        if (comment) {
          addClientActivity(newClient.id, 'feedback', comment, currentUser?.name || '', {
            authorId: currentUser.id,
            status: feedbackStatus,
            ...(feedbackStatus === 'cancellation' && cancelReason ? { cancelReason } : {}),
            callStatus: feedbackStatus === 'no-answer' ? 'no-answer' : 'called',
          });
        } else {
          addClientActivity(newClient.id, 'feedback', NEW_CLIENT_FEEDBACK, currentUser?.name || '', {
            skipCard: true,
            status: 'fresh-stage',
            callStatus: 'not-called',
          });
          const allFeedbacks: DailyFeedback[] = JSON.parse(localStorage.getItem('crm_daily_feedback') || '[]');
          const card: DailyFeedback = {
            id: crypto.randomUUID(),
            userId: owner,
            clientPhone: newClient.phone,
            clientName: newClient.name,
            date: now,
            feedback: NEW_CLIENT_FEEDBACK,
            callStatus: 'not-called',
            status: 'fresh-stage',
            createdAt: now,
          };
          localStorage.setItem('crm_daily_feedback', JSON.stringify([card, ...allFeedbacks]));
        }

        // التذكير: ينزل في تبويب التذكيرات عند صاحب العميل مباشرة
        if (reminderAt) {
          const allReminders: Reminder[] = JSON.parse(localStorage.getItem('crm_reminders') || '[]');
          const reminder: Reminder = {
            id: crypto.randomUUID(),
            userId: owner,
            clientId: newClient.id,
            clientName: newClient.name,
            clientPhone: newClient.phone,
            dateTime: new Date(reminderAt).toISOString(),
            note: comment ? `متابعة العميل الجديد: ${comment}` : 'متابعة العميل الجديد',
            isCompleted: false,
            isDelayed: false,
            delayCount: 0,
            createdAt: now,
          };
          localStorage.setItem('crm_reminders', JSON.stringify([reminder, ...allReminders]));
        }
      }

      // الرفع: كل مفتاح على حدة حتى نعرف أي جزء لم يصل للقاعدة
      const [clientsOk, remindersOk, feedbackOk] = await Promise.all([
        pushKey('crm_clients'),
        form.reminderAt ? pushKey('crm_reminders') : Promise.resolve(true),
        // بطاقة الفيدباك تُنشأ دائماً (كومنت مكتوب أو «مرحلة جديدة» تلقائياً)
        pushKey('crm_daily_feedback'),
      ]);
      onSuccess();
      if (clientsOk && remindersOk && feedbackOk) {
        onClose();
        return;
      }
      setError('العميل اتسجل على الشاشة دي لكن ماوصلش لقاعدة البيانات — تأكد من الاتصال واضغط «إعادة المحاولة» لرفعه.');
    } catch {
      setError('تعذّر حفظ العميل — حاول مرة أخرى');
    } finally {
      setSaving(false);
    }
  };
  
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80" onClick={onClose}>
      <motion.div initial={{ scale: 0.9 }} animate={{ scale: 1 }} exit={{ scale: 0.9 }} className="panel p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-3 mb-6">
          <div className="page-intro"><div><h2>إضافة عميل جديد</h2></div></div>
          <button type="button" onClick={onClose} title="إغلاق"
            className="p-2 rounded-[var(--r-sm)] bg-[var(--tint-1)] hover:bg-[var(--tint-3)] transition-colors shrink-0">
            <X className="w-4 h-4 text-[var(--text)]" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          {isAdmin && (
            <select value={form.ownerId} onChange={(e) => setForm({ ...form, ownerId: e.target.value })}
              className="w-full bg-[var(--tint-1)] border border-[var(--brand-primary-soft)] rounded-[var(--r-md)] px-4 py-3 text-[var(--text-strong)]" required>
              <option value={String(currentUser?.id || '')} className="bg-gray-900">👤 الإدارة (أنا)</option>
              {reps.map((u: User) => (
                <option key={u.id} value={u.id} className="bg-gray-900">{u.name}</option>
              ))}
            </select>
          )}
          <input type="text" placeholder="الاسم *" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full bg-[var(--tint-1)] border border-[var(--border)] rounded-[var(--r-md)] px-4 py-3 text-[var(--text-strong)]" required />
          <input type="tel" placeholder="رقم الهاتف الرئيسي *" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="w-full bg-[var(--tint-1)] border border-[var(--border)] rounded-[var(--r-md)] px-4 py-3 text-[var(--text-strong)]" dir="ltr" required />
          {simple && (
            <p className="text-[11px] text-[var(--text-dim)] -mt-1">
              النموذج مبسّط للإدارة: اسم + رقم. متابعة العميل وفيدباكه وتذكيره من شغل السيلز.
            </p>
          )}

          {!simple && (
          <>
          <div>
            <label className="block text-sm text-[var(--text)] mb-2">أرقام إضافية</label>
            <div className="flex gap-2">
              <input type="tel" placeholder="رقم إضافي" value={newPhone} onChange={(e) => setNewPhone(e.target.value)} className="flex-1 bg-[var(--tint-1)] border border-[var(--border)] rounded-[var(--r-md)] px-4 py-3 text-[var(--text-strong)]" dir="ltr" />
              <button type="button" onClick={addPhone} className="gradient-primary text-[var(--text-strong)] px-4 py-3 rounded-[var(--r-md)] font-bold">
                <Plus className="w-5 h-5" />
              </button>
            </div>
            {form.phones.length > 0 && (
              <div className="mt-2 space-y-2">
                {form.phones.map((phone, index) => (
                  <div key={index} className="flex items-center justify-between bg-[var(--tint-1)] rounded-[var(--r-sm)] px-3 py-2">
                    <span className="text-[var(--text-strong)] text-sm" dir="ltr">{phone}</span>
                    <button type="button" onClick={() => removePhone(phone)} className="p-1 hover:bg-red-500/20 rounded">
                      <X className="w-4 h-4 text-red-400" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
          
          <input type="text" placeholder="العقار" value={form.property} onChange={(e) => setForm({ ...form, property: e.target.value })} className="w-full bg-[var(--tint-1)] border border-[var(--border)] rounded-[var(--r-md)] px-4 py-3 text-[var(--text-strong)]" />
          <input type="text" placeholder="الميزانية (مثال: 2 مليون أو 2,000,000)" value={form.budget} onChange={(e) => setForm({ ...form, budget: e.target.value })} className="w-full bg-[var(--tint-1)] border border-[var(--border)] rounded-[var(--r-md)] px-4 py-3 text-[var(--text-strong)]" />
          {form.budget && parsePrice(form.budget) > 0 && (
            <p className="text-xs text-[var(--text)] -mt-2">= {formatPrice(form.budget)} ج.م</p>
          )}
          <input type="text" placeholder="القسط الشهري" value={form.monthlyInstallment} onChange={(e) => setForm({ ...form, monthlyInstallment: e.target.value })} className="w-full bg-[var(--tint-1)] border border-[var(--border)] rounded-[var(--r-md)] px-4 py-3 text-[var(--text-strong)]" />
          <input type="text" placeholder="مدة الاستلام" value={form.deliveryPeriod} onChange={(e) => setForm({ ...form, deliveryPeriod: e.target.value })} className="w-full bg-[var(--tint-1)] border border-[var(--border)] rounded-[var(--r-md)] px-4 py-3 text-[var(--text-strong)]" />
          <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as Client['status'] })} className="w-full bg-[var(--tint-1)] border border-[var(--border)] rounded-[var(--r-md)] px-4 py-3 text-[var(--text-strong)]">
            <option value="campaign" className="bg-gray-900">كامبين</option>
            <option value="facebook" className="bg-gray-900">فيسبوك</option>
            <option value="external" className="bg-gray-900">خارجي</option>
          </select>
          <select value={form.stage} onChange={(e) => setForm({ ...form, stage: e.target.value as Client['stage'] })} className="w-full bg-[var(--tint-1)] border border-[var(--border)] rounded-[var(--r-md)] px-4 py-3 text-[var(--text-strong)]">
            <option value="new" className="bg-gray-900">جديد</option>
            <option value="contacted" className="bg-gray-900">تم التواصل</option>
            <option value="meeting" className="bg-gray-900">موعد معاينة</option>
            <option value="negotiation" className="bg-gray-900">تفاوض</option>
            <option value="closed" className="bg-gray-900">تم البيع</option>
            <option value="lost" className="bg-gray-900">ضائع</option>
          </select>
          {/* فيدباك أول للعميل: حالة + كومنت — ينزل في تبويب «الفيدباك» فوراً */}
          <div className="rounded-[var(--r-md)] border border-[var(--border)] bg-[var(--tint-1)] p-3.5 space-y-3">
            <div>
              <label className="block text-xs font-bold text-[var(--text)] mb-1.5">أول فيدباك للعميل (حالة + كومنت)</label>
              <StatusMenu
                value={form.feedbackStatus}
                label="اختر حالة الفيدباك"
                stopPropagation={false}
                onPick={(optionId: string) =>
                  setForm({
                    ...form,
                    feedbackStatus: optionId,
                    cancelReason: '',
                    // المرحلة تتحرّك مع الحالة المختارة، فيظهر العميل في مكانه الصحيح
                    ...(FEEDBACK_STATUS_BY_ID[optionId]?.stage ? { stage: FEEDBACK_STATUS_BY_ID[optionId].stage } : {}),
                    ...(optionId === 'no-answer' && !form.feedback.trim()
                      ? { feedback: NO_ANSWER_COMMENT }
                      : optionId === 'cancellation'
                      ? { feedback: '' }
                      : {}),
                  })
                }
              />
              {form.feedbackStatus === 'cancellation' && (
                <div className="mt-2">
                  <CancelReasonPicker
                    value={form.cancelReason}
                    onChange={(reason) => setForm({ ...form, cancelReason: reason, feedback: reason ? cancelReasonLabelOf(reason) : '' })}
                  />
                </div>
              )}
            </div>
            <textarea placeholder="اكتب كومنت الفيدباك — ولو سيبته فاضي ينزل العميل في الفيدباك كـ«مرحلة جديدة لم يتم التواصل معه»"
              value={form.feedback} onChange={(e) => setForm({ ...form, feedback: e.target.value })}
              className="w-full bg-[var(--surface)] border border-[var(--border)] rounded-[var(--r-md)] px-4 py-3 text-[var(--text-strong)] resize-none h-20" />
            <div>
              <label className="block text-xs font-bold text-[var(--text)] mb-1.5">تذكير المتابعة</label>
              <input type="datetime-local" value={form.reminderAt} dir="ltr"
                onChange={(e) => setForm({ ...form, reminderAt: e.target.value })}
                className="w-full bg-[var(--surface)] border border-[var(--border)] rounded-[var(--r-md)] px-4 py-3 text-[var(--text-strong)]" />
              <p className="text-[11px] text-[var(--text-dim)] mt-1.5">
                ينزل مباشرة في تبويب «التذكيرات» عند السيلز المسؤول — افرغ الحقل لو ما تحبّش تذكير.
              </p>
            </div>
          </div>
          </>
          )}
          {error && <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/30 rounded-[var(--r-md)] px-3 py-2">{error}</p>}
          <button type="submit" disabled={saving || (form.feedbackStatus === 'cancellation' && !form.cancelReason)} className="w-full gradient-primary text-[var(--text-strong)] py-3 rounded-[var(--r-md)] font-bold disabled:opacity-60">
            {saving ? 'جارٍ الحفظ...' : createdId ? 'إعادة المحاولة' : 'إضافة'}
          </button>
        </form>
      </motion.div>
    </motion.div>
  );
}

function AddReminderModal({ clients, currentUser, onClose, onSuccess }: any) {
  const [form, setForm] = useState({ clientId: '', clientName: '', clientPhone: '', dateTime: '', note: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  // معرّف التذكير بعد حفظه محلياً: إعادة المحاولة ترفع نفس السجل بدل إنشاء نسخة مكررة
  const [createdId, setCreatedId] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    setError('');
    try {
      if (!createdId) {
        const reminders = JSON.parse(localStorage.getItem('crm_reminders') || '[]');
        const newReminder = { ...form, id: crypto.randomUUID(), userId: currentUser.id, isCompleted: false, isDelayed: false, delayCount: 0, createdAt: new Date().toISOString() };
        localStorage.setItem('crm_reminders', JSON.stringify([newReminder, ...reminders]));
        setCreatedId(newReminder.id);
        // ما بنكتبش لوج «تم إنشاء تذكير» في خط العميل:
        // التذكير نفسه في crm_reminders، والكومنتات بتعرض كلام السيلز فقط.
      }
      // لا نعتبر التذكير محفوظاً قبل وصوله للقاعدة: إشعار «الموقع مقفول» يرسله السيرفر من هناك
      const savedToDb = await pushKey('crm_reminders');
      if (!savedToDb) {
        // يظهر في القائمة محلياً رغم تعذّر الرفع، ويظل قابلاً لإعادة المحاولة بنفس السجل
        onSuccess();
        setError('التذكير اتسجل على الجهاز ده لكن ماوصلش لقاعدة البيانات — تأكد من الاتصال واضغط «إعادة المحاولة».');
        return;
      }
      onSuccess();
      onClose();
    } catch {
      setError('تعذّر حفظ التذكير — حاول مرة أخرى');
    } finally {
      setSaving(false);
    }
  };
  
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80" onClick={onClose}>
      <motion.div initial={{ scale: 0.9 }} animate={{ scale: 1 }} exit={{ scale: 0.9 }} className="panel p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-3 mb-6">
          <div className="page-intro"><div><h2>إضافة تذكير</h2></div></div>
          <button type="button" onClick={onClose} title="إغلاق"
            className="p-2 rounded-[var(--r-sm)] bg-[var(--tint-1)] hover:bg-[var(--tint-3)] transition-colors shrink-0">
            <X className="w-4 h-4 text-[var(--text)]" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* اختيار العميل من قائمة عملائك — يملأ الاسم والرقم تلقائياً (مثل التذكيرات والفيدباك) */}
          <select
            value={form.clientId}
            onChange={(e) => {
              const picked = clients.find((c: Client) => c.id === e.target.value);
              setForm(picked
                ? { ...form, clientId: picked.id, clientName: picked.name, clientPhone: picked.phone }
                : { ...form, clientId: '', clientName: '', clientPhone: '' });
            }}
            className="w-full bg-[var(--tint-1)] border border-[var(--border)] rounded-[var(--r-md)] px-4 py-3 text-[var(--text-strong)]"
          >
            <option value="" className="bg-gray-900"> اختر العميل من قائمة عملائك (اختياري)</option>
            {clients.map((c: Client) => (
              <option key={c.id} value={c.id} className="bg-gray-900">
                {c.name} — {c.phone}
              </option>
            ))}
          </select>
          <input type="text" placeholder="اسم العميل *" value={form.clientName} onChange={(e) => setForm({ ...form, clientName: e.target.value, clientId: '' })} className="w-full bg-[var(--tint-1)] border border-[var(--border)] rounded-[var(--r-md)] px-4 py-3 text-[var(--text-strong)]" required />
          <input type="tel" placeholder="رقم الهاتف *" value={form.clientPhone} onChange={(e) => setForm({ ...form, clientPhone: e.target.value, clientId: '' })} className="w-full bg-[var(--tint-1)] border border-[var(--border)] rounded-[var(--r-md)] px-4 py-3 text-[var(--text-strong)]" dir="ltr" required />
          <input type="datetime-local" value={form.dateTime} onChange={(e) => setForm({ ...form, dateTime: e.target.value })} className="w-full bg-[var(--tint-1)] border border-[var(--border)] rounded-[var(--r-md)] px-4 py-3 text-[var(--text-strong)]" dir="ltr" required />
          <textarea placeholder="ملاحظة" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} className="w-full bg-[var(--tint-1)] border border-[var(--border)] rounded-[var(--r-md)] px-4 py-3 text-[var(--text-strong)] resize-none h-20" />
          {error && <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/30 rounded-[var(--r-md)] px-3 py-2">{error}</p>}
          <button type="submit" disabled={saving} className="w-full gradient-primary text-[var(--text-strong)] py-3 rounded-[var(--r-md)] font-bold disabled:opacity-60">
            {saving ? 'جارٍ الحفظ...' : createdId ? 'إعادة المحاولة' : 'إضافة'}
          </button>
        </form>
      </motion.div>
    </motion.div>
  );
}

function AddPropertyModal({ clients, currentUser, onClose, onSuccess }: any) {
  const [form, setForm] = useState({ name: '', type: '', area: '', price: '', priceNumeric: 0, location: '', description: '', images: [] as string[], latitude: 0, longitude: 0, clientPhone: '', clientPhone2: '', clientName: '', project: '', compound: '', floor: '', rooms: '', bathrooms: '', finishing: 'fully-finished', delivery: 'immediate', scope: 'team' as 'team' | 'private' });
  const [imgBusy, setImgBusy] = useState(false);
  const [geoMsg, setGeoMsg] = useState('');
  
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const properties = JSON.parse(localStorage.getItem('crm_properties') || '[]');
    const newProperty = {
      ...form,
      priceNumeric: parsePrice(form.price),
      latitude: form.latitude || undefined,
      longitude: form.longitude || undefined,
      id: crypto.randomUUID(),
      userId: currentUser.id,
      createdAt: new Date().toISOString(),
    };
    localStorage.setItem('crm_properties', JSON.stringify([newProperty, ...properties]));
    onSuccess();
    onClose();
  };
  
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80" onClick={onClose}>
      <motion.div initial={{ scale: 0.9 }} animate={{ scale: 1 }} exit={{ scale: 0.9 }}        className="panel p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-3 mb-6">
          <div className="page-intro"><div><h2>إضافة عقار</h2></div></div>
          <button type="button" onClick={onClose} title="إغلاق"
            className="p-2 rounded-[var(--r-sm)] bg-[var(--tint-1)] hover:bg-[var(--tint-3)] transition-colors shrink-0">
            <X className="w-4 h-4 text-[var(--text)]" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <input type="text" placeholder="اسم العقار *" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full bg-[var(--tint-1)] border border-[var(--border)] rounded-[var(--r-md)] px-4 py-3 text-[var(--text-strong)]" required />

          {/* بند ٣: نطاق العقار — لكل الفريق ولا خاص بيك */}
          <div>
            <label className="block text-xs font-bold text-[var(--text)] mb-1.5">مين يشوف العقار؟</label>
            <div className="seg-bar">
              <button type="button" className={`seg-item${form.scope === 'team' ? ' on' : ''}`}
                onClick={() => setForm({ ...form, scope: 'team' })}>
                <Globe className="w-4 h-4" /> عقار الفريق
              </button>
              <button type="button" className={`seg-item${form.scope === 'private' ? ' on' : ''}`}
                onClick={() => setForm({ ...form, scope: 'private' })}>
                <Shield className="w-4 h-4" /> خاص بيك
              </button>
            </div>
            <p className="text-[11px] text-[var(--text-dim)] mt-1.5">
              {form.scope === 'private'
                ? 'يظهر لك وحدك، والإدارة تشوفه للمتابعة — مش بيظهر لباقي المناديب.'
                : 'يظهر لكل مناديب الفريق في تبويب عقارات الفريق.'}
            </p>
          </div>
          <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} className="w-full bg-[var(--tint-1)] border border-[var(--border)] rounded-[var(--r-md)] px-4 py-3 text-[var(--text-strong)]" required>
            <option value="" className="bg-gray-900">اختر النوع</option>
            <option value="شقة" className="bg-gray-900">شقة</option>
            <option value="فيلا" className="bg-gray-900">فيلا</option>
            <option value="أرض" className="bg-gray-900">أرض</option>
          </select>
          <input type="text" placeholder="المساحة" value={form.area} onChange={(e) => setForm({ ...form, area: e.target.value })} className="w-full bg-[var(--tint-1)] border border-[var(--border)] rounded-[var(--r-md)] px-4 py-3 text-[var(--text-strong)]" />
          <input type="text" placeholder="السعر (مثال: مليون أو 1.5 مليون أو 1,500,000)" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} className="w-full bg-[var(--tint-1)] border border-[var(--border)] rounded-[var(--r-md)] px-4 py-3 text-[var(--text-strong)]" />
          {form.price && (
            <p className="text-xs text-[var(--text)] -mt-2">
              {parsePrice(form.price) > 0
                ? `= ${formatPrice(form.price)} ج.م`
                : 'اكتب رقماً (1,500,000) أو كلمة (مليون / نص مليون)'}
            </p>
          )}
          <input type="text" placeholder="الموقع" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} className="w-full bg-[var(--tint-1)] border border-[var(--border)] rounded-[var(--r-md)] px-4 py-3 text-[var(--text-strong)]" />
          <textarea placeholder="ملاحظات العقار (اختياري) — مثال: الدور الثالث، المصعد شغال، المالك عايز يبيع بسرعة، القبضة متبقية…" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="w-full bg-[var(--tint-1)] border border-[var(--border)] rounded-[var(--r-md)] px-4 py-3 text-[var(--text-strong)] resize-y min-h-20" />
          {/* صور الوحدة — تُضغط داخل المتصفح وتُحفظ مع العقار نفسه */}
          <div className="bg-[var(--tint-1)] border border-[var(--border)] rounded-[var(--r-md)] p-3">
            <div className="flex items-center justify-between gap-2 mb-2">
              <p className="text-sm text-[var(--text)]"> صور الوحدة (اختياري — حتى ٦ صور)</p>
              <label className={`text-xs px-3 py-1.5 rounded-[var(--r-sm)] font-bold whitespace-nowrap ${form.images.length >= 6 ? 'bg-[var(--tint-1)] text-[var(--text-dim)]' : 'gradient-primary text-[var(--text-strong)] cursor-pointer'}`}>
                {imgBusy ? 'جارٍ الضغط…' : '+ أضف صور'}
                <input type="file" accept="image/*" multiple className="hidden" disabled={imgBusy || form.images.length >= 6}
                  onChange={async (e) => {
                    const files = Array.from(e.target.files || []);
                    e.target.value = '';
                    if (!files.length) return;
                    setImgBusy(true);
                    try {
                      const room = Math.max(0, 6 - form.images.length);
                      const added: string[] = [];
                      for (const file of files.slice(0, room)) added.push(await compressImage(file as File));
                      setForm((prev) => ({ ...prev, images: [...prev.images, ...added].slice(0, 6) }));
                    } catch {
                      /* تجاهل الصور غير الصالحة */
                    }
                    setImgBusy(false);
                  }} />
              </label>
            </div>
            {form.images.length === 0 ? (
              <p className="text-[11px] text-[var(--text-dim)]">اختر صور الشقة/الفيلا من هاتفك أو جهازك — تُضغط تلقائياً وتُحفظ داخل بيانات الشركة.</p>
            ) : (
              <div className="grid grid-cols-3 gap-2">
                {form.images.map((src, i) => (
                  <div key={i} className="relative">
                    <img src={src} alt={`صورة ${i + 1}`} className="w-full h-20 object-cover rounded-[var(--r-sm)]" />
                    <button type="button" onClick={() => setForm((prev) => ({ ...prev, images: prev.images.filter((_, idx) => idx !== i) }))}
                      className="absolute top-1 left-1 bg-black/70 hover:bg-red-500/80 rounded-full p-1" title="حذف الصورة">
                      <X className="w-3 h-3 text-[var(--text-strong)]" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* موقع الوحدة على الخريطة */}
          <div className="bg-[var(--tint-1)] border border-[var(--border)] rounded-[var(--r-md)] p-3">
            <div className="flex items-center justify-between gap-2 mb-1">
              <p className="text-sm text-[var(--text)]"> موقع الوحدة على الخريطة (اختياري)</p>
              <button type="button"
                onClick={() => {
                  setGeoMsg('');
                  if (!('geolocation' in navigator)) return setGeoMsg('المتصفح لا يدعم تحديد الموقع');
                  navigator.geolocation.getCurrentPosition(
                    (pos) => {
                      setForm((prev) => ({ ...prev, latitude: Number(pos.coords.latitude.toFixed(6)), longitude: Number(pos.coords.longitude.toFixed(6)) }));
                      setGeoMsg(' تم التقاط الموقع');
                    },
                    () => setGeoMsg(' لم نتمكن من قراءة الموقع — اسمح بالوصول للموقع من المتصفح'),
                    { enableHighAccuracy: true, timeout: 15000 }
                  );
                }}
                className="text-xs bg-[var(--brand-primary-softer)] hover:bg-[var(--brand-primary-soft)] border border-[var(--brand-primary-soft)] text-[var(--text)] px-3 py-1.5 rounded-[var(--r-sm)] font-bold whitespace-nowrap">
                 التقط موقع الوحدة
              </button>
            </div>
            {form.latitude && form.longitude ? (
              <p className="text-[11px] text-emerald-300" dir="ltr">{form.latitude}, {form.longitude}</p>
            ) : (
              <p className="text-[11px] text-[var(--text-dim)]">قف في موقع الوحدة واضغط الزر لتُسجَّل الإحداثيات ويظهر العقار على الخريطة لكل الفريق.</p>
            )}
            {geoMsg && <p className="text-[11px] text-amber-300 mt-1">{geoMsg}</p>}
          </div>
          <input type="tel" placeholder="رقم العميل (اختياري)" value={form.clientPhone} onChange={(e) => setForm({ ...form, clientPhone: e.target.value })} className="w-full bg-[var(--tint-1)] border border-[var(--border)] rounded-[var(--r-md)] px-4 py-3 text-[var(--text-strong)]" dir="ltr" />
          <input type="tel" placeholder="رقم تاني (اختياري) — رقم المالك أو رقم إضافي للعميل" value={form.clientPhone2} onChange={(e) => setForm({ ...form, clientPhone2: e.target.value })} className="w-full bg-[var(--tint-1)] border border-[var(--border)] rounded-[var(--r-md)] px-4 py-3 text-[var(--text-strong)]" dir="ltr" />
          <input type="text" placeholder="اسم العميل" value={form.clientName} onChange={(e) => setForm({ ...form, clientName: e.target.value })} className="w-full bg-[var(--tint-1)] border border-[var(--border)] rounded-[var(--r-md)] px-4 py-3 text-[var(--text-strong)]" />
          <button type="submit" className="w-full gradient-primary text-[var(--text-strong)] py-3 rounded-[var(--r-md)] font-bold">إضافة</button>
        </form>
      </motion.div>
    </motion.div>
  );
}

function AddFeedbackModal({ clients, currentUser, onClose, onSuccess, preset }: any) {
  // preset: رقم/عميل محدد مسبقاً (يُفتح من مراحل الرئيسية بنفس رقم الكارت)
  const [form, setForm] = useState({
    clientId: preset?.clientId || '',
    clientPhone: preset?.clientPhone || '',
    clientName: preset?.clientName || '',
    date: new Date().toISOString().slice(0, 16),
    feedback: '', status: '', callStatus: 'called', duration: '', nextAction: '', nextActionAt: '', cancelReason: '',
  });
  
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  // معرّف البطاقة المسجّلة محلياً: إعادة المحاولة بعد فشل الرفع تحدّثها بدل ما تكرّرها
  const [savedId, setSavedId] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    // الفيدباك لا يُحفظ بلا حالة وبلا كومنت — نفس شرط الشريط في تبويب العملاء
    if (!form.status || !form.feedback.trim()) return;
    // «cancellation» بلا سبب لا تُحفظ — السبب هو الكومنت
    if (form.status === 'cancellation' && !form.cancelReason) return;
    setSaving(true);
    try {
      const feedbacks: DailyFeedback[] = JSON.parse(localStorage.getItem('crm_daily_feedback') || '[]');
      const id = savedId || crypto.randomUUID();
      const now = new Date().toISOString();
      const card: DailyFeedback = {
        ...(form as any),
        id,
        // كاتب الفيدباك — بهذا تظهر البطاقة في تبويب الفيدباك اليومي عنده وعند الإدارة
        userId: currentUser.id,
        // التاريخ المختار يُحفظ ISO (بدل نص حقل datetime-local) حتى يُحسب «فيدباك اليوم» بدقة
        date: form.date ? new Date(form.date).toISOString() : now,
        // موعد «الإجراء القادم» (يوم + ساعة) — يُحفظ ISO على البطاقة
        ...(form.nextActionAt ? { nextActionAt: new Date(form.nextActionAt).toISOString() } : {}),
        createdAt: now,
      };
      // ===== «الإجراء القادم»: اختيار يوم + ساعة → تذكير يبان على كارت العميل =====
      // (قبل حفظ البطاقة، عشان الرفع يبقى قريب من الكتابة)
      let nextReminder: Reminder | null = null;
      if (form.nextActionAt) {
        const target = clients.find((c: Client) => c.id === form.clientId);
        nextReminder = addNextActionReminder(
          target || { id: form.clientId, name: form.clientName, phone: form.clientPhone },
          form.nextActionAt,
          'إجراء قادم',
          currentUser?.id || ''
        );
      }
      localStorage.setItem(
        'crm_daily_feedback',
        JSON.stringify([card, ...feedbacks.filter((f: DailyFeedback) => f.id !== id)])
      );
      setSavedId(id);
      if (!savedId && form.clientId) {
        // البطاقة سُجّلت أعلاه بنفس المعرّف، فلا ننشئ بطاقة ثانية مكرّرة
        addClientActivity(form.clientId, 'feedback', `فيدباك: ${form.feedback || 'بدون تفاصيل'}${form.nextAction ? ` — الخطوة القادمة: ${form.nextAction}` : ''}`, currentUser?.name, {
          authorId: currentUser?.id,
          skipCard: true,
          status: form.status,
          // «الإجراء القادم» (يوم + ساعة) — على سجل العميل + تذكير
          ...(form.nextActionAt
            ? { nextActionAt: new Date(form.nextActionAt).toISOString(), nextActionNote: 'إجراء قادم' }
            : {}),
          ...(form.status === 'cancellation' && form.cancelReason ? { cancelReason: form.cancelReason } : {}),
          callStatus: form.status === 'no-answer' ? 'no-answer' : 'called',
        });
      }
      // **الرفع الفعلي**: بدون انتظاره كان الفيدباك يُحفظ على جهاز السيلز فقط
      // ولا تظهره الإدارة في «الفيدباك اليومي» أبداً.
      const [feedbackOk, clientsOk, remindersOk] = await Promise.all([
        pushKey('crm_daily_feedback'),
        !savedId && form.clientId ? pushKey('crm_clients') : Promise.resolve(true),
        nextReminder ? pushKey('crm_reminders') : Promise.resolve(true),
      ]);
      if (!(feedbackOk && clientsOk && remindersOk)) {
        setError('الفيدباك اتسجل على الشاشة دي لكن ماوصلش لقاعدة البيانات — تأكد من الاتصال واضغط «إضافة» مرة تانية لإعادة الرفع.');
        return;
      }
      onSuccess();
      onClose();
    } catch {
      setError('تعذّر حفظ الفيدباك — حاول مرة أخرى');
    } finally {
      setSaving(false);
    }
  };
  
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80" onClick={onClose}>
      <motion.div initial={{ scale: 0.9 }} animate={{ scale: 1 }} exit={{ scale: 0.9 }} className="panel p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-3 mb-6">
          <div className="page-intro"><div><h2>إضافة فيدباك</h2></div></div>
          <button type="button" onClick={onClose} title="إغلاق"
            className="p-2 rounded-[var(--r-sm)] bg-[var(--tint-1)] hover:bg-[var(--tint-3)] transition-colors shrink-0">
            <X className="w-4 h-4 text-[var(--text)]" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* اختيار العميل من قائمة عملائك — يملأ الاسم والرقم تلقائياً (مثل التذكيرات) */}
          <select
            value={form.clientId}
            onChange={(e) => {
              const picked = clients.find((c: Client) => c.id === e.target.value);
              setForm(picked
                ? { ...form, clientId: picked.id, clientName: picked.name, clientPhone: picked.phone }
                : { ...form, clientId: '', clientName: '', clientPhone: '' });
            }}
            className="w-full bg-[var(--tint-1)] border border-[var(--border)] rounded-[var(--r-md)] px-4 py-3 text-[var(--text-strong)]"
          >
            <option value="" className="bg-gray-900"> اختر العميل من قائمة عملائك (اختياري)</option>
            {clients.map((c: Client) => (
              <option key={c.id} value={c.id} className="bg-gray-900">
                {c.name} — {c.phone}
              </option>
            ))}
          </select>
          <input type="tel" placeholder="رقم العميل *" value={form.clientPhone} onChange={(e) => setForm({ ...form, clientPhone: e.target.value, clientId: '' })} className="w-full bg-[var(--tint-1)] border border-[var(--border)] rounded-[var(--r-md)] px-4 py-3 text-[var(--text-strong)]" dir="ltr" required />
          <input type="text" placeholder="اسم العميل *" value={form.clientName} onChange={(e) => setForm({ ...form, clientName: e.target.value, clientId: '' })} className="w-full bg-[var(--tint-1)] border border-[var(--border)] rounded-[var(--r-md)] px-4 py-3 text-[var(--text-strong)]" required />
          <input type="datetime-local" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} className="w-full bg-[var(--tint-1)] border border-[var(--border)] rounded-[var(--r-md)] px-4 py-3 text-[var(--text-strong)]" dir="ltr" required />
          {/* ===== «الإجراء القادم»: يوم + ساعة (اختياري) ===== */}
          {/* يكتب تذكيراً بنفس نظام «محتاج إجراء»، فيبقى الموعد على كارت العميل:
              «الإجراء القادم: يوم كذا الساعة كذا». */}
          <div>
            <label className="block text-xs font-bold text-[var(--text)] mb-1.5">
              <CalendarClock className="w-3 h-3 inline" /> الإجراء القادم (يوم + ساعة) — اختياري
            </label>
            <div className="fc-next-quick mb-1.5">
              <button type="button" onClick={() => setForm({ ...form, nextActionAt: nextActionQuickValue('today') })}>اليوم</button>
              <button type="button" onClick={() => setForm({ ...form, nextActionAt: nextActionQuickValue('tomorrow') })}>بكرة</button>
              <button type="button" onClick={() => setForm({ ...form, nextActionAt: nextActionQuickValue('dayAfter') })}>بعد غد</button>
            </div>
            <input type="datetime-local" value={form.nextActionAt} onChange={(e) => setForm({ ...form, nextActionAt: e.target.value })}
              className="w-full bg-[var(--tint-1)] border border-[var(--border)] rounded-[var(--r-md)] px-4 py-3 text-[var(--text-strong)]" dir="ltr" />
            <p className="text-[11px] text-[var(--text-dim)] mt-1">
              يتكتب على كارت العميل كـ«محتاج إجراء» — لما يجي وقته وهو ما اتصرفش، الكارت يولّع أصفر «اتأخر».
            </p>
          </div>
          <select value={form.callStatus} onChange={(e) => setForm({ ...form, callStatus: e.target.value })} className="w-full bg-[var(--tint-1)] border border-[var(--border)] rounded-[var(--r-md)] px-4 py-3 text-[var(--text-strong)]">
            <option value="called" className="bg-gray-900">تم الاتصال</option>
            <option value="no-answer" className="bg-gray-900">لا رد</option>
            <option value="busy" className="bg-gray-900">مشغول</option>
            <option value="not-called" className="bg-gray-900">لم يتصل</option>
          </select>
          {/* حالة الفيدباك — إلزامية مع الكومنت (نفس شرائط شريط الفيدباك) */}
          <div>
            <label className="block text-xs font-bold text-[var(--text)] mb-1.5">حالة الفيدباك *</label>
            <StatusMenu
              value={form.status}
              label="اختر حالة الفيدباك"
              stopPropagation={false}
              onPick={(optionId) =>
                setForm({
                  ...form,
                  status: optionId,
                  // حالة الإلغاء تنتظر اختيار السبب — والسبب هو اللي يكتب الكومنت
                  cancelReason: '',
                  // «no answer» تعني مكالمة بلا رد — يُضبط حقل حالة الاتصال معها
                  callStatus: optionId === 'no-answer' ? 'no-answer' : 'called',
                  ...(optionId === 'no-answer' && !form.feedback.trim()
                    ? { feedback: NO_ANSWER_COMMENT }
                    : optionId === 'cancellation'
                    ? { feedback: '' }
                    : {}),
                })
              }
            />
            {form.status === 'cancellation' && (
              <div className="mt-2">
                <CancelReasonPicker
                  value={form.cancelReason}
                  onChange={(reason) => setForm({ ...form, cancelReason: reason, feedback: reason ? cancelReasonLabelOf(reason) : '' })}
                />
              </div>
            )}
          </div>
          <textarea placeholder="الفيدباك * (لا يُحفظ بلا كومنت)" value={form.feedback} onChange={(e) => setForm({ ...form, feedback: e.target.value })} className="w-full bg-[var(--tint-1)] border border-[var(--border)] rounded-[var(--r-md)] px-4 py-3 text-[var(--text-strong)] resize-none h-24" required />
          {error && <p className="text-xs font-bold text-amber-300 leading-relaxed">{error}</p>}
          <button type="submit" disabled={saving || !form.status || !form.feedback.trim() || (form.status === 'cancellation' && !form.cancelReason)} className="w-full gradient-primary text-[var(--text-strong)] py-3 rounded-[var(--r-md)] font-bold disabled:opacity-50">{saving ? 'جارٍ الحفظ…' : 'إضافة'}</button>
        </form>
      </motion.div>
    </motion.div>
  );
}

// Edit User Modal - تعديل بيانات حساب (سيلز / مشرف)
// كلمة المرور: صلاحية الإدارة (CEO) وحدها — تراها في هذا النموذج وتستطيع تعيين واحدة جديدة.
// ومن غير الإدارة لا يظهر الحقل أصلاً، ولو كتب أحدهم كلمة مرور بطلب مُصنَّع من DevTools
// فسيُهمل على السيرفر تماماً (server/auth.js: preserveUserPasswords — canManage للإدارة فقط).
function EditUserModal({ user, users, currentUser, onClose, onSuccess }: any) {
  const [form, setForm] = useState({
    name: user.name,
    username: user.username,
    phone: user.phone || '',
    role: user.role as User['role'],
    team: user.team || '',
    isActive: user.isActive,
    // «إداري وسيلز في نفس الوقت»: يبقى رتبته كما هي ويستقبل أرقاماً أيضاً
    receivesLeads: user.receivesLeads === true,
    // نطاق البيانات: يحسم هل الحساب يرى أرقام وفيدباك غيره
    dataScope: (user.dataScope === 'own'
      ? 'own'
      : user.dataScope === 'all'
        ? 'all'
        : user.role === 'admin'
          ? 'all'
          : 'own') as 'own' | 'all',
  });
  // الإدارة فقط ترى وتغيّر كلمات المرور
  const canSeePasswords = currentUser.role === 'admin';
  const [newPassword, setNewPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  const isSelf = user.id === currentUser.id;
  const canAssignCeo = isCeoRole(currentUser.role);
  // لا يمكن لقائد الفريق تغيير رتبة أحد إلى CEO ولا المساس بحساب الـ CEO
  const roleLocked = isSelf || (user.role === 'admin' && !canAssignCeo) || !canAssignCeo;
  const activeLocked = isSelf;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!form.name.trim() || !form.username.trim()) {
      setError('يرجى تعبئة الاسم واسم المستخدم');
      return;
    }

    const allUsers: User[] = JSON.parse(localStorage.getItem('crm_users') || '[]');
    const usernameTaken = allUsers.some(
      (u: User) => u.id !== user.id && u.username.trim().toLowerCase() === form.username.trim().toLowerCase()
    );

    if (usernameTaken) {
      setError('اسم المستخدم موجود بالفعل، اختر اسماً آخر');
      return;
    }
    if (newPassword && newPassword.length < 6) {
      setError('كلمة المرور ٦ أحرف على الأقل');
      return;
    }

    // البيانات (الاسم/الرقم/الرتبة/الفريق) + كلمة مرور جديدة إن عيّنها الإدارة
    // (فارغة = الإبقاء على الحالية؛ والسيرفر يقبل تغيير الكلمة من الإدارة فقط)
    const updated = allUsers.map((u: User) =>
      u.id === user.id
        ? {
            ...u,
            ...form,
            name: form.name.trim(),
            username: form.username.trim(),
            ...(canSeePasswords && newPassword ? { password: newPassword } : {}),
          }
        : u
    );

    localStorage.setItem('crm_users', JSON.stringify(updated));
    // الحفظ لا يُعتبر ناجحاً إلا بعد تأكيد الرفع للسيرفر — وإلا يبقى التغيير
    // على هذا الجهاز وحده (خصوصاً تغيير كلمة المرور).
    const pushed = await pushKey('crm_users');
    if (!pushed) {
      setError('تعذّر حفظ التغيير على السيرفر — تحقّق من الاتصال ثم حاول مرة أخرى');
      return;
    }
    setSaved(true);
    setTimeout(() => { onSuccess(); onClose(); }, 900);
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80" onClick={onClose}>
      <motion.div
        initial={{ scale: 0.9, y: 20 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.9, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 220, damping: 20 }}
        className="panel p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto border-[var(--brand-primary-soft)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 gradient-primary rounded-full flex items-center justify-center">
              <Edit3 className="w-6 h-6 text-[var(--text-strong)]" />
            </div>
            <div>
              <div className="page-intro"><div><h2>تعديل الحساب</h2></div></div>
              <p className="text-sm text-[var(--text-muted)]">{user.name} • @{user.username}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-[var(--tint-2)] rounded-[var(--r-sm)] transition-colors">
            <X className="w-5 h-5 text-[var(--text-muted)]" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm text-[var(--text)] mb-1">الاسم الكامل *</label>
            <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="w-full bg-[var(--tint-1)] border border-[var(--border)] rounded-[var(--r-md)] px-4 py-3 text-[var(--text-strong)]" required />
          </div>

          <div>
            <label className="block text-sm text-[var(--text)] mb-1">اسم المستخدم *</label>
            <input type="text" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })}
              className="w-full bg-[var(--tint-1)] border border-[var(--border)] rounded-[var(--r-md)] px-4 py-3 text-[var(--text-strong)]" dir="ltr" required />
          </div>

          {canSeePasswords && (
            <div>
              <label className="block text-sm text-[var(--text)] mb-1">كلمة المرور</label>
              {String(user.password || '').startsWith('sha256:') ? (
                <p className="text-[12px] text-[var(--text-dim)] mb-2">
                  محفوظة مشفّرة (قيمة قديمة) — لا تُعرض، وتعيين كلمة جديدة من الحقل أدناه يستبدلها.
                </p>
              ) : (
                <p className="mb-2 flex items-center gap-2">
                  <span
                    className="px-3 py-2 rounded-[var(--r-sm)] bg-[var(--tint-1)] border border-[var(--border)] text-sm text-[var(--text-strong)] select-all"
                    dir="ltr"
                  >
                    {user.password || 'بلا كلمة مرور — لا يستطيع الدخول'}
                  </span>
                  <span className="text-[11px] text-[var(--text-dim)]">مرئية للإدارة فقط</span>
                </p>
              )}
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="اتركها فارغة للإبقاء على كلمة المرور الحالية"
                  className="w-full bg-[var(--tint-1)] border border-[var(--border)] rounded-[var(--r-md)] px-4 py-3 pl-12 text-[var(--text-strong)]"
                  dir="ltr"
                />
                <button type="button" onClick={() => setShowPassword(!showPassword)}
                  className="absolute left-3 top-1/2 -translate-y-1/2 p-1 hover:bg-[var(--tint-2)] rounded-[var(--r-sm)]">
                  {showPassword ? <EyeOff className="w-4 h-4 text-[var(--text-muted)]" /> : <Eye className="w-4 h-4 text-[var(--text-muted)]" />}
                </button>
              </div>
              <p className="text-[11px] text-[var(--text-dim)] mt-1">
                كلمة مرور جديدة (٦ أحرف على الأقل) — تعمل فور الحفظ على كل الأجهزة.
              </p>
            </div>
          )}

          {/* إداري وسيلز معاً: الرتبة تبقى كما هي (قوائم الإدارة شغالة) والحساب
              يدخل في قائمة السيلز فيستقبل أرقاماً يدوياً وبالتوزيع التلقائي. */}
          {!['sales', 'supervisor'].includes(String(form.role)) && (
            <button
              type="button"
              onClick={() => setForm({ ...form, receivesLeads: !form.receivesLeads })}
              className={`w-full flex items-start gap-3 rounded-[var(--r-md)] px-4 py-3 text-right border transition-colors ${
                form.receivesLeads
                  ? 'bg-emerald-500/15 border-emerald-400/40'
                  : 'bg-[var(--tint-1)] border-[var(--border)]'
              }`}
            >
              <span
                className={`w-5 h-5 mt-0.5 rounded-[var(--r-xs)] border flex items-center justify-center shrink-0 ${
                  form.receivesLeads ? 'bg-emerald-500 border-emerald-500' : 'border-gray-500'
                }`}
              >
                {form.receivesLeads && <Check className="w-3.5 h-3.5 text-[var(--text-strong)]" />}
              </span>
              <span>
                <span className="block text-sm text-[var(--text)] font-bold">يعمل سيلزاً أيضاً (يستقبل أرقاماً)</span>
                <span className="block text-xs text-[var(--text-dim)] mt-0.5">
                  يبقى رتبته الإدارية وقوائمه كما هي، ويظهر في «توزيع الأرقام» ويقبل التوزيع اليدوي والتلقائي مثل أي مندوب.
                </span>
              </span>
            </button>
          )}

          <div>
            <label className="block text-sm text-[var(--text)] mb-1">رقم الهاتف</label>
            <input type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })}
              className="w-full bg-[var(--tint-1)] border border-[var(--border)] rounded-[var(--r-md)] px-4 py-3 text-[var(--text-strong)]" dir="ltr" placeholder="لا يوجد رقم" />
          </div>

          <div>
            <label className="block text-sm text-[var(--text)] mb-1">الرتبة</label>
            <select value={form.role} disabled={roleLocked}
              onChange={(e) => setForm({ ...form, role: e.target.value as User['role'] })}
              className="w-full bg-[var(--tint-1)] border border-[var(--border)] rounded-[var(--r-md)] px-4 py-3 text-[var(--text-strong)] disabled:opacity-50 disabled:cursor-not-allowed">
              <option value="sales" className="bg-gray-900">Sales Agent — سيلز</option>
              <option value="supervisor" className="bg-gray-900">Team Leader — قائد فريق</option>
              {canAssignCeo && <option value="admin" className="bg-gray-900">CEO — المدير التنفيذي</option>}
            </select>
            <p className="text-xs text-[var(--text-dim)] mt-1">
              {isSelf
                ? 'لا يمكنك تغيير رتبتك الحالية'
                : roleLocked
                ? 'تغيير الرتب هو صلاحية المدير التنفيذي (CEO) وحده'
                : 'قائد الفريق يرى ويوزّع على أعضاء فريقه فقط'}
            </p>
            <input type="text" value={form.team} onChange={(e) => setForm({ ...form, team: e.target.value })}
              placeholder="اسم الفريق (اختياري)" className="mt-2 w-full bg-[var(--tint-1)] border border-[var(--border)] rounded-[var(--r-md)] px-4 py-3 text-[var(--text-strong)]" />
          </div>

          {/* نطاق البيانات: يحسم اذا كان الحساب يشوف أرقام وفيدباك غيره — حتى لو رتبته إدارية */}
          <div>
            <label className="block text-sm text-[var(--text)] mb-1">نطاق البيانات</label>
            <select value={form.dataScope}
              onChange={(e) => setForm({ ...form, dataScope: e.target.value as 'own' | 'all' })}
              className="w-full bg-[var(--tint-1)] border border-[var(--border)] rounded-[var(--r-md)] px-4 py-3 text-[var(--text-strong)]">
              <option value="own" className="bg-gray-900">بياناته فقط — أرقامه وعملاؤه وفيدباكه</option>
              <option value="all" className="bg-gray-900">كل البيانات — أرقام وفيدباك كل الفريق</option>
            </select>
            <p className="text-xs text-[var(--text-dim)] mt-1">
              «بياناته فقط» هو الصحيح لأي إداري يشتغل كسيلز: يمنعه من رؤية أرقام غيره وفيدباكهم.
            </p>
          </div>

          <button type="button" disabled={activeLocked} onClick={() => setForm({ ...form, isActive: !form.isActive })}
            className={`w-full flex items-center justify-between rounded-[var(--r-md)] px-4 py-3 border transition-colors ${
              form.isActive ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-red-500/10 border-red-500/30'
            } disabled:opacity-50 disabled:cursor-not-allowed`}>
            <span className="text-sm text-[var(--text)]">حالة الحساب</span>
            <span className={`text-sm font-bold ${form.isActive ? 'text-emerald-400' : 'text-red-400'}`}>
              {form.isActive ? 'مفعّل - يمكنه تسجيل الدخول' : 'موقوف - لا يمكنه تسجيل الدخول'}
            </span>
          </button>

          <AnimatePresence>
            {error && (
              <motion.p initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                className="text-red-400 text-sm text-center bg-red-500/10 border border-red-500/20 rounded-[var(--r-md)] py-2 px-3 flex items-center justify-center gap-2">
                <AlertTriangle className="w-4 h-4" /> {error}
              </motion.p>
            )}
          </AnimatePresence>

          <div className="flex gap-3 pt-2">
            <motion.button type="submit" whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
              className="flex-1 gradient-primary text-[var(--text-strong)] py-3 rounded-[var(--r-md)] font-bold flex items-center justify-center gap-2 glow-primary">
              {saved ? (<><Check className="w-5 h-5" /> تم الحفظ</>) : (<><Check className="w-5 h-5" /> حفظ التعديلات</>)}
            </motion.button>
            <button type="button" onClick={onClose}
              className="flex-1 bg-[var(--tint-2)] text-[var(--text-strong)] py-3 rounded-[var(--r-md)] font-bold hover:bg-[var(--tint-3)] transition-colors">
              إلغاء
            </button>
          </div>
        </form>
      </motion.div>
    </motion.div>
  );
}

// Confirm Delete User Modal - تأكيد حذف حساب سيلز
function ConfirmDeleteUserModal({ user, currentUser, onClose, onConfirm }: any) {
  const [deleteRelatedData, setDeleteRelatedData] = useState(false);

  const clients = JSON.parse(localStorage.getItem('crm_clients') || '[]');
  const leads = JSON.parse(localStorage.getItem('crm_assigned_leads') || '[]');
  const feedbacks = JSON.parse(localStorage.getItem('crm_daily_feedback') || '[]');
  const reminders = JSON.parse(localStorage.getItem('crm_reminders') || '[]');

  const relatedClients = clients.filter((c: Client) => c.userId === user.id || c.assignedTo === user.id).length;
  const relatedLeads = leads.filter((l: AssignedLead) => l.salesId === user.id).length;
  const relatedFeedbacks = feedbacks.filter((f: DailyFeedback) => f.userId === user.id).length;
  const relatedReminders = reminders.filter((r: Reminder) => r.userId === user.id).length;

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80" onClick={onClose}>
      <motion.div
        initial={{ scale: 0.9, y: 20 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.9, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 220, damping: 20 }}
        className="panel p-6 w-full max-w-md border-red-500/30 glow-primary"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-center mb-6">
          <motion.div
            initial={{ scale: 0, rotate: -90 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={{ type: 'spring', stiffness: 200, damping: 12 }}
            className="w-16 h-16 bg-red-500/20 rounded-full flex items-center justify-center mx-auto mb-4 border border-red-500/30"
          >
            <AlertTriangle className="w-8 h-8 text-red-400" />
          </motion.div>
          <h2 className="text-xl font-bold text-[var(--text-strong)] mb-2">تأكيد حذف الحساب</h2>
          <p className="text-sm text-[var(--text-muted)]">
            سيتم حذف حساب <span className="text-red-400 font-bold">{user.name}</span> (@{user.username}) نهائياً
            ولن يستطيع تسجيل الدخول بعد ذلك.
          </p>
        </div>

        <div className="bg-[var(--tint-1)] rounded-[var(--r-md)] p-4 mb-4 space-y-2">
          {[
            { label: 'عملاء مرتبطون', value: relatedClients },
            { label: 'أرقام موزعة', value: relatedLeads },
            { label: 'فيدباك يومي', value: relatedFeedbacks },
            { label: 'تذكيرات', value: relatedReminders },
          ].map((row) => (
            <div key={row.label} className="flex items-center justify-between text-sm">
              <span className="text-[var(--text-muted)]">{row.label}</span>
              <span className="text-[var(--text-strong)] font-bold">{row.value}</span>
            </div>
          ))}
        </div>

        <button type="button" onClick={() => setDeleteRelatedData(!deleteRelatedData)}
          className={`w-full flex items-center gap-3 rounded-[var(--r-md)] px-4 py-3 mb-2 border transition-colors text-right ${
            deleteRelatedData ? 'bg-red-500/15 border-red-500/40' : 'bg-[var(--tint-1)] border-[var(--border)]'
          }`}>
          <span className={`w-5 h-5 rounded-[var(--r-xs)] border flex items-center justify-center shrink-0 ${
            deleteRelatedData ? 'bg-red-500 border-red-500' : 'border-gray-500'
          }`}>
            {deleteRelatedData && <Check className="w-3.5 h-3.5 text-[var(--text-strong)]" />}
          </span>
          <span className="text-sm text-[var(--text)]">
            حذف بياناته نهائياً كمان (العملاء، الأرقام، الفيدباك، التذكيرات)
          </span>
        </button>
        <p className="text-[11px] text-[var(--text-dim)] mb-4 leading-relaxed">
          {deleteRelatedData
            ? 'تحذير: الأرقام والكومنتات بتتشال نهائياً ومش بترجع.'
            : 'الأرقام ترجع «غير مخصصة» في توزيع الأرقام (مع كومنتاتها)، والعملاء يرجعوا بلا مالك لحد ما توزّعهم. التذكيرات والحضور بس اللي بيتشالوا.'}
        </p>

        <div className="flex gap-3">
          <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
            onClick={() => onConfirm(deleteRelatedData)}
            className="flex-1 bg-[var(--danger)] text-white py-3 rounded-[var(--r-md)] font-bold flex items-center justify-center gap-2">
            <Trash2 className="w-4 h-4" /> حذف نهائي
          </motion.button>
          <button onClick={onClose}
            className="flex-1 bg-[var(--tint-2)] text-[var(--text-strong)] py-3 rounded-[var(--r-md)] font-bold hover:bg-[var(--tint-3)] transition-colors">
            إلغاء
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ===== إنشاء حساب جديد بالرتب الثلاث: CEO / Team Leader / Sales Agent =====
// الرئيسي (CEO) وحده يستطيع إنشاء حساب CEO آخر. قائد الفريق ينشئ مندوبين لفريقه فقط.
function AddUserModal({ currentUser, users = [], onClose, onSuccess }: any) {
  const canCreateCeo = isCeoRole(currentUser?.role);
  const [form, setForm] = useState({ username: '', password: '', name: '', phone: '', role: canCreateCeo ? 'admin' : 'sales', team: '' });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  // معرّف الحساب بعد حفظه على هذا الجهاز: لو ماوصلش لقاعدة البيانات نعيد المحاولة
  // بنفس الحساب بدل ما ننشئ واحداً آخر يكسر الدخول.
  const [createdId, setCreatedId] = useState('');
  const teamNames = Array.from(new Set((users || []).map((u: User) => u.team).filter(Boolean))) as string[];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    setError('');
    const clean = { username: form.username.trim(), name: form.name.trim(), phone: form.phone.trim() };
    if (!/^[A-Za-z0-9._-]{3,24}$/.test(clean.username)) {
      setError('اسم المستخدم: حروف إنجليزية أو أرقام فقط (٣–٢٤ حرفاً)');
      return;
    }
    if (form.password.length < 6) {
      setError('كلمة المرور ٦ أحرف على الأقل');
      return;
    }
    // لا يستطيع غير الـ CEO إنشاء CEO
    if (form.role === 'admin' && !canCreateCeo) {
      setError('إنشاء حساب CEO متاح للمدير التنفيذي فقط');
      return;
    }
    const store = JSON.parse(localStorage.getItem('crm_users') || '[]') as User[];
    if (!createdId && store.some((u) => u.username.toLowerCase() === clean.username.toLowerCase())) {
      setError('اسم المستخدم موجود بالفعل');
      return;
    }
    setSaving(true);
    try {
      if (!createdId) {
        const newUser: User = {
          username: clean.username,
          // تُحفظ كما أُرسلت: نصاً تراها الإدارة في حسابات السيلز
          password: form.password,
          name: clean.name,
          phone: clean.phone,
          role: form.role as User['role'],
          team: form.team.trim(),
          isActive: true,
          id: crypto.randomUUID(),
          createdAt: new Date().toISOString(),
          createdBy: currentUser.id,
        };
        localStorage.setItem('crm_users', JSON.stringify([...store, newUser]));
        setCreatedId(newUser.id);
      }
      // لا نعتبر الحساب منشأً قبل أن يصل لقاعدة البيانات: الدخول يمرّ بالسيرفر،
      // فحساب موجود على هذا الجهاز وحده لا يستطيع صاحبه أن يسجّل الدخول.
      const savedToDb = await pushKey('crm_users');
      if (!savedToDb) {
        setError('الحساب اتسجّل على الجهاز ده لكن ماوصلش لقاعدة البيانات — من غير وصوله مايقدرش صاحبه يدخل من جهازه. تأكد من الاتصال واضغط «إعادة المحاولة».');
        return;
      }
      onSuccess();
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80" onClick={onClose}>
      <motion.div initial={{ scale: 0.9 }} animate={{ scale: 1 }} exit={{ scale: 0.9 }} className="panel p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-3 mb-6">
          <div className="page-intro"><div><h2>إنشاء حساب جديد</h2></div></div>
          <button type="button" onClick={onClose} title="إغلاق"
            className="p-2 rounded-[var(--r-sm)] bg-[var(--tint-1)] hover:bg-[var(--tint-3)] transition-colors shrink-0">
            <X className="w-4 h-4 text-[var(--text)]" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs text-[var(--text-muted)] mb-1.5 font-bold">الرتبة</label>
            <div className="grid grid-cols-3 gap-2">
              {([
                { id: 'admin', label: 'CEO', sub: 'مدير تنفيذي' },
                { id: 'supervisor', label: 'Team Leader', sub: 'قائد فريق' },
                { id: 'sales', label: 'Sales Agent', sub: 'سيلز' },
              ] as const).filter((r) => r.id !== 'admin' || canCreateCeo).map((r) => (
                <button key={r.id} type="button" onClick={() => setForm({ ...form, role: r.id })}
                  className={`rounded-[var(--r-md)] px-2 py-3 border text-center transition-colors ${
                    form.role === r.id ? 'bg-[var(--brand-primary-softer)] border-[var(--brand-primary-soft)]' : 'bg-[var(--tint-1)] border-[var(--border)] hover:bg-[var(--tint-2)]'
                  }`}>
                  <span className="block text-[11px] font-bold text-[var(--text-strong)]">{r.label}</span>
                  <span className="block text-[9.5px] text-[var(--text-muted)]">{r.sub}</span>
                </button>
              ))}
            </div>
          </div>
          <input type="text" placeholder="الاسم الكامل *" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full bg-[var(--tint-1)] border border-[var(--border)] rounded-[var(--r-md)] px-4 py-3 text-[var(--text-strong)]" required />
          <input type="text" placeholder="اسم المستخدم *" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} className="w-full bg-[var(--tint-1)] border border-[var(--border)] rounded-[var(--r-md)] px-4 py-3 text-[var(--text-strong)]" dir="ltr" required />
          <input type="password" placeholder="كلمة المرور * (٦ أحرف على الأقل)" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} className="w-full bg-[var(--tint-1)] border border-[var(--border)] rounded-[var(--r-md)] px-4 py-3 text-[var(--text-strong)]" dir="ltr" required />
          <input type="tel" placeholder="رقم الهاتف" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="w-full bg-[var(--tint-1)] border border-[var(--border)] rounded-[var(--r-md)] px-4 py-3 text-[var(--text-strong)]" dir="ltr" />
          <div>
            <label className="block text-xs text-[var(--text-muted)] mb-1.5 font-bold">الفريق</label>
            <input type="text" list="team-options" placeholder="اسم الفريق (اختياري)" value={form.team} onChange={(e) => setForm({ ...form, team: e.target.value })} className="w-full bg-[var(--tint-1)] border border-[var(--border)] rounded-[var(--r-md)] px-4 py-3 text-[var(--text-strong)]" />
            <datalist id="team-options">
              {teamNames.map((t) => <option key={t} value={t} />)}
            </datalist>
          </div>
          {error && <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/30 rounded-[var(--r-md)] px-3 py-2">{error}</p>}
          <button type="submit" disabled={saving} className="w-full gradient-primary text-[var(--text-strong)] py-3 rounded-[var(--r-md)] font-bold disabled:opacity-60">
            {saving ? 'جارٍ الحفظ...' : createdId ? 'إعادة المحاولة' : 'إنشاء الحساب'}
          </button>
        </form>
      </motion.div>
    </motion.div>
  );
}

function AddTeamModal({ users, currentUser, onClose, onSuccess }: any) {
  const [form, setForm] = useState({ name: '', supervisorId: '', supervisorName: '', memberIds: [] as string[] });
  
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const teams = JSON.parse(localStorage.getItem('crm_teams') || '[]');
    const supervisor = users.find((u: User) => u.id === form.supervisorId);
    const newTeam = { ...form, supervisorName: supervisor?.name || '', id: crypto.randomUUID(), createdAt: new Date().toISOString(), createdBy: currentUser.id };
    localStorage.setItem('crm_teams', JSON.stringify([...teams, newTeam]));
    onSuccess();
    onClose();
  };
  
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80" onClick={onClose}>
      <motion.div initial={{ scale: 0.9 }} animate={{ scale: 1 }} exit={{ scale: 0.9 }} className="panel p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-3 mb-6">
          <div className="page-intro"><div><h2>إضافة فريق</h2></div></div>
          <button type="button" onClick={onClose} title="إغلاق"
            className="p-2 rounded-[var(--r-sm)] bg-[var(--tint-1)] hover:bg-[var(--tint-3)] transition-colors shrink-0">
            <X className="w-4 h-4 text-[var(--text)]" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <input type="text" placeholder="اسم الفريق *" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full bg-[var(--tint-1)] border border-[var(--border)] rounded-[var(--r-md)] px-4 py-3 text-[var(--text-strong)]" required />
          <select value={form.supervisorId} onChange={(e) => setForm({ ...form, supervisorId: e.target.value })} className="w-full bg-[var(--tint-1)] border border-[var(--border)] rounded-[var(--r-md)] px-4 py-3 text-[var(--text-strong)]" required>
            <option value="" className="bg-gray-900">اختر المشرف</option>
            {users.filter((u: User) => u.role === 'supervisor' || u.role === 'admin').map((u: User) => (
              <option key={u.id} value={u.id} className="bg-gray-900">{u.name}</option>
            ))}
          </select>
          <button type="submit" className="w-full gradient-primary text-[var(--text-strong)] py-3 rounded-[var(--r-md)] font-bold">إضافة</button>
        </form>
      </motion.div>
    </motion.div>
  );
}

// Add Assigned Lead Modal
// ===== استيراد الأرقام من ملف (فيسبوك / إنجاز) =====
function ImportLeadsModal({ users, clients, assignedLeads, currentUser, onClose, onSuccess }: any) {
  // نفس قاعدة السيرفر حرفياً (isAssignableSales): سيلز/قائد فريق + حساب «مطوّر»
  // إداري يعمل سيلزاً أيضاً. والاشتراط بـ u.isActive كان يُخفي أي حساب قديم
  // لم يُكتب له الحقل أصلاً، فلا يظهر في توزيع الأرقام ولا يقبل رقمأ.
  const salesUsers = users.filter((u: User) => isAssignableSales(u));
  const [stage, setStage] = useState<'pick' | 'preview' | 'done'>('pick');
  const [fileName, setFileName] = useState('');
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [error, setError] = useState('');
  const [mode, setMode] = useState<'even' | 'single'>('even');
  const [singleId, setSingleId] = useState(salesUsers[0]?.id || '');
  const [selectedIds, setSelectedIds] = useState<string[]>(() => salesUsers.map((u: User) => u.id));
  // عدد الأرقام لكل مندوب (يحدده المدير) — فعّال عند تشغيل الحصص
  const [useQuota, setUseQuota] = useState(false);
  const [quotas, setQuotas] = useState<Record<string, number>>({});
  const setQuota = (id: string, value: number) =>
    setQuotas((prev) => ({ ...prev, [id]: Math.max(0, Math.floor(value || 0)) }));
  const totalQuota = Object.values(quotas).reduce((a, b) => a + (b || 0), 0);
  const [dragging, setDragging] = useState(false);
  const [result, setResult] = useState<{ imported: number; duplicates: number; invalid: number; perUser: { name: string; count: number }[] } | null>(null);

  // كل الأرقام الموجودة بالفعل (موزعة أو عملاء) لمنع التكرار
  const existingPhones = [
    ...assignedLeads.map((lead: AssignedLead) => lead.phone),
    ...clients.flatMap((client: Client) => [client.phone, ...(client.phones || [])]),
  ].filter(Boolean);

  const readFile = async (file: File) => {
    setError('');
    if (/\.(xlsx|xls)$/i.test(file.name)) {
      setError('ملفات إكسل (xlsx) تحتاج تحويلاً بسيطاً: افتح الملف في إكسل ثم File ← Save As ← CSV UTF-8');
      return;
    }
    try {
      const text = decodeText(await file.arrayBuffer());
      const table = parseTable(text);
      if (!table.length) {
        setError('الملف فارغ أو غير مقروء');
        return;
      }
      const built = buildPreview(table, existingPhones);
      if (!built.rows.length) {
        setError('لم نجد أي صفوف قابلة للقراءة في الملف');
        return;
      }
      setPreview(built);
      setFileName(file.name);
      setStage('preview');
    } catch {
      setError('تعذّر قراءة الملف — تأكد أن الملف بصيغة CSV');
    }
  };

  const downloadCsv = (content: string, name: string) => {
    const blob = new Blob([`\uFEFF${content}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    link.click();
    URL.revokeObjectURL(url);
  };

  const downloadSample = () => downloadCsv(buildSampleCsv(), 'facebook-leads-sample.csv');
  const downloadFakeCampaign = (count: number) => downloadCsv(buildFakeCampaignCsv(count), `fake-campaign-${count}.csv`);

  const handleImport = () => {
    if (!preview) return;
    const targets = mode === 'single' ? salesUsers.filter((u: User) => u.id === singleId) : salesUsers.filter((u: User) => selectedIds.includes(u.id));
    if (!targets.length) {
      setError('اختر سيلز واحداً على الأقل قبل الاستيراد');
      return;
    }

    const counts = new Map<string, number>();
    const fresh = preview.rows.filter((row) => !row.duplicate && !row.invalid);

    // توزيع الأرقام: إما بالتساوي بالمناوبة، أو بعدد يحدده المدير لكل مندوب (الحصص)
    const assignment: Array<{ row: (typeof fresh)[number]; owner: User }> = [];
    if (useQuota) {
      let cursor = 0;
      for (const owner of targets) {
        const quota = quotas[owner.id] || 0;
        for (let i = 0; i < quota && cursor < fresh.length; i += 1) {
          assignment.push({ row: fresh[cursor], owner });
          cursor += 1;
        }
      }
      if (assignment.length === 0) {
        setError('حدّد عدد الأرقام لكل سيلز (أو أغلق خيار التحديد للتوزيع بالتساوي)');
        return;
      }
    } else {
      fresh.forEach((row, index) => assignment.push({ row, owner: targets[index % targets.length] }));
    }

    const newLeads: AssignedLead[] = assignment.map(({ row, owner }) => {
      counts.set(owner.id, (counts.get(owner.id) || 0) + 1);
      const description = [row.source && `المصدر: ${row.source}`, row.date && `التاريخ: ${row.date}`, row.note].filter(Boolean).join(' • ');
      // وقت تسجيل الرقم في الكامبين (لو الملف فيه تاريخ) — منفصل عن وقت الاستيراد
      const campaignAt = campaignAtFromText(description);
      return {
        id: crypto.randomUUID(),
        adminId: currentUser.id,
        salesId: owner.id,
        name: row.name || 'عميل بدون اسم',
        phone: row.phone,
        description,
        status: 'new',
        createdAt: new Date().toISOString(),
        ...(campaignAt ? { campaignAt } : {}),
      };
    });

    const existing = JSON.parse(localStorage.getItem('crm_assigned_leads') || '[]');
    localStorage.setItem('crm_assigned_leads', JSON.stringify([...newLeads, ...existing]));
    onSuccess();
    setResult({
      imported: newLeads.length,
      duplicates: preview.duplicates,
      invalid: preview.invalid,
      perUser: targets.map((u: User) => ({ name: u.name, count: counts.get(u.id) || 0 })),
    });
    setStage('done');
  };

  const summary = preview
    ? [
        { label: 'إجمالي الصفوف', value: preview.total, className: 'text-[var(--text-strong)]' },
        { label: 'أرقام جديدة', value: preview.fresh, className: 'text-emerald-400' },
        { label: 'مكررة (تُتجاهل)', value: preview.duplicates, className: 'text-amber-400' },
        { label: 'غير صالحة', value: preview.invalid, className: 'text-red-400' },
      ]
    : [];

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80" onClick={onClose}>
      <motion.div
        initial={{ scale: 0.94, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.94, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 220, damping: 22 }}
        className="panel p-6 w-full max-w-3xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-[var(--brand-fill)] rounded-full flex items-center justify-center">
              <Upload className="w-6 h-6 text-[var(--text-strong)]" />
            </div>
            <div>
              <div className="page-intro"><div><h2>استيراد أرقام من ملف</h2></div></div>
              <p className="text-xs text-[var(--text-muted)]">من فيسبوك (Leads Center) أو من إنجاز (تصدير Excel ثم CSV)</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-[var(--tint-2)] rounded-[var(--r-sm)] transition-colors">
            <X className="w-5 h-5 text-[var(--text-muted)]" />
          </button>
        </div>

        {/* الخطوة ١: اختيار الملف */}
        {stage === 'pick' && (
          <div className="space-y-4">
            <div
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                const file = e.dataTransfer.files?.[0];
                if (file) void readFile(file);
              }}
              className={`rounded-[var(--r-xl)] border-2 border-dashed p-8 text-center transition-colors ${dragging ? 'border-[var(--brand)] bg-[var(--brand-primary-softer)]' : 'border-[var(--brand-primary-soft)] bg-[var(--tint-1)]'}`}
            >
              <Upload className="w-12 h-12 text-[var(--brand)] mx-auto mb-3" />
              <p className="text-[var(--text-strong)] font-bold mb-1">اسحب ملف الأرقام هنا أو اختره من جهازك</p>
              <p className="text-xs text-[var(--text-muted)] mb-4">مدعوم: CSV / TXT — يدعم الأرقام المكتوبة عربية (+20 و 010 و ٠١٠)</p>
              <label className="inline-block cursor-pointer gradient-primary text-[var(--text-strong)] px-6 py-3 rounded-[var(--r-md)] font-bold">
                اختر ملفاً
                <input type="file" accept=".csv,.txt,text/csv" className="hidden"
                  onChange={(e) => { const file = e.target.files?.[0]; if (file) void readFile(file); }} />
              </label>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-[var(--r-md)] bg-[var(--tint-1)] border border-[var(--border)] p-4">
                <p className="text-sm font-bold text-[var(--brand)] mb-1">من فيسبوك</p>
                <p className="text-xs text-[var(--text-muted)] leading-relaxed">
                  Ads Manager ← Leads Center ← اختر الفورم ← تنزيل الملف، ثم ارفعه هنا.
                </p>
              </div>
              <div className="rounded-[var(--r-md)] bg-[var(--tint-1)] border border-[var(--border)] p-4">
                <p className="text-sm font-bold text-[var(--text)] mb-1">من إنجاز</p>
                <p className="text-xs text-[var(--text-muted)] leading-relaxed">
                  صدّر العملاء من إنجاز بصيغة Excel، ثم احفظه في إكسل كـ CSV UTF-8.
                </p>
              </div>
            </div>

            <button onClick={downloadSample} className="w-full flex items-center justify-center gap-2 bg-[var(--tint-1)] border border-[var(--border)] text-[var(--text)] py-3 rounded-[var(--r-md)] font-bold hover:bg-[var(--tint-2)] transition-colors">
              <Download className="w-4 h-4" /> نزّل ملفاً تجريبياً صغيراً (٩ أرقام بمشاكل مقصودة)
            </button>

            <div className="rounded-[var(--r-md)] bg-[var(--tint-1)] border border-[var(--border)] p-4">
              <p className="text-xs text-[var(--text-muted)] mb-3">
                أو ولّد <span className="text-[var(--brand)] font-bold">كامبين وهمية</span> بعدد أرقام أكبر لتجرّب التوزيع على الفريق (بها مكرر وصفوف بلا رقم مثل فيسبوك الحقيقي):
              </p>
              <div className="flex flex-wrap gap-2">
                {[50, 100, 200].map((count) => (
                  <button key={count} onClick={() => downloadFakeCampaign(count)}
                    className="flex-1 min-w-[110px] bg-[var(--brand-primary-softer)] border border-[var(--brand-primary-soft)] text-[var(--brand)] py-2.5 rounded-[var(--r-md)] font-bold text-sm hover:bg-[var(--brand-primary-soft)] transition-colors">
                    توليد {count} رقم
                  </button>
                ))}
              </div>
            </div>

            <AnimatePresence>
              {error && (
                <motion.p initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                  className="text-amber-400 text-sm bg-amber-500/10 border border-amber-500/20 rounded-[var(--r-md)] py-2 px-3 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0" /> {error}
                </motion.p>
              )}
            </AnimatePresence>
          </div>
        )}

        {/* الخطوة ٢: مراجعة قبل الاستيراد */}
        {stage === 'preview' && preview && (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm text-[var(--text)]">
                <FileText className="w-4 h-4 inline ml-1 text-[var(--text-muted)]" />
                الملف: <span className="text-[var(--text-strong)] font-bold">{fileName}</span>
              </p>
              <button onClick={() => { setPreview(null); setError(''); setStage('pick'); }}
                className="text-xs text-[var(--brand)] hover:text-[var(--brand)] font-bold">اختيار ملف آخر</button>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {summary.map((item) => (
                <div key={item.label} className="rounded-[var(--r-md)] bg-[var(--tint-1)] border border-[var(--border)] p-3 text-center">
                  <p className={`text-2xl font-bold ${item.className}`}>{item.value}</p>
                  <p className="text-[11px] text-[var(--text-muted)] mt-1">{item.label}</p>
                </div>
              ))}
            </div>

            <p className="text-xs text-[var(--text-muted)] bg-[var(--tint-1)] rounded-[var(--r-md)] px-4 py-2">
              الأعمدة التي تم التعرّف عليها تلقائياً:{' '}
              {preview.mapping.phone && <span className="text-emerald-300">الرقم: {preview.mapping.phone} </span>}
              {preview.mapping.name && <span className="text-[var(--brand)]">• الاسم: {preview.mapping.name} </span>}
              {preview.mapping.source && <span className="text-[var(--text)]">• المصدر: {preview.mapping.source} </span>}
              {!preview.mapping.phone && <span className="text-amber-400">لم يتم العثور على عمود أرقام واضح</span>}
            </p>

            <div className="max-h-64 overflow-y-auto rounded-[var(--r-md)] border border-[var(--border)] table-scroll">
              <table className="w-full text-sm">
                <thead className="bg-[var(--tint-1)] sticky top-0">
                  <tr className="text-[var(--text-muted)] text-xs">
                    <th className="py-2 px-3 text-right font-bold">الاسم</th>
                    <th className="py-2 px-3 text-right font-bold">الرقم بعد التنظيف</th>
                    <th className="py-2 px-3 text-right font-bold">المصدر</th>
                    <th className="py-2 px-3 text-right font-bold">الحالة</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.slice(0, 50).map((row, index) => (
                    <tr key={index} className="border-t border-[var(--border-soft)]">
                      <td className="py-2 px-3 text-[var(--text-strong)]">{row.name || <span className="text-[var(--text-dim)]">بدون اسم</span>}</td>
                      <td className="py-2 px-3 text-[var(--text)]" dir="ltr">{row.phone || row.rawPhone}</td>
                      <td className="py-2 px-3 text-[var(--text-muted)] text-xs">{row.source || '—'}</td>
                      <td className="py-2 px-3">
                        {row.invalid ? (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-red-500/20 text-red-400">رقم غير صالح</span>
                        ) : row.duplicate ? (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-400">مكرر</span>
                        ) : (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400">جديد</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {preview.rows.length > 50 && (
              <p className="text-[11px] text-[var(--text-dim)] text-center">معروض أول ٥٠ صفاً من إجمالي {preview.rows.length}</p>
            )}

            <div className="rounded-[var(--r-md)] bg-[var(--tint-1)] border border-[var(--border)] p-4 space-y-3">
              <p className="text-sm font-bold text-[var(--text-strong)]">توزيع الأرقام الجديدة</p>
              <div className="flex flex-col sm:flex-row gap-2">
                <button onClick={() => setMode('even')}
                  className={`flex-1 py-2.5 rounded-[var(--r-md)] font-bold text-sm border transition-colors ${mode === 'even' ? 'bg-[var(--brand-primary-softer)] border-[var(--brand-primary-soft)] text-[var(--text)]' : 'bg-[var(--tint-1)] border-[var(--border)] text-[var(--text-muted)]'}`}>
                  بالمناوبة على السيلز المختارين
                </button>
                <button onClick={() => setMode('single')}
                  className={`flex-1 py-2.5 rounded-[var(--r-md)] font-bold text-sm border transition-colors ${mode === 'single' ? 'bg-[var(--brand-primary-softer)] border-[var(--brand-primary-soft)] text-[var(--text)]' : 'bg-[var(--tint-1)] border-[var(--border)] text-[var(--text-muted)]'}`}>
                  كل الأرقام لشخص واحد
                </button>
              </div>

              {mode === 'even' ? (
                <div className="space-y-3">
                  <div className="flex flex-wrap gap-2">
                    {salesUsers.map((user: User) => (
                      <button key={user.id}
                        onClick={() => setSelectedIds((ids) => ids.includes(user.id) ? ids.filter((id) => id !== user.id) : [...ids, user.id])}
                        className={`px-3 py-2 rounded-[var(--r-sm)] text-xs font-bold border transition-colors ${selectedIds.includes(user.id) ? 'bg-emerald-500/20 border-emerald-400/40 text-emerald-300' : 'bg-[var(--tint-1)] border-[var(--border)] text-[var(--text-muted)]'}`}>
                        {selectedIds.includes(user.id) ? '✓ ' : '+ '}{user.name}
                      </button>
                    ))}
                    {salesUsers.length === 0 && <p className="text-xs text-amber-400">لا يوجد سيلز مفعّل — أنشئ حساب سيلز أولاً</p>}
                  </div>

                  {/* عدد الأرقام لكل سيلز — يحدده المدير بنفسه */}
                  <label className="flex items-center gap-2 text-xs font-bold text-[var(--text)] cursor-pointer">
                    <input type="checkbox" checked={useQuota} onChange={(e) => setUseQuota(e.target.checked)}
                      className="accent-blue-500 w-4 h-4" />
                    تحديد عدد الأرقام لكل سيلز بنفسي (بدل التوزيع بالتساوي)
                  </label>

                  {useQuota && (
                    <div className="rounded-[var(--r-md)] bg-[var(--tint-1)] border border-[var(--border)] p-3 space-y-2">
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <p className="text-[11px] text-[var(--text-muted)]">اكتب عدد الأرقام أمام كل سيلز — المتبقي لا يُوزَّع</p>
                        <div className="flex gap-1.5">
                          <button type="button" onClick={() => setQuotas({})}
                            className="text-[11px] px-2.5 py-1 rounded-[var(--r-sm)] bg-[var(--tint-1)] border border-[var(--border)] text-[var(--text)] hover:bg-[var(--tint-2)]">تصفير</button>
                          <button type="button"
                            onClick={() => {
                              // توزيع بالتساوي على المختارين فقط، على حسب الأرقام المتاحة
                              const ids = selectedIds.filter((id) => salesUsers.some((u: User) => u.id === id));
                              const each = ids.length ? Math.floor(preview.fresh / ids.length) : 0;
                              const next: Record<string, number> = {};
                              ids.forEach((id) => { next[id] = each; });
                              setQuotas(next);
                            }}
                            className="text-[11px] px-2.5 py-1 rounded-[var(--r-sm)] bg-[var(--brand-primary-softer)] border border-[var(--brand-primary-soft)] text-[var(--brand)] hover:bg-[var(--brand-primary-soft)]">
                            توزيع متساوٍ ({preview.fresh} رقم)
                          </button>
                        </div>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {salesUsers.filter((u: User) => selectedIds.includes(u.id)).map((user: User) => (
                          <div key={user.id} className="flex items-center gap-2 bg-[var(--tint-1)] rounded-[var(--r-sm)] px-2.5 py-1.5">
                            <span className="text-xs text-[var(--text)] flex-1 truncate">{user.name}</span>
                            <button type="button" onClick={() => setQuota(user.id, (quotas[user.id] || 0) - 5)}
                              className="w-6 h-6 rounded-[var(--r-xs)] bg-[var(--tint-1)] border border-[var(--border)] text-[var(--text)] hover:bg-[var(--tint-2)]">−</button>
                            <input type="number" min={0} value={quotas[user.id] ?? 0}
                              onChange={(e) => setQuota(user.id, Number(e.target.value))}
                              className="w-16 bg-[var(--tint-1)] border border-[var(--border)] rounded-[var(--r-xs)] px-2 py-1 text-xs text-[var(--text-strong)] text-center" dir="ltr" />
                            <button type="button" onClick={() => setQuota(user.id, (quotas[user.id] || 0) + 5)}
                              className="w-6 h-6 rounded-[var(--r-xs)] bg-[var(--tint-1)] border border-[var(--border)] text-[var(--text)] hover:bg-[var(--tint-2)]">+</button>
                          </div>
                        ))}
                      </div>
                      <p className={`text-[11px] font-bold ${totalQuota > preview.fresh ? 'text-red-400' : 'text-emerald-300'}`}>
                        الإجمالي المحدد: {totalQuota} من {preview.fresh} رقم{totalQuota > preview.fresh ? ' — أكبر من المتاح، سيُقلَّص تلقائياً' : ''}
                      </p>
                    </div>
                  )}
                </div>
              ) : (
                <select value={singleId} onChange={(e) => setSingleId(e.target.value)}
                  className="w-full bg-[var(--tint-1)] border border-[var(--border)] rounded-[var(--r-md)] px-4 py-3 text-[var(--text-strong)]">
                  {salesUsers.map((user: User) => (
                    <option key={user.id} value={user.id} className="bg-gray-900">{user.name}</option>
                  ))}
                </select>
              )}
            </div>

            <AnimatePresence>
              {error && (
                <motion.p initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                  className="text-red-400 text-sm bg-red-500/10 border border-red-500/20 rounded-[var(--r-md)] py-2 px-3 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0" /> {error}
                </motion.p>
              )}
            </AnimatePresence>

            <div className="flex gap-3">
              <button onClick={handleImport} disabled={preview.fresh === 0}
                className="flex-1 gradient-primary text-[var(--text-strong)] py-3 rounded-[var(--r-md)] font-bold flex items-center justify-center gap-2 glow-primary disabled:opacity-50 disabled:cursor-not-allowed">
                <Check className="w-5 h-5" /> استيراد {preview.fresh} رقم وتوزيعها
              </button>
              <button onClick={onClose} className="px-6 bg-[var(--tint-2)] text-[var(--text-strong)] py-3 rounded-[var(--r-md)] font-bold hover:bg-[var(--tint-3)] transition-colors">
                إلغاء
              </button>
            </div>
          </div>
        )}

        {/* الخطوة ٣: النتيجة */}
        {stage === 'done' && result && (
          <div className="space-y-5 text-center">
            <motion.div initial={{ scale: 0.7, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
              className="w-20 h-20 mx-auto gradient-success rounded-full flex items-center justify-center">
              <Check className="w-10 h-10 text-[var(--text-strong)]" />
            </motion.div>
            <div>
              <h3 className="text-xl font-bold text-[var(--text-strong)] mb-1">تم استيراد {result.imported} رقم</h3>
              <p className="text-sm text-[var(--text-muted)]">
                تم تجاهل {result.duplicates} رقم مكرر و{result.invalid} رقم غير صالح
              </p>
            </div>

            {result.perUser.length > 0 && (
              <div className="rounded-[var(--r-md)] bg-[var(--tint-1)] border border-[var(--border)] p-4 text-right">
                <p className="text-xs text-[var(--text-muted)] mb-2">التوزيع:</p>
                <div className="flex flex-wrap gap-2">
                  {result.perUser.map((item) => (
                    <span key={item.name} className="text-xs bg-[var(--brand-primary-softer)] text-[var(--text)] px-3 py-1 rounded-full">
                      {item.name}: {item.count}
                    </span>
                  ))}
                </div>
              </div>
            )}

            <p className="text-xs text-[var(--text-muted)]">
              الأرقام ظهرت الآن في تبويب «أرقام جديدة» لكل سيلز، وستصل لكل الأجهزة تلقائياً خلال ثانيتين.
            </p>

            <button onClick={onClose} className="w-full gradient-primary text-[var(--text-strong)] py-3 rounded-[var(--r-md)] font-bold">
              تم
            </button>
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}



function AddAssignedLeadModal({ users, currentUser, onClose, onSuccess }: any) {
  // السيلز مابيوزعش لنفسه على حد: الرقم اللي بيكتبه بينزل باسمه هو مباشرة،
  // فقائمة اختيار السيلز تختفي تماماً من حسابه (وقرار التوزيع يظل للإدارة).
  const isSalesAgent = currentUser?.role === 'sales';
  const [form, setForm] = useState({ name: '', phone: '', description: '', salesId: isSalesAgent ? currentUser.id : '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    const salesId = isSalesAgent ? currentUser.id : form.salesId;
    if (!salesId) {
      setError('اختر السيلز المسؤول عن الرقم');
      return;
    }
    setError('');
    setSaving(true);
    const leads = JSON.parse(localStorage.getItem('crm_assigned_leads') || '[]');
    const newLead: AssignedLead = {
      ...form,
      salesId,
      id: crypto.randomUUID(),
      adminId: currentUser.id,
      status: 'new',
      // رقم أضافه السيلز بنفسه (مش رقم كامبين) — فتبقى في تبويب «العملاء»
      manual: true,
      createdAt: new Date().toISOString()
    };
    localStorage.setItem('crm_assigned_leads', JSON.stringify([newLead, ...leads]));
    // لا نغلق النافذة قبل التأكد أن الرقم وصل للسيرفر — وإلا بقي على الجهاز وحده
    const ok = await pushKey('crm_assigned_leads');
    setSaving(false);
    onSuccess();
    if (!ok) {
      setError('الرقم اتحفظ على الجهاز ولم يوصل للسيرفر — جرّب مرة أخرى.');
      return;
    }
    onClose();
  };
  
  const salesUsers = users.filter((u: User) => ['sales', 'supervisor'].includes(effectiveRoleOf(u)));
  
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80" onClick={onClose}>
      <motion.div initial={{ scale: 0.9 }} animate={{ scale: 1 }} exit={{ scale: 0.9 }} className="panel p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-3 mb-6">
          <div className="page-intro"><div><h2>{isSalesAgent ? 'إضافة رقم جديد' : 'توزيع رقم جديد'}</h2></div></div>
          <button type="button" onClick={onClose} title="إغلاق"
            className="p-2 rounded-[var(--r-sm)] bg-[var(--tint-1)] hover:bg-[var(--tint-3)] transition-colors shrink-0">
            <X className="w-4 h-4 text-[var(--text)]" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <input type="text" placeholder="اسم العميل *" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full bg-[var(--tint-1)] border border-[var(--border)] rounded-[var(--r-md)] px-4 py-3 text-[var(--text-strong)]" required />
          <input type="tel" placeholder="رقم الهاتف *" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="w-full bg-[var(--tint-1)] border border-[var(--border)] rounded-[var(--r-md)] px-4 py-3 text-[var(--text-strong)]" dir="ltr" required />
          <textarea placeholder="وصف/ملاحظات" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="w-full bg-[var(--tint-1)] border border-[var(--border)] rounded-[var(--r-md)] px-4 py-3 text-[var(--text-strong)] resize-none h-20" />
          {isSalesAgent ? (
            <div className="flex items-center justify-between gap-2 rounded-[var(--r-md)] border border-[var(--brand-primary-soft)] bg-[var(--brand-primary-softer)] px-4 py-3">
              <span className="text-xs text-[var(--text-muted)]">الرقم هيضاف على اسمك</span>
              <b className="text-sm text-[var(--text-strong)]">{currentUser.name}</b>
            </div>
          ) : (
            <select value={form.salesId} onChange={(e) => setForm({ ...form, salesId: e.target.value })} className="w-full bg-[var(--tint-1)] border border-[var(--border)] rounded-[var(--r-md)] px-4 py-3 text-[var(--text-strong)]" required>
              <option value="" className="bg-gray-900">اختر السيلز</option>
              {salesUsers.map((u: User) => (
                <option key={u.id} value={u.id} className="bg-gray-900">{u.name}</option>
              ))}
            </select>
          )}
          {error && <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/30 rounded-[var(--r-md)] px-3 py-2">{error}</p>}
          <button type="submit" disabled={saving || (!isSalesAgent && !form.salesId)} className="w-full gradient-primary text-[var(--text-strong)] py-3 rounded-[var(--r-md)] font-bold disabled:opacity-60">
            {saving ? 'جارٍ الحفظ...' : isSalesAgent ? 'إضافة الرقم' : 'توزيع الرقم'}
          </button>
        </form>
      </motion.div>
    </motion.div>
  );
}

// User Feedback Modal - Show daily feedback for a user
// مراحل العملاء — تُعرَّف مرة واحدة في أعلى الملف وتُستخدم في الفيدباك والمراحل وقائمة العملاء

// ===== تجميع فيدباك أي سيلز: رقم ← كومنتاته (مصدر واحد يستخدمه كل مكان عند الإدارة) =====
// يجمع من: خط العملاء الزمني + سجل المكالمات + الأرقام الواردة، ويشيل التكرار.
const normPhone = (value: any) => normalizeDigits(String(value || '')).replace(/\D/g, '');

function salesFeedbackByNumber(userId: string, clients: any[], leads: any[] = [], callLogs: any[] = [], userName = '') {
  type Item = { id: string; text: string; at: string; kind: string; status: string };
  const map = new Map<string, { key: string; name: string; phone: string; source: string; stage: string; incoming: boolean; items: Item[] }>();
  const norm = normPhone;

  const ensure = (key: string, base: any) => {
    if (!map.has(key)) {
      map.set(key, {
        key,
        name: base.name || 'عميل بدون اسم',
        phone: base.phone || '',
        source: base.source || base.status || '',
        stage: base.stage || '',
        incoming: !!base.incoming,
        items: [],
      });
    }
    return map.get(key)!;
  };

  // عملاؤه — وفيدباكه المكتوب على عميل مسجَّل باسم حساب تاني.
  // الفيدباك يُنسب لكاتبه (activity.by) لا لصاحب العميل: كان كومنت المندوب على
  // عميل مسجَّل باسم الإدارة يظهر كأن الإدارة كتبته ولا يظهر في كارت المندوب إطلاقاً.
  // مطابقة اسم الكاتب بعد توحيد الحروف والمسافات (كانت المقارنة الحرفية تُضيّع
  // كومنتات السيلز لو الاسم مكتوب بشكل مختلف بمسافة أو همزة)
  const normName = (v: any) => normalizeArabicText(String(v || '')).replace(/\s+/g, ' ').trim();
  const myName = normName(userName);
  for (const c of clients || []) {
    const isOwner = c.userId === userId || c.assignedTo === userId;
    // كلام المندوب فقط: لا لوجات (اتصال/واتساب/تذكير) ولا كومنت مكرر.
    // النسبة: صاحب العميل، أو معرّف الكاتب، أو اسمه (بعد التوحيد).
    const acts = (Array.isArray(c.activities) ? c.activities : []).filter((a: any) => {
      if (!isCommentActivity(a)) return false;
      if (isOwner) return true;
      if (a.authorId && String(a.authorId) === String(userId)) return true;
      return !!myName && normName(a.by) === myName;
    });
    if (!isOwner && !acts.length) continue;
    const entry = ensure(norm(c.phone) || `id:${c.id}`, { ...c, incoming: false });
    for (const a of acts) {
      const text = cleanCommentText(a.text);
      // نص نتيجة الاتصال (No answer / تم الرد) كومنت حقيقي — ما يتشالش
      if (!text || (isSystemOnlyText(text) && !isCallResultText(text))) continue;
      entry.items.push({ id: a.id, text, at: a.at, kind: 'كومنت', status: a.status || '' });
    }
  }

  // أرقام واردة من الإدارة ولم تُحوَّل لعميل بعد
  for (const l of leads || []) {
    if (l.salesId !== userId) continue;
    const key = norm(l.phone) || `lead:${l.id}`;
    if (!map.has(key)) ensure(key, { name: l.name, phone: l.phone, source: 'رقم وارد من الإدارة', incoming: true });
  }

  // سجل المكالمات: فيه كلام المندوب بنفسه (نص المكالمة) — وده مصدر الكومنتات
  // القديمة. لوج بس (من غير كلام) ما بيظهرش؛ ونفس الكومنت بيتدمج مرة واحدة.
  for (const l of callLogs || []) {
    const mine =
      String(l?.salesId || '') === String(userId || '') ||
      (!!userName && String(l?.salesName || '').trim() === String(userName).trim());
    if (!mine) continue;
    const text = cleanCommentText(l?.comment);
    if (!text || (isSystemOnlyText(text) && !isCallResultText(text))) continue;
    const key = norm(l?.clientPhone) || `log:${l?.id}`;
    const entry = ensure(key, {
      name: l?.clientName,
      phone: l?.clientPhone,
      source: 'مكالمة',
      incoming: false,
    });
    entry.items.push({
      id: `log-${l?.id}`,
      text,
      at: String(l?.createdAt || ''),
      kind: 'مكالمة',
      status: l?.result === 'answered' ? 'follow-up' : 'no-answer',
    });
  }

  // إزالة التكرار (نفس النص في نفس الدقيقة) + الترتيب من الأحدث
  for (const entry of map.values()) {
    entry.items = dedupeComments(entry.items).sort((a, b) => String(b.at).localeCompare(String(a.at)));
  }

  // **كل** أرقام المندوب تتعرض — حتى اللي عليها كلام ولا لسه. الحساب اللي عنده
  // أرقام كثيرة وما كتبش عليها فيدباك كان يظهر «0 رقم» في لوحة الإدارة، فيبدو
  // كأنه بلا شغل أصلاً. الأرقام اللي عليها كومنت تفضل الأول (الأحدث)، والباقي بعدها.
  const all = Array.from(map.values());
  return all.sort((a, b) => {
    if (!!a.items.length !== !!b.items.length) return a.items.length ? -1 : 1;
    const ta = Date.parse(a.items[0]?.at || '') || 0;
    const tb = Date.parse(b.items[0]?.at || '') || 0;
    if (ta !== tb) return tb - ta;
    return String(a.name || '').localeCompare(String(b.name || ''), 'ar');
  });
}

// ===== بطاقات «الفيدباك اليومي» تُضاف لأرقام السيلز =====
// بعض الفيدباك يُحفظ في بطاقة الفيدباك فقط (بلا حدث على العميل، أو على رقم مسجّل
// باسم حساب آخر)، فكان لا يظهر للإدارة خالص. هذا يُكمّل الأرقام ببطاقات كاتبها.
type FeedbackNumber = {
  key: string;
  name: string;
  phone: string;
  source: string;
  stage: string;
  incoming: boolean;
  items: Array<{ id: string; text: string; at: string; kind: string; status: string }>;
};

function mergeDailyFeedbackCards(
  nums: FeedbackNumber[],
  userId: string,
  dailyFeedbacks: any[] = []
): FeedbackNumber[] {
  for (const card of dailyFeedbacks || []) {
    if (!card || card.userId !== userId || !String(card.feedback || '').trim()) continue;
    // نص النظام الآلي (لوج) ما بيظهرش — كلام السيلز بس
    const cardText = cleanCommentText(card.feedback);
    if (!cardText || (isSystemOnlyText(cardText) && !isCallResultText(cardText))) continue;
    const key = normPhone(card.clientPhone) || `fb:${card.id}`;
    let target: FeedbackNumber | undefined = nums.find((n: FeedbackNumber) => n.key === key);
    if (!target) {
      target = {
        key,
        name: card.clientName || 'عميل بدون اسم',
        phone: card.clientPhone || '',
        source: 'فيدباك',
        stage: '',
        incoming: false,
        items: [],
      };
      nums.push(target);
    }
    const at = card.date || card.createdAt;
    const dup = target.items.some(
      (item: FeedbackNumber['items'][number]) =>
        cleanCommentText(item.text) === cardText && String(item.at).slice(0, 16) === String(at).slice(0, 16)
    );
    if (!dup) target.items.push({ id: card.id, text: cardText, at, kind: 'فيدباك', status: card.status || '' });
  }
  for (const number of nums)
    number.items.sort((a: FeedbackNumber['items'][number], b: FeedbackNumber['items'][number]) =>
      String(b.at).localeCompare(String(a.at))
    );
  return nums;
}

// ===== صفحة فيدباك السيلز عند الإدارة (٣ مستويات) =====
// اسم السيلز ← صفحة كاملة بأرقامه ← اضغط الرقم ← فيدباكه منظّماً تحت بعضه
function UserFeedbackModal({ user, clients, leads = [], callLogs = [], dailyFeedbacks = [], onClose }: any) {
  const [openNumber, setOpenNumber] = useState<string | null>(null);
  const [q, setQ] = useState('');

  const norm = normPhone;

  // كل رقم يمتلكه هذا السيلز، ومعاه كومنتاته مرتبة من الأحدث للأقدم
  const numbers = useMemo(
    () => mergeDailyFeedbackCards(salesFeedbackByNumber(user.id, clients, leads, callLogs, user.name), user.id, dailyFeedbacks),
    [user.id, user.name, clients, leads, callLogs, dailyFeedbacks]
  );

  const totalComments = numbers.reduce((acc, n) => acc + n.items.length, 0);
  const withComments = numbers.filter((n) => n.items.length).length;
  const current = openNumber ? numbers.find((n) => n.key === openNumber) : null;

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return numbers;
    const digits = norm(term);
    return numbers.filter(
      (n) => String(n.name).toLowerCase().includes(term) || (!!digits && norm(n.phone).includes(digits))
    );
  }, [numbers, q]);

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-black/80" onClick={onClose}>
      <motion.div initial={{ scale: 0.96, y: 10 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.96 }} className="panel p-4 sm:p-6 w-full max-w-4xl h-[92vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        {/* رأس الصفحة: اسم السيلز أو الرقم المفتوح */}
        <div className="flex items-center justify-between gap-3 pb-4 border-b border-[var(--border)]">
          <div className="flex items-center gap-3 min-w-0">
            {current ? (
              <button onClick={() => setOpenNumber(null)} title="رجوع للأرقام"
                className="p-2 rounded-[var(--r-md)] bg-[var(--tint-1)] hover:bg-[var(--tint-3)] text-[var(--text)] shrink-0">
                <ChevronRight className="w-5 h-5" />
              </button>
            ) : (
              <div className="w-11 h-11 gradient-primary rounded-full flex items-center justify-center shrink-0">
                <span className="text-[var(--text-strong)] font-bold">{user.name[0]}</span>
              </div>
            )}
            <div className="min-w-0">
              <h2 className="text-lg sm:text-xl font-bold gradient-text truncate">
                {current ? current.name : user.name}
              </h2>
              <p className="text-xs text-[var(--text-muted)] truncate" dir={current ? 'ltr' : 'rtl'}>
                {current
                  ? current.phone || 'بدون رقم'
                  : `${numbers.length} رقم • ${withComments} رقم فيه فيدباك • ${totalComments} كومنت`}
              </p>
            </div>
          </div>
          <button onClick={onClose} title="إغلاق" className="p-2 hover:bg-[var(--tint-2)] rounded-[var(--r-sm)] shrink-0">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* المستوى الأول: أرقامه */}
        {!current && (
          <div className="flex-1 overflow-y-auto pt-4 space-y-3">
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ابحث بالاسم أو الرقم…"
              className="w-full bg-[var(--tint-1)] border border-[var(--border)] rounded-[var(--r-md)] px-4 py-2.5 text-[var(--text-strong)] text-sm" />
            {filtered.length === 0 && (
              <div className="text-center py-16">
                <Users className="w-14 h-14 text-[var(--text-dim)] mx-auto mb-3" />
                <p className="text-[var(--text-muted)] text-sm">لا توجد أرقام لهذا الحساب بعد</p>
              </div>
            )}
            {filtered.map((n) => (
              <button key={n.key} onClick={() => setOpenNumber(n.key)}
                className="w-full text-right fb-card st-list-row flex items-center gap-3 p-3">
                <span className="fb-avatar">{(n.name || '؟').trim().charAt(0)}</span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2 flex-wrap">
                    <b className="fb-name truncate">{n.name}</b>
                    {n.incoming && <span className="st-chip">🔵 رقم وارد</span>}
                    {!n.incoming && n.stage && STAGE_META[n.stage] && (
                      <span className={STAGE_META[n.stage].cls}>{STAGE_META[n.stage].icon} {STAGE_META[n.stage].label}</span>
                    )}
                  </span>
                  <span className="block text-[11.5px] text-[var(--text-muted)] mt-0.5" dir="ltr">{n.phone || '—'}</span>
                  {n.items[0] && (
                    <span className="block text-[11px] text-[var(--text-muted)] mt-1 truncate">
                      آخر فيدباك: {String(n.items[0].text).replace(/^(فيدباك:|من المكالمة:)\s*/, '')}
                    </span>
                  )}
                </span>
                <span className={`fb-count ${n.items.length ? '' : 'opacity-50'}`}>{n.items.length} كومنت</span>
                <ChevronLeft className="w-4 h-4 text-[var(--text-dim)] shrink-0" />
              </button>
            ))}
          </div>
        )}

        {/* المستوى الثاني: فيدباك الرقم منظّماً */}
        {current && (
          <div className="flex-1 overflow-y-auto pt-4">
            <div className="flex flex-wrap items-center gap-2 mb-4">
              {current.source && <span className="st-chip">{current.source}</span>}
              <span className="st-chip"> {current.items.length} كومنت</span>
              {current.phone && <a href={`tel:${current.phone}`} className="st-chip text-emerald-300"> اتصال</a>}
              <WhatsAppButton name={current.name} label="واتساب" phones={[current.phone]} />
            </div>
            {current.items.length === 0 ? (
              <div className="text-center py-12">
                <MessageSquare className="w-14 h-14 text-[var(--text-dim)] mx-auto mb-3" />
                <p className="text-[var(--text-muted)] text-sm">لا يوجد فيدباك على هذا الرقم بعد</p>
              </div>
            ) : (
              <div className="fb-card">
                <div className="fb-head">
                  <span className="fb-avatar">{(current.name || '؟').trim().charAt(0)}</span>
                  <span className="fb-who">
                    <b className="fb-name">{current.name}</b>
                    <span className="fb-phone" dir="ltr">{current.phone}</span>
                  </span>
                  <span className="fb-count">{current.items.length} كومنت</span>
                </div>
                <div className="fb-body">
                  {current.items.map((item) => (
                    <div key={item.id} className="fb-row">
                      <div className="min-w-0 flex-1">
                        <p className="fb-text">{String(item.text).replace(/^(فيدباك:|من المكالمة:)\s*/, '')}</p>
                        <p className="fb-meta">
                          {item.kind} • {formatDateTime(item.at)}{item.status ? ` • ${item.status}` : ''}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}

// أيقونة كل نوع حدث في الخط الزمني
const ACTIVITY_ICONS: Record<string, string> = {
  created: '🆕', stage: '🎯', reminder: '', feedback: '',
  whatsapp: '', call: '', public: '🔗', note: '',
};

function ClientDetailModal({ client, users = [], onClose, onSuccess, onCall, callLogs = [] }: any) {
  const activities: ClientActivity[] = client.activities || [];
  // فيدباك العميل وكومنتاته — تظهر هنا لحظة الضغط على الكارت (بدل ما تفضل مخفية)
  // كلام المندوب فقط: لا لوجات (اتصال/واتساب/تذكير) ولا كومنت مكرر.
  const feedbackEntries = useMemo(() => {
    const digits = normalizeDigits(String(client?.phone || '')).replace(/\D/g, '');
    const list: Array<{ id: string; text: string; type: string; by?: string; at: string; status?: string }> = [];
    for (const a of commentActivitiesOf(client)) {
      list.push({
        id: `act-${a.id}`,
        text: a.text,
        type: String(a.type || 'comment'),
        by: a.by,
        at: a.at,
        status: a.status,
      });
    }
    // سجل المكالمات: كلام المندوب عن العميل (نص المكالمة) — اللوج بس ما بيظهرش
    for (const log of callLogs || []) {
      const logPhone = normalizeDigits(String(log?.clientPhone || '')).replace(/\D/g, '');
      if (!digits || logPhone !== digits) continue;
      const text = cleanCommentText(log?.comment);
      if (!text || isSystemOnlyText(text)) continue;
      list.push({
        id: `log-${log?.id}`,
        text,
        type: 'call',
        by: String(log?.salesName || ''),
        at: String(log?.createdAt || ''),
        status: log?.result === 'answered' ? 'follow-up' : 'no-answer',
      });
    }
    // الأحدث أولاً — ونفس الكومنت مرة واحدة بس
    return dedupeComments(list)
      .sort((a: any, b: any) => String(b.at).localeCompare(String(a.at)))
      .slice(0, 12);
  }, [client, callLogs]);
  const logActivity = (type: string, text: string) => {
    addClientActivity(client.id, type, text);
    onSuccess?.();
  };
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80" onClick={onClose}>
      <motion.div initial={{ scale: 0.9 }} animate={{ scale: 1 }} exit={{ scale: 0.9 }} className="panel p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="page-intro"><div><h2>{client.name}</h2></div></div>
        <div className="space-y-3">
          <p className="text-[var(--text)]" dir="ltr">{client.phone}</p>
          {client.property && <p className="text-[var(--text)]">{client.property}</p>}
          <p className="text-[var(--text)]">
            الميزانية: <span className="text-emerald-400 font-bold">{displayPrice(client.budget)}</span>
          </p>
          {client.monthlyInstallment && (
            <p className="text-[var(--text)]">
              القسط الشهري: <span className="text-[var(--text-muted)] font-bold">{displayPrice(client.monthlyInstallment)}</span>
            </p>
          )}
          {client.source && <p className="text-xs text-[var(--text-muted)]">المصدر: {client.source}</p>}
        </div>

        <div className="mt-4">
          <h3 className="text-sm font-bold text-[var(--text-strong)] mb-2 flex items-center gap-2">
            <MessageSquare className="w-4 h-4" /> فيدباك العميل وكومنتاته
            <span className="text-[11px] text-[var(--text-dim)]">({feedbackEntries.length})</span>
          </h3>
          {feedbackEntries.length === 0 ? (
            <p className="text-xs text-[var(--text-dim)] bg-[var(--tint-1)] rounded-[var(--r-md)] px-3 py-2.5">
              لسه مفيش فيدباك أو كومنت مسجّل — اكتب كومنت من علامة + جنب اسم الفورم.
            </p>
          ) : (
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {feedbackEntries.map((a) => (
                <div key={a.id} className="bg-[var(--tint-1)] rounded-[var(--r-md)] px-3 py-2">
                  <p className="text-xs text-[var(--text)] whitespace-pre-line">{a.text}</p>
                  <p className="text-[10.5px] text-[var(--text-dim)] mt-1 flex items-center gap-2 flex-wrap">
                    <FeedbackChip status={a.status} />
                    {a.type === 'comment' && <span className="text-[var(--brand)] font-bold">كومنت</span>}
                    {commentAuthorName(a, users) && (
                      <span className="font-bold text-[var(--text-muted)]">{commentAuthorName(a, users)}</span>
                    )}
                    <span dir="ltr">{formatDateTime(a.at)}</span>
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="flex flex-col sm:flex-row gap-2 mt-5">
          <button type="button"
            onClick={() => { logActivity('call', 'تم فتح الاتصال بالعميل'); onCall?.(); }}
            className="flex-1 bg-[var(--tint-2)] hover:bg-[var(--tint-3)] text-[var(--text-strong)] py-3 rounded-[var(--r-md)] font-bold flex items-center justify-center gap-2">
            <PhoneCall className="w-4 h-4" /> الاتصال بالعميل
          </button>
          <WhatsAppButton name={client.name} label="واتساب"
            className="flex-1 justify-center py-3 text-sm rounded-[var(--r-md)]"
            phones={[client.phone, ...(client.phones || [])]}
            onOpened={() => logActivity('whatsapp', 'تم فتح واتساب وإرسال رسالة للعميل')} />
        </div>

        <button onClick={onClose} className="w-full mt-4 bg-[var(--tint-2)] text-[var(--text-strong)] py-3 rounded-[var(--r-md)] font-bold">إغلاق</button>
      </motion.div>
    </motion.div>
  );
}

function PropertyDetailModal({ property, users, onClose, onSuccess }: any) {
  const owner = users?.find((u: User) => u.id === property.userId);
  const images: string[] = Array.isArray(property.images) ? property.images.filter(Boolean) : [];
  const [active, setActive] = useState(0);
  const [copied, setCopied] = useState<'idle' | 'ok' | 'fail'>('idle');
  const shareUrl = publicPropertyUrl(property.id);
  const mapQuery = property.latitude && property.longitude ? `${property.latitude},${property.longitude}` : property.location;
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80" onClick={onClose}>
      <motion.div initial={{ scale: 0.9 }} animate={{ scale: 1 }} exit={{ scale: 0.9 }} className="panel p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="page-intro"><div><h2>{property.name}</h2></div></div>
        <div className="space-y-3">
          {images.length > 0 && (
            <div>
              <img src={images[Math.min(active, images.length - 1)]} alt={property.name} className="w-full h-56 object-cover rounded-[var(--r-xl)]" />
              {images.length > 1 && (
                <div className="flex gap-2 mt-2 overflow-x-auto pb-1">
                  {images.map((src, i) => (
                    <button key={i} type="button" onClick={() => setActive(i)}
                      className={`shrink-0 w-16 h-16 rounded-[var(--r-sm)] overflow-hidden border-2 ${i === active ? 'border-[var(--brand)]' : 'border-transparent opacity-70 hover:opacity-100'}`}>
                      <img src={src} alt={`صورة ${i + 1}`} className="w-full h-full object-cover" />
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          <p className="text-[var(--text)]">{property.type}{property.area ? ` • ${property.area}م` : ''}</p>
          {property.location && <p className="text-[var(--text)]"> {property.location}</p>}
          <p className="text-[var(--text-muted)] font-bold">السعر: {displayPrice(property.price)} ج.م</p>
          <p className="text-[var(--text)]">
            أضافه: <span className="text-[var(--brand)] font-bold">{owner?.name || 'عضو محذوف'}</span>
            {property.createdAt && <span className="text-xs text-[var(--text-dim)]"> • {formatDateTime(property.createdAt)}</span>}
          </p>
          {property.clientName && <p className="text-[var(--text)]">العميل: {property.clientName}</p>}
          {property.clientPhone && <p className="text-[var(--text)]" dir="ltr">{property.clientPhone}</p>}
          {property.clientPhone2 && (
            <p className="text-[var(--text)]" dir="ltr">
              {property.clientPhone2}
              <span className="text-[11px] text-[var(--text-dim)] mr-2">رقم إضافي</span>
            </p>
          )}
          {(property.clientPhone || property.clientPhone2) && (
            <div className="flex flex-col sm:flex-row gap-2 pt-1">
              <WhatsAppButton name={property.clientName} label="واتساب للعميل"
                className="justify-center py-2.5 text-sm"
                phones={[property.clientPhone, property.clientPhone2]} />
            </div>
          )}
          {property.description && (
            <div className="bg-[var(--tint-1)] rounded-[var(--r-md)] px-3 py-2.5">
              <p className="text-xs text-[var(--text-dim)] mb-1"> ملاحظات العقار</p>
              <p className="text-[var(--text)] text-sm whitespace-pre-line">{property.description}</p>
            </div>
          )}
          {mapQuery && (
            <div className="rounded-[var(--r-md)] overflow-hidden border border-[var(--border)]">
              <iframe title="خريطة العقار" className="w-full h-48" loading="lazy"
                src={`https://www.google.com/maps?q=${encodeURIComponent(mapQuery)}&z=15&output=embed`} />
              <a href={`https://www.google.com/maps?q=${encodeURIComponent(mapQuery)}`} target="_blank" rel="noopener noreferrer"
                className="block text-center text-xs text-[var(--brand)] bg-[var(--tint-1)] py-2"> افتح في خرائط جوجل</a>
            </div>
          )}
          <div className="bg-[var(--tint-1)] rounded-[var(--r-md)] px-3 py-2.5">
            <p className="text-xs text-[var(--text-dim)] mb-1">🔗 رابط عام للعقار — شاركه مع أي عميل، يسجّل رقمه ويصل عندك كـ ليد</p>
            <p className="text-[11px] text-[var(--text-muted)] break-all" dir="ltr">{shareUrl}</p>
            <div className="flex flex-col sm:flex-row gap-2 mt-2">
              <button type="button"
                onClick={async () => {
                  const ok = await copyText(shareUrl);
                  setCopied(ok ? 'ok' : 'fail');
                  setTimeout(() => setCopied('idle'), 2200);
                }}
                className="flex-1 bg-[var(--tint-2)] hover:bg-[var(--tint-3)] text-[var(--text-strong)] py-2.5 rounded-[var(--r-sm)] font-bold text-sm">
                {copied === 'ok' ? ' تم نسخ الرابط' : copied === 'fail' ? 'انسخه يدوياً من الأعلى' : ' نسخ الرابط'}
              </button>
              <a href={`https://wa.me/?text=${encodeURIComponent(`${property.name} — ${property.type}${property.area ? ` • ${property.area}م` : ''}\n${property.price ? `السعر: ${property.price}\n` : ''}${shareUrl}`)}`}
                target="_blank" rel="noopener noreferrer"
                className="flex-1 bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/30 text-emerald-200 py-2.5 rounded-[var(--r-sm)] font-bold text-sm text-center">
                 مشاركة واتساب
              </a>
            </div>
          </div>
        </div>
        <button onClick={onClose} className="w-full mt-6 bg-[var(--tint-2)] text-[var(--text-strong)] py-3 rounded-[var(--r-md)] font-bold">إغلاق</button>
      </motion.div>
    </motion.div>
  );
}

function UserDetailModal({ user, currentUser, onClose, onSuccess }: any) {
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80" onClick={onClose}>
      <motion.div initial={{ scale: 0.9 }} animate={{ scale: 1 }} exit={{ scale: 0.9 }} className="panel p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="page-intro"><div><h2>{user.name}</h2></div></div>
        <div className="space-y-3">
          <p className="text-[var(--text)]">@{user.username}</p>
          <p className="text-[var(--text)]">{user.role}</p>
        </div>
        <button onClick={onClose} className="w-full mt-6 bg-[var(--tint-2)] text-[var(--text-strong)] py-3 rounded-[var(--r-md)] font-bold">إغلاق</button>
      </motion.div>
    </motion.div>
  );
}

function TeamDetailModal({ team, users, currentUser, onClose, onSuccess }: any) {
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80" onClick={onClose}>
      <motion.div initial={{ scale: 0.9 }} animate={{ scale: 1 }} exit={{ scale: 0.9 }} className="panel p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="page-intro"><div><h2>{team.name}</h2></div></div>
        <div className="space-y-3">
          <p className="text-[var(--text)]">المشرف: {team.supervisorName}</p>
          <p className="text-[var(--text)]">عدد الأعضاء: {team.memberIds.length}</p>
        </div>
        <button onClick={onClose} className="w-full mt-6 bg-[var(--tint-2)] text-[var(--text-strong)] py-3 rounded-[var(--r-md)] font-bold">إغلاق</button>
      </motion.div>
    </motion.div>
  );
}

export default App;
