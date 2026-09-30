import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BRAND_DARK, BRAND_LIGHT, type BrandPalette } from '@/lib/brand-palette';
import { Starfield } from './starfield';

/** The rgb() part of every colour the canvas painted a star with. */
let painted: string[] = [];

/** jsdom has no 2D canvas: record each fillStyle a star is filled with. */
function stubCanvasContext() {
  const original = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = (() => {
    const ctx = {
      fillStyle: '',
      shadowBlur: 0,
      shadowColor: '',
      setTransform: () => {},
      clearRect: () => {},
      beginPath: () => {},
      arc: () => {},
      fill: () => painted.push(String(ctx.fillStyle).replace(/, [\d.]+\)$/, ')')),
    };
    return ctx;
  }) as unknown as HTMLCanvasElement['getContext'];
  return () => {
    HTMLCanvasElement.prototype.getContext = original;
  };
}

const rgb = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
};
const starTones = (p: BrandPalette) => new Set([p.starlight, p.gold, p.violet].map(rgb));

describe('Starfield on both themes', () => {
  let container: HTMLDivElement;
  let root: Root;
  let restoreCanvas: () => void;

  beforeEach(() => {
    painted = [];
    restoreCanvas = stubCanvasContext();
    // Reduced motion paints one static field: deterministic, and it must still repaint on a
    // theme switch since no animation frame will pick the new palette up.
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: true, addEventListener: () => {}, removeEventListener: () => {} })),
    );
    document.documentElement.classList.remove('light', 'dark');
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    restoreCanvas();
    vi.unstubAllGlobals();
    document.documentElement.classList.remove('light', 'dark');
  });

  it('paints pale token-coloured stars on the dark sky', async () => {
    await act(async () => root.render(<Starfield />));
    expect(painted.length).toBeGreaterThan(0);
    const dark = starTones(BRAND_DARK);
    expect(painted.every((c) => dark.has(c))).toBe(true);
  });

  it('repaints with the dark-on-light palette when html.light is set', async () => {
    await act(async () => root.render(<Starfield />));
    painted = [];
    await act(async () => {
      document.documentElement.classList.add('light');
    });
    expect(painted.length).toBeGreaterThan(0);
    const light = starTones(BRAND_LIGHT);
    expect(painted.every((c) => light.has(c))).toBe(true);
    // The light theme's brightest tone is a dark violet, not the near-white that vanished.
    expect(painted).toContain(rgb(BRAND_LIGHT.starlight));
  });

  it('starts light when the theme was set before first paint', async () => {
    document.documentElement.classList.add('light');
    await act(async () => root.render(<Starfield />));
    const light = starTones(BRAND_LIGHT);
    expect(painted.length).toBeGreaterThan(0);
    expect(painted.every((c) => light.has(c))).toBe(true);
  });
});
