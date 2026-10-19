// ===== ألوان الموقع القابلة للتخصيص لكل مستخدم =====
// اختياران مستقلان: لون الموقع (الهوية/الأزرار) ولون الأيقونات.
// يُحفظ الاختيار على جهاز المستخدم بمفتاح خاص به، ولا يؤثر على غيره.

export type ThemeMode = 'dark' | 'light';

export type Palette = {
  id: string;
  label: string;
  dark: { brand: string; fill: string; deep: string; accent: string };
  light: { brand: string; fill: string; deep: string; accent: string };
};

export const PALETTES: Palette[] = [
  {
    id: 'teal',
    label: 'تركواز',
    dark: { brand: '#63d4d0', fill: '#0d8184', deep: '#0b6e70', accent: '#8ce4e0' },
    light: { brand: '#0b6a6d', fill: '#119497', deep: '#0a5f62', accent: '#0b6a6d' },
  },
  {
    id: 'blue',
    label: 'أزرق',
    dark: { brand: '#93c5fd', fill: '#2563eb', deep: '#1d4ed8', accent: '#bfdbfe' },
    light: { brand: '#1d4ed8', fill: '#2563eb', deep: '#1e40af', accent: '#1d4ed8' },
  },
  {
    id: 'emerald',
    label: 'أخضر',
    dark: { brand: '#6ee7b7', fill: '#059669', deep: '#047857', accent: '#a7f3d0' },
    light: { brand: '#047857', fill: '#059669', deep: '#065f46', accent: '#047857' },
  },
  {
    id: 'violet',
    label: 'بنفسجي',
    dark: { brand: '#c4b5fd', fill: '#7c3aed', deep: '#6d28d9', accent: '#ddd6fe' },
    light: { brand: '#6d28d9', fill: '#7c3aed', deep: '#5b21b6', accent: '#6d28d9' },
  },
  {
    id: 'amber',
    label: 'ذهبي',
    dark: { brand: '#fcd34d', fill: '#b45309', deep: '#92400e', accent: '#fde68a' },
    light: { brand: '#92400e', fill: '#b45309', deep: '#78350f', accent: '#92400e' },
  },
  {
    id: 'rose',
    label: 'وردي',
    dark: { brand: '#fda4af', fill: '#be123c', deep: '#9f1239', accent: '#fecdd3' },
    light: { brand: '#be123c', fill: '#be123c', deep: '#9f1239', accent: '#be123c' },
  },
  {
    id: 'slate',
    label: 'رمادي',
    dark: { brand: '#cbd5e1', fill: '#475569', deep: '#334155', accent: '#e2e8f0' },
    light: { brand: '#334155', fill: '#475569', deep: '#1e293b', accent: '#334155' },
  },
];

export type ThemeChoice = { brand: string; icons: string };
// icons = 'default' يعني نسيب ألوان الأيقونات الأصلية كما هي
export const DEFAULT_THEME: ThemeChoice = { brand: 'teal', icons: 'default' };

const STORAGE_PREFIX = 'crm_theme_';
const keyOf = (userId?: string) => `${STORAGE_PREFIX}${userId || 'guest'}`;

const paletteOf = (id?: string): Palette => PALETTES.find((p) => p.id === id) || PALETTES[0];

const hexToRgb = (hex: string): string => {
  const clean = String(hex).replace('#', '');
  const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean;
  const n = parseInt(full, 16);
  if (!Number.isFinite(n)) return '99, 212, 208';
  return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
};

export function readThemeChoice(userId?: string): ThemeChoice {
  try {
    const raw = JSON.parse(localStorage.getItem(keyOf(userId)) || '{}');
    return {
      brand: PALETTES.some((p) => p.id === raw?.brand) ? raw.brand : DEFAULT_THEME.brand,
      icons: raw?.icons === 'default' || raw?.icons === 'brand' || PALETTES.some((p) => p.id === raw?.icons) ? raw.icons : DEFAULT_THEME.icons,
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

export function applyThemeChoice(choice: ThemeChoice): void {
  if (typeof document === 'undefined') return;
  const mode: ThemeMode = document.documentElement.dataset.mode === 'light' ? 'light' : 'dark';
  const brandPalette = paletteOf(choice.brand);
  const brand = brandPalette[mode];
  const icon = choice.icons === 'default'
    ? null
    : (choice.icons === 'brand' ? brandPalette : paletteOf(choice.icons))[mode];
  const root = document.documentElement.style;

  root.setProperty('--brand', brand.brand);
  root.setProperty('--brand-fill', brand.fill);
  root.setProperty('--brand-deep', brand.deep);
  root.setProperty('--brand-strong', brand.brand);
  root.setProperty('--brand-accent', brand.accent);
  root.setProperty('--brand-primary', brand.fill);
  root.setProperty('--brand-primary-dark', brand.deep);
  root.setProperty('--brand-primary-light', brand.accent);
  root.setProperty('--brand-primary-soft', `rgba(${hexToRgb(brand.brand)}, 0.22)`);
  root.setProperty('--brand-primary-softer', `rgba(${hexToRgb(brand.brand)}, 0.14)`);
  root.setProperty('--brand-primary-glow', `rgba(${hexToRgb(brand.brand)}, 0.45)`);
  root.setProperty('--on-brand', '#ffffff');
  if (icon) root.setProperty('--icon-color', icon.brand);
  else root.removeProperty('--icon-color');
}

export function applyThemeForUser(userId?: string): void {
  lastUserId = userId || '';
  applyThemeChoice(readThemeChoice(userId));
}

export function reapplyCurrentTheme(): void {
  applyThemeChoice(readThemeChoice(lastUserId));
}
