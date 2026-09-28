import { describe, it, expect, vi, beforeEach } from 'vitest';

const readContractMock = vi.fn();

vi.mock('./contracts', () => ({
  readContract: (...a: unknown[]) => readContractMock(...a),
  invokeAndWait: vi.fn(),
  rewardsId: () => 'CREWARDS',
  args: { u32: (n: number) => ({ __u32: n }), addr: (a: string) => ({ __addr: a }) },
}));

import { getRewardStats } from './rewards';

describe('getRewardStats', () => {
  beforeEach(() => readContractMock.mockReset());

  it('reads get_reward_stats for the reward id', async () => {
    readContractMock.mockResolvedValueOnce({ claims: 3, max_claims: 50 });
    await expect(getRewardStats(7, 'GSOURCE')).resolves.toEqual({ claims: 3, max_claims: 50 });
    expect(readContractMock).toHaveBeenCalledWith('CREWARDS', 'get_reward_stats', [{ __u32: 7 }], 'GSOURCE');
  });

  it('treats a missing result as an uncapped reward with no claims', async () => {
    readContractMock.mockResolvedValueOnce(null);
    await expect(getRewardStats(7, 'GSOURCE')).resolves.toEqual({ claims: 0, max_claims: 0 });
  });
});
