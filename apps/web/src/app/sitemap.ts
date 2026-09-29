import type { MetadataRoute } from 'next';
import { getSiteUrl } from '@/lib/site-url';

/** The public, indexable static routes. /app and /claim are `noindex` and stay out. */
const PUBLIC_PATHS = ['/', '/how-it-works', '/leaderboard', '/stats'];

export default function sitemap(): MetadataRoute.Sitemap {
  const base = getSiteUrl();
  return PUBLIC_PATHS.map((path) => ({ url: new URL(path, base).href }));
}
