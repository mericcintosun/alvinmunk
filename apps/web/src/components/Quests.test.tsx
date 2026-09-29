import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  completeQuestMock,
  getCompletedMock,
  getEarnedScoreMock,
  getStreakMock,
  getWalletMock,
  toastMock,
} = vi.hoisted(() => ({
  completeQuestMock: vi.fn(),
  getCompletedMock: vi.fn(),
  getEarnedScoreMock: vi.fn(),
  getStreakMock: vi.fn(),
  getWalletMock: vi.fn(),
  toastMock: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('@/lib/wallet', () => ({ getWallet: getWalletMock }));
vi.mock('@/lib/quests', () => ({
  completeQuest: completeQuestMock,
  getCompleted: getCompletedMock,
  getStreak: getStreakMock,
}));
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
const FRIEND = 'GARCEIRCEIRCEIRCEIRCEIRCEIRCEIRCEIRCEIRCEIRCEIRCEIRCFRVX'; // a valid G… address

describe('Quests', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    completeQuestMock.mockReset().mockResolvedValue({ ok: true });
    // No completion state unless a test sets one (as on a contract without get_completed).
    getCompletedMock.mockReset().mockResolvedValue(null);
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

  // The three quest buttons, in page order: refer, invite, vouch-back.
  const buttons = () => [...container.querySelectorAll('button')];
  const vouchBackButton = () => buttons()[2];

  /** Type `value` into an input the way a user does, so React sees the change. */
  async function typeInto(selector: string, value: string) {
    const input = container.querySelector(selector) as HTMLInputElement;
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    await act(async () => {
      setValue.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }

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
    // A referral target, so the refer button is enabled exactly when no quest is busy.
    await typeInto('#quest-ref', FRIEND);
    expect(buttons()[0].disabled).toBe(false);

    await clickVouchBack();

    expectReportedSuccess();
    // The finished quest now reads as completed; the others are free again.
    expect(vouchBackButton().textContent).toBe('Completed');
    expect(buttons()[0].textContent).toBe('Verify a quest');
    expect(buttons()[0].disabled).toBe(false);
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

  // ── completion state (issue #156) ──────────────────────────────────────────

  // The dashboard's quest ids (lib/attest.ts DEFAULT_QUEST_IDS): refer, invite-converts, vouch-back.
  const [REFER, INVITE, VOUCHBACK] = [2, 3, 4];

  it('shows the quests the wallet already completed as done on load', async () => {
    getCompletedMock.mockResolvedValue(
      new Map([
        [REFER, true],
        [INVITE, false],
        [VOUCHBACK, true],
      ]),
    );
    await mount();

    expect(getCompletedMock).toHaveBeenCalledWith(ADDRESS, [REFER, INVITE, VOUCHBACK], ADDRESS);
    const [refer, invite, vouchback] = buttons();
    expect(refer.textContent).toBe('Completed');
    expect(refer.disabled).toBe(true);
    expect(invite.textContent).toBe('Claim invite reward');
    expect(vouchback.textContent).toBe('Completed');
    expect(vouchback.disabled).toBe(true);
  });

  it('leaves every quest available when the view is missing or the read fails', async () => {
    await mount(); // getCompleted resolves null
    const [refer, invite, vouchback] = buttons();
    expect(refer.textContent).toBe('Verify a quest');
    expect(invite.textContent).toBe('Claim invite reward');
    expect(vouchback.textContent).toBe('Claim vouch-back (3+ vouches)');
    expect(vouchback.disabled).toBe(false);
  });

  it('marks a quest done when a retry finds it already completed', async () => {
    completeQuestMock.mockResolvedValueOnce({
      ok: false,
      error: 'You’ve already completed this quest.',
      completed: true,
    });
    await mount();

    await clickVouchBack();

    expect(completeQuestMock).toHaveBeenCalledWith(
      { kind: 'dev', address: ADDRESS },
      VOUCHBACK,
      { type: 'vouch_back', ref: '' },
    );
    expect(vouchBackButton().textContent).toBe('Completed');
    expect(vouchBackButton().disabled).toBe(true);
    expect(container.textContent).toContain('You’ve already completed this quest.');
    expect(container.textContent).not.toContain(SUCCESS_ART);
  });

  it('keeps a quest available after a failure that is not a completion', async () => {
    completeQuestMock.mockResolvedValueOnce({ ok: false, error: 'Vouch for 3 people first' });
    await mount();

    await clickVouchBack();

    expect(vouchBackButton().textContent).toBe('Claim vouch-back (3+ vouches)');
    expect(vouchBackButton().disabled).toBe(false);
  });
});
