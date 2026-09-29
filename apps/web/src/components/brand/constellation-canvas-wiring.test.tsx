import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Smoke-tests that each canvas actually wires the shared `useFrameloop` result into its
 * <Canvas frameloop={...}> prop (as opposed to unit-testing the hook in isolation, which
 * constellation-parts.test.tsx already covers). Neither three.js nor WebGL exists in
 * jsdom, so `@react-three/fiber`/`@react-three/drei` are mocked out entirely: the mock
 * <Canvas> records the props it was given and renders no children, so nothing under it
 * (Scene, InvalidateBridge, Stars, Line, Html) ever has to actually run.
 */
vi.stubGlobal('React', React);

const canvasPropsMock = vi.fn();

vi.mock('@react-three/fiber', () => ({
  Canvas: (props: Record<string, unknown>) => {
    canvasPropsMock(props);
    return React.createElement('div', {
      'data-testid': 'canvas',
      'data-frameloop': String(props.frameloop),
    });
  },
  useFrame: () => {},
  useThree: () => ({ invalidate: () => {} }),
}));

vi.mock('@react-three/drei', () => ({
  Stars: () => null,
  Html: () => null,
  Line: () => null,
}));

const { fetchVouchersOfMock, getPeopleCountsMock } = vi.hoisted(() => ({
  fetchVouchersOfMock: vi.fn(),
  getPeopleCountsMock: vi.fn(),
}));

vi.mock('@/lib/constellation', () => ({
  fetchVouchersOf: fetchVouchersOfMock,
  getPeopleCounts: getPeopleCountsMock,
  timeAgo: () => '',
  addrHue: () => 0,
}));

class MockIntersectionObserver {
  static instances: MockIntersectionObserver[] = [];
  observe = vi.fn();
  disconnect = vi.fn();
  private callback: (entries: { isIntersecting: boolean }[]) => void;
  constructor(callback: (entries: { isIntersecting: boolean }[]) => void) {
    this.callback = callback;
    MockIntersectionObserver.instances.push(this);
  }
  trigger(isIntersecting: boolean) {
    this.callback([{ isIntersecting }]);
  }
}

import ConstellationHero3D from './constellation-3d';
import ConstellationBackdrop from './constellation-backdrop';

describe('canvas frameloop wiring', () => {
  let container: HTMLDivElement;
  let root: Root;
  let originalIntersectionObserver: unknown;
  // usePrefersReducedMotion subscribes to changes, so the stub needs the listener API too.
  const mediaQuery = (matches: boolean) => ({
    matches,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
  let matchMediaMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // The source files use the classic JSX transform without importing React themselves;
    // vi.unstubAllGlobals() in afterEach wipes a module-level stub, so it has to be redone
    // every test (matches the pattern in app-client-layout.test.tsx).
    vi.stubGlobal('React', React);
    MockIntersectionObserver.instances = [];
    originalIntersectionObserver = (globalThis as { IntersectionObserver?: unknown })
      .IntersectionObserver;
    (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver =
      MockIntersectionObserver;

    matchMediaMock = vi.fn().mockReturnValue(mediaQuery(false));
    vi.stubGlobal('matchMedia', matchMediaMock);

    fetchVouchersOfMock.mockResolvedValue([]);
    getPeopleCountsMock.mockResolvedValue({ vouchedBy: 0 });

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver =
      originalIntersectionObserver;
    canvasPropsMock.mockClear();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it('ConstellationHero3D starts with frameloop="always" and switches to "never" offscreen', () => {
    act(() => {
      root.render(<ConstellationHero3D address={'G'.padEnd(56, 'A')} handle="alice" />);
    });

    expect(container.querySelector('[data-frameloop]')?.getAttribute('data-frameloop')).toBe(
      'always',
    );

    const io = MockIntersectionObserver.instances[0];
    act(() => io.trigger(false));
    expect(container.querySelector('[data-frameloop]')?.getAttribute('data-frameloop')).toBe(
      'never',
    );
  });

  it('ConstellationHero3D uses frameloop="demand" when prefers-reduced-motion is set', () => {
    matchMediaMock.mockReturnValue(mediaQuery(true));
    act(() => {
      root.render(<ConstellationHero3D address={'G'.padEnd(56, 'B')} handle="bob" />);
    });
    expect(container.querySelector('[data-frameloop]')?.getAttribute('data-frameloop')).toBe(
      'demand',
    );
  });

  it('ConstellationBackdrop starts with frameloop="always" and switches to "never" offscreen', () => {
    act(() => {
      root.render(<ConstellationBackdrop />);
    });

    expect(container.querySelector('[data-frameloop]')?.getAttribute('data-frameloop')).toBe(
      'always',
    );

    const io = MockIntersectionObserver.instances[0];
    act(() => io.trigger(false));
    expect(container.querySelector('[data-frameloop]')?.getAttribute('data-frameloop')).toBe(
      'never',
    );
  });

  it('ConstellationBackdrop uses frameloop="demand" when prefers-reduced-motion is set', () => {
    matchMediaMock.mockReturnValue(mediaQuery(true));
    act(() => {
      root.render(<ConstellationBackdrop />);
    });
    expect(container.querySelector('[data-frameloop]')?.getAttribute('data-frameloop')).toBe(
      'demand',
    );
  });
});
