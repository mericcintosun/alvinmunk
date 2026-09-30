import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const { walletMock, toastMock, writeTextMock } = vi.hoisted(() => {
  const callable: ReturnType<typeof vi.fn> = vi.fn();
  return {
    walletMock: {
      profile: null as { handle: string; address: string; createdAt: number } | null,
      balance: null as string | null,
      disconnect: vi.fn(),
    },
    toastMock: Object.assign(callable, { success: vi.fn(), error: vi.fn() }),
    writeTextMock: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock('./wallet-provider', () => ({ useWallet: () => walletMock }));
vi.mock('sonner', () => ({ toast: toastMock }));
// A ref-forwarding stand-in for next/link, so refs and href behave like the real component.
vi.mock('next/link', () => ({
  default: React.forwardRef<HTMLAnchorElement, { href: string; children?: React.ReactNode }>(
    function Link({ href, children, ...rest }, ref) {
      return React.createElement('a', { href, ref, ...rest }, children);
    },
  ),
}));

import { ConnectButton } from './connect-button';

const HANDLE = 'damian';
const ADDRESS = 'GB3KJPLFUYN5VL6R3GU3EGCGVCKFDSD7BEDJ42TCGNGHOYE5Q6C4Z2O';
/** Comfortably past the component's typeahead window, so each key starts a fresh search. */
const TYPEAHEAD_GAP_MS = 5_000;

describe('ConnectButton account menu (WAI-ARIA menu button)', () => {
  let container: HTMLDivElement;
  let root: Root;
  let now: number;

  beforeEach(() => {
    walletMock.profile = { handle: HANDLE, address: ADDRESS, createdAt: 0 };
    walletMock.balance = '12.5';

    now = 1_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: writeTextMock },
      configurable: true,
    });

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  const render = async () => {
    await act(async () => {
      root.render(<ConnectButton />);
    });
  };

  const trigger = () => container.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')!;
  const menu = () => container.querySelector<HTMLElement>('[role="menu"]');
  const items = () => Array.from(container.querySelectorAll<HTMLElement>('[role="menuitem"]'));
  const activeName = () => document.activeElement?.textContent?.trim() ?? null;
  const itemNames = () => items().map((el) => el.textContent!.trim());

  /** Press a key on `target`, the way a browser delivers it to the focused element. */
  const press = async (target: Element, key: string) => {
    await act(async () => {
      target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
    });
  };

  /** Press a key after the typeahead window, so it starts a new search. */
  const pressAfterGap = async (target: Element, key: string) => {
    now += TYPEAHEAD_GAP_MS;
    await press(target, key);
  };

  /** Open the menu the way a mouse user does: one activation click on the trigger. */
  const openWithClick = async () => {
    await render();
    await act(async () => {
      trigger().click();
    });
  };

  it('exposes the menu button contract on the trigger', async () => {
    await render();
    const button = trigger();

    expect(button.getAttribute('aria-haspopup')).toBe('menu');
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(menu()).toBeNull();
  });

  it('opens on click and moves focus to the first item', async () => {
    await openWithClick();

    expect(trigger().getAttribute('aria-expanded')).toBe('true');
    expect(itemNames()).toEqual(['Dashboard', 'View profile', 'Copy address', 'Disconnect']);
    expect(document.activeElement).toBe(items()[0]);
  });

  it('leads with a Dashboard link back to /app that closes the menu (#472)', async () => {
    const onNavigate = vi.fn();
    await act(async () => {
      root.render(<ConnectButton onNavigate={onNavigate} />);
    });
    await act(async () => {
      trigger().click();
    });

    const dashboard = items()[0];
    expect(dashboard.tagName).toBe('A');
    expect(dashboard.getAttribute('href')).toBe('/app');
    dashboard.addEventListener('click', (e) => e.preventDefault()); // jsdom cannot navigate
    await press(dashboard, 'Enter');
    expect(onNavigate).toHaveBeenCalledTimes(1);
    expect(menu()).toBeNull();
    expect(document.activeElement).toBe(trigger());
  });

  it('points aria-controls at the open menu and labels it from the trigger', async () => {
    await openWithClick();

    expect(trigger().getAttribute('aria-controls')).toBe(menu()!.id);
    expect(menu()!.getAttribute('aria-labelledby')).toBe(trigger().id);
  });

  it('keeps only menu items and separators inside role="menu"', async () => {
    await openWithClick();

    // The address/balance block is information, not an item, so it lives outside the menu.
    expect(menu()!.textContent).not.toContain('XLM');
    const childRoles = Array.from(menu()!.children).map((child) => child.getAttribute('role'));
    expect(childRoles.filter(Boolean)).toEqual(['menuitem', 'menuitem', 'menuitem', 'separator', 'menuitem']);
  });

  it('opens with ArrowDown on the first item and ArrowUp on the last', async () => {
    await render();
    act(() => trigger().focus());

    await press(trigger(), 'ArrowDown');
    expect(menu()).not.toBeNull();
    expect(document.activeElement).toBe(items()[0]);

    await press(items()[0], 'Escape');
    act(() => trigger().focus());
    await press(trigger(), 'ArrowUp');
    expect(document.activeElement).toBe(items()[3]);
  });

  it('wraps ArrowDown and ArrowUp around the ends', async () => {
    await openWithClick();
    expect(activeName()).toBe('Dashboard');

    await press(document.activeElement!, 'ArrowDown');
    expect(activeName()).toBe('View profile');
    await press(document.activeElement!, 'ArrowDown');
    expect(activeName()).toBe('Copy address');
    await press(document.activeElement!, 'ArrowDown');
    expect(activeName()).toBe('Disconnect');
    await press(document.activeElement!, 'ArrowDown');
    expect(activeName()).toBe('Dashboard');

    await press(document.activeElement!, 'ArrowUp');
    expect(activeName()).toBe('Disconnect');
    await press(document.activeElement!, 'ArrowUp');
    expect(activeName()).toBe('Copy address');
  });

  it('jumps to the first and last item with Home and End', async () => {
    await openWithClick();

    await press(document.activeElement!, 'End');
    expect(activeName()).toBe('Disconnect');
    await press(document.activeElement!, 'Home');
    expect(activeName()).toBe('Dashboard');
  });

  it('keeps a roving tabindex so the menu stays a single tab stop', async () => {
    await openWithClick();
    expect(items().map((el) => el.tabIndex)).toEqual([0, -1, -1, -1]);

    await press(document.activeElement!, 'ArrowDown');
    expect(items().map((el) => el.tabIndex)).toEqual([-1, 0, -1, -1]);
    expect(document.activeElement).toBe(items()[1]);

    await press(document.activeElement!, 'End');
    expect(items().map((el) => el.tabIndex)).toEqual([-1, -1, -1, 0]);
  });

  it('jumps to an item by the letters of its name', async () => {
    await openWithClick();

    await pressAfterGap(document.activeElement!, 'd');
    expect(activeName()).toBe('Disconnect');
    await pressAfterGap(document.activeElement!, 'c');
    expect(activeName()).toBe('Copy address');
    await pressAfterGap(document.activeElement!, 'v');
    expect(activeName()).toBe('View profile');
    // Two items start with "d": the search moves on from the focused one and wraps.
    await pressAfterGap(document.activeElement!, 'd');
    expect(activeName()).toBe('Disconnect');
    await pressAfterGap(document.activeElement!, 'd');
    expect(activeName()).toBe('Dashboard');
  });

  it('reads keys typed close together as one search', async () => {
    await openWithClick();

    await press(document.activeElement!, 'v');
    expect(activeName()).toBe('View profile');
    await press(document.activeElement!, 'i'); // "vi" still means "View profile"
    expect(activeName()).toBe('View profile');
  });

  it('leaves focus alone when a typed character matches no item', async () => {
    await openWithClick();

    await pressAfterGap(document.activeElement!, 'z');
    expect(activeName()).toBe('Dashboard');
  });

  it('activates the focused item with Enter and hands focus back to the trigger', async () => {
    await openWithClick();

    await press(document.activeElement!, 'ArrowDown');
    await press(document.activeElement!, 'ArrowDown'); // Copy address
    expect(activeName()).toBe('Copy address');

    await press(document.activeElement!, 'Enter');

    expect(writeTextMock).toHaveBeenCalledTimes(1);
    expect(writeTextMock).toHaveBeenCalledWith(ADDRESS);
    expect(toastMock.success).toHaveBeenCalledWith('Address copied');
    expect(menu()).toBeNull();
    expect(document.activeElement).toBe(trigger());
  });

  it('activates the focused item with Space exactly once', async () => {
    await openWithClick();

    await press(document.activeElement!, 'End'); // Disconnect
    await press(document.activeElement!, ' ');

    expect(walletMock.disconnect).toHaveBeenCalledTimes(1);
    expect(menu()).toBeNull();
  });

  it('closes on Escape and returns focus to the trigger', async () => {
    await openWithClick();

    await press(items()[0], 'ArrowDown');
    await press(document.activeElement!, 'Escape');

    expect(menu()).toBeNull();
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(trigger());
  });

  it('closes when focus moves out of the menu', async () => {
    await openWithClick();

    const outside = document.createElement('button');
    document.body.appendChild(outside);
    act(() => outside.focus());

    expect(menu()).toBeNull();
    expect(document.activeElement).toBe(outside);
    outside.remove();
  });

  it('stays open while focus moves between its own items', async () => {
    await openWithClick();

    act(() => items()[3].focus());

    expect(menu()).not.toBeNull();
  });

  it('closes on a click outside the menu', async () => {
    await openWithClick();

    act(() => {
      document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });

    expect(menu()).toBeNull();
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
  });

  it('closes when the trigger is clicked again and keeps focus on it', async () => {
    await openWithClick();

    await act(async () => {
      trigger().click();
    });

    expect(menu()).toBeNull();
    expect(document.activeElement).toBe(trigger());
  });
});
