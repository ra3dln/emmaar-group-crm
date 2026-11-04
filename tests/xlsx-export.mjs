// ===== اختبار ملف Excel (.xlsx) المُولَّد =====
// يتحقق أن الملف ZIP صحيح، وفيه أجزاء XLSX المطلوبة، والقيم العربية والأرقام والدمج.
// التشغيل: node tests/xlsx-export.mjs
import assert from 'node:assert/strict';

const { buildXlsx, buildXlsxBook } = await import('../src/xlsx.ts');

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

// ===== ملف بأكتر من ورقة: «الملخص» + «الأيام» (شمال ليمين ومتثبّت) =====
const unzip = async (b) => {
  const u8 = new Uint8Array(await b.arrayBuffer());
  const dv = new DataView(u8.buffer);
  const out = new Map();
  let at = 0;
  while (at + 30 <= u8.length && dv.getUint32(at, true) === 0x04034b50) {
    const size = dv.getUint32(at + 18, true);
    const nameLen = dv.getUint16(at + 26, true);
    const extraLen = dv.getUint16(at + 28, true);
    const name = decoder.decode(u8.slice(at + 30, at + 30 + nameLen));
    const start = at + 30 + nameLen + extraLen;
    out.set(name, decoder.decode(u8.slice(start, start + size)));
    at = start + size;
  }
  return out;
};
const book = await unzip(buildXlsxBook([
  { sheetName: 'الملخص', rows },
  {
    sheetName: 'الأيام',
    rows: [['تفاصيل الأيام'], ['التاريخ', 'اليوم', 'أحمد'], ['2026-10-01', 'الخميس', '10:05 - 18:00']],
    rightToLeft: false,
    freeze: { rows: 2, cols: 2 },
  },
]));
check('ورقتين في الملف', book.has('xl/worksheets/sheet1.xml') && book.has('xl/worksheets/sheet2.xml'));
check('اسم الورقتين في workbook', /name="الملخص"[\s\S]*name="الأيام"/.test(book.get('xl/workbook.xml')));
check('الورقتين متسجّلين في الأنواع والعلاقات',
  book.get('[Content_Types].xml').includes('/xl/worksheets/sheet2.xml') &&
    book.get('xl/_rels/workbook.xml.rels').includes('Target="worksheets/sheet2.xml"') &&
    book.get('xl/_rels/workbook.xml.rels').includes('Id="rId3"'));
const daysSheet = book.get('xl/worksheets/sheet2.xml');
check('ورقة الأيام شمال ليمين (التاريخ على الشمال)', !daysSheet.includes('rightToLeft="1"') && book.get('xl/worksheets/sheet1.xml').includes('rightToLeft="1"'));
check('التاريخ وأسماء السيلز متثبّتين وقت التمرير', daysSheet.includes('xSplit="2" ySplit="2" topLeftCell="C3"') && daysSheet.includes('state="frozen"'));
check('الورقة الأولى بس هي المختارة', book.get('xl/worksheets/sheet1.xml').includes('tabSelected="1"') && !daysSheet.includes('tabSelected'));

console.log(`\n✅ كل اختبارات تصدير Excel نجحت (${passed}).`);
