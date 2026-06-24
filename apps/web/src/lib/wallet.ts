/**
 * Wallet layer (Sprint 1 / White belt). Two providers behind one interface:
 *
 *  - PASSKEY (production): passkey smart wallet (FaceID, no seed phrase), fee-sponsored.
 *    Requires deployed factory + a submitter (launchtube) — wired in `connectPasskey`
 *    once that infra is configured (NEXT_PUBLIC_WALLET_WASM_HASH + LAUNCHTUBE_URL).
 *  - DEV (local/testing ONLY): an ephemeral classic keypair funded by Friendbot on
 *    testnet. Lets White belt run + be tested end-to-end without passkey infra.
 *    HARD-disabled on mainnet.
 *
 * The rest of the app depends only on the `Wallet` interface, so swapping providers
 * never touches feature code.
 */
import { Keypair, TransactionBuilder } from '@stellar/stellar-sdk';
import {
  isConnected as freighterIsConnected,
  requestAccess as freighterRequestAccess,
  signTransaction as freighterSign,
} from '@stellar/freighter-api';
import { config, networkPassphrase } from './stellar';

export type WalletKind = 'passkey' | 'dev' | 'freighter';

export interface Wallet {
  kind: WalletKind;
  address: string;
  /** Sign a base64 tx XDR, returning the signed XDR. */
  sign: (xdr: string) => Promise<string>;
  /** Sign a plain UTF-8 message (ed25519), returning a base64 signature.
   * Used to PROVE wallet ownership to the attester (no key leaves the client). */
  signMessage: (message: string) => Promise<string>;
}

function u8ToB64(u8: Uint8Array): string {
  let s = '';
  for (const b of u8) s += String.fromCharCode(b);
  return btoa(s);
}

const DEV_SECRET_KEY = 'passport.devSecret';

/**
 * Is the passkey smart-wallet infra fully configured? Requires ALL THREE pieces —
 * the deployed wallet WASM hash, a launchtube submitter (fee sponsorship), and the
 * factory contract id. Half-configured = stay on the dev wallet (never half-enable).
 * See docs/PASSKEY_WIRING.md.
 */
export function isPasskeyConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_WALLET_WASM_HASH &&
      process.env.NEXT_PUBLIC_LAUNCHTUBE_URL &&
      process.env.NEXT_PUBLIC_PASSKEY_FACTORY_ID,
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
      const res = await fetch(url);
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

// ── Passkey provider (production) ──
//
// This is the ONLY function that needs filling to ship real FaceID onboarding — the
// adapter seam is already complete: every caller depends only on the `Wallet`
// interface, so wiring passkey here touches no feature code. It's deferred (not on
// the critical path to the next belt) and intentionally carries NO heavy dependency:
// `passkey-kit` pulls native node-gyp modules that fail Vercel's install-time build,
// which is why it was removed. Re-add it safely (pnpm.overrides / isolated package)
// only when the infra below exists. Full runbook: docs/PASSKEY_WIRING.md.
//
// Integration contract (map passkey-kit -> the `Wallet` interface):
//   const kit = new PasskeyKit({
//     rpcUrl: config.rpcUrl,
//     networkPassphrase,
//     walletWasmHash:  process.env.NEXT_PUBLIC_WALLET_WASM_HASH!,
//     factoryContractId: process.env.NEXT_PUBLIC_PASSKEY_FACTORY_ID!,
//   });
//   // createWallet() on first run (FaceID enroll) / connectWallet() on return;
//   // submit via launchtube (NEXT_PUBLIC_LAUNCHTUBE_URL) for sponsored fees.
//   return {
//     kind: 'passkey',
//     address: contractId,                 // the smart-account contract address (C...)
//     sign: (xdr) => kit.sign(xdr) -> launchtube.send(...) -> signedXdr,
//     signMessage: (m) => kit.signMessage(m),  // for the /api/attest ownership proof
//   };
export async function connectPasskey(): Promise<Wallet> {
  throw new Error(
    'Passkey infra not configured. Set NEXT_PUBLIC_WALLET_WASM_HASH, ' +
      'NEXT_PUBLIC_LAUNCHTUBE_URL and NEXT_PUBLIC_PASSKEY_FACTORY_ID (see ' +
      'docs/PASSKEY_WIRING.md), or use the dev wallet on testnet (default).',
  );
}

// ── helpers ──

function safeLocalGet(k: string): string | null {
  return typeof localStorage !== 'undefined' ? localStorage.getItem(k) : null;
}
function safeLocalSet(k: string, v: string): void {
  if (typeof localStorage !== 'undefined') localStorage.setItem(k, v);
}
