import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Wallet } from '@/lib/wallet';

// Next's automatic JSX runtime is compiled to `React.createElement` here, so provide a global.
(globalThis as { React?: typeof React }).React = React;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { connectMock, setProfileMock, restoreProfileMock, claimHandleMock, pushMock, toastMock } =
  vi.hoisted(() => ({
    connectMock: vi.fn(),
    setProfileMock: vi.fn(),
    restoreProfileMock: vi.fn(),
    claimHandleMock: vi.fn(),
    pushMock: vi.fn(),
    toastMock: { success: vi.fn(), error: vi.fn() },
  }));

vi.mock('@/components/wallet/wallet-provider', () => ({
  useWallet: () => ({
    profile: null,
    connect: connectMock,
    setProfile: setProfileMock,
    restoreProfile: restoreProfileMock,
  }),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: pushMock }) }));
vi.mock('@/lib/genesis', () => ({ recordGenesis: vi.fn(async () => 'TX') }));
vi.mock('@/lib/registry', () => ({
  claimHandle: claimHandleMock,
  handleAvailability: vi.fn(async () => ({ status: 'free' })),
}));
vi.mock('@/lib/track', () => ({ track: vi.fn(), identify: vi.fn(), trackError: vi.fn() }));
vi.mock('sonner', () => ({ toast: toastMock }));

import { LandingOnboard } from './landing-onboard';

const WALLET = { kind: 'passkey', address: 'CACCOUNT' } as unknown as Wallet;

describe('LandingOnboard — an address that already holds a handle (#278)', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    for (const m of [setProfileMock, pushMock, toastMock.success, toastMock.error]) m.mockReset();
    connectMock.mockReset().mockResolvedValue(WALLET);
    restoreProfileMock.mockReset().mockResolvedValue(null);
    claimHandleMock.mockReset().mockResolvedValue(undefined);
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  async function flush() {
    await act(async () => {
      for (let i = 0; i < 8; i++) await Promise.resolve();
    });
  }

  async function createAs(value: string) {
    await act(async () => root.render(<LandingOnboard />));
    const input = container.querySelector<HTMLInputElement>('[aria-label="Handle"]')!;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    await act(async () => {
      setter.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const form = input.closest('form')!;
    await act(async () => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    await flush();
  }

  it('keeps the handle instead of claiming (renaming) it, and opens the app', async () => {
    restoreProfileMock.mockResolvedValue({ handle: 'alvin', address: 'CACCOUNT', createdAt: 1 });

    await createAs('bob');

    expect(restoreProfileMock).toHaveBeenCalledWith(WALLET);
    expect(claimHandleMock).not.toHaveBeenCalled();
    expect(setProfileMock).not.toHaveBeenCalled();
    expect(toastMock.success).toHaveBeenCalledWith('Welcome back — @alvin restored.');
    expect(pushMock).toHaveBeenCalledWith('/app');
  });

  it('claims the typed handle when the address holds none', async () => {
    await createAs('bob');

    expect(claimHandleMock).toHaveBeenCalledWith(WALLET, 'bob');
    expect(setProfileMock).toHaveBeenCalledWith(expect.objectContaining({ handle: 'bob' }));
  });
});
