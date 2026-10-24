import { Keypair, Transaction, hash as sha256, xdr } from '@stellar/stellar-sdk';
import { networkPassphrase } from '@alvinmunk/shared';

/**
 * passkey-kit deploys every smart wallet from a single shared deployer account whose seed is
 * the literal `hash("kalepail")` (see passkey-kit `kit.ts`) — public, not a secret. We rebuild
 * that keypair to re-sign the deploy tx after lowering its fee.
 */
export function deployerKeypair(): Keypair {
  return Keypair.fromRawEd25519Seed(sha256(Buffer.from('kalepail')));
}

/**
 * Lower a deployer-signed Soroban deploy tx's fee to exactly its resource fee (the Channels
 * fund account supplies the inclusion fee via the fee bump) and re-sign with the deployer key.
 */
export function refeeDeploy(
  xdrStr: string,
  passphrase: string = networkPassphrase(),
): string {
  const env = xdr.TransactionEnvelope.fromXDR(xdrStr, 'base64');
  const v1 = env.v1();
  const tx = v1.tx();
  const resourceFee = tx.ext().sorobanData().resourceFee(); // xdr Int64
  tx.fee(Number(resourceFee.toString())); // fee == resource fee (Soroban fee-bump rule)
  v1.signatures([]); // drop the now-stale deployer signature over the old fee
  const rebuilt = new Transaction(env.toXDR('base64'), passphrase);
  rebuilt.sign(deployerKeypair());
  return rebuilt.toXDR();
}
