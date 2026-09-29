import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Wallet } from '@/lib/wallet';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { storedDevWalletMock, reverseHandleMock, transferHandleMock } = vi.hoisted(() => ({
  storedDevWalletMock: vi.fn(),
  reverseHandleMock: vi.fn(),
  transferHandleMock: vi.fn(),
}));

vi.mock('@/lib/wallet', () => ({ storedDevWallet: storedDevWalletMock }));
vi.mock('@/lib/registry', () => ({
  reverseHandle: reverseHandleMock,
  transferHandle: transferHandleMock,
  TRANSFER_ERRORS: { NoHandle: 4, AlreadyHasHandle: 10 },
}));
vi.mock('@/lib/stellar', () => ({ txExplorerUrl: (h: string) => `https://explorer/tx/${h}` }));

import { HandleTransfer } from './HandleTransfer';

const DEV = 'GDEVDEVDEVDEVDEVDEVDEVDEVDEVDEVDEVDEVDEVDEVDEVDEVDEVDEVD';
const KIT = 'GKITKITKITKITKITKITKITKITKITKITKITKITKITKITKITKITKITKIT';
const dev = { kind: 'dev', address: DEV } as unknown as Wallet;
const kit = { kind: 'kit', address: KIT } as unknown as Wallet;

describe('HandleTransfer', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    storedDevWalletMock.mockReturnValue(dev);
    reverseHandleMock.mockImplementation(async (a: string) => (a === DEV ? 'alice' : null));
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.clearAllMocks();
  });

  async function render(wallet: Wallet = kit) {
    await act(async () => {
      root.render(<HandleTransfer wallet={wallet} />);
      await Promise.resolve();
    });
  }

  const button = () => container.querySelector('button');

  it("offers to move the in-app wallet's handle here, saying the XP stays behind", async () => {
    await render();
    expect(reverseHandleMock).toHaveBeenCalledWith(DEV);
    expect(reverseHandleMock).toHaveBeenCalledWith(KIT);
    expect(container.textContent).toContain('holds @alice');
    expect(container.textContent).toContain('Social and Earned XP stay with the in-app wallet');
    expect(button()?.textContent).toBe('Move @alice here');
  });

  it('moves it with both wallets and shows the transaction', async () => {
    transferHandleMock.mockResolvedValue('tx-hash');
    await render();
    await act(async () => {
      button()?.click();
    });
    expect(transferHandleMock).toHaveBeenCalledWith(dev, kit);
    expect(container.textContent).toContain('@alice now belongs to this wallet.');
    expect(container.querySelector('a')?.getAttribute('href')).toBe('https://explorer/tx/tx-hash');
    expect(button()).toBeNull();
  });

  it('explains a registry revert instead of the raw error', async () => {
    transferHandleMock.mockRejectedValue(new Error('HostError: Error(Contract, #10)'));
    await render();
    await act(async () => {
      button()?.click();
    });
    expect(container.textContent).toContain('This wallet already holds a handle');
    expect(button()?.textContent).toBe('Move @alice here'); // can try again
  });

  it('says why it cannot move when the connected wallet already holds a handle', async () => {
    reverseHandleMock.mockImplementation(async (a: string) => (a === DEV ? 'alice' : 'bob'));
    await render();
    expect(container.textContent).toContain('This wallet already holds @bob.');
    expect(button()).toBeNull();
  });

  it('renders nothing without an in-app wallet, a handle to move, or a second wallet', async () => {
    storedDevWalletMock.mockReturnValue(null);
    await render();
    expect(container.innerHTML).toBe('');

    storedDevWalletMock.mockReturnValue(dev);
    reverseHandleMock.mockResolvedValue(null);
    await render({ ...kit, address: 'GOTHER' } as Wallet);
    expect(container.innerHTML).toBe('');

    reverseHandleMock.mockResolvedValue('alice');
    await render(dev); // the in-app wallet is the connected one
    expect(container.innerHTML).toBe('');
    expect(transferHandleMock).not.toHaveBeenCalled();
  });
});
