import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { getPendingMock, getProfileMock, focus } = vi.hoisted(() => ({
  getPendingMock: vi.fn(),
  getProfileMock: vi.fn(),
  focus: { on: false },
}));

vi.mock('@/lib/reputation', () => ({ getPending: getPendingMock, getProfile: getProfileMock }));
vi.mock('@/components/wallet/wallet-provider', () => ({
  useWallet: () => ({ profile: { address: 'GME' } }),
}));
vi.mock('@/lib/focus', () => ({
  get FOCUS_MODE() {
    return focus.on;
  },
}));

import { PendingBonusNudge } from './PendingBonusNudge';

const ALICE = 'GALICEALICEALICEALICEALICEALICEALICEALICEALICEALICEALICE';
const CAROL = 'GCAROLCAROLCAROLCAROLCAROLCAROLCAROLCAROLCAROLCAROLCAROL';
const DAVE = 'GDAVEDAVEDAVEDAVEDAVEDAVEDAVEDAVEDAVEDAVEDAVEDAVEDAVEDAV';

const unverified = { social: 30, earned: 0, verified: false };

describe('PendingBonusNudge', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    focus.on = false;
    getProfileMock.mockResolvedValue(unverified);
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
      root.render(<PendingBonusNudge />);
      await Promise.resolve();
    });
  }

  const three = [
    { voucher: ALICE, amount: 5 },
    { voucher: CAROL, amount: 5 },
    { voucher: DAVE, amount: 5 },
  ];

  it('tells an unverified claimer how many people wait on their first quest', async () => {
    getPendingMock.mockResolvedValue(three);
    await render();
    expect(getPendingMock).toHaveBeenCalledWith('GME');
    expect(container.textContent).toContain(
      '3 people get +5 XP each when you complete your first quest',
    );
    const link = container.querySelector('a');
    expect(link?.getAttribute('href')).toBe('/app/quests');
  });

  it('uses the singular copy for one waiting voucher', async () => {
    getPendingMock.mockResolvedValue([three[0]]);
    await render();
    expect(container.textContent).toContain(
      '1 person gets +5 XP when you complete your first quest',
    );
  });

  it('states the total when the queued amounts differ', async () => {
    getPendingMock.mockResolvedValue([three[0], { voucher: CAROL, amount: 10 }]);
    await render();
    expect(container.textContent).toContain('2 people get +15 XP between them');
  });

  it('renders nothing when nobody is waiting', async () => {
    getPendingMock.mockResolvedValue([]);
    await render();
    expect(container.innerHTML).toBe('');
  });

  it('renders nothing for a verified user', async () => {
    getPendingMock.mockResolvedValue(three);
    getProfileMock.mockResolvedValue({ social: 30, earned: 50, verified: true });
    await render();
    expect(container.innerHTML).toBe('');
  });

  it('renders nothing when the pending read fails (e.g. a contract without get_pending)', async () => {
    getPendingMock.mockRejectedValue(new Error('simulation failed'));
    await render();
    expect(container.innerHTML).toBe('');
  });

  it('still decides from the queue when the profile read fails', async () => {
    getPendingMock.mockResolvedValue(three);
    getProfileMock.mockRejectedValue(new Error('rpc down'));
    await render();
    expect(container.textContent).toContain('3 people get +5 XP each');
  });

  it('keeps the copy but drops the quests link under FOCUS_MODE', async () => {
    focus.on = true;
    getPendingMock.mockResolvedValue(three);
    await render();
    expect(container.textContent).toContain('3 people get +5 XP each');
    expect(container.querySelector('a')).toBeNull();
  });

  it('re-reads when the tab comes back into view', async () => {
    getPendingMock.mockResolvedValue(three);
    await render();
    expect(container.textContent).toContain('3 people');

    getPendingMock.mockResolvedValue([]); // the claimer verified in another tab
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
      await Promise.resolve();
    });
    expect(getPendingMock).toHaveBeenCalledTimes(2);
    expect(container.innerHTML).toBe('');
  });
});
