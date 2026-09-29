import { ImageResponse } from 'next/og';
import { claimCard, type ClaimStatus } from '@/lib/og-card';
import { loadFont } from '@/lib/og-assets';
import { getVouch, VOUCH_TTL_SECS } from '@/lib/reputation';
import { reverseHandle } from '@/lib/registry';

// The install funnel: what a pasted /claim/<id> link unfurls into. Built from the public
// vouch id only — the claim secret lives in the URL fragment and never reaches the server,
// so this route must not read an `s` parameter. See opengraph-image.test.tsx.
export const runtime = 'nodejs';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';
export const alt = 'Someone vouched for you';

export default async function Image({ params }: { params: { id: string } }) {
  const id = Number(params.id);
  const validId = Number.isInteger(id) && id >= 0;

  let from: string | null = null;
  let note: string | null = null;
  let status: ClaimStatus = 'unknown';
  let daysLeft = 0;

  if (validId) {
    let vouch = null;
    try {
      vouch = await getVouch(id);
    } catch {
      vouch = null;
    }

    if (vouch) {
      from = vouch.from;
      note = vouch.note || null;
      const nowSec = Math.floor(Date.now() / 1000);
      const deadline = vouch.created + VOUCH_TTL_SECS;
      daysLeft = Math.max(0, Math.ceil((deadline - nowSec) / 86_400));
      status = vouch.claimed
        ? 'claimed'
        : vouch.slashed || nowSec >= deadline
          ? 'closed'
          : 'open';
    }
  }

  const handle = from ? await reverseHandle(from).catch(() => null) : null;

  const regularFont = loadFont('fonts/NotoSans-Regular.ttf');
  const boldFont = loadFont('fonts/NotoSans-Bold.ttf');

  return new ImageResponse(claimCard({ vouchId: validId ? id : 0, from, handle, note, status, daysLeft }), {
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
