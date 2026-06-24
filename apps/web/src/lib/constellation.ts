/**
 * Constellation data — "who lit your sky": the people who VOUCHED a given address
 * (inbound claimed edges), enriched with the vouch note + timestamp so the 3D hero can
 * render real faces/stars, not numbers. Wallet-free — reads RPC events + the on-chain
 * get_vouch view (durable indexer deferred to Blue/Black, belts/00-strategy).
 */
import { EVENTS } from '@passport/shared';
import { fetchReputationEvents } from './events';
import { getVouch } from './reputation';

/** A person who vouched you — one star in your constellation. */
export interface VoucherStar {
  from: string;
  vouchId: number;
  note: string;
  /** ledger unix-seconds when the half-card was minted */
  created: number;
}

/**
 * People who vouched `address` — newest first, de-duplicated per voucher, capped at
 * `max`. Reads `vouch:claimed` events (id, from, claimer) where claimer === address,
 * then enriches each with note + timestamp via get_vouch.
 */
export async function fetchVouchersOf(address: string, max = 14): Promise<VoucherStar[]> {
  const events = await fetchReputationEvents();

  const seen = new Set<string>();
  const edges: { from: string; vouchId: number }[] = [];
  for (let i = events.length - 1; i >= 0; i--) {
    const { topics, data } = events[i];
    if (topics[0] !== EVENTS.VOUCH || topics[1] !== 'claimed') continue;
    if (!Array.isArray(data)) continue;
    const vouchId = Number(data[0]);
    const from = String(data[1]);
    const claimer = String(data[2]);
    if (claimer !== address || seen.has(from)) continue;
    seen.add(from);
    edges.push({ from, vouchId });
    if (edges.length >= max) break;
  }

  return Promise.all(
    edges.map(async (e): Promise<VoucherStar> => {
      const v = await getVouch(e.vouchId).catch(() => null);
      return { from: e.from, vouchId: e.vouchId, note: v?.note ?? '', created: v?.created ?? 0 };
    }),
  );
}

/** Warm relative time from a unix-seconds timestamp. */
export function timeAgo(unixSecs: number): string {
  if (!unixSecs) return '';
  const s = Math.max(0, Math.floor(Date.now() / 1000) - unixSecs);
  const days = Math.floor(s / 86_400);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks} week${weeks === 1 ? '' : 's'} ago`;
  return `${Math.floor(days / 30)} month${Math.floor(days / 30) === 1 ? '' : 's'} ago`;
}

/** Deterministic hue (0-359) from an address — matches the crest art seed family. */
export function addrHue(address: string): number {
  let h = 2166136261;
  for (let i = 0; i < address.length; i++) {
    h ^= address.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % 360;
}
