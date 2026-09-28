import type { Metadata } from 'next';
import { CLAIM_DESCRIPTION } from '@/lib/metadata';

// Static on purpose: the copy needs no vouch lookup, so a slow RPC can never hold up
// the page.
export const metadata: Metadata = {
  title: 'Someone vouched for you',
  description: CLAIM_DESCRIPTION,
};

export default function ClaimLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
