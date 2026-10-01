import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The page leans on Next's automatic JSX runtime; this vitest setup compiles JSX to
// `React.createElement`, so give it a global React to resolve.
(globalThis as { React?: typeof React }).React = React;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { getVouchMock, reverseHandleMock, getMetaMock, claimVouchSignedMock, isVouchCancelledMock, profileHook, walletCtx } = vi.hoisted(() => ({
  getVouchMock: vi.fn(),
  reverseHandleMock: vi.fn(),
  getMetaMock: vi.fn(),
  claimVouchSignedMock: vi.fn(),
  isVouchCancelledMock: vi.fn(),
  /** What the mocked useCreateProfile returns; a test may overwrite fields. */
  profileHook: {
    current: {} as Record<string, unknown>,
  },
  walletCtx: {
    connect: (() => Promise.resolve(undefined)) as () => Promise<unknown>,
    wallet: null as { address: string } | null,
  },
}));
const IDLE_HOOK = { handle: '', setHandle: () => {}, normalizedHandle: '', avail: 'idle', creating: false, create: () => {} };

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
  useCreateProfile: () => profileHook.current,
}));
vi.mock('@/lib/reputation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/reputation')>()),
  getVouch: getVouchMock,
  isVouchCancelled: isVouchCancelledMock,
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
    profileHook.current = { ...IDLE_HOOK };
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
    isVouchCancelledMock.mockResolvedValue(false);
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

  it('keeps a 32-character @handle inside a phone screen (#477)', async () => {
    const long = 'w'.repeat(32);
    reverseHandleMock.mockResolvedValue(long);
    await renderPage();

    // The headline wraps anywhere and steps down a size below sm; desktop keeps text-4xl.
    const h1 = container.querySelector('h1')!;
    expect(h1.textContent).toBe(`@${long} vouched for you.`);
    expect(h1.classList).toContain('[overflow-wrap:anywhere]');
    expect(h1.classList).toContain('text-3xl');
    expect(h1.classList).toContain('sm:text-4xl');
    // The card's name line truncates, and its half of the grid may shrink to allow that.
    const name = [...container.querySelectorAll('span')].find((el) => el.textContent === `@${long}`)!;
    expect(name.classList).toContain('truncate');
    expect(name.classList).toContain('max-w-full');
    expect(name.closest('.grid')?.classList).toContain('grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]');
    expect(container.querySelector(`a[href="/u/${long}"]`)?.classList).toContain('truncate');
  });
});

describe('/claim/[id] — the handle picker after a claim (#479)', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    profileHook.current = { ...IDLE_HOOK };
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
    isVouchCancelledMock.mockResolvedValue(false);
    claimVouchSignedMock.mockResolvedValue(undefined);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null)));
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  async function claimed() {
    await act(async () => root.render(<ClaimPage params={{ id: '7' }} />));
    for (let i = 0; i < 6; i++) await act(async () => Promise.resolve());
    const claim = [...container.querySelectorAll('button')].find((b) => b.textContent?.includes('Claim your star'))!;
    await act(async () => claim.click());
    for (let i = 0; i < 6; i++) await act(async () => Promise.resolve());
    const input = container.querySelector<HTMLInputElement>('[aria-label="Pick a handle"]');
    expect(input).not.toBeNull();
    return input!;
  }

  it('states the rules, caps the field at 20 and names what normalizing removed', async () => {
    profileHook.current = { ...IDLE_HOOK, handle: 'Ayşe K', normalizedHandle: 'ayek' };
    const input = await claimed();
    expect(input.maxLength).toBe(20);
    expect(input.getAttribute('aria-describedby')).toBe('claim-handle-status claim-handle-rules');
    expect(container.querySelector('#claim-handle-rules')!.textContent).toBe(
      'Removed “ş”, space — use 3–20 characters: a–z, 0–9 or _',
    );
  });

  it('lets a long reserved message wrap above the Claim @handle button', async () => {
    profileHook.current = {
      ...IDLE_HOOK,
      handle: 'ayse',
      normalizedHandle: 'ayse',
      avail: 'reserved',
      reservedUntil: 'Oct 29, 2026',
    };
    await claimed();
    const status = container.querySelector('#claim-handle-status')!;
    expect(status.textContent).toBe('@ayse is reserved until Oct 29, 2026');
    expect(status.className.split(' ')).toContain('min-h-4');
    expect(status.className.split(' ')).not.toContain('h-4');
    expect(container.querySelector('#claim-handle-rules')!.textContent).toBe('3–20 characters: a–z, 0–9 or _');
  });
});

describe('/claim/[id] — feedback after a claim (#287)', () => {
  const CLAIMER = 'GCLAIMERCLAIMERCLAIMERCLAIMERCLAIMERCLAIMERCLAIMERCLAIM';
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    profileHook.current = { ...IDLE_HOOK };
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
    isVouchCancelledMock.mockResolvedValue(false);
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

describe('/claim/[id] — a card its voucher revoked (#137)', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    profileHook.current = { ...IDLE_HOOK };
    walletCtx.connect = () => Promise.resolve({ address: 'GCLAIMER' });
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

  it('shows the revoked state instead of a Claim button', async () => {
    isVouchCancelledMock.mockResolvedValue(true);
    await renderPage();

    expect(isVouchCancelledMock).toHaveBeenCalledWith(7);
    expect(container.querySelector('h1')?.textContent).toBe('This link was revoked.');
    expect(claimButton()).toBeUndefined();
    expect(container.querySelector('a[href="/app"]')).not.toBeNull();
  });

  it('keeps the card claimable when the flag cannot be read (a contract without is_cancelled)', async () => {
    isVouchCancelledMock.mockRejectedValue(new Error('simulate is_cancelled failed'));
    await renderPage();

    expect(claimButton()).toBeDefined();
    expect(container.querySelector('h1')?.textContent).toBe('Someone vouched for you.');
  });

  it('switches to the revoked state when the claim reverts with Cancelled (#16)', async () => {
    isVouchCancelledMock.mockResolvedValue(false); // revoked after the page loaded
    claimVouchSignedMock.mockRejectedValue(new Error('HostError: Error(Contract, #16)'));
    await renderPage();

    await act(async () => claimButton()!.click());
    for (let i = 0; i < 6; i++) await act(async () => Promise.resolve());

    expect(claimVouchSignedMock).toHaveBeenCalledWith({ address: 'GCLAIMER' }, 7, 'ab'.repeat(32));
    expect(container.querySelector('h1')?.textContent).toBe('This link was revoked.');
    expect(container.querySelector('.text-destructive')).toBeNull();
  });
});
