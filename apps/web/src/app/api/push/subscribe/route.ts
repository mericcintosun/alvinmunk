/**
 * /api/push/subscribe — store, move, or remove a push subscription.
 *
 * POST  { subscription: PushSubscriptionJSON, walletAddress: string, vouchId: number }
 *       { subscription: PushSubscriptionJSON, walletAddress: string, vouchIds: number[] }
 *       { subscription: PushSubscriptionJSON, walletAddress: string }
 *   → Upserts a subscription record keyed by endpoint, for a G… or C… `walletAddress`.
 *   → Adds the vouch ID(s) to the set of vouch IDs the voucher wants notified about. The
 *     legacy single `vouchId` and the `vouchIds` array (used when a rotated subscription
 *     re-registers with every still-pending vouch) are both accepted.
 *   → With no vouch ID (no field, or an empty `vouchIds`) it is a general opt-in (#297):
 *     the wallet gets its tip notifications without ever having minted. A vouch field that
 *     is present but malformed is rejected, never read as a general opt-in.
 *
 * PATCH { oldEndpoint: string, subscription: PushSubscriptionJSON, walletAddress: string }
 *   → Moves the stored record to the new endpoint key (pushsubscriptionchange, #169),
 *     keeping the wallet and the accumulated vouchIds. Requires the owning wallet as
 *     the same ownership proof DELETE uses.
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
import { isStellarAddress } from '@alvinmunk/shared';
import {
  removeSubscription,
  saveGeneralSubscription,
  saveSubscription,
  saveSubscriptionWithVouchIds,
  moveSubscription,
} from '@/lib/push-store';
import { withRoute } from '@/lib/api-route';

const MAX_BODY = 4096;

export const POST = withRoute('POST /api/push/subscribe', async (req: NextRequest) => {
  // Reject oversized bodies.
  const contentLength = Number(req.headers.get('content-length') ?? 0);
  if (contentLength > MAX_BODY) {
    return NextResponse.json({ error: 'body too large' }, { status: 413 });
  }

  let body: { subscription?: PushSubscriptionJSON; walletAddress?: string; vouchId?: number; vouchIds?: number[] };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  const { subscription, walletAddress } = body;

  const isVouchId = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0;
  // `vouchIds` (a rotated subscription re-registering, #169) wins over the legacy `vouchId`;
  // neither is a general opt-in (#297).
  const vouchIds: number[] | null =
    body.vouchIds !== undefined
      ? Array.isArray(body.vouchIds) && body.vouchIds.every(isVouchId)
        ? body.vouchIds
        : null
      : body.vouchId !== undefined
        ? isVouchId(body.vouchId)
          ? [body.vouchId]
          : null
        : [];

  if (
    !subscription ||
    typeof subscription.endpoint !== 'string' ||
    !subscription.endpoint.startsWith('https://') ||
    typeof walletAddress !== 'string' ||
    !isStellarAddress(walletAddress) ||
    vouchIds === null
  ) {
    return NextResponse.json({ error: 'missing or invalid fields' }, { status: 422 });
  }

  const wallet = walletAddress.trim();
  if (vouchIds.length === 0) {
    await saveGeneralSubscription(subscription, wallet);
  } else if (body.vouchIds !== undefined) {
    await saveSubscriptionWithVouchIds(subscription, wallet, vouchIds);
  } else {
    await saveSubscription(subscription, wallet, vouchIds[0]);
  }

  return NextResponse.json({ ok: true });
});

/**
 * PATCH — move an existing subscription record to a rotated endpoint.
 *
 * Body: { oldEndpoint, subscription, walletAddress }
 *   oldEndpoint   — the endpoint the server currently stores
 *   subscription  — the fresh PushSubscriptionJSON (new endpoint, keys, auth…)
 *   walletAddress — ownership proof: must match the wallet the record is stored under
 *
 * Returns { ok: true } on a successful move, or the appropriate error:
 *   400 invalid json · 413 too large · 422 missing/invalid fields
 *   404 unknown oldEndpoint · 403 wallet does not own the record · 409 new endpoint already stored
 */
export const PATCH = withRoute('PATCH /api/push/subscribe', async (req: NextRequest) => {
  const contentLength = Number(req.headers.get('content-length') ?? 0);
  if (contentLength > MAX_BODY) {
    return NextResponse.json({ error: 'body too large' }, { status: 413 });
  }

  let body: { oldEndpoint?: string; subscription?: PushSubscriptionJSON; walletAddress?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  const { oldEndpoint, subscription, walletAddress } = body;

  if (
    !oldEndpoint ||
    typeof oldEndpoint !== 'string' ||
    !oldEndpoint.startsWith('https://') ||
    !subscription ||
    typeof subscription.endpoint !== 'string' ||
    !subscription.endpoint.startsWith('https://') ||
    subscription.endpoint === oldEndpoint ||
    !walletAddress ||
    typeof walletAddress !== 'string'
  ) {
    return NextResponse.json({ error: 'missing or invalid fields' }, { status: 422 });
  }

  const result = await moveSubscription(
    oldEndpoint.slice(0, 512),
    subscription.endpoint.slice(0, 512),
    subscription,
    walletAddress,
  );

  switch (result) {
    case 'moved':
      return NextResponse.json({ ok: true });
    case 'not_found':
      // The old endpoint is gone (pruned on a 410, or never registered). The client
      // should fall back to a full POST upsert.
      return NextResponse.json({ error: 'subscription not found' }, { status: 404 });
    case 'forbidden':
      return NextResponse.json({ error: 'not the owner of this subscription' }, { status: 403 });
    case 'conflict':
      return NextResponse.json({ error: 'new endpoint already registered' }, { status: 409 });
  }
});

export const DELETE = withRoute('DELETE /api/push/subscribe', async (req: NextRequest) => {
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
});
