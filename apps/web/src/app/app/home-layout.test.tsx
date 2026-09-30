import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as { React?: typeof React }).React = React;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// The hero renders as its loading placeholder; the self-hiding sections stay out of the way.
vi.mock('next/dynamic', () => ({
  default: (_load: unknown, opts: { loading: () => React.ReactNode }) => () => opts.loading(),
}));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('@/components/wallet/wallet-provider', () => ({
  useWallet: () => ({ profile: { handle: 'alice', address: 'GALICE', createdAt: 0 } }),
}));
vi.mock('@/components/FirstStarNudge', () => ({ FirstStarNudge: () => <div data-testid="nudge" /> }));
vi.mock('@/components/InviteNudge', () => ({ InviteNudge: () => null }));
vi.mock('@/components/PendingHalfCards', () => ({ PendingHalfCards: () => null }));
vi.mock('@/components/OwedBonuses', () => ({ OwedBonuses: () => null }));
vi.mock('@/components/ActivityFeed', () => ({ ActivityFeed: () => null }));

import AppHome from './page';
import { HERO_BOX } from '@/components/brand/hero-box';

describe('/app home order (#474)', () => {
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
  });

  it('leads with the "What now" shortcuts on a phone and keeps the desktop order', async () => {
    await act(async () => root.render(<AppHome />));
    const sections = [...container.firstElementChild!.children];
    const shortcuts = sections.find((el) => el.querySelector('a[href="/app/vouch"]'))!;
    const hero = sections.find((el) => HERO_BOX.split(' ').every((c) => el.querySelector(`[class~="${c}"]`)))!;

    // Visual order below sm: the shortcuts first; from sm up (order-none) the source order,
    // which keeps the hero and the nudges above them as before.
    expect([...shortcuts.classList]).toEqual(['order-first', 'sm:order-none']);
    expect(sections.indexOf(hero)).toBe(0);
    expect(sections.indexOf(byTestId(sections, 'nudge'))).toBeLessThan(sections.indexOf(shortcuts));
  });
});

function byTestId(els: Element[], id: string) {
  return els.find((el) => el.getAttribute('data-testid') === id)!;
}
