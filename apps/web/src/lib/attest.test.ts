// @vitest-environment node
// The quest payload is built and signed with stellar-sdk, which needs Node's own Uint8Array;
// jsdom's cross-realm one fails the SDK's checks.
import { describe, it, expect } from 'vitest';
import { Keypair, StrKey } from '@stellar/stellar-sdk';
import {
  questPayload,
  signQuestPayload,
  validateEvidence,
  isValidQuestId,
  parseRepoAllowlist,
  repoAllowed,
  prBodyNamesRecipient,
  addressesInText,
  decodeDataEntry,
  judgeReferral,
  judgeFirstTip,
  judgeFirstTips,
  evidenceMatchesQuest,
  buildQuestEvidenceMap,
  REFERRAL_MARKER_KEY,
  DEFAULT_QUEST_IDS,
  MAX_QUEST_ID,
  MAX_REF_LEN,
  QUEST_AWARD_DOMAIN,
  QUEST_AWARD_DOMAIN_V2,
  QUEST_SIG_TTL_SECS,
  FRESH_EVIDENCE,
  TIP_FLOOR_STROOPS,
  FIRST_TIP_REJECTIONS,
  WEEK_SECS,
  questWindow,
  signatureExpiry,
  type ReferralFacts,
  type TipFacts,
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

  it('accepts first_tip with no ref, like vouch_back', () => {
    expect(validateEvidence({ type: 'first_tip', ref: '' }, G)).toEqual({ ok: true });
    expect(validateEvidence({ type: 'first_tip', ref: '' }, C)).toEqual({ ok: true });
    // The ref is never read for first_tip (the tip comes off the chain), so whatever a client
    // puts there changes nothing.
    expect(validateEvidence({ type: 'first_tip', ref: G2 }, G)).toEqual({ ok: true });
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
    // Fail closed (#163): no allowlist means no repo is eligible.
    expect(repoAllowed(null, 'anything', 'goes')).toBe(false);
  });
});

describe('github_pr body binding (#163)', () => {
  const ME = Keypair.random().publicKey();
  const OTHER = Keypair.random().publicKey();
  const MY_C = StrKey.encodeContract(Buffer.alloc(32, 4));
  // A 56-char G… token whose checksum is wrong: not an address anyone can hold.
  const LOOKALIKE = `${ME.slice(0, -1)}${ME.endsWith('A') ? 'B' : 'A'}`;

  it('accepts a body naming only the recipient — repeated, in prose, a link or a comment', () => {
    for (const body of [
      ME,
      `Closes #12\n\nStellar: ${ME}`,
      `wallet ${ME}, again: ${ME}.`,
      `https://stellar.expert/explorer/testnet/account/${ME}`,
      `<!-- ${ME} -->`,
    ]) {
      expect(prBodyNamesRecipient(body, ME)).toEqual({ ok: true });
    }
    expect(prBodyNamesRecipient(`passkey wallet: ${MY_C}`, MY_C)).toEqual({ ok: true });
  });

  it('rejects someone else’s PR: its body names another wallet', () => {
    const res = prBodyNamesRecipient(`reward ${OTHER}`, ME);
    expect(res).toMatchObject({ ok: false, reason: expect.stringMatching(/not yours/) });
  });

  it('rejects a body naming two different addresses, even if one is the recipient', () => {
    for (const body of [`${ME} ${OTHER}`, `${OTHER}\n<!-- ${ME} -->`, `${ME} and ${MY_C}`]) {
      expect(prBodyNamesRecipient(body, ME)).toMatchObject({
        ok: false,
        reason: expect.stringMatching(/more than one/),
      });
    }
  });

  it('rejects a body without the address: empty, null, lowercased, or glued into a longer token', () => {
    for (const body of [null, undefined, '', 'no wallet here', ME.toLowerCase(), `X${ME}`, `${ME}Q`, `${ME}2`]) {
      expect(prBodyNamesRecipient(body, ME)).toMatchObject({
        ok: false,
        reason: expect.stringMatching(/must include your Stellar address/),
      });
    }
  });

  it('ignores lookalike tokens with a bad checksum', () => {
    expect(addressesInText(`${LOOKALIKE} ${ME}`)).toEqual([ME]);
    expect(prBodyNamesRecipient(`${LOOKALIKE} ${ME}`, ME)).toEqual({ ok: true });
    // …and a lookalike of the recipient is not the recipient.
    expect(prBodyNamesRecipient(LOOKALIKE, ME)).toMatchObject({ ok: false });
  });

  it('lists each distinct valid address once, G… and C…', () => {
    expect(addressesInText(`${ME} ${MY_C} ${ME}`)).toEqual([ME, MY_C]);
    expect(addressesInText(null)).toEqual([]);
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

describe('judgeFirstTip', () => {
  const RECIPIENT = G;
  const FRIEND = G2;
  const facts = (over: Partial<TipFacts> = {}): TipFacts => ({
    to: FRIEND,
    amount: TIP_FLOOR_STROOPS,
    usdc: true,
    connected: true,
    frozen: false,
    ...over,
  });
  const code = (f: TipFacts) => {
    const verdict = judgeFirstTip(f, RECIPIENT);
    return verdict.ok ? 'ok' : verdict.code;
  };
  const reason = (f: TipFacts) => {
    const verdict = judgeFirstTip(f, RECIPIENT);
    return verdict.ok ? '' : verdict.reason;
  };

  it('passes a floor-sized USDC tip to a connected, unfrozen wallet', () => {
    expect(judgeFirstTip(facts(), RECIPIENT)).toEqual({ ok: true });
    expect(judgeFirstTip(facts({ amount: TIP_FLOOR_STROOPS + 1n }), RECIPIENT)).toEqual({
      ok: true,
    });
    expect(judgeFirstTip(facts({ to: C }), RECIPIENT)).toEqual({ ok: true }); // a passkey friend
  });

  it('keeps the floor at 0.5 USDC (7 decimals)', () => {
    expect(TIP_FLOOR_STROOPS).toBe(5_000_000n);
  });

  it('rejects a self-tip', () => {
    expect(code(facts({ to: RECIPIENT }))).toBe('self');
    expect(reason(facts({ to: RECIPIENT }))).toBe('a tip to your own wallet doesn’t count');
  });

  it('rejects a tip that did not move the configured USDC', () => {
    expect(code(facts({ usdc: false }))).toBe('not_usdc');
    expect(reason(facts({ usdc: false }))).toMatch(/USDC/);
  });

  it('rejects a tip below the floor, one stroop short included', () => {
    expect(code(facts({ amount: TIP_FLOOR_STROOPS - 1n }))).toBe('below_floor');
    expect(code(facts({ amount: 0n }))).toBe('below_floor');
    expect(code(facts({ amount: -TIP_FLOOR_STROOPS }))).toBe('below_floor');
    expect(reason(facts({ amount: 1n }))).toMatch(/0\.5 USDC/);
  });

  it('rejects a tip to an unconnected wallet with a reason', () => {
    expect(code(facts({ connected: false }))).toBe('unconnected');
    expect(reason(facts({ connected: false }))).toMatch(/connected to/);
  });

  it('rejects a tip to a frozen wallet', () => {
    expect(code(facts({ frozen: true }))).toBe('frozen');
    expect(reason(facts({ frozen: true }))).toMatch(/frozen/);
  });

  it('never takes a freeze status it did not read as unfrozen', () => {
    expect(code(facts({ frozen: undefined }))).toBe('unread');
    expect(reason(facts({ frozen: undefined }))).toMatch(/try again/);
  });

  it('checks in a fixed order, so a tip fails on the first thing wrong with it', () => {
    const bad = { to: RECIPIENT, usdc: false, amount: 1n, connected: false, frozen: true };
    expect(code(facts(bad))).toBe('self');
    expect(code(facts({ ...bad, to: FRIEND }))).toBe('not_usdc');
    expect(code(facts({ ...bad, to: FRIEND, usdc: true }))).toBe('below_floor');
    expect(code(facts({ ...bad, to: FRIEND, usdc: true, amount: TIP_FLOOR_STROOPS }))).toBe(
      'unconnected',
    );
    expect(FIRST_TIP_REJECTIONS).toEqual([
      'self',
      'not_usdc',
      'below_floor',
      'unconnected',
      'frozen',
      'unread',
    ]);
  });
});

describe('judgeFirstTips', () => {
  const RECIPIENT = G;
  const tip = (over: Partial<TipFacts> = {}): TipFacts => ({
    to: G2,
    amount: TIP_FLOOR_STROOPS,
    usdc: true,
    connected: true,
    frozen: false,
    ...over,
  });

  it('says so when the recipient never tipped', () => {
    const r = judgeFirstTips([], RECIPIENT);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toMatch(/haven’t tipped anyone/);
  });

  it('passes when any one tip passes', () => {
    expect(
      judgeFirstTips([tip({ amount: 1n }), tip({ connected: false }), tip()], RECIPIENT),
    ).toEqual({
      ok: true,
    });
  });

  it('reports the tip that got furthest through the checks', () => {
    const r = judgeFirstTips(
      [
        tip({ to: RECIPIENT }),
        tip({ amount: 1n }),
        tip({ connected: false }),
        tip({ usdc: false }),
      ],
      RECIPIENT,
    );
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toMatch(/connected to/);
    const frozen = judgeFirstTips([tip({ connected: false }), tip({ frozen: true })], RECIPIENT);
    expect(!frozen.ok && frozen.reason).toMatch(/frozen/);
    const only = judgeFirstTips([tip({ amount: TIP_FLOOR_STROOPS - 1n })], RECIPIENT);
    expect(!only.ok && only.reason).toMatch(/0\.5 USDC/);
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
      NEXT_PUBLIC_FIRST_TIP_QUEST_ID: '5',
      QUEST_GITHUB_ID: '1',
    });
    expect([...map.entries()].sort(([a], [b]) => a - b)).toEqual([
      [1, 'github_pr'],
      [5, 'first_tip'],
      [7, 'referral_tx'],
      [8, 'invite_converts'],
      [9, 'vouch_back'],
    ]);
  });

  it('falls back to the dashboard defaults when unset or blank, with github_pr and first_tip unmapped', () => {
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

// ── quest award payload (issue #142) ──

const QUEST_CONTRACT = 'CAIRCEIRCEIRCEIRCEIRCEIRCEIRCEIRCEIRCEIRCEIRCEIRCEIRDB3V'; // 32 × 0x11
const CLASSIC = 'GARCEIRCEIRCEIRCEIRCEIRCEIRCEIRCEIRCEIRCEIRCEIRCEIRCFRVX'; // 32 × 0x22
const PASSKEY = 'CAZTGMZTGMZTGMZTGMZTGMZTGMZTGMZTGMZTGMZTGMZTGMZTGMZTGGJH'; // 32 × 0x33
const TESTNET = { contractId: QUEST_CONTRACT, passphrase: 'Test SDF Network ; September 2015' };
const MAINNET = { contractId: QUEST_CONTRACT, passphrase: 'Public Global Stellar Network ; September 2015' };
const EXPIRES_AT = 1_790_813_400; // 2026-10-01 00:10:00 UTC

/** Quest 3's award payload on testnet from QUEST_CONTRACT, valid through EXPIRES_AT — the
 *  same bytes contracts/quest_registry/src/test.rs pins for the contract's `payload`. */
const AWARD_PAYLOAD_HEAD = [
  '000000100000000100000006', // vec of 6
  '0000000f00000018616c76696e6d756e6b5f61776172645f71756573745f7631', // Symbol("alvinmunk_award_quest_v1")
  '0000000d00000020cee0302d59844d32bdca915c8203dd44b33fbb7edc19051ea37abedf28ecd472', // BytesN<32> network id
  '00000012000000011111111111111111111111111111111111111111111111111111111111111111', // Address, contract
  '0000000300000003', // u32 quest id
].join('');
const AWARD_EXPIRES_AT = '00000005000000006abda4d8'; // u64 expires_at
const AWARD_PAYLOAD_G =
  AWARD_PAYLOAD_HEAD +
  '0000001200000000000000002222222222222222222222222222222222222222222222222222222222222222' +
  AWARD_EXPIRES_AT;
const AWARD_PAYLOAD_C =
  AWARD_PAYLOAD_HEAD + '00000012000000013333333333333333333333333333333333333333333333333333333333333333' + AWARD_EXPIRES_AT;

const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');

describe('questPayload', () => {
  it("is the contract's award payload byte for byte, for classic and passkey recipients", () => {
    expect(QUEST_AWARD_DOMAIN).toBe('alvinmunk_award_quest_v1');
    expect(hex(questPayload(TESTNET, 3, CLASSIC, EXPIRES_AT))).toBe(AWARD_PAYLOAD_G);
    expect(hex(questPayload(TESTNET, 3, PASSKEY, EXPIRES_AT))).toBe(AWARD_PAYLOAD_C);
  });

  it('changes with the network, contract, quest, recipient and expiry', () => {
    const base = hex(questPayload(TESTNET, 3, CLASSIC, EXPIRES_AT));
    const variants = [
      questPayload(MAINNET, 3, CLASSIC, EXPIRES_AT),
      questPayload({ ...TESTNET, contractId: PASSKEY }, 3, CLASSIC, EXPIRES_AT),
      questPayload(TESTNET, 4, CLASSIC, EXPIRES_AT),
      questPayload(TESTNET, 3, PASSKEY, EXPIRES_AT),
      questPayload(TESTNET, 3, CLASSIC, EXPIRES_AT + 1),
    ].map(hex);
    for (const v of variants) expect(v).not.toBe(base);
    expect(new Set(variants).size).toBe(variants.length);
  });
});

describe('signQuestPayload', () => {
  const kp = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 7));

  it('returns the attester key, its signature over the payload, and the signed expiry', () => {
    const signed = signQuestPayload(kp.secret(), TESTNET, 3, CLASSIC, EXPIRES_AT);
    expect(signed.attester).toBe(kp.rawPublicKey().toString('hex'));
    expect(signed.attester).toMatch(/^[0-9a-f]{64}$/);
    expect(signed.expiresAt).toBe(EXPIRES_AT);
    const sig = Buffer.from(signed.sig, 'base64');
    expect(sig).toHaveLength(64);
    expect(kp.verify(questPayload(TESTNET, 3, CLASSIC, EXPIRES_AT), sig)).toBe(true);
  });

  it('signs a grant that does not verify with a stretched expiry or for anyone else', () => {
    const sig = Buffer.from(signQuestPayload(kp.secret(), TESTNET, 3, CLASSIC, EXPIRES_AT).sig, 'base64');
    expect(kp.verify(questPayload(TESTNET, 3, CLASSIC, EXPIRES_AT + QUEST_SIG_TTL_SECS), sig)).toBe(false);
    expect(kp.verify(questPayload(TESTNET, 3, PASSKEY, EXPIRES_AT), sig)).toBe(false);
    expect(kp.verify(questPayload(MAINNET, 3, CLASSIC, EXPIRES_AT), sig)).toBe(false);
  });
});

// ── repeatable quests: the period window (issue #154) ──

const THU_2026_10_01 = 1_790_812_800; // a week boundary: 2961 × WEEK_SECS

/** Quest 3's WEEKLY award payload in week 2961 — the bytes
 *  contracts/quest_registry/src/test.rs pins as AWARD_V2_PAYLOAD. */
const AWARD_V2_PAYLOAD_G = [
  '000000100000000100000008', // vec of 8
  '0000000f00000018616c76696e6d756e6b5f61776172645f71756573745f7632', // Symbol("alvinmunk_award_quest_v2")
  '0000000d00000020cee0302d59844d32bdca915c8203dd44b33fbb7edc19051ea37abedf28ecd472', // BytesN<32> network id
  '00000012000000011111111111111111111111111111111111111111111111111111111111111111', // Address, contract
  '0000000300000003', // u32 quest id
  '0000001200000000000000002222222222222222222222222222222222222222222222222222222222222222', // Address, account
  '000000050000000000093a80', // u64 period_secs = 604_800
  '000000050000000000000b91', // u64 epoch = 2961
  AWARD_EXPIRES_AT, // u64 expires_at
].join('');

describe('questWindow', () => {
  it('is null for a one-shot quest', () => {
    expect(questWindow(THU_2026_10_01, 0)).toBeNull();
    expect(questWindow(THU_2026_10_01, -1)).toBeNull();
  });

  it("derives the contract's epoch and the period's first and last second", () => {
    const week = { periodSecs: WEEK_SECS, epoch: 2961, start: THU_2026_10_01, end: THU_2026_10_01 + WEEK_SECS - 1 };
    expect(questWindow(THU_2026_10_01, WEEK_SECS)).toEqual(week);
    expect(questWindow(THU_2026_10_01 + WEEK_SECS - 1, WEEK_SECS)).toEqual(week);
    expect(questWindow(THU_2026_10_01 + WEEK_SECS, WEEK_SECS)?.epoch).toBe(2962);
    expect(questWindow(THU_2026_10_01 - 1, WEEK_SECS)?.epoch).toBe(2960);
  });
});

describe('signatureExpiry', () => {
  it('is QUEST_SIG_TTL_SECS ahead, but never past the end of a repeatable period', () => {
    const now = THU_2026_10_01 + 100;
    expect(signatureExpiry(now, null)).toBe(now + QUEST_SIG_TTL_SECS);
    expect(signatureExpiry(now, questWindow(now, WEEK_SECS))).toBe(now + QUEST_SIG_TTL_SECS);
    const late = THU_2026_10_01 + WEEK_SECS - 60;
    expect(signatureExpiry(late, questWindow(late, WEEK_SECS))).toBe(THU_2026_10_01 + WEEK_SECS - 1);
  });
});

describe('questPayload for a repeatable quest', () => {
  const week = questWindow(THU_2026_10_01, WEEK_SECS);

  it("is the contract's v2 payload byte for byte", () => {
    expect(QUEST_AWARD_DOMAIN_V2).toBe('alvinmunk_award_quest_v2');
    expect(hex(questPayload(TESTNET, 3, CLASSIC, EXPIRES_AT, week))).toBe(AWARD_V2_PAYLOAD_G);
    // A one-shot quest's bytes are unchanged.
    expect(hex(questPayload(TESTNET, 3, CLASSIC, EXPIRES_AT, null))).toBe(AWARD_PAYLOAD_G);
  });

  it('binds the signature to its period', () => {
    const kp = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 7));
    const sig = Buffer.from(signQuestPayload(kp.secret(), TESTNET, 3, CLASSIC, EXPIRES_AT, week).sig, 'base64');
    expect(kp.verify(questPayload(TESTNET, 3, CLASSIC, EXPIRES_AT, week), sig)).toBe(true);
    const next = questWindow(THU_2026_10_01 + WEEK_SECS, WEEK_SECS);
    const daily = questWindow(THU_2026_10_01, 86_400);
    for (const other of [next, daily, null]) {
      expect(kp.verify(questPayload(TESTNET, 3, CLASSIC, EXPIRES_AT, other), sig)).toBe(false);
    }
  });

  it('only takes evidence the attester can date', () => {
    expect([...FRESH_EVIDENCE].sort()).toEqual(['github_pr', 'invite_converts', 'vouch_back']);
    expect(FRESH_EVIDENCE.has('referral_tx')).toBe(false);
    // A first tip is one-shot: a repeatable quest must never pay the same tip every period.
    expect(FRESH_EVIDENCE.has('first_tip')).toBe(false);
  });
});
