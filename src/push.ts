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
      try {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(vapidKey),
        });
      } catch (error) {
        // اشتراك قديم بمفتاح سابق يمنع إنشاء اشتراك جديد (InvalidStateError):
        // نلغيه ثم نُنشئ اشتراكاً بالمفتاح الحالي — بدون ذلك يبقى الجهاز
        // «مفعّلاً» في الشاشة ولا يصله أي إشعار إطلاقاً.
        const stale = await registration.pushManager.getSubscription();
        if (!stale) throw error;
        await stale.unsubscribe();
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(vapidKey),
        });
      }
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
    // لا أجهزة مسجّلة: الإشعار التجريبي المحلي لا يُثبت أن الإشعار الخارجي يعمل،
    // فنقولها صريحة بدل ما يظن المستخدم أن الإشعارات مضبوطة.
    if (res.ok && Number(json.total) === 0) {
      return {
        ok: false,
        state: 'default',
        message: 'مفيش أجهزة مسجّلة لهذا الحساب — اضغط «تفعيل على هذا الجهاز» ثم أعد التجربة',
      };
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

// ===== دفع فوري للتذكيرات المستحقة =====
// المجدول الخارجي قد يتأخر/يتوقف فتبقى التذكيرات بلا إشعار خارجي. أي جهاز مفتوح
// ينادي هذا المسار فيرسل السيرفر الإشعارات المستحقة لبقية الأجهزة فوراً.
let lastFlushAt = 0;
export async function flushPush(force = false): Promise<{ sent?: number } | null> {
  // نداء واحد كل ٦٠ ثانية كحد أقصى من هذا الجهاز
  if (!force && Date.now() - lastFlushAt < 60_000) return null;
  lastFlushAt = Date.now();
  try {
    const res = await fetch('/api/push/flush', { method: 'POST', credentials: 'same-origin' });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export type PushHealth = {
  devices: number;
  totalDevices: number;
  lastRunAt: number;
  lastResult: { sent?: number; reminders?: number; messages?: number } | null;
  lastError: string;
  dueReminders: number;
  serverTime: number;
};

// تشخيص الإشعارات: أجهزتي المسجلة + آخر تشغيل للمُشغّل + آخر نتيجة إرسال
export async function pushHealth(): Promise<PushHealth | null> {
  try {
    const res = await fetch('/api/push/health', { credentials: 'same-origin', cache: 'no-store' });
    if (!res.ok) return null;
    return (await res.json()) as PushHealth;
  } catch {
    return null;
  }
}

// إشعار محلي فوري (يعمل والموقع مفتوح).
// الأولوية لـ Service Worker (وهو المسار الوحيد على الهاتف)، لكن على الكمبيوتر
// قد لا يكون العامل مسجّلاً بعد — والانتظار على serviceWorker.ready كان يعلّق
// إلى الأبد فلا يظهر أي إشعار إطلاقاً. لذلك: مهلة قصيرة ثم إشعار المتصفح المباشر.
const SW_READY_TIMEOUT_MS = 1500;

export async function localNotification(title: string, body: string, tag?: string, url = '/'): Promise<boolean> {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return false;
  const finalTag = tag || `local-${Date.now()}`;

  // ١) عبر عامل الخدمة إن كان جاهزاً (أفضل على الكمبيوتر، وضروري على الهاتف)
  if ('serviceWorker' in navigator) {
    try {
      const registration = await Promise.race([
        navigator.serviceWorker.ready,
        new Promise<null>((resolve) => setTimeout(() => resolve(null), SW_READY_TIMEOUT_MS)),
      ]);
      if (registration?.active) {
        registration.active.postMessage({ type: 'notify', title, body, tag: finalTag, url });
        return true;
      }
    } catch {
      /* نكمل بالبديل المباشر */
    }
  }

  // ٢) بديل الكمبيوتر: إشعار مباشر من الصفحة (Chrome / Edge / Firefox)
  try {
    const notification = new Notification(title, {
      body,
      tag: finalTag,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      data: { url },
      requireInteraction: true,
    });
    notification.onclick = () => {
      try {
        window.focus();
        notification.close();
      } catch {
        /* لا شيء */
      }
    };
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
    // اشتراك قديم بمفتاح سابق لا يصلح: نرجّع الحالة «غير مشترك» حتى يفعّله المستخدم
    // من جديد بدل أن يضل فاكراً الإشعارات شغّالة وهي ميتة.
    const keyNow = await fetchVapidKey();
    const existing = await navigator.serviceWorker.getRegistration(SW_URL);
    const current = await existing?.pushManager.getSubscription();
    if (current && keyNow) {
      const used = current.options?.applicationServerKey;
      if (used) {
        const a = new Uint8Array(used as ArrayBuffer);
        const b = urlBase64ToUint8Array(keyNow);
        const same = a.length === b.length && a.every((value, index) => value === b[index]);
        if (!same) return 'default';
      }
    }
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
