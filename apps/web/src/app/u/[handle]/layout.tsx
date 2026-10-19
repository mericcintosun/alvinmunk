import type { Metadata } from 'next';
import { routeHandle } from '@/lib/metadata';

// Text only, no RPC: the handle is all the copy needs, and the on-chain face and scores
// are already rendered into the card by the sibling opengraph-image route.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ handle: string }>;
}): Promise<Metadata> {
  const { handle: raw } = await params;
  const handle = routeHandle(raw);
  if (!handle) {
    return { title: 'Profile', description: 'A constellation on alvinmunk.' };
  }
  return {
    title: `@${handle}`,
    description: `View @${handle}'s constellation and reputation on alvinmunk.`,
    // /u/Alice and /u/alice render the same page; point search engines at one.
    alternates: { canonical: `/u/${handle}` },
  };
}

export default function ProfileLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
