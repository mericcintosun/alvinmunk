import { describe, it, expect } from 'vitest';
import {
  ownershipMessage,
  withinFreshness,
  validateEvidence,
  isValidQuestId,
  makeReplayGuard,
  parseRepoAllowlist,
  repoAllowed,
  decodeDataEntry,
  evidenceMatchesQuest,
  buildQuestEvidenceMap,
  REFERRAL_MARKER_KEY,
  DEFAULT_QUEST_IDS,
  MAX_QUEST_ID,
  MAX_REF_LEN,
  type AttestClaim,
  type EvidenceType,
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

describe('decodeDataEntry', () => {
  it('round-trips a G-address stored as base64 UTF-8', () => {
    const addr = G; // G + 55 'A's — a valid-shaped G-address
    const b64 = Buffer.from(addr, 'utf8').toString('base64');
    expect(decodeDataEntry(b64)).toBe(addr);
  });

  it('returns null for an empty string', () => {
    expect(decodeDataEntry('')).toBeNull();
  });

  it('returns null when the base64 decodes to an empty payload', () => {
    // base64 of empty string
    expect(decodeDataEntry(Buffer.from('', 'utf8').toString('base64'))).toBeNull();
  });

  it('returns null for garbage that is not valid base64-of-address', () => {
    // completely invalid base64 — Buffer.from is lenient but the result is non-null only
    // if there are actual bytes; supply a string that decodes to empty-ish content
    expect(decodeDataEntry('!!!!')).toBeNull(); // '!!!!' -> Buffer is empty after base64 decode
  });

  it('is exported and the REFERRAL_MARKER_KEY constant is "referral"', () => {
    expect(REFERRAL_MARKER_KEY).toBe('referral');
  });
});

describe('validateEvidence — referral_tx on-chain marker', () => {
  it('accepts a valid referral_tx with a different G-address ref', () => {
    expect(validateEvidence({ type: 'referral_tx', ref: G2 }, G).ok).toBe(true);
  });

  it('rejects when ref is not a G-address (C-address, arbitrary string)', () => {
    const C = 'C'.padEnd(56, 'A');
    expect(validateEvidence({ type: 'referral_tx', ref: C }, G).ok).toBe(false);
    expect(validateEvidence({ type: 'referral_tx', ref: 'notanaddress' }, G).ok).toBe(false);
  });

  it('rejects self-referral at the shape level', () => {
    const result = validateEvidence({ type: 'referral_tx', ref: G }, G);
    expect(result).toEqual({ ok: false, reason: 'cannot refer yourself' });
  });
});

describe('referral marker round-trip invariant', () => {
  // Mirrors what the attester does: encode the referrer address, then decode and compare.
  it('encodes referrer address → base64 → decodes back to the same address', () => {
    const referrer = G2;
    const encoded = Buffer.from(referrer, 'utf8').toString('base64');
    const decoded = decodeDataEntry(encoded);
    expect(decoded).toBe(referrer);
    // A different referrer's address must NOT match
    const otherEncoded = Buffer.from(G, 'utf8').toString('base64');
    expect(decodeDataEntry(otherEncoded)).not.toBe(referrer);
  });
});

describe('evidenceMatchesQuest', () => {
  const map = new Map<number, EvidenceType>([
    [1, 'referral_tx'],
    [3, 'invite_converts'],
    [4, 'vouch_back'],
    [5, 'github_pr'],
  ]);

  it('accepts the evidence type configured for the quest id', () => {
    expect(evidenceMatchesQuest(1, 'referral_tx', map)).toBe(true);
    expect(evidenceMatchesQuest(3, 'invite_converts', map)).toBe(true);
    expect(evidenceMatchesQuest(4, 'vouch_back', map)).toBe(true);
    expect(evidenceMatchesQuest(5, 'github_pr', map)).toBe(true);
  });

  it('rejects a mismatch — the vulnerability this fix closes', () => {
    // a vouch_back wallet reusing its evidence for the referral / invite quests
    expect(evidenceMatchesQuest(1, 'vouch_back', map)).toBe(false);
    expect(evidenceMatchesQuest(3, 'vouch_back', map)).toBe(false);
    expect(evidenceMatchesQuest(4, 'referral_tx', map)).toBe(false);
  });

  it('rejects a quest id that isn’t in the map', () => {
    expect(evidenceMatchesQuest(2, 'referral_tx', map)).toBe(false);
    expect(evidenceMatchesQuest(999, 'vouch_back', map)).toBe(false);
  });

  it('rejects every type when the map is empty', () => {
    const empty = new Map<number, EvidenceType>();
    expect(evidenceMatchesQuest(1, 'referral_tx', empty)).toBe(false);
  });
});

describe('buildQuestEvidenceMap', () => {
  it('maps each configured env var to its evidence type', () => {
    const map = buildQuestEvidenceMap({
      NEXT_PUBLIC_DEFAULT_QUEST_ID: '7',
      NEXT_PUBLIC_INVITE_QUEST_ID: '8',
      NEXT_PUBLIC_VOUCHBACK_QUEST_ID: '9',
      QUEST_GITHUB_ID: '1',
    });
    expect([...map.entries()].sort(([a], [b]) => a - b)).toEqual([
      [1, 'github_pr'],
      [7, 'referral_tx'],
      [8, 'invite_converts'],
      [9, 'vouch_back'],
    ]);
  });

  it('falls back to the dashboard defaults when unset or blank, with github_pr unmapped', () => {
    const expected = [
      [2, 'referral_tx'],
      [3, 'invite_converts'],
      [4, 'vouch_back'],
    ];
    const sorted = (m: Map<number, EvidenceType>) => [...m.entries()].sort(([a], [b]) => a - b);
    expect(sorted(buildQuestEvidenceMap({}))).toEqual(expected);
    expect(
      sorted(
        buildQuestEvidenceMap({
          NEXT_PUBLIC_DEFAULT_QUEST_ID: '',
          NEXT_PUBLIC_INVITE_QUEST_ID: '  ',
          QUEST_GITHUB_ID: '',
        }),
      ),
    ).toEqual(expected);
    expect(DEFAULT_QUEST_IDS).toEqual({ referral_tx: 2, invite_converts: 3, vouch_back: 4 });
  });

  it('leaves a type unmapped when its value is not a plain quest id (no fallback)', () => {
    const map = buildQuestEvidenceMap({
      NEXT_PUBLIC_DEFAULT_QUEST_ID: 'not-a-number',
      NEXT_PUBLIC_INVITE_QUEST_ID: '-1',
      NEXT_PUBLIC_VOUCHBACK_QUEST_ID: '4.5',
      QUEST_GITHUB_ID: String(MAX_QUEST_ID + 1),
    });
    expect(map.size).toBe(0);
    expect(buildQuestEvidenceMap({ QUEST_GITHUB_ID: '0x10' }).has(16)).toBe(false);
  });

  it('drops a quest id configured for two types, so it binds to none (fail closed)', () => {
    const map = buildQuestEvidenceMap({ QUEST_GITHUB_ID: '2' }); // collides with the referral default
    expect(map.has(2)).toBe(false);
    expect(evidenceMatchesQuest(2, 'referral_tx', map)).toBe(false);
    expect(evidenceMatchesQuest(2, 'github_pr', map)).toBe(false);
    expect(map.get(3)).toBe('invite_converts');
  });
});
