import { describe, it, expect } from 'vitest';
import {
  ownershipMessage,
  withinFreshness,
  validateEvidence,
  isValidQuestId,
  makeReplayGuard,
  parseRepoAllowlist,
  repoAllowed,
  MAX_REF_LEN,
  type AttestClaim,
} from './attest';

const G = 'G'.padEnd(56, 'A'); // a syntactically valid G-address (G + 55 base32 chars)
const G2 = 'G'.padEnd(56, 'B');
const ctxA = { contractId: 'CQUEST_A', passphrase: 'Test SDF Network ; September 2015' };
const ctxB = { contractId: 'CQUEST_B', passphrase: 'Public Global Stellar Network ; September 2015' };

const claim = (over: Partial<AttestClaim> = {}): AttestClaim => ({
  questId: 1,
  recipient: G,
  evidence: { type: 'referral_tx', ref: G2 },
  timestamp: 1_000_000,
  ...over,
});

describe('ownershipMessage', () => {
  it('is deterministic for the same inputs', () => {
    expect(ownershipMessage(claim(), ctxA)).toEqual(ownershipMessage(claim(), ctxA));
  });

  it('binds the deployment — same claim, different contract/network -> different message', () => {
    expect(ownershipMessage(claim(), ctxA)).not.toEqual(ownershipMessage(claim(), ctxB));
  });

  it('changes when any claim field changes', () => {
    const base = ownershipMessage(claim(), ctxA);
    expect(ownershipMessage(claim({ questId: 2 }), ctxA)).not.toEqual(base);
    expect(ownershipMessage(claim({ timestamp: 1_000_001 }), ctxA)).not.toEqual(base);
    expect(ownershipMessage(claim({ recipient: G2 }), ctxA)).not.toEqual(base);
  });
});

describe('withinFreshness', () => {
  it('accepts a timestamp inside the window and rejects stale/future/non-numeric', () => {
    const now = 1_000_000;
    expect(withinFreshness(now, now)).toBe(true);
    expect(withinFreshness(now, now - 119_000)).toBe(true);
    expect(withinFreshness(now, now - 121_000)).toBe(false);
    expect(withinFreshness(now, now + 121_000)).toBe(false);
    expect(withinFreshness(now, undefined)).toBe(false);
    expect(withinFreshness(now, NaN)).toBe(false);
  });
});

describe('validateEvidence', () => {
  it('rejects missing/unknown types', () => {
    expect(validateEvidence(undefined, G).ok).toBe(false);
    // @ts-expect-error — exercising a bad type at runtime
    expect(validateEvidence({ type: 'nope', ref: 'x' }, G).ok).toBe(false);
  });

  it('bounds the ref length', () => {
    const long = 'a'.repeat(MAX_REF_LEN + 1);
    expect(validateEvidence({ type: 'github_pr', ref: long }, G).ok).toBe(false);
  });

  it('validates github_pr ref format', () => {
    expect(validateEvidence({ type: 'github_pr', ref: 'owner/repo#12' }, G).ok).toBe(true);
    expect(validateEvidence({ type: 'github_pr', ref: 'not-a-ref' }, G).ok).toBe(false);
  });

  it('requires a G-address referral and blocks self-referral', () => {
    expect(validateEvidence({ type: 'referral_tx', ref: G2 }, G).ok).toBe(true);
    expect(validateEvidence({ type: 'referral_tx', ref: 'nope' }, G).ok).toBe(false);
    expect(validateEvidence({ type: 'referral_tx', ref: G }, G)).toEqual({
      ok: false,
      reason: 'cannot refer yourself',
    });
  });
});

describe('isValidQuestId', () => {
  it('accepts non-negative integers in range and rejects the rest', () => {
    expect(isValidQuestId(0)).toBe(true);
    expect(isValidQuestId(42)).toBe(true);
    expect(isValidQuestId(-1)).toBe(false);
    expect(isValidQuestId(1.5)).toBe(false);
    expect(isValidQuestId('1')).toBe(false);
    expect(isValidQuestId(10_000_001)).toBe(false);
  });
});

describe('makeReplayGuard', () => {
  it('accepts a signature once, then rejects the replay until it expires', () => {
    const guard = makeReplayGuard(1000);
    expect(guard.accept('sigA', 0)).toBe(true);
    expect(guard.accept('sigA', 500)).toBe(false); // replay within window
    expect(guard.accept('sigB', 500)).toBe(true); // a different sig is fine
    expect(guard.accept('sigA', 1500)).toBe(true); // expired -> usable again
  });
});

describe('repo allowlist', () => {
  it('parses a CSV list (or null when unset) and gates membership case-insensitively', () => {
    expect(parseRepoAllowlist(undefined)).toBeNull();
    expect(parseRepoAllowlist('')).toBeNull();
    const allow = parseRepoAllowlist('Owner/Repo, foo/bar');
    expect(repoAllowed(allow, 'owner', 'repo')).toBe(true);
    expect(repoAllowed(allow, 'foo', 'bar')).toBe(true);
    expect(repoAllowed(allow, 'evil', 'repo')).toBe(false);
    // no allowlist configured -> any repo passes
    expect(repoAllowed(null, 'anything', 'goes')).toBe(true);
  });
});
