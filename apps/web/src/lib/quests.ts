/**
 * Quest client. To claim a verified quest, the wallet owner signs a canonical
 * message proving ownership of the recipient address; the serverless attester
 * verifies that + the evidence, then grants Earned XP on-chain. The private
 * attester key never touches the client (belts/08 security).
 */
import { readContract, args, questId as questRegistryId } from './contracts';
import type { Wallet } from './wallet';

export interface QuestResult {
  ok: boolean;
  hash?: string;
  error?: string;
}

/** Weekly retention streak (Green belt) — consecutive weeks with a completed quest. */
export interface Streak {
  weeks: number;
  best: number;
  lastWeek: number;
}

/** Read a player's weekly streak from the QuestRegistry. */
export async function getStreak(addr: string, source: string): Promise<Streak> {
  const v = await readContract<{ weeks: number; best: number; last_week: bigint }>(
    questRegistryId(),
    'get_streak',
    [args.addr(addr)],
    source,
  );
  return {
    weeks: Number(v?.weeks ?? 0),
    best: Number(v?.best ?? 0),
    lastWeek: Number(v?.last_week ?? 0),
  };
}

export type Evidence = { type: 'github_pr' | 'referral_tx'; ref: string };

export async function completeQuest(
  wallet: Wallet,
  questId: number,
  evidence: Evidence,
): Promise<QuestResult> {
  const timestamp = Date.now();
  // MUST match the server's ownershipMessage() exactly.
  const message = `attest:v1:${wallet.address}:${questId}:${evidence.type}:${evidence.ref}:${timestamp}`;
  const signature = await wallet.signMessage(message);

  const res = await fetch('/api/attest', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      questId,
      recipient: wallet.address,
      evidence,
      timestamp,
      signature,
    }),
  });
  const data = (await res.json().catch(() => ({}))) as { hash?: string; error?: string };
  if (!res.ok) return { ok: false, error: data.error ?? `error ${res.status}` };
  return { ok: true, hash: data.hash };
}
