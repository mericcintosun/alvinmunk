// @vitest-environment node
// Claim keys hash and sign with stellar-sdk, which needs Node's own Uint8Array; jsdom's
// cross-realm one fails the SDK's checks.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Keypair, StrKey } from '@stellar/stellar-sdk';

const readPublicMock = vi.fn();
const { invokeMock, REP_ID, TESTNET } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  // 32 × 0x11 as a contract strkey — the contract of the shared claim-message vector.
  REP_ID: 'CAIRCEIRCEIRCEIRCEIRCEIRCEIRCEIRCEIRCEIRCEIRCEIRCEIRDB3V',
  TESTNET: 'Test SDF Network ; September 2015',
}));

vi.mock('./stellar', () => ({ networkPassphrase: TESTNET }));
vi.mock('./contracts', () => ({
  repId: () => REP_ID,
  questId: () => 'CQUESTID',
  readPublic: (...a: unknown[]) => readPublicMock(...a),
  readContract: vi.fn(),
  invokeAndWait: (...a: unknown[]) => invokeMock(...a),
  args: {
    addr: (g: string) => ({ __addr: g }),
    u64: (n: number) => ({ __u64: n }),
    str: (s: string) => ({ __str: s }),
    bytes: (b: Uint8Array) => ({ __bytes: b }),
  },
}));

import {
  claimLink,
  claimMessage,
  claimPublicKey,
  claimVouch,
  claimVouchSigned,
  clampVouchNote,
  isClaimCode,
  mintVouch,
  parseClaimCode,
  signClaim,
  fromHex,
  toHex,
  getCounts,
  getPending,
  getProfile,
  getScores,
  VOUCH_NOTE_MAX_BYTES,
  VOUCH_NOTE_MAX_CHARS,
  vouchNoteBytes,
} from './reputation';

function expectBytes(actual: Uint8Array, expected: number[]) {
  expect(Array.from(actual)).toEqual(expected);
}

describe('claim-secret hex helpers', () => {
  it('round-trips random 32-byte inputs', () => {
    for (let seed = 0; seed < 32; seed++) {
      const bytes = new Uint8Array(32);
      for (let i = 0; i < bytes.length; i++) {
        bytes[i] = (seed * 73 + i * 29 + i * i) & 0xff;
      }

      expect(fromHex(toHex(bytes))).toEqual(bytes);
    }
  });

  it('uses lowercase hex and preserves leading zero bytes', () => {
    const bytes = new Uint8Array([0x00, 0x0a, 0xab, 0xff]);

    expect(toHex(bytes)).toBe('000aabff');
    expect(fromHex('000AABFF')).toEqual(bytes);
  });

  it('ignores an incomplete trailing nibble', () => {
    expectBytes(fromHex('abc'), [0xab]);
  });

  it('coerces non-hex byte pairs to zero', () => {
    expectBytes(fromHex('zz01'), [0, 1]);
  });

  it('returns no bytes for an empty string', () => {
    expectBytes(fromHex(''), []);
  });
});

describe('vouch note limit', () => {
  it('mirrors the contract cap: 240 bytes, 60 characters', () => {
    expect(VOUCH_NOTE_MAX_BYTES).toBe(240);
    expect(VOUCH_NOTE_MAX_CHARS).toBe(60);
  });

  it('counts UTF-8 bytes like the contract', () => {
    expect(vouchNoteBytes('abc')).toBe(3);
    expect(vouchNoteBytes('ş')).toBe(2);
    expect(vouchNoteBytes('€')).toBe(3);
    expect(vouchNoteBytes('💧')).toBe(4);
  });

  it('keeps a note of 60 characters, one-byte or four-byte alike', () => {
    for (const ch of ['a', 'ş', '€', '💧']) {
      const note = ch.repeat(60);
      expect(clampVouchNote(note)).toBe(note);
      expect(clampVouchNote(note + ch)).toBe(note);
    }
    // 60 four-byte characters are exactly the contract's cap.
    expect(vouchNoteBytes(clampVouchNote('💧'.repeat(61)))).toBe(VOUCH_NOTE_MAX_BYTES);
  });

  it('never cuts a character in half', () => {
    // 59 ASCII + a 4-byte emoji fits; the emoji is character 60 and stays whole.
    const note = `${'a'.repeat(59)}💧`;
    expect(clampVouchNote(`${note}💧`)).toBe(note);
    expect(clampVouchNote('💧'.repeat(70))).not.toMatch(/[\uD800-\uDFFF]$/u);
  });

  it('always fits the contract cap', () => {
    for (const s of [
      'x'.repeat(500),
      'ş'.repeat(500),
      '€'.repeat(500),
      '🌟'.repeat(500),
      '👍🏽'.repeat(100),
    ]) {
      expect(vouchNoteBytes(clampVouchNote(s))).toBeLessThanOrEqual(VOUCH_NOTE_MAX_BYTES);
    }
  });

  it('leaves short notes alone', () => {
    expect(clampVouchNote('')).toBe('');
    expect(clampVouchNote('unblocked me at 2am ✨')).toBe('unblocked me at 2am ✨');
  });
});

describe('getProfile', () => {
  beforeEach(() => readPublicMock.mockReset());

  it('maps the aggregate view to a typed ProfileView', async () => {
    readPublicMock.mockResolvedValueOnce({ social: 30n, earned: 50n, verified: true });
    const p = await getProfile('GADDR');
    expect(p).toEqual({ social: 30, earned: 50, verified: true });
    expect(readPublicMock).toHaveBeenCalledWith(REP_ID, 'get_profile', expect.any(Array));
  });

  it('defaults missing fields to zero/false', async () => {
    readPublicMock.mockResolvedValueOnce(undefined);
    const p = await getProfile('GADDR');
    expect(p).toEqual({ social: 0, earned: 0, verified: false });
  });

  it('shares one get_profile read between widgets asking at the same time', async () => {
    readPublicMock.mockResolvedValue({ social: 1n, earned: 2n, verified: true });
    const [a, b] = await Promise.all([getProfile('GADDR'), getProfile('GADDR')]);
    expect(a).toEqual(b);
    expect(readPublicMock).toHaveBeenCalledTimes(1);
    await getProfile('GADDR'); // settled → the next read is fresh
    expect(readPublicMock).toHaveBeenCalledTimes(2);
  });
});

describe('getScores', () => {
  beforeEach(() => readPublicMock.mockReset());

  it('prefers the single get_profile call (1 round-trip)', async () => {
    readPublicMock.mockResolvedValueOnce({ social: 15n, earned: 5n, verified: false });
    const s = await getScores('GADDR');
    expect(s).toEqual({ social: 15, earned: 5 });
    expect(readPublicMock).toHaveBeenCalledTimes(1);
  });

  it('falls back to get_score + get_earned when get_profile is unavailable', async () => {
    readPublicMock
      .mockRejectedValueOnce(new Error('unknown method get_profile'))
      .mockResolvedValueOnce(12n) // get_score
      .mockResolvedValueOnce(8n); // get_earned
    const s = await getScores('GADDR');
    expect(s).toEqual({ social: 12, earned: 8 });
    expect(readPublicMock).toHaveBeenCalledTimes(3);
  });
});

describe('getCounts', () => {
  beforeEach(() => readPublicMock.mockReset());

  it('maps the (vouched_by, backed) tuple', async () => {
    readPublicMock.mockResolvedValueOnce([3, 1]);
    expect(await getCounts('GADDR')).toEqual({ vouchedBy: 3, backed: 1 });
    expect(readPublicMock).toHaveBeenCalledWith(REP_ID, 'get_counts', expect.any(Array));
  });

  it('is null, not zero, when the contract predates get_counts', async () => {
    readPublicMock.mockRejectedValueOnce(new Error('simulate get_counts failed: MissingValue'));
    expect(await getCounts('GADDR')).toBeNull();
  });

  it('is null for an empty return value', async () => {
    readPublicMock.mockResolvedValueOnce(undefined);
    expect(await getCounts('GADDR')).toBeNull();
  });
});

describe('getPending', () => {
  beforeEach(() => readPublicMock.mockReset());

  it('maps the queued PendingBonus entries', async () => {
    readPublicMock.mockResolvedValueOnce([
      { voucher: 'GALICE', amount: 5n },
      { voucher: 'GCAROL', amount: 5n },
    ]);
    expect(await getPending('GBOB')).toEqual([
      { voucher: 'GALICE', amount: 5 },
      { voucher: 'GCAROL', amount: 5 },
    ]);
    expect(readPublicMock).toHaveBeenCalledWith(REP_ID, 'get_pending', expect.any(Array));
  });

  it('is empty once the claimer has verified', async () => {
    readPublicMock.mockResolvedValueOnce([]);
    expect(await getPending('GBOB')).toEqual([]);
  });

  it('rejects when the contract predates get_pending, instead of reading as nothing owed', async () => {
    readPublicMock.mockRejectedValueOnce(new Error('simulate get_pending failed: MissingValue'));
    await expect(getPending('GBOB')).rejects.toThrow('get_pending');
  });
});

// ── claim keys (issue #121) ──

const CLASSIC = 'GARCEIRCEIRCEIRCEIRCEIRCEIRCEIRCEIRCEIRCEIRCEIRCEIRCFRVX'; // 32 × 0x22
const PASSKEY = 'CAZTGMZTGMZTGMZTGMZTGMZTGMZTGMZTGMZTGMZTGMZTGMZTGMZTGGJH'; // 32 × 0x33
const MAINNET = 'Public Global Stellar Network ; September 2015';

/** Vouch 7's claim message on testnet from REP_ID — the same bytes
 *  contracts/reputation/src/test.rs pins for the contract's `claim_message`. */
const CLAIM_MESSAGE_HEAD = [
  '000000100000000100000005', // vec of 5
  '0000000f00000015616c76696e6d756e6b5f766f7563685f636c61696d000000', // Symbol("alvinmunk_vouch_claim")
  '0000000d00000020cee0302d59844d32bdca915c8203dd44b33fbb7edc19051ea37abedf28ecd472', // BytesN<32> network id
  '00000012000000011111111111111111111111111111111111111111111111111111111111111111', // Address, contract
  '000000050000000000000007', // u64 vouch id
].join('');
const CLAIM_MESSAGE_G =
  CLAIM_MESSAGE_HEAD + '0000001200000000000000002222222222222222222222222222222222222222222222222222222222222222';
const CLAIM_MESSAGE_C =
  CLAIM_MESSAGE_HEAD + '00000012000000013333333333333333333333333333333333333333333333333333333333333333';

// RFC 8032 §7.1, test 1: an ed25519 seed and its public key.
const RFC_SEED = '9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60';
const RFC_PUBLIC = 'd75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a';

function verifies(publicKey: Uint8Array, message: Uint8Array, sig: Uint8Array): boolean {
  const kp = Keypair.fromPublicKey(StrKey.encodeEd25519PublicKey(Buffer.from(publicKey)));
  return kp.verify(Buffer.from(message), Buffer.from(sig));
}

describe('claimMessage', () => {
  it("is the contract's claim message byte for byte, for classic and passkey claimers", () => {
    expect(toHex(claimMessage(TESTNET, REP_ID, 7, CLASSIC))).toBe(CLAIM_MESSAGE_G);
    expect(toHex(claimMessage(TESTNET, REP_ID, 7, PASSKEY))).toBe(CLAIM_MESSAGE_C);
  });
});

describe('signClaim', () => {
  const seed = fromHex(RFC_SEED);

  it('derives the standard ed25519 public key from the seed', () => {
    expect(toHex(claimPublicKey(seed))).toBe(RFC_PUBLIC);
  });

  it('signs a claim that verifies for the claimer, card, contract and network it names only', () => {
    const pub = claimPublicKey(seed);
    const sig = signClaim(seed, TESTNET, REP_ID, 7, CLASSIC);
    expect(verifies(pub, claimMessage(TESTNET, REP_ID, 7, CLASSIC), sig)).toBe(true);
    // A front-runner's address, another card, another deployment, another network.
    expect(verifies(pub, claimMessage(TESTNET, REP_ID, 7, PASSKEY), sig)).toBe(false);
    expect(verifies(pub, claimMessage(TESTNET, REP_ID, 8, CLASSIC), sig)).toBe(false);
    expect(verifies(pub, claimMessage(TESTNET, PASSKEY, 7, CLASSIC), sig)).toBe(false);
    expect(verifies(pub, claimMessage(MAINNET, REP_ID, 7, CLASSIC), sig)).toBe(false);
  });
});

describe('vouch mint and claim', () => {
  const wallet = { address: CLASSIC } as Parameters<typeof mintVouch>[0];

  beforeEach(() => invokeMock.mockReset());

  it('mints with the public key of a fresh seed and hands the seed back for the link', async () => {
    invokeMock.mockResolvedValue(7n);
    const { id, seed } = await mintVouch(wallet, 'gm');

    expect(id).toBe(7);
    expect(isClaimCode(seed)).toBe(true);
    expect(invokeMock).toHaveBeenCalledWith(
      REP_ID,
      'mint_vouch_signed',
      [{ __addr: CLASSIC }, { __bytes: claimPublicKey(fromHex(seed)) }, { __str: 'gm' }],
      wallet,
    );
    expect(JSON.stringify(invokeMock.mock.calls)).not.toContain(seed);
    // Every mint gets its own key.
    const again = await mintVouch(wallet, 'gm');
    expect(again.seed).not.toBe(seed);
  });

  it('claims with a signature for the wallet, never the seed itself', async () => {
    invokeMock.mockResolvedValue(undefined);
    await claimVouchSigned(wallet, 7, RFC_SEED);

    const [contract, method, callArgs] = invokeMock.mock.calls[0];
    expect([contract, method]).toEqual([REP_ID, 'claim_vouch_signed']);
    expect(callArgs.slice(0, 2)).toEqual([{ __addr: CLASSIC }, { __u64: 7 }]);
    const sig = (callArgs[2] as { __bytes: Uint8Array }).__bytes;
    expect(sig).toHaveLength(64);
    expect(verifies(fromHex(RFC_PUBLIC), claimMessage(TESTNET, REP_ID, 7, CLASSIC), sig)).toBe(true);
    expect(toHex(sig)).not.toContain(RFC_SEED);
  });

  it('still claims an older card with its secret', async () => {
    invokeMock.mockResolvedValue(undefined);
    await claimVouch(wallet, 3, 'ab'.repeat(32));
    expect(invokeMock).toHaveBeenCalledWith(
      REP_ID,
      'claim_vouch',
      [{ __addr: CLASSIC }, { __u64: 3 }, { __bytes: fromHex('ab'.repeat(32)) }],
      wallet,
    );
  });
});

describe('claim links', () => {
  const seed = 'cd'.repeat(32);

  it('puts the claim key in the fragment and reads it back', () => {
    const link = claimLink('https://alvinmunk.app/', 7, { kind: 'key', code: seed });
    expect(link).toBe(`https://alvinmunk.app/claim/7#k=${seed}`);
    const url = new URL(link);
    expect(url.search).toBe('');
    expect(parseClaimCode(url.hash, url.search)).toEqual({ kind: 'key', code: seed });
  });

  it('keeps reading older links: #s= and the original ?s= query', () => {
    expect(claimLink('https://a.b', 2, { kind: 'secret', code: seed })).toBe(`https://a.b/claim/2#s=${seed}`);
    expect(parseClaimCode(`#s=${seed}`, '')).toEqual({ kind: 'secret', code: seed });
    expect(parseClaimCode('', `?s=${seed}`)).toEqual({ kind: 'secret', code: seed });
    expect(parseClaimCode('', '')).toBeNull();
  });

  it('accepts only 32 bytes of hex as a claim code', () => {
    expect(isClaimCode(seed)).toBe(true);
    expect(isClaimCode(seed.toUpperCase())).toBe(true);
    expect(isClaimCode(seed.slice(1))).toBe(false);
    expect(isClaimCode(`${seed}0`)).toBe(false);
    expect(isClaimCode(`zz${seed.slice(2)}`)).toBe(false);
  });
});
