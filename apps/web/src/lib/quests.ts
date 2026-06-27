/**
 * Quest client. Earned XP is granted by a DUAL-authorized on-chain call:
 *   1. The serverless attester verifies the real action (merged PR / referral tx) and
 *      returns its ed25519 SIGNATURE over the contract's canonical payload — it never
 *      submits a tx, so it stays stateless and its key never touches the client.
 *   2. The wallet submits `award_quest`, satisfying `recipient.require_auth()` on-chain
 *      (passkey via the smart-account invoke path, classic wallets via the tx signature).
 * Ownership is thus proven ON-CHAIN — no off-chain ownership signature, and it works for
 * passkey smart accounts (C…) as well as classic (G…) wallets.
 */
import { invokeAndWait, readContract, args, questId as questRegistryId } from './contracts';
import { humanizeError } from './utils';
import type { EvidenceType } from './attest';
import type { Wallet } from './wallet';

// QuestRegistry contract error codes → friendly copy (mirrors contracts/quest_registry Error enum).
const QUEST_ERRORS: Record<number, string> = {
  3: 'This quest verification isn’t authorized — try again in a moment.',
  4: 'That quest doesn’t exist.',
  5: 'You’ve already completed this quest.',
  6: 'This quest isn’t active right now.',
};

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

export type Evidence = { type: EvidenceType; ref: string };

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function completeQuest(
  wallet: Wallet,
  questId: number,
  evidence: Evidence,
): Promise<QuestResult> {
  // 1) Attester verifies the evidence and signs the on-chain payload (no tx, no fee).
  const res = await fetch('/api/attest', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ questId, recipient: wallet.address, evidence, timestamp: Date.now() }),
  });
  const data = (await res.json().catch(() => ({}))) as {
    attester?: string;
    sig?: string;
    error?: string;
  };
  if (!res.ok || !data.attester || !data.sig) {
    return { ok: false, error: data.error ?? `error ${res.status}` };
  }

  // 2) Submit award_quest. The wallet authorizes recipient.require_auth() — passkey via
  //    the smart-account invoke path, classic wallets via the envelope signature.
  try {
    await invokeAndWait(
      questRegistryId(),
      'award_quest',
      [
        args.bytes(hexToBytes(data.attester)),
        args.bytes(b64ToBytes(data.sig)),
        args.u32(questId),
        args.addr(wallet.address),
      ],
      wallet,
    );
    return { ok: true };
  } catch (e) {
    return { ok: false, error: humanizeError(e, QUEST_ERRORS) };
  }
}
