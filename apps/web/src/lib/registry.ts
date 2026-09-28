/**
 * Username registry client — on-chain handle ↔ address. Turns @handle into a public,
 * shareable identity that resolves for ANY wallet (not just the logged-in user).
 * Validate/normalize the handle with normalizeHandle() BEFORE calling claim.
 */
import { invokeAndWait, readPublic, args, registryId } from './contracts';
import { Address, nativeToScVal } from '@stellar/stellar-sdk';
import type { Wallet } from './wallet';

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
