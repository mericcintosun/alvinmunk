import { Account, Contract, Networks, nativeToScVal, scValToNative, xdr } from '@stellar/stellar-sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { server } = vi.hoisted(() => ({
  server: {
    getAccount: vi.fn(),
    prepareTransaction: vi.fn(),
    sendTransaction: vi.fn(),
    getTransaction: vi.fn(),
    getLedgerEntries: vi.fn(),
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
    const wallet: Wallet = { kind: 'freighter', address: SOURCE, sign, signMessage: vi.fn() };

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
      signMessage: vi.fn(),
      invoke,
    };
    await expect(invokeAndWait(CONTRACT, 'mint_vouch', [], wallet)).resolves.toBe(42);
    await expect(invokeAndWaitHash(CONTRACT, 'mint_vouch', [], wallet)).resolves.toBe('pk-hash');
    expect(invoke).toHaveBeenCalledWith(CONTRACT, 'mint_vouch', []);
    expect(server.getAccount).not.toHaveBeenCalled();
  });

  it('refuses an undeployed contract before touching the wallet', async () => {
    const wallet: Wallet = { kind: 'dev', address: SOURCE, sign: vi.fn(), signMessage: vi.fn() };
    await expect(invokeAndWaitHash('', 'add_reward', [], wallet)).rejects.toThrow(
      'Contract not deployed',
    );
    expect(wallet.sign).not.toHaveBeenCalled();
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
