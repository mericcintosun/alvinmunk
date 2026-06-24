import { ImageResponse } from 'next/og';
import { ogResolve, passportCard } from '@/lib/og-card';

// The artifact every shared /u/<handle> link unfurls into — resolves the handle
// on-chain and renders the real constellation + scores (shared builder in lib/og-card).
export const runtime = 'nodejs';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';
export const alt = 'Stellar Passport';

export default async function Image({ params }: { params: { handle: string } }) {
  const handle = params.handle.toLowerCase();
  const { address, scores } = await ogResolve(handle);
  return new ImageResponse(passportCard({ handle, address, scores }), { ...size });
}
