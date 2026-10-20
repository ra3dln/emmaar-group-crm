// ===== بكرة ألوان حقيقية داخل الصفحة =====
// لا تعتمد على منتقي النظام (اللي كان ممكن يفتح أو ما يفتحش حسب المتصفح)،
// بل دائرة طيف مرسومة بالـCSS: السحب داخلها يختار الدرجة والتشبّع، وشريط
// أسفلها يضبط الإضاءة، مع كتابة كود HEX يدوياً. نفس البكرة تُستخدم في
// الشريط العلوي وفي تبويب الإعدادات.
import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, Palette, X } from 'lucide-react';
import {
  AUTO_BACKGROUND,
  BACKGROUND_PRESETS,
  PRESET_COLORS,
  ThemeChoice,
  applyThemeChoice,
  applyThemeForUser,
  hslToHex,
  normalizeHex,
  readThemeChoice,
  rgbToHsl,
  saveThemeChoice,
} from './theme';

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

// الدائرة: الزاوية = درجة اللون، والبُعد عن المركز = التشبّع
export function ColorWheel({
  label,
  value,
  onChange,
  autoLabel,
  autoValue,
  placeholder = '#0D8184',
  size = 'sm',
}: {
  label: string;
  value: string;
  onChange: (hex: string) => void;
  autoLabel?: string;
  autoValue?: string;
  placeholder?: string;
  size?: 'sm' | 'lg';
}) {
  const discRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const hex = normalizeHex(value);
  const [draft, setDraft] = useState(hex || '');
  useEffect(() => setDraft(hex || ''), [hex]);

  const [hue, sat, light] = rgbToHsl(hex || '#0d8184');
  const isAuto = !hex;

  const pickAt = (clientX: number, clientY: number) => {
    const el = discRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const dx = clientX - (rect.left + rect.width / 2);
    const dy = clientY - (rect.top + rect.height / 2);
    const distance = Math.hypot(dx, dy) / (rect.width / 2);
    const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
    onChange(hslToHex((angle + 360) % 360, clamp01(distance), hex ? light : 0.5));
  };

  const commitHex = (text: string) => {
    setDraft(text);
    const next = normalizeHex(text);
    if (next) onChange(next);
  };

  const nudge = (event: React.KeyboardEvent) => {
    const step = event.shiftKey ? 15 : 5;
    const nextHue = event.key === 'ArrowLeft' ? hue - step : event.key === 'ArrowRight' ? hue + step : hue;
    const nextSat = event.key === 'ArrowUp' ? clamp01(sat + 0.06) : event.key === 'ArrowDown' ? clamp01(sat - 0.06) : sat;
    if (nextHue === hue && nextSat === sat) return;
    event.preventDefault();
    onChange(hslToHex(nextHue, nextSat, hex ? light : 0.5));
  };

  const markerLeft = 50 + Math.cos((hue * Math.PI) / 180) * sat * 50;
  const markerTop = 50 + Math.sin((hue * Math.PI) / 180) * sat * 50;

  return (
    <div className={`cw ${size === 'lg' ? 'cw-lg' : 'cw-sm'}`}>
      <div
        ref={discRef}
        role="slider"
        tabIndex={0}
        aria-label={`${label} — درجة اللون والتشبّع`}
        aria-valuemin={0}
        aria-valuemax={360}
        aria-valuenow={Math.round(hue)}
        className="cw-disc"
        onPointerDown={(event) => {
          try {
            event.currentTarget.setPointerCapture(event.pointerId);
          } catch {
            /* بعض المتصفحات ترفض الالتقاط قبل بدء السحبة — السحب بالحركة يكفي */
          }
          setDragging(true);
          pickAt(event.clientX, event.clientY);
        }}
        onPointerMove={(event) => {
          if (dragging) pickAt(event.clientX, event.clientY);
        }}
        onPointerUp={(event) => {
          setDragging(false);
          try {
            event.currentTarget.releasePointerCapture?.(event.pointerId);
          } catch {
            /* لا شيء */
          }
        }}
        onPointerCancel={() => setDragging(false)}
        onKeyDown={nudge}
      >
        <span className="cw-mask" />
        <span
          className="cw-marker"
          style={{
            left: `${isAuto ? 50 : markerLeft}%`,
            top: `${isAuto ? 50 : markerTop}%`,
            background: hex || '#ffffff',
          }}
        />
      </div>

      <div className="cw-body">
        <p className="theme-pop-label">{label}</p>
        <div className="cw-line">
          <input
            dir="ltr"
            value={draft}
            onChange={(event) => commitHex(event.target.value)}
            maxLength={7}
            placeholder={placeholder}
            aria-label={`${label} — كود اللون`}
            className="theme-hex"
          />
          {autoLabel && autoValue && (
            <button
              type="button"
              onClick={() => onChange(autoValue)}
              className={`theme-swatch-auto ${isAuto ? 'on' : ''}`}
            >
              {autoLabel}
            </button>
          )}
        </div>
        <input
          type="range"
          min={0}
          max={100}
          value={Math.round(light * 100)}
          onChange={(event) => onChange(hslToHex(hue, sat, Number(event.target.value) / 100))}
          aria-label={`${label} — الإضاءة`}
          className="cw-range"
          style={{
            background: `linear-gradient(to right, #000, hsl(${hue} 100% 50%), #fff)`,
          }}
        />
      </div>
    </div>
  );
}

// محرّر ألوان الموقع كامل: بكرة كبيرة تلّون الموقع كله + لوحات جاهزة + خلفية وأيقونات
export function ThemeEditor({
  choice,
  onPick,
}: {
  choice: ThemeChoice;
  onPick: (patch: Partial<ThemeChoice>) => void;
}) {
  // البكرة الكبيرة تلوّن الموقع كله: لون الهوية + خلفية بنفس الدرجة
  const applyWholeSite = (hex: string) => onPick({ brand: hex, background: hex });

  return (
    <div className="theme-editor">
      <div className="theme-hero">
        <ColorWheel
          label="لون الموقع كله"
          value={choice.brand}
          onChange={applyWholeSite}
          size="lg"
        />
      </div>
      <p className="theme-pop-note">اسحب داخل الدائرة واختار الدرجة — الأزرار والخلفية والأيقونات تتلوّن معاً.</p>

      <p className="theme-pop-label">لوحات جاهزة</p>
      <div className="theme-swatches">
        {PRESET_COLORS.map((preset) => {
          const on = normalizeHex(choice.brand) === preset.hex;
          return (
            <button
              key={preset.hex}
              type="button"
              onClick={() => applyWholeSite(preset.hex)}
              title={preset.label}
              aria-label={preset.label}
              className={`theme-swatch ${on ? 'on' : ''}`}
              style={{ background: preset.hex }}
            >
              {on && <Check className="w-3.5 h-3.5" />}
            </button>
          );
        })}
      </div>

      <div className="theme-adv">
        <ColorWheel
          label="خلفية الموقع"
          value={choice.background}
          onChange={(hex) => onPick({ background: hex })}
          autoLabel="الأصلية"
          autoValue={AUTO_BACKGROUND}
          placeholder="تلقائي"
        />
        <div className="theme-swatches theme-swatches-sm">
          {BACKGROUND_PRESETS.map((preset) => (
            <button
              key={preset.hex}
              type="button"
              onClick={() => onPick({ background: preset.hex })}
              title={preset.label}
              aria-label={preset.label}
              className={`theme-swatch theme-swatch-sm ${
                normalizeHex(choice.background) === preset.hex ? 'on' : ''
              }`}
              style={{ background: preset.hex }}
            />
          ))}
        </div>
        <ColorWheel
          label="أيقونات القائمة والشريط العلوي"
          value={choice.icons}
          onChange={(hex) => onPick({ icons: hex })}
          autoLabel="الأصلية"
          autoValue="default"
          placeholder="الأصلي"
        />
      </div>

      <p className="theme-pop-note theme-pop-note-dim">يُحفظ على جهازك فقط — كل موظف يختار ألوانه.</p>
    </div>
  );
}

// حالة ألوان المستخدم: قراءة عند الدخول، وحفظ + تطبيق لحظي عند أي تغيير
function useThemeChoice(userId?: string) {
  const [choice, setChoice] = useState<ThemeChoice>(() => readThemeChoice(userId));

  // عند تبديل المستخدم: نقرأ ألوانه ونطبّقها (ولا نكتب فوقها)
  useEffect(() => {
    const next = readThemeChoice(userId);
    setChoice(next);
    applyThemeChoice(next);
  }, [userId]);

  // كل تغيير يُكتب ويُطبّق في نفس اللحظة — بلا انتظار دورة رسم
  const update = (patch: Partial<ThemeChoice>) =>
    setChoice((prev) => {
      const next = { ...prev, ...patch };
      saveThemeChoice(next, userId);
      applyThemeChoice(next);
      return next;
    });

  return { choice, update };
}

// زر ألوان الموقع في الشريط العلوي — يفتح نفس المحرّر في لوحة صغيرة
export function ThemePaletteButton({ userId }: { userId?: string }) {
  const [open, setOpen] = useState(false);
  const { choice, update } = useThemeChoice(userId);

  return (
    <div className="relative">
      <motion.button
        whileHover={{ scale: 1.05 }}
        onClick={() => setOpen((value) => !value)}
        title="ألوان الموقع"
        aria-label="ألوان الموقع"
        className="icon-btn theme-palette-btn"
      >
        <Palette className="w-4 h-4" />
      </motion.button>

      <AnimatePresence>
        {open && (
          <>
            <div className="fixed inset-0 z-[110]" onClick={() => setOpen(false)} />
            <motion.div
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              className="theme-pop z-[120]"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="flex items-center justify-between gap-2 mb-2">
                <p className="theme-pop-title">ألوان الموقع</p>
                <button type="button" onClick={() => setOpen(false)} className="theme-pop-close" title="إغلاق">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
              <ThemeEditor choice={choice} onPick={update} />
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

// محرّر ألوان داخل تبويب الإعدادات — نفس المحرّر لكن ظاهر دائماً
// (بعض المستخدمين لا يجدون زر الشريط العلوي، فيجدون الألوان في مكانها الطبيعي)
export function ThemeSettingsPanel({ userId }: { userId?: string }) {
  const { choice, update } = useThemeChoice(userId);
  return <ThemeEditor choice={choice} onPick={update} />;
}
