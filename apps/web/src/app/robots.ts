import type { MetadataRoute } from 'next';
import { getSiteUrl } from '@/lib/site-url';

/** Prefixes crawlers skip: the signed-in dashboard, the API and the wallet demo. */
const DISALLOWED_PATHS = ['/app', '/api', '/wallet'];

// /claim is deliberately NOT disallowed. Its pages carry `noindex`, which a crawler only
// sees if it may fetch them: a robots.txt block would let a linked claim URL (older ones
// hold the secret in `?s=`) be indexed bare. Link-preview bots such as Twitterbot also
// obey robots.txt, so a block would stop shared claim links from unfurling.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: '*', disallow: DISALLOWED_PATHS },
    sitemap: new URL('/sitemap.xml', getSiteUrl()).href,
  };
}
