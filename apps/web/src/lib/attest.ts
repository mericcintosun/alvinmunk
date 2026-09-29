/**
 * Pure, framework-free helpers shared by the quest CLIENT (lib/quests.ts) and the
 * serverless ATTESTER (app/api/attest/route.ts). Keeping the canonical message and
 * the validation rules in ONE place guarantees the client signs exactly what the
 * server verifies — and lets us unit-test the security logic without the network.
 *
 * Hardening (belts/08 §security): v2 ownership message binds the deployment + network
 * (cross-environment replay), a per-signature in-window nonce guard, bounded inputs,
 * a self-referral guard, and an optional GitHub repo allowlist.
 */

export const ATTEST_VERSION = 'v2';
export const FRESHNESS_MS = 120_000; // 2 minutes
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
 * The manageData entry name the REFERRED account must set on-chain to bind the referral.
 * Value must be the REFERRER's G-address encoded as UTF-8 bytes (Horizon stores it
 * base64-encoded; the attester decodes it and compares to `recipient`).
 *
 * Onboarding flow: when a new user is invited, they include a `manageData` operation in
 * their account-creation (or first) transaction that sets this key to the inviter's address.
 * This is verifiable on-chain via GET /accounts/{referred} → .data["referral"].
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
export interface AttestClaim {
  questId: number;
  recipient: string;
  evidence?: AttestEvidence;
  timestamp: number;
}
/** Binds a signature to one deployment so it can't be replayed elsewhere. */
export interface AttestContext {
  contractId: string;
  passphrase: string;
}

const G_ADDRESS = /^G[A-Z2-7]{55}$/;
export function isGAddress(s: unknown): boolean {
  return typeof s === 'string' && G_ADDRESS.test(s);
}

const STELLAR_ADDRESS = /^[GC][A-Z2-7]{55}$/; // classic (G…) or smart-wallet (C…)
export function isStellarAddress(s: unknown): boolean {
  return typeof s === 'string' && STELLAR_ADDRESS.test(s);
}

/**
 * The canonical message the recipient signs to prove wallet ownership. v2 BINDS the
 * quest-registry contract id + network passphrase, so a signature captured on
 * testnet/contract-A cannot be replayed against mainnet/contract-B. Fields are
 * '|'-joined (the passphrase contains ':' and spaces, but never '|').
 */
export function ownershipMessage(c: AttestClaim, ctx: AttestContext): string {
  return [
    `attest:${ATTEST_VERSION}`,
    ctx.passphrase,
    ctx.contractId,
    c.recipient,
    String(c.questId),
    c.evidence?.type ?? '',
    c.evidence?.ref ?? '',
    String(c.timestamp),
  ].join('|');
}

/** Reject stale or future-dated requests outside the replay window. */
export function withinFreshness(now: number, ts: unknown, windowMs = FRESHNESS_MS): boolean {
  return typeof ts === 'number' && Number.isFinite(ts) && Math.abs(now - ts) <= windowMs;
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
    if (!isGAddress(ev.ref)) return { ok: false, reason: 'ref must be a G address' };
    if (ev.ref === recipient) return { ok: false, reason: 'cannot refer yourself' };
  }
  if (ev.type === 'invite_converts') {
    if (!isStellarAddress(ev.ref)) return { ok: false, reason: 'ref must be a Stellar address' };
    if (ev.ref === recipient) return { ok: false, reason: 'cannot invite yourself' };
  }
  return { ok: true };
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

/**
 * In-window replay guard keyed by signature; entries self-expire after the window.
 * Best-effort (per-instance, resets on cold start) — the on-chain replay guard is the
 * hard cap, this just stops rapid double-submits within the freshness window.
 */
export function makeReplayGuard(windowMs = FRESHNESS_MS) {
  const seen = new Map<string, number>();
  return {
    /** True if the signature is NEW (accept); false if it's a replay. */
    accept(sig: string, now: number): boolean {
      for (const [k, exp] of seen) if (exp <= now) seen.delete(k);
      if (seen.has(sig)) return false;
      seen.set(sig, now + windowMs);
      return true;
    },
    size(): number {
      return seen.size;
    },
  };
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
