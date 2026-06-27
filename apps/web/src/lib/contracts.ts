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
  Account,
  Address,
  Contract,
  Keypair,
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
export const registryId = () => config.contracts.registry;
export const gateId = () => config.contracts.gate;

/** ScVal builders for the contract ABIs. */
export const args = {
  addr: (g: string) => new Address(g).toScVal(),
  u32: (n: number) => nativeToScVal(n, { type: 'u32' }),
  u64: (n: number | bigint) => nativeToScVal(n, { type: 'u64' }),
  i128: (n: bigint) => nativeToScVal(n, { type: 'i128' }),
  str: (s: string) => nativeToScVal(s, { type: 'string' }),
  sym: (s: string) => nativeToScVal(s, { type: 'symbol' }),
  // Bytes / BytesN<32> (claim hash, secret) — the host checks fixed length where needed.
  bytes: (u8: Uint8Array) => nativeToScVal(u8, { type: 'bytes' }),
};

/** Read-only call via simulation (no signature, no fee). */
export async function readContract<T>(
  contractId: string,
  method: string,
  callArgs: xdr.ScVal[],
  sourceAccount: string,
): Promise<T> {
  requireDeployed(contractId, method);
  // Read-only simulation needs only a well-formed source envelope, not a real on-chain
  // account. A passkey wallet's address is a CONTRACT (C…), which isn't a classic account
  // (`getAccount(C…)` 404s), so synthesize a throwaway source for it; any G… source is used
  // directly to keep behavior unchanged.
  const account = sourceAccount.startsWith('C')
    ? new Account(Keypair.random().publicKey(), '0')
    : await server.getAccount(sourceAccount);
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
 * Read-only simulation with NO wallet — for logged-out pages (e.g. the claim funnel).
 * A read getter has no auth and no fee, so the source account need not exist on-chain;
 * we use a throwaway key purely to form a valid envelope for `simulateTransaction`.
 */
export async function readPublic<T>(
  contractId: string,
  method: string,
  callArgs: xdr.ScVal[],
): Promise<T> {
  requireDeployed(contractId, method);
  const source = new Account(Keypair.random().publicKey(), '0');
  const tx = new TransactionBuilder(source, { fee: BASE_FEE, networkPassphrase })
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

  // Passkey (smart-account) wallets can't be a classic tx source: the call is
  // authorized by the passkey and submitted via the relayer inside wallet.invoke.
  if (wallet.invoke) {
    return (await wallet.invoke(contractId, method, callArgs)) as T;
  }

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

/**
 * Poll getTransaction until it leaves NOT_FOUND; throw on FAILED. The poll budget must
 * outlast the tx's own validity window (`setTimeout(60)` above) — otherwise a slow ledger
 * makes us give up on a tx that actually lands, turning a successful claim into a
 * false-negative error in the funnel.
 */
async function pollTransaction(
  hash: string,
  tries = 65,
): Promise<rpc.Api.GetSuccessfulTransactionResponse> {
  let lastErr: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await server.getTransaction(hash);
      if (res.status === 'SUCCESS') return res;
      if (res.status === 'FAILED') throw new Error(`tx ${hash} failed on-chain`);
    } catch (e) {
      if (e instanceof Error && e.message.endsWith('failed on-chain')) throw e;
      lastErr = e; // transient decode/RPC error — keep polling
    }
    await sleep(1000);
  }
  throw new Error(`tx ${hash} not confirmed in time${lastErr ? ` (${String(lastErr)})` : ''}`);
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
