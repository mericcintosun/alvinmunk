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

/** Is the passkey smart-wallet infra configured? If not, we use the dev wallet. */
export function isPasskeyConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_WALLET_WASM_HASH && process.env.NEXT_PUBLIC_LAUNCHTUBE_URL,
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

/** Friendbot funds a new testnet account (~10,000 XLM). No-op if already funded. */
export async function fundWithFriendbot(publicKey: string): Promise<void> {
  const url = `https://friendbot.stellar.org/?addr=${encodeURIComponent(publicKey)}`;
  const res = await fetch(url);
  if (!res.ok && res.status !== 400) {
    // 400 == already funded; anything else is a real error.
    throw new Error(`friendbot funding failed: ${res.status}`);
  }
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

export async function connectPasskey(): Promise<Wallet> {
  // TODO(White belt infra): instantiate passkey-kit here with:
  //   rpcUrl: config.rpcUrl, networkPassphrase, walletWasmHash, factory, launchtube.
  // Then createWallet/connectWallet -> { contractId } and a sponsored sign().
  // See belts/01-white-belt.md. Until configured, getWallet() falls back to dev.
  throw new Error(
    'Passkey infra not configured. Set NEXT_PUBLIC_WALLET_WASM_HASH + NEXT_PUBLIC_LAUNCHTUBE_URL, ' +
      'or use the dev wallet on testnet (default).',
  );
}

// ── helpers ──

function safeLocalGet(k: string): string | null {
  return typeof localStorage !== 'undefined' ? localStorage.getItem(k) : null;
}
function safeLocalSet(k: string, v: string): void {
  if (typeof localStorage !== 'undefined') localStorage.setItem(k, v);
}
