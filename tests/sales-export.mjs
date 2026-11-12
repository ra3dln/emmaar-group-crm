// ===== تبويب «تصدير الأرقام»: شيت السيلز والعملاء والفيدباك =====
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const app = fs.readFileSync(path.join(root, '..', 'src/App.tsx'), 'utf8');

const { buildSalesExportRows, exportSheet, EXCEL_CELL_LIMIT } = await import('../src/salesExport.ts');
const { buildXlsxBook, readXlsx } = await import('../src/xlsx.ts');

let passed = 0;
const check = (name, ok, extra = '') => {
  assert.ok(ok, `✗ ${name} ${extra}`);
  passed++;
  console.log(`✓ ${name}`);
};

const users = [{ id: 'u1', name: 'Haidy' }, { id: 'u2', name: 'Hassan' }, { id: 'a1', name: 'الإدارة' }];
const clients = [
  {
    id: 'c1', userId: 'u1', name: 'منى سامي', phone: '01000000001', phones: ['01200000001'],
    activities: [
      { id: 'a1', type: 'feedback', text: 'طلبت معاينة', status: 'follow-up', at: '2026-11-02T10:00:00.000Z', by: 'Haidy' },
      { id: 'a0', type: 'created', text: 'تمت إضافة العميل', at: '2026-11-01T09:00:00.000Z' },
    ],
  },
  { id: 'c2', userId: '', name: 'من غير صاحب', phone: '01000000002', activities: [] },
];
const leads = [
  { id: 'l1', salesId: 'u2', name: 'كريم', phone: '01000000003', status: 'new' },
  { id: 'l2', salesId: 'u1', name: 'منى (رقم اتحوّل لعميل)', phone: '01000000001', status: 'new' },
  { id: 'l3', salesId: '', name: 'مش موزّع', phone: '01000000004', status: 'new' },
];
const cards = [
  { id: 'f1', clientPhone: '01000000001', userId: 'u1', feedback: 'طلبت معاينة', status: 'follow-up', createdAt: '2026-11-02T10:00:00.000Z' },
  { id: 'f2', clientPhone: '01000000003', userId: 'u2', feedback: 'No answer', status: 'no-answer', createdAt: '2026-11-03T10:00:00.000Z' },
];
const logs = [{ id: 'g1', clientPhone: '01000000001', salesId: 'a1', comment: 'اتكلمت معاها الإدارة', createdAt: '2026-11-04T10:00:00.000Z' }];

const rows = buildSalesExportRows({ users, clients, leads, cards, logs });
check('رقم لكل سيلز: عميل Haidy + رقم Hassan (من غير المكرر والمش موزّع)', rows.length === 2, JSON.stringify(rows.map((r) => r.name)));
const mona = rows.find((r) => r.name === 'منى سامي');
check('اسم السيلز واسم العميل', mona?.sales === 'Haidy');
check('الرقم ومعاه الرقم التاني', mona?.phone === '01000000001 / 01200000001');
const lines = (mona?.feedback || '').split('\n');
check('الفيدباك كامل من كل المصادر ومن غير تكرار', lines.length === 2, mona?.feedback);
check('من الأقدم للأحدث وفيه الكاتب والحالة', /Haidy: طلبت معاينة \[Follow Up\]$/.test(lines[0]) && /الإدارة: اتكلمت معاها الإدارة$/.test(lines[1]), mona?.feedback);
check('«No answer» بيظهر في الفيدباك', /No answer \[No Answer\]/.test(rows.find((r) => r.name === 'كريم')?.feedback || ''));
check('نص أطول من حد إكسل بيتقص', buildSalesExportRows({
  users, clients: [{ id: 'c9', userId: 'u1', name: 'x', phone: '010', activities: Array.from({ length: 500 }, (_, i) => ({ id: `k${i}`, type: 'feedback', text: 'ك'.repeat(100) + i, at: `2026-11-01T10:${String(i % 60).padStart(2, '0')}:00.000Z` })) }],
})[0].feedback.length <= EXCEL_CELL_LIMIT);

// ملف حقيقي: ورقة للكل + ورقة لكل سيلز، والفيدباك بيلف على سطور
const blob = buildXlsxBook([exportSheet('كل السيلز', 'أرقام', rows), exportSheet('Haidy', 'أرقام Haidy', rows.filter((r) => r.salesId === 'u1'))]);
const table = await readXlsx(await blob.arrayBuffer());
check('الأعمدة بالظبط: اسم السيلز / اسم العميل / الرقم / الفيدباك', table[1].join('|') === 'اسم السيلز|اسم العميل|الرقم|الفيدباك', table[1].join('|'));
check('الفيدباك متعدد السطور بيتقرا زي ما هو من الملف', table.some((row) => row[3] === mona.feedback));

// الفورم لكل صف (للفلتر) + كومنت الإدارة على رقم لسه ما اتحوّلش لعميل
const withForm = buildSalesExportRows({
  users,
  leads: [{ id: 'lf', salesId: 'u2', name: 'نادر', phone: '01000000009', status: 'new', formName: 'GO ADS', comment: 'كلمه بعد العصر', commentBy: 'الإدارة', commentAt: '2026-11-12T09:00:00.000Z' }],
});
check('كل صف معاه اسم الفورم ومفتاح للاختيار', withForm[0].form === 'GO ADS' && withForm[0].key === 'l:lf');
check('كومنت الإدارة على الرقم ظاهر في الفيدباك', /الإدارة: كلمه بعد العصر/.test(withForm[0].feedback), withForm[0].feedback);
const view = fs.readFileSync(path.join(root, '..', 'src/SalesExportView.tsx'), 'utf8');
check(
  'فلتر الفورم والسيلز والبحث + اختيار عملاء بعينهم',
  /الفورم \(عملاء كامبين\)/.test(view) && /تنزيل المختارين/.test(view) && /تنزيل المعروض/.test(view) && /type="checkbox"/.test(view)
);

check(
  'تبويب «تصدير الأرقام» للإدارة',
  /id: 'admin-export', icon: Download, label: 'تصدير الأرقام'/.test(app) && /activeTab === 'admin-export' && currentUser\.role === 'admin' && <SalesExportView/.test(app)
);

console.log(`\n✅ نجحت ${passed} فحوصات (تصدير الأرقام)`);
