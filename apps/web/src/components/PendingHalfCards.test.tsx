import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PendingVouch } from '@/lib/myvouches';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { getPendingVouchesMock, cancelVouchMock, getWalletMock } = vi.hoisted(() => ({
  getPendingVouchesMock: vi.fn(),
  cancelVouchMock: vi.fn(),
  getWalletMock: vi.fn(),
}));

vi.mock('@/lib/myvouches', () => ({ getPendingVouches: getPendingVouchesMock }));
vi.mock('@/lib/reputation', () => ({ cancelVouch: cancelVouchMock }));
vi.mock('@/lib/wallet', () => ({ getWallet: getWalletMock }));
vi.mock('@/components/wallet/wallet-provider', () => ({
  useWallet: () => ({ profile: { address: 'GME' } }),
}));
vi.mock('@/components/ui/state-art', () => ({ StateArt: () => null }));
vi.mock('@/components/ui/sticker', () => ({ Sticker: () => null, Tape: () => null }));

import { PendingHalfCards } from './PendingHalfCards';

const WALLET = { address: 'GME' };

function card(id: number, over: Partial<PendingVouch> = {}): PendingVouch {
  return {
    id,
    seed: 'aa',
    note: `note ${id}`,
    created: 0,
    claimUrl: `https://alvinmunk.app/claim/${id}#k=aa`,
    daysLeft: 5,
    from: 'GME',
    revocable: true,
    ...over,
  };
}

describe('PendingHalfCards — revoke a leaked link (#137)', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    getWalletMock.mockResolvedValue(WALLET);
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
      root.render(<PendingHalfCards />);
      await Promise.resolve();
    });
  }

  const buttons = (label: string) =>
    [...container.querySelectorAll('button')].filter((b) => b.textContent === label);

  async function click(b: HTMLButtonElement) {
    await act(async () => {
      b.click();
      await Promise.resolve();
    });
  }

  it("offers the revoke only on the wallet's own cards, on a contract that supports it", async () => {
    getPendingVouchesMock.mockResolvedValue([
      card(1),
      card(2, { revocable: false }), // is_cancelled unreadable: older contract
      card(3, { from: 'GOTHER' }), // minted in this browser by another wallet
    ]);
    await render();
    expect(container.querySelectorAll('li')).toHaveLength(3);
    expect(buttons('revoke_link')).toHaveLength(1);
    expect(container.querySelectorAll('li')[0].textContent).toContain('revoke_link');
  });

  it('asks first, warning that the stake is not refunded, and can back out', async () => {
    getPendingVouchesMock.mockResolvedValue([card(1)]);
    await render();

    await click(buttons('revoke_link')[0]);
    expect(container.textContent).toContain('your stake is not refunded');
    expect(cancelVouchMock).not.toHaveBeenCalled();

    await click(buttons('Keep it')[0]);
    expect(container.textContent).not.toContain('your stake is not refunded');
    expect(buttons('revoke_link')).toHaveLength(1);
    expect(cancelVouchMock).not.toHaveBeenCalled();
  });

  it('cancels the card with the wallet on confirm and drops it from the list', async () => {
    getPendingVouchesMock.mockResolvedValue([card(1), card(2)]);
    cancelVouchMock.mockResolvedValue(undefined);
    await render();

    await click(buttons('revoke_link')[0]);
    await click(buttons('Revoke')[0]);

    expect(cancelVouchMock).toHaveBeenCalledWith(WALLET, 1);
    const rows = container.querySelectorAll('li');
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).toContain('note 2');
  });

  it('keeps the card and explains a refused cancel', async () => {
    getPendingVouchesMock.mockResolvedValue([card(1)]);
    cancelVouchMock.mockRejectedValue(new Error('HostError: Error(Contract, #5)'));
    await render();

    await click(buttons('revoke_link')[0]);
    await click(buttons('Revoke')[0]);

    expect(container.querySelectorAll('li')).toHaveLength(1);
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      'Too late — this vouch was already claimed.',
    );
  });
});
