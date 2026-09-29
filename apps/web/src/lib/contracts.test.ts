// @vitest-environment node
import {
  Account,
  Address,
  Contract,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
  authorizeEntry,
  nativeToScVal,
  scValToNative,
  xdr,
  type Transaction,
} from '@stellar/stellar-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { server } = vi.hoisted(() => ({
  server: {
    getAccount: vi.fn(),
    prepareTransaction: vi.fn(),
    sendTransaction: vi.fn(),
    getTransaction: vi.fn(),
    getLedgerEntries: vi.fn(),
    getLatestLedger: vi.fn(),
  },
}));
vi.mock('./stellar', () => ({
  server,
  networkPassphrase: Networks.TESTNET,
  config: { contracts: {} },
}));

import {
  enumKey,
  instanceStorageValue,
  invokeAndWait,
  invokeAndWaitHash,
  invokeCosigned,
  readInstanceValue,
  readLedgerData,
} from './contracts';
import type { Wallet } from './wallet';

const CONTRACT = 'CBEJVYLWTU6BQDL3RXKWW6CYUISRC4SUIVURCG452CTOIANGY2N7V3WI';
const SOURCE = 'GDIS5BDXSI2DDJNTKRZPI6MNB5XCLMN4Z6PPRPM4RQLZ3PSQ2YTERLFA';
const u32 = (n: number) => nativeToScVal(n, { type: 'u32' });

describe('invokeAndWait / invokeAndWaitHash', () => {
  beforeEach(() => {
    Object.values(server).forEach((m) => m.mockReset());
  });

  it('classic wallet: build → sign → send → poll; returns the value or the hash', async () => {
    server.getAccount.mockImplementation(async () => new Account(SOURCE, '1'));
    server.prepareTransaction.mockImplementation(async (tx) => tx);
    server.sendTransaction.mockResolvedValue({ status: 'PENDING', hash: 'abc123' });
    server.getTransaction.mockResolvedValue({ status: 'SUCCESS', returnValue: u32(7) });
    const sign = vi.fn(async (x: string) => x);
    const wallet: Wallet = { kind: 'freighter', address: SOURCE, sign };

    await expect(invokeAndWait(CONTRACT, 'create_quest', [u32(1)], wallet)).resolves.toBe(7);
    await expect(invokeAndWaitHash(CONTRACT, 'create_quest', [u32(1)], wallet)).resolves.toBe(
      'abc123',
    );
    expect(sign).toHaveBeenCalledTimes(2);
    expect(server.getTransaction).toHaveBeenCalledWith('abc123');
  });

  it('passkey wallet: routes through invoke and never builds a classic tx', async () => {
    const invoke = vi.fn(async () => ({ hash: 'pk-hash', value: 42 }));
    const wallet: Wallet = {
      kind: 'passkey',
      address: CONTRACT,
      sign: vi.fn(),
      invoke,
    };
    await expect(invokeAndWait(CONTRACT, 'mint_vouch', [], wallet)).resolves.toBe(42);
    await expect(invokeAndWaitHash(CONTRACT, 'mint_vouch', [], wallet)).resolves.toBe('pk-hash');
    expect(invoke).toHaveBeenCalledWith(CONTRACT, 'mint_vouch', []);
    expect(server.getAccount).not.toHaveBeenCalled();
  });

  it('refuses an undeployed contract before touching the wallet', async () => {
    const wallet: Wallet = { kind: 'dev', address: SOURCE, sign: vi.fn() };
    await expect(invokeAndWaitHash('', 'add_reward', [], wallet)).rejects.toThrow(
      'Contract not deployed',
    );
    expect(wallet.sign).not.toHaveBeenCalled();
  });

  describe('when Core answers TRY_AGAIN_LATER', () => {
    const wallet = (): Wallet => ({
      kind: 'freighter',
      address: SOURCE,
      sign: vi.fn(async (x: string) => x),
    });
    beforeEach(() => {
      server.getAccount.mockImplementation(async () => new Account(SOURCE, '1'));
      server.prepareTransaction.mockImplementation(async (tx) => tx);
      vi.useFakeTimers();
    });
    afterEach(() => vi.useRealTimers());

    it('resubmits the same signed envelope until PENDING, then polls its hash', async () => {
      server.sendTransaction
        .mockResolvedValueOnce({ status: 'TRY_AGAIN_LATER', hash: 'abc123' })
        .mockResolvedValueOnce({ status: 'TRY_AGAIN_LATER', hash: 'abc123' })
        .mockResolvedValue({ status: 'PENDING', hash: 'abc123' });
      server.getTransaction.mockResolvedValue({ status: 'SUCCESS', returnValue: u32(7) });

      const p = invokeAndWait(CONTRACT, 'create_quest', [u32(1)], wallet());
      await vi.runAllTimersAsync();
      await expect(p).resolves.toBe(7);
      expect(server.sendTransaction).toHaveBeenCalledTimes(3);
      const [first] = server.sendTransaction.mock.calls[0];
      for (const [sent] of server.sendTransaction.mock.calls) expect(sent).toBe(first);
      expect(server.getTransaction).toHaveBeenCalledWith('abc123');
    });

    it('gives up with a clear, retryable error and never polls the hash', async () => {
      server.sendTransaction.mockResolvedValue({ status: 'TRY_AGAIN_LATER', hash: 'abc123' });

      const p = invokeAndWaitHash(CONTRACT, 'create_quest', [u32(1)], wallet());
      const settled = expect(p).rejects.toThrow(/network is busy/);
      await vi.runAllTimersAsync();
      await settled;
      expect(server.getTransaction).not.toHaveBeenCalled();
    });

    it('treats DUPLICATE as accepted and polls its hash', async () => {
      server.sendTransaction.mockResolvedValue({ status: 'DUPLICATE', hash: 'dup-1' });
      server.getTransaction.mockResolvedValue({ status: 'SUCCESS', returnValue: u32(7) });

      await expect(invokeAndWait(CONTRACT, 'create_quest', [u32(1)], wallet())).resolves.toBe(7);
      expect(server.sendTransaction).toHaveBeenCalledTimes(1);
      expect(server.getTransaction).toHaveBeenCalledWith('dup-1');
    });
  });
});

describe('invokeCosigned', () => {
  const cosignerKey = Keypair.random();
  const OTHER = Keypair.random().publicKey();

  /** An unsigned auth entry for `transfer_handle` — address credentials for `who`, or the
   * tx source's own when `who` is null. */
  function entry(who: string | null): xdr.SorobanAuthorizationEntry {
    const rootInvocation = new xdr.SorobanAuthorizedInvocation({
      function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
        new xdr.InvokeContractArgs({
          contractAddress: new Address(CONTRACT).toScAddress(),
          functionName: 'transfer_handle',
          args: [],
        }),
      ),
      subInvocations: [],
    });
    const credentials = who
      ? xdr.SorobanCredentials.sorobanCredentialsAddress(
          new xdr.SorobanAddressCredentials({
            address: new Address(who).toScAddress(),
            nonce: xdr.Int64.fromString('7'),
            signatureExpirationLedger: 0,
            signature: xdr.ScVal.scvVoid(),
          }),
        )
      : xdr.SorobanCredentials.sorobanCredentialsSourceAccount();
    return new xdr.SorobanAuthorizationEntry({ credentials, rootInvocation });
  }

  /** `tx` rebuilt as simulation would hand it back: the same call carrying `auth`. */
  function withAuth(tx: Transaction, auth: xdr.SorobanAuthorizationEntry[]): Transaction {
    const op = tx.operations[0] as Operation.InvokeHostFunction;
    return TransactionBuilder.cloneFrom(tx)
      .clearOperations()
      .addOperation(Operation.invokeHostFunction({ func: op.func, auth }))
      .build();
  }

  const authOf = (tx: Transaction) => (tx.operations[0] as Operation.InvokeHostFunction).auth ?? [];
  const signed = (e: xdr.SorobanAuthorizationEntry) =>
    e.credentials().address().signature().switch() !== xdr.ScValType.scvVoid();

  const cosigner = (): Wallet => ({
    kind: 'dev',
    address: cosignerKey.publicKey(),
    sign: vi.fn(),
    signAuthEntry: vi.fn((e: xdr.SorobanAuthorizationEntry, until: number) =>
      authorizeEntry(e, cosignerKey, until, Networks.TESTNET),
    ),
  });

  beforeEach(() => {
    Object.values(server).forEach((m) => m.mockReset());
    server.getLatestLedger.mockResolvedValue({ sequence: 1_000 });
    server.getAccount.mockImplementation(async () => new Account(SOURCE, '1'));
    server.sendTransaction.mockResolvedValue({ status: 'PENDING', hash: 'tx-hash' });
    server.getTransaction.mockResolvedValue({ status: 'SUCCESS' });
  });

  it("classic submitter: signs only the co-signer's entry, re-simulates, then the submitter signs", async () => {
    // first simulation records the auth; the second sees the co-signature and keeps it
    server.prepareTransaction
      .mockImplementationOnce(async (tx: Transaction) =>
        withAuth(tx, [entry(null), entry(cosignerKey.publicKey()), entry(OTHER)]),
      )
      .mockImplementationOnce(async (tx: Transaction) => tx);
    const sign = vi.fn(async (x: string) => x);
    const submitter: Wallet = { kind: 'freighter', address: SOURCE, sign };
    const co = cosigner();

    await expect(invokeCosigned(CONTRACT, 'transfer_handle', [], submitter, co)).resolves.toEqual({
      hash: 'tx-hash',
      value: undefined,
    });

    expect(co.signAuthEntry).toHaveBeenCalledTimes(1);
    const resimulated = server.prepareTransaction.mock.calls[1][0] as Transaction;
    const [source, mine, other] = authOf(resimulated);
    expect(source.credentials().switch()).toBe(
      xdr.SorobanCredentialsType.sorobanCredentialsSourceAccount(),
    );
    expect(signed(mine)).toBe(true);
    expect(mine.credentials().address().signatureExpirationLedger()).toBe(1_120);
    expect(signed(other)).toBe(false); // someone else's to sign
    // the submitter signs the re-simulated call, co-signature included
    const submitted = TransactionBuilder.fromXDR(sign.mock.calls[0][0], Networks.TESTNET) as Transaction;
    expect(signed(authOf(submitted)[1])).toBe(true);
  });

  it('passkey submitter: hands invoke a cosign step that signs the co-signer entry first', async () => {
    const invoke = vi.fn(async () => ({ hash: 'pk-hash', value: undefined }));
    const submitter: Wallet = {
      kind: 'passkey',
      address: CONTRACT,
      sign: vi.fn(),
      invoke,
    };
    await expect(invokeCosigned(CONTRACT, 'transfer_handle', [], submitter, cosigner())).resolves.toEqual(
      { hash: 'pk-hash', value: undefined },
    );
    const cosign = (invoke.mock.calls[0] as unknown[])[3] as (tx: Transaction) => Promise<Transaction>;
    const prepared = withAuth(
      new TransactionBuilder(new Account(SOURCE, '1'), { fee: '100', networkPassphrase: Networks.TESTNET })
        .addOperation(new Contract(CONTRACT).call('transfer_handle'))
        .setTimeout(30)
        .build(),
      [entry(cosignerKey.publicKey()), entry(CONTRACT)],
    );
    const [mine, passkeys] = authOf(await cosign(prepared));
    expect(signed(mine)).toBe(true);
    expect(signed(passkeys)).toBe(false); // the passkey signs its own inside invoke
    expect(server.getAccount).not.toHaveBeenCalled();
  });

  it('refuses before the submitter signs when the co-signer cannot sign auth entries', async () => {
    server.prepareTransaction.mockImplementationOnce(async (tx: Transaction) =>
      withAuth(tx, [entry(null), entry(OTHER)]),
    );
    const sign = vi.fn(async (x: string) => x);
    const submitter: Wallet = { kind: 'freighter', address: SOURCE, sign };
    const noKey: Wallet = { kind: 'freighter', address: OTHER, sign: vi.fn() };
    await expect(invokeCosigned(CONTRACT, 'transfer_handle', [], submitter, noKey)).rejects.toThrow(
      "can't co-sign",
    );
    expect(sign).not.toHaveBeenCalled();
    expect(server.sendTransaction).not.toHaveBeenCalled();
  });

  it('refuses when the call asks nothing of the co-signer', async () => {
    server.prepareTransaction.mockImplementationOnce(async (tx: Transaction) =>
      withAuth(tx, [entry(null), entry(OTHER)]),
    );
    const sign = vi.fn(async (x: string) => x);
    const submitter: Wallet = { kind: 'freighter', address: SOURCE, sign };
    await expect(
      invokeCosigned(CONTRACT, 'transfer_handle', [], submitter, cosigner()),
    ).rejects.toThrow('Nothing in this call');
    expect(sign).not.toHaveBeenCalled();
  });
});

describe('direct ledger reads', () => {
  beforeEach(() => {
    server.getLedgerEntries.mockReset();
  });

  const contract = new Contract(CONTRACT).address().toScAddress();
  const durability = xdr.ContractDataDurability.persistent();
  const ledgerKey = (key: xdr.ScVal) =>
    xdr.LedgerKey.contractData(new xdr.LedgerKeyContractData({ contract, key, durability }));
  const entry = (key: xdr.ScVal, val: xdr.ScVal) => ({
    key: ledgerKey(key),
    val: xdr.LedgerEntryData.contractData(
      new xdr.ContractDataEntry({ ext: new xdr.ExtensionPoint(0), contract, key, durability, val }),
    ),
  });

  it('encodes a contracttype enum key as vec[Symbol(variant), ...fields]', () => {
    expect(scValToNative(enumKey('Admin'))).toEqual(['Admin']);
    expect(scValToNative(enumKey('Quest', u32(2)))).toEqual(['Quest', 2]);
  });

  it('returns one value per key, in key order, null where the entry is absent', async () => {
    const [q1, q2, q3] = [1, 2, 3].map((id) => enumKey('Quest', u32(id)));
    // RPC returns entries in any order and omits missing ones.
    server.getLedgerEntries.mockResolvedValue({
      entries: [entry(q3, u32(30)), entry(q1, u32(10))],
      latestLedger: 1,
    });
    const values = await readLedgerData(CONTRACT, [q1, q2, q3]);
    expect(values.map((v) => (v ? scValToNative(v) : null))).toEqual([10, null, 30]);
    const asked = server.getLedgerEntries.mock.calls[0].map((k: xdr.LedgerKey) => k.toXDR('base64'));
    expect(asked).toEqual([q1, q2, q3].map((k) => ledgerKey(k).toXDR('base64')));
  });

  it('propagates an RPC failure instead of reading it as "not found"', async () => {
    server.getLedgerEntries.mockRejectedValue(new Error('503'));
    await expect(readLedgerData(CONTRACT, [enumKey('Admin')])).rejects.toThrow('503');
  });

  it('reads one key out of the contract instance storage', async () => {
    const instanceKey = xdr.ScVal.scvLedgerKeyContractInstance();
    const admin = nativeToScVal(SOURCE, { type: 'address' });
    const instance = xdr.ScVal.scvContractInstance(
      new xdr.ScContractInstance({
        executable: xdr.ContractExecutable.contractExecutableStellarAsset(),
        storage: [
          new xdr.ScMapEntry({ key: enumKey('Paused'), val: xdr.ScVal.scvBool(false) }),
          new xdr.ScMapEntry({ key: enumKey('Admin'), val: admin }),
        ],
      }),
    );
    expect(scValToNative(instanceStorageValue(instance, enumKey('Admin'))!)).toBe(SOURCE);
    expect(instanceStorageValue(instance, enumKey('Usdc'))).toBeNull();

    server.getLedgerEntries.mockResolvedValue({ entries: [entry(instanceKey, instance)] });
    const v = await readInstanceValue(CONTRACT, enumKey('Admin'));
    expect(v && scValToNative(v)).toBe(SOURCE);

    server.getLedgerEntries.mockResolvedValue({ entries: [] });
    await expect(readInstanceValue(CONTRACT, enumKey('Admin'))).resolves.toBeNull();
  });
});
