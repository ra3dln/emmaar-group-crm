// ===== اختبار: الكومنت ينزل مع الرقم على المندوب =====
// القاعدة: كل رقم ينزل على سيلز ينزل بالكومنت اللي اتكتب عليه — حتى لو الكومنت
// كان من مندوب تاني أو من مندوب اتمسح حسابه (فبطاقته ما هتشوف لحدّ).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let passed = 0;
let failed = 0;
const check = (name, condition, extra = '') => {
  if (condition) {
    passed++;
    console.log(`✓ ${name}`);
  } else {
    failed++;
    console.log(`✗ ${name}${extra ? ` — ${extra}` : ''}`);
  }
};

const { commentsByPhone } = await import('../shared/comments.js');
const { buildLeadClients } = await import('../shared/leadClients.js');

// ===== ١) فهرس آخر كلام على الرقم =====
const index = commentsByPhone(
  [
    { id: 'c1', clientPhone: '01011112222', feedback: 'قالى اتواصل معاه الساعة 8', date: '2026-10-24T12:25', userId: 'ghost-1', status: 'follow-up' },
    { id: 'c2', clientPhone: '01033334444', feedback: 'تليفونه مغلق', date: '2026-10-25T10:00', userId: 'u2' },
    { id: 'c3', clientPhone: '01011112222', feedback: 'كلام أقدم', date: '2026-10-20T10:00', userId: 'ghost-1' },
  ],
  [
    { id: 'l1', clientPhone: '01055556666', comment: 'من المكالمة: مردش هكلمه تانى', at: '2026-10-26T09:18' },
  ]
);
check('الفهرس بيجمع البطاقات', index.get('01011112222')?.text === 'قالى اتواصل معاه الساعة 8', JSON.stringify(index.get('01011112222')));
check('الفهرس بياخد آخر كلام على الرقم', index.get('01011112222')?.at === '2026-10-24T12:25');
check('الفهرس بياخد الحالة', index.get('01011112222')?.status === 'follow-up');
check('سجلات المكالمات في الفهرس', index.get('01055556666')?.text === 'مردش هكلمه تانى', JSON.stringify(index.get('01055556666')));
check('رقم مالوش كلام مش في الفهرس', !index.has('01099998888'));
check('نص النظام الآلي مش كلام', !commentsByPhone([{ clientPhone: '010', feedback: 'No answer' }]).has('010'));

// ===== ٢) العميل الجديد (رقم نزل على مندوب) بينزل بالكومنت =====
const comments = commentsByPhone([
  { clientPhone: '01011112222', feedback: 'قالى اتواصل معاه الساعة 8 بعد الشغل', date: '2026-10-24T12:25', userId: 'ghost-1', status: 'follow-up' },
]);
const created = buildLeadClients({
  leads: [{ id: 'l1', phone: '01011112222', name: 'أحمد', salesId: 'u-haidy', description: 'استيراد تلقائي' }],
  clients: [],
  at: '2026-10-27T09:00:00.000Z',
  by: 'الإدارة',
  comments,
});
check('الرقم الموزّع بيتحوّل عميل', created.length === 1 && created[0].id === 'crm-lead-01011112222', JSON.stringify(created.map((c) => c.id)));
check('العميل الجديد خد الكومنت', created[0]?.feedback === 'قالى اتواصل معاه الساعة 8 بعد الشغل', JSON.stringify(created[0]?.feedback));
check('الكومنت في الخط الزمني', (created[0]?.activities || []).some((a) => a.type === 'feedback' && a.text === 'قالى اتواصل معاه الساعة 8 بعد الشغل'));
check('العميل لسه مالهوش كومنتات مكررة', (created[0]?.activities || []).filter((a) => a.type === 'feedback').length === 1);
check('العميل الجديد من غير كومنت: خانة الفيدباك فاضية', buildLeadClients({ leads: [{ id: 'l2', phone: '01022223333', salesId: 'u' }], clients: [] })[0]?.feedback === '');

// ===== ٣) الواجهة: التوزيع بينقل الكومنت مع الرقم =====
const app = fs.readFileSync(path.join(root, 'src/App.tsx'), 'utf8');
check('التوزيع بيجمع كومنتات كل الأرقام', /commentsByPhone\(dailyFeedbacks, callLogs\)/.test(app));
check('العميل بياخد الكومنت الناقص في خطه', /const noteActivity = note && !hasNote/.test(app));
check('خانة الفيدباك بتتحدّث بالكومنت', /feedback: note\?\.text \|\| c\.feedback/.test(app));
check('العميل الجديد بياخد الكومنت معاه', /comments: phoneComments/.test(app));
check('بطاقة الفيدباك بتنتقل لصاحب الرقم', /return \{ \.\.\.card, userId: owner \}/.test(app));

// ===== ٤) حذف الحساب ما يمسحش الأرقام ولا الكومنتات =====
const deleteBlock = app.slice(app.indexOf('const handleDeleteUser'), app.indexOf('const handleDeleteUser') + 5200);
// المسار الافتراضي (من غير «حذف بياناته نهائياً»): الأرقام ترجع غير مخصصة
const defaultPath = deleteBlock.slice(deleteBlock.indexOf('} else {'));
check('حذف الحساب: الأرقام ترجع «غير مخصصة»', /salesId: '', assignedAt: now/.test(defaultPath));
check('حذف الحساب: العميل يرجع بلا مالك', /userId: '', assignedTo: '', updatedAt: now/.test(defaultPath));
check('حذف الحساب: بطاقات الفيدباك بتفضل محفوظة', !/\.filter\(\(f: DailyFeedback\) => f\.userId !== userId\)/.test(defaultPath));
check('حذف الحساب: التذكيرات بتتشال', /crm_reminders/.test(defaultPath));
check('حذف الحساب: المحذوف يتشال من قواعد التوزيع التلقائي', /rule\.salesIds\.filter\(\(id\) => id !== userId\)/.test(defaultPath));
check('حذف نهائي (اختياري): لسه بيمسح الأرقام والكومنتات', /\.filter\(\(f: DailyFeedback\) => f\.userId !== userId\)/.test(deleteBlock));

console.log(`\n${failed ? '❌' : '✅'} نجحت ${passed} فحوصات${failed ? ` — فشل ${failed}` : ''}`);
if (failed) process.exit(1);
