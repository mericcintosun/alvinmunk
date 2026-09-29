import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Wallet } from '@/lib/wallet';
import type { Profile } from '@/lib/profile';

// Next's automatic JSX runtime is compiled to `React.createElement` here, so provide a global.
(globalThis as { React?: typeof React }).React = React;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { getWalletMock, getXlmBalanceMock, reverseHandleMock } = vi.hoisted(() => ({
  getWalletMock: vi.fn(),
  getXlmBalanceMock: vi.fn(),
  reverseHandleMock: vi.fn(),
}));

vi.mock('@/lib/wallet', () => ({ getWallet: getWalletMock }));
vi.mock('@/lib/stellar', () => ({ getXlmBalance: getXlmBalanceMock }));
vi.mock('@/lib/registry', () => ({ reverseHandle: reverseHandleMock }));

import { WalletProvider, useWallet } from './wallet-provider';
import { clearProfile, loadProfile, saveProfile } from '@/lib/profile';

const WALLET = { kind: 'passkey', address: 'CACCOUNT' } as unknown as Wallet;

/** Reverse-lookup failure as the RPC reports it. */
const RPC_DOWN = new Error('simulate reverse failed: 503');

describe('WalletProvider — adopting the handle an address already holds (#278)', () => {
  let container: HTMLDivElement;
  let root: Root;
  let ctx: ReturnType<typeof useWallet>;

  /** Exposes the context and renders the profile the app would see. */
  function Probe() {
    ctx = useWallet();
    return <span data-testid="handle">{ctx.profile?.handle ?? ''}</span>;
  }

  beforeEach(() => {
    clearProfile();
    getWalletMock.mockReset().mockResolvedValue(WALLET);
    getXlmBalanceMock.mockReset().mockResolvedValue('10');
    reverseHandleMock.mockReset().mockResolvedValue(null);
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  async function mount() {
    await act(async () => root.render(<WalletProvider><Probe /></WalletProvider>));
  }

  /** Run `fn` against the live context and let React commit what it set. */
  async function run<T>(fn: () => Promise<T>): Promise<T> {
    let out!: T;
    await act(async () => {
      out = await fn();
    });
    return out;
  }

  const shown = () => container.querySelector('[data-testid="handle"]')!.textContent;

  it('hands the connect mode to getWallet (create by default)', async () => {
    await mount();
    await run(() => ctx.connect('recover'));
    await run(() => ctx.connect());
    expect(getWalletMock.mock.calls).toEqual([['recover'], ['create']]);
  });

  it('adopts the on-chain handle when this browser has no profile for the address', async () => {
    reverseHandleMock.mockResolvedValue('alvin');
    await mount();

    await run(() => ctx.connect('recover'));

    // A strict read: a failure must not pass for "no handle".
    expect(reverseHandleMock).toHaveBeenCalledWith('CACCOUNT', { strict: true });
    expect(shown()).toBe('alvin');
    expect(loadProfile()).toEqual({ handle: 'alvin', address: 'CACCOUNT', createdAt: expect.any(Number) });
  });

  it("replaces another address's profile with the connected address's handle", async () => {
    saveProfile({ handle: 'someone', address: 'GOTHER', createdAt: 1, bio: 'not mine' });
    reverseHandleMock.mockResolvedValue('alvin');
    await mount();

    await run(() => ctx.connect());

    expect(loadProfile()).toEqual({ handle: 'alvin', address: 'CACCOUNT', createdAt: expect.any(Number) });
  });

  it('keeps a profile that already belongs to the address, without a registry read', async () => {
    const mine: Profile = { handle: 'alvin', address: 'CACCOUNT', createdAt: 123, bio: 'ship it' };
    saveProfile(mine);
    await mount();

    await run(() => ctx.connect());

    expect(reverseHandleMock).not.toHaveBeenCalled();
    expect(loadProfile()).toEqual(mine);
  });

  it('leaves the profile empty when the address holds no handle', async () => {
    await mount();

    await expect(run(() => ctx.connect('recover'))).resolves.toBe(WALLET);

    expect(shown()).toBe('');
    expect(loadProfile()).toBeNull();
  });

  it('still connects when the registry read fails, and changes nothing', async () => {
    reverseHandleMock.mockRejectedValue(RPC_DOWN);
    await mount();

    await expect(run(() => ctx.connect('recover'))).resolves.toBe(WALLET);

    expect(ctx.wallet).toBe(WALLET);
    expect(loadProfile()).toBeNull();
  });

  describe('restoreProfile', () => {
    it('returns the adopted profile, or null when the address holds no handle', async () => {
      await mount();
      await expect(run(() => ctx.restoreProfile(WALLET))).resolves.toBeNull();

      reverseHandleMock.mockResolvedValue('alvin');
      await expect(run(() => ctx.restoreProfile(WALLET))).resolves.toMatchObject({ handle: 'alvin' });
      expect(shown()).toBe('alvin');
    });

    it('throws when the registry cannot be read, so no caller claims on a guess', async () => {
      reverseHandleMock.mockRejectedValue(RPC_DOWN);
      await mount();

      const err = await run(() => ctx.restoreProfile(WALLET).catch((e: unknown) => e));

      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toBe("Couldn't look up your handle — try again in a moment.");
      expect((err as Error).cause).toBe(RPC_DOWN);
      expect(loadProfile()).toBeNull();
    });
  });
});
