/**
 * The public origin of this deployment — the one source for `metadataBase` (absolute
 * og:image / canonical URLs), robots.txt and the sitemap, so a fork, a custom domain or a
 * Vercel preview never advertises the upstream production host. In order:
 *
 * 1. `NEXT_PUBLIC_SITE_URL` — pins the host, e.g. when serving outside Vercel. On Vercel
 *    scope it to Production only, or previews would point at the production host again.
 * 2. A Vercel production build: `VERCEL_PROJECT_PRODUCTION_URL`, the project's production
 *    domain, custom domain included (not the per-deployment host, which deployment
 *    protection may lock).
 * 3. Any other Vercel build (a preview): `VERCEL_URL`, its own host.
 * 4. `http://localhost:3000` (`next dev`, a local `next start`) — Next's own default.
 *
 * Vercel's values carry no scheme, so `https://` is assumed. An unparseable value is
 * skipped instead of throwing, because the root layout's metadata evaluates this on load.
 */
export function getSiteUrl(): URL {
  const env = process.env;
  const explicit = toOrigin(env.NEXT_PUBLIC_SITE_URL);
  if (env.NEXT_PUBLIC_SITE_URL?.trim() && !explicit) {
    console.warn('[site-url] ignoring NEXT_PUBLIC_SITE_URL: not an http(s) URL');
  }
  return (
    explicit ??
    (env.VERCEL_ENV === 'production' ? toOrigin(env.VERCEL_PROJECT_PRODUCTION_URL) : null) ??
    toOrigin(env.VERCEL_URL) ??
    new URL('http://localhost:3000')
  );
}

function toOrigin(value: string | undefined): URL | null {
  const raw = value?.trim();
  if (!raw) return null;
  try {
    const url = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    return new URL(url.origin);
  } catch {
    return null;
  }
}
