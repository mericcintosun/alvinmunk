/**
 * Classic XLM payment (White-belt Level-1 rubric: "send an XLM transaction on
 * testnet" with success/failure + tx hash feedback). Works with any Wallet provider
 * (Freighter for the Level-1 demo, or passkey/dev).
 */
import { Asset, Operation, TransactionBuilder } from '@stellar/stellar-sdk';
import { server, networkPassphrase } from './stellar';
import { submitSigned } from './submit';
import type { Wallet } from './wallet';

export interface PaymentResult {
  hash: string;
  status: 'SUCCESS' | 'FAILED' | 'PENDING';
}

/** Send `amount` XLM from the wallet to `to`. Returns hash + final-ish status. */
export async function sendXlm(wallet: Wallet, to: string, amount: string): Promise<PaymentResult> {
  const account = await server.getAccount(wallet.address);
  const tx = new TransactionBuilder(account, { fee: '1000', networkPassphrase })
    .addOperation(Operation.payment({ destination: to, asset: Asset.native(), amount }))
    .setTimeout(60)
    .build();

  const signedXdr = await wallet.sign(tx.toXDR());
  const signed = TransactionBuilder.fromXDR(signedXdr, networkPassphrase);
  const hash = await submitSigned(signed, 'payment');

  // Poll briefly so the UI can show a confirmed success/failure.
  // The payment is already submitted, so a failed status read must never reject: keep polling
  // through transient RPC/decode errors and report PENDING when the budget runs out (#193).
  for (let i = 0; i < 15; i++) {
    const status = await server.getTransaction(hash).then((r) => r.status, () => null);
    if (status === 'SUCCESS') return { hash, status: 'SUCCESS' };
    if (status === 'FAILED') return { hash, status: 'FAILED' };
    await new Promise((r) => setTimeout(r, 1000));
  }
  return { hash, status: 'PENDING' };
}
