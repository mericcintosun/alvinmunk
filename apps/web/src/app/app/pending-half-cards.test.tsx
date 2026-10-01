import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as { React?: typeof React }).React = React;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Only the first-star nudge and the pending half-cards render for real: a new user with
// nothing minted and nothing pending (#475).
vi.mock('@/lib/myvouches', () => ({ getMyVouches: () => [], getPendingVouches: () => Promise.resolve([]) }));
vi.mock('@/components/wallet/wallet-provider', () => ({
  useWallet: () => ({ profile: { handle: 'me', address: 'GME', createdAt: 1 } }),
}));
vi.mock('next/dynamic', () => ({ default: () => () => null }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('@/components/InviteNudge', () => ({ InviteNudge: () => null }));
vi.mock('@/components/OwedBonuses', () => ({ OwedBonuses: () => null }));
vi.mock('@/components/ActivityFeed', () => ({ ActivityFeed: () => null }));
vi.mock('@/components/VouchCompose', () => ({ VouchCompose: () => null }));

import AppHome from './page';
import VouchPage from './vouch/page';

describe('pending half-cards with none waiting (#475)', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    localStorage.clear();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  async function render(ui: React.ReactElement) {
    await act(async () => {
      root.render(ui);
      await Promise.resolve();
    });
  }

  it('renders no pending frame on /app home, where the nudge links to the vouch form', async () => {
    await render(<AppHome />);
    expect(container.textContent).not.toContain('pending // awaiting_claim');
    expect(container.textContent).not.toContain('No half-cards waiting');
    expect(container.querySelector('a[href="/app/vouch"]')?.textContent).toContain('light your first star');
  });

  it('keeps the empty state on /app/vouch', async () => {
    await render(<VouchPage />);
    expect(container.textContent).toContain('pending // awaiting_claim');
    expect(container.textContent).toContain('No half-cards waiting');
  });
});
