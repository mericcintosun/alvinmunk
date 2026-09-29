import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as { React?: typeof React }).React = React;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { fetchLeaderboardMock, reverseHandlesMock, store } = vi.hoisted(() => ({
  fetchLeaderboardMock: vi.fn(),
  reverseHandlesMock: vi.fn(),
  store: { me: null as string | null },
}));

vi.mock('@/lib/leaderboard', () => ({
  fetchLeaderboard: fetchLeaderboardMock,
}));
vi.mock('@/lib/profile', () => ({
  loadProfile: () => (store.me ? { address: store.me } : null),
}));
vi.mock('@/lib/registry', () => ({
  reverseHandles: reverseHandlesMock,
}));
// The key, then any vars as name=value, so a test can read what a label was built from.
vi.mock('@/lib/i18n', () => ({
  useTranslations: () => (k: string, vars?: Record<string, string>) =>
    vars ? [k, ...Object.entries(vars).map(([n, v]) => `${n}=${v}`)].join(' ') : k,
}));

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
    reverseHandlesMock.mockReset();
    // Matches the real contract: every requested address gets an entry (null if
    // unresolved), so the "missing handles" effect settles instead of re-firing forever.
    reverseHandlesMock.mockImplementation(async (addrs: string[]) =>
      Object.fromEntries(addrs.map((a) => [a, null])),
    );
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

/**
 * Tests for issue #208: leaderboard handle lookups were cancelled by every 5-second
 * poll because the handle-lookup effect depended on the `rows` array reference rather
 * than the stable set of addresses. The fix depends on `addressKey` (sorted, joined
 * addresses) instead, and tracks in-flight addresses in a ref so a lookup already
 * running is never restarted.
 *
 * By the time this landed, #319 had already replaced the per-address `reverseHandle`
 * loop with one batched `reverseHandles(missing)` call (lib/registry.ts's
 * `reverse_many`), so these tests exercise that batched call rather than a
 * concurrency-limited loop of single-address calls.
 *
 * Acceptance criteria (from the issue):
 *  - With the handle lookup mocked to take 8 s, handles still appear.
 *  - Each address is looked up at most once while a lookup is pending.
 *  - A vitest with fake timers covers the poll/lookup interaction.
 */
describe('LeaderboardPage — poll / handle-lookup interaction (issue #208)', () => {
  let root: Root;
  let container: HTMLDivElement;

  const ADDR_A = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
  const ADDR_B = 'GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';

  function makeRows(addresses: string[]) {
    return addresses.map((address, i) => ({
      rank: i + 1,
      address,
      score: 100 - i * 10,
      flagged: false,
    }));
  }

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    fetchLeaderboardMock.mockReset();
    reverseHandlesMock.mockReset();
    vi.useFakeTimers();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  it('shows @handle for an address even when the lookup takes 8 s', async () => {
    // reverseHandles resolves after 8 s (longer than the 5-s poll interval).
    reverseHandlesMock.mockImplementation(
      (addrs: string[]) =>
        new Promise((resolve) =>
          setTimeout(
            () =>
              resolve(Object.fromEntries(addrs.map((a) => [a, a === ADDR_A ? 'alice' : null]))),
            8_000,
          ),
        ),
    );

    // A NEW array reference on every call, like the real rankLeaderboard — this is
    // what makes the old `[rows, handles]`-keyed effect re-run (and cancel the
    // in-flight lookup) on every poll tick even though nothing changed.
    fetchLeaderboardMock.mockImplementation(async () => makeRows([ADDR_A]));

    await act(async () => {
      root.render(<LeaderboardPage />);
      await Promise.resolve();
    });

    // Advance 5 s — the second poll fires. The handle should NOT have appeared yet
    // because the lookup is still in flight, and it must not have been restarted.
    await act(async () => {
      vi.advanceTimersByTime(5_000);
      await Promise.resolve();
    });
    expect(container.textContent).not.toContain('@alice');

    // Advance 3 more seconds — total 8 s — the batched lookup resolves.
    await act(async () => {
      vi.advanceTimersByTime(3_000);
      await Promise.resolve();
    });

    expect(container.textContent).toContain('@alice');
    expect(reverseHandlesMock).toHaveBeenCalledTimes(1);
  });

  it('looks up each address at most once while a lookup is pending', async () => {
    // Slow lookup — takes longer than two poll intervals.
    reverseHandlesMock.mockImplementation(
      (addrs: string[]) =>
        new Promise((resolve) =>
          setTimeout(
            () => resolve(Object.fromEntries(addrs.map((a) => [a, null]))),
            12_000,
          ),
        ),
    );

    // A new array reference every call, like the real rankLeaderboard.
    fetchLeaderboardMock.mockImplementation(async () => makeRows([ADDR_A, ADDR_B]));

    await act(async () => {
      root.render(<LeaderboardPage />);
      await Promise.resolve();
    });

    // Two more polls fire (each at +5 s and +10 s) while the first batch is pending.
    await act(async () => {
      vi.advanceTimersByTime(10_000);
      await Promise.resolve();
    });

    // Despite 3 polls, the batched lookup should have been made exactly once for
    // both addresses — not once per poll.
    expect(reverseHandlesMock).toHaveBeenCalledTimes(1);
    expect(reverseHandlesMock).toHaveBeenCalledWith([ADDR_A, ADDR_B]);
  });

  it('does not restart lookups when the poll returns identical data', async () => {
    const rows = makeRows([ADDR_A]);
    // Return a *new array* on every tick, but with identical content.
    fetchLeaderboardMock.mockImplementation(async () => [...rows]);
    reverseHandlesMock.mockResolvedValue({ [ADDR_A]: 'alice' });

    await act(async () => {
      root.render(<LeaderboardPage />);
      await Promise.resolve();
    });

    // Three more polls — same content each time.
    await act(async () => {
      vi.advanceTimersByTime(15_000);
      await Promise.resolve();
    });

    // The address-key is stable, so the lookup effect didn't re-run.
    expect(reverseHandlesMock).toHaveBeenCalledTimes(1);
  });

  it('still resolves handles for new addresses that appear after the initial poll', async () => {
    // First poll: only ADDR_A. Second poll onward: both ADDR_A and ADDR_B.
    fetchLeaderboardMock.mockResolvedValueOnce(makeRows([ADDR_A]));
    fetchLeaderboardMock.mockResolvedValue(makeRows([ADDR_A, ADDR_B]));

    reverseHandlesMock.mockImplementation(async (addrs: string[]) =>
      Object.fromEntries(addrs.map((a) => [a, a === ADDR_A ? 'alice' : 'bob'])),
    );

    await act(async () => {
      root.render(<LeaderboardPage />);
      await Promise.resolve();
    });

    // ADDR_A resolved immediately; ADDR_B is not yet in the list.
    expect(reverseHandlesMock).toHaveBeenCalledWith([ADDR_A]);
    expect(container.textContent).toContain('@alice');

    // Second poll fires at +5 s, brings in ADDR_B — only the new address is looked up.
    await act(async () => {
      vi.advanceTimersByTime(5_000);
      await Promise.resolve();
    });

    expect(reverseHandlesMock).toHaveBeenCalledWith([ADDR_B]);
    expect(container.textContent).toContain('@bob');
  });
});

/** Issue #216: every row opens the person — their profile, else their score page. */
describe('LeaderboardPage — rows link to the person (issue #216)', () => {
  let root: Root;
  let container: HTMLDivElement;

  const ALICE = 'GALICEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
  const NOHANDLE = 'GNOHANDLEBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    fetchLeaderboardMock.mockReset();
    reverseHandlesMock.mockReset();
    reverseHandlesMock.mockImplementation(async (addrs: string[]) =>
      Object.fromEntries(addrs.map((a) => [a, a === ALICE ? 'alice' : null])),
    );
    store.me = null;
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    store.me = null;
  });

  type Row = { address: string; score: number; rank: number; flagged: boolean };

  async function renderRows(rows: Row[]) {
    fetchLeaderboardMock.mockResolvedValue(rows);
    await act(async () => {
      root.render(<LeaderboardPage />);
      await Promise.resolve();
    });
    return Array.from(container.querySelectorAll('ol > li'));
  }

  it('links a row with a handle to /u/<handle> and one without to /score/<address>', async () => {
    const items = await renderRows([
      { address: ALICE, score: 42, rank: 1, flagged: false },
      { address: NOHANDLE, score: 7, rank: 2, flagged: false },
    ]);
    expect(items).toHaveLength(2);
    // One focusable link per row, wrapping the whole row (keyboard: a real <a href>).
    const links = items.map((li) => li.querySelectorAll('a'));
    expect(links.map((l) => l.length)).toEqual([1, 1]);
    expect(links[0][0].getAttribute('href')).toBe('/u/alice');
    expect(links[1][0].getAttribute('href')).toBe(`/score/${NOHANDLE}`);
    // The face shows next to the crest.
    expect(links[0][0].querySelector('[role="img"]')).not.toBeNull();
  });

  it('names each row for a screen reader: @handle (or short address), rank and score', async () => {
    const items = await renderRows([
      { address: ALICE, score: 42, rank: 3, flagged: false },
      { address: NOHANDLE, score: 7, rank: 4, flagged: false },
    ]);
    const labels = items.map((li) => li.querySelector('a')?.getAttribute('aria-label'));
    expect(labels).toEqual([
      'leaderboard.rowLabel name=@alice rank=3 score=42',
      'leaderboard.rowLabel name=GNOH…BBBB rank=4 score=7',
    ]);
  });

  it('keeps the "you" and flagged marks in the accessible name', async () => {
    store.me = ALICE;
    const items = await renderRows([{ address: ALICE, score: 42, rank: 1, flagged: true }]);
    expect(items[0].querySelector('a')?.getAttribute('aria-label')).toBe(
      'leaderboard.rowLabel name=@alice rank=1 score=42, leaderboard.you, leaderboard.flaggedTitle',
    );
  });
});
