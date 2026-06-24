/**
 * Typed Reputation contract client — the Yellow-belt vouch loop with a CLAIM-SECRET.
 *
 * You vouch by minting a half-card bound to sha256(secret) — WITHOUT knowing the
 * recipient's address. The share link carries the secret; the recipient binds their
 * own address at claim time. This is the cold-start fix (belts/00-strategy §3).
 */
import { invokeAndWait, readContract, readPublic, args, repId } from './contracts';
import type { Wallet } from './wallet';

/** Vouch TTL — claim within this window to refund the voucher's stake (mirrors the
 *  contract's VOUCH_TTL_SECS). After it, the stake is slashed but the card still claims. */
export const VOUCH_TTL_SECS = 604_800; // 7 days

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

/** Mint a half-card. Returns the vouch id AND the secret to embed in the share link. */
export async function mintVouch(
  wallet: Wallet,
  note: string,
): Promise<{ id: number; secret: string }> {
  const secret = randomBytes(32);
  const claimHash = await sha256(secret);
  const id = await invokeAndWait<bigint>(
    repId(),
    'mint_vouch',
    [args.addr(wallet.address), args.bytes(claimHash), args.str(note)],
    wallet,
  );
  return { id: Number(id), secret: toHex(secret) };
}

/** Claim a half-card by presenting the secret from the link. Both sides earn Social XP. */
export async function claimVouch(wallet: Wallet, vouchId: number, secretHex: string): Promise<void> {
  await invokeAndWait(
    repId(),
    'claim_vouch',
    [args.addr(wallet.address), args.u64(vouchId), args.bytes(fromHex(secretHex))],
    wallet,
  );
}

/** Read a half-card by id (no wallet needed — used by the logged-out claim funnel). */
export async function getVouch(vouchId: number): Promise<VouchView | null> {
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
}

/** Wallet-free profile aggregator — both XP tracks in parallel for ANY address
 *  (the public-profile read path; the on-chain get_profile view is a later optimization). */
export async function getScores(address: string): Promise<{ social: number; earned: number }> {
  const [s, e] = await Promise.all([
    readPublic<bigint>(repId(), 'get_score', [args.addr(address)]).catch(() => 0n),
    readPublic<bigint>(repId(), 'get_earned', [args.addr(address)]).catch(() => 0n),
  ]);
  return { social: Number(s ?? 0), earned: Number(e ?? 0) };
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
