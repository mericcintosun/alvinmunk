/**
 * GET /api/cron/notify — the scheduled worker that pushes "@alice tipped you 2 USDC" to a
 * tip's recipient (#297). Vercel cron calls it on the schedule in apps/web/vercel.json: daily,
 * the most a Hobby plan allows — on Pro, tighten it (see CRON_SECRET in .env.example). The
 * cursor and the per-tip claims need KV to persist across serverless instances.
 *
 * Auth: `Authorization: Bearer <CRON_SECRET>`, which Vercel sends on every cron call once
 * the env var is set. No secret configured → 503 (disabled, never open); a wrong or
 * missing header → 401.
 *
 * Each run:
 *   1. reads `tipped` events on the rewards contract since the stored RPC cursor
 *      (lib/events `fetchTipEventsSince`; the first run starts at the latest ledger);
 *   2. for a tip whose recipient has subscriptions, claims the event (SET NX, lib/push-store
 *      `claimEvent`) and only then pushes to each of the recipient's devices — an event is
 *      claimed once, so neither a later run nor an overlapping one sends it twice;
 *   3. stores the cursor the read ended on.
 * Delivery is at-most-once: a push service error is logged and not retried (a retry could
 * not tell which devices already got it), and revoked endpoints (404/410) are pruned. One
 * bad endpoint therefore never holds back every later tip.
 */
import { timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { shortAddr } from '@alvinmunk/shared';
import { withRoute } from '@/lib/api-route';
import { fetchTipEventsSince, type RepEvent } from '@/lib/events';
import {
  claimEvent,
  getCursor,
  getSubscriptionsForWallet,
  removeSubscription,
  setCursor,
  type StoredSubscription,
} from '@/lib/push-store';
import { reverseHandles } from '@/lib/registry';
import { stroopsToUsdc } from '@/lib/rewards';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Where a tip notification opens: the inbox lists received tips. */
const TIP_URL = '/app/inbox';

/** Constant-time `Bearer <secret>` check, so the secret can't be guessed byte by byte. */
function authorized(header: string | null, secret: string): boolean {
  const got = Buffer.from(header ?? '');
  const want = Buffer.from(`Bearer ${secret}`);
  return got.length === want.length && timingSafeEqual(got, want);
}

/** A well-formed tip: `('tipped', from, to)` · positive amount, with an RPC id. */
interface Tip {
  id: string;
  from: string;
  to: string;
  amount: bigint;
}

function asTip(ev: RepEvent): Tip | null {
  const [, from, to] = ev.topics;
  const amount = ev.data;
  if (!ev.id || typeof from !== 'string' || typeof to !== 'string') return null;
  if (typeof amount !== 'bigint' || amount <= 0n) return null;
  return { id: ev.id, from, to, amount };
}

export const GET = withRoute('GET /api/cron/notify', async (req: NextRequest) => {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: 'cron not configured' }, { status: 503 });
  if (!authorized(req.headers.get('authorization'), secret)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  // Push not configured: nothing to send, and the cursor stays put for when it is.
  const vapidSubject = process.env.VAPID_SUBJECT;
  const vapidPublicKey = process.env.VAPID_PUBLIC_KEY;
  const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY;
  if (!vapidSubject || !vapidPublicKey || !vapidPrivateKey) {
    return NextResponse.json({ ok: true, sent: 0, skipped: 'push not configured' });
  }

  let webpush: typeof import('web-push');
  try {
    webpush = await import('web-push');
  } catch {
    return NextResponse.json({ ok: false, error: 'web-push not installed' }, { status: 500 });
  }
  webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);

  const previous = await getCursor();
  const read = await fetchTipEventsSince(previous);
  if (!read.ok) return NextResponse.json({ ok: false, error: 'rpc unavailable' }, { status: 502 });

  // Only tips someone is subscribed to cost a claim, a handle lookup and a push.
  const tips = read.events.map(asTip).filter((tip): tip is Tip => tip !== null);
  const subsByWallet = new Map<string, StoredSubscription[]>();
  for (const to of new Set(tips.map((tip) => tip.to))) {
    subsByWallet.set(to, await getSubscriptionsForWallet(to));
  }
  const due = tips.filter((tip) => (subsByWallet.get(tip.to)?.length ?? 0) > 0);

  let handles: Record<string, string | null> = {};
  if (due.length > 0) {
    // Senders, named by @handle; a failed lookup only falls back to the short address.
    handles = await reverseHandles([...new Set(due.map((tip) => tip.from))]).catch(() => ({}));
  }

  let sent = 0;
  let failed = 0;
  for (const tip of due) {
    if (!(await claimEvent(tip.id))) continue; // already pushed, or being pushed right now
    const who = handles[tip.from] ? `@${handles[tip.from]}` : shortAddr(tip.from);
    const payload = JSON.stringify({
      title: '💸 You received a tip',
      body: `${who} tipped you ${stroopsToUsdc(tip.amount)} USDC`,
      url: TIP_URL,
      tag: `tip-${tip.id}`,
    });
    const results = await Promise.all(
      (subsByWallet.get(tip.to) ?? []).map(async (stored) => {
        try {
          await webpush.sendNotification(
            stored.subscription as Parameters<typeof webpush.sendNotification>[0],
            payload,
          );
          return true;
        } catch (err) {
          const status = (err as { statusCode?: number })?.statusCode;
          if (status === 404 || status === 410) {
            await removeSubscription(stored.endpoint).catch(() => {});
          } else {
            console.warn('[cron/notify] sendNotification failed:', status ?? 'no status');
            failed++;
          }
          return false;
        }
      }),
    );
    if (results.includes(true)) sent++;
  }

  if (read.cursor && read.cursor !== previous) await setCursor(read.cursor);

  return NextResponse.json({ ok: true, events: read.events.length, sent, failed });
});
