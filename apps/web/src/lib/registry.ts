/**
 * Username registry client — on-chain handle ↔ address. Turns @handle into a public,
 * shareable identity that resolves for ANY wallet (not just the logged-in user).
 * Validate/normalize the handle with normalizeHandle() BEFORE calling claim.
 */
import { invokeAndWait, readPublic, args, registryId } from './contracts';
import type { Wallet } from './wallet';
import { encodeAvatar, decodeAvatar, type AvatarConfig } from './avatar';
import { sanitizeBio } from './profile';
import { shareInFlight } from './utils';

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

/** Most addresses per `reverse_many` call; mirrors `REVERSE_MANY_CAP` in the contract. */
const REVERSE_MANY_CAP = 50;

const pendingReverse = new Map<string, Promise<(string | null)[]>>();

/**
 * Batched `reverseHandle`: address → `@handle` for every distinct input address, in
 * ⌈N / REVERSE_MANY_CAP⌉ `reverse_many` simulations instead of N `reverse` ones. Every
 * input address gets an entry (null = no handle, or it couldn't be read), so a caller that
 * merges the result into its label map never asks again for the same address.
 */
export async function reverseHandles(addresses: string[]): Promise<Record<string, string | null>> {
  const unique = [...new Set(addresses)];
  const out: Record<string, string | null> = Object.fromEntries(unique.map((a) => [a, null]));
  if (!registryId()) return out;
  // sorted, so a re-render that reorders the same rows asks for the same chunks
  const todo = unique.filter(Boolean).sort();
  const chunks: string[][] = [];
  for (let i = 0; i < todo.length; i += REVERSE_MANY_CAP) {
    chunks.push(todo.slice(i, i + REVERSE_MANY_CAP));
  }
  await Promise.all(
    chunks.map(async (chunk) => {
      const handles = await reverseChunk(chunk);
      for (let i = 0; i < chunk.length; i++) out[chunk[i]] = handles[i];
    }),
  );
  return out;
}

/**
 * One `reverse_many` read for up to REVERSE_MANY_CAP addresses; a list view re-rendering
 * mid-read shares it. A registry that predates the view gets one `reverse` per address
 * instead; any other failure leaves the chunk unlabelled, as a failed `reverseHandle` would.
 */
function reverseChunk(chunk: string[]): Promise<(string | null)[]> {
  return shareInFlight(pendingReverse, chunk.join(','), async () => {
    try {
      const v = await readPublic<unknown>(registryId(), 'reverse_many', [args.addrs(chunk)]);
      if (!Array.isArray(v) || v.length !== chunk.length) return chunk.map(() => null);
      return v.map((h) => (typeof h === 'string' ? h : null));
    } catch (e) {
      if (!isMissingFunction(e)) return chunk.map(() => null);
      return Promise.all(chunk.map((a) => reverseHandle(a).catch(() => null)));
    }
  });
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

/** Registry error codes `set_inviter` can revert with (mirrors the contract's Error enum). */
export const INVITE_ERRORS = { NoHandle: 4, SelfInvite: 9, AlreadyInvited: 10 } as const;

/**
 * Bind, once, that `wallet` was invited by `inviterAddress` (the one-shot on-chain invite
 * graph edge). `inviterAddress` must be a registered address (a C… passkey contract
 * included); the wallet itself needs no handle. Fire-and-forget by design — callers pass
 * `{ quiet: true }` so a taken binding (returning user re-onboarding, or a stale ref)
 * never blocks or spoils an otherwise-successful onboarding.
 */
export async function setInviter(
  wallet: Wallet,
  inviterAddress: string,
  { quiet = false }: { quiet?: boolean } = {},
): Promise<void> {
  try {
    await invokeAndWait(
      registryId(),
      'set_inviter',
      [args.addr(wallet.address), args.addr(inviterAddress)],
      wallet,
    );
  } catch (e) {
    if (quiet) return; // the binding is best-effort; onboarding continues either way
    throw e;
  }
}

/**
 * Who invited `address` (public, wallet-free), or null while unbound — also null when the
 * deployed registry predates `invited_by` (treat a failed read as "no binding").
 */
export async function getInvitedBy(address: string): Promise<string | null> {
  if (!registryId() || !address) return null;
  const v = await readPublic<string | null>(registryId(), 'invited_by', [args.addr(address)]).catch(
    () => null,
  );
  return v ?? null;
}

/** Registry error codes `set_meta` can revert with (mirrors the contract's Error enum). */
export const META_ERRORS = { NoHandle: 4, BioTooLong: 5, BadBio: 6, BadAvatar: 7 } as const;

/** A holder's published profile, decoded from `get_meta`. */
export interface OnChainMeta {
  /** undefined when the stored face is one this build can't render → show the default. */
  avatar: AvatarConfig | undefined;
  bio: string;
}

/** True when the error says the deployed registry has no such function (it predates it). */
function isMissingFunction(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e ?? '');
  return /Error\(WasmVm, MissingValue\)|non-existent contract function/.test(msg);
}

/**
 * True when the error says the registry has no such function — i.e. the deployed registry
 * predates `set_meta` / `get_meta`, so profiles stay local until it is upgraded.
 */
export function isMetaUnsupported(e: unknown): boolean {
  return isMissingFunction(e);
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
