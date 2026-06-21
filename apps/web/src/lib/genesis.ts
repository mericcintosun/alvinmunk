/**
 * The "Genesis" first on-chain action (Sprint 1 / White belt deliverable #3).
 * A single manageData op binds the chosen handle on-chain — the user's first
 * signed transaction. Cheap, classic, and demoable: FaceID -> on-chain in seconds.
 */
import { Operation, TransactionBuilder } from '@stellar/stellar-sdk';
import { server, networkPassphrase } from './stellar';
import type { Wallet } from './wallet';

const FEE = '1000'; // stroops; sponsored in the passkey flow.

/** Sign + submit the Genesis tx. Returns the tx hash. */
export async function recordGenesis(wallet: Wallet, handle: string): Promise<string> {
  const account = await server.getAccount(wallet.address);
  const tx = new TransactionBuilder(account, { fee: FEE, networkPassphrase })
    .addOperation(
      Operation.manageData({
        name: 'passport:genesis',
        value: handle.slice(0, 28), // manageData value <= 64 bytes; handle is short
      }),
    )
    .setTimeout(60)
    .build();

  const signedXdr = await wallet.sign(tx.toXDR());
  const signed = TransactionBuilder.fromXDR(signedXdr, networkPassphrase);
  const sent = await server.sendTransaction(signed);

  if (sent.status === 'ERROR') {
    throw new Error(`genesis tx failed: ${JSON.stringify(sent.errorResult ?? sent)}`);
  }
  return sent.hash;
}
