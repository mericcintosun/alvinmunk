import { ImageResponse } from 'next/og';
import { claimCard, type ClaimCardView } from '@/lib/og-card';
import { loadFont } from '@/lib/og-assets';
import { getVouch, VOUCH_TTL_SECS } from '@/lib/reputation';
import { getMeta, reverseHandle } from '@/lib/registry';

// Chain reads go through the Stellar SDK's fetch; without this Next caches them in the Data
// Cache forever, so the claim card would never change after its first render.
export const fetchCache = 'default-no-store';

// The install funnel: what a pasted /claim/<id> link unfurls into. Built from the public
// vouch id alone. The claim code rides in the URL fragment (#k=…), which no server ever
// receives; the oldest links' `?s=` query reaches the page request, never this one. The
// route takes only `params` and reads only public chain state, so the image can neither
// carry nor reveal the code. See opengraph-image.test.tsx.
export const runtime = 'nodejs';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';
export const alt = 'Someone vouched for you';

export default async function Image({ params }: { params: { id: string } }) {
  const regularFont = loadFont('fonts/NotoSans-Regular.ttf');
  const boldFont = loadFont('fonts/NotoSans-Bold.ttf');

  return new ImageResponse(claimCard(await claimView(params.id)), {
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

/** The card for a vouch id, with the claim page's own status rules. Never throws: an
 *  unfurl must always get a valid image. */
async function claimView(idParam: string): Promise<ClaimCardView> {
  const id = Number(idParam);
  if (!Number.isSafeInteger(id) || id < 0) return { status: 'unknown' };

  let vouch;
  try {
    vouch = await getVouch(id);
  } catch {
    return { status: 'unavailable' };
  }
  if (!vouch) return { status: 'unknown' };

  // Name and face are decoration: a failed read keeps the short address and default face.
  const [handle, meta] = await Promise.all([
    reverseHandle(vouch.from).catch(() => null),
    getMeta(vouch.from).catch(() => null),
  ]);
  const nowSec = Math.floor(Date.now() / 1000);
  const deadline = vouch.created + VOUCH_TTL_SECS;
  return {
    status: vouch.claimed ? 'claimed' : vouch.slashed || nowSec >= deadline ? 'closed' : 'open',
    vouchId: id,
    from: vouch.from,
    handle,
    avatar: meta?.avatar,
    note: vouch.note,
    daysLeft: Math.max(0, Math.ceil((deadline - nowSec) / 86_400)),
  };
}
