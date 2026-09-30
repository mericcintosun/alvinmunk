import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as { React?: typeof React }).React = React;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const lenis = vi.hoisted(() => ({ stop: vi.fn(), start: vi.fn(), raf: vi.fn(), destroy: vi.fn() }));
vi.mock('lenis', () => ({
  default: vi.fn().mockImplementation(function () {
    return lenis;
  }),
}));
vi.mock('lenis/dist/lenis.css', () => ({}));

import { SmoothScroll } from './smooth-scroll';
import { lockScroll } from '@/lib/scroll-lock';

describe('SmoothScroll and the dialog scroll lock (#489)', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    Object.values(lenis).forEach((f) => f.mockClear());
    window.matchMedia = vi.fn().mockReturnValue({ matches: false }) as unknown as typeof window.matchMedia;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('pauses Lenis while a dialog holds the lock and resumes it after', async () => {
    await act(async () => root.render(<SmoothScroll />));
    lenis.stop.mockClear();
    lenis.start.mockClear();
    const unlock = lockScroll();
    expect(lenis.stop).toHaveBeenCalledTimes(1);
    unlock();
    expect(lenis.start).toHaveBeenCalledTimes(1);
  });

  it('starts paused when a dialog is already open', async () => {
    const unlock = lockScroll();
    try {
      await act(async () => root.render(<SmoothScroll />));
      expect(lenis.stop).toHaveBeenCalled();
    } finally {
      unlock();
    }
  });

  it('stops listening once unmounted', async () => {
    await act(async () => root.render(<SmoothScroll />));
    act(() => root.unmount());
    root = createRoot(container);
    expect(lenis.destroy).toHaveBeenCalled();
    lenis.stop.mockClear();
    lockScroll()();
    expect(lenis.stop).not.toHaveBeenCalled();
  });
});
