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
  Operation,
  TransactionBuilder,
  nativeToScVal,
  scValToNative,
  rpc,
  xdr,
  type Transaction,
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
  addrs: (gs: string[]) => xdr.ScVal.scvVec(gs.map((g) => new Address(g).toScVal())),
  u32: (n: number) => nativeToScVal(n, { type: 'u32' }),
  u64: (n: number | bigint) => nativeToScVal(n, { type: 'u64' }),
  i128: (n: bigint) => nativeToScVal(n, { type: 'i128' }),
  bool: (b: boolean) => xdr.ScVal.scvBool(b),
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

/** A confirmed state-changing call: its transaction hash and decoded return value. */
export interface InvokeReceipt {
  hash: string;
  value: unknown;
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
  return (await submitAndWait(contractId, method, callArgs, wallet)).value as T;
}

/** Same as `invokeAndWait`, but resolves the confirmed transaction hash (for receipts). */
export async function invokeAndWaitHash(
  contractId: string,
  method: string,
  callArgs: xdr.ScVal[],
  wallet: Wallet,
): Promise<string> {
  return (await submitAndWait(contractId, method, callArgs, wallet)).hash;
}

/**
 * A call that needs TWO wallets' authorization (e.g. `transfer_handle`): `wallet` submits it
 * exactly as `invokeAndWait` would, after `cosigner` has signed its own auth entry — which
 * takes `cosigner.signAuthEntry`, a key held in this browser. Resolves once confirmed.
 */
export async function invokeCosigned(
  contractId: string,
  method: string,
  callArgs: xdr.ScVal[],
  wallet: Wallet,
  cosigner: Wallet,
): Promise<InvokeReceipt> {
  return submitAndWait(contractId, method, callArgs, wallet, (tx) => cosignAuth(tx, cosigner));
}

/** How long a co-signature stays valid (~10 min of 5s ledgers): time for the submitting
 * wallet to sign too. Matches the passkey wallet's own auth expiration. */
const COSIGN_VALID_LEDGERS = 120;

/**
 * `tx` (a prepared single-call transaction) with `cosigner`'s unsigned auth entries signed
 * by it. Every other entry is left as it is, for the submitting wallet to sign.
 */
async function cosignAuth(tx: Transaction, cosigner: Wallet): Promise<Transaction> {
  const sign = cosigner.signAuthEntry;
  if (!sign) throw new Error("This wallet can't co-sign a call from here.");
  const op = tx.operations[0] as Operation.InvokeHostFunction;
  const auth = op.auth ?? [];
  const mine = auth.map((entry) => awaitsSignatureFrom(entry, cosigner.address));
  if (!mine.includes(true)) throw new Error(`Nothing in this call for ${cosigner.address} to sign.`);
  const { sequence } = await server.getLatestLedger();
  const signed = await Promise.all(
    auth.map((entry, i) => (mine[i] ? sign(entry, sequence + COSIGN_VALID_LEDGERS) : entry)),
  );
  return TransactionBuilder.cloneFrom(tx)
    .clearOperations()
    .addOperation(Operation.invokeHostFunction({ source: op.source, func: op.func, auth: signed }))
    .build();
}

/** Is `entry` an address-credential auth entry for `address` that nobody has signed yet? */
function awaitsSignatureFrom(entry: xdr.SorobanAuthorizationEntry, address: string): boolean {
  const creds = entry.credentials();
  if (creds.switch() !== xdr.SorobanCredentialsType.sorobanCredentialsAddress()) return false;
  const signer = creds.address();
  return (
    Address.fromScAddress(signer.address()).toString() === address &&
    signer.signature().switch() === xdr.ScValType.scvVoid()
  );
}

async function submitAndWait(
  contractId: string,
  method: string,
  callArgs: xdr.ScVal[],
  wallet: Wallet,
  cosign?: (prepared: Transaction) => Promise<Transaction>,
): Promise<InvokeReceipt> {
  requireDeployed(contractId, method);

  // Passkey (smart-account) wallets can't be a classic tx source: the call is
  // authorized by the passkey and submitted via the relayer inside wallet.invoke.
  if (wallet.invoke) {
    return cosign
      ? wallet.invoke(contractId, method, callArgs, cosign)
      : wallet.invoke(contractId, method, callArgs);
  }

  const account = await server.getAccount(wallet.address);
  const built = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase })
    .addOperation(new Contract(contractId).call(method, ...callArgs))
    .setTimeout(60)
    .build();

  let prepared = await server.prepareTransaction(built);
  // With a co-signer's signature in, simulate again: verifying it adds to the footprint
  // and fee (the auth entries themselves are kept as signed).
  if (cosign) prepared = await server.prepareTransaction(await cosign(prepared));
  const signedXdr = await wallet.sign(prepared.toXDR());
  const signed = TransactionBuilder.fromXDR(signedXdr, networkPassphrase);

  const sent = await server.sendTransaction(signed);
  if (sent.status === 'ERROR') {
    throw new Error(`send ${method} failed: ${JSON.stringify(sent.errorResult)}`);
  }

  const result = await pollTransaction(sent.hash);
  const retval = result.returnValue;
  return { hash: sent.hash, value: retval ? scValToNative(retval) : undefined };
}

/** A `#[contracttype]` enum key as the contracts store it: `vec[Symbol(variant), ...fields]`. */
export function enumKey(variant: string, ...fields: xdr.ScVal[]): xdr.ScVal {
  return xdr.ScVal.scvVec([xdr.ScVal.scvSymbol(variant), ...fields]);
}

/**
 * Read stored contract state straight from the ledger (no simulation, no source account) —
 * for state a contract keeps but has no getter for, like its admin or a quest config. One
 * RPC round-trip for all `keys`; each result is `null` when that entry doesn't exist. Unlike
 * `getContractData`, an RPC failure throws instead of reading as "not found".
 */
export async function readLedgerData(
  contractId: string,
  keys: xdr.ScVal[],
): Promise<Array<xdr.ScVal | null>> {
  requireDeployed(contractId, 'ledger read');
  const contract = new Contract(contractId).address().toScAddress();
  // Instance storage and `persistent()` entries both live under persistent durability.
  const durability = xdr.ContractDataDurability.persistent();
  const ledgerKeys = keys.map((key) =>
    xdr.LedgerKey.contractData(new xdr.LedgerKeyContractData({ contract, key, durability })),
  );
  const { entries } = await server.getLedgerEntries(...ledgerKeys);
  const found = new Map(
    (entries ?? []).map((e) => [e.key.toXDR('base64'), e.val.contractData().val()]),
  );
  return ledgerKeys.map((k) => found.get(k.toXDR('base64')) ?? null);
}

/** One value from a contract instance's storage (`null` if the key isn't set). */
export function instanceStorageValue(instance: xdr.ScVal, key: xdr.ScVal): xdr.ScVal | null {
  const want = key.toXDR('base64');
  const storage = instance.instance().storage() ?? [];
  return storage.find((e) => e.key().toXDR('base64') === want)?.val() ?? null;
}

/** Read one key of a contract's INSTANCE storage (where every contract keeps its Admin). */
export async function readInstanceValue(
  contractId: string,
  key: xdr.ScVal,
): Promise<xdr.ScVal | null> {
  const [instance] = await readLedgerData(contractId, [xdr.ScVal.scvLedgerKeyContractInstance()]);
  return instance ? instanceStorageValue(instance, key) : null;
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
