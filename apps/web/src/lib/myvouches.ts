/**
 * My minted vouches — kept locally (the claim-secret only ever exists client-side) so
 * the dashboard can resurface UNCLAIMED half-cards: the re-engagement hook (your stake
 * gets slashed if nobody claims within the window — re-share the link).
 */
import { buildClaimUrl } from '@alvinmunk/shared';
import { getVouch, VOUCH_TTL_SECS } from './reputation';
import { subscribeToPush } from './push';

export interface MyVouch {
  id: number;
  secret: string;
  note: string;
  created: number; // unix seconds
  /** Stellar address of the voucher — stored so we can look up push subscriptions
   *  server-side when the claim page notifies after claim_vouch succeeds. */
  walletAddress?: string;
}

const KEY = 'alvinmunk.myVouches';

export function getMyVouches(): MyVouch[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '[]') as MyVouch[];
  } catch {
    return [];
  }
}

export function addMyVouch(v: MyVouch): void {
  if (typeof localStorage === 'undefined') return;
  const list = [v, ...getMyVouches().filter((x) => x.id !== v.id)].slice(0, 60);
  localStorage.setItem(KEY, JSON.stringify(list));
}

export interface PendingVouch extends MyVouch {
  claimUrl: string;
  daysLeft: number;
}

/** Minted vouches still awaiting a claim (not claimed, not slashed, in-window). */
export async function getPendingVouches(origin: string): Promise<PendingVouch[]> {
  const mine = getMyVouches();
  const now = Math.floor(Date.now() / 1000);
  const out: PendingVouch[] = [];
  await Promise.all(
    mine.map(async (m) => {
      const v = await getVouch(m.id).catch(() => null);
      if (!v || v.claimed || v.slashed) return;
      const deadline = v.created + VOUCH_TTL_SECS;
      if (now >= deadline) return; // window closed — stake already slashable
      out.push({
        ...m,
        claimUrl: `${buildClaimUrl(origin, m.id)}?s=${m.secret}`,
        daysLeft: Math.max(0, Math.ceil((deadline - now) / 86_400)),
      });
    }),
  );
  return out.sort((a, b) => a.daysLeft - b.daysLeft);
}

const SEEN_CLAIMED_KEY = 'alvinmunk.seenClaimed';

function getSeenClaimed(): { ids: number[]; baselined: boolean } {
  if (typeof localStorage === 'undefined') return { ids: [], baselined: true };
  try {
    const raw = localStorage.getItem(SEEN_CLAIMED_KEY);
    if (raw === null) return { ids: [], baselined: false };
    return { ids: JSON.parse(raw) as number[], baselined: true };
  } catch {
    return { ids: [], baselined: true };
  }
}

/**
 * Subscribe to push notifications for a newly minted vouch (if permission is granted and
 * VAPID is configured). Fire-and-forget — failures are logged but don't break the mint flow.
 * Call this AFTER addMyVouch so the localStorage record exists and has walletAddress.
 */
export async function subscribeToVouchPush(walletAddress: string, vouchId: number): Promise<void> {
  try {
    await subscribeToPush(walletAddress, vouchId);
  } catch (err) {
    console.warn('[myvouches] push subscription failed:', err);
  }
}

/**
 * The one in-app notification that matters (Nicole/roundtable): your vouch to someone was
 * CLAIMED — their star ignited. Returns vouches claimed SINCE the last check (empty on the
 * first ever run, which just baselines so old claims don't flood). Marks them seen.
 *
 * NOTE: pollNewlyClaimed is in-session only. Web push (subscribeToVouchPush + service worker)
 * handles the bring-them-back case when the tab is closed.
 */
export async function pollNewlyClaimed(): Promise<{ id: number; note: string }[]> {
  const mine = getMyVouches();
  if (mine.length === 0) return [];
  const { ids: seenIds, baselined } = getSeenClaimed();
  const seen = new Set(seenIds);
  const claimedNow: number[] = [];
  const fresh: { id: number; note: string }[] = [];
  await Promise.all(
    mine.slice(0, 25).map(async (m) => {
      const v = await getVouch(m.id).catch(() => null);
      if (!v?.claimed) return;
      claimedNow.push(m.id);
      if (baselined && !seen.has(m.id)) fresh.push({ id: m.id, note: m.note });
    }),
  );
  if (typeof localStorage !== 'undefined') {
    // Persist the union so a claim is reported once; first run only baselines (no toasts).
    const next = Array.from(new Set([...seenIds, ...claimedNow]));
    localStorage.setItem(SEEN_CLAIMED_KEY, JSON.stringify(next));
  }
  return baselined ? fresh : [];
}
