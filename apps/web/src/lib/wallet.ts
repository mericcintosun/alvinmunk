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
import { Keypair, TransactionBuilder, scValToNative } from '@stellar/stellar-sdk';
import {
  isConnected as freighterIsConnected,
  requestAccess as freighterRequestAccess,
  signTransaction as freighterSign,
} from '@stellar/freighter-api';
import { config, networkPassphrase, waitForAccountReady, server } from './stellar';

export type WalletKind = 'passkey' | 'dev' | 'freighter' | 'albedo';

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
   * build→sign→send path. When present, the contract layer routes through this and
   * returns the decoded return value. Absent on G… wallets (dev/freighter).
   */
  invoke?: (
    contractId: string,
    method: string,
    args: import('@stellar/stellar-sdk').xdr.ScVal[],
  ) => Promise<unknown>;
}

function u8ToB64(u8: Uint8Array): string {
  let s = '';
  for (const b of u8) s += String.fromCharCode(b);
  return btoa(s);
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

/** Pick the right provider. Passkey when configured; dev otherwise (testnet only). */
export async function getWallet(): Promise<Wallet> {
  if (isPasskeyConfigured()) return connectPasskey();
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
      if ('error' in res && res.error) throw new Error(String(res.error));
      return res.signedTxXdr;
    },
    signMessage: async () => {
      // Freighter message-signing uses a different scheme; not wired for quest
      // ownership proof yet. Use the in-app (passkey/dev) wallet for quests.
      throw new Error('Quests via Freighter not supported yet — use the in-app wallet.');
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
    signMessage: async () => {
      throw new Error('Quests via Albedo not supported yet — use the in-app wallet.');
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

export async function connectPasskey(): Promise<Wallet> {
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
    timeoutInSeconds: 50,
  });

  // Returning user → re-derive the wallet from the stored credential (no Mercury needed: the
  // contract id derives on-chain from the keyId; the cached id is a fallback). First run →
  // FaceID/passkey enroll + build the deploy tx, then submit + CONFIRM it via the relayer
  // before returning — otherwise the next call would hit an undeployed C… account.
  const storedKeyId = safeLocalGet(PK_KEYID);
  const storedContractId = safeLocalGet(PK_CONTRACT);
  let keyId: string;
  let contractId: string;
  if (storedKeyId) {
    const res = await kit.connectWallet({
      keyId: storedKeyId,
      getContractId: async () => storedContractId ?? undefined,
    });
    keyId = res.keyIdBase64;
    contractId = res.contractId;
  } else {
    const created = await kit.createWallet('alvinmunk', 'alvinmunk');
    const hash = await relayerPost({ xdr: created.signedTx.toXDR() });
    await waitForPasskeyTx(hash);
    keyId = created.keyIdBase64;
    contractId = created.contractId;
    safeLocalSet(PK_KEYID, keyId);
    safeLocalSet(PK_CONTRACT, contractId);
  }

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
      return waitForPasskeyTx(hash);
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
  return typeof localStorage !== 'undefined' ? localStorage.getItem(k) : null;
}
function safeLocalSet(k: string, v: string): void {
  if (typeof localStorage !== 'undefined') localStorage.setItem(k, v);
}
