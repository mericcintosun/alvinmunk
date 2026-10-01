import { describe, it, expect, vi, beforeEach } from 'vitest';

const readContractMock = vi.fn();

vi.mock('./contracts', () => ({
  readContract: (...a: unknown[]) => readContractMock(...a),
  invokeAndWait: vi.fn(),
  rewardsId: () => 'CREWARDS',
  args: { u32: (n: number) => ({ __u32: n }), addr: (a: string) => ({ __addr: a }) },
}));

import { getRewardsFor } from './rewards';

const row = (id: number, over: { active?: boolean; claimed?: boolean; reason?: number } = {}) => ({
  entry: {
    id,
    threshold: 30n,
    amount: 5_000_000n,
    active: over.active ?? true,
    max_claims: 0,
    claims: 0,
    min_streak: 0,
  },
  claimed: over.claimed ?? false,
  eligible: (over.reason ?? 0) === 0,
  reason: over.reason ?? 0,
});

describe('getRewardsFor', () => {
  beforeEach(() => readContractMock.mockReset());

  it('reads the whole table for the wallet in one get_rewards_for simulation', async () => {
    readContractMock.mockResolvedValueOnce([[row(1), row(2, { claimed: true, reason: 4 })], 3_000_000n]);
    const res = await getRewardsFor('GWHO', 'GSOURCE');
    expect(readContractMock).toHaveBeenCalledTimes(1);
    expect(readContractMock).toHaveBeenCalledWith('CREWARDS', 'get_rewards_for', [{ __addr: 'GWHO' }], 'GSOURCE');
    expect(res.rows).toEqual([row(1), row(2, { claimed: true, reason: 4 })]);
    expect(res.remainingToday).toBe(3_000_000n);
  });

  it('keeps only active rows, like the player table always did', async () => {
    readContractMock.mockResolvedValueOnce([[row(1, { active: false, reason: 7 }), row(2)], -1n]);
    const res = await getRewardsFor('GWHO', 'GSOURCE');
    expect(res.rows.map((r) => r.entry.id)).toEqual([2]);
  });

  it('reads -1 as no daily cap and 0 as a spent budget', async () => {
    readContractMock.mockResolvedValueOnce([[], -1n]);
    expect((await getRewardsFor('GWHO', 'GSOURCE')).remainingToday).toBeNull();
    readContractMock.mockResolvedValueOnce([[row(1, { reason: 9 })], 0n]);
    expect((await getRewardsFor('GWHO', 'GSOURCE')).remainingToday).toBe(0n);
  });

  it('treats a missing result as an empty, uncapped table', async () => {
    readContractMock.mockResolvedValueOnce(undefined);
    await expect(getRewardsFor('GWHO', 'GSOURCE')).resolves.toEqual({ rows: [], remainingToday: null });
  });

  it('lets an RPC failure reach the caller instead of guessing a state', async () => {
    readContractMock.mockRejectedValueOnce(new Error('simulate get_rewards_for failed'));
    await expect(getRewardsFor('GWHO', 'GSOURCE')).rejects.toThrow('get_rewards_for');
  });
});
