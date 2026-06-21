/**
 * Typed Reputation contract client — the Yellow-belt vouch loop.
 * mintVouch -> shareable link -> claimVouch (both earn Social XP, first-pair-only).
 */
import { invokeAndWait, readContract, args, repId } from './contracts';
import type { Wallet } from './wallet';

/** `mint_vouch(from, to, note)` -> vouch id. Signed by the voucher. */
export async function mintVouch(
  wallet: Wallet,
  to: string,
  note: string,
): Promise<number> {
  const id = await invokeAndWait<bigint>(
    repId(),
    'mint_vouch',
    [args.addr(wallet.address), args.addr(to), args.str(note)],
    wallet,
  );
  return Number(id);
}

/** `claim_vouch(to, vouch_id)`. Signed by the recipient. Both sides earn Social XP. */
export async function claimVouch(wallet: Wallet, vouchId: number): Promise<void> {
  await invokeAndWait(
    repId(),
    'claim_vouch',
    [args.addr(wallet.address), args.u64(vouchId)],
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
