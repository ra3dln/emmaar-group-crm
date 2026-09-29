// Service Worker: إشعارات حقيقية + سلوك المنبه (يرنّ ويتكرر حتى المستخدم يفتح الموقع أو يسكته)
self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => event.waitUntil(clients.claim()));

const ICON = '/icon-192.png';

// ===== إشعار يصل من السيرفر والموقع مقفول =====
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: 'إعمار جروب', body: event.data ? event.data.text() : '' };
  }

  const title = data.title || 'تذكير بالاتصال';
  const options = {
    body: data.body || 'حان وقت الاتصال بالعميل',
    icon: data.icon || ICON,
    badge: ICON,
    vibrate: [400, 200, 400, 200, 400],
    tag: data.tag || `crm-${Date.now()}`,
    renotify: true,
    dir: 'rtl',
    lang: 'ar',
    data: { url: data.url || '/', id: data.id || '', phone: data.phone || '', kind: data.kind || '' },
    actions: [
      { action: 'open', title: '🔔 فتح ومتابعة' },
      { action: 'snooze', title: '⏰ تأجيل ٥ د' },
    ],
  };

  event.waitUntil(
    (async () => {
      await self.registration.showNotification(title, options);
      // للرسائل: نُعيد الإشعار كل ٢٠ ثانية حتى يفتح المستخدم الموقع (بحد أقصى ٥ مرات)
      const repeats = data.kind === 'message' ? 4 : 0;
      for (let i = 0; i < repeats; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 20000));
        await self.registration.showNotification(title, { ...options });
      }
    })()
  );
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
      self.registration.showNotification(msg.title || 'إعمار جروب', {
        body: msg.body || '',
        icon: ICON,
        badge: ICON,
        dir: 'rtl',
        lang: 'ar',
        vibrate: [400, 200, 400, 200, 400],
        tag: msg.tag || `local-${Date.now()}`,
        renotify: true,
        data: { url: msg.url || '/', id: msg.id || '' },
        actions: [
          { action: 'open', title: '🔔 فتح' },
          { action: 'snooze', title: '⏰ تأجيل ٥ د' },
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
