import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { completeQuestMock, getEarnedScoreMock, getStreakMock, getWalletMock, toastMock } = vi.hoisted(() => ({
  completeQuestMock: vi.fn(),
  getEarnedScoreMock: vi.fn(),
  getStreakMock: vi.fn(),
  getWalletMock: vi.fn(),
  toastMock: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('@/lib/wallet', () => ({ getWallet: getWalletMock }));
vi.mock('@/lib/quests', () => ({ completeQuest: completeQuestMock, getStreak: getStreakMock }));
vi.mock('@/lib/reputation', () => ({ getEarnedScore: getEarnedScoreMock }));
vi.mock('@/lib/registry', () => ({ resolveHandle: vi.fn() }));
vi.mock('@/components/ui/toaster', () => ({ toast: toastMock }));
vi.mock('@/components/fx/frame', () => ({
  Frame: ({ children }: { children: React.ReactNode }) => children,
}));
// The count-up animation needs IntersectionObserver; the figure itself is what matters here.
vi.mock('@/components/fx/number-ticker', () => ({
  NumberTicker: ({ value }: { value: number }) => <span>{value}</span>,
}));
vi.mock('@/components/ui/state-art', () => ({ StateArt: () => null }));
vi.mock('@/components/ui/sticker', () => ({ Sticker: () => null }));
vi.mock('@/components/Avatar', () => ({ Avatar: () => null }));
vi.mock('@/components/WeekReset', () => ({ WeekReset: () => null }));

import { Quests } from './Quests';

// This vitest setup compiles JSX to `React.createElement`; give the component a global React.
(globalThis as { React?: typeof React }).React = React;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ADDRESS = `G${'A'.repeat(55)}`;
const SUCCESS_ART = 'verified on-chain → Earned XP added';

describe('Quests', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    completeQuestMock.mockReset().mockResolvedValue({ ok: true });
    getEarnedScoreMock.mockReset().mockResolvedValue(12);
    getStreakMock.mockReset().mockResolvedValue({ weeks: 1, best: 2, lastWeek: 0 });
    getWalletMock.mockReset().mockResolvedValue({ kind: 'dev', address: ADDRESS });
    toastMock.success.mockReset();
    toastMock.error.mockReset();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.clearAllMocks();
  });

  async function mount() {
    await act(async () => root.render(<Quests address={ADDRESS} />));
  }

  const vouchBackButton = () =>
    [...container.querySelectorAll('button')].find(
      (item) => item.textContent?.startsWith('Claim vouch-back') || item.textContent === 'Verifying…',
    )!;

  const earnedBadge = () =>
    [...container.querySelectorAll('span')].find((s) => s.textContent?.startsWith('Earned XP:'))?.textContent;

  async function clickVouchBack() {
    await act(async () => {
      vouchBackButton().click();
      for (let i = 0; i < 5; i++) await Promise.resolve();
    });
  }

  function expectReportedSuccess() {
    expect(completeQuestMock).toHaveBeenCalledOnce();
    expect(toastMock.success).toHaveBeenCalledOnce();
    expect(toastMock.error).not.toHaveBeenCalled();
    expect(container.textContent).toContain(SUCCESS_ART);
    expect(container.querySelector('p.text-destructive')).toBeNull();
  }

  it('re-reads the Earned XP and streak after a verified quest', async () => {
    getEarnedScoreMock.mockResolvedValueOnce(12).mockResolvedValueOnce(17);
    await mount();
    expect(earnedBadge()).toBe('Earned XP: 12');

    await clickVouchBack();

    expectReportedSuccess();
    expect(getEarnedScoreMock).toHaveBeenCalledTimes(2);
    expect(getStreakMock).toHaveBeenCalledTimes(2);
    expect(earnedBadge()).toBe('Earned XP: 17');
  });

  it('keeps a successful quest successful when the earned score refresh rejects', async () => {
    getEarnedScoreMock.mockResolvedValueOnce(12).mockRejectedValueOnce(new Error('score timeout'));
    await mount();

    await clickVouchBack();

    expectReportedSuccess();
    expect(container.textContent).not.toContain('score timeout');
    // The failed read keeps the last known figure rather than blanking the badge.
    expect(earnedBadge()).toBe('Earned XP: 12');
  });

  it('keeps a successful quest successful when the streak refresh rejects', async () => {
    getStreakMock
      .mockResolvedValueOnce({ weeks: 1, best: 2, lastWeek: 0 })
      .mockRejectedValueOnce(new Error('streak read failed'));
    await mount();

    await clickVouchBack();

    expectReportedSuccess();
    expect(container.textContent).not.toContain('streak read failed');
  });

  it('does not hold the quest buttons while a refresh read hangs', async () => {
    getEarnedScoreMock.mockResolvedValueOnce(12).mockReturnValueOnce(new Promise(() => {}));
    getStreakMock.mockResolvedValueOnce({ weeks: 1, best: 2, lastWeek: 0 }).mockReturnValueOnce(new Promise(() => {}));
    await mount();

    await clickVouchBack();

    expectReportedSuccess();
    expect(vouchBackButton().textContent).toMatch(/^Claim vouch-back/);
    expect(vouchBackButton().disabled).toBe(false);
  });

  it('still reports a failed quest', async () => {
    completeQuestMock.mockRejectedValueOnce(new Error('attester rejected'));
    await mount();

    await clickVouchBack();

    expect(toastMock.success).not.toHaveBeenCalled();
    expect(toastMock.error).toHaveBeenCalledOnce();
    expect(container.textContent).toContain('attester rejected');
    expect(container.textContent).not.toContain(SUCCESS_ART);
    expect(getEarnedScoreMock).toHaveBeenCalledOnce();
  });

  it('still reports a quest the attester declines', async () => {
    completeQuestMock.mockResolvedValueOnce({ ok: false, error: 'Vouch for 3 people first' });
    await mount();

    await clickVouchBack();

    expect(toastMock.success).not.toHaveBeenCalled();
    expect(toastMock.error).toHaveBeenCalledWith('Vouch for 3 people first');
    expect(container.querySelector('p.text-destructive')?.textContent).toBe('Vouch for 3 people first');
    expect(container.textContent).not.toContain(SUCCESS_ART);
  });
});
