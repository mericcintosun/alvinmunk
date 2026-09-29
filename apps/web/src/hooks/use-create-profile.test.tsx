import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Profile } from '@/lib/profile';
import type { FaceId } from '@/lib/avatar';
import type { Wallet } from '@/lib/wallet';

// This vitest setup compiles JSX to `React.createElement`; give it a global React.
(globalThis as { React?: typeof React }).React = React;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const FREE = { status: 'free' } as const;
const TAKEN = { status: 'taken' } as const;
const UNTIL = new Date('2026-10-29T12:00:00Z');
const RESERVED = { status: 'reserved', until: UNTIL } as const;
const UNTIL_EN = UNTIL.toLocaleDateString('en', { dateStyle: 'medium' });

const DEV_WALLET: Wallet = { kind: 'dev', address: 'GDEV', sign: async (x) => x };
const PASSKEY_WALLET: Wallet = { kind: 'passkey', address: 'CPASSKEY', sign: async (x) => x };

const {
  store,
  connectMock,
  setProfileMock,
  restoreProfileMock,
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
  restoreProfileMock: vi.fn(),
  availabilityMock: vi.fn(),
  claimHandleMock: vi.fn(),
  recordGenesisMock: vi.fn(),
  toastMock: { success: vi.fn(), error: vi.fn() },
  trackMock: vi.fn(),
  identifyMock: vi.fn(),
  trackErrorMock: vi.fn(),
}));

vi.mock('@/components/wallet/wallet-provider', () => ({
  useWallet: () => ({
    wallet: store.wallet,
    connect: connectMock,
    setProfile: setProfileMock,
    restoreProfile: restoreProfileMock,
  }),
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
  face,
  onCreated,
  onState,
}: {
  from: 'app' | 'landing' | 'claim';
  face?: FaceId;
  onCreated?: (p: Profile) => void;
  onState: (r: UseCreateProfileResult) => void;
}) {
  const result = useCreateProfile({ from, face, onCreated });
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
    restoreProfileMock.mockReset().mockResolvedValue(null);
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

  async function mount(from: 'app' | 'landing' | 'claim', onCreated?: (p: Profile) => void, face?: FaceId) {
    await act(async () => {
      root.render(<Harness from={from} face={face} onCreated={onCreated} onState={(r) => (latest = r)} />);
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
    await mount('landing', (p) => created.push(p), 'face-03');
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
    expect(created[0]).toMatchObject({ handle: 'freshuser', source: 'landing', avatar: { kind: 'face', id: 'face-03' } });
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

  describe('an address that already holds a handle (#278)', () => {
    const HELD: Profile = { handle: 'alvin', address: 'CPASSKEY', createdAt: 1 };

    it.each(['app', 'landing', 'claim'] as const)(
      'keeps it instead of claiming (renaming) it, from %s',
      async (from) => {
        store.wallet = PASSKEY_WALLET;
        restoreProfileMock.mockResolvedValue(HELD);
        const done: Profile[] = [];
        await mount(from, (p) => done.push(p));
        await setHandle('newname');

        await act(async () => {
          await latest.createProfile();
        });

        expect(restoreProfileMock).toHaveBeenCalledWith(PASSKEY_WALLET);
        // Checked before availability: the typed handle (even a reserved one) is irrelevant.
        expect(availabilityMock).not.toHaveBeenCalled();
        expect(claimHandleMock).not.toHaveBeenCalled();
        expect(recordGenesisMock).not.toHaveBeenCalled();
        expect(setProfileMock).not.toHaveBeenCalled();
        expect(trackMock).toHaveBeenCalledWith('profile_restored', { walletKind: 'passkey', from });
        expect(toastMock.success).toHaveBeenCalledWith('Welcome back — @alvin restored.');
        expect(done).toEqual([HELD]); // landing still moves on into /app
      },
    );

    it('does not claim when it cannot tell whether the address holds one', async () => {
      restoreProfileMock.mockRejectedValue(new Error("Couldn't look up your handle — try again in a moment."));
      vi.spyOn(console, 'error').mockImplementation(() => {});
      await mount('app');
      await setHandle('newname');

      await act(async () => {
        await latest.createProfile();
      });

      expect(claimHandleMock).not.toHaveBeenCalled();
      expect(toastMock.error).toHaveBeenCalledWith("Couldn't look up your handle — try again in a moment.");
      vi.mocked(console.error).mockRestore();
    });

    it('restoreAccount connects in recover mode, even with a wallet already connected', async () => {
      store.wallet = DEV_WALLET;
      connectMock.mockResolvedValue(PASSKEY_WALLET);
      restoreProfileMock.mockResolvedValue(HELD);
      await mount('app');

      await act(async () => {
        await latest.restoreAccount();
      });

      expect(connectMock).toHaveBeenCalledWith('recover');
      expect(restoreProfileMock).toHaveBeenCalledWith(PASSKEY_WALLET);
      expect(toastMock.success).toHaveBeenCalledWith('Welcome back — @alvin restored.');
      expect(claimHandleMock).not.toHaveBeenCalled();
      expect(latest.restoring).toBe(false);
    });
  });

  it('reports a claim failure without saving a profile', async () => {
    const created: Profile[] = [];
    await mount('landing', (p) => created.push(p));
    await setHandle('failinguser');
    claimHandleMock.mockRejectedValueOnce(new Error('claim failed'));
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await act(async () => {
        await latest.createProfile();
      });
      expect(setProfileMock).not.toHaveBeenCalled();
      expect(trackErrorMock).toHaveBeenCalledWith(expect.any(Error), { flow: 'create_profile', from: 'landing' });
      expect(trackMock).not.toHaveBeenCalledWith('profile_created', expect.anything());
      expect(toastMock.success).not.toHaveBeenCalled();
      expect(toastMock.error).toHaveBeenCalledWith('claim failed');
      expect(created).toEqual([]);
      expect(latest.creating).toBe(false);
    } finally {
      consoleError.mockRestore();
    }
  });

  // Landing and /app onboarding used to carry near-duplicate copy that drifted (#240); both
  // now read the one shared `onboard.*` set, and only the claim page keeps its own.
  describe('messages', () => {
    it.each(['app', 'landing'] as const)('uses the shared onboarding copy from %s', async (from) => {
      await mount(from);
      await setHandle('ab');
      await act(async () => {
        await latest.createProfile();
      });
      expect(toastMock.error).toHaveBeenLastCalledWith('Pick a handle — 3+ letters or numbers.');

      availabilityMock.mockResolvedValue(TAKEN);
      await setHandle('takenname');
      await act(async () => {
        await latest.createProfile();
      });
      expect(toastMock.error).toHaveBeenLastCalledWith('@takenname is taken — pick another.');

      availabilityMock.mockResolvedValue(FREE);
      await setHandle('freename');
      await act(async () => {
        await latest.createProfile();
      });
      expect(toastMock.success).toHaveBeenLastCalledWith('Your profile is live — @freename stamped on-chain.');
    });

    it('keeps the claim page on its own copy', async () => {
      store.wallet = DEV_WALLET;
      await mount('claim');
      await setHandle('claimer');
      await act(async () => {
        await latest.createProfile();
      });
      expect(toastMock.success).toHaveBeenCalledWith("You're in — @claimer stamped on-chain.");
    });
  });

  it.each(['app', 'landing'] as const)('skips the genesis tx for a new passkey wallet from %s', async (from) => {
    connectMock.mockResolvedValue(PASSKEY_WALLET);
    await mount(from, undefined, 'face-02');
    await setHandle('passkeyuser');

    await act(async () => {
      await latest.createProfile();
    });

    expect(recordGenesisMock).not.toHaveBeenCalled();
    expect(claimHandleMock).toHaveBeenCalledWith(PASSKEY_WALLET, 'passkeyuser');
    expect(setProfileMock).toHaveBeenCalledWith(
      expect.objectContaining({
        handle: 'passkeyuser',
        genesisTx: undefined,
        avatar: { kind: 'face', id: 'face-02' },
        source: from,
      }),
    );
    expect(trackMock).toHaveBeenCalledWith('profile_created', { walletKind: 'passkey', from });
  });
});
