/**
 * Contract invocation core. build -> simulate/prepare -> sign (injected) -> submit
 * -> poll for result. Signing is injected via the Wallet abstraction so the same
 * helpers serve passkey (sponsored) and dev wallets.
 *
 * Production note: after a stable deploy, `stellar contract bindings typescript`
 * can generate fully-typed clients; these typed wrappers (args + scValToNative) are
 * the lean equivalent for the handful of methods the MVP calls.
 */
import {
  Address,
  Contract,
  TransactionBuilder,
  nativeToScVal,
  scValToNative,
  rpc,
  xdr,
} from '@stellar/stellar-sdk';
import { server, networkPassphrase, config } from './stellar';
import type { Wallet } from './wallet';

const BASE_FEE = '1000000'; // 0.1 XLM ceiling; simulation sets the real fee.

export const repId = () => config.contracts.reputation;
export const rewardsId = () => config.contracts.rewards;
export const questId = () => config.contracts.questRegistry;

/** ScVal builders for the contract ABIs. */
export const args = {
  addr: (g: string) => new Address(g).toScVal(),
  u32: (n: number) => nativeToScVal(n, { type: 'u32' }),
  u64: (n: number | bigint) => nativeToScVal(n, { type: 'u64' }),
  i128: (n: bigint) => nativeToScVal(n, { type: 'i128' }),
  str: (s: string) => nativeToScVal(s, { type: 'string' }),
};

/** Read-only call via simulation (no signature, no fee). */
export async function readContract<T>(
  contractId: string,
  method: string,
  callArgs: xdr.ScVal[],
  sourceAccount: string,
): Promise<T> {
  requireDeployed(contractId, method);
  const account = await server.getAccount(sourceAccount);
  const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase })
    .addOperation(new Contract(contractId).call(method, ...callArgs))
    .setTimeout(30)
    .build();

  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) {
    throw new Error(`simulate ${method} failed: ${sim.error}`);
  }
  const retval = sim.result?.retval;
  return retval ? (scValToNative(retval) as T) : (undefined as T);
}

/**
 * State-changing call: prepare (simulate+assemble), sign via the wallet, submit,
 * then poll until the tx lands. Returns the decoded return value (or undefined).
 */
export async function invokeAndWait<T = unknown>(
  contractId: string,
  method: string,
  callArgs: xdr.ScVal[],
  wallet: Wallet,
): Promise<T> {
  requireDeployed(contractId, method);
  const account = await server.getAccount(wallet.address);
  const built = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase })
    .addOperation(new Contract(contractId).call(method, ...callArgs))
    .setTimeout(60)
    .build();

  const prepared = await server.prepareTransaction(built);
  const signedXdr = await wallet.sign(prepared.toXDR());
  const signed = TransactionBuilder.fromXDR(signedXdr, networkPassphrase);

  const sent = await server.sendTransaction(signed);
  if (sent.status === 'ERROR') {
    throw new Error(`send ${method} failed: ${JSON.stringify(sent.errorResult)}`);
  }

  const result = await pollTransaction(sent.hash);
  const retval = result.returnValue;
  return (retval ? scValToNative(retval) : undefined) as T;
}

/** Poll getTransaction until it leaves NOT_FOUND; throw on FAILED. */
async function pollTransaction(hash: string, tries = 30): Promise<rpc.Api.GetSuccessfulTransactionResponse> {
  for (let i = 0; i < tries; i++) {
    const res = await server.getTransaction(hash);
    if (res.status === 'SUCCESS') return res;
    if (res.status === 'FAILED') {
      throw new Error(`tx ${hash} failed: ${JSON.stringify(res.resultXdr)}`);
    }
    await sleep(1000);
  }
  throw new Error(`tx ${hash} not confirmed in time`);
}

function requireDeployed(contractId: string, method: string): void {
  if (!contractId) {
    throw new Error(
      `Contract not deployed for "${method}". Run scripts/deploy-testnet.sh and set NEXT_PUBLIC_*_CONTRACT_ID.`,
    );
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
