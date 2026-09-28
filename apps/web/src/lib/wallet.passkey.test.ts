/**
 * Regression tests for issue #186 — a failed passkey wallet deploy orphaned the newly created
 * passkey and retrying enrolled ANOTHER one. The fix splits enrollment (`kit.createKey`) from
 * deployment (a rebuildable `PasskeyClient.deploy`) and persists the key material + a
 * `pendingDeploy` marker before submitting, so a retry resumes with the SAME passkey.
 *
 * The kit and the relayer are mocked; the on-chain "does the contract exist?" probe is mocked
 * through the rpc server.
 *
 * Runs in the NODE environment (not jsdom): the deploy builder derives the passkey-kit deployer
 * key from `hash('kalepail')` via @stellar/stellar-sdk, and jsdom's global `Uint8Array` is a
 * different realm from the SDK's bundled `buffer`, which trips @noble/ed25519's byte check. The
 * real browser bundle has a single realm, so this is a test-runner artifact only.
 */
// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  createKey: vi.fn(),
  createWallet: vi.fn(),
  connectWallet: vi.fn(),
  deploy: vi.fn(),
  getTransaction: vi.fn(),
  getContractData: vi.fn(),
}));

vi.mock('passkey-kit', () => ({
  PasskeyKit: class {
    createKey = mocks.createKey;
    createWallet = mocks.createWallet;
    connectWallet = mocks.connectWallet;
    sign = vi.fn();
    wallet = undefined;
    keyId = undefined;
  },
  PasskeyClient: {
    deploy: (...args: unknown[]) => mocks.deploy(...args),
  },
}));

vi.mock('./stellar', () => ({
  config: { rpcUrl: 'https://rpc.test', network: 'testnet' },
  networkPassphrase: 'Test SDF Network ; September 2015',
  waitForAccountReady: vi.fn(),
  server: {
    getTransaction: (...args: unknown[]) => mocks.getTransaction(...args),
    getContractData: (...args: unknown[]) => mocks.getContractData(...args),
  },
}));

import { connectPasskey } from './wallet';

// A realistic base64url WebAuthn credential id (43 chars = 32 bytes, unpadded).
const KEY_ID = 'cZwu2LJZg1YEdS_DZzquI-d_x-g1nmyyVRM2GtgmKCI';
const PUBKEY = 'BAECAw=='; // base64 of Uint8Array [4,1,2,3]
const CONTRACT_ID = 'C'.padEnd(56, 'A');
const WASM_HASH = 'ecd990f0b45ca6817149b6175f79b32efb442f35731985a084131e8265c4cd90';

const KEYID_KEY = 'alvinmunk.passkey.keyId';
const CONTRACT_KEY = 'alvinmunk.passkey.contractId';
const PUBKEY_KEY = 'alvinmunk.passkey.publicKey';
const PENDING_KEY = 'alvinmunk.passkey.pendingDeploy';

/** A deploy submission that succeeded at the relayer boundary. */
const relayerOk = (hash: string) => ({
  ok: true,
  status: 200,
  json: async () => ({ hash }),
});

/** A deploy submission the relayer rejected (or that never reached it). */
const relayerFail = (error: string) => ({
  ok: false,
  status: 502,
  json: async () => ({ error }),
});

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

beforeEach(() => {
  process.env.NEXT_PUBLIC_PASSKEY_WALLET_WASM_HASH = WASM_HASH;
  vi.stubGlobal('localStorage', memoryStorage());

  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);

  mocks.createKey.mockReset().mockResolvedValue({
    keyIdBase64: KEY_ID,
    publicKey: new Uint8Array([4, 1, 2, 3]),
  });
  mocks.createWallet.mockReset();
  mocks.connectWallet
    .mockReset()
    .mockImplementation(async (opts: { keyId?: string }) => ({
      keyIdBase64: opts.keyId,
      contractId: CONTRACT_ID,
    }));
  mocks.deploy.mockReset().mockImplementation(async () => ({
    result: { options: { contractId: CONTRACT_ID } },
    sign: async () => {},
    signed: { toXDR: () => 'signed-deploy-xdr' },
  }));
  mocks.getTransaction.mockReset().mockResolvedValue({ status: 'SUCCESS' });
  mocks.getContractData.mockReset();
});

afterEach(() => {
  delete process.env.NEXT_PUBLIC_PASSKEY_WALLET_WASM_HASH;
  vi.unstubAllGlobals();
});

describe('connectPasskey deploy resilience (#186)', () => {
  it('reuses the first passkey when the relayer rejects the deploy — no second enrollment', async () => {
    // 1st attempt: the passkey is created, the deploy is built and submitted, the relayer rejects.
    fetchMock.mockResolvedValueOnce(relayerFail('relayer unavailable'));

    await expect(connectPasskey()).rejects.toThrow(/relayer unavailable/);

    // The passkey is NOT re-created on the next attempt — it is recorded, pending its deploy.
    expect(mocks.createKey).toHaveBeenCalledTimes(1);
    expect(mocks.createWallet).not.toHaveBeenCalled();
    expect(localStorage.getItem(KEYID_KEY)).toBe(KEY_ID);
    expect(localStorage.getItem(PUBKEY_KEY)).toBe(PUBKEY);
    expect(localStorage.getItem(PENDING_KEY)).toBe('1');

    // 2nd attempt: the contract never landed -> rebuild the deploy from the STORED public key and
    // resubmit. No WebAuthn enrollment happens again.
    mocks.deploy.mockClear();
    mocks.getContractData.mockRejectedValue(new Error('not found'));
    fetchMock.mockResolvedValueOnce(relayerOk('HASH-2'));

    const wallet = await connectPasskey();

    expect(mocks.createKey).toHaveBeenCalledTimes(1); // <-- the whole point of the fix
    expect(mocks.createWallet).not.toHaveBeenCalled();
    expect(mocks.deploy).toHaveBeenCalledTimes(1); // exactly one resubmitted rebuild
    expect(mocks.connectWallet).toHaveBeenCalledWith(
      expect.objectContaining({ keyId: KEY_ID }),
    );
    expect(wallet.address).toBe(CONTRACT_ID);
    expect(localStorage.getItem(PENDING_KEY)).toBeNull();
  });

  it('picks up a deploy that landed after the confirm poll timed out', async () => {
    // State left behind by a timed-out poll: enrollment persisted, deploy submitted, marker set.
    localStorage.setItem(KEYID_KEY, KEY_ID);
    localStorage.setItem(PUBKEY_KEY, PUBKEY);
    localStorage.setItem(CONTRACT_KEY, CONTRACT_ID);
    localStorage.setItem(PENDING_KEY, '1');

    // The contract is on-chain now (the late deploy), so the retry must NOT redeploy.
    mocks.getContractData.mockResolvedValue({});

    const wallet = await connectPasskey();

    expect(mocks.createKey).not.toHaveBeenCalled();
    expect(mocks.deploy).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(wallet.address).toBe(CONTRACT_ID);
    expect(localStorage.getItem(PENDING_KEY)).toBeNull();
    expect(localStorage.getItem(CONTRACT_KEY)).toBe(CONTRACT_ID);
  });

  it('rebuilds (does not replay) the deploy for a resumed enrollment with a stale tx', async () => {
    localStorage.setItem(KEYID_KEY, KEY_ID);
    localStorage.setItem(PUBKEY_KEY, PUBKEY);
    localStorage.setItem(CONTRACT_KEY, CONTRACT_ID);
    localStorage.setItem(PENDING_KEY, '1');

    // Contract still absent -> the stale signed tx cannot be reused; a fresh one is built.
    mocks.getContractData.mockRejectedValue(new Error('not found'));
    fetchMock.mockResolvedValueOnce(relayerOk('HASH-3'));

    await connectPasskey();

    expect(mocks.deploy).toHaveBeenCalledTimes(1);
    expect(mocks.deploy).toHaveBeenCalledWith(
      expect.objectContaining({
        signer: expect.objectContaining({ tag: 'Secp256r1' }),
      }),
      expect.objectContaining({ wasmHash: WASM_HASH, timeoutInSeconds: 50 }),
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ xdr: 'signed-deploy-xdr' });
  });
});
