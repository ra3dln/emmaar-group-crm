// ===== اختبار ملف Excel (.xlsx) المُولَّد =====
// يتحقق أن الملف ZIP صحيح، وفيه أجزاء XLSX المطلوبة، والقيم العربية والأرقام والدمج.
// التشغيل: node tests/xlsx-export.mjs
import assert from 'node:assert/strict';

const { buildXlsx } = await import('../src/xlsx.ts');

let passed = 0;
const check = (label, condition, extra = '') => {
  assert.ok(condition, `✗ ${label} ${extra}`);
  passed += 1;
  console.log(`✓ ${label}`);
};

const rows = [
  ['تقرير الحضور الشهري — أكتوبر ٢٠٢٦'],
  ['بداية الدوام 10:00 • سماحية 30 دقيقة • نهاية الدوام 18:00'],
  ['السيلز', 'أيام الحضور', 'أيام التأخير'],
  ['أحمد سيلز', 20, 3],
  ['الإجمالي', 20, 3],
];
const blob = buildXlsx({
  sheetName: 'الحضور',
  rows,
  headerRows: [3],
  titleRows: [1],
  columnWidths: [22, 12, 12],
  merges: ['A1:C1', 'A2:C2', 'A5:C5'],
});

check('نوع الملف هو xlsx', String(blob.type).includes('spreadsheetml.sheet'), blob.type);
check('الملف غير فارغ', blob.size > 1000, `size=${blob.size}`);

// قارئ ZIP مبسّط (الملفات مخزّنة بلا ضغط)
const bytes = new Uint8Array(await blob.arrayBuffer());
const view = new DataView(bytes.buffer);
const decoder = new TextDecoder('utf-8');
const entries = new Map();
let offset = 0;
while (offset + 30 <= bytes.length && view.getUint32(offset, true) === 0x04034b50) {
  const method = view.getUint16(offset + 8, true);
  const size = view.getUint32(offset + 18, true);
  const nameLength = view.getUint16(offset + 26, true);
  const extraLength = view.getUint16(offset + 28, true);
  const name = decoder.decode(bytes.slice(offset + 30, offset + 30 + nameLength));
  const start = offset + 30 + nameLength + extraLength;
  entries.set(name, { method, data: bytes.slice(start, start + size) });
  offset = start + size;
}

check('ملف ZIP صحيح', entries.size >= 6, `entries=${entries.size}`);
check('طريقة التخزين store', [...entries.values()].every((entry) => entry.method === 0));
for (const name of [
  '[Content_Types].xml',
  '_rels/.rels',
  'xl/workbook.xml',
  'xl/_rels/workbook.xml.rels',
  'xl/styles.xml',
  'xl/worksheets/sheet1.xml',
]) {
  check(`يحتوي ${name}`, entries.has(name));
}

const sheet = decoder.decode(entries.get('xl/worksheets/sheet1.xml').data);
const workbook = decoder.decode(entries.get('xl/workbook.xml').data);
const contentTypes = decoder.decode(entries.get('[Content_Types].xml').data);

check('الورقة تعرض من اليمين لليسار', sheet.includes('rightToLeft="1"'));
check('العنوان العربي موجود كنص', sheet.includes('تقرير الحضور الشهري'));
check('اسم السيلز العربي موجود', sheet.includes('أحمد سيلز'));
check('الأرقام كخلايا رقمية', sheet.includes('<v>20</v>') && sheet.includes('<v>3</v>'));
check('الخلايا النصية inlineStr', sheet.includes('t="inlineStr"'));
check('الدمج موجود', sheet.includes('<mergeCell ref="A1:C1"/>'));
check('اسم الورقة في workbook', workbook.includes('name="الحضور"'));
check('نوع المحتوى xlsx', contentTypes.includes('spreadsheetml.sheet.main+xml'));

console.log(`\n✅ كل اختبارات تصدير Excel نجحت (${passed}).`);
