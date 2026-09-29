import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as { React?: typeof React }).React = React;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { nav, focus } = vi.hoisted(() => ({ nav: { pathname: '/app' }, focus: { on: false } }));

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

import { AppTabs } from './app-tabs';

describe('AppTabs', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    focus.on = false;
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
});
