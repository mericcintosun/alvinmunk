import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { resolveHandleMock, wallet } = vi.hoisted(() => ({
  resolveHandleMock: vi.fn(),
  wallet: { profile: null as { handle: string; address: string } | null },
}));

vi.mock('@/lib/registry', () => ({
  resolveHandle: resolveHandleMock,
  getMeta: () => Promise.resolve(null),
}));
vi.mock('@/lib/constellation', () => ({
  getPeopleCounts: () => Promise.resolve({ vouchedBy: 0, backed: 0 }),
}));
vi.mock('@/components/wallet/wallet-provider', () => ({ useWallet: () => ({ profile: wallet.profile }) }));
vi.mock('@/components/fx/share-row', () => ({
  ShareRow: ({ path, text }: { path: string; text: string }) => (
    <div data-testid="share-row" data-path={path} data-text={text} />
  ),
}));

import InvitePage from './page';

const KEY = 'alvinmunk.ref';
const BOB = 'GBOBBOBBOBBOBBOBBOBBOBBOBBOBBOBBOBBOBBOBBOBBOBBOBBOBBOB';

describe('/v/[handle] invite ref', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    sessionStorage.clear();
    wallet.profile = null;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.clearAllMocks();
  });

  async function visit(handle: string) {
    await act(async () => {
      root.render(<InvitePage params={{ handle }} />);
    });
  }

  it('stores a claimed handle, normalized, once it resolves', async () => {
    resolveHandleMock.mockResolvedValue(BOB);
    await visit('Bob');
    expect(resolveHandleMock).toHaveBeenCalledWith('bob');
    expect(sessionStorage.getItem(KEY)).toBe('bob');
  });

  it('never stores an unclaimed handle', async () => {
    resolveHandleMock.mockResolvedValue(null);
    await visit('nobody');
    expect(resolveHandleMock).toHaveBeenCalledWith('nobody');
    expect(sessionStorage.getItem(KEY)).toBeNull();
  });

  it('does not store the handle while it is still resolving, or when the lookup fails', async () => {
    let fail!: (e: Error) => void;
    resolveHandleMock.mockReturnValue(new Promise((_, reject) => (fail = reject)));
    await visit('bob');
    expect(sessionStorage.getItem(KEY)).toBeNull();
    await act(async () => fail(new Error('rpc down')));
    expect(sessionStorage.getItem(KEY)).toBeNull();
  });

  it('keeps a 32-character @handle inside a phone screen (#477)', async () => {
    const long = 'w'.repeat(32);
    resolveHandleMock.mockResolvedValue(BOB);
    await visit(long);

    // The headline wraps anywhere and steps down a size below sm; desktop keeps text-4xl.
    const h1 = container.querySelector('h1')!;
    expect(h1.textContent).toContain(`@${long}`);
    expect(h1.classList).toContain('[overflow-wrap:anywhere]');
    expect(h1.classList).toContain('text-3xl');
    expect(h1.classList).toContain('sm:text-4xl');
    // The card's name line truncates inside its min-w-0 column.
    const name = [...container.querySelectorAll('div')].find((el) => el.textContent === `@${long}`)!;
    expect(name.classList).toContain('truncate');
    expect(name.parentElement?.classList).toContain('min-w-0');
    // The frame header label wraps rather than pushing its index out.
    const label = [...container.querySelectorAll('span')].find((el) => el.textContent === `invite // @${long}`)!;
    expect(label.classList).toContain('[overflow-wrap:anywhere]');
    expect(label.classList).toContain('min-w-0');
  });

  it('keeps an earlier inviter when the new link is unclaimed', async () => {
    sessionStorage.setItem(KEY, 'carol');
    resolveHandleMock.mockResolvedValue(null);
    await visit('nobody');
    expect(sessionStorage.getItem(KEY)).toBe('carol');
  });

  describe('call to action (#485)', () => {
    const CAROL = 'GCAROLCAROLCAROLCAROLCAROLCAROLCAROLCAROLCAROLCAROLCAROL';
    const cta = () => container.querySelector('a[href^="/app"]');

    it('invites a signed-out visitor to create a profile', async () => {
      resolveHandleMock.mockResolvedValue(BOB);
      await visit('bob');
      expect(cta()?.getAttribute('href')).toBe('/app');
      expect(cta()?.textContent).toContain('Create your profile');
      expect(container.querySelector('[data-testid="share-row"]')).toBeNull();
    });

    it('offers the owner their invite to share, never "Create your profile"', async () => {
      wallet.profile = { handle: 'bob', address: BOB };
      resolveHandleMock.mockResolvedValue(BOB);
      await visit('bob');
      expect(container.textContent).toContain('Share your invite');
      const share = container.querySelector('[data-testid="share-row"]');
      expect(share?.getAttribute('data-path')).toBe('/v/bob');
      expect(share?.getAttribute('data-text')).toBe(
        'Join my constellation on alvinmunk — collect people, not points.',
      );
      expect(cta()).toBeNull();
      expect(container.textContent).not.toContain('Create your profile');
    });

    it('asks a signed-in visitor to vouch the inviter back', async () => {
      wallet.profile = { handle: 'carol', address: CAROL };
      resolveHandleMock.mockResolvedValue(BOB);
      await visit('Bob');
      expect(cta()?.getAttribute('href')).toBe('/app/vouch');
      expect(cta()?.textContent).toContain('Vouch @bob back');
      expect(container.textContent).not.toContain('Create your profile');
      expect(container.querySelector('[data-testid="share-row"]')).toBeNull();
    });

    it('truncates a long @handle in the vouch-back button instead of widening the page (#477)', async () => {
      const long = 'w'.repeat(32);
      wallet.profile = { handle: 'carol', address: CAROL };
      resolveHandleMock.mockResolvedValue(BOB);
      await visit(long);
      expect(cta()?.classList).toContain('max-w-full');
      expect(cta()?.querySelector('span.truncate')?.textContent).toBe(`Vouch @${long} back`);
      expect(cta()?.parentElement?.classList).toContain('max-w-full');
    });

    it('shows a signed-in visitor nothing until the handle resolves (owner or not)', async () => {
      wallet.profile = { handle: 'bob', address: BOB };
      let resolve!: (addr: string) => void;
      resolveHandleMock.mockReturnValue(new Promise((r) => (resolve = r)));
      await visit('bob');
      expect(cta()).toBeNull();
      expect(container.textContent).not.toContain('Create your profile');
      expect(container.textContent).not.toContain('Vouch @bob back');
      await act(async () => resolve(BOB));
      expect(container.textContent).toContain('Share your invite');
    });

    it('sends a signed-in visitor on an unclaimed handle to their dashboard', async () => {
      wallet.profile = { handle: 'carol', address: CAROL };
      resolveHandleMock.mockResolvedValue(null);
      await visit('nobody');
      expect(cta()?.getAttribute('href')).toBe('/app');
      expect(cta()?.textContent).toContain('Open your dashboard');
      expect(container.textContent).not.toContain('Create your profile');
      expect(container.textContent).not.toContain('Vouch @nobody back');
    });

    it('server-renders no call to action, so the owner never gets a "Create your profile" flash', () => {
      resolveHandleMock.mockReturnValue(new Promise(() => {}));
      const html = renderToString(<InvitePage params={{ handle: 'bob' }} />);
      expect(html).toContain('wants you in their');
      expect(html).not.toContain('Create your profile');
    });
  });
});
