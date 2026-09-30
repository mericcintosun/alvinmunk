/**
 * `GET /api/badge/[handle]` — an embeddable reputation badge as SVG (#283).
 *
 * A builder drops one `<img>` (or Markdown line) into a README, a hackathon profile or a
 * community site and their standing renders live, no login and no key. The badge only reads
 * public state: `resolveHandle` + `getProfile`/`getCounts`, all wallet-free simulations, so
 * there is no signing path here at all.
 *
 * The number is people, not points. `vouchedBy` comes from the durable on-chain counters
 * (`get_counts`); a reputation contract that predates that view falls back to Social XP, the
 * only approximation available there (same rule as the profile page, but without the event
 * scan — a crawler-facing route must not fan out into an RPC event walk).
 *
 * The response is CDN-cacheable for five minutes (`stale-while-revalidate` for an hour), so
 * a badge embedded on a busy page costs one origin read per window. An unknown or malformed
 * handle is NOT an error: it renders the neutral "unclaimed" badge with status 200, never a
 * broken image, and it never reaches the chain at all.
 */
import { withRoute } from '@/lib/api-route';
import { resolveHandle } from '@/lib/registry';
import { getCounts, getProfile } from '@/lib/reputation';
import { badgeStyle, badgeSvg, type BadgeView } from '@/lib/badge-svg';

export const runtime = 'nodejs';
// Read the chain at REQUEST time; a build-time (prerendered) snapshot would freeze whatever
// the RPC happened to answer during the deploy.
export const dynamic = 'force-dynamic';

// 5 minutes at the CDN, an hour of background refresh — mirrors the issue's contract.
const CACHE_CONTROL = 'public, s-maxage=300, stale-while-revalidate=3600';
const SVG_TYPE = 'image/svg+xml; charset=utf-8';

/** A registry handle is a Soroban Symbol: a-z, 0-9, _; at most 32 chars (lib/metadata). */
const HANDLE = /^[a-z0-9_]{1,32}$/;
const DISPLAY_MAX = 32;

/** The unclaimed badge — also the shape every read failure degrades to. */
function unclaimed(handle: string): BadgeView {
  return { handle, address: null, vouchedBy: 0, earned: 0, verified: false };
}

/** Resolve `handle` and read what the badge shows. Never rejects: an unreadable handle
 *  reads as unclaimed, an unreadable profile as zeros. */
async function readView(handle: string): Promise<BadgeView> {
  const address = await resolveHandle(handle).catch(() => null);
  if (!address) return unclaimed(handle);
  const [profile, counts] = await Promise.all([
    getProfile(address).catch(() => ({ social: 0, earned: 0, verified: false })),
    // `getCounts` already answers null instead of throwing; the extra catch keeps this
    // route's promise to the caller ("never a broken image") independent of that.
    getCounts(address).catch(() => null),
  ]);
  return {
    handle,
    address,
    vouchedBy: counts?.vouchedBy ?? profile.social,
    earned: profile.earned,
    verified: profile.verified,
  };
}

export const GET = withRoute(
  'GET /api/badge/[handle]',
  async (req: Request, ctx: { params: { handle: string } }): Promise<Response> => {
    const requested = String(ctx.params?.handle ?? '').trim().toLowerCase();
    const style = badgeStyle(new URL(req.url).searchParams.get('style'));
    // A param that can never be a handle renders neutral and never touches the chain. It
    // also does NOT echo the path back: nothing arbitrary should end up inside an image a
    // stranger embeds, so an impossible handle is simply "unknown".
    const valid = requested.length <= DISPLAY_MAX && HANDLE.test(requested);
    const view = valid ? await readView(requested) : unclaimed('unknown');
    return new Response(badgeSvg(view, style), {
      status: 200,
      headers: { 'content-type': SVG_TYPE, 'cache-control': CACHE_CONTROL },
    });
  },
);
