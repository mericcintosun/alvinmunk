/**
 * /api/push/subscribe — store or remove a push subscription.
 *
 * POST  { subscription: PushSubscriptionJSON, walletAddress: string, vouchId: number }
 *   → Upserts a subscription record keyed by endpoint.
 *   → Adds `vouchId` to the set of vouch IDs the voucher wants notified about.
 *
 * DELETE { endpoint: string }
 *   → Removes the subscription record and its wallet-index entry.
 *
 * Storage strategy (order of preference, see lib/push-store):
 *   1. Upstash Redis / Vercel KV (if KV_REST_API_URL + KV_REST_API_TOKEN are set)
 *   2. In-memory Map (single serverless instance — fine for testnet demos; subscriptions
 *      survive as long as the function warm instance lives)
 *
 * The in-memory fallback is intentional for environments without KV configured. It means
 * subscriptions are lost on cold-start. Switch to KV by setting KV_REST_API_URL +
 * KV_REST_API_TOKEN in the Vercel dashboard.
 */

import { NextRequest, NextResponse } from 'next/server';
import { removeSubscription, saveSubscription } from '@/lib/push-store';

const MAX_BODY = 4096;

export async function POST(req: NextRequest): Promise<NextResponse> {
  // Reject oversized bodies.
  const contentLength = Number(req.headers.get('content-length') ?? 0);
  if (contentLength > MAX_BODY) {
    return NextResponse.json({ error: 'body too large' }, { status: 413 });
  }

  let body: { subscription?: PushSubscriptionJSON; walletAddress?: string; vouchId?: number };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  const { subscription, walletAddress, vouchId } = body;

  if (
    !subscription ||
    typeof subscription.endpoint !== 'string' ||
    !subscription.endpoint.startsWith('https://') ||
    !walletAddress ||
    typeof walletAddress !== 'string' ||
    typeof vouchId !== 'number'
  ) {
    return NextResponse.json({ error: 'missing or invalid fields' }, { status: 422 });
  }

  await saveSubscription(subscription, walletAddress, vouchId);

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest): Promise<NextResponse> {
  let body: { endpoint?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  if (!body.endpoint || typeof body.endpoint !== 'string') {
    return NextResponse.json({ error: 'endpoint required' }, { status: 422 });
  }

  await removeSubscription(body.endpoint);

  return NextResponse.json({ ok: true });
}
