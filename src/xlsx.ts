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
  /** اتجاه الورقة: يمين لشمال (الافتراضي) أو شمال ليمين */
  rightToLeft?: boolean;
  /** تثبيت أول صفوف/أعمدة وقت التمرير (رأس الجدول وعمود التاريخ) */
  freeze?: { rows?: number; cols?: number };
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

const sheetXml = (options: XlsxOptions, selected = true): string => {
  const { rows, headerRows = [], titleRows = [], columnWidths = [], merges = [], rightToLeft = true, freeze } = options;
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

  const frozenRows = Math.max(0, freeze?.rows || 0);
  const frozenCols = Math.max(0, freeze?.cols || 0);
  const pane = frozenRows || frozenCols
    ? `<pane${frozenCols ? ` xSplit="${frozenCols}"` : ''}${frozenRows ? ` ySplit="${frozenRows}"` : ''} topLeftCell="${columnName(frozenCols)}${frozenRows + 1}" activePane="${frozenRows && frozenCols ? 'bottomRight' : frozenRows ? 'bottomLeft' : 'topRight'}" state="frozen"/>`
    : '';
  const viewAttrs = `${rightToLeft ? ' rightToLeft="1"' : ''}${selected ? ' tabSelected="1"' : ''}`;

  return `${XML_HEADER}
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<dimension ref="${dimension}"/>
<sheetViews><sheetView${viewAttrs} workbookViewId="0">${pane}</sheetView></sheetViews>
<sheetFormatPr defaultRowHeight="15"/>
${cols}
<sheetData>${sheetRows}</sheetData>
${mergeXml}
<pageMargins left="0.4" right="0.4" top="0.5" bottom="0.5" header="0.2" footer="0.2"/>
</worksheet>`;
};

const workbookXml = (sheetNames: string[]): string => `${XML_HEADER}
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<bookViews><workbookView/></bookViews>
<sheets>${sheetNames
  .map((name, i) => `<sheet name="${escapeAttr(name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
  .join('')}</sheets>
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

const contentTypesXml = (sheetCount: number): string => `${XML_HEADER}
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
${Array.from({ length: sheetCount }, (_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('\n')}
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`;

const rootRelsXml = (): string => `${XML_HEADER}
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

const workbookRelsXml = (sheetCount: number): string => `${XML_HEADER}
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${Array.from({ length: sheetCount }, (_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('\n')}
<Relationship Id="rId${sheetCount + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

/**
 * يبني ملف .xlsx كامل ويعيده كـ Blob جاهز للتنزيل.
 * كل النصوص inline (بلا sharedStrings) لتقليل التعقيد، والورقة RTL.
 */
export function buildXlsx(options: XlsxOptions): Blob {
  return buildXlsxBook([options]);
}

/** نفس buildXlsx بس بأكتر من ورقة (تبويبات تحت في إكسيل) — الأولى هي اللي بتفتح */
export function buildXlsxBook(sheets: XlsxOptions[]): Blob {
  const list = sheets.length ? sheets : [{ sheetName: 'Sheet1', rows: [] }];
  const used = new Set<string>();
  const names = list.map((sheet, i) => {
    const raw = String(sheet.sheetName || `Sheet${i + 1}`).replace(/[\[\]:*?/\\]/g, ' ').trim();
    let name = (raw || `Sheet${i + 1}`).slice(0, 31);
    // اسم الورقة لازم يكون فريد في الملف
    while (used.has(name)) name = `${name.slice(0, 28)} ${i + 1}`;
    used.add(name);
    return name;
  });
  const encoder = new TextEncoder();
  const files = [
    { name: '[Content_Types].xml', data: encoder.encode(contentTypesXml(list.length)) },
    { name: '_rels/.rels', data: encoder.encode(rootRelsXml()) },
    { name: 'xl/workbook.xml', data: encoder.encode(workbookXml(names)) },
    { name: 'xl/_rels/workbook.xml.rels', data: encoder.encode(workbookRelsXml(list.length)) },
    { name: 'xl/styles.xml', data: encoder.encode(stylesXml()) },
    ...list.map((sheet, i) => ({
      name: `xl/worksheets/sheet${i + 1}.xml`,
      data: encoder.encode(sheetXml(sheet, i === 0)),
    })),
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

// ===== قراءة ملف .xlsx (ZIP + XML) بدون أي مكتبة خارجية =====
// ملفات إكسل الحقيقية أرشيف ZIP مضغوط (deflate) — بنفكّها بـ DecompressionStream
// (موجود في المتصفحات الحديثة) ونقرا أول ورقة: النصوص من sharedStrings أو inline.

type ZipEntry = { name: string; method: number; compSize: number; size: number; offset: number };

// آخر ترويسة «نهاية الدليل المركزي» (EOCD) — نبحث عنها من آخر الملف
const findEocd = (bytes: Uint8Array): number => {
  const min = Math.max(0, bytes.length - 66000);
  for (let i = bytes.length - 22; i >= min; i -= 1) {
    if (bytes[i] === 0x50 && bytes[i + 1] === 0x4b && bytes[i + 2] === 0x05 && bytes[i + 3] === 0x06) return i;
  }
  return -1;
};

const readZipEntries = (bytes: Uint8Array): Map<string, ZipEntry> => {
  const map = new Map<string, ZipEntry>();
  const eocd = findEocd(bytes);
  if (eocd < 0) return map;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = view.getUint16(eocd + 10, true);
  let pointer = view.getUint32(eocd + 16, true);
  for (let i = 0; i < count; i += 1) {
    if (pointer + 46 > bytes.length) break;
    if (view.getUint32(pointer, true) !== 0x02014b50) break;
    const method = view.getUint16(pointer + 10, true);
    const compSize = view.getUint32(pointer + 20, true);
    const size = view.getUint32(pointer + 24, true);
    const nameLen = view.getUint16(pointer + 28, true);
    const extraLen = view.getUint16(pointer + 30, true);
    const commentLen = view.getUint16(pointer + 32, true);
    const offset = view.getUint32(pointer + 42, true);
    const name = new TextDecoder('utf-8').decode(bytes.subarray(pointer + 46, pointer + 46 + nameLen));
    map.set(name, { name, method, compSize, size, offset });
    pointer += 46 + nameLen + extraLen + commentLen;
  }
  return map;
};

const readZipFile = async (bytes: Uint8Array, entry: ZipEntry): Promise<string> => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const nameLen = view.getUint16(entry.offset + 26, true);
  const extraLen = view.getUint16(entry.offset + 28, true);
  const start = entry.offset + 30 + nameLen + extraLen;
  const raw = bytes.subarray(start, start + entry.compSize);
  if (entry.method === 0) return new TextDecoder('utf-8').decode(raw);
  if (entry.method === 8) {
    if (typeof DecompressionStream === 'undefined') throw new Error('المتصفح ده أقدم منFeature نقدر نفك ضغط بيه');
    // نسخة في ArrayBuffer صريح: الـ Blob يقبل ArrayBuffer بس
    const buffer = new ArrayBuffer(raw.byteLength);
    new Uint8Array(buffer).set(raw);
    const stream = new Blob([buffer]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return await new Response(stream).text();
  }
  throw new Error('طريقة ضغط غير مدعومة في الملف');
};

const decodeXmlEntities = (value: string): string =>
  String(value)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
    .replace(/&amp;/g, '&');

const parseSharedStrings = (xml: string): string[] => {
  const out: string[] = [];
  const re = /<si\b[^>]*>([\s\S]*?)<\/si>/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(xml))) {
    const texts = [...match[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((t) => decodeXmlEntities(t[1]));
    out.push(texts.join(''));
  }
  return out;
};

// A → 0، B → 1، AA → 26 …
const columnIndexOf = (ref: string): number => {
  const letters = (String(ref || '').match(/^[A-Z]+/) || [''])[0];
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return Math.max(0, n - 1);
};

const parseSheetXml = (xml: string, shared: string[]): string[][] => {
  const rows: string[][] = [];
  const rowRe = /<row\b[^>]*>([\s\S]*?)<\/row>/g;
  let rowMatch: RegExpExecArray | null;
  while ((rowMatch = rowRe.exec(xml))) {
    const cells: string[] = [];
    const cellRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
    let cellMatch: RegExpExecArray | null;
    while ((cellMatch = cellRe.exec(rowMatch[1]))) {
      const attrs = cellMatch[1] || '';
      const body = cellMatch[2] || '';
      const ref = (attrs.match(/r="([A-Z]+\d+)"/) || [])[1] || '';
      const type = (attrs.match(/t="([^"]+)"/) || [])[1] || '';
      let value = '';
      if (type === 's') {
        const raw = (body.match(/<v>([\s\S]*?)<\/v>/) || [])[1] || '';
        value = shared[Number(raw)] ?? '';
      } else if (type === 'inlineStr') {
        value = [...body.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((t) => decodeXmlEntities(t[1])).join('');
      } else {
        value = plainNumberText(decodeXmlEntities((body.match(/<v>([\s\S]*?)<\/v>/) || [])[1] || ''));
      }
      const index = ref ? columnIndexOf(ref) : cells.length;
      while (cells.length < index) cells.push('');
      cells[index] = value;
    }
    rows.push(cells.map((cell) => cell.trim()));
  }
  return rows.filter((row) => row.some((cell) => cell !== ''));
};

/** إكسل ممكن يخزّن الرقم «2.01001234567E11» — القيمة كاملة، فبنرجّعها رقم عادي */
export function plainNumberText(value: string): string {
  if (!/^\d+(\.\d+)?[eE]\+?\d+$/.test(value)) return value;
  const number = Number(value);
  return Number.isSafeInteger(number) ? String(number) : value;
}

/** يقرأ أول ورقة في ملف .xlsx ويعيدها كجدول نصوص */
export async function readXlsx(buffer: ArrayBuffer): Promise<string[][]> {
  const bytes = new Uint8Array(buffer);
  const entries = readZipEntries(bytes);
  if (!entries.size) throw new Error('الملف ده مش ملف إكسل صحيح');

  const sharedEntry = entries.get('xl/sharedStrings.xml');
  const shared = sharedEntry ? parseSharedStrings(await readZipFile(bytes, sharedEntry)) : [];

  // مسار أول ورقة من workbook + علاقاته
  let sheetPath = '';
  const workbookEntry = entries.get('xl/workbook.xml');
  if (workbookEntry) {
    const workbookXml = await readZipFile(bytes, workbookEntry);
    const sheetTag = workbookXml.match(/<sheet\b[^>]*\/?>/);
    const relId = sheetTag ? (sheetTag[0].match(/r:id="([^"]+)"/) || [])[1] : '';
    const relsEntry = entries.get('xl/_rels/workbook.xml.rels');
    if (relId && relsEntry) {
      const relsXml = await readZipFile(bytes, relsEntry);
      const relRe = /<Relationship\b[^>]*\/?>/g;
      let rel: RegExpExecArray | null;
      while ((rel = relRe.exec(relsXml))) {
        if ((rel[0].match(/Id="([^"]+)"/) || [])[1] === relId) {
          const target = (rel[0].match(/Target="([^"]+)"/) || [])[1] || '';
          if (target) {
            sheetPath = target.startsWith('/')
              ? target.slice(1)
              : target.startsWith('xl/')
              ? target
              : `xl/${target.replace(/^\.\//, '')}`;
          }
          break;
        }
      }
    }
  }
  if (!sheetPath || !entries.has(sheetPath)) {
    sheetPath = [...entries.keys()].find((name) => name.startsWith('xl/worksheets/') && name.endsWith('.xml')) || '';
  }
  if (!sheetPath) throw new Error('ما لقيناش أي ورقة في الملف');

  const sheetXml = await readZipFile(bytes, entries.get(sheetPath)!);
  return parseSheetXml(sheetXml, shared);
}
