import { beforeEach, describe, expect, it, vi } from 'vitest';

const { repEvents, tipEvents } = vi.hoisted(() => ({
  repEvents: vi.fn(),
  tipEvents: vi.fn(),
}));
vi.mock('./events', () => ({ fetchReputationEvents: repEvents, fetchTipEvents: tipEvents }));

import { fetchActivity } from './feed';

const claimed = (ledger: number, from: string, to: string) => ({
  topics: ['vouch', 'claimed'],
  data: [1, from, to],
  ledger,
});
const tipped = (ledger: number, from: string, to: string, amount: unknown) => ({
  topics: ['tipped', from, to],
  data: amount,
  ledger,
});

describe('fetchActivity', () => {
  beforeEach(() => {
    repEvents.mockReset().mockResolvedValue([]);
    tipEvents.mockReset().mockResolvedValue([]);
  });

  it('merges vouches and tips by ledger, newest first', async () => {
    repEvents.mockResolvedValue([claimed(10, 'A', 'B'), claimed(30, 'C', 'D')]);
    tipEvents.mockResolvedValue([tipped(20, 'B', 'C', 5_000_000n), tipped(40, 'D', 'A', 1_000_000n)]);

    expect(await fetchActivity()).toEqual([
      { kind: 'tip', from: 'D', to: 'A', ledger: 40, amount: 1_000_000n },
      { kind: 'vouch', from: 'C', to: 'D', ledger: 30 },
      { kind: 'tip', from: 'B', to: 'C', ledger: 20, amount: 5_000_000n },
      { kind: 'vouch', from: 'A', to: 'B', ledger: 10 },
    ]);
  });

  it('applies the cap to the merged stream, not to each stream', async () => {
    repEvents.mockResolvedValue([claimed(1, 'A', 'B'), claimed(2, 'A', 'B'), claimed(3, 'A', 'B')]);
    tipEvents.mockResolvedValue([tipped(4, 'B', 'A', 1n), tipped(5, 'B', 'A', 1n)]);

    const items = await fetchActivity(3);
    expect(items.map((i) => i.ledger)).toEqual([5, 4, 3]);
  });

  it('skips other reputation events and malformed tips', async () => {
    repEvents.mockResolvedValue([{ topics: ['vouch', 'minted'], data: [1, 'A', 'B'], ledger: 5 }]);
    tipEvents.mockResolvedValue([tipped(6, 'A', 'B', 'not-an-amount'), tipped(7, 'A', 'B', 3)]);

    expect(await fetchActivity()).toEqual([{ kind: 'tip', from: 'A', to: 'B', ledger: 7, amount: 3n }]);
  });
});
