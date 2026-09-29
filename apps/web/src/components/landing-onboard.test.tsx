import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Wallet } from '@/lib/wallet';

// Next's automatic JSX runtime is compiled to `React.createElement` here, so provide a global.
(globalThis as { React?: typeof React }).React = React;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { connectMock, setProfileMock, restoreProfileMock, claimHandleMock, handleAvailabilityMock, pushMock, toastMock } =
  vi.hoisted(() => ({
    connectMock: vi.fn(),
    setProfileMock: vi.fn(),
    restoreProfileMock: vi.fn(),
    claimHandleMock: vi.fn(),
    handleAvailabilityMock: vi.fn(),
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
  handleAvailability: handleAvailabilityMock,
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
    handleAvailabilityMock.mockReset().mockResolvedValue({ status: 'free' });
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

  const handleInput = () => container.querySelector<HTMLInputElement>('[aria-label="Handle"]')!;

  async function typeHandle(value: string) {
    const input = handleInput();
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    await act(async () => {
      setter.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }

  async function submit() {
    const form = handleInput().closest('form')!;
    await act(async () => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    await flush();
  }

  async function createAs(value: string) {
    await act(async () => root.render(<LandingOnboard />));
    await typeHandle(value);
    await submit();
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

// The landing sign-up used to skip the face picker and the live status line that /app
// onboarding has (#240); both now run on the same hook and render the same states.
describe('LandingOnboard — parity with /app onboarding (#240)', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.useFakeTimers();
    for (const m of [setProfileMock, pushMock, toastMock.success, toastMock.error]) m.mockReset();
    connectMock.mockReset().mockResolvedValue(WALLET);
    restoreProfileMock.mockReset().mockResolvedValue(null);
    claimHandleMock.mockReset().mockResolvedValue(undefined);
    handleAvailabilityMock.mockReset().mockResolvedValue({ status: 'free' });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  const handleInput = () => container.querySelector<HTMLInputElement>('[aria-label="Handle"]')!;
  const submitButton = () => container.querySelector<HTMLButtonElement>('button[type="submit"]')!;
  const status = () => document.getElementById(handleInput().getAttribute('aria-describedby')!)!;

  async function render() {
    await act(async () => root.render(<LandingOnboard />));
  }

  async function typeHandle(value: string) {
    const input = handleInput();
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    await act(async () => {
      setter.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }

  async function settle() {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
  }

  async function submit() {
    const form = handleInput().closest('form')!;
    await act(async () => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    await act(async () => {
      for (let i = 0; i < 8; i++) await Promise.resolve();
    });
  }

  it('saves the face picked on the landing page with the new profile', async () => {
    await render();
    const face = container.querySelector<HTMLButtonElement>('[role="radio"][aria-label="Face 03"]')!;
    await act(async () => face.click());
    expect(face.getAttribute('aria-checked')).toBe('true');

    await typeHandle('bob');
    await submit();

    expect(setProfileMock).toHaveBeenCalledWith(
      expect.objectContaining({ handle: 'bob', avatar: { kind: 'face', id: 'face-03' }, source: 'landing' }),
    );
    expect(pushMock).toHaveBeenCalledWith('/app');
  });

  it('announces availability in a live region tied to the input', async () => {
    await render();
    expect(status().getAttribute('aria-live')).toBe('polite');
    expect(status().textContent).toBe('no seed phrase · fees sponsored · one tap');

    await typeHandle('bob');
    expect(status().textContent).toBe('Checking…');
    await settle();
    expect(status().textContent).toBe('✓ @bob is free');
  });

  it('labels the submit button while the profile is being created', async () => {
    let finish!: () => void;
    claimHandleMock.mockReturnValue(new Promise<void>((resolve) => (finish = resolve)));
    await render();
    await typeHandle('bob');
    await submit();

    expect(submitButton().textContent).toBe('Creating your profile…');
    expect(submitButton().disabled).toBe(true);
    expect(container.textContent).not.toMatch(/onboard\./);

    await act(async () => finish());
    await act(async () => {
      for (let i = 0; i < 8; i++) await Promise.resolve();
    });
    expect(pushMock).toHaveBeenCalledWith('/app');
  });
});
