import { ImageResponse } from 'next/og';
import { SITE_CARD_ALT, siteCard } from '@/lib/og-card';
import { loadFont } from '@/lib/og-assets';

// The card every route without its own opengraph-image unfurls into: /, /how-it-works,
// /leaderboard, /stats, /wallet, /score/<address>. It replaces the 317×128 "passport"
// banner, which is under the summary_large_image minimum, so X, Slack and LinkedIn
// dropped or cropped it (#505). Next copies it into twitter:image (see lib/metadata.ts).
export const runtime = 'nodejs';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';
export const alt = SITE_CARD_ALT;

export default function Image() {
  const regularFont = loadFont('fonts/NotoSans-Regular.ttf');
  const boldFont = loadFont('fonts/NotoSans-Bold.ttf');

  return new ImageResponse(siteCard(), {
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
