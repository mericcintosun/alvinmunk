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
vi.mock('@/lib/registry', () => ({ reverseHandles: async () => ({}) }));
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

    expect(container.textContent).toContain('Sync Failed');
    expect(container.textContent).toContain('The network is currently unavailable.');
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
    expect(container.textContent).toContain('Sync Failed');
  });
});
