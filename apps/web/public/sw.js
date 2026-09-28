/**
 * alvinmunk service worker — Web Push (VAPID) receiver.
 *
 * Handles:
 *   push          — show a "your vouch was claimed" notification
 *   notificationclick — focus/open the app when the user taps the notification
 *   activate      — clean up old caches (we don't pre-cache anything here;
 *                   the SW is only used for push delivery)
 */

const APP_ORIGIN = self.location.origin;

// ─── push ───────────────────────────────────────────────────────────────────
self.addEventListener('push', (event) => {
  let payload = { title: '🌟 Your vouch was claimed', body: 'Someone lit their star.', vouchId: null };

  if (event.data) {
    try {
      payload = { ...payload, ...event.data.json() };
    } catch {
      // malformed payload — use the defaults above
    }
  }

  const options = {
    body: payload.body,
    icon: '/assets/brand/alvinmunk-icon-192.png',
    badge: '/assets/brand/alvinmunk-badge-96.png',
    tag: `vouch-claimed-${payload.vouchId ?? 'unknown'}`,
    renotify: false,               // same tag → replace, not a second buzz
    data: {
      url: payload.vouchId ? `/app` : APP_ORIGIN,
      vouchId: payload.vouchId,
    },
  };

  event.waitUntil(self.registration.showNotification(payload.title, options));
});

// ─── notificationclick ───────────────────────────────────────────────────────
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const targetUrl = (event.notification.data && event.notification.data.url) || APP_ORIGIN;

  event.waitUntil(
    clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((windowClients) => {
        // If there's already an open tab on the same origin, focus it.
        for (const client of windowClients) {
          if (client.url.startsWith(APP_ORIGIN) && 'focus' in client) {
            client.navigate(targetUrl);
            return client.focus();
          }
        }
        // Otherwise open a new tab.
        if (clients.openWindow) {
          return clients.openWindow(targetUrl);
        }
      }),
  );
});

// ─── activate ────────────────────────────────────────────────────────────────
self.addEventListener('activate', (event) => {
  // Claim all clients immediately so push delivery works without a reload.
  event.waitUntil(self.clients.claim());
});
