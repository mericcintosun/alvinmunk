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
 *      attester sign the quest_registry's canonical payload.
 *   2. Ownership — proven ON-CHAIN: the wallet submits `award_quest`, which calls
 *      `recipient.require_auth()`. There is no off-chain ownership signature.
 *   3. Replay — the quest_registry's on-chain replay guard (one completion per recipient
 *      per quest) is the hard cap; the route adds only a per-IP rate limit.
 */

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
