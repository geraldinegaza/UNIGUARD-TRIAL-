/* UniGuard · service worker additions, imported by the generated Workbox worker.
 * Web push display, notification click-through, and a background sync hook that
 * wakes the page to flush its offline queue. Caching stays with Workbox, so
 * there is exactly one service worker and one cache strategy. */

self.addEventListener('push', (event) => {
  let payload = { title: 'UniGuard alert', body: 'Open UniGuard for details.', severity: 'advisory' };
  try { if (event.data) payload = Object.assign(payload, event.data.json()); }
  catch (e) { if (event.data) payload.body = event.data.text(); }

  event.waitUntil(self.registration.showNotification(payload.title, {
    body: payload.body,
    icon: '/icons/icon-192.png',
    badge: '/icons/badge-96.png',
    tag: payload.tag || payload.advisory_id || 'uniguard',
    renotify: !!payload.renotify,
    requireInteraction: payload.severity === 'emergency',
    data: { url: '/', advisory_id: payload.advisory_id || null },
    vibrate: payload.severity === 'emergency' ? [200, 80, 200, 80, 200] : [120]
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if ('focus' in client) return client.focus();
      }
      return self.clients.openWindow(target);
    })
  );
});

/* Queued reports are flushed by the page; this lets the browser wake an open
   page when it regains network. */
self.addEventListener('sync', (event) => {
  if (event.tag === 'uniguard-queue') {
    event.waitUntil(self.clients.matchAll({ type: 'window' }).then((list) => {
      list.forEach((c) => c.postMessage({ type: 'FLUSH_QUEUE' }));
    }));
  }
});
