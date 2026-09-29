/**
 * My minted vouches — kept locally (the claim code only ever exists client-side) so
 * the dashboard can resurface UNCLAIMED half-cards: the re-engagement hook (your stake
 * gets slashed if nobody claims within the window — re-share the link). The claimed ones
 * also surface the voucher bonus still waiting on each claimer (`getOwedBonuses`).
 */
import { claimLink, getPending, getVouch, VOUCH_TTL_SECS, type ClaimCode } from './reputation';
import { reverseHandle } from './registry';
import { subscribeToPush } from './push';
import { readJSON, writeJSON } from './storage';

export interface MyVouch {
  id: number;
  /** The card's claim-key seed (hex) — set for cards minted with `mint_vouch_signed`. */
  seed?: string;
  /** The legacy claim secret (hex) — set on cards stored before the claim key existed. */
  secret?: string;
  note: string;
  created: number; // unix seconds
  /** Stellar address of the voucher — stored so we can look up push subscriptions
   *  server-side when the claim page notifies after claim_vouch succeeds. */
  walletAddress?: string;
}

const KEY = 'alvinmunk.myVouches';

export function getMyVouches(): MyVouch[] {
  return readJSON<MyVouch[]>(KEY, []);
}

export function addMyVouch(v: MyVouch): void {
  const list = [v, ...getMyVouches().filter((x) => x.id !== v.id)].slice(0, 60);
  writeJSON(KEY, list);
}

/**
 * Vouch IDs this device still wants notifications for (pending, unclaimed, in-window).
 * Used when a rotated push subscription must be re-registered after the server already
 * pruned the old record (#169) — the server's vouchIds set is rebuilt from this list.
 */
export async function getPendingVouchIds(): Promise<number[]> {
  const mine = getMyVouches();
  if (mine.length === 0) return [];
  const now = Math.floor(Date.now() / 1000);
  const ids = await Promise.all(
    mine.map(async (m) => {
      const v = await getVouch(m.id).catch(() => null);
      if (!v || v.claimed || v.slashed) return null;
      if (now >= v.created + VOUCH_TTL_SECS) return null;
      return m.id;
    }),
  );
  return ids.filter((id): id is number => id !== null);
}

export interface PendingVouch extends MyVouch {
  claimUrl: string;
  daysLeft: number;
}

/** The code a stored card's link carries: its claim-key seed, or an older card's secret. */
function claimCodeOf(m: MyVouch): ClaimCode {
  return m.seed ? { kind: 'key', code: m.seed } : { kind: 'secret', code: m.secret ?? '' };
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
        claimUrl: claimLink(origin, m.id, claimCodeOf(m)),
        daysLeft: Math.max(0, Math.ceil((deadline - now) / 86_400)),
      });
    }),
  );
  return out.sort((a, b) => a.daysLeft - b.daysLeft);
}

/** A voucher bonus you're still owed — waiting on one person you vouched to verify. */
export interface OwedBonus {
  claimer: string;
  /** their @handle, when they claimed one */
  handle: string | null;
  /** the note on your latest vouch for them */
  note: string;
  /** Social XP owed to you, released on their first verified quest */
  amount: number;
}

/**
 * The 2nd-order bonuses `me` is still owed (belts/08 §1): for each vouch minted here by `me`
 * that has been claimed, read `get_pending(claimer)` and keep the entries whose voucher is
 * `me`. One row per person, largest first. A claimer who verified has an empty queue, so
 * their row drops out. A failed read for one person (including a deployed contract that
 * predates `get_pending`) drops that row, never the whole list.
 */
export async function getOwedBonuses(me: string): Promise<OwedBonus[]> {
  const mine = getMyVouches();
  const chain = await Promise.all(mine.map((m) => getVouch(m.id).catch(() => null)));

  // Unique claimers of MY claimed vouches (this browser may hold another wallet's too).
  const claimers = new Map<string, string>(); // claimer -> note of the newest vouch
  chain.forEach((v, i) => {
    if (!v?.claimed || !v.claimer || v.from !== me) return;
    if (!claimers.has(v.claimer)) claimers.set(v.claimer, mine[i].note);
  });

  const rows = await Promise.all(
    [...claimers].map(async ([claimer, note]): Promise<OwedBonus | null> => {
      const pending = await getPending(claimer).catch(() => null);
      if (!pending) return null;
      const amount = pending.filter((p) => p.voucher === me).reduce((sum, p) => sum + p.amount, 0);
      if (amount <= 0) return null;
      const handle = await reverseHandle(claimer).catch(() => null);
      return { claimer, handle, note, amount };
    }),
  );
  return rows.filter((r): r is OwedBonus => r !== null).sort((a, b) => b.amount - a.amount);
}

const SEEN_CLAIMED_KEY = 'alvinmunk.seenClaimed';

function getSeenClaimed(): { ids: number[]; baselined: boolean } {
  const ids = readJSON<number[] | null>(SEEN_CLAIMED_KEY, null);
  if (ids === null) return { ids: [], baselined: false };
  return { ids, baselined: true };
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
  // Persist the union so a claim is reported once; first run only baselines (no toasts).
  const next = Array.from(new Set([...seenIds, ...claimedNow]));
  writeJSON(SEEN_CLAIMED_KEY, next);
  return baselined ? fresh : [];
}
