import type { Metadata } from 'next';
import { routeHandle } from '@/lib/metadata';

// Text only, no RPC: the sibling opengraph-image route renders the inviter's card.
export function generateMetadata({ params }: { params: { handle: string } }): Metadata {
  const handle = routeHandle(params.handle);
  if (!handle) {
    return { title: 'You’re invited', description: 'Join a constellation on alvinmunk.' };
  }
  return {
    title: `@${handle} invited you`,
    description: `@${handle} wants you in their constellation on alvinmunk.`,
    alternates: { canonical: `/v/${handle}` },
  };
}

export default function InviteLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
