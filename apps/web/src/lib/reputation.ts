/**
 * Typed Reputation contract client — the Yellow-belt vouch loop with a CLAIM-SECRET.
 *
 * You vouch by minting a half-card bound to sha256(secret) — WITHOUT knowing the
 * recipient's address. The share link carries the secret; the recipient binds their
 * own address at claim time. This is the cold-start fix (belts/00-strategy §3).
 */
import { invokeAndWait, readContract, args, repId } from './contracts';
import type { Wallet } from './wallet';

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
