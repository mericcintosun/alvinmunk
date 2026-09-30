import { afterEach, describe, expect, it, vi } from 'vitest';
import { SCROLL_LOCK_EVENT, isScrollLocked, lockScroll } from './scroll-lock';

describe('scroll lock (#489)', () => {
  const events = vi.fn();
  window.addEventListener(SCROLL_LOCK_EVENT, events);

  afterEach(() => {
    events.mockClear();
    document.body.style.overflow = '';
  });

  it('hides the body overflow while held and restores what was there before', () => {
    document.body.style.overflow = 'scroll';
    const unlock = lockScroll();
    expect(isScrollLocked()).toBe(true);
    expect(document.body.style.overflow).toBe('hidden');
    unlock();
    expect(isScrollLocked()).toBe(false);
    expect(document.body.style.overflow).toBe('scroll');
  });

  it('is counted: a nested lock releases the page only when the last one goes', () => {
    const outer = lockScroll();
    const inner = lockScroll();
    expect(events).toHaveBeenCalledTimes(1); // only the first lock announces itself
    inner();
    expect(isScrollLocked()).toBe(true);
    expect(document.body.style.overflow).toBe('hidden');
    expect(events).toHaveBeenCalledTimes(1);
    outer();
    expect(isScrollLocked()).toBe(false);
    expect(document.body.style.overflow).toBe('');
    expect(events).toHaveBeenCalledTimes(2);
  });

  it('ignores a second call of the same unlock', () => {
    const outer = lockScroll();
    const inner = lockScroll();
    inner();
    inner(); // would otherwise release the outer lock too
    expect(isScrollLocked()).toBe(true);
    outer();
    expect(isScrollLocked()).toBe(false);
  });
});
