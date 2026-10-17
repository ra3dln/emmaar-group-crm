// ===== الإشعارات الحقيقية (تصل والموقع مقفول) =====
// المتصفح يشترك في خدمة الإشعارات، والسيرفر هو الذي يرسل — فلا حاجة أن يكون الموقع مفتوحاً.
const SW_URL = '/sw.js';

export type PushState = 'unsupported' | 'default' | 'denied' | 'subscribed';
export type PushResult = { ok: boolean; state: PushState; message: string; devices?: number };

export const pushSupported = (): boolean =>
  typeof window !== 'undefined'
  && 'serviceWorker' in navigator
  && 'PushManager' in window
  && 'Notification' in window;

const urlBase64ToUint8Array = (base64: string): Uint8Array<ArrayBuffer> => {
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob(padded.replace(/-/g, '+').replace(/_/g, '/'));
  // نُمرّر ArrayBuffer صريحاً حتى يقبله إشعار المتصفح بلا مشاكل أنواع
  const buffer = new ArrayBuffer(raw.length);
  const out = new Uint8Array(buffer);
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
};

export async function registerWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null;
  try {
    const existing = await navigator.serviceWorker.getRegistration(SW_URL);
    if (existing) return existing;
    return await navigator.serviceWorker.register(SW_URL, { scope: '/' });
  } catch {
    return null;
  }
}

const fetchVapidKey = async (): Promise<string | null> => {
  try {
    const res = await fetch('/api/push/key');
    if (!res.ok) return null;
    const json = await res.json();
    return json.publicKey || null;
  } catch {
    return null;
  }
};

// هل هذا الجهاز مشترك فعلاً؟
export async function isSubscribed(): Promise<boolean> {
  if (!pushSupported()) return false;
  try {
    const registration = await navigator.serviceWorker.getRegistration(SW_URL);
    if (!registration) return false;
    const subscription = await registration.pushManager.getSubscription();
    return !!subscription;
  } catch {
    return false;
  }
}

export async function pushState(): Promise<PushState> {
  if (!pushSupported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  if (await isSubscribed()) return 'subscribed';
  return 'default';
}

// تفعيل الإشعارات: صلاحية + اشتراك + تسجيل الجهاز على السيرفر
export async function enablePush(user: { id: string; name?: string }): Promise<PushResult> {
  if (!pushSupported()) {
    return { ok: false, state: 'unsupported', message: 'المتصفح لا يدعم الإشعارات — استخدم كروم أو ثبّت الموقع كتطبيق' };
  }

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    // نشرح السبب والحل بدقة لأن كل حالة لها طريق مختلف:
    const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);
    const isAndroid = /Android/i.test(navigator.userAgent);
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone === true;
    if (permission === 'denied') {
      return {
        ok: false,
        state: 'denied',
        message: 'الإشعارات محظورة لهذا الموقع من إعدادات المتصفح. الحل: اضغط أيقونة 🔒 بجانب رابط الموقع ← «الإشعارات» ← «السماح» ← أعد تحميل الصفحة واضغط تفعيل من جديد',
      };
    }
    if (isIOS && !isStandalone) {
      return {
        ok: false,
        state: 'default',
        message: 'آيفون لا يسمح بإشعارات الويب إلا للتطبيق المثبّت على الشاشة الرئيسية (iOS 16.4 وأحدث). الحل: زر المشاركة ⬆ ← «إضافة إلى الشاشة الرئيسية» ← افتح التطبيق من أيقونته ← فعّل الإشعارات من جديد',
      };
    }
    if (isAndroid && !isStandalone) {
      return {
        ok: false,
        state: 'default',
        message: 'كروم على الهاتف لا يُظهر نافذة الصلاحية إلا للتطبيق المثبّت. الحل: قائمة المتصفح ⋮ ← «إضافة إلى الشاشة الرئيسية» ← افتح التطبيق من أيقونته ← ثم اضغط تفعيل',
      };
    }
    return {
      ok: false,
      state: 'default',
      message: 'لم تظهر نافذة الصلاحية أو أُغلقت بلا موافقة — أعد المحاولة واضغط «السماح» فور ظهورها',
    };
  }

  const registration = await registerWorker();
  if (!registration) return { ok: false, state: 'default', message: 'تعذّر تشغيل خدمة الإشعارات' };

  const vapidKey = await fetchVapidKey();
  if (!vapidKey) {
    return { ok: false, state: 'default', message: 'السيرفر لا يوفّر مفتاح الإشعارات — أعد تشغيل السيرفر (npm run dev)' };
  }

  try {
    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidKey),
      });
    }

    const res = await fetch('/api/push/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: user.id, userName: user.name || '', subscription }),
    });
    if (!res.ok) return { ok: false, state: 'default', message: 'تعذّر تسجيل هذا الجهاز على السيرفر' };
    const json = await res.json();
    // إشعار تأكيد فوري: يثبت أن الإشعارات تصل لهذا الجهاز فعلاً
    await localNotification(
      '✅ تم تفعيل الإشعارات بنجاح',
      'هذا إشعار تأكيد — الرسائل والتذكيرات هتوصلك حتى والموقع مقفول',
      'push-confirmation'
    );
    return { ok: true, state: 'subscribed', message: `الإشعارات مفعّلة على ${json.devices || 1} جهاز — وصلك إشعار تأكيد الآن ✓`, devices: json.devices };
  } catch (error) {
    // أشهر سبب هنا: المتصفح لا يستطيع الوصول لخدمة الإشعارات (إنترنت/شبكة)
    return {
      ok: false,
      state: 'default',
      message: 'تعذّر إنشاء اشتراك الإشعارات — تأكد أن السيرفر متصل بالإنترنت',
    };
  }
}

export async function disablePush(): Promise<PushResult> {
  if (!pushSupported()) return { ok: false, state: 'unsupported', message: 'غير مدعوم' };
  try {
    const registration = await navigator.serviceWorker.getRegistration(SW_URL);
    const subscription = await registration?.pushManager.getSubscription();
    if (subscription) {
      await fetch('/api/push/unsubscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint: subscription.endpoint }),
      }).catch(() => {});
      await subscription.unsubscribe();
    }
    return { ok: true, state: 'default', message: 'تم إيقاف الإشعارات على هذا الجهاز' };
  } catch {
    return { ok: false, state: 'default', message: 'تعذّر إيقاف الإشعارات' };
  }
}

// إشعار تجريبي فوري: عبر السيرفر (push حقيقي) وإن تعذّر فعبر خدمة الإشعارات محلياً
export async function sendTestPush(user: { id: string }): Promise<PushResult> {
  try {
    const res = await fetch('/api/push/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: user.id }),
    });
    const json = await res.json().catch(() => ({}));
    if (res.ok && json.ok) {
      return { ok: true, state: 'subscribed', message: 'تم إرسال إشعار تجريبي حقيقي من السيرفر' };
    }
    const local = await localNotification('🔔 إشعار تجريبي', 'هذا إشعار من الجهاز نفسه — لتفعيل الإشعارات والموقع مقفول اضغط «تفعيل الإشعارات»');
    return local
      ? { ok: true, state: 'default', message: 'وصل إشعار محلي (لم يُرسل من السيرفر بعد)' }
      : { ok: false, state: 'default', message: 'تعذّر إرسال الإشعار التجريبي' };
  } catch {
    const local = await localNotification('🔔 إشعار تجريبي', 'إشعار محلي من الجهاز');
    return local
      ? { ok: true, state: 'default', message: 'وصل إشعار محلي' }
      : { ok: false, state: 'default', message: 'تعذّر إرسال الإشعار التجريبي' };
  }
}

// إشعار محلي فوري (يعمل والموقع مفتوح) — يمر دائماً عبر Service Worker.
// آيفون لا يدعم new Notification أبداً، لذلك ننتظر جاهزية العامل ونستخدمه هو.
export async function localNotification(title: string, body: string, tag?: string, url = '/'): Promise<boolean> {
  if (!pushSupported() || Notification.permission !== 'granted') return false;
  try {
    const registration = await navigator.serviceWorker.ready;
    registration.active?.postMessage({ type: 'notify', title, body, tag: tag || `local-${Date.now()}`, url });
    return true;
  } catch {
    return false;
  }
}

// إعادة تسجيل هذا الجهاز على السيرفر بلا طلب صلاحية جديدة.
// مهم لآيفون: الاشتراك قد يتجدّد بعد تحديث التطبيق، وللقاعدة لو تغيّرت،
// فلا نريد أن يجلس المستخدم بلا إشعارات وهو فاكرها مفعّلة.
export async function resyncPush(user: { id: string; name?: string }): Promise<PushState> {
  if (!pushSupported()) return 'unsupported';
  if (Notification.permission !== 'granted') return pushState();
  try {
    // نسجّل العامل أولاً (لو المتصفح مسحه) وبننتظر جاهزيته بحد أقصى ٤ ثوانٍ
    // حتى لا يعلّق التطبيق لو الإشعارات مش مسجّلة في هذا المتصفح أصلاً.
    await registerWorker();
    const registration = await Promise.race([
      navigator.serviceWorker.ready,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 4000)),
    ]);
    if (!registration) return await pushState();
    const subscription = await registration.pushManager.getSubscription();
    if (!subscription) return 'default';
    const res = await fetch('/api/push/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: user.id, userName: user.name || '', subscription }),
    });
    return res.ok ? 'subscribed' : 'default';
  } catch {
    return 'default';
  }
}
