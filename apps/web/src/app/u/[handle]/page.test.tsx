import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as { React?: typeof React }).React = React;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const G = 'G'.padEnd(56, 'T');
const m = vi.hoisted(() => ({
  resolveHandle: vi.fn(),
  getScores: vi.fn(),
  getPeopleCounts: vi.fn(),
  getMeta: vi.fn(),
  profile: null as { address: string } | null,
  net: { network: 'testnet' },
  vouchNetwork: vi.fn(),
}));

vi.mock('@/lib/registry', () => ({ resolveHandle: m.resolveHandle, getMeta: m.getMeta }));
vi.mock('@/lib/reputation', () => ({ getScores: m.getScores }));
vi.mock('@/lib/constellation', () => ({ getPeopleCounts: m.getPeopleCounts }));
vi.mock('@/components/wallet/wallet-provider', () => ({ useWallet: () => ({ profile: m.profile }) }));
vi.mock('@/lib/i18n', () => ({ useTranslations: () => (k: string) => k }));
// lib/read-network decides what an override is (tested there); here `testnet` is one.
vi.mock('@/lib/read-network', () => ({
  readNetworkFor: (p?: string | string[]) => (p === 'testnet' ? m.net : null),
  withReadNetwork: (path: string, net: unknown) => (net ? `${path}?network=testnet` : path),
}));
vi.mock('@/components/BadgeGallery', () => ({ BadgeGallery: () => <div data-testid="badges" /> }));
// The vouch network section is tested on its own (components/VouchNetwork.test.tsx).
vi.mock('@/components/VouchNetwork', () => ({
  VouchNetwork: (props: Record<string, unknown>) => {
    m.vouchNetwork(props);
    return <div data-testid="vouch-network" />;
  },
}));
vi.mock('@/components/Avatar', () => ({ Avatar: () => <div data-testid="avatar" /> }));
vi.mock('@/components/fx/share-row', () => ({
  ShareRow: ({ path }: { path: string }) => <div data-testid="share" data-path={path} />,
}));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import ProfilePage from './page';

describe('/u/[handle] on a ?network= override (#290)', () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    m.profile = null;
    m.vouchNetwork.mockReset();
    m.resolveHandle.mockReset().mockResolvedValue(G);
    m.getScores.mockReset().mockResolvedValue({ social: 9, earned: 4 });
    m.getPeopleCounts.mockReset().mockResolvedValue({ vouchedBy: 3, backed: 1 });
    m.getMeta.mockReset().mockResolvedValue(null);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  async function render(searchParams?: { network?: string }) {
    await act(async () => {
      root.render(<ProfilePage params={{ handle: 'Umut' }} searchParams={searchParams} />);
    });
  }
  const q = (sel: string) => container.querySelector(sel);

  it('reads every value from the override network', async () => {
    await render({ network: 'testnet' });
    expect(m.resolveHandle).toHaveBeenCalledWith('umut', m.net);
    expect(m.getScores).toHaveBeenCalledWith(G, m.net);
    expect(m.getPeopleCounts).toHaveBeenCalledWith(G, m.net);
    expect(m.getMeta).toHaveBeenCalledWith(G, m.net);
    expect(container.textContent).toContain('@umut');
    expect(container.textContent).toContain('4'); // earned XP from the override's read
    // The vouch network reads the same network, with the override's counts.
    expect(m.vouchNetwork).toHaveBeenLastCalledWith(
      expect.objectContaining({ address: G, handle: 'umut', net: m.net, vouchedByCount: 3, backedCount: 1 }),
    );
  });

  it('is read-only: a network badge, no vouch link, and links that keep the override', async () => {
    m.profile = { address: G }; // even the signed-in owner gets no write action here
    await render({ network: 'testnet' });
    expect(q('[role="status"]')?.textContent).toContain('readOnly.stamp');
    expect(q('a[href="/app"]')).toBeNull();
    expect(q('[data-testid="badges"]')).toBeNull();
    expect(q('a[href="/leaderboard?network=testnet"]')).not.toBeNull();
    expect(q('[data-testid="share"]')?.getAttribute('data-path')).toBe('/u/umut?network=testnet');
  });

  it('offers no claim link for a handle nobody held on the override network', async () => {
    m.resolveHandle.mockResolvedValue(null);
    await render({ network: 'testnet' });
    expect(q('a[href="/app"]')).toBeNull();
    expect(container.textContent).toContain('Nobody held this handle on testnet');
  });

  it('is the normal profile without the override', async () => {
    await render();
    expect(m.resolveHandle).toHaveBeenCalledWith('umut', null);
    expect(q('[role="status"]')).toBeNull();
    expect(q('a[href="/app"]')?.textContent).toContain('Vouch @umut');
    expect(q('[data-testid="badges"]')).not.toBeNull();
    expect(m.vouchNetwork).toHaveBeenLastCalledWith(expect.objectContaining({ net: null, isMe: false }));
    expect(q('[data-testid="share"]')?.getAttribute('data-path')).toBe('/u/umut');
  });
});
