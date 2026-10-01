// @vitest-environment node
// XDR opaque fields (the fee-bump inner hash) need Node's own Buffer/Uint8Array.
import { xdr } from '@stellar/stellar-sdk';
import { describe, expect, it } from 'vitest';
import {
  TxNotQueuedError,
  TxRejectedError,
  txRejectionCode,
  txRejectionMessage,
} from './tx-errors';
import { humanizeError } from './utils';

const fee = xdr.Int64.fromString('100');

/** A result as RPC hands it back: XDR on the wire, parsed by the SDK. */
function rejected(result: xdr.TransactionResultResult): xdr.TransactionResult {
  const r = new xdr.TransactionResult({ feeCharged: fee, result, ext: new xdr.TransactionResultExt(0) });
  return xdr.TransactionResult.fromXDR(r.toXDR('base64'), 'base64');
}

const payment = (r: xdr.PaymentResult) => xdr.OperationResult.opInner(xdr.OperationResultTr.payment(r));

describe('txRejectionCode', () => {
  it.each([
    ['txBadSeq', xdr.TransactionResultResult.txBadSeq()],
    ['txTooLate', xdr.TransactionResultResult.txTooLate()],
    ['txInsufficientBalance', xdr.TransactionResultResult.txInsufficientBalance()],
    ['txBadAuth', xdr.TransactionResultResult.txBadAuth()],
  ])('reads %s off the transaction result', (code, result) => {
    expect(txRejectionCode(rejected(result))).toBe(code);
  });

  it('txFailed: names the first operation that did not succeed', () => {
    const result = xdr.TransactionResultResult.txFailed([
      payment(xdr.PaymentResult.paymentSuccess()),
      payment(xdr.PaymentResult.paymentUnderfunded()),
      xdr.OperationResult.opBadAuth(),
    ]);
    expect(txRejectionCode(rejected(result))).toBe('paymentUnderfunded');
  });

  it('txFailed: an operation that never ran reports its op-level code', () => {
    const result = xdr.TransactionResultResult.txFailed([xdr.OperationResult.opNoAccount()]);
    expect(txRejectionCode(rejected(result))).toBe('opNoAccount');
  });

  it('a fee bump reports its inner transaction code', () => {
    const inner = new xdr.InnerTransactionResult({
      feeCharged: fee,
      result: xdr.InnerTransactionResultResult.txTooLate(),
      ext: new xdr.InnerTransactionResultExt(0),
    });
    const pair = new xdr.InnerTransactionResultPair({ transactionHash: Buffer.alloc(32), result: inner });
    expect(txRejectionCode(rejected(xdr.TransactionResultResult.txFeeBumpInnerFailed(pair)))).toBe(
      'txTooLate',
    );
  });

  it('is "unknown" without a readable result', () => {
    expect(txRejectionCode(undefined)).toBe('unknown');
    expect(txRejectionCode({} as xdr.TransactionResult)).toBe('unknown');
  });
});

describe('TxRejectedError', () => {
  it.each([
    ['txBadSeq', 'Another transaction went out at the same moment — try again.'],
    ['txTooLate', 'This took too long — try again.'],
    ['txBadAuth', 'Your wallet is on a different network — switch networks and try again.'],
    ['txInsufficientBalance', 'You need a little more XLM to cover the network fee.'],
    ['paymentUnderfunded', 'Your balance is too low for this payment.'],
  ])('%s reads as a next step, and humanizeError keeps it whole', (code, message) => {
    const e = new TxRejectedError(code);
    expect(e).toMatchObject({ name: 'TxRejectedError', code, message });
    expect(humanizeError(e)).toBe(message);
  });

  it('an unmapped code still names the code, so support can tell rejections apart', () => {
    expect(txRejectionMessage('txMalformed')).toBe(
      'The network rejected this transaction (txMalformed). Try again in a moment.',
    );
  });

  it('never carries the stringified XDR', () => {
    // What every submit path used to throw: the serialization noise from #189.
    const r = rejected(xdr.TransactionResultResult.txBadSeq());
    expect(JSON.stringify(r)).toMatch(/_maxDepth|_attributes/);
    const e = new TxRejectedError(txRejectionCode(r));
    expect(e.message).not.toMatch(/_maxDepth|_attributes|\{/);
    expect(humanizeError(e)).not.toMatch(/_maxDepth|_attributes/);
  });

  it.each([undefined, 'tip', 'reward'] as const)(
    'humanizeError hands a rejection back whole (flow %s), however long its code',
    (flow) => {
      // Past 120 characters humanizeError's generic path would truncate the message.
      const e = new TxRejectedError(`invokeHostFunction${'Resource'.repeat(8)}LimitExceeded`);
      expect(e.message.length).toBeGreaterThan(120);
      expect(humanizeError(e, {}, flow)).toBe(e.message);
      expect(humanizeError(new TxRejectedError('txBadSeq'), {}, flow)).toBe(
        'Another transaction went out at the same moment — try again.',
      );
    },
  );

  it('humanizeError keeps the not-queued message whole too', () => {
    const e = new TxNotQueuedError('H', 4);
    expect(humanizeError(e)).toBe(e.message);
  });
});
