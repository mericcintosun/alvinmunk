import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchLeaderboard } from './leaderboard';
import { fetchReputationEvents } from './events';
import { EVENTS } from '@alvinmunk/shared';

vi.mock('./events', () => ({
  fetchReputationEvents: vi.fn(),
}));

describe('fetchLeaderboard', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    localStorage.clear();
  });

  it('merges live event window with snapshot, detects reciprocal rings, and ranks', async () => {
    // Setup mock localStorage snapshot
    localStorage.setItem('alvinmunk.leaderboard.snapshot', JSON.stringify([
      { address: 'A', total: 10, ledger: 100 },
      { address: 'B', total: 5, ledger: 100 },
    ]));

    // Setup mock fetchReputationEvents
    vi.mocked(fetchReputationEvents).mockResolvedValue([
      // New social event for A (updates score)
      { topics: [EVENTS.SOCIAL, 'A'], data: [0, 15], ledger: 200 },
      // New social event for C (new user)
      { topics: [EVENTS.SOCIAL, 'C'], data: 20, ledger: 200 },
      // Reciprocal vouch pair A <-> C
      { topics: [EVENTS.VOUCH, 'claimed'], data: ['id1', 'A', 'C'], ledger: 200 },
      { topics: [EVENTS.VOUCH, 'claimed'], data: ['id2', 'C', 'A'], ledger: 200 },
    ] as any);

    const result = await fetchLeaderboard();

    // C has 20 (rank 1), A has 15 (rank 2), B has 5 (rank 3).
    // A and C are a ring, so their flagged should be true.
    expect(result).toEqual([
      { address: 'C', score: 20, rank: 1, flagged: true },
      { address: 'A', score: 15, rank: 2, flagged: true },
      { address: 'B', score: 5, rank: 3, flagged: false },
    ]);
  });
});
