import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getScoresMock,
  getPeopleCountsMock,
  fetchActivityMock,
  reverseHandlesMock,
  getPendingVouchesMock,
} = vi.hoisted(() => ({
  getScoresMock: vi.fn(),
  getPeopleCountsMock: vi.fn(),
  fetchActivityMock: vi.fn(),
  reverseHandlesMock: vi.fn(),
  getPendingVouchesMock: vi.fn(),
}));

vi.mock('@/lib/reputation', () => ({ getScores: getScoresMock }));
vi.mock('@/lib/constellation', () => ({ getPeopleCounts: getPeopleCountsMock }));
vi.mock('@/lib/feed', () => ({ fetchActivity: fetchActivityMock }));
vi.mock('@/lib/registry', () => ({ reverseHandles: reverseHandlesMock }));
vi.mock('@/lib/myvouches', () => ({ getPendingVouches: getPendingVouchesMock }));

import { StatStrip } from './stat-strip';
import { ActivityFeed } from '../ActivityFeed';
import { PendingHalfCards } from '../PendingHalfCards';

describe('first-run UI states', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.clearAllMocks();
  });

  it('shows a friendly zero-state for the stat strip when no reputation exists yet', async () => {
    getScoresMock.mockResolvedValue({ social: 0, earned: 0 });
    getPeopleCountsMock.mockResolvedValue({ vouchedBy: 0, backed: 0 });

    await act(async () => {
      root.render(<StatStrip address="GB123" />);
      await Promise.resolve();
    });

    expect(container.textContent).toContain('Your constellation is still quiet');
  });

  it('keeps the zero-state card and numbers mounted across a 15 s refresh', async () => {
    vi.useFakeTimers();
    try {
      // The first read lands; the refresh stays in flight, which is when a skeleton would show.
      getScoresMock
        .mockResolvedValueOnce({ social: 0, earned: 0 })
        .mockReturnValueOnce(new Promise(() => {}));
      getPeopleCountsMock.mockResolvedValue({ vouchedBy: 0, backed: 0 });

      await act(async () => {
        root.render(<StatStrip address="GB123" />);
        await Promise.resolve();
      });
      expect(container.querySelectorAll('.animate-pulse')).toHaveLength(0);
      expect(container.textContent).toContain('Your constellation is still quiet');
      const card = Array.from(container.querySelectorAll('p')).find(
        (p) => p.textContent === 'Your constellation is still quiet',
      );

      await act(async () => {
        await vi.advanceTimersByTimeAsync(15_000);
      });

      expect(getScoresMock).toHaveBeenCalledTimes(2);
      expect(container.querySelectorAll('.animate-pulse')).toHaveLength(0);
      // Same node, never unmounted and remounted.
      expect(card?.isConnected).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows a friendly empty state for the activity feed before any vouches appear', async () => {
    fetchActivityMock.mockResolvedValue([]);
    reverseHandlesMock.mockResolvedValue({});

    await act(async () => {
      root.render(<ActivityFeed />);
      await Promise.resolve();
    });

    expect(container.textContent).toContain('No activity yet');
  });

  it('shows a friendly empty state for pending half-cards when none are waiting', async () => {
    getPendingVouchesMock.mockResolvedValue([]);

    await act(async () => {
      root.render(<PendingHalfCards />);
      await Promise.resolve();
    });

    expect(container.textContent).toContain('No half-cards waiting');
  });
});
