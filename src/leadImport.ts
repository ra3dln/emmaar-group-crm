// ===== استيراد الأرقام من ملفات فيسبوك / إنجاز =====
// كل الدوال هنا "نقية" (بدون واجهة) حتى يسهل اختبارها ومراجعتها.
import { readXlsx } from './xlsx.ts';

export type ImportedLead = {
  name: string;
  phone: string; // بعد التنظيف
  rawPhone: string; // كما ورد في الملف
  source: string; // الحملة أو الفورم
  date: string;
  note: string;
  duplicate: boolean;
  invalid: boolean;
};

export type ImportPreview = {
  rows: ImportedLead[];
  mapping: { phone?: string; name?: string; source?: string; date?: string; note?: string };
  // صف العناوين اللي اتقرا (فاضي لو الشيت من غير عناوين)
  header?: string[];
  total: number;
  fresh: number;
  duplicates: number;
  invalid: number;
};

// --- 1) قراءة الملف: يدعم UTF-8 و UTF-16 و windows-1256 (ملفات إكسل العربية) ---
export function decodeText(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const decode = (encoding: string): string => {
    try {
      return new TextDecoder(encoding).decode(bytes);
    } catch {
      return '';
    }
  };

  if (bytes[0] === 0xff && bytes[1] === 0xfe) return decode('utf-16le');
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return decode('utf-16be');

  const utf8 = decode('utf-8');
  if (utf8.includes('\uFFFD')) {
    const arabic = decode('windows-1256');
    if (arabic && !arabic.includes('\uFFFD')) return arabic;
  }
  return utf8.replace(/^\uFEFF/, '');
}

// --- 2) تحويل النص إلى جدول (CSV بفاصلة أو فاصلة منقوطة أو مسافة جدولة) ---
const detectDelimiter = (line: string): string => {
  const candidates = [',', ';', '\t', '|'];
  let best = ',';
  let bestCount = 0;
  for (const candidate of candidates) {
    const count = line.split(candidate).length - 1;
    if (count > bestCount) {
      bestCount = count;
      best = candidate;
    }
  }
  return best;
};

export function parseTable(text: string): string[][] {
  const clean = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  if (!clean) return [];
  const delimiter = detectDelimiter(clean.split('\n')[0] || '');

  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < clean.length; i += 1) {
    const char = clean[i];
    if (inQuotes) {
      if (char === '"') {
        if (clean[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === delimiter) {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }
  row.push(field);
  rows.push(row);

  return rows.map((cells) => cells.map((cell) => cell.trim())).filter((cells) => cells.some((cell) => cell !== ''));
}

// --- 3) تنظيف الرقم: +20 / 0020 / مسافات / شرطات / أرقام عربية => 01xxxxxxxxx ---
const toLatinDigits = (value: string): string =>
  value
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[\u06f0-\u06f9]/g, (d) => String(d.charCodeAt(0) - 0x06f0));

export function normalizeEgyptPhone(raw: string): string {
  const text = toLatinDigits(String(raw ?? '')).trim();
  // «2.01E+11»: إكسل قرّب الرقم وضاعت خاناته — ما نخمّنش رقم عميل، يتعلّم غير صالح
  if (/^\d+(\.\d+)?e\+?\d+$/i.test(text)) return '';
  // «1001234567.0»: الكسر مش جزء من الرقم
  let digits = text.replace(/\.0+$/, '').replace(/\D/g, '');
  if (!digits) return '';

  while (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.startsWith('20') && digits.length >= 12) digits = digits.slice(2);

  if (digits.startsWith('1') && digits.length === 10) return `0${digits}`;
  if (digits.startsWith('0')) return digits;
  if (digits.length === 10 && digits.startsWith('1')) return `0${digits}`;
  return digits;
}

export const isPhoneLike = (value: string): boolean => {
  const text = toLatinDigits(String(value ?? ''));
  const digits = text.replace(/\D/g, '');
  if (digits.length < 8) return false;
  return digits.length / Math.max(text.trim().length, 1) >= 0.6;
};

export const isValidPhone = (phone: string): boolean => phone.replace(/\D/g, '').length >= 8;

// --- 4) التعرّف على الأعمدة تلقائياً (عربي وإنجليزي) ---
const HINTS: Array<{ key: 'phone' | 'name' | 'source' | 'date' | 'note'; words: string[] }> = [
  { key: 'source', words: ['campaign_name', 'campaign', 'form_name', 'form', 'source', 'الحملة', 'اسم الحملة', 'المصدر', 'مصدر', 'الفورم', 'النموذج'] },
  { key: 'phone', words: ['phone_number', 'phone', 'mobile', 'whatsapp', 'رقم الهاتف', 'الهاتف', 'رقم الموبايل', 'الموبايل', 'موبايل', 'تليفون', 'رقم العميل', 'الجوال', 'رقم'] },
  { key: 'name', words: ['full_name', 'fullname', 'name', 'client', 'الاسم', 'اسم', 'اسم العميل', 'العميل', 'الاسم الكامل'] },
  { key: 'date', words: ['created_time', 'created', 'date', 'time', 'التاريخ', 'تاريخ', 'الوقت'] },
  { key: 'note', words: ['notes', 'note', 'description', 'comment', 'ملاحظات', 'ملاحظة', 'الوصف', 'تفاصيل'] },
];

const normalizeHeader = (value: string): string =>
  toLatinDigits(String(value ?? ''))
    .toLowerCase()
    .replace(/[\s_\-.:]+/g, ' ')
    .trim();

const headerMatches = (header: string, word: string): boolean => {
  if (!header) return false;
  if (header === word) return true;
  // تطابق كامل للكلمة (مع المسافات) وأيضاً احتواء للكلمات العربية المركبة
  return header.includes(word) && (word.length >= 4 || word === header);
};

// رقم العمود من اسمه (أو «العمود ٣» لما مافيش عناوين)
const columnIndexOf = (header: string[], label?: string): number => {
  if (!label) return -1;
  if (label.startsWith('العمود ')) return Number(label.replace('العمود ', '')) - 1;
  return header.findIndex((cell) => cell === label);
};

// كام قيم العمود دي أرقام تليفون فعلاً (0..1)
const phoneScoreOf = (body: string[][], index: number): number => {
  if (index < 0) return 0;
  const values = body.map((row) => row[index] || '').filter((value) => value !== '');
  if (!values.length) return 0;
  return values.filter(isPhoneLike).length / values.length;
};

// كام قيمة في العمود موبايل مصري كامل (0..1) — أدق من «شكله رقم» لأن عمود المعرّف
// (lead id) كمان أرقام طويلة
const mobileScoreOf = (body: string[][], index: number): number => {
  if (index < 0) return 0;
  const values = body.map((row) => row[index] || '').filter((value) => value !== '');
  if (!values.length) return 0;
  return values.filter((value) => /^01[0125]\d{8}$/.test(normalizeEgyptPhone(value))).length / values.length;
};

// عناوين فيها كلمة «name» بس مش اسم العميل (ad_name / campaign_name / form_name…)
const NOT_CLIENT_NAME = /(^|\s)(ad|adset|campaign|form|platform|page|user|file|email)(\s|$)|حمل|فورم|نموذج|إعلان|اعلان|مصدر|بريد/;

// كام قيمة في العمود شكلها اسم شخص (0..1): حروف، مش إيميل أو لينك أو رقم، ومتنوعة
// (عمود زي «fb / ig» حروف برضه بس بيتكرر)
const nameScoreOf = (body: string[][], index: number): number => {
  if (index < 0) return 0;
  const values = body.map((row) => row[index] || '').filter((value) => value !== '');
  if (!values.length) return 0;
  const named = values.filter((value) => /\p{L}/u.test(value) && !/[@/]/.test(value) && !/\d{4,}/.test(value));
  return (named.length / values.length) * Math.min(1, new Set(values).size / values.length);
};

export function guessColumns(header: string[], body: string[][]): ImportPreview['mapping'] {
  const columns: ImportPreview['mapping'] = {};
  const used = new Set<number>();

  for (const { key, words } of HINTS) {
    for (let i = 0; i < header.length; i += 1) {
      if (used.has(i)) continue;
      const cell = normalizeHeader(header[i]);
      if (key === 'name' && NOT_CLIENT_NAME.test(cell)) continue;
      if (words.some((word) => headerMatches(cell, word))) {
        columns[key] = header[i];
        used.add(i);
        break;
      }
    }
  }

  // ===== عمود الهاتف: لازم قيمه تشبه تليفون فعلاً =====
  // عمود مسمّى «رقم» ممكن يكون تسلسلي (1، 2، 3) مش تليفون — وهو اللي كان
  // بيخلي كل أرقام الشيت «غير صالحة» مع إن الأرقام سليمة. فبنقيس قيم العمود
  // اللي اتعرف عليه، ولو مش أرقام بنختار العمود اللي أرقامه صح.
  const hintedIndex = columnIndexOf(header, columns.phone);
  if (phoneScoreOf(body, hintedIndex) < 0.5) {
    let bestIndex = -1;
    let bestScore = 0;
    const width = Math.max(...body.map((row) => row.length), 0);
    for (let i = 0; i < width; i += 1) {
      const score = phoneScoreOf(body, i);
      if (score > bestScore) {
        bestScore = score;
        bestIndex = i;
      }
    }
    if (bestIndex >= 0 && bestScore >= 0.5) {
      columns.phone = header[bestIndex] ? header[bestIndex] : `العمود ${bestIndex + 1}`;
    }
  }

  // لو في عمود موبايلات مصرية أوضح بكتير من اللي اتختار (معرّف طويل مثلاً) ناخده هو
  const width = Math.max(...body.map((row) => row.length), 0);
  const labelOf = (index: number) => header[index] || `العمود ${index + 1}`;
  let bestMobile = -1;
  let bestMobileScore = 0;
  for (let i = 0; i < width; i += 1) {
    const score = mobileScoreOf(body, i);
    if (score > bestMobileScore) {
      bestMobileScore = score;
      bestMobile = i;
    }
  }
  if (bestMobile >= 0 && bestMobileScore >= 0.5 && bestMobileScore > mobileScoreOf(body, columnIndexOf(header, columns.phone)) + 0.3) {
    columns.phone = labelOf(bestMobile);
  }

  // ===== عمود الاسم: لازم قيمه تشبه أسماء، ومايبقاش عمود الرقم =====
  const phoneIndex = columnIndexOf(header, columns.phone);
  const nameIndex = columnIndexOf(header, columns.name);
  const taken = new Set([columns.source, columns.date, columns.note].map((label) => columnIndexOf(header, label)));
  const currentName = nameIndex === phoneIndex ? 0 : nameScoreOf(body, nameIndex);
  if (currentName < 0.5) {
    let bestName = -1;
    let bestNameScore = currentName;
    for (let i = 0; i < width; i += 1) {
      if (i === phoneIndex || taken.has(i) || NOT_CLIENT_NAME.test(normalizeHeader(header[i] || ''))) continue;
      const score = nameScoreOf(body, i);
      if (score > bestNameScore) {
        bestNameScore = score;
        bestName = i;
      }
    }
    if (bestName >= 0 && bestNameScore >= 0.5) columns.name = labelOf(bestName);
  }

  return columns;
}

const looksLikeHeader = (row: string[]): boolean => {
  const cells = row.map(normalizeHeader);
  const hasHint = cells.some((cell) => HINTS.some(({ words }) => words.some((word) => headerMatches(cell, word))));
  if (hasHint) return true;
  // صف بلا أي رقم هاتف معقول = غالباً صف عناوين
  return !row.some(isPhoneLike);
};

// --- 5) بناء المعاينة: تنظيف + كشف المكرر قبل أي إضافة ---
export function buildPreview(
  table: string[][],
  existingPhones: string[],
  mappingOverride?: ImportPreview['mapping']
): ImportPreview {
  const empty: ImportPreview = { rows: [], mapping: {}, total: 0, fresh: 0, duplicates: 0, invalid: 0 };
  if (!table.length) return empty;

  // شيت فوقه سطور عنوان (مثلاً «عملاء أكتوبر» ثم العناوين): نبدأ من صف العناوين الحقيقي
  const firstPhoneRow = table.slice(0, 6).findIndex((row) => row.some(isPhoneLike));
  const start =
    firstPhoneRow >= 2 && table[firstPhoneRow - 1].filter((cell) => cell !== '').length >= 2 ? firstPhoneRow - 1 : 0;
  const sheet = table.slice(start);

  const hasHeader = looksLikeHeader(sheet[0]);
  const header = hasHeader ? sheet[0] : [];
  const body = hasHeader ? sheet.slice(1) : sheet;
  // تعرّف تلقائي على الأعمدة — والمدير يقدر يصحّحها يدوياً (عمود الاسم/الرقم)
  const mapping = {
    ...guessColumns(header, body),
    ...(mappingOverride || {}),
  };

  const indexOf = (label?: string): number => {
    if (!label) return -1;
    if (label.startsWith('العمود ')) return Number(label.replace('العمود ', '')) - 1;
    return header.findIndex((cell) => cell === label);
  };

  const phoneIndex = indexOf(mapping.phone);
  const nameIndex = indexOf(mapping.name);
  const sourceIndex = indexOf(mapping.source);
  const dateIndex = indexOf(mapping.date);
  const noteIndex = indexOf(mapping.note);

  const fallbackNameIndex = nameIndex >= 0 ? nameIndex : body[0]?.findIndex((_, i) => i !== phoneIndex) ?? -1;
  const seen = new Set<string>(existingPhones.map(normalizeEgyptPhone).filter(Boolean));

  const rows: ImportedLead[] = [];
  let duplicates = 0;
  let invalid = 0;

  for (const cells of body) {
    const rawPhone = phoneIndex >= 0 ? cells[phoneIndex] || '' : '';
    const phone = normalizeEgyptPhone(rawPhone);
    const name = (fallbackNameIndex >= 0 ? cells[fallbackNameIndex] || '' : '').trim();

    if (!isValidPhone(phone)) {
      invalid += 1;
      rows.push({ name, phone: rawPhone.trim(), rawPhone: rawPhone.trim(), source: sourceIndex >= 0 ? cells[sourceIndex] || '' : '', date: dateIndex >= 0 ? cells[dateIndex] || '' : '', note: noteIndex >= 0 ? cells[noteIndex] || '' : '', duplicate: false, invalid: true });
      continue;
    }

    const isDuplicate = seen.has(phone);
    if (isDuplicate) duplicates += 1;
    else seen.add(phone);

    rows.push({
      name,
      phone,
      rawPhone: rawPhone.trim(),
      source: sourceIndex >= 0 ? cells[sourceIndex] || '' : '',
      date: dateIndex >= 0 ? cells[dateIndex] || '' : '',
      note: noteIndex >= 0 ? cells[noteIndex] || '' : '',
      duplicate: isDuplicate,
      invalid: false,
    });
  }

  return { rows, mapping, header, total: body.length, fresh: rows.length - duplicates - invalid, duplicates, invalid };
}

// --- 6) قراءة أي شيت: CSV / TXT / إكسل (xlsx) ---
// «رفع أي شيت»: بنقرأ الملف اللي بيختاره المدير — CSV أو TXT أو إكسل حقيقي.
export async function readSheetTable(file: File): Promise<string[][]> {
  const buffer = await file.arrayBuffer();
  if (/\.(xlsx|xlsm)$/i.test(file.name)) return await readXlsx(buffer);
  return parseTable(decodeText(buffer));
}

// --- 7) ملف وهمي كبير لتجربة التوزيع على الفريق ---
// يحاكي كامبين حقيقية: ٣ حملات، ~٨٠٪ أرقام صحيحة، ~١٣٪ مكررة، ~٥٪ بلا رقم
const FAKE_FIRST = ['أحمد', 'محمد', 'محمود', 'مصطفى', 'خالد', 'يوسف', 'عمر', 'كريم', 'هشام', 'شريف', 'منى', 'سارة', 'نورهان', 'هبة', 'أميرة', 'دينا', 'ياسمين', 'رنا', 'ملك', 'مي', 'عبد الله', 'عبد الرحمن', 'إسلام', 'طارق', 'وليد'];
const FAKE_LAST = ['محمود', 'سامي', 'عبد الله', 'حسن', 'علي', 'إبراهيم', 'شريف', 'فؤاد', 'رمضان', 'السيد', 'مصطفى', 'جمال', 'فتحي', 'الشافعي', 'منصور'];
const FAKE_CAMPAIGNS = ['حملة أكتوبر - الشيخ زايد', 'حملة أكتوبر - التجمع', 'حملة المعادي - شقق'];
const FAKE_FORMS = ['فورم شقق', 'فورم فيلات', 'فورم استثمار'];

const pickRandom = (list: string[]): string => list[Math.floor(Math.random() * list.length)];

export function buildFakeCampaignCsv(count = 100): string {
  const rows = ['id,created_time,full_name,phone_number,campaign_name,form_name'];
  const used: string[] = [];

  for (let i = 0; i < count; i += 1) {
    const name = `${pickRandom(FAKE_FIRST)} ${pickRandom(FAKE_LAST)}`;
    const roll = Math.random();
    let phone: string;

    if (roll < 0.05) {
      phone = ''; // صف بلا رقم => غير صالح
    } else if (roll < 0.18 && used.length) {
      phone = pickRandom(used); // مكرر مقصود
    } else {
      phone = `${pickRandom(['010', '011', '012', '015'])}${Math.floor(10000000 + Math.random() * 89999999)}`;
      used.push(phone);
    }

    if (phone && Math.random() < 0.25) phone = `+20${phone.replace(/^0/, '')}`; // صيغة دولية كما ترسلها فيسبوك

    const day = String(20 + (i % 3)).padStart(2, '0');
    const hour = String(9 + (i % 9)).padStart(2, '0');
    const minute = String(i % 60).padStart(2, '0');

    rows.push(
      [`${7000 + i}`, `2026-09-${day} ${hour}:${minute}`, name, phone, pickRandom(FAKE_CAMPAIGNS), pickRandom(FAKE_FORMS)].join(',')
    );
  }

  return rows.join('\n');
}

// --- 7) ملف تجريبي صغير للتجربة (نفس شكل ملفات فيسبوك) ---
export function buildSampleCsv(): string {
  return [
    'id,created_time,full_name,phone_number,campaign_name,form_name',
    '6801,2026-09-23 08:14,أحمد محمود,+201001234567,حملة أكتوبر - الشيخ زايد,فورم شقق',
    '6802,2026-09-23 09:02,منى سامي,01098765432,حملة أكتوبر - الشيخ زايد,فورم شقق',
    '6803,2026-09-23 09:40,محمود عبد الله,"0020 111 222 3333",حملة التجمع,فورم فيلات',
    '6804,2026-09-23 10:05,سارة إبراهيم,٠١٢٣٤٥٦٧٨٩٠,حملة التجمع,فورم فيلات',
    '6805,2026-09-23 10:31,,"+20 128 555 4444",حملة المعادي,فورم شقق',
    '6806,2026-09-23 11:02,خالد حسن,01098765432,حملة أكتوبر - الشيخ زايد,فورم شقق',
    '6807,2026-09-23 11:20,نورهان علي,+201550001122,حملة المعادي,فورم شقق',
    '6808,2026-09-23 12:00,عميل بدون رقم,,حملة المعادي,فورم شقق',
    '6809,2026-09-23 12:15,يوسف شريف,0223456789,حملة أكتوبر - الشيخ زايد,فورم شقق',
  ].join('\n');
}
