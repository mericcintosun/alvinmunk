import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as { React?: typeof React }).React = React;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { fetchLeaderboardMock } = vi.hoisted(() => ({
  fetchLeaderboardMock: vi.fn(),
}));

vi.mock('@/lib/leaderboard', () => ({
  fetchLeaderboard: fetchLeaderboardMock,
}));
vi.mock('@/lib/profile', () => ({ loadProfile: () => null }));
vi.mock('@/lib/registry', () => ({
  // Matches the real contract: every requested address gets an entry (null if unresolved),
  // so the "missing handles" effect settles instead of re-firing forever.
  reverseHandles: async (addrs: string[]) => Object.fromEntries(addrs.map((a) => [a, null])),
}));
vi.mock('@/lib/i18n', () => ({ useTranslations: () => (k: string) => k }));

// Fix for default exports
import LeaderboardPage from './page';

describe('LeaderboardPage', () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    fetchLeaderboardMock.mockReset();
    vi.useFakeTimers();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  it('shows error state when fetch fails on first load with no snapshot', async () => {
    fetchLeaderboardMock.mockRejectedValue(new Error('rpc error'));

    await act(async () => {
      root.render(<LeaderboardPage />);
      // wait for initial mount effect
      await Promise.resolve();
    });

    expect(container.textContent).toContain('leaderboard.syncFailed');
    expect(container.textContent).toContain('leaderboard.syncFailedBody');
    expect(container.textContent).not.toContain('leaderboard.empty');
  });

  it('shows stale badge and empty state when snapshot is empty but later fetch fails', async () => {
    // first load succeeds with []
    fetchLeaderboardMock.mockResolvedValueOnce([]);

    await act(async () => {
      root.render(<LeaderboardPage />);
      await Promise.resolve();
    });

    expect(container.textContent).toContain('leaderboard.live');
    expect(container.textContent).toContain('leaderboard.empty');

    // next poll fails
    fetchLeaderboardMock.mockRejectedValueOnce(new Error('rpc error'));

    await act(async () => {
      vi.advanceTimersByTime(5000);
      await Promise.resolve();
    });

    // since rows is still empty and it's stale, it will transition to Sync Failed instead of showing "stale" badge on empty board
    expect(container.textContent).toContain('leaderboard.syncFailed');
  });

  it('does not confuse a genuinely empty-but-healthy result with an outage', async () => {
    // The RPC is healthy and simply has nothing to report — fetchLeaderboard resolves
    // (no throw) with an empty list, same as a real "no events yet" network.
    fetchLeaderboardMock.mockResolvedValue([]);

    await act(async () => {
      root.render(<LeaderboardPage />);
      await Promise.resolve();
    });

    expect(container.textContent).toContain('leaderboard.live');
    expect(container.textContent).toContain('leaderboard.empty');
    expect(container.textContent).not.toContain('leaderboard.syncFailed');
    expect(container.textContent).not.toContain('leaderboard.syncDelayed');
  });

  it('keeps showing the last good rows with a stale badge when a later poll fails', async () => {
    const rows = [{ address: 'A', score: 10, rank: 1, flagged: false }];
    fetchLeaderboardMock.mockResolvedValueOnce(rows);

    await act(async () => {
      root.render(<LeaderboardPage />);
      await Promise.resolve();
    });

    expect(container.textContent).toContain('leaderboard.live');

    fetchLeaderboardMock.mockRejectedValueOnce(new Error('rpc error'));

    await act(async () => {
      vi.advanceTimersByTime(5000);
      await Promise.resolve();
    });

    // Rows stay on screen (never cleared on a failed poll); the badge switches to "delayed",
    // not the harder "Sync Failed" empty-state — those are two different outage severities.
    expect(container.textContent).toContain('leaderboard.syncDelayed');
    expect(container.textContent).not.toContain('leaderboard.syncFailed');
    expect(container.textContent).not.toContain('leaderboard.empty');
  });
});
