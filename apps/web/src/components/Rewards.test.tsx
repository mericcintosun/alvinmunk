import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RewardEntry, RewardStatus } from '@/lib/rewards';

const { getEarnedScoreMock, getRewardsForMock, getStreakMock, claimRewardMock } = vi.hoisted(() => ({
  getEarnedScoreMock: vi.fn(),
  getRewardsForMock: vi.fn(),
  getStreakMock: vi.fn(),
  claimRewardMock: vi.fn(),
}));

vi.mock('@/lib/reputation', () => ({ getEarnedScore: getEarnedScoreMock }));
vi.mock('@/lib/quests', () => ({ getStreak: getStreakMock }));
vi.mock('@/lib/rewards', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/rewards')>()),
  getRewardsFor: getRewardsForMock,
  claimReward: claimRewardMock,
  getUsdcBalance: vi.fn(),
}));
vi.mock('@/lib/wallet', () => ({ getWallet: vi.fn() }));
vi.mock('@/lib/anchor', () => ({ getAnchorConfig: () => null }));
vi.mock('@/components/ui/toaster', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
// The count-up animation needs IntersectionObserver; the figure itself is what matters here.
vi.mock('@/components/fx/number-ticker', () => ({
  NumberTicker: ({ value }: { value: number }) => <span>{value}</span>,
}));

import { Rewards } from './Rewards';

// This vitest setup compiles JSX to `React.createElement`; give the component a global React.
(globalThis as { React?: typeof React }).React = React;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ME = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';

const reward = (id: number, extra: Partial<RewardEntry> = {}): RewardEntry => ({
  id,
  threshold: 30n,
  amount: 5_000_000n,
  active: true,
  max_claims: 0,
  claims: 0,
  ...extra,
});

/** A `get_rewards_for` row; `reason` is the claim_reward error code (0 = claimable). */
const status = (entry: RewardEntry, reason = 0, claimed = false): RewardStatus => ({
  entry,
  claimed,
  eligible: reason === 0,
  reason,
});

const table = (rows: RewardStatus[], remainingToday: bigint | null = null) =>
  getRewardsForMock.mockResolvedValue({ rows, remainingToday });

describe('Rewards', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    getEarnedScoreMock.mockResolvedValue(50);
    getStreakMock.mockResolvedValue({ weeks: 2, best: 3, lastWeek: 100 });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.clearAllMocks();
  });

  async function render() {
    await act(async () => {
      root.render(<Rewards address={ME} />);
    });
  }

  const items = () => [...container.querySelectorAll('li')];
  const button = (li: Element) => li.querySelector('button')!;

  it('shows a streak requirement with the wallet’s live streak and locks it until met', async () => {
    table([
      status(reward(1, { min_streak: 4 }), 18),
      status(reward(2, { min_streak: 2 })),
      status(reward(3)), // contract deployed before streak gates: no min_streak field
    ]);
    await render();

    expect(getStreakMock).toHaveBeenCalledWith(ME, ME);
    const [gated, met, plain] = items();
    expect(gated.textContent).toContain('needs a 4-week streak (you: 2)');
    expect(button(gated).textContent).toBe('Locked');
    expect(button(gated).disabled).toBe(true);

    expect(met.textContent).toContain('needs a 2-week streak (you: 2)');
    expect(button(met).textContent).toBe('Claim');
    expect(button(met).disabled).toBe(false);

    expect(plain.textContent).not.toContain('streak');
    expect(button(plain).textContent).toBe('Claim');
  });

  it('still needs the Earned XP threshold when the streak is met', async () => {
    getEarnedScoreMock.mockResolvedValue(10);
    table([status(reward(1, { min_streak: 1 }), 3)]);
    await render();
    expect(button(items()[0]).textContent).toBe('Locked');
  });

  it('reads a failed streak lookup as no streak: gated rewards stay locked, others don’t', async () => {
    getStreakMock.mockRejectedValue(new Error('rpc down'));
    table([status(reward(1, { min_streak: 1 }), 18), status(reward(2))]);
    await render();
    const [gated, plain] = items();
    expect(gated.textContent).toContain('needs a 1-week streak (you: 0)');
    expect(button(gated).textContent).toBe('Locked');
    expect(button(plain).textContent).toBe('Claim');
  });

  it('explains a StreakTooShort (#18) revert from claim_reward', async () => {
    table([status(reward(1, { min_streak: 2 }))]);
    claimRewardMock.mockRejectedValue(new Error('HostError: Error(Contract, #18)'));
    await render();
    await act(async () => {
      button(items()[0]).click();
    });
    expect(container.textContent).toContain('This reward needs a longer weekly quest streak');
  });

  it('renders the whole table from one get_rewards_for call', async () => {
    table([status(reward(1)), status(reward(2), 4, true)]);
    await render();
    expect(getRewardsForMock).toHaveBeenCalledTimes(1);
    expect(getRewardsForMock).toHaveBeenCalledWith(ME, ME);
    const [open, done] = items();
    expect(button(open).textContent).toBe('Claim');
    expect(button(done).textContent).toBe('Claimed');
    expect(button(done).disabled).toBe(true);
  });

  it('takes eligibility from the contract, not from the Earned XP badge', async () => {
    getEarnedScoreMock.mockResolvedValue(500); // clears every threshold on its face
    table([status(reward(1), 3)]); // …but the ledger says it doesn't
    await render();
    expect(button(items()[0]).textContent).toBe('Locked');
    expect(button(items()[0]).disabled).toBe(true);
  });

  it('says once why a wallet-wide block stops every row', async () => {
    table([status(reward(1), 10), status(reward(2), 10)]);
    await render();
    const notice = "This account is under review and can't claim right now.";
    expect(container.textContent?.split(notice).length).toBe(2);
    expect(items().map((li) => button(li).textContent)).toEqual(['Locked', 'Locked']);
  });

  it('shows today’s remaining budget and flags a row it can no longer cover', async () => {
    table([status(reward(1)), status(reward(2, { amount: 40_000_000n }), 9)], 25_000_000n);
    await render();
    expect(container.textContent).toContain("2.5 USDC left in today's reward budget");
    const [fits, over] = items();
    expect(fits.textContent).not.toContain('daily reward limit');
    expect(over.textContent).toContain('The daily reward limit was reached — try again tomorrow.');
    expect(button(over).textContent).toBe('Locked');
  });

  it('shows no budget line when there is no daily cap', async () => {
    table([status(reward(1))], null);
    await render();
    expect(container.textContent).not.toContain('reward budget');
  });

  it('degrades a failed status read to an empty table, never to a claimable row', async () => {
    getRewardsForMock.mockRejectedValue(new Error('rpc down'));
    await render();
    expect(items()).toHaveLength(0);
    expect(container.textContent).toContain('No rewards registered yet.');
  });
});
