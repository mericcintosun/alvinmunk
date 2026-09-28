'use client';

import { useEffect, useState } from 'react';
import { Bell } from 'lucide-react';
import { toast } from '@/components/ui/toaster';
import { pollNewlyClaimed } from '@/lib/myvouches';
import {
  registerServiceWorker,
  requestPermission,
  getPermission,
  getActivePushSubscription,
} from '@/lib/push';

/**
 * VouchClaimedNotice
 *
 * Two jobs in one lightweight component (renders nothing visible unless push opt-in is shown):
 *
 * 1. In-session poll — on every dashboard mount, pollNewlyClaimed() fires a toast for
 *    any vouches claimed since the last check. This is the always-on path (no push infra
 *    needed; works even with push blocked).
 *
 * 2. Push opt-in prompt — if the browser supports Web Push AND permission hasn't been
 *    granted yet, shows a small non-blocking banner after a short delay. Tapping "Enable"
 *    registers the service worker and requests Notification permission. Once granted the
 *    banner dismisses permanently. If permission is denied or dismissed the banner hides
 *    and we never re-surface it for this session.
 */
export function VouchClaimedNotice() {
  // ─── 1. In-session poll ────────────────────────────────────────────────────
  useEffect(() => {
    let alive = true;
    pollNewlyClaimed()
      .then((claimed) => {
        if (!alive || claimed.length === 0) return;
        if (claimed.length === 1) {
          toast.success(`🌟 Your vouch ignited — "${claimed[0].note}" was claimed.`);
        } else {
          toast.success(`🌟 ${claimed.length} of your vouches were claimed — your sky grew.`);
        }
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  // ─── 2. Push opt-in prompt ─────────────────────────────────────────────────
  const [showBanner, setShowBanner] = useState(false);
  const [requesting, setRequesting] = useState(false);

  useEffect(() => {
    // Only show the opt-in if:
    //   • Push is supported in this browser
    //   • Permission hasn't been set yet (default)
    //   • VAPID public key is configured (no key → push is disabled in this deploy)
    //   • We don't already have an active subscription

    if (
      typeof window === 'undefined' ||
      !('serviceWorker' in navigator) ||
      !('PushManager' in window) ||
      !('Notification' in window)
    ) {
      return;
    }
    if (!process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY) return;
    if (Notification.permission !== 'default') return;

    // Check if already subscribed (e.g. from a previous session).
    getActivePushSubscription().then((sub) => {
      if (sub) return; // already subscribed — no need to prompt
      // Small delay so it doesn't compete with the initial page render.
      const t = window.setTimeout(() => setShowBanner(true), 2500);
      return () => window.clearTimeout(t);
    });
  }, []);

  async function handleEnable() {
    setRequesting(true);
    try {
      await registerServiceWorker();
      const perm = await requestPermission();
      if (perm === 'granted') {
        // The actual per-vouch subscription is created when the next mint happens
        // (subscribeToVouchPush in VouchCompose). Here we just register the SW so
        // future subscriptions can be taken out immediately.
        toast.success("🔔 Push notifications enabled — we'll tell you when your star is claimed.");
      }
    } catch {
      // Ignore — user may have blocked the prompt
    } finally {
      setRequesting(false);
      setShowBanner(false);
    }
  }

  if (!showBanner) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-20 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-xl border border-border/60 bg-surface/90 px-4 py-3 shadow-lg backdrop-blur-sm sm:bottom-6"
    >
      <Bell className="size-4 shrink-0 text-primary" aria-hidden />
      <p className="text-sm text-foreground">
        Get notified when someone claims your vouch.
      </p>
      <button
        onClick={handleEnable}
        disabled={requesting}
        className="ml-1 shrink-0 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition-opacity hover:opacity-80 disabled:opacity-50"
      >
        {requesting ? 'Enabling…' : 'Enable'}
      </button>
      <button
        onClick={() => setShowBanner(false)}
        aria-label="Dismiss push notification prompt"
        className="ml-1 shrink-0 rounded-md px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
      >
        ✕
      </button>
    </div>
  );
}
