import { ImageResponse } from 'next/og';
import { ogResolve, ogCard, OG_RETRY_CACHE } from '@/lib/og-card';
import { loadFont } from '@/lib/og-assets';
import { parseRouteHandle } from '@/lib/profile';

// Chain reads go through the Stellar SDK's fetch; without this Next caches them in the Data
// Cache forever, so the invite card would never change after its first render.
export const fetchCache = 'default-no-store';

// Invite card — what a shared /v/<handle> recruit link unfurls into ("@handle invited you").
export const runtime = 'nodejs';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';
export const alt = 'You\'re invited to alvinmunk';

export default async function Image({ params }: { params: { handle: string } }) {
  const { handle } = parseRouteHandle(params.handle);
  const { address, lookup, scores, avatar } = await ogResolve(handle);
  const regularFont = loadFont('fonts/NotoSans-Regular.ttf');
  const boldFont = loadFont('fonts/NotoSans-Bold.ttf');

  return new ImageResponse(ogCard({ handle, address, lookup, scores, invite: true, avatar }), {
    ...size,
    // A failed lookup renders a neutral card; keep crawlers from caching it for a year.
    ...(lookup === 'error' ? { headers: { 'cache-control': OG_RETRY_CACHE } } : {}),
    // Both weights are required: passing only the bold font replaces Satori's default font
    // entirely, so every text node (not just the ones with fontWeight: 700) would render in
    // bold with no regular counterpart to fall back to.
    fonts: [
      {
        name: 'Noto Sans',
        data: regularFont,
        weight: 400,
        style: 'normal',
      },
      {
        name: 'Noto Sans',
        data: boldFont,
        weight: 700,
        style: 'normal',
      },
    ],
  });
}
