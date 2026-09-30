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
  getScoresMock,
} = vi.hoisted(() => ({
  store: { profile: { address: 'G'.padEnd(56, 'M'), handle: 'me', createdAt: 1 } as { address: string } | null },
  fetchEventsMock: vi.fn(),
  suggestPeopleMock: vi.fn(),
  reverseHandlesMock: vi.fn(),
  resolveHandleMock: vi.fn(),
  getScoresMock: vi.fn(),
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
vi.mock('@/lib/reputation', () => ({ getScores: getScoresMock }));
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
    // The link IS the button (#487): one tab stop, no <button> nested in the <a>.
    expect(aliceLink!.querySelector('button')).toBeNull();
    expect(aliceLink!.className).toContain('rounded-full');
    expect(aliceLink!.getAttribute('aria-label')).toBeTruthy();
    expect(container.querySelector('a button')).toBeNull();

    // B has no claimed handle yet → `/u/[handle]` would 404 on a raw address, so the card
    // opens B's reputation at /score/<address> instead of a dead, disabled button (#486).
    const brokenLink = Array.from(container.querySelectorAll('a')).find((a) => a.getAttribute('href') === `/u/${B1}`);
    expect(brokenLink).toBeUndefined();
    const scoreLink = Array.from(container.querySelectorAll('a')).find((a) => a.getAttribute('href') === `/score/${B1}`);
    expect(scoreLink).toBeTruthy();
    expect(scoreLink!.textContent).toContain('View reputation');
    // The accessible name carries the short address, since there is no handle to name.
    expect(scoreLink!.getAttribute('aria-label')).toBe("View GBBBBB…BBBB's reputation");
    expect(aliceLink!.getAttribute('aria-label')).toBe("View @alice's profile");
    // Every suggestion card has a working link; nothing is left disabled.
    expect(Array.from(container.querySelectorAll('button')).filter((b) => b.disabled && b.closest('.rounded-xl'))).toEqual(
      [],
    );
    expect(container.querySelectorAll('a[href^="/u/"], a[href^="/score/"]')).toHaveLength(2);
  });
});

describe('PeoplePage search result', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    store.profile = { address: ME };
    fetchEventsMock.mockReset().mockResolvedValue([]);
    suggestPeopleMock.mockReset().mockReturnValue([]);
    reverseHandlesMock.mockReset().mockResolvedValue({});
    resolveHandleMock.mockReset().mockResolvedValue(A1);
    getScoresMock.mockReset().mockResolvedValue({ social: 1234, earned: 56_789 });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  async function searchFor(term: string) {
    await act(async () => root.render(<PeoplePage />));
    const input = container.querySelector<HTMLInputElement>('input[aria-label="Search users by handle"]')!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      setter.call(input, term);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      input.form!.requestSubmit();
      for (let i = 0; i < 5; i++) await Promise.resolve();
    });
  }

  it('renders the Vouch CTA as a single link styled as the button (#487)', async () => {
    await searchFor('alice');
    expect(resolveHandleMock).toHaveBeenCalledWith('alice');
    const vouch = container.querySelector<HTMLAnchorElement>('a[href="/app/vouch"]');
    expect(vouch).not.toBeNull();
    expect(vouch!.textContent).toContain('Vouch');
    expect(vouch!.querySelector('button')).toBeNull();
    // Same look as the old <Button variant="flow" size="sm">: the variant classes sit on the link.
    for (const c of ['flow', 'rounded-full', 'h-9', 'gap-1.5']) expect(vouch!.classList).toContain(c);
    expect(container.querySelector('a button')).toBeNull();
  });

  it('shows the scores with the locale digit grouping (#493)', async () => {
    await searchFor('@alice');
    expect(container.textContent).toContain('1,234 Social');
    expect(container.textContent).toContain('56,789 Earned');
  });
});
