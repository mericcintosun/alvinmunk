import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Profile } from '@/lib/profile';
import type { Wallet } from '@/lib/wallet';

// This vitest setup compiles JSX to `React.createElement`; give it a global React.
(globalThis as { React?: typeof React }).React = React;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const FREE = { status: 'free' } as const;
const TAKEN = { status: 'taken' } as const;
const UNTIL = new Date('2026-10-29T12:00:00Z');
const RESERVED = { status: 'reserved', until: UNTIL } as const;
const UNTIL_EN = UNTIL.toLocaleDateString('en', { dateStyle: 'medium' });

const DEV_WALLET: Wallet = { kind: 'dev', address: 'GDEV', sign: async (x) => x, signMessage: async () => '' };
const PASSKEY_WALLET: Wallet = { kind: 'passkey', address: 'CPASSKEY', sign: async (x) => x, signMessage: async () => '' };

const {
  store,
  connectMock,
  setProfileMock,
  availabilityMock,
  claimHandleMock,
  recordGenesisMock,
  toastMock,
  trackMock,
  identifyMock,
  trackErrorMock,
} = vi.hoisted(() => ({
  store: { wallet: null as Wallet | null },
  connectMock: vi.fn(),
  setProfileMock: vi.fn(),
  availabilityMock: vi.fn(),
  claimHandleMock: vi.fn(),
  recordGenesisMock: vi.fn(),
  toastMock: { success: vi.fn(), error: vi.fn() },
  trackMock: vi.fn(),
  identifyMock: vi.fn(),
  trackErrorMock: vi.fn(),
}));

vi.mock('@/components/wallet/wallet-provider', () => ({
  useWallet: () => ({ wallet: store.wallet, connect: connectMock, setProfile: setProfileMock }),
}));
vi.mock('@/lib/registry', () => ({
  handleAvailability: availabilityMock,
  claimHandle: claimHandleMock,
}));
vi.mock('@/lib/genesis', () => ({
  recordGenesis: recordGenesisMock,
}));
vi.mock('sonner', () => ({ toast: toastMock }));
vi.mock('@/lib/track', () => ({
  track: trackMock,
  identify: identifyMock,
  trackError: trackErrorMock,
}));

import { useCreateProfile, type UseCreateProfileResult } from './use-create-profile';

function Harness({
  from,
  onCreated,
  onState,
}: {
  from: 'app' | 'landing' | 'claim';
  onCreated?: (p: Profile) => void;
  onState: (r: UseCreateProfileResult) => void;
}) {
  const result = useCreateProfile({ from, onCreated });
  onState(result);
  return null;
}

describe('useCreateProfile', () => {
  let container: HTMLDivElement;
  let root: Root;
  let latest: UseCreateProfileResult;

  beforeEach(() => {
    vi.useFakeTimers();
    store.wallet = null;
    connectMock.mockReset().mockResolvedValue(DEV_WALLET);
    setProfileMock.mockReset();
    availabilityMock.mockReset().mockResolvedValue(FREE);
    claimHandleMock.mockReset().mockResolvedValue(undefined);
    recordGenesisMock.mockReset().mockResolvedValue('genesis-tx-hash');
    toastMock.success.mockReset();
    toastMock.error.mockReset();
    trackMock.mockReset();
    identifyMock.mockReset();
    trackErrorMock.mockReset();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  async function mount(from: 'app' | 'landing' | 'claim', onCreated?: (p: Profile) => void) {
    await act(async () => {
      root.render(<Harness from={from} onCreated={onCreated} onState={(r) => (latest = r)} />);
    });
  }

  async function flush() {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  async function setHandle(h: string) {
    await act(async () => {
      latest.setHandle(h);
    });
  }

  async function advance(ms: number) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  }

  it('debounces the availability check and reports free vs taken', async () => {
    await mount('app');
    availabilityMock.mockResolvedValue(FREE);
    await setHandle('newbie');
    expect(latest.avail).toBe('checking');
    expect(availabilityMock).not.toHaveBeenCalled();

    await advance(400);
    await flush();
    expect(availabilityMock).toHaveBeenCalledWith('newbie', undefined);
    expect(latest.avail).toBe('free');

    availabilityMock.mockResolvedValue(TAKEN);
    await setHandle('taken1');
    await advance(400);
    await flush();
    expect(latest.avail).toBe('taken');
  });

  it('reuses an already-connected wallet instead of calling connect() again (claim flow)', async () => {
    // The claim page already connected a wallet to submit claimVouch before this hook
    // ever renders — picking a handle right after must NOT trigger a second connect()
    // (which, for a passkey wallet, means a second FaceID prompt).
    store.wallet = PASSKEY_WALLET;
    await mount('claim');
    await setHandle('newperson');
    await advance(400);
    await flush();

    await act(async () => {
      await latest.createProfile();
    });

    expect(connectMock).not.toHaveBeenCalled();
    expect(claimHandleMock).toHaveBeenCalledWith(PASSKEY_WALLET, 'newperson');
    // Passkey wallets skip the classic-account genesis tx entirely.
    expect(recordGenesisMock).not.toHaveBeenCalled();
    expect(setProfileMock).toHaveBeenCalledWith(
      expect.objectContaining({ handle: 'newperson', address: 'CPASSKEY', source: 'claim' }),
    );
    expect(trackMock).toHaveBeenCalledWith('profile_created', { walletKind: 'passkey', from: 'claim' });
  });

  it('connects when there is no wallet yet (landing/app flow) and fires onCreated', async () => {
    const created: Profile[] = [];
    await mount('landing', (p) => created.push(p));
    await setHandle('freshuser');
    await advance(400);
    await flush();

    await act(async () => {
      await latest.createProfile();
    });

    expect(connectMock).toHaveBeenCalledTimes(1);
    expect(recordGenesisMock).toHaveBeenCalledWith(DEV_WALLET, 'freshuser');
    expect(claimHandleMock).toHaveBeenCalledWith(DEV_WALLET, 'freshuser');
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ handle: 'freshuser', source: 'landing' });
    expect(toastMock.success).toHaveBeenCalled();
  });

  it('rejects a handle shorter than 3 characters without touching the chain', async () => {
    await mount('app');
    await setHandle('ab');
    await act(async () => {
      await latest.createProfile();
    });
    expect(toastMock.error).toHaveBeenCalledWith('Pick a handle — 3+ letters or numbers.');
    expect(claimHandleMock).not.toHaveBeenCalled();
    expect(connectMock).not.toHaveBeenCalled();
  });

  it('re-checks availability at submit time and bails out if it was just taken', async () => {
    store.wallet = DEV_WALLET;
    await mount('claim');
    await setHandle('raceduser');
    await advance(400);
    await flush();
    // Someone else claims it between the debounced check and the submit.
    availabilityMock.mockResolvedValue(TAKEN);

    await act(async () => {
      await latest.createProfile();
    });

    expect(claimHandleMock).not.toHaveBeenCalled();
    expect(toastMock.error).toHaveBeenCalledWith('@raceduser is taken — pick another.');
    expect(latest.avail).toBe('taken');
  });

  it('reports a handle cooling down for its previous owner as reserved until a date', async () => {
    await mount('app');
    availabilityMock.mockResolvedValue(RESERVED);
    await setHandle('alice');
    await advance(400);
    await flush();
    expect(latest.avail).toBe('reserved');
    expect(latest.reservedUntil).toBe(UNTIL_EN);

    availabilityMock.mockResolvedValue(FREE);
    await setHandle('alice2');
    await advance(400);
    await flush();
    expect(latest.reservedUntil).toBeNull();
  });

  it('asks on behalf of the connected wallet, which may be the previous owner', async () => {
    store.wallet = DEV_WALLET;
    await mount('claim');
    await setHandle('myoldname');
    await advance(400);
    await flush();
    expect(availabilityMock).toHaveBeenCalledWith('myoldname', 'GDEV');

    await act(async () => {
      await latest.createProfile();
    });
    expect(availabilityMock).toHaveBeenLastCalledWith('myoldname', 'GDEV');
    expect(claimHandleMock).toHaveBeenCalledWith(DEV_WALLET, 'myoldname');
  });

  it('refuses a reserved handle at submit time and says until when', async () => {
    await mount('landing');
    await setHandle('alice');
    await advance(400);
    await flush();
    availabilityMock.mockResolvedValue(RESERVED);

    await act(async () => {
      await latest.createProfile();
    });

    expect(availabilityMock).toHaveBeenLastCalledWith('alice', 'GDEV');
    expect(claimHandleMock).not.toHaveBeenCalled();
    expect(recordGenesisMock).not.toHaveBeenCalled();
    expect(toastMock.error).toHaveBeenCalledWith(
      `@alice was just freed and is held for its previous owner until ${UNTIL_EN} — pick another.`,
    );
    expect(latest.avail).toBe('reserved');
  });
});
