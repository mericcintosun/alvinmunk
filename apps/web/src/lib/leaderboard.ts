/**
 * MVP leaderboard (Yellow belt): read `social` + `vouch claimed` events from RPC,
 * fold into a ranking, and harden against the two known MVP gaps:
 *   - #7 RPC retention (~24h): paginate the window AND persist a localStorage snapshot
 *     so scores survive once seen (no standing indexer needed yet).
 *   - #5 sybil: flag reciprocal vouch pairs (A↔B). Full clustering lands at Blue.
 * The fold/merge/ring logic is the pure, tested code in @alvinmunk/shared.
 */
import {
  rankLeaderboard,
  mergeSocialRecords,
  detectReciprocalRings,
  EVENTS,
  type SocialRecord,
  type VouchPair,
  type LeaderboardEntry,
} from '@alvinmunk/shared';
import { fetchReputationEvents } from './events';
import { readJSON, writeJSON } from './storage';

const SNAPSHOT_KEY = 'alvinmunk.leaderboard.snapshot';

function loadSnapshot(): SocialRecord[] {
  return readJSON<SocialRecord[]>(SNAPSHOT_KEY, []);
}
function saveSnapshot(records: SocialRecord[]): void {
  writeJSON(SNAPSHOT_KEY, records);
}

/** Pull recent reputation events → social records + claimed vouch pairs. */
export async function fetchWindow(options?: { throwOnError?: boolean }): Promise<{ records: SocialRecord[]; pairs: VouchPair[] }> {
  const records: SocialRecord[] = [];
  const pairs: VouchPair[] = [];

  for (const { topics, data, ledger } of await fetchReputationEvents(options)) {
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

export async function fetchLeaderboard(options?: { throwOnError?: boolean }): Promise<LeaderboardEntry[]> {
  // `throwOnError` always propagates a failure — regardless of whether a snapshot exists —
  // so the caller can tell an outage apart from a genuinely quiet network. Swallowing the
  // error whenever a snapshot happened to be present would silently keep the "live" badge
  // on screen through an outage that started after the first successful load: the exact bug
  // this option exists to prevent (issue #209).
  const { records, pairs } = await fetchWindow(options);

  // Merge with the persisted snapshot so older scores survive the RPC window.
  const merged = mergeSocialRecords(loadSnapshot(), records);
  if (records.length > 0 || pairs.length > 0) {
    saveSnapshot(merged);
  }
  const flagged = new Set(detectReciprocalRings(pairs));
  return rankLeaderboard(merged, flagged);
}
