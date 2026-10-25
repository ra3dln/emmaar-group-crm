// ===== فحوصات «محتاج إجراء»: التذكير فات موعده والمندوب مخدش خطوة =====
// الكارت بيتلوّن أصفر (في كل المراحل) لحد ما المندوب يتصرف، وبعدها يرجع
// لونه الأصلي. ولون «follow up» مبقاش أصفر (الأصفر = طلب إجراء).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const read = (rel) => fs.readFileSync(path.join(root, '..', rel), 'utf8');

const app = read('src/App.tsx');
const css = read('src/index.css');

const { clientActionState, alertMapOf, leadAlertState } = await import('../src/reminders.ts');

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

// ===== ١) الحالة الأساسية =====
check(
  'تذكير فات موعده والمندوب مخدش خطوة → محتاج إجراء',
  clientActionState(client(), [
    { id: 'r1', clientId: 'c1', clientPhone: '01001234567', dateTime: iso(NOW - HOUR), createdAt: iso(NOW - 3 * HOUR), isCompleted: false },
  ], [], NOW).needsAction === true
);
check(
  'تذكير لسه ما عداش → مش محتاج إجراء',
  clientActionState(client(), [
    { id: 'r1', clientId: 'c1', clientPhone: '01001234567', dateTime: iso(NOW + HOUR), createdAt: iso(NOW - HOUR), isCompleted: false },
  ], [], NOW).needsAction === false
);
check(
  'تذكير مكمّل → مش محتاج إجراء',
  clientActionState(client(), [
    { id: 'r1', clientId: 'c1', clientPhone: '01001234567', dateTime: iso(NOW - HOUR), createdAt: iso(NOW - 3 * HOUR), isCompleted: true },
  ], [], NOW).needsAction === false
);
check(
  'مفيش تذكير أصلاً → مش محتاج إجراء',
  clientActionState(client(), [], [], NOW).needsAction === false
);

// ===== ٢) الإجراء يرجّع اللون =====
check(
  'كومنت بعد التذكير → رجع للوضع الطبيعي',
  clientActionState(
    client({ activities: [{ id: 'a1', type: 'feedback', text: 'كلمني', at: iso(NOW - HOUR / 2) }] }),
    [{ id: 'r1', clientId: 'c1', clientPhone: '01001234567', dateTime: iso(NOW - HOUR), createdAt: iso(NOW - 3 * HOUR), isCompleted: false }],
    [],
    NOW
  ).needsAction === false
);
check(
  'مكالمة بعد التذكير → رجع للوضع الطبيعي',
  clientActionState(
    client(),
    [{ id: 'r1', clientId: 'c1', clientPhone: '01001234567', dateTime: iso(NOW - HOUR), createdAt: iso(NOW - 3 * HOUR), isCompleted: false }],
    [{ id: 'l1', clientPhone: '01001234567', createdAt: iso(NOW - HOUR / 2) }],
    NOW
  ).needsAction === false
);
check(
  'الكومنت اللي قبل التذكير مش إجراء (التذكير لسه مفتوح)',
  clientActionState(
    client({ activities: [{ id: 'a1', type: 'feedback', text: 'كلمني', at: iso(NOW - 4 * HOUR) }] }),
    [{ id: 'r1', clientId: 'c1', clientPhone: '01001234567', dateTime: iso(NOW - HOUR), createdAt: iso(NOW - 3 * HOUR), isCompleted: false }],
    [],
    NOW
  ).needsAction === true
);

// ===== ٢ب) أكثر من تذكير فات على نفس العميل: الأحدث هو الحكم =====
// كان يُختار الأقدم، فأي إجراء بعد التذكير الأول يلغي كل التذكيرات اللي بعده —
// فلا يظهر «اتأخر» أبداً في حساب فيه متابعات متكررة (شكوى حساب mohamed).
const repeated = [
  { id: 'old', clientId: 'c1', clientPhone: '01001234567', dateTime: iso(NOW - 2 * HOUR), createdAt: iso(NOW - 4 * HOUR), isCompleted: false },
  { id: 'new', clientId: 'c1', clientPhone: '01001234567', dateTime: iso(NOW - HOUR), createdAt: iso(NOW - 30 * 60 * 1000), isCompleted: false },
];
check(
  'إجراء بعد التذكير القديم لا يلغي التذكير الأحدث → محتاج إجراء',
  clientActionState(
    client({ activities: [{ id: 'a1', type: 'feedback', text: 'كلمني', at: iso(NOW - 3 * HOUR) }] }),
    repeated,
    [{ id: 'l1', clientPhone: '01001234567', createdAt: iso(NOW - 3 * HOUR) }],
    NOW
  ).needsAction === true
);
check(
  'إجراء بعد أحدث تذكير → رجع للوضع الطبيعي',
  clientActionState(
    client({ activities: [{ id: 'a1', type: 'feedback', text: 'كلمني', at: iso(NOW - 10 * 60 * 1000) }] }),
    repeated,
    [],
    NOW
  ).needsAction === false
);
check(
  'الرقم الموزّع بنفس القاعدة (الأحدث هو الحكم)',
  leadAlertState(
    { id: 'l1', phone: '01001234567' },
    repeated,
    [{ id: 'lg', clientPhone: '01001234567', createdAt: iso(NOW - 3 * HOUR) }],
    NOW
  ).needsAction === true
);

// ===== ٣) المطابقة بالرقم (التذكير على رقم، والعميل بمعرّف مختلف) =====
check(
  'التذكير بيتطابق بالرقم كمان (الرقم واحد في مكان واحد)',
  clientActionState(
    client({ id: 'other-id' }),
    [{ id: 'r1', clientId: 'x', clientPhone: '01001234567', dateTime: iso(NOW - HOUR), createdAt: iso(NOW - 3 * HOUR), isCompleted: false }],
    [],
    NOW
  ).needsAction === true
);

// ===== ٤) الخريطة للواجهة =====
const map = alertMapOf(
  [client(), client({ id: 'c2', phone: '01009998888' })],
  [
    { id: 'r1', clientId: 'c1', clientPhone: '01001234567', dateTime: iso(NOW - HOUR), createdAt: iso(NOW - 3 * HOUR), isCompleted: false },
  ],
  [],
  NOW
);
check('الخريطة فيها الرقم المحتاج إجراء فقط', map.size === 1 && map.has('01001234567'));
check('وقت التذكير محفوظ في الخريطة', map.get('01001234567') === iso(NOW - HOUR));

// ===== ٥) الرقم الموزّع (مش عميل) =====
check(
  'رقم موزّع عليه تذكير فات → محتاج إجراء',
  leadAlertState(
    { id: 'l1', phone: '01005556666' },
    [{ id: 'r9', clientPhone: '01005556666', dateTime: iso(NOW - HOUR), createdAt: iso(NOW - 3 * HOUR), isCompleted: false }],
    [],
    NOW
  ).needsAction === true
);
check(
  'رقم موزّع اتصلنا بيه بعد التذكير → رجع طبيعي',
  leadAlertState(
    { id: 'l1', phone: '01005556666' },
    [{ id: 'r9', clientPhone: '01005556666', dateTime: iso(NOW - HOUR), createdAt: iso(NOW - 3 * HOUR), isCompleted: false }],
    [{ id: 'lg', clientPhone: '01005556666', createdAt: iso(NOW - HOUR / 2) }],
    NOW
  ).needsAction === false
);

// ===== ٦) الألوان: follow up مبقاش أصفر، والأصفر = طلب إجراء =====
check('«follow up» مبقاش أصفر', /\.fs-follow\s*\{\s*--fs:\s*var\(--followup\)/.test(css));
check('الأصفر مخصّص للتنبيه (fs-alert)', /\.fs-alert\s*\{\s*--fs:\s*var\(--warn\)/.test(css));
check('في متغيّر لون follow up', /--followup:\s*#e4548c/.test(css));
check('مصدر «خارجي» مش أصفر (يبقى واضح إنه مش تنبيه)', /\.client-card\.src-external\s*\{\s*--src:\s*var\(--external\)/.test(css));
check('الكارت بيتلوّن أصفر لما يطلب إجراء', /\.client-card\.cc-alert\s*\{/.test(css));
check('في شارة «اتأخر» على الكارت', /\.cc-alert-badge\s*\{/.test(css));

// ===== ٧) الربط في الواجهة =====
check('الكارت بياخد حالة التنبيه', /alertMap\?\.get\(digitsOfPhone\(client\?\.phone\)\)/.test(app));
check('الكارت بيضيف كلاس التنبيه', /needsAction \? 'cc-alert' : ''/.test(app));
check('شارة «اتأخر» على كارت العميل', /cc-alert-badge/.test(app));
check('شارة الحالة بتتحوّل لأصفر مع التنبيه', /\$\{alert \? 'fs-alert' : meta\.cls\}/.test(app));
check('كارت رقم ENGAZ كمان بيطلب إجراء', /eg-card \$\{alert \? 'cc-alert' : ''\}/.test(app));
check('نبضة كل ٣٠ ثانية عشان اللون يتغيّر في وقته', /setInterval\(\(\) => setNowTick\(Date\.now\(\)\), 30000\)/.test(app));

console.log(`\n✅ نجحت ${passed} فحوصات (محتاج إجراء: التذكير اللي فات + رجوع اللون)`);
