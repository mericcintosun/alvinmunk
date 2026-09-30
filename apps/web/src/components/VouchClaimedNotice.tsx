'use client';

import { useEffect, useState } from 'react';
import { Bell } from 'lucide-react';
import { toast } from '@/components/ui/toaster';
import { useWallet } from '@/components/wallet/wallet-provider';
import { pollNewlyClaimed, getPendingVouchIds } from '@/lib/myvouches';
import {
  registerServiceWorker,
  requestPermission,
  getPermission,
  getActivePushSubscription,
  getPushAvailabilityHint,
  subscribeToPush,
  syncPushSubscription,
} from '@/lib/push';
import { useLocale, useTranslations } from '@/lib/i18n';

/**
 * Give the service worker the owning wallet address so its pushsubscriptionchange handler
 * can prove ownership when PATCHing /api/push/subscribe (localStorage is unavailable
 * inside a service worker). Best-effort — if it fails the SW falls back to a plain re-subscribe.
 */
async function shareWalletWithServiceWorker(walletAddress: string): Promise<void> {
  try {
    const reg = await registerServiceWorker();
    if (!reg || !reg.active) return;
    const cache = await caches.open('alvinmunk-push-meta');
    await cache.put('/__push/wallet', new Response(JSON.stringify({ walletAddress })));
  } catch {
    // Ignore — best-effort.
  }
}

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
  const t = useTranslations();
  const { locale } = useLocale();
  // ─── 1. In-session poll ────────────────────────────────────────────────────
  useEffect(() => {
    let alive = true;
    pollNewlyClaimed()
      .then((claimed) => {
        if (!alive || claimed.length === 0) return;
        if (claimed.length === 1) {
          toast.success(t('vouchNotice.claimed.one', { note: claimed[0].note }));
        } else {
          toast.success(t('vouchNotice.claimed.many', {
            count: new Intl.NumberFormat(locale === 'tr' ? 'tr-TR' : 'en-US').format(claimed.length),
          }));
        }
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [locale, t]);

  // ─── 1b. Rotation re-sync (#169) ──────────────────────────────────────────
  // Push services rotate endpoints; a rotated subscription used to never reach the
  // server again (the next notify 410s and prunes it). On every dashboard mount, if
  // permission is granted and the active endpoint differs from the last one the server
  // acknowledged, move the stored record (PATCH) so notifications keep flowing.
  const { profile } = useWallet();
  const walletAddress = profile?.address;
  useEffect(() => {
    if (!walletAddress) return;
    let alive = true;
    syncPushSubscription(walletAddress, () => getPendingVouchIds())
      .catch(() => {})
      .finally(() => {
        if (alive) void shareWalletWithServiceWorker(walletAddress);
      });
    return () => {
      alive = false;
    };
  }, [walletAddress]);

  // ─── 2. Push opt-in prompt ─────────────────────────────────────────────────
  const [showBanner, setShowBanner] = useState(false);
  const [pushAvailabilityHint, setPushAvailabilityHint] = useState<string | null>(null);
  const [requesting, setRequesting] = useState(false);

  useEffect(() => {
    // Only show the opt-in if:
    //   • Push is supported in this browser
    //   • Permission hasn't been set yet (default)
    //   • VAPID public key is configured (no key → push is disabled in this deploy)
    //   • We don't already have an active subscription

    if (!process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY) return;
    const availabilityHint = getPushAvailabilityHint();
    if (availabilityHint) {
      setPushAvailabilityHint(availabilityHint);
      setShowBanner(true);
      return;
    }
    if (
      typeof window === 'undefined' ||
      !('serviceWorker' in navigator) ||
      !('PushManager' in window) ||
      !('Notification' in window)
    ) {
      return;
    }
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
        // Opt in now, without a vouch (#297): tips received reach this device even if
        // this wallet never mints. A later mint adds its vouch ID to the same record.
        if (walletAddress) {
          await subscribeToPush(walletAddress);
          void shareWalletWithServiceWorker(walletAddress);
        }
        toast.success(t('vouchNotice.push.enabled'));
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
      className="fixed bottom-20 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-xl border border-border/60 bg-surface/90 px-4 py-3 shadow-toast backdrop-blur-sm sm:bottom-6"
    >
      <Bell className="size-4 shrink-0 text-primary" aria-hidden />
      <p className="text-sm text-foreground">
        {pushAvailabilityHint ? t('vouchNotice.push.installHint') : t('vouchNotice.push.prompt')}
      </p>
      {!pushAvailabilityHint && (
        <button
          onClick={handleEnable}
          disabled={requesting}
          className="ml-1 shrink-0 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition-opacity hover:opacity-80 disabled:opacity-50"
        >
          {requesting ? t('vouchNotice.push.enabling') : t('vouchNotice.push.enable')}
        </button>
      )}
      <button
        onClick={() => setShowBanner(false)}
        aria-label={t('vouchNotice.push.dismiss')}
        className="ml-1 shrink-0 rounded-md px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
      >
        ✕
      </button>
    </div>
  );
}
