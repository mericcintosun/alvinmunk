/** Standalone example for reading a reputation profile from Soroban testnet. */
export const REPUTATION_READ_SNIPPET = `import {
  Account,
  Address,
  Contract,
  Keypair,
  Networks,
  TransactionBuilder,
  rpc,
  scValToNative,
} from '@stellar/stellar-sdk';

const server = new rpc.Server('https://soroban-testnet.stellar.org');
const contractId = 'CBNIZXITUVTRVW6RZGEGCI7KNF46REG4EDM4XUVHKDAV63WOHWW75SZM';
const address = 'GB72PZXNOU6DJ2BXZDITS24A5JCN3CEUNTKIX5ESZDXAY2R5HO7YZ3H3';
const source = new Account(Keypair.random().publicKey(), '0');

const tx = new TransactionBuilder(source, {
  fee: '1000000',
  networkPassphrase: Networks.TESTNET,
})
  .addOperation(new Contract(contractId).call('get_profile', new Address(address).toScVal()))
  .setTimeout(30)
  .build();

const result = await server.simulateTransaction(tx);
if (rpc.Api.isSimulationError(result)) throw new Error(result.error);
const profile = result.result?.retval ? scValToNative(result.result.retval) : undefined;
console.log(profile); // { social, earned, verified }`;
