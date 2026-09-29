/**
 * Thin analytics helper over Vercel Analytics. Feature code fires product events without
 * importing or null-checking the SDK. Every call is a safe no-op when analytics isn't
 * available (SSR, blocked, or not initialized), so instrumenting a call site never risks a
 * crash.
 *
 * NOTE: Vercel custom events require a Pro plan; on Hobby these calls are harmless no-ops and
 * only the built-in page-view/visitor analytics is collected. Basic pageviews work on any plan.
 */
import { track as vercelTrack } from '@vercel/analytics';

type Props = Record<string, string | number | boolean | null>;

/** Well-known product event names, kept in one place so call sites stay typo-free. */
export type TrackEvent = 'profile_created' | 'vouch_minted' | 'client_error';

/** Fire a product/usage event, e.g. track('vouch_minted', { hasNote: true }). */
export function track(event: string, props?: Props): void {
  try {
    if (typeof window !== 'undefined') vercelTrack(event, props);
  } catch {
    /* analytics must never break a user flow */
  }
}

/** Vercel Analytics is privacy-first / anonymous — no user identity. Kept for call-site parity. */
export function identify(_id?: string, _props?: Record<string, unknown>): void {
  /* no-op */
}

/** Report a caught error (also fires a Vercel custom event on Pro plans). */
export function trackError(error: unknown, context?: Props): void {
  try {
    const message = String(error instanceof Error ? error.message : error).slice(0, 120);
    if (typeof window !== 'undefined') vercelTrack('client_error', { message, ...(context ?? {}) });
  } catch {
    /* no-op */
  }
}
