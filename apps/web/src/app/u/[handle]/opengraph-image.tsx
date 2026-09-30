import { ImageResponse } from 'next/og';
import { ogResolve, ogCard } from '@/lib/og-card';
import { loadFont } from '@/lib/og-assets';

// Chain reads go through the Stellar SDK's fetch; without this Next caches them in the Data
// Cache forever, so the profile card would never change after its first render.
export const fetchCache = 'default-no-store';

// The artifact every shared /u/<handle> link unfurls into — resolves the handle
// on-chain and renders the published face, bio and scores (shared builder in lib/og-card).
export const runtime = 'nodejs';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';
export const alt = 'alvinmunk';

export default async function Image({ params }: { params: { handle: string } }) {
  const handle = params.handle.toLowerCase();
  const { address, scores, avatar, bio } = await ogResolve(handle);
  const regularFont = loadFont('fonts/NotoSans-Regular.ttf');
  const boldFont = loadFont('fonts/NotoSans-Bold.ttf');

  return new ImageResponse(ogCard({ handle, address, scores, avatar, bio }), {
    ...size,
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
