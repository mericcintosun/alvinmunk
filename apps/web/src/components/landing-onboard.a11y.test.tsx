import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// LandingOnboard leans on Next's automatic JSX runtime; this vitest setup compiles JSX to
// `React.createElement`, so give it a global React to resolve.
(globalThis as { React?: typeof React }).React = React;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { handleAvailabilityMock, pushMock } = vi.hoisted(() => ({
  handleAvailabilityMock: vi.fn(),
  pushMock: vi.fn(),
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: pushMock }) }));
vi.mock('next/link', () => ({ default: (p: { children: React.ReactNode }) => p.children }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/components/wallet/wallet-provider', () => ({
  useWallet: () => ({
    profile: null,
    connect: async () => ({ kind: 'dev', address: 'GME' }),
    setProfile: vi.fn(),
    restoreProfile: vi.fn(),
  }),
}));
vi.mock('@/lib/registry', () => ({ handleAvailability: handleAvailabilityMock }));
vi.mock('@/lib/track', () => ({ track: vi.fn(), identify: vi.fn(), trackError: vi.fn() }));

import { LandingOnboard } from './landing-onboard';

describe('LandingOnboard handle field', () => {
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
  });

  async function render() {
    await act(async () => {
      root.render(<LandingOnboard />);
    });
  }

  async function typeHandle(value: string) {
    const input = container.querySelector('input')!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      setter.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    // The debounce (400ms) plus the availability lookup.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 500));
    });
  }

  /** The borderless input keeps its focus ring, so the pill itself has to show focus. */
  it('shows a focus ring on the wrapper while the input has focus', async () => {
    await render();
    const input = container.querySelector('input')!;
    const wrapper = input.closest('.glass')!;
    expect(wrapper.className).toMatch(/focus-within:ring-2/);
    expect(wrapper.className).toMatch(/focus-within:ring-ring\/40/);
  });

  it('points the input at the status line with a polite live region', async () => {
    await render();
    const input = container.querySelector('input')!;
    const status = container.querySelector('#landing-handle-status')!;
    expect(input.getAttribute('aria-describedby')).toBe('landing-handle-status');
    expect(status.getAttribute('aria-live')).toBe('polite');
  });

  it('announces a taken handle instead of silently disabling submit', async () => {
    handleAvailabilityMock.mockResolvedValue({ status: 'taken' });
    await render();
    await typeHandle('ada');
    expect(handleAvailabilityMock).toHaveBeenCalledWith('ada', undefined);
    expect(container.querySelector('#landing-handle-status')!.textContent).toBe('@ada is taken');
    expect(container.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(
      true,
    );
  });

  it('announces a free handle', async () => {
    handleAvailabilityMock.mockResolvedValue({ status: 'free' });
    await render();
    await typeHandle('ada');
    expect(container.querySelector('#landing-handle-status')!.textContent).toBe('✓ @ada is free');
  });
});
