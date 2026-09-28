import type { MetadataRoute } from 'next';
import { getSiteUrl } from '@/lib/site-url';

export default function robots(): MetadataRoute.Robots {
  const base = getSiteUrl();

  return {
    rules: {
      userAgent: '*',
      disallow: ['/app', '/app/', '/claim', '/claim/', '/api', '/api/', '/wallet', '/wallet/'],
    },
    sitemap: new URL('sitemap.xml', base).href,
  };
}
