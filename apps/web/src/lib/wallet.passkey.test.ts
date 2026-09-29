/**
 * Regression tests for issue #186 — a failed passkey wallet deploy orphaned the newly created
 * passkey and retrying enrolled ANOTHER one. The fix splits enrollment (`kit.createKey`) from
 * deployment (a rebuildable `PasskeyClient.deploy`) and persists the key material + a
 * `pendingDeploy` marker before submitting, so a retry resumes with the SAME passkey.
 *
 * The kit and the relayer are mocked; the on-chain "does the contract exist?" probe and the
 * confirm poll are mocked through the rpc server.
 *
 * Runs in the NODE environment (not jsdom): the deploy builder derives the passkey-kit deployer
 * key from `hash('kalepail')` via @stellar/stellar-sdk, and jsdom's global `Uint8Array` is a
 * different realm from the SDK's bundled `buffer`, which trips @noble/ed25519's byte check. The
 * real browser bundle has a single realm, so this is a test-runner artifact only.
 */
// @vitest-environment node
import { createHash } from 'node:crypto';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  Account,
  Keypair,
  Networks,
  Operation,
  StrKey,
  TransactionBuilder,
} from '@stellar/stellar-sdk';
import { humanizeError } from './utils';

const mocks = vi.hoisted(() => ({
  createKey: vi.fn(),
  createWallet: vi.fn(),
  connectWallet: vi.fn(),
  deploy: vi.fn(),
  getTransaction: vi.fn(),
  getLedgerEntries: vi.fn(),
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
    getLedgerEntries: (...args: unknown[]) => mocks.getLedgerEntries(...args),
  },
}));

import { connectPasskey } from './wallet';

// A realistic base64url WebAuthn credential id (43 chars = 32 bytes, unpadded).
const KEY_ID = 'cZwu2LJZg1YEdS_DZzquI-d_x-g1nmyyVRM2GtgmKCI';
const KEY_ID_HEX = Buffer.from(KEY_ID, 'base64url').toString('hex');
// An uncompressed P-256 point (0x04 ‖ x ‖ y), the shape passkey-kit's getPublicKey returns.
const PUBKEY = Uint8Array.from({ length: 65 }, (_, i) => (i === 0 ? 0x04 : i));
const PUBKEY_B64 = Buffer.from(PUBKEY).toString('base64');
const PUBKEY_HEX = Buffer.from(PUBKEY).toString('hex');
const CONTRACT_ID = StrKey.encodeContract(Buffer.alloc(32, 7));
const OTHER_CONTRACT_ID = StrKey.encodeContract(Buffer.alloc(32, 9));
const WASM_HASH = 'ecd990f0b45ca6817149b6175f79b32efb442f35731985a084131e8265c4cd90';
// passkey-kit 0.12's shared deploy source: Keypair.fromRawEd25519Seed(hash('kalepail')). The
// rebuilt deploy must come from it, or its contract id would differ from createWallet's.
const DEPLOYER = 'GC2C7AWLS2FMFTQAHW3IBUB4ZXVP4E37XNLEF2IK7IVXBB6CMEPCSXFO';

const KEYID_KEY = 'alvinmunk.passkey.keyId';
const CONTRACT_KEY = 'alvinmunk.passkey.contractId';
const PUBKEY_KEY = 'alvinmunk.passkey.publicKey';
const PENDING_KEY = 'alvinmunk.passkey.pendingDeploy';

// Stand-in for the assembled deploy tx the SDK hands to the deployer signer.
const UNSIGNED_DEPLOY_XDR = new TransactionBuilder(new Account(DEPLOYER, '1'), {
  fee: '100',
  networkPassphrase: Networks.TESTNET,
})
  .addOperation(Operation.bumpSequence({ bumpTo: '2' }))
  .setTimeout(50)
  .build()
  .toXDR();

/** A deploy submission that succeeded at the relayer boundary. */
const relayerOk = (hash: string) => ({
  ok: true,
  status: 200,
  json: async () => ({ hash }),
});

/** A deploy submission the relayer rejected (or that never reached it). */
const relayerFail = (error: string, status = 502) => ({
  ok: false,
  status,
  json: async () => ({ error }),
});

const contractPresent = { entries: [{}], latestLedger: 1 };
const contractAbsent = { entries: [], latestLedger: 1 };

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

/** Everything the app left in localStorage. */
function stored(): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)!;
    out[k] = localStorage.getItem(k)!;
  }
  return out;
}

/** The record a failed first attempt leaves behind. */
function seedPendingRecord(record: Partial<Record<string, string>> = {}) {
  const full = {
    [PENDING_KEY]: '1',
    [KEYID_KEY]: KEY_ID,
    [PUBKEY_KEY]: PUBKEY_B64,
    [CONTRACT_KEY]: CONTRACT_ID,
    ...record,
  };
  for (const [k, v] of Object.entries(full)) if (v !== undefined) localStorage.setItem(k, v);
}

/** The deploy's constructor signer + options, hex-encoded so calls compare by value. */
function deployCall(i: number) {
  const [args, opts] = mocks.deploy.mock.calls[i] as [
    { signer: { tag: string; values: unknown[] } },
    Record<string, unknown>,
  ];
  const [keyId, publicKey, ...rest] = args.signer.values;
  return {
    signer: {
      tag: args.signer.tag,
      keyId: Buffer.from(keyId as Uint8Array).toString('hex'),
      publicKey: Buffer.from(publicKey as Uint8Array).toString('hex'),
      rest,
    },
    options: { ...opts, salt: Buffer.from(opts.salt as Uint8Array).toString('hex') },
  };
}

function sentXdr(i: number): string {
  return JSON.parse(fetchMock.mock.calls[i][1].body).xdr;
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_PASSKEY_WALLET_WASM_HASH = WASM_HASH;
  vi.stubGlobal('localStorage', memoryStorage());

  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);

  mocks.createKey.mockReset().mockResolvedValue({
    keyId: Buffer.from(KEY_ID, 'base64url'),
    keyIdBase64: KEY_ID,
    publicKey: Buffer.from(PUBKEY),
  });
  mocks.createWallet.mockReset();
  mocks.connectWallet
    .mockReset()
    .mockImplementation(async (opts: { keyId: string; getContractId: () => Promise<string> }) => ({
      keyIdBase64: opts.keyId,
      contractId: await opts.getContractId(),
    }));
  mocks.deploy.mockReset().mockImplementation(async () => {
    const at = {
      result: { options: { contractId: CONTRACT_ID } },
      signed: undefined as { toXDR(): string } | undefined,
      sign: async ({ signTransaction }: { signTransaction: (x: string) => Promise<{ signedTxXdr: string }> }) => {
        const { signedTxXdr } = await signTransaction(UNSIGNED_DEPLOY_XDR);
        at.signed = { toXDR: () => signedTxXdr };
      },
    };
    return at;
  });
  mocks.getTransaction.mockReset().mockResolvedValue({ status: 'SUCCESS' });
  mocks.getLedgerEntries.mockReset().mockResolvedValue(contractAbsent);
});

afterEach(() => {
  delete process.env.NEXT_PUBLIC_PASSKEY_WALLET_WASM_HASH;
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('connectPasskey — first run and returning user', () => {
  it('enrolls once, deploys the passkey-kit wallet, and keeps only the key id + contract id', async () => {
    fetchMock.mockResolvedValueOnce(relayerOk('HASH-1'));

    const wallet = await connectPasskey();

    expect(mocks.createKey).toHaveBeenCalledTimes(1);
    expect(mocks.createWallet).not.toHaveBeenCalled();
    // The same deploy passkey-kit's createWallet builds: Secp256r1 signer from this passkey,
    // the shared deploy source, and hash(keyId) as salt (which fixes the contract id).
    expect(mocks.deploy).toHaveBeenCalledTimes(1);
    expect(deployCall(0)).toEqual({
      signer: {
        tag: 'Secp256r1',
        keyId: KEY_ID_HEX,
        publicKey: PUBKEY_HEX,
        rest: [[undefined], [undefined], { tag: 'Persistent', values: undefined }],
      },
      options: {
        rpcUrl: 'https://rpc.test',
        wasmHash: WASM_HASH,
        networkPassphrase: Networks.TESTNET,
        publicKey: DEPLOYER,
        salt: createHash('sha256').update(Buffer.from(KEY_ID, 'base64url')).digest('hex'),
        timeoutInSeconds: 50,
      },
    });

    // The relayer gets the deployer-signed tx, and the confirm poll watches its hash.
    const tx = TransactionBuilder.fromXDR(sentXdr(0), Networks.TESTNET);
    expect(tx.signatures).toHaveLength(1);
    expect(Keypair.fromPublicKey(DEPLOYER).verify(tx.hash(), tx.signatures[0].signature())).toBe(true);
    expect(mocks.getTransaction).toHaveBeenCalledWith('HASH-1');
    // A fresh enrollment has nothing on-chain to probe.
    expect(mocks.getLedgerEntries).not.toHaveBeenCalled();

    expect(wallet.kind).toBe('passkey');
    expect(wallet.address).toBe(CONTRACT_ID);
    expect(mocks.connectWallet).toHaveBeenCalledWith(expect.objectContaining({ keyId: KEY_ID }));
    // Once confirmed, only public identifiers remain — the same shape as before #186.
    expect(stored()).toEqual({ [KEYID_KEY]: KEY_ID, [CONTRACT_KEY]: CONTRACT_ID });
  });

  it('connects a returning user without enrolling, deploying, or probing the chain', async () => {
    localStorage.setItem(KEYID_KEY, KEY_ID);
    localStorage.setItem(CONTRACT_KEY, CONTRACT_ID);

    const wallet = await connectPasskey();

    expect(mocks.createKey).not.toHaveBeenCalled();
    expect(mocks.deploy).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.getLedgerEntries).not.toHaveBeenCalled();
    expect(mocks.connectWallet).toHaveBeenCalledWith(expect.objectContaining({ keyId: KEY_ID }));
    expect(wallet.address).toBe(CONTRACT_ID);
    expect(stored()).toEqual({ [KEYID_KEY]: KEY_ID, [CONTRACT_KEY]: CONTRACT_ID });
  });
});

describe('connectPasskey deploy resilience (#186)', () => {
  it('reuses the first passkey when the relayer rejects the deploy — no second enrollment', async () => {
    // 1st attempt: the passkey is created, the deploy is built and submitted, the relayer rejects.
    fetchMock.mockResolvedValueOnce(relayerFail('relayer unavailable'));

    const err = await connectPasskey().catch((e: unknown) => e);

    // The user is told a retry will reuse their passkey (and why it failed).
    expect(err).toBeInstanceOf(Error);
    expect(humanizeError(err)).toBe(
      "Wallet setup didn't finish — try again, your passkey is saved. (relayer unavailable)",
    );
    // The passkey is recorded, pending its deploy. Public data only.
    expect(stored()).toEqual({
      [PENDING_KEY]: '1',
      [KEYID_KEY]: KEY_ID,
      [PUBKEY_KEY]: PUBKEY_B64,
      [CONTRACT_KEY]: CONTRACT_ID,
    });

    // 2nd attempt: the contract never landed -> rebuild the deploy from the STORED key material
    // and resubmit. No WebAuthn enrollment happens again.
    fetchMock.mockResolvedValueOnce(relayerOk('HASH-2'));

    const wallet = await connectPasskey();

    expect(mocks.createKey).toHaveBeenCalledTimes(1); // <-- the whole point of the fix
    expect(mocks.createWallet).not.toHaveBeenCalled();
    // Rebuilt (the first tx's time bounds are stale), and byte-for-byte the same deploy.
    expect(mocks.deploy).toHaveBeenCalledTimes(2);
    expect(deployCall(1)).toEqual(deployCall(0));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(mocks.getTransaction).toHaveBeenCalledWith('HASH-2');
    expect(wallet.address).toBe(CONTRACT_ID);
    expect(stored()).toEqual({ [KEYID_KEY]: KEY_ID, [CONTRACT_KEY]: CONTRACT_ID });
  });

  it('picks up a deploy that lands after the confirm poll timed out — no resubmit', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    fetchMock.mockResolvedValueOnce(relayerOk('HASH-1'));
    mocks.getTransaction.mockResolvedValue({ status: 'NOT_FOUND' });

    const first = connectPasskey();
    const rejected = expect(first).rejects.toThrow(/passkey is saved.*not confirmed in time/);
    await vi.advanceTimersByTimeAsync(70_000);
    await rejected;
    expect(localStorage.getItem(PENDING_KEY)).toBe('1');

    // The deploy lands late; the next connect adopts it instead of deploying a second wallet.
    mocks.getLedgerEntries.mockResolvedValue(contractPresent);

    const wallet = await connectPasskey();

    expect(mocks.createKey).toHaveBeenCalledTimes(1);
    expect(mocks.deploy).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(wallet.address).toBe(CONTRACT_ID);
    expect(stored()).toEqual({ [KEYID_KEY]: KEY_ID, [CONTRACT_KEY]: CONTRACT_ID });
  });

  it.each([
    ['the relayer errors after submitting', () => fetchMock.mockResolvedValueOnce(relayerFail('upstream timeout', 504))],
    [
      'the tx is reported FAILED (an earlier attempt already deployed it)',
      () => {
        fetchMock.mockResolvedValueOnce(relayerOk('HASH-1'));
        mocks.getTransaction.mockResolvedValue({ status: 'FAILED' });
      },
    ],
  ])('adopts a deploy that landed although %s', async (_label, arrange) => {
    arrange();
    mocks.getLedgerEntries.mockResolvedValue(contractPresent);

    const wallet = await connectPasskey();

    expect(mocks.createKey).toHaveBeenCalledTimes(1);
    expect(mocks.deploy).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(wallet.address).toBe(CONTRACT_ID);
    expect(stored()).toEqual({ [KEYID_KEY]: KEY_ID, [CONTRACT_KEY]: CONTRACT_ID });
  });

  it('adopts a landed wallet from a pending record without needing its key material', async () => {
    seedPendingRecord({ [PUBKEY_KEY]: undefined });
    mocks.getLedgerEntries.mockResolvedValue(contractPresent);

    const wallet = await connectPasskey();

    expect(mocks.createKey).not.toHaveBeenCalled();
    expect(mocks.deploy).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(wallet.address).toBe(CONTRACT_ID);
    expect(stored()).toEqual({ [KEYID_KEY]: KEY_ID, [CONTRACT_KEY]: CONTRACT_ID });
  });

  it.each([
    ['its public key is missing', { [PUBKEY_KEY]: undefined }],
    ['its public key is not base64', { [PUBKEY_KEY]: '%%%not-base64%%%' }],
    ['its public key is not a P-256 point', { [PUBKEY_KEY]: 'BAECAw==' }],
    ['its key id is not base64url', { [KEYID_KEY]: '***' }],
  ])('drops a pending record whose wallet never landed when %s, and enrolls afresh', async (_label, corruption) => {
    seedPendingRecord({ [CONTRACT_KEY]: OTHER_CONTRACT_ID, ...corruption });
    fetchMock.mockResolvedValueOnce(relayerOk('HASH-1'));

    const wallet = await connectPasskey();

    // Nothing to resume, so the user gets a working wallet instead of a dead end.
    expect(mocks.createKey).toHaveBeenCalledTimes(1);
    expect(mocks.deploy).toHaveBeenCalledTimes(1);
    expect(deployCall(0).signer).toMatchObject({ keyId: KEY_ID_HEX, publicKey: PUBKEY_HEX });
    expect(wallet.address).toBe(CONTRACT_ID);
    expect(stored()).toEqual({ [KEYID_KEY]: KEY_ID, [CONTRACT_KEY]: CONTRACT_ID });
  });

  it('never adopts a stale contract id left behind by an earlier record', async () => {
    // A stray marker + another wallet's contract id, with no key id. That wallet is live.
    localStorage.setItem(PENDING_KEY, '1');
    localStorage.setItem(CONTRACT_KEY, OTHER_CONTRACT_ID);
    mocks.getLedgerEntries.mockResolvedValue(contractPresent);
    mocks.deploy.mockRejectedValueOnce(new Error('simulation failed'));

    const err = await connectPasskey().catch((e: unknown) => e);

    expect(humanizeError(err)).toMatch(/passkey is saved\. \(simulation failed\)/);
    // The failed deploy is not mistaken for "landed" on the strength of the other wallet.
    expect(mocks.getLedgerEntries).not.toHaveBeenCalled();
    expect(mocks.connectWallet).not.toHaveBeenCalled();
    expect(stored()).toEqual({ [PENDING_KEY]: '1', [KEYID_KEY]: KEY_ID, [PUBKEY_KEY]: PUBKEY_B64 });
  });

  it('keeps the pending record when the chain check itself fails', async () => {
    seedPendingRecord();
    // What the SDK's JSON-RPC client rejects with — not an Error instance.
    mocks.getLedgerEntries.mockRejectedValue({ code: -32603, message: 'rpc unavailable' });

    const err = await connectPasskey().catch((e: unknown) => e);

    expect(err).toBeInstanceOf(Error);
    expect(humanizeError(err)).toBe("Couldn't reach the network to check your wallet — try again in a moment.");
    // An RPC blip is not "absent": no rebuild, no resubmit, no new passkey, nothing discarded.
    expect(mocks.createKey).not.toHaveBeenCalled();
    expect(mocks.deploy).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(stored()).toEqual({
      [PENDING_KEY]: '1',
      [KEYID_KEY]: KEY_ID,
      [PUBKEY_KEY]: PUBKEY_B64,
      [CONTRACT_KEY]: CONTRACT_ID,
    });
  });
});
