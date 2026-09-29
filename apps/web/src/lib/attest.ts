/**
 * Pure, framework-free rules for the serverless ATTESTER (app/api/attest/route.ts), kept
 * here so they can be unit-tested without the network. The client (lib/quests.ts,
 * components/Quests.tsx) only shares the evidence types and default quest ids.
 *
 * The model the route enforces (belts/08 §security):
 *   1. Evidence verification — cheap shape checks (`validateEvidence`: bounded inputs,
 *      self-referral guard), the quest id bound to one evidence type
 *      (`evidenceMatchesQuest`), then the real action checked on the network (merged PR
 *      within an optional repo allowlist, `judgeReferral`, …). Only then does the
 *      attester sign the quest_registry's award payload (`questPayload`), which binds
 *      the network, the contract and an expiry (issue #142).
 *   2. Ownership — proven ON-CHAIN: the wallet submits `award_quest`, which calls
 *      `recipient.require_auth()`. There is no off-chain ownership signature.
 *   3. Replay — the quest_registry's on-chain replay guard (one completion per recipient
 *      per quest, or per period for a repeatable quest) is the hard cap, and an unredeemed
 *      signature expires on-chain QUEST_SIG_TTL_SECS after it is issued; the route adds
 *      only a per-IP rate limit.
 *   4. Repeatable quests (#154) — the payload also names the period (`questWindow`), so a
 *      signature can't carry over into the next one, and the evidence must be dated inside
 *      the current period (`FRESH_EVIDENCE`): a standing condition must not pay every week.
 */
import { Address, Keypair, hash, nativeToScVal, xdr } from '@stellar/stellar-sdk';

export const MAX_REF_LEN = 200; // evidence.ref upper bound (anti-abuse)
export const MAX_QUEST_ID = 1_000_000;
export const MAX_BODY_BYTES = 4_096; // request body upper bound

export type EvidenceType = 'github_pr' | 'referral_tx' | 'invite_converts' | 'vouch_back';
export interface AttestEvidence {
  type: EvidenceType;
  /** Meaning by type: github_pr → "owner/repo#n"; referral_tx/invite_converts → a Stellar
   * address; vouch_back → unused (the recipient's own mint history is checked). */
  ref: string;
}

/**
 * The manageData entry name a classic REFERRED account can set on-chain to bind the
 * referral. Value must be the REFERRER's address encoded as UTF-8 bytes (Horizon stores it
 * base64-encoded; the attester decodes it and compares to `recipient`). Verifiable via
 * GET /accounts/{referred} → .data["referral"].
 *
 * Passkey smart accounts (C…) can't hold manageData; any wallet can instead bind its
 * inviter once in the registry (`set_inviter`, read back with `invited_by(addr)`), which
 * the attester checks first — see `judgeReferral`.
 */
export const REFERRAL_MARKER_KEY = 'referral';

/**
 * Decode a Horizon account data-entry value (base64) to its UTF-8 string.
 * Returns null if the input is empty, not valid base64, or decodes to an empty string.
 * Deliberately kept free of stellar-sdk imports so it stays unit-testable without mocks.
 */
export function decodeDataEntry(base64Value: string): string | null {
  if (!base64Value) return null;
  try {
    const s = Buffer.from(base64Value, 'base64').toString('utf8');
    return s.length > 0 ? s : null;
  } catch {
    return null;
  }
}
/** Vouch-back threshold: how many distinct people you must have vouched for to earn it. */
export const VOUCH_BACK_MIN = 3;

const G_ADDRESS = /^G[A-Z2-7]{55}$/;
export function isGAddress(s: unknown): boolean {
  return typeof s === 'string' && G_ADDRESS.test(s);
}

const STELLAR_ADDRESS = /^[GC][A-Z2-7]{55}$/; // classic (G…) or smart-wallet (C…)
export function isStellarAddress(s: unknown): boolean {
  return typeof s === 'string' && STELLAR_ADDRESS.test(s);
}

/** Domain tag leading every one-shot quest award payload (the contract's `AWARD_DOMAIN`). */
export const QUEST_AWARD_DOMAIN = 'alvinmunk_award_quest_v1';
/** Domain tag of a repeatable quest's payload (the contract's `AWARD_DOMAIN_V2`). */
export const QUEST_AWARD_DOMAIN_V2 = 'alvinmunk_award_quest_v2';

/** A weekly repeat period, the contract's streak week: Thursday 00:00 UTC to Thursday. */
export const WEEK_SECS = 604_800;

/**
 * The period a repeatable quest is in at `nowSecs`, as the contract derives it: `epoch =
 * floor(now / periodSecs)` (aligned on the Unix epoch), from `start` to `end` inclusive.
 * `null` for a one-shot quest (`periodSecs` 0).
 */
export interface QuestWindow {
  periodSecs: number;
  epoch: number;
  start: number;
  end: number;
}
export function questWindow(nowSecs: number, periodSecs: number): QuestWindow | null {
  if (!Number.isSafeInteger(periodSecs) || periodSecs <= 0) return null;
  const epoch = Math.floor(nowSecs / periodSecs);
  const start = epoch * periodSecs;
  return { periodSecs, epoch, start, end: start + periodSecs - 1 };
}

/**
 * The evidence types a REPEATABLE quest can take: each is checked for an action dated inside
 * the current period (a PR merged, a vouch claimed). A referral has no date the attester can
 * read — the invite marker just stands — so it would pay out every period for one referral.
 */
export const FRESH_EVIDENCE: ReadonlySet<EvidenceType> = new Set([
  'github_pr',
  'invite_converts',
  'vouch_back',
]);

/**
 * The expiry to sign: QUEST_SIG_TTL_SECS from now, but never past the end of a repeatable
 * quest's period. Past it the contract names the next period and the signature could not
 * verify, so it expires first and the wallet gets `SignatureExpired` (retry) instead.
 */
export function signatureExpiry(nowSecs: number, window: QuestWindow | null): number {
  const ttl = nowSecs + QUEST_SIG_TTL_SECS;
  return window ? Math.min(ttl, window.end) : ttl;
}

/** How long an award signature stays redeemable: `award_quest` refuses it once the ledger
 *  time passes `expiresAt`. Long enough for a wallet prompt and a slow submit. */
export const QUEST_SIG_TTL_SECS = 600;

/** The deployment an award signature is for: the quest_registry contract and its network. */
export interface QuestDeployment {
  contractId: string;
  passphrase: string;
}

/**
 * The bytes the attester signs to award `questId` to `recipient` until `expiresAt` (unix
 * seconds, compared with the ledger time): the XDR of the ScVal vector
 * `[Symbol(QUEST_AWARD_DOMAIN), sha256(passphrase), contract, u32 questId, recipient,
 * u64 expiresAt]`, byte for byte the contract's `payload` (both sides pin the same test
 * vectors). For a repeatable quest (`window`) it is `[Symbol(QUEST_AWARD_DOMAIN_V2), …,
 * recipient, u64 periodSecs, u64 epoch, u64 expiresAt]`. Built here, never read from an
 * RPC node: a dishonest node could return the payload for ITS address, and the attester
 * key would sign the award over to it.
 */
export function questPayload(
  ctx: QuestDeployment,
  questId: number,
  recipient: string,
  expiresAt: number,
  window: QuestWindow | null = null,
): Buffer {
  const period = window
    ? [
        nativeToScVal(BigInt(window.periodSecs), { type: 'u64' }),
        nativeToScVal(BigInt(window.epoch), { type: 'u64' }),
      ]
    : [];
  return xdr.ScVal.scvVec([
    xdr.ScVal.scvSymbol(window ? QUEST_AWARD_DOMAIN_V2 : QUEST_AWARD_DOMAIN),
    xdr.ScVal.scvBytes(hash(Buffer.from(ctx.passphrase))),
    new Address(ctx.contractId).toScVal(),
    nativeToScVal(questId, { type: 'u32' }),
    new Address(recipient).toScVal(),
    ...period,
    nativeToScVal(BigInt(expiresAt), { type: 'u64' }),
  ]).toXDR();
}

/** What `/api/attest` returns for `award_quest`: the attester's raw ed25519 public key
 *  (hex), its signature over `questPayload` (base64), and the signed expiry. */
export interface QuestSignature {
  attester: string;
  sig: string;
  expiresAt: number;
}

/** Sign the award payload for `questId` / `recipient` with the attester secret; pass the
 *  current `window` for a repeatable quest. */
export function signQuestPayload(
  secret: string,
  ctx: QuestDeployment,
  questId: number,
  recipient: string,
  expiresAt: number,
  window: QuestWindow | null = null,
): QuestSignature {
  const kp = Keypair.fromSecret(secret);
  const sig = kp.sign(questPayload(ctx, questId, recipient, expiresAt, window));
  return { attester: kp.rawPublicKey().toString('hex'), sig: sig.toString('base64'), expiresAt };
}

export function isValidQuestId(q: unknown): q is number {
  return typeof q === 'number' && Number.isInteger(q) && q >= 0 && q <= MAX_QUEST_ID;
}

/** Cheap, network-free evidence checks: shape, length, format, self-referral. */
export function validateEvidence(
  ev: AttestEvidence | undefined,
  recipient: string,
): { ok: true } | { ok: false; reason: string } {
  const KNOWN: EvidenceType[] = ['github_pr', 'referral_tx', 'invite_converts', 'vouch_back'];
  if (!ev || !KNOWN.includes(ev.type)) {
    return { ok: false, reason: 'unknown or missing evidence type' };
  }
  // vouch_back checks the recipient's own on-chain mint history — no ref needed.
  if (ev.type !== 'vouch_back') {
    if (typeof ev.ref !== 'string' || ev.ref.length === 0 || ev.ref.length > MAX_REF_LEN) {
      return { ok: false, reason: 'evidence ref missing or too long' };
    }
  }
  if (ev.type === 'github_pr' && !/^[\w.-]+\/[\w.-]+#\d+$/.test(ev.ref)) {
    return { ok: false, reason: 'ref must be owner/repo#number' };
  }
  if (ev.type === 'referral_tx') {
    // a passkey smart account (C…) is referred through its registry invite binding
    if (!isStellarAddress(ev.ref)) return { ok: false, reason: 'ref must be a G or C address' };
    if (ev.ref === recipient) return { ok: false, reason: 'cannot refer yourself' };
  }
  if (ev.type === 'invite_converts') {
    if (!isStellarAddress(ev.ref)) return { ok: false, reason: 'ref must be a Stellar address' };
    if (ev.ref === recipient) return { ok: false, reason: 'cannot invite yourself' };
  }
  return { ok: true };
}

/**
 * What the attester read about a `referral_tx` ref. For both lookups `null` means "none"
 * and `undefined` means "couldn't be read right now".
 */
export interface ReferralFacts {
  /** The referred wallet's Social score (`reputation.get_score`). */
  score: bigint;
  /**
   * Its registry invite binding (`registry.invited_by`): the inviter's address; null when
   * unbound, or when the registry isn't configured or predates invite bindings.
   */
  invitedBy: string | null | undefined;
  /** Its decoded `referral` manageData entry; null when absent (always, for a C… account). */
  marker: string | null | undefined;
}

/**
 * Did `recipient` refer `ref`? The referred wallet must have done something real (a
 * Social score above zero), so an empty account bound to you earns nothing. Its registry
 * binding decides whenever there is one — it is write-once and signed by the referred
 * wallet — and only a wallet with no binding falls back to the classic manageData marker.
 */
export function judgeReferral(
  facts: ReferralFacts,
  ref: string,
  recipient: string,
): { ok: true } | { ok: false; reason: string } {
  if (facts.score <= 0n) {
    return { ok: false, reason: 'that wallet hasn’t done anything here yet — no referral credit' };
  }
  if (facts.invitedBy === undefined) {
    return { ok: false, reason: 'couldn’t read who invited that wallet right now — try again' };
  }
  if (facts.invitedBy !== null) {
    return facts.invitedBy === recipient
      ? { ok: true }
      : { ok: false, reason: 'that wallet was invited by a different account' };
  }
  if (facts.marker === undefined) {
    return { ok: false, reason: 'couldn’t read the referred account right now — try again' };
  }
  if (facts.marker !== null) {
    if (facts.marker === recipient) return { ok: true };
    return {
      ok: false,
      reason:
        facts.marker === ref
          ? 'referral marker is a self-referral on the referred account'
          : 'referral marker points to a different referrer — cannot reuse this marker',
    };
  }
  return {
    ok: false,
    reason:
      'no referral binding found — ask them to join through your invite link ' +
      `(or set the "${REFERRAL_MARKER_KEY}" data entry to your address)`,
  };
}

/**
 * The quest id each evidence type is bound to when its env var is unset: the ids
 * scripts/redeploy-all.sh seeds and components/Quests.tsx targets. `github_pr` has no
 * default, so GitHub attestations stay off until QUEST_GITHUB_ID is set.
 */
export const DEFAULT_QUEST_IDS = { referral_tx: 2, invite_converts: 3, vouch_back: 4 } as const;

/** Quest-id env vars (per evidence type) read by `buildQuestEvidenceMap`. */
export const QUEST_ID_ENV: Record<EvidenceType, string> = {
  referral_tx: 'NEXT_PUBLIC_DEFAULT_QUEST_ID',
  invite_converts: 'NEXT_PUBLIC_INVITE_QUEST_ID',
  vouch_back: 'NEXT_PUBLIC_VOUCHBACK_QUEST_ID',
  github_pr: 'QUEST_GITHUB_ID',
};

/**
 * Whether `type` is THE evidence type bound to `questId`. The attester checks this BEFORE
 * any network call: without it one qualifying action (e.g. vouch_back) could be replayed
 * against every quest id and redeem each of them. A quest id missing from the map is
 * rejected, so an unmapped quest can never be attested.
 */
export function evidenceMatchesQuest(
  questId: number,
  type: EvidenceType,
  map: ReadonlyMap<number, EvidenceType>,
): boolean {
  return map.get(questId) === type;
}

/**
 * Build the questId → evidence-type map from env (see `QUEST_ID_ENV`). An unset or blank
 * var falls back to `DEFAULT_QUEST_IDS`; a set value must be a plain decimal quest id, or
 * that type is left unmapped. Two types configured with the same quest id are ambiguous,
 * so that id is dropped entirely and rejects every type (fail closed).
 */
export function buildQuestEvidenceMap(
  env: Record<string, string | undefined>,
): Map<number, EvidenceType> {
  const map = new Map<number, EvidenceType>();
  const conflicts = new Set<number>();
  for (const type of Object.keys(QUEST_ID_ENV) as EvidenceType[]) {
    const raw = env[QUEST_ID_ENV[type]]?.trim();
    const fallback = (DEFAULT_QUEST_IDS as Partial<Record<EvidenceType, number>>)[type];
    const id = raw ? (/^\d+$/.test(raw) ? Number(raw) : NaN) : fallback;
    if (!isValidQuestId(id)) continue;
    if (map.has(id)) conflicts.add(id);
    else map.set(id, type);
  }
  for (const id of conflicts) map.delete(id);
  return map;
}

/** Parse "owner/repo,owner2/repo2" into a lowercased set, or null when unset. */
export function parseRepoAllowlist(raw: string | undefined): Set<string> | null {
  if (!raw) return null;
  const set = new Set(
    raw
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
  return set.size > 0 ? set : null;
}

/** When an allowlist is configured, only its repos count; otherwise allow any. */
export function repoAllowed(allow: Set<string> | null, owner: string, repo: string): boolean {
  return !allow || allow.has(`${owner}/${repo}`.toLowerCase());
}
