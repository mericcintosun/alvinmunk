import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const getAccountMock = vi.fn();
const sendTransactionMock = vi.fn();
const getTransactionMock = vi.fn();

vi.mock('./stellar', () => ({
  server: {
    getAccount: (...a: unknown[]) => getAccountMock(...a),
    sendTransaction: (...a: unknown[]) => sendTransactionMock(...a),
    getTransaction: (...a: unknown[]) => getTransactionMock(...a),
  },
  networkPassphrase: 'Test SDF Network ; September 2015',
}));

vi.mock('@stellar/stellar-sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@stellar/stellar-sdk')>();
  return {
    ...actual,
    TransactionBuilder: class {
      constructor(_account: unknown, _opts: unknown) {}
      addOperation() {
        return this;
      }
      setTimeout() {
        return this;
      }
      build() {
        return { toXDR: () => 'unsigned-xdr' };
      }
      static fromXDR(xdr: string) {
        return { xdr };
      }
    },
  };
});

import { sendXlm } from './payments';
import type { Wallet } from './wallet';

function makeWallet(): Wallet {
  return {
    address: 'GALICE',
    sign: vi.fn(async (xdr: string) => `signed-${xdr}`),
  } as unknown as Wallet;
}

describe('sendXlm status mapping', () => {
  beforeEach(() => {
    getAccountMock.mockReset().mockResolvedValue({ accountId: () => 'GALICE', sequenceNumber: () => '1' });
    sendTransactionMock.mockReset();
    getTransactionMock.mockReset();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns SUCCESS once getTransaction reports SUCCESS', async () => {
    sendTransactionMock.mockResolvedValue({ status: 'PENDING', hash: 'HASH1' });
    getTransactionMock
      .mockResolvedValueOnce({ status: 'NOT_FOUND' })
      .mockResolvedValueOnce({ status: 'SUCCESS' });

    const promise = sendXlm(makeWallet(), 'GB72PZXNOU6DJ2BXZDITS24A5JCN3CEUNTKIX5ESZDXAY2R5HO7YZ3H3', '10');
    await vi.runAllTimersAsync();
    await expect(promise).resolves.toEqual({ hash: 'HASH1', status: 'SUCCESS' });
  });

  it('returns FAILED when getTransaction reports FAILED', async () => {
    sendTransactionMock.mockResolvedValue({ status: 'PENDING', hash: 'HASH2' });
    getTransactionMock.mockResolvedValueOnce({ status: 'FAILED' });

    const promise = sendXlm(makeWallet(), 'GB72PZXNOU6DJ2BXZDITS24A5JCN3CEUNTKIX5ESZDXAY2R5HO7YZ3H3', '10');
    await vi.runAllTimersAsync();
    await expect(promise).resolves.toEqual({ hash: 'HASH2', status: 'FAILED' });
  });

  it('throws when sendTransaction itself errors', async () => {
    sendTransactionMock.mockResolvedValue({ status: 'ERROR', errorResult: { foo: 'bar' } });
    await expect(sendXlm(makeWallet(), 'GB72PZXNOU6DJ2BXZDITS24A5JCN3CEUNTKIX5ESZDXAY2R5HO7YZ3H3', '10')).rejects.toThrow('payment rejected');
  });

  it('falls back to PENDING when confirmation never resolves within the poll budget', async () => {
    sendTransactionMock.mockResolvedValue({ status: 'PENDING', hash: 'HASH3' });
    getTransactionMock.mockResolvedValue({ status: 'NOT_FOUND' });

    const promise = sendXlm(makeWallet(), 'GB72PZXNOU6DJ2BXZDITS24A5JCN3CEUNTKIX5ESZDXAY2R5HO7YZ3H3', '10');
    await vi.runAllTimersAsync();
    await expect(promise).resolves.toEqual({ hash: 'HASH3', status: 'PENDING' });
    expect(getTransactionMock).toHaveBeenCalledTimes(15);
  });
});