/**
 * Wallet layer (Sprint 1 / White belt). Two providers behind one interface:
 *
 *  - PASSKEY (production): smart-account-kit passkey wallet (FaceID, no seed phrase),
 *    fee-sponsored via a relayer. Wired in `connectPasskey` once the infra env is set
 *    (NEXT_PUBLIC_SMART_ACCOUNT_WASM_HASH + WEBAUTHN_VERIFIER_ID + RELAYER_URL). See
 *    docs/PASSKEY_WIRING.md.
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

const DEV_SECRET_KEY = 'passport.devSecret';

/**
 * Is the passkey smart-wallet infra configured? Needs the OpenZeppelin smart-account
 * WASM hash + the WebAuthn verifier contract. On testnet the kit's shared, well-known
 * deployer account pays fees, so a relayer is OPTIONAL there; set NEXT_PUBLIC_RELAYER_URL
 * to sponsor fees yourself (required for mainnet). Half-configured = stay on the dev
 * wallet (never half-enable). See docs/PASSKEY_WIRING.md.
 */
export function isPasskeyConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SMART_ACCOUNT_WASM_HASH &&
      process.env.NEXT_PUBLIC_WEBAUTHN_VERIFIER_ID,
  );
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
// Built on `smart-account-kit` (compiled ESM, no native deps → Vercel-build-safe). The
// adapter seam is complete: callers depend only on the `Wallet` interface, so this file
// is the only feature-facing change. A passkey wallet's address is a CONTRACT (C…), which
// can't be a classic tx source — contract calls go out via `invoke` (auth signed by the
// passkey, submitted + fee-sponsored by the relayer). Turn it on by setting the three
// NEXT_PUBLIC_* infra vars below; otherwise the app stays on the dev wallet.
// Full runbook + deferred follow-ups (quests, trustlines): docs/PASSKEY_WIRING.md.
export async function connectPasskey(): Promise<Wallet> {
  const wasmHash = process.env.NEXT_PUBLIC_SMART_ACCOUNT_WASM_HASH;
  const verifier = process.env.NEXT_PUBLIC_WEBAUTHN_VERIFIER_ID;
  if (!wasmHash || !verifier) {
    throw new Error(
      'Passkey infra not configured. Set NEXT_PUBLIC_SMART_ACCOUNT_WASM_HASH, ' +
        'NEXT_PUBLIC_WEBAUTHN_VERIFIER_ID and NEXT_PUBLIC_RELAYER_URL (see ' +
        'docs/PASSKEY_WIRING.md), or use the dev wallet on testnet (default).',
    );
  }

  // Browser-only SDK (WebAuthn + IndexedDB); dynamic-imported so it never enters SSR
  // or the marketing bundle. Compiled ESM, no native deps — Vercel-build-safe.
  const { SmartAccountKit, IndexedDBStorage } = await import('smart-account-kit');
  const kit = new SmartAccountKit({
    rpcUrl: config.rpcUrl,
    networkPassphrase,
    accountWasmHash: wasmHash,
    webauthnVerifierAddress: verifier,
    // Relayer (OZ Channels) pays fees so the user needs no XLM — a C… account can't
    // be a tx source, so submission MUST go through it.
    relayerUrl: process.env.NEXT_PUBLIC_RELAYER_URL || undefined,
    storage: new IndexedDBStorage(),
    rpName: 'Stellar Passport',
  });

  // Returning user → silent restore. First run → FaceID/passkey enroll + create the
  // smart account (fees sponsored by the relayer).
  const restored = await kit.connectWallet();
  const contractId =
    restored?.contractId ??
    (await kit.createWallet('Stellar Passport', 'passport', { autoSubmit: true })).contractId;

  return {
    kind: 'passkey',
    address: contractId, // a CONTRACT address (C…), not a G… key
    invoke: async (target, method, callArgs) => {
      // Build the contract call with the kit's shared DEPLOYER account (a real G… key) as
      // the fee source — a C… smart account can't be a tx source. Simulation returns the
      // auth entries requiring the smart account's signature; kit.signAndSubmit then signs
      // them with the passkey, re-simulates, and submits (deployer pays the fee).
      const { contract: contractNs } = await import('@stellar/stellar-sdk');
      const at = await contractNs.AssembledTransaction.build({
        method,
        args: callArgs,
        contractId: target,
        networkPassphrase,
        rpcUrl: config.rpcUrl,
        publicKey: kit.deployerPublicKey,
        parseResultXdr: (scv) => scValToNative(scv),
      });
      const sent = await kit.signAndSubmit(at);
      if (!sent.success) throw new Error(sent.error || `${method} failed`);
      // signAndSubmit only returns {success, hash} — no return value. Fetch the confirmed
      // tx by hash and decode its result so callers (e.g. mintVouch → vouch id) get it.
      const res = await server.getTransaction(sent.hash);
      const rv = res.status === 'SUCCESS' ? res.returnValue : undefined;
      return rv ? scValToNative(rv) : undefined;
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
