/**
 * MVP leaderboard (Yellow belt): read `social` + `vouch claimed` events from RPC,
 * fold into a ranking, and harden against the two known MVP gaps:
 *   - #7 RPC retention (~24h): paginate the window AND persist a localStorage snapshot
 *     so scores survive once seen (no standing indexer needed yet).
 *   - #5 sybil: flag reciprocal vouch pairs (A↔B). Full clustering lands at Blue.
 * The fold/merge/ring logic is the pure, tested code in @passport/shared.
 */
import {
  rankLeaderboard,
  mergeSocialRecords,
  detectReciprocalRings,
  EVENTS,
  type SocialRecord,
  type VouchPair,
  type LeaderboardEntry,
} from '@passport/shared';
import { fetchReputationEvents } from './events';

const SNAPSHOT_KEY = 'passport.leaderboard.snapshot';

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

/** Pull recent reputation events → social records + claimed vouch pairs. */
export async function fetchWindow(): Promise<{ records: SocialRecord[]; pairs: VouchPair[] }> {
  const records: SocialRecord[] = [];
  const pairs: VouchPair[] = [];

  for (const { topics, data, ledger } of await fetchReputationEvents()) {
    if (topics[0] === EVENTS.SOCIAL) {
      const total = Array.isArray(data) ? Number(data[1]) : Number(data);
      records.push({ address: String(topics[1]), total, ledger });
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
