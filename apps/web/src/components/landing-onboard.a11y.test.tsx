import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// LandingOnboard leans on Next's automatic JSX runtime; this vitest setup compiles JSX to
// `React.createElement`, so give it a global React to resolve.
(globalThis as { React?: typeof React }).React = React;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { handleAvailabilityMock, pushMock, wallet } = vi.hoisted(() => ({
  handleAvailabilityMock: vi.fn(),
  pushMock: vi.fn(),
  wallet: { profile: null as { address: string; handle: string } | null },
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: pushMock }) }));
// A plain anchor that forwards every prop, as next/link renders one.
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/components/wallet/wallet-provider', () => ({
  useWallet: () => ({
    profile: wallet.profile,
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
    expect(wrapper.className).toMatch(/focus-within:ring-ring(?![/\w-])/);
  });

  it('points the input at the status line with a polite live region', async () => {
    await render();
    const input = container.querySelector('input')!;
    const status = container.querySelector('#landing-handle-status')!;
    expect(input.getAttribute('aria-describedby')).toBe('landing-handle-status landing-handle-rules');
    expect(status.getAttribute('aria-live')).toBe('polite');
  });

  it('announces a taken handle instead of silently disabling submit', async () => {
    handleAvailabilityMock.mockResolvedValue({ status: 'taken' });
    await render();
    await typeHandle('ada');
    expect(handleAvailabilityMock).toHaveBeenCalledWith('ada', undefined);
    expect(container.querySelector('#landing-handle-status')!.textContent).toBe('@ada is taken — try another');
    expect(container.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(
      true,
    );
  });

  // #479: rules up front, dropped characters named, and a status line that wraps instead of
  // covering the face picker below it.
  it('states the handle rules, caps the field at 20 and names removed characters', async () => {
    handleAvailabilityMock.mockResolvedValue({ status: 'free' });
    await render();
    const input = container.querySelector('input')!;
    const rules = container.querySelector('#landing-handle-rules')!;
    expect(input.maxLength).toBe(20);
    expect(rules.textContent).toBe('3–20 characters: a–z, 0–9 or _');
    await typeHandle('Ayşe K');
    expect(rules.textContent).toBe('Removed “ş”, space — use 3–20 characters: a–z, 0–9 or _');
    expect(container.querySelector('#landing-handle-status')!.textContent).toBe('✓ @ayek is free');
  });

  it('lets a long reserved message wrap instead of overlapping the face picker', async () => {
    handleAvailabilityMock.mockResolvedValue({ status: 'reserved', until: new Date('2026-10-29T12:00:00Z') });
    await render();
    await typeHandle('ada');
    const status = container.querySelector('#landing-handle-status')!;
    expect(status.textContent).toMatch(/^@ada is reserved until .+ — try another$/);
    expect(status.className.split(' ')).toContain('min-h-4');
    expect(status.className.split(' ')).not.toContain('h-4');
  });

  it('announces a free handle', async () => {
    handleAvailabilityMock.mockResolvedValue({ status: 'free' });
    await render();
    await typeHandle('ada');
    expect(container.querySelector('#landing-handle-status')!.textContent).toBe('✓ @ada is free');
  });
});

describe('LandingOnboard returning-user CTA (#487)', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    wallet.profile = { address: 'GME', handle: 'ada' };
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    wallet.profile = null;
  });

  it('is one link styled as the button, not a <button> nested in an <a>', async () => {
    await act(async () => {
      root.render(<LandingOnboard />);
    });
    const links = container.querySelectorAll('a');
    expect(links).toHaveLength(1);
    expect(links[0].getAttribute('href')).toBe('/app');
    expect(links[0].textContent).toContain('Open your app');
    // One tab stop: no focusable control inside the link.
    expect(container.querySelector('a button')).toBeNull();
    expect(container.querySelectorAll('button')).toHaveLength(0);
    // Same look as the old <Button variant="flow" size="lg">.
    for (const c of ['flow', 'rounded-full', 'h-12', 'px-7']) {
      expect(links[0].classList).toContain(c);
    }
    // Its focus ring is the global :focus-visible outline (#502), not a ring class of its own.
    expect(links[0].className).not.toMatch(/focus-visible:(ring|outline)/);
  });
});
