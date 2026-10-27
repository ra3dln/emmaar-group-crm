// ===== اختبار: «عملاء كامبين» — إضافة عميل يدوي + رفع أي شيت =====
// الطلب:
//  ١) في تبويب «عملاء كامبين» عايز إضافة عميل يدوي.
//  ٢) رفع أي شيت يفلتر فيه اسم الشخص ورقمه.
// التشغيل: node tests/admin-clients-import.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';

const { buildXlsx, readXlsx } = await import('../src/xlsx.ts');
const { buildPreview, readSheetTable, normalizeEgyptPhone } = await import('../src/leadImport.ts');

let passed = 0;
const check = (label, condition, extra = '') => {
  assert.ok(condition, `✗ ${label} ${extra}`);
  passed += 1;
  console.log(`✓ ${label}`);
};

// ===== ١) قراءة ملف إكسل حقيقي (ZIP مضغوط) =====
const enc = new TextEncoder();
// أرشيف ZIP بطريقة deflate (زي ملفات إكسل الحقيقية) —CRC مش مهم للقارئ
const zipDeflate = async (files) => {
  const parts = [];
  const central = [];
  let offset = 0;
  for (const file of files) {
    const name = enc.encode(file.name);
    const raw = enc.encode(file.content);
    const compressed = new Uint8Array(
      await new Response(
        new Blob([raw]).stream().pipeThrough(new CompressionStream('deflate-raw'))
      ).arrayBuffer()
    );
    const local = new Uint8Array(30 + name.length);
    const dv = new DataView(local.buffer);
    dv.setUint32(0, 0x04034b50, true);
    dv.setUint16(4, 20, true);
    dv.setUint16(8, 8, true); // deflate
    dv.setUint32(18, compressed.length, true);
    dv.setUint32(22, raw.length, true);
    dv.setUint16(26, name.length, true);
    local.set(name, 30);
    parts.push(local, compressed);
    central.push({ name, compSize: compressed.length, size: raw.length, offset });
    offset += local.length + compressed.length;
  }
  const cdParts = [];
  let cdSize = 0;
  for (const entry of central) {
    const head = new Uint8Array(46 + entry.name.length);
    const dv = new DataView(head.buffer);
    dv.setUint32(0, 0x02014b50, true);
    dv.setUint16(10, 8, true);
    dv.setUint32(20, entry.compSize, true);
    dv.setUint32(24, entry.size, true);
    dv.setUint16(28, entry.name.length, true);
    dv.setUint32(42, entry.offset, true);
    head.set(entry.name, 46);
    cdParts.push(head);
    cdSize += head.length;
  }
  const end = new Uint8Array(22);
  const dv = new DataView(end.buffer);
  dv.setUint32(0, 0x06054b50, true);
  dv.setUint16(8, central.length, true);
  dv.setUint16(10, central.length, true);
  dv.setUint32(12, cdSize, true);
  dv.setUint32(16, offset, true);
  const all = [...parts, ...cdParts, end];
  const total = all.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const part of all) {
    out.set(part, o);
    o += part.length;
  }
  return out.buffer;
};

const sheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>
<row r="1"><c r="A1" t="inlineStr"><is><t>الاسم</t></is></c><c r="B1" t="inlineStr"><is><t>رقم الهاتف</t></is></c></row>
<row r="2"><c r="A2" t="s"><v>0</v></c><c r="B2" t="s"><v>1</v></c></row>
<row r="3"><c r="A3" t="inlineStr"><is><t>سارة إبراهيم</t></is></c><c r="B3"><v>201234567890</v></c></row>
</sheetData></worksheet>`;
const sharedXml = `<?xml version="1.0" encoding="UTF-8"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><si><t>محمد علي</t></si><si><t>01012345678</t></si></sst>`;
const workbookXml = `<?xml version="1.0" encoding="UTF-8"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="عملاء" sheetId="1" r:id="rId1"/></sheets></workbook>`;
const workbookRels = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`;

const deflated = await zipDeflate([
  { name: 'xl/workbook.xml', content: workbookXml },
  { name: 'xl/_rels/workbook.xml.rels', content: workbookRels },
  { name: 'xl/sharedStrings.xml', content: sharedXml },
  { name: 'xl/worksheets/sheet1.xml', content: sheetXml },
]);
const table = await readXlsx(deflated);
check('إكسل مضغوط (deflate) اتقرا', table.length === 3, JSON.stringify(table));
check('صف العناوين اتقرا', table[0]?.[0] === 'الاسم' && table[0]?.[1] === 'رقم الهاتف', JSON.stringify(table[0]));
check('نص من sharedStrings اتقرا', table[1]?.[0] === 'محمد علي', JSON.stringify(table[1]));
check('نص inline + رقم اتقروا', table[2]?.[0] === 'سارة إبراهيم' && table[2]?.[1] === '201234567890', JSON.stringify(table[2]));

// ===== ٢) التعرّف التلقائي على عمود الاسم والرقم + تنظيف الرقم =====
const preview = buildPreview(table, []);
check('اتعرف عمود الرقم', preview.mapping.phone === 'رقم الهاتف', preview.mapping.phone);
check('اتعرف عمود الاسم', preview.mapping.name === 'الاسم', preview.mapping.name);
check('الرقم اتنضّف (20 + 11 رقم)', preview.rows[1]?.phone === '01234567890', preview.rows[1]?.phone);
check('الأرقام العربية بتتحوّل لLatin', normalizeEgyptPhone('٠١٢٣٤٥٦٧٨٩٠') === '01234567890');

// ===== ٣) المدير يقدر يصحّح الأعمدة بنفسه =====
const custom = buildPreview(table, [], { name: 'الاسم', phone: 'رقم الهاتف' });
check('تحديد الأعمدة يدوياً بيشتغل', custom.rows.length === 2 && custom.rows[0]?.name === 'محمد علي');

// ===== ٤) مكرر与非 صالح =====
const dup = buildPreview(table, ['01012345678']);
check('الرقم الموجود بيتحسب مكرر', dup.duplicates === 1, `duplicates=${dup.duplicates}`);
const bad = buildPreview([['الاسم', 'الرقم'], ['عميل', 'أبجد']], []);
check('الرقم الغلط بيتحسب غير صالح', bad.invalid === 1, `invalid=${bad.invalid}`);

// ===== ٥) قراءة CSV بنفس المسار =====
const csv = await readSheetTable({
  name: 'عملاء.csv',
  arrayBuffer: async () => new TextEncoder().encode('الاسم,رقم\nأحمد,01011112222\n').buffer,
});
check('CSV اتقرا بنفس الطريقة', csv.length === 2 && csv[1]?.[1] === '01011112222', JSON.stringify(csv));

// ===== ٦) الواجهة: زرارين في «عملاء كامبين» + النافذة =====
const app = fs.readFileSync('src/App.tsx', 'utf8');
check(
  'في «عملاء كامبين» زرار «إضافة عميل» و«رفع شيت»',
  /إضافة عميل/.test(app) && /رفع شيت/.test(app) && /onImport\?\.\(\)/.test(app)
);
check(
  'النافذة بتقرأ CSV و Excel',
  /accept="\.csv,\.txt,\.xlsx,\.xlsm,text\/csv"/.test(app) && /readSheetTable\(file\)/.test(app)
);
check(
  'المعاينة بتعرض الاسم والرقم والحالة',
  /عمود الاسم/.test(app) && /عمود الرقم/.test(app) && /مكرر/.test(app) && /رقم غير صالح/.test(app)
);
check(
  'الحفظ بيسجّل عميل جديد ورفعه للسيرفر',
  /localStorage\.setItem\('crm_clients', JSON\.stringify\(\[\.\.\.added, \.\.\.existing\]\)\)/.test(app) &&
    /pushKey\('crm_clients'\)/.test(app)
);
check(
  'العميل المرفوع بيتسجّل ككامبين (يظهر في تبويب عملاء كامبين)',
  /source: finalForm \? `كامبين — \$\{finalForm\}` : 'كامبين — شيت مرفوع'/.test(app) &&
    /status: 'campaign'/.test(app)
);

// ===== ٧) كشف عمود الهاتف بالقياس (مش باسم العمود) =====
// العمود المسمّى «رقم» ممكن يكون تسلسلي (1، 2، 3) — وهو اللي كان بيخلي
// كل أرقام الشيت «غير صالحة» مع إن الأرقام سليمة.
const serialSheet = [
  ['الاسم', 'رقم', 'رقم الهاتف'],
  ['أحمد', '1', '01011112222'],
  ['منى', '2', '01133334444'],
  ['سارة', '3', '01255556666'],
];
const serialPreview = buildPreview(serialSheet, []);
check(
  'عمود «رقم» التسلسلي ما اتاخدش',
  serialPreview.mapping.phone === 'رقم الهاتف',
  serialPreview.mapping.phone
);
check(
  'الأرقام السليمة اتعرفت (مش كلها غير صالحة)',
  serialPreview.invalid === 0 && serialPreview.fresh === 3,
  `invalid=${serialPreview.invalid} fresh=${serialPreview.fresh}`
);
const realSheet = [
  ['الاسم', 'رقم'],
  ['أحمد', '01011112222'],
  ['منى', '01133334444'],
];
check(
  'عمود «رقم» اللي فيه تليفونات صحيح يفضل زي ما هو',
  buildPreview(realSheet, []).mapping.phone === 'رقم',
  buildPreview(realSheet, []).mapping.phone
);
const noHeaderSheet = [['أحمد', '01011112222'], ['منى', '01133334444']];
const noHeader = buildPreview(noHeaderSheet, []);
check(
  'شيت بلا عناوين: العمود الصح اتعرف',
  noHeader.invalid === 0 && noHeader.rows[0]?.phone === '01011112222',
  `invalid=${noHeader.invalid}`
);

// ===== ٨) الفورم الجديد: بنفس اسم الملف + حفظه في الإعدادات =====
const { formNameFromFileName, withExtraFormName } = await import('../src/leadForms.ts');
check(
  'اسم الفورم = اسم الملف بدون الامتداد',
  formNameFromFileName('عملاء أكتوبر.xlsx') === 'عملاء أكتوبر',
  formNameFromFileName('عملاء أكتوبر.xlsx')
);
check(
  'اسم ملف بلا امتداد يفضل زي ما هو',
  formNameFromFileName('عملاء') === 'عملاء'
);
check('إضافة اسم فورم جديد', withExtraFormName(['أ'], 'ب').length === 2);
check('نفس الاسم مرتين ما يتكررش', withExtraFormName(['أ'], 'أ').length === 1);
check('اسم فاضي ما بيضيفش فورم', withExtraFormName(['أ'], '   ').length === 1);

check(
  'النافذة بتحفظ الفورم في إعدادات السحب',
  /saveExtraFormName\(finalForm\)/.test(app) && /formNameFromFileName\(file\.name\)/.test(app)
);
check(
  'النافذة بتسجّل الأرقام في «توزيع الأرقام» (غير مخصصة)',
  /pushKey\('crm_assigned_leads'\)/.test(app) && /salesId: ''/.test(app) && /status: 'new'/.test(app)
);
check(
  'النافذة بتستنى نتيجة الرفع قبل ما تقفل',
  /const \[clientsOk, leadsOk\] = await Promise\.all/.test(app)
);
check(
  'إضافة العميل للإدارة: نموذج مبسّط (اسم + رقم)',
  /const simple = isAdmin/.test(app) && /\{!simple && \(/.test(app) &&
    /reminderAt: simple \? '' : nextReminderInput\(\)/.test(app)
);

console.log(`\n✅ نجحت ${passed} فحوصات لإضافة عميل يدوي ورفع الشيت`);