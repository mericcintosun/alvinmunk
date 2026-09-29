/**
 * Contract-mirroring input rules, kept pure so they are unit-tested: who sees the admin
 * controls, the checks each write is held to before anyone signs, the plain-language
 * consequence every write is confirmed with, and friendly copy for the contract errors
 * those writes can hit.
 *
 * Most of it backs the /admin content page (issue #296); `validateTip` is the one
 * player-facing check, and it lives here because it is the same shape of rule as the rest —
 * a mirror of a contract guard, in the same order the contract applies it, so a bad
 * transaction is caught before a signature rather than after.
 *
 * This module does NOT authorize anything. Every content write is `admin.require_auth()`-
 * gated on-chain, so a wallet that isn't the admin can never change content, whatever the
 * page renders. The gate here only decides whether to RENDER controls: it compares the
 * connected wallet with the admin each contract stores in its instance storage (read from
 * the ledger, not from configuration, since the contracts have no admin getter) and fails
 * closed when that read fails.
 */
import { Address } from '@stellar/stellar-sdk';
import { enumKey, gateId, questId, readInstanceValue, rewardsId } from './contracts';
import { stroopsToUsdc, usdcToStroops, type RewardEntry } from './rewards';
import { TRACK, type Gate } from './gate';
import type { QuestConfig } from './quests';
import { WEEK_SECS } from './attest';
import { humanizeError } from './utils';

export type ContentSection = 'rewards' | 'gates' | 'quests';
export const CONTENT_SECTIONS: ContentSection[] = ['rewards', 'gates', 'quests'];

// ── Admin gate ──

/** `DataKey::Admin`: the instance-storage key each contract's constructor (its `init`, before
 *  #127) stores its admin under. */
export const ADMIN_KEY = enumKey('Admin');

/** The admin a contract stores on-chain (`null` if it has none, or isn't deployed). */
export async function readContractAdmin(contractId: string): Promise<string | null> {
  if (!contractId) return null;
  const v = await readInstanceValue(contractId, ADMIN_KEY);
  return v ? Address.fromScVal(v).toString() : null;
}

export type ContentAdmins = Record<ContentSection, string | null>;

/** Each content contract's on-chain admin. Never rejects: a failed read is `null`. */
export async function readContentAdmins(): Promise<ContentAdmins> {
  const read = (id: string) => readContractAdmin(id).catch(() => null);
  const [rewards, gates, quests] = await Promise.all([
    read(rewardsId()),
    read(gateId()),
    read(questId()),
  ]);
  return { rewards, gates, quests };
}

/** The sections `address` may manage: those whose contract has it as admin. Fails closed. */
export function manageableSections(
  address: string | null | undefined,
  admins: ContentAdmins | null,
): ContentSection[] {
  if (!address || !admins) return [];
  return CONTENT_SECTIONS.filter((s) => admins[s] === address);
}

// ── Input checks (mirror the contracts, so a bad row is caught before anyone signs) ──

export type Checked<T> = { ok: true; value: T } | { ok: false; error: string };
const ok = <T>(value: T): Checked<T> => ({ ok: true, value });
const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });

export const U32_MAX = 4_294_967_295;
const U64_MAX = 2n ** 64n - 1n;
const I128_MAX = 2n ** 127n - 1n;
/** Longest gate label accepted: it is shown on a player-facing card. */
export const GATE_LABEL_MAX = 64;

/** A contract `u32`: ids, schema ids, supply caps. */
export function parseU32(raw: string, name: string): Checked<number> {
  const s = raw.trim();
  if (!/^\d+$/.test(s) || Number(s) > U32_MAX) {
    return fail(`${name} must be a whole number from 0 to ${U32_MAX}.`);
  }
  return ok(Number(s));
}

/** A contract `u64` XP value of at least 1. `zero` explains why 0 is refused. */
function parseXp(raw: string, name: string, zero: string): Checked<bigint> {
  const s = raw.trim();
  if (!/^\d+$/.test(s) || BigInt(s) > U64_MAX) return fail(`${name} must be a whole number.`);
  const v = BigInt(s);
  return v < 1n ? fail(zero) : ok(v);
}

/** A positive USDC amount (at most 7 decimals, like every Stellar asset) as i128 stroops. */
export function parseUsdc(raw: string): Checked<bigint> {
  const s = raw.trim();
  if (!/^\d+(\.\d{1,7})?$/.test(s)) {
    return fail('Amount must be a USDC number with at most 7 decimals, e.g. 2 or 0.5.');
  }
  let stroops: bigint;
  try {
    stroops = usdcToStroops(s);
  } catch {
    // usdcToStroops rejects zero and sub-stroop amounts (never coerces to 0).
    return fail('Amount must be more than 0 USDC.');
  }
  if (stroops > I128_MAX) return fail('Amount is too large.');
  return ok(stroops);
}

export interface RewardDraft {
  id: number;
  threshold: bigint;
  amount: bigint;
}

/**
 * `add_reward` input. Mirrors the contract: amount > 0 (InvalidAmount), threshold ≥ 1
 * (InvalidThreshold, #318) and, while a daily cap is set, amount ≤ cap (AmountExceedsCap).
 */
export function validateReward(
  input: { id: string; threshold: string; amount: string },
  dailyCap: bigint,
): Checked<RewardDraft> {
  const id = parseU32(input.id, 'Reward ID');
  if (!id.ok) return id;
  const threshold = parseXp(
    input.threshold,
    'Earned XP threshold',
    'A 0 XP threshold would let every wallet claim. Use at least 1.',
  );
  if (!threshold.ok) return threshold;
  const amount = parseUsdc(input.amount);
  if (!amount.ok) return amount;
  if (dailyCap > 0n && amount.value > dailyCap) {
    return fail(
      `${stroopsToUsdc(amount.value)} USDC is above the daily cap of ${stroopsToUsdc(dailyCap)} USDC, so no one could claim it. Lower the amount or raise the cap first.`,
    );
  }
  return ok({ id: id.value, threshold: threshold.value, amount: amount.value });
}

/**
 * `set_reward_supply` input: the reward must exist (RewardNotFound) and a non-zero cap can't
 * be below the claims already paid (InvalidSupply). 0 means unlimited.
 */
export function validateSupply(
  input: { id: string; maxClaims: string },
  rewards: RewardEntry[],
): Checked<{ reward: RewardEntry; maxClaims: number }> {
  const id = parseU32(input.id, 'Reward ID');
  if (!id.ok) return id;
  const reward = rewards.find((r) => r.id === id.value);
  if (!reward) return fail(`Reward ${id.value} doesn't exist. Add it first.`);
  const maxClaims = parseU32(input.maxClaims, 'Max claims');
  if (!maxClaims.ok) return maxClaims;
  const claims = reward.claims ?? 0;
  if (maxClaims.value !== 0 && maxClaims.value < claims) {
    return fail(
      `Reward ${reward.id} has already paid ${claims} claims, so its cap can't be lower. Use 0 for unlimited.`,
    );
  }
  return ok({ reward, maxClaims: maxClaims.value });
}

/**
 * `tip` input (#144). Mirrors the contract's `validate_tip`: the amount must be more than
 * 0 USDC (`InvalidAmount`) and the receiver must be a DIFFERENT wallet from the sender
 * (`SelfTip`) — a zero or self tip mints a `tipped` event that moves no value, which
 * fakes "somebody received a spend" in the feed and the indexer. The same two checks, in
 * the same order, so a shape the chain would reject never costs a fee to discover.
 */
export function validateTip(input: { to: string; amount: string }, from: string): Checked<bigint> {
  const amount = parseUsdc(input.amount);
  if (!amount.ok) return amount;
  if (input.to === from) return fail('That’s your own wallet — enter someone else to tip.');
  return ok(amount.value);
}

export interface GateDraft {
  id: number;
  track: number;
  min: bigint;
  label: string;
}

/** `create_gate` input: track Social/Earned (BadTrack), min ≥ 1, a short non-empty label. */
export function validateGate(input: {
  id: string;
  track: string;
  min: string;
  label: string;
}): Checked<GateDraft> {
  const id = parseU32(input.id, 'Gate ID');
  if (!id.ok) return id;
  const track = Number(input.track);
  if (input.track.trim() === '' || (track !== TRACK.SOCIAL && track !== TRACK.EARNED)) {
    return fail('Pick the Social or Earned track.');
  }
  const min = parseXp(
    input.min,
    'Minimum XP',
    'A 0 XP minimum would let every wallet through. Use at least 1.',
  );
  if (!min.ok) return min;
  const label = input.label.trim();
  if (!label) return fail('Give the gate a label players will see.');
  if (label.length > GATE_LABEL_MAX) return fail(`Keep the label to ${GATE_LABEL_MAX} characters.`);
  return ok({ id: id.value, track, min: min.value, label });
}

export interface QuestDraft {
  id: number;
  schemaId: number;
  xp: bigint;
}

/** `create_quest` input: u32 id and schema id, and an XP award of at least 1. */
export function validateQuest(input: { id: string; schemaId: string; xp: string }): Checked<QuestDraft> {
  const id = parseU32(input.id, 'Quest ID');
  if (!id.ok) return id;
  const schemaId = parseU32(input.schemaId, 'Schema ID');
  if (!schemaId.ok) return schemaId;
  const xp = parseXp(input.xp, 'XP', 'A quest must award at least 1 XP.');
  if (!xp.ok) return xp;
  return ok({ id: id.value, schemaId: schemaId.value, xp: xp.value });
}

// ── Consequences: the exact effect each write is confirmed with ──

const trackName = (track: number) => (track === TRACK.EARNED ? 'Earned' : 'Social');
const reEnabled = (active: boolean) => (active ? '' : ' It will be re-enabled.');

/** `add_reward` saves the row ACTIVE; replacing one keeps its per-wallet claim records. */
export function rewardConsequence(d: RewardDraft, current?: RewardEntry): string {
  const pays = `Reward ${d.id} will pay ${stroopsToUsdc(d.amount)} USDC to any wallet with ≥ ${d.threshold} Earned XP`;
  if (!current) return `${pays}.`;
  return (
    `${pays}, replacing ${stroopsToUsdc(current.amount)} USDC at ≥ ${current.threshold} Earned XP.` +
    `${reEnabled(current.active)} Wallets that already claimed it can't claim it again.`
  );
}

export function rewardToggleConsequence(r: RewardEntry, active: boolean): string {
  const usdc = stroopsToUsdc(r.amount);
  if (!active) {
    return `Reward ${r.id} (${usdc} USDC at ≥ ${r.threshold} Earned XP) will be disabled: no wallet can claim it until it is re-enabled.`;
  }
  const cap = r.max_claims ?? 0;
  const left = cap > 0 ? ` ${Math.max(0, cap - (r.claims ?? 0))} of ${cap} claims are left.` : '';
  return `Reward ${r.id} will be enabled: any wallet with ≥ ${r.threshold} Earned XP that hasn't claimed it can claim ${usdc} USDC.${left}`;
}

export function supplyConsequence(r: RewardEntry, maxClaims: number): string {
  const usdc = stroopsToUsdc(r.amount);
  if (maxClaims === 0) {
    return `Reward ${r.id} will have no claim limit: every eligible wallet can claim ${usdc} USDC.`;
  }
  const claims = r.claims ?? 0;
  const left = maxClaims - claims;
  if (left <= 0) {
    return `Reward ${r.id} will stop paying now: its cap of ${maxClaims} equals the ${claims} claims already paid.`;
  }
  return (
    `Reward ${r.id} will stop paying after ${maxClaims} claims in total (${claims} paid so far): ` +
    `at most ${left} more, ${stroopsToUsdc(r.amount * BigInt(left))} USDC.`
  );
}

/** `create_gate` saves the gate ACTIVE; replacing one keeps existing unlocks. */
export function gateConsequence(d: GateDraft, current?: Gate): string {
  const opens = `Gate ${d.id} “${d.label}” will open to any wallet with ≥ ${d.min} ${trackName(d.track)} XP`;
  if (!current) return `${opens}.`;
  return (
    `${opens}, replacing “${current.label}” at ≥ ${current.min} ${trackName(current.track)} XP.` +
    `${reEnabled(current.active)} Wallets that already unlocked it stay unlocked.`
  );
}

export function gateToggleConsequence(g: Gate, active: boolean): string {
  if (!active) {
    return `Gate ${g.id} “${g.label}” will be disabled: every access check fails and no wallet can unlock it until it is re-enabled. Existing unlocks are kept.`;
  }
  return `Gate ${g.id} “${g.label}” will be enabled: any wallet with ≥ ${g.min} ${trackName(g.track)} XP passes it.`;
}

/** How often a quest with this repeat period can be completed, for admin copy. */
function repeatPhrase(periodSecs: number): string {
  if (periodSecs <= 0) return 'once';
  if (periodSecs === WEEK_SECS) return 'once a week';
  return `once every ${Math.round(periodSecs / 86_400)} days`;
}

/** `create_quest` saves the quest ACTIVE and leaves its repeat period (`periodSecs`, 0 =
 *  one-shot) alone; replacing one keeps its per-wallet completions. */
export function questConsequence(
  d: QuestDraft,
  current: QuestConfig | null,
  periodSecs = 0,
): string {
  const awards = `Quest ${d.id} will award ${d.xp} Earned XP (schema ${d.schemaId}) ${repeatPhrase(periodSecs)} to each wallet the attester verifies for it`;
  if (!current) return `${awards}.`;
  const kept =
    periodSecs > 0
      ? 'Wallets that completed it this round can complete it again next round.'
      : "Wallets that already completed it can't complete it again.";
  return (
    `${awards}, replacing ${current.xp} XP (schema ${current.schemaId}).` +
    `${reEnabled(current.active)} ${kept}`
  );
}

/** `set_quest_period`: weekly (`WEEK_SECS`) or back to one-shot (0). */
export function questPeriodConsequence(q: QuestConfig, periodSecs: number): string {
  if (periodSecs <= 0) {
    return (
      `Quest ${q.id} will be one-shot again: each wallet can complete it once. ` +
      'Wallets that only completed the repeating version can complete it one more time.'
    );
  }
  return (
    `Quest ${q.id} will repeat: each wallet can complete it ${repeatPhrase(periodSecs)} ` +
    '(weeks start Thursday 00:00 UTC). The attester signs a repeating quest only for evidence ' +
    'dated inside the current round — a PR merged, an invite or vouches claimed — so a ' +
    'referral quest can’t repeat. Approvals issued before the change stop working.'
  );
}

export function questToggleConsequence(q: QuestConfig, active: boolean): string {
  if (!active) {
    return `Quest ${q.id} will be disabled: the attester can't award it until it is re-enabled.`;
  }
  return `Quest ${q.id} will be enabled: the attester can award its ${q.xp} Earned XP again.`;
}

// ── Contract errors → admin copy ──

/**
 * The error codes each section's writes can hit, per contract Error enum (codes are
 * per-contract, so the maps are separate). Rewards 13 (RewardExhausted) and 17
 * (CapBelowActiveReward) come from `claim_reward` / `set_daily_cap`, not from this page.
 */
export const ADMIN_ERRORS: Record<ContentSection, Record<number, string>> = {
  rewards: {
    1: 'The rewards contract is not initialized.',
    6: 'That reward doesn’t exist. Add it first.',
    8: 'A reward must pay more than 0 USDC.',
    14: 'The supply cap can’t be lower than the claims already paid. Use 0 for unlimited.',
    15: 'A reward needs an Earned XP threshold of at least 1.',
    16: 'That payout is above the daily cap, so no one could claim it. Lower it or raise the cap first.',
  },
  gates: {
    1: 'The gate contract is not initialized.',
    3: 'That gate doesn’t exist. Create it first.',
    6: 'A gate’s track must be Social or Earned.',
  },
  quests: {
    1: 'The quest registry is not initialized.',
    4: 'That quest doesn’t exist. Create it first.',
    9: 'A repeat period must be at least a day. Use 0 for a one-shot quest.',
  },
};

export function adminErrorMessage(section: ContentSection, e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e ?? '');
  // A signer other than the stored admin fails `admin.require_auth()`.
  if (/Error\(Auth,/.test(raw)) return 'The contract refused: this wallet is not its admin.';
  return humanizeError(e, ADMIN_ERRORS[section]);
}
