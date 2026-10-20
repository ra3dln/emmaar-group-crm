// ===== ألوان الموقع القابلة للتخصيص لكل مستخدم =====
// ثلاثة اختيارات مستقلة: لون الهوية، لون الخلفية، ولون الأيقونات.
// أي لون مسموح (بكرة ألوان كاملة + إدخال HEX)، لا قائمة ثابتة.
// الاختيار يُحفظ على جهاز المستخدم بمفتاح خاص به، ولا يؤثر على غيره.

export type ThemeMode = 'dark' | 'light';

export type ThemeChoice = {
  brand: string; // لون الهوية — HEX
  icons: string; // HEX أو 'default' (ألوان الأيقونات الأصلية)
  background: string; // HEX أو 'auto' (خلفية الوضع كما هي)
};

// خلفية «تلقائية» = نفس ألوان الوضع الحالي (ليلي/نهاري) بلا تلوين
export const AUTO_BACKGROUND = 'auto';

export const DEFAULT_THEME: ThemeChoice = {
  brand: '#0d8184',
  icons: 'default',
  background: AUTO_BACKGROUND,
};

// ألوان جاهزة سريعة تحت البكرة (اختيارية — البكرة تقبل أي لون)
export const PRESET_COLORS: { label: string; hex: string }[] = [
  { label: 'تركواز', hex: '#0d8184' },
  { label: 'أزرق', hex: '#2563eb' },
  { label: 'أخضر', hex: '#059669' },
  { label: 'بنفسجي', hex: '#7c3aed' },
  { label: 'ذهبي', hex: '#b45309' },
  { label: 'وردي', hex: '#be123c' },
  { label: 'برتقالي', hex: '#ea580c' },
  { label: 'رمادي', hex: '#475569' },
];

// ألوان خلفية مقترحة (هادئة بما يكفي ليبقى النص مقروءاً)
export const BACKGROUND_PRESETS: { label: string; hex: string }[] = [
  { label: 'أزرق ليلي', hex: '#101a2b' },
  { label: 'أخضر غامق', hex: '#0d1f1a' },
  { label: 'بنفسجي', hex: '#1a1330' },
  { label: 'عنبري', hex: '#241a10' },
  { label: 'رمادي فحمي', hex: '#1a1c20' },
  { label: 'أبيض دافئ', hex: '#f3f0ea' },
  { label: 'رملي', hex: '#e9e2d6' },
  { label: 'أزرق فاتح', hex: '#e6eef6' },
];

// أسماء اللوحات القديمة — لتحويل أي اختيار محفوظ سابقاً إلى HEX
const LEGACY_PALETTES: Record<string, string> = {
  teal: '#0d8184',
  blue: '#2563eb',
  emerald: '#059669',
  violet: '#7c3aed',
  amber: '#b45309',
  rose: '#be123c',
  slate: '#475569',
};

const STORAGE_PREFIX = 'crm_theme_';
const keyOf = (userId?: string) => `${STORAGE_PREFIX}${userId || 'guest'}`;

// ---------- أدوات اللون ----------
const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

export const normalizeHex = (value?: string): string | null => {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw || raw === AUTO_BACKGROUND) return null;
  const candidate = LEGACY_PALETTES[raw] || raw;
  const match = candidate.match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!match) return null;
  const body = match[1];
  if (body.length === 3) return `#${body.split('').map((c) => c + c).join('')}`;
  return `#${body}`;
};

const toRgb = (hex: string): [number, number, number] => {
  const clean = normalizeHex(hex) || '#000000';
  const n = parseInt(clean.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

const toHex = (r: number, g: number, b: number): string =>
  `#${[r, g, b].map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('')}`;

export const rgba = (hex: string, alpha: number): string => {
  const [r, g, b] = toRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

// دمج لونين: weight = نسبة اللون الثاني في الناتج (0 → الأول، 1 → الثاني)
export const mix = (from: string, to: string, weight: number): string => {
  const [r1, g1, b1] = toRgb(from);
  const [r2, g2, b2] = toRgb(to);
  const w = clamp(weight, 0, 1);
  return toHex(r1 + (r2 - r1) * w, g1 + (g2 - g1) * w, b1 + (b2 - b1) * w);
};

export const lighten = (hex: string, percent: number): string => mix(hex, '#ffffff', percent / 100);
export const darken = (hex: string, percent: number): string => mix(hex, '#000000', percent / 100);

// تحويل HEX ↔ HSL — نحتاجه لبناء خلفية بنفس درجة اللون المختار وإضاءة الوضع الحالي
// (مُصدّران أيضاً لأن بكرة الألوان في الواجهة تحسب منهما موضع المؤشر)
export const rgbToHsl = (hex: string): [number, number, number] => {
  const [r, g, b] = toRgb(hex).map((v) => v / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const delta = max - min;
  if (!delta) return [0, 0, l];
  const s = l > 0.5 ? delta / (2 - max - min) : delta / (max + min);
  let h = 0;
  if (max === r) h = ((g - b) / delta) % 6;
  else if (max === g) h = (b - r) / delta + 2;
  else h = (r - g) / delta + 4;
  return [(h * 60 + 360) % 360, s, l];
};

export const hslToHex = (h: number, s: number, l: number): string => {
  const hue = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * clamp(s, 0, 1);
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = l - c / 2;
  const [r1, g1, b1] =
    hue < 60 ? [c, x, 0] :
    hue < 120 ? [x, c, 0] :
    hue < 180 ? [0, c, x] :
    hue < 240 ? [0, x, c] :
    hue < 300 ? [x, 0, c] : [c, 0, x];
  return toHex((r1 + m) * 255, (g1 + m) * 255, (b1 + m) * 255);
};

// نسبة السطوع المدركة (0 غامق → 1 فاتح) — تُستخدم لضبط التباين
export const luminance = (hex: string): number => {
  const [r, g, b] = toRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

// لون نص يبان فوق لون معيّن
export const readableOn = (hex: string): string => (luminance(hex) > 0.55 ? '#0b1117' : '#ffffff');

// ---------- الحفظ والقراءة ----------
const toColorChoice = (value: unknown, fallback: string): string => {
  if (value === AUTO_BACKGROUND) return AUTO_BACKGROUND;
  return normalizeHex(typeof value === 'string' ? value : '') || fallback;
};

export function readThemeChoice(userId?: string): ThemeChoice {
  try {
    const raw = JSON.parse(localStorage.getItem(keyOf(userId)) || '{}');
    const icons = raw?.icons === 'default' ? 'default' : toColorChoice(raw?.icons, 'default');
    return {
      brand: toColorChoice(raw?.brand, DEFAULT_THEME.brand),
      icons,
      background: toColorChoice(raw?.background, AUTO_BACKGROUND),
    };
  } catch {
    return { ...DEFAULT_THEME };
  }
}

export function saveThemeChoice(choice: ThemeChoice, userId?: string): void {
  try {
    localStorage.setItem(keyOf(userId), JSON.stringify(choice));
  } catch {
    /* لا شيء */
  }
}

let lastUserId = '';

// المتغيّرات التي نكتبها داخل <html> — نمسحها كلها عند العودة للخلفية الأصلية
const BG_VARS = ['--bg', '--bg-deep', '--surface', '--surface-2', '--surface-solid', '--surface-raised'];

export function applyThemeChoice(choice: ThemeChoice): void {
  if (typeof document === 'undefined') return;
  const mode: ThemeMode = document.documentElement.dataset.mode === 'light' ? 'light' : 'dark';
  const root = document.documentElement.style;

  const brand = normalizeHex(choice.brand) || DEFAULT_THEME.brand;
  const brandLum = luminance(brand);

  // لون الهوية كنص/حدود: نرفع تباينه لو بعيد جداً عن خلفية الوضع
  const brandText =
    mode === 'dark'
      ? brandLum < 0.22
        ? lighten(brand, 38)
        : brand
      : brandLum > 0.5
        ? darken(brand, 34)
        : brand;

  // تعبئة الأزرار: في النهاري نغمّقها قليلاً حتى يبان النص الأبيض
  const fill = mode === 'light' && brandLum > 0.62 ? darken(brand, 18) : brand;
  const deep = darken(fill, 16);
  const light = lighten(brand, 18);

  root.setProperty('--brand', brandText);
  root.setProperty('--brand-strong', brandText);
  root.setProperty('--brand-fill', fill);
  root.setProperty('--brand-deep', deep);
  root.setProperty('--brand-accent', light);
  root.setProperty('--brand-gradient', fill);
  root.setProperty('--primary', brandText);
  root.setProperty('--primary-dark', deep);
  root.setProperty('--primary-light', light);
  root.setProperty('--brand-primary', brandText);
  root.setProperty('--brand-primary-dark', deep);
  root.setProperty('--brand-primary-light', light);
  root.setProperty('--brand-primary-soft', rgba(brandText, 0.22));
  root.setProperty('--brand-primary-softer', rgba(brandText, 0.14));
  root.setProperty('--brand-primary-glow', rgba(brandText, 0.45));
  root.setProperty('--bg-grad-1', rgba(brandText, mode === 'dark' ? 0.14 : 0.09));
  root.setProperty('--on-brand', readableOn(fill));
  root.setProperty('--glow', `0 0 0 1px ${rgba(brandText, 0.35)}`);

  // ---- لون الخلفية: نأخذ درجة اللون المختار ونبني منها خلفية الوضع الحالي ----
  // التلوين بنفس «الإضاءة» يحفظ تباين النصوص مهما اخترت لوناً فاتحاً أو لغامقاً،
  // وفي نفس الوقت تتغيّر خلفية الموقع فعلاً لأن اللون لا يُلغى في أبيض/أسود.
  const background = normalizeHex(choice.background);
  if (background) {
    const [hue, sat] = rgbToHsl(background);
    const s = clamp(Math.max(sat * 0.75, 0.12), 0.12, 0.55);
    const dark = mode === 'dark';
    const surface = hslToHex(hue, s * 0.7, dark ? 0.13 : 0.99);
    root.setProperty('--bg', hslToHex(hue, s, dark ? 0.095 : 0.955));
    root.setProperty('--bg-deep', hslToHex(hue, s, dark ? 0.07 : 0.925));
    root.setProperty('--surface', surface);
    root.setProperty('--surface-2', hslToHex(hue, s * 0.7, dark ? 0.155 : 0.975));
    root.setProperty('--surface-solid', surface);
    root.setProperty('--surface-raised', hslToHex(hue, s * 0.7, dark ? 0.185 : 1));
  } else {
    for (const name of BG_VARS) root.removeProperty(name);
  }

  // ---- لون الأيقونات ----
  const icons = normalizeHex(choice.icons);
  if (icons) root.setProperty('--icon-color', icons);
  else root.removeProperty('--icon-color');
}

export function applyThemeForUser(userId?: string): void {
  lastUserId = userId || '';
  applyThemeChoice(readThemeChoice(userId));
}

export function reapplyCurrentTheme(): void {
  applyThemeChoice(readThemeChoice(lastUserId));
}
