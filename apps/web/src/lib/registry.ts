/**
 * Username registry client — on-chain handle ↔ address. Turns @handle into a public,
 * shareable identity that resolves for ANY wallet (not just the logged-in user).
 * Validate/normalize the handle with normalizeHandle() BEFORE calling claim.
 */
import { invokeAndWait, readPublic, args, registryId } from './contracts';
import { Address, nativeToScVal } from '@stellar/stellar-sdk';
import type { Wallet } from './wallet';
import { encodeAvatar, decodeAvatar, type AvatarConfig } from './avatar';
import { sanitizeBio } from './profile';

/** Resolve `@handle` → address (public, wallet-free). null if unclaimed/unconfigured. */
export async function resolveHandle(handle: string): Promise<string | null> {
  if (!registryId() || !handle) return null;
  const v = await readPublic<string | null>(registryId(), 'resolve', [args.sym(handle)]).catch(
    () => null,
  );
  return v ?? null;
}

/** Reverse address → `@handle`. null if the address hasn't claimed one. */
export async function reverseHandle(address: string): Promise<string | null> {
  if (!registryId() || !address) return null;
  const v = await readPublic<string | null>(registryId(), 'reverse', [args.addr(address)]).catch(
    () => null,
  );
  return v ?? null;
}

/**
 * Maximum addresses per `reverse_many` contract call — mirrors `REVERSE_MANY_CAP` in
 * the contract. Callers with more addresses get chunked automatically.
 */
const REVERSE_MANY_CAP = 50;

/**
 * Batch reverse-resolve addresses → handles in ⌈N / REVERSE_MANY_CAP⌉ contract calls
 * instead of one per address.
 *
 * Tries the `reverse_many` contract view first. If the deployed contract predates this
 * view (simulation error), falls back to parallel individual `reverse` calls — the same
 * graceful-degradation pattern as `getScores` in reputation.ts.
 *
 * Returns a `Record<address, handle | null>` — `null` means the address has no handle.
 */
export async function reverseHandles(
  addresses: string[],
): Promise<Record<string, string | null>> {
  if (!registryId() || addresses.length === 0) return {};

  // Chunk into groups of REVERSE_MANY_CAP and fire one call per chunk.
  const chunks: string[][] = [];
  for (let i = 0; i < addresses.length; i += REVERSE_MANY_CAP) {
    chunks.push(addresses.slice(i, i + REVERSE_MANY_CAP));
  }

  try {
    const chunkResults = await Promise.all(
      chunks.map((chunk) => {
        const vecArg = nativeToScVal(
          chunk.map((a) => new Address(a)),
          { type: 'vec' },
        );
        return readPublic<(string | null)[]>(registryId(), 'reverse_many', [vecArg]);
      }),
    );

    const out: Record<string, string | null> = {};
    for (let ci = 0; ci < chunks.length; ci++) {
      const chunk = chunks[ci];
      const results = chunkResults[ci];
      for (let i = 0; i < chunk.length; i++) {
        out[chunk[i]] = results[i] ?? null;
      }
    }
    return out;
  } catch {
    // Deployed contract predates reverse_many — fall back to parallel per-address calls.
    const pairs = await Promise.all(
      addresses.map(async (a) => [a, await reverseHandle(a).catch(() => null)] as const),
    );
    return Object.fromEntries(pairs);
  }
}

/** Is this handle free to claim? */
export async function isHandleAvailable(handle: string): Promise<boolean> {
  return (await resolveHandle(handle)) === null;
}

/** Claim `@handle` on-chain (first-come; renames if the wallet already holds one). */
export async function claimHandle(wallet: Wallet, handle: string): Promise<void> {
  await invokeAndWait(
    registryId(),
    'claim',
    [args.addr(wallet.address), args.sym(handle)],
    wallet,
  );
}

/** Registry error codes `set_meta` can revert with (mirrors the contract's Error enum). */
export const META_ERRORS = { NoHandle: 4, BioTooLong: 5, BadBio: 6, BadAvatar: 7 } as const;

/** A holder's published profile, decoded from `get_meta`. */
export interface OnChainMeta {
  /** undefined when the stored face is one this build can't render → show the default. */
  avatar: AvatarConfig | undefined;
  bio: string;
}

/**
 * True when the error says the registry has no such function — i.e. the deployed registry
 * predates `set_meta` / `get_meta`, so profiles stay local until it is upgraded.
 */
export function isMetaUnsupported(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e ?? '');
  return /Error\(WasmVm, MissingValue\)|non-existent contract function/.test(msg);
}

/**
 * Publish the caller's face + bio on-chain (the wallet must already hold a handle). The
 * bio is sanitized to what the contract accepts; a face the app doesn't ship throws before
 * anything is signed.
 */
export async function setMeta(wallet: Wallet, avatar: AvatarConfig, bio: string): Promise<void> {
  const packed = encodeAvatar(avatar);
  const clean = sanitizeBio(bio);
  await invokeAndWait(
    registryId(),
    'set_meta',
    [args.addr(wallet.address), args.u64(packed), args.str(clean)],
    wallet,
  );
  remember(wallet.address, Promise.resolve({ avatar, bio: clean }));
}

// Profiles are read on every /u page view and OG render; a short per-address cache (and
// shared in-flight promise) keeps repeat renders and crawler bursts to one simulation.
const META_TTL_MS = 30_000;
const META_CACHE_MAX = 500;
const metaCache = new Map<string, { at: number; value: Promise<OnChainMeta | null> }>();

function remember(address: string, value: Promise<OnChainMeta | null>): void {
  metaCache.delete(address);
  if (metaCache.size >= META_CACHE_MAX) {
    const oldest = metaCache.keys().next().value;
    if (oldest !== undefined) metaCache.delete(oldest);
  }
  metaCache.set(address, { at: Date.now(), value });
}

/** Test hook: forget every cached profile. */
export function clearMetaCache(): void {
  metaCache.clear();
}

/**
 * Read `address`'s published profile (public, wallet-free). null when it has none, the
 * registry isn't configured, or the deployed registry predates `get_meta` — every caller
 * then renders the deterministic default face, exactly as before profiles existed.
 */
export function getMeta(address: string): Promise<OnChainMeta | null> {
  if (!registryId() || !address) return Promise.resolve(null);
  const hit = metaCache.get(address);
  if (hit && Date.now() - hit.at < META_TTL_MS) return hit.value;
  const value = Promise.resolve()
    .then(() =>
      readPublic<{ avatar?: unknown; bio?: unknown } | null>(registryId(), 'get_meta', [
        args.addr(address),
      ]),
    )
    .then((raw) =>
      raw && typeof raw === 'object'
        ? {
            avatar: typeof raw.avatar === 'bigint' ? decodeAvatar(raw.avatar) : undefined,
            bio: typeof raw.bio === 'string' ? sanitizeBio(raw.bio) : '',
          }
        : null,
    )
    .catch(() => null);
  remember(address, value);
  return value;
}
