import React, { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Dialog } from './dialog';
import { SCROLL_LOCK_EVENT, isScrollLocked } from '@/lib/scroll-lock';

(globalThis as { React?: typeof React }).React = React;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function Harness({ nested = false }: { nested?: boolean }) {
  const [outer, setOuter] = useState(true);
  const [inner, setInner] = useState(nested);
  return (
    <>
      <Dialog open={outer} onClose={() => setOuter(false)} labelledBy="outer-title">
        <h2 id="outer-title">Outer</h2>
        <button id="close-outer" onClick={() => setOuter(false)}>
          Close
        </button>
      </Dialog>
      <Dialog open={inner} onClose={() => setInner(false)} labelledBy="inner-title">
        <h2 id="inner-title">Inner</h2>
        <button id="close-inner" onClick={() => setInner(false)}>
          Close inner
        </button>
      </Dialog>
    </>
  );
}

describe('Dialog on short screens and scroll (#489)', () => {
  let container: HTMLDivElement;
  let root: Root;
  const lockEvents = vi.fn();

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    window.addEventListener(SCROLL_LOCK_EVENT, lockEvents);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    window.removeEventListener(SCROLL_LOCK_EVENT, lockEvents);
    lockEvents.mockReset();
    document.body.style.overflow = '';
  });

  const click = (sel: string) => act(() => (container.querySelector(sel) as HTMLButtonElement).click());

  it('lets a tall panel scroll inside the viewport instead of clipping it', async () => {
    await act(async () => root.render(<Harness />));
    const panel = container.querySelector<HTMLElement>('[role="dialog"]')!;
    const overlay = panel.parentElement!;
    // The overlay can scroll and no longer centres with items-center (which pushes the top
    // of a too-tall panel above the viewport); the panel centres with my-auto instead.
    expect(overlay.classList).toContain('overflow-y-auto');
    expect(overlay.classList).not.toContain('items-center');
    for (const c of ['my-auto', 'max-h-[calc(100dvh-2rem)]', 'overflow-y-auto', 'overscroll-contain']) {
      expect(panel.classList).toContain(c);
    }
    // Lenis leaves wheel and touch inside the panel to native scrolling.
    expect(panel.hasAttribute('data-lenis-prevent')).toBe(true);
  });

  it('locks the page while open and releases it on close', async () => {
    document.body.style.overflow = 'auto';
    await act(async () => root.render(<Harness />));
    expect(isScrollLocked()).toBe(true);
    expect(document.body.style.overflow).toBe('hidden');
    expect(lockEvents).toHaveBeenCalledTimes(1);
    click('#close-outer');
    expect(isScrollLocked()).toBe(false);
    expect(document.body.style.overflow).toBe('auto');
    expect(lockEvents).toHaveBeenCalledTimes(2);
  });

  it('keeps the page locked until the last of two open dialogs closes', async () => {
    await act(async () => root.render(<Harness nested />));
    expect(container.querySelectorAll('[role="dialog"]')).toHaveLength(2);
    click('#close-inner');
    expect(isScrollLocked()).toBe(true);
    expect(document.body.style.overflow).toBe('hidden');
    click('#close-outer');
    expect(isScrollLocked()).toBe(false);
    expect(document.body.style.overflow).toBe('');
  });

  it('releases the lock when the dialog unmounts while open', async () => {
    await act(async () => root.render(<Harness />));
    act(() => root.unmount());
    root = createRoot(container);
    expect(isScrollLocked()).toBe(false);
    expect(document.body.style.overflow).toBe('');
  });

  it('still moves focus in, traps Tab and closes on Escape', async () => {
    await act(async () => root.render(<Harness />));
    const close = container.querySelector<HTMLButtonElement>('#close-outer')!;
    expect(document.activeElement).toBe(close);
    await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', cancelable: true })));
    expect(document.activeElement).toBe(close); // the only focusable wraps to itself
    await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true })));
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(isScrollLocked()).toBe(false);
  });
});
