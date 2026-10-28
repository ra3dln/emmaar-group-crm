// ===== «الإجراء القادم»: موعد محدد (يوم + ساعة) على كارت كل عميل =====
//
// الفكرة: المندوب يختار في الفيدباك «يوم + ساعة» للإجراء القادم، فيُكتب على
// كارت العميل: «الإجراء القادم: يوم كذا الساعة كذا».
// التنفيذ: الاختيار بيبني تذكيراً (نفس نظام «محتاج إجراء»)، فالموعد يبان على
// الكارت، ولما يجي وقته من غير خطوة → «اتأخر».
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const read = (rel) => fs.readFileSync(path.join(root, '..', rel), 'utf8');

const app = read('src/App.tsx');
const css = read('src/index.css');
const types = read('src/types.ts');

const { nextActionOf, nextActionMapOf, buildNextActionReminder } = await import('../src/nextAction.ts');

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

const NOW = Date.parse('2026-10-25T12:00:00.000Z');
const HOUR = 3600 * 1000;
const iso = (ms) => new Date(ms).toISOString();

const client = (over = {}) => ({
  id: 'c1',
  name: 'عميل',
  phone: '01001234567',
  stage: 'contacted',
  activities: [],
  ...over,
});

const reminder = (over = {}) => ({
  id: 'r1',
  clientId: 'c1',
  clientName: 'عميل',
  clientPhone: '01001234567',
  dateTime: iso(NOW + 2 * HOUR),
  note: 'إجراء قادم',
  isCompleted: false,
  isDelayed: false,
  delayCount: 0,
  createdAt: iso(NOW - HOUR),
  ...over,
});

// ===== ١) بناء التذكير (شكله زي أي تذكير في النظام) =====
const built = buildNextActionReminder({
  id: 'na-1',
  userId: 's1',
  clientId: 'c1',
  clientName: 'عميل',
  clientPhone: '01001234567',
  at: iso(NOW + 3 * HOUR),
  note: 'إجراء قادم',
  createdAt: iso(NOW),
});
check(
  'بناء تذكير «الإجراء القادم» بنفس شكل التذكير العادي',
  built.id === 'na-1' &&
    built.userId === 's1' &&
    built.clientId === 'c1' &&
    built.clientPhone === '01001234567' &&
    built.dateTime === iso(NOW + 3 * HOUR) &&
    built.isCompleted === false &&
    built.isDelayed === false &&
    built.delayCount === 0
);

// ===== ٢) الإجراء القادم على الكارت =====
check(
  'مفيش تذكير → مفيش إجراء قادم على الكارت',
  nextActionOf(client(), [], [], NOW) === null
);
check(
  'تذكير قادم → الإجراء القادم يبان بالموعد (يوم + ساعة)',
  (() => {
    const a = nextActionOf(client(), [reminder()], [], NOW);
    return !!a && a.at === iso(NOW + 2 * HOUR) && a.overdue === false;
  })()
);
check(
  'أقرب موعد هو المعروض (مش الأبعد)',
  (() => {
    const a = nextActionOf(
      client(),
      [reminder({ id: 'r2', dateTime: iso(NOW + 5 * HOUR) }), reminder({ id: 'r1', dateTime: iso(NOW + HOUR) })],
      [],
      NOW
    );
    return !!a && a.at === iso(NOW + HOUR);
  })()
);
check(
  'تذكير مكمّل (اتنفّذ) → مفيش إجراء قادم',
  nextActionOf(client(), [reminder({ isCompleted: true })], [], NOW) === null
);

// ===== ٣) الموعد اللي فات =====
check(
  'موعد فات والمندوب ما اتصرفش → «اتأخر» (يبان على الكارت)',
  (() => {
    const a = nextActionOf(client(), [reminder({ dateTime: iso(NOW - HOUR) })], [], NOW);
    return !!a && a.overdue === true && a.at === iso(NOW - HOUR);
  })()
);
check(
  'موعد فات والمندوب اتصرف (كومنت بعده) → السطر بيختفي',
  nextActionOf(
    client({ activities: [{ id: 'a1', type: 'comment', text: 'اتصلت', at: iso(NOW - 30 * 60 * 1000) }] }),
    [reminder({ dateTime: iso(NOW - HOUR), createdAt: iso(NOW - 2 * HOUR) })],
    [],
    NOW
  ) === null
);

// ===== ٤) الخريطة: مفتاحها رقم العميل (تتطابق مع الكارت في كل الشاشات) =====
const map = nextActionMapOf(
  [client(), client({ id: 'c2', phone: '01009998888' })],
  [reminder()],
  [],
  NOW
);
check(
  'الخريطة بتتطابق مع أرقام العملاء',
  map.get('01001234567')?.at === iso(NOW + 2 * HOUR) &&
    map.get('01009998888') === undefined &&
    map.size === 1
);

// ===== ٥) الربط في الواجهة =====
check(
  'الواجهة تحسب الخريطة وتمررها للكارت',
  /const nextActionMap = nextActionMapOf\(scopedClients, scopedReminders, scopedCallLogs, nowTick\)/.test(app) &&
    /nextActionMap=\{nextActionMap\}/.test(app)
);
check(
  'صندوق الفيدباك على الكارت فيه اختيار «يوم + ساعة»',
  /type="datetime-local"[\s\S]{0,400}nextActionAt/.test(app) &&
    /setNextActionAt\(e\.target\.value\)/.test(app)
);
check(
  'نافذة «إضافة فيدباك» فيها اختيار «يوم + ساعة» كمان',
  /الإجراء القادم \(يوم \+ ساعة\)/.test(app)
);
check(
  'الكارت يعرض سطر «الإجراء القادم» باليوم والساعة',
  /className=\{`cc-next \$\{nextAction\.overdue \? 'is-late' : ''\}`\}/.test(app) &&
    /cc-next-time/.test(app) &&
    /formatDateTime\(nextAction\.at\)/.test(app)
);
check(
  'اختيار الموعد يبني تذكيراً (نفس نظام «محتاج إجراء»)',
  /const addNextActionReminder = \(/.test(app) &&
    /buildNextActionReminder\(\{/.test(app) &&
    /localStorage\.setItem\('crm_reminders'/.test(app)
);
check(
  'الحفظ ينتظر رفع التذكير للسيرفر (pushKey) — مفيش سجل على جهاز واحد',
  /nextReminder \? pushKey\('crm_reminders'\) : Promise\.resolve\(true\)/.test(app)
);
check(
  'الموعد بيتحفظ كـ ISO على بطاقة الفيدباك',
  /nextActionAt: new Date\(form\.nextActionAt\)\.toISOString\(\)/.test(app) &&
    /nextActionAt\?: string;/.test(types)
);
check('التصميم موجود (سطر الإجراء + حقل الاختيار)', /\.cc-next \{/.test(css) && /\.fc-next-input \{/.test(css));
check(
  'اختصارات سريعة: اليوم / بكرة / بعد غد',
  /nextActionQuickValue = \(kind: 'today' \| 'tomorrow' \| 'dayAfter'\)/.test(app) &&
    /setNextActionAt\(nextActionQuickValue\('today'\)\)/.test(app) &&
    /setForm\(\{ \.\.\.form, nextActionAt: nextActionQuickValue\('tomorrow'\) \}\)/.test(app)
);

console.log(`\n✅ نجحت ${passed} فحوصات لـ«الإجراء القادم».`);
