/**
 * Regression tests for issue #185 — the dev wallet's key is saved before Friendbot funds it,
 * and a retry used to skip funding because the key already existed, stranding the address
 * unfunded for good. Funding is now decided by whether the account exists on-chain.
 *
 * Friendbot is the real `fundWithFriendbot` against a mocked `fetch`; the on-chain probe is
 * mocked through `./stellar`. Runs in the NODE environment for the reason given in
 * wallet.passkey.test.ts (jsdom's `Uint8Array` realm trips the SDK's ed25519 byte checks).
 */
// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Keypair } from '@stellar/stellar-sdk';

const mocks = vi.hoisted(() => ({
  accountExists: vi.fn(),
  waitForAccountReady: vi.fn(),
}));

vi.mock('./stellar', () => ({
  config: { rpcUrl: 'https://rpc.test', network: 'testnet' },
  networkPassphrase: 'Test SDF Network ; September 2015',
  accountExists: (...args: unknown[]) => mocks.accountExists(...args),
  waitForAccountReady: (...args: unknown[]) => mocks.waitForAccountReady(...args),
  server: {},
}));

import { getDevWallet } from './wallet';

const DEV_SECRET_KEY = 'alvinmunk.devSecret';

const friendbotOk = { ok: true, status: 200 };
const friendbotBusy = { ok: false, status: 503 };

let fetchMock: ReturnType<typeof vi.fn>;

/** Minimal in-memory localStorage (the node test environment has none). */
function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, String(v)),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() {
      return map.size;
    },
  };
}

/** The addresses Friendbot was asked to fund, in call order. */
function fundedAddresses(): string[] {
  return fetchMock.mock.calls.map(([url]) => new URL(String(url)).searchParams.get('addr')!);
}

beforeEach(() => {
  vi.stubGlobal('localStorage', memoryStorage());
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  mocks.accountExists.mockReset();
  mocks.waitForAccountReady.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('getDevWallet funding', () => {
  it('funds the same address on the retry after Friendbot failed on the first run', async () => {
    vi.useFakeTimers();
    mocks.accountExists.mockResolvedValue(false); // never funded
    fetchMock.mockResolvedValue(friendbotBusy);

    const first = getDevWallet();
    const failed = expect(first).rejects.toThrow(/Friendbot is busy/);
    await vi.advanceTimersByTimeAsync(10_000); // every retry backoff
    await failed;
    expect(fetchMock).toHaveBeenCalledTimes(4); // fundWithFriendbot's attempts
    const address = fundedAddresses()[0];
    const secret = localStorage.getItem(DEV_SECRET_KEY);
    expect(secret && Keypair.fromSecret(secret).publicKey()).toBe(address);

    fetchMock.mockReset().mockResolvedValue(friendbotOk);
    const wallet = await getDevWallet();

    expect(wallet.address).toBe(address);
    expect(mocks.accountExists).toHaveBeenCalledWith(address);
    expect(fundedAddresses()).toEqual([address]); // funding attempted again
    expect(mocks.waitForAccountReady).toHaveBeenCalledWith(address);
    expect(localStorage.getItem(DEV_SECRET_KEY)).toBe(secret);
  });

  it('does not call Friendbot for a stored key that is already funded', async () => {
    const kp = Keypair.random();
    localStorage.setItem(DEV_SECRET_KEY, kp.secret());
    mocks.accountExists.mockResolvedValue(true);

    const wallet = await getDevWallet();

    expect(wallet.address).toBe(kp.publicKey());
    expect(mocks.accountExists).toHaveBeenCalledWith(kp.publicKey());
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.waitForAccountReady).not.toHaveBeenCalled();
  });

  it('funds a new key without probing the chain, after saving it', async () => {
    fetchMock.mockImplementation(async () => {
      // The key is on disk before Friendbot is called, so a failure here can be retried.
      expect(localStorage.getItem(DEV_SECRET_KEY)).not.toBeNull();
      return friendbotOk;
    });

    const wallet = await getDevWallet();

    expect(mocks.accountExists).not.toHaveBeenCalled();
    expect(fundedAddresses()).toEqual([wallet.address]);
    expect(Keypair.fromSecret(localStorage.getItem(DEV_SECRET_KEY)!).publicKey()).toBe(
      wallet.address,
    );
  });

  it('does not treat an RPC outage as an unfunded account', async () => {
    const kp = Keypair.random();
    localStorage.setItem(DEV_SECRET_KEY, kp.secret());
    mocks.accountExists.mockRejectedValue(new Error('RPC unavailable'));

    await expect(getDevWallet()).rejects.toThrow('RPC unavailable');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(localStorage.getItem(DEV_SECRET_KEY)).toBe(kp.secret());
  });
});
