// Service Worker for Push Notifications
self.addEventListener('install', (event) => {
  console.log('Service Worker installing...');
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  console.log('Service Worker activated');
  event.waitUntil(clients.claim());
});

// Listen for push notifications
self.addEventListener('push', (event) => {
  const data = event.data ? event.data.json() : {};
  const title = data.title || 'تذكير بالاتصال';
  const options = {
    body: data.body || 'حان وقت الاتصال بالعميل',
    icon: data.icon || '/favicon.ico',
    badge: '/favicon.ico',
    vibrate: [200, 100, 200, 100, 200],
    data: {
      url: data.url || '/',
    },
    actions: [
      { action: 'call', title: '📞 اتصال' },
      { action: 'delay', title: '⏰ تأجيل' },
    ],
  };

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

// Handle notification click
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  if (event.action === 'call') {
    // Open phone dialer
    const phoneNumber = event.notification.data?.phone;
    if (phoneNumber) {
      event.waitUntil(
        clients.openWindow(`tel:${phoneNumber}`)
      );
    }
  } else if (event.action === 'delay') {
    // Open app to delay
    event.waitUntil(
      clients.openWindow('/')
    );
  } else {
    // Default action - open app
    event.waitUntil(
      clients.openWindow('/')
    );
  }
});
