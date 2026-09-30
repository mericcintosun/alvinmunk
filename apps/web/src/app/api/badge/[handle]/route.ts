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
 * a badge embedded on a busy page costs one origin read per window. Nothing renders a broken
 * image: an unknown handle is the neutral "unclaimed" badge and a path that can never be a
 * handle the "not a handle" one (both status 200; the latter never reaches the chain). A
 * read that FAILED is neither: it renders "unavailable" and is cached for seconds, not an
 * hour, so an RPC blip never leaves a stranger's README calling a real user unclaimed or
 * zeroed. (`resolveHandle` still reads a failed lookup as unclaimed until it tells the two
 * apart, #188.)
 *
 * The SVG is served with `nosniff` and a `default-src 'none'` CSP: it carries no script and
 * loads nothing, and opened directly it stays inert even if a future change let markup in.
 */
import { withRoute } from '@/lib/api-route';
import { resolveHandle } from '@/lib/registry';
import { getCounts, getProfile } from '@/lib/reputation';
import { badgeStyle, badgeSvg, type BadgeView } from '@/lib/badge-svg';

export const runtime = 'nodejs';
// Read the chain at REQUEST time; a build-time (prerendered) snapshot would freeze whatever
// the RPC happened to answer during the deploy.
export const dynamic = 'force-dynamic';
// The CDN caches the response (headers below); the chain reads themselves must not land in
// Next's Data Cache, or the badge would show its first numbers forever.
export const fetchCache = 'default-no-store';

// 5 minutes at the CDN, an hour of background refresh — mirrors the issue's contract.
const CACHE_CONTROL = 'public, s-maxage=300, stale-while-revalidate=3600';
// A failed read: long enough to spare the RPC during an outage, short enough to heal fast.
const CACHE_CONTROL_UNAVAILABLE = 'public, s-maxage=30';
const SVG_TYPE = 'image/svg+xml; charset=utf-8';
const SVG_CSP = "default-src 'none'";

/** A registry handle is a Soroban Symbol: a-z, 0-9, _; at most 32 chars (lib/metadata). */
const HANDLE = /^[a-z0-9_]{1,32}$/;
const DISPLAY_MAX = 32;

/** A badge with no stats: `unclaimed`, `unavailable` or `invalid`. */
function statless(status: Exclude<BadgeView['status'], 'claimed'>, handle: string): BadgeView {
  return { status, handle, vouchedBy: 0, earned: 0, verified: false };
}

/** Resolve `handle` and read what the badge shows. Never rejects: a lookup or profile read
 *  that fails reads as `unavailable`, never as unclaimed or zeroed. */
async function readView(handle: string): Promise<BadgeView> {
  let address: string | null;
  try {
    address = await resolveHandle(handle);
  } catch {
    return statless('unavailable', handle);
  }
  if (!address) return statless('unclaimed', handle);
  const [profile, counts] = await Promise.all([
    getProfile(address).catch(() => null),
    // `getCounts` already answers null instead of throwing; the extra catch keeps this
    // route's promise to the caller ("never a broken image") independent of that.
    getCounts(address).catch(() => null),
  ]);
  if (!profile) return statless('unavailable', handle);
  return {
    status: 'claimed',
    handle,
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
    // stranger embeds (and naming a stand-in like "@unknown" would misreport a real handle).
    const valid = requested.length <= DISPLAY_MAX && HANDLE.test(requested);
    const view = valid ? await readView(requested) : statless('invalid', '');
    return new Response(badgeSvg(view, style), {
      status: 200,
      headers: {
        'content-type': SVG_TYPE,
        'cache-control': view.status === 'unavailable' ? CACHE_CONTROL_UNAVAILABLE : CACHE_CONTROL,
        'x-content-type-options': 'nosniff',
        'content-security-policy': SVG_CSP,
      },
    });
  },
);
