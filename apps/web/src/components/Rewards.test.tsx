import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RewardEntry } from '@/lib/rewards';

const { getEarnedScoreMock, getRewardsMock, isClaimedMock, getStreakMock, claimRewardMock } = vi.hoisted(
  () => ({
    getEarnedScoreMock: vi.fn(),
    getRewardsMock: vi.fn(),
    isClaimedMock: vi.fn(),
    getStreakMock: vi.fn(),
    claimRewardMock: vi.fn(),
  }),
);

vi.mock('@/lib/reputation', () => ({ getEarnedScore: getEarnedScoreMock }));
vi.mock('@/lib/quests', () => ({ getStreak: getStreakMock }));
vi.mock('@/lib/rewards', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/rewards')>()),
  getRewards: getRewardsMock,
  isClaimed: isClaimedMock,
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

describe('Rewards', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    getEarnedScoreMock.mockResolvedValue(50);
    isClaimedMock.mockResolvedValue(false);
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
    getRewardsMock.mockResolvedValue([
      reward(1, { min_streak: 4 }),
      reward(2, { min_streak: 2 }),
      reward(3), // contract deployed before streak gates: no min_streak field
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
    getRewardsMock.mockResolvedValue([reward(1, { min_streak: 1 })]);
    await render();
    expect(button(items()[0]).textContent).toBe('Locked');
  });

  it('reads a failed streak lookup as no streak: gated rewards stay locked, others don’t', async () => {
    getStreakMock.mockRejectedValue(new Error('rpc down'));
    getRewardsMock.mockResolvedValue([reward(1, { min_streak: 1 }), reward(2)]);
    await render();
    const [gated, plain] = items();
    expect(gated.textContent).toContain('needs a 1-week streak (you: 0)');
    expect(button(gated).textContent).toBe('Locked');
    expect(button(plain).textContent).toBe('Claim');
  });

  it('explains a StreakTooShort (#18) revert from claim_reward', async () => {
    getRewardsMock.mockResolvedValue([reward(1, { min_streak: 2 })]);
    claimRewardMock.mockRejectedValue(new Error('HostError: Error(Contract, #18)'));
    await render();
    await act(async () => {
      button(items()[0]).click();
    });
    expect(container.textContent).toContain('This reward needs a longer weekly quest streak');
  });
});
