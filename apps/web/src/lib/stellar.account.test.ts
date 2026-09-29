// @vitest-environment node
import { describe, it, expect, vi, afterEach } from 'vitest';
import { Keypair, StrKey, xdr } from '@stellar/stellar-sdk';
import { accountExists, server } from './stellar';

const ADDRESS = Keypair.random().publicKey();

afterEach(() => {
  vi.restoreAllMocks();
});

describe('accountExists', () => {
  it('is true when the RPC returns the account entry', async () => {
    const spy = vi
      .spyOn(server, 'getLedgerEntries')
      .mockResolvedValue({ entries: [{}], latestLedger: 1 } as never);

    await expect(accountExists(ADDRESS)).resolves.toBe(true);
    const [key] = spy.mock.calls[0] as [xdr.LedgerKey];
    expect(key.switch()).toBe(xdr.LedgerEntryType.account());
    expect(StrKey.encodeEd25519PublicKey(key.account().accountId().ed25519())).toBe(ADDRESS);
  });

  it('is false when the RPC answers that there is no such account', async () => {
    vi.spyOn(server, 'getLedgerEntries').mockResolvedValue({
      entries: [],
      latestLedger: 1,
    } as never);

    await expect(accountExists(ADDRESS)).resolves.toBe(false);
  });

  it('throws when the RPC fails instead of reporting the account missing', async () => {
    vi.spyOn(server, 'getLedgerEntries').mockRejectedValue(new Error('503 Service Unavailable'));

    await expect(accountExists(ADDRESS)).rejects.toThrow('503 Service Unavailable');
  });
});
