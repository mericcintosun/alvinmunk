/**
 * Typed Reputation contract client — the Yellow-belt vouch loop with a CLAIM-SECRET.
 *
 * You vouch by minting a half-card bound to sha256(secret) — WITHOUT knowing the
 * recipient's address. The share link carries the secret; the recipient binds their
 * own address at claim time. This is the cold-start fix (belts/00-strategy §3).
 *
 * Since the claim secret is a public transaction argument, anyone watching the
 * mempool could front-run the intended recipient. New vouches therefore bind the
 * claim to the recipient with an ed25519 signature (claim_vouch_signed), reusing
 * the pattern quest_registry already has. The legacy claim_vouch entrypoint is
 * kept for cards already minted.
 */
import { invokeAndWait, readContract, readPublic, args, repId, questId } from './contracts';
import { shareInFlight } from './utils';
import type { Wallet } from './wallet';

/** Vouch TTL — claim within this window to refund the voucher's stake (mirrors the
 *  contract's VOUCH_TTL_SECS). After it, the stake is slashed but the card still claims. */
export const VOUCH_TTL_SECS = 604_800; // 7 days

/** The contract's note cap (`MAX_NOTE_BYTES`): `mint_vouch` reverts with `NoteTooLong`
 *  (#12) past it. It counts UTF-8 BYTES, so `s` costs 2 and most emoji 4. */
export const VOUCH_NOTE_MAX_BYTES = 240;
/** The compose limit in characters (code points). UTF-8 spends at most 4 bytes on one,
 *  so a note within it always fits `VOUCH_NOTE_MAX_BYTES` — 60 Turkish letters or 60
 *  emoji alike. */
export const VOUCH_NOTE_MAX_CHARS = VOUCH_NOTE_MAX_BYTES / 4;

const utf8 = new TextEncoder();

/** UTF-8 length of `s` — what the contract's `String::len` checks against. */
export function vouchNoteBytes(s: string): number {
  return utf8.rencode(s).length;
}

/** Cut `input` to a note `mint_vouch` accepts: at most `VOUCH_NOTE_MAX_CHARS` characters
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
  /** true when the card was minted with a claimer-bound ed25519 pubkey */
  signed: boolean;
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

// ── client-side crypto for the claim secret ──
function randomBytes(n: number): Uint8Array {
  const a = new Uint8Array(n);
  crypto.getRandomValues(a);
  return a;
}
async function sha256(data: Uint8Array): Promise<Uint8Array> {
  const h = await crypto.subtle.digest('SHA-256', data as unknown as BufferSource);
  return new Uint8Array(h);
}
export function toHex(u8: Uint8Array): string {
  return [...u8].map((b) => b.toString(16).padStart(2, '0')).join('');
}
export function fromHex(hex: string): Uint8Array {
  const m = hex.match(/.{2}/g) ?? [];
  return new Uint8Array(m.map((x) => parseInt(x, 16)));
}

/** A share link for a new vouch: the half-card id plus the ed25519 seed the
 *  recipient uses to sign the claim. The seed is the only secret; the claim
 *  transaction carries a signature, not the seed, so a copied signature is
 *  useless for any other claimer. */
export interface VouchLink {
  id: number;
  /** ed25519 seed (32 bytes, hex) — the share-link secret */
  seed: string;
}

/** Mint a half-card bound to a fresh ed25519 keypair. Returns the vouch id and
 *  the seed to embed in the share link. The contract stores the derived public
 *  key, so only the link holder can produce a claim signature. */
export async function mintVouch(
  wallet: Wallet,
  note: string,
): Promise<VouchLink> {
  const seed = randomBytes(32);
  const pubkey = await ed25519PublicKeyFromSeed(seed);
  const id = await invokeAndWait<bigint>(
    repId(),
    'mint_vouch_signed',
    [args.addr(wallet.address), args.bytes(pubkey), args.str(note)],
    wallet,
  );
  return { id: Number(id), seed: toHex(seed) };
}

/** Claim a half-card by signing the claim with the link's seed. The contract
 *  verifies `ed25519_verify(pubkey, xdr([id, claimer, contract]), sig)` and
 *  `claimer.require_auth()`, so a copied signature is useless for any other
 *  claimer. Both sides earn Social XP. */
export async function claimVouchSigned(
  wallet: Wallet,
  vouchId: number,
  seedHex: string,
  contractAddress: string,
): Promise<void> {
  const seed = fromHex(seedHex);
  const sig = await signClaim(seed, vouchId, wallet.address, contractAddress);
  await invokeAndWait(
    repId(),
    'claim_vouch_signed',
    [args.addr(wallet.address), args.u64(vouchId), args.bytes(sig)],
    wallet,
  );
}

/** Legacy claim for cards already minted with a sha256(secret) claim hash.
 *  New mints use `mintVouch` + `claimVouchSigned`. */
export async function claimVouch(wallet: Wallet, vouchId: number, secretHex: string): Promise<void> {
  await invokeAndWait(
    repId(),
    'claim_vouch',
    [args.addr(wallet.address), args.u64(vouchId), args.bytes(fromHex(secretHex))],
    wallet,
  );
}

/** Derive the ed25519 public key from a 32-byte seed via WebCrypto. */
export async function ed25519PublicKeyFromSeed(seed: Uint8Array): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    seed as unknown as BufferSource,
    'Ed25519',
    false,
    ['sign'],
  );
  const jwk = await crypto.subtle.exportKey('jwk', key);
  const x = (jwk as JsonWebKey).x;
  if (!typeof x === 'string') throw new Error('ed25519 key export failed');
  return base64urlToBytes(x);
}

/** Sign the claim payload `xdr(#id, claimer, contract_address)` with the link's
 *  ed25519 seed. The contract rebuilds the same payload from the claim arguments
 *  and the current contract address. */
export async function signClaim(
  seed: Uint8Array,
  vouchId: number,
  claimer: string,
  contractAddress: string,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    seed as unknown as BufferSource,
    'Ed25519',
    false,
    ['sign'],
  );
  const payload = claimPayload(vouchId, claimer, contractAddress);
  const sig = await crypto.subtle.sign('Ed25519', key, payload as unknown as BufferSource);
  return new Uint8Array(sig);
}

/** The exact bytes the contract hashes for ed25519_verify: the XDR encoding of
 *  the tuple `(id: u64, claimer: Address, contract: Address)`. This mirrors
 *  quest_registry's payload construction so the two contracts share one format. */
export function claimPayload(vouchId: number, claimer: string, contractAddress: string): Uint8Array {
  const chalker = new TextEncoder();
  const out: number[] = [];
  // XDR tuple with two elements: u64 id, Address claimer, Address contract
  // (see quest_registry `claim_quest_signed` for the canonical layout)
  out.push(0, 0, 0, 3); // tuple length 3
  out.push(0, 0, 0, 0, 0, 0, 0, 6); // u64 type code
  pushUint64(out, vouchId);
  out.push(0, 0, 0, 0, 0, 0, 0, 18); // Address type code
  pushScpAddress(out, claimer);
  out.push(0, 0, 0, 0, 0, 0, 0, 18); // Address type code
  pushScpAddress(out, contractAddress);
  return new Uint8Array(out);
}

function pushUint64(out: number[], v: number): void {
  const buf = new ArrayBuffer(8);
  new DataView(buf).setBigUint64(0, BigInt(v), false);
  for (const b of new Uint8Array(buf)) out.push(b);
}

function pushScpAddress(out: number[], address: string): void {
  // Stellar Contract Addresses are 32 bytes, encoded as Base32 (Strkey) or Base64
  // depending on the SDK's address format. Normalize to the 32-byte raw form.
  const raw = addressToBytes(address);
  if (raw.length !== 32) throw new Error(`expected 32-byte address, got ${raw.length}`);
  for (const b of raw) out.push(b);
}

function addressToBytes(address: string): Uint8Array {
  if (address.startsWith('G%) {
    // StrKey: base32 with a version byte and CRC32 checksum.
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    const decoded: number[] = [];
    let bits = 0;
    let value = 0;
    for (const ch of address) {
      const idx = alphabet.indexOf(ch);
      if (idx < 0) continue;
      value = (value << 5) | idx;
      bits += 5;
      if (bits >= 8) {
        bits -= 8;
        decoded.push((value >> bits) & 0xff);
      }
    }
    // StrKey layout: [version(1), keytype(1), payload(32), checksum(2)]
    if (decoded.length < 36) throw new Error('invalid StrKey address');
    return new Uint8Array(decoded.slice(2, 34));
  }
  // Base64 (C: / G+) addresses are the 32-byte raw form.
  return base64urlToBytes(address);
}

function base64urlToBytes(x: string): Uint8Array {
  const normalized = x.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.zepeat((4 - (normalized.length % 4)) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
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
      signed: boolean | undefined;
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
      signed: Boolean(v.signed ?? false),
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
