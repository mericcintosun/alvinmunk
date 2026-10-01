/**
 * The one place a signed transaction goes to RPC `sendTransaction`. Every classic submit
 * path (contract calls, genesis, XLM payments, the USDC trustline, the anchor payment and
 * the faucet mint) goes through `submitSigned`, so they all read the four send statuses
 * the same way:
 *
 * - `PENDING` — Core queued it: poll the hash.
 * - `DUPLICATE` — this exact envelope is already queued: accepted, poll the hash.
 * - `TRY_AGAIN_LATER` — Core did NOT queue it (surge pricing, a full queue, or another tx
 *   from the same account already pending), so its hash will never land. Back off and
 *   resubmit the same signed envelope (same hash, so it can never apply twice); after
 *   `SEND_ATTEMPTS` sends, throw `TxNotQueuedError` instead of polling a hash that was
 *   never queued.
 * - `ERROR` — rejected: throw `TxRejectedError`, whose message says why in plain words.
 */
import type { FeeBumpTransaction, Transaction, rpc } from '@stellar/stellar-sdk';
import { server } from './stellar';
import { TxNotQueuedError, TxRejectedError, txRejectionCode } from './tx-errors';

// The error classes live in the dependency-free lib/tx-errors (humanizeError reads them).
export { TxNotQueuedError, TxRejectedError } from './tx-errors';

/** Sends of one envelope before giving up on `TRY_AGAIN_LATER` (backoff 1s, 2s, 4s between). */
export const SEND_ATTEMPTS = 4;
const BACKOFF_MS = 1000;

/**
 * Send a signed envelope until Core queues it, and resolve its hash for the caller to poll.
 * `what` names the transaction on a rejection (`TxRejectedError.what`, for logs; the message
 * stays one plain sentence). `rpcServer` defaults to the app's RPC server (the faucet route
 * passes its own).
 */
export async function submitSigned(
  tx: Transaction | FeeBumpTransaction,
  what: string,
  rpcServer: Pick<rpc.Server, 'sendTransaction'> = server,
): Promise<string> {
  for (let attempt = 1; ; attempt++) {
    const sent = await rpcServer.sendTransaction(tx);
    if (sent.status === 'PENDING' || sent.status === 'DUPLICATE') return sent.hash;
    if (sent.status !== 'TRY_AGAIN_LATER') {
      // ERROR (or a status this SDK doesn't know): never poll it.
      throw new TxRejectedError(txRejectionCode(sent.errorResult), what);
    }
    if (attempt >= SEND_ATTEMPTS) throw new TxNotQueuedError(sent.hash, attempt);
    await new Promise((r) => setTimeout(r, BACKOFF_MS * 2 ** (attempt - 1)));
  }
}
