import type { Metadata } from 'next';
import { getSiteUrl } from './site-url';

/**
 * Site-wide metadata, shared by the root layout and the per-route server layouts.
 *
 * Two Next merge rules shape this file:
 * - The root owns the `%s · alvinmunk` title template. A route passes its bare title
 *   ("Leaderboard") and never appends the suffix itself, or it doubles (#204). A layout
 *   with children must pass `{ default, template }`: a plain string title resets the
 *   template for every segment below it.
 * - A segment's `openGraph` / `twitter` REPLACES its parent's instead of merging, so a
 *   route that sets them silently drops the default image and card type. The root
 *   therefore sets only the image and card; Next fills og:title, og:description and the
 *   twitter text from each route's own `title` / `description`. Routes set those two and
 *   leave `openGraph` / `twitter` alone (an `opengraph-image` file still wins for its route).
 */
export const SITE_NAME = 'alvinmunk';
export const TITLE_TEMPLATE = `%s · ${SITE_NAME}`;
export const SITE_TITLE = `${SITE_NAME} — Collect people, not points`;
export const SITE_DESCRIPTION =
  'A social proof-of-people reputation game on Stellar. Someone you trust vouches for you, and it becomes a star in your constellation.';
/** The claim-funnel line. Only /claim/<id> uses it: it is wrong copy for any other unfurl. */
export const CLAIM_DESCRIPTION = 'Someone vouched for you. Claim your half of the sky.';

const DEFAULT_OG_IMAGE = '/assets/meta/og-default.png';

export const rootMetadata: Metadata = {
  metadataBase: getSiteUrl(),
  title: { default: SITE_TITLE, template: TITLE_TEMPLATE },
  description: SITE_DESCRIPTION,
  openGraph: { type: 'website', images: [DEFAULT_OG_IMAGE] },
  twitter: { card: 'summary_large_image' },
  icons: { icon: [{ url: '/assets/meta/favicon-32.png', type: 'image/png' }] },
};

// A registry handle is a Soroban `Symbol` (a-z, 0-9, _; at most 32 chars), read lowercased.
const HANDLE = /^[a-z0-9_]{1,32}$/;

/** The lowercased handle from a `/u/[handle]` or `/v/[handle]` param, or null when it can
 *  never be a registry handle (those pages render the "unclaimed" state, so the metadata
 *  falls back to generic copy instead of echoing the raw path segment). */
export function routeHandle(param: string): string | null {
  const handle = param.toLowerCase();
  return HANDLE.test(handle) ? handle : null;
}
