import { ImageResponse } from 'next/og';
import { ogResolve, ogCard } from '@/lib/og-card';

// The artifact every shared /u/<handle> link unfurls into — resolves the handle
// on-chain and renders the published face, bio and scores (shared builder in lib/og-card).
export const runtime = 'nodejs';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';
export const alt = 'alvinmunk';

export default async function Image({ params }: { params: { handle: string } }) {
  const handle = params.handle.toLowerCase();
  const { address, scores, avatar, bio } = await ogResolve(handle);
  return new ImageResponse(ogCard({ handle, address, scores, avatar, bio }), { ...size });
}
