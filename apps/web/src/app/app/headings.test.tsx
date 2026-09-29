import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Profile } from '@/lib/profile';

// The /app tree relies on Next's automatic JSX runtime; this vitest setup compiles JSX to
// `React.createElement`, so give it a global React to resolve.
(globalThis as { React?: typeof React }).React = React;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { state } = vi.hoisted(() => ({
  state: {
    pathname: '/app',
    profile: null as Profile | null,
    network: 'pending' as 'pending' | 'down',
  },
}));

// Every component in the /app tree renders for real; only the network is cut. Contracts
// look deployed, and each RPC / Horizon call and fetch either never settles (loading
// states) or fails (error states).
vi.mock('@/lib/stellar', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/stellar')>();
  const { StrKey } = await import('@stellar/stellar-sdk');
  const id = StrKey.encodeContract(Buffer.alloc(32, 1));
  const contracts = Object.fromEntries(Object.keys(actual.config.contracts).map((k) => [k, id]));
  const offline = (): unknown =>
    new Proxy(() => {}, {
      get: (_t, prop) => (prop === 'then' ? undefined : offline()),
      apply: () =>
        state.network === 'pending' ? new Promise(() => {}) : Promise.reject(new Error('offline')),
    });
  return {
    ...actual,
    config: { ...actual.config, contracts },
    server: offline(),
    horizon: offline(),
  };
});
vi.mock('@/components/wallet/wallet-provider', () => ({
  useWallet: () => ({
    profile: state.profile,
    connect: async () => ({ kind: 'dev', address: state.profile?.address }),
    setProfile: () => {},
  }),
}));
vi.mock('next/navigation', () => ({
  usePathname: () => state.pathname,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
}));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
// The cashable routes (Quests / Rewards) render nothing under focus mode, so test them with it off.
vi.mock('@/lib/focus', () => ({ FOCUS_MODE: false }));
// WebGL is not available in jsdom: keep the hero's DOM overlay (where its heading lives), drop the scene.
vi.mock('@react-three/fiber', () => ({ Canvas: () => null, useFrame: () => {} }));
vi.mock('@react-three/drei', () => ({ Stars: () => null, Html: () => null, Line: () => null }));

import AppLayout from './layout';
import AppHome from './page';
import VouchPage from './vouch/page';
import QuestsPage from './quests/page';
import RewardsPage from './rewards/page';
import ActivityPage from './activity/page';
import PeoplePage from './people/page';

const ME: Profile = {
  handle: 'me',
  address: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
  createdAt: 1,
};

const ROUTES: [string, () => React.ReactNode][] = [
  ['/app', () => <AppHome />],
  ['/app/vouch', () => <VouchPage />],
  ['/app/quests', () => <QuestsPage />],
  ['/app/rewards', () => <RewardsPage />],
  ['/app/activity', () => <ActivityPage />],
  ['/app/people', () => <PeoplePage />],
];

describe('/app routes', () => {
  let container: HTMLDivElement;
  let root: Root;

  // Load the 3D hero's module up front, so its lazy import resolves promptly in each test.
  beforeAll(async () => {
    await import('@/components/brand/constellation-3d');
  });

  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal('fetch', () =>
      state.network === 'pending' ? new Promise(() => {}) : Promise.reject(new Error('offline')),
    );
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
        takeRecords() {
          return [];
        }
      },
    );
    window.matchMedia = vi.fn().mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
    });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  const tick = () =>
    act(async () => {
      await new Promise((r) => setTimeout(r, 5));
    });
  async function render(page: React.ReactNode) {
    await act(async () => root.render(<AppLayout>{page}</AppLayout>));
    // The home hero is a lazy chunk: wait for it to replace its placeholder.
    const hero = () => container.querySelector('section[aria-label="Your constellation"]');
    for (let i = 0; i < 400 && state.pathname === '/app' && state.profile && !hero(); i++)
      await tick();
    // Then let the reads settle into their final render.
    for (let i = 0; i < 10; i++) await tick();
  }
  const h1s = () => Array.from(container.querySelectorAll('h1')).map((h) => h.textContent?.trim());

  describe.each(['pending', 'down'] as const)('with the network %s', (network) => {
    beforeEach(() => {
      state.network = network;
      state.profile = { ...ME };
    });

    it.each(ROUTES)('%s renders exactly one <h1>', async (pathname, page) => {
      state.pathname = pathname;
      await render(page());
      expect(h1s()).toHaveLength(1);
      // The shell's identity bar still shows the handle, just not as a heading.
      expect(container.textContent).toContain('@me');
    });

    it('the home hero is the /app heading', async () => {
      state.pathname = '/app';
      await render(<AppHome />);
      expect(h1s()).toEqual(['@me']);
      expect(
        container.querySelector('h1')!.closest('[aria-label="Your constellation"]'),
      ).not.toBeNull();
    });
  });

  it('the onboarding gate (no profile yet) renders exactly one <h1>', async () => {
    state.network = 'pending';
    state.profile = null;
    state.pathname = '/app/vouch';
    await render(<VouchPage />);
    expect(h1s()).toHaveLength(1);
  });
});
