// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  Account,
  Address,
  Operation,
  SorobanDataBuilder,
  Transaction,
  TransactionBuilder,
  xdr,
} from '@stellar/stellar-sdk';
import { PASSPHRASE } from '@alvinmunk/shared';
import { deployerKeypair, refeeDeploy } from './refee-deploy';

function buildDeployEnvelope(fee: number, passphrase: string = PASSPHRASE.testnet): string {
  const source = deployerKeypair();
  const tx = new TransactionBuilder(new Account(source.publicKey(), '1'), {
    fee: String(fee),
    networkPassphrase: passphrase,
  })
    .addOperation(
      Operation.createCustomContract({
        address: new Address(source.publicKey()),
        wasmHash: Buffer.alloc(32),
        salt: Buffer.alloc(32),
      }),
    )
    .setSorobanData(new SorobanDataBuilder().setResourceFee(fee - 150).build())
    .setTimeout(0)
    .build();
  tx.sign(source);
  return tx.toXDR();
}

describe('refeeDeploy', () => {
  it('lowers tx fee to equal resourceFee', () => {
    const inputXdr = buildDeployEnvelope(1000);
    const outputXdr = refeeDeploy(inputXdr, PASSPHRASE.testnet);

    const env = xdr.TransactionEnvelope.fromXDR(outputXdr, 'base64');
    const tx = env.v1()?.tx();
    const resourceFee = Number(tx?.ext().sorobanData()?.resourceFee().toString());
    const fee = Number(tx?.fee().toString());

    expect(fee).toBe(resourceFee);
    expect(fee).toBe(850);
  });

  it('re-signs with deployer keypair and verifies under the configured passphrase', () => {
    const passphrase = PASSPHRASE.testnet;
    const inputXdr = buildDeployEnvelope(1200, passphrase);
    const outputXdr = refeeDeploy(inputXdr, passphrase);

    const tx = new Transaction(outputXdr, passphrase);
    const deployer = deployerKeypair();

    expect(tx.signatures.length).toBe(1);
    const sig = tx.signatures[0];
    const verified = deployer.verify(tx.hash(), sig.signature());
    expect(verified).toBe(true);
  });

  it('verifies under mainnet passphrase when configured for mainnet', () => {
    const passphrase = PASSPHRASE.mainnet;
    const inputXdr = buildDeployEnvelope(1500, passphrase);
    const outputXdr = refeeDeploy(inputXdr, passphrase);

    const tx = new Transaction(outputXdr, passphrase);
    const deployer = deployerKeypair();

    expect(tx.signatures.length).toBe(1);
    expect(deployer.verify(tx.hash(), tx.signatures[0].signature())).toBe(true);
  });
});
