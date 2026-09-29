import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchLeaderboard } from './leaderboard';
import { fetchReputationEvents } from './events';
import { EVENTS } from '@alvinmunk/shared';
import type { ReadNetwork } from './read-network';

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

  it('completes fetchLeaderboard even when localStorage getter or setter throws', async () => {
    vi.mocked(fetchReputationEvents).mockResolvedValue([
      { topics: [EVENTS.SOCIAL, 'A'], data: [0, 15], ledger: 200 },
    ] as any);

    const original = Object.getOwnPropertyDescriptor(window, 'localStorage');
    Object.defineProperty(window, 'localStorage', {
      get() {
        throw new DOMException('SecurityError', 'SecurityError');
      },
      configurable: true,
    });

    try {
      const result = await fetchLeaderboard();
      expect(result).toEqual([
        { address: 'A', score: 15, rank: 1, flagged: false },
      ]);
    } finally {
      if (original) {
        Object.defineProperty(window, 'localStorage', original);
      }
    }
  });

  // `events.ts`'s real fetchReputationEvents only rejects when the caller opts into
  // `throwOnError`; otherwise it swallows RPC failures to []. Mock it the same way here so
  // these tests exercise fetchLeaderboard's own handling of that contract, not a mock that
  // contradicts it.
  function mockEventsRespectingThrowOnError() {
    vi.mocked(fetchReputationEvents).mockImplementation(async (options?: { throwOnError?: boolean }) => {
      if (options?.throwOnError) throw new Error('rpc down');
      return [];
    });
  }

  it('resolves to [] on RPC failure for existing callers, preserving the #312 contract', async () => {
    mockEventsRespectingThrowOnError();

    // No `throwOnError` — the default, silent-degrade behaviour every other caller
    // (feed, constellation, badges) still relies on.
    await expect(fetchLeaderboard()).resolves.toEqual([]);
  });

  it('propagates a failure via throwOnError even when a snapshot already has data', async () => {
    // A snapshot from an earlier, successful load.
    localStorage.setItem('alvinmunk.leaderboard.snapshot', JSON.stringify([
      { address: 'A', total: 10, ledger: 100 },
    ]));
    mockEventsRespectingThrowOnError();

    // The outage must still surface to the caller (the leaderboard page uses this to flip
    // the "live" badge to "sync delayed") — the presence of a stale snapshot must not
    // swallow the error and make the page look healthy through an active outage.
    await expect(fetchLeaderboard({ throwOnError: true })).rejects.toThrow('rpc down');
  });

  it('does not throw with throwOnError when the RPC genuinely has nothing to report', async () => {
    vi.mocked(fetchReputationEvents).mockResolvedValue([]);

    await expect(fetchLeaderboard({ throwOnError: true })).resolves.toEqual([]);
  });

  it("always scans fresh: the 5s poll must not be served the dashboard's cached window", async () => {
    vi.mocked(fetchReputationEvents).mockResolvedValue([]);

    await fetchLeaderboard({ throwOnError: true });

    expect(fetchReputationEvents).toHaveBeenLastCalledWith({ throwOnError: true, maxAgeMs: 0 });
  });

  it('keeps an override network in its own snapshot, apart from the deployment\'s (#290)', async () => {
    const net = { network: 'testnet' } as unknown as ReadNetwork;
    localStorage.setItem('alvinmunk.leaderboard.snapshot', JSON.stringify([{ address: 'MAIN', total: 99, ledger: 1 }]));
    vi.mocked(fetchReputationEvents).mockResolvedValue([
      { topics: [EVENTS.SOCIAL, 'TEST'], data: 7, ledger: 5 },
    ]);

    const rows = await fetchLeaderboard({ net });
    expect(vi.mocked(fetchReputationEvents)).toHaveBeenCalledWith({ net, maxAgeMs: 0 });
    expect(rows.map((r) => r.address)).toEqual(['TEST']);
    expect(JSON.parse(localStorage.getItem('alvinmunk.leaderboard.snapshot.testnet')!)).toEqual([
      { address: 'TEST', total: 7, ledger: 5 },
    ]);
    // The deployment's snapshot is untouched.
    expect(JSON.parse(localStorage.getItem('alvinmunk.leaderboard.snapshot')!)).toEqual([
      { address: 'MAIN', total: 99, ledger: 1 },
    ]);
  });
});
