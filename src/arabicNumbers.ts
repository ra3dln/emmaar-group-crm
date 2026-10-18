// ===== فهم الأرقام والغرف المكتوبة بالعربي =====
// وحدة نقية (بلا DOM) حتى تُختبر بسهولة، وتُستخدم في:
//   • بحث احتياجات العميل (src/App.tsx)
//   • البحث العام في العقارات والعملاء
//   • تحويل سعر مكتوب بالحروف إلى رقم (parsePrice)
//
// أمثلة مدعومة:
//   «غرفتين» = 2   «أوضتين» = 2   «3 غرف» = 3   «غرفة واحدة» = 1
//   «عشر آلاف» = 10,000   «مية وخمسين ألف» = 150,000
//   «مليون وميتين ألف» = 1,200,000   «نص مليون» = 500,000   «مليون ونص» = 1,500,000

type WordValue = { keys: string[]; value: number };

// توحيد الحروف والأرقام بنفس قواعد البحث في التطبيق (أ/إ/آ ← ا، ة ← ه، ى ← ي)
export const normalizeArabicNumberText = (value: string): string =>
  String(value ?? '')
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[\u06f0-\u06f9]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .toLowerCase()
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[\u064b-\u065f\u0670]/g, '');

const ONES: WordValue[] = [
  { keys: ['واحد', 'واحدة', 'واحده', 'وحد'], value: 1 },
  { keys: ['اتنين', 'اثنين', 'اثنان', 'إتنين', 'تنين', 'اثنتين', 'اتنتين'], value: 2 },
  { keys: ['تلاتة', 'ثلاثة', 'تلاته', 'ثلاثه', 'تلات', 'ثلاث'], value: 3 },
  { keys: ['أربعة', 'اربعة', 'أربعه', 'اربعه', 'أربع', 'اربع'], value: 4 },
  { keys: ['خمسة', 'خمسه', 'خمس'], value: 5 },
  { keys: ['ستة', 'سته', 'ست'], value: 6 },
  { keys: ['سبعة', 'سبعه', 'سبع'], value: 7 },
  { keys: ['تمانية', 'ثمانية', 'تمانيه', 'ثمانيه', 'تمان', 'ثمان', 'تمن'], value: 8 },
  { keys: ['تسعة', 'تسعه', 'تسع'], value: 9 },
  // ١١–١٩ كما تُكتب في الكلام العادي
  { keys: ['حداشر', 'احداشر'], value: 11 },
  { keys: ['اتناشر', 'اثناشر'], value: 12 },
  { keys: ['تلاتاشر', 'ثلاثتاشر'], value: 13 },
  { keys: ['اربعتاشر', 'أربعتاشر'], value: 14 },
  { keys: ['خمستاشر'], value: 15 },
  { keys: ['ستاشر'], value: 16 },
  { keys: ['سبعتاشر'], value: 17 },
  { keys: ['تمنتاشر', 'ثمانتاشر'], value: 18 },
  { keys: ['تسعتاشر'], value: 19 },
];

const TENS: WordValue[] = [
  { keys: ['عشرة', 'عشره', 'عشر'], value: 10 },
  { keys: ['عشرين', 'عشرون'], value: 20 },
  { keys: ['تلاتين', 'ثلاثين', 'ثلاثون'], value: 30 },
  { keys: ['أربعين', 'اربعين', 'اربعون'], value: 40 },
  { keys: ['خمسين', 'خمسون'], value: 50 },
  { keys: ['ستين', 'ستون'], value: 60 },
  { keys: ['سبعين', 'سبعون'], value: 70 },
  { keys: ['تمانين', 'ثمانين', 'ثمانون'], value: 80 },
  { keys: ['تسعين', 'تسعون'], value: 90 },
];

const HUNDREDS: WordValue[] = [
  { keys: ['مية', 'ميه', 'مائة', 'مئة', 'مئه', 'مائه', 'ميت'], value: 100 },
  { keys: ['ميتين', 'مئتين', 'مئتان', 'ميتان'], value: 200 },
  { keys: ['تلتمية', 'تلتميه', 'ثلاثمائة', 'ثلاثمئة', 'ثلاثميه', 'تلتميت'], value: 300 },
  { keys: ['ربعمية', 'ربعميه', 'أربعمائة', 'اربعمائة', 'اربعمئة', 'ربعميت'], value: 400 },
  { keys: ['خمسمية', 'خمسميه', 'خمسمائة', 'خمسمئة', 'خمسميت'], value: 500 },
  { keys: ['ستمية', 'ستميه', 'ستمائة', 'ستمئة', 'ستميت'], value: 600 },
  { keys: ['سبعمية', 'سبعميه', 'سبعمائة', 'سبعمئة', 'سبعميت'], value: 700 },
  { keys: ['تمنمية', 'تمنميه', 'ثمانمائة', 'ثمانمئة', 'تمنميت'], value: 800 },
  { keys: ['تسعمية', 'تسعميه', 'تسعمائة', 'تسعمئة', 'تسعميت'], value: 900 },
];

const FRACTIONS: WordValue[] = [
  { keys: ['نص', 'نصف'], value: 0.5 },
  { keys: ['ربع'], value: 0.25 },
  { keys: ['تلت', 'ثلث'], value: 1 / 3 },
];

type MoneyUnit = { keys: string[]; base: number; dual: boolean };

const MONEY_UNITS: MoneyUnit[] = [
  { keys: ['مليار', 'مليارات'], base: 1_000_000_000, dual: false },
  { keys: ['مليارين', 'ملياران'], base: 1_000_000_000, dual: true },
  { keys: ['مليون', 'ملايين'], base: 1_000_000, dual: false },
  { keys: ['مليونين', 'مليونان'], base: 1_000_000, dual: true },
  { keys: ['مليوني'], base: 1_000_000, dual: true },
  { keys: ['الف', 'الاف', 'آلاف', 'الوف', 'ألوف', 'ألاف'], base: 1000, dual: false },
  { keys: ['الفين', 'الفان', 'ألفين'], base: 1000, dual: true },
];

const normalizeKeys = <T extends { keys: string[] }>(items: T[]): T[] =>
  items.map((item) => ({ ...item, keys: item.keys.map((key) => normalizeArabicNumberText(key).trim()) }));

const ONES_N = normalizeKeys(ONES);
const TENS_N = normalizeKeys(TENS);
const HUNDREDS_N = normalizeKeys(HUNDREDS);
const FRACTIONS_N = normalizeKeys(FRACTIONS);
const UNITS_N = normalizeKeys(MONEY_UNITS);

const WORD_VALUES = new Map<string, number>();
for (const entry of [...ONES_N, ...TENS_N, ...HUNDREDS_N]) {
  for (const key of entry.keys) {
    if (key && !WORD_VALUES.has(key)) WORD_VALUES.set(key, entry.value);
  }
}

const UNIT_VALUES = new Map<string, MoneyUnit>();
for (const entry of UNITS_N) {
  for (const key of entry.keys) if (key) UNIT_VALUES.set(key, entry);
}

const FRACTION_VALUES = new Map<string, number>();
for (const entry of FRACTIONS_N) {
  for (const key of entry.keys) if (key) FRACTION_VALUES.set(key, entry.value);
}

const stripWaw = (word: string): string => (word.startsWith('و') && word.length > 1 ? word.slice(1) : word);

// حروف الجر الملتصقة: (بعشر) (بميه) (بألف) (للمليون)
const stripPrep = (word: string): string => word.replace(/^[بلف]+/, '');

// كل الصيغ المحتملة للكلمة قبل البحث في القاموس (مع/بدون واو وحروف جر)
const wordVariants = (word: string): string[] => {
  const clean = normalizeArabicNumberText(word).trim();
  if (!clean) return [];
  const noWaw = stripWaw(clean);
  return [...new Set([clean, noWaw, stripPrep(clean), stripPrep(noWaw)])].filter(Boolean);
};

// تقسيم النص مع الحفاظ على الكسور العشرية (1.5) وإزالة فواصل الآلاف
const tokenize = (text: string): string[] => {
  let q = normalizeArabicNumberText(text);
  for (let i = 0; i < 4; i += 1) {
    q = q.replace(/(\d)[,\u060c\u066c](?=\d{3}(?!\d))/g, '$1');
  }
  return q
    .split(/[^\u0621-\u064A0-9a-zA-Z.]+/)
    .map((token) => token.replace(/^\.+|\.+$/g, ''))
    .filter(Boolean);
};

const asNumber = (token: string): number | null => {
  if (!/^\d+(?:[.,]\d+)?$/.test(token)) return null;
  const value = parseFloat(token.replace(',', '.'));
  return Number.isFinite(value) ? value : null;
};

// قيمة كلمة رقم مفردة: (عشر) 10، (مية) 100، (خمسة) 5
export function numberWordValue(word: string): number | null {
  for (const candidate of wordVariants(word)) {
    const value = WORD_VALUES.get(candidate);
    if (value !== undefined) return value;
  }
  return null;
}

// رقم من نص مكتوب بالحروف: (مية وعشرين) 120، (ثلاث مية) 300، (خمسة وتلاتين) 35
export function arabicNumberValue(text: string): number | null {
  const tokens = tokenize(text);
  let total = 0;
  let current: number | null = null;
  let seen = false;

  for (const token of tokens) {
    const digit = asNumber(token);
    if (digit !== null) {
      current = (current ?? 0) + digit;
      seen = true;
      continue;
    }

    const value = numberWordValue(token);
    if (value === null) {
      if (current !== null) {
        total += current;
        current = null;
      }
      continue;
    }

    seen = true;
    if (current === null) current = value;
    // (ثلاث مية) = 300 و(خمس مية) = 500 — المضاعف قبل المية
    else if (value >= 100 && current > 0 && current < 10) current *= value;
    else current += value;
  }

  if (current !== null) total += current;
  return seen && total > 0 ? total : null;
}

// هل الكلمة وحدة مالية؟ (مليون / ألف / مليار)
export function isArabicMoneyWord(word: string): boolean {
  return wordVariants(word).some((candidate) => UNIT_VALUES.has(candidate));
}

// هل الكلمة رقم مكتوب بالحروف؟
export const isArabicNumberWord = (word: string): boolean => numberWordValue(word) !== null;

// هل الكلمة من كلمات الغرف؟ (لاستثنائها من «المنطقة» في البحث)
const ROOM_WORDS = new Set([
  'غرف', 'غرفه', 'غرفتين', 'غرفتان', 'اوض', 'اوضه', 'اوضتين', 'اوضتان',
  'نوم', 'سرير', 'bedroom', 'bedrooms', 'room', 'rooms',
]);
export const isRoomWord = (word: string): boolean =>
  ROOM_WORDS.has(stripWaw(normalizeArabicNumberText(word).trim()));

// ===== المبالغ المالية المكتوبة بالحروف =====
// لا نعتبر أي رقم «سعراً» إلا لو معاه وحدة (ألف/مليون) أو عملة (جنيه)
// حتى لا تُقرأ «3 غرف» أو «120 متر» كسعر.
export function arabicMoneyValue(text: string): number | null {
  const q = normalizeArabicNumberText(text);
  if (!q) return null;
  const tokens = tokenize(q);
  const hasCurrency = /(جنيه|جنيها|ج\.?\s*م|egp|ريال|دولار|درهم)/.test(q);

  let total = 0;
  let current: number | null = null;
  let pendingFraction: number | null = null;
  let lastUnit = 0;
  let sawUnit = false;

  const flushFraction = () => {
    if (pendingFraction !== null && lastUnit) total += pendingFraction * lastUnit;
    pendingFraction = null;
  };

  for (const token of tokens) {
    const digit = asNumber(token);
    if (digit !== null) {
      current = (current ?? 0) + digit;
      continue;
    }

    // كلمة العملة تقفل الرقم الحالي وتحتفظ به (10000 جنيه)
    if (/(جنيه|جنيها|ريال|دولار|درهم|egp)/.test(token) || /^ج\.?م$/.test(token)) {
      if (current !== null) total += current;
      current = null;
      continue;
    }

    const variants = wordVariants(token);
    const fraction = variants.map((v) => FRACTION_VALUES.get(v)).find((v) => v !== undefined);
    if (fraction !== undefined) {
      pendingFraction = fraction;
      continue;
    }

    const unit = variants.map((v) => UNIT_VALUES.get(v)).find((v) => v !== undefined);
    if (unit) {
      const amount = current ?? pendingFraction ?? 1;
      total += amount * unit.base * (unit.dual ? 2 : 1);
      lastUnit = unit.base;
      sawUnit = true;
      current = null;
      pendingFraction = null;
      continue;
    }

    const value = numberWordValue(token);
    if (value !== null) {
      if (current === null) current = value;
      else if (value >= 100 && current > 0 && current < 10) current *= value;
      else current += value;
      continue;
    }

    // كلمة عادية (شقة / في / غرف): تقفل المجموعة الحالية ولا تُضاف للسعر
    flushFraction();
    current = null;
    lastUnit = 0;
  }

  flushFraction();
  if (current !== null) total += current;

  if (!sawUnit && !hasCurrency) return null;
  return total > 0 ? total : null;
}

// ===== عدد الغرف من نص حر =====
// (غرفتين) 2، (أوضتين) 2، (٣ غرف) 3، (غرفة واحدة) 1، (غرفة نوم) 1
export function roomsFromText(text: string): number | null {
  const q = normalizeArabicNumberText(text);
  if (!q) return null;

  // صيغة المثنى مباشرة
  if (/(غرفتين|غرفتان|اوضتين|اوضتان|اودتين|اودتان)/.test(q)) return 2;

  // مفرد + واحدة
  if (/(غرفه|اوضه)\s+(واحده|وحد)/.test(q)) return 1;

  const tokens = tokenize(q);
  for (let index = 0; index < tokens.length; index += 1) {
    const token = stripWaw(tokens[index]);
    if (!ROOM_WORDS.has(token)) continue;

    // رقم قبل كلمة الغرف: (3 غرف) (غرفتين) (تلات غرف)
    const before: string[] = [];
    for (let back = 1; back <= 4 && index - back >= 0; back += 1) {
      const prev = tokens[index - back];
      if (asNumber(prev) !== null || numberWordValue(prev) !== null) before.unshift(prev);
      else break;
    }
    if (before.length) {
      const value = arabicNumberValue(before.join(' '));
      if (value !== null && value >= 1 && value <= 12) return Math.round(value);
    }

    // رقم بعد كلمة الغرف: (غرفة 2)
    const next = tokens[index + 1];
    if (next) {
      const digit = asNumber(next);
      if (digit !== null && digit >= 1 && digit <= 12) return Math.round(digit);
      const value = numberWordValue(next);
      if (value !== null && value >= 1 && value <= 12) return Math.round(value);
    }

    // مفرد بلا رقم = غرفة واحدة
    if (token === 'غرفه' || token === 'اوضه') return 1;
  }

  return null;
}
