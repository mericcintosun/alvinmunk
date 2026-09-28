import type { Metadata } from 'next';
import { CLAIM_DESCRIPTION } from '@/lib/metadata';

// Static on purpose: the copy needs no vouch lookup, so a slow RPC can never hold up
// the page.
export const metadata: Metadata = {
  title: 'Someone vouched for you',
  description: CLAIM_DESCRIPTION,
  // A claim link is personal and single-use, and older ones carry the secret in `?s=`
  // (#78): keep them out of search results.
  robots: { index: false, follow: false },
};

export default function ClaimLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
