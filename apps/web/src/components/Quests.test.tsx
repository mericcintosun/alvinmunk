import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { getCompletedMock, completeQuestMock, getStreakMock, getEarnedScoreMock, getWalletMock } =
  vi.hoisted(() => ({
    getCompletedMock: vi.fn(),
    completeQuestMock: vi.fn(),
    getStreakMock: vi.fn(),
    getEarnedScoreMock: vi.fn(),
    getWalletMock: vi.fn(),
  }));

vi.mock('@/lib/quests', () => ({
  getCompleted: getCompletedMock,
  completeQuest: completeQuestMock,
  getStreak: getStreakMock,
}));
vi.mock('@/lib/reputation', () => ({ getEarnedScore: getEarnedScoreMock }));
vi.mock('@/lib/registry', () => ({ resolveHandle: vi.fn(async () => null) }));
vi.mock('@/lib/wallet', () => ({ getWallet: getWalletMock }));
vi.mock('@/components/ui/toaster', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/components/WeekReset', () => ({ WeekReset: () => null }));
// The count-up animation needs IntersectionObserver; the figure itself is what matters here.
vi.mock('@/components/fx/number-ticker', () => ({
  NumberTicker: ({ value }: { value: number }) => <span>{value}</span>,
}));

import { Quests } from './Quests';

// This vitest setup compiles JSX to `React.createElement`; give the component a global React.
(globalThis as { React?: typeof React }).React = React;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ME = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
// The dashboard's quest ids (lib/attest.ts DEFAULT_QUEST_IDS): refer, invite-converts, vouch-back.
const [REFER, INVITE, VOUCHBACK] = [2, 3, 4];

describe('Quests completion state (issue #156)', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    getEarnedScoreMock.mockResolvedValue(0);
    getStreakMock.mockResolvedValue({ weeks: 0, best: 0, lastWeek: 0 });
    getWalletMock.mockResolvedValue({ address: ME });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.clearAllMocks();
  });

  async function render() {
    await act(async () => {
      root.render(<Quests address={ME} />);
    });
  }

  // The three quest buttons, in page order: refer, invite, vouch-back.
  const buttons = () => [...container.querySelectorAll('button')];

  it('shows the quests the wallet already completed as done on load', async () => {
    getCompletedMock.mockResolvedValue(
      new Map([
        [REFER, true],
        [INVITE, false],
        [VOUCHBACK, true],
      ]),
    );
    await render();

    expect(getCompletedMock).toHaveBeenCalledWith(ME, [REFER, INVITE, VOUCHBACK], ME);
    const [refer, invite, vouchback] = buttons();
    expect(refer.textContent).toBe('Completed');
    expect(refer.disabled).toBe(true);
    expect(invite.textContent).toBe('Claim invite reward');
    expect(vouchback.textContent).toBe('Completed');
    expect(vouchback.disabled).toBe(true);
  });

  it('leaves every quest available when the view is missing or the read fails', async () => {
    getCompletedMock.mockResolvedValue(null);
    await render();
    const [refer, invite, vouchback] = buttons();
    expect(refer.textContent).toBe('Verify a quest');
    expect(invite.textContent).toBe('Claim invite reward');
    expect(vouchback.textContent).toBe('Claim vouch-back (3+ vouches)');
    expect(vouchback.disabled).toBe(false);
  });

  it('marks a quest done when a retry finds it already completed', async () => {
    getCompletedMock.mockResolvedValue(null);
    completeQuestMock.mockResolvedValue({
      ok: false,
      error: 'You’ve already completed this quest.',
      completed: true,
    });
    await render();
    await act(async () => {
      buttons()[2].click();
    });
    expect(completeQuestMock).toHaveBeenCalledWith({ address: ME }, VOUCHBACK, {
      type: 'vouch_back',
      ref: '',
    });
    expect(buttons()[2].textContent).toBe('Completed');
    expect(buttons()[2].disabled).toBe(true);
    expect(container.textContent).toContain('You’ve already completed this quest.');
  });

  it('keeps a quest available after a failure that is not a completion', async () => {
    getCompletedMock.mockResolvedValue(null);
    completeQuestMock.mockResolvedValue({ ok: false, error: 'vouch for 3 people first' });
    await render();
    await act(async () => {
      buttons()[2].click();
    });
    expect(buttons()[2].textContent).toBe('Claim vouch-back (3+ vouches)');
    expect(buttons()[2].disabled).toBe(false);
  });
});
