import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The page leans on Next's automatic JSX runtime; this vitest setup compiles JSX to
// `React.createElement`, so give it a global React to resolve.
(globalThis as { React?: typeof React }).React = React;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { getVouchMock, reverseHandleMock, getMetaMock, claimVouchSignedMock, walletCtx } = vi.hoisted(() => ({
  getVouchMock: vi.fn(),
  reverseHandleMock: vi.fn(),
  getMetaMock: vi.fn(),
  claimVouchSignedMock: vi.fn(),
  walletCtx: {
    connect: (() => Promise.resolve(undefined)) as () => Promise<unknown>,
    wallet: null as { address: string } | null,
  },
}));

vi.mock('next/link', () => ({
  default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('@/components/wallet/wallet-provider', () => ({
  useWallet: () => ({ connect: walletCtx.connect, wallet: walletCtx.wallet, profile: null }),
}));
vi.mock('@/hooks/use-create-profile', () => ({
  useCreateProfile: () => ({ handle: '', setHandle: vi.fn(), normalizedHandle: '', avail: 'idle', creating: false, create: vi.fn() }),
}));
vi.mock('@/lib/reputation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/reputation')>()),
  getVouch: getVouchMock,
  claimVouchSigned: claimVouchSignedMock,
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

describe('/claim/[id] — feedback after a claim (#287)', () => {
  const CLAIMER = 'GCLAIMERCLAIMERCLAIMERCLAIMERCLAIMERCLAIMERCLAIMERCLAIM';
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    localStorage.clear();
    vi.stubEnv('NEXT_PUBLIC_FEEDBACK_FORM_URL', 'https://docs.google.com/forms/d/e/FORM/viewform?entry.2={address}');
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('{}'))));
    window.location.hash = `#k=${'ab'.repeat(32)}`;
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
    reverseHandleMock.mockResolvedValue(null);
    getMetaMock.mockResolvedValue(null);
    claimVouchSignedMock.mockResolvedValue(undefined);
    walletCtx.connect = async () => {
      walletCtx.wallet = { address: CLAIMER };
      return walletCtx.wallet;
    };
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    walletCtx.wallet = null;
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  const prompt = () => container.querySelector('section[aria-label="Quick feedback"]');

  it('asks once the star is lit, with the claimer\'s address prefilled', async () => {
    await act(async () => root.render(<ClaimPage params={{ id: '7' }} />));
    for (let i = 0; i < 6; i++) await act(async () => Promise.resolve());
    expect(prompt()).toBeNull(); // not before the claim

    const claim = [...container.querySelectorAll('button')].find((b) => b.textContent?.includes('Claim your star'))!;
    await act(async () => claim.click());
    for (let i = 0; i < 6; i++) await act(async () => Promise.resolve());

    expect(claimVouchSignedMock).toHaveBeenCalledWith({ address: CLAIMER }, 7, 'ab'.repeat(32));
    expect(container.textContent).toContain('STAR IGNITED');
    const href = new URL(prompt()!.querySelector('a')!.href);
    expect(href.searchParams.get('entry.2')).toBe(CLAIMER);
  });
});
