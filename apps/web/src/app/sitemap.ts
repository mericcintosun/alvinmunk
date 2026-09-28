import type { MetadataRoute } from 'next';
import { getSiteUrl } from '@/lib/site-url';

const PUBLIC_STATIC_PATHS = ['/', '/how-it-works', '/leaderboard', '/stats'] as const;

export default function sitemap(): MetadataRoute.Sitemap {
  const base = getSiteUrl();
  const lastModified = new Date();

  return PUBLIC_STATIC_PATHS.map((path) => ({
    url: new URL(path === '/' ? '/' : path, base).href,
    lastModified,
  }));
}
