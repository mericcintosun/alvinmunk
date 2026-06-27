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
