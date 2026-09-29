import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The page leans on Next's automatic JSX runtime; this vitest setup compiles JSX to
// `React.createElement`, so give it a global React to resolve.
(globalThis as { React?: typeof React }).React = React;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { getVouchMock, reverseHandleMock, getMetaMock } = vi.hoisted(() => ({
  getVouchMock: vi.fn(),
  reverseHandleMock: vi.fn(),
  getMetaMock: vi.fn(),
}));

vi.mock('next/link', () => ({
  default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('@/components/wallet/wallet-provider', () => ({
  useWallet: () => ({ connect: vi.fn(), profile: null }),
}));
vi.mock('@/hooks/use-create-profile', () => ({
  useCreateProfile: () => ({ handle: '', setHandle: vi.fn(), normalizedHandle: '', avail: 'idle', creating: false, create: vi.fn() }),
}));
vi.mock('@/lib/reputation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/reputation')>()),
  getVouch: getVouchMock,
}));
vi.mock('@/lib/registry', () => ({ reverseHandle: reverseHandleMock, getMeta: getMetaMock }));
vi.mock('@/components/fx/border-beam', () => ({ BorderBeam: () => null }));
vi.mock('@/components/ui/state-art', () => ({ StateArt: () => null }));
vi.mock('@/components/ui/sticker', () => ({ Sticker: () => null }));

import ClaimPage from './page';

const VOUCHER = 'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H';

describe('/claim/[id] — who vouched (#218)', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    window.location.hash = '#k=ab';
    getVouchMock.mockResolvedValue({
      id: 7,
      from: VOUCHER,
      note: 'gm',
      claimed: false,
      claimer: null,
      created: Math.floor(Date.now() / 1000),
      stake: 5,
      slashed: false,
    });
    getMetaMock.mockResolvedValue(null);
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.clearAllMocks();
  });

  async function renderPage() {
    await act(async () => root.render(<ClaimPage params={{ id: '7' }} />));
    for (let i = 0; i < 6; i++) await act(async () => Promise.resolve());
  }

  const claimButton = () =>
    [...container.querySelectorAll('button')].find((b) => b.textContent?.includes('Claim your star'));

  it('names the voucher by @handle and face, with a link to their profile', async () => {
    reverseHandleMock.mockResolvedValue('ayse');
    await renderPage();

    expect(container.querySelector('h1')?.textContent).toBe('@ayse vouched for you.');
    expect(container.querySelector('[aria-label="@ayse\'s profile face"]')).not.toBeNull();
    const link = container.querySelector<HTMLAnchorElement>('a[href="/u/ayse"]');
    expect(link?.target).toBe('_blank');
    expect(getMetaMock).toHaveBeenCalledWith(VOUCHER);
  });

  it('falls back cleanly for a voucher without a handle', async () => {
    reverseHandleMock.mockResolvedValue(null);
    await renderPage();

    expect(container.querySelector('h1')?.textContent).toBe('Someone vouched for you.');
    expect(container.textContent).toContain(`${VOUCHER.slice(0, 4)}…${VOUCHER.slice(-4)}`);
    expect(container.querySelector('a[href^="/u/"]')).toBeNull();
  });

  it('never holds the Claim button on a slow or failing lookup', async () => {
    reverseHandleMock.mockReturnValue(new Promise(() => {})); // never settles
    getMetaMock.mockRejectedValue(new Error('rpc down'));
    await renderPage();

    expect(claimButton()).toBeDefined();
    expect(claimButton()!.disabled).toBe(false);
    expect(container.querySelector('h1')?.textContent).toBe('Someone vouched for you.');
  });
});
