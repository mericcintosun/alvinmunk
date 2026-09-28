'use client';

import { usePathname } from 'next/navigation';
import { Footer } from '@/components/layout/footer';

/**
 * Gate the marketing footer to non-app surfaces. The signed-in /app/* dashboard has its own
 * chrome (shell + sub-nav); the editorial footer belongs on marketing + public pages only.
 */
export function SiteFooter() {
  const pathname = usePathname();
  if (pathname.startsWith('/app')) return null;
  return <Footer />;
}
