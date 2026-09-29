import { describe, it, expect, vi, beforeEach } from 'vitest';

const readPublicMock = vi.fn();

vi.mock('./contracts', () => ({
  repId: () => 'CREPID',
  questId: () => 'CQUESTID',
  readPublic: (...a: unknown[]) => readPublicMock(...a),
  readContract: vi.fn(),
  invokeAndWait: vi.fn(),
  args: {
    addr: (g: string) => ({ __addr: g }),
    u64: (n: number) => ({ __u64: n }),
    str: (s: string) => ({ __str: s }),
    bytes: (b: Uint8Array) => ({ __bytes: b }),
  },
}));

import {
  clampVouchNote,
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
    expect(readPublicMock).toHaveBeenCalledWith('CREPID', 'get_profile', expect.any(Array));
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
    expect(readPublicMock).toHaveBeenCalledWith('CREPID', 'get_counts', expect.any(Array));
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
    expect(readPublicMock).toHaveBeenCalledWith('CREPID', 'get_pending', expect.any(Array));
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
