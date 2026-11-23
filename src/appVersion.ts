// ===== تحديث الموقع لوحده لما نسخة جديدة تنزل =====
// الموقع بيفضل مفتوح طول اليوم على أجهزة السيلز، فأي تصليح بينزل ما بيوصلهمش
// إلا لو عملوا تحديث بإيدهم (مثال: «تم الرد» فضل يحط ميعاد بكرة عند حسن بعد
// التصليح بساعة). هنا بنقارن ملف الواجهة الحالي بالموجود على السيرفر، ولو اتغيّر:
//   • الصفحة مش قدّامه (رجع للتطبيق بعد ما كان برّه) → تحديث على طول،
//   • الصفحة قدّامه → تحديث أول ما يسيب الكتابة (مش في نص كومنت).

const BUNDLE_RE = /\/assets\/index-[A-Za-z0-9_-]+\.js/;

export const bundleOf = (html: string): string => (String(html || '').match(BUNDLE_RE) || [''])[0];

export const currentBundle = (): string => {
  const scripts = Array.from(document.querySelectorAll('script[src]')) as HTMLScriptElement[];
  for (const s of scripts) {
    const m = bundleOf(s.getAttribute('src') || '');
    if (m) return m;
  }
  return '';
};

export const isNewVersion = (running: string, served: string): boolean =>
  !!running && !!served && running !== served;

// المستخدم بيكتب حاجة دلوقتي؟ (حقل نص عليه التركيز وفيه كلام)
const busyTyping = (): boolean => {
  const el = document.activeElement as HTMLInputElement | HTMLTextAreaElement | null;
  if (!el) return false;
  const tag = el.tagName;
  if (tag !== 'TEXTAREA' && tag !== 'INPUT' && !(el as any).isContentEditable) return false;
  return String((el as any).value || '').trim().length > 0;
};

export function startVersionWatch(intervalMs = 3 * 60 * 1000): () => void {
  const running = currentBundle();
  if (!running) return () => {}; // وضع التطوير (vite) — مفيش ملف مجمّع
  let pending = false;
  let stopped = false;

  const reloadWhenSafe = () => {
    if (stopped) return;
    if (document.visibilityState === 'hidden' || !busyTyping()) {
      window.location.reload();
    }
  };

  const check = async () => {
    if (stopped || pending) {
      if (pending) reloadWhenSafe();
      return;
    }
    try {
      const res = await fetch(`/?v=${Date.now()}`, { cache: 'no-store' });
      if (!res.ok) return;
      const served = bundleOf(await res.text());
      if (isNewVersion(running, served)) {
        pending = true;
        reloadWhenSafe();
      }
    } catch {
      /* مفيش نت — نجرب المرة الجاية */
    }
  };

  const onVisible = () => {
    if (document.visibilityState === 'visible') void check();
  };
  const timer = window.setInterval(() => void check(), intervalMs);
  document.addEventListener('visibilitychange', onVisible);
  window.addEventListener('focus', onVisible);
  void check();
  return () => {
    stopped = true;
    window.clearInterval(timer);
    document.removeEventListener('visibilitychange', onVisible);
    window.removeEventListener('focus', onVisible);
  };
}
