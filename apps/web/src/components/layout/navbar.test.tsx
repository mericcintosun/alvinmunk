import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The navbar and its children rely on Next's automatic JSX runtime; this vitest setup
// compiles JSX to `React.createElement`, so give them a global React to resolve.
(globalThis as { React?: typeof React }).React = React;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { nav, wallet } = vi.hoisted(() => ({
  nav: { pathname: '/' },
  wallet: {
    profile: null as { handle: string; address: string; createdAt: number } | null,
    balance: null as string | null,
    disconnect: vi.fn(),
  },
}));

vi.mock('next/navigation', () => ({ usePathname: () => nav.pathname }));
// A plain anchor that forwards every prop (and its ref), so ARIA attributes reach the DOM as
// they would (jsdom cannot navigate, so a click only runs the link's own handler).
vi.mock('next/link', () => ({
  default: React.forwardRef<
    HTMLAnchorElement,
    { href: string; children: React.ReactNode; onClick?: (e: React.MouseEvent) => void }
  >(function Link({ href, children, onClick, ...rest }, ref) {
    return (
      <a
        href={href}
        ref={ref}
        {...rest}
        onClick={(e) => {
          e.preventDefault();
          onClick?.(e);
        }}
      >
        {children}
      </a>
    );
  }),
}));
// The real ConnectButton renders inside the mobile panel, so the tests exercise how its clicks
// interact with the panel; only the wallet behind it is stubbed.
vi.mock('@/components/wallet/wallet-provider', () => ({ useWallet: () => wallet }));
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));

import { Navbar } from './navbar';
import { THEME_KEY } from '@/components/theme-toggle';

describe('Navbar', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    nav.pathname = '/';
    wallet.profile = null;
    wallet.disconnect.mockClear();
    localStorage.clear();
    document.documentElement.className = 'dark';
    window.matchMedia = vi.fn().mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  async function mount() {
    await act(async () => root.render(<Navbar />));
  }
  const menuButton = () =>
    container.querySelector<HTMLButtonElement>('button[aria-controls="mobile-nav"]')!;
  const panel = () => document.getElementById('mobile-nav');
  const openPanel = async () => {
    await act(async () => menuButton().click());
    expect(panel()).not.toBeNull();
    return panel()!;
  };
  const current = (scope: ParentNode) =>
    Array.from(scope.querySelectorAll('a[aria-current]')).map((a) => [
      a.getAttribute('href'),
      a.getAttribute('aria-current'),
    ]);

  it('marks only the active desktop link as the current page', async () => {
    nav.pathname = '/leaderboard';
    await mount();
    expect(current(container)).toEqual([['/leaderboard', 'page']]);
  });

  it('marks no link as current off the nav routes', async () => {
    nav.pathname = '/app';
    await mount();
    expect(current(container)).toEqual([]);
  });

  it('exposes the mobile menu state and the panel it controls', async () => {
    nav.pathname = '/stats';
    await mount();
    const button = menuButton();
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(button.getAttribute('aria-label')).toBe('Open menu');
    expect(document.getElementById('mobile-nav')).toBeNull();

    await act(async () => button.click());
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(button.getAttribute('aria-label')).toBe('Close menu');
    const panel = document.getElementById('mobile-nav')!;
    expect(panel).not.toBeNull();
    expect(current(panel)).toEqual([['/stats', 'page']]);

    // Following a link closes the panel again.
    await act(async () => panel.querySelector<HTMLAnchorElement>('a[href="/wallet"]')!.click());
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(document.getElementById('mobile-nav')).toBeNull();
  });

  it('keeps the theme toggle working beside the menu button', async () => {
    await mount();
    const toggle = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Switch to light theme"]',
    )!;
    expect(toggle).not.toBeNull();

    await act(async () => toggle.click());
    expect(document.documentElement.classList.contains('light')).toBe(true);
    expect(localStorage.getItem(THEME_KEY)).toBe('light');
    expect(toggle.getAttribute('aria-label')).toBe('Switch to dark theme');
    // The theme toggle does not open the mobile menu.
    expect(menuButton().getAttribute('aria-expanded')).toBe('false');
  });

  it('keeps the panel open while a signed-in user uses the account menu', async () => {
    wallet.profile = { handle: 'damian', address: 'G'.padEnd(56, 'A'), createdAt: 0 };
    await mount();
    const mobile = await openPanel();

    // Tapping the account chip opens its menu instead of unmounting the whole panel.
    await act(async () => mobile.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')!.click());
    expect(panel()).not.toBeNull();
    const disconnect = Array.from(mobile.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')).find(
      (el) => el.textContent?.includes('Disconnect'),
    );
    expect(disconnect).toBeDefined();

    await act(async () => disconnect!.click());
    expect(wallet.disconnect).toHaveBeenCalledTimes(1);
  });

  it('closes the panel when the account menu\'s View profile link is followed', async () => {
    wallet.profile = { handle: 'damian', address: 'G'.padEnd(56, 'A'), createdAt: 0 };
    await mount();
    const mobile = await openPanel();
    await act(async () => mobile.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')!.click());

    await act(async () => mobile.querySelector<HTMLAnchorElement>('a[href="/u/damian"]')!.click());
    expect(panel()).toBeNull();
  });

  it('closes the panel when the signed-out "Open app" link is followed', async () => {
    await mount();
    const mobile = await openPanel();

    await act(async () => mobile.querySelector<HTMLAnchorElement>('a[href="/app"]')!.click());
    expect(panel()).toBeNull();
    expect(menuButton().getAttribute('aria-expanded')).toBe('false');
  });

  it('closes the panel when a link to the current page is tapped', async () => {
    nav.pathname = '/stats';
    await mount();
    const mobile = await openPanel();

    // The route does not change, so only the link's own handler can close the panel.
    await act(async () => mobile.querySelector<HTMLAnchorElement>('a[href="/stats"]')!.click());
    expect(panel()).toBeNull();
  });

  it('closes the panel on a route change that no link click caused (back/forward)', async () => {
    await mount();
    await openPanel();

    nav.pathname = '/leaderboard';
    await mount();
    expect(panel()).toBeNull();
    expect(menuButton().getAttribute('aria-expanded')).toBe('false');
  });
});
