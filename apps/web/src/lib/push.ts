/**
 * Web Push (VAPID) — client-side subscription management.
 *
 * Flow:
 *  1. registerServiceWorker()   — idempotent; call once on app boot
 *  2. subscribeToPush(walletAddress, vouchId)
 *       → requests Notification permission (if not yet granted)
 *       → creates/reuses a PushSubscription bound to this device
 *       → POSTs {subscription, walletAddress, vouchIds:[vouchId]} to /api/push/subscribe
 *  3. unsubscribeFromPush()     — removes subscription server-side + browser-side
 *
 * When the VAPID public key env-var is absent (local dev without push infra),
 * every function degrades gracefully and logs a warning rather than throwing.
 */

/** The VAPID public key is baked in at build time via NEXT_PUBLIC_ */
const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? '';

// ─── helpers ────────────────────────────────────────────────────────────────

/** Convert a base64url VAPID public key to a Uint8Array the browser expects. */
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  return Uint8Array.from([...raw].map((char) => char.charCodeAt(0)));
}

function isPushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

// ─── service worker registration ─────────────────────────────────────────────

let _swRegistration: ServiceWorkerRegistration | null = null;

/**
 * Register (or re-use) the service worker at /sw.js.
 * Safe to call multiple times — returns the existing registration if already active.
 */
export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!isPushSupported()) return null;
  if (_swRegistration) return _swRegistration;

  try {
    const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
    _swRegistration = reg;
    return reg;
  } catch (err) {
    console.warn('[push] SW registration failed:', err);
    return null;
  }
}

// ─── permission ──────────────────────────────────────────────────────────────

/** Returns the current notification permission without prompting. */
export function getPermission(): NotificationPermission {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'denied';
  return Notification.permission;
}

/**
 * Request notification permission.
 * Returns 'granted' | 'denied' | 'default'.
 * Call this from a user-gesture handler (button click) to satisfy browser requirements.
 */
export async function requestPermission(): Promise<NotificationPermission> {
  if (!isPushSupported()) return 'denied';
  return Notification.requestPermission();
}

// ─── subscribe ───────────────────────────────────────────────────────────────

/**
 * Subscribe this device to push notifications for `walletAddress`.
 * Associates `vouchId` so the server knows which vouches to notify about.
 *
 * - If permission is 'default', prompts the user first.
 * - If VAPID key is missing, logs a warning and returns early (safe for local dev).
 * - If already subscribed (same device + same endpoint), re-POSTs to ensure the
 *   server has the latest vouchId registered.
 *
 * Returns the PushSubscription, or null if push is unavailable/denied.
 */
export async function subscribeToPush(
  walletAddress: string,
  vouchId: number,
): Promise<PushSubscription | null> {
  if (!isPushSupported()) return null;

  if (!VAPID_PUBLIC_KEY) {
    console.warn('[push] NEXT_PUBLIC_VAPID_PUBLIC_KEY not set — skipping push subscription');
    return null;
  }

  // Ask for permission if we haven't yet.
  const permission = await requestPermission();
  if (permission !== 'granted') return null;

  const reg = await registerServiceWorker();
  if (!reg) return null;

  // Reuse or create a subscription.
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    try {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        // Cast through ArrayBuffer to satisfy the strict lib.dom type — the browser
        // accepts Uint8Array here but the TS DOM types narrowed the signature.
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY).buffer as ArrayBuffer,
      });
    } catch (err) {
      console.warn('[push] subscribe() failed:', err);
      return null;
    }
  }

  // Register with the server (idempotent — server upserts on endpoint).
  try {
    await fetch('/api/push/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        subscription: sub.toJSON(),
        walletAddress,
        vouchId,
      }),
    });
  } catch (err) {
    // Network failure — subscription is still valid locally; server will retry next time.
    console.warn('[push] failed to register subscription with server:', err);
  }

  return sub;
}

/**
 * Unsubscribe this device from push notifications.
 * Also tells the server to remove the subscription record.
 */
export async function unsubscribeFromPush(): Promise<void> {
  if (!isPushSupported()) return;

  const reg = await registerServiceWorker();
  if (!reg) return;

  const sub = await reg.pushManager.getSubscription();
  if (!sub) return;

  // Tell the server first so it doesn't try to push to a dead endpoint.
  try {
    await fetch('/api/push/subscribe', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint: sub.endpoint }),
    });
  } catch {
    // Best-effort.
  }

  await sub.unsubscribe();
}

/**
 * Get the active PushSubscription for this device, or null if not subscribed.
 * Does NOT trigger a permission prompt.
 */
export async function getActivePushSubscription(): Promise<PushSubscription | null> {
  if (!isPushSupported()) return null;
  const reg = await registerServiceWorker();
  if (!reg) return null;
  return reg.pushManager.getSubscription();
}
