import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HERO_BOX } from './hero-box';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { captured } = vi.hoisted(() => ({
  captured: { loading: null as null | (() => React.ReactNode) },
}));

// Grab the dashboard's dynamic() loading placeholder as the page module defines it.
vi.mock('next/dynamic', () => ({
  default: (_load: unknown, opts: { loading: () => React.ReactNode }) => {
    captured.loading = opts.loading;
    return () => null;
  },
}));
vi.mock('@/components/wallet/wallet-provider', () => ({ useWallet: () => ({ profile: null }) }));
vi.mock('@/components/FirstStarNudge', () => ({ FirstStarNudge: () => null }));
vi.mock('@/components/InviteNudge', () => ({ InviteNudge: () => null }));
vi.mock('@/components/PendingHalfCards', () => ({ PendingHalfCards: () => null }));
vi.mock('@/components/OwedBonuses', () => ({ OwedBonuses: () => null }));
vi.mock('@/components/ActivityFeed', () => ({ ActivityFeed: () => null }));
// No WebGL in jsdom: keep the hero's DOM frame, drop the scene.
vi.mock('@react-three/fiber', () => ({
  Canvas: () => null,
  useFrame: () => {},
  useThree: () => ({ invalidate: () => {} }),
}));
vi.mock('@react-three/drei', () => ({ Stars: () => null, Html: () => null, Line: () => null }));
vi.mock('@/lib/constellation', () => ({
  fetchVouchersOf: () => new Promise(() => {}),
  getPeopleCounts: () => new Promise(() => {}),
  timeAgo: () => '',
  addrHue: () => 0,
}));

import '@/app/app/page';
import ConstellationHero3D from './constellation-3d';

// Classes that change an element's outer height: borders, padding, margins and heights.
const SIZING = /^(border(-[xytblr])?(-\d+|-\[[^\]]+\])?|[pm][xytblr]?-.+|(min-|max-)?h-.+)$/;
const sizing = (el: Element) =>
  [...el.classList].filter((c) => SIZING.test(c.split(':').pop()!)).sort();

/** The frame (outermost element) and the one element inside it sized by HERO_BOX. */
function boxModel(container: HTMLElement) {
  const frame = container.firstElementChild!;
  const sized = [...container.querySelectorAll('*')].filter((el) =>
    HERO_BOX.split(' ').every((c) => el.classList.contains(c)),
  );
  expect(sized).toHaveLength(1);
  expect(sized[0].parentElement).toBe(frame);
  return { frame: sizing(frame), box: sizing(sized[0]) };
}

describe('hero box sizing', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        observe() {}
        disconnect() {}
      },
    );
    vi.stubGlobal(
      'matchMedia',
      vi
        .fn()
        .mockReturnValue({
          matches: false,
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
        }),
    );
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it('keeps the hero at its real size from sm up, and shorter on a phone', () => {
    expect(HERO_BOX).toBe('h-[42vh] max-h-[620px] min-h-[280px] sm:h-[64vh] sm:min-h-[440px]');
  });

  it('gives the loading placeholder the same frame and box as the 3D hero', () => {
    expect(captured.loading).toBeTypeOf('function');
    act(() => root.render(<>{captured.loading!()}</>));
    const placeholder = boxModel(container);

    act(() => root.render(<ConstellationHero3D address={'G'.padEnd(56, 'A')} handle="alice" />));
    const hero = boxModel(container);

    expect(placeholder).toEqual(hero);
    // The border sits on the frame, outside the sized box, in both.
    expect(hero.frame).toEqual(['border']);
    expect(hero.box).toEqual(HERO_BOX.split(' ').sort());
  });
});
