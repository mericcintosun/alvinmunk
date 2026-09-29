import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GateStatus } from '@/lib/gate';

const { getGateStatusMock, getScoresMock, unlockGateMock } = vi.hoisted(() => ({
  getGateStatusMock: vi.fn(),
  getScoresMock: vi.fn(),
  unlockGateMock: vi.fn(),
}));

vi.mock('@/lib/gate', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/gate')>()),
  getGateStatus: getGateStatusMock,
  unlockGate: unlockGateMock,
}));
vi.mock('@/lib/reputation', () => ({ getScores: getScoresMock }));
vi.mock('@/lib/wallet', () => ({ getWallet: vi.fn().mockResolvedValue({ address: 'GME' }) }));

import { Unlockables } from './Unlockables';

// This vitest setup compiles JSX to `React.createElement`; give the component a global React.
(globalThis as { React?: typeof React }).React = React;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ME = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';

const row = (id: number, passes: boolean, unlocked: boolean, extra: Partial<GateStatus['gate']> = {}) => ({
  gate: { id, track: 1, min: 30, label: `Gate ${id}`, active: true, ...extra },
  passes,
  unlocked,
});

describe('Unlockables', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    getScoresMock.mockResolvedValue({ social: 0, earned: 100 });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.clearAllMocks();
  });

  async function render() {
    await act(async () => {
      root.render(<Unlockables address={ME} />);
    });
  }

  const items = () => [...container.querySelectorAll('li')];

  it('renders every row from one get_status read', async () => {
    getGateStatusMock.mockResolvedValue([row(1, true, true), row(2, true, false), row(3, false, false)]);
    await render();
    expect(getGateStatusMock).toHaveBeenCalledTimes(1);
    expect(getGateStatusMock).toHaveBeenCalledWith(ME);
    const [done, open, closed] = items();
    expect(done.textContent).toContain('✦ unlocked');
    expect(open.querySelector('button')!.textContent).toBe('unlock');
    expect(open.querySelector('button')!.disabled).toBe(false);
    expect(closed.querySelector('button')!.textContent).toBe('locked');
    expect(closed.querySelector('button')!.disabled).toBe(true);
  });

  it('takes pass state from the contract, not from the first rule and the scores', async () => {
    // Earned 100 clears `min: 30`, but the gate's full rule set (e.g. a second rule) doesn't.
    getGateStatusMock.mockResolvedValue([row(1, false, false)]);
    await render();
    expect(items()[0].querySelector('button')!.textContent).toBe('locked');
    expect(items()[0].textContent).toContain('you 100'); // the scores still fill in the figure
  });

  it('offers to unlock again when an old unlock no longer counts', async () => {
    getGateStatusMock.mockResolvedValue([row(1, true, false)]); // redefined since the last unlock
    await render();
    const button = items()[0].querySelector('button')!;
    expect(button.textContent).toBe('unlock');
    await act(async () => {
      button.click();
    });
    expect(unlockGateMock).toHaveBeenCalledWith({ address: 'GME' }, 1);
    expect(getGateStatusMock).toHaveBeenCalledTimes(2); // refreshed after the unlock
  });

  it('hides inactive gates, and itself when none are left', async () => {
    getGateStatusMock.mockResolvedValue([row(1, false, false, { active: false })]);
    await render();
    expect(items()).toHaveLength(0);
    expect(container.textContent).toBe('');
  });
});
