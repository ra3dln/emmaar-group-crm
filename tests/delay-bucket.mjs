// ===== خانة «Delay» في لوحة الأرقام =====
//
// القاعدة: الرقم يدخل Delay لو عليه تذكير فات وقته والمندوب ما اتصرفش بعده
// (نفس شارة «اتأخر» الصفرا = alertMap). خانة إضافية: الرقم بيفضل في خانته
// الأصلية كمان، وبيخرج من Delay أول ما المندوب يتصل أو يكتب كومنت.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const read = (rel) => fs.readFileSync(path.join(root, '..', rel), 'utf8');

const app = read('src/App.tsx');
const css = read('src/index.css');

const { isDelayedNumber, buildWorkNumbers } = await import('../src/feedbackBuckets.ts');
const { alertMapOf, leadAlertState } = await import('../src/reminders.ts');

let passed = 0;
const check = (name, ok, extra = '') => {
  if (ok) {
    passed++;
    console.log(`✓ ${name}`);
  } else {
    console.error(`✗ ${name}${extra ? ` — ${extra}` : ''}`);
    process.exit(1);
  }
};

const NOW = Date.parse('2026-10-29T12:00:00.000Z');
const HOUR = 3600 * 1000;
const iso = (ms) => new Date(ms).toISOString();

const reminder = (over = {}) => ({
  id: 'r1',
  userId: 'u1',
  clientId: '',
  clientName: 'عميل',
  clientPhone: '',
  dateTime: iso(NOW - HOUR),
  note: 'متابعة',
  isCompleted: false,
  isDelayed: false,
  delayCount: 0,
  createdAt: iso(NOW - 3 * HOUR),
  ...over,
});

// نفس طريقة App.tsx في بناء alertMap: العملاء الأول، وبعدين الأرقام الموزّعة
const buildAlertMap = (clients, leads, reminders, callLogs) => {
  const map = alertMapOf(clients, reminders, callLogs, NOW);
  for (const lead of leads) {
    const state = leadAlertState(lead, reminders, callLogs, NOW);
    if (!state.needsAction) continue;
    const key = String(lead.phone).replace(/[^\d]/g, '');
    if (key && !map.has(key)) map.set(key, String(state.dueAt || ''));
  }
  return map;
};

const lateClient = { id: 'c1', name: 'متأخر', phone: '01001111111', stage: 'contacted', activities: [] };
const actedClient = { id: 'c2', name: 'اتصرف', phone: '01002222222', stage: 'contacted', activities: [] };
const futureClient = { id: 'c3', name: 'لسه', phone: '01003333333', stage: 'contacted', activities: [] };
const commentedClient = {
  id: 'c4', name: 'كتب كومنت', phone: '01004444444', stage: 'meeting',
  activities: [{ id: 'a1', type: 'feedback', text: 'كلمته', status: 'meeting', at: iso(NOW - 30 * 60 * 1000) }],
};
const lateLead = { id: 'l1', name: 'رقم موزّع', phone: '01005555555', status: 'viewed', salesId: 'u1' };
const calledLead = { id: 'l2', name: 'رقم اتكلم', phone: '01006666666', status: 'viewed', salesId: 'u1' };

const reminders = [
  reminder({ id: 'r1', clientId: 'c1', clientPhone: lateClient.phone }),
  reminder({ id: 'r2', clientId: 'c2', clientPhone: actedClient.phone }),
  reminder({ id: 'r3', clientId: 'c3', clientPhone: futureClient.phone, dateTime: iso(NOW + HOUR) }),
  reminder({ id: 'r4', clientId: 'c4', clientPhone: commentedClient.phone }),
  reminder({ id: 'r5', clientPhone: lateLead.phone }),
  reminder({ id: 'r6', clientPhone: calledLead.phone }),
  // تذكير متكمّل (مقفول) مش تأخير
  reminder({ id: 'r7', clientPhone: '01007777777', isCompleted: true }),
];
const callLogs = [
  { id: 'k1', clientPhone: actedClient.phone, result: 'answered', createdAt: iso(NOW - HOUR / 2) },
  { id: 'k2', clientPhone: calledLead.phone, result: 'no-answer', createdAt: iso(NOW - HOUR / 2) },
];

const clients = [lateClient, actedClient, futureClient, commentedClient];
const leads = [lateLead, calledLead, { id: 'l3', name: 'مقفول', phone: '01007777777', status: 'viewed', salesId: 'u1' }];
const alertMap = buildAlertMap(clients, leads, reminders, callLogs);

// ===== منطق الخانة =====
check('عميل عليه تذكير فات ومن غير خطوة → Delay', isDelayedNumber(lateClient, alertMap) === true);
check('عميل اتصل بيه بعد التذكير → مش Delay', isDelayedNumber(actedClient, alertMap) === false);
check('تذكير لسه وقته ما جاش → مش Delay', isDelayedNumber(futureClient, alertMap) === false);
check('كومنت بعد التذكير بيخرّج الرقم من Delay', isDelayedNumber(commentedClient, alertMap) === false);
check('رقم موزّع (مش عميل) تذكيره فات → Delay', isDelayedNumber(lateLead, alertMap) === true);
check('رقم موزّع اتصل بيه بعد التذكير (حتى لو لم يرد) → مش Delay', isDelayedNumber(calledLead, alertMap) === false);
check('تذكير متكمّل مش تأخير', isDelayedNumber({ phone: '01007777777' }, alertMap) === false);
check('الرقم بأرقام عربية بيتطابق', isDelayedNumber({ phone: '٠١٠٠١١١١١١١' }, alertMap) === true);
check('رقم فاضي → مش Delay', isDelayedNumber({ phone: '' }, alertMap) === false);
check('من غير alertMap → مش Delay (ما يوقعش)', isDelayedNumber(lateClient, undefined) === false && isDelayedNumber(lateClient, null) === false);

// ===== خانة إضافية: الرقم بيفضل في خانته الأصلية =====
const numbers = buildWorkNumbers(clients, leads, new Map());
const lateRow = numbers.find((n) => n.phone === lateClient.phone);
check('الرقم المتأخر بيفضل في خانته الأصلية (Follow Up)', lateRow?.bucket === 'follow-up', lateRow?.bucket);
const delayedCount = numbers.filter((n) => isDelayedNumber(n, alertMap)).length;
check('عدد Delay = الرقمين المتأخرين بس', delayedCount === 2, String(delayedCount));

// ===== الواجهة: العدّاد + الفلتر + اللون =====
check('Delay ليها كارت في لوحة الأرقام', /\{\s*id:\s*DELAY_ID,\s*label:\s*'Delay',\s*cls:\s*'fs-delay'\s*\}/.test(app));
check('Delay في شريط الفلاتر بعد Cold Calls', /COLD_CALL_ID,\s*DELAY_ID,\s*SHARED_ID,\s*'follow-up'/.test(app));
check('عدّاد اللوحة بيحسب Delay من alertMap', /card\.id === DELAY_ID\s*\?\s*delayed/.test(app) && /isDelayedNumber\(record, alertMap\)/.test(app));
check('الرئيسية بتستلم alertMap', /<DashboardView[^>]*alertMap=\{alertMap\}/.test(app));
check('فلتر Delay في صفحة الأرقام', /filter === DELAY_ID\) list = list\.filter\(\(row\) => row\.delayed\)/.test(app));
check('عدّاد Delay إضافي (مش بيغيّر status الرقم)', /if \(row\.delayed\) map\[DELAY_ID\]/.test(app));
check('لون Delay = لون شارة «اتأخر»', /\.fs-delay\s*\{\s*--fs:\s*var\(--warn\);\s*\}/.test(css));

console.log(`\n${passed} checks passed — delay bucket`);
