import { xdr } from '@stellar/stellar-sdk';
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
import { TxRejectedError } from './tx-errors';
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

  it('throws the decoded rejection when sendTransaction itself errors, and never polls', async () => {
    sendTransactionMock.mockResolvedValue({
      status: 'ERROR',
      hash: 'HASH6',
      errorResult: new xdr.TransactionResult({
        feeCharged: xdr.Int64.fromString('100'),
        result: xdr.TransactionResultResult.txFailed([
          xdr.OperationResult.opInner(
            xdr.OperationResultTr.payment(xdr.PaymentResult.paymentUnderfunded()),
          ),
        ]),
        ext: new xdr.TransactionResultExt(0),
      }),
    });
    await expect(
      sendXlm(makeWallet(), 'GB72PZXNOU6DJ2BXZDITS24A5JCN3CEUNTKIX5ESZDXAY2R5HO7YZ3H3', '10'),
    ).rejects.toMatchObject({
      name: 'TxRejectedError',
      code: 'paymentUnderfunded',
      message: 'Your balance is too low for this payment.',
    } satisfies Partial<TxRejectedError>);
    expect(getTransactionMock).not.toHaveBeenCalled();
  });

  it('resubmits the same envelope on TRY_AGAIN_LATER, then polls once it is PENDING', async () => {
    sendTransactionMock
      .mockResolvedValueOnce({ status: 'TRY_AGAIN_LATER', hash: 'HASH4' })
      .mockResolvedValueOnce({ status: 'PENDING', hash: 'HASH4' });
    getTransactionMock.mockResolvedValueOnce({ status: 'SUCCESS' });

    const promise = sendXlm(makeWallet(), 'GB72PZXNOU6DJ2BXZDITS24A5JCN3CEUNTKIX5ESZDXAY2R5HO7YZ3H3', '10');
    await vi.runAllTimersAsync();
    await expect(promise).resolves.toEqual({ hash: 'HASH4', status: 'SUCCESS' });
    expect(sendTransactionMock).toHaveBeenCalledTimes(2);
    expect(sendTransactionMock.mock.calls[1][0]).toBe(sendTransactionMock.mock.calls[0][0]);
  });

  it('gives up with a clear retryable error when TRY_AGAIN_LATER persists, and never polls', async () => {
    sendTransactionMock.mockResolvedValue({ status: 'TRY_AGAIN_LATER', hash: 'HASH5' });

    const promise = sendXlm(makeWallet(), 'GB72PZXNOU6DJ2BXZDITS24A5JCN3CEUNTKIX5ESZDXAY2R5HO7YZ3H3', '10');
    const assertion = expect(promise).rejects.toThrow(/network is busy.*try again/);
    await vi.runAllTimersAsync();
    await assertion;
    expect(getTransactionMock).not.toHaveBeenCalled();
  });

  it('falls back to PENDING when confirmation never resolves within the poll budget', async () => {
    sendTransactionMock.mockResolvedValue({ status: 'PENDING', hash: 'HASH3' });
    getTransactionMock.mockResolvedValue({ status: 'NOT_FOUND' });

    const promise = sendXlm(makeWallet(), 'GB72PZXNOU6DJ2BXZDITS24A5JCN3CEUNTKIX5ESZDXAY2R5HO7YZ3H3', '10');
    await vi.runAllTimersAsync();
    await expect(promise).resolves.toEqual({ hash: 'HASH3', status: 'PENDING' });
    expect(getTransactionMock).toHaveBeenCalledTimes(15);
  });

  it('keeps polling on transient getTransaction error, then resolves SUCCESS', async () => {
    sendTransactionMock.mockResolvedValue({ status: 'PENDING', hash: 'HASH6' });
    getTransactionMock
      .mockRejectedValueOnce(new Error('RPC 429'))
      .mockResolvedValueOnce({ status: 'SUCCESS' });

    const promise = sendXlm(makeWallet(), 'GB72PZXNOU6DJ2BXZDITS24A5JCN3CEUNTKIX5ESZDXAY2R5HO7YZ3H3', '10');
    await vi.runAllTimersAsync();
    await expect(promise).resolves.toEqual({ hash: 'HASH6', status: 'SUCCESS' });
    expect(getTransactionMock).toHaveBeenCalledTimes(2);
  });
});
