import { describe, it, expect } from 'vitest';
import {
  validateEvidence,
  isValidQuestId,
  parseRepoAllowlist,
  repoAllowed,
  decodeDataEntry,
  judgeReferral,
  evidenceMatchesQuest,
  buildQuestEvidenceMap,
  REFERRAL_MARKER_KEY,
  DEFAULT_QUEST_IDS,
  MAX_QUEST_ID,
  MAX_REF_LEN,
  type ReferralFacts,
  type EvidenceType,
} from './attest';

const G = 'G'.padEnd(56, 'A'); // a syntactically valid G-address (G + 55 base32 chars)
const G2 = 'G'.padEnd(56, 'B');
const C = 'C'.padEnd(56, 'A'); // a syntactically valid smart-account (passkey) address

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

  it('requires a G- or C-address referral and blocks self-referral', () => {
    expect(validateEvidence({ type: 'referral_tx', ref: G2 }, G).ok).toBe(true);
    expect(validateEvidence({ type: 'referral_tx', ref: C }, G).ok).toBe(true);
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

  it('accepts a passkey smart account (C…) ref, bound through the registry', () => {
    expect(validateEvidence({ type: 'referral_tx', ref: C }, G).ok).toBe(true);
  });

  it('rejects a ref that is not a G or C address', () => {
    for (const ref of ['notanaddress', 'M'.padEnd(56, 'A'), `${C}A`, C.toLowerCase()]) {
      expect(validateEvidence({ type: 'referral_tx', ref }, G)).toEqual({
        ok: false,
        reason: 'ref must be a G or C address',
      });
    }
  });

  it('rejects self-referral at the shape level, for a C… recipient too', () => {
    const result = validateEvidence({ type: 'referral_tx', ref: G }, G);
    expect(result).toEqual({ ok: false, reason: 'cannot refer yourself' });
    expect(validateEvidence({ type: 'referral_tx', ref: C }, C).ok).toBe(false);
  });
});

describe('judgeReferral', () => {
  const INVITER = G; // the quest recipient claiming the referral
  const OTHER = 'G'.padEnd(56, 'C');
  const facts = (over: Partial<ReferralFacts> = {}): ReferralFacts => ({
    score: 5n,
    invitedBy: null,
    marker: null,
    ...over,
  });

  it('passes a passkey account whose registry binding names the recipient', () => {
    expect(judgeReferral(facts({ invitedBy: INVITER }), C, INVITER)).toEqual({ ok: true });
  });

  it('rejects a binding to a different inviter with a clear reason', () => {
    expect(judgeReferral(facts({ invitedBy: OTHER }), C, INVITER)).toEqual({
      ok: false,
      reason: 'that wallet was invited by a different account',
    });
  });

  it('lets the write-once binding outrank a classic marker that disagrees', () => {
    expect(judgeReferral(facts({ invitedBy: OTHER, marker: INVITER }), G2, INVITER).ok).toBe(false);
    expect(judgeReferral(facts({ invitedBy: INVITER, marker: OTHER }), G2, INVITER).ok).toBe(true);
  });

  it('keeps the manageData path for an unbound classic account', () => {
    expect(judgeReferral(facts({ marker: INVITER }), G2, INVITER)).toEqual({ ok: true });
    expect(judgeReferral(facts({ marker: OTHER }), G2, INVITER)).toEqual({
      ok: false,
      reason: 'referral marker points to a different referrer — cannot reuse this marker',
    });
    expect(judgeReferral(facts({ marker: G2 }), G2, INVITER)).toEqual({
      ok: false,
      reason: 'referral marker is a self-referral on the referred account',
    });
  });

  it('gives an empty account bound to you nothing', () => {
    for (const bound of [facts({ score: 0n, invitedBy: INVITER }), facts({ score: 0n, marker: INVITER })]) {
      expect(judgeReferral(bound, C, INVITER)).toEqual({
        ok: false,
        reason: 'that wallet hasn’t done anything here yet — no referral credit',
      });
    }
  });

  it('asks them to join through the invite link when neither binding exists', () => {
    const r = judgeReferral(facts(), C, INVITER);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toMatch(/invite link/);
  });

  it('never passes on a lookup it could not make', () => {
    // registry unreadable: even a matching marker waits, the binding might say otherwise
    expect(judgeReferral(facts({ invitedBy: undefined, marker: INVITER }), G2, INVITER)).toEqual({
      ok: false,
      reason: 'couldn’t read who invited that wallet right now — try again',
    });
    expect(judgeReferral(facts({ marker: undefined }), G2, INVITER)).toEqual({
      ok: false,
      reason: 'couldn’t read the referred account right now — try again',
    });
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
