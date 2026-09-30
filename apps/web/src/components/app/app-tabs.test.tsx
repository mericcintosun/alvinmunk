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
// A plain anchor that forwards every prop (and its ref, as next/link does), so ARIA attributes
// reach the DOM and the active pill can be scrolled to.
vi.mock('next/link', () => ({
  default: React.forwardRef<HTMLAnchorElement, { href: string; children: React.ReactNode }>(function Link(
    { href, children, ...rest },
    ref,
  ) {
    return (
      <a href={href} ref={ref} {...rest}>
        {children}
      </a>
    );
  }),
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

  it('leaves room inside the scroll box for the global focus ring (#502)', async () => {
    await currentAt('/app');
    const scroller = container.querySelector('a[href="/app"]')!.parentElement!;
    // overflow-x-auto clips anything past the padding box; the ring sits 2px out and is 2px
    // wide, so the box pads 4px (p-1) and a -m-1 keeps the tabs where they were.
    for (const c of ['overflow-x-auto', 'p-1', '-m-1']) expect(scroller.classList).toContain(c);
    // The tabs themselves pick no ring colour of their own.
    for (const a of Array.from(scroller.querySelectorAll('a'))) {
      expect(a.className).not.toMatch(/focus-visible:(ring|outline)/);
    }
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
      expect(container.querySelector('[data-testid="inbox-dot-mirror"]')).toBeNull();
    });

    it('is mirrored on Home for phones, where the Inbox pill can be scrolled away (#473)', async () => {
      wallet.profile = { address: 'GME' };
      loadInboxMock.mockResolvedValue({ items: [], unread: new Set(['tip:1']) });
      await currentAt('/app/people');
      const mirror = container.querySelector('a[href="/app"] [data-testid="inbox-dot-mirror"]');
      expect(mirror).not.toBeNull();
      // Phone-only and silent: the announced dot stays on the Inbox pill.
      expect(mirror!.classList).toContain('sm:hidden');
      expect(mirror!.getAttribute('aria-hidden')).toBe('true');
      expect(container.querySelector('a[href="/app/inbox"] [data-testid="inbox-dot"]')).not.toBeNull();

      await act(async () => window.dispatchEvent(new Event('alvinmunk:inbox-read')));
      expect(container.querySelector('[data-testid="inbox-dot-mirror"]')).toBeNull();
    });
  });

  describe('on a phone-width strip (#473)', () => {
    /** Lays the strip out as `width` px showing pills of `pill` px each (4px gaps), scrolled to `left`. */
    let layout = { width: 272, pill: 40, left: 0 };
    let scrollTo: ReturnType<typeof vi.fn>;
    let reduced = false;
    const strip = () => container.querySelector<HTMLElement>('nav .overflow-x-auto')!;
    const fade = (side: 'left' | 'right') => container.querySelector(`[data-testid="tabs-fade-${side}"]`)!;

    beforeEach(() => {
      layout = { width: 272, pill: 40, left: 0 };
      reduced = false;
      scrollTo = vi.fn();
      const rect = (x: number, w: number) => ({ left: x, right: x + w, x, y: 0, top: 0, bottom: 36, width: w, height: 36 }) as DOMRect;
      vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
        if (this === strip()) return rect(0, layout.width);
        const i = [...strip().children].indexOf(this);
        return rect(i * (layout.pill + 4) - layout.left, layout.pill);
      });
      vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockImplementation(function (this: HTMLElement) {
        return this.children.length * (layout.pill + 4) - 4;
      });
      vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => layout.width);
      vi.spyOn(HTMLElement.prototype, 'scrollLeft', 'get').mockImplementation(() => layout.left);
      HTMLElement.prototype.scrollTo = scrollTo as unknown as HTMLElement['scrollTo'];
      HTMLElement.prototype.scrollIntoView = vi.fn();
      window.matchMedia = vi.fn().mockImplementation(() => ({ matches: reduced })) as unknown as typeof window.matchMedia;
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('goes icon-only below sm and keeps every label for screen readers', async () => {
      await currentAt('/app');
      for (const a of container.querySelectorAll('nav a')) {
        const label = a.querySelector('span')!;
        expect([...label.classList]).toEqual(['sr-only', 'sm:not-sr-only']);
        expect(label.textContent).toBeTruthy();
      }
    });

    it('scrolls the strip (never the page) to bring the active pill clear of the fades', async () => {
      // 7 pills of 40px = 304px in a 272px strip: Inbox (the last) is past the right edge.
      await currentAt('/app/inbox');
      expect(scrollTo).toHaveBeenCalledTimes(1);
      // Clamped to the end of the strip (304 - 272), smoothly.
      expect(scrollTo).toHaveBeenCalledWith({ left: 32, behavior: 'smooth' });
      expect(HTMLElement.prototype.scrollIntoView).not.toHaveBeenCalled();
    });

    it('jumps instead of gliding under reduced motion, and leaves a visible pill alone', async () => {
      reduced = true;
      await currentAt('/app/people');
      // People (the sixth pill, 220–260px) clears the right fade at scrollLeft 20.
      expect(scrollTo).toHaveBeenLastCalledWith({ left: 20, behavior: 'auto' });

      scrollTo.mockClear();
      await currentAt('/app/vouch'); // the second pill: already on screen at scrollLeft 0
      expect(scrollTo).not.toHaveBeenCalled();
    });

    it('shows an edge fade only where more pills sit past the edge', async () => {
      await currentAt('/app');
      expect(fade('left').classList).toContain('opacity-0');
      expect(fade('right').classList).toContain('opacity-100');
      expect(fade('right').classList).toContain('sm:hidden');

      layout.left = 32; // scrolled to the end
      await act(async () => strip().dispatchEvent(new Event('scroll')));
      expect(fade('left').classList).toContain('opacity-100');
      expect(fade('right').classList).toContain('opacity-0');
    });

    it('shows no fades when every pill fits', async () => {
      layout.width = 400;
      await currentAt('/app/inbox');
      expect(fade('left').classList).toContain('opacity-0');
      expect(fade('right').classList).toContain('opacity-0');
      expect(scrollTo).not.toHaveBeenCalled();
    });
  });
});
