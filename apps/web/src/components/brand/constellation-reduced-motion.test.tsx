import { readFileSync } from 'node:fs';
import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The components under test are compiled to React.createElement by this vitest setup, and
// they only reference React while rendering, so a global is enough (same trick as og-card).
(globalThis as { React?: typeof React }).React = React;

/** Every useFrame callback the scenes register, in mount order. */
const frames: ((_: unknown, d: number) => void)[] = [];

vi.mock('@react-three/fiber', () => ({
  // No WebGL in jsdom: render the scene tree directly and hand the frame callbacks over so
  // the test can step them itself.
  Canvas: ({ children }: { children: React.ReactNode }) => children,
  useFrame: (cb: (state: unknown, d: number) => void) => {
    frames.push(cb);
  },
  useThree: () => ({ viewport: { width: 10, height: 10 }, size: { width: 1000, height: 800 } }),
}));

// The sky/line layers are the browser's job; they carry no motion logic of their own.
vi.mock('@react-three/drei', () => ({
  Stars: () => null,
  Line: () => null,
  Html: () => null,
}));

import { usePrefersReducedMotion } from './constellation-parts';
import ConstellationBackdrop from './constellation-backdrop';

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');

/** A controllable `matchMedia('(prefers-reduced-motion: reduce)')`, one list per call. */
function stubMatchMedia(initial: boolean) {
  const lists: Array<{
    matches: boolean;
    listeners: Set<(e: MediaQueryListEvent) => void>;
    removed: Set<(e: MediaQueryListEvent) => void>;
  }> = [];
  const original = window.matchMedia;
  window.matchMedia = ((query: string) => {
    const entry = {
      matches: query.includes('prefers-reduced-motion') ? initial : false,
      listeners: new Set<(e: MediaQueryListEvent) => void>(),
      removed: new Set<(e: MediaQueryListEvent) => void>(),
    };
    lists.push(entry);
    const mql = {
      get matches() {
        return entry.matches;
      },
      media: query,
      addEventListener: (_: string, l: (e: MediaQueryListEvent) => void) => entry.listeners.add(l),
      removeEventListener: (_: string, l: (e: MediaQueryListEvent) => void) => {
        entry.removed.add(l);
        entry.listeners.delete(l);
      },
    };
    return mql as unknown as MediaQueryList;
  }) as typeof window.matchMedia;
  return {
    lists,
    /** Flip the OS setting the way the browser does: update, then notify listeners. */
    set(matches: boolean) {
      for (const l of lists) {
        l.matches = matches;
        for (const fn of l.listeners) fn({ matches } as MediaQueryListEvent);
      }
    },
    restore: () => {
      window.matchMedia = original;
    },
  };
}

/** The star sprite texture is drawn on a 2D canvas jsdom does not implement. */
function stubCanvasContext() {
  const original = HTMLCanvasElement.prototype.getContext;
  const gradient = { addColorStop: () => {} };
  HTMLCanvasElement.prototype.getContext = (() => ({
    translate: () => {},
    createRadialGradient: () => gradient,
    beginPath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    closePath: () => {},
    fill: () => {},
    fillRect: () => {},
  })) as unknown as HTMLCanvasElement['getContext'];
  return () => {
    HTMLCanvasElement.prototype.getContext = original;
  };
}

/**
 * R3F normally hands `rotation`/`position`/`scale` to real three.js objects. Give the
 * stand-in DOM elements per-instance ones so the assertions see the same mutation surface.
 */
function stubTransforms() {
  const defs: Array<[string, () => object]> = [
    ['rotation', () => new THREE.Euler()],
    ['position', () => new THREE.Vector3()],
    ['scale', () => new THREE.Vector3()],
  ];
  const added = defs.map(([key, make]) => {
    const store = `__${key}`;
    Object.defineProperty(HTMLElement.prototype, key, {
      configurable: true,
      get(this: HTMLElement & Record<string, unknown>) {
        return (this[store] ??= make());
      },
    });
    return key;
  });
  return () => {
    for (const key of added)
      delete (HTMLElement.prototype as unknown as Record<string, unknown>)[key];
  };
}

describe('usePrefersReducedMotion', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  function Probe() {
    return <span data-testid="reduced">{String(usePrefersReducedMotion())}</span>;
  }

  async function render() {
    await act(async () => {
      root.render(<Probe />);
    });
    return () => container.querySelector('[data-testid="reduced"]')?.textContent;
  }

  it('reports the current setting and follows the OS without a reload', async () => {
    const media = stubMatchMedia(false);
    try {
      const readState = await render();
      expect(readState()).toBe('false');

      await act(async () => media.set(true));
      expect(readState()).toBe('true');

      await act(async () => media.set(false));
      expect(readState()).toBe('false');
    } finally {
      media.restore();
    }
  });

  it('unsubscribes on unmount so a torn-down scene stops reacting', async () => {
    const media = stubMatchMedia(true);
    try {
      await render();
      // The lazy initializer reads once, the effect subscribes to its own list.
      const list = media.lists[media.lists.length - 1];
      expect(list.listeners.size).toBe(1);

      await act(async () => root.unmount());
      expect(list.listeners.size).toBe(0);
      expect(list.removed.size).toBe(1);

      // A re-render after unmount would throw on a null root; the point is the listener is gone.
      media.set(false);
      expect(list.listeners.size).toBe(0);
    } finally {
      media.restore();
      // afterEach unmounts again; a double unmount is a no-op on an already-unmounted root.
    }
  });
});

describe('constellation backdrop under reduced motion', () => {
  let container: HTMLDivElement;
  let root: Root;
  let restoreTransforms: () => void;
  let restoreCanvas: () => void;

  beforeEach(() => {
    frames.length = 0;
    restoreTransforms = stubTransforms();
    restoreCanvas = stubCanvasContext();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    restoreTransforms();
    restoreCanvas();
  });

  function elements(): HTMLElement[] {
    return [...container.querySelectorAll('group, sprite')];
  }

  function snapshot() {
    return elements().map((el) => {
      const { x, y, z } = el.scale as THREE.Vector3;
      return `s:${x},${y},${z}`;
    });
  }

  function rotations() {
    return elements().map((el) => {
      const { x, y } = el.rotation as THREE.Euler;
      return `r:${x},${y}`;
    });
  }

  async function mount(reduced: boolean) {
    const media = stubMatchMedia(reduced);
    try {
      await act(async () => {
        root.render(<ConstellationBackdrop />);
      });
      // Park the pointer in a corner: any parallax at all has to show up in the rotations.
      await act(async () => {
        window.dispatchEvent(new MouseEvent('pointermove', { clientX: 0, clientY: 0 }));
      });
      const step = (n = 20) =>
        act(() => {
          for (let i = 0; i < n; i++) for (const cb of frames) cb({}, 0.016);
        });
      return { step, media };
    } finally {
      media.restore();
    }
  }

  it('is fully static: no spin, no cursor tilt, no star pulse', async () => {
    const { step } = await mount(true);
    // One frame settles the refs (the first pass writes the layout offset); everything after
    // it would be motion.
    await step(1);
    const beforeRotations = rotations();
    const beforeScales = snapshot();
    expect(beforeRotations.length).toBeGreaterThan(0);

    await step();

    expect(rotations()).toEqual(beforeRotations);
    expect(snapshot()).toEqual(beforeScales);
  });

  it('still places the constellation to the right on wide screens', async () => {
    const { step } = await mount(true);
    await step(1);
    // The layout offset is not motion: it applies, it just does not glide in.
    const shifted = elements().filter((el) => (el.position as THREE.Vector3).x === 2);
    expect(shifted.length).toBe(1);
  });

  it('animates normally when the setting is off', async () => {
    const { step } = await mount(false);
    await step(1);
    const beforeRotations = rotations();
    const beforeScales = snapshot();

    await step();

    expect(rotations()).not.toEqual(beforeRotations);
    expect(snapshot()).not.toEqual(beforeScales);
  });
});

describe('both constellation scenes', () => {
  const scenes = ['./constellation-3d.tsx', './constellation-backdrop.tsx'];

  it.each(scenes)('%s reads the OS setting through the shared hook', (file) => {
    const src = read(file);
    expect(src).toContain('usePrefersReducedMotion()');
    // The one-shot read is gone: only the live hook decides what moves.
    expect(src).not.toMatch(/reducedMotion\(\)/);
  });
});
