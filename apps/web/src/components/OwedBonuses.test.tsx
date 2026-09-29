import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { getOwedBonusesMock, focus } = vi.hoisted(() => ({
  getOwedBonusesMock: vi.fn(),
  focus: { on: false },
}));

vi.mock('@/lib/myvouches', () => ({ getOwedBonuses: getOwedBonusesMock }));
vi.mock('@/components/wallet/wallet-provider', () => ({
  useWallet: () => ({ profile: { address: 'GME' } }),
}));
vi.mock('@/lib/focus', () => ({
  get FOCUS_MODE() {
    return focus.on;
  },
}));

import { OwedBonuses } from './OwedBonuses';

const BOB = 'GBOBBOBBOBBOBBOBBOBBOBBOBBOBBOBBOBBOBBOBBOBBOBBOBBOBBOB';
const EVE = 'GEVEEVEEVEEVEEVEEVEEVEEVEEVEEVEEVEEVEEVEEVEEVEEVEEVEEVE';

describe('OwedBonuses', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    focus.on = false;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.clearAllMocks();
  });

  async function render() {
    await act(async () => {
      root.render(<OwedBonuses />);
      await Promise.resolve();
    });
  }

  const rows = [
    { claimer: EVE, handle: null, note: '', amount: 10 },
    { claimer: BOB, handle: 'bob', note: 'unblocked me at 2am', amount: 5 },
  ];

  it('shows the total and one row per person', async () => {
    getOwedBonusesMock.mockResolvedValue(rows);
    await render();
    expect(getOwedBonusesMock).toHaveBeenCalledWith('GME');
    expect(container.textContent).toContain('15 XP waiting');
    expect(container.textContent).toContain('Unlocks when @bob completes a verified quest');
    expect(container.textContent).toContain('unblocked me at 2am');
    expect(container.querySelectorAll('li')).toHaveLength(2);
    expect(container.querySelectorAll('button')).toHaveLength(2);
  });

  it('renders nothing when nothing is owed', async () => {
    getOwedBonusesMock.mockResolvedValue([]);
    await render();
    expect(container.innerHTML).toBe('');
  });

  it('keeps the copy but drops the quests link under FOCUS_MODE', async () => {
    focus.on = true;
    getOwedBonusesMock.mockResolvedValue(rows);
    await render();
    expect(container.textContent).toContain('Unlocks when @bob completes a verified quest');
    expect(container.querySelectorAll('button')).toHaveLength(0);
  });

  it('nudges by copying the quests link when native share is unavailable', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    getOwedBonusesMock.mockResolvedValue([rows[1]]);
    await render();

    const button = container.querySelector('button')!;
    expect(button.getAttribute('aria-label')).toBe('Share the quests link with @bob');
    await act(async () => {
      button.click();
      await Promise.resolve();
    });
    expect(writeText).toHaveBeenCalledWith(
      expect.stringContaining(`${window.location.origin}/app/quests`),
    );
    expect(container.textContent).toContain('copied');
  });

  it('re-reads when the tab comes back into view', async () => {
    getOwedBonusesMock.mockResolvedValue([rows[1]]);
    await render();
    expect(container.querySelectorAll('li')).toHaveLength(1);

    getOwedBonusesMock.mockResolvedValue([]); // bob verified meanwhile
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
      await Promise.resolve();
    });
    expect(getOwedBonusesMock).toHaveBeenCalledTimes(2);
    expect(container.innerHTML).toBe('');
  });
});
