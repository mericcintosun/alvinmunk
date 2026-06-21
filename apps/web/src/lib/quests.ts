/**
 * Quest client. To claim a verified quest, the wallet owner signs a canonical
 * message proving ownership of the recipient address; the serverless attester
 * verifies that + the evidence, then grants Earned XP on-chain. The private
 * attester key never touches the client (belts/08 security).
 */
import type { Wallet } from './wallet';

export interface QuestResult {
  ok: boolean;
  hash?: string;
  error?: string;
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
