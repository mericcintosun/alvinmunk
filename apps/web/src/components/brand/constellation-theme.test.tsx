import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BRAND_DARK, BRAND_LIGHT, type BrandPalette } from '@/lib/brand-palette';

/**
 * The 3D scenes on both themes. No WebGL in jsdom: the mocked <Canvas> renders the scene
 * tree as plain elements, so each material's props (color, blending) land as attributes the
 * test can read. The drei sky renders a marker so the test can see whether it is drawn.
 */
(globalThis as { React?: typeof React }).React = React;

vi.mock('@react-three/fiber', () => ({
  Canvas: ({ children }: { children: React.ReactNode }) => children,
  useFrame: () => {},
  useThree: () => ({
    viewport: { width: 10, height: 10 },
    size: { width: 1000, height: 800 },
    invalidate: () => {},
  }),
}));

vi.mock('@react-three/drei', () => ({
  Stars: () => React.createElement('i', { 'data-sky': '' }),
  Line: () => null,
  Html: () => null,
}));

vi.mock('@/lib/constellation', () => ({
  fetchVouchersOf: () => Promise.resolve([]),
  getPeopleCounts: () => Promise.resolve({ vouchedBy: 0, backed: 0 }),
  timeAgo: () => '',
  addrHue: () => 0,
}));

import ConstellationHero3D from './constellation-3d';
import ConstellationBackdrop from './constellation-backdrop';

/** The glow sprite is drawn on a 2D canvas jsdom does not implement. */
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

const scenes: Array<[string, () => React.ReactElement]> = [
  ['app hero', () => <ConstellationHero3D address={'G'.padEnd(56, 'A')} handle="alice" />],
  ['landing backdrop', () => <ConstellationBackdrop />],
];

describe.each(scenes)('%s on both themes', (_, scene) => {
  let container: HTMLDivElement;
  let root: Root;
  let restoreCanvas: () => void;

  beforeEach(() => {
    restoreCanvas = stubCanvasContext();
    // Motion on; the scenes subscribe to the query, so the stub needs the listener API.
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} })),
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

  async function mount() {
    await act(async () => {
      root.render(scene());
    });
  }

  async function setTheme(theme: 'light' | 'dark') {
    await act(async () => {
      document.documentElement.classList.remove('light', 'dark');
      document.documentElement.classList.add(theme);
    });
  }

  const sprites = () => [...container.querySelectorAll('spritematerial')];
  const ringColors = () =>
    [...container.querySelectorAll('meshbasicmaterial')]
      .map((m) => m.getAttribute('color'))
      .filter((c): c is string => c !== null);
  const sky = () => container.querySelector('[data-sky]');

  function expectPalette(palette: BrandPalette, blending: THREE.Blending) {
    expect(ringColors()).toEqual([palette.violet, palette.green, palette.cyan]);
    // Exactly one star is "you", and it is the gold accent.
    const you = sprites().filter((m) => m.getAttribute('color') === palette.gold);
    expect(you).toHaveLength(1);
    expect(sprites().length).toBeGreaterThan(3);
    for (const m of sprites()) expect(m.getAttribute('blending')).toBe(String(blending));
  }

  it('glows additively in token colours on the dark sky', async () => {
    await mount();
    expect(sky()).not.toBeNull();
    expectPalette(BRAND_DARK, THREE.AdditiveBlending);
  });

  it('switches to darker colours and normal blending when html.light is set, and back', async () => {
    await mount();
    await setTheme('light');
    // The near-white additive sky would vanish on the pale background, so it is not drawn.
    expect(sky()).toBeNull();
    expectPalette(BRAND_LIGHT, THREE.NormalBlending);

    await setTheme('dark');
    expect(sky()).not.toBeNull();
    expectPalette(BRAND_DARK, THREE.AdditiveBlending);
  });

  it('reads a light theme already set before mount', async () => {
    document.documentElement.classList.add('light');
    await mount();
    expect(sky()).toBeNull();
    expectPalette(BRAND_LIGHT, THREE.NormalBlending);
  });
});
