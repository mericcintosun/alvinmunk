import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const m = vi.hoisted(() => ({
  pathname: '/app',
  mounts: { stats: 0, badges: 0, identity: 0 },
  statProps: [] as { compact?: boolean }[],
}));

vi.mock('next/navigation', () => ({ usePathname: () => m.pathname }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('@/components/wallet/wallet-provider', () => ({
  useWallet: () => ({ profile: { handle: 'alice', address: 'GALICE', createdAt: 0 } }),
}));
// Stand-ins that count their mounts: switching tabs must not remount (and so re-read) them.
const stub = vi.hoisted(
  () =>
    (R: typeof import('react'), key: 'stats' | 'badges' | 'identity', testid: string) =>
      function Stub(props: Record<string, unknown>) {
        R.useEffect(() => {
          m.mounts[key] += 1;
        }, []);
        if (key === 'stats') m.statProps.push(props);
        return R.createElement('div', { 'data-testid': testid, 'data-props': JSON.stringify(props) });
      },
);
vi.mock('@/components/IdentityBar', async () => ({ IdentityBar: stub(await import('react'), 'identity', 'identity') }));
vi.mock('@/components/app/stat-strip', async () => ({ StatStrip: stub(await import('react'), 'stats', 'stats') }));
vi.mock('@/components/BadgeGallery', async () => ({ BadgeGallery: stub(await import('react'), 'badges', 'badges') }));
vi.mock('@/components/app/app-tabs', () => ({ AppTabs: () => <nav data-testid="tabs" /> }));
vi.mock('@/components/VouchClaimedNotice', () => ({ VouchClaimedNotice: () => null }));
vi.mock('@/components/Avatar', () => ({ Avatar: () => <span data-testid="avatar" /> }));

import { AppShell } from './app-shell';

describe('AppShell on phones (#474)', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    m.pathname = '/app';
    m.mounts = { stats: 0, badges: 0, identity: 0 };
    m.statProps = [];
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const render = () =>
    act(async () =>
      root.render(
        <AppShell>
          <p data-testid="page" />
        </AppShell>,
      ),
    );
  const byId = (id: string) => container.querySelector(`[data-testid="${id}"]`)!;
  const wrapper = (id: string) => byId(id).parentElement!;
  const props = (id: string) => JSON.parse(byId(id).getAttribute('data-props')!);

  it('keeps the full chrome on home: identity bar, stat tiles, and the badges as a summary', async () => {
    await render();
    expect(wrapper('identity').className).toBe('');
    expect(container.querySelector('[data-testid="shell-compact-identity"]')).toBeNull();
    expect(props('stats')).toEqual({ address: 'GALICE', compact: false });
    expect(wrapper('badges').className).toBe('mt-4');
    expect(props('badges')).toEqual({ address: 'GALICE', collapsible: true });
  });

  it('opens every other tab on one compact identity + stats row, full chrome from sm up', async () => {
    m.pathname = '/app/vouch';
    await render();
    // The identity bar and the badges are there for sm and up only.
    expect([...wrapper('identity').classList]).toEqual(['hidden', 'sm:block']);
    expect([...wrapper('badges').classList]).toEqual(['mt-4', 'hidden', 'sm:block']);
    // One row: a link to the public profile with the face and handle, then compact stats.
    const compact = byId('shell-compact-identity');
    expect(compact.getAttribute('href')).toBe('/u/alice');
    expect(compact.textContent).toBe('@alice');
    expect(compact.classList).toContain('sm:hidden');
    expect(compact.parentElement).toBe(wrapper('stats').parentElement);
    expect(compact.parentElement!.classList).toContain('sm:block');
    expect(props('stats')).toEqual({ address: 'GALICE', compact: true });
    expect(byId('page')).not.toBeNull();
  });

  it('switches between the two without remounting (and re-reading) any part', async () => {
    await render();
    m.pathname = '/app/people';
    await render();
    m.pathname = '/app';
    await render();
    expect(m.mounts).toEqual({ stats: 1, badges: 1, identity: 1 });
    expect(m.statProps.map((p) => p.compact)).toEqual([false, true, false]);
  });
});
