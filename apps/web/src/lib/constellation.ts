/**
 * Constellation data — "who lit your sky": the people who VOUCHED a given address
 * (inbound claimed edges), enriched with the vouch note + timestamp so the 3D hero can
 * render real faces/stars, not numbers. Wallet-free — reads RPC events + the on-chain
 * get_vouch view (durable indexer deferred to Blue/Black, belts/00-strategy).
 */
import { artSeed, EVENTS } from '@alvinmunk/shared';
import { fetchReputationEvents } from './events';
import { getCounts, getVouch, type PeopleCounts } from './reputation';
import { foldVouchEdges, type ChainEvent } from './badges';
import type { ReadNetwork } from './read-network';

/** A person who vouched you — one star in your constellation. (For `fetchBackedBy`, `from`
 *  is the person backed: always the other side of the edge.) */
export interface VoucherStar {
  from: string;
  vouchId: number;
  note: string;
  /** ledger unix-seconds when the half-card was minted */
  created: number;
}

/**
 * The claimed vouch edges touching `address` in one direction, newest first, one per other
 * person, capped at `max`: `in` = who vouched for it (claimer === address), `out` = whom it
 * backed (from === address). Read from `vouch:claimed` events (id, from, claimer), then
 * enriched with note + timestamp via get_vouch. `net` reads another network (the ?network=
 * override, lib/read-network).
 */
async function claimedEdges(
  address: string,
  direction: 'in' | 'out',
  max: number,
  net?: ReadNetwork | null,
): Promise<VoucherStar[]> {
  const events = await fetchReputationEvents({ net });

  const seen = new Set<string>();
  const edges: { other: string; vouchId: number }[] = [];
  for (let i = events.length - 1; i >= 0; i--) {
    const { topics, data } = events[i];
    if (topics[0] !== EVENTS.VOUCH || topics[1] !== 'claimed') continue;
    if (!Array.isArray(data) || data.length < 3) continue;
    const vouchId = Number(data[0]);
    const from = String(data[1]);
    const claimer = String(data[2]);
    if (from === claimer) continue; // rejected on-chain; never a person to show
    const other = direction === 'in' ? (claimer === address ? from : null) : from === address ? claimer : null;
    if (!other || seen.has(other)) continue;
    seen.add(other);
    edges.push({ other, vouchId });
    if (edges.length >= max) break;
  }

  return Promise.all(
    edges.map(async (e): Promise<VoucherStar> => {
      const v = await getVouch(e.vouchId, net).catch(() => null);
      return { from: e.other, vouchId: e.vouchId, note: v?.note ?? '', created: v?.created ?? 0 };
    }),
  );
}

/** People who vouched `address` — newest first, de-duplicated per voucher, capped at `max`. */
export function fetchVouchersOf(address: string, max = 14, net?: ReadNetwork | null): Promise<VoucherStar[]> {
  return claimedEdges(address, 'in', max, net);
}

/**
 * People `address` BACKED — its claimed half-cards, newest first, one per recipient, capped
 * at `max`. `from` on each star is the person backed (the other side of the edge).
 */
export function fetchBackedBy(address: string, max = 14, net?: ReadNetwork | null): Promise<VoucherStar[]> {
  return claimedEdges(address, 'out', max, net);
}

/**
 * The people `viewer` and `address` are BOTH connected to by a claimed vouch, either way
 * round (undirected, as `suggestPeople` treats edges). Pure: pass the window's events.
 * Sorted, so a re-render never reshuffles it; the two themselves are never in it.
 */
export function mutualNeighbours(viewer: string, address: string, events: ChainEvent[]): string[] {
  if (!viewer || !address || viewer === address) return [];
  const a = foldVouchEdges(events, viewer);
  const b = foldVouchEdges(events, address);
  const ofViewer = new Set([...a.vouchedBy, ...a.vouchedFor]);
  const ofSubject = new Set([...b.vouchedBy, ...b.vouchedFor]);
  ofViewer.delete(address);
  ofSubject.delete(viewer);
  return [...ofViewer].filter((n) => ofSubject.has(n)).sort();
}

/**
 * "People who vouched" / "people you backed" for `address`. The durable on-chain counters
 * (`get_counts`) start at the upgrade that added them and can't be backfilled; the recent
 * `vouch:claimed` events only cover the RPC window. Both are lower bounds on the same
 * number, so each side takes the larger — a counter still at 0 (or a deployed contract
 * that predates the view) falls back to the events. Never derived from Social XP.
 */
export async function getPeopleCounts(address: string, net?: ReadNetwork | null): Promise<PeopleCounts> {
  const [onchain, events] = await Promise.all([getCounts(address, net), fetchReputationEvents({ net })]);
  const recent = foldVouchEdges(events, address);
  return {
    vouchedBy: Math.max(onchain?.vouchedBy ?? 0, recent.vouchedBy.length),
    backed: Math.max(onchain?.backed ?? 0, recent.vouchedFor.length),
  };
}

/** Warm relative time from a unix-seconds timestamp. */
export function timeAgo(unixSecs: number, locale = 'en'): string {
  if (!unixSecs) return '';
  const s = Math.max(0, Math.floor(Date.now() / 1000) - unixSecs);
  const days = Math.floor(s / 86_400);
  const localeTag = locale === 'tr' ? 'tr-TR' : 'en-US';
  const naturalRelativeTime = new Intl.RelativeTimeFormat(localeTag, { numeric: 'auto' });
  const numericRelativeTime = new Intl.RelativeTimeFormat(localeTag, { numeric: 'always' });
  if (days <= 0) return naturalRelativeTime.format(0, 'day');
  if (days === 1) return naturalRelativeTime.format(-1, 'day');
  if (days < 7) return numericRelativeTime.format(-days, 'day');
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return numericRelativeTime.format(-weeks, 'week');
  return numericRelativeTime.format(-Math.floor(days / 30), 'month');
}

// ── People suggestions ───────────────────────────────────────────────────────

/** One suggested person — address, shared-connection count, and an optional @handle. */
export interface Suggestion {
  address: string;
  /** Number of people both `me` and this address share a vouch edge with. */
  sharedCount: number;
  /** Resolved @handle, or null when unclaimed / not yet looked up. */
  handle: string | null;
}

/**
 * Pure second-degree suggestion engine, built on `foldVouchEdges` (the same fold
 * `badges.ts` and `getPeopleCounts` above use) instead of re-parsing `vouch:claimed`
 * topics/data — one place decides what counts as an edge.
 *
 * Treat every `vouch:claimed` edge as UNDIRECTED (A↔B when either A vouched B or B
 * vouched A — `foldVouchEdges` already merges both directions into `vouchedBy` +
 * `vouchedFor`). Then:
 *   1. Fold `me`'s direct connections (first-degree neighbours).
 *   2. For each first-degree neighbour, fold THEIR connections too, and count how many
 *      first-degree neighbours share an edge to each second-degree candidate.
 *   3. Drop `me` and anyone already in the first-degree set.
 *   4. Rank descending by shared count; break ties by address (stable, deterministic).
 *   5. Return the top `max` results (default 6).
 *
 * Pure: no I/O. Feed it the full event list from `fetchReputationEvents()`.
 */
export function suggestPeople(me: string, events: ChainEvent[], max = 6): Suggestion[] {
  const myEdges = foldVouchEdges(events, me);
  const direct = new Set([...myEdges.vouchedBy, ...myEdges.vouchedFor]);

  // Count shared connections for each second-degree candidate.
  const shared = new Map<string, number>();
  for (const neighbour of direct) {
    const theirs = foldVouchEdges(events, neighbour);
    for (const candidate of [...theirs.vouchedBy, ...theirs.vouchedFor]) {
      if (candidate === me) continue;
      if (direct.has(candidate)) continue; // already connected
      shared.set(candidate, (shared.get(candidate) ?? 0) + 1);
    }
  }

  return [...shared.entries()]
    .sort(([addrA, cntA], [addrB, cntB]) => cntB - cntA || addrA.localeCompare(addrB))
    .slice(0, max)
    .map(([address, sharedCount]) => ({ address, sharedCount, handle: null }));
}

// ── Deterministic colour ──────────────────────────────────────────────────────

/** Deterministic hue (0-359) from an address — matches the crest art seed family. */
export function addrHue(address: string): number {
  return artSeed(address) % 360;
}
