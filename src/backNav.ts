// ===== الرجوع بخطوة واحدة (زرار الرجوع / السحب من حافة الشاشة) =====
// المشكلة: السحب من يمين/شمال الشاشة — أو زرار الرجوع في الأندرويد — كان بيطلع
// المستخدم من البرنامج خالص. الحل: نضيف صفحة للـ history أول ما يفتح التطبيق،
// فالرجوع بيرجع جوّه: بيقفل آخر نافذة مفتوحة (خطوة واحدة) ومبيطلعش بره.
//
// كل النوافذ في الموقع (المودالات، نافذة الإجراء، مركز الإشعارات، صفحة العميل…)
// مرسومة فوق backdrop فيه onClick يقفلها — فقفل أعلى نافذة = الضغط عليها.

// أعلى نافذة مفتوحة دلوقتي (الأعلى z-index هو اللي فوق)
export const pickTopOverlay = (doc: Document, view?: Window): HTMLElement | null => {
  const nodes = Array.from(doc.querySelectorAll('div.fixed.inset-0')).filter((el) => {
    // جذر التطبيق نفسه مش نافذة
    if (el.classList.contains('app-root')) return false;
    if (view?.getComputedStyle) {
      const style = view.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
    }
    const rect = el.getBoundingClientRect?.();
    if (rect && (rect.width <= 0 || rect.height <= 0)) return false;
    return true;
  });
  if (!nodes.length) return null;
  const zOf = (el: Element): number => {
    const raw = view?.getComputedStyle
      ? view.getComputedStyle(el).zIndex
      : (el as HTMLElement).style?.zIndex || '';
    const n = parseInt(String(raw), 10);
    return Number.isFinite(n) ? n : 0;
  };
  return nodes.sort((a, b) => zOf(b) - zOf(a))[0] as HTMLElement;
};

// خطوة واحدة ورا: نقفل آخر نافذة مفتوحة، ولو مفيش نافذة نندعي الـ fallback
// (زي رجوع صفحة «الأرقام» للرئيسية). بترجع true لو اتقفل حاجة.
export const runBack = (
  fallback: () => boolean,
  doc: Document = typeof document !== 'undefined' ? document : (null as any),
  view?: Window
): boolean => {
  const overlay = pickTopOverlay(doc, view);
  if (overlay) {
    try { overlay.click(); } catch { /* لا شيء */ }
    return true;
  }
  try { return !!fallback(); } catch { return false; }
};

// تركيب حارس الرجوع: بيضيف صفحة للـ history وبيمنع الخروج من البرنامج.
// بيرجع دالة التنظيف (تشيل المستمع).
export const installBackGuard = (fallback: () => boolean): (() => void) => {
  const push = () => {
    try { window.history.pushState({ crmBack: Date.now() }, ''); } catch { /* المتصفح مش داعم */ }
  };
  const onPop = () => {
    runBack(fallback, document, window);
    // نرجّع صفحة الـ history: المستخدم ما بيخرجش من البرنامج أبداً
    push();
  };
  push();
  window.addEventListener('popstate', onPop);
  return () => window.removeEventListener('popstate', onPop);
};
