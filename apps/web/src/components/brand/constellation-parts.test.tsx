import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// JSX in this test file compiles to React.createElement; hand it the global the same way
// the other component tests in this repo do.
vi.stubGlobal('React', React);

import { useFrameloop } from './constellation-parts';

type Entry = { isIntersecting: boolean };

/** A controllable stand-in for the real IntersectionObserver: tests fire `trigger()`
 *  themselves instead of relying on an actual layout/scroll. */
class MockIntersectionObserver {
  static instances: MockIntersectionObserver[] = [];
  observe = vi.fn();
  disconnect = vi.fn();
  private callback: (entries: Entry[]) => void;

  constructor(callback: (entries: Entry[]) => void) {
    this.callback = callback;
    MockIntersectionObserver.instances.push(this);
  }

  trigger(isIntersecting: boolean) {
    this.callback([{ isIntersecting }]);
  }
}

function Harness({ reduced }: { reduced: boolean }) {
  const ref = React.useRef<HTMLDivElement>(null);
  const frameloop = useFrameloop(ref, reduced);
  return <div ref={ref} data-testid="probe" data-frameloop={frameloop} />;
}

describe('useFrameloop', () => {
  let container: HTMLDivElement;
  let root: Root;
  let originalIntersectionObserver: unknown;

  beforeEach(() => {
    MockIntersectionObserver.instances = [];
    originalIntersectionObserver = (globalThis as { IntersectionObserver?: unknown })
      .IntersectionObserver;
    (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver =
      MockIntersectionObserver;
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver =
      originalIntersectionObserver;
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  function render(reduced = false) {
    act(() => {
      root.render(<Harness reduced={reduced} />);
    });
  }

  function probe() {
    return container.querySelector('[data-testid="probe"]')?.getAttribute('data-frameloop');
  }

  it('renders "always" on first paint while visible and the tab is foregrounded', () => {
    render();
    // The very first render must not come out frozen: it should already read 'always',
    // not some placeholder that only resolves after an effect.
    expect(probe()).toBe('always');
  });

  it('switches to "never" once the container is scrolled offscreen, and back on return', () => {
    render();
    const io = MockIntersectionObserver.instances[0];
    expect(io).toBeDefined();

    act(() => io.trigger(false));
    expect(probe()).toBe('never');

    act(() => io.trigger(true));
    expect(probe()).toBe('always');
  });

  it('switches to "never" when the tab is backgrounded, independent of intersection', () => {
    render();
    const io = MockIntersectionObserver.instances[0];
    act(() => io.trigger(true)); // still on-screen

    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    expect(probe()).toBe('never');

    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    expect(probe()).toBe('always');
  });

  it('stays on "demand" for reduced motion regardless of visibility or tab state', () => {
    render(true);
    expect(probe()).toBe('demand');

    const io = MockIntersectionObserver.instances[0];
    act(() => io.trigger(true));
    expect(probe()).toBe('demand');

    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    expect(probe()).toBe('demand');
  });

  it('disconnects the IntersectionObserver and removes the visibilitychange listener on unmount', () => {
    render();
    const io = MockIntersectionObserver.instances[0];
    const removeSpy = vi.spyOn(document, 'removeEventListener');

    act(() => root.unmount());

    expect(io.disconnect).toHaveBeenCalledTimes(1);
    expect(removeSpy).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
  });

  it('does not throw and keeps rendering when IntersectionObserver is unavailable', () => {
    delete (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver;
    expect(() => render()).not.toThrow();
    // No observer means we can never learn the element is offscreen, so it must not be
    // left permanently frozen — it keeps the normal 'always' loop instead.
    expect(probe()).toBe('always');
  });
});
