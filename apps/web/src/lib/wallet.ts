/**
 * Wallet layer (Sprint 1 / White belt). Two providers behind one interface:
 *
 *  - PASSKEY (production): passkey-kit smart-wallet (FaceID, no seed phrase), fee-sponsored
 *    via the OZ Relayer Channels submitter. Wired in `connectPasskey` once the wallet WASM
 *    hash is set (NEXT_PUBLIC_PASSKEY_WALLET_WASM_HASH) + the server-side relayer key
 *    (PASSKEY_RELAYER_URL/PASSKEY_RELAYER_API_KEY). See docs/PASSKEY_HANDOFF.md.
 *  - DEV (local/testing ONLY): an ephemeral classic keypair funded by Friendbot on
 *    testnet. Lets White belt run + be tested end-to-end without passkey infra.
 *    HARD-disabled on mainnet.
 *
 * The rest of the app depends only on the `Wallet` interface, so swapping providers
 * never touches feature code.
 */
import {
  Address,
  Contract,
  Keypair,
  StrKey,
  TransactionBuilder,
  hash as sha256,
  scValToNative,
  xdr,
} from '@stellar/stellar-sdk';
import {
  isConnected as freighterIsConnected,
  requestAccess as freighterRequestAccess,
  signTransaction as freighterSign,
  signMessage as freighterSignMessage,

} from '@stellar/freighter-api';
import { assertNetworkConfig, config, networkPassphrase, waitForAccountReady, server } from './stellar';
import { getItem, setItem, remove } from './storage';

export type WalletKind = 'passkey' | 'dev' | 'freighter' | 'albedo' | 'kit';

/**
 * How to establish a wallet:
 *  - `create` (default): the wallet this browser has on record — resuming a pending deploy —
 *    or, with none, enroll a NEW passkey and deploy its wallet.
 *  - `recover`: an EXISTING wallet only (issue #278). The passkey is picked in a WebAuthn
 *    prompt (synced ones included), so a returning user on a new phone, a second browser or
 *    after clearing site data reaches the SAME account instead of silently getting a fresh,
 *    empty one. Never enrolls or deploys; throws `AccountNotFoundError` when there is none.
 */
export type ConnectMode = 'create' | 'recover';

/** A `recover` connect found no existing wallet. Nothing was created, nothing stored changed. */
export class AccountNotFoundError extends Error {
  constructor(
    message = 'No account found for that passkey — create a new one, or use the device where you first signed up.',
  ) {
    super(message);
    this.name = 'AccountNotFoundError';
  }
}

export interface Wallet {
  kind: WalletKind;
  address: string;
  /** Sign a base64 tx XDR, returning the signed XDR. */
  sign: (xdr: string) => Promise<string>;
  /** Sign a plain UTF-8 message (ed25519), returning a base64 signature.
   * Used to PROVE wallet ownership to the attester (no key leaves the client). */
  signMessage: (message: string) => Promise<string>;
  /**
   * Smart-account-mediated contract call (passkey only). A passkey wallet's address is
   * a CONTRACT (`C…`), which can't be a classic tx source — so contract invocations are
   * authorized by the passkey and submitted via the relayer here, instead of the
   * build→sign→send path. When present, the contract layer routes through this; it
   * resolves once the tx confirms, with its hash and decoded return value. Absent on G…
   * wallets (dev/freighter).
   */
  invoke?: (
    contractId: string,
    method: string,
    args: import('@stellar/stellar-sdk').xdr.ScVal[],
  ) => Promise<{ hash: string; value: unknown }>;
}

function u8ToB64(u8: Uint8Array): string {
  let s = '';
  for (const b of u8) s += String.fromCharCode(b);
  return btoa(s);
}

function b64ToU8(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** WebAuthn credential ids are base64url and may be unpadded. */
function b64uToU8(b64url: string): Uint8Array {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  return b64ToU8(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
}

const DEV_SECRET_KEY = 'alvinmunk.devSecret';

/**
 * Is the passkey smart-wallet infra configured? The only client-visible gate is the wallet
 * WASM hash — the relayer URL + key are SERVER-only secrets (used in /api/passkey-send), so
 * the client can't see them. Setting the WASM hash means "offer passkey onboarding"; the
 * relayer must also be configured server-side (else /api/passkey-send returns a clear error).
 * Unset the hash to fall back to the dev wallet (testnet). See docs/PASSKEY_HANDOFF.md.
 */
export function isPasskeyConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_PASSKEY_WALLET_WASM_HASH);
}

/**
 * Pick the right provider. Passkey when configured; dev otherwise (testnet only). Like every
 * connect below, it refuses on an inconsistent network config: no wallet, no transaction — and
 * no passkey wallet deployed, nor dev wallet funded, on the wrong network.
 */
export async function getWallet(mode: ConnectMode = 'create'): Promise<Wallet> {
  assertNetworkConfig();
  if (isPasskeyConfigured()) return connectPasskey(mode);
  // The dev wallet lives only in this browser's storage: with none stored there is nothing to
  // recover, and minting one would hand the returning user a fresh, empty account.
  if (mode === 'recover' && !safeLocalGet(DEV_SECRET_KEY)) {
    throw new AccountNotFoundError('No wallet on this device to restore.');
  }
  return getDevWallet();
}

// ── Dev provider (testnet only) ──

export async function getDevWallet(): Promise<Wallet> {
  if (config.network === 'mainnet') {
    throw new Error('Dev wallet is disabled on mainnet — passkey infra is required.');
  }
  const existing = safeLocalGet(DEV_SECRET_KEY);
  const kp = existing ? Keypair.fromSecret(existing) : Keypair.random();

  if (!existing) {
    safeLocalSet(DEV_SECRET_KEY, kp.secret());
    await fundWithFriendbot(kp.publicKey());
    // Friendbot may return before the RPC sees the new account; wait so the first
    // getAccount in the onboarding flow doesn't 404.
    await waitForAccountReady(kp.publicKey());
  }

  return {
    kind: 'dev',
    address: kp.publicKey(),
    sign: async (xdr: string) => {
      const tx = TransactionBuilder.fromXDR(xdr, networkPassphrase);
      tx.sign(kp);
      return tx.toXDR();
    },
    signMessage: async (message: string) => {
      const sig = kp.sign(new TextEncoder().encode(message) as unknown as Buffer);
      return u8ToB64(new Uint8Array(sig));
    },
  };
}

/**
 * Friendbot funds a new testnet account (~10,000 XLM). No-op if already funded.
 * Friendbot is the single entry point of the install funnel, and it rate-limits /
 * times out under load — so we retry with backoff and surface a clear, recoverable
 * error if it stays down (onboarding must never die on a transient 429/5xx).
 */
export async function fundWithFriendbot(publicKey: string, tries = 4): Promise<void> {
  const url = `https://friendbot.stellar.org/?addr=${encodeURIComponent(publicKey)}`;
  let lastStatus = 0;
  for (let i = 0; i < tries; i++) {
    try {
      // Hard timeout per attempt — Friendbot can hold a connection open under load,
      // which would otherwise hang onboarding forever (no fetch default timeout).
      const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
      // 400 == already funded; 200 == funded now. Both are success.
      if (res.ok || res.status === 400) return;
      lastStatus = res.status;
    } catch {
      lastStatus = 0; // network/timeout — retry
    }
    if (i < tries - 1) await sleep(800 * (i + 1)); // linear backoff
  }
  throw new Error(
    `Couldn't fund your testnet wallet (Friendbot ${lastStatus || 'unreachable'}). ` +
    'Friendbot is busy — wait a moment and try again.',
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ── Freighter provider (browser extension) ──
// Satisfies the White-belt Level-1 rubric: Freighter connect/disconnect + signing.

export async function connectFreighter(): Promise<Wallet> {
  assertNetworkConfig();
  const conn = await freighterIsConnected();
  if (!conn.isConnected) {
    throw new Error('Freighter not detected. Install it from freighter.app, then retry.');
  }
  const access = await freighterRequestAccess();
  if ('error' in access && access.error) {
    throw new Error(String(access.error));
  }
  const address = access.address;
  return {
    kind: 'freighter',
    address,
    sign: async (xdr: string) => {
      const res = await freighterSign(xdr, {
        address,
        networkPassphrase,
      });
      if ('error' in res && res.error) {
        const e = res.error as string | { message?: string };
        throw new Error(typeof e === 'string' ? e : (e?.message ?? JSON.stringify(e)));
      }
      return res.signedTxXdr;
    },
    signMessage: async (message: string) => {
      const res = await freighterSignMessage(message, { address, networkPassphrase });
      if ('error' in res && res.error) {
        const e = res.error as string | { message?: string };
        throw new Error(typeof e === 'string' ? e : (e?.message ?? JSON.stringify(e)));
      }
      const { signedMessage } = res;
      // Freighter returns a base64 string in current versions; normalize defensively in
      // case a wallet build returns raw bytes instead (same pattern as wallet-kit.ts's
      // SWK normalization), so callers can always treat Wallet.signMessage as string-in/out.
      return typeof signedMessage === 'string'
        ? signedMessage
        : u8ToB64(new Uint8Array(signedMessage as unknown as ArrayBufferLike));
    },
  };
}

/** Freighter has no programmatic disconnect; apps clear their own connection state. */
export function disconnectFreighter(): void {
  /* state is held in React; the caller clears it. Kept for API symmetry. */
}

// ── Albedo provider (web wallet, no extension) ──
// Albedo is a hosted web wallet (popup to albedo.link) — works without any extension,
// so it's a light, build-safe second option for the multi-wallet connect modal. Tiny,
// zero-dependency SDK; dynamic-imported so it stays out of the marketing bundle.

export async function connectAlbedo(): Promise<Wallet> {
  assertNetworkConfig();
  const albedo = (await import('@albedo-link/intent')).default;
  const net = config.network === 'mainnet' ? 'public' : 'testnet';
  const { pubkey } = await albedo.publicKey({});
  return {
    kind: 'albedo',
    address: pubkey,
    sign: async (xdr: string) => {
      const res = await albedo.tx({ xdr, network: net, pubkey });
      return res.signed_envelope_xdr;
    },
    signMessage: async (message: string) => {
      // Albedo's sign_message intent signs under Albedo's own message envelope (not the
      // same raw bytes the dev wallet signs directly) — see note in wallet.ts header re:
      // signing schemes if this is ever consumed by an off-chain verifier.
      const res = await albedo.signMessage({ message, pubkey });
      return res.signed_message;
    },
  };
}

// ── Passkey provider (production) ──
//
// Built on `passkey-kit` (kalepail) — the canonical Stellar smart-wallet SDK. Its wallet WASM
// verifies the secp256r1 passkey signature INLINE (env.crypto), with no external verifier
// contract call, so the smart-account-kit footprint blocker does not exist (docs/PASSKEY_HANDOFF.md).
// A passkey wallet's address is a CONTRACT (C…), which can't be a classic tx source — contract
// calls go out via `invoke`: the passkey signs the Soroban auth entry, then the host function +
// signed auth are handed to the OZ Relayer Channels submitter (server-side, in /api/passkey-send),
// which sources the call on a fee-paying channel account, so the user never needs XLM. Turn it on
// by setting NEXT_PUBLIC_PASSKEY_WALLET_WASM_HASH (+ the server-side relayer key); otherwise the
// app stays on the dev wallet.

const PK_KEYID = 'alvinmunk.passkey.keyId';
const PK_CONTRACT = 'alvinmunk.passkey.contractId';
// The passkey PUBLIC KEY (base64) is persisted next to the key id so a deploy that never landed
// can be rebuilt on a later visit without a second WebAuthn enrollment (issue #186). Public data
// only, like the key id; dropped once the deploy is confirmed.
const PK_PUBKEY = 'alvinmunk.passkey.publicKey';
// Set between "passkey enrolled" and "deploy confirmed". While set, the next connect must resume
// the deploy for the SAME passkey (reusing the OS-saved credential) instead of creating a new one.
const PK_PENDING = 'alvinmunk.passkey.pendingDeploy';

// OZ Channels rejects an inner tx whose maxTime is > 60s in the future, so the deploy's time
// bounds stay under that. Those bounds are also WHY a retry rebuilds the deploy instead of
// replaying it — the assembled tx goes stale after this many seconds.
const PASSKEY_TIMEOUT_SECONDS = 50;

// Placeholder source for ASSEMBLING a passkey contract call (so simulation can populate the
// footprint + the unsigned auth entry). The relayer re-sources the call on a channel account
// at submit, so this is never the fee payer and need not exist on-chain.
const NULL_SOURCE = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';

/** POST a job to the server-side relayer (holds the OZ Channels key); returns the tx hash.
 * Two shapes: `{ xdr }` for a complete signed tx (the deploy), or `{ func, auth }` for a
 * Soroban contract call (channel-sourced; the relayer sets the fee + fee-bumps). */
async function relayerPost(body: Record<string, unknown>): Promise<string> {
  const res = await fetch('/api/passkey-send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as { hash?: string; error?: string };
  if (!res.ok || !json.hash) {
    throw new Error(json.error || `Relayer submit failed (${res.status}).`);
  }
  return json.hash;
}

/** Poll until a submitted tx confirms; throw on FAILED. Mirrors contracts.ts pollTransaction. */
async function waitForPasskeyTx(hash: string, tries = 65): Promise<unknown> {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await server.getTransaction(hash);
      if (res.status === 'SUCCESS') {
        return res.returnValue ? scValToNative(res.returnValue) : undefined;
      }
      if (res.status === 'FAILED') throw new Error(`tx ${hash} failed on-chain`);
    } catch (e) {
      if (e instanceof Error && e.message.endsWith('failed on-chain')) throw e;
      // transient decode/NOT_FOUND — keep polling
    }
    await sleep(1000);
  }
  throw new Error(`tx ${hash} not confirmed in time`);
}

/**
 * Is a smart-wallet contract instance present on-chain? Distinguishes a deploy that never landed
 * from one that landed late (after the confirm poll gave up) — see issue #186. Reads the instance
 * entry itself rather than using `server.getContractData`, which reports ANY RPC failure as "not
 * found": an RPC blip must not pass for "absent" and resubmit a deploy that already landed.
 */
async function passkeyContractExists(contractId: string): Promise<boolean> {
  if (!StrKey.isValidContract(contractId)) return false;
  try {
    const { entries } = await server.getLedgerEntries(new Contract(contractId).getFootprint());
    return entries.length > 0;
  } catch (e) {
    throw new Error("Couldn't reach the network to check your wallet — try again in a moment.", {
      cause: e,
    });
  }
}

/** An enrolled passkey's raw key material — what the wallet's Secp256r1 signer is built from. */
interface PasskeyKey {
  keyId: Uint8Array;
  publicKey: Uint8Array;
}

/**
 * Decode a stored passkey record, or null when it's missing or corrupted: the key id isn't
 * base64url, or the public key isn't the uncompressed P-256 point (0x04 ‖ x ‖ y) the signer takes.
 * A deploy rebuilt from such a record could never work.
 */
function decodePasskeyKey(keyIdB64: string, publicKeyB64: string | null): PasskeyKey | null {
  if (!publicKeyB64) return null;
  try {
    const keyId = b64uToU8(keyIdB64);
    const publicKey = b64ToU8(publicKeyB64);
    if (keyId.length === 0 || publicKey.length !== 65 || publicKey[0] !== 0x04) return null;
    return { keyId, publicKey };
  } catch {
    return null; // not base64 at all
  }
}

/**
 * passkey-kit deploys every wallet from this deterministic shared source (see PasskeyKit's
 * constructor). Reproducing it is what makes a rebuilt deploy land — and a recovered passkey
 * derive — the SAME contract id.
 */
function passkeyDeployer(): Keypair {
  return Keypair.fromRawEd25519Seed(sha256('kalepail'));
}

/**
 * The wallet contract a passkey deploys to: the shared deploy source with `hash(keyId)` as salt,
 * on this network. The same derivation as passkey-kit's (private) `encodeContract`, which
 * `connectWallet` uses.
 */
function passkeyContractId(keyId: Uint8Array): string {
  const preimage = xdr.HashIdPreimage.envelopeTypeContractId(
    new xdr.HashIdPreimageContractId({
      networkId: sha256(networkPassphrase),
      contractIdPreimage: xdr.ContractIdPreimage.contractIdPreimageFromAddress(
        new xdr.ContractIdPreimageFromAddress({
          address: Address.fromString(passkeyDeployer().publicKey()).toScAddress(),
          salt: sha256(keyId as Buffer),
        }),
      ),
    }),
  );
  return StrKey.encodeContract(sha256(preimage.toXDR()));
}

/**
 * Build (and deployer-sign) a smart-wallet deploy transaction for an ALREADY-enrolled passkey.
 *
 * `PasskeyKit.createWallet` enrols the passkey and deploys in a single opaque call and persists
 * nothing in between, so a relayer/confirm failure orphans a passkey the OS has already saved and
 * the app has no record of (issue #186). We split the two halves: enrollment is `kit.createKey()`,
 * this is the (re)buildable deploy — the same `PasskeyClient.deploy` call `createWallet` makes.
 *
 * It MUST be rebuilt on retry, never replayed: the assembled tx carries TIME BOUNDS that expire
 * after `timeoutInSeconds`. The contract id is deterministic — passkey-kit's fixed deploy source
 * (`hash('kalepail')`) plus `hash(keyId)` as salt — so a rebuild lands the SAME wallet the first
 * attempt would have.
 */
async function buildPasskeyDeploy(
  key: PasskeyKey,
  wasmHash: string,
): Promise<{ contractId: string; signedXdr: string }> {
  const { PasskeyClient } = await import('passkey-kit');

  const deployer = passkeyDeployer();

  const at = await PasskeyClient.deploy(
    {
      signer: {
        tag: 'Secp256r1',
        values: [key.keyId, key.publicKey, [undefined], [undefined], { tag: 'Persistent', values: undefined }],
      },
    } as unknown as Parameters<typeof PasskeyClient.deploy>[0],
    {
      rpcUrl: config.rpcUrl,
      wasmHash,
      networkPassphrase,
      publicKey: deployer.publicKey(),
      salt: new Uint8Array(sha256(key.keyId as Buffer)),
      timeoutInSeconds: PASSKEY_TIMEOUT_SECONDS,
    },
  );

  await at.sign({
    signTransaction: async (txXdr: string) => {
      const tx = TransactionBuilder.fromXDR(txXdr, networkPassphrase);
      tx.sign(deployer);
      return { signedTxXdr: tx.toXDR() };
    },
  });

  return { contractId: at.result.options.contractId, signedXdr: at.signed!.toXDR() };
}

/**
 * Deploy the smart wallet for an enrolled passkey, wait for it to confirm, then settle the pending
 * record. A reported failure is not proof the deploy didn't land — the relayer can error after it
 * submitted, the poll can give up on a slow ledger, an earlier attempt's tx can win the race — so
 * the chain is checked before giving up. On a real failure the record stays pending and the next
 * connect resumes with the same passkey.
 */
async function deployPasskeyWallet(key: PasskeyKey, wasmHash: string): Promise<void> {
  let contractId = safeLocalGet(PK_CONTRACT);
  try {
    const built = await buildPasskeyDeploy(key, wasmHash);
    contractId = built.contractId;
    safeLocalSet(PK_CONTRACT, contractId);
    await waitForPasskeyTx(await relayerPost({ xdr: built.signedXdr }));
  } catch (e) {
    const landed = contractId ? await passkeyContractExists(contractId).catch(() => false) : false;
    if (!landed) {
      const reason = (e instanceof Error ? e.message : String(e)).split('\n')[0];
      throw new Error(`Wallet setup didn't finish — try again, your passkey is saved. (${reason})`, {
        cause: e,
      });
    }
  }
  settlePasskeyRecord();
}

/**
 * Finish the pending deploy of a stored passkey. Returns false when the record is corrupted and
 * its wallet never landed, i.e. there is nothing left to resume.
 */
async function resumePasskeyDeploy(keyIdB64: string, wasmHash: string): Promise<boolean> {
  // A confirm timeout is not a failure: the deploy may have landed late. Check the chain first;
  // only rebuild if the contract really isn't there.
  const contractId = safeLocalGet(PK_CONTRACT);
  if (contractId && (await passkeyContractExists(contractId))) {
    settlePasskeyRecord();
    return true;
  }
  const key = decodePasskeyKey(keyIdB64, safeLocalGet(PK_PUBKEY));
  if (!key) return false;
  await deployPasskeyWallet(key, wasmHash);
  return true;
}

/** The deploy is confirmed: keep only what a returning user needs (key id + contract id). */
function settlePasskeyRecord(): void {
  safeLocalRemove(PK_PENDING);
  safeLocalRemove(PK_PUBKEY);
}

/** Forget the stored passkey record entirely. */
function clearPasskeyRecord(): void {
  for (const k of [PK_PENDING, PK_KEYID, PK_PUBKEY, PK_CONTRACT]) safeLocalRemove(k);
}

/**
 * Find the existing wallet of a passkey the user picks (issue #278) and make it this browser's
 * record; returns its key id. `connectWallet` without a keyId runs a WebAuthn assertion for any
 * discoverable passkey of this site — synced ones included (iCloud Keychain, Google Password
 * Manager) — so this works where no record exists, and where the record is for a DIFFERENT
 * passkey (say, one enrolled here by mistake before choosing "I already have an account").
 *
 * Never enrolls or deploys. The record is only replaced once the wallet is confirmed on-chain:
 * a missing wallet, an RPC failure or a dismissed prompt leave it as it was, so a pending
 * deploy stays resumable.
 */
async function recoverPasskey(kit: import('passkey-kit').PasskeyKit): Promise<string> {
  // The kit probes its derived contract with `getContractData`, which reports ANY RPC failure
  // as "not found" and then throws a bare "Failed to connect wallet". Handing the same
  // derivation back as its fallback leaves the verdict to `passkeyContractExists`, which tells
  // an RPC blip (throws) from a wallet that isn't there (false).
  const found = await kit.connectWallet({
    getContractId: async (keyId) => passkeyContractId(b64uToU8(keyId)),
  });
  if (!(await passkeyContractExists(found.contractId))) throw new AccountNotFoundError();
  clearPasskeyRecord(); // whatever was on record here belongs to another (or an unfinished) wallet
  safeLocalSet(PK_KEYID, found.keyIdBase64);
  safeLocalSet(PK_CONTRACT, found.contractId);
  return found.keyIdBase64;
}

export async function connectPasskey(mode: ConnectMode = 'create'): Promise<Wallet> {
  const wasmHash = process.env.NEXT_PUBLIC_PASSKEY_WALLET_WASM_HASH;
  if (!wasmHash) {
    throw new Error(
      'Passkey infra not configured. Set NEXT_PUBLIC_PASSKEY_WALLET_WASM_HASH (+ the ' +
      'server-side PASSKEY_RELAYER_* secrets; see docs/PASSKEY_HANDOFF.md), or use the ' +
      'dev wallet on testnet (default).',
    );
  }

  // Browser-only SDK (WebAuthn); dynamic-imported so it never enters SSR or the marketing
  // bundle. Ships raw TS (transpiled via next.config transpilePackages); no native deps.
  const { PasskeyKit } = await import('passkey-kit');
  // timeoutInSeconds drives the built tx's TIME BOUNDS. The OZ Channels relayer rejects an
  // inner tx whose maxTime is > 60s in the future ("too far into the future"), so keep this
  // under 60. (It ALSO drives the default auth-entry expiration, which is too tight for a
  // multi-step call — but we override THAT per-invoke below with an explicit, generous
  // expiration, so the deploy stays relayer-safe while invokes don't expire.)
  const kit = new PasskeyKit({
    rpcUrl: config.rpcUrl,
    networkPassphrase,
    walletWasmHash: wasmHash,
    timeoutInSeconds: PASSKEY_TIMEOUT_SECONDS,
  });

  // Returning user → re-derive the wallet from the stored credential (no Mercury needed: the
  // contract id derives on-chain from the keyId; the cached id is a fallback). First run →
  // FaceID/passkey enroll, then persist + deploy + CONFIRM via the relayer before returning —
  // otherwise the next call would hit an undeployed C… account. Recover → the user picks an
  // existing passkey instead, whatever this browser has on record (see `recoverPasskey`).
  //
  // Enrollment and deploy are deliberately SPLIT. `kit.createWallet` does both in one call and
  // stores nothing in between, so a relayer/confirm failure orphans a passkey the OS has already
  // saved and the app has no record of. Persisting the key material first (with a pendingDeploy
  // marker) is what lets a retry resume with the SAME passkey (issue #186).
  let storedKeyId = mode === 'recover' ? null : safeLocalGet(PK_KEYID);
  if (storedKeyId && safeLocalGet(PK_PENDING) && !(await resumePasskeyDeploy(storedKeyId, wasmHash))) {
    // The pending record is corrupted and its wallet never landed, so it can't be resumed. Drop
    // it and enroll afresh instead of leaving every later connect stuck on it.
    clearPasskeyRecord();
    storedKeyId = null;
  }

  let keyId: string;
  if (mode === 'recover') {
    keyId = await recoverPasskey(kit);
  } else if (storedKeyId) {
    keyId = storedKeyId;
  } else {
    // First run: enroll, then persist key id + public key + the pendingDeploy marker BEFORE we
    // submit anything, so any failure past this point is recoverable with the same passkey.
    const created = await kit.createKey('alvinmunk', 'alvinmunk');
    keyId = created.keyIdBase64;
    const publicKeyB64 = u8ToB64(created.publicKey);
    const key = decodePasskeyKey(keyId, publicKeyB64);
    if (!key) throw new Error("This passkey can't secure a wallet — try again or use another device.");
    clearPasskeyRecord(); // nothing left over from an earlier record (e.g. its contract id) applies
    safeLocalSet(PK_PENDING, '1');
    safeLocalSet(PK_KEYID, keyId);
    safeLocalSet(PK_PUBKEY, publicKeyB64);
    await deployPasskeyWallet(key, wasmHash);
  }

  // Derive + verify the wallet from the (possibly just-deployed) credential. This also wires the
  // kit's contract client so `invoke` below can sign with the passkey.
  const res = await kit.connectWallet({
    keyId,
    getContractId: async () => safeLocalGet(PK_CONTRACT) ?? undefined,
  });
  keyId = res.keyIdBase64;
  const contractId = res.contractId;

  return {
    kind: 'passkey',
    address: contractId, // a CONTRACT address (C…), not a G… key
    invoke: async (target, method, callArgs) => {
      // The app SDK (@stellar/stellar-sdk v16) and passkey-kit's bundled SDK (v14) are
      // DIFFERENT package instances, so an AssembledTransaction we build here would fail
      // kit.sign's `instanceof` check and be mis-parsed. We sidestep that by crossing the
      // boundary as XDR BYTES: assemble + simulate the call with the app SDK (so it carries
      // the footprint + the unsigned auth entry for our C… smart wallet), then hand the XDR
      // STRING to kit.sign — passkey-kit rebuilds it inside its own SDK and the passkey
      // (FaceID) signs the smart-account auth entry.
      const { Contract, Account } = await import('@stellar/stellar-sdk');
      const tx = new TransactionBuilder(new Account(NULL_SOURCE, '0'), {
        fee: '1000000', // placeholder inclusion fee; the relayer sets the real fee at submit
        networkPassphrase,
      })
        .addOperation(new Contract(target).call(method, ...callArgs))
        .setTimeout(180)
        .build();
      const prepared = await server.prepareTransaction(tx);

      // Give the passkey-signed AUTH entry a generous expiration ledger (≈ +120 ledgers, ~10
      // min). This is independent of the tx time bounds (the relayer rebuilds those on a
      // channel account at submit), so a multi-step call can't have its auth expire before it
      // lands — the cause of the earlier quest "op=Trapped" (simulates OK, then traps).
      const { sequence: latestLedger } = await server.getLatestLedger();
      const at = await kit.sign(prepared.toXDR(), { keyId, expiration: latestLedger + 120 });
      const built = at.built;
      if (!built) throw new Error(`${method}: build produced no transaction to submit.`);

      // Submit via the channel-account Soroban path: hand the host function + the passkey-signed
      // auth entries to the relayer. It sources the call on a channel account (unique sequence →
      // no races), sets fee = resource fee, and fee-bumps — so we never fight the "inner fee must
      // equal the resource fee" rule. The relayer returns only the hash, so decode the return
      // value from the confirmed tx (callers e.g. mintVouch → vouch id).
      const op = built.operations[0] as unknown as {
        func?: { toXDR(format: 'base64'): string };
        auth?: Array<{ toXDR(format: 'base64'): string }>;
      };
      if (!op?.func) throw new Error(`${method}: expected an invokeHostFunction operation.`);
      const hash = await relayerPost({
        func: op.func.toXDR('base64'),
        auth: (op.auth ?? []).map((e) => e.toXDR('base64')),
      });
      return { hash, value: await waitForPasskeyTx(hash) };
    },
    sign: async () => {
      // Passkey wallets author actions via `invoke` (Soroban auth), never raw classic XDR.
      throw new Error('This action needs a classic wallet; passkey wallets sign on-chain calls only.');
    },
    signMessage: async () => {
      // Quest ownership proof verifies an ed25519 G… signer; the smart-account (secp256r1)
      // signer path is a documented follow-up in the attester. Defer like Freighter quests.
      throw new Error('Quests with a passkey wallet are coming soon — use the in-app wallet to verify a quest for now.');
    },
  };
}

// ── helpers ──

function safeLocalGet(k: string): string | null {
  return getItem(k);
}
function safeLocalSet(k: string, v: string): void {
  setItem(k, v);
}
function safeLocalRemove(k: string): void {
  remove(k);
}
