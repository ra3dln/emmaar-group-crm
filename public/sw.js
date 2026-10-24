// Service Worker: إشعارات حقيقية صامتة — تظهر مرة واحدة في وقتها بلا رنة ولا تكرار
self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => event.waitUntil(clients.claim()));

// التطبيق المثبّت: network-first لصفحة التطبيق حتى تظهر أي تعديلات فورًا
// (الأصول نفسها مُبصومة بالـhash، فلا تحتاج كاش هنا)
self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request, { cache: 'no-store' }).catch(() => fetch(request)));
  }
});

const ICON = '/icon-192.png';

// عرض الإشعار بأمان: بعض المتصفحات (وآيفون) ترفض خصائص مثل actions/renotify
// فترفض الإشعار كله. لو حدث ذلك نعرضه بدون الخصائص الاختيارية بدل ما يضيع.
const showSafe = async (title, options) => {
  try {
    await self.registration.showNotification(title, options);
  } catch {
    const { actions, renotify, ...rest } = options;
    await self.registration.showNotification(title, rest);
  }
};

// ===== إشعار يصل من السيرفر والموقع مقفول =====
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: 'MSA CRM', body: event.data ? event.data.text() : '' };
  }

  const title = data.title || 'تذكير بالاتصال';
  const options = {
    body: data.body || 'حان وقت الاتصال بالعميل',
    icon: data.icon || ICON,
    badge: ICON,
    // نوتفكيشن فقط: بلا رنة وبلا اهتزاز متكرر. (أندرويد يحترم silent،
    // وآيفون يعرض الإشعار بنغمة النظام مرة واحدة — لا نكرر ولا نطيل.)
    silent: true,
    tag: data.tag || `crm-${Date.now()}`,
    renotify: true,
    dir: 'rtl',
    lang: 'ar',
    timestamp: Date.now(),
    // التذكير يبقى على الشاشة حتى يُتخذ فيه إجراء — رسالة الشات تكفيها لمسة
    requireInteraction: (data.kind || '') === 'reminder',
    data: { url: data.url || '/', id: data.id || '', phone: data.phone || '', kind: data.kind || '' },
    actions: [
      { action: 'open', title: 'فتح ومتابعة' },
      { action: 'snooze', title: 'تأجيل ٥ د' },
    ],
  };

  // إشعار واحد لكل حدث في وقته — ممنوع أي حلقة إعادة عرض (كانت بتعمل رنة متكررة).
  // التذكيرات تبقى على الشاشة (requireInteraction) حتى لا تفوت لو الجهاز بعيد.
  event.waitUntil(showSafe(title, options));
});

// ===== ضغط المستخدم على الإشعار =====
self.addEventListener('notificationclick', (event) => {
  const data = event.notification.data || {};
  event.notification.close();

  if (event.action === 'snooze') {
    event.waitUntil(
      (async () => {
        const list = await clients.matchAll({ type: 'window', includeUncontrolled: true });
        for (const client of list) client.postMessage({ type: 'snooze', id: data.id, minutes: 5 });
        if (!list.length) await clients.openWindow(`/#snooze=${data.id}`);
      })()
    );
    return;
  }

  const target = data.url || '/';
  event.waitUntil(
    (async () => {
      const list = await clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of list) {
        client.postMessage({ type: 'open-alarm', id: data.id, phone: data.phone });
        if ('focus' in client) {
          await client.focus();
          return;
        }
      }
      await clients.openWindow(target);
    })()
  );
});

// ===== إغلاق الإشعار بالمسح (swipe away) = إسكات للرنة =====
self.addEventListener('notificationclose', (event) => {
  const data = event.notification.data || {};
  event.waitUntil(
    (async () => {
      const list = await clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of list) client.postMessage({ type: 'silence', id: data.id });
    })()
  );
});

// ===== رسائل من صفحة الموقع (إشعار تجريبي أو إسكات) =====
self.addEventListener('message', (event) => {
  const msg = event.data || {};
  if (msg.type === 'notify') {
    event.waitUntil(
      showSafe(msg.title || 'MSA CRM', {
        body: msg.body || '',
        icon: ICON,
        badge: ICON,
        silent: true,
        dir: 'rtl',
        lang: 'ar',
        timestamp: Date.now(),
        tag: msg.tag || `local-${Date.now()}`,
        renotify: true,
        data: { url: msg.url || '/', id: msg.id || '', kind: msg.kind || '' },
        actions: [
          { action: 'open', title: 'فتح' },
          { action: 'snooze', title: 'تأجيل ٥ د' },
        ],
      })
    );
    return;
  }
  if (msg.type === 'silence') {
    event.waitUntil(
      self.registration.getNotifications().then((list) => list.forEach((n) => n.close()))
    );
  }
});
