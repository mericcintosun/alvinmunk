import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The navbar and its children rely on Next's automatic JSX runtime; this vitest setup
// compiles JSX to `React.createElement`, so give them a global React to resolve.
(globalThis as { React?: typeof React }).React = React;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { nav } = vi.hoisted(() => ({ nav: { pathname: '/' } }));

vi.mock('next/navigation', () => ({ usePathname: () => nav.pathname }));
// A plain anchor that forwards every prop, so ARIA attributes reach the DOM as they would
// (jsdom cannot navigate, so a click only runs the link's own handler).
vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    onClick,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
    onClick?: (e: React.MouseEvent) => void;
  }) => (
    <a
      href={href}
      {...rest}
      onClick={(e) => {
        e.preventDefault();
        onClick?.(e);
      }}
    >
      {children}
    </a>
  ),
}));
vi.mock('@/components/wallet/connect-button', () => ({ ConnectButton: () => null }));

import { Navbar } from './navbar';
import { THEME_KEY } from '@/components/theme-toggle';

describe('Navbar', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    nav.pathname = '/';
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
});
