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
vi.mock('@/components/fx/number-ticker', () => ({ NumberTicker: ({ value }: { value: number }) => value }));
vi.mock('@/components/ui/state-art', () => ({ StateArt: () => null }));
vi.mock('@/components/ui/sticker', () => ({ Sticker: () => null }));
vi.mock('@/components/Avatar', () => ({ Avatar: () => null }));
vi.mock('@/components/WeekReset', () => ({ WeekReset: () => null }));

import { Quests } from './Quests';

(globalThis as { React?: typeof React }).React = React;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ADDRESS = `G${'A'.repeat(55)}`;

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

  async function clickVouchBack() {
    const button = [...container.querySelectorAll('button')].find((item) =>
      item.textContent?.startsWith('Claim vouch-back'),
    )!;
    await act(async () => {
      button.click();
      for (let i = 0; i < 5; i++) await Promise.resolve();
    });
  }

  it('keeps a successful quest successful when the earned score refresh rejects', async () => {
    getEarnedScoreMock.mockReset().mockResolvedValueOnce(12).mockRejectedValueOnce(new Error('score timeout'));
    await mount();

    await clickVouchBack();

    expect(completeQuestMock).toHaveBeenCalledOnce();
    expect(toastMock.success).toHaveBeenCalledOnce();
    expect(toastMock.error).not.toHaveBeenCalled();
    expect(container.textContent).toContain('verified on-chain → Earned XP added');
    expect(container.textContent).not.toContain('score timeout');
  });

  it('still reports a failed quest', async () => {
    completeQuestMock.mockRejectedValueOnce(new Error('attester rejected'));
    await mount();

    await clickVouchBack();

    expect(toastMock.success).not.toHaveBeenCalled();
    expect(toastMock.error).toHaveBeenCalledOnce();
    expect(container.textContent).toContain('attester rejected');
  });
});