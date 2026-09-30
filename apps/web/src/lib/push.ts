/**
 * Web Push (VAPID) — client-side subscription management.
 *
 * Flow:
 *  1. registerServiceWorker()   — idempotent; call once on app boot
 *  2. subscribeToPush(walletAddress, vouchId?)
 *       → requests Notification permission (if not yet granted)
 *       → creates/reuses a PushSubscription bound to this device
 *       → POSTs {subscription, walletAddress, vouchIds:[vouchId]} to /api/push/subscribe —
 *         or `vouchIds: []` without a vouch: the general opt-in tip notifications use (#297)
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

/** Explain why push cannot be enabled before an iOS Safari app is installed. */
export function getPushAvailabilityHint(): string | null {
  if (typeof window === 'undefined') return null;

  const userAgent = navigator.userAgent;
  const isIosDevice =
    /iPad|iPhone|iPod/.test(userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isIosSafari =
    isIosDevice &&
    /Safari/.test(userAgent) &&
    !/(CriOS|FxiOS|EdgiOS|OPiOS)/.test(userAgent);
  const isStandalone =
    (typeof window.matchMedia === 'function' &&
      window.matchMedia('(display-mode: standalone)').matches) ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;

  if (isIosSafari && !isStandalone) return 'Add to Home Screen to get notified.';
  return null;
}

// ─── last-sent registry (rotation sync) ─────────────────────────────────────

/** localStorage key holding the endpoint last successfully sent to the server. */
const LAST_SENT_KEY = 'alvinmunk.push.lastSentEndpoint';

/**
 * Remember the endpoint the server last acknowledged for this device.
 * Written only after the server answers 2xx so a failed POST isn't mistaken for a move.
 * Pass null to clear the memory (after unsubscribe).
 */
function rememberLastSentEndpoint(endpoint: string | null): void {
  if (typeof localStorage === 'undefined') return;
  try {
    if (endpoint) localStorage.setItem(LAST_SENT_KEY, endpoint);
    else localStorage.removeItem(LAST_SENT_KEY);
  } catch {
    // Storage may be unavailable (private mode) — rotation sync just degrades to no-op.
  }
}

function getLastSentEndpoint(): string | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    return localStorage.getItem(LAST_SENT_KEY);
  } catch {
    return null;
  }
}

/**
 * Ask the server to move the stored record from `oldEndpoint` to `subscription.endpoint`,
 * keeping the wallet and the accumulated vouchIds (the PATCH half of pushsubscriptionchange).
 * On 404 (old endpoint already pruned server-side) falls back to a full POST upsert, re-attaching
 * the locally-known vouch IDs so the server's vouchIds stay in sync.
 */
async function rotateSubscription(
  oldEndpoint: string,
  sub: PushSubscription,
  walletAddress: string,
  getVouchIds: () => number[] | Promise<number[]>,
): Promise<boolean> {
  try {
    const res = await fetch('/api/push/subscribe', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        oldEndpoint,
        subscription: sub.toJSON(),
        walletAddress,
      }),
    });
    if (res.ok) {
      rememberLastSentEndpoint(sub.endpoint);
      return true;
    }
    if (res.status !== 404) {
      console.warn('[push] subscription move rejected:', res.status);
      return false;
    }
    // Old record already pruned server-side — re-register from scratch, re-attaching
    // the locally-known vouch IDs so the server's vouchIds stay in sync.
    await registerSubscription(sub, walletAddress, await getVouchIds());
    return true;
  } catch (err) {
    console.warn('[push] subscription move failed:', err);
    return false;
  }
}

/**
 * Re-sync this device's subscription with the server after an endpoint rotation (#169).
 *
 * Compares the browser's active subscription endpoint with the endpoint last acknowledged
 * by the server (kept in localStorage) and PATCHes /api/push/subscribe when they differ.
 * Cheap no-op when they match; safe to call on every dashboard mount.
 */
export async function syncPushSubscription(
  walletAddress: string,
  getVouchIds: () => number[] | Promise<number[]> = () => [],
): Promise<void> {
  if (!isPushSupported() || !VAPID_PUBLIC_KEY) return;
  if (getPermission() !== 'granted') return;

  try {
    const reg = await registerServiceWorker();
    if (!reg) return;
    const sub = await reg.pushManager.getSubscription();
    if (!sub) return;

    const lastSent = getLastSentEndpoint();
    if (lastSent === sub.endpoint) return; // server already has this endpoint

    if (lastSent) {
      const moved = await rotateSubscription(lastSent, sub, walletAddress, async () => getVouchIds());
      if (moved) return;
    }
    // No last-sent memory (cleared storage, first run after this feature ships, or the
    // move failed) — make sure the server knows the current endpoint. POST is idempotent
    // per endpoint, so this is safe to repeat.
    await registerSubscription(sub, walletAddress, await getVouchIds());
  } catch (err) {
    console.warn('[push] subscription sync failed:', err);
  }
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
 * Associates `vouchId`, when given, so the server knows which vouches to notify about;
 * without one it is a general opt-in (tips received, #297) — no mint needed.
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
  vouchId?: number,
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
    await registerSubscription(sub, walletAddress, vouchId === undefined ? [] : [vouchId]);
  } catch (err) {
    // Network failure — subscription is still valid locally; server will retry next time.
    console.warn('[push] failed to register subscription with server:', err);
  }

  return sub;
}

/** POST the subscription (with vouchIds) to /api/push/subscribe. Throws on network failure. */
async function registerSubscription(
  sub: PushSubscription,
  walletAddress: string,
  vouchIds: number[],
): Promise<void> {
  const res = await fetch('/api/push/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      subscription: sub.toJSON(),
      walletAddress,
      vouchIds: Array.from(new Set(vouchIds)),
    }),
  });
  if (!res.ok) throw new Error(`subscribe POST failed: ${res.status}`);
  rememberLastSentEndpoint(sub.endpoint);
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
  // The server record is gone — forget the last-sent endpoint so a later re-subscribe
  // POSTs fresh instead of trying to PATCH from a deleted endpoint.
  rememberLastSentEndpoint(null);
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
