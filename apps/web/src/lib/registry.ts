/**
 * Username registry client — on-chain handle ↔ address. Turns @handle into a public,
 * shareable identity that resolves for ANY wallet (not just the logged-in user).
 * Validate/normalize the handle with normalizeHandle() BEFORE calling claim.
 */
import { invokeAndWait, readPublic, args, registryId } from './contracts';
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
