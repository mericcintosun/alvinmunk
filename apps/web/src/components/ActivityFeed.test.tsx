import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { fetchActivityMock, reverseHandlesMock, focus } = vi.hoisted(() => ({
  fetchActivityMock: vi.fn(),
  reverseHandlesMock: vi.fn(),
  focus: { FOCUS_MODE: false },
}));

vi.mock('@/lib/feed', () => ({ fetchActivity: fetchActivityMock }));
vi.mock('@/lib/registry', () => ({ reverseHandles: reverseHandlesMock }));
vi.mock('@/components/Avatar', () => ({ Avatar: () => null }));
vi.mock('@/lib/focus', () => focus);

import { ActivityFeed } from './ActivityFeed';

const ALICE = 'GALICE'.padEnd(56, 'A');
const BOB = 'GBOB'.padEnd(56, 'B');
const CAROL = 'GCAROL'.padEnd(56, 'C');

describe('ActivityFeed', () => {
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
    focus.FOCUS_MODE = false;
  });

  async function renderFeed() {
    await act(async () => root.render(<ActivityFeed />));
    // let the feed read, the label read and any effect they trigger settle
    for (let i = 0; i < 4; i++) await act(async () => Promise.resolve());
  }

  const MIXED = [
    { kind: 'tip', from: BOB, to: CAROL, ledger: 3, amount: 20_000_000n },
    { kind: 'vouch', from: ALICE, to: BOB, ledger: 2 },
  ];

  it('labels every row with one batched lookup, and does not ask again for unnamed ones', async () => {
    fetchActivityMock.mockResolvedValue([
      { from: ALICE, to: BOB, ledger: 2 },
      { from: CAROL, to: ALICE, ledger: 1 },
    ]);
    reverseHandlesMock.mockResolvedValue({ [ALICE]: 'alice', [BOB]: null, [CAROL]: null });

    await act(async () => root.render(<ActivityFeed />));
    // let the feed read, the label read and any effect they trigger settle
    for (let i = 0; i < 4; i++) await act(async () => Promise.resolve());

    expect(reverseHandlesMock).toHaveBeenCalledTimes(1);
    expect(reverseHandlesMock).toHaveBeenCalledWith([ALICE, BOB, CAROL]);
    expect(container.textContent).toContain('@alice');
    expect(container.textContent).toContain(`${BOB.slice(0, 4)}…${BOB.slice(-4)}`);
  });

  it('shows a tip with sender, recipient and the USDC amount', async () => {
    fetchActivityMock.mockResolvedValue(MIXED);
    reverseHandlesMock.mockResolvedValue({ [ALICE]: 'alice', [BOB]: 'bob', [CAROL]: 'carol' });
    await renderFeed();

    const rows = [...container.querySelectorAll('li')].map((li) => li.textContent);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain('@bob');
    expect(rows[0]).toContain('tipped');
    expect(rows[0]).toContain('@carol');
    expect(rows[0]).toContain('2 USDC');
    expect(rows[1]).toContain('vouched');
  });

  it('hides tips while FOCUS_MODE hides the cashable surface', async () => {
    focus.FOCUS_MODE = true;
    fetchActivityMock.mockResolvedValue(MIXED);
    reverseHandlesMock.mockResolvedValue({ [ALICE]: null, [BOB]: null, [CAROL]: null });
    await renderFeed();

    const rows = [...container.querySelectorAll('li')].map((li) => li.textContent);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toContain('vouched');
  });
});
