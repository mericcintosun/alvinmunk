/**
 * /api/push/subscribe — store or remove a push subscription.
 *
 * POST  { subscription: PushSubscriptionJSON, walletAddress: string, vouchId: number }
 *   → Upserts a subscription record keyed by endpoint.
 *   → Adds `vouchId` to the set of vouch IDs the voucher wants notified about.
 *
 * DELETE { endpoint: string }
 *   → Removes the subscription record.
 *
 * Storage strategy (order of preference):
 *   1. Vercel KV (if @vercel/kv is installed and KV_REST_API_URL is set)
 *   2. In-memory Map (single serverless instance — fine for testnet demos; subscriptions
 *      survive as long as the function warm instance lives)
 *
 * The in-memory fallback is intentional for environments without KV configured. It means
 * subscriptions are lost on cold-start but avoids a hard dependency. Switch to KV by
 * setting KV_REST_API_URL + KV_REST_API_TOKEN in the Vercel dashboard.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getKv, memGet, memSet, memDel } from '@/lib/push-store';

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

  // Sanitize: cap endpoint length to avoid KV key blowup.
  const endpoint = subscription.endpoint.slice(0, 512);
  const key = `sub:${endpoint}`;
  const wallet = walletAddress.toLowerCase();

  const kv = await getKv();

  if (kv) {
    const existing = await kv.get(key);
    const vouchIds = Array.from(new Set([...(existing?.vouchIds ?? []), vouchId]));
    await kv.set(key, {
      endpoint,
      subscription,
      walletAddress: wallet,
      vouchIds,
      updatedAt: Date.now(),
    });
    // Maintain wallet → endpoint index.
    await kv.sadd(`wallet:${wallet}`, endpoint);
  } else {
    const existing = memGet(key);
    const vouchIds = Array.from(new Set([...(existing?.vouchIds ?? []), vouchId]));
    memSet(key, {
      endpoint,
      subscription,
      walletAddress: wallet,
      vouchIds,
      updatedAt: Date.now(),
    });
  }

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

  const endpoint = body.endpoint.slice(0, 512);
  const key = `sub:${endpoint}`;
  const kv = await getKv();

  if (kv) {
    await kv.del(key);
  } else {
    memDel(key);
  }

  return NextResponse.json({ ok: true });
}
