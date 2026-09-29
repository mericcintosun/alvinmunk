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
import { scValToNative } from '@stellar/stellar-sdk';
import {
  enumKey,
  invokeAndWait,
  invokeAndWaitHash,
  readContract,
  readLedgerData,
  readPublic,
  args,
  questId as questRegistryId,
} from './contracts';
import { humanizeError } from './utils';
import type { EvidenceType } from './attest';
import type { Wallet } from './wallet';

// QuestRegistry contract error codes → friendly copy (mirrors contracts/quest_registry Error enum).
const QUEST_ERRORS: Record<number, string> = {
  3: 'This quest verification isn’t authorized — try again in a moment.',
  4: 'That quest doesn’t exist.',
  5: 'You’ve already completed this quest.',
  6: 'This quest isn’t active right now.',
  7: 'Quest rewards hit today’s limit — try again after 00:00 UTC.',
  8: 'The quest approval expired before it reached the chain — complete the quest again.',
};

export interface QuestResult {
  ok: boolean;
  hash?: string;
  error?: string;
}

// --- Admin content management. Every write is `admin.require_auth()`-gated on-chain. ---

/** A quest's on-chain config (contracts/quest_registry `QuestConfig`). */
export interface QuestConfig {
  id: number;
  schemaId: number;
  xp: bigint;
  active: boolean;
}

/**
 * Look up quest `id` by reading its stored `DataKey::Quest(id)` entry straight from the
 * ledger: the registry has no quest getter yet (#114), so the admin view works from a typed
 * id. `null` when no such quest exists. Throws on RPC failure.
 */
export async function readQuest(id: number): Promise<QuestConfig | null> {
  const [v] = await readLedgerData(questRegistryId(), [enumKey('Quest', args.u32(id))]);
  if (!v) return null;
  const raw = scValToNative(v) as { id: number; schema_id: number; xp: bigint; active: boolean };
  return {
    id: Number(raw.id),
    schemaId: Number(raw.schema_id),
    xp: BigInt(raw.xp),
    active: Boolean(raw.active),
  };
}

/** Define or replace quest `id` (always saved ACTIVE). Resolves the confirmed tx hash. */
export async function createQuest(
  wallet: Wallet,
  id: number,
  schemaId: number,
  xp: bigint,
): Promise<string> {
  return invokeAndWaitHash(
    questRegistryId(),
    'create_quest',
    [args.u32(id), args.u32(schemaId), args.u64(xp)],
    wallet,
  );
}

export async function setQuestActive(wallet: Wallet, id: number, active: boolean): Promise<string> {
  return invokeAndWaitHash(
    questRegistryId(),
    'set_quest_active',
    [args.u32(id), args.bool(active)],
    wallet,
  );
}

/** Weekly retention streak (Green belt) — consecutive weeks with a completed quest. */
export interface Streak {
  weeks: number;
  best: number;
  lastWeek: number;
}

/** Read a player's weekly streak from the QuestRegistry. Omit `source` for a wallet-free
 *  read (public profiles — no source-account lookup). */
export async function getStreak(addr: string, source?: string): Promise<Streak> {
  type Raw = { weeks: number; best: number; last_week: bigint };
  const call = [args.addr(addr)];
  const v = source
    ? await readContract<Raw>(questRegistryId(), 'get_streak', call, source)
    : await readPublic<Raw>(questRegistryId(), 'get_streak', call);
  return {
    weeks: Number(v?.weeks ?? 0),
    best: Number(v?.best ?? 0),
    lastWeek: Number(v?.last_week ?? 0),
  };
}

/** The current streak week in UTC unix seconds: `start` is its first second and `end` its
 *  last (inclusive), so the week resets at `end + 1`. Weeks are aligned on the Unix epoch
 *  and run Thursday 00:00 to Wednesday 23:59:59 UTC. */
export interface WeekBounds {
  start: number;
  end: number;
}

/** Read `get_week_bounds` from the QuestRegistry. Resolves `null` when the read fails —
 *  including a deployed contract that predates the view — or returns something that isn't
 *  a week, so the UI hides the countdown instead of guessing. Omit `source` for a
 *  wallet-free read. */
export async function getWeekBounds(source?: string): Promise<WeekBounds | null> {
  type Raw = [bigint, bigint] | undefined;
  try {
    const v = source
      ? await readContract<Raw>(questRegistryId(), 'get_week_bounds', [], source)
      : await readPublic<Raw>(questRegistryId(), 'get_week_bounds', []);
    if (!Array.isArray(v) || v.length !== 2) return null;
    const start = Number(v[0]);
    const end = Number(v[1]);
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || end <= start) return null;
    return { start, end };
  } catch {
    return null;
  }
}

export interface TimeLeft {
  days: number;
  hours: number;
  minutes: number;
}

/** Time left until the week resets (`end + 1`), split for display. Rounds up to the
 *  minute so it never reads "0m" while time remains; `null` once the reset has passed. */
export function timeUntilReset(bounds: WeekBounds, nowSecs: number): TimeLeft | null {
  const left = bounds.end + 1 - nowSecs;
  if (left <= 0) return null;
  const totalMinutes = Math.ceil(left / 60);
  return {
    days: Math.floor(totalMinutes / 1440),
    hours: Math.floor((totalMinutes % 1440) / 60),
    minutes: totalMinutes % 60,
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
    body: JSON.stringify({ questId, recipient: wallet.address, evidence }),
  });
  const data = (await res.json().catch(() => ({}))) as {
    attester?: string;
    sig?: string;
    expiresAt?: number;
    error?: string;
  };
  if (!res.ok || !data.attester || !data.sig || !Number.isSafeInteger(data.expiresAt)) {
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
        // Signed into the payload: the contract refuses the signature after this time.
        args.u64(BigInt(data.expiresAt as number)),
      ],
      wallet,
    );
    return { ok: true };
  } catch (e) {
    return { ok: false, error: humanizeError(e, QUEST_ERRORS) };
  }
}
