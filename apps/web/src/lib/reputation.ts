/**
 * Typed Reputation contract client — the Yellow-belt vouch loop with a CLAIM KEY.
 *
 * You vouch by minting a half-card bound to the public half of a fresh ed25519 key —
 * WITHOUT knowing the recipient's address. The share link carries the key's seed; the
 * recipient binds their own address at claim time by signing it with that seed. This is
 * the cold-start fix (belts/00-strategy §3). The seed never leaves the browser: the claim
 * transaction carries only a signature that names the claimer, so anyone who sees it in
 * flight cannot reuse it for another address (issue #121). Cards minted before the key
 * existed (links with `s=`) still claim with their plain secret.
 */
import { Address, Keypair, hash, nativeToScVal, xdr } from '@stellar/stellar-sdk';
import { buildClaimUrl } from '@alvinmunk/shared';
import { invokeAndWait, readContract, readPublic, args, repId, questId } from './contracts';
import { networkPassphrase } from './stellar';
import { shareInFlight } from './utils';
import type { Wallet } from './wallet';

/** Vouch TTL — claim within this window to refund the voucher's stake (mirrors the
 *  contract's VOUCH_TTL_SECS). After it, the stake is slashed but the card still claims. */
export const VOUCH_TTL_SECS = 604_800; // 7 days

/** The contract's note cap (`MAX_NOTE_BYTES`): `mint_vouch_signed` reverts with `NoteTooLong`
 *  (#12) past it. It counts UTF-8 BYTES, so `ş` costs 2 and most emoji 4. */
export const VOUCH_NOTE_MAX_BYTES = 240;
/** The compose limit in characters (code points). UTF-8 spends at most 4 bytes on one,
 *  so a note within it always fits `VOUCH_NOTE_MAX_BYTES` — 60 Turkish letters or 60
 *  emoji alike. */
export const VOUCH_NOTE_MAX_CHARS = VOUCH_NOTE_MAX_BYTES / 4;

const utf8 = new TextEncoder();

/** UTF-8 length of `s` — what the contract's `String::len` checks against. */
export function vouchNoteBytes(s: string): number {
  return utf8.encode(s).length;
}

/** Cut `input` to a note `mint_vouch_signed` accepts: at most `VOUCH_NOTE_MAX_CHARS` characters
 *  and `VOUCH_NOTE_MAX_BYTES` bytes, never half a character. The character cap binds
 *  first; the byte check is the contract's own rule, kept so the two can never drift. */
export function clampVouchNote(input: string): string {
  let out = '';
  let chars = 0;
  let bytes = 0;
  for (const ch of input) {
    bytes += vouchNoteBytes(ch);
    if (++chars > VOUCH_NOTE_MAX_CHARS || bytes > VOUCH_NOTE_MAX_BYTES) break;
    out += ch;
  }
  return out;
}

/** A half-card as read from chain (the fields the claim funnel surfaces). */
export interface VouchView {
  id: number;
  from: string;
  note: string;
  claimed: boolean;
  claimer: string | null;
  /** ledger unix-seconds when the half-card was minted */
  created: number;
  /** Social XP the voucher escrowed (refunded on a timely claim, else slashed) */
  stake: number;
  slashed: boolean;
}

/** Aggregate profile shape from the on-chain get_profile view. */
export interface ProfileView {
  social: number;
  earned: number;
  verified: boolean;
}

const pendingProfiles = new Map<string, Promise<ProfileView>>();

/** `get_profile(addr)` — single round-trip for social + earned + verified. Widgets that
 *  mount together (profile header + badge row, stat strip + badge row) share one read. */
export function getProfile(address: string): Promise<ProfileView> {
  return shareInFlight(pendingProfiles, address, async () => {
    const p = await readPublic<{ social: bigint; earned: bigint; verified: boolean } | undefined>(
      repId(),
      'get_profile',
      [args.addr(address)],
    );
    return {
      social: Number(p?.social ?? 0),
      earned: Number(p?.earned ?? 0),
      verified: Boolean(p?.verified ?? false),
    };
  });
}

/** How many distinct people vouched for an address, and how many it vouched for. */
export interface PeopleCounts {
  vouchedBy: number;
  backed: number;
}

const pendingCounts = new Map<string, Promise<PeopleCounts | null>>();

/** `get_counts(addr)` — the durable on-chain people counters, `(vouched_by, backed)`.
 *  They only move on a fresh first-pair claim and start at the upgrade that added them,
 *  so older vouches are not in them. Resolves `null` when the read fails — including a
 *  deployed contract that predates the view — so callers never mistake "unknown" for 0.
 *  Concurrent callers (stat strip, hero, badge row) share one read. */
export function getCounts(address: string): Promise<PeopleCounts | null> {
  return shareInFlight(pendingCounts, address, async () => {
    try {
      const c = await readPublic<[number, number] | undefined>(repId(), 'get_counts', [
        args.addr(address),
      ]);
      if (!Array.isArray(c)) return null;
      return { vouchedBy: Number(c[0] ?? 0), backed: Number(c[1] ?? 0) };
    } catch {
      return null;
    }
  });
}

// ── client-side crypto for the claim key ──
function randomBytes(n: number): Uint8Array {
  const a = new Uint8Array(n);
  crypto.getRandomValues(a);
  return a;
}
export function toHex(u8: Uint8Array): string {
  return [...u8].map((b) => b.toString(16).padStart(2, '0')).join('');
}
export function fromHex(hex: string): Uint8Array {
  const m = hex.match(/.{2}/g) ?? [];
  return new Uint8Array(m.map((x) => parseInt(x, 16)));
}

/** True for exactly 32 bytes of hex — a well-formed claim seed or legacy claim secret.
 *  `fromHex` quietly turns junk into zero bytes, so check before signing with a link. */
export function isClaimCode(hex: string): boolean {
  return /^[0-9a-f]{64}$/i.test(hex);
}

/** What a claim link carries: the claim key's seed (`k`, cards from `mint_vouch_signed`)
 *  or, for cards minted before the key existed, the plain claim secret (`s`). */
export interface ClaimCode {
  kind: 'key' | 'secret';
  code: string;
}

/** A card's share link. The code rides in the URL fragment, which the browser never sends
 *  to any server. */
export function claimLink(origin: string, vouchId: number, claim: ClaimCode): string {
  return `${buildClaimUrl(origin, vouchId)}#${claim.kind === 'key' ? 'k' : 's'}=${claim.code}`;
}

/** The claim code in a claim link: `#k=…` or `#s=…` from the fragment, else the `?s=…` query
 *  of links shared before the fragment switch. `null` when the link carries none. */
export function parseClaimCode(hash: string, search: string): ClaimCode | null {
  const fragment = new URLSearchParams(hash.replace(/^#/, ''));
  const seed = fragment.get('k');
  if (seed) return { kind: 'key', code: seed };
  const secret = fragment.get('s') ?? new URLSearchParams(search).get('s');
  return secret ? { kind: 'secret', code: secret } : null;
}

/** Domain tag leading every claim message (the contract's `CLAIM_DOMAIN`). */
export const VOUCH_CLAIM_DOMAIN = 'alvinmunk_vouch_claim';

/**
 * The bytes a card's claim key signs to claim `vouchId` for `claimer`: the XDR of the ScVal
 * vector `[Symbol(VOUCH_CLAIM_DOMAIN), sha256(passphrase), contract, u64 vouchId, claimer]`,
 * byte for byte the contract's `claim_message` (both sides pin the same test vector). Built
 * here, never read from an RPC node: a dishonest node could return the message for ITS
 * address, and the link's key would sign the card over to it.
 */
export function claimMessage(
  passphrase: string,
  contractId: string,
  vouchId: number,
  claimer: string,
): Buffer {
  return xdr.ScVal.scvVec([
    xdr.ScVal.scvSymbol(VOUCH_CLAIM_DOMAIN),
    xdr.ScVal.scvBytes(hash(passphrase)),
    new Address(contractId).toScVal(),
    nativeToScVal(vouchId, { type: 'u64' }),
    new Address(claimer).toScVal(),
  ]).toXDR();
}

/** The ed25519 key behind a link's 32-byte claim seed. */
function claimKeypair(seed: Uint8Array): Keypair {
  return Keypair.fromRawEd25519Seed(seed as Buffer);
}

/** The public claim key `mint_vouch_signed` stores for a seed. */
export function claimPublicKey(seed: Uint8Array): Uint8Array {
  return new Uint8Array(claimKeypair(seed).rawPublicKey());
}

/** The seed's signature over `claimMessage` — what `claim_vouch_signed` verifies. */
export function signClaim(
  seed: Uint8Array,
  passphrase: string,
  contractId: string,
  vouchId: number,
  claimer: string,
): Uint8Array {
  const message = claimMessage(passphrase, contractId, vouchId, claimer);
  return new Uint8Array(claimKeypair(seed).sign(message));
}

/** Mint a half-card bound to a fresh claim key. Returns the vouch id AND the key's seed
 *  (hex) to embed in the share link — the only copy; the chain holds the public half. */
export async function mintVouch(
  wallet: Wallet,
  note: string,
): Promise<{ id: number; seed: string }> {
  const seed = randomBytes(32);
  const id = await invokeAndWait<bigint>(
    repId(),
    'mint_vouch_signed',
    [args.addr(wallet.address), args.bytes(claimPublicKey(seed)), args.str(note)],
    wallet,
  );
  return { id: Number(id), seed: toHex(seed) };
}

/** Claim a half-card by signing the claim for this wallet with the seed from the link.
 *  The seed stays here; the transaction carries only the signature, which is worthless
 *  for any other claimer, card, contract or network. Both sides earn Social XP. */
export async function claimVouchSigned(wallet: Wallet, vouchId: number, seedHex: string): Promise<void> {
  const sig = signClaim(fromHex(seedHex), networkPassphrase, repId(), vouchId, wallet.address);
  await invokeAndWait(
    repId(),
    'claim_vouch_signed',
    [args.addr(wallet.address), args.u64(vouchId), args.bytes(sig)],
    wallet,
  );
}

/** LEGACY: claim a card minted with a claim hash (links with `s=`) by presenting its secret.
 *  The secret is a plain transaction argument, so these older cards stay front-runnable;
 *  new cards use `mintVouch` + `claimVouchSigned`. Both sides earn Social XP. */
export async function claimVouch(wallet: Wallet, vouchId: number, secretHex: string): Promise<void> {
  await invokeAndWait(
    repId(),
    'claim_vouch',
    [args.addr(wallet.address), args.u64(vouchId), args.bytes(fromHex(secretHex))],
    wallet,
  );
}

const pendingVouches = new Map<string, Promise<VouchView | null>>();

/** Read a half-card by id (no wallet needed — used by the logged-out claim funnel).
 *  Dashboard cards that scan the same stored vouches at once share each read. */
export function getVouch(vouchId: number): Promise<VouchView | null> {
  return shareInFlight(pendingVouches, String(vouchId), async () => {
    const v = await readPublic<{
      id: bigint;
      from: string;
      note: string;
      claimed: boolean;
      claimer: string | null;
      created: bigint;
      stake: bigint;
      slashed: boolean;
    } | null>(repId(), 'get_vouch', [args.u64(vouchId)]);
    if (!v) return null;
    return {
      id: Number(v.id),
      from: v.from,
      note: v.note,
      claimed: v.claimed,
      claimer: v.claimer ?? null,
      created: Number(v.created),
      stake: Number(v.stake),
      slashed: v.slashed,
    };
  });
}

/** A 2nd-order voucher bonus queued on a claimer — mirror of the contract's PendingBonus. */
export interface PendingBonusView {
  voucher: string;
  /** Social XP, paid to `voucher` on the claimer's first verified action */
  amount: number;
}

/** `get_pending(claimer)` — the voucher bonuses waiting on `claimer`'s first verified
 *  (Earned) action, oldest first; empty once they verify. Rejects when the read fails —
 *  including a deployed contract that predates the view — so "unknown" never reads as
 *  "nothing owed". */
export async function getPending(claimer: string): Promise<PendingBonusView[]> {
  const list = await readPublic<Array<{ voucher: string; amount: bigint }> | undefined>(
    repId(),
    'get_pending',
    [args.addr(claimer)],
  );
  return (list ?? []).map((p) => ({ voucher: String(p.voucher), amount: Number(p.amount) }));
}

/** Wallet-free profile aggregator — social + earned for ANY address. Prefers the
 *  single-call get_profile view; falls back to the two parallel legacy calls if
 *  the deployed contract predates get_profile. */
export async function getScores(address: string): Promise<{ social: number; earned: number }> {
  try {
    const p = await getProfile(address);
    return { social: p.social, earned: p.earned };
  } catch {
    const [s, e] = await Promise.all([
      readPublic<bigint>(repId(), 'get_score', [args.addr(address)]).catch(() => 0n),
      readPublic<bigint>(repId(), 'get_earned', [args.addr(address)]).catch(() => 0n),
    ]);
    return { social: Number(s ?? 0), earned: Number(e ?? 0) };
  }
}

/** `get_score(addr)` — Social XP (leaderboard, non-cashable). */
export async function getSocialScore(addr: string, source: string): Promise<number> {
  const v = await readContract<bigint>(repId(), 'get_score', [args.addr(addr)], source);
  return Number(v ?? 0);
}

/** `get_earned(addr)` — Earned XP (the only USDC-eligible track). */
export async function getEarnedScore(addr: string, source: string): Promise<number> {
  const v = await readContract<bigint>(repId(), 'get_earned', [args.addr(addr)], source);
  return Number(v ?? 0);
}

/** `get_attestation(addr)` — Read completed quest attestations for an address. */
export async function getAttestation(addr: string): Promise<number> {
  try {
    const v = await readPublic<bigint>(questId(), 'get_completed', [args.addr(addr)]);
    return Number(v ?? 0);
  } catch {
    return 0;
  }
}
