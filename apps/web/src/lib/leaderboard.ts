/**
 * MVP leaderboard (Yellow belt): read `social` + `vouch claimed` events from RPC,
 * fold into a ranking, and harden against the two known MVP gaps:
 *   - #7 RPC retention (~24h): paginate the window AND persist a localStorage snapshot
 *     so scores survive once seen (no standing indexer needed yet).
 *   - #5 sybil: flag reciprocal vouch pairs (A↔B). Full clustering lands at Blue.
 * The fold/merge/ring logic is the pure, tested code in @passport/shared.
 */
import { scValToNative, xdr } from '@stellar/stellar-sdk';
import {
  rankLeaderboard,
  mergeSocialRecords,
  detectReciprocalRings,
  EVENTS,
  type SocialRecord,
  type VouchPair,
  type LeaderboardEntry,
} from '@passport/shared';
import { server, config } from './stellar';

const SNAPSHOT_KEY = 'passport.leaderboard.snapshot';

function toNative(v: xdr.ScVal | string): unknown {
  const sv = typeof v === 'string' ? xdr.ScVal.fromXDR(v, 'base64') : v;
  return scValToNative(sv);
}

function loadSnapshot(): SocialRecord[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    return JSON.parse(localStorage.getItem(SNAPSHOT_KEY) ?? '[]') as SocialRecord[];
  } catch {
    return [];
  }
}
function saveSnapshot(records: SocialRecord[]): void {
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(records));
  }
}

/** Pull recent reputation events (paginated) → social records + claimed vouch pairs. */
export async function fetchWindow(): Promise<{ records: SocialRecord[]; pairs: VouchPair[] }> {
  const records: SocialRecord[] = [];
  const pairs: VouchPair[] = [];
  if (!config.contracts.reputation) return { records, pairs };

  let startLedger: number;
  try {
    const latest = await server.getLatestLedger();
    startLedger = Math.max(1, latest.sequence - 16000); // ~24h, within RPC retention
  } catch {
    return { records, pairs };
  }

  let res;
  try {
    res = await server.getEvents({
      startLedger,
      filters: [
        { type: 'contract', contractIds: [config.contracts.reputation], topics: [['*', '*']] },
      ],
      limit: 1000,
    });
  } catch {
    return { records, pairs };
  }

  for (const ev of res.events) {
    const topics = (ev.topic as Array<xdr.ScVal | string>).map(toNative);
    const data = toNative(ev.value as xdr.ScVal | string);
    if (topics[0] === EVENTS.SOCIAL) {
      const total = Array.isArray(data) ? Number(data[1]) : Number(data);
      records.push({ address: String(topics[1]), total, ledger: ev.ledger });
    } else if (topics[0] === EVENTS.VOUCH && topics[1] === 'claimed' && Array.isArray(data)) {
      // ('vouch','claimed') -> (id, from, claimer)
      pairs.push({ from: String(data[1]), claimer: String(data[2]) });
    }
  }
  return { records, pairs };
}

export async function fetchLeaderboard(): Promise<LeaderboardEntry[]> {
  const { records, pairs } = await fetchWindow();
  // Merge with the persisted snapshot so older scores survive the RPC window.
  const merged = mergeSocialRecords(loadSnapshot(), records);
  saveSnapshot(merged);
  const flagged = new Set(detectReciprocalRings(pairs));
  return rankLeaderboard(merged, flagged);
}
