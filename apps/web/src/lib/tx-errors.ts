/**
 * Why a transaction didn't go out, as one sentence a user can act on. `submitSigned`
 * (lib/submit.ts) throws these; `humanizeError` passes their message through untouched.
 *
 * A rejected send carries an `xdr.TransactionResult`. JSON-stringifying it gives
 * `{"_maxDepth":200,"_attributes":{…` and the result code is cut off before it shows
 * (#189), so the code is decoded instead: `txBadSeq`, `txTooLate`, … or, for `txFailed`,
 * the first failing operation's own code (`paymentUnderfunded`, …).
 */
import type { xdr } from '@stellar/stellar-sdk';

/** The codes a user can do something about. Anything else gets the generic message. */
const MESSAGES: Record<string, string> = {
  txBadSeq: 'Another transaction went out at the same moment — try again.',
  txTooLate: 'This took too long — try again.',
  txBadAuth: 'Your wallet is on a different network — switch networks and try again.',
  // Same copy humanizeError gives a raw txInsufficientBalance (#396).
  txInsufficientBalance: 'You need a little more XLM to cover the network fee.',
  txNoAccount: 'This account isn’t funded yet — add some XLM first.',
  txInsufficientFee: 'The network is busy and the fee was too low — try again in a moment.',
  paymentUnderfunded: 'Your balance is too low for this payment.',
  paymentNoDestination: 'That account doesn’t exist yet, so it can’t receive a payment.',
  paymentNoTrust: 'The recipient hasn’t enabled this asset yet, so they can’t receive it.',
  changeTrustLowReserve: 'You need a little more XLM to hold USDC — add some and try again.',
};

/** The message for a rejection code; unknown codes still name the code for support. */
export function txRejectionMessage(code: string): string {
  return (
    MESSAGES[code] ??
    (code === 'unknown'
      ? 'The network rejected this transaction. Try again in a moment.'
      : `The network rejected this transaction (${code}). Try again in a moment.`)
  );
}

/**
 * The most specific code in a rejected result: the transaction's own code, a fee bump's
 * inner code, or for `txFailed` the first operation that didn't succeed. `unknown` when
 * there is no result or it can't be read.
 */
export function txRejectionCode(result: xdr.TransactionResult | undefined): string {
  try {
    const outer = result?.result();
    if (!outer) return 'unknown';
    const res =
      outer.switch().name === 'txFeeBumpInnerFailed' ? outer.innerResultPair().result().result() : outer;
    const code = res.switch().name;
    if (code !== 'txFailed') return code;
    for (const op of res.results()) {
      const opCode = operationCode(op);
      if (!opCode.endsWith('Success')) return opCode;
    }
    return code;
  } catch {
    return 'unknown';
  }
}

/** `opBadAuth` & co. for an operation that never ran; its own result code once it did. */
function operationCode(op: xdr.OperationResult): string {
  if (op.switch().name !== 'opInner') return op.switch().name;
  return (op.tr().value() as { switch(): { name: string } }).switch().name;
}

/** RPC rejected the transaction (`sendTransaction` status `ERROR`). `what` names it, for logs. */
export class TxRejectedError extends Error {
  constructor(
    readonly code: string,
    readonly what?: string,
  ) {
    super(txRejectionMessage(code));
    this.name = 'TxRejectedError';
  }
}

/** Core kept answering `TRY_AGAIN_LATER`: the tx never entered the queue, so retrying is safe. */
export class TxNotQueuedError extends Error {
  readonly retryable = true;

  constructor(
    readonly hash: string,
    readonly attempts: number,
  ) {
    super('The network is busy and did not accept the transaction. Nothing was sent — try again in a moment.');
    this.name = 'TxNotQueuedError';
  }
}
