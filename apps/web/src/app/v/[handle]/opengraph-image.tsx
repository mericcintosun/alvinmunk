import { ImageResponse } from 'next/og';
import { ogResolve, passportCard } from '@/lib/og-card';

// Invite card — what a shared /v/<handle> recruit link unfurls into ("@handle invited you").
export const runtime = 'nodejs';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';
export const alt = 'You’re invited to Stellar Passport';

export default async function Image({ params }: { params: { handle: string } }) {
  const handle = params.handle.toLowerCase();
  const { address, scores } = await ogResolve(handle);
  return new ImageResponse(passportCard({ handle, address, scores, invite: true }), { ...size });
}
