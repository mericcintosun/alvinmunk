import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Wallet } from './wallet';

const readContractMock = vi.fn();
const invokeAndWaitHashMock = vi.fn();

vi.mock('./contracts', () => ({
  readContract: (...a: unknown[]) => readContractMock(...a),
  invokeAndWait: vi.fn(),
  invokeAndWaitHash: (...a: unknown[]) => invokeAndWaitHashMock(...a),
  rewardsId: () => 'CREWARDS',
  args: { u32: (n: number) => ({ __u32: n }), addr: (a: string) => ({ __addr: a }) },
}));

import { getRewardMinStreak, setRewardMinStreak } from './rewards';

describe('streak-gated rewards client', () => {
  beforeEach(() => {
    readContractMock.mockReset();
    invokeAndWaitHashMock.mockReset();
  });

  it('reads get_reward_min_streak for the reward id', async () => {
    readContractMock.mockResolvedValueOnce(4);
    await expect(getRewardMinStreak(1, 'GSOURCE')).resolves.toBe(4);
    expect(readContractMock).toHaveBeenCalledWith('CREWARDS', 'get_reward_min_streak', [{ __u32: 1 }], 'GSOURCE');
  });

  it('treats a missing result as 0 (no streak required)', async () => {
    readContractMock.mockResolvedValueOnce(null);
    await expect(getRewardMinStreak(1, 'GSOURCE')).resolves.toBe(0);
  });

  it('sets the minimum with set_reward_min_streak and resolves the tx hash', async () => {
    invokeAndWaitHashMock.mockResolvedValueOnce('abc123');
    const wallet = { address: 'GADMIN' } as unknown as Wallet;
    await expect(setRewardMinStreak(wallet, 1, 4)).resolves.toBe('abc123');
    expect(invokeAndWaitHashMock).toHaveBeenCalledWith(
      'CREWARDS',
      'set_reward_min_streak',
      [{ __u32: 1 }, { __u32: 4 }],
      wallet,
    );
  });
});
