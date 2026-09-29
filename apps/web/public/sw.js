/**
 * alvinmunk service worker — Web Push (VAPID) receiver.
 *
 * Handles:
 *   push          — show a "your vouch was claimed" notification
 *   notificationclick — focus/open the app when the user taps the notification
 *   pushsubscriptionchange — re-subscribe after an endpoint rotation and move the
 *                   server-side record (PATCH /api/push/subscribe) so notifications
 *                   keep flowing without any user action (issue #169)
 *   activate      — clean up old caches (we don't pre-cache anything here;
 *                   the SW is only used for push delivery)
 */

const APP_ORIGIN = self.location.origin;

/** localStorage isn't available in a service worker — keep the wallet in a global. */
let pushWalletAddress = null;

/** Read the owning wallet address written by the page (best-effort — PATCH needs it as the ownership proof). */
async function readWalletAddress() {
  if (pushWalletAddress) return pushWalletAddress;
  try {
    const cache = await caches.open('alvinmunk-push-meta');
    const res = await cache.match('/__push/wallet');
    if (!res) return null;
    const body = await res.json();
    pushWalletAddress = body && body.walletAddress ? body.walletAddress : null;
  } catch {
    // Cache storage unavailable — fall through.
  }
  return pushWalletAddress;
}

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

// ─── pushsubscriptionchange ─────────────────────────────────────────────────
// Push services rotate/expire endpoints; without this handler the server keeps pushing
// to a dead endpoint, gets a 410, and prunes the record — notifications silently stop.
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil(
    (async () => {
      try {
        // 1. Get a fresh subscription. Some browsers hand us the new one directly.
        let newSub =
          event.newSubscription ||
          (await self.registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: event.oldSubscription
              ? event.oldSubscription.options.applicationServerKey
              : undefined,
          }));
        if (!newSub) return;

        const oldEndpoint = event.oldSubscription ? event.oldSubscription.endpoint : null;

        // 2. Tell the server to move the stored record (keeps walletAddress + vouchIds).
        const wallet = await readWalletAddress();
        const res = await fetch('/api/push/subscribe', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            oldEndpoint,
            subscription: newSub.toJSON(),
            walletAddress: wallet,
          }),
        });
        if (res.ok) return;

        // 3. Move rejected (unknown endpoint / wrong wallet / conflict). The page-side
        //    sync on the next dashboard load re-registers via POST as a fallback, so log
        //    and stop here. Without the wallet the PATCH cannot prove ownership.
        console.warn('[sw] subscription move rejected:', res.status);
      } catch (err) {
        console.warn('[sw] pushsubscriptionchange handling failed:', err);
      }
    })(),
  );
});

// ─── activate ────────────────────────────────────────────────────────────────
self.addEventListener('activate', (event) => {
  // Claim all clients immediately so push delivery works without a reload.
  event.waitUntil(self.clients.claim());
});
