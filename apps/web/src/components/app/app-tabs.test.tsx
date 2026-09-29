import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as { React?: typeof React }).React = React;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { nav, focus, wallet, loadInboxMock } = vi.hoisted(() => ({
  nav: { pathname: '/app' },
  focus: { on: false },
  wallet: { profile: null as { address: string } | null },
  loadInboxMock: vi.fn(),
}));

vi.mock('next/navigation', () => ({ usePathname: () => nav.pathname }));
// A plain anchor that forwards every prop, so ARIA attributes reach the DOM as they would.
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('@/lib/focus', () => ({
  get FOCUS_MODE() {
    return focus.on;
  },
}));

vi.mock('@/components/wallet/wallet-provider', () => ({ useWallet: () => wallet }));
// What is unread is lib/inbox's call (tested there); the tab only shows it.
vi.mock('@/lib/inbox', () => ({ INBOX_READ_EVENT: 'alvinmunk:inbox-read', loadInbox: loadInboxMock }));

import { AppTabs } from './app-tabs';

describe('AppTabs', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    focus.on = false;
    wallet.profile = null;
    loadInboxMock.mockReset().mockResolvedValue({ items: [], unread: new Set() });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  async function currentAt(pathname: string) {
    nav.pathname = pathname;
    await act(async () => root.render(<AppTabs />));
    return Array.from(container.querySelectorAll('a[aria-current]')).map((a) => [
      a.getAttribute('href'),
      a.getAttribute('aria-current'),
    ]);
  }

  it.each([
    ['/app', '/app'],
    ['/app/vouch', '/app/vouch'],
    ['/app/quests', '/app/quests'],
    ['/app/rewards', '/app/rewards'],
    ['/app/activity', '/app/activity'],
    ['/app/people', '/app/people'],
    ['/app/inbox', '/app/inbox'],
  ])('on %s only the %s tab is the current page', async (pathname, tab) => {
    expect(await currentAt(pathname)).toEqual([[tab, 'page']]);
  });

  it('keeps a tab current on its nested routes, without the exact-match Home tab', async () => {
    expect(await currentAt('/app/vouch/draft')).toEqual([['/app/vouch', 'page']]);
  });

  it('marks nothing current when the route has no tab', async () => {
    focus.on = true;
    // Under focus mode the Quests tab is hidden, so its route has no current tab.
    expect(await currentAt('/app/quests')).toEqual([]);
  });

  describe('the inbox dot (#279)', () => {
    const dot = () => container.querySelector('[data-testid="inbox-dot"]');

    it('shows while the signed-in wallet has unread items, and clears when the inbox is read', async () => {
      wallet.profile = { address: 'GME' };
      loadInboxMock.mockResolvedValue({ items: [], unread: new Set(['tip:1', 'claim:2']) });
      await currentAt('/app');
      expect(loadInboxMock).toHaveBeenCalledWith('GME');
      expect(dot()).not.toBeNull();
      expect(container.querySelector('a[href="/app/inbox"]')?.textContent).toContain('New items in your inbox');

      await act(async () => window.dispatchEvent(new Event('alvinmunk:inbox-read')));
      expect(dot()).toBeNull();
    });

    it('stays off with nothing unread, when signed out, and on the inbox itself', async () => {
      await currentAt('/app');
      expect(dot()).toBeNull();
      expect(loadInboxMock).not.toHaveBeenCalled(); // signed out: no read at all

      wallet.profile = { address: 'GME' };
      loadInboxMock.mockResolvedValue({ items: [], unread: new Set(['tip:1']) });
      await currentAt('/app/inbox');
      expect(dot()).toBeNull();
    });
  });
});
