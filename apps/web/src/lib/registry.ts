/**
 * Username registry client — on-chain handle ↔ address. Turns @handle into a public,
 * shareable identity that resolves for ANY wallet (not just the logged-in user).
 * Validate/normalize the handle with normalizeHandle() BEFORE calling claim.
 */
import { isMissingFunction } from '@alvinmunk/sdk';
import { invokeAndWait, invokeCosigned, readPublic, args, registryId } from './contracts';
import { readClient } from './sdk';
import type { ReadNetwork } from './read-network';
import type { Wallet } from './wallet';
import { encodeAvatar, decodeAvatar, type AvatarConfig } from './avatar';
import { sanitizeBio } from './profile';
import { shareInFlight } from './utils';

/** The registry to read: `net`'s (the ?network= override) or the deployment's. */
const registryOf = (net?: ReadNetwork | null) => (net ? net.contracts.registry : registryId());

/** What a registry handle can be at all: a Soroban `Symbol` (`[A-Za-z0-9_]`, at most 32). */
const SYMBOL = /^[A-Za-z0-9_]{1,32}$/;

/**
 * Resolve `@handle` → address (public, wallet-free). null when nobody holds it, when no
 * registry is configured, or when `handle` can never be one (no read then). A read that
 * FAILS rejects instead (#188): an RPC outage must never pass for a free handle.
 */
export async function resolveHandle(handle: string, net?: ReadNetwork | null): Promise<string | null> {
  if (!registryOf(net) || !SYMBOL.test(handle)) return null;
  return (net?.client ?? readClient()).resolveHandle(handle);
}

/**
 * Reverse address → `@handle`. null if the address hasn't claimed one — or, unless `strict`,
 * if the registry couldn't be read. A caller about to CLAIM passes `strict` so a failed read
 * throws instead: claiming renames the address's existing handle.
 */
export async function reverseHandle(
  address: string,
  { strict = false, net }: { strict?: boolean; net?: ReadNetwork | null } = {},
): Promise<string | null> {
  if (!registryOf(net) || !address) return null;
  const read = (net?.client ?? readClient()).reverseHandle(address);
  return strict ? read : read.catch(() => null);
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
export async function reverseHandles(
  addresses: string[],
  net?: ReadNetwork | null,
): Promise<Record<string, string | null>> {
  const unique = [...new Set(addresses)];
  const out: Record<string, string | null> = Object.fromEntries(unique.map((a) => [a, null]));
  if (!registryOf(net)) return out;
  // sorted, so a re-render that reorders the same rows asks for the same chunks
  const todo = unique.filter(Boolean).sort();
  const chunks: string[][] = [];
  for (let i = 0; i < todo.length; i += REVERSE_MANY_CAP) {
    chunks.push(todo.slice(i, i + REVERSE_MANY_CAP));
  }
  await Promise.all(
    chunks.map(async (chunk) => {
      const handles = await reverseChunk(chunk, net);
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
function reverseChunk(chunk: string[], net?: ReadNetwork | null): Promise<(string | null)[]> {
  return shareInFlight(pendingReverse, `${net?.network ?? ''}|${chunk.join(',')}`, async () => {
    try {
      const v = await readPublic<unknown>(registryOf(net), 'reverse_many', [args.addrs(chunk)], net);
      if (!Array.isArray(v) || v.length !== chunk.length) return chunk.map(() => null);
      return v.map((h) => (typeof h === 'string' ? h : null));
    } catch (e) {
      if (!isMissingFunction(e)) return chunk.map(() => null);
      return Promise.all(chunk.map((a) => reverseHandle(a, { net }).catch(() => null)));
    }
  });
}

/** A freed handle held back for the wallet that freed it (the registry's `cooldown` view). */
export interface HandleCooldown {
  /** The wallet that released it or renamed away; it may take it back any time. */
  prevOwner: string;
  /** When anyone may claim it (ledger time). */
  until: Date;
}

/**
 * The cooldown `handle` is in, or null: none running, the registry isn't configured, or it
 * predates cooldowns (nothing is reserved there, so null is the true answer too).
 */
export async function getHandleCooldown(handle: string): Promise<HandleCooldown | null> {
  if (!registryId() || !handle) return null;
  const raw = await readPublic<{ prev_owner?: unknown; until?: unknown } | null>(
    registryId(),
    'cooldown',
    [args.sym(handle)],
  ).catch(() => null);
  if (!raw || typeof raw.prev_owner !== 'string' || typeof raw.until !== 'bigint') return null;
  return { prevOwner: raw.prev_owner, until: new Date(Number(raw.until) * 1000) };
}

/** Whether a handle can be claimed; `reserved` = cooling down for the wallet that freed it. */
export type HandleAvailability =
  | { status: 'free' }
  | { status: 'taken' }
  | { status: 'reserved'; until: Date };

/**
 * Can `address` (anyone, when omitted) claim `handle`? Taken while someone holds it;
 * reserved while it cools down after its holder released it or renamed away, except for
 * that previous holder, who may take it back any time. Rejects when the holder can't be
 * read, so a caller shows "couldn't check" rather than "free".
 */
export async function handleAvailability(
  handle: string,
  address?: string,
): Promise<HandleAvailability> {
  const [owner, cooldown] = await Promise.all([resolveHandle(handle), getHandleCooldown(handle)]);
  if (owner !== null) {
    // If the handle is owned by the checking address, it's available for them to reclaim
    if (owner === address) return { status: 'free' };
    return { status: 'taken' };
  }
  if (cooldown && cooldown.prevOwner !== address) {
    return { status: 'reserved', until: cooldown.until };
  }
  return { status: 'free' };
}

/** Is this handle free for `address` (anyone, when omitted) to claim? */
export async function isHandleAvailable(handle: string, address?: string): Promise<boolean> {
  return (await handleAvailability(handle, address)).status === 'free';
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

/** Registry error codes `transfer_handle` can revert with (mirrors the contract's Error enum). */
export const TRANSFER_ERRORS = { NoHandle: 4, AlreadyHasHandle: 10 } as const;

/**
 * Move `from`'s @handle, with its published face and bio, to `to` in ONE transaction — the
 * handle is never free in between, as it would be with a release and a fresh claim. The
 * registry wants both wallets' signatures, so one of them must hold its key in this browser
 * (the dev wallet) and co-sign, while the other submits the call with its usual prompt.
 * Social and Earned XP don't move: the reputation contract keys them by address. Resolves
 * the transaction hash.
 */
export async function transferHandle(from: Wallet, to: Wallet): Promise<string> {
  const [submitter, cosigner] = from.signAuthEntry ? [to, from] : [from, to];
  const { hash } = await invokeCosigned(
    registryId(),
    'transfer_handle',
    [args.addr(from.address), args.addr(to.address)],
    submitter,
    cosigner,
  );
  // the profile moved with the handle: read both addresses fresh next time
  metaCache.delete(from.address);
  metaCache.delete(to.address);
  return hash;
}

/**
 * Bind, once, that `wallet` was invited by `inviterAddress` (the one-shot on-chain invite
 * graph edge). `inviterAddress` must currently hold a handle; the wallet itself needs no
 * handle. Throws on any contract error — callers decide whether to surface it or swallow it.
 */
export async function setInviter(wallet: Wallet, inviterAddress: string): Promise<void> {
  await invokeAndWait(
    registryId(),
    'set_inviter',
    [args.addr(wallet.address), args.addr(inviterAddress)],
    wallet,
  );
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
export function getMeta(address: string, net?: ReadNetwork | null): Promise<OnChainMeta | null> {
  if (!registryOf(net) || !address) return Promise.resolve(null);
  // One address can hold a profile on each network: never serve one network's from the other's.
  const key = net ? `${net.network}|${address}` : address;
  const hit = metaCache.get(key);
  if (hit && Date.now() - hit.at < META_TTL_MS) return hit.value;
  const value = Promise.resolve()
    .then(() =>
      readPublic<{ avatar?: unknown; bio?: unknown } | null>(
        registryOf(net),
        'get_meta',
        [args.addr(address)],
        net,
      ),
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
  remember(key, value);
  return value;
}
