// ===== توليد ملف Excel حقيقي (.xlsx) بدون أي مكتبة خارجية =====
// السبب: تصدير CSV كان بيتفتح عند بعض البرامج/المتصفحات كخطأ «unrecoverable problem»،
// وملف xlsx قياسي (ZIP + XML) بيفتح في Excel وGoogle Sheets وWPS وONLYOFFICE.
//
// الملف الناتج: ورقة واحدة، نصوص inline، أرقام كأرقام، وعناوين بولد.

export type XlsxCell = string | number | null | undefined;

export type XlsxOptions = {
  sheetName: string;
  rows: XlsxCell[][];
  /** أرقام الصفوف (1-based) التي تُنسّق كعنوان جدول (bold) */
  headerRows?: number[];
  /** أرقام الصفوف التي تُنسّق كعنوان رئيسي (bold أكبر) */
  titleRows?: number[];
  /** عرض كل عمود بالحروف */
  columnWidths?: number[];
  /** نطاقات دمج مثل A1:L1 */
  merges?: string[];
};

const XML_HEADER = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

const escapeXml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

const escapeAttr = (value: string): string => escapeXml(value).replace(/\r?\n/g, ' ');

// A, B, ... Z, AA, AB ...
const columnName = (index: number): string => {
  let n = index + 1;
  let out = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
};

export const xlsxColumnName = columnName;

// ===== CRC32 لملفات ZIP =====
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

const crc32 = (data: Uint8Array): number => {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i += 1) {
    crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
};

const concatBytes = (parts: Uint8Array[]): Uint8Array => {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
};

const u16 = (value: number): Uint8Array => new Uint8Array([value & 0xff, (value >>> 8) & 0xff]);
const u32 = (value: number): Uint8Array =>
  new Uint8Array([value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff]);

// ZIP بدون ضغط (store) — الملفات صغيرة، والبساطة أهم من الحجم
const zipStore = (files: Array<{ name: string; data: Uint8Array }>): Uint8Array => {
  const encoder = new TextEncoder();
  const now = new Date();
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | Math.floor(now.getSeconds() / 2);
  const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();

  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  for (const file of files) {
    const name = encoder.encode(file.name);
    const crc = crc32(file.data);
    const local = concatBytes([
      u32(0x04034b50),
      u16(20), // version needed
      u16(0x0800), // UTF-8 names
      u16(0), // store
      u16(dosTime),
      u16(dosDate),
      u32(crc),
      u32(file.data.length),
      u32(file.data.length),
      u16(name.length),
      u16(0),
      name,
    ]);
    parts.push(local, file.data);

    central.push(
      concatBytes([
        u32(0x02014b50),
        u16(20), // version made by
        u16(20), // version needed
        u16(0x0800),
        u16(0),
        u16(dosTime),
        u16(dosDate),
        u32(crc),
        u32(file.data.length),
        u32(file.data.length),
        u16(name.length),
        u16(0), // extra
        u16(0), // comment
        u16(0), // disk
        u16(0), // internal attrs
        u32(0), // external attrs
        u32(offset),
        name,
      ])
    );

    offset += local.length + file.data.length;
  }

  const centralBytes = concatBytes(central);
  const end = concatBytes([
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(files.length),
    u16(files.length),
    u32(centralBytes.length),
    u32(offset),
    u16(0),
  ]);

  return concatBytes([...parts, centralBytes, end]);
};

const sheetXml = (options: XlsxOptions): string => {
  const { rows, headerRows = [], titleRows = [], columnWidths = [], merges = [] } = options;
  const headerSet = new Set(headerRows);
  const titleSet = new Set(titleRows);

  const cols = columnWidths.length
    ? `<cols>${columnWidths
        .map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`)
        .join('')}</cols>`
    : '';

  const sheetRows = rows
    .map((cells, rowIndex) => {
      const r = rowIndex + 1;
      const style = titleSet.has(r) ? 2 : headerSet.has(r) ? 1 : 0;
      const xmlCells = cells
        .map((cell, cellIndex) => {
          if (cell === null || cell === undefined || cell === '') return '';
          const ref = `${columnName(cellIndex)}${r}`;
          if (typeof cell === 'number' && Number.isFinite(cell)) {
            return `<c r="${ref}"${style ? ` s="${style}"` : ''}><v>${cell}</v></c>`;
          }
          return `<c r="${ref}" t="inlineStr"${style ? ` s="${style}"` : ''}><is><t xml:space="preserve">${escapeXml(
            String(cell)
          )}</t></is></c>`;
        })
        .join('');
      return `<row r="${r}"${titleSet.has(r) ? ' ht="22" customHeight="1"' : ''}>${xmlCells}</row>`;
    })
    .join('');

  const width = rows.reduce((max, row) => Math.max(max, row.length), 1);
  const height = Math.max(rows.length, 1);
  const dimension = `A1:${columnName(width - 1)}${height}`;

  const mergeXml = merges.length
    ? `<mergeCells count="${merges.length}">${merges
        .map((range) => `<mergeCell ref="${escapeAttr(range)}"/>`)
        .join('')}</mergeCells>`
    : '';

  return `${XML_HEADER}
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<dimension ref="${dimension}"/>
<sheetViews><sheetView rightToLeft="1" tabSelected="1" workbookViewId="0"/></sheetViews>
<sheetFormatPr defaultRowHeight="15"/>
${cols}
<sheetData>${sheetRows}</sheetData>
${mergeXml}
<pageMargins left="0.4" right="0.4" top="0.5" bottom="0.5" header="0.2" footer="0.2"/>
</worksheet>`;
};

const workbookXml = (sheetName: string): string => `${XML_HEADER}
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<bookViews><workbookView/></bookViews>
<sheets><sheet name="${escapeAttr(sheetName)}" sheetId="1" r:id="rId1"/></sheets>
</workbook>`;

const stylesXml = (): string => `${XML_HEADER}
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="3">
<font><sz val="11"/><name val="Calibri"/></font>
<font><b/><sz val="11"/><name val="Calibri"/></font>
<font><b/><sz val="14"/><color rgb="FF1F4E78"/><name val="Calibri"/></font>
</fonts>
<fills count="2">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
</fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="3">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

const contentTypesXml = (): string => `${XML_HEADER}
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`;

const rootRelsXml = (): string => `${XML_HEADER}
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

const workbookRelsXml = (): string => `${XML_HEADER}
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

/**
 * يبني ملف .xlsx كامل ويعيده كـ Blob جاهز للتنزيل.
 * كل النصوص inline (بلا sharedStrings) لتقليل التعقيد، والورقة RTL.
 */
export function buildXlsx(options: XlsxOptions): Blob {
  const rawName = String(options.sheetName || 'Sheet1').replace(/[\[\]:*?/\\]/g, ' ').trim();
  const sheetName = (rawName || 'Sheet1').slice(0, 31);
  const encoder = new TextEncoder();
  const files = [
    { name: '[Content_Types].xml', data: encoder.encode(contentTypesXml()) },
    { name: '_rels/.rels', data: encoder.encode(rootRelsXml()) },
    { name: 'xl/workbook.xml', data: encoder.encode(workbookXml(sheetName)) },
    { name: 'xl/_rels/workbook.xml.rels', data: encoder.encode(workbookRelsXml()) },
    { name: 'xl/styles.xml', data: encoder.encode(stylesXml()) },
    { name: 'xl/worksheets/sheet1.xml', data: encoder.encode(sheetXml(options)) },
  ];
  const zip = zipStore(files);
  // نسخة صريحة على ArrayBuffer حتى يقبلها نوع Blob في TypeScript
  const buffer = new ArrayBuffer(zip.length);
  new Uint8Array(buffer).set(zip);
  return new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

/** يُنزّل Blob باسم ملف — مع الرجوع لـ msSaveBlob على متصفحات قديمة */
export function downloadBlob(blob: Blob, fileName: string): void {
  const nav = navigator as Navigator & { msSaveBlob?: (blob: Blob, name: string) => boolean };
  if (typeof nav.msSaveBlob === 'function') {
    nav.msSaveBlob(blob, fileName);
    return;
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
  // إعطاء المتصفح فرصة لبدء التنزيل قبل تحرير الرابط
  window.setTimeout(() => URL.revokeObjectURL(url), 4000);
}
