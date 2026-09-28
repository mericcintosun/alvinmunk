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

import { fromHex, toHex, getProfile, getScores } from './reputation';

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
