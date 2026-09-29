import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Suggestion } from '@/lib/constellation';

(globalThis as { React?: typeof React }).React = React;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ME = 'G'.padEnd(56, 'M');

const {
  store,
  fetchEventsMock,
  suggestPeopleMock,
  reverseHandlesMock,
  resolveHandleMock,
} = vi.hoisted(() => ({
  store: { profile: { address: 'G'.padEnd(56, 'M'), handle: 'me', createdAt: 1 } as { address: string } | null },
  fetchEventsMock: vi.fn(),
  suggestPeopleMock: vi.fn(),
  reverseHandlesMock: vi.fn(),
  resolveHandleMock: vi.fn(),
}));

vi.mock('@/components/wallet/wallet-provider', () => ({
  useWallet: () => ({ profile: store.profile }),
}));
vi.mock('@/lib/events', () => ({ fetchReputationEvents: fetchEventsMock }));
vi.mock('@/lib/constellation', () => ({ suggestPeople: suggestPeopleMock }));
vi.mock('@/lib/registry', () => ({
  resolveHandle: resolveHandleMock,
  reverseHandles: reverseHandlesMock,
}));
vi.mock('@/lib/reputation', () => ({ getScores: vi.fn() }));
vi.mock('@/components/Avatar', () => ({ Avatar: () => null }));
// A plain anchor that forwards every prop, so aria-label/href reach the DOM as they would.
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import PeoplePage from './page';

const A1 = 'G'.padEnd(56, 'A');
const B1 = 'G'.padEnd(56, 'B');

describe('PeoplePage suggestions (idle state)', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    store.profile = { address: ME };
    fetchEventsMock.mockReset().mockResolvedValue([]);
    suggestPeopleMock.mockReset().mockReturnValue([]);
    reverseHandlesMock.mockReset().mockResolvedValue({});
    resolveHandleMock.mockReset();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  async function mount() {
    await act(async () => root.render(<PeoplePage />));
  }

  async function flush() {
    await act(async () => {
      for (let i = 0; i < 5; i++) await Promise.resolve();
    });
  }

  it('shows the suggestion heading with a loading skeleton before events resolve', async () => {
    let resolveEvents!: (v: []) => void;
    fetchEventsMock.mockReturnValue(new Promise((r) => (resolveEvents = r)));
    await mount();
    expect(container.textContent).toContain('People you might know');
    expect(container.querySelectorAll('[class*="animate-pulse"]').length).toBeGreaterThan(0);
    await act(async () => resolveEvents([]));
    await flush();
  });

  it('falls back to the original empty state when the viewer has no graph edges', async () => {
    fetchEventsMock.mockResolvedValue([]);
    suggestPeopleMock.mockReturnValue([]);
    await mount();
    await flush();
    expect(container.textContent).toContain('Discover the network');
    expect(suggestPeopleMock).toHaveBeenCalledWith(ME, [], 6);
  });

  it('renders resolved-handle cards, ranked as returned, with a singular/plural mutual label', async () => {
    const raw: Suggestion[] = [
      { address: A1, sharedCount: 2, handle: null },
      { address: B1, sharedCount: 1, handle: null },
    ];
    fetchEventsMock.mockResolvedValue([{ topics: ['vouch', 'claimed'], data: [1, ME, A1] }]);
    suggestPeopleMock.mockReturnValue(raw);
    reverseHandlesMock.mockResolvedValue({ [A1]: 'alice', [B1]: null });

    await mount();
    await flush();

    expect(container.textContent).toContain('@alice');
    expect(container.textContent).toContain('2 people you know vouched for them');
    expect(container.textContent).toContain('1 person you know vouched for them');

    // alice has a handle → a real, enabled profile link.
    const aliceLink = Array.from(container.querySelectorAll('a')).find((a) => a.getAttribute('href') === '/u/alice');
    expect(aliceLink).toBeTruthy();

    // B has no claimed handle yet → `/u/[handle]` would 404 on a raw address, so the
    // View action must be a disabled button, never a link to a broken profile page.
    const brokenLink = Array.from(container.querySelectorAll('a')).find((a) => a.getAttribute('href') === `/u/${B1}`);
    expect(brokenLink).toBeUndefined();
    const disabledButtons = Array.from(container.querySelectorAll('button')).filter((b) => b.disabled);
    expect(disabledButtons.length).toBeGreaterThan(0);
  });
});
