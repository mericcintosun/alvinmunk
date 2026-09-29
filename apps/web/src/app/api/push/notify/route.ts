/**
 * /api/push/notify — fan-out a "vouch claimed" push notification.
 *
 * Called server-to-server (from the claim page via a client fetch) after a successful
 * claim_vouch transaction.
 *
 * POST { vouchId: number, voucherAddress: string, note?: string }
 *   → Looks up every push subscription registered for `voucherAddress`.
 *   → Sends a Web Push message to each endpoint via the `web-push` library.
 *   → Dead endpoints (410 Gone / 404) are silently pruned from the store.
 *
 * The VAPID keys must be set as env vars:
 *   VAPID_SUBJECT       — "mailto:your@email.com" or "https://your-domain.com"
 *   VAPID_PUBLIC_KEY    — base64url-encoded uncompressed EC P-256 public key
 *   VAPID_PRIVATE_KEY   — base64url-encoded P-256 private key
 *
 * Generate with:
 *   node -e "const wp = require('web-push'); const k = wp.generateVAPIDKeys(); console.log(JSON.stringify(k))"
 * or: npx web-push generate-vapid-keys
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSubscriptionsForWallet, removeSubscription } from '@/lib/push-store';

// web-push is a Node.js library — only runs in the Node.js runtime.
// We import it dynamically to avoid edge-runtime issues.

const MAX_BODY = 1024;

export async function POST(req: NextRequest): Promise<NextResponse> {
  const contentLength = Number(req.headers.get('content-length') ?? 0);
  if (contentLength > MAX_BODY) {
    return NextResponse.json({ error: 'body too large' }, { status: 413 });
  }

  let body: { vouchId?: number; voucherAddress?: string; note?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  const { vouchId, voucherAddress, note } = body;

  if (typeof vouchId !== 'number' || !voucherAddress || typeof voucherAddress !== 'string') {
    return NextResponse.json({ error: 'vouchId and voucherAddress are required' }, { status: 422 });
  }

  // Gracefully degrade when VAPID keys are not configured.
  const vapidSubject = process.env.VAPID_SUBJECT;
  const vapidPublicKey = process.env.VAPID_PUBLIC_KEY;
  const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY;

  if (!vapidSubject || !vapidPublicKey || !vapidPrivateKey) {
    // This is expected in local dev without push infra — not an error.
    console.warn('[push/notify] VAPID keys not configured — skipping push delivery');
    return NextResponse.json({ ok: true, sent: 0, skipped: true });
  }

  // Dynamic import — avoids pulling web-push into the edge runtime and keeps
  // the initial bundle lean for callers that never use push.
  let webpush: typeof import('web-push');
  try {
    webpush = await import('web-push');
  } catch {
    console.error('[push/notify] web-push not installed');
    return NextResponse.json({ ok: false, error: 'web-push not installed' }, { status: 500 });
  }

  webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);

  // Fetch all subscriptions for this voucher address.
  const subs = await getSubscriptionsForWallet(voucherAddress);

  // Filter to subscriptions that care about this specific vouchId.
  const relevant = subs.filter((s) => s.vouchIds.includes(vouchId));

  if (relevant.length === 0) {
    return NextResponse.json({ ok: true, sent: 0 });
  }

  const notificationPayload = JSON.stringify({
    title: '🌟 Your vouch was claimed!',
    body: note
      ? `"${note.slice(0, 80)}" — their star ignited.`
      : 'Someone claimed your vouch. Their star just ignited.',
    vouchId,
  });

  let sent = 0;
  await Promise.all(
    relevant.map(async (stored) => {
      try {
        await webpush.sendNotification(
          stored.subscription as Parameters<typeof webpush.sendNotification>[0],
          notificationPayload,
        );
        sent++;
      } catch (err: unknown) {
        // 410 Gone or 404: the subscription has been revoked — prune it.
        const status = (err as { statusCode?: number })?.statusCode;
        if (status === 410 || status === 404) {
          // Fire-and-forget cleanup — prune the revoked endpoint from the shared store.
          await removeSubscription(stored.endpoint).catch(() => {});
        } else {
          console.warn('[push/notify] sendNotification failed:', err);
        }
      }
    }),
  );

  return NextResponse.json({ ok: true, sent });
}
